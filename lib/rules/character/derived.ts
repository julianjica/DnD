/** Derived character statistics (pure; computed from Character on demand). */
import type { Ability, Abilities, Character, DamageType, InventoryItem } from "../../game/types";
import { ABILITIES } from "../../game/types";
import { abilityMod, signed } from "../dice";
import { getClass, getEquipment, getSubclass, classLevel as classLevelRow } from "../../srd/index";
import { FEATURE_IMMUNITY, FEATURE_RESISTANCE, SKILL_ABILITY, proficiencyBonus } from "./tables";

// ─── basic helpers ─────────────────────────────────────────────────────────

export function totalLevel(c: Pick<Character, "classes">): number {
	return c.classes.reduce((n, x) => n + x.level, 0);
}
export function classLevelOf(c: Pick<Character, "classes">, classId: string): number {
	return c.classes.find((x) => x.classId === classId)?.level ?? 0;
}
export function profBonusOf(c: Pick<Character, "classes">): number {
	return proficiencyBonus(totalLevel(c));
}
export function abilityMods(a: Abilities): Abilities {
	return Object.fromEntries(ABILITIES.map((k) => [k, abilityMod(a[k])])) as Abilities;
}
export function hasFeature(c: Pick<Character, "features">, id: string | RegExp): boolean {
	return c.features.some((f) => (typeof id === "string" ? f.id === id : id.test(f.id)));
}
/** Class-specific number from the class level table (rage_count, ki_points…). */
export function classSpecific(c: Pick<Character, "classes">, classId: string, key: string): number | string | undefined {
	const lvl = classLevelOf(c, classId);
	if (!lvl) return undefined;
	return classLevelRow(classId, lvl)?.specific[key];
}

// ─── armor class ───────────────────────────────────────────────────────────

export interface AcResult {
	ac: number;
	/** Human-readable breakdown, e.g. "Chain Mail 16 + Shield 2 + Defense 1". */
	source: string;
}

export function equippedArmor(c: Character): { armor?: InventoryItem; shield?: InventoryItem } {
	const armor = c.inventory.find((i) => i.equipped && i.armor && i.armor.type !== "shield");
	const shield = c.inventory.find((i) => i.equipped && i.armor?.type === "shield");
	return { armor, shield };
}

export function armorClass(c: Character): AcResult {
	const m = abilityMods(c.abilities);
	const { armor, shield } = equippedArmor(c);
	const shieldAc = shield?.armor ? shield.armor.baseAc + (shield.armor.magicBonus ?? 0) : 0;
	const options: AcResult[] = [];
	if (armor?.armor) {
		const a = armor.armor;
		const dex = a.type === "heavy" ? 0 : a.dexCap !== undefined ? Math.min(m.dex, a.dexCap) : a.type === "medium" ? Math.min(m.dex, 2) : m.dex;
		const parts = [`${armor.name} ${a.baseAc}`];
		if (dex) parts.push(`DEX ${signed(dex)}`);
		if (a.magicBonus) parts.push(`magic ${signed(a.magicBonus)}`);
		options.push({ ac: a.baseAc + dex + (a.magicBonus ?? 0), source: parts.join(" + ") });
	} else {
		options.push({ ac: 10 + m.dex, source: `10 + DEX ${signed(m.dex)}` });
		if (hasFeature(c, "barbarian-unarmored-defense")) {
			options.push({ ac: 10 + m.dex + m.con, source: `Unarmored Defense 10 + DEX ${signed(m.dex)} + CON ${signed(m.con)}` });
		}
		if (hasFeature(c, "monk-unarmored-defense") && !shield) {
			options.push({ ac: 10 + m.dex + m.wis, source: `Unarmored Defense 10 + DEX ${signed(m.dex)} + WIS ${signed(m.wis)}` });
		}
		if (hasFeature(c, "draconic-resilience")) {
			options.push({ ac: 13 + m.dex, source: `Draconic Resilience 13 + DEX ${signed(m.dex)}` });
		}
	}
	const best = options.reduce((a, b) => (b.ac > a.ac ? b : a));
	let ac = best.ac;
	let source = best.source;
	if (shieldAc) {
		ac += shieldAc;
		source += ` + Shield ${shieldAc}`;
	}
	if (armor && c.features.some((f) => /fighting-style-defense$/.test(f.id))) {
		ac += 1;
		source += " + Defense 1";
	}
	return { ac, source };
}

// ─── saves & skills ────────────────────────────────────────────────────────

export function saveMod(c: Character, ab: Ability): number {
	const m = abilityMod(c.abilities[ab]);
	return m + (c.savingThrows.includes(ab) ? profBonusOf(c) : 0);
}

export interface SkillInfo {
	ability: Ability;
	mod: number;
	proficient: boolean;
	expertise: boolean;
	/** Half-proficiency from Jack of All Trades / Remarkable Athlete. */
	half: boolean;
}

/** Bonus a non-proficient ability check gets from Jack of All Trades / Remarkable Athlete. */
function halfProfBonus(c: Character, ab: Ability): number {
	const pb = profBonusOf(c);
	if (hasFeature(c, "jack-of-all-trades")) return Math.floor(pb / 2);
	if (hasFeature(c, "remarkable-athlete") && (ab === "str" || ab === "dex" || ab === "con")) return Math.ceil(pb / 2);
	return 0;
}

export function skillInfo(c: Character, skill: string): SkillInfo {
	const ab = SKILL_ABILITY[skill] ?? "int";
	const pb = profBonusOf(c);
	const proficient = c.skills.includes(skill);
	const expertise = proficient && c.expertise.includes(skill);
	const half = !proficient ? halfProfBonus(c, ab) : 0;
	const mod = abilityMod(c.abilities[ab]) + (expertise ? 2 * pb : proficient ? pb : half);
	return { ability: ab, mod, proficient, expertise, half: half > 0 };
}
export function skillMod(c: Character, skill: string): number {
	return skillInfo(c, skill).mod;
}
/** Raw ability check (no skill), incl. Jack of All Trades / Remarkable Athlete. */
export function abilityCheckMod(c: Character, ab: Ability): number {
	return abilityMod(c.abilities[ab]) + halfProfBonus(c, ab);
}
export function toolMod(c: Character, tool: string, ab: Ability): number {
	const pb = profBonusOf(c);
	const prof = c.tools.includes(tool);
	return abilityMod(c.abilities[ab]) + (prof ? (c.expertise.includes(tool) ? 2 * pb : pb) : halfProfBonus(c, ab));
}
export function initiativeMod(c: Character): number {
	return abilityCheckMod(c, "dex");
}
export function passiveScore(c: Character, skill: string): number {
	return 10 + skillMod(c, skill);
}

// ─── spellcasting ──────────────────────────────────────────────────────────

export function spellSaveDc(c: Character, ab: Ability): number {
	return 8 + profBonusOf(c) + abilityMod(c.abilities[ab]);
}
export function spellAttackBonus(c: Character, ab: Ability): number {
	return profBonusOf(c) + abilityMod(c.abilities[ab]);
}

/** Number of spells a prepared caster may prepare (excludes always-prepared subclass spells). */
export function preparedLimit(c: Character, classId: string): number | undefined {
	const cls = getClass(classId);
	const sc = cls?.spellcasting;
	if (!sc?.prepares) return undefined;
	const lvl = classLevelOf(c, classId);
	if (lvl < sc.startLevel) return 0;
	const mod = abilityMod(c.abilities[sc.ability]);
	const eff = sc.type === "half" ? Math.floor(lvl / 2) : lvl;
	return Math.max(1, mod + eff);
}

/** Subclass spells always prepared (domain/oath/circle) at the current class level. */
export function alwaysPreparedSpells(c: Character, classId: string): string[] {
	const cl = c.classes.find((x) => x.classId === classId);
	if (!cl?.subclassId) return [];
	const sub = getSubclass(cl.subclassId);
	if (!sub || classId === "warlock") return [];
	return sub.spells.filter((s) => s.level <= cl.level && (!s.requires || hasFeature(c, s.requires))).map((s) => s.spell);
}

// ─── defenses ──────────────────────────────────────────────────────────────

export interface Defenses {
	resistances: DamageType[];
	immunities: DamageType[];
	vulnerabilities: DamageType[];
}

/** Resistances/immunities from species traits and class features. */
export function characterDefenses(c: Character): Defenses {
	const res = new Set<DamageType>();
	const imm = new Set<DamageType>();
	for (const f of c.features) {
		const r = FEATURE_RESISTANCE[f.id];
		if (r) res.add(r);
		const i = FEATURE_IMMUNITY[f.id];
		if (i) imm.add(i);
	}
	return { resistances: [...res], immunities: [...imm], vulnerabilities: [] };
}

// ─── carrying ──────────────────────────────────────────────────────────────

export function carriedWeight(c: Character): number {
	return Math.round(c.inventory.reduce((w, i) => w + (i.weight ?? 0) * i.quantity, 0) * 100) / 100;
}
export function carryingCapacity(c: Character): { capacity: number; pushDragLift: number; carried: number; overloaded: boolean } {
	const mult = c.size === "tiny" ? 0.5 : c.size === "large" ? 2 : c.size === "huge" ? 4 : c.size === "gargantuan" ? 8 : 1;
	const capacity = c.abilities.str * 15 * mult;
	const carried = carriedWeight(c);
	return { capacity, pushDragLift: capacity * 2, carried, overloaded: carried > capacity };
}

// ─── attacks ───────────────────────────────────────────────────────────────

export interface SheetAttack {
	itemId?: string;
	name: string;
	kind: "melee" | "ranged";
	ability: Ability;
	toHit: number;
	/** e.g. "1d8+3" */
	damage: string;
	damageType: DamageType;
	/** Two-handed damage for versatile weapons. */
	versatileDamage?: string;
	reach?: number;
	range?: { normal: number; long?: number };
	properties: string[];
	proficient: boolean;
	equipped: boolean;
	notes: string[];
}

function weaponProficient(c: Character, item: InventoryItem): boolean {
	if (!item.ref) return true;
	const eq = getEquipment(item.ref);
	if (!eq?.weapon) return true;
	return c.weaponProf.includes(eq.weapon.category) || c.weaponProf.includes(eq.index);
}
function isMonkWeapon(item: InventoryItem): boolean {
	const eq = item.ref ? getEquipment(item.ref) : undefined;
	if (!eq?.weapon) return false;
	if (eq.index === "shortsword") return true;
	return eq.weapon.category === "simple" && !eq.weapon.ranged && !eq.weapon.properties.includes("two-handed") && !eq.weapon.properties.includes("heavy");
}
function dmgStr(dice: string, mod: number): string {
	return mod ? `${dice}${signed(mod)}` : dice;
}
function biggerDie(a: string, b: string): string {
	const sa = Number(/d(\d+)/.exec(a)?.[1] ?? 0);
	const sb = Number(/d(\d+)/.exec(b)?.[1] ?? 0);
	return sb > sa ? b : a;
}

/** Attack options for the sheet: every weapon carried plus an unarmed strike. */
export function attacks(c: Character): SheetAttack[] {
	const m = abilityMods(c.abilities);
	const pb = profBonusOf(c);
	const monk = classLevelOf(c, "monk") > 0;
	const martialArts = monk ? String(classSpecific(c, "monk", "martial_arts") ?? "1d4") : undefined;
	const archery = c.features.some((f) => /fighting-style-archery$/.test(f.id));
	const dueling = c.features.some((f) => /fighting-style-dueling$/.test(f.id));
	const out: SheetAttack[] = [];
	for (const item of c.inventory) {
		const w = item.weapon;
		if (!w) continue;
		const props = w.properties;
		const eq = item.ref ? getEquipment(item.ref) : undefined;
		const ranged = eq?.weapon?.ranged ?? (!!w.range && !props.includes("thrown"));
		const finesse = props.includes("finesse");
		const monkW = monk && isMonkWeapon(item);
		let ab: Ability = ranged ? "dex" : "str";
		if ((finesse || monkW) && m.dex > m.str) ab = "dex";
		const proficient = weaponProficient(c, item);
		const magic = w.magicBonus ?? 0;
		const notes: string[] = [];
		let toHit = m[ab] + (proficient ? pb : 0) + magic;
		if (ranged && archery) {
			toHit += 2;
			notes.push("Archery +2");
		}
		let dice = w.damage;
		if (monkW && martialArts) dice = biggerDie(dice, martialArts);
		let dmgMod = m[ab] + magic;
		const twoHanded = props.includes("two-handed");
		if (!ranged && dueling && !twoHanded) {
			dmgMod += 2;
			notes.push("Dueling +2 (one-handed)");
		}
		const reach = ranged ? undefined : props.includes("reach") ? 10 : 5;
		const range = ranged ? w.range ?? eq?.weapon?.range : props.includes("thrown") ? eq?.weapon?.throwRange ?? w.range : undefined;
		if (props.includes("thrown") && !ranged) notes.push(`Thrown ${range ? `${range.normal}/${range.long ?? range.normal}` : ""}`.trim());
		if (props.includes("loading")) notes.push("Loading");
		if (props.includes("ammunition")) notes.push("Uses ammunition");
		if (props.includes("light")) notes.push("Light (two-weapon fighting)");
		if (props.includes("heavy") && (c.size === "small" || c.size === "tiny")) notes.push("Heavy: disadvantage (Small)");
		const versatile = w.versatile ? dmgStr(w.versatile, m[ab] + magic) : undefined;
		out.push({
			itemId: item.id,
			name: item.name,
			kind: ranged ? "ranged" : "melee",
			ability: ab,
			toHit,
			damage: dmgStr(dice, dmgMod),
			damageType: w.damageType,
			...(versatile ? { versatileDamage: versatile } : {}),
			...(reach ? { reach } : {}),
			...(range ? { range } : {}),
			properties: props,
			proficient,
			equipped: !!item.equipped,
			notes,
		});
	}
	// Unarmed strike: 1 + STR, or the martial arts die with DEX/STR for monks.
	const uAb: Ability = monk && m.dex > m.str ? "dex" : "str";
	out.push({
		name: "Unarmed Strike",
		kind: "melee",
		ability: uAb,
		toHit: m[uAb] + pb,
		damage: martialArts ? dmgStr(martialArts, m[uAb]) : String(Math.max(1, 1 + m.str)),
		damageType: "bludgeoning",
		reach: 5,
		properties: [],
		proficient: true,
		equipped: true,
		notes: monk ? ["Martial Arts: bonus-action unarmed strike after Attack"] : [],
	});
	return out;
}

/** Homebrew subclass features that grant Extra Attack. */
const EXTRA_ATTACK_FEATURES = new Set(["hb-battle-hymns-two-beat-strike"]);

/** Attacks per Attack action (Extra Attack). */
export function attacksPerAction(c: Character): number {
	let n = 1;
	const fighter = classSpecific(c, "fighter", "extra_attacks");
	if (typeof fighter === "number") n = Math.max(n, 1 + fighter);
	if (c.features.some((f) => /^(barbarian|monk|paladin|ranger)-extra-attack$/.test(f.id) || EXTRA_ATTACK_FEATURES.has(f.id))) n = Math.max(n, 2);
	return n;
}

export function critRange(c: Character): number {
	if (hasFeature(c, "superior-critical")) return 18;
	if (hasFeature(c, "improved-critical")) return 19;
	return 20;
}

export function speedOf(c: Character): number {
	let s = c.speed;
	const um = classSpecific(c, "monk", "unarmored_movement");
	const { armor, shield } = equippedArmor(c);
	if (typeof um === "number" && !armor && !shield) s += um;
	if (hasFeature(c, "fast-movement") && armor?.armor?.type !== "heavy") s += 10;
	if (armor?.armor?.strMin && c.abilities.str < armor.armor.strMin && c.speciesId !== "dwarf") s -= 10;
	if (c.exhaustion >= 5) return 0;
	if (c.exhaustion >= 2) s = Math.floor(s / 2);
	return Math.max(0, s);
}

// ─── full sheet ────────────────────────────────────────────────────────────

export interface CharacterSheet {
	level: number;
	profBonus: number;
	mods: Abilities;
	ac: number;
	acSource: string;
	saves: Record<Ability, { mod: number; proficient: boolean }>;
	skills: Record<string, SkillInfo>;
	passivePerception: number;
	passiveInvestigation: number;
	passiveInsight: number;
	initiative: number;
	speed: number;
	spellcasting: { classId: string; ability: Ability; saveDc: number; attackBonus: number; preparedLimit?: number }[];
	carrying: ReturnType<typeof carryingCapacity>;
	attacks: SheetAttack[];
	attacksPerAction: number;
	critRange: number;
	defenses: Defenses;
	/** Notable per-class numbers: sneak attack dice, rage damage, ki, martial arts… */
	classNumbers: Record<string, number | string>;
	xpToNext?: number;
}

export function deriveSheet(c: Character, xpToNext?: number): CharacterSheet {
	const mods = abilityMods(c.abilities);
	const ac = armorClass(c);
	const saves = Object.fromEntries(ABILITIES.map((a) => [a, { mod: saveMod(c, a), proficient: c.savingThrows.includes(a) }])) as CharacterSheet["saves"];
	const skills = Object.fromEntries(Object.keys(SKILL_ABILITY).map((s) => [s, skillInfo(c, s)]));
	const classNumbers: Record<string, number | string> = {};
	for (const cl of c.classes) {
		const row = classLevelRow(cl.classId, cl.level);
		for (const [k, v] of Object.entries(row?.specific ?? {})) classNumbers[k] = v;
	}
	return {
		level: totalLevel(c),
		profBonus: profBonusOf(c),
		mods,
		ac: ac.ac,
		acSource: ac.source,
		saves,
		skills,
		passivePerception: passiveScore(c, "perception"),
		passiveInvestigation: passiveScore(c, "investigation"),
		passiveInsight: passiveScore(c, "insight"),
		initiative: initiativeMod(c),
		speed: speedOf(c),
		spellcasting: (c.spellcasting?.classes ?? []).map((s) => {
			const limit = preparedLimit(c, s.classId);
			return {
				classId: s.classId,
				ability: s.ability,
				saveDc: spellSaveDc(c, s.ability),
				attackBonus: spellAttackBonus(c, s.ability),
				...(limit !== undefined ? { preparedLimit: limit } : {}),
			};
		}),
		carrying: carryingCapacity(c),
		attacks: attacks(c),
		attacksPerAction: attacksPerAction(c),
		critRange: critRange(c),
		defenses: characterDefenses(c),
		classNumbers,
		...(xpToNext !== undefined ? { xpToNext } : {}),
	};
}
