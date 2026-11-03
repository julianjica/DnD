import type { ActiveCondition, ConditionId, DamageType, SpellInfo } from "../../game/types";
import { Rng } from "../dice";
import { type AttackContext, evaluateAttack } from "./attack";
import { addCondition, applyDamage, applyHeal, type Ctx, doRoll, fail, getC, removeCondition, run, saveModifiers } from "./core";
import { areHostile, distanceFeet, entityFor, footprintOf, livingCombatants, type Point } from "./grid";
import type { AttackProfile } from "./profile";
import { spellArea, spellAttackProfile, spellRangeFeet } from "./spells";
import type { CombatOptions, CombatResult, CombatState } from "./types";

/** Helpers for DM tools (apply_damage / heal / apply_condition) and UI previews. */

function amountOf(ctx: Ctx, amount: number | string, label: string): number {
	if (typeof amount === "number") return amount;
	return Math.max(0, doRoll(ctx, amount, { label, actor: "dm" }).total);
}

/** Damage through the full pipeline (resistances, temp HP, death saves, concentration). `amount` may be dice. */
export function applyDamageTo(
	state: CombatState,
	rng: Rng,
	targetId: string,
	amount: number | string,
	damageType?: DamageType,
	info: { crit?: boolean; sourceId?: string } = {},
	opts: CombatOptions = {},
): CombatResult {
	return run(state, rng, opts, (ctx) => {
		getC(ctx, targetId);
		const n = amountOf(ctx, amount, `Damage to ${ctx.enc.combatants[targetId].name}`);
		applyDamage(ctx, targetId, [{ amount: n, type: damageType }], info);
	});
}

export function healTo(state: CombatState, rng: Rng, targetId: string, amount: number | string, opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => {
		getC(ctx, targetId);
		applyHeal(ctx, targetId, amountOf(ctx, amount, `Healing for ${ctx.enc.combatants[targetId].name}`), "healing");
	});
}

export function applyConditionTo(state: CombatState, rng: Rng, targetId: string, condition: ActiveCondition, opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => {
		if (!addCondition(ctx, targetId, condition)) fail(`${ctx.enc.combatants[targetId].name} is immune to ${condition.id}.`);
	});
}

export function removeConditionFrom(state: CombatState, rng: Rng, targetId: string, condition: ConditionId, opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => removeCondition(ctx, targetId, condition));
}

function peek<T>(state: CombatState, opts: CombatOptions, fn: (ctx: Ctx) => T): T | string {
	let out: T | string = "";
	const res = run(state, new Rng(0), opts, (ctx) => {
		out = fn(ctx);
	});
	return res.ok ? out : (res.error ?? "error");
}

/** Range/cover/advantage preview for an attack (no rolls). Returns an error string if impossible. */
export function previewAttack(state: CombatState, attackerId: string, targetId: string, ap: AttackProfile, opts: CombatOptions = {}): AttackContext | string {
	return peek(state, opts, (ctx) => evaluateAttack(ctx, attackerId, targetId, ap));
}

/** Squares + combatants an area spell would hit (UI template preview). */
export function previewSpellArea(state: CombatState, casterId: string, spell: SpellInfo, point: Point, opts: CombatOptions = {}): { squares: Point[]; targetIds: string[] } | string {
	return peek(state, opts, (ctx) => spellArea(ctx, casterId, spell, point));
}

/** Live advantage/disadvantage for casting a spell at one creature (UI hint, no rolls). */
export interface SpellPreview {
	targetId: string;
	distance: number;
	/** "attack": reasons apply to the caster's attack roll; "save": to the target's saving throw. */
	roll: "attack" | "save";
	advantage: string[];
	disadvantage: string[];
	/** Save only: reasons the target fails STR/DEX saves automatically. */
	autoFail: string[];
}

/**
 * What the engine would apply if `casterId` cast `spell` at `targetId` now —
 * the same `evaluateAttack` / `saveModifiers` the real cast uses. Without a
 * target, previews the nearest visible hostile in range. Returns an error
 * string when the spell has no attack or save, or nothing can be targeted.
 */
export function previewSpell(state: CombatState, casterId: string, spell: SpellInfo, targetId?: string, opts: CombatOptions = {}): SpellPreview | string {
	return peek(state, opts, (ctx): SpellPreview | string => {
		if (!spell.attack && !spell.save) return "No attack roll or saving throw.";
		const caster = getC(ctx, casterId);
		const from = footprintOf(ctx.enc, ctx.map, casterId);
		if (!from) return "Combatant has no position on the map.";
		const dist = (id: string) => {
			const f = footprintOf(ctx.enc, ctx.map, id);
			return f ? distanceFeet(from, f) : Infinity;
		};
		const candidates = targetId
			? [targetId]
			: livingCombatants(ctx.enc)
					.filter((c) => c.id !== casterId && areHostile(caster, c) && !entityFor(ctx.enc, ctx.map, c.id)?.hidden)
					.sort((a, b) => dist(a.id) - dist(b.id))
					.map((c) => c.id);
		if (!candidates.length) return "No target.";
		let firstError = "";
		for (const id of candidates) {
			if (spell.attack) {
				const ev = evaluateAttack(ctx, casterId, id, spellAttackProfile(spell));
				if (typeof ev === "string") {
					firstError ||= ev;
					continue;
				}
				return { targetId: id, distance: ev.distance, roll: "attack", advantage: ev.advantage, disadvantage: ev.disadvantage, autoFail: [] };
			}
			const t = getC(ctx, id);
			const d = dist(id);
			const range = Math.max(5, spellRangeFeet(spell));
			if (!spell.area && d > range) {
				firstError ||= `${t.name} is out of range (${d} ft > ${range} ft).`;
				continue;
			}
			const m = saveModifiers(t, spell.save!.ability);
			return { targetId: id, distance: d, roll: "save", ...m };
		}
		return firstError;
	});
}
