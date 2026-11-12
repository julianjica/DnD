import type { GameState, PacingState, StoryThread } from "../game/types";

/**
 * Storytelling aids for the DM (any ruleset):
 * - Threads: what the DM planted (a mystery, a promise, a name on the radio)
 *   and still owes a payoff. Old untouched threads are flagged so they come back.
 * - Pacing: an invisible director that remembers when the last threat, action,
 *   human moment and twist happened (in player turns) and nudges the next scene.
 * - Voice cards: how each NPC talks, what they want, what they think of the
 *   player; shown to the DM whenever they're on stage.
 */

export const MAX_OPEN_THREADS = 8;
/** Player turns without mention before a thread is overdue. */
const OVERDUE = 25;

// ─── threads ───────────────────────────────────────────────────────────────

export function openThreads(state: GameState): StoryThread[] {
	return (state.threads ?? []).filter((t) => t.status === "open");
}

export type ThreadArgs = {
	op: "plant" | "touch" | "resolve" | "drop";
	id?: string;
	title?: string;
	planted?: string;
	payoff?: string;
};

export function storyThread(state: GameState, a: ThreadArgs, newId: () => string): string {
	const turn = pacingOf(state).turn;
	const list = (state.threads ??= []);
	if (a.op === "plant") {
		if (!a.title?.trim() || !a.planted?.trim()) throw new Error("plant needs title and planted (what was set up and where it could lead).");
		if (openThreads(state).length >= MAX_OPEN_THREADS) throw new Error(`Already ${MAX_OPEN_THREADS} open threads: pay one off or drop one before planting more (${openThreads(state).map((t) => `${t.title} [${t.id}]`).join(", ")}).`);
		const t: StoryThread = { id: newId(), title: a.title.trim(), planted: a.planted.trim(), status: "open", plantedTurn: turn, touchedTurn: turn };
		list.push(t);
		return `Thread planted: ${t.title} [${t.id}].`;
	}
	const t = list.find((x) => x.id === a.id || x.title.toLowerCase() === a.id?.toLowerCase());
	if (!t) throw new Error(`Unknown thread ${a.id}. Open: ${openThreads(state).map((x) => `${x.title} [${x.id}]`).join(", ") || "none"}.`);
	if (t.status !== "open") throw new Error(`${t.title} is already ${t.status}.`);
	if (a.op === "touch") {
		t.touchedTurn = turn;
		if (a.planted?.trim()) t.planted = `${t.planted} Then: ${a.planted.trim()}`.slice(-600);
		return `${t.title} brought back.`;
	}
	if (a.op === "resolve") {
		if (!a.payoff?.trim()) throw new Error("resolve needs payoff (how it paid off).");
		t.status = "resolved";
		t.payoff = a.payoff.trim();
		t.touchedTurn = turn;
		markBeat(state, "twist");
		return `${t.title} paid off.`;
	}
	t.status = "dropped";
	return `${t.title} dropped.`;
}

// ─── pacing ────────────────────────────────────────────────────────────────

export type Beat = keyof PacingState["last"];
export const BEATS: readonly Beat[] = ["threat", "action", "human", "twist"];

export function pacingOf(state: GameState): PacingState {
	return (state.pacing ??= { turn: 0, last: { threat: 0, action: 0, human: 0, twist: 0 } });
}

/** A new player turn (no catch-up: an old save starts with everything "just happened"). */
export function nextTurn(state: GameState): void {
	const p = pacingOf(state);
	p.turn += 1;
}

export function markBeat(state: GameState, ...beats: Beat[]): void {
	const p = pacingOf(state);
	for (const b of beats) p.last[b] = p.turn;
	// Action is threatening by definition.
	if (beats.includes("action")) p.last.threat = p.turn;
}

/**
 * The director's single nudge for the next scene, or undefined when the rhythm
 * is fine. It is advice for when the player has no direction of their own,
 * never a reason to pull them off what they chose (the prompt says so too).
 */
export function pacingNudge(state: GameState): string | undefined {
	const p = pacingOf(state);
	if (state.encounter?.status === "active") return undefined;
	const since = (b: Beat) => p.turn - p.last[b];
	const overdue = openThreads(state).filter((t) => p.turn - t.touchedTurn >= OVERDUE).sort((x, y) => x.touchedTurn - y.touchedTurn)[0];
	if (since("action") <= 2 && p.last.action > p.last.human) return "the fight just ended: let it breathe. A quiet, human beat next (wounds tended, a companion shaking, someone saying what they really think), before anything new comes at them.";
	const only = " Only if it fits what the player is doing now; if they are following their own plan, follow them and let this wait.";
	if (since("twist") >= 25) return `the story hasn't turned in a while: a reveal or a complication could come out of what the player is doing${overdue ? ` (perhaps touching "${overdue.title}")` : ""}.${only}`;
	if (since("threat") >= 10) return `it's been quiet for a while: some danger or dread could enter the player's current scene (a sound, a sign, a hostile face), not necessarily a fight.${only}`;
	if (since("human") >= 12) return `room for a human moment: someone the player is with opens up, asks for something, or clashes with someone.${only}`;
	if (overdue) return `"${overdue.title}" hasn't come up in ${p.turn - overdue.touchedTurn} turns: the world can remember it in passing (a mention, a consequence) if it fits; never pull the player toward it.`;
	return undefined;
}

// ─── digest ────────────────────────────────────────────────────────────────

export function storyDigest(state: GameState): string | undefined {
	const p = pacingOf(state);
	const open = openThreads(state);
	const lines: string[] = [];
	if (open.length) lines.push(`Open threads (the world's background: they pay off when the player engages them or as consequences of what they do; story_thread touch/resolve): ${open.map((t) => (p.turn - t.touchedTurn >= OVERDUE ? `${t.title} [${t.id}] OVERDUE: ${t.planted}` : `${t.title} [${t.id}]`)).join(" | ")}`);
	else if (state.journal.length >= 5) lines.push("Open threads: none recorded. Record the story's open threads now with story_thread op=plant (mysteries, promises, debts, names you planted), up to 8.");
	const nudge = pacingNudge(state);
	if (nudge) lines.push(`PACING (director, turn ${p.turn}): ${nudge}`);
	return lines.join("\n") || undefined;
}

/** Voice cards for the NPCs on stage, and who still needs one. */
export function voiceDigest(state: GameState): string | undefined {
	const here = state.scene.npcIds.map((id) => state.npcs[id]).filter((n) => n && n.alive);
	if (!here.length) return undefined;
	const cards = here.filter((n) => n.voice || n.wants || n.opinion).map((n) => `${n.name}: ${[n.voice && `talks: ${n.voice}`, n.wants && `wants: ${n.wants}`, n.opinion && `thinks of the player: ${n.opinion}`].filter(Boolean).join("; ")}`);
	const missing = here.filter((n) => !n.voice).map((n) => `${n.name} [${n.id}]`);
	return [cards.length ? `Voice cards (keep each one's way of talking distinct and consistent): ${cards.join(" | ")}` : "", missing.length ? `No voice card yet: ${missing.join(", ")}. Give them one with update_npc (voice, wants, opinion) before they speak.` : ""]
		.filter(Boolean)
		.join("\n");
}
