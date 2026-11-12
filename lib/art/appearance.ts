import type { PortraitSpec } from "../game/types";
import { Rng } from "../rules/dice";
import { CLOTH, NATURAL_HAIR_LIVE, NATURAL_MALE_HAIR, normalizeSpecies, portraitTraits, randomPortrait, skinTonesFor } from "./portrait";

type NaturalHair = (typeof NATURAL_MALE_HAIR)[number];

const BASE_HAIR_IDS = [
	"bald", "short", "cropped", "sidepart", "long", "ponytail", "braids", "bun", "topknot", "mohawk", "wild", "curly", "shaved_sides",
	"buzz", "undercut", "quiff", "slicked_back", "receding", "dreadlocks", "cornrows", "curtains", "spiky", "flat_top",
] as const;

/** Hair ids the DM may set (update_npc / add_npc). The natural men's cuts join once NATURAL_HAIR_LIVE. */
export const DM_HAIR_IDS: string[] = NATURAL_HAIR_LIVE ? [...BASE_HAIR_IDS, ...NATURAL_MALE_HAIR] : [...BASE_HAIR_IDS];

/**
 * Once NATURAL_HAIR_LIVE: a man described with a cut gets the natural version of
 * it (phrases are checked first, then the older id is translated).
 */
const NATURAL_PHRASES: [NaturalHair, string[]][] = [
	["m_horseshoe", ["horseshoe", "bald crown", "balding on top", "bald on top", "coronilla calva", "calvo en la coronilla"]],
	["m_receding", ["receding hairline", "receding", "balding", "thinning hair", "entradas pronunciadas", "entradas", "calvicie incipiente"]],
	["m_locs_long", ["long dreadlocks", "long locs", "rastas largas"]],
	["m_locs_short", ["dreadlocks", "dreadlocked", "locs", "rastas", "rastafari"]],
	["m_cornrows", ["cornrows", "cornrowed", "trenzas pegadas", "trenzas africanas"]],
	["m_twists", ["twists", "twisted hair"]],
	["m_afro_short", ["short afro", "afro corto"]],
	["m_afro", ["afro"]],
	["m_curly_top", ["curly top", "rizos arriba"]],
	["m_man_bun", ["man bun", "bun", "moño"]],
	["m_mullet", ["mullet"]],
	["m_pompadour", ["pompadour"]],
	["m_quiff", ["quiff", "tupé"]],
	["m_undercut", ["undercut"]],
	["m_slick_back", ["slicked-back", "slicked back", "slicked", "engominado", "peinado hacia atrás"]],
	["m_brushed_back", ["brushed back", "swept back", "hair swept back"]],
	["m_side_part", ["side part", "side-parted", "raya al lado", "raya a un lado"]],
	["m_ivy", ["ivy league"]],
	["m_curtains", ["middle part", "center part", "centre part", "curtains", "raya al medio", "raya en medio"]],
	["m_mod", ["bowl cut", "mod cut", "corte de tazón", "tazón"]],
	["m_shag", ["shag"]],
	["m_caesar", ["caesar cut", "corte césar"]],
	["m_french_crop", ["french crop", "crop top haircut", "textured crop"]],
	["m_crew", ["crew cut", "flat top", "flat-top", "corte militar", "corte de cepillo"]],
	["m_buzz", ["buzz cut", "buzzcut", "shaved short", "rapado al cero", "pelo al rape", "rapado"]],
	["m_messy_fringe", ["fringe", "bangs", "flequillo"]],
	["m_bedhead", ["tousled", "messy hair", "bedhead", "unkempt", "despeinado", "greñas"]],
	["m_wavy", ["wavy", "ondulado"]],
	["m_long", ["long hair", "long-haired", "pelo largo", "cabello largo", "melena larga"]],
	["m_shoulder", ["shoulder-length", "shoulder length", "melena", "hasta los hombros"]],
	["m_tucked", ["tucked behind his ears", "behind his ears", "tras las orejas"]],
];
const OLD_TO_NATURAL: Record<string, NaturalHair> = {
	short: "m_short_back_sides", cropped: "m_crew", sidepart: "m_side_part", long: "m_shoulder", curly: "m_curly_top", wild: "m_bedhead",
	buzz: "m_buzz", undercut: "m_undercut", quiff: "m_quiff", slicked_back: "m_slick_back", receding: "m_receding", dreadlocks: "m_locs_short",
	cornrows: "m_cornrows", curtains: "m_curtains", spiky: "m_french_crop", flat_top: "m_crew", bun: "m_man_bun",
};
function naturalHairFrom(t: string, old: Appearance["hair"], has: (t: string, ...w: string[]) => boolean): Appearance["hair"] {
	for (const [id, ws] of NATURAL_PHRASES) if (has(t, ...ws)) return id;
	return old && OLD_TO_NATURAL[old] ? OLD_TO_NATURAL[old] : old;
}

/**
 * Turns a described look into a portrait. The DM passes `Appearance` when it
 * introduces an NPC; when it doesn't, `appearanceFromText` reads the NPC's
 * description/role (English or Spanish) so the face matches the words.
 */
export interface Appearance {
	gender?: "female" | "male";
	age?: "child" | "young" | "adult" | "middle-aged" | "old" | "ancient";
	skin?: "pale" | "fair" | "olive" | "tan" | "brown" | "dark" | "red" | "purple" | "blue" | "green" | "grey" | "gold";
	hair?: (typeof BASE_HAIR_IDS)[number] | NaturalHair;
	hairColor?: "black" | "dark-brown" | "brown" | "auburn" | "red" | "ginger" | "blonde" | "platinum" | "grey" | "white" | "blue" | "purple" | "green";
	facialHair?: "none" | "stubble" | "mustache" | "goatee" | "short_beard" | "full_beard" | "braided_beard" | "sideburns";
	eyes?: "brown" | "amber" | "green" | "blue" | "grey" | "gold" | "red" | "violet" | "white";
	headwear?: "none" | "hood" | "helmet" | "circlet" | "crown" | "headband";
	mark?: "none" | "scar" | "eyepatch" | "warpaint" | "earrings" | "freckles";
	clothing?: "tunic" | "armor" | "robe" | "leather" | "cloak";
	clothingColor?: "red" | "green" | "blue" | "brown" | "purple" | "grey" | "black" | "white" | "gold";
}

const AGE: Record<NonNullable<Appearance["age"]>, number> = { child: 0, young: 0.1, adult: 0.3, "middle-aged": 0.55, old: 0.8, ancient: 1 };
const SKIN: Record<NonNullable<Appearance["skin"]>, string> = {
	pale: "#f6d7c3", fair: "#eec1a0", olive: "#c98e65", tan: "#e0ac83", brown: "#8a5a3b", dark: "#4b2f22",
	red: "#b8413c", purple: "#5f3a74", blue: "#3d5f9e", green: "#6f8c56", grey: "#8e9294", gold: "#c9a14a",
};
const HAIR_COLOR: Record<NonNullable<Appearance["hairColor"]>, string> = {
	black: "#1c1714", "dark-brown": "#3a2a1e", brown: "#5a3a22", auburn: "#7a4e2a", red: "#a33a22", ginger: "#c95a2a",
	blonde: "#e0c070", platinum: "#efe0b0", grey: "#8a8a8a", white: "#f2f2ee", blue: "#2c3a5a", purple: "#5a2a6a", green: "#2a5a4a",
};
const EYES: Record<NonNullable<Appearance["eyes"]>, string> = {
	brown: "#4a2e1a", amber: "#8a6a2a", green: "#3f6a3a", blue: "#3a5a8a", grey: "#7a7a7a", gold: "#c8a030", red: "#d0402a", violet: "#9a5ac8", white: "#e8e2c0",
};
const CLOTH_COLOR: Record<NonNullable<Appearance["clothingColor"]>, string> = {
	red: "#6b2a2a", green: "#2f4a36", blue: "#2c3b5c", brown: "#5a4630", purple: "#4a3a5a", grey: "#3c3c40", black: "#1f1d22", white: "#b8b2a4", gold: "#7a5a2a",
};

/** A portrait honoring every given trait; unspecified ones stay random but species-appropriate. */
export function portraitFromAppearance(rng: Rng, speciesId: string | undefined, a: Appearance = {}): PortraitSpec {
	const p = randomPortrait(rng, speciesId);
	const sp = normalizeSpecies(speciesId);
	if (a.gender) p.gender = a.gender;
	if (p.gender === "female" && !a.facialHair) p.facialHair = "none";
	if (a.age) p.age = AGE[a.age];
	if (a.skin) p.skinTone = SKIN[a.skin];
	else if (!skinTonesFor(sp).includes(p.skinTone)) p.skinTone = skinTonesFor(sp)[0];
	if (a.hair) p.hairStyle = a.hair;
	if (a.hairColor) p.hairColor = HAIR_COLOR[a.hairColor];
	else if (a.age === "old" || a.age === "ancient") p.hairColor = a.age === "ancient" ? HAIR_COLOR.white : HAIR_COLOR.grey;
	if (a.facialHair) p.facialHair = a.facialHair;
	if (a.eyes) p.eyeColor = EYES[a.eyes];
	if (a.headwear) p.accessory = a.headwear;
	if (a.mark && a.mark !== "none") {
		if (a.mark === "freckles") p.features = [...new Set([...p.features, "freckles"])];
		else if (!a.headwear || a.headwear === "none") p.accessory = a.mark;
	}
	if (a.clothing) p.clothingStyle = a.clothing;
	if (a.clothingColor) p.clothing = CLOTH_COLOR[a.clothingColor];
	else if (!p.clothing) p.clothing = CLOTH[Math.floor(rng.next() * CLOTH.length)];
	return p;
}

/** Applies an appearance on top of an existing portrait (keeps its face seed). */
export function applyAppearance(rng: Rng, base: PortraitSpec, speciesId: string | undefined, a: Appearance): PortraitSpec {
	const fresh = portraitFromAppearance(rng, speciesId, a);
	const keep = <K extends keyof PortraitSpec>(k: K, given: unknown) => (given ? fresh[k] : base[k] ?? fresh[k]);
	return {
		...base,
		gender: a.gender ?? base.gender ?? fresh.gender,
		age: a.age ? fresh.age : base.age,
		skinTone: keep("skinTone", a.skin),
		hairStyle: keep("hairStyle", a.hair),
		hairColor: a.hairColor || a.age === "old" || a.age === "ancient" ? fresh.hairColor : base.hairColor,
		facialHair: a.facialHair ? fresh.facialHair : (a.gender ?? base.gender) === "female" ? "none" : base.facialHair,
		eyeColor: keep("eyeColor", a.eyes),
		accessory: a.headwear || (a.mark && a.mark !== "freckles") ? fresh.accessory : base.accessory,
		features: a.mark === "freckles" ? fresh.features : base.features,
		clothingStyle: a.clothing ?? base.clothingStyle,
		clothing: a.clothingColor ? fresh.clothing : base.clothing,
	};
}

// ─── Reading a description ──────────────────────────────────────────────

const has = (t: string, ...words: string[]) => words.some((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu").test(t));

/** Best-effort appearance from free text (English and Spanish). Only sets what the text states. */
export function appearanceFromText(text: string): Appearance {
	const t = text.toLowerCase();
	const a: Appearance = {};
	// Gender: the earliest gendered word wins (descriptions lead with the person; later words mention relatives).
	const FEM = ["she", "her", "woman", "girl", "lady", "mother", "wife", "widow", "sister", "daughter", "queen", "priestess", "matron", "crone", "hag", "maiden", "nun", "abbess",
		"ella", "mujer", "muchacha", "chica", "niña", "señora", "dama", "madre", "esposa", "viuda", "hermana", "hija", "reina", "sacerdotisa", "anciana", "doncella", "posadera", "tabernera", "monja", "abadesa", "bruja", "sargenta", "capitana", "superviviente"];
	const MASC = ["he", "his", "him", "man", "boy", "lord", "father", "husband", "brother", "son", "king", "priest", "monk", "friar", "sir", "ser",
		"él", "hombre", "muchacho", "chico", "niño", "señor", "padre", "esposo", "hermano", "hijo", "rey", "sacerdote", "monje", "fraile", "anciano", "posadero", "tabernero", "sargento", "cabo", "soldado", "abad", "barbudo", "caballero"];
	const first = (words: string[]) => {
		let best = Infinity;
		for (const w of words) {
			const m = new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu").exec(t);
			if (m && m.index < best) best = m.index;
		}
		return best;
	};
	const fi = first(FEM), mi = first(MASC);
	if (fi < mi) a.gender = "female";
	else if (mi < fi) a.gender = "male";

	const yearsOld = t.match(/(\d{1,3})\s*(?:years?|year-old|años)/);
	const decade = t.match(/\b(twenties|thirties|forties|fifties|sixties|seventies|eighties|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta)\b/);
	const NUM: Record<string, number> = { nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciséis: 16, diecisiete: 17, dieciocho: 18, seventeen: 17, sixteen: 16, fifteen: 15, fourteen: 14, thirteen: 13, twelve: 12, ten: 10, nine: 9, eight: 8, seven: 7, ocho: 8, siete: 7 };
	const word = t.match(/\b(nueve|diez|once|doce|trece|catorce|quince|dieciséis|diecisiete|dieciocho|seventeen|sixteen|fifteen|fourteen|thirteen|twelve|ten|nine|eight|seven|ocho|siete)\b(?=\s*(?:years?|años|-year))/);
	const years = yearsOld ? Number(yearsOld[1]) : word ? NUM[word[1]] : decade ? { twenties: 25, veinte: 25, thirties: 35, treinta: 35, forties: 45, cuarenta: 45, fifties: 55, cincuenta: 55, sixties: 65, sesenta: 65, seventies: 75, setenta: 75, eighties: 85, ochenta: 85 }[decade[1]] : undefined;
	if (years !== undefined) a.age = years < 13 ? "child" : years < 25 ? "young" : years < 40 ? "adult" : years < 60 ? "middle-aged" : years < 85 ? "old" : "ancient";

	if (a.age) {
		/* numeric age already set */
	} else if (has(t, "child", "kid", "niño", "niña", "crío", "cría")) a.age = "child";
	else if (has(t, "boy", "girl", "youth", "young", "teen", "teenage", "lad", "lass", "muchacho", "muchacha", "joven", "chico", "chica", "adolescente", "mozo", "moza")) a.age = "young";
	else if (has(t, "ancient", "venerable", "decrepit", "centenario", "centenaria", "decrépito", "decrépita")) a.age = "ancient";
	else if (has(t, "old", "elderly", "aged", "crone", "grey-haired", "gray-haired", "white-haired", "wizened", "anciano", "anciana", "viejo", "vieja", "canoso", "canosa", "arrugado", "arrugada", "de pelo blanco")) a.age = "old";
	else if (has(t, "middle-aged", "weathered", "grizzled", "veteran", "mediana edad", "curtido", "curtida", "veterano", "veterana")) a.age = "middle-aged";

	if (has(t, "bald", "shaven head", "shaved head", "calvo", "calva", "rapado", "rapada", "tonsura", "tonsured")) a.hair = "bald";
	else if (has(t, "dreadlocks", "dreadlocked", "rastas", "rastafari")) a.hair = "dreadlocks";
	else if (has(t, "cornrows", "cornrowed", "trenzas pegadas", "trenzas africanas")) a.hair = "cornrows";
	else if (has(t, "braid", "braids", "braided", "trenza", "trenzas", "trenzado")) a.hair = "braids";
	else if (has(t, "ponytail", "coleta", "cola de caballo")) a.hair = "ponytail";
	else if (has(t, "bun", "moño")) a.hair = "bun";
	else if (has(t, "curly", "curls", "rizado", "rizada", "rizos")) a.hair = "curly";
	else if (has(t, "long hair", "long-haired", "pelo largo", "cabello largo", "melena")) a.hair = "long";
	else if (has(t, "cropped", "short hair", "pelo corto", "cabello corto")) a.hair = "cropped";
	else if (has(t, "wild hair", "unkempt", "greñas", "desgreñado", "desgreñada", "enmarañado")) a.hair = "wild";
	else if (has(t, "mohawk", "cresta")) a.hair = "mohawk";
	else if (has(t, "receding hairline", "receding", "balding", "thinning hair", "entradas pronunciadas", "calvicie incipiente")) a.hair = "receding";
	else if (has(t, "buzz cut", "buzzcut", "crew cut", "rapado al cero", "pelo al rape")) a.hair = "buzz";
	else if (has(t, "undercut")) a.hair = "undercut";
	else if (has(t, "quiff", "pompadour", "tupé")) a.hair = "quiff";
	else if (has(t, "slicked-back", "slicked back", "slicked", "engominado", "engominada", "peinado hacia atrás")) a.hair = "slicked_back";
	else if (has(t, "middle part", "center part", "centre part", "raya al medio", "raya en medio")) a.hair = "curtains";
	else if (has(t, "spiky", "spiked hair", "pelo de punta", "pelo en punta")) a.hair = "spiky";
	else if (has(t, "flat top", "flat-top", "flattop", "corte de cepillo")) a.hair = "flat_top";

	if (NATURAL_HAIR_LIVE && a.gender !== "female" && a.hair !== "bald") a.hair = naturalHairFrom(t, a.hair, has);

	const hc: [Appearance["hairColor"], string[]][] = [
		["white", ["white hair", "white-haired", "snow-white", "pelo blanco", "cabello blanco", "canas blancas"]],
		["grey", ["grey hair", "gray hair", "grey-haired", "gray-haired", "grizzled", "silver hair", "canoso", "canosa", "pelo gris", "cabello gris", "entrecano", "entrecana"]],
		["red", ["red hair", "red-haired", "redhead", "pelirrojo", "pelirroja", "pelo rojo"]],
		["ginger", ["ginger", "copper hair", "cobrizo", "cobriza"]],
		["auburn", ["auburn", "castaño rojizo"]],
		["platinum", ["platinum", "silver-blond", "platino"]],
		["blonde", ["blond", "blonde", "golden hair", "fair-haired", "rubio", "rubia", "pelo dorado"]],
		["black", ["black hair", "black-haired", "raven", "pelo negro", "cabello negro", "moreno", "morena"]],
		["brown", ["brown hair", "brown-haired", "chestnut", "castaño", "castaña"]],
	];
	for (const [c, ws] of hc) if (has(t, ...ws)) { a.hairColor = c; break; }

	if (has(t, "braided beard", "barba trenzada")) a.facialHair = "braided_beard";
	else if (has(t, "long beard", "full beard", "great beard", "bushy beard", "thick beard", "barba larga", "barba poblada", "barba espesa", "barbudo")) a.facialHair = "full_beard";
	else if (has(t, "beard", "bearded", "barba")) a.facialHair = "short_beard";
	else if (has(t, "goatee", "perilla")) a.facialHair = "goatee";
	else if (has(t, "moustache", "mustache", "mostacho", "bigote")) a.facialHair = "mustache";
	else if (has(t, "stubble", "unshaven", "barba de varios días", "sin afeitar")) a.facialHair = "stubble";
	else if (has(t, "clean-shaven", "beardless", "lampiño", "afeitado")) a.facialHair = "none";

	if (has(t, "helmet", "helm", "casco", "yelmo")) a.headwear = "helmet";
	else if (has(t, "hood", "hooded", "cowl", "capucha", "encapuchado", "encapuchada", "embozado")) a.headwear = "hood";
	else if (has(t, "crown", "corona")) a.headwear = "crown";
	else if (has(t, "circlet", "diadem", "tiara", "diadema")) a.headwear = "circlet";
	else if (has(t, "headband", "bandana", "cinta", "pañuelo")) a.headwear = "headband";

	if (has(t, "eyepatch", "eye patch", "parche")) a.mark = "eyepatch";
	else if (has(t, "scar", "scarred", "cicatriz", "cicatrices")) a.mark = "scar";
	else if (has(t, "war paint", "warpaint", "pintura de guerra")) a.mark = "warpaint";
	else if (has(t, "freckles", "freckled", "pecas", "pecoso", "pecosa")) a.mark = "freckles";
	else if (has(t, "earring", "earrings", "pendiente", "pendientes", "aretes")) a.mark = "earrings";

	if (has(t, "armor", "armour", "armored", "mail", "plate", "breastplate", "soldier", "guard", "knight", "tabard", "brigandine", "man-at-arms", "sergeant", "captain", "armadura", "cota", "coraza", "soldado", "guardia", "caballero", "sargento", "capitán", "cabo", "tabardo", "halberd", "alabarda")) a.clothing = "armor";
	else if (has(t, "robe", "robes", "habit", "vestments", "cassock", "monk", "friar", "priest", "priestess", "wizard", "mage", "túnica", "hábito", "sotana", "vestiduras", "monje", "fraile", "sacerdote", "sacerdotisa", "mago", "maga", "hechicero", "clérigo", "monja", "abad")) a.clothing = "robe";
	else if (has(t, "leather", "hunter", "ranger", "thief", "rogue", "scout", "cuero", "cazador", "cazadora", "ladrón", "ladrona", "explorador", "exploradora")) a.clothing = "leather";
	else if (has(t, "cloak", "cloaked", "traveler", "capa", "manto", "viajero", "viajera")) a.clothing = "cloak";
	else if (has(t, "apron", "innkeeper", "farmer", "merchant", "delantal", "posadero", "posadera", "granjero", "granjera", "mercader", "comerciante")) a.clothing = "tunic";

	const cc: [Appearance["clothingColor"], string[]][] = [
		["red", ["red tabard", "red cloak", "crimson", "scarlet", "tabardo rojo", "capa roja", "carmesí", "escarlata"]],
		["black", ["black robe", "black cloak", "dark robes", "túnica negra", "capa negra", "de negro"]],
		["white", ["white robe", "white robes", "túnica blanca", "de blanco"]],
		["grey", ["grey robe", "grey cloak", "gray cloak", "capa gris", "túnica gris", "de gris"]],
		["green", ["green cloak", "capa verde"]],
		["blue", ["blue robe", "blue cloak", "túnica azul", "capa azul"]],
		["purple", ["purple", "púrpura", "morado"]],
	];
	for (const [c, ws] of cc) if (has(t, ...ws)) { a.clothingColor = c; break; }
	return a;
}

/**
 * Older saves drew NPC portraits at random. Once per NPC, re-read their role
 * and description and fix gender/age/hair/beard/headwear/clothing to match.
 * Returns true when something changed.
 */
export function repairNpcPortraits(npcs: Record<string, { name: string; role: string; description: string; speciesId?: string; portrait: PortraitSpec }>): boolean {
	let changed = false;
	for (const n of Object.values(npcs)) {
		if (!n.portrait || n.portrait.gender) continue;
		const a: Appearance = { age: "adult", ...appearanceFromText(`${n.role}. ${n.description}`) };
		// Keep the face they had when the text doesn't say otherwise.
		const current = portraitTraits(n.portrait, n.speciesId);
		const seeded = new Rng((n.portrait.seed ^ 0x9e3779b9) >>> 0 || 1);
		n.portrait = applyAppearance(seeded, { ...n.portrait, gender: a.gender ?? (current.female ? "female" : "male") }, n.speciesId, a);
		changed = true;
	}
	return changed;
}
