/**
 * Tiny i18n: flat string dictionaries keyed like "play.sidebar.inventory",
 * `{name}` placeholders. English is the source of truth; Spanish must define
 * every key (enforced by its type). Game enums (skills, conditions, scene
 * kinds…) use `enum.<group>.<value>` keys and fall back to a title-cased id.
 */
import { en, type Messages } from "./en";
import { es } from "./es";

export type Lang = "en" | "es";
export const LANGS: { id: Lang; label: string }[] = [
	{ id: "en", label: "English" },
	{ id: "es", label: "Español" },
];
export const DEFAULT_LANG: Lang = "en";
export const LANG_COOKIE = "dh_lang";

const DICTS: Record<Lang, Messages> = { en, es };
export type MessageKey = keyof Messages;

export function isLang(x: unknown): x is Lang {
	return x === "en" || x === "es";
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
	let s: string = DICTS[lang]?.[key] ?? en[key] ?? key;
	if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
	return s;
}

function titleCase(s: string): string {
	return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Translate an enum-like game id (e.g. group "skill", value "sleight-of-hand"). */
export function translateEnum(lang: Lang, group: string, value: string): string {
	const key = `enum.${group}.${value}`;
	const d = DICTS[lang] as Record<string, string>;
	return d[key] ?? (en as Record<string, string>)[key] ?? titleCase(value);
}

export type { Messages };
