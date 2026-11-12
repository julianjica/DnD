/** Static 5e (SRD 5.1) rules tables used by the character rules. */
import type { Ability, DamageType } from "../../game/types";

/** XP needed to reach each level (index = level). */
export const XP_THRESHOLDS = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

export function levelForXp(xp: number): number {
	let lvl = 1;
	for (let l = 2; l <= 20; l++) if (xp >= XP_THRESHOLDS[l]) lvl = l;
	return lvl;
}
export function xpForLevel(level: number): number {
	return XP_THRESHOLDS[Math.max(1, Math.min(20, level))];
}
export function proficiencyBonus(totalLevel: number): number {
	return 2 + Math.floor((Math.max(1, Math.min(20, totalLevel)) - 1) / 4);
}

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

/** Full-caster slot table (also the multiclass spellcaster table). Index = caster level. */
export const FULL_CASTER_SLOTS: number[][] = [
	[0, 0, 0, 0, 0, 0, 0, 0, 0],
	[2, 0, 0, 0, 0, 0, 0, 0, 0],
	[3, 0, 0, 0, 0, 0, 0, 0, 0],
	[4, 2, 0, 0, 0, 0, 0, 0, 0],
	[4, 3, 0, 0, 0, 0, 0, 0, 0],
	[4, 3, 2, 0, 0, 0, 0, 0, 0],
	[4, 3, 3, 0, 0, 0, 0, 0, 0],
	[4, 3, 3, 1, 0, 0, 0, 0, 0],
	[4, 3, 3, 2, 0, 0, 0, 0, 0],
	[4, 3, 3, 3, 1, 0, 0, 0, 0],
	[4, 3, 3, 3, 2, 0, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 0, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 0, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 0],
	[4, 3, 3, 3, 2, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 1, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 1, 1, 1],
	[4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Warlock Pact Magic: [slot count, slot level] per warlock level. */
export const PACT_SLOTS: [number, number][] = [
	[0, 0], [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5],
	[3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5],
];

export const SKILL_ABILITY: Record<string, Ability> = {
	acrobatics: "dex", "animal-handling": "wis", arcana: "int", athletics: "str", deception: "cha", history: "int",
	insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis", nature: "int", perception: "wis",
	performance: "cha", persuasion: "cha", religion: "int", "sleight-of-hand": "dex", stealth: "dex", survival: "wis",
};
export const SKILL_IDS = Object.keys(SKILL_ABILITY);

/** Damage type granted as a resistance by a feature/trait id. */
export const FEATURE_RESISTANCE: Record<string, DamageType> = {
	"dwarven-resilience": "poison",
	// Root Access: the Vantis trial kid's experimental jack hardens the mind.
	"c-hardened-mind": "psychic",
	"hellish-resistance": "fire",
	"draconic-ancestry-black": "acid",
	"draconic-ancestry-blue": "lightning",
	"draconic-ancestry-brass": "fire",
	"draconic-ancestry-bronze": "lightning",
	"draconic-ancestry-copper": "acid",
	"draconic-ancestry-gold": "fire",
	"draconic-ancestry-green": "poison",
	"draconic-ancestry-red": "fire",
	"draconic-ancestry-silver": "cold",
	"draconic-ancestry-white": "cold",
};
export const FEATURE_IMMUNITY: Record<string, DamageType> = {
	"purity-of-body": "poison",
};

/** Feature ids that supersede earlier versions of themselves (keep only the newest). */
export const FEATURE_GROUPS: [RegExp, string][] = [
	[/^action-surge-/, "action-surge"],
	[/^bardic-inspiration-d\d+$/, "bardic-inspiration"],
	[/^song-of-rest-d\d+$/, "song-of-rest"],
	[/^indomitable-\d/, "indomitable"],
	[/^wild-shape-/, "wild-shape"],
	[/^channel-divinity-\d-rest$/, "channel-divinity"],
	[/^destroy-undead-/, "destroy-undead"],
	[/^brutal-critical-/, "brutal-critical"],
	[/^extra-attack-\d$/, "extra-attack"],
	[/^unarmored-movement-\d$/, "unarmored-movement"],
	[/^natural-explorer-\d-/, "natural-explorer"],
	[/^favored-enemy-\d-/, "favored-enemy"],
];
export function featureGroup(id: string): string | undefined {
	for (const [re, g] of FEATURE_GROUPS) if (re.test(id)) return g;
	return undefined;
}

export const ALIGNMENTS = [
	"lawful good", "neutral good", "chaotic good", "lawful neutral", "neutral", "chaotic neutral",
	"lawful evil", "neutral evil", "chaotic evil",
];
