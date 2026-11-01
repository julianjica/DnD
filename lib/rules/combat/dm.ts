import type { ActiveCondition, ConditionId, DamageType, SpellInfo } from "../../game/types";
import { Rng } from "../dice";
import { type AttackContext, evaluateAttack } from "./attack";
import { addCondition, applyDamage, applyHeal, type Ctx, doRoll, fail, getC, removeCondition, run } from "./core";
import type { Point } from "./grid";
import type { AttackProfile } from "./profile";
import { spellArea } from "./spells";
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
