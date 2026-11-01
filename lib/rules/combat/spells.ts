import type { Combatant, SpellInfo } from "../../game/types";
import { signed } from "../dice";
import { performAttack } from "./attack";
import { applyDamage, applyHeal, type Ctx, doRoll, emit, fail, getC, revealIfHidden, rollSave, say, startConcentration } from "./core";
import { areaSquares, combatantsInSquares, coverBetween, distanceFeet, footprintOf, footprintsSee, type Point } from "./grid";
import type { AttackProfile } from "./profile";

/** Numeric range in feet: "Self" → 0, "Touch" → 5, "120 feet" → 120. */
export function spellRangeFeet(spell: SpellInfo): number {
	if (spell.rangeFeet !== undefined) return spell.rangeFeet;
	const r = spell.range.toLowerCase();
	if (r.startsWith("self")) return 0;
	if (r.startsWith("touch")) return 5;
	const m = /(\d+)\s*(feet|foot|ft)/.exec(r);
	if (m) return Number(m[1]);
	const mi = /(\d+)\s*mile/.exec(r);
	if (mi) return Number(mi[1]) * 5280;
	return 0;
}

export function pickByKey(table: Record<number, string> | undefined, level: number): string | undefined {
	if (!table) return undefined;
	const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
	let best: number | undefined;
	for (const k of keys) if (k <= level) best = k;
	return table[best ?? keys[0]];
}

/** Damage dice for a spell at a slot level (cantrips scale by character level). */
export function spellDamageDice(spell: SpellInfo, slotLevel: number, characterLevel: number): string | undefined {
	if (!spell.damage) return undefined;
	if (spell.level === 0) return pickByKey(spell.damage.byCharacterLevel, characterLevel) ?? pickByKey(spell.damage.bySlotLevel, 0);
	return pickByKey(spell.damage.bySlotLevel, slotLevel) ?? pickByKey(spell.damage.byCharacterLevel, characterLevel);
}

export interface CastParams {
	casterId: string;
	spell: SpellInfo;
	slotLevel: number;
	targetIds?: string[];
	point?: Point;
	attackBonus: number;
	saveDc: number;
	/** Spellcasting ability modifier (healing addModifier). */
	abilityMod: number;
	characterLevel: number;
}

/** Squares and targets an area spell would hit (for UI previews too). */
export function spellArea(ctx: Ctx, casterId: string, spell: SpellInfo, point: Point | undefined): { squares: Point[]; targetIds: string[] } {
	if (!spell.area) return { squares: [], targetIds: [] };
	const caster = footprintOf(ctx.enc, ctx.map, casterId);
	if (!caster) fail("Caster has no position.");
	const self = spell.range.toLowerCase().startsWith("self");
	if (!point) fail(`${spell.name} needs a target point.`);
	if (!self) {
		const range = spellRangeFeet(spell);
		const pfp = { ...point, size: 1 };
		if (distanceFeet(caster, pfp) > range) fail(`That point is out of range (${range} ft).`);
		if (!footprintsSee(ctx.map, caster, pfp)) fail("No line of sight to that point.");
	}
	const squares = areaSquares(ctx.map, { shape: spell.area.shape, size: spell.area.size, point, caster, fromCaster: self });
	return { squares, targetIds: combatantsInSquares(ctx.enc, ctx.map, squares) };
}

function checkTarget(ctx: Ctx, caster: Combatant, targetId: string, range: number): void {
	const t = getC(ctx, targetId);
	if (t.dead) fail(`${t.name} is dead.`);
	if (targetId === caster.id) return;
	const a = footprintOf(ctx.enc, ctx.map, caster.id);
	const b = footprintOf(ctx.enc, ctx.map, targetId);
	if (!a || !b) fail("Missing position.");
	const d = distanceFeet(a, b);
	if (d > range) fail(`${t.name} is out of range (${d} ft > ${range} ft).`);
	if (coverBetween(ctx.enc, ctx.map, caster.id, targetId) === "total") fail(`${t.name} has total cover.`);
}

/**
 * Resolves a spell's structured mechanics (attack / save / heal / area).
 * Resource spending (slots, action) is the caller's job. Spells without
 * structured mechanics emit a `needs_dm` event.
 */
export function resolveSpell(ctx: Ctx, p: CastParams): void {
	const { spell } = p;
	const caster = getC(ctx, p.casterId);
	const range = spellRangeFeet(spell);
	let targets: string[];
	let squares: Point[] | undefined;
	if (spell.area) {
		const area = spellArea(ctx, p.casterId, spell, p.point ?? (p.targetIds?.[0] ? footprintOf(ctx.enc, ctx.map, p.targetIds[0]) : undefined));
		squares = area.squares;
		targets = area.targetIds;
	} else {
		targets = p.targetIds?.length ? p.targetIds : spell.heal || range === 0 ? [p.casterId] : [];
		if (!targets.length && (spell.attack || spell.save || spell.damage)) fail(`${spell.name} needs a target.`);
		for (const t of targets) checkTarget(ctx, caster, t, Math.max(range, 5));
	}
	say(ctx, `${caster.name} casts ${spell.name}${p.slotLevel > 0 ? ` (level ${p.slotLevel} slot)` : ""}${targets.length ? ` targeting ${targets.map((t) => ctx.enc.combatants[t].name).join(", ")}` : ""}.`);
	emit(ctx, { type: "spell_cast", casterId: p.casterId, spell: spell.index, slotLevel: p.slotLevel, targetIds: targets, ...(squares ? { squares } : {}) });
	revealIfHidden(ctx, caster);
	if (spell.concentration) startConcentration(ctx, p.casterId, spell.index);

	const dice = spellDamageDice(spell, p.slotLevel, p.characterLevel);
	if (spell.attack && dice && spell.damage) {
		const ap: AttackProfile = {
			name: spell.name,
			kind: spell.attack,
			toHit: p.attackBonus,
			damage: [{ dice, type: spell.damage.type }],
			reach: Math.max(5, range),
			range: { normal: Math.max(5, range) },
		};
		for (const t of targets) if (!ctx.enc.combatants[t].dead) performAttack(ctx, p.casterId, t, ap);
		return;
	}
	if (spell.save) {
		let amount = 0;
		if (dice && spell.damage) {
			const r = doRoll(ctx, dice, { label: `${spell.name} damage (${spell.damage.type})`, actor: p.casterId });
			amount = Math.max(0, r.total);
		}
		const failed: string[] = [];
		for (const t of targets) {
			const target = ctx.enc.combatants[t];
			if (!target || target.dead) continue;
			const ok = rollSave(ctx, t, spell.save.ability, p.saveDc, spell.name);
			if (!ok) failed.push(target.name);
			if (amount > 0 && spell.damage) {
				const dealt = ok ? (spell.save.halfOnSuccess ? Math.floor(amount / 2) : 0) : amount;
				if (dealt > 0) applyDamage(ctx, t, [{ amount: dealt, type: spell.damage.type }], { sourceId: p.casterId });
			}
		}
		if (failed.length && !spell.damage) emit(ctx, { type: "needs_dm", text: `${failed.join(", ")} failed the save vs ${spell.name}: apply its effects. ${spell.description.slice(0, 300)}` });
		return;
	}
	if (spell.heal) {
		const base = pickByKey(spell.heal.bySlotLevel, p.slotLevel);
		if (!base) fail(`${spell.name} has no healing dice for level ${p.slotLevel}.`);
		const mod = spell.heal.addModifier ? p.abilityMod : 0;
		for (const t of targets) {
			const notation = /^\d+$/.test(base) ? `${Number(base) + mod}` : `${base}${mod ? signed(mod) : ""}`;
			const r = doRoll(ctx, notation, { label: `${spell.name} healing`, actor: p.casterId });
			applyHeal(ctx, t, Math.max(0, r.total), spell.name);
		}
		return;
	}
	if (dice && spell.damage && targets.length) {
		// Auto-hit damage (e.g. Magic Missile-style): roll once per target.
		for (const t of targets) {
			const r = doRoll(ctx, dice, { label: `${spell.name} damage`, actor: p.casterId });
			applyDamage(ctx, t, [{ amount: Math.max(0, r.total), type: spell.damage.type }], { sourceId: p.casterId });
		}
		return;
	}
	emit(ctx, { type: "needs_dm", text: `${caster.name} cast ${spell.name}; adjudicate its effect. ${spell.description.slice(0, 300)}` });
}
