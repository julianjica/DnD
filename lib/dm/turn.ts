import type { EngineConfig, LogEntry } from "../game/types";
import { getEngine } from "../engines";
import { appendLog, loadState, readLog, mutate } from "../store/campaigns";
import { buildSystemPrompt } from "./prompt";
import { stateDigest } from "./digest";
import { newId, type ClientEvent, type ToolContext } from "./context";
import { allTools } from "./tools";
import { derivedAc } from "./derived";

/**
 * One DM turn: player input → engine (model + game-tool loop) → narration.
 * Streams ClientEvents; logs the player line, the DM narration and rolls.
 */

const running = new Map<string, AbortController>();

export function isTurnRunning(campaignId: string): boolean {
	return running.has(campaignId);
}

export function abortTurn(campaignId: string): boolean {
	const c = running.get(campaignId);
	c?.abort();
	return !!c;
}

export interface TurnInput {
	campaignId: string;
	/** What the player typed or clicked. Empty for the opening turn. */
	text: string;
	/** Extra engine-generated context (combat action results, roll results, settings change). */
	systemNotes?: string[];
	/** Shown in the log as the player's line (defaults to text). */
	displayText?: string;
	emit: (e: ClientEvent) => void;
}

export async function runTurn(input: TurnInput): Promise<void> {
	const { campaignId, emit } = input;
	if (running.has(campaignId)) throw new Error("The DM is still narrating the previous turn.");
	const controller = new AbortController();
	running.set(campaignId, controller);
	try {
		const state = loadState(campaignId);
		const playerLine = input.displayText ?? input.text;
		if (playerLine) {
			appendLog(campaignId, { id: newId("l"), role: "player", text: playerLine, ts: Date.now() });
			emit({ type: "player", text: playerLine });
		}
		// Clear stale suggestions/pending roll the moment the player acts.
		await mutate(campaignId, (s) => {
			s.suggestions = [];
		});

		const ctx: ToolContext = { campaignId, emit, rolls: [] };
		const tools = allTools(ctx);
		const recent = readLog(campaignId, { limit: 12 });
		const digest = stateDigest(state, { recentLog: recent, ac: derivedAc(state.character) });
		const notes = input.systemNotes?.length ? `\n\n# ENGINE NOTES\n${input.systemNotes.join("\n")}` : "";
		const action = input.text ? `# PLAYER ACTION\n${input.text}` : "# OPENING\nBegin the adventure: set the opening scene (set_scene, set_ambience), introduce the hook, and end with suggest_actions.";
		const langNote = state.settings.language === "es" ? "\n\n(Recuerda: escribe todo lo que ve el jugador en español.)" : "";
		const message = `${action}${notes}\n\n# STATE DIGEST (authoritative)\n${digest}${langNote}`;

		const config: EngineConfig = state.settings.engine;
		const engine = getEngine(config.provider);
		let narration = "";
		const toolLog: NonNullable<LogEntry["tools"]> = [];
		let errored: string | undefined;
		// Text after suggest_actions is the model re-narrating (when it already narrated); drop it.
		let closed = false;
		await engine.runTurn({
			sessionKey: campaignId,
			systemPrompt: buildSystemPrompt(state.settings),
			input: message,
			tools,
			config,
			signal: controller.signal,
			onEvent(ev) {
				switch (ev.type) {
					case "text":
						if (closed) break;
						narration += ev.delta;
						emit({ type: "text", delta: ev.delta });
						break;
					case "thinking":
						emit({ type: "thinking", delta: ev.delta });
						break;
					case "tool_start":
						emit({ type: "tool", id: ev.id, name: ev.name, status: "start" });
						break;
					case "tool_end": {
						// The player can read summaries: stop before the engine's DM-only notices (camp scenes, town and base events).
						const summary = ev.result.text.split(/\n(?=[A-Z][A-Z' ]{3,}[ —:(])/)[0].slice(0, 200);
						toolLog.push({ name: ev.name, summary, isError: ev.result.isError });
						if (ev.name === "suggest_actions" && !ev.result.isError && narration.trim().length > 150) closed = true;
						emit({ type: "tool", id: ev.id, name: ev.name, status: "end", summary, isError: ev.result.isError });
						break;
					}
					case "error":
						errored = ev.message;
						emit({ type: "error", message: ev.message });
						break;
				}
			},
		});
		const entries: LogEntry[] = ctx.rolls.map((roll) => ({ id: newId("l"), role: "roll", text: `${roll.label}: ${roll.total}`, roll, ts: roll.ts }));
		if (narration.trim() || toolLog.length) entries.push({ id: newId("l"), role: "dm", text: narration.trim(), tools: toolLog, ts: Date.now() });
		if (errored) entries.push({ id: newId("l"), role: "system", text: `Engine error: ${errored}`, ts: Date.now() });
		appendLog(campaignId, ...entries);
	} finally {
		running.delete(campaignId);
		emit({ type: "done" });
	}
}
