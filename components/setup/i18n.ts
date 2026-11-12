import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import type { Lang } from "@/lib/i18n";
import { srdDictIfLoaded, translateSrd } from "@/lib/i18n/srd";
import { localizeEngine } from "@/lib/i18n/engine";
import type { OptionChoice } from "@/lib/srd";
import { rulesetLabel } from "@/lib/i18n/ruleset-labels";
import type { Ruleset } from "@/lib/rules/ruleset";
import type { MessageKey } from "@/lib/i18n";

const DICTS: Record<Lang, Record<string, string>> = { en, es };

/**
 * Label for an SRD id: the translated `enum.<group>.<id>` when a dictionary
 * defines it, otherwise the SRD's own (English) name. Unlike translateEnum,
 * missing keys fall back to the real name rather than a title-cased id.
 * In The Quiet (`rs` = "zombie") and Root Access ("cyberpunk") the ruleset's
 * own label wins (Wizard → Chemistry Teacher / Netrunner, Arcana → Science).
 */
export function srdName(lang: Lang, group: string, id: string, fallback: string, rs: Ruleset = "fantasy"): string {
	const z = rulesetLabel(rs, lang, srdDictIfLoaded(), fallback);
	if (z) return z;
	const k = `enum.${group}.${id}`;
	return DICTS[lang][k] ?? translateSrd(lang, srdDictIfLoaded(), fallback) ?? DICTS.en[k];
}

type Tr = (key: "choice.classSkills" | "choice.bgLanguages" | "choice.cantrips" | "choice.spellsKnown" | "choice.spellbook" | "z.choice.cantrips" | "z.choice.spellsKnown" | "z.choice.spellbook" | "c.choice.cantrips" | "c.choice.spellsKnown" | "c.choice.spellbook" | "choice.extraLanguage" | "choice.abilityBonus" | "choice.skillVersatility" | "choice.speciesCantrip" | "choice.toolProficiency" | "choice.draconicAncestry", vars?: Record<string, string>) => string;

/** Rebuilds a creation-choice label from its id so it can be translated; unknown ids keep their SRD label. */
export function choiceLabel(ch: Pick<OptionChoice, "id" | "label">, t: Tr, names: { cls?: string; bg?: string }, lang: Lang = "en", rs: Ruleset = "fantasy"): string {
	const id = ch.id;
	const cls = names.cls ?? "";
	const k = <K extends "choice.cantrips" | "choice.spellbook" | "choice.spellsKnown">(key: K) => (rs === "zombie" ? (`z.${key}` as const) : rs === "cyberpunk" ? (`c.${key}` as const) : key);
	if (id === "class:skills" && cls) return t("choice.classSkills", { cls });
	if (id === "background:languages" && names.bg) return t("choice.bgLanguages", { bg: names.bg });
	if (id === "cantrips" && cls) return t(k("choice.cantrips"), { cls });
	if (id === "spells") return /spellbook/i.test(ch.label) ? t(k("choice.spellbook")) : cls ? t(k("choice.spellsKnown"), { cls }) : ch.label;
	if (id.endsWith(":ability_bonus")) return t("choice.abilityBonus");
	if (id.endsWith(":languages")) return t("choice.extraLanguage");
	if (id.endsWith(":cantrip")) return t("choice.speciesCantrip");
	if (id === "half-elf:skills") return t("choice.skillVersatility");
	if (id.endsWith(":draconic-ancestry")) return t("choice.draconicAncestry");
	if (id.endsWith(":tools")) return t("choice.toolProficiency");
	const label = rulesetLabel(rs, lang, srdDictIfLoaded(), ch.label);
	if (label) return label;
	const srd = (x: string) => translateSrd(lang, srdDictIfLoaded(), x);
	return localizeEngine(lang, ch.label, srd);
}

/** `srdName` with the ruleset first (setup components pass `useT().ruleset`). */
export function srdNameIn(rs: Ruleset, lang: Lang, group: string, id: string, fallback: string): string {
	return srdName(lang, group, id, fallback, rs);
}

/**
 * The ruleset's own wording for a wizard message: "z.<key>" in The Quiet
 * (techniques, professions), "c.<key>" in Root Access (programs, hacking
 * styles), the plain key in fantasy. Every modern key has a z.* and c.* entry.
 */
export function rsKey(rs: Ruleset, key: string): MessageKey {
	return (rs === "zombie" ? `z.${key}` : rs === "cyberpunk" ? `c.${key}` : key) as MessageKey;
}
