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

/** Default campaign titles ("X's Tale" / "La historia de X") follow the UI language. */
export function displayTitle(lang: Lang, title: string): string {
	const en = title.match(/^(.+)'s Tale$/);
	const es = title.match(/^La historia de (.+)$/);
	const name = en?.[1] ?? es?.[1];
	if (!name) return title;
	return lang === "es" ? `La historia de ${name}` : `${name}'s Tale`;
}

const PLACE_ES: [RegExp, string][] = [
	[/^Halls of (.+)$/, "Salas de $1"], [/^(.+) Undercroft$/, "Criptas de $1"], [/^The (.+) Vaults$/, "Las bóvedas de $1"],
	[/^(.+) Caverns$/, "Cavernas de $1"], [/^(.+) Hollows$/, "Grutas de $1"],
	[/^(.+) Wood$/, "Bosque de $1"], [/^The (.+) Wilds$/, "Las espesuras de $1"], [/^(.+) Forest$/, "Selva de $1"],
	[/^Mount (.+)$/, "Monte $1"], [/^(.+) Peaks$/, "Picos de $1"],
	[/^Ruins of (.+)$/, "Ruinas de $1"], [/^Old (.+)$/, "Antigua $1"],
	[/^Castle (.+)$/, "Castillo de $1"], [/^(.+) Keep$/, "Fortaleza de $1"],
	[/^Temple of (.+)$/, "Templo de $1"], [/^(.+) Abbey$/, "Abadía de $1"],
	[/^(.+) Fen$/, "Ciénaga de $1"], [/^(.+) Mire$/, "Pantano de $1"],
	[/^(.+) Cove$/, "Cala de $1"], [/^(.+) Strand$/, "Playa de $1"],
	[/^(.+) Camp$/, "Campamento $1"],
	[/^(.+) Tower$/, "Torre de $1"], [/^The Spire of (.+)$/, "La aguja de $1"],
	[/^The (.+) Stones$/, "Las piedras de $1"], [/^(.+) Monolith$/, "Monolito de $1"],
	[/^The Realm of (.+)$/, "El Reino de $1"], [/^The Kingdom of (.+)$/, "El Señorío de $1"], [/^The Marches of (.+)$/, "Las Marcas de $1"],
	[/^The Reaches of (.+)$/, "Los Confines de $1"], [/^The Dominion of (.+)$/, "El Dominio de $1"], [/^The Free Lands of (.+)$/, "Las Tierras Libres de $1"],
];

/** Generated English place names ("Castle X", "X Wood") shown in Spanish. Names the DM invented are left alone. */
export function displayPlace(lang: Lang, name: string): string {
	if (lang !== "es") return name;
	for (const [re, out] of PLACE_ES) if (re.test(name) && !/\s/.test(name.replace(re, "$1"))) return name.replace(re, out);
	return name;
}
