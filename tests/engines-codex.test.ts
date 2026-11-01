import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexEngine, codexEffort } from "../lib/engines/codex";
import { codexArgs, type CodexTransport, type ConnectFn, type RpcMessage } from "../lib/engines/codex-rpc";
import { memoryLedger, toolsFingerprintOf } from "../lib/engines/sessions";
import type { DmTool, EngineEvent, TurnRequest } from "../lib/game/types";

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-codex-test-"));

const rollDie: DmTool = {
	name: "roll_die",
	description: "Roll a die",
	parameters: { type: "object", properties: { sides: { type: "integer" } }, required: ["sides"] },
	async execute(args) {
		return { text: `Rolled ${args.sides}: 17` };
	},
};

function request(events: EngineEvent[], extra: Partial<TurnRequest> = {}): TurnRequest {
	return {
		sessionKey: "camp1",
		systemPrompt: "You are the DM.",
		input: "I sneak.",
		tools: [rollDie],
		config: { provider: "codex", model: "gpt-6-luna", effort: "low" },
		onEvent: (e) => events.push(e),
		...extra,
	};
}

type TurnScript = (server: FakeServer, threadId: string, turnId: string) => Promise<void>;

/** A scripted app-server speaking the real message order. */
class FakeServer {
	requests: { method: string; params: Record<string, unknown> }[] = [];
	threads = new Set<string>(["thread-old"]);
	private listener: ((m: RpcMessage) => void) | undefined;
	private closer: ((reason?: string) => void) | undefined;
	private waiting = new Map<string, (m: RpcMessage) => void>();
	private nextThread = 1;
	closed = false;
	constructor(private readonly turn: TurnScript) {}

	connect: ConnectFn = (options) => {
		assert.equal(options.cwd, workdir);
		assert.equal(options.env.OPENAI_API_KEY, undefined);
		const transport: CodexTransport = {
			send: (m) => this.receive(m),
			onMessage: (l) => void (this.listener = l),
			onClose: (l) => void (this.closer = l),
			close: () => {
				this.closed = true;
			},
		};
		return transport;
	};

	emit(method: string, params: unknown) {
		setImmediate(() => this.listener?.({ method, params }));
	}
	/** A server request (item/tool/call); resolves with our answer. */
	ask(method: string, params: unknown): Promise<RpcMessage> {
		const id = `srv-${Math.random()}`;
		return new Promise((resolve) => {
			this.waiting.set(id, resolve);
			setImmediate(() => this.listener?.({ id, method, params }));
		});
	}
	crash(reason: string) {
		this.closer?.(reason);
	}

	private reply(id: RpcMessage["id"], result: unknown, error?: string) {
		setImmediate(() => this.listener?.(error ? { id, error: { message: error } } : { id, result }));
	}

	private receive(m: RpcMessage) {
		if (m.method === undefined && m.id !== undefined) {
			const w = this.waiting.get(String(m.id));
			this.waiting.delete(String(m.id));
			w?.(m);
			return;
		}
		const params = (m.params ?? {}) as Record<string, unknown>;
		this.requests.push({ method: m.method!, params });
		switch (m.method) {
			case "initialize":
				return this.reply(m.id, { userAgent: "fake" });
			case "initialized":
				return;
			case "thread/start": {
				const id = `thread-${this.nextThread++}`;
				this.threads.add(id);
				return this.reply(m.id, { thread: { id } });
			}
			case "thread/resume":
				if (!this.threads.has(String(params.threadId))) return this.reply(m.id, null, "no rollout found for thread id");
				return this.reply(m.id, { thread: { id: params.threadId } });
			case "turn/start": {
				const turnId = `turn-${this.requests.length}`;
				this.reply(m.id, { turn: { id: turnId, status: "inProgress" } });
				const threadId = String(params.threadId);
				setImmediate(() => {
					this.emit("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } });
					void this.turn(this, threadId, turnId);
				});
				return;
			}
			case "turn/interrupt": {
				this.reply(m.id, {});
				this.emit("turn/completed", { threadId: params.threadId, turn: { id: params.turnId, status: "interrupted" } });
				return;
			}
		}
	}
}

const tick = () => new Promise((r) => setImmediate(r));

const happyTurn: TurnScript = async (s, threadId, turnId) => {
	await tick();
	s.emit("item/started", { threadId, turnId, item: { type: "agentMessage", id: "a1", text: "" } });
	s.emit("item/agentMessage/delta", { threadId, turnId, itemId: "a1", delta: "Rolling" });
	s.emit("item/completed", { threadId, turnId, item: { type: "agentMessage", id: "a1", text: "Rolling." } });
	s.emit("item/reasoning/summaryTextDelta", { threadId, turnId, itemId: "r1", delta: "think" });
	await tick();
	const answer = await s.ask("item/tool/call", { threadId, turnId, callId: "call-1", tool: "roll_die", arguments: { sides: 20 } });
	assert.deepEqual(answer.result, { contentItems: [{ type: "inputText", text: "Rolled 20: 17" }], success: true });
	s.emit("thread/tokenUsage/updated", { threadId, turnId, tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 7, totalTokens: 107 } } });
	s.emit("item/agentMessage/delta", { threadId, turnId, itemId: "a2", delta: "You rolled 17." });
	s.emit("item/completed", { threadId, turnId, item: { type: "agentMessage", id: "a2", text: "You rolled 17." } });
	s.emit("thread/tokenUsage/updated", { threadId, turnId, tokenUsage: { last: { inputTokens: 50, cachedInputTokens: 40, outputTokens: 3 } } });
	s.emit("account/rateLimits/updated", { rateLimits: { primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1 }, secondary: null } });
	s.emit("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
};

test("thread/start with our prompt + dynamic tools, streams text, answers tool calls, sums usage", async () => {
	const server = new FakeServer(happyTurn);
	const ledger = memoryLedger();
	const events: EngineEvent[] = [];
	await new CodexEngine({ connect: server.connect, ledger, workdir }).runTurn(request(events));

	const start = server.requests.find((r) => r.method === "thread/start")!.params;
	assert.equal(start.baseInstructions, "You are the DM.");
	assert.equal(start.approvalPolicy, "never");
	assert.equal(start.sandbox, "read-only");
	assert.equal(start.model, "gpt-6-luna");
	assert.deepEqual(start.dynamicTools, [{ type: "function", name: "roll_die", description: "Roll a die", inputSchema: rollDie.parameters }]);
	const turn = server.requests.find((r) => r.method === "turn/start")!.params;
	assert.deepEqual(turn.input, [{ type: "text", text: "I sneak.", text_elements: [] }]);
	assert.equal(turn.effort, "low");
	assert.equal(turn.summary, "auto");

	assert.deepEqual(
		events.map((e) => e.type),
		["text", "text", "thinking", "tool_start", "tool_end", "text", "text", "usage", "done"],
	);
	const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
	assert.equal(text, "Rolling.\n\nYou rolled 17.", "completed text adds only the unstreamed remainder");
	assert.deepEqual(events[3], { type: "tool_start", id: "call-1", name: "roll_die", args: { sides: 20 } });
	assert.deepEqual(events.find((e) => e.type === "usage"), { type: "usage", input: 30, output: 10, cacheRead: 120 });
	assert.equal(ledger.get("codex:camp1")!.id, "thread-1");
	assert.ok(server.closed);
});

test("resumes a matching thread; a missing thread or changed tools starts a new one", async () => {
	const server = new FakeServer(async (s, threadId, turnId) => {
		s.emit("item/agentMessage/delta", { threadId, turnId, itemId: "a", delta: "ok" });
		s.emit("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
	});
	const ledger = memoryLedger();
	const engine = new CodexEngine({ connect: server.connect, ledger, workdir });
	const fp = toolsFingerprintOf([rollDie]);

	ledger.set("codex:camp1", { id: "thread-old", model: "gpt-6-luna", toolsFingerprint: fp, updatedAt: 0 });
	await engine.runTurn(request([]));
	assert.deepEqual(server.requests.filter((r) => r.method.startsWith("thread/")).map((r) => r.method), ["thread/resume"]);
	assert.equal(ledger.get("codex:camp1")!.id, "thread-old");

	server.requests = [];
	ledger.set("codex:camp1", { id: "thread-gone", model: "gpt-6-luna", toolsFingerprint: fp, updatedAt: 0 });
	const events: EngineEvent[] = [];
	await engine.runTurn(request(events));
	assert.deepEqual(server.requests.filter((r) => r.method.startsWith("thread/")).map((r) => r.method), ["thread/resume", "thread/start"]);
	assert.ok(!events.some((e) => e.type === "error"));
	assert.equal(ledger.get("codex:camp1")!.id, "thread-1");

	server.requests = [];
	const other: DmTool = { ...rollDie, name: "other" };
	await engine.runTurn(request([], { tools: [rollDie, other] }));
	assert.deepEqual(server.requests.filter((r) => r.method.startsWith("thread/")).map((r) => r.method), ["thread/start"]);
});

test("a failed turn surfaces Codex's message; unknown tools answer success:false", async () => {
	let toolAnswer: RpcMessage | undefined;
	const server = new FakeServer(async (s, threadId, turnId) => {
		toolAnswer = await s.ask("item/tool/call", { threadId, turnId, callId: "c", tool: "nope", arguments: {} });
		s.emit("error", { threadId, turnId, willRetry: true, error: { message: "retrying" } });
		s.emit("turn/completed", { threadId, turn: { id: turnId, status: "failed", error: { message: "You've hit your usage limit." } } });
	});
	const ledger = memoryLedger();
	const events: EngineEvent[] = [];
	await new CodexEngine({ connect: server.connect, ledger, workdir }).runTurn(request(events));
	assert.equal((toolAnswer!.result as { success: boolean }).success, false);
	assert.deepEqual(events.slice(-2), [{ type: "error", message: "You've hit your usage limit." }, { type: "done" }]);
	assert.equal(ledger.get("codex:camp1"), undefined);
});

test("the child dying mid-turn is an error", async () => {
	const server = new FakeServer(async (s) => {
		await tick();
		s.crash("Codex exited (1): not logged in");
	});
	const events: EngineEvent[] = [];
	await new CodexEngine({ connect: server.connect, ledger: memoryLedger(), workdir }).runTurn(request(events));
	assert.deepEqual(events, [{ type: "error", message: "Codex exited (1): not logged in" }, { type: "done" }]);
});

test("abort sends turn/interrupt and ends with done, no error", async () => {
	const server = new FakeServer(async (s, threadId, turnId) => {
		s.emit("item/agentMessage/delta", { threadId, turnId, itemId: "a", delta: "The goblin" });
		// never completes on its own
	});
	const controller = new AbortController();
	const events: EngineEvent[] = [];
	const ledger = memoryLedger();
	await new CodexEngine({ connect: server.connect, ledger, workdir }).runTurn(
		request(events, {
			signal: controller.signal,
			onEvent: (e) => {
				events.push(e);
				if (e.type === "text") controller.abort();
			},
		}),
	);
	assert.deepEqual(events.map((e) => e.type), ["text", "done"]);
	assert.ok(server.requests.some((r) => r.method === "turn/interrupt"));
	assert.equal(ledger.get("codex:camp1")!.id, "thread-1");
});

test("CLI flags disable built-ins; effort mapping", () => {
	const args = codexArgs();
	assert.equal(args[0], "app-server");
	assert.ok(args.includes("shell_tool") && args.includes("mcp_servers={}") && args.includes('web_search="disabled"'));
	assert.deepEqual(codexEffort("off"), { effort: "low", summary: "none" });
	assert.deepEqual(codexEffort("xhigh"), { effort: "xhigh", summary: "auto" });
});
