/**
 * Limited-use features, spell slots, conditions, exhaustion, HP/damage and
 * death saves. Every function is pure: it returns a new Character.
 */
import type { ActiveCondition, Character, ConditionId, DamageType, Feature, RollRecord } from "../../game/types";
import { abilityMod, roll, type Rng } from "../dice";
import { characterDefenses, classLevelOf, classSpecific, hasFeature } from "./derived";
import { featureGroup } from "./tables";

function clone<T>(x: T): T {
	return structuredClone(x);
}

// ─── feature uses ──────────────────────────────────────────────────────────

type Uses = { max: number; recharge: "short" | "long" | "dawn" };

/**
 * Max uses / recharge for limited features, keyed by feature id (or group).
 * Returns undefined for features without a usage limit.
 */
export function featureUses(c: Character, featureId: string): Uses | undefined {
	const id = featureGroup(featureId) ?? featureId;
	const cha = abilityMod(c.abilities.cha);
	const num = (classId: string, key: string): number => {
		const v = classSpecific(c, classId, key);
		return typeof v === "number" ? v : 0;
	};
	switch (id) {
		case "rage": {
			const n = num("barbarian", "rage_count");
			return { max: n >= 9999 ? 99 : n, recharge: "long" };
		}
		case "second-wind":
			return { max: 1, recharge: "short" };
		case "action-surge":
			return { max: Math.max(1, num("fighter", "action_surges")), recharge: "short" };
		case "indomitable":
			return { max: Math.max(1, num("fighter", "indomitable_uses")), recharge: "long" };
		case "bardic-inspiration":
			return { max: Math.max(1, cha), recharge: classLevelOf(c, "bard") >= 5 ? "short" : "long" };
		case "channel-divinity":
			if (featureId === "channel-divinity" /* paladin */) return { max: 1, recharge: "short" };
			return { max: Math.max(1, num("cleric", "channel_divinity_charges")), recharge: "short" };
		case "wild-shape":
			return { max: 2, recharge: "short" };
		case "ki":
			return { max: num("monk", "ki_points"), recharge: "short" };
		case "font-of-magic":
			return { max: num("sorcerer", "sorcery_points"), recharge: "long" };
		case "divine-sense":
			return { max: 1 + Math.max(0, cha), recharge: "long" };
		case "lay-on-hands":
			return { max: 5 * classLevelOf(c, "paladin"), recharge: "long" };
		case "cleansing-touch":
			return { max: Math.max(1, cha), recharge: "long" };
		case "arcane-recovery":
		case "natural-recovery":
		case "relentless-endurance":
		case "wholeness-of-body":
		case "hurl-through-hell":
		case "holy-nimbus":
		case "eldritch-master":
		case "divine-intervention":
		case "mystic-arcanum-6th-level":
		case "mystic-arcanum-7th-level":
		case "mystic-arcanum-8th-level":
		case "mystic-arcanum-9th-level":
			return { max: 1, recharge: "long" };
		case "breath-weapon":
		case "dark-ones-own-luck":
		case "stroke-of-luck":
			return { max: 1, recharge: "short" };
		default:
			return undefined;
	}
}

/** Recomputes `uses.max` for every feature (after level-up / ability change), keeping `used`. */
export function refreshFeatureUses(c: Character): Character {
	const next = clone(c);
	next.features = next.features.map((f): Feature => {
		const u = featureUses(next, f.id);
		// Unknown features keep whatever counter another module gave them.
		if (!u) return f;
		const used = Math.min(f.uses?.used ?? 0, u.max);
		return { ...f, uses: { max: u.max, used, recharge: u.recharge } };
	});
	return next;
}

/** Finds a feature by id, superseding group ("action-surge") or case-insensitive name. */
export function findFeature(c: Character, idOrName: string): Feature | undefined {
	const q = idOrName.toLowerCase();
	return (
		c.features.find((f) => f.id === idOrName) ??
		c.features.find((f) => featureGroup(f.id) === idOrName) ??
		c.features.find((f) => f.name.toLowerCase() === q)
	);
}

export class RulesError extends Error {}

/** Spends `n` uses of a feature (n = points for pools like ki or lay on hands). */
export function useFeature(c: Character, featureId: string, n = 1): Character {
	const f = findFeature(c, featureId);
	if (!f) throw new RulesError(`${c.name} doesn't have the feature "${featureId}"`);
	if (!f.uses) return c; // unlimited
	const left = f.uses.max - f.uses.used;
	if (n > left) throw new RulesError(`${f.name}: only ${left} use(s) left`);
	const next = clone(c);
	const nf = next.features.find((x) => x.id === f.id)!;
	nf.uses!.used += n;
	return next;
}
export function restoreFeature(c: Character, featureId: string, n?: number): Character {
	const f = findFeature(c, featureId);
	if (!f?.uses) return c;
	const next = clone(c);
	const nf = next.features.find((x) => x.id === f.id)!;
	nf.uses!.used = n === undefined ? 0 : Math.max(0, nf.uses!.used - n);
	return next;
}

// ─── spell slots ───────────────────────────────────────────────────────────

export function slotsAvailable(c: Character, level: number): { regular: number; pact: number } {
	const sc = c.spellcasting;
	if (!sc || level < 1 || level > 9) return { regular: 0, pact: 0 };
	const regular = (sc.slots[level - 1] ?? 0) - (sc.slotsUsed[level - 1] ?? 0);
	const pact = sc.pact && sc.pact.level === level ? sc.pact.max - sc.pact.used : 0;
	return { regular, pact };
}

/**
 * Expends a slot of `level`. By default uses a regular slot first and falls
 * back to a pact slot of the same level; `pact: true` forces pact magic.
 */
export function spendSlot(c: Character, level: number, opts: { pact?: boolean } = {}): Character {
	const av = slotsAvailable(c, level);
	const next = clone(c);
	const sc = next.spellcasting;
	if (!sc) throw new RulesError(`${c.name} has no spell slots`);
	if (!opts.pact && av.regular > 0) {
		sc.slotsUsed[level - 1] = (sc.slotsUsed[level - 1] ?? 0) + 1;
		return next;
	}
	if (av.pact > 0 && sc.pact) {
		sc.pact.used += 1;
		return next;
	}
	throw new RulesError(`No level-${level} spell slot left`);
}
export function restoreSlot(c: Character, level: number, opts: { pact?: boolean } = {}): Character {
	const next = clone(c);
	const sc = next.spellcasting;
	if (!sc) return c;
	if (opts.pact && sc.pact) sc.pact.used = Math.max(0, sc.pact.used - 1);
	else sc.slotsUsed[level - 1] = Math.max(0, (sc.slotsUsed[level - 1] ?? 0) - 1);
	return next;
}

// ─── conditions & exhaustion ───────────────────────────────────────────────

export function hasCondition(c: Pick<Character, "conditions">, id: ConditionId): boolean {
	return c.conditions.some((x) => x.id === id);
}

/** Adds (or refreshes) a condition. Returns unchanged if immune (e.g. Fey Ancestry vs. charm isn't immunity). */
export function addCondition(c: Character, cond: ActiveCondition | ConditionId): Character {
	const ac: ActiveCondition = typeof cond === "string" ? { id: cond } : cond;
	if (conditionImmune(c, ac.id)) return c;
	const next = clone(c);
	next.conditions = next.conditions.filter((x) => !(x.id === ac.id && x.source === ac.source));
	next.conditions.push(ac);
	// Paralyzed/petrified/stunned/unconscious imply incapacitated; tracked implicitly by isIncapacitated().
	return next;
}
export function removeCondition(c: Character, id: ConditionId, source?: string): Character {
	const next = clone(c);
	next.conditions = next.conditions.filter((x) => !(x.id === id && (source === undefined || x.source === source)));
	return next;
}
export function conditionImmune(c: Character, id: ConditionId): boolean {
	if (id === "poisoned" && hasFeature(c, "purity-of-body")) return true;
	if (id === "frightened" && hasFeature(c, "aura-of-courage")) return true;
	return false;
}
export function isIncapacitated(c: Pick<Character, "conditions">): boolean {
	return c.conditions.some((x) => ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"].includes(x.id));
}

/** Exhaustion level 0–6; 6 = death. */
export function setExhaustion(c: Character, level: number): Character {
	const next = clone(c);
	next.exhaustion = Math.max(0, Math.min(6, Math.round(level)));
	if (next.exhaustion >= 6) {
		next.hp = 0;
		next.deathSaves = { successes: 0, failures: 3 };
	}
	return next;
}
export function addExhaustion(c: Character, delta = 1): Character {
	return setExhaustion(c, c.exhaustion + delta);
}
/** Effects of the current exhaustion level, for the sheet. */
export function exhaustionEffects(level: number): string[] {
	const all = [
		"Disadvantage on ability checks",
		"Speed halved",
		"Disadvantage on attack rolls and saving throws",
		"Hit point maximum halved",
		"Speed reduced to 0",
		"Death",
	];
	return all.slice(0, Math.max(0, Math.min(6, level)));
}
/** Effective HP maximum (halved at exhaustion 4+). */
export function effectiveMaxHp(c: Character): number {
	return c.exhaustion >= 4 ? Math.floor(c.maxHp / 2) : c.maxHp;
}

// ─── HP, damage, healing, death ────────────────────────────────────────────

export function isDead(c: Character): boolean {
	return c.deathSaves.failures >= 3 || c.exhaustion >= 6;
}
export function isDying(c: Character): boolean {
	return c.hp <= 0 && !isDead(c) && c.deathSaves.successes < 3;
}
export function isStable(c: Character): boolean {
	return c.hp <= 0 && !isDead(c) && c.deathSaves.successes >= 3;
}

export interface DamageOptions {
	type?: DamageType;
	/** The hit was a critical (2 death-save failures if already at 0 HP). */
	critical?: boolean;
	/** Extra resistances active now (e.g. while raging: bludgeoning/piercing/slashing). */
	extraResistances?: DamageType[];
	extraImmunities?: DamageType[];
	extraVulnerabilities?: DamageType[];
}

export interface DamageResult {
	character: Character;
	/** Damage after resistance/immunity/vulnerability. */
	applied: number;
	absorbedByTemp: number;
	hpLost: number;
	droppedToZero: boolean;
	instantDeath: boolean;
	modifier?: "resisted" | "immune" | "vulnerable";
}

/** Adjusts raw damage for resistances/immunities/vulnerabilities. */
export function adjustDamage(c: Character, amount: number, opts: DamageOptions = {}): { amount: number; modifier?: DamageResult["modifier"] } {
	if (!opts.type) return { amount };
	const d = characterDefenses(c);
	const t = opts.type;
	if (d.immunities.includes(t) || opts.extraImmunities?.includes(t)) return { amount: 0, modifier: "immune" };
	let a = amount;
	let modifier: DamageResult["modifier"];
	if (d.resistances.includes(t) || opts.extraResistances?.includes(t)) {
		a = Math.floor(a / 2);
		modifier = "resisted";
	}
	if (d.vulnerabilities.includes(t) || opts.extraVulnerabilities?.includes(t)) {
		a *= 2;
		modifier = modifier ? undefined : "vulnerable";
	}
	return { amount: a, modifier };
}

export function applyDamage(c: Character, amount: number, opts: DamageOptions = {}): DamageResult {
	const adj = adjustDamage(c, Math.max(0, Math.floor(amount)), opts);
	const next = clone(c);
	let left = adj.amount;
	const absorbed = Math.min(next.tempHp, left);
	next.tempHp -= absorbed;
	left -= absorbed;
	const wasAtZero = next.hp <= 0;
	let instantDeath = false;
	let droppedToZero = false;
	let hpLost = 0;
	if (left > 0) {
		if (wasAtZero) {
			// Damage at 0 HP: a death save failure (2 on a crit); massive damage kills.
			if (left >= effectiveMaxHp(next)) instantDeath = true;
			next.deathSaves.failures = Math.min(3, next.deathSaves.failures + (opts.critical ? 2 : 1));
			next.deathSaves.successes = Math.min(next.deathSaves.successes, 2);
		} else {
			hpLost = Math.min(next.hp, left);
			const overflow = left - next.hp;
			next.hp = Math.max(0, next.hp - left);
			if (next.hp === 0) {
				droppedToZero = true;
				if (overflow >= effectiveMaxHp(next)) instantDeath = true;
				else {
					next.deathSaves = { successes: 0, failures: 0 };
					if (!hasCondition(next, "unconscious")) next.conditions.push({ id: "unconscious", source: "0 hp" });
					if (!hasCondition(next, "prone")) next.conditions.push({ id: "prone", source: "0 hp" });
				}
			}
		}
	}
	if (instantDeath) {
		next.hp = 0;
		next.deathSaves = { successes: 0, failures: 3 };
	}
	if (adj.amount > 0 && next.concentration && next.hp <= 0) delete next.concentration;
	return {
		character: next,
		applied: adj.amount,
		absorbedByTemp: absorbed,
		hpLost,
		droppedToZero,
		instantDeath,
		...(adj.modifier ? { modifier: adj.modifier } : {}),
	};
}

/** DC for the concentration save after taking `damage`. */
export function concentrationDc(damage: number): number {
	return Math.max(10, Math.floor(damage / 2));
}

/** Heals up to the (effective) maximum. Healing from 0 HP wakes the character. */
export function heal(c: Character, amount: number): Character {
	if (isDead(c)) return c;
	const next = clone(c);
	const wasZero = next.hp <= 0;
	next.hp = Math.min(effectiveMaxHp(next), next.hp + Math.max(0, Math.floor(amount)));
	if (wasZero && next.hp > 0) {
		next.deathSaves = { successes: 0, failures: 0 };
		next.conditions = next.conditions.filter((x) => !(x.id === "unconscious" && x.source === "0 hp"));
	}
	return next;
}

/** Temporary HP don't stack: keep the higher value. */
export function grantTempHp(c: Character, amount: number): Character {
	const next = clone(c);
	next.tempHp = Math.max(next.tempHp, Math.max(0, Math.floor(amount)));
	return next;
}

export interface DeathSaveResult {
	character: Character;
	roll: RollRecord;
	outcome: "success" | "failure" | "stable" | "dead" | "revived";
}

/** Rolls a death saving throw (d20, 10+ success; nat 20 = 1 HP; nat 1 = 2 failures). */
export function rollDeathSave(c: Character, rng: Rng, opts: { advantage?: "advantage" | "disadvantage" } = {}): DeathSaveResult {
	const r = roll(rng, "1d20", { label: `${c.name} death saving throw`, actor: c.id, target: 10, ...(opts.advantage ? { advantage: opts.advantage } : {}) });
	const nat = r.dice.find((d) => !d.dropped)?.value ?? r.total;
	return { ...recordDeathSave(c, nat), roll: r };
}

/** Applies a natural d20 result to the death save track. */
export function recordDeathSave(c: Character, natural: number): Omit<DeathSaveResult, "roll"> {
	let next = clone(c);
	if (natural === 20) {
		next = heal(next, 1);
		return { character: next, outcome: "revived" };
	}
	if (natural >= 10) next.deathSaves.successes += 1;
	else next.deathSaves.failures += natural === 1 ? 2 : 1;
	next.deathSaves.failures = Math.min(3, next.deathSaves.failures);
	if (next.deathSaves.failures >= 3) return { character: next, outcome: "dead" };
	if (next.deathSaves.successes >= 3) {
		next.deathSaves.successes = 3;
		return { character: next, outcome: "stable" };
	}
	return { character: next, outcome: natural >= 10 ? "success" : "failure" };
}

/** Medicine check / Spare the Dying: becomes stable at 0 HP. */
export function stabilize(c: Character): Character {
	if (c.hp > 0 || isDead(c)) return c;
	const next = clone(c);
	next.deathSaves = { successes: 3, failures: 0 };
	return next;
}

// ─── misc ──────────────────────────────────────────────────────────────────

export function setConcentration(c: Character, spell: string | undefined, startedRound?: number): Character {
	const next = clone(c);
	if (spell) next.concentration = { spell, ...(startedRound !== undefined ? { startedRound } : {}) };
	else delete next.concentration;
	return next;
}
