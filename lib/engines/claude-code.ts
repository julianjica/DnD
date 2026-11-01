import type { HookCallbackMatcher, Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { PATHS } from "../config";
import type { DmEngine, Effort, TurnRequest } from "../game/types";
import { claudeCodeEnv, claudeCodeExecutable } from "./cli";
import { loadClaudeSdk } from "./esm";
import { bareToolName, createToolServer, mcpToolName } from "./mcp";
import { noteClaudeRateLimitEvent } from "./plan-limits";
import { fileLedger, ledgerKey, resumableEntry, toolsFingerprintOf, type SessionLedger } from "./sessions";
import { errorMessage, eventSink, runDmTool, serialQueue } from "./tools";

/**
 * ClaudeCodeEngine — one DM turn on the locally signed-in Claude Code CLI,
 * through the Agent SDK's `query()` (simplified from learnharness
 * claude-code/agent.ts; see docs/claude-code-engine.md there).
 *
 * Claude Code runs the model + tool loop itself. We give it OUR system
 * prompt, NO built-in tools (`tools: []`), no user/project settings
 * (`settingSources: []`, `strictMcpConfig`), and our DmTools through an
 * in-process MCP server ("dh"); `permissionMode: "dontAsk"` + allowedTools
 * means only our tools ever run. Stream events become EngineEvents.
 *
 * Sessions: the Claude Code session id is stored in the ledger per
 * campaign and resumed next turn (same model + same tools only). If a
 * resumed attempt fails before producing any output (session file gone,
 * corrupt), the turn is retried once on a fresh session.
 *
 * Contract (all engines): runTurn never rejects; it emits exactly one
 * trailing `done`; failures are `error` events carrying the CLI's own text
 * (not signed in, rate limits…); an abort ends with `done` and no `error`.
 */

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>;

export interface ClaudeCodeEngineOptions {
	/** Test seam: a scripted query(). */
	query?: QueryFn;
	ledger?: SessionLedger;
	workdir?: string;
	/** Extra env for the Claude Code process (debugging). */
	env?: Record<string, string>;
	stderr?: (data: string) => void;
}

/** Our effort → Claude Code effort + thinking. "off" disables thinking. */
export function claudeEffort(effort: Effort | undefined): Pick<Options, "effort" | "thinking"> {
	if (effort === "off") return { thinking: { type: "disabled" } };
	const thinking = { type: "adaptive", display: "summarized" } as Options["thinking"];
	if (!effort) return { thinking };
	return { effort, thinking };
}

/** A push-based async iterable — the SDK's streaming-input channel (in-process
 *  MCP servers need streaming-input mode). */
class InputChannel implements AsyncIterable<SDKUserMessage> {
	private items: SDKUserMessage[] = [];
	private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | undefined;
	private closed = false;
	push(item: SDKUserMessage) {
		if (this.closed) return;
		if (this.waiting) {
			const w = this.waiting;
			this.waiting = undefined;
			w({ value: item, done: false });
		} else this.items.push(item);
	}
	close() {
		this.closed = true;
		if (this.waiting) {
			const w = this.waiting;
			this.waiting = undefined;
			w({ value: undefined, done: true });
		}
	}
	[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
		return {
			next: () => {
				const item = this.items.shift();
				if (item) return Promise.resolve({ value: item, done: false });
				if (this.closed) return Promise.resolve({ value: undefined, done: true });
				return new Promise((resolve) => (this.waiting = resolve));
			},
			return: () => {
				this.close();
				return Promise.resolve({ value: undefined, done: true });
			},
		};
	}
}

interface AttemptOutcome {
	sessionId?: string;
	failure?: string;
	aborted: boolean;
}

type Sink = ReturnType<typeof eventSink>;

export class ClaudeCodeEngine implements DmEngine {
	readonly provider = "claude-code" as const;
	private readonly ledger: SessionLedger;

	constructor(private readonly options: ClaudeCodeEngineOptions = {}) {
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
			let outcome = await this.attempt(req, sink, entry?.id);
			if (entry && outcome.failure && !outcome.aborted && !sink.emittedAny) {
				// The resumed session may be gone or unusable: retry once fresh.
				outcome = await this.attempt(req, sink, undefined);
			}
			const save = (id: string) => this.ledger.set(key, { id, model: req.config.model, toolsFingerprint, updatedAt: Date.now() });
			if (outcome.aborted) {
				// Claude Code persists partial turns; the session stays resumable.
				if (outcome.sessionId) save(outcome.sessionId);
				return;
			}
			if (outcome.failure) {
				sink.emit({ type: "error", message: outcome.failure });
				return;
			}
			if (outcome.sessionId) save(outcome.sessionId);
		} catch (error) {
			if (!req.signal?.aborted) sink.emit({ type: "error", message: errorMessage(error) });
		} finally {
			sink.emit({ type: "done" });
		}
	}

	private async attempt(req: TurnRequest, sink: Sink, resume: string | undefined): Promise<AttemptOutcome> {
		const controller = new AbortController();
		const onAbort = () => controller.abort();
		req.signal?.addEventListener("abort", onAbort, { once: true });
		if (req.signal?.aborted) controller.abort();

		let sessionId: string | undefined = resume;
		const freshId = resume ? undefined : randomUUID();
		let failure: string | undefined;
		let sawResult = false;

		const input = new InputChannel();
		input.push({ type: "user", message: { role: "user", content: req.input }, parent_tool_use_id: null } as SDKUserMessage);

		// ── tools: PreToolUse records Claude Code's tool_use ids; the MCP
		// handler claims one (same name + identical args, else first by name).
		const pending: { id: string; name: string; key: string }[] = [];
		const serial = serialQueue();
		const callTool = (name: string, args: unknown): Promise<CallToolResult> =>
			serial(async () => {
				const bare = bareToolName(name);
				const argKey = JSON.stringify(args ?? {});
				let index = pending.findIndex((p) => p.name === bare && p.key === argKey);
				if (index < 0) index = pending.findIndex((p) => p.name === bare);
				const id = index >= 0 ? pending.splice(index, 1)[0]!.id : `cc_${randomUUID()}`;
				sink.emit({ type: "tool_start", id, name: bare, args: args ?? {} });
				const result = await runDmTool(req.tools, bare, args, controller.signal);
				sink.emit({ type: "tool_end", id, name: bare, result });
				return { content: [{ type: "text", text: result.text }], isError: !!result.isError };
			});
		const preToolUse: HookCallbackMatcher = {
			hooks: [
				async (hookInput) => {
					if (hookInput.hook_event_name === "PreToolUse") {
						pending.push({ id: hookInput.tool_use_id, name: bareToolName(hookInput.tool_name), key: JSON.stringify(hookInput.tool_input ?? {}) });
					}
					return {};
				},
			],
		};

		const workdir = this.options.workdir ?? PATHS.claudeCodeWorkdir;
		fs.mkdirSync(workdir, { recursive: true });
		const executable = claudeCodeExecutable();
		const toolServer = await createToolServer(req.tools, callTool);
		const options: Options = {
			systemPrompt: req.systemPrompt,
			model: req.config.model,
			tools: [],
			mcpServers: { [toolServer.name]: toolServer },
			allowedTools: req.tools.map((t) => mcpToolName(t.name)),
			permissionMode: "dontAsk",
			settingSources: [],
			strictMcpConfig: true,
			includePartialMessages: true,
			abortController: controller,
			cwd: workdir,
			env: claudeCodeEnv(this.options.env),
			persistSession: true,
			hooks: { PreToolUse: [preToolUse] },
			...(resume ? { resume } : { sessionId: freshId }),
			...claudeEffort(req.config.effort),
			...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
			...(this.options.stderr ? { stderr: this.options.stderr } : {}),
		};

		const streamed = new Set<string>(); // assistant message ids seen via stream events
		let currentMessage = "";
		try {
			const query = this.options.query ?? ((await loadClaudeSdk()).query as unknown as QueryFn);
			for await (const msg of query({ prompt: input, options })) {
				switch (msg.type) {
					case "system":
						if ((msg as { subtype?: string }).subtype === "init") sessionId = (msg as { session_id?: string }).session_id ?? sessionId ?? freshId;
						break;
					case "rate_limit_event":
						noteClaudeRateLimitEvent();
						break;
					case "stream_event": {
						if (msg.parent_tool_use_id) break;
						const ev = msg.event;
						if (ev.type === "message_start") {
							currentMessage = ev.message.id;
							streamed.add(ev.message.id);
						} else if (ev.type === "content_block_delta") {
							const delta = ev.delta as { type: string; text?: string; thinking?: string };
							if (delta.type === "text_delta") sink.text(delta.text ?? "", `${currentMessage}:${ev.index}`);
							else if (delta.type === "thinking_delta") sink.thinking(delta.thinking ?? "");
						}
						break;
					}
					case "assistant": {
						if (msg.parent_tool_use_id) break;
						// An error message (signed out, rate limited…) is reported by
						// the result; never narrate its text.
						if (msg.error) break;
						if (streamed.has(msg.message.id)) break;
						// Fallback for a message that arrived without stream events.
						streamed.add(msg.message.id);
						(msg.message.content as unknown as { type: string; text?: string; thinking?: string }[]).forEach((block, i) => {
							if (block.type === "text") sink.text(block.text ?? "", `${msg.message.id}:${i}`);
							else if (block.type === "thinking") sink.thinking(block.thinking ?? "");
						});
						break;
					}
					case "result": {
						sawResult = true;
						if (msg.subtype !== "success") {
							failure = (msg as { errors?: string[] }).errors?.filter(Boolean).join("; ") || `Claude Code stopped: ${msg.subtype}`;
						} else if (msg.is_error) {
							failure = String(msg.result || "Claude Code reported an error");
						}
						const u = msg.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
						if (u && !failure) {
							sink.emit({
								type: "usage",
								input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
								output: u.output_tokens ?? 0,
								...(u.cache_read_input_tokens ? { cacheRead: u.cache_read_input_tokens } : {}),
							});
						}
						input.close();
						break;
					}
				}
			}
		} catch (error) {
			if (!controller.signal.aborted) failure ??= errorMessage(error);
		} finally {
			input.close();
			req.signal?.removeEventListener("abort", onAbort);
		}
		const aborted = controller.signal.aborted;
		if (!aborted && !failure && !sawResult) failure = "Claude Code ended without a result";
		return { sessionId: sessionId ?? (sawResult ? freshId : undefined), failure: aborted ? undefined : failure, aborted };
	}
}
