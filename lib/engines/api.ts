import type { AgentEvent, AgentMessage, AgentTool, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Model, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import type { DmEngine, TurnRequest } from "../game/types";
import { loadPiAgentCore, loadPiAi } from "./esm";
import { loadKeys } from "./keys";
import { piModels } from "./pi-models";
import { errorMessage, eventSink, plainSchema } from "./tools";

/**
 * ApiEngine — one DM turn on an API key through pi-ai + pi-agent-core's
 * `Agent` (pi runs the tool loop: heal → validate → execute, sequentially).
 *
 * pi is stateless per turn, so the conversation is persisted per campaign in
 * DATA_DIR/api-sessions/<key>.json and trimmed to the last ~60 messages at a
 * user-message boundary (the DM injects a state digest every turn, so the
 * dropped head is safe to lose). A failed or aborted turn persists only its
 * valid prefix (no orphaned tool calls, no error/aborted assistant messages).
 *
 * Contract: same as the CLI engines (never rejects, one trailing `done`,
 * provider errors as `error` events, abort → `done` without `error`).
 */

export interface ApiEngineOptions {
	/** Test seam: replaces pi-ai's streamSimple. */
	streamFn?: StreamFn;
	/** Test seam: model lookup (default: pi-ai's catalogs). */
	resolveModel?: (provider: string, id: string) => Promise<Model<Api> | undefined>;
	/** Where histories live (default DATA_DIR/api-sessions). */
	dir?: string;
	/** History cap (default 60). */
	maxMessages?: number;
}

interface StoredSession {
	version: 1;
	provider: string;
	model: string;
	updatedAt: number;
	messages: AgentMessage[];
}

const role = (m: AgentMessage) => (m as { role?: string }).role;

/** The longest prefix that is a valid transcript: every assistant tool call
 *  answered before the next assistant/user message, no error/aborted turns. */
export function validPrefix(messages: readonly AgentMessage[]): AgentMessage[] {
	let valid = 0;
	let i = 0;
	while (i < messages.length) {
		const m = messages[i]!;
		if (role(m) === "user") {
			valid = ++i;
			continue;
		}
		if (role(m) !== "assistant") {
			// a stray tool result / system message outside an assistant batch
			break;
		}
		const a = m as AssistantMessage;
		if (a.stopReason === "error" || a.stopReason === "aborted") break;
		const calls = a.content.filter((c) => c.type === "toolCall").map((c) => (c as { id: string }).id);
		let j = i + 1;
		const answered = new Set<string>();
		while (j < messages.length && role(messages[j]!) === "toolResult") {
			answered.add((messages[j] as ToolResultMessage).toolCallId);
			j++;
		}
		if (!calls.every((id) => answered.has(id))) break;
		i = j;
		valid = j;
	}
	return messages.slice(0, valid);
}

/** Keep at most `max` messages, cutting at a user-message boundary. */
export function trimHistory(messages: readonly AgentMessage[], max: number): AgentMessage[] {
	if (messages.length <= max) return [...messages];
	for (let i = messages.length - max; i < messages.length; i++) {
		if (role(messages[i]!) === "user") return messages.slice(i);
	}
	// No user boundary inside the window: keep from the last user message.
	for (let i = messages.length - 1; i >= 0; i--) if (role(messages[i]!) === "user") return messages.slice(i);
	return [];
}

function safeFileName(key: string): string {
	return key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "default";
}

export class ApiEngine implements DmEngine {
	readonly provider = "api" as const;
	private readonly dir: string;
	private readonly maxMessages: number;

	constructor(private readonly options: ApiEngineOptions = {}) {
		this.dir = options.dir ?? path.join(DATA_DIR, "api-sessions");
		this.maxMessages = options.maxMessages ?? 60;
	}

	private file(sessionKey: string): string {
		return path.join(this.dir, `${safeFileName(sessionKey)}.json`);
	}

	loadHistory(sessionKey: string): AgentMessage[] {
		try {
			const stored = JSON.parse(fs.readFileSync(this.file(sessionKey), "utf8")) as StoredSession;
			return Array.isArray(stored.messages) ? stored.messages.filter((m) => role(m) !== "system") : [];
		} catch {
			return [];
		}
	}

	private saveHistory(sessionKey: string, provider: string, model: string, messages: AgentMessage[]): void {
		fs.mkdirSync(this.dir, { recursive: true });
		const file = this.file(sessionKey);
		const tmp = `${file}.${process.pid}.tmp`;
		const stored: StoredSession = { version: 1, provider, model, updatedAt: Date.now(), messages };
		fs.writeFileSync(tmp, JSON.stringify(stored));
		fs.renameSync(tmp, file);
	}

	resetSession(sessionKey: string): void {
		fs.rmSync(this.file(sessionKey), { force: true });
	}

	async runTurn(req: TurnRequest): Promise<void> {
		const sink = eventSink(req.onEvent);
		try {
			if (req.signal?.aborted) return;
			const providerId = req.config.apiProvider;
			if (!providerId) throw new Error("No API provider selected (config.apiProvider is empty)");
			loadKeys();
			const model = this.options.resolveModel ? await this.options.resolveModel(providerId, req.config.model) : (await piModels()).getModel(providerId, req.config.model);
			if (!model) throw new Error(`Unknown model ${providerId}/${req.config.model}`);
			const [{ Agent }, ai] = await Promise.all([loadPiAgentCore(), loadPiAi()]);
			const level = ai.clampThinkingLevel(model, req.config.effort) as ThinkingLevel;
			const streamFn: StreamFn =
				this.options.streamFn ??
				(await (async () => {
					const models = await piModels();
					return (m, context, opts) => models.streamSimple(m, context, { ...opts, reasoning: level === "off" ? undefined : level } as never);
				})());

			const tools: AgentTool[] = req.tools.map((tool) => ({
				name: tool.name,
				label: tool.name,
				description: tool.description,
				parameters: plainSchema(tool.parameters) as never,
				execute: async (_id, params, signal) => {
					const result = await tool.execute(params as Record<string, unknown>, signal);
					return { content: [{ type: "text", text: result.text }], details: undefined, ...(result.isError ? { isError: true } : {}) };
				},
			}));

			const history = this.loadHistory(req.sessionKey);
			const agent = new Agent({
				initialState: { systemPrompt: req.systemPrompt, model, thinkingLevel: level, tools, messages: history },
				streamFn,
				toolExecution: "sequential",
				sessionId: req.sessionKey,
			});

			let failure: string | undefined;
			let assistantIndex = 0;
			const usage = { input: 0, output: 0, cacheRead: 0, cost: 0, seen: false };
			agent.subscribe((event: AgentEvent) => {
				switch (event.type) {
					case "message_start":
						if (role(event.message) === "assistant") assistantIndex++;
						break;
					case "message_update": {
						const e = event.assistantMessageEvent;
						if (e.type === "text_delta") sink.text(e.delta, `${assistantIndex}:${e.contentIndex}`);
						else if (e.type === "thinking_delta") sink.thinking(e.delta);
						break;
					}
					case "message_end": {
						if (role(event.message) !== "assistant") break;
						const m = event.message as AssistantMessage;
						if (m.usage) {
							usage.input += (m.usage.input ?? 0) + (m.usage.cacheWrite ?? 0);
							usage.output += m.usage.output ?? 0;
							usage.cacheRead += m.usage.cacheRead ?? 0;
							usage.cost += m.usage.cost?.total ?? 0;
							usage.seen = true;
						}
						if (m.stopReason === "error") failure = m.errorMessage || "The model returned an error";
						break;
					}
					case "tool_execution_start":
						sink.emit({ type: "tool_start", id: event.toolCallId, name: event.toolName, args: event.args });
						break;
					case "tool_execution_end": {
						const content = (event.result?.content ?? []) as TextContent[];
						const text = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
						sink.emit({ type: "tool_end", id: event.toolCallId, name: event.toolName, result: { text, ...(event.isError ? { isError: true } : {}) } });
						break;
					}
				}
			});

			const onAbort = () => agent.abort();
			req.signal?.addEventListener("abort", onAbort, { once: true });
			try {
				await agent.prompt(req.input);
			} catch (error) {
				if (!req.signal?.aborted) failure ??= errorMessage(error);
			} finally {
				req.signal?.removeEventListener("abort", onAbort);
			}

			const aborted = !!req.signal?.aborted;
			const all = agent.state.messages.filter((m) => role(m) !== "system");
			const keep = aborted || failure ? validPrefix(all) : all;
			this.saveHistory(req.sessionKey, providerId, req.config.model, trimHistory(keep, this.maxMessages));
			if (aborted) return;
			if (usage.seen) sink.emit({ type: "usage", input: usage.input, output: usage.output, ...(usage.cacheRead ? { cacheRead: usage.cacheRead } : {}), ...(usage.cost ? { costUsd: usage.cost } : {}) });
			if (failure) sink.emit({ type: "error", message: failure });
		} catch (error) {
			if (!req.signal?.aborted) sink.emit({ type: "error", message: errorMessage(error) });
		} finally {
			sink.emit({ type: "done" });
		}
	}
}
