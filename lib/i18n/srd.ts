/**
 * Spanish translations of SRD content (spell/item/feature/monster names and
 * descriptions), keyed by the exact English text. Characters copy SRD text
 * into their sheets, so translating by text works for saved games too.
 * Loaded lazily (it's large) the first time Spanish is shown.
 */
import type { Lang } from "./index";

export type SrdDict = Record<string, string>;
let cache: SrdDict | null = null;
let loading: Promise<SrdDict> | null = null;

export function loadSrdDict(): Promise<SrdDict> {
	if (cache) return Promise.resolve(cache);
	loading ??= import("@/lib/srd/es/dict.json").then((m) => (cache = (m.default ?? m) as SrdDict));
	return loading;
}

/** The dictionary if already loaded (the I18nProvider loads it and re-renders consumers). */
export function srdDictIfLoaded(): SrdDict | null {
	return cache;
}

/** Translate one SRD string; handles "Name 2" suffixes and "2 × Name" quantities. */
export function translateSrd(lang: Lang, dict: SrdDict | null, text: string | undefined): string {
	if (!text || lang === "en" || !dict) return text ?? "";
	const t = text.trim();
	const hit = dict[t];
	if (hit) return hit;
	const num = t.match(/^(.*?)(\s+\d+)$/);
	if (num && dict[num[1]]) return dict[num[1]] + num[2];
	const qty = t.match(/^(\d+\s*×\s*)(.+)$/);
	if (qty && dict[qty[2]]) return qty[1] + dict[qty[2]];
	return text;
}
