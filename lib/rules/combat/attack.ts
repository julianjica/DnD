import type { Combatant } from "../../game/types";
import { critNotation, signed } from "../dice";
import {
	applyDamage,
	clearFlag,
	type Ctx,
	doRoll,
	emit,
	exhaustion,
	fail,
	getC,
	hasCond,
	netAdvantage,
	revealIfHidden,
	say,
} from "./core";
import { areHostile, COVER_AC, coverBetween, type Cover, distanceFeet, footprintOf, isIncapacitated, livingCombatants } from "./grid";
import type { AttackProfile } from "./profile";

export interface AttackContext {
	distance: number;
	cover: Cover;
	longRange: boolean;
	advantage: string[];
	disadvantage: string[];
}

/** Returns an error message if the attack is not possible, else the geometry and adv/dis reasons. */
export function evaluateAttack(ctx: Ctx, attackerId: string, targetId: string, ap: AttackProfile): AttackContext | string {
	const a = ctx.enc.combatants[attackerId];
	const t = ctx.enc.combatants[targetId];
	if (!a || !t) return "Unknown combatant.";
	if (t.dead) return `${t.name} is already dead.`;
	if (a.id === t.id) return "Cannot attack yourself.";
	const fa = footprintOf(ctx.enc, ctx.map, attackerId);
	const ft = footprintOf(ctx.enc, ctx.map, targetId);
	if (!fa || !ft) return "Combatant has no position on the map.";
	const distance = distanceFeet(fa, ft);
	let longRange = false;
	if (ap.kind === "melee") {
		if (distance > ap.reach) return `${t.name} is out of reach (${distance} ft > ${ap.reach} ft).`;
	} else {
		const range = ap.range ?? { normal: 5 };
		const max = range.long ?? range.normal;
		if (distance > max) return `${t.name} is out of range (${distance} ft > ${max} ft).`;
		longRange = distance > range.normal;
	}
	const cover = coverBetween(ctx.enc, ctx.map, attackerId, targetId);
	if (cover === "total") return `${t.name} has total cover.`;
	const advantage: string[] = [];
	const disadvantage: string[] = [];
	// Attacker conditions
	if (hasCond(a, "blinded")) disadvantage.push("attacker blinded");
	if (hasCond(a, "poisoned")) disadvantage.push("attacker poisoned");
	if (hasCond(a, "frightened")) disadvantage.push("attacker frightened");
	if (hasCond(a, "prone")) disadvantage.push("attacker prone");
	if (hasCond(a, "restrained")) disadvantage.push("attacker restrained");
	if (hasCond(a, "invisible")) advantage.push("attacker invisible");
	if (a.usage.__hidden) advantage.push("attacker hidden");
	if (a.usage.__helped) advantage.push("helped");
	// Target conditions
	if (hasCond(t, "blinded")) advantage.push("target blinded");
	if (hasCond(t, "invisible")) disadvantage.push("target invisible");
	if (t.usage.__hidden) disadvantage.push("target hidden");
	for (const k of ["paralyzed", "stunned", "unconscious", "petrified", "restrained"] as const) if (hasCond(t, k)) advantage.push(`target ${k}`);
	if (t.kind === "pc" && t.hp <= 0 && !hasCond(t, "unconscious")) advantage.push("target unconscious");
	if (hasCond(t, "prone")) (distance <= 5 ? advantage : disadvantage).push("target prone");
	if (t.turn.dodging && !isIncapacitated(t)) disadvantage.push("target dodging");
	if (t.usage.__helpAgainst) advantage.push("help");
	// Ranged specifics
	if (ap.kind === "ranged") {
		if (longRange) disadvantage.push("long range");
		const threatened = livingCombatants(ctx.enc).some((o) => {
			if (o.id === a.id || !areHostile(a, o) || isIncapacitated(o)) return false;
			const fo = footprintOf(ctx.enc, ctx.map, o.id);
			return !!fo && distanceFeet(fa, fo) <= 5;
		});
		if (threatened) disadvantage.push("ranged attack in melee");
	}
	return { distance, cover, longRange, advantage, disadvantage };
}

export interface AttackOutcome {
	hit: boolean;
	crit: boolean;
	damage: number;
}

/** Rolls one attack and applies damage. Throws CombatError if the attack is invalid. */
export function performAttack(
	ctx: Ctx,
	attackerId: string,
	targetId: string,
	ap: AttackProfile,
	opts: { opportunity?: boolean; extraAdvantage?: string[]; extraDisadvantage?: string[] } = {},
): AttackOutcome {
	const ev = evaluateAttack(ctx, attackerId, targetId, ap);
	if (typeof ev === "string") fail(ev);
	const a = getC(ctx, attackerId);
	const t = getC(ctx, targetId);
	const adv = [...ev.advantage, ...(opts.extraAdvantage ?? [])];
	const dis = [...ev.disadvantage, ...(opts.extraDisadvantage ?? [])];
	const advantage = netAdvantage(adv.length > 0, dis.length > 0);
	const ac = t.ac + COVER_AC[ev.cover];
	const bonus = ap.toHit - 2 * exhaustion(ctx, a);
	const r = doRoll(ctx, `1d20${bonus ? signed(bonus) : ""}`, {
		label: `${a.name} ${opts.opportunity ? "opportunity attack" : "attacks"} ${t.name} (${ap.name})`,
		actor: attackerId,
		advantage,
		target: ac,
		attack: true,
		critOn: ap.critOn ?? 20,
	});
	// Consume one-shot advantage sources.
	clearFlag(a, "__helped");
	clearFlag(t, "__helpAgainst");
	revealIfHidden(ctx, a);
	const hit = !!r.success;
	let crit = r.critical === "hit";
	if (hit && !crit && ev.distance <= 5 && (hasCond(t, "paralyzed") || hasCond(t, "unconscious") || (t.kind === "pc" && t.hp <= 0))) {
		crit = true;
	}
	if (crit && !r.critical) r.critical = "hit";
	const why = [...(adv.length ? [`adv: ${adv.join(", ")}`] : []), ...(dis.length ? [`dis: ${dis.join(", ")}`] : []), ...(ev.cover !== "none" ? [`${ev.cover.replace("_", "-")} cover`] : [])];
	say(ctx, `${a.name} ${opts.opportunity ? "makes an opportunity attack on" : "attacks"} ${t.name} with ${ap.name}: ${r.total} vs AC ${ac} — ${crit ? "CRITICAL HIT" : hit ? "hit" : r.critical === "miss" ? "natural 1, miss" : "miss"}${why.length ? ` (${why.join("; ")})` : ""}.`);
	emit(ctx, { type: "attack", attackerId, targetId, name: ap.name, hit, crit, rollId: r.id });
	if (!hit) return { hit, crit: false, damage: 0 };
	const parts = ap.damage.map((d) => {
		const notation = crit ? critNotation(d.dice) : d.dice;
		const dr = doRoll(ctx, notation, { label: `${ap.name} damage (${d.type})${crit ? " — critical" : ""}`, actor: attackerId });
		return { amount: Math.max(0, dr.total), type: d.type };
	});
	const damage = applyDamage(ctx, targetId, parts, { crit, sourceId: attackerId });
	return { hit, crit, damage };
}

/** Hostile, living, non-incapacitated creatures that could take an OA on `moverId`. */
export function potentialOpportunityAttackers(ctx: Ctx, moverId: string): Combatant[] {
	const m = getC(ctx, moverId);
	return livingCombatants(ctx.enc).filter((o) => o.id !== moverId && areHostile(m, o) && o.turn.reaction && !isIncapacitated(o));
}
