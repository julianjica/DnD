/**
 * Character creation: option lists for the setup wizard and `createCharacter`.
 */
import { nanoid } from "nanoid";
import type { Abilities, Ability, Character, Feature, InventoryItem, PortraitSpec, RollRecord } from "../../game/types";
import { ABILITIES } from "../../game/types";
import { roll, Rng } from "../dice";
import {
	EQUIPMENT, LANGUAGES, SKILLS, getBackground, getClass, getEquipment, getSpecies, getSubclass, spellsForClass, toIndex, zombieKit,
} from "../../srd/index";
import type { Ruleset } from "../ruleset";
import type {
	BackgroundData, ClassData, EquipmentChoice, EquipmentData, OptionChoice, Ref, SpeciesData, SubspeciesData,
} from "../../srd/types";
import { applyClassLevel, autoPick, levelUpOptions, resolveChoice, type Choices, type HpMethod } from "./leveling";
import { RulesError } from "./resources";
import { POINT_BUY_BUDGET, POINT_BUY_COST, SKILL_IDS, STANDARD_ARRAY, xpForLevel } from "./tables";

// ─── ability scores ────────────────────────────────────────────────────────

export type AbilityInput =
	| { method: "standard_array"; scores: Abilities }
	| { method: "point_buy"; scores: Abilities }
	/** `rolled` are the six results from `rollAbilityScores`; `scores` assigns them. */
	| { method: "roll"; scores: Abilities; rolled: number[] }
	| { method: "manual"; scores: Abilities };

export function pointBuyCost(scores: Abilities): number {
	return ABILITIES.reduce((n, a) => {
		const c = POINT_BUY_COST[scores[a]];
		if (c === undefined) throw new RulesError(`Point buy: ${a.toUpperCase()} ${scores[a]} must be between 8 and 15`);
		return n + c;
	}, 0);
}

function sameMultiset(a: readonly number[], b: readonly number[]): boolean {
	const x = [...a].sort((p, q) => p - q);
	const y = [...b].sort((p, q) => p - q);
	return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Validates base scores (before species bonuses). Throws RulesError. */
export function validateAbilities(input: AbilityInput): Abilities {
	const s = input.scores;
	for (const a of ABILITIES) if (!Number.isInteger(s[a])) throw new RulesError(`Missing ${a.toUpperCase()} score`);
	const vals = ABILITIES.map((a) => s[a]);
	switch (input.method) {
		case "standard_array":
			if (!sameMultiset(vals, STANDARD_ARRAY)) throw new RulesError(`Standard array must use exactly ${STANDARD_ARRAY.join(", ")}`);
			break;
		case "point_buy": {
			const cost = pointBuyCost(s);
			if (cost > POINT_BUY_BUDGET) throw new RulesError(`Point buy costs ${cost} points (budget ${POINT_BUY_BUDGET})`);
			break;
		}
		case "roll":
			if (input.rolled.length !== 6 || !sameMultiset(vals, input.rolled)) throw new RulesError("Rolled scores must be assigned exactly once each");
			if (input.rolled.some((v) => v < 3 || v > 18)) throw new RulesError("Rolled scores must be 3–18");
			break;
		case "manual":
			if (vals.some((v) => v < 3 || v > 20)) throw new RulesError("Manual scores must be 3–20");
			break;
	}
	return { ...s };
}

/** Rolls six ability scores with 4d6, dropping the lowest die. */
export function rollAbilityScores(rng: Rng): { scores: number[]; rolls: RollRecord[] } {
	const rolls = Array.from({ length: 6 }, (_, i) => roll(rng, "4d6kh3", { label: `Ability score ${i + 1} (4d6 drop lowest)` }));
	return { scores: rolls.map((r) => r.total), rolls };
}

/** Assigns six values to abilities in class-priority order (for quick builds). */
export function assignByPriority(values: readonly number[], classId: string): Abilities {
	const cls = getClass(classId);
	const order: Ability[] = [...(cls?.primaryAbility ?? []), "con", "dex", "wis", "str", "cha", "int"].filter((a, i, arr) => arr.indexOf(a) === i) as Ability[];
	const sorted = [...values].sort((a, b) => b - a);
	const out = {} as Abilities;
	order.forEach((a, i) => (out[a] = sorted[i]));
	return out;
}

// ─── option lists for the wizard ───────────────────────────────────────────

export interface ResolvedEquipmentChoice {
	/** Position in `equipment` input array. */
	index: number;
	from: "class" | "background";
	desc: string;
	options: {
		label: string;
		/** Fixed items. */
		items: { ref: string; name: string; qty: number }[];
		/** Picks the player must make from a category (in order). */
		picks: { label: string; choose: number; options: Ref[] }[];
	}[];
}

export interface CreationOptions {
	/** Content set: "zombie" (The Quiet) uses origins, techniques and a fixed profession kit with no gold. */
	ruleset: Ruleset;
	classId: string;
	speciesId: string;
	subspeciesId?: string;
	backgroundId: string;
	hitDie: number;
	savingThrows: Ability[];
	standardArray: number[];
	pointBuy: { budget: number; costs: Record<number, number>; min: number; max: number };
	/** Fixed species + subspecies bonuses. */
	abilityBonuses: Partial<Record<Ability, number>>;
	/** Skills already granted (species/background) — not offered again. */
	grantedSkills: string[];
	/** Every choice point with its id (key into `CreateCharacterInput.choices`). */
	choices: OptionChoice[];
	equipment: ResolvedEquipmentChoice[];
	/** The Quiet: the profession's fixed starting kit (replaces class/background gear; `equipment` is empty). */
	kit: { ref: string; name: string; qty: number }[];
	startingGold: number;
	subspecies: { index: string; name: string }[];
	/** How many spells a prepared caster prepares at level 1 = mod + level (needs the final score). */
	preparedFormula?: string;
}

/** Items in an equipment category (or a "list:a,b" pseudo-category). */
export function categoryOptions(category: string): Ref[] {
	if (category.startsWith("list:")) return category.slice(5).split(",").map((i) => ({ index: i, name: getEquipment(i)?.name ?? i }));
	// Equipment category index → items in it, using our normalized subcategories.
	const map: Record<string, (e: EquipmentData) => boolean> = {
		"simple-weapons": (e) => e.weapon?.category === "simple",
		"martial-weapons": (e) => e.weapon?.category === "martial",
		"simple-melee-weapons": (e) => e.weapon?.category === "simple" && !e.weapon.ranged,
		"martial-melee-weapons": (e) => e.weapon?.category === "martial" && !e.weapon.ranged,
		"arcane-foci": (e) => e.subcategory === "arcane-foci",
		"druidic-foci": (e) => e.subcategory === "druidic-foci",
		"holy-symbols": (e) => e.subcategory === "holy-symbols",
		"musical-instruments": (e) => e.subcategory === "musical-instrument",
		"artisans-tools": (e) => e.subcategory === "artisans-tools",
		"gaming-sets": (e) => e.subcategory === "gaming-sets",
	};
	const f = map[category];
	const list = f ? EQUIPMENT.filter(f) : EQUIPMENT.filter((e) => e.subcategory === category || e.category === category);
	return list.map((e) => ({ index: e.index, name: e.name }));
}

function resolveEquipment(list: EquipmentChoice[], from: "class" | "background", offset: number): ResolvedEquipmentChoice[] {
	return list.map((c, i) => ({
		index: offset + i,
		from,
		desc: c.desc,
		options: c.options.map((o) => ({
			label: o.label,
			items: o.grants.filter((g): g is { ref: string; qty: number } => "ref" in g).map((g) => ({ ref: g.ref, name: getEquipment(g.ref)?.name ?? g.ref, qty: g.qty })),
			picks: o.grants.filter((g): g is { category: string; choose: number; label: string } => "category" in g).map((g) => ({ label: g.label, choose: g.choose, options: categoryOptions(g.category) })),
		})),
	}));
}

function lookupAll(classId: string, speciesId: string, backgroundId: string, subspeciesId?: string): {
	cls: ClassData; sp: SpeciesData; bg: BackgroundData; sub?: SubspeciesData;
} {
	const cls = getClass(classId);
	if (!cls) throw new RulesError(`Unknown class ${classId}`);
	const sp = getSpecies(speciesId);
	if (!sp) throw new RulesError(`Unknown species ${speciesId}`);
	const bg = getBackground(backgroundId);
	if (!bg) throw new RulesError(`Unknown background ${backgroundId}`);
	let sub: SubspeciesData | undefined;
	if (subspeciesId) {
		sub = sp.subspecies.find((s) => s.index === subspeciesId);
		if (!sub) throw new RulesError(`${subspeciesId} is not a subspecies of ${sp.name}`);
	} else if (sp.subspecies.length === 1) sub = sp.subspecies[0];
	return { cls, sp, bg, sub };
}

/**
 * Languages a character may learn. The Quiet has no fantasy tongues: it offers
 * the real-world languages listed by the Bilingual origin.
 */
function langRefs(exclude: string[], rs: Ruleset): Ref[] {
	const pool = rs === "zombie" ? (getSpecies("z-origin-bilingual")?.choices.find((c) => c.id.endsWith(":languages"))?.options ?? []) : LANGUAGES.map((l) => ({ index: l.index, name: l.name }));
	return pool.filter((l) => !exclude.includes(l.index));
}

/**
 * Ruleset of a creation: explicit (the campaign's), or the species' own
 * (origins belong to The Quiet). An origin can't be used in a fantasy game;
 * a plain SRD species in The Quiet is tolerated (the wizard always offers origins).
 */
function creationRuleset(sp: SpeciesData, ruleset?: Ruleset): Ruleset {
	const own = sp.ruleset ?? "fantasy";
	if (ruleset === "fantasy" && own === "zombie") throw new RulesError(`${sp.name} is only available in The Quiet`);
	return ruleset ?? own;
}

/**
 * Lists every choice the setup wizard needs for this combination. Choice
 * ids are the keys of `CreateCharacterInput.choices`.
 */
export function creationOptions(classId: string, speciesId: string, backgroundId: string, subspeciesId?: string, ruleset?: Ruleset): CreationOptions {
	const { cls, sp, bg, sub } = lookupAll(classId, speciesId, backgroundId, subspeciesId);
	const rs = creationRuleset(sp, ruleset);
	const zombie = rs === "zombie";
	const granted = [...new Set([...sp.skills, ...(sub?.skills ?? []), ...bg.skills])];
	const choices: OptionChoice[] = [];
	for (const ch of [...sp.choices, ...(sub?.choices ?? [])]) {
		if (ch.id.endsWith(":skills")) choices.push({ ...ch, options: ch.options.filter((o) => !granted.includes(o.index)) });
		else if (ch.id.endsWith(":languages")) choices.push({ ...ch, options: ch.options.filter((o) => !sp.languages.includes(o.index)) });
		else choices.push(ch);
	}
	choices.push({
		id: "class:skills",
		label: `${cls.name} skills`,
		choose: cls.skillChoice.choose,
		options: cls.skillChoice.from.filter((s) => !granted.includes(s)).map((s) => ({ index: s, name: s.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) })),
	});
	for (const oc of cls.otherChoices) choices.push(oc);
	if (bg.languageChoose) choices.push({ id: "background:languages", label: `${bg.name} languages`, choose: bg.languageChoose, options: langRefs(sp.languages, rs) });
	for (const tc of bg.toolChoices) choices.push(tc);
	// Level-1 class choices (subclass at 1, fighting style, expertise, spells…).
	const stub = blankCharacter("stub", speciesId);
	stub.skills = [...granted];
	stub.tools = [...bg.tools, ...cls.tools];
	const lvl1 = levelUpOptions(stub, classId);
	for (const ch of lvl1.choices) {
		if (ch.id === "feature:rogue-expertise-1" || ch.id === "feature:bard-expertise-1") {
			// Expertise options depend on skills chosen above: offer all skills + thieves' tools.
			choices.push({ ...ch, options: [...SKILL_IDS.map((s) => ({ index: s, name: SKILLS.find((k) => k.index === s)?.name ?? s })), ...(classId === "rogue" ? [{ index: "thieves-tools", name: "Thieves' Tools" }] : [])] });
		} else choices.push(ch);
	}
	const equipment = zombie ? [] : [...resolveEquipment(cls.equipmentChoices, "class", 0), ...resolveEquipment(bg.equipmentChoices, "background", cls.equipmentChoices.length)];
	const kit = zombie ? zombieKit(classId).map((g) => ({ ref: g.ref, name: getEquipment(g.ref)?.name ?? g.ref, qty: g.qty })) : [];
	const bonuses: Partial<Record<Ability, number>> = { ...sp.abilityBonuses };
	for (const [a, v] of Object.entries(sub?.abilityBonuses ?? {}) as [Ability, number][]) bonuses[a] = (bonuses[a] ?? 0) + v;
	return {
		ruleset: rs,
		classId, speciesId, ...(sub ? { subspeciesId: sub.index } : {}), backgroundId,
		hitDie: cls.hitDie,
		savingThrows: cls.savingThrows,
		standardArray: [...STANDARD_ARRAY],
		pointBuy: { budget: POINT_BUY_BUDGET, costs: POINT_BUY_COST, min: 8, max: 15 },
		abilityBonuses: bonuses,
		grantedSkills: granted,
		choices,
		equipment,
		kit,
		startingGold: zombie ? 0 : bg.gold,
		subspecies: sp.subspecies.map((s) => ({ index: s.index, name: s.name })),
		...(cls.spellcasting?.prepares ? { preparedFormula: `${cls.spellcasting.ability.toUpperCase()} modifier + ${cls.spellcasting.type === "half" ? "half " : ""}${cls.name} level (min 1)` } : {}),
	};
}

// ─── inventory helpers ─────────────────────────────────────────────────────

const INV_CATEGORY: Record<string, string> = {
	weapon: "weapon", armor: "armor", shield: "shield", ammunition: "ammunition", tool: "tool", pack: "gear", focus: "gear", gear: "gear", mount: "mount", vehicle: "vehicle",
};

/** Builds an InventoryItem from an SRD equipment index. */
export function itemFromEquipment(ref: string, qty = 1, id: string = nanoid(8)): InventoryItem {
	const eq = getEquipment(ref);
	if (!eq) return { id, name: ref, quantity: qty, category: "gear" };
	const perItemWeight = eq.weight !== undefined ? Math.round((eq.weight / (eq.bundle ?? 1)) * 1000) / 1000 : undefined;
	const item: InventoryItem = {
		id,
		ref: eq.index,
		name: eq.name,
		quantity: qty,
		category: INV_CATEGORY[eq.category] ?? "gear",
		...(perItemWeight !== undefined ? { weight: perItemWeight } : {}),
		...(eq.description ? { description: eq.description } : {}),
	};
	if (eq.weapon) {
		const range = eq.weapon.ranged ? eq.weapon.range : eq.weapon.throwRange;
		item.weapon = {
			damage: eq.weapon.damage,
			damageType: eq.weapon.damageType,
			properties: eq.weapon.properties,
			...(range ? { range } : {}),
			...(eq.weapon.versatile ? { versatile: eq.weapon.versatile } : {}),
		};
	}
	if (eq.armor) {
		const t = eq.armor.type;
		item.armor = {
			baseAc: eq.armor.baseAc,
			type: t,
			...(t === "heavy" ? { dexCap: 0 } : t === "medium" ? { dexCap: eq.armor.dexCap ?? 2 } : {}),
			...(eq.armor.stealthDisadvantage ? { stealthDisadvantage: true } : {}),
			...(eq.armor.strMin ? { strMin: eq.armor.strMin } : {}),
		};
	}
	return item;
}

/** Adds items (expanding packs into their contents and stacking duplicates). */
export function addItems(inv: InventoryItem[], grants: { ref: string; qty: number }[]): InventoryItem[] {
	const out = [...inv];
	const push = (ref: string, qty: number) => {
		const eq = getEquipment(ref);
		if (eq?.contents?.length) {
			for (const c of eq.contents) for (let i = 0; i < qty; i++) push(c.ref, c.qty);
			return;
		}
		const existing = out.find((i) => i.ref === ref && !i.equipped);
		if (existing) existing.quantity += qty;
		else out.push(itemFromEquipment(ref, qty));
	};
	for (const g of grants) push(g.ref, g.qty);
	return out;
}

/** Equips the best armor/shield the character is proficient with, and up to two weapons. */
export function autoEquip(c: Character): InventoryItem[] {
	const inv = c.inventory.map((i) => ({ ...i }));
	const prof = (t: string) => c.armorProf.includes(t);
	const armors = inv.filter((i) => i.armor && i.armor.type !== "shield" && prof(i.armor.type));
	const monkOrBarb = c.features.some((f) => f.id === "monk-unarmored-defense");
	if (armors.length && !monkOrBarb) {
		const best = armors.sort((a, b) => b.armor!.baseAc - a.armor!.baseAc)[0];
		best.equipped = true;
	}
	const weapons = inv.filter((i) => i.weapon);
	weapons.slice(0, 2).forEach((w) => (w.equipped = true));
	const shield = inv.find((i) => i.armor?.type === "shield");
	const twoHanded = weapons.slice(0, 1).some((w) => w.weapon!.properties.includes("two-handed"));
	if (shield && prof("shields") && !twoHanded && !monkOrBarb) shield.equipped = true;
	return inv;
}

// ─── portrait ──────────────────────────────────────────────────────────────

const SKIN = ["porcelain", "fair", "light", "olive", "tan", "brown", "dark", "ebony"];
const SKIN_EXOTIC: Record<string, string[]> = {
	tiefling: ["crimson", "violet", "ashen", "tan"],
	dragonborn: ["brass", "bronze", "copper", "gold", "red", "silver", "blue", "green", "black", "white"],
	"half-orc": ["grey-green", "olive", "grey", "tan"],
};
const HAIR_STYLES = ["short", "long", "braided", "ponytail", "bald", "mohawk", "curly", "topknot", "shaved_sides", "wild"];
const HAIR_COLORS = ["black", "brown", "auburn", "blonde", "red", "grey", "white", "silver"];
const EYES = ["brown", "blue", "green", "grey", "hazel", "amber", "violet", "gold"];
const BG = ["slate", "forest", "crimson", "midnight", "sand", "plum", "teal", "ochre"];

function hashString(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

/** Deterministic procedural portrait from a seed and species. */
export function defaultPortrait(seed: number, speciesId: string): PortraitSpec {
	const rng = new Rng(seed);
	const sp = getSpecies(speciesId);
	const features = [...(sp?.portraitFeatures ?? [])];
	const facial = speciesId === "dwarf" ? "full_beard" : rng.next() < 0.3 && !["elf", "dragonborn"].includes(speciesId) ? rng.pick(["stubble", "beard", "mustache", "goatee"]) : undefined;
	return {
		seed,
		skinTone: rng.pick(SKIN_EXOTIC[speciesId] ?? SKIN),
		hairStyle: speciesId === "dragonborn" ? "bald" : rng.pick(HAIR_STYLES),
		hairColor: rng.pick(HAIR_COLORS),
		eyeColor: rng.pick(EYES),
		...(facial ? { facialHair: facial } : {}),
		features,
		background: rng.pick(BG),
	};
}

// ─── createCharacter ───────────────────────────────────────────────────────

export interface CreateCharacterInput {
	id?: string;
	name: string;
	speciesId: string;
	subspeciesId?: string;
	classId: string;
	/** Subclass (if the class gets it at or below the starting level). */
	subclassId?: string;
	backgroundId: string;
	abilities: AbilityInput;
	/** Choice id → picked option indices (see `creationOptions`). */
	choices?: Choices;
	/** One entry per `creationOptions().equipment` item: option index + category picks. */
	equipment?: { option: number; picks?: string[] }[];
	/** Starting level 1–20. Levels above 1 use average HP. */
	level?: number;
	/** Choices for levels 2..N, keyed by level (same ids as `levelUpOptions`). */
	levelChoices?: Record<number, Choices>;
	/** HP method for levels after the first (default "average"). */
	hpMethod?: HpMethod;
	rng?: Rng;
	alignment?: string;
	personality?: Character["personality"];
	portrait?: PortraitSpec;
	/** Throw on any missing choice instead of auto-filling. */
	strict?: boolean;
	/**
	 * Content set (from the campaign's world preset). "zombie" requires an
	 * origin as species and gives the profession kit with no gold. Defaults to
	 * the species' own ruleset, i.e. fantasy for every SRD species.
	 */
	ruleset?: Ruleset;
}

export function blankCharacter(id: string, speciesId: string): Character {
	const sp = getSpecies(speciesId);
	return {
		id,
		name: "",
		speciesId,
		backgroundId: "",
		classes: [],
		xp: 0,
		abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
		maxHp: 0,
		hp: 0,
		tempHp: 0,
		hitDice: [],
		speed: sp?.speed ?? 30,
		size: sp?.size ?? "medium",
		savingThrows: [],
		skills: [],
		expertise: [],
		languages: [],
		tools: [],
		armorProf: [],
		weaponProf: [],
		inventory: [],
		currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
		features: [],
		conditions: [],
		exhaustion: 0,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		portrait: defaultPortrait(0, speciesId),
	};
}

export interface CreateResult {
	character: Character;
	/** Choices that were auto-filled (choice id → picks), for showing the player. */
	autoChoices: Choices;
}

/**
 * Builds a complete Character. Missing choices are auto-filled (see
 * `autoChoices` in the result) unless `strict` is set.
 */
export function createCharacterDetailed(input: CreateCharacterInput): CreateResult {
	const level = input.level ?? 1;
	if (!Number.isInteger(level) || level < 1 || level > 20) throw new RulesError("Starting level must be 1–20");
	if (!input.name.trim()) throw new RulesError("Name is required");
	const opts = creationOptions(input.classId, input.speciesId, input.backgroundId, input.subspeciesId, input.ruleset);
	const zombie = opts.ruleset === "zombie";
	const { cls, sp, bg, sub } = lookupAll(input.classId, input.speciesId, input.backgroundId, input.subspeciesId);
	if (!sub && sp.subspecies.length > 1) throw new RulesError(`Choose a subspecies of ${sp.name}`);
	const choices: Choices = { ...(input.choices ?? {}) };
	if (input.subclassId) {
		if (!cls.subclasses.includes(input.subclassId)) throw new RulesError(`${input.subclassId} is not a ${cls.name} subclass`);
		choices.subclass ??= [input.subclassId];
	}
	const auto: Choices = {};
	const take = (id: string, kind: "spell" | "plain" = "plain", avoid: string[] = []): string[] => {
		const ch = opts.choices.find((x) => x.id === id);
		if (!ch) return [];
		if (!choices[id]) {
			if (input.strict && ch.choose > 0) throw new RulesError(`Missing choice "${ch.label}" (${id})`);
			const v = autoPick(ch.options, ch.choose, kind, avoid);
			auto[id] = v;
			return v;
		}
		return resolveChoice(ch, choices, { kind });
	};

	const id = input.id ?? nanoid(10);
	const c = blankCharacter(id, sp.index);
	if (zombie) c.ruleset = "zombie";
	c.name = input.name.trim();
	if (sub) c.subspeciesId = sub.index;
	c.backgroundId = bg.index;
	if (input.alignment) c.alignment = input.alignment;
	if (input.personality) c.personality = input.personality;
	c.portrait = input.portrait ?? defaultPortrait(hashString(`${id}:${c.name}`), sp.index);

	// Abilities.
	const base = validateAbilities(input.abilities);
	const abilities = { ...base };
	for (const [a, v] of Object.entries(opts.abilityBonuses) as [Ability, number][]) abilities[a] += v;
	const abChoice = opts.choices.find((x) => x.id.endsWith(":ability_bonus"));
	if (abChoice) {
		const picks = choices[abChoice.id] ? resolveChoice(abChoice, choices) : (auto[abChoice.id] = assignByPriorityPicks(abChoice, cls, abChoice.choose));
		for (const p of picks) abilities[p as Ability] += 1;
	}
	c.abilities = abilities;

	// Species & subspecies.
	const speciesTraits = [...sp.traits.map((t) => ({ t, src: `species:${sp.index}` })), ...(sub?.traits ?? []).map((t) => ({ t, src: `species:${sub!.index}` }))];
	c.features = speciesTraits.map(({ t, src }): Feature => ({ id: t.index, name: t.name, source: src, description: t.description }));
	c.languages = [...sp.languages];
	c.skills = [...opts.grantedSkills];
	c.weaponProf = [...sp.weapons, ...(sub?.weapons ?? [])];
	c.tools = [...sp.tools, ...(sub?.tools ?? []), ...bg.tools];
	for (const ch of opts.choices) {
		if (!ch.id.startsWith(`${sp.index}:`) && !(sub && ch.id.startsWith(`${sub.index}:`))) continue;
		if (ch.id.endsWith(":ability_bonus")) continue;
		const picks = take(ch.id);
		if (ch.id.endsWith(":skills")) c.skills.push(...picks);
		else if (ch.id.endsWith(":languages")) c.languages.push(...picks);
		else if (ch.id.endsWith(":tools")) c.tools.push(...picks);
		else if (ch.id.endsWith(":cantrip")) {
			c.spellcasting ??= { classes: [], slots: Array(9).fill(0), slotsUsed: Array(9).fill(0) };
			c.spellcasting.classes.push({ classId: sub?.index ?? sp.index, ability: sub?.index === "high-elf" ? "int" : "cha", known: [], prepared: [], cantrips: picks });
		} else {
			// Sub-trait such as draconic ancestry → add the chosen trait as a feature.
			for (const p of picks) {
				const name = ch.options.find((o) => o.index === p)?.name ?? p;
				c.features.push({ id: p, name, source: `species:${sp.index}`, description: `${ch.label}: ${name}.` });
			}
		}
	}
	if (sp.index === "tiefling") {
		c.spellcasting ??= { classes: [], slots: Array(9).fill(0), slotsUsed: Array(9).fill(0) };
		c.spellcasting.classes.push({ classId: "tiefling", ability: "cha", known: [], prepared: [], cantrips: ["thaumaturgy"] });
	}

	// Background.
	c.features.push({ id: toIndex(bg.feature.name), name: bg.feature.name, source: `background:${bg.index}`, description: bg.feature.description });
	c.languages.push(...take("background:languages", "plain", c.languages));
	for (const tc of bg.toolChoices) c.tools.push(...take(tc.id));
	c.currency.gp = opts.startingGold;

	// Class level-1 skills/tools (level-1 features are applied by applyClassLevel).
	c.skills.push(...take("class:skills"));
	for (const oc of cls.otherChoices) c.tools.push(...take(oc.id));
	c.skills = [...new Set(c.skills)];
	c.tools = [...new Set(c.tools)];
	c.languages = [...new Set(c.languages)];

	// Equipment.
	let grants: { ref: string; qty: number }[] = zombie ? opts.kit.map((k) => ({ ref: k.ref, qty: k.qty })) : [...cls.startingEquipment, ...bg.equipment];
	opts.equipment.forEach((ec, i) => {
		const sel = input.equipment?.[i] ?? { option: 0 };
		const opt = ec.options[sel.option];
		if (!opt) throw new RulesError(`Equipment "${ec.desc}": option ${sel.option} doesn't exist`);
		if (!input.equipment?.[i]) auto[`equipment:${i}`] = [String(sel.option)];
		grants.push(...opt.items.map((x) => ({ ref: x.ref, qty: x.qty })));
		const picks = [...(sel.picks ?? [])];
		for (const p of opt.picks) {
			const chosen = picks.splice(0, p.choose);
			const prefer = ["longsword", "rapier", "warhammer", "battleaxe", "mace", "shortsword", "spear", "lute", "holy-symbol", "amulet", "crystal", "wooden-staff"];
			while (chosen.length < p.choose) {
				if (input.strict) throw new RulesError(`Equipment "${ec.desc}": pick ${p.choose} from ${p.label}`);
				const pref = prefer.find((x) => p.options.some((o) => o.index === x)) ?? p.options[0]?.index;
				if (!pref) break;
				chosen.push(pref);
			}
			for (const ch of chosen) {
				if (!p.options.some((o) => o.index === ch)) throw new RulesError(`Equipment: "${ch}" is not one of ${p.label}`);
				grants.push({ ref: ch, qty: 1 });
			}
		}
	});
	grants = grants.filter((g) => g.qty > 0);
	c.inventory = addItems([], grants);

	// Class level 1 (subclass/feature/spell choices use the same ids as level-up).
	const r1 = applyClassLevel(c, cls.index, choices, { strict: input.strict });
	Object.assign(auto, r1.autoChoices);
	let ch = r1.character;
	for (let lvl = 2; lvl <= level; lvl++) {
		const lc = { ...(input.levelChoices?.[lvl] ?? {}) };
		if (input.subclassId && lvl === cls.subclassLevel) lc.subclass ??= [input.subclassId];
		const r = applyClassLevel(ch, cls.index, lc, { hp: input.hpMethod ?? "average", rng: input.rng, strict: input.strict });
		for (const [k, v] of Object.entries(r.autoChoices)) auto[`L${lvl}:${k}`] = v;
		ch = r.character;
	}
	ch.xp = xpForLevel(level);
	ch.hp = ch.maxHp;
	ch.inventory = autoEquip(ch);
	return { character: ch, autoChoices: auto };
}

export function createCharacter(input: CreateCharacterInput): Character {
	return createCharacterDetailed(input).character;
}

function assignByPriorityPicks(choice: OptionChoice, cls: ClassData, n: number): string[] {
	const order = [...cls.primaryAbility, "con", "dex", "wis", "str", "int"];
	return order.filter((a) => choice.options.some((o) => o.index === a)).slice(0, n);
}

/** Quick list of the SRD subclasses available for a class (for UI). */
export function subclassOptions(classId: string): Ref[] {
	return (getClass(classId)?.subclasses ?? []).map((s) => ({ index: s, name: getSubclass(s)?.name ?? s }));
}

/** Cantrip/spell lists for a class at a spell level (UI helper). */
export function classSpellRefs(classId: string, level: number, ruleset: Ruleset = "fantasy"): Ref[] {
	return spellsForClass(classId, { level, ruleset }).map((s) => ({ index: s.index, name: s.name }));
}
