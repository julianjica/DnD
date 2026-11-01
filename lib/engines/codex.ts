import fs from "node:fs";
import { PATHS } from "../config";
import type { DmEngine, Effort, TurnRequest } from "../game/types";
import { codexEnv } from "./cli";
import { CLIENT_INFO, CodexClient, spawnCodex, type ConnectFn } from "./codex-rpc";
import { recordCodexRateLimits } from "./plan-limits";
import { fileLedger, ledgerKey, resumableEntry, toolsFingerprintOf, type SessionLedger } from "./sessions";
import { errorMessage, eventSink, plainSchema, runDmTool, serialQueue } from "./tools";

/**
 * CodexEngine — one DM turn on the locally signed-in Codex CLI, over
 * `codex app-server` JSON-RPC (simplified from learnharness codex/agent.ts;
 * see docs/codex-engine.md there).
 *
 *   initialize {experimentalApi} → thread/start {baseInstructions = our
 *   system prompt, dynamicTools = our DmTools, approvalPolicy never,
 *   sandbox read-only} | thread/resume {threadId}
 *   → turn/start {input, effort, summary}
 *   ◀ item/tool/call (server request) — we execute the DmTool and answer
 *   ◀ item/agentMessage/delta, item/reasoning/* deltas, thread/tokenUsage/updated
 *   ◀ turn/completed {status}
 *
 * Codex's built-ins are switched off by codex-rpc.ts flags; code mode stays
 * on (current models reach dynamic tools through it). Dynamic tools are
 * fixed at thread/start, hence the ledger's tools fingerprint: a different
 * tool set (or model) starts a new thread. A thread that cannot be resumed
 * is replaced by a fresh one in the same turn.
 *
 * Contract: same as ClaudeCodeEngine (never rejects, one trailing `done`,
 * failures as `error` with Codex's text, abort → `done` without `error`).
 */

export interface CodexEngineOptions {
	/** Test seam: a scripted app-server. */
	connect?: ConnectFn;
	ledger?: SessionLedger;
	workdir?: string;
	/** Extra env for the Codex process (debugging). */
	env?: Record<string, string>;
	stderr?: (data: string) => void;
}

export type CodexEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Our effort → Codex reasoning effort + summary. Codex models have no
 *  "off": it runs at the lowest effort with no summary. */
export function codexEffort(effort: Effort | undefined): { effort?: CodexEffort; summary: "auto" | "none" } {
	if (!effort) return { summary: "auto" };
	if (effort === "off") return { effort: "low", summary: "none" };
	return { effort, summary: "auto" };
}

interface CodexItem {
	type: string;
	id: string;
	text?: string;
}
interface CodexTurn {
	id: string;
	status: "completed" | "interrupted" | "failed" | "inProgress";
	error?: { message?: string } | null;
}
interface TokenBreakdown {
	totalTokens?: number;
	inputTokens?: number;
	cachedInputTokens?: number;
	cacheWriteInputTokens?: number;
	outputTokens?: number;
}

interface RunOutcome {
	threadId?: string;
	failure?: string;
	aborted: boolean;
}

type Sink = ReturnType<typeof eventSink>;

export class CodexEngine implements DmEngine {
	readonly provider = "codex" as const;
	private readonly ledger: SessionLedger;

	constructor(private readonly options: CodexEngineOptions = {}) {
		this.ledger = options.ledger ?? fileLedger();
	}

	resetSession(sessionKey: string): void {
		this.ledger.delete(ledgerKey(this.provider, sessionKey));
	}

	async runTurn(req: TurnRequest): Promise<void> {
		const sink = eventSink(req.onEvent);
		try {
			if (req.signal?.aborted) return;
			const key = ledgerKey(this.provider, req.sessionKey);
			const toolsFingerprint = toolsFingerprintOf(req.tools);
			const entry = resumableEntry(this.ledger, key, req.config.model, toolsFingerprint);
			const outcome = await this.run(req, sink, entry?.id);
			const save = (id: string) => this.ledger.set(key, { id, model: req.config.model, toolsFingerprint, updatedAt: Date.now() });
			if (outcome.aborted) {
				if (outcome.threadId) save(outcome.threadId);
				return;
			}
			if (outcome.failure) {
				sink.emit({ type: "error", message: outcome.failure });
				return;
			}
			if (outcome.threadId) save(outcome.threadId);
		} catch (error) {
			if (!req.signal?.aborted) sink.emit({ type: "error", message: errorMessage(error) });
		} finally {
			sink.emit({ type: "done" });
		}
	}

	private async run(req: TurnRequest, sink: Sink, resumeId: string | undefined): Promise<RunOutcome> {
		const signal = req.signal;
		let threadId: string | undefined;
		let turnId: string | undefined;
		let failure: string | undefined;
		let finished = false;
		let resolveDone!: () => void;
		const done = new Promise<void>((resolve) => (resolveDone = resolve));
		const finish = () => {
			finished = true;
			resolveDone();
		};
		const aborted = () => !!signal?.aborted;

		// per-item text bookkeeping: what was streamed, so item/completed only adds the remainder
		const streamedText = new Map<string, string>();
		const thinkingSeen = new Set<string>();
		const usage = { input: 0, output: 0, cacheRead: 0, seen: false };

		const onNotification = async (method: string, params: Record<string, unknown>) => {
			if (method === "account/rateLimits/updated") return recordCodexRateLimits(params.rateLimits);
			if (finished) return;
			if (threadId && params.threadId !== undefined && params.threadId !== threadId) return;
			if (method === "turn/started") {
				turnId = (params.turn as CodexTurn).id;
				return;
			}
			if (method === "turn/completed") {
				const turn = params.turn as CodexTurn;
				if (turnId && turn.id !== turnId) return;
				if (turn.status === "failed") failure ??= turn.error?.message ?? "Codex turn failed";
				else if (turn.status === "interrupted" && !aborted()) failure ??= "Codex interrupted the turn";
				return finish();
			}
			if (method === "error") {
				if (params.willRetry !== true) failure ??= (params.error as { message?: string } | undefined)?.message ?? "Codex reported an error";
				return;
			}
			if (turnId && params.turnId !== undefined && params.turnId !== turnId) return;
			switch (method) {
				case "item/agentMessage/delta": {
					const itemId = String(params.itemId ?? "");
					const delta = String(params.delta ?? "");
					streamedText.set(itemId, (streamedText.get(itemId) ?? "") + delta);
					sink.text(delta, itemId);
					return;
				}
				case "item/reasoning/summaryTextDelta":
				case "item/reasoning/textDelta": {
					thinkingSeen.add(String(params.itemId ?? ""));
					sink.thinking(String(params.delta ?? ""));
					return;
				}
				case "item/reasoning/summaryPartAdded": {
					if (thinkingSeen.has(String(params.itemId ?? ""))) sink.thinking("\n\n");
					return;
				}
				case "item/completed": {
					const item = params.item as CodexItem;
					if (item?.type === "agentMessage" && typeof item.text === "string") {
						// Some models deliver text only on completion: send what was not streamed.
						const sent = streamedText.get(item.id) ?? "";
						if (item.text.length > sent.length && item.text.startsWith(sent)) sink.text(item.text.slice(sent.length), item.id);
						streamedText.set(item.id, item.text);
					}
					return;
				}
				case "thread/tokenUsage/updated": {
					// `last` is one model step; a turn may take several (tool round trips).
					const last = (params.tokenUsage as { last?: TokenBreakdown } | undefined)?.last;
					if (!last) return;
					// OpenAI counts cached and cache-write tokens inside inputTokens.
					const cached = last.cachedInputTokens ?? 0;
					usage.cacheRead += cached;
					usage.input += Math.max(0, (last.inputTokens ?? 0) - cached);
					usage.output += last.outputTokens ?? 0;
					usage.seen = true;
					return;
				}
			}
		};

		const onToolCall = async (params: { callId: string; tool: string; arguments: unknown }) => {
			if (finished || aborted()) return { contentItems: [{ type: "inputText", text: "The turn has ended." }], success: false };
			const args = params.arguments ?? {};
			sink.emit({ type: "tool_start", id: params.callId, name: params.tool, args });
			const result = await runDmTool(req.tools, params.tool, args, signal);
			sink.emit({ type: "tool_end", id: params.callId, name: params.tool, result });
			return { contentItems: [{ type: "inputText", text: result.text }], success: !result.isError };
		};

		// Codex messages are handled strictly in arrival order: a tool call is
		// answered only after the deltas before it landed.
		const serial = serialQueue();
		let client: CodexClient | undefined;
		const interrupt = () => {
			if (client && threadId && turnId) client.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
		};
		const onAbort = () => {
			interrupt();
			finish();
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		try {
			const workdir = this.options.workdir ?? PATHS.codexWorkdir;
			fs.mkdirSync(workdir, { recursive: true });
			const connect = this.options.connect ?? spawnCodex;
			client = new CodexClient(connect({ cwd: workdir, env: codexEnv(this.options.env), ...(this.options.stderr ? { stderr: this.options.stderr } : {}) }), {
				notification: (method, params) =>
					void serial(() => onNotification(method, (params ?? {}) as Record<string, unknown>)).catch((error: unknown) => {
						failure ??= errorMessage(error);
						finish();
					}),
				request: (method, params) => {
					if (method === "item/tool/call") return serial(() => onToolCall(params as never));
					return Promise.reject(new Error(`DungeonHarness does not handle ${method}`));
				},
				closed: (reason) => {
					if (!finished && !aborted()) failure ??= reason ?? "Codex closed the connection";
					finish();
				},
			});
			const c = client;
			await c.request("initialize", CLIENT_INFO);
			c.notify("initialized");
			const common = { model: req.config.model, baseInstructions: req.systemPrompt, approvalPolicy: "never", sandbox: "read-only", cwd: workdir };
			if (resumeId) {
				try {
					threadId = (await c.request<{ thread: { id: string } }>("thread/resume", { threadId: resumeId, ...common })).thread.id;
				} catch {
					threadId = undefined; // the thread is gone: start a new one
				}
			}
			if (!threadId) {
				const dynamicTools = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, inputSchema: plainSchema(t.parameters) }));
				threadId = (await c.request<{ thread: { id: string } }>("thread/start", { ...common, dynamicTools })).thread.id;
			}
			if (aborted()) return { threadId, aborted: true };
			const { effort, summary } = codexEffort(req.config.effort);
			const response = await c.request<{ turn: CodexTurn }>("turn/start", {
				threadId,
				input: [{ type: "text", text: req.input, text_elements: [] }],
				model: req.config.model,
				summary,
				...(effort ? { effort } : {}),
			});
			turnId ??= response.turn.id;
			if (aborted()) interrupt();
			await done;
			await serial(async () => undefined); // drain handlers queued before completion
		} catch (error) {
			if (!aborted()) failure ??= errorMessage(error);
		} finally {
			signal?.removeEventListener("abort", onAbort);
			finished = true;
			client?.close();
		}
		if (aborted()) return { threadId, aborted: true };
		if (!failure && usage.seen) sink.emit({ type: "usage", input: usage.input, output: usage.output, ...(usage.cacheRead ? { cacheRead: usage.cacheRead } : {}) });
		return { threadId, failure, aborted: false };
	}
}
