import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookCallbackMatcher, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeCodeEngine, claudeEffort, type QueryFn } from "../lib/engines/claude-code";
import { memoryLedger } from "../lib/engines/sessions";
import type { DmTool, EngineEvent, TurnRequest } from "../lib/game/types";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-cc-test-"));

const rolls: unknown[] = [];
const rollDie: DmTool = {
	name: "roll_die",
	description: "Roll a die",
	parameters: { type: "object", properties: { sides: { type: "integer" } }, required: ["sides"] },
	async execute(args) {
		rolls.push(args);
		return { text: `Rolled ${args.sides}: 17` };
	},
};

function request(events: EngineEvent[], extra: Partial<TurnRequest> = {}): TurnRequest {
	return {
		sessionKey: "camp1",
		systemPrompt: "You are the DM.",
		input: "I sneak.",
		tools: [rollDie],
		config: { provider: "claude-code", model: "claude-haiku-5-5", effort: "low" },
		onEvent: (e) => events.push(e),
		...extra,
	};
}

/** Calls one of our tools the way Claude Code does: PreToolUse hook, then MCP over a real client. */
async function callTool(options: Options, id: string, name: string, args: Record<string, unknown>) {
	const hook = (options.hooks?.PreToolUse?.[0] as HookCallbackMatcher).hooks[0]!;
	await hook({ hook_event_name: "PreToolUse", tool_name: `mcp__dh__${name}`, tool_input: args, tool_use_id: id, session_id: "s", transcript_path: "", cwd: "" } as never, id, { signal: new AbortController().signal });
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
	const server = (options.mcpServers!.dh as { instance: { connect(t: unknown): Promise<void> } }).instance;
	const [a, b] = InMemoryTransport.createLinkedPair();
	await server.connect(a);
	const client = new Client({ name: "fake-claude", version: "1" });
	await client.connect(b);
	const listed = await client.listTools();
	const result = await client.callTool({ name, arguments: args });
	await client.close();
	return { listed, result };
}

const streamText = (messageId: string, text: string): SDKMessage[] => [
	{ type: "stream_event", parent_tool_use_id: null, event: { type: "message_start", message: { id: messageId, model: "claude-haiku-5-5" } } } as never,
	{ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } } } as never,
	{ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text } } } as never,
];
const success = (): SDKMessage => ({ type: "result", subtype: "success", is_error: false, result: "", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 2 } }) as never;

function scripted(script: (options: Options, firstPrompt: SDKUserMessage) => AsyncGenerator<SDKMessage>): { query: QueryFn; calls: Options[] } {
	const calls: Options[] = [];
	const query: QueryFn = ({ prompt, options }) => {
		calls.push(options);
		return (async function* () {
			const it = prompt[Symbol.asyncIterator]();
			const first = (await it.next()).value as SDKUserMessage;
			yield* script(options, first);
		})();
	};
	return { query, calls };
}

test("maps stream events, runs tools over MCP, records usage and ledger", async () => {
	rolls.length = 0;
	let listedNames: string[] = [];
	let seenInput = "";
	const { query, calls } = scripted(async function* (options, first) {
		seenInput = String(first.message.content);
		yield { type: "system", subtype: "init", session_id: options.sessionId } as never;
		yield* streamText("m1", "Rolling.");
		const { listed, result } = await callTool(options, "tu_1", "roll_die", { sides: "20" });
		listedNames = listed.tools.map((t) => t.name);
		assert.equal((result.content as { text: string }[])[0]!.text, "Rolled 20: 17");
		yield* streamText("m2", "You rolled 17.");
		yield success();
	});
	const ledger = memoryLedger();
	const engine = new ClaudeCodeEngine({ query, ledger, workdir });
	const events: EngineEvent[] = [];
	await engine.runTurn(request(events));

	assert.equal(seenInput, "I sneak.");
	assert.deepEqual(listedNames, ["roll_die"]);
	assert.deepEqual(rolls, [{ sides: 20 }], "string arg coerced to integer by validation");
	const o = calls[0]!;
	assert.deepEqual(o.tools, []);
	assert.deepEqual(o.allowedTools, ["mcp__dh__roll_die"]);
	assert.equal(o.permissionMode, "dontAsk");
	assert.deepEqual(o.settingSources, []);
	assert.equal(o.strictMcpConfig, true);
	assert.equal(o.includePartialMessages, true);
	assert.equal(o.systemPrompt, "You are the DM.");
	assert.equal(o.model, "claude-haiku-5-5");
	assert.equal(o.effort, "low");
	assert.equal(o.cwd, workdir);
	assert.equal(o.resume, undefined);
	assert.ok(o.sessionId);
	assert.equal(o.env?.ANTHROPIC_API_KEY, undefined);

	const types = events.map((e) => e.type);
	assert.deepEqual(types, ["thinking", "text", "tool_start", "tool_end", "thinking", "text", "text", "usage", "done"]);
	assert.deepEqual(events[2], { type: "tool_start", id: "tu_1", name: "roll_die", args: { sides: "20" } });
	assert.deepEqual(events[3], { type: "tool_end", id: "tu_1", name: "roll_die", result: { text: "Rolled 20: 17" } });
	assert.equal(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join(""), "Rolling.\n\nYou rolled 17.");
	assert.deepEqual(events[7], { type: "usage", input: 12, output: 5, cacheRead: 100 });
	const entry = ledger.get("claude-code:camp1")!;
	assert.equal(entry.id, o.sessionId);
	assert.equal(entry.model, "claude-haiku-5-5");
});

test("resumes the stored session; model change starts fresh; resetSession forgets", async () => {
	const { query, calls } = scripted(async function* (options) {
		yield { type: "system", subtype: "init", session_id: options.resume ?? options.sessionId } as never;
		yield* streamText("m", "ok");
		yield success();
	});
	const ledger = memoryLedger();
	const engine = new ClaudeCodeEngine({ query, ledger, workdir });
	await engine.runTurn(request([]));
	const first = ledger.get("claude-code:camp1")!.id;
	await engine.runTurn(request([]));
	assert.equal(calls[1]!.resume, first);
	await engine.runTurn(request([], { config: { provider: "claude-code", model: "claude-sonnet-5-5", effort: "off" } }));
	assert.equal(calls[2]!.resume, undefined);
	assert.deepEqual(calls[2]!.thinking, { type: "disabled" });
	assert.notEqual(ledger.get("claude-code:camp1")!.id, first);
	engine.resetSession("camp1");
	assert.equal(ledger.get("claude-code:camp1"), undefined);
});

test("a resume that fails before any output retries once on a fresh session", async () => {
	const { query, calls } = scripted(async function* (options) {
		if (options.resume) {
			yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["No conversation found with session ID: gone"], usage: {} } as never;
			return;
		}
		yield { type: "system", subtype: "init", session_id: options.sessionId } as never;
		yield* streamText("m", "fresh");
		yield success();
	});
	const ledger = memoryLedger();
	const engine = new ClaudeCodeEngine({ query, ledger, workdir });
	ledger.set("claude-code:camp1", { id: "gone", model: "claude-haiku-5-5", toolsFingerprint: (await import("../lib/engines/sessions")).toolsFingerprintOf([rollDie]), updatedAt: 0 });
	const events: EngineEvent[] = [];
	await engine.runTurn(request(events));
	assert.equal(calls.length, 2);
	assert.equal(calls[0]!.resume, "gone");
	assert.equal(calls[1]!.resume, undefined);
	assert.ok(!events.some((e) => e.type === "error"));
	assert.equal(ledger.get("claude-code:camp1")!.id, calls[1]!.sessionId);
});

test("signed-out CLI surfaces Claude Code's own text as one error and never narrates it", async () => {
	const text = "Not logged in · Please run /login";
	const { query } = scripted(async function* () {
		yield { type: "system", subtype: "init", session_id: "s1" } as never;
		yield { type: "assistant", parent_tool_use_id: null, error: "authentication_failed", message: { id: "e1", content: [{ type: "text", text }] } } as never;
		yield { type: "result", subtype: "success", is_error: true, result: text, usage: { input_tokens: 0, output_tokens: 0 } } as never;
	});
	const ledger = memoryLedger();
	const events: EngineEvent[] = [];
	await new ClaudeCodeEngine({ query, ledger, workdir }).runTurn(request(events));
	assert.deepEqual(events, [{ type: "error", message: text }, { type: "done" }]);
	assert.equal(ledger.get("claude-code:camp1"), undefined);
});

test("a thrown query (CLI missing) becomes an error event; runTurn never rejects", async () => {
	const query: QueryFn = () => {
		throw new Error("spawn claude ENOENT");
	};
	const events: EngineEvent[] = [];
	await new ClaudeCodeEngine({ query, ledger: memoryLedger(), workdir }).runTurn(request(events));
	assert.deepEqual(events, [{ type: "error", message: "spawn claude ENOENT" }, { type: "done" }]);
});

test("abort ends the turn with done and no error", async () => {
	const { query } = scripted(async function* (options) {
		yield { type: "system", subtype: "init", session_id: "s-abort" } as never;
		yield* streamText("m", "The goblin");
		const signal = options.abortController!.signal;
		if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
		throw new Error("Claude Code process aborted by user");
	});
	const controller = new AbortController();
	const events: EngineEvent[] = [];
	const ledger = memoryLedger();
	await new ClaudeCodeEngine({ query, ledger, workdir }).runTurn(
		request(events, {
			signal: controller.signal,
			onEvent: (e) => {
				events.push(e);
				if (e.type === "text") controller.abort();
			},
		}),
	);
	assert.deepEqual(events.map((e) => e.type), ["thinking", "text", "done"]);
	assert.equal(ledger.get("claude-code:camp1")!.id, "s-abort", "partial session stays resumable");
});

test("effort mapping", () => {
	assert.deepEqual(claudeEffort("off"), { thinking: { type: "disabled" } });
	assert.deepEqual(claudeEffort("high"), { effort: "high", thinking: { type: "adaptive", display: "summarized" } });
	assert.deepEqual(claudeEffort("max").effort, "max");
});
