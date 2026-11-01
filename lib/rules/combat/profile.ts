import type { Ability, AttackAction, Character, DamageType, InventoryItem, MonsterStats } from "../../game/types";
import { ABILITIES } from "../../game/types";
import { abilityMod, parseNotation } from "../dice";
import type { PcCombatProfile } from "./types";

/**
 * Minimal local character math (the full rules live in lib/rules/character;
 * this module deliberately does not import it). Every derived value can be
 * overridden by passing `overrides` to `derivePcProfile`.
 */

export function characterLevel(c: Character): number {
	return Math.max(1, c.classes.reduce((s, k) => s + k.level, 0));
}

export function proficiencyBonus(level: number): number {
	return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

function classLevel(c: Character, classId: string): number {
	return c.classes.find((k) => k.classId === classId)?.level ?? 0;
}

export function estimateAc(c: Character): number {
	const dex = abilityMod(c.abilities.dex);
	const armor = c.inventory.find((i) => i.equipped && i.armor && i.armor.type !== "shield");
	const shield = c.inventory.find((i) => i.equipped && i.armor?.type === "shield");
	const shieldAc = shield ? 2 + (shield.armor?.magicBonus ?? 0) : 0;
	if (armor?.armor) {
		const a = armor.armor;
		const cap = a.type === "heavy" ? 0 : a.type === "medium" ? (a.dexCap ?? 2) : (a.dexCap ?? Infinity);
		return a.baseAc + Math.min(dex, cap) + (a.magicBonus ?? 0) + shieldAc;
	}
	if (classLevel(c, "barbarian") > 0) return 10 + dex + abilityMod(c.abilities.con) + shieldAc;
	if (classLevel(c, "monk") > 0 && !shield) return 10 + dex + abilityMod(c.abilities.wis);
	return 10 + dex + shieldAc;
}

function extraAttacks(c: Character): number {
	const f = classLevel(c, "fighter");
	let n = f >= 20 ? 4 : f >= 11 ? 3 : f >= 5 ? 2 : 1;
	for (const k of ["barbarian", "monk", "paladin", "ranger"]) if (classLevel(c, k) >= 5) n = Math.max(n, 2);
	return n;
}

export function derivePcProfile(c: Character, overrides: Partial<PcCombatProfile> = {}): PcCombatProfile {
	const level = characterLevel(c);
	const pb = proficiencyBonus(level);
	const mod = (a: Ability) => abilityMod(c.abilities[a]);
	const saveBonuses = Object.fromEntries(ABILITIES.map((a) => [a, mod(a) + (c.savingThrows.includes(a) ? pb : 0)])) as Record<Ability, number>;
	const skill = (name: string, a: Ability) => mod(a) + (c.expertise.includes(name) ? 2 * pb : c.skills.includes(name) ? pb : 0);
	const champion = c.classes.find((k) => k.classId === "fighter" && k.subclassId === "champion");
	const critOn = champion ? (champion.level >= 15 ? 18 : champion.level >= 3 ? 19 : 20) : 20;
	const sc = c.spellcasting?.classes[0];
	const base: PcCombatProfile = {
		ac: estimateAc(c),
		speed: c.speed,
		proficiencyBonus: pb,
		initiativeBonus: mod("dex"),
		attacksPerAction: extraAttacks(c),
		critOn,
		saveBonuses,
		stealthBonus: skill("stealth", "dex"),
		passivePerception: 10 + skill("perception", "wis"),
		level,
		resistances: [],
		vulnerabilities: [],
		immunities: [],
		cunningAction: classLevel(c, "rogue") >= 2,
		...(sc ? { spellcastingAbility: sc.ability, spellAttackBonus: pb + mod(sc.ability), spellSaveDc: 8 + pb + mod(sc.ability) } : {}),
	};
	return { ...base, ...overrides };
}

/** A resolved attack option (PC weapon or monster attack). */
export interface AttackProfile {
	name: string;
	kind: "melee" | "ranged";
	toHit: number;
	/** Damage notations including modifiers, e.g. "1d8+3". */
	damage: { dice: string; type: DamageType }[];
	/** Melee reach in feet. */
	reach: number;
	range?: { normal: number; long?: number };
	critOn?: number;
	itemId?: string;
}

function withMod(dice: string, mod: number): string {
	if (!mod) return dice;
	return `${dice}${mod > 0 ? "+" : "-"}${Math.abs(mod)}`;
}

export function isRangedWeapon(item: InventoryItem): boolean {
	const w = item.weapon;
	if (!w) return false;
	const props = w.properties.map((p) => p.toLowerCase());
	return !!w.range && !props.includes("thrown");
}

/**
 * Builds a PC attack from a weapon item (or unarmed when `item` is undefined).
 * `thrown`: use a thrown melee weapon at range. `offHand`: no positive ability mod to damage.
 */
export function pcAttackProfile(
	c: Character,
	profile: PcCombatProfile,
	item: InventoryItem | undefined,
	opts: { thrown?: boolean; offHand?: boolean } = {},
): AttackProfile {
	const str = abilityMod(c.abilities.str);
	const dex = abilityMod(c.abilities.dex);
	if (!item?.weapon) {
		if (profile.unarmed) {
			return { name: "Unarmed Strike", kind: "melee", toHit: profile.unarmed.toHit, damage: [{ dice: profile.unarmed.damage, type: profile.unarmed.damageType }], reach: 5, critOn: profile.critOn };
		}
		return { name: "Unarmed Strike", kind: "melee", toHit: str + profile.proficiencyBonus, damage: [{ dice: String(Math.max(1, 1 + str)), type: "bludgeoning" }], reach: 5, critOn: profile.critOn };
	}
	const w = item.weapon;
	const props = w.properties.map((p) => p.toLowerCase());
	const ranged = isRangedWeapon(item) || !!opts.thrown;
	const finesse = props.includes("finesse");
	const mod = isRangedWeapon(item) ? dex : finesse ? Math.max(str, dex) : str;
	const prof = profile.weaponProficient ? (profile.weaponProficient(item) ? profile.proficiencyBonus : 0) : profile.proficiencyBonus;
	const magic = w.magicBonus ?? 0;
	const hasShield = c.inventory.some((i) => i.equipped && i.armor?.type === "shield");
	const dice = w.versatile && !hasShield && !opts.offHand && !ranged ? w.versatile : w.damage;
	const dmgMod = (opts.offHand && mod > 0 ? 0 : mod) + magic;
	return {
		name: item.name,
		kind: ranged ? "ranged" : "melee",
		toHit: mod + prof + magic,
		damage: [{ dice: withMod(dice, dmgMod), type: w.damageType }],
		reach: props.includes("reach") ? 10 : 5,
		range: ranged ? w.range : undefined,
		critOn: profile.critOn,
		itemId: item.id,
	};
}

/** Average damage of an attack (for AI choices). */
export function averageDamage(damage: { dice: string }[]): number {
	let sum = 0;
	for (const d of damage) {
		try {
			const p = parseNotation(d.dice);
			sum += p.modifier + p.terms.reduce((s, t) => s + t.sign * t.count * ((t.sides + 1) / 2), 0);
		} catch {
			/* ignore unparsable */
		}
	}
	return sum;
}

export function monsterAttackProfile(a: AttackAction, preferRanged = false): AttackProfile {
	const ranged = a.kind === "ranged" || (a.kind === "melee_or_ranged" && preferRanged);
	return {
		name: a.name,
		kind: ranged ? "ranged" : "melee",
		toHit: a.toHit,
		damage: a.damage.map((d) => ({ dice: d.dice, type: d.type })),
		reach: a.reach ?? 5,
		range: ranged ? (a.range ?? { normal: 5 }) : undefined,
	};
}

/** Best melee attack a PC can use for an opportunity attack. */
export function pcBestMelee(c: Character, profile: PcCombatProfile): AttackProfile {
	const options = c.inventory
		.filter((i) => i.equipped && i.weapon && !isRangedWeapon(i))
		.map((i) => pcAttackProfile(c, profile, i));
	options.push(pcAttackProfile(c, profile, undefined));
	return options.sort((x, y) => averageDamage(y.damage) - averageDamage(x.damage))[0];
}

export function monsterSaveBonus(stats: MonsterStats | undefined, ability: Ability): number {
	if (!stats) return 0;
	return stats.saves[ability] ?? abilityMod(stats.abilities[ability]);
}

export function monsterPassivePerception(stats: MonsterStats | undefined): number {
	if (!stats) return 10;
	const m = /passive perception\s*(\d+)/i.exec(stats.senses);
	if (m) return Number(m[1]);
	return 10 + (stats.skills.perception ?? abilityMod(stats.abilities.wis));
}
