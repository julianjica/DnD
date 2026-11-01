import type { GameState, PlayerCombatAction } from "../game/types";
import type { Rng } from "../rules/dice";
import { applyPlayerAction, type CombatOptions, type CombatResult, type CombatState } from "../rules/combat";
import { getSpell } from "../srd";
import { pcCombatProfile } from "./derived";
import type { StateTxn } from "./context";

/** Combat options bound to the current character and the SRD. */
export function combatOpts(state: GameState): CombatOptions {
	return { profile: pcCombatProfile(state.character), spells: (index: string) => getSpell(index) };
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
