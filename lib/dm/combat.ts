import type { GameState, PlayerCombatAction } from "../game/types";
import type { Rng } from "../rules/dice";
import { applyPlayerAction, type CombatOptions, type CombatResult, type CombatState } from "../rules/combat";
import { getEquipment, getSpell } from "../srd";
import { pcCombatProfile } from "./derived";
import type { StateTxn } from "./context";

/** Combat options bound to the current character and the SRD. */
export function combatOpts(state: GameState): CombatOptions {
	return { profile: pcCombatProfile(state.character), spells: (index: string) => getSpell(index), equipment: (index: string) => getEquipment(index) };
}

/**
 * The Quiet, Phase-2 hook: loud actions (gunshots) are appended here with the
 * game time so the noise rules (docs/zombie.md §5) can read them later. Kept
 * off the GameState type until Phase 2 defines the noise model; capped.
 */
export interface NoiseEntry {
	day: number;
	hour: number;
	minute: number;
	source: string;
	loudness: number;
}
export function noiseLog(state: GameState): NoiseEntry[] {
	return (state as GameState & { noiseLog?: NoiseEntry[] }).noiseLog ?? [];
}
function recordNoise(state: GameState, source: string, loudness: number): void {
	const s = state as GameState & { noiseLog?: NoiseEntry[] };
	const { day, hour, minute } = state.time;
	s.noiseLog = [...(s.noiseLog ?? []), { day, hour, minute, source, loudness }].slice(-50);
}

export function combatState(state: GameState): CombatState {
	if (!state.encounter) throw new Error("No active combat.");
	const map = state.maps[state.encounter.mapId];
	if (!map) throw new Error("Combat map missing.");
	return { encounter: state.encounter, map, character: state.character };
}

/**
 * Writes a CombatResult back into GameState and forwards rolls/fx.
 * Returns the human-readable log (plus DM hand-off notes) or throws on rejection.
 */
export function applyCombatResult(tx: StateTxn, res: CombatResult): string {
	if (!res.ok) throw new Error(res.error ?? "Combat action rejected.");
	const { state } = tx;
	state.encounter = res.encounter;
	state.maps[res.map.id] = res.map;
	if (res.character) state.character = res.character;
	for (const r of res.rolls) tx.roll(r);
	for (const ev of res.events) {
		const ent = (id: string) => res.encounter.combatants[id]?.entityId;
		if (ev.type === "damage") tx.fx({ kind: "damage", entityId: ent(ev.targetId), amount: ev.amount });
		else if (ev.type === "heal") tx.fx({ kind: "heal", entityId: ent(ev.targetId), amount: ev.amount });
		else if (ev.type === "attack" && !ev.hit) tx.fx({ kind: "miss", entityId: ent(ev.targetId) });
		else if (ev.type === "attack" && ev.hit) tx.fx({ kind: "sfx", sound: "sword" });
		else if (ev.type === "spell_cast") tx.fx({ kind: "sfx", sound: "spell" });
		else if (ev.type === "death") tx.fx({ kind: "sfx", sound: "death" });
		else if (ev.type === "noise") recordNoise(state, ev.source, ev.loudness);
	}
	if (res.encounter.status !== "active") {
		state.mode = "explore";
		if (state.ambience === "combat" || state.ambience === "boss") state.ambience = res.encounter.status === "victory" ? "victory" : "tension";
	} else state.mode = "combat";
	const needs = res.events.filter((e) => e.type === "needs_dm").map((e) => `DM ADJUDICATE: ${(e as { text: string }).text}`);
	return [...res.log, ...needs].join("\n");
}

/** Applies a player's clicked combat action. Returns the log lines. */
export function playerCombatAction(tx: StateTxn, action: PlayerCombatAction, rng: Rng): string {
	const res = applyPlayerAction(combatState(tx.state), rng, action, combatOpts(tx.state));
	return applyCombatResult(tx, res);
}

export function isPcTurn(state: GameState): boolean {
	const e = state.encounter;
	if (!e || e.status !== "active") return false;
	return e.order[e.turnIndex] === state.character.id;
}
