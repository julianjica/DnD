import type { DmTool, EngineEvent, JsonSchema, ToolResult } from "../game/types";
import { loadPiAi } from "./esm";

/**
 * Shared tool execution for the CLI engines. The API engine gets the same
 * behaviour from pi's own tool loop: unknown tool → error result; arguments
 * coerced + validated with pi-ai's validateToolArguments (plain JSON Schema
 * works); a throwing tool → error result carrying its message. Tool failures
 * never fail the turn — the model sees the error and can retry.
 */
export async function runDmTool(tools: readonly DmTool[], name: string, args: unknown, signal?: AbortSignal): Promise<ToolResult> {
	const tool = tools.find((t) => t.name === name);
	if (!tool) return { text: `Unknown tool "${name}". Available: ${tools.map((t) => t.name).join(", ") || "none"}.`, isError: true };
	let validated: Record<string, unknown>;
	try {
		const { validateToolArguments } = await loadPiAi();
		validated = validateToolArguments(
			{ name: tool.name, description: tool.description, parameters: plainSchema(tool.parameters) as never },
			{ type: "toolCall", id: "validate", name: tool.name, arguments: (args ?? {}) as Record<string, never> },
		) as Record<string, unknown>;
	} catch (error) {
		return { text: error instanceof Error ? error.message : String(error), isError: true };
	}
	try {
		return await tool.execute(validated, signal);
	} catch (error) {
		return { text: error instanceof Error ? error.message : String(error), isError: true };
	}
}

/** JSON Schema guaranteed to be an object schema (MCP and Codex need `type: "object"`). */
export function plainSchema(schema: JsonSchema | undefined): JsonSchema {
	const plain = JSON.parse(JSON.stringify(schema ?? { type: "object" })) as JsonSchema;
	if (plain.type !== "object") return { type: "object", properties: {}, ...plain, ...(plain.type === undefined ? { type: "object" } : {}) };
	return plain;
}

/**
 * Serializes tool executions within one turn: game tools mutate campaign
 * state and the CLIs may dispatch a batch concurrently.
 */
export function serialQueue() {
	let chain: Promise<unknown> = Promise.resolve();
	return <T>(fn: () => Promise<T>): Promise<T> => {
		const next = chain.then(fn, fn);
		chain = next.catch(() => undefined);
		return next;
	};
}

/**
 * Wraps a turn's onEvent: guarantees exactly one trailing `done`, swallows
 * listener exceptions (a broken UI stream must not kill the tool loop), and
 * inserts a paragraph break between separate text segments (e.g. narration
 * before and after a tool call) that would otherwise run together.
 */
export function eventSink(onEvent: (event: EngineEvent) => void) {
	let doneSent = false;
	let lastText = "";
	let textSegmentOpen = false;
	let currentSegment = "";
	let emittedAny = false;
	const emit = (event: EngineEvent) => {
		if (doneSent) return;
		if (event.type === "done") doneSent = true;
		if (event.type === "text" || event.type === "thinking" || event.type === "tool_start") emittedAny = true;
		try {
			onEvent(event);
		} catch {
			// listener bugs are not engine failures
		}
	};
	return {
		emit,
		/** A text delta; `segment` identifies the content block / item it belongs to. */
		text(delta: string, segment: string) {
			if (!delta) return;
			if (!textSegmentOpen || segment !== currentSegment) {
				if (lastText && !lastText.endsWith("\n\n")) emit({ type: "text", delta: lastText.endsWith("\n") ? "\n" : "\n\n" });
				currentSegment = segment;
				textSegmentOpen = true;
			}
			lastText = delta;
			emit({ type: "text", delta });
		},
		thinking(delta: string) {
			if (delta) emit({ type: "thinking", delta });
		},
		/** Whether any model output (text/thinking/tool call) reached the caller. */
		get emittedAny() {
			return emittedAny;
		},
		get done() {
			return doneSent;
		},
	};
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
