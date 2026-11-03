import type { Ability, ActiveCondition, Character, Combatant, ConditionId, DamageType, Encounter, GridMap, RollRecord } from "../../game/types";
import { roll, signed, type Rng } from "../dice";
import { entityFor } from "./grid";
import { derivePcProfile, monsterSaveBonus } from "./profile";
import type { CombatEvent, CombatOptions, CombatResult, CombatState, PcCombatProfile } from "./types";

/** Internal mutable working copy of a CombatState for one engine call. */
export interface Ctx {
	enc: Encounter;
	map: GridMap;
	character?: Character;
	rng: Rng;
	opts: CombatOptions;
	rolls: RollRecord[];
	log: string[];
	events: CombatEvent[];
}

export class CombatError extends Error {}

export function fail(message: string): never {
	throw new CombatError(message);
}

/**
 * Runs `fn` on a deep copy of `state`. On CombatError: returns the original
 * state with ok=false and restores the RNG (no randomness consumed).
 */
export function run(state: CombatState, rng: Rng, opts: CombatOptions | undefined, fn: (ctx: Ctx) => void): CombatResult {
	const entry = rng.state;
	const ctx: Ctx = {
		enc: structuredClone(state.encounter),
		map: structuredClone(state.map),
		character: state.character ? structuredClone(state.character) : undefined,
		rng,
		opts: { ...(opts ?? {}) },
		rolls: [],
		log: [],
		events: [],
	};
	try {
		fn(ctx);
	} catch (e) {
		if (e instanceof CombatError) {
			rng.state = entry;
			return { ...state, ok: false, error: e.message, rolls: [], log: [], events: [] };
		}
		throw e;
	}
	syncCharacter(ctx);
	return {
		encounter: ctx.enc,
		map: ctx.map,
		...(ctx.character ? { character: ctx.character } : {}),
		ok: true,
		rolls: ctx.rolls,
		log: ctx.log,
		events: ctx.events,
	};
}

export function pcCombatant(enc: Encounter): Combatant | undefined {
	return Object.values(enc.combatants).find((c) => c.kind === "pc");
}

/** Mirrors the PC combatant's live state into the Character. */
export function syncCharacter(ctx: Ctx): void {
	const ch = ctx.character;
	if (!ch) return;
	const pc = ctx.enc.combatants[ch.id];
	if (!pc) return;
	ch.hp = pc.hp;
	ch.tempHp = pc.tempHp;
	ch.conditions = structuredClone(pc.conditions);
	ch.deathSaves = { ...(pc.deathSaves ?? { successes: 0, failures: 0 }) };
	if (pc.concentration) ch.concentration = { spell: pc.concentration, startedRound: ch.concentration?.spell === pc.concentration ? ch.concentration.startedRound : ctx.enc.round };
	else delete ch.concentration;
}

export function getC(ctx: Ctx, id: string): Combatant {
	const c = ctx.enc.combatants[id];
	if (!c) fail(`Unknown combatant: ${id}`);
	return c;
}

export function pcProfile(ctx: Ctx): PcCombatProfile | undefined {
	if (ctx.opts.profile) return ctx.opts.profile;
	if (ctx.character) {
		ctx.opts.profile = derivePcProfile(ctx.character);
		return ctx.opts.profile;
	}
	return undefined;
}

export function emit(ctx: Ctx, ev: CombatEvent): void {
	ctx.events.push(ev);
}

export function say(ctx: Ctx, line: string): void {
	ctx.log.push(line);
}

export function doRoll(ctx: Ctx, notation: string, opts: Parameters<typeof roll>[2]): RollRecord {
	const r = roll(ctx.rng, notation, opts);
	ctx.rolls.push(r);
	return r;
}

/** The natural d20 actually kept in a roll record. */
export function natural(r: RollRecord): number {
	return r.dice.find((d) => d.sides === 20 && !d.dropped)?.value ?? 0;
}

export function hasCond(c: Combatant, id: ConditionId): boolean {
	return c.conditions.some((k) => k.id === id);
}

export function exhaustion(ctx: Ctx, c: Combatant): number {
	return c.kind === "pc" && ctx.character?.id === c.id ? ctx.character.exhaustion : 0;
}

/** Combines advantage sources: any adv + any dis cancel out. */
export function netAdvantage(adv: boolean, dis: boolean): "advantage" | "disadvantage" | undefined {
	if (adv && !dis) return "advantage";
	if (dis && !adv) return "disadvantage";
	return undefined;
}

// ─── Usage flags (conventions documented in types.ts) ────────────────────

export function flag(c: Combatant, key: string): { used: number; charged?: boolean } | undefined {
	return c.usage[key];
}
export function setFlag(c: Combatant, key: string, used = 1): void {
	c.usage[key] = { used };
}
export function clearFlag(c: Combatant, key: string): void {
	delete c.usage[key];
}

// ─── Conditions ──────────────────────────────────────────────────────────

export function addCondition(ctx: Ctx, targetId: string, cond: ActiveCondition): boolean {
	const t = getC(ctx, targetId);
	if (t.stats?.conditionImmunities.includes(cond.id)) {
		say(ctx, `${t.name} is immune to ${cond.id}.`);
		return false;
	}
	const existing = t.conditions.find((k) => k.id === cond.id);
	if (existing) {
		if (cond.rounds === undefined || (existing.rounds !== undefined && cond.rounds > existing.rounds)) Object.assign(existing, cond);
		return true;
	}
	t.conditions.push({ ...cond });
	emit(ctx, { type: "condition_added", targetId, condition: { ...cond } });
	say(ctx, `${t.name} is ${cond.id}${cond.rounds ? ` (${cond.rounds} rounds)` : ""}.`);
	if (["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"].includes(cond.id) && t.concentration) {
		breakConcentration(ctx, targetId, `${cond.id}`);
	}
	return true;
}

export function removeCondition(ctx: Ctx, targetId: string, id: ConditionId): void {
	const t = getC(ctx, targetId);
	const before = t.conditions.length;
	t.conditions = t.conditions.filter((k) => k.id !== id);
	if (t.conditions.length !== before) {
		emit(ctx, { type: "condition_removed", targetId, condition: id });
		say(ctx, `${t.name} is no longer ${id}.`);
	}
}

// ─── Concentration ───────────────────────────────────────────────────────

export function concentrationSource(casterId: string, spell: string): string {
	return `conc:${casterId}:${spell}`;
}

export function breakConcentration(ctx: Ctx, cid: string, reason: string): void {
	const c = getC(ctx, cid);
	const spell = c.concentration;
	if (!spell) return;
	delete c.concentration;
	emit(ctx, { type: "concentration_broken", combatantId: cid, spell });
	say(ctx, `${c.name} loses concentration on ${spell} (${reason}).`);
	const src = concentrationSource(cid, spell);
	for (const id of ctx.enc.order) {
		const o = ctx.enc.combatants[id];
		if (!o) continue;
		for (const k of o.conditions.filter((k) => k.source === src)) removeCondition(ctx, id, k.id);
	}
}

export function startConcentration(ctx: Ctx, cid: string, spell: string): void {
	const c = getC(ctx, cid);
	if (c.concentration) breakConcentration(ctx, cid, `started ${spell}`);
	c.concentration = spell;
	emit(ctx, { type: "concentration_started", combatantId: cid, spell });
}

// ─── Saves ───────────────────────────────────────────────────────────────

export function saveBonus(ctx: Ctx, c: Combatant, ability: Ability): number {
	if (c.kind === "pc") {
		const p = pcProfile(ctx);
		return p?.saveBonuses[ability] ?? 0;
	}
	return monsterSaveBonus(c.stats, ability);
}

/** Rolls a saving throw with condition effects. Returns success. */
export function rollSave(
	ctx: Ctx,
	targetId: string,
	ability: Ability,
	dc: number,
	source: string,
	extra: { advantage?: boolean; disadvantage?: boolean; bonus?: number } = {},
): boolean {
	const t = getC(ctx, targetId);
	const autoFail = (ability === "str" || ability === "dex") && ["paralyzed", "stunned", "unconscious", "petrified"].some((k) => hasCond(t, k as ConditionId));
	if (autoFail || (t.kind === "pc" && t.hp <= 0 && (ability === "str" || ability === "dex"))) {
		emit(ctx, { type: "save", targetId, ability, dc, success: false, source });
		say(ctx, `${t.name} automatically fails the ${ability.toUpperCase()} save vs ${source} (DC ${dc}).`);
		return false;
	}
	const adv = !!extra.advantage || (ability === "dex" && !!t.turn.dodging && !hasCond(t, "incapacitated"));
	const dis = !!extra.disadvantage || (ability === "dex" && hasCond(t, "restrained"));
	const bonus = saveBonus(ctx, t, ability) + (extra.bonus ?? 0) - 2 * exhaustion(ctx, t);
	const r = doRoll(ctx, `1d20${bonus ? signed(bonus) : ""}`, {
		label: `${t.name} ${ability.toUpperCase()} save vs ${source}`,
		actor: targetId,
		advantage: netAdvantage(adv, dis),
		target: dc,
	});
	r.check = { kind: "save", ability, parts: [] };
	const success = !!r.success;
	emit(ctx, { type: "save", targetId, ability, dc, success, source });
	say(ctx, `${t.name} ${success ? "succeeds" : "fails"} a DC ${dc} ${ability.toUpperCase()} save vs ${source} (${r.total}).`);
	return success;
}

// ─── Damage & healing ────────────────────────────────────────────────────

export interface DamagePart {
	amount: number;
	type?: DamageType;
}

function defenses(ctx: Ctx, c: Combatant): { res: DamageType[]; vul: DamageType[]; imm: DamageType[] } {
	if (c.kind === "pc") {
		const p = pcProfile(ctx);
		return { res: p?.resistances ?? [], vul: p?.vulnerabilities ?? [], imm: p?.immunities ?? [] };
	}
	return { res: c.stats?.resistances ?? [], vul: c.stats?.vulnerabilities ?? [], imm: c.stats?.immunities ?? [] };
}

/** Adjusts damage parts for immunity/resistance/vulnerability. */
export function adjustDamage(ctx: Ctx, c: Combatant, parts: DamagePart[]): { total: number; notes: string[] } {
	const { res, vul, imm } = defenses(ctx, c);
	let total = 0;
	const notes: string[] = [];
	for (const p of parts) {
		let a = Math.max(0, p.amount);
		if (p.type && imm.includes(p.type)) {
			notes.push(`immune to ${p.type}`);
			a = 0;
		} else {
			if (p.type && res.includes(p.type)) {
				a = Math.floor(a / 2);
				notes.push(`resists ${p.type}`);
			}
			if (p.type && vul.includes(p.type)) {
				a *= 2;
				notes.push(`vulnerable to ${p.type}`);
			}
		}
		total += a;
	}
	return { total, notes };
}

/**
 * Full damage pipeline. Returns damage actually dealt to hp+temp.
 * PC at 0 HP: each hit = 1 death-save failure (2 on crit); damage ≥ max HP = death.
 * Massive damage: leftover after reaching 0 ≥ max HP → instant death.
 * Concentration save DC max(10, half damage) (capped at 30).
 */
export function applyDamage(ctx: Ctx, targetId: string, parts: DamagePart[], info: { crit?: boolean; sourceId?: string; label?: string } = {}): number {
	const t = getC(ctx, targetId);
	if (t.dead) return 0;
	const { total, notes } = adjustDamage(ctx, t, parts);
	const mainType = parts.find((p) => p.type)?.type;
	if (total <= 0) {
		say(ctx, `${t.name} takes no damage${notes.length ? ` (${notes.join(", ")})` : ""}.`);
		return 0;
	}
	let remaining = total;
	if (t.tempHp > 0) {
		const absorbed = Math.min(t.tempHp, remaining);
		t.tempHp -= absorbed;
		remaining -= absorbed;
	}
	const hpBefore = t.hp;
	if (t.kind === "pc" && hpBefore <= 0) {
		emit(ctx, { type: "damage", targetId, amount: total, damageType: mainType, sourceId: info.sourceId, hpAfter: 0 });
		if (remaining <= 0) {
			say(ctx, `${t.name}'s temporary hit points absorb the blow.`);
			return total;
		}
		if (remaining >= t.maxHp) {
			say(ctx, `${t.name} takes ${total} damage while dying — massive damage kills them outright.`);
			killPc(ctx, t);
			return total;
		}
		const ds = (t.deathSaves ??= { successes: 0, failures: 0 });
		if (ds.successes >= 3) ds.successes = 0; // stable creature starts dying again
		ds.failures = Math.min(3, ds.failures + (info.crit ? 2 : 1));
		say(ctx, `${t.name} takes damage while dying: ${ds.failures} death save failure${ds.failures === 1 ? "" : "s"}.`);
		if (ds.failures >= 3) killPc(ctx, t);
		return total;
	}
	t.hp = Math.max(0, hpBefore - remaining);
	emit(ctx, { type: "damage", targetId, amount: total, damageType: mainType, sourceId: info.sourceId, hpAfter: t.hp });
	say(ctx, `${t.name} takes ${total}${mainType ? ` ${mainType}` : ""} damage${notes.length ? ` (${notes.join(", ")})` : ""} → ${t.hp}/${t.maxHp} HP.`);
	if (t.hp <= 0) {
		if (t.kind === "pc") {
			const overflow = remaining - hpBefore;
			if (overflow >= t.maxHp) {
				say(ctx, `Massive damage! ${t.name} dies instantly.`);
				killPc(ctx, t);
			} else {
				downPc(ctx, t);
			}
		} else {
			killCreature(ctx, t);
		}
		return total;
	}
	if (t.concentration && remaining > 0) {
		const dc = Math.min(30, Math.max(10, Math.floor(total / 2)));
		const ok = rollSave(ctx, targetId, "con", dc, `concentration (${t.concentration})`);
		if (!ok) breakConcentration(ctx, targetId, "failed concentration save");
	}
	return total;
}

function revealIfHidden(ctx: Ctx, c: Combatant): void {
	if (c.usage.__hidden) {
		delete c.usage.__hidden;
		const e = entityFor(ctx.enc, ctx.map, c.id);
		if (e) e.hidden = false;
		emit(ctx, { type: "revealed", combatantId: c.id });
	}
}
export { revealIfHidden };

function downPc(ctx: Ctx, t: Combatant): void {
	t.hp = 0;
	t.deathSaves = { successes: 0, failures: 0 };
	emit(ctx, { type: "down", targetId: t.id });
	say(ctx, `${t.name} falls unconscious!`);
	if (t.concentration) breakConcentration(ctx, t.id, "unconscious");
	addCondition(ctx, t.id, { id: "unconscious", source: "0 hp" });
	addCondition(ctx, t.id, { id: "prone", source: "0 hp" });
	revealIfHidden(ctx, t);
}

export function killPc(ctx: Ctx, t: Combatant): void {
	t.hp = 0;
	t.dead = true;
	t.deathSaves = { successes: 0, failures: 3 };
	if (t.concentration) breakConcentration(ctx, t.id, "death");
	emit(ctx, { type: "death", targetId: t.id });
	say(ctx, `${t.name} has died.`);
	checkEnd(ctx);
}

export function killCreature(ctx: Ctx, t: Combatant): void {
	t.hp = 0;
	t.dead = true;
	if (t.concentration) breakConcentration(ctx, t.id, "death");
	t.conditions = [];
	revealIfHidden(ctx, t);
	if (t.side === "enemy") ctx.enc.xpPool += t.stats?.xp ?? 0;
	emit(ctx, { type: "death", targetId: t.id });
	say(ctx, `${t.name} dies.`);
	checkEnd(ctx);
}

export function applyHeal(ctx: Ctx, targetId: string, amount: number, sourceLabel = "healing"): number {
	const t = getC(ctx, targetId);
	if (t.dead) {
		say(ctx, `${t.name} is dead; ${sourceLabel} has no effect.`);
		return 0;
	}
	const before = t.hp;
	t.hp = Math.min(t.maxHp, t.hp + Math.max(0, amount));
	const healed = t.hp - before;
	emit(ctx, { type: "heal", targetId, amount: healed, hpAfter: t.hp });
	say(ctx, `${t.name} regains ${healed} HP (${sourceLabel}) → ${t.hp}/${t.maxHp}.`);
	if (before <= 0 && t.hp > 0 && t.kind === "pc") {
		t.deathSaves = { successes: 0, failures: 0 };
		removeCondition(ctx, targetId, "unconscious");
	}
	return healed;
}

// ─── End of combat ───────────────────────────────────────────────────────

export function checkEnd(ctx: Ctx): void {
	const enc = ctx.enc;
	if (enc.status !== "active") return;
	const pc = pcCombatant(enc);
	if (pc?.dead) {
		enc.status = "defeat";
	} else {
		const enemies = Object.values(enc.combatants).filter((c) => c.side === "enemy" && !c.dead);
		if (enemies.length === 0) enc.status = "victory";
	}
	if (enc.status !== "active") {
		emit(ctx, { type: "combat_ended", status: enc.status, xp: enc.xpPool });
		say(ctx, enc.status === "victory" ? `Victory! ${enc.xpPool} XP earned.` : `Defeat.`);
	}
}
