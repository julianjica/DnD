import type { Combatant, GameState } from "../game/types";

/**
 * The named dead: enemies with their own name (Kyle the stock boy, not
 * "Shambler 2") who were killed. They stay dead, so the DM can't bring the same
 * one back on another map.
 */

export interface Fallen {
	name: string;
	day: number;
	where?: string;
}

const key = (n: string) => n.trim().toLowerCase();

/** A combatant worth remembering: an enemy with a proper name, not a numbered stat block. */
export function isNamedFoe(c: Combatant): boolean {
	if (c.side !== "enemy" || c.kind === "pc") return false;
	const n = c.name.trim();
	if (!n || /\s\d+$/.test(n)) return false;
	return key(n) !== key(c.stats?.name ?? "");
}

export function recordFallen(state: GameState, name: string, where?: string): void {
	const list = (state.fallen ??= []);
	if (list.some((f) => key(f.name) === key(name))) return;
	list.push({ name, day: state.time.day, ...(where ? { where } : {}) });
	if (list.length > 60) list.splice(0, list.length - 60);
}

export function fallenNamed(state: GameState, name: string | undefined): Fallen | undefined {
	if (!name) return undefined;
	return state.fallen?.find((f) => key(f.name) === key(name));
}

/** Throws if `name` belongs to someone already killed. */
export function assertNotFallen(state: GameState, name: string | undefined): void {
	const f = fallenNamed(state, name);
	if (f)
		throw new Error(
			`${f.name} was killed on day ${f.day}${f.where ? ` at ${f.where}` : ""}. The dead stay dead: their body is where they fell. If this is someone else, give them a different name.`,
		);
}

export function fallenSummary(state: GameState): string {
	const list = state.fallen ?? [];
	return list.length ? `Killed and gone for good (never bring them back; a new foe needs a new name): ${list.map((f) => `${f.name} (day ${f.day}${f.where ? `, ${f.where}` : ""})`).join("; ")}` : "";
}
