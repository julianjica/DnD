import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import type { Lang } from "@/lib/i18n";
import type { OptionChoice } from "@/lib/srd";

const DICTS: Record<Lang, Record<string, string>> = { en, es };

/**
 * Label for an SRD id: the translated `enum.<group>.<id>` when a dictionary
 * defines it, otherwise the SRD's own (English) name. Unlike translateEnum,
 * missing keys fall back to the real name rather than a title-cased id.
 */
export function srdName(lang: Lang, group: string, id: string, fallback: string): string {
	const k = `enum.${group}.${id}`;
	return DICTS[lang][k] ?? DICTS.en[k] ?? fallback;
}

type Tr = (key: "choice.classSkills" | "choice.bgLanguages" | "choice.cantrips" | "choice.spellsKnown" | "choice.spellbook" | "choice.extraLanguage" | "choice.abilityBonus" | "choice.skillVersatility" | "choice.speciesCantrip" | "choice.toolProficiency" | "choice.draconicAncestry", vars?: Record<string, string>) => string;

/** Rebuilds a creation-choice label from its id so it can be translated; unknown ids keep their SRD label. */
export function choiceLabel(ch: Pick<OptionChoice, "id" | "label">, t: Tr, names: { cls?: string; bg?: string }): string {
	const id = ch.id;
	const cls = names.cls ?? "";
	if (id === "class:skills" && cls) return t("choice.classSkills", { cls });
	if (id === "background:languages" && names.bg) return t("choice.bgLanguages", { bg: names.bg });
	if (id === "cantrips" && cls) return t("choice.cantrips", { cls });
	if (id === "spells") return /spellbook/i.test(ch.label) ? t("choice.spellbook") : cls ? t("choice.spellsKnown", { cls }) : ch.label;
	if (id.endsWith(":ability_bonus")) return t("choice.abilityBonus");
	if (id.endsWith(":languages")) return t("choice.extraLanguage");
	if (id.endsWith(":cantrip")) return t("choice.speciesCantrip");
	if (id === "half-elf:skills") return t("choice.skillVersatility");
	if (id.endsWith(":draconic-ancestry")) return t("choice.draconicAncestry");
	if (id === "dwarf:tools") return t("choice.toolProficiency");
	return ch.label;
}
