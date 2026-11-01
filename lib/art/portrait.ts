import type { PortraitSpec } from "../game/types";
import type { Rng } from "../rules/dice";
import { ArtRng } from "./rand";

/**
 * Procedural portrait vocabulary. `PortraitSpec` fields are free strings; the
 * lists here define the values the renderer understands (unknown values fall
 * back gracefully). Colors are hex strings so custom pickers also work.
 */

export const SKIN_TONES = {
	human: ["#f6d7c3", "#eec1a0", "#e0ac83", "#c98e65", "#a8714b", "#8a5a3b", "#6b4430", "#4b2f22"],
	tiefling: ["#b8413c", "#9c2f3a", "#7e2a45", "#8a4a7d", "#5f3a74", "#c0645a", "#d08e7d", "#6d5a8e"],
	orc: ["#8aa36b", "#6f8c56", "#5b7a4a", "#8c9a86", "#7a8a7e", "#9aa07a", "#6a6f5c"],
	goliath: ["#a9a9a2", "#8e9294", "#b8ada0", "#7c8287", "#9c9488"],
	dragonborn: ["#c9a14a", "#b07a3a", "#b5653a", "#a33a2c", "#3d5f9e", "#3f7a4a", "#2b2b33", "#d9dde2", "#9aa3ad", "#c4b07a"],
} as const;

export const HAIR_STYLES = [
	"bald", "short", "cropped", "sidepart", "long", "ponytail", "braids", "bun", "topknot", "mohawk", "wild", "curly", "shaved_sides",
] as const;

export const HAIR_COLORS = [
	"#1c1714", "#3a2a1e", "#5a3a22", "#7a4e2a", "#a0672e", "#c48a3f", "#e0c070", "#efe0b0",
	"#a33a22", "#c95a2a", "#8a8a8a", "#d8d8d8", "#f2f2ee", "#2c3a5a", "#5a2a6a", "#2a5a4a",
] as const;

export const EYE_COLORS = [
	"#4a2e1a", "#6b4423", "#8a6a2a", "#3f6a3a", "#5a8a6a", "#3a5a8a", "#6a8ab0", "#7a7a7a",
	"#c8a030", "#d0402a", "#9a5ac8", "#e8e2c0",
] as const;

export const FACIAL_HAIR = ["none", "stubble", "mustache", "goatee", "short_beard", "full_beard", "braided_beard", "sideburns"] as const;

export const ACCESSORIES = ["none", "hood", "helmet", "circlet", "eyepatch", "scar", "earrings", "warpaint", "headband", "crown"] as const;

export const FEATURES = ["pointed_ears", "long_ears", "horns", "ram_horns", "tusks", "scales", "snout", "markings", "freckles", "solid_eyes", "whiskers_none"] as const;

export const BACKGROUNDS = ["crimson", "forest", "azure", "parchment", "slate", "violet", "ember", "teal", "night", "gold"] as const;

export const SPECIES_IDS = ["human", "elf", "dwarf", "halfling", "gnome", "orc", "half-orc", "half-elf", "tiefling", "dragonborn", "goliath"] as const;

export type PortraitOptionKey = "skinTone" | "hairStyle" | "hairColor" | "eyeColor" | "facialHair" | "accessory" | "features" | "background";

/** Allowed values for the setup wizard. */
export const portraitOptions: Record<PortraitOptionKey, readonly string[]> = {
	skinTone: [...SKIN_TONES.human, ...SKIN_TONES.tiefling, ...SKIN_TONES.orc, ...SKIN_TONES.goliath, ...SKIN_TONES.dragonborn],
	hairStyle: HAIR_STYLES,
	hairColor: HAIR_COLORS,
	eyeColor: EYE_COLORS,
	facialHair: FACIAL_HAIR,
	accessory: ACCESSORIES,
	features: FEATURES,
	background: BACKGROUNDS,
};

/** Skin tones appropriate for a species (wizard can show these first). */
export function skinTonesFor(speciesId?: string): readonly string[] {
	switch (normalizeSpecies(speciesId)) {
		case "tiefling": return [...SKIN_TONES.tiefling, ...SKIN_TONES.human.slice(2)];
		case "orc": return SKIN_TONES.orc;
		case "goliath": return SKIN_TONES.goliath;
		case "dragonborn": return SKIN_TONES.dragonborn;
		default: return SKIN_TONES.human;
	}
}

/** Features each species gets by default. */
export function speciesFeatures(speciesId?: string): string[] {
	switch (normalizeSpecies(speciesId)) {
		case "elf": return ["pointed_ears", "long_ears"];
		case "half-elf": return ["pointed_ears"];
		case "gnome": return ["pointed_ears"];
		case "halfling": return [];
		case "orc": return ["tusks", "pointed_ears"];
		case "half-orc": return ["tusks"];
		case "tiefling": return ["horns"];
		case "dragonborn": return ["scales", "snout", "horns"];
		case "goliath": return ["markings"];
		default: return [];
	}
}

export function normalizeSpecies(id?: string): string {
	const s = (id ?? "human").toLowerCase();
	if (s.includes("dragon")) return "dragonborn";
	if (s.includes("tiefling")) return "tiefling";
	if (s === "half-orc" || s === "halforc") return "half-orc";
	if (s.includes("orc")) return "orc";
	if (s === "half-elf" || s === "halfelf") return "half-elf";
	if (s.includes("elf") || s === "drow") return "elf";
	if (s.includes("dwarf") || s === "duergar") return "dwarf";
	if (s.includes("halfling")) return "halfling";
	if (s.includes("gnome")) return "gnome";
	if (s.includes("goliath")) return "goliath";
	return SPECIES_IDS.includes(s as (typeof SPECIES_IDS)[number]) ? s : "human";
}

function pickWeighted<T>(rng: Rng, items: [T, number][]): T {
	const total = items.reduce((a, [, w]) => a + w, 0);
	let x = rng.next() * total;
	for (const [v, w] of items) {
		x -= w;
		if (x <= 0) return v;
	}
	return items[items.length - 1][0];
}

/** A random, species-appropriate portrait spec. */
export function randomPortrait(rng: Rng, speciesId?: string): PortraitSpec {
	const sp = normalizeSpecies(speciesId);
	const seed = (rng.next() * 2 ** 32) >>> 0;
	const features = speciesFeatures(sp);
	if (sp === "tiefling" && rng.next() < 0.5) features.splice(features.indexOf("horns"), 1, "ram_horns");
	if (sp === "tiefling" && rng.next() < 0.35) features.push("solid_eyes");
	if (["human", "halfling", "gnome", "half-elf", "elf"].includes(sp) && rng.next() < 0.25) features.push("freckles");

	let hairStyle: string;
	let facialHair = "none";
	let hairColor = rng.pick(HAIR_COLORS.slice(0, 12));
	let eyeColor = rng.pick(EYE_COLORS.slice(0, 8));
	const skinTone = rng.pick(skinTonesFor(sp));

	switch (sp) {
		case "dragonborn":
			hairStyle = "bald";
			eyeColor = rng.pick(["#c8a030", "#d0402a", "#e8e2c0", "#5a8a6a"]);
			break;
		case "dwarf":
			hairStyle = pickWeighted(rng, [["long", 2], ["braids", 3], ["bald", 2], ["topknot", 1], ["short", 1], ["wild", 1]]);
			facialHair = pickWeighted(rng, [["braided_beard", 4], ["full_beard", 4], ["short_beard", 1], ["none", 0.6]]);
			break;
		case "elf":
			hairStyle = pickWeighted(rng, [["long", 4], ["ponytail", 2], ["braids", 2], ["sidepart", 1], ["topknot", 1]]);
			hairColor = rng.pick(["#efe0b0", "#e0c070", "#1c1714", "#d8d8d8", "#f2f2ee", "#a33a22", "#3a2a1e", "#2c3a5a"]);
			eyeColor = rng.pick([...EYE_COLORS.slice(2, 8), "#c8a030", "#9a5ac8"]);
			break;
		case "halfling":
			hairStyle = pickWeighted(rng, [["curly", 5], ["short", 2], ["wild", 1], ["bun", 1]]);
			facialHair = rng.next() < 0.15 ? "sideburns" : "none";
			break;
		case "gnome":
			hairStyle = pickWeighted(rng, [["wild", 4], ["curly", 2], ["bald", 1], ["topknot", 1], ["bun", 1]]);
			facialHair = pickWeighted(rng, [["none", 3], ["mustache", 1], ["short_beard", 1], ["full_beard", 1]]);
			hairColor = rng.pick([...HAIR_COLORS]);
			break;
		case "orc":
		case "half-orc":
			hairStyle = pickWeighted(rng, [["mohawk", 3], ["shaved_sides", 2], ["topknot", 2], ["bald", 2], ["long", 1], ["braids", 1]]);
			facialHair = pickWeighted(rng, [["none", 4], ["stubble", 2], ["goatee", 1], ["short_beard", 1]]);
			hairColor = rng.pick(["#1c1714", "#3a2a1e", "#5a3a22", "#8a8a8a"]);
			break;
		case "goliath":
			hairStyle = pickWeighted(rng, [["bald", 5], ["topknot", 1], ["shaved_sides", 1]]);
			facialHair = pickWeighted(rng, [["none", 4], ["short_beard", 1]]);
			break;
		case "tiefling":
			hairStyle = pickWeighted(rng, [["long", 3], ["sidepart", 2], ["wild", 1], ["ponytail", 1], ["short", 1], ["curly", 1]]);
			hairColor = rng.pick(["#1c1714", "#2c3a5a", "#5a2a6a", "#a33a22", "#3a2a1e", "#d8d8d8"]);
			eyeColor = rng.pick(["#c8a030", "#d0402a", "#e8e2c0", "#9a5ac8"]);
			break;
		default: {
			hairStyle = pickWeighted(rng, [["short", 3], ["cropped", 2], ["sidepart", 2], ["long", 3], ["ponytail", 2], ["braids", 1], ["bun", 1], ["curly", 2], ["wild", 1], ["bald", 0.7], ["shaved_sides", 0.7]]);
			facialHair = pickWeighted(rng, [["none", 5], ["stubble", 1.5], ["mustache", 0.7], ["goatee", 0.8], ["short_beard", 1.2], ["full_beard", 0.8], ["sideburns", 0.4]]);
		}
	}

	const accessory = pickWeighted(rng, [["none", 9], ["hood", 1.5], ["helmet", 1], ["circlet", 1], ["eyepatch", 0.5], ["scar", 1.5], ["earrings", 1], ["warpaint", sp === "orc" || sp === "half-orc" || sp === "goliath" ? 1.5 : 0.4], ["headband", 0.6]]);

	return {
		seed,
		skinTone,
		hairStyle,
		hairColor,
		eyeColor,
		facialHair,
		accessory,
		features,
		background: rng.pick(BACKGROUNDS),
	};
}

// ─── Derived traits (seed-driven details not in the spec) ────────────────

export type HeadShape = "oval" | "square" | "long" | "round" | "heart" | "draconic";
export type EyeShape = "almond" | "round" | "narrow" | "hooded";
export type NoseShape = "straight" | "broad" | "hooked" | "button" | "long";
export type MouthShape = "neutral" | "smile" | "smirk" | "stern" | "full";

export interface PortraitTraits {
	head: HeadShape;
	/** Head half-width at the cheekbones. */
	width: number;
	/** Jaw half-width. */
	jaw: number;
	/** Chin y. */
	chin: number;
	eye: EyeShape;
	eyeSpacing: number;
	eyeTilt: number;
	nose: NoseShape;
	noseSize: number;
	mouth: MouthShape;
	mouthWidth: number;
	browThick: number;
	browAngle: number;
	clothing: string;
	clothingTrim: string;
	clothingStyle: "tunic" | "armor" | "robe" | "leather" | "cloak";
	age: number; // 0 young … 1 old
	female: boolean;
}

const CLOTH = ["#6b2a2a", "#2f4a36", "#2c3b5c", "#5a4630", "#4a3a5a", "#3c3c40", "#7a5a2a", "#1f3a3f", "#5c2d44"];
const TRIM = ["#c9a24a", "#b8b8b8", "#8a5a2a", "#d8c8a0", "#9a3a2a"];

export function portraitTraits(spec: PortraitSpec, speciesHint?: string): PortraitTraits {
	const rng = new ArtRng(spec.seed);
	const feats = new Set(spec.features);
	const draconic = feats.has("scales") && feats.has("snout");
	const head: HeadShape = draconic ? "draconic" : rng.pick(["oval", "oval", "square", "long", "round", "heart"] as const);
	const sp = normalizeSpecies(speciesHint);
	const stocky = sp === "dwarf" || sp === "orc" || sp === "half-orc" || sp === "goliath" || feats.has("tusks");
	const small = sp === "halfling" || sp === "gnome";
	let width = 36 + rng.range(-2, 3);
	let jaw = { oval: 25, square: 31, long: 24, round: 29, heart: 20, draconic: 26 }[head] + rng.range(-2, 2);
	let chin = { oval: 150, square: 150, long: 156, round: 146, heart: 151, draconic: 160 }[head] + rng.range(-2, 2);
	if (stocky) { width += 2; jaw += 4; }
	if (small) { width += 1; chin -= 4; jaw += 1; }
	const female = rng.next() < 0.5;
	if (female && !stocky) { jaw -= 2.5; chin -= 1; }
	return {
		head,
		width,
		jaw,
		chin,
		eye: draconic ? "narrow" : rng.pick(["almond", "almond", "round", "narrow", "hooded"] as const),
		eyeSpacing: 15.5 + rng.range(-1.5, 1.5),
		eyeTilt: (sp === "elf" ? 4 : 0) + rng.range(-2, 3),
		nose: small && sp === "gnome" ? "long" : rng.pick(["straight", "straight", "broad", "hooked", "button"] as const),
		noseSize: rng.range(0.85, 1.2) * (sp === "gnome" ? 1.3 : 1),
		mouth: rng.pick(["neutral", "neutral", "smile", "smirk", "stern", "full"] as const),
		mouthWidth: 11 + rng.range(-1.5, 2.5),
		browThick: (stocky ? 3.6 : 2.4) + rng.range(-0.5, 0.8) - (female ? 0.6 : 0),
		browAngle: rng.range(-4, 6),
		clothing: rng.pick(CLOTH),
		clothingTrim: rng.pick(TRIM),
		clothingStyle: rng.pick(["tunic", "armor", "robe", "leather", "cloak"] as const),
		age: rng.next() < 0.75 ? rng.range(0, 0.4) : rng.range(0.5, 1),
		female,
	};
}

export const BACKGROUND_COLORS: Record<string, [string, string]> = {
	crimson: ["#7a2a2a", "#2a0e12"],
	forest: ["#3f5f3a", "#101c12"],
	azure: ["#3a5a8a", "#0e1628"],
	parchment: ["#c9b48a", "#5a4630"],
	slate: ["#5a6470", "#1a1e24"],
	violet: ["#5a3a7a", "#180e24"],
	ember: ["#b0602a", "#2a1008"],
	teal: ["#2f6a6a", "#0a1e20"],
	night: ["#2a3050", "#06080f"],
	gold: ["#b08a3a", "#2e2210"],
};
