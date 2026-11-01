/** Short and long rests. */
import type { Character, RollRecord } from "../../game/types";
import { abilityMod, roll, type Rng } from "../dice";
import { classLevelOf, classSpecific, totalLevel } from "./derived";
import { effectiveMaxHp, RulesError } from "./resources";

function clone<T>(x: T): T {
	return structuredClone(x);
}

export interface ShortRestOptions {
	/** Hit dice to spend: a count (largest dice first) or explicit per-die counts. */
	hitDice?: number | { die: number; count: number }[];
	/** Wizard Arcane Recovery / Land druid Natural Recovery: slot levels to recover. */
	recoverSlots?: number[];
}

export interface ShortRestResult {
	character: Character;
	rolls: RollRecord[];
	hpRegained: number;
	recoveredSlots: number[];
}

export function hitDiceRemaining(c: Character): number {
	return c.hitDice.reduce((n, h) => n + h.total - h.used, 0);
}

/** Validates an Arcane/Natural Recovery choice: total ≤ half class level (rounded up), no slot of 6th+. */
export function slotRecoveryBudget(c: Character): { featureId: string; budget: number } | undefined {
	const wiz = classLevelOf(c, "wizard");
	const arcane = c.features.find((f) => f.id === "arcane-recovery");
	if (wiz && arcane && (!arcane.uses || arcane.uses.used < arcane.uses.max)) {
		const v = classSpecific(c, "wizard", "arcane_recovery_levels");
		return { featureId: "arcane-recovery", budget: typeof v === "number" ? v : Math.ceil(wiz / 2) };
	}
	const dru = classLevelOf(c, "druid");
	const nat = c.features.find((f) => f.id === "natural-recovery");
	if (dru && nat && (!nat.uses || nat.uses.used < nat.uses.max)) return { featureId: "natural-recovery", budget: Math.ceil(dru / 2) };
	return undefined;
}

export function shortRest(c: Character, rng: Rng, opts: ShortRestOptions = {}): ShortRestResult {
	const next = clone(c);
	const rolls: RollRecord[] = [];
	const con = abilityMod(next.abilities.con);
	let hpRegained = 0;

	// 1. Spend hit dice.
	const plan: { die: number; count: number }[] = [];
	if (typeof opts.hitDice === "number") {
		let left = opts.hitDice;
		for (const h of [...next.hitDice].sort((a, b) => b.die - a.die)) {
			const n = Math.min(left, h.total - h.used);
			if (n > 0) plan.push({ die: h.die, count: n });
			left -= n;
		}
		if (left > 0) throw new RulesError(`Only ${hitDiceRemaining(c)} hit dice left`);
	} else if (opts.hitDice) plan.push(...opts.hitDice);
	let spent = 0;
	for (const p of plan) {
		const h = next.hitDice.find((x) => x.die === p.die);
		if (!h || h.total - h.used < p.count) throw new RulesError(`Not enough d${p.die} hit dice`);
		for (let i = 0; i < p.count; i++) {
			const r = roll(rng, `1d${p.die}${con ? (con > 0 ? `+${con}` : `${con}`) : ""}`, { label: `${c.name} spends a hit die`, actor: c.id });
			rolls.push(r);
			hpRegained += Math.max(0, r.total);
			h.used += 1;
			spent++;
		}
	}
	// Song of Rest: one extra die if anyone spent hit dice (solo: the bard).
	const song = next.features.find((f) => /^song-of-rest-d\d+$/.test(f.id));
	if (song && spent > 0) {
		const die = Number(song.id.split("-d").pop());
		const r = roll(rng, `1d${die}`, { label: "Song of Rest", actor: c.id });
		rolls.push(r);
		hpRegained += r.total;
	}
	if (next.hp > 0 || hpRegained > 0) {
		const before = next.hp;
		next.hp = Math.min(effectiveMaxHp(next), next.hp + hpRegained);
		hpRegained = next.hp - before;
		if (before <= 0 && next.hp > 0) {
			next.deathSaves = { successes: 0, failures: 0 };
			next.conditions = next.conditions.filter((x) => !(x.id === "unconscious" && x.source === "0 hp"));
		}
	}

	// 2. Recharge short-rest features and pact slots.
	for (const f of next.features) if (f.uses && f.uses.recharge === "short") f.uses.used = 0;
	if (next.spellcasting?.pact) next.spellcasting.pact.used = 0;

	// 3. Arcane / Natural Recovery.
	const recovered: number[] = [];
	if (opts.recoverSlots?.length) {
		const b = slotRecoveryBudget(next);
		if (!b) throw new RulesError("No slot recovery feature available");
		const total = opts.recoverSlots.reduce((a, x) => a + x, 0);
		if (total > b.budget) throw new RulesError(`Can recover at most ${b.budget} slot levels`);
		if (opts.recoverSlots.some((l) => l >= 6 || l < 1)) throw new RulesError("Can't recover slots of 6th level or higher");
		const sc = next.spellcasting!;
		for (const l of opts.recoverSlots) {
			if ((sc.slotsUsed[l - 1] ?? 0) <= 0) throw new RulesError(`No expended level-${l} slot to recover`);
			sc.slotsUsed[l - 1] -= 1;
			recovered.push(l);
		}
		const f = next.features.find((x) => x.id === b.featureId);
		if (f?.uses) f.uses.used += 1;
	}
	return { character: next, rolls, hpRegained, recoveredSlots: recovered };
}

export interface LongRestOptions {
	/** Had food and water (needed to reduce exhaustion). Default true. */
	fed?: boolean;
}

export function longRest(c: Character, opts: LongRestOptions = {}): Character {
	const next = clone(c);
	if (next.deathSaves.failures >= 3) return next; // dead characters don't rest
	if (opts.fed !== false && next.exhaustion > 0) next.exhaustion -= 1;
	next.hp = effectiveMaxHp(next);
	next.tempHp = 0;
	next.deathSaves = { successes: 0, failures: 0 };
	next.conditions = next.conditions.filter((x) => x.source !== "0 hp");
	delete next.concentration;
	// Regain up to half total hit dice (min 1), largest dice first.
	let regain = Math.max(1, Math.floor(totalLevel(next) / 2));
	for (const h of [...next.hitDice].sort((a, b) => b.die - a.die)) {
		const n = Math.min(regain, h.used);
		h.used -= n;
		regain -= n;
	}
	for (const f of next.features) if (f.uses) f.uses.used = 0;
	if (next.spellcasting) {
		next.spellcasting.slotsUsed = next.spellcasting.slotsUsed.map(() => 0);
		if (next.spellcasting.pact) next.spellcasting.pact.used = 0;
	}
	return next;
}
