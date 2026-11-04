import type { GameState, PlayerCombatAction } from "../game/types";
import type { Rng } from "../rules/dice";
import { applyPlayerAction, type CombatOptions, type CombatResult, type CombatState } from "../rules/combat";
import { getEquipment, getSpell } from "../srd";
import { pcCombatProfile } from "./derived";
import { addNoise, DEFAULT_LOUDNESS, infectionSave, isZombie, survivalItem, survivalItemEffect } from "../rules/survival";
import type { StateTxn } from "./context";

/** Combat options bound to the current character and the SRD. */
export function combatOpts(state: GameState): CombatOptions {
	const opts: CombatOptions = { profile: pcCombatProfile(state.character), spells: (index: string) => getSpell(index), equipment: (index: string) => getEquipment(index) };
	// The Quiet: medkits, bandages, food, water, pills and the antiviral work in combat (effects beyond healing: survivalEvents).
	if (isZombie(state)) opts.onUseItem = (item) => survivalItem(item);
	return opts;
}

/**
 * The Quiet: a history of loud actions (gunshots) with the game time. The
 * noise level itself lives in GameState.survival (lib/rules/survival.ts); this
 * log is kept off the GameState type as a capped history.
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
	const before = state.character;
	if (res.character) state.character = res.character;
	for (const r of res.rolls) tx.roll(r);
	// A loud attack (gunfire) sounds like a gunshot, hit or miss.
	const gunfire = res.events.some((e) => e.type === "noise" && e.loudness >= 3);
	if (gunfire) tx.fx({ kind: "sfx", sound: "gunshot" });
	for (const ev of res.events) {
		const ent = (id: string) => res.encounter.combatants[id]?.entityId;
		if (ev.type === "damage") tx.fx({ kind: "damage", entityId: ent(ev.targetId), amount: ev.amount });
		else if (ev.type === "heal") tx.fx({ kind: "heal", entityId: ent(ev.targetId), amount: ev.amount });
		else if (ev.type === "attack" && !ev.hit) tx.fx({ kind: "miss", entityId: ent(ev.targetId) });
		else if (ev.type === "attack" && ev.hit && !gunfire) tx.fx({ kind: "sfx", sound: "sword" });
		else if (ev.type === "spell_cast") tx.fx({ kind: "sfx", sound: "spell" });
		else if (ev.type === "death") tx.fx({ kind: "sfx", sound: "death" });
		else if (ev.type === "noise") recordNoise(state, ev.source, ev.loudness);
	}
	const survival = isZombie(state) ? survivalEvents(tx, res, before) : [];
	if (res.encounter.status !== "active") {
		state.mode = "explore";
		if (state.ambience === "combat" || state.ambience === "boss") state.ambience = res.encounter.status === "victory" ? "victory" : "tension";
	} else state.mode = "combat";
	const needs = res.events.filter((e) => e.type === "needs_dm").map((e) => `DM ADJUDICATE: ${(e as { text: string }).text}`);
	return [...res.log, ...needs, ...survival].join("\n");
}

/**
 * The Quiet: what a combat result means for survival. Loud weapons, loud
 * techniques and a screamer's shriek raise the noise level; a zombie's bite
 * that wounds the player forces the infection save.
 */
const GUNFIRE = /\b(pistol|revolver|shotgun|rifle|carbine|gun)\b/i;

function survivalEvents(tx: StateTxn, res: CombatResult, before: GameState["character"]): string[] {
	const { state, rng } = tx;
	const out: string[] = [];
	const pcId = state.character.id;
	let lastAttack: Extract<CombatResult["events"][number], { type: "attack" }> | undefined;
	let bitten = false;
	for (const ev of res.events) {
		if (ev.type === "noise") out.push(addNoise(state, rng, ev.loudness, ev.source));
		else if (ev.type === "item_used" && ev.combatantId === pcId) {
			const item = before.inventory.find((i) => i.id === ev.itemId);
			const note = item && survivalItemEffect(state, rng, tx.roll, item);
			if (note) out.push(note);
		}
		else if (ev.type === "spell_cast" && ev.casterId === pcId) {
			const loud = getSpell(ev.spell)?.loud;
			if (loud) out.push(addNoise(state, rng, typeof loud === "number" ? loud : DEFAULT_LOUDNESS, getSpell(ev.spell)!.name));
		} else if (ev.type === "action_used" && /shriek/i.test(ev.action)) {
			const c = res.encounter.combatants[ev.combatantId];
			if (c?.stats?.ruleset === "zombie") out.push(addNoise(state, rng, 10, `${c.name}'s shriek`));
		} else if (ev.type === "attack") {
			lastAttack = ev;
			// The living shoot too: raiders' and soldiers' guns are as loud as the player's.
			const c = res.encounter.combatants[ev.attackerId];
			if (ev.attackerId !== pcId && c?.stats?.ruleset === "zombie" && GUNFIRE.test(ev.name)) out.push(addNoise(state, rng, 3, `${c.name}'s ${ev.name}`));
		}
		else if (ev.type === "damage" && ev.targetId === pcId && ev.amount > 0 && !bitten && lastAttack?.hit && lastAttack.targetId === pcId && /\bbites?\b/i.test(lastAttack.name)) {
			const attacker = res.encounter.combatants[lastAttack.attackerId];
			if (attacker?.stats?.ruleset === "zombie" && /undead/i.test(attacker.stats.type)) {
				bitten = true;
				const note = infectionSave(state, rng, tx.roll, { monster: attacker.stats, attack: lastAttack.name });
				if (note) out.push(`ENGINE (infection): ${note}`);
			}
		}
	}
	return out;
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
