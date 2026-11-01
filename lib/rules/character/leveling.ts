/**
 * Level-up (incl. multiclassing). `applyClassLevel` is the single code path
 * used both by character creation (levels 1..N) and by `levelUp`.
 *
 * Choices are a generic `Record<choiceId, string[]>`; `levelUpOptions` lists
 * every choice point with its id, count and options. Any choice left out is
 * filled with a sensible default, unless `strict` is set.
 */
import type { Ability, Character, Feature } from "../../game/types";
import { ABILITIES } from "../../game/types";
import { abilityMod, roll, type Rng } from "../dice";
import {
	FEATS, FEATURES, SKILLS, SPELLS, getClass, getFeat, getFeature, getSubclass, spellsForClass,
} from "../../srd/index";
import type { ClassData, FeatureData, OptionChoice, Ref } from "../../srd/types";
import { alwaysPreparedSpells, classLevelOf, preparedLimit, totalLevel } from "./derived";
import { refreshFeatureUses, RulesError } from "./resources";
import { computeSlots, maxSpellLevelFor } from "./slots";
import { featureGroup, levelForXp, SKILL_IDS } from "./tables";

export type Choices = Record<string, string[]>;
export type HpMethod = "average" | "roll" | "max";

function clone<T>(x: T): T {
	return structuredClone(x);
}

// ─── spell preference (for auto-picks) ─────────────────────────────────────

const POPULAR = [
	"fire-bolt", "eldritch-blast", "sacred-flame", "vicious-mockery", "produce-flame", "shillelagh", "ray-of-frost",
	"guidance", "light", "mage-hand", "prestidigitation", "thaumaturgy", "spare-the-dying",
	"magic-missile", "shield", "mage-armor", "sleep", "thunderwave", "burning-hands", "cure-wounds", "healing-word",
	"bless", "guiding-bolt", "hunters-mark", "hex", "faerie-fire", "entangle", "detect-magic", "charm-person",
	"misty-step", "scorching-ray", "hold-person", "spiritual-weapon", "lesser-restoration", "invisibility", "web",
	"fireball", "counterspell", "lightning-bolt", "haste", "revivify", "spirit-guardians", "dispel-magic", "fly",
	"polymorph", "greater-invisibility", "banishment", "wall-of-fire", "cone-of-cold", "mass-cure-wounds",
];
function spellScore(index: string): number {
	const s = SPELLS.find((x) => x.index === index);
	if (!s) return 0;
	const pop = POPULAR.indexOf(index);
	return (pop >= 0 ? 100 - pop : 0) + (s.damage ? 6 : 0) + (s.heal ? 5 : 0) + (s.attack ? 2 : 0) + (s.save ? 1 : 0) + s.level;
}
export function autoPick(options: Ref[], n: number, kind: "spell" | "plain" = "plain", avoid: string[] = []): string[] {
	const pool = options.filter((o) => !avoid.includes(o.index));
	const sorted = kind === "spell" ? [...pool].sort((a, b) => spellScore(b.index) - spellScore(a.index)) : pool;
	return sorted.slice(0, n).map((o) => o.index);
}

/** Auto-prepare: round-robin over spell levels (highest first), best-scored spell per level. */
export function autoPrepare(pool: string[], n: number, avoid: string[] = []): string[] {
	const byLevel = new Map<number, string[]>();
	for (const id of pool) {
		if (avoid.includes(id)) continue;
		const lvl = SPELLS.find((s) => s.index === id)?.level ?? 1;
		byLevel.set(lvl, [...(byLevel.get(lvl) ?? []), id]);
	}
	const queues = [...byLevel.entries()].sort((a, b) => b[0] - a[0]).map(([, ids]) => ids.sort((a, b) => spellScore(b) - spellScore(a)));
	const out: string[] = [];
	while (out.length < n && queues.some((q) => q.length)) {
		for (const q of queues) {
			const next = q.shift();
			if (next && out.length < n) out.push(next);
		}
	}
	return out;
}

// ─── validation helpers ────────────────────────────────────────────────────

/** Validates a choice; returns the picked indices (auto-filled if missing). */
export function resolveChoice(
	choice: OptionChoice,
	choices: Choices,
	opts: { strict?: boolean; kind?: "spell" | "plain"; avoid?: string[]; allowRepeat?: boolean } = {},
): string[] {
	const picked = choices[choice.id];
	if (!picked) {
		if (opts.strict && choice.choose > 0) throw new RulesError(`Missing choice "${choice.label}" (${choice.id})`);
		return autoPick(choice.options, choice.choose, opts.kind, opts.avoid);
	}
	if (picked.length !== choice.choose) throw new RulesError(`${choice.label}: choose exactly ${choice.choose} (got ${picked.length})`);
	const valid = new Set(choice.options.map((o) => o.index));
	for (const p of picked) if (!valid.has(p)) throw new RulesError(`${choice.label}: "${p}" is not a valid option`);
	if (!opts.allowRepeat && new Set(picked).size !== picked.length) throw new RulesError(`${choice.label}: duplicate picks`);
	return picked;
}

const refsOf = (ids: string[], nameOf: (id: string) => string = (x) => x): Ref[] => ids.map((i) => ({ index: i, name: nameOf(i) }));
const skillName = (id: string) => SKILLS.find((s) => s.index === id)?.name ?? id;
const spellName = (id: string) => SPELLS.find((s) => s.index === id)?.name ?? id;

// ─── multiclassing ─────────────────────────────────────────────────────────

function meetsPrereqs(cls: ClassData, c: Pick<Character, "abilities">): boolean {
	const p = cls.multiclass.prerequisites;
	if (!p.length) return true;
	const ok = p.map((x) => c.abilities[x.ability] >= x.min);
	return cls.multiclass.any ? ok.some(Boolean) : ok.every(Boolean);
}

/** Multiclassing requires the prerequisites of the new class AND every current class. */
export function canMulticlass(c: Character, classId: string): { ok: boolean; reasons: string[] } {
	const target = getClass(classId);
	if (!target) return { ok: false, reasons: [`Unknown class ${classId}`] };
	if (c.classes.some((x) => x.classId === classId)) return { ok: true, reasons: [] };
	const reasons: string[] = [];
	for (const cid of [classId, ...c.classes.map((x) => x.classId)]) {
		const cls = getClass(cid)!;
		if (!meetsPrereqs(cls, c)) {
			const req = cls.multiclass.prerequisites.map((p) => `${p.ability.toUpperCase()} ${p.min}`).join(cls.multiclass.any ? " or " : " and ");
			reasons.push(`${cls.name} requires ${req}`);
		}
	}
	return { ok: reasons.length === 0, reasons };
}

// ─── level-up options ──────────────────────────────────────────────────────

export interface LevelUpOptions {
	classId: string;
	newClassLevel: number;
	newTotalLevel: number;
	isNewClass: boolean;
	multiclass: { ok: boolean; reasons: string[] };
	hitDie: number;
	/** HP gained with the average method (incl. CON and per-level bonuses). */
	averageHp: number;
	features: FeatureData[];
	choices: OptionChoice[];
	/** Max spell level learnable in this class after the level. */
	maxSpellLevel: number;
	asi: boolean;
}

function knownSpellsOf(c: Character, classId: string) {
	return c.spellcasting?.classes.find((x) => x.classId === classId);
}

/** Spells a class may pick from (incl. Fiend expanded list, Magical Secrets). */
function spellOptions(c: Character, classId: string, maxLevel: number, anyClass: boolean): Ref[] {
	const base = anyClass ? SPELLS.filter((s) => s.level >= 1 && s.level <= maxLevel) : spellsForClass(classId, { maxLevel }).filter((s) => s.level >= 1);
	const ids = new Set(base.map((s) => s.index));
	const cl = c.classes.find((x) => x.classId === classId);
	if (classId === "warlock" && cl?.subclassId) {
		for (const s of getSubclass(cl.subclassId)?.spells ?? []) {
			const sp = SPELLS.find((x) => x.index === s.spell);
			if (sp && sp.level <= maxLevel) ids.add(sp.index);
		}
	}
	const known = new Set([...(knownSpellsOf(c, classId)?.known ?? [])]);
	return [...ids].filter((i) => !known.has(i)).map((i) => ({ index: i, name: spellName(i) }));
}

function rowOf(cls: ClassData, level: number) {
	return cls.levels.find((l) => l.level === level);
}

/** Features gained at `level` of the class (and subclass, if chosen/given). */
function featuresAt(cls: ClassData, level: number, subclassId?: string): FeatureData[] {
	const ids = [...(rowOf(cls, level)?.features ?? [])];
	if (subclassId) {
		// The subclass level table misses some features (e.g. Circle of the Land), so merge with the feature list.
		const sub = getSubclass(subclassId);
		for (const f of sub?.features.find((x) => x.level === level)?.features ?? []) ids.push(f);
		for (const f of FEATURES) if (f.subclassId === subclassId && f.level === level && !f.parent) ids.push(f.index);
	}
	return [...new Set(ids)].map((i) => getFeature(i)).filter((f): f is FeatureData => !!f);
}

/** Hit points gained for one level (excluding retroactive CON changes). */
function hpForLevel(c: Character, die: number, method: HpMethod, conMod: number, rng?: Rng, sorcerer = false): { hp: number; rolled?: number } {
	let base: number;
	let rolled: number | undefined;
	if (method === "max") base = die;
	else if (method === "roll") {
		if (!rng) throw new RulesError("Rolling HP needs an Rng");
		rolled = roll(rng, `1d${die}`, { label: `${c.name} rolls hit points`, actor: c.id }).total;
		base = rolled;
	} else base = die / 2 + 1;
	let hp = Math.max(1, base + conMod);
	if (c.features.some((f) => f.id === "dwarven-toughness")) hp += 1;
	if (sorcerer && c.features.some((f) => f.id === "draconic-resilience")) hp += 1;
	return { hp, ...(rolled !== undefined ? { rolled } : {}) };
}

export function levelUpOptions(c: Character, classId: string, choicesSoFar: Choices = {}): LevelUpOptions {
	const cls = getClass(classId);
	if (!cls) throw new RulesError(`Unknown class ${classId}`);
	const cur = c.classes.find((x) => x.classId === classId);
	const newClassLevel = (cur?.level ?? 0) + 1;
	const newTotalLevel = totalLevel(c) + 1;
	const isNewClass = !cur;
	const multiclass = isNewClass && c.classes.length ? canMulticlass(c, classId) : { ok: true, reasons: [] };
	const choices: OptionChoice[] = [];
	let subclassId = cur?.subclassId;
	if (newClassLevel === cls.subclassLevel && !subclassId) {
		choices.push({ id: "subclass", label: cls.subclassFlavor, choose: 1, options: cls.subclasses.map((s) => ({ index: s, name: getSubclass(s)?.name ?? s })) });
		subclassId = choicesSoFar.subclass?.[0] ?? cls.subclasses[0];
	}
	const features = featuresAt(cls, newClassLevel, subclassId);
	const row = rowOf(cls, newClassLevel);
	const asi = !!row?.asi;
	if (asi) {
		choices.push({
			id: "asi",
			label: "Ability Score Improvement: two abilities (repeat one for +2), or a feat as \"feat:<index>\"",
			choose: 2,
			options: [...ABILITIES.map((a) => ({ index: a, name: a.toUpperCase() })), ...FEATS.map((f) => ({ index: `feat:${f.index}`, name: `Feat: ${f.name}` }))],
		});
	}
	if (isNewClass && c.classes.length) {
		if (cls.multiclass.skillChoose) {
			choices.push({ id: "multiclass:skills", label: `${cls.name} multiclass skill`, choose: cls.multiclass.skillChoose, options: refsOf(cls.skillChoice.from.filter((s) => !c.skills.includes(s)), skillName) });
		}
		for (const oc of cls.otherChoices) if (cls.index === "bard") choices.push({ ...oc, id: "multiclass:tools", choose: 1 });
	}
	// Feature choices.
	const prevRow = rowOf(cls, newClassLevel - 1);
	for (const f of features) {
		const fc = f.choice;
		if (!fc) continue;
		let count = fc.choose;
		let options = fc.options;
		if (fc.kind === "invocation") {
			const now = Number(row?.specific.invocations_known ?? 0);
			const before = Number(prevRow?.specific.invocations_known ?? 0);
			count = now - before;
		}
		if (fc.kind === "expertise") options = options.filter((o) => c.skills.includes(o.index) || c.tools.includes(o.index) || (choicesSoFar["class:skills"] ?? []).includes(o.index));
		if (fc.kind === "feature" || fc.kind === "invocation") options = options.filter((o) => !c.features.some((x) => x.id === o.index));
		if (fc.kind === "expertise") options = options.filter((o) => !c.expertise.includes(o.index));
		if (count > 0) choices.push({ id: `feature:${f.index}`, label: f.name, choose: count, options });
	}
	// Invocations gained at levels without the feature itself (5, 7, 9…).
	if (classId === "warlock" && !features.some((f) => f.index === "eldritch-invocations")) {
		const delta = Number(row?.specific.invocations_known ?? 0) - Number(prevRow?.specific.invocations_known ?? 0);
		const inv = getFeature("eldritch-invocations");
		if (delta > 0 && inv?.choice) {
			choices.push({ id: "feature:eldritch-invocations", label: "Eldritch Invocations", choose: delta, options: inv.choice.options.filter((o) => !c.features.some((x) => x.id === o.index)) });
		}
	}
	// Metamagic gained via later metamagic-N features is covered above; Lore bonus proficiencies:
	if (features.some((f) => f.index === "bonus-proficiencies")) {
		choices.push({ id: "lore:skills", label: "Bonus Proficiencies (3 skills)", choose: 3, options: refsOf(SKILL_IDS.filter((s) => !c.skills.includes(s)), skillName) });
	}
	// Spells.
	const sc = cls.spellcasting;
	let maxSpellLevel = 0;
	if (sc && newClassLevel >= sc.startLevel) {
		maxSpellLevel = maxSpellLevelFor(classId, newClassLevel);
		const known = knownSpellsOf(c, classId);
		const prevCantrips = known?.cantrips.length ?? 0;
		let cantripCount = (row?.cantripsKnown ?? 0) - prevCantrips;
		if (features.some((f) => f.index === "bonus-cantrip")) cantripCount += 1;
		if (cantripCount > 0) {
			choices.push({
				id: "cantrips", label: `${cls.name} cantrips`, choose: cantripCount,
				options: spellsForClass(classId, { level: 0 })
					.filter((s) => !(c.spellcasting?.classes ?? []).some((e) => e.cantrips.includes(s.index)))
					.map((s) => ({ index: s.index, name: s.name })),
			});
		}
		const magicalSecrets = features.some((f) => /^magical-secrets-\d$/.test(f.index));
		if (!sc.prepares) {
			// Mystic Arcanum spells (6th+) don't count against warlock spells known.
			const extras = new Set(c.features.filter((f) => f.id.startsWith("additional-magical-secrets:")).map((f) => f.id.split(":")[1]));
			const counted = (known?.known ?? []).filter((s) => !extras.has(s) && (classId !== "warlock" || (SPELLS.find((x) => x.index === s)?.level ?? 0) <= 5)).length;
			const n = (row?.spellsKnown ?? 0) - counted;
			if (n > 0) choices.push({ id: "spells", label: `${cls.name} spells known`, choose: n, options: spellOptions(c, classId, maxSpellLevel, magicalSecrets) });
			if (newClassLevel > sc.startLevel && known?.known.length) {
				choices.push({ id: "replace-spell", label: "Optionally replace one known spell: [old, new]", choose: 0, options: spellOptions(c, classId, maxSpellLevel, false) });
			}
		} else if (classId === "wizard") {
			const n = newClassLevel === 1 ? 6 : 2;
			choices.push({ id: "spells", label: "Spells added to your spellbook", choose: n, options: spellOptions(c, classId, maxSpellLevel, false) });
		}
		if (features.some((f) => f.index === "additional-magical-secrets")) {
			choices.push({ id: "magical-secrets", label: "Additional Magical Secrets (any class)", choose: 2, options: spellOptions(c, classId, maxSpellLevel, true) });
		}
		if (classId === "warlock") {
			const arc = features.find((f) => /^mystic-arcanum-(\d)th-level$/.test(f.index));
			if (arc) {
				const lvl = Number(/(\d)th/.exec(arc.index)![1]);
				choices.push({ id: "arcanum", label: `Mystic Arcanum (${lvl}th level)`, choose: 1, options: spellsForClass("warlock", { level: lvl }).map((s) => ({ index: s.index, name: s.name })) });
			}
		}
	}
	const conMod = abilityMod(c.abilities.con);
	const avg = hpForLevel(c, cls.hitDie, newTotalLevel === 1 ? "max" : "average", conMod, undefined, classId === "sorcerer").hp;
	return { classId, newClassLevel, newTotalLevel, isNewClass, multiclass, hitDie: cls.hitDie, averageHp: avg, features, choices, maxSpellLevel, asi };
}

// ─── applying a level ──────────────────────────────────────────────────────

export interface ApplyLevelOptions {
	hp?: HpMethod;
	rng?: Rng;
	strict?: boolean;
	/** Skip multiclass prerequisite checks (DM override). */
	ignorePrereqs?: boolean;
}

export interface LevelUpResult {
	character: Character;
	hpGained: number;
	hpRolled?: number;
	newFeatures: Feature[];
	/** Choices that were auto-filled because none were given. */
	autoChoices: Choices;
}

function addFeature(c: Character, f: Feature): Feature[] {
	const g = featureGroup(f.id);
	const out = c.features.filter((x) => x.id !== f.id && !(g && featureGroup(x.id) === g));
	const prev = c.features.find((x) => x.id === f.id || (g && featureGroup(x.id) === g));
	out.push(prev?.uses ? { ...f, uses: prev.uses } : f);
	return out;
}
function featureFromData(f: FeatureData, source: string): Feature {
	return { id: f.index, name: f.name, source, description: f.description };
}

function applyAsi(c: Character, picks: string[]): { abilities: Partial<Record<Ability, number>>; feat?: string } {
	const feat = picks.find((p) => p.startsWith("feat:"));
	if (feat) {
		const fd = getFeat(feat.slice(5));
		if (!fd) throw new RulesError(`Unknown feat ${feat}`);
		for (const p of fd.prerequisites) if (c.abilities[p.ability] < p.min) throw new RulesError(`${fd.name} requires ${p.ability.toUpperCase()} ${p.min}`);
		return { abilities: {}, feat: fd.index };
	}
	const inc: Partial<Record<Ability, number>> = {};
	for (const p of picks) {
		if (!(ABILITIES as string[]).includes(p)) throw new RulesError(`ASI: "${p}" is not an ability`);
		inc[p as Ability] = (inc[p as Ability] ?? 0) + 1;
	}
	for (const [a, n] of Object.entries(inc) as [Ability, number][]) {
		if (c.abilities[a] + n > 20) throw new RulesError(`ASI would raise ${a.toUpperCase()} above 20`);
	}
	return { abilities: inc };
}

function defaultAsi(c: Character, cls: ClassData): string[] {
	const order: Ability[] = [...cls.primaryAbility, "con", "dex", "wis", "str", "cha", "int"];
	const picks: string[] = [];
	const tmp = { ...c.abilities };
	for (const a of order) {
		while (picks.length < 2 && tmp[a] < 20) {
			picks.push(a);
			tmp[a] += 1;
		}
		if (picks.length === 2) break;
	}
	return picks.length === 2 ? picks : ["feat:grappler"];
}

/**
 * Adds one level of `classId` to the character. Handles the first level of
 * the first class (creation) and multiclass entry.
 */
export function applyClassLevel(c0: Character, classId: string, choices: Choices = {}, opts: ApplyLevelOptions = {}): LevelUpResult {
	const cls = getClass(classId);
	if (!cls) throw new RulesError(`Unknown class ${classId}`);
	if (totalLevel(c0) >= 20) throw new RulesError("Already level 20");
	const options = levelUpOptions(c0, classId, choices);
	if (options.isNewClass && c0.classes.length && !options.multiclass.ok && !opts.ignorePrereqs) {
		throw new RulesError(`Can't multiclass into ${cls.name}: ${options.multiclass.reasons.join("; ")}`);
	}
	const c = clone(c0);
	const conBefore = abilityMod(c0.abilities.con);
	const auto: Choices = {};
	const pick = (id: string, kind: "spell" | "plain" = "plain", allowRepeat = false, avoid: string[] = []): string[] => {
		const ch = options.choices.find((x) => x.id === id);
		if (!ch) return [];
		if (!choices[id]) {
			if (opts.strict && ch.choose > 0) throw new RulesError(`Missing choice "${ch.label}" (${ch.id})`);
			const v = id === "asi" ? defaultAsi(c, cls) : autoPick(ch.options, ch.choose, kind, avoid);
			auto[id] = v;
			return v;
		}
		const v = resolveChoice(ch, choices, { allowRepeat, kind });
		const dup = v.find((x) => avoid.includes(x));
		if (dup) throw new RulesError(`${ch.label}: "${dup}" was already chosen`);
		return v;
	};
	const firstLevel = c.classes.length === 0;

	// Class entry / multiclass proficiencies.
	let entry = c.classes.find((x) => x.classId === classId);
	if (!entry) {
		entry = { classId, level: 0 };
		c.classes.push(entry);
		if (firstLevel) {
			c.savingThrows = [...new Set([...c.savingThrows, ...cls.savingThrows])];
			c.armorProf = [...new Set([...c.armorProf, ...cls.armor])];
			c.weaponProf = [...new Set([...c.weaponProf, ...cls.weapons])];
			c.tools = [...new Set([...c.tools, ...cls.tools])];
		} else {
			c.armorProf = [...new Set([...c.armorProf, ...cls.multiclass.armor])];
			c.weaponProf = [...new Set([...c.weaponProf, ...cls.multiclass.weapons])];
			c.tools = [...new Set([...c.tools, ...cls.multiclass.tools])];
			c.skills = [...new Set([...c.skills, ...pick("multiclass:skills")])];
			c.tools = [...new Set([...c.tools, ...pick("multiclass:tools")])];
		}
	}
	entry.level += 1;
	const lvl = entry.level;

	// Subclass.
	if (options.choices.some((x) => x.id === "subclass")) {
		const s = pick("subclass")[0];
		if (s) entry.subclassId = s;
	}
	const sourceTag = `class:${classId}`;
	const newFeatures: Feature[] = [];
	for (const f of featuresAt(cls, lvl, entry.subclassId)) {
		const feat = featureFromData(f, f.subclassId ? `subclass:${f.subclassId}` : sourceTag);
		c.features = addFeature(c, feat);
		newFeatures.push(feat);
		// Special grants.
		if (f.index === "bonus-proficiency") c.armorProf = [...new Set([...c.armorProf, "heavy"])];
		if (f.index === "dragon-ancestor" && !c.languages.includes("draconic")) c.languages.push("draconic");
		if (f.index === "druidic" && !c.languages.includes("druidic")) c.languages.push("druidic");
		if (f.index === "thieves-cant" && !c.languages.includes("thieves-cant")) c.languages.push("thieves-cant");
		if (f.index === "diamond-soul") c.savingThrows = [...ABILITIES];
		if (f.index === "slippery-mind" && !c.savingThrows.includes("wis")) c.savingThrows.push("wis");
		if (f.index === "primal-champion") {
			c.abilities.str = Math.min(24, c.abilities.str + 4);
			c.abilities.con = Math.min(24, c.abilities.con + 4);
		}
	}
	// Feature choices.
	for (const ch of options.choices.filter((x) => x.id.startsWith("feature:"))) {
		const fIndex = ch.id.slice(8);
		const fd = getFeature(fIndex);
		const picks = pick(ch.id);
		if (!fd?.choice) continue;
		for (const p of picks) {
			if (fd.choice.kind === "expertise") {
				if (!c.expertise.includes(p)) c.expertise.push(p);
			} else if (fd.choice.kind === "string") {
				const name = ch.options.find((o) => o.index === p)?.name ?? p;
				const f: Feature = { id: `${fIndex}:${p}`, name: `${fd.name.replace(/\s*\(.*\)$/, "")}: ${name}`, source: sourceTag, description: `Chosen: ${name}.` };
				c.features.push(f);
				newFeatures.push(f);
			} else {
				const sub = getFeature(p);
				const name = ch.options.find((o) => o.index === p)?.name ?? p;
				const f: Feature = sub ? featureFromData(sub, sourceTag) : { id: p, name, source: sourceTag, description: name };
				c.features = addFeature(c, f);
				newFeatures.push(f);
			}
		}
	}
	if (options.choices.some((x) => x.id === "lore:skills")) c.skills = [...new Set([...c.skills, ...pick("lore:skills")])];

	// ASI / feat (before HP so a CON increase counts for this level).
	if (options.asi) {
		const r = applyAsi(c, pick("asi", "plain", true));
		for (const [a, n] of Object.entries(r.abilities) as [Ability, number][]) c.abilities[a] += n;
		if (r.feat) {
			const fd = getFeat(r.feat)!;
			const f: Feature = { id: `feat:${fd.index}`, name: fd.name, source: `feat:${fd.index}`, description: fd.description };
			c.features.push(f);
			newFeatures.push(f);
		}
	}
	const conAfter = abilityMod(c.abilities.con);

	// Hit points & hit dice.
	const method: HpMethod = firstLevel ? "max" : (opts.hp ?? "average");
	const prevLevels = totalLevel(c) - 1;
	const gained = hpForLevel(c, cls.hitDie, method, conAfter, opts.rng, classId === "sorcerer");
	let hpGained = gained.hp + (conAfter - conBefore) * prevLevels;
	// Draconic Resilience gained after level 1 of sorcerer is retroactive (not possible: it's a 1st-level feature).
	c.maxHp += hpGained;
	c.hp = Math.max(0, c.hp + hpGained);
	if (firstLevel) c.hp = c.maxHp;
	const hd = c.hitDice.find((h) => h.die === cls.hitDie);
	if (hd) hd.total += 1;
	else c.hitDice.push({ die: cls.hitDie, total: 1, used: 0 });
	hpGained = Math.max(hpGained, 0);

	// Spellcasting.
	const sc = cls.spellcasting;
	if (sc && lvl >= sc.startLevel) {
		c.spellcasting ??= { classes: [], slots: Array(9).fill(0), slotsUsed: Array(9).fill(0) };
		let sEntry = c.spellcasting.classes.find((x) => x.classId === classId);
		if (!sEntry) {
			sEntry = { classId, ability: sc.ability, known: [], prepared: [], cantrips: [] };
			c.spellcasting.classes.push(sEntry);
		}
		sEntry.cantrips.push(...pick("cantrips", "spell"));
		const newSpells = pick("spells", "spell");
		sEntry.known.push(...newSpells);
		const rep = choices["replace-spell"];
		if (rep?.length === 2 && !sc.prepares) {
			const [oldS, newS] = rep;
			if (!sEntry.known.includes(oldS)) throw new RulesError(`Can't replace ${oldS}: not known`);
			const ch = options.choices.find((x) => x.id === "replace-spell");
			if (!ch?.options.some((o) => o.index === newS)) throw new RulesError(`Can't learn ${newS} as a replacement`);
			sEntry.known = sEntry.known.map((s) => (s === oldS ? newS : s));
		}
		for (const sp of pick("magical-secrets", "spell", false, sEntry.known)) {
			sEntry.known.push(sp);
			c.features.push({ id: `additional-magical-secrets:${sp}`, name: `Magical Secret: ${spellName(sp)}`, source: "subclass:lore", description: `${spellName(sp)} counts as a bard spell and doesn't count against spells known.` });
		}
		const arc = pick("arcanum", "spell");
		if (arc.length) {
			sEntry.known.push(...arc);
			const lvlA = SPELLS.find((s) => s.index === arc[0])?.level ?? 6;
			const f: Feature = { id: `mystic-arcanum-${lvlA}th-level`, name: `Mystic Arcanum (${spellName(arc[0])})`, source: sourceTag, description: `Cast ${spellName(arc[0])} once without a spell slot; regain after a long rest.`, uses: { max: 1, used: 0, recharge: "long" } };
			c.features = addFeature(c, f);
		}
		if (!sc.prepares) sEntry.prepared = [...sEntry.known];
		else {
			const always = alwaysPreparedSpells(c, classId);
			const limit = preparedLimit(c, classId) ?? 0;
			const maxL = maxSpellLevelFor(classId, lvl);
			const pool = classId === "wizard" ? sEntry.known : spellsForClass(classId, { maxLevel: maxL }).filter((s) => s.level >= 1).map((s) => s.index);
			let chosen: string[];
			if (choices.prepared) {
				chosen = choices.prepared.filter((s) => !always.includes(s));
				for (const s of chosen) if (!pool.includes(s)) throw new RulesError(`Can't prepare ${s}`);
				if (chosen.length > limit) throw new RulesError(`Can prepare at most ${limit} spells`);
			} else {
				chosen = sEntry.prepared.filter((s) => !always.includes(s) && pool.includes(s));
				const extra = autoPrepare(pool, limit - chosen.length, [...chosen, ...always]);
				chosen = [...chosen, ...extra].slice(0, limit);
				if (extra.length) auto.prepared = [...chosen];
			}
			sEntry.prepared = [...new Set([...always, ...chosen])];
		}
	}
	if (c.spellcasting) {
		const slots = computeSlots(c.classes);
		c.spellcasting.slots = slots.slots;
		c.spellcasting.slotsUsed = slots.slots.map((max, i) => Math.min(max, c.spellcasting!.slotsUsed[i] ?? 0));
		if (slots.pact) c.spellcasting.pact = { ...slots.pact, used: Math.min(slots.pact.max, c.spellcasting.pact?.used ?? 0) };
	}
	const out = refreshFeatureUses(c);
	return { character: out, hpGained, ...(gained.rolled !== undefined ? { hpRolled: gained.rolled } : {}), newFeatures, autoChoices: auto };
}

/**
 * Level up in `classId` (existing class or a multiclass). Requires enough XP
 * unless `ignoreXp` is set (milestone leveling).
 */
export function levelUp(c: Character, classId: string, choices: Choices = {}, opts: ApplyLevelOptions & { ignoreXp?: boolean } = {}): LevelUpResult {
	if (!opts.ignoreXp && levelForXp(c.xp) <= totalLevel(c)) {
		throw new RulesError(`${c.name} needs more XP to reach level ${totalLevel(c) + 1}`);
	}
	return applyClassLevel(c, classId, choices, opts);
}

/** Can the character level up now (by XP)? */
export function canLevelUp(c: Character): boolean {
	return totalLevel(c) < 20 && levelForXp(c.xp) > totalLevel(c);
}

/** Ability modifiers changed outside leveling (e.g. a magic item) — adjust max HP for CON. */
export function adjustHpForConChange(c: Character, oldCon: number): Character {
	const delta = (abilityMod(c.abilities.con) - abilityMod(oldCon)) * totalLevel(c);
	if (!delta) return c;
	const next = clone(c);
	next.maxHp += delta;
	next.hp = Math.min(next.maxHp, Math.max(0, next.hp + delta));
	return next;
}

export { classLevelOf };
