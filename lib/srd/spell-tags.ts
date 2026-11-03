import type { ConditionId, SpellInfo } from "../game/types";

/**
 * Advantage / disadvantage relevance of a spell, for the spell tooltips.
 *
 * Curated by spell index for every SRD spell whose text mentions advantage
 * or disadvantage (plus the ones that impose a condition the attack rules turn
 * into advantage); a spell outside the table falls back to a neutral
 * "mentions advantage" tag from its description, because the wording alone
 * doesn't say who benefits (Charm Person's target saves with advantage).
 */

export type SpellTagNote =
	| "attacksVsTarget"
	| "nextAttackVsTarget"
	| "yourNextAttack"
	| "vsMetalArmor"
	| "targetChecks"
	| "yourChecks"
	| "allRolls"
	| "targetSaves"
	| "enlarge"
	| "invisibleAttacks"
	| "attacksVsProtectedDis"
	| "typesVsProtectedDis"
	| "targetNextAttackDis"
	| "undeadVsYouDis"
	| "targetAbilityDis"
	| "targetAttacksChecksDis"
	| "targetDisVarious"
	| "someSaveDis"
	| "saveAdvIfFighting"
	| "saveAdvOnDamage"
	| "youDisAfter"
	| "youDisSome"
	| "rangedInMelee"
	| "condition"
	| "mentionsAdv"
	| "mentionsDis";

/** Conditions whose attack-roll effects a spell tag can point at. */
export type TagCondition = Extract<ConditionId, "paralyzed" | "restrained" | "blinded" | "unconscious" | "prone" | "stunned" | "frightened">;

export interface SpellTag {
	/** Which kind of roll modifier this is about ("mention": text names one, direction unknown). */
	effect: "adv" | "dis" | "mention";
	/** Whether it helps the caster's side (null: unknown). */
	good: boolean | null;
	note: SpellTagNote;
	/** note = "condition": the condition the spell imposes. */
	condition?: TagCondition;
	/** note = "mentions*": the English sentence that mentions it. */
	excerpt?: string;
}

const A = (note: SpellTagNote, good = true): SpellTag => ({ effect: "adv", good, note });
const D = (note: SpellTagNote, good = true): SpellTag => ({ effect: "dis", good, note });
const C = (condition: TagCondition): SpellTag => ({ effect: condition === "frightened" ? "dis" : "adv", good: true, note: "condition", condition });

export const CURATED_SPELL_TAGS: Record<string, SpellTag[]> = {
	// Advantage for you and your allies
	"faerie-fire": [A("attacksVsTarget")],
	"guiding-bolt": [A("nextAttackVsTarget")],
	"true-strike": [A("yourNextAttack")],
	"shocking-grasp": [A("vsMetalArmor")],
	"enhance-ability": [A("targetChecks")],
	"arcane-hand": [A("yourChecks")],
	"hunters-mark": [A("yourChecks")],
	foresight: [A("allRolls"), D("attacksVsProtectedDis")],
	"beacon-of-hope": [A("targetSaves")],
	"gaseous-form": [A("targetSaves")],
	haste: [A("targetSaves")],
	"heroes-feast": [A("targetSaves")],
	"protection-from-poison": [A("targetSaves")],
	"holy-aura": [A("targetSaves"), D("attacksVsProtectedDis")],
	"enlarge-reduce": [A("enlarge")],
	invisibility: [A("invisibleAttacks"), D("attacksVsProtectedDis")],
	"greater-invisibility": [A("invisibleAttacks"), D("attacksVsProtectedDis")],
	// Disadvantage for your enemies
	blur: [D("attacksVsProtectedDis")],
	"protection-from-evil-and-good": [D("typesVsProtectedDis"), A("targetSaves")],
	"dispel-evil-and-good": [D("typesVsProtectedDis")],
	"magic-circle": [D("typesVsProtectedDis")],
	"vicious-mockery": [D("targetNextAttackDis")],
	"chill-touch": [D("undeadVsYouDis")],
	"bestow-curse": [D("targetAbilityDis")],
	eyebite: [D("targetAttacksChecksDis"), C("unconscious")],
	"heat-metal": [D("targetAttacksChecksDis")],
	symbol: [D("targetAttacksChecksDis"), C("frightened")],
	contagion: [D("targetDisVarious"), C("blinded")],
	"control-water": [D("targetDisVarious")],
	enthrall: [D("targetDisVarious"), A("saveAdvIfFighting", false)],
	"irresistible-dance": [A("attacksVsTarget"), D("targetDisVarious")],
	blight: [D("someSaveDis")],
	dream: [D("someSaveDis")],
	moonbeam: [D("someSaveDis")],
	shatter: [D("someSaveDis")],
	sunbeam: [D("someSaveDis"), C("blinded")],
	sunburst: [D("someSaveDis"), C("blinded")],
	// Conditions that give attackers advantage (or the target disadvantage)
	"hold-person": [C("paralyzed")],
	"hold-monster": [C("paralyzed")],
	entangle: [C("restrained")],
	web: [C("restrained")],
	"black-tentacles": [C("restrained")],
	"flesh-to-stone": [C("restrained")],
	"blindness-deafness": [C("blinded")],
	"color-spray": [C("blinded")],
	sleep: [C("unconscious")],
	command: [C("prone")],
	grease: [C("prone")],
	"sleet-storm": [C("prone")],
	earthquake: [C("prone")],
	"power-word-stun": [C("stunned")],
	fear: [C("frightened")],
	"phantasmal-killer": [C("frightened")],
	weird: [C("frightened")],
	// Drawbacks for the caster
	"charm-person": [A("saveAdvIfFighting", false)],
	"dominate-beast": [A("saveAdvIfFighting", false)],
	"dominate-person": [A("saveAdvIfFighting", false)],
	"dominate-monster": [A("saveAdvIfFighting", false)],
	"modify-memory": [A("saveAdvIfFighting", false)],
	"hideous-laughter": [C("prone"), A("saveAdvOnDamage", false)],
	resurrection: [D("youDisAfter", false)],
	"meld-into-stone": [D("youDisSome", false)],
	// Mentions advantage only as a generic reroll option
	wish: [],
	// The Quiet: techniques (lib/srd/data/zombie/techniques.json)
	"t-taunt": [D("targetNextAttackDis")],
	"t-mark-target": [A("yourChecks")],
	"t-second-gear": [A("targetSaves")],
	"t-sweet-talk": [A("saveAdvIfFighting", false)],
	"t-animal-whisperer": [A("targetSaves", false)],
	"t-flashbang": [C("blinded")],
	"t-flashlight-glare": [C("blinded")],
	"t-pepper-spray": [C("blinded")],
	"t-snare": [C("restrained")],
	"t-cuff-them": [C("restrained")],
	"t-tripwire": [C("prone")],
	"t-tackle": [C("prone")],
	"t-bowl-them-over": [C("prone")],
	"t-sedative": [C("unconscious")],
	"t-lull": [C("unconscious")],
	"t-talk-down": [C("paralyzed")],
	"t-spread-panic": [C("frightened")],
	"t-mad-dog-stare": [C("frightened")],
};

/** Sentences of `text` that mention (dis)advantage. */
function sentencesWith(text: string, re: RegExp): string[] {
	return text
		.split(/(?<=[.!?])\s+|\n+/)
		.map((s) => s.replace(/\*+/g, "").trim())
		.filter((s) => re.test(s));
}

/** Neutral tags from the description, for spells outside the curated table. */
export function mentionTags(spell: Pick<SpellInfo, "description" | "higherLevel">): SpellTag[] {
	const text = `${spell.description}\n${spell.higherLevel ?? ""}`;
	const out: SpellTag[] = [];
	const adv = sentencesWith(text, /(?<!dis)advantage\b/i);
	const dis = sentencesWith(text, /\bdisadvantage\b/i);
	if (adv.length) out.push({ effect: "mention", good: null, note: "mentionsAdv", excerpt: adv[0] });
	if (dis.length) out.push({ effect: "mention", good: null, note: "mentionsDis", ...(dis[0] !== adv[0] ? { excerpt: dis[0] } : {}) });
	return out;
}

/**
 * Everything the tooltip says about advantage/disadvantage for a spell:
 * curated (or text-derived) tags, plus the situational rule every ranged
 * spell attack carries (disadvantage with a hostile creature within 5 ft).
 */
export function spellTags(spell: SpellInfo): SpellTag[] {
	const tags = [...(CURATED_SPELL_TAGS[spell.index] ?? mentionTags(spell))];
	if (spell.attack === "ranged") tags.push(D("rangedInMelee", false));
	return tags;
}

/** The distinct effects worth a compact badge in a list (adv first). */
export function tagEffects(tags: SpellTag[]): ("adv" | "dis")[] {
	const out: ("adv" | "dis")[] = [];
	for (const e of ["adv", "dis"] as const) if (tags.some((t) => t.effect === e && t.note !== "rangedInMelee")) out.push(e);
	return out;
}
