/**
 * SRD 5.1 importer.
 *
 * Downloads (or reuses) the 5e-bits/5e-database JSON for the 2014 SRD
 * (https://github.com/5e-bits/5e-database, src/2014/en, CC-BY-4.0 content)
 * into scripts/srd/raw/ and converts it into compact JSON under lib/srd/data/.
 *
 *   npx tsx scripts/srd/import.ts            # download missing files + convert
 *   npx tsx scripts/srd/import.ts --refresh  # re-download everything
 *
 * The raw directory is git-ignored (scripts/srd/.gitignore).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	Ability, AttackAction, ConditionId, DamageType, MonsterAction, MonsterStats, Size, SpellInfo,
} from "../../lib/game/types";
import type {
	BackgroundData, ClassData, ClassLevelRow, EquipmentChoice, EquipmentData, EquipmentGrant, FeatData,
	FeatureData, LanguageData, MagicItemData, OptionChoice, Ref, SimpleEntry, SkillData, SpeciesData,
	SubclassData, SubspeciesData, TraitData,
} from "../../lib/srd/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const RAW = join(HERE, "raw");
const OUT = join(ROOT, "lib", "srd", "data");
const BASE = "https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2014/en/";

const FILES = [
	"Ability-Scores", "Backgrounds", "Classes", "Conditions", "Damage-Types", "Equipment",
	"Equipment-Categories", "Feats", "Features", "Languages", "Levels", "Magic-Items", "Magic-Schools",
	"Monsters", "Proficiencies", "Races", "Skills", "Spells", "Subclasses", "Subraces", "Traits",
	"Weapon-Properties",
] as const;
type RawName = (typeof FILES)[number];

// Raw JSON is untyped; we read it through this loose shape and narrow as we go.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

async function ensureRaw(refresh: boolean): Promise<void> {
	mkdirSync(RAW, { recursive: true });
	for (const f of FILES) {
		const path = join(RAW, `5e-SRD-${f}.json`);
		if (!refresh && existsSync(path)) continue;
		const res = await fetch(`${BASE}5e-SRD-${f}.json`);
		if (!res.ok) throw new Error(`Download failed for ${f}: ${res.status}`);
		writeFileSync(path, await res.text());
		console.log(`downloaded ${f}`);
	}
}

const cache = new Map<RawName, Raw[]>();
function raw(name: RawName): Raw[] {
	let v = cache.get(name);
	if (!v) {
		v = JSON.parse(readFileSync(join(RAW, `5e-SRD-${name}.json`), "utf8")) as Raw[];
		cache.set(name, v);
	}
	return v;
}

// ─── helpers ────────────────────────────────────────────────────────────────

const ABILITY_SET = new Set<string>(["str", "dex", "con", "int", "wis", "cha"]);
const DAMAGE_SET = new Set<string>([
	"acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison",
	"psychic", "radiant", "slashing", "thunder",
]);
const CONDITION_SET = new Set<string>([
	"blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed",
	"petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
]);
const ABILITY_NAMES: Record<string, Ability> = {
	strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha",
};

function ability(x: string): Ability {
	const v = x.toLowerCase();
	if (ABILITY_SET.has(v)) return v as Ability;
	const n = ABILITY_NAMES[v];
	if (!n) throw new Error(`Unknown ability ${x}`);
	return n;
}
function damageType(x: string | undefined): DamageType | undefined {
	const v = x?.toLowerCase();
	return v && DAMAGE_SET.has(v) ? (v as DamageType) : undefined;
}
function text(d: unknown): string {
	if (Array.isArray(d)) return d.join("\n");
	return typeof d === "string" ? d : "";
}
function ref(x: Raw): Ref {
	return { index: x.index, name: x.name };
}
function sizeOf(s: string): Size {
	return s.toLowerCase() as Size;
}
function feet(s: string | undefined): number | undefined {
	if (!s) return undefined;
	const m = /(\d+)/.exec(s);
	return m ? Number(m[1]) : undefined;
}
function costGp(c: Raw): { qty: number; unit: string } {
	return c ? { qty: c.quantity, unit: c.unit } : { qty: 0, unit: "gp" };
}
/** Normalizes a proficiency index into the ids used on Character. */
function normProf(index: string): { kind: "skill" | "save" | "armor" | "weapon" | "tool" | "other"; id: string } {
	if (index.startsWith("skill-")) return { kind: "skill", id: index.slice(6) };
	if (index.startsWith("saving-throw-")) return { kind: "save", id: index.slice(13) };
	const p = raw("Proficiencies").find((x) => x.index === index);
	const type: string = p?.type ?? "";
	if (type === "Armor") {
		if (index === "all-armor") return { kind: "armor", id: "all" };
		if (index === "shields") return { kind: "armor", id: "shields" };
		return { kind: "armor", id: index.replace(/-armor$/, "") };
	}
	if (type === "Weapons") {
		if (index === "simple-weapons") return { kind: "weapon", id: "simple" };
		if (index === "martial-weapons") return { kind: "weapon", id: "martial" };
		return { kind: "weapon", id: p?.reference?.index ?? index };
	}
	if (["Artisan's Tools", "Gaming Sets", "Musical Instruments", "Other", "Vehicles"].includes(type)) {
		return { kind: "tool", id: p?.reference?.index ?? index };
	}
	return { kind: "other", id: index };
}
function expandArmor(ids: string[]): string[] {
	const out = new Set<string>();
	for (const id of ids) {
		if (id === "all") ["light", "medium", "heavy"].forEach((a) => out.add(a));
		else out.add(id);
	}
	return [...out];
}

/** Flattens an options_array of references (possibly nested choices) into refs. */
function optionRefs(from: Raw): Ref[] {
	const out: Ref[] = [];
	if (!from) return out;
	if (from.option_set_type === "options_array") {
		for (const o of from.options as Raw[]) {
			if (typeof o === "string") out.push({ index: o, name: o[0].toUpperCase() + o.slice(1) });
			else if (o.option_type === "reference") out.push(ref(o.item));
			else if (o.option_type === "choice") out.push(...optionRefs(o.choice.from));
			else if (o.option_type === "string") out.push({ index: o.string, name: o.string });
		}
	} else if (from.option_set_type === "equipment_category") {
		const cat = raw("Equipment-Categories").find((c) => c.index === from.equipment_category.index);
		for (const e of cat?.equipment ?? []) out.push(ref(e));
	} else if (from.option_set_type === "resource_list") {
		if (String(from.resource_list_url).endsWith("/languages")) out.push(...raw("Languages").map(ref));
	}
	return out;
}
function profRefsNormalized(refs: Ref[]): Ref[] {
	return refs.map((r) => ({ index: normProf(r.index).id, name: r.name.replace(/^Skill: /, "") }));
}

// ─── equipment ──────────────────────────────────────────────────────────────

function equipment(): EquipmentData[] {
	const PACK_IDS = new Set<string>(raw("Equipment-Categories").find((c) => c.index === "equipment-packs").equipment.map((e: Raw) => e.index));
	return raw("Equipment").map((e): EquipmentData => {
		const cat: string = e.equipment_category.index;
		const gear: string | undefined = e.gear_category?.index;
		let category = "gear";
		let subcategory: string | undefined = gear;
		if (cat === "weapon") {
			category = "weapon";
			subcategory = `${String(e.weapon_category).toLowerCase()}-${String(e.weapon_range).toLowerCase()}`;
		} else if (cat === "armor") {
			category = e.armor_category === "Shield" ? "shield" : "armor";
			subcategory = String(e.armor_category).toLowerCase();
		} else if (cat === "tools") {
			category = "tool";
			subcategory = String(e.tool_category ?? "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, "-");
		} else if (cat === "mounts-and-vehicles") {
			category = e.vehicle_category ? "vehicle" : "mount";
			subcategory = String(e.vehicle_category ?? "").toLowerCase().replace(/\s+/g, "-") || undefined;
		} else if (gear === "ammunition") category = "ammunition";
		else if (PACK_IDS.has(e.index)) category = "pack";
		else if (gear && /foci|holy-symbols/.test(gear)) category = "focus";
		const out: EquipmentData = {
			index: e.index,
			name: e.name,
			category,
			...(subcategory ? { subcategory } : {}),
			cost: costGp(e.cost),
			...(e.weight !== undefined ? { weight: e.weight } : {}),
			...(e.desc?.length ? { description: text(e.desc) } : {}),
			...(e.quantity && e.quantity > 1 ? { bundle: e.quantity } : {}),
		};
		if (cat === "weapon") {
			const dt = damageType(e.damage?.damage_type?.index);
			const props: string[] = (e.properties ?? []).map((p: Raw) => p.index);
			const ranged = e.weapon_range === "Ranged";
			out.weapon = {
				category: e.weapon_category === "Martial" ? "martial" : "simple",
				ranged,
				damage: e.damage?.damage_dice ?? "0",
				damageType: dt ?? "bludgeoning",
				properties: props,
				...(ranged && e.range ? { range: { normal: e.range.normal, ...(e.range.long ? { long: e.range.long } : {}) } } : {}),
				...(e.throw_range ? { throwRange: { normal: e.throw_range.normal, long: e.throw_range.long } } : {}),
				...(e.two_handed_damage ? { versatile: e.two_handed_damage.damage_dice } : {}),
			};
		}
		if (cat === "armor") {
			const t = String(e.armor_category).toLowerCase() as "light" | "medium" | "heavy" | "shield";
			out.armor = {
				type: t,
				baseAc: e.armor_class.base,
				dex: !!e.armor_class.dex_bonus,
				...(e.armor_class.max_bonus ? { dexCap: e.armor_class.max_bonus } : {}),
				...(e.str_minimum ? { strMin: e.str_minimum } : {}),
				stealthDisadvantage: !!e.stealth_disadvantage,
			};
		}
		if (e.contents?.length) out.contents = e.contents.map((c: Raw) => ({ ref: c.item.index, qty: c.quantity }));
		return out;
	});
}

function magicItems(): MagicItemData[] {
	const all = raw("Magic-Items");
	const parentOf = new Map<string, string>();
	for (const m of all) for (const v of m.variants ?? []) parentOf.set(v.index, m.index);
	return all.map((m): MagicItemData => {
		const desc: string[] = m.desc ?? [];
		const head = desc[0] ?? "";
		return {
			index: m.index,
			name: m.name,
			category: m.equipment_category?.index ?? "wondrous-items",
			rarity: m.rarity?.name ?? "Varies",
			attunement: /requires attunement/i.test(head),
			description: text(desc),
			...(m.variants?.length ? { variants: m.variants.map((v: Raw) => v.index) } : {}),
			...(parentOf.has(m.index) ? { variantOf: parentOf.get(m.index) } : {}),
		};
	});
}

// ─── equipment choices (classes, backgrounds) ──────────────────────────────

function grantsOf(o: Raw): EquipmentGrant[] {
	switch (o.option_type) {
		case "counted_reference":
			return [{ ref: o.of.index, qty: o.count }];
		case "multiple":
			return (o.items as Raw[]).flatMap(grantsOf);
		case "choice": {
			const ch = o.choice;
			if (ch.from.option_set_type === "equipment_category") {
				return [{ category: ch.from.equipment_category.index, choose: ch.choose, label: ch.desc ?? ch.from.equipment_category.name }];
			}
			// options_array inside a choice → treat as category-like pick over listed refs
			const refs = optionRefsEquipment(ch.from);
			return [{ category: `list:${refs.join(",")}`, choose: ch.choose, label: ch.desc ?? "choice" }];
		}
		case "reference":
			return [{ ref: o.item.index, qty: 1 }];
		default:
			return [];
	}
}
function optionRefsEquipment(from: Raw): string[] {
	const out: string[] = [];
	for (const o of from.options ?? []) {
		if (o.option_type === "counted_reference") out.push(o.of.index);
		else if (o.option_type === "reference") out.push(o.item.index);
	}
	return out;
}
function grantLabel(g: EquipmentGrant[]): string {
	const eq = raw("Equipment");
	return g
		.map((x) => {
			if ("ref" in x) {
				const n = eq.find((e) => e.index === x.ref)?.name ?? x.ref;
				return x.qty > 1 ? `${x.qty} × ${n}` : n;
			}
			return x.label;
		})
		.join(", ");
}
function equipmentChoices(list: Raw[] | undefined): EquipmentChoice[] {
	const out: EquipmentChoice[] = [];
	for (const c of list ?? []) {
		if (c.from.option_set_type === "equipment_category") {
			const grants: EquipmentGrant[] = [{ category: c.from.equipment_category.index, choose: c.choose, label: c.desc ?? c.from.equipment_category.name }];
			out.push({ desc: c.desc ?? c.from.equipment_category.name, options: [{ label: grantLabel(grants), grants }] });
			continue;
		}
		const options = (c.from.options as Raw[]).map((o) => {
			const grants = grantsOf(o);
			return { label: grantLabel(grants), grants };
		});
		out.push({ desc: c.desc ?? options.map((o) => o.label).join(" or "), options });
	}
	return out;
}

// ─── species ────────────────────────────────────────────────────────────────

function traitData(t: Raw): TraitData {
	return { index: t.index, name: t.name, description: text(t.desc) };
}
const PORTRAIT: Record<string, string[]> = {
	dwarf: ["beard_common", "stocky"],
	elf: ["pointed_ears"],
	halfling: ["small"],
	human: [],
	dragonborn: ["scales", "snout"],
	gnome: ["small", "pointed_ears"],
	"half-elf": ["pointed_ears_small"],
	"half-orc": ["tusks"],
	tiefling: ["horns", "tail"],
};

function traitBundle(traitRefs: Raw[], ownerId: string): {
	traits: TraitData[]; skills: string[]; weapons: string[]; tools: string[]; choices: OptionChoice[];
} {
	const all = raw("Traits");
	const traits: TraitData[] = [];
	const skills: string[] = [];
	const weapons: string[] = [];
	const tools: string[] = [];
	const choices: OptionChoice[] = [];
	for (const r of traitRefs) {
		const t = all.find((x) => x.index === r.index);
		if (!t) continue;
		traits.push(traitData(t));
		for (const p of t.proficiencies ?? []) {
			const n = normProf(p.index);
			if (n.kind === "skill") skills.push(n.id);
			else if (n.kind === "weapon") weapons.push(n.id);
			else if (n.kind === "tool") tools.push(n.id);
		}
		if (t.proficiency_choices) {
			const opts = profRefsNormalized(optionRefs(t.proficiency_choices.from));
			const isSkill = (t.proficiency_choices.from.options as Raw[]).some((o) => String(o.item?.index).startsWith("skill-"));
			choices.push({ id: isSkill ? `${ownerId}:skills` : `${ownerId}:tools`, label: t.name, choose: t.proficiency_choices.choose, options: opts });
		}
		if (t.language_options) {
			choices.push({ id: `${ownerId}:languages`, label: t.name, choose: t.language_options.choose, options: optionRefs(t.language_options.from) });
		}
		const ts = t.trait_specific;
		if (ts?.subtrait_options) {
			choices.push({ id: `${ownerId}:${t.index}`, label: t.name, choose: ts.subtrait_options.choose, options: optionRefs(ts.subtrait_options.from) });
		}
		if (ts?.spell_options) {
			choices.push({ id: `${ownerId}:cantrip`, label: t.name, choose: ts.spell_options.choose, options: optionRefs(ts.spell_options.from) });
		}
	}
	return { traits, skills, weapons, tools, choices };
}

function bonuses(list: Raw[] | undefined): Partial<Record<Ability, number>> {
	const out: Partial<Record<Ability, number>> = {};
	for (const b of list ?? []) out[ability(b.ability_score.index)] = b.bonus;
	return out;
}

function species(): SpeciesData[] {
	const subs = raw("Subraces");
	return raw("Races").map((r): SpeciesData => {
		// Draconic-ancestry sub-traits are reached via the choice; don't list all ten as traits.
		const topTraits = (r.traits as Raw[]).filter((t) => !/^draconic-ancestry-/.test(t.index));
		const b = traitBundle(topTraits, r.index);
		const choices: OptionChoice[] = [...b.choices];
		if (r.ability_bonus_options) {
			const o = r.ability_bonus_options;
			choices.unshift({
				id: `${r.index}:ability_bonus`,
				label: "Ability Score Increase (+1 each)",
				choose: o.choose,
				options: (o.from.options as Raw[]).map((x) => ({ index: x.ability_score.index, name: x.ability_score.name })),
			});
		}
		if (r.language_options) {
			choices.push({ id: `${r.index}:languages`, label: "Extra language", choose: r.language_options.choose, options: optionRefs(r.language_options.from) });
		}
		const dv = (r.traits as Raw[]).some((t) => t.index === "darkvision") ? 60 : 0;
		const subspecies: SubspeciesData[] = (r.subraces as Raw[]).map((sr) => {
			const s = subs.find((x) => x.index === sr.index);
			const sb = traitBundle(s.racial_traits ?? [], s.index);
			return {
				index: s.index,
				name: s.name,
				description: text(s.desc),
				abilityBonuses: bonuses(s.ability_bonuses),
				traits: sb.traits,
				skills: sb.skills,
				weapons: sb.weapons,
				tools: sb.tools,
				choices: sb.choices,
			};
		});
		return {
			index: r.index,
			name: r.name,
			speed: r.speed,
			size: sizeOf(r.size),
			sizeDescription: r.size_description,
			age: r.age,
			alignment: r.alignment,
			abilityBonuses: bonuses(r.ability_bonuses),
			languages: (r.languages as Raw[]).map((l) => l.index),
			languageDescription: r.language_desc,
			traits: b.traits,
			skills: b.skills,
			weapons: b.weapons,
			tools: b.tools,
			choices,
			darkvision: dv,
			subspecies,
			portraitFeatures: PORTRAIT[r.index] ?? [],
		};
	});
}

// ─── classes ────────────────────────────────────────────────────────────────

const CASTER: Record<string, ClassData["spellcasting"] extends infer T ? (T extends { type: infer U } ? U : never) : never> = {
	bard: "full", cleric: "full", druid: "full", sorcerer: "full", wizard: "full",
	paladin: "half", ranger: "half", warlock: "pact",
};
const PREPARES = new Set(["cleric", "druid", "paladin", "wizard"]);
const SUBCLASS_LEVEL: Record<string, number> = {
	barbarian: 3, bard: 3, cleric: 1, druid: 2, fighter: 3, monk: 3, paladin: 3, ranger: 3, rogue: 3, sorcerer: 1, warlock: 1, wizard: 2,
};
const PRIMARY: Record<string, Ability[]> = {
	barbarian: ["str"], bard: ["cha"], cleric: ["wis"], druid: ["wis"], fighter: ["str", "dex"], monk: ["dex", "wis"],
	paladin: ["str", "cha"], ranger: ["dex", "wis"], rogue: ["dex"], sorcerer: ["cha"], warlock: ["cha"], wizard: ["int"],
};
/** Class-level placeholder features that only say "you gain a subclass feature". */
const PLACEHOLDER = /^(primal-path|bard-college|divine-domain|druid-circle|martial-archetype|monastic-tradition|sacred-oath|ranger-archetype|roguish-archetype|sorcerous-origin|otherworldly-patron|arcane-tradition)-improvement-\d+$/;

function flattenSpecific(cs: Raw | undefined): Record<string, number | string> {
	const out: Record<string, number | string> = {};
	for (const [k, v] of Object.entries(cs ?? {})) {
		if (typeof v === "number") out[k] = v;
		else if (typeof v === "boolean") out[k] = v ? 1 : 0;
		else if (v && typeof v === "object" && !Array.isArray(v) && "dice_count" in (v as Raw)) {
			const d = v as Raw;
			out[k] = `${d.dice_count}d${d.dice_value}`;
		}
	}
	return out;
}

function classes(): ClassData[] {
	const levels = raw("Levels");
	return raw("Classes").map((c): ClassData => {
		const profs = (c.proficiencies as Raw[]).map((p) => normProf(p.index));
		const skillPc = (c.proficiency_choices as Raw[]).find((pc) => (pc.from.options as Raw[]).some((o) => String(o.item?.index ?? "").startsWith("skill-")));
		const others = (c.proficiency_choices as Raw[]).filter((pc) => pc !== skillPc);
		const sc = c.spellcasting;
		const rows: ClassLevelRow[] = levels
			.filter((l) => l.class.index === c.index && !l.subclass)
			.sort((a, b) => a.level - b.level)
			.map((l) => {
				const featureIds: string[] = (l.features as Raw[]).map((f) => f.index);
				const asi = featureIds.some((f) => /ability-score-improvement/.test(f));
				const row: ClassLevelRow = {
					level: l.level,
					profBonus: l.prof_bonus,
					features: featureIds.filter((f) => !PLACEHOLDER.test(f) && !/ability-score-improvement/.test(f)),
					asi,
					specific: flattenSpecific(l.class_specific),
				};
				if (l.spellcasting) {
					const s = l.spellcasting;
					if (s.cantrips_known !== undefined) row.cantripsKnown = s.cantrips_known;
					if (s.spells_known !== undefined) row.spellsKnown = s.spells_known;
					row.slots = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => s[`spell_slots_level_${n}`] ?? 0);
				}
				return row;
			});
		const mc = c.multi_classing ?? {};
		let prereqs: { ability: Ability; min: number }[] = [];
		let any = false;
		if (mc.prerequisites) prereqs = (mc.prerequisites as Raw[]).map((p) => ({ ability: ability(p.ability_score.index), min: p.minimum_score }));
		else if (mc.prerequisite_options) {
			any = true;
			prereqs = (mc.prerequisite_options.from.options as Raw[]).map((p) => ({ ability: ability(p.ability_score.index), min: p.minimum_score }));
		}
		const mcProfs = ((mc.proficiencies ?? []) as Raw[]).map((p) => normProf(p.index));
		const mcSkill = ((mc.proficiency_choices ?? []) as Raw[]).find((pc) => pc.type === "proficiencies");
		const infoText = sc ? (sc.info as Raw[]).map((i) => `${i.name}: ${text(i.desc)}`).join("\n") : "";
		return {
			index: c.index,
			name: c.name,
			hitDie: c.hit_die,
			savingThrows: (c.saving_throws as Raw[]).map((s) => ability(s.index)),
			armor: expandArmor(profs.filter((p) => p.kind === "armor").map((p) => p.id)),
			weapons: profs.filter((p) => p.kind === "weapon").map((p) => p.id),
			tools: profs.filter((p) => p.kind === "tool").map((p) => p.id),
			skillChoice: {
				choose: skillPc?.choose ?? 0,
				from: skillPc ? optionRefs(skillPc.from).map((r) => normProf(r.index).id) : [],
			},
			otherChoices: others.map((pc, i) => ({
				id: `${c.index}:tools${i ? `-${i}` : ""}`,
				label: pc.desc ?? "Tool proficiency",
				choose: pc.choose,
				options: profRefsNormalized(optionRefs(pc.from)),
			})),
			startingEquipment: ((c.starting_equipment ?? []) as Raw[]).map((e) => ({ ref: e.equipment.index, qty: e.quantity })),
			equipmentChoices: equipmentChoices(c.starting_equipment_options),
			multiclass: {
				prerequisites: prereqs,
				any,
				armor: expandArmor(mcProfs.filter((p) => p.kind === "armor").map((p) => p.id)),
				weapons: mcProfs.filter((p) => p.kind === "weapon").map((p) => p.id),
				tools: mcProfs.filter((p) => p.kind === "tool").map((p) => p.id),
				skillChoose: mcSkill?.choose ?? 0,
			},
			...(sc
				? {
					spellcasting: {
						ability: ability(sc.spellcasting_ability.index),
						startLevel: sc.level,
						type: CASTER[c.index] ?? "none",
						prepares: PREPARES.has(c.index),
						info: infoText,
					},
				}
				: {}),
			subclassLevel: SUBCLASS_LEVEL[c.index] ?? 3,
			subclassFlavor: raw("Subclasses").find((s) => s.class.index === c.index)?.subclass_flavor ?? "Subclass",
			subclasses: (c.subclasses as Raw[]).map((s) => s.index),
			primaryAbility: PRIMARY[c.index] ?? ["str"],
			levels: rows,
		};
	});
}

function subclasses(): SubclassData[] {
	const levels = raw("Levels");
	return raw("Subclasses").map((s): SubclassData => {
		const lv = levels.filter((l) => l.subclass?.index === s.index).sort((a, b) => a.level - b.level);
		return {
			index: s.index,
			classId: s.class.index,
			name: s.name,
			flavor: s.subclass_flavor,
			description: text(s.desc),
			features: lv.map((l) => ({ level: l.level, features: (l.features as Raw[]).map((f) => f.index) })),
			spells: ((s.spells ?? []) as Raw[]).map((sp) => {
				const lvl = (sp.prerequisites as Raw[]).find((p) => p.type === "level");
				const feat = (sp.prerequisites as Raw[]).find((p) => p.type === "feature");
				return {
					spell: sp.spell.index,
					level: lvl ? Number(String(lvl.index).split("-").pop()) : 1,
					...(feat ? { requires: feat.index } : {}),
				};
			}),
			specific: lv.filter((l) => l.subclass_specific).map((l) => ({ level: l.level, values: Object.fromEntries(Object.entries(l.subclass_specific).filter(([, v]) => typeof v === "number")) as Record<string, number> })),
		};
	});
}

function featuresData(): FeatureData[] {
	return raw("Features").map((f): FeatureData => {
		const fs = f.feature_specific;
		let choice: FeatureData["choice"];
		if (fs?.subfeature_options) choice = { choose: fs.subfeature_options.choose, kind: "feature", options: optionRefs(fs.subfeature_options.from) };
		else if (fs?.expertise_options) {
			// Rogue expertise is "two skills, or one skill and thieves' tools" in the SRD;
			// the source nests it oddly, so flatten to "choose 2 from skills + thieves' tools".
			const opts = profRefsNormalized(optionRefs(fs.expertise_options.from));
			const skillsAll = raw("Skills").map((x) => ({ index: x.index as string, name: x.name as string }));
			const merged = new Map<string, Ref>([...skillsAll, ...opts].map((r) => [r.index, r]));
			if (f.class.index === "rogue") merged.set("thieves-tools", { index: "thieves-tools", name: "Thieves' Tools" });
			choice = { choose: f.class.index === "rogue" ? 2 : fs.expertise_options.choose, kind: "expertise", options: [...merged.values()] };
		}
		else if (fs?.enemy_type_options) choice = { choose: fs.enemy_type_options.choose, kind: "string", options: optionRefs(fs.enemy_type_options.from) };
		else if (fs?.terrain_type_options) choice = { choose: fs.terrain_type_options.choose, kind: "string", options: optionRefs(fs.terrain_type_options.from) };
		else if (fs?.invocations) choice = { choose: 0, kind: "invocation", options: (fs.invocations as Raw[]).map(ref) };
		return {
			index: f.index,
			name: f.name,
			classId: f.class.index,
			...(f.subclass ? { subclassId: f.subclass.index } : {}),
			level: f.level,
			description: text(f.desc),
			...(f.parent ? { parent: f.parent.index } : {}),
			...(choice ? { choice } : {}),
		};
	});
}

// ─── backgrounds & feats ────────────────────────────────────────────────────

function backgrounds(): BackgroundData[] {
	const list: BackgroundData[] = raw("Backgrounds").map((b) => ({
		index: b.index,
		name: b.name,
		skills: (b.starting_proficiencies as Raw[]).map((p) => normProf(p.index)).filter((p) => p.kind === "skill").map((p) => p.id),
		tools: (b.starting_proficiencies as Raw[]).map((p) => normProf(p.index)).filter((p) => p.kind === "tool").map((p) => p.id),
		languageChoose: b.language_options?.choose ?? 0,
		toolChoices: [],
		equipment: ((b.starting_equipment ?? []) as Raw[]).map((e) => ({ ref: e.equipment.index, qty: e.quantity })),
		equipmentChoices: equipmentChoices(b.starting_equipment_options),
		gold: b.starting_gold?.unit === "gp" ? b.starting_gold.quantity : 0,
		feature: { name: b.feature.name, description: text(b.feature.desc) },
		personalityTraits: optionRefs(b.personality_traits?.from).map((r) => r.name),
		ideals: ((b.ideals?.from?.options ?? []) as Raw[]).map((o) => o.desc),
		bonds: optionRefs(b.bonds?.from).map((r) => r.name),
		flaws: optionRefs(b.flaws?.from).map((r) => r.name),
		source: "SRD 5.1",
	}));
	// SRD 5.1 only ships Acolyte. These three backgrounds also appear in SRD 5.2
	// (CC-BY-4.0); they are given here with 2014-style mechanics and original
	// short descriptions so the setup wizard has a few choices.
	const tools = (cat: string): Ref[] => optionRefs({ option_set_type: "equipment_category", equipment_category: { index: cat } });
	list.push(
		{
			index: "criminal", name: "Criminal", skills: ["deception", "stealth"], tools: ["thieves-tools"], languageChoose: 0,
			toolChoices: [{ id: "criminal:tools", label: "One type of gaming set", choose: 1, options: tools("gaming-sets") }],
			equipment: [{ ref: "crowbar", qty: 1 }, { ref: "clothes-common", qty: 1 }, { ref: "pouch", qty: 1 }], equipmentChoices: [], gold: 15,
			feature: { name: "Criminal Contact", description: "You have a reliable contact who acts as your liaison to a network of criminals, and you know how to get messages to and from that contact." },
			personalityTraits: [], ideals: [], bonds: [], flaws: [], source: "SRD 5.2 (adapted)",
		},
		{
			index: "sage", name: "Sage", skills: ["arcana", "history"], tools: [], languageChoose: 2, toolChoices: [],
			equipment: [{ ref: "ink-1-ounce-bottle", qty: 1 }, { ref: "ink-pen", qty: 1 }, { ref: "small-knife", qty: 1 }, { ref: "clothes-common", qty: 1 }, { ref: "pouch", qty: 1 }],
			equipmentChoices: [], gold: 10,
			feature: { name: "Researcher", description: "When you don't know a piece of lore, you usually know where and from whom it can be learned: a library, a scriptorium, a university, or a learned person." },
			personalityTraits: [], ideals: [], bonds: [], flaws: [], source: "SRD 5.2 (adapted)",
		},
		{
			index: "soldier", name: "Soldier", skills: ["athletics", "intimidation"], tools: ["land-vehicles"], languageChoose: 0,
			toolChoices: [{ id: "soldier:tools", label: "One type of gaming set", choose: 1, options: tools("gaming-sets") }],
			equipment: [{ ref: "clothes-common", qty: 1 }, { ref: "pouch", qty: 1 }], equipmentChoices: [], gold: 10,
			feature: { name: "Military Rank", description: "Soldiers loyal to your former military organization still recognize your authority and influence, and you can requisition simple equipment or horses for temporary use." },
			personalityTraits: [], ideals: [], bonds: [], flaws: [], source: "SRD 5.2 (adapted)",
		},
	);
	return list;
}

function feats(): FeatData[] {
	return raw("Feats").map((f) => ({
		index: f.index,
		name: f.name,
		prerequisites: ((f.prerequisites ?? []) as Raw[]).map((p) => ({ ability: ability(p.ability_score.index), min: p.minimum_score })),
		description: text(f.desc).replace(/--/g, "-"),
	}));
}

// ─── spells ─────────────────────────────────────────────────────────────────

function spells(): SpellInfo[] {
	return raw("Spells").map((s): SpellInfo => {
		const dmg = (Array.isArray(s.damage) ? s.damage[0] ?? {} : s.damage ?? {}) as Raw;
		const dt = damageType(dmg.damage_type?.index);
		const out: SpellInfo = {
			index: s.index,
			name: s.name,
			level: s.level,
			school: s.school.index,
			castingTime: s.casting_time,
			range: s.range,
			...(/\d+\s*(feet|foot|mile)/i.test(s.range) && !/^self/i.test(s.range)
				? { rangeFeet: /mile/i.test(s.range) ? Number(/(\d+)/.exec(s.range)?.[1] ?? 1) * 5280 : feet(s.range) }
				: {}),
			components: s.components ?? [],
			...(s.material ? { material: s.material } : {}),
			duration: s.duration,
			concentration: !!s.concentration,
			ritual: !!s.ritual,
			description: text(s.desc),
			...(s.higher_level?.length ? { higherLevel: text(s.higher_level) } : {}),
			classes: (s.classes as Raw[]).map((c) => c.index),
		};
		if (s.attack_type === "melee" || s.attack_type === "ranged") out.attack = s.attack_type;
		if (s.dc?.dc_type) out.save = { ability: ability(s.dc.dc_type.index), halfOnSuccess: s.dc.dc_success === "half" };
		// Spells without a damage type (Sleep's HP pool, Prismatic Spray) stay text-only.
		if (dt) {
			const clean = (r: Record<string, string>): Record<number, string> =>
				Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), String(v).replace(/\s+/g, "")]));
			out.damage = {
				type: dt,
				...(dmg.damage_at_character_level ? { byCharacterLevel: clean(dmg.damage_at_character_level) } : {}),
				...(dmg.damage_at_slot_level ? { bySlotLevel: clean(dmg.damage_at_slot_level) } : {}),
			};
		}
		if (s.heal_at_slot_level) {
			const entries = Object.entries(s.heal_at_slot_level as Record<string, string>);
			out.heal = {
				bySlotLevel: Object.fromEntries(entries.map(([k, v]) => [Number(k), v.replace(/\+\s*MOD/i, "").replace(/\s+/g, "")])),
				addModifier: entries.some(([, v]) => /MOD/i.test(v)),
			};
		}
		if (s.area_of_effect) {
			const t = String(s.area_of_effect.type) as "sphere" | "cone" | "line" | "cube" | "cylinder";
			out.area = { shape: t, size: s.area_of_effect.size };
		}
		return out;
	});
}

// ─── monsters ───────────────────────────────────────────────────────────────

function dmgList(list: Raw[] | undefined): { dice: string; type: DamageType }[] {
	const out: { dice: string; type: DamageType }[] = [];
	for (const d of list ?? []) {
		let entry = d;
		if (d.choose && d.from?.options?.length) entry = d.from.options[0];
		const t = damageType(entry.damage_type?.index);
		if (t && entry.damage_dice) out.push({ dice: String(entry.damage_dice).replace(/\s+/g, ""), type: t });
	}
	return out;
}
const SAVE_RE = /DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/;

function usageOf(u: Raw | undefined): MonsterAction["usage"] {
	if (!u) return undefined;
	if (u.type === "per day") return { type: "per_day", times: u.times ?? 1 };
	if (u.type === "recharge on roll") return { type: "recharge", minRoll: u.min_value };
	if (u.type === "recharge after rest") return { type: "per_day", times: 1 };
	if (u.type === "at will") return { type: "at_will" };
	return undefined;
}

function monsterAction(a: Raw): MonsterAction {
	const desc: string = a.desc ?? "";
	const out: MonsterAction = { name: a.name, description: desc };
	const usage = usageOf(a.usage);
	if (usage) out.usage = usage;
	if (a.multiattack_type === "actions" && a.actions) {
		out.multiattack = (a.actions as Raw[]).map((x) => ({ action: x.action_name, count: Number(x.count) || 1 }));
	} else if (a.multiattack_type === "action_options" && a.action_options) {
		const first = a.action_options.from.options[0];
		const items: Raw[] = first.option_type === "multiple" ? first.items : [first];
		out.multiattack = items.map((x) => ({ action: x.action_name, count: Number(x.count) || 1 }));
	}
	if (a.attack_bonus !== undefined) {
		const kind: AttackAction["kind"] = /Melee or Ranged/i.test(desc) ? "melee_or_ranged" : /Ranged (Weapon|Spell) Attack/i.test(desc) ? "ranged" : "melee";
		const reach = /reach (\d+) ft/.exec(desc);
		const range = /range (\d+)(?:\/(\d+))? ft/.exec(desc);
		const atk: AttackAction = {
			name: a.name,
			kind,
			toHit: a.attack_bonus,
			...(reach ? { reach: Number(reach[1]) } : kind !== "ranged" ? { reach: 5 } : {}),
			...(range ? { range: { normal: Number(range[1]), ...(range[2] ? { long: Number(range[2]) } : {}) } } : {}),
			damage: dmgList(a.damage),
			description: desc,
		};
		const sm = SAVE_RE.exec(desc);
		if (a.dc?.dc_type || sm) {
			const ab = a.dc?.dc_type ? ability(a.dc.dc_type.index) : ability(sm![2]);
			const dc = a.dc?.dc_value ?? Number(sm![1]);
			const sentence = desc.slice(desc.indexOf(sm ? sm[0] : "DC")).split(/(?<=\.)\s/)[0];
			atk.save = { ability: ab, dc, onFail: sentence, halfOnSuccess: /half as much/i.test(desc) };
		}
		out.attack = atk;
	} else if (a.dc?.dc_type) {
		out.save = {
			ability: ability(a.dc.dc_type.index),
			dc: a.dc.dc_value,
			...(a.damage?.length ? { damage: dmgList(a.damage) } : {}),
			halfOnSuccess: a.dc.success_type === "half" || /half as much/i.test(desc),
		};
	} else if (a.options?.from?.options?.length) {
		// Breath weapon choice: structure the first damaging option; the DM reads the rest.
		const opt = (a.options.from.options as Raw[]).find((o) => o.damage?.length && o.dc) ?? a.options.from.options[0];
		if (opt?.dc?.dc_type) {
			out.save = {
				ability: ability(opt.dc.dc_type.index),
				dc: opt.dc.dc_value,
				...(opt.damage?.length ? { damage: dmgList(opt.damage) } : {}),
				halfOnSuccess: opt.dc.success_type === "half",
			};
		}
	} else {
		const sm = SAVE_RE.exec(desc);
		const dmg = a.damage?.length ? dmgList(a.damage) : [];
		if (sm && (dmg.length || /saving throw/.test(desc))) {
			out.save = { ability: ability(sm[2]), dc: Number(sm[1]), ...(dmg.length ? { damage: dmg } : {}), halfOnSuccess: /half as much/i.test(desc) };
		}
	}
	return out;
}

const NAME_HINTS: [RegExp, string][] = [
	[/dragon|wyrmling|dragon turtle/i, "dragon"],
	[/skeleton/i, "skeleton"], [/zombie/i, "zombie"], [/ghoul|ghast/i, "ghoul"], [/vampire/i, "vampire"],
	[/lich/i, "lich"], [/mummy/i, "mummy"], [/ghost|specter|wraith|banshee|shadow|poltergeist|will-o/i, "ghost"],
	[/wight/i, "wight"], [/wolf|worg|jackal|dog|hound|mastiff/i, "wolf"], [/spider/i, "spider"], [/rat\b|rats\b/i, "rat"],
	[/bat\b|bats\b/i, "bat"], [/bear/i, "bear"], [/snake|serpent|python|cobra|viper|naga/i, "snake"],
	[/goblin|hobgoblin|bugbear/i, "goblin"], [/orc\b/i, "orc"], [/kobold/i, "kobold"], [/gnoll/i, "gnoll"],
	[/ogre/i, "ogre"], [/troll/i, "troll"], [/golem/i, "golem"],
	[/ooze|pudding|jelly|cube|slime/i, "ooze"], [/elemental/i, "elemental"],
	[/eagle|hawk|owl|raven|vulture|blood hawk|roc\b|griffon|hippogriff|bird|pteranodon/i, "bird"],
	[/lion|tiger|panther|cat\b|saber/i, "cat"], [/horse|pony|mule|camel|elk|deer|warhorse/i, "horse"],
	[/boar|swine/i, "boar"], [/shark|fish|octopus|squid|quipper|eel|whale|plesiosaurus|crocodile/i, "aquatic"],
	[/centipede|scorpion|wasp|beetle|ankheg|insect/i, "insect"], [/demon|balor|marilith|hezrou|vrock|glabrezu|nalfeshnee|dretch/i, "demon"],
	[/devil|imp\b/i, "devil"], [/angel|deva|planetar|solar/i, "angel"],
	[/bandit|thug|guard|knight|noble|priest|acolyte|cultist|mage|archmage|veteran|gladiator|scout|spy|assassin|berserker|commoner|tribal|pirate|captain|druid|assassin/i, "humanoid"],
];
const SUBTYPE_HINTS: Record<string, string> = {
	goblinoid: "goblin", orc: "orc", kobold: "kobold", gnoll: "gnoll", demon: "demon", devil: "devil",
	lizardfolk: "lizardfolk", sahuagin: "sahuagin", merfolk: "merfolk",
};
function tokenHint(m: Raw): string {
	const sub = String(m.subtype ?? "").toLowerCase();
	if (SUBTYPE_HINTS[sub]) return SUBTYPE_HINTS[sub];
	for (const [re, hint] of NAME_HINTS) if (re.test(m.name)) return hint;
	const t = String(m.type).toLowerCase();
	if (t.startsWith("swarm")) return "swarm";
	return t.split(/\s+/)[0] || "monster";
}

function speed(s: Record<string, string | boolean>): MonsterStats["speed"] {
	const out: MonsterStats["speed"] = {};
	for (const [k, v] of Object.entries(s)) {
		if (k === "hover") {
			out.hover = v === true || v === "true";
			continue;
		}
		const n = feet(String(v));
		if (n !== undefined && (k === "walk" || k === "fly" || k === "swim" || k === "climb" || k === "burrow")) out[k] = n;
		if (typeof v === "string" && /hover/.test(v)) out.hover = true;
	}
	return out;
}

function damageList(list: string[]): { types: DamageType[]; notes: string[] } {
	const types: DamageType[] = [];
	const notes: string[] = [];
	for (const s of list) {
		const t = damageType(s);
		if (t) types.push(t);
		else notes.push(s);
	}
	return { types, notes };
}

function monsters(): MonsterStats[] {
	return raw("Monsters").map((m): MonsterStats => {
		const saves: Partial<Record<Ability, number>> = {};
		const skills: Record<string, number> = {};
		for (const p of m.proficiencies ?? []) {
			const n = normProf(p.proficiency.index);
			if (n.kind === "save") saves[ability(n.id)] = p.value;
			else if (n.kind === "skill") skills[n.id] = p.value;
		}
		const vul = damageList(m.damage_vulnerabilities ?? []);
		const res = damageList(m.damage_resistances ?? []);
		const imm = damageList(m.damage_immunities ?? []);
		const traits: { name: string; description: string }[] = ((m.special_abilities ?? []) as Raw[]).map((a) => ({ name: a.name, description: a.desc }));
		const qual: string[] = [];
		if (vul.notes.length) qual.push(`Vulnerable: ${vul.notes.join("; ")}`);
		if (res.notes.length) qual.push(`Resistant: ${res.notes.join("; ")}`);
		if (imm.notes.length) qual.push(`Immune: ${imm.notes.join("; ")}`);
		if (qual.length) traits.unshift({ name: "Damage Qualifiers", description: qual.join(". ") });
		const ci = ((m.condition_immunities ?? []) as Raw[]).map((c) => c.index as string);
		if (ci.includes("exhaustion")) traits.push({ name: "Condition Immunity: Exhaustion", description: "Immune to exhaustion." });
		const senses = Object.entries(m.senses ?? {})
			.map(([k, v]) => (k === "passive_perception" ? `passive Perception ${v}` : `${k.replace(/_/g, " ")} ${v}`))
			.join(", ");
		const typeStr = m.subtype ? `${m.type} (${m.subtype})` : String(m.type);
		const ac = (m.armor_class as Raw[])[0];
		return {
			index: m.index,
			name: m.name,
			size: sizeOf(m.size),
			type: typeStr,
			alignment: m.alignment,
			ac: ac?.value ?? 10,
			hp: m.hit_points,
			hitDice: m.hit_dice,
			speed: speed(m.speed ?? {}),
			abilities: { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma },
			saves,
			skills,
			vulnerabilities: vul.types,
			resistances: res.types,
			immunities: imm.types,
			conditionImmunities: ci.filter((c) => CONDITION_SET.has(c)) as ConditionId[],
			senses,
			languages: m.languages || "—",
			cr: m.challenge_rating,
			xp: m.xp,
			traits,
			actions: ((m.actions ?? []) as Raw[]).map(monsterAction),
			bonusActions: ((m.bonus_actions ?? []) as Raw[]).map(monsterAction),
			reactions: ((m.reactions ?? []) as Raw[]).map((r) => ({ name: r.name, description: r.desc })),
			legendaryActions: ((m.legendary_actions ?? []) as Raw[]).map(monsterAction),
			tokenHint: tokenHint(m),
		};
	});
}

// ─── small tables ───────────────────────────────────────────────────────────

function skills(): SkillData[] {
	return raw("Skills").map((s) => ({ index: s.index, name: s.name, ability: ability(s.ability_score.index), description: text(s.desc) }));
}
function languages(): LanguageData[] {
	return raw("Languages").map((l) => ({ index: l.index, name: l.name, type: l.type, ...(l.script ? { script: l.script } : {}), speakers: l.typical_speakers ?? [] }));
}
function simple(name: RawName): SimpleEntry[] {
	return raw(name).map((x) => ({ index: x.index, name: x.name, description: text(x.desc) }));
}

// ─── main ───────────────────────────────────────────────────────────────────

function write(name: string, data: unknown): number {
	const path = join(OUT, `${name}.json`);
	writeFileSync(path, JSON.stringify(data));
	return statSync(path).size;
}

async function main(): Promise<void> {
	await ensureRaw(process.argv.includes("--refresh"));
	mkdirSync(OUT, { recursive: true });
	const outputs: Record<string, unknown> = {
		species: species(),
		classes: classes(),
		subclasses: subclasses(),
		features: featuresData(),
		backgrounds: backgrounds(),
		feats: feats(),
		skills: skills(),
		languages: languages(),
		conditions: simple("Conditions"),
		"damage-types": simple("Damage-Types"),
		"weapon-properties": simple("Weapon-Properties"),
		"magic-schools": simple("Magic-Schools"),
		equipment: equipment(),
		"magic-items": magicItems(),
		spells: spells(),
		monsters: monsters(),
	};
	let total = 0;
	for (const [name, data] of Object.entries(outputs)) {
		const size = write(name, data);
		total += size;
		console.log(`${name.padEnd(18)} ${String((data as unknown[]).length).padStart(4)} entries  ${(size / 1024).toFixed(1)} KB`);
	}
	console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
