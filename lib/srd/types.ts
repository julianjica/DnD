/**
 * Compact SRD 5.1 data shapes written by `scripts/srd/import.ts` into
 * `lib/srd/data/*.json`. Spells and monsters use the shared contracts in
 * `lib/game/types.ts`; everything else is defined here.
 */
import type { Ability, DamageType, Size } from "../game/types";

export interface Ref {
	index: string;
	name: string;
}

/** A generic "choose N from these" choice point (skills, languages, tools, cantrips…). */
export interface OptionChoice {
	/** Stable id used as the key in creation/level-up `choices`. */
	id: string;
	label: string;
	choose: number;
	options: Ref[];
}

export interface TraitData {
	index: string;
	name: string;
	description: string;
}

export interface SubspeciesData {
	index: string;
	name: string;
	description: string;
	abilityBonuses: Partial<Record<Ability, number>>;
	traits: TraitData[];
	/** Skill/weapon/tool proficiencies granted outright (normalized ids). */
	skills: string[];
	weapons: string[];
	tools: string[];
	choices: OptionChoice[];
}

export interface SpeciesData {
	index: string;
	/** Content set ("zombie" = an origin of The Quiet); absent = SRD fantasy. */
	ruleset?: "fantasy" | "zombie";
	name: string;
	speed: number;
	size: Size;
	sizeDescription: string;
	age: string;
	alignment: string;
	abilityBonuses: Partial<Record<Ability, number>>;
	languages: string[];
	languageDescription: string;
	traits: TraitData[];
	skills: string[];
	weapons: string[];
	tools: string[];
	/** Choices: ability bonus picks (half-elf), languages, skills, tools, ancestry, cantrip… */
	choices: OptionChoice[];
	/** Feet of darkvision, 0 if none. */
	darkvision: number;
	subspecies: SubspeciesData[];
	/** Portrait feature hints ("pointed_ears", "horns"…). */
	portraitFeatures: string[];
}

/** One grant within an equipment option: a fixed item or a pick from a category. */
export type EquipmentGrant =
	| { ref: string; qty: number }
	| { category: string; choose: number; label: string };

export interface EquipmentChoice {
	desc: string;
	options: { label: string; grants: EquipmentGrant[] }[];
}

export type CasterType = "full" | "half" | "third" | "pact" | "none";

export interface ClassLevelRow {
	level: number;
	profBonus: number;
	/** Feature indices gained at this level (class-wide, not subclass). */
	features: string[];
	/** True if this level grants an Ability Score Improvement. */
	asi: boolean;
	cantripsKnown?: number;
	spellsKnown?: number;
	/** Slots for spell levels 1..9 (index 0 = 1st). Omitted for non-casters. */
	slots?: number[];
	/** Class-specific numbers flattened: rage_count, sneak_attack_dice ("3d6"), ki_points, extra_attacks… */
	specific: Record<string, number | string>;
}

export interface ClassData {
	index: string;
	name: string;
	hitDie: number;
	savingThrows: Ability[];
	/** Normalized: "light", "medium", "heavy", "shields". */
	armor: string[];
	/** Normalized: "simple", "martial" or equipment indices ("longsword"). */
	weapons: string[];
	tools: string[];
	skillChoice: { choose: number; from: string[] };
	/** Extra proficiency choices (bard instruments, monk tool/instrument). */
	otherChoices: OptionChoice[];
	startingEquipment: { ref: string; qty: number }[];
	equipmentChoices: EquipmentChoice[];
	multiclass: {
		/** All of these must be met (unless `any` is true, then one of them). */
		prerequisites: { ability: Ability; min: number }[];
		any: boolean;
		armor: string[];
		weapons: string[];
		tools: string[];
		skillChoose: number;
	};
	spellcasting?: {
		ability: Ability;
		/** Class level at which spellcasting starts. */
		startLevel: number;
		type: CasterType;
		/** Prepares from the full list (cleric/druid/paladin/wizard) vs. a known list. */
		prepares: boolean;
		info: string;
	};
	subclassLevel: number;
	subclassFlavor: string;
	subclasses: string[];
	primaryAbility: Ability[];
	levels: ClassLevelRow[];
}

export interface SubclassData {
	index: string;
	classId: string;
	name: string;
	flavor: string;
	description: string;
	/** level → feature indices */
	features: { level: number; features: string[] }[];
	/** Always-prepared / expanded spells (domain, oath, circle, patron). */
	spells: { spell: string; level: number; requires?: string }[];
	specific: { level: number; values: Record<string, number> }[];
	/** Original DungeonHarness content (not from the SRD). */
	homebrew?: boolean;
}

export interface FeatureData {
	index: string;
	name: string;
	classId: string;
	subclassId?: string;
	level: number;
	description: string;
	/** Parent feature index for selectable sub-features (fighting styles). */
	parent?: string;
	/** Choice offered by this feature (fighting style, expertise, favored enemy…). */
	choice?: { choose: number; kind: "feature" | "expertise" | "string" | "invocation"; options: Ref[] };
	/**
	 * Limited uses (homebrew features). `max` is a number or a formula:
	 * "prof" (proficiency bonus), "str|dex|con|int|wis|cha" (modifier, min 1),
	 * "level" / "level/2" / "level/3" (class level, rounded down, min 1), or "N+cha" style sums.
	 */
	uses?: { max: number | string; recharge: "short" | "long" | "dawn" };
}

export interface BackgroundData {
	index: string;
	name: string;
	skills: string[];
	tools: string[];
	languageChoose: number;
	toolChoices: OptionChoice[];
	equipment: { ref: string; qty: number }[];
	equipmentChoices: EquipmentChoice[];
	gold: number;
	feature: { name: string; description: string };
	personalityTraits: string[];
	ideals: string[];
	bonds: string[];
	flaws: string[];
	source: string;
}

export interface FeatData {
	index: string;
	name: string;
	prerequisites: { ability: Ability; min: number }[];
	description: string;
	/** Ability increases granted by the feat, if any. */
	abilityIncrease?: { choose: number; from: Ability[]; amount: number };
}

export interface SkillData {
	index: string;
	name: string;
	ability: Ability;
	description: string;
}

export interface LanguageData {
	index: string;
	name: string;
	type: string;
	script?: string;
	speakers: string[];
}

export interface SimpleEntry {
	index: string;
	name: string;
	description: string;
}

export interface EquipmentData {
	index: string;
	/** Content set ("zombie" = modern gear of The Quiet); absent = SRD fantasy. */
	ruleset?: "fantasy" | "zombie";
	/** Firearms/bows: equipment index of the ammunition one attack uses up. */
	ammo?: string;
	name: string;
	/** "weapon" | "armor" | "gear" | "tool" | "pack" | "ammunition" | "mount" | "vehicle" | "focus" */
	category: string;
	/** Sub-category, e.g. "simple-melee", "martial-ranged", "light", "artisans-tools". */
	subcategory?: string;
	cost: { qty: number; unit: string };
	weight?: number;
	description?: string;
	/** Bundle size (20 arrows per purchase). */
	bundle?: number;
	weapon?: {
		category: "simple" | "martial";
		ranged: boolean;
		damage: string;
		damageType: DamageType;
		properties: string[];
		range?: { normal: number; long?: number };
		throwRange?: { normal: number; long?: number };
		versatile?: string;
	};
	armor?: {
		type: "light" | "medium" | "heavy" | "shield";
		baseAc: number;
		dex: boolean;
		dexCap?: number;
		strMin?: number;
		stealthDisadvantage: boolean;
	};
	contents?: { ref: string; qty: number }[];
}

export interface MagicItemData {
	index: string;
	name: string;
	category: string;
	rarity: string;
	attunement: boolean;
	description: string;
	variants?: string[];
	variantOf?: string;
}
