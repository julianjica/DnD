import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { ApiEngine, trimHistory, validPrefix } from "../lib/engines/api";
import { piModels } from "../lib/engines/pi-models";
import type { DmTool, EngineEvent, TurnRequest } from "../lib/game/types";

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
		sessionKey: "camp/1",
		systemPrompt: "You are the DM.",
		input: "I sneak.",
		tools: [rollDie],
		config: { provider: "api", apiProvider: "anthropic", model: "claude-haiku-5-5", effort: "low" },
		onEvent: (e) => events.push(e),
		...extra,
	};
}

const usage = (input: number, output: number) => ({ input, output, cacheRead: 1, cacheWrite: 0, totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } });

/** A fake model: each call pops the next scripted reply. */
async function fakeStream(replies: ((ctxMessages: unknown[]) => Partial<AssistantMessage>)[], seen: unknown[][] = []): Promise<StreamFn> {
	const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
	return (model, context) => {
		seen.push([...context.messages]);
		const stream = createAssistantMessageEventStream();
		const reply = replies.shift()!(context.messages);
		const message: AssistantMessage = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: usage(10, 5), stopReason: "stop", timestamp: Date.now(), ...reply };
		setImmediate(() => {
			stream.push({ type: "start", partial: { ...message, content: [] } });
			message.content.forEach((c, i) => {
				if (c.type === "text") stream.push({ type: "text_delta", contentIndex: i, delta: c.text, partial: message });
				if (c.type === "thinking") stream.push({ type: "thinking_delta", contentIndex: i, delta: c.thinking, partial: message });
			});
			if (message.stopReason === "error" || message.stopReason === "aborted") stream.push({ type: "error", reason: message.stopReason, error: message });
			else stream.push({ type: "done", reason: message.stopReason as "stop", message });
			stream.end(message);
		});
		return stream;
	};
}

const resolveModel = async (provider: string, id: string) => (await piModels()).getModel(provider, id);

test("runs pi's tool loop, maps events, persists history, resumes it next turn", async () => {
	rolls.length = 0;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-api-test-"));
	const seen: unknown[][] = [];
	const streamFn = await fakeStream(
		[
			() => ({ content: [{ type: "thinking", thinking: "roll" }, { type: "text", text: "Rolling." }, { type: "toolCall", id: "t1", name: "roll_die", arguments: { sides: "20" } as never }], stopReason: "toolUse" }),
			() => ({ content: [{ type: "text", text: "You rolled 17." }] }),
			() => ({ content: [{ type: "text", text: "17" }] }),
		],
		seen,
	);
	const engine = new ApiEngine({ streamFn, resolveModel, dir });
	const events: EngineEvent[] = [];
	await engine.runTurn(request(events));

	assert.deepEqual(rolls, [{ sides: 20 }]);
	assert.deepEqual(events.map((e) => e.type), ["thinking", "text", "tool_start", "tool_end", "text", "text", "usage", "done"]);
	assert.equal(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join(""), "Rolling.\n\nYou rolled 17.");
	assert.deepEqual(events[3], { type: "tool_end", id: "t1", name: "roll_die", result: { text: "Rolled 20: 17" } });
	assert.deepEqual(events[6], { type: "usage", input: 20, output: 10, cacheRead: 2, costUsd: 0.002 });

	const history = engine.loadHistory("camp/1");
	assert.deepEqual(history.map((m) => (m as { role: string }).role), ["user", "assistant", "toolResult", "assistant"]);
	assert.ok(fs.existsSync(path.join(dir, "camp_1.json")));

	await engine.runTurn(request([], { input: "What did I roll?" }));
	const third = seen[2]!.map((m) => (m as { role: string }).role);
	assert.deepEqual(third, ["system", "user", "assistant", "toolResult", "assistant", "user"], "history replayed with a fresh system prompt");

	engine.resetSession("camp/1");
	assert.deepEqual(engine.loadHistory("camp/1"), []);
});

test("provider errors become error events and are not persisted", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-api-test-"));
	const streamFn = await fakeStream([() => ({ content: [], stopReason: "error", errorMessage: "401 invalid x-api-key" })]);
	const engine = new ApiEngine({ streamFn, resolveModel, dir });
	const events: EngineEvent[] = [];
	await engine.runTurn(request(events));
	assert.deepEqual(events.slice(-2), [{ type: "error", message: "401 invalid x-api-key" }, { type: "done" }]);
	assert.deepEqual(engine.loadHistory("camp/1").map((m) => (m as { role: string }).role), ["user"]);
});

test("unknown model / missing provider are errors, never throws", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-api-test-"));
	const engine = new ApiEngine({ resolveModel, dir });
	const events: EngineEvent[] = [];
	await engine.runTurn(request(events, { config: { provider: "api", apiProvider: "anthropic", model: "nope", effort: "low" } }));
	assert.equal(events[0]!.type, "error");
	assert.equal(events.at(-1)!.type, "done");
	const events2: EngineEvent[] = [];
	await engine.runTurn(request(events2, { config: { provider: "api", model: "x", effort: "low" } }));
	assert.match((events2[0] as { message: string }).message, /No API provider/);
});

test("abort: done without error; only the valid prefix is kept", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-api-test-"));
	const controller = new AbortController();
	const streamFn = await fakeStream([() => ({ content: [{ type: "text", text: "partial" }], stopReason: "aborted" })]);
	const engine = new ApiEngine({ streamFn, resolveModel, dir });
	const events: EngineEvent[] = [];
	await engine.runTurn(
		request(events, {
			signal: controller.signal,
			onEvent: (e) => {
				events.push(e);
				if (e.type === "text") controller.abort();
			},
		}),
	);
	assert.deepEqual(events.map((e) => e.type), ["text", "done"]);
	assert.deepEqual(engine.loadHistory("camp/1").map((m) => (m as { role: string }).role), ["user"]);
});

test("validPrefix drops orphaned tool calls; trimHistory cuts at a user boundary", () => {
	const u = { role: "user", content: "x", timestamp: 0 };
	const call = { role: "assistant", content: [{ type: "toolCall", id: "a", name: "t", arguments: {} }], stopReason: "toolUse" };
	const res = { role: "toolResult", toolCallId: "a", toolName: "t", content: [], isError: false, timestamp: 0 };
	const fin = { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" };
	assert.equal(validPrefix([u, call, res, fin] as never).length, 4);
	assert.equal(validPrefix([u, call, res, fin, u, call] as never).length, 5);
	assert.equal(validPrefix([u, { ...fin, stopReason: "error" }] as never).length, 1);
	const long = Array.from({ length: 10 }, (_, i) => (i % 3 === 0 ? u : fin));
	const trimmed = trimHistory(long as never, 5);
	assert.equal((trimmed[0] as { role: string }).role, "user");
	assert.ok(trimmed.length <= 5);
});
