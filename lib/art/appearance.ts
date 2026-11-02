import type { PortraitSpec } from "../game/types";
import { Rng } from "../rules/dice";
import { CLOTH, normalizeSpecies, portraitTraits, randomPortrait, skinTonesFor } from "./portrait";

/**
 * Turns a described look into a portrait. The DM passes `Appearance` when it
 * introduces an NPC; when it doesn't, `appearanceFromText` reads the NPC's
 * description/role (English or Spanish) so the face matches the words.
 */
export interface Appearance {
	gender?: "female" | "male";
	age?: "child" | "young" | "adult" | "middle-aged" | "old" | "ancient";
	skin?: "pale" | "fair" | "olive" | "tan" | "brown" | "dark" | "red" | "purple" | "blue" | "green" | "grey" | "gold";
	hair?: "bald" | "short" | "cropped" | "long" | "ponytail" | "braids" | "bun" | "topknot" | "mohawk" | "wild" | "curly" | "shaved_sides";
	hairColor?: "black" | "dark-brown" | "brown" | "auburn" | "red" | "ginger" | "blonde" | "platinum" | "grey" | "white" | "blue" | "purple" | "green";
	facialHair?: "none" | "stubble" | "mustache" | "goatee" | "short_beard" | "full_beard" | "braided_beard" | "sideburns";
	eyes?: "brown" | "amber" | "green" | "blue" | "grey" | "gold" | "red" | "violet" | "white";
	headwear?: "none" | "hood" | "helmet" | "circlet" | "crown" | "headband";
	mark?: "none" | "scar" | "eyepatch" | "warpaint" | "earrings" | "freckles";
	clothing?: "tunic" | "armor" | "robe" | "leather" | "cloak" | "noble";
	clothingColor?: "red" | "green" | "blue" | "brown" | "purple" | "grey" | "black" | "white" | "gold";
	expression?: NonNullable<PortraitSpec["expression"]>;
	build?: NonNullable<PortraitSpec["build"]>;
	/** One memorable item in frame: an innkeeper's mug, a priest's holy symbol… */
	signature?: NonNullable<PortraitSpec["signature"]>;
}

/** Default expression for an NPC's disposition (text and explicit appearance override it). */
export function expressionForDisposition(d?: string): Appearance["expression"] {
	return d === "hostile" ? "stern" : d === "friendly" ? "smile" : undefined;
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
	if (a.expression) p.expression = a.expression;
	if (a.build) p.build = a.build;
	if (a.signature) p.signature = a.signature;
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
		expression: a.expression ?? base.expression,
		build: a.build ?? base.build,
		signature: a.signature ?? base.signature,
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
	else if (has(t, "braid", "braids", "braided", "trenza", "trenzas", "trenzado")) a.hair = "braids";
	else if (has(t, "ponytail", "coleta", "cola de caballo")) a.hair = "ponytail";
	else if (has(t, "bun", "moño")) a.hair = "bun";
	else if (has(t, "curly", "curls", "rizado", "rizada", "rizos")) a.hair = "curly";
	else if (has(t, "long hair", "long-haired", "pelo largo", "cabello largo", "melena")) a.hair = "long";
	else if (has(t, "cropped", "short hair", "pelo corto", "cabello corto")) a.hair = "cropped";
	else if (has(t, "wild hair", "unkempt", "greñas", "desgreñado", "desgreñada", "enmarañado")) a.hair = "wild";
	else if (has(t, "mohawk", "cresta")) a.hair = "mohawk";

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
	else if (has(t, "noble", "nobleman", "noblewoman", "lord", "duke", "duchess", "baron", "baroness", "countess", "courtier", "aristocrat", "doublet", "aristócrata", "duque", "duquesa", "barón", "baronesa", "conde", "condesa", "cortesano", "cortesana", "jubón")) a.clothing = "noble";
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

	const ex: [NonNullable<Appearance["expression"]>, string[]][] = [
		["angry", ["angry", "furious", "scowling", "scowls", "snarling", "enraged", "wrathful", "seething", "furioso", "furiosa", "enfadado", "enfadada", "enojado", "enojada", "iracundo", "iracunda", "colérico", "colérica", "rabioso", "rabiosa"]],
		["worried", ["worried", "nervous", "anxious", "fearful", "frightened", "scared", "jittery", "haunted", "trembling", "preocupado", "preocupada", "nervioso", "nerviosa", "ansioso", "ansiosa", "asustado", "asustada", "temeroso", "temerosa", "atemorizado", "atemorizada", "tembloroso", "temblorosa"]],
		["sad", ["sad", "grieving", "mournful", "sorrowful", "weeping", "melancholy", "despondent", "forlorn", "triste", "afligido", "afligida", "apenado", "apenada", "melancólico", "melancólica", "doliente", "lloroso", "llorosa", "abatido", "abatida", "desconsolado", "desconsolada"]],
		["stern", ["stern", "grim", "severe", "dour", "stoic", "strict", "frowning", "hard-faced", "unsmiling", "severo", "severa", "adusto", "adusta", "ceñudo", "ceñuda", "serio", "seria", "estoico", "estoica", "sombrío", "sombría", "hosco", "hosca"]],
		["smirk", ["smirk", "smirking", "sly", "wry", "mocking", "sardonic", "cocky", "roguish", "burlón", "burlona", "socarrón", "socarrona", "pícaro", "pícara", "sarcástico", "sarcástica", "astuto", "astuta", "zalamero", "zalamera"]],
		["smile", ["smiling", "smiles", "smile", "cheerful", "jovial", "jolly", "merry", "laughing", "friendly", "kindly", "genial", "sonriente", "sonríe", "sonrisa", "alegre", "risueño", "risueña", "amable", "afable", "bonachón", "bonachona", "simpático", "simpática", "campechano", "campechana"]],
	];
	for (const [e, ws] of ex) if (has(t, ...ws)) { a.expression = e; break; }

	if (has(t, "fat", "portly", "stout", "rotund", "heavyset", "heavy-set", "plump", "paunchy", "pot-bellied", "big-bellied", "corpulent", "obese", "gordo", "gorda", "rechoncho", "rechoncha", "orondo", "oronda", "barrigón", "barrigona", "obeso", "obesa", "regordete", "regordeta", "corpulento", "corpulenta")) a.build = "heavy";
	else if (has(t, "burly", "broad-shouldered", "brawny", "muscular", "hulking", "stocky", "thickset", "beefy", "fornido", "fornida", "robusto", "robusta", "musculoso", "musculosa", "ancho de hombros", "membrudo", "membruda", "achaparrado", "achaparrada")) a.build = "broad";
	else if (has(t, "thin", "slim", "slender", "lean", "gaunt", "wiry", "rangy", "skinny", "lanky", "willowy", "scrawny", "bony", "emaciated", "delgado", "delgada", "flaco", "flaca", "enjuto", "enjuta", "esbelto", "esbelta", "escuálido", "escuálida", "huesudo", "huesuda", "demacrado", "demacrada", "larguirucho", "larguirucha", "fibroso", "fibrosa")) a.build = "slim";

	a.signature = signatureFromText(t, a);
	if (!a.signature) delete a.signature;
	return a;
}

/** The one item that makes this person memorable: named objects first, then what the role implies. */
function signatureFromText(t: string, a: Appearance): Appearance["signature"] {
	// Objects the text names outright.
	if (has(t, "pipe", "pipa", "smoker", "fumador", "fumadora", "cachimba")) return "pipe";
	if (has(t, "wizard hat", "pointed hat", "sombrero puntiagudo", "sombrero de mago", "sombrero picudo")) return "wizard_hat";
	if (has(t, "feathered hat", "plumed hat", "sombrero de plumas", "sombrero emplumado", "sombrero con pluma")) return "feathered_hat";
	if (has(t, "staff", "bastón", "báculo", "cayado")) return "staff";
	if (has(t, "holy symbol", "símbolo sagrado", "símbolo sacro")) return "holy_symbol";
	if (has(t, "amulet", "pendant", "talisman", "locket", "medallion", "amuleto", "colgante", "talismán", "relicario", "medallón")) return "amulet";
	if (has(t, "lantern", "lamp", "farol", "linterna", "lámpara", "candil")) return "lantern";
	if (has(t, "tome", "book", "grimoire", "ledger", "libro", "tomo", "grimorio", "libro de cuentas")) return "book";
	if (has(t, "quill", "inkwell", "pluma de ave", "tintero")) return "quill";
	if (has(t, "dagger", "knife", "daga", "puñal", "cuchillo", "estilete")) return "dagger";
	if (has(t, "raven", "crow", "falcon", "hawk", "owl", "parrot", "cuervo", "halcón", "búho", "lechuza", "loro", "cetrero", "cetrera", "falconer")) return "bird";
	if (has(t, "flower", "flowers", "flor", "flores")) return "flower";
	if (has(t, "tankard", "mug", "ale", "jarra", "cerveza")) return "mug";
	// What the role implies.
	if (has(t, "innkeeper", "barkeep", "barkeeper", "bartender", "tavern keeper", "tavernkeeper", "brewer", "alewife", "posadero", "posadera", "tabernero", "tabernera", "cervecero", "cervecera", "cantinero", "cantinera", "mesonero", "mesonera")) return "mug";
	if (has(t, "priest", "priestess", "cleric", "acolyte", "paladin", "nun", "abbess", "abbot", "chaplain", "templar", "sacerdote", "sacerdotisa", "clérigo", "clériga", "acólito", "acólita", "monja", "abad", "abadesa", "paladín", "capellán", "templario", "templaria")) return "holy_symbol";
	if (has(t, "wizard", "archmage", "mage", "mago", "maga", "archimago", "archimaga")) return "wizard_hat";
	if (has(t, "sorcerer", "sorceress", "warlock", "druid", "shaman", "hechicero", "hechicera", "brujo", "druida", "chamán", "chamana")) return "staff";
	if (has(t, "scribe", "clerk", "notary", "chronicler", "secretary", "escriba", "escribano", "escribana", "notario", "notaria", "cronista", "secretario", "secretaria")) return "quill";
	if (has(t, "scholar", "sage", "librarian", "archivist", "historian", "loremaster", "erudito", "erudita", "sabio", "sabia", "bibliotecario", "bibliotecaria", "archivero", "archivera", "historiador", "historiadora")) return "book";
	if (has(t, "bard", "minstrel", "troubadour", "dandy", "bardo", "barda", "trovador", "trovadora", "juglar", "juglaresa")) return "feathered_hat";
	if (has(t, "lamplighter", "watchman", "night watch", "farolero", "farolera", "sereno")) return "lantern";
	if (has(t, "assassin", "cutpurse", "pickpocket", "asesino", "asesina", "carterista", "sicario", "sicaria")) return "dagger";
	if (has(t, "gardener", "florist", "herbalist", "jardinero", "jardinera", "florista", "herbolario", "herbolaria", "herbalista")) return "flower";
	if (a.clothing === "robe" && has(t, "monk", "friar", "monje", "fraile")) return "holy_symbol";
	return undefined;
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
