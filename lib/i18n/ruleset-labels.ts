import type { Lang } from "./index";
import type { Ruleset } from "../rules/ruleset";
import zombieLabels from "../srd/data/zombie/labels.json";
import { translateSrd, type SrdDict } from "./srd";
import cBarbarian from "../srd/data/cyber/labels/barbarian.json";
import cBard from "../srd/data/cyber/labels/bard.json";
import cCleric from "../srd/data/cyber/labels/cleric.json";
import cDruid from "../srd/data/cyber/labels/druid.json";
import cFighter from "../srd/data/cyber/labels/fighter.json";
import cMonk from "../srd/data/cyber/labels/monk.json";
import cPaladin from "../srd/data/cyber/labels/paladin.json";
import cRanger from "../srd/data/cyber/labels/ranger.json";
import cRogue from "../srd/data/cyber/labels/rogue.json";
import cSorcerer from "../srd/data/cyber/labels/sorcerer.json";
import cWarlock from "../srd/data/cyber/labels/warlock.json";
import cWizard from "../srd/data/cyber/labels/wizard.json";
import cCommon from "../srd/data/cyber/labels/common.json";

type LabelSet = { en: Record<string, string>; es: Record<string, string> };

/** Root Access: the per-class label files merged into one layer (later files win on a clash; "common" first). */
function mergeLabels(files: unknown[]): LabelSet {
	const out: LabelSet = { en: {}, es: {} };
	for (const f of files) {
		const l = f as Partial<LabelSet> | null;
		Object.assign(out.en, l?.en ?? {});
		Object.assign(out.es, l?.es ?? {});
	}
	return out;
}

/**
 * Ruleset label layer: in The Quiet, SRD class/subclass/feature/background
 * names and descriptions are shown with their modern meaning (Wizard →
 * Chemistry Teacher, Rage → Adrenaline); in Root Access with their hacker
 * meaning (Wizard → Netrunner, Rage → Overdrive). Keyed by the exact English SRD text,
 * like the Spanish dictionary, so nothing else has to know about it.
 */
const LABELS: Record<Exclude<Ruleset, "fantasy">, LabelSet> = {
	zombie: zombieLabels as LabelSet,
	cyberpunk: mergeLabels([cCommon, cBarbarian, cBard, cCleric, cDruid, cFighter, cMonk, cPaladin, cRanger, cRogue, cSorcerer, cWarlock, cWizard]),
};

export function rulesetText(rs: Ruleset, lang: Lang, dict: SrdDict | null, text: string | undefined): string {
	if (!text) return "";
	if (rs !== "fantasy") {
		const L = LABELS[rs];
		const t = text.trim();
		if (lang === "es" && L.es[t]) return L.es[t];
		if (L.en[t]) return lang === "en" ? L.en[t] : translateSrd(lang, dict, L.en[t]);
	}
	return translateSrd(lang, dict, text);
}

/** The ruleset's own label for an SRD text, or undefined when it has none (callers keep their usual lookup). */
export function rulesetLabel(rs: Ruleset, lang: Lang, dict: SrdDict | null, text: string | undefined): string | undefined {
	if (!text || rs === "fantasy") return undefined;
	const L = LABELS[rs];
	const t = text.trim();
	if (lang === "es" && L.es[t]) return L.es[t];
	if (L.en[t]) return lang === "en" ? L.en[t] : translateSrd(lang, dict, L.en[t]);
	return undefined;
}

/** English modern label for server-side text (DM digest), or the text itself. */
export function rulesetLabelEn(rs: Ruleset, text: string): string {
	return rs === "fantasy" ? text : (LABELS[rs].en[text.trim()] ?? text);
}
