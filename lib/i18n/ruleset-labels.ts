import type { Lang } from "./index";
import type { Ruleset } from "../rules/ruleset";
import zombieLabels from "../srd/data/zombie/labels.json";
import { translateSrd, type SrdDict } from "./srd";

/**
 * Ruleset label layer: in The Quiet, SRD class/subclass/feature/background
 * names and descriptions are shown with their modern meaning (Wizard →
 * Chemistry Teacher, Rage → Adrenaline). Keyed by the exact English SRD text,
 * like the Spanish dictionary, so nothing else has to know about it.
 */
const LABELS: Record<Exclude<Ruleset, "fantasy">, { en: Record<string, string>; es: Record<string, string> }> = {
	zombie: zombieLabels as { en: Record<string, string>; es: Record<string, string> },
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
