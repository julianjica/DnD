/**
 * Typed SRD 5.1 lookups. Data is imported statically (no fs) so this module
 * works on the server and in the browser.
 */
import type { ConditionId, MonsterStats, SpellInfo } from "../game/types";
import type {
	BackgroundData, ClassData, EquipmentData, FeatData, FeatureData, LanguageData, MagicItemData, SimpleEntry,
	SkillData, SpeciesData, SubclassData, SubspeciesData,
} from "./types";

import speciesJson from "./data/species.json";
import classesJson from "./data/classes.json";
import subclassesJson from "./data/subclasses.json";
import featuresJson from "./data/features.json";
import backgroundsJson from "./data/backgrounds.json";
import featsJson from "./data/feats.json";
import skillsJson from "./data/skills.json";
import languagesJson from "./data/languages.json";
import conditionsJson from "./data/conditions.json";
import damageTypesJson from "./data/damage-types.json";
import weaponPropertiesJson from "./data/weapon-properties.json";
import magicSchoolsJson from "./data/magic-schools.json";
import equipmentJson from "./data/equipment.json";
import magicItemsJson from "./data/magic-items.json";
import spellsJson from "./data/spells.json";
import monstersJson from "./data/monsters.json";
// Original subclasses written for DungeonHarness to fill the SRD's one-per-class gap.
import hb_barbarian from "./data/homebrew/barbarian.json";
import hb_bard from "./data/homebrew/bard.json";
import hb_cleric from "./data/homebrew/cleric.json";
import hb_druid from "./data/homebrew/druid.json";
import hb_fighter from "./data/homebrew/fighter.json";
import hb_monk from "./data/homebrew/monk.json";
import hb_paladin from "./data/homebrew/paladin.json";
import hb_ranger from "./data/homebrew/ranger.json";
import hb_rogue from "./data/homebrew/rogue.json";
import hb_sorcerer from "./data/homebrew/sorcerer.json";
import hb_warlock from "./data/homebrew/warlock.json";
import hb_wizard from "./data/homebrew/wizard.json";
// The Quiet (zombie ruleset, docs/zombie.md): original content, marked ruleset: "zombie".
import zTechniques from "./data/zombie/techniques.json";
import zEquipment from "./data/zombie/equipment.json";
import zMonsters from "./data/zombie/monsters.json";
import zOrigins from "./data/zombie/origins.json";

export * from "./types";

function HOMEBREW_SUBCLASS_IDS(classId: string): string[] {
	const raw = [hb_barbarian, hb_bard, hb_cleric, hb_druid, hb_fighter, hb_monk, hb_paladin, hb_ranger, hb_rogue, hb_sorcerer, hb_warlock, hb_wizard] as unknown as { subclasses: { index: string; classId: string }[] }[];
	return raw.flatMap((h) => h.subclasses).filter((s) => s.classId === classId).map((s) => s.index);
}

// Casting through unknown keeps tsc from inferring huge literal types.
const zTag = <T,>(list: unknown) => (list as T[]).map((x) => ({ ...x, ruleset: "zombie" as const }));
export const SPECIES = [...(speciesJson as unknown as SpeciesData[]), ...zTag<SpeciesData>(zOrigins)];
export const CLASSES = (classesJson as unknown as ClassData[]).map((c) => ({
	...c,
	// Offer the homebrew subclasses alongside the SRD one.
	subclasses: [...c.subclasses, ...HOMEBREW_SUBCLASS_IDS(c.index)],
}));
type HomebrewFile = { subclasses: SubclassData[]; features: FeatureData[] };
const HOMEBREW = [hb_barbarian, hb_bard, hb_cleric, hb_druid, hb_fighter, hb_monk, hb_paladin, hb_ranger, hb_rogue, hb_sorcerer, hb_warlock, hb_wizard] as unknown as HomebrewFile[];
export const SUBCLASSES = [...(subclassesJson as unknown as SubclassData[]), ...HOMEBREW.flatMap((h) => h.subclasses.map((s) => ({ ...s, homebrew: true })))];
export const FEATURES = [...(featuresJson as unknown as FeatureData[]), ...HOMEBREW.flatMap((h) => h.features)];
export const BACKGROUNDS = backgroundsJson as unknown as BackgroundData[];
export const FEATS = featsJson as unknown as FeatData[];
export const SKILLS = skillsJson as unknown as SkillData[];
export const LANGUAGES = languagesJson as unknown as LanguageData[];
export const CONDITIONS = conditionsJson as unknown as SimpleEntry[];
export const DAMAGE_TYPES = damageTypesJson as unknown as SimpleEntry[];
export const WEAPON_PROPERTIES = weaponPropertiesJson as unknown as SimpleEntry[];
export const MAGIC_SCHOOLS = magicSchoolsJson as unknown as SimpleEntry[];
export const EQUIPMENT = [...(equipmentJson as unknown as EquipmentData[]), ...zTag<EquipmentData>(zEquipment)];
export const MAGIC_ITEMS = magicItemsJson as unknown as MagicItemData[];
export const SPELLS = [...(spellsJson as unknown as SpellInfo[]), ...zTag<SpellInfo>(zTechniques)];
export const MONSTERS = [...(monstersJson as unknown as MonsterStats[]), ...zTag<MonsterStats>(zMonsters)];

function indexBy<T extends { index: string }>(list: T[]): Map<string, T> {
	return new Map(list.map((x) => [x.index, x]));
}
const byIndex = {
	species: indexBy(SPECIES),
	subspecies: indexBy(SPECIES.flatMap((s) => s.subspecies)),
	classes: indexBy(CLASSES),
	subclasses: indexBy(SUBCLASSES),
	features: indexBy(FEATURES),
	backgrounds: indexBy(BACKGROUNDS),
	feats: indexBy(FEATS),
	skills: indexBy(SKILLS),
	languages: indexBy(LANGUAGES),
	conditions: indexBy(CONDITIONS),
	equipment: indexBy(EQUIPMENT),
	magicItems: indexBy(MAGIC_ITEMS),
	spells: indexBy(SPELLS),
	monsters: indexBy(MONSTERS),
};

/** Normalizes user/AI input to an SRD index: "Fire Bolt" → "fire-bolt". */
export function toIndex(s: string): string {
	return s
		.toLowerCase()
		.replace(/[’']/g, "")
		.replace(/[^a-z0-9+]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
function get<T>(map: Map<string, T>, key: string): T | undefined {
	return map.get(key) ?? map.get(toIndex(key));
}

export const getMonster = (index: string): MonsterStats | undefined => get(byIndex.monsters, index);
export const getSpell = (index: string): SpellInfo | undefined => get(byIndex.spells, index);
export const getClass = (index: string): ClassData | undefined => get(byIndex.classes, index);
export const getSubclass = (index: string): SubclassData | undefined => get(byIndex.subclasses, index);
export const getSpecies = (index: string): SpeciesData | undefined => get(byIndex.species, index);
export const getSubspecies = (index: string): SubspeciesData | undefined => get(byIndex.subspecies, index);
export const getBackground = (index: string): BackgroundData | undefined => get(byIndex.backgrounds, index);
export const getFeat = (index: string): FeatData | undefined => get(byIndex.feats, index);
export const getFeature = (index: string): FeatureData | undefined => get(byIndex.features, index);
export const getSkill = (index: string): SkillData | undefined => get(byIndex.skills, index);
export const getLanguage = (index: string): LanguageData | undefined => get(byIndex.languages, index);
export const getEquipment = (index: string): EquipmentData | undefined => get(byIndex.equipment, index);
export const getMagicItem = (index: string): MagicItemData | undefined => get(byIndex.magicItems, index);
export function getCondition(index: ConditionId | "exhaustion" | string): SimpleEntry | undefined {
	return get(byIndex.conditions, index);
}

/** Class level row (1..20) for a class. */
export function classLevel(classId: string, level: number) {
	return getClass(classId)?.levels.find((l) => l.level === level);
}

export interface MonsterQuery {
	name?: string;
	/** Matches the start of the type, e.g. "undead", "humanoid". */
	type?: string;
	minCr?: number;
	maxCr?: number;
	size?: MonsterStats["size"];
	tokenHint?: string;
	limit?: number;
}

export function searchMonsters(q: MonsterQuery = {}): MonsterStats[] {
	const name = q.name?.toLowerCase();
	const type = q.type?.toLowerCase();
	const out = MONSTERS.filter(
		(m) =>
			(!name || m.name.toLowerCase().includes(name)) &&
			(!type || m.type.toLowerCase().startsWith(type)) &&
			(q.minCr === undefined || m.cr >= q.minCr) &&
			(q.maxCr === undefined || m.cr <= q.maxCr) &&
			(!q.size || m.size === q.size) &&
			(!q.tokenHint || m.tokenHint === q.tokenHint),
	).sort((a, b) => a.cr - b.cr || a.name.localeCompare(b.name));
	return q.limit ? out.slice(0, q.limit) : out;
}

/**
 * Spells on a class's list. `maxLevel` limits by spell level (0 = cantrips
 * only); pass `level` instead to get only one spell level.
 */
export function spellsForClass(classId: string, opts: { maxLevel?: number; level?: number } = {}): SpellInfo[] {
	return SPELLS.filter(
		(s) =>
			s.classes.includes(classId) &&
			(opts.level === undefined || s.level === opts.level) &&
			(opts.maxLevel === undefined || s.level <= opts.maxLevel),
	).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

export function featuresOf(classId: string, subclassId?: string): FeatureData[] {
	return FEATURES.filter((f) => f.classId === classId && (!f.subclassId || f.subclassId === subclassId));
}

// ─── fuzzy lookup for the DM tool ──────────────────────────────────────────

export type LookupCategory =
	| "monster" | "spell" | "class" | "subclass" | "species" | "subspecies" | "background" | "feat" | "feature"
	| "condition" | "equipment" | "magic-item" | "skill" | "language" | "damage-type" | "weapon-property";

export interface LookupHit {
	category: LookupCategory;
	index: string;
	name: string;
	score: number;
	/** Short text summary suitable for the DM. */
	summary: string;
}

const crText = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));
const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
function clip(s: string, n: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function summarizeMonster(m: MonsterStats, long = false): string {
	const speed = Object.entries(m.speed)
		.filter(([k]) => k !== "hover")
		.map(([k, v]) => (k === "walk" ? `${v} ft` : `${k} ${v} ft`))
		.join(", ");
	const ab = (Object.entries(m.abilities) as [string, number][]).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(" ");
	const actions = m.actions
		.map((a) => {
			if (a.attack) return `${a.name} (${sign(a.attack.toHit)}, ${a.attack.damage.map((d) => `${d.dice} ${d.type}`).join(" + ")})`;
			if (a.save) return `${a.name} (DC ${a.save.dc} ${a.save.ability.toUpperCase()}${a.save.damage ? `, ${a.save.damage.map((d) => `${d.dice} ${d.type}`).join(" + ")}` : ""}${a.usage?.type === "recharge" ? `, recharge ${a.usage.minRoll}-6` : ""})`;
			return a.name;
		})
		.join("; ");
	let s = `${m.name} — ${m.size} ${m.type}, CR ${crText(m.cr)} (${m.xp} XP). AC ${m.ac}, HP ${m.hp} (${m.hitDice}), speed ${speed}. ${ab}. Actions: ${actions}.`;
	if (m.resistances.length) s += ` Resist: ${m.resistances.join(", ")}.`;
	if (m.immunities.length) s += ` Immune: ${m.immunities.join(", ")}.`;
	if (m.vulnerabilities.length) s += ` Vulnerable: ${m.vulnerabilities.join(", ")}.`;
	if (long) {
		if (m.traits.length) s += `\nTraits: ${m.traits.map((t) => `${t.name}: ${clip(t.description, 300)}`).join(" | ")}`;
		s += `\nActions detail: ${m.actions.map((a) => `${a.name}: ${clip(a.description, 300)}`).join(" | ")}`;
		if (m.legendaryActions.length) s += `\nLegendary: ${m.legendaryActions.map((a) => `${a.name}: ${clip(a.description, 200)}`).join(" | ")}`;
		if (m.reactions.length) s += `\nReactions: ${m.reactions.map((a) => `${a.name}: ${clip(a.description, 200)}`).join(" | ")}`;
	}
	return s;
}

export function summarizeSpell(s: SpellInfo, long = false): string {
	const lvl = s.level === 0 ? `${s.school} cantrip` : `${ordinal(s.level)}-level ${s.school}`;
	const tags = [s.concentration ? "concentration" : "", s.ritual ? "ritual" : ""].filter(Boolean).join(", ");
	const head = `${s.name} — ${lvl}${tags ? ` (${tags})` : ""}. ${s.castingTime}, range ${s.range}, ${s.components.join("/")}, ${s.duration}. Classes: ${s.classes.join(", ")}.`;
	return `${head} ${clip(s.description, long ? 1500 : 350)}${long && s.higherLevel ? ` At higher levels: ${s.higherLevel}` : ""}`;
}

interface Entry {
	category: LookupCategory;
	index: string;
	name: string;
	summary: (long: boolean) => string;
}

let entries: Entry[] | undefined;
function allEntries(): Entry[] {
	if (entries) return entries;
	const e: Entry[] = [];
	for (const m of MONSTERS) e.push({ category: "monster", index: m.index, name: m.name, summary: (l) => summarizeMonster(m, l) });
	for (const s of SPELLS) e.push({ category: "spell", index: s.index, name: s.name, summary: (l) => summarizeSpell(s, l) });
	for (const c of CLASSES)
		e.push({
			category: "class", index: c.index, name: c.name,
			summary: () => `${c.name} — hit die d${c.hitDie}, saves ${c.savingThrows.join("/").toUpperCase()}, armor: ${c.armor.join(", ") || "none"}, weapons: ${c.weapons.join(", ")}. Skills: choose ${c.skillChoice.choose} from ${c.skillChoice.from.join(", ")}.${c.spellcasting ? ` Spellcasting (${c.spellcasting.ability.toUpperCase()}, ${c.spellcasting.type}).` : ""} ${c.subclassFlavor} at level ${c.subclassLevel}: ${c.subclasses.join(", ")}.`,
		});
	for (const s of SUBCLASSES)
		e.push({ category: "subclass", index: s.index, name: s.name, summary: (l) => `${s.name} (${s.classId} ${s.flavor}) — ${clip(s.description, l ? 1200 : 300)} Features at levels ${s.features.map((f) => f.level).join(", ")}.` });
	for (const s of SPECIES) {
		e.push({ category: "species", index: s.index, name: s.name, summary: (l) => `${s.name} — ${s.size}, speed ${s.speed} ft., ability bonuses ${Object.entries(s.abilityBonuses).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(", ") || "choice"}. Traits: ${s.traits.map((t) => (l ? `${t.name}: ${clip(t.description, 200)}` : t.name)).join(l ? " | " : ", ")}. Languages: ${s.languages.join(", ")}.${s.subspecies.length ? ` Subspecies: ${s.subspecies.map((x) => x.name).join(", ")}.` : ""}` });
		for (const sub of s.subspecies)
			e.push({ category: "subspecies", index: sub.index, name: sub.name, summary: () => `${sub.name} (${s.name}) — ${clip(sub.description, 200)} Bonuses ${Object.entries(sub.abilityBonuses).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(", ")}. Traits: ${sub.traits.map((t) => `${t.name}: ${clip(t.description, 160)}`).join(" | ")}` });
	}
	for (const b of BACKGROUNDS)
		e.push({ category: "background", index: b.index, name: b.name, summary: () => `${b.name} background — skills ${b.skills.join(", ")}${b.tools.length ? `, tools ${b.tools.join(", ")}` : ""}${b.languageChoose ? `, ${b.languageChoose} languages` : ""}. Feature: ${b.feature.name}: ${clip(b.feature.description, 250)}` });
	for (const f of FEATS) e.push({ category: "feat", index: f.index, name: f.name, summary: () => `${f.name} (feat) — ${clip(f.description, 400)}` });
	for (const f of FEATURES)
		e.push({ category: "feature", index: f.index, name: f.name, summary: (l) => `${f.name} (${f.classId}${f.subclassId ? `/${f.subclassId}` : ""} ${f.level}) — ${clip(f.description, l ? 1500 : 350)}` });
	for (const c of CONDITIONS) e.push({ category: "condition", index: c.index, name: c.name, summary: () => `${c.name} (condition) — ${clip(c.description, 700)}` });
	for (const q of EQUIPMENT)
		e.push({
			category: "equipment", index: q.index, name: q.name,
			summary: () => {
				const parts = [`${q.name} (${q.subcategory ? `${q.subcategory} ` : ""}${q.category}) — ${q.cost.qty} ${q.cost.unit}${q.weight ? `, ${q.weight} lb` : ""}`];
				if (q.weapon) parts.push(`${q.weapon.damage} ${q.weapon.damageType}${q.weapon.versatile ? ` (versatile ${q.weapon.versatile})` : ""}${q.weapon.properties.length ? `, ${q.weapon.properties.join(", ")}` : ""}${q.weapon.range ? `, range ${q.weapon.range.normal}/${q.weapon.range.long}` : ""}${q.weapon.throwRange ? `, thrown ${q.weapon.throwRange.normal}/${q.weapon.throwRange.long}` : ""}`);
				if (q.armor) parts.push(q.armor.type === "shield" ? `+${q.armor.baseAc} AC` : `AC ${q.armor.baseAc}${q.armor.dex ? (q.armor.dexCap ? ` + DEX (max ${q.armor.dexCap})` : " + DEX") : ""}${q.armor.strMin ? `, STR ${q.armor.strMin}` : ""}${q.armor.stealthDisadvantage ? ", stealth disadvantage" : ""}`);
				if (q.contents) parts.push(`contains ${q.contents.map((c) => `${c.qty} ${c.ref}`).join(", ")}`);
				if (q.description) parts.push(clip(q.description, 250));
				return parts.join("; ");
			},
		});
	for (const m of MAGIC_ITEMS)
		e.push({ category: "magic-item", index: m.index, name: m.name, summary: (l) => `${m.name} (${m.rarity}${m.attunement ? ", requires attunement" : ""}) — ${clip(m.description, l ? 1500 : 400)}` });
	for (const s of SKILLS) e.push({ category: "skill", index: s.index, name: s.name, summary: () => `${s.name} (${s.ability.toUpperCase()} skill) — ${clip(s.description, 300)}` });
	for (const l of LANGUAGES) e.push({ category: "language", index: l.index, name: l.name, summary: () => `${l.name} (${l.type} language, script ${l.script ?? "—"}), spoken by ${l.speakers.join(", ")}.` });
	for (const d of DAMAGE_TYPES) e.push({ category: "damage-type", index: d.index, name: d.name, summary: () => `${d.name} damage — ${clip(d.description, 250)}` });
	for (const w of WEAPON_PROPERTIES) e.push({ category: "weapon-property", index: w.index, name: w.name, summary: () => `${w.name} (weapon property) — ${clip(w.description, 400)}` });
	entries = e;
	return e;
}

function tokens(s: string): string[] {
	return toIndex(s).split("-").filter(Boolean);
}

/** Levenshtein distance capped for short strings. */
function editDistance(a: string, b: string): number {
	if (Math.abs(a.length - b.length) > 3) return 99;
	const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = dp[0];
		dp[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = dp[j];
			dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = tmp;
		}
	}
	return dp[b.length];
}

function score(query: string, qTokens: string[], e: Entry): number {
	const idx = e.index;
	if (idx === query) return 100;
	const nameIdx = toIndex(e.name);
	if (nameIdx === query) return 95;
	const flat = query.replace(/-/g, "");
	if (nameIdx.replace(/-/g, "") === flat || idx.replace(/-/g, "") === flat) return 90;
	if (idx.startsWith(query) || nameIdx.startsWith(query)) return 80 - Math.min(20, idx.length - query.length);
	const nTokens = tokens(e.name);
	let hits = 0;
	for (const t of qTokens) {
		if (nTokens.includes(t)) hits += 1;
		else if (nTokens.some((n) => n.startsWith(t) && t.length >= 3)) hits += 0.7;
		else if (t.length >= 4 && nTokens.some((n) => editDistance(n, t) <= (t.length >= 7 ? 2 : 1))) hits += 0.6;
	}
	if (!hits) return 0;
	const coverage = hits / qTokens.length;
	const precision = hits / nTokens.length;
	return 40 * coverage + 20 * precision;
}

const CATEGORY_ALIASES: Record<string, LookupCategory> = {
	monster: "monster", creature: "monster", spell: "spell", class: "class", subclass: "subclass", race: "species",
	species: "species", background: "background", feat: "feat", feature: "feature", condition: "condition",
	item: "equipment", equipment: "equipment", weapon: "equipment", armor: "equipment", "magic-item": "magic-item",
	magic: "magic-item", skill: "skill", language: "language",
};

/**
 * Fuzzy lookup across all SRD categories. Accepts an optional "category:"
 * prefix ("spell: fireball", "monster:goblin"). Returns best hits first.
 */
export function lookup(query: string, opts: { limit?: number; category?: LookupCategory; long?: boolean } = {}): LookupHit[] {
	let q = query.trim();
	let category = opts.category;
	const m = /^([a-z- ]+):\s*(.+)$/i.exec(q);
	if (m && CATEGORY_ALIASES[toIndex(m[1])]) {
		category = CATEGORY_ALIASES[toIndex(m[1])];
		q = m[2];
	}
	const qi = toIndex(q);
	if (!qi) return [];
	const qt = tokens(q);
	const hits: LookupHit[] = [];
	for (const e of allEntries()) {
		if (category && e.category !== category) continue;
		const s = score(qi, qt, e);
		if (s > 15) hits.push({ category: e.category, index: e.index, name: e.name, score: s, summary: "" });
	}
	// Prefer rules-relevant categories on ties.
	const pri: Partial<Record<LookupCategory, number>> = { spell: 3, monster: 3, condition: 3, equipment: 2, "magic-item": 2, class: 2, species: 2, feature: 1 };
	hits.sort((a, b) => b.score - a.score || (pri[b.category] ?? 0) - (pri[a.category] ?? 0) || a.name.localeCompare(b.name));
	const top = hits.slice(0, opts.limit ?? 5);
	const all = allEntries();
	for (const h of top) {
		const e = all.find((x) => x.category === h.category && x.index === h.index)!;
		h.summary = e.summary(opts.long ?? top.indexOf(h) === 0);
	}
	return top;
}

/** Convenience: the lookup results as one text block (for the `lookup_srd` tool). */
export function lookupText(query: string, limit = 3): string {
	const hits = lookup(query, { limit });
	if (!hits.length) return `No SRD entry matches "${query}".`;
	return hits.map((h) => `[${h.category}] ${h.summary}`).join("\n\n");
}
