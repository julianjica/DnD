import type { Mood, SceneKind, SceneState, TimeOfDay, Weather } from "../game/types";
import { mix, shade } from "./color";
import { hashString } from "./rand";

/** Canvas size of the scene SVG (16:9). */
export const SCENE_W = 1600;
export const SCENE_H = 900;

export const SCENE_KINDS: SceneKind[] = [
	"tavern", "town", "forest", "dungeon", "cave", "mountain", "coast", "swamp", "desert", "castle", "temple", "camp", "road", "crypt", "plains", "ship", "underdark",
];
export const TIMES: TimeOfDay[] = ["dawn", "day", "dusk", "night"];
export const WEATHERS: Weather[] = ["clear", "cloudy", "rain", "storm", "fog", "snow"];
export const MOODS: Mood[] = ["calm", "mysterious", "tense", "combat", "triumphant", "somber", "festive", "eerie"];

/** Prop vocabulary understood by SceneArt (`SceneState.props`). */
export const SCENE_PROPS = [
	"campfire", "altar", "statue", "cart", "tents", "torches", "barrels", "crates", "well", "signpost", "banners", "boat",
	"lanterns", "bones", "chest", "throne", "fountain", "gravestones", "ruins", "standing_stones", "candles", "crystals",
	"mushrooms", "cauldron", "portal", "bridge",
] as const;
export type SceneProp = (typeof SCENE_PROPS)[number];

const PROP_ALIASES: Record<string, SceneProp> = {
	fire: "campfire", bonfire: "campfire", wagon: "cart", tent: "tents", torch: "torches", barrel: "barrels", crate: "crates",
	sign: "signpost", banner: "banners", ship: "boat", rowboat: "boat", lantern: "lanterns", skull: "bones", skulls: "bones",
	treasure: "chest", grave: "gravestones", graves: "gravestones", tombstones: "gravestones", stones: "standing_stones",
	candle: "candles", crystal: "crystals", mushroom: "mushrooms", pot: "cauldron", shrine: "altar", idol: "statue",
};

/** Normalizes free-form prop names to the known vocabulary (unknown props dropped). */
export function normalizeProps(props: string[]): SceneProp[] {
	const out: SceneProp[] = [];
	for (const p of props) {
		const k = p.toLowerCase().trim().replace(/[\s-]+/g, "_");
		const v = (SCENE_PROPS as readonly string[]).includes(k) ? (k as SceneProp) : PROP_ALIASES[k] ?? PROP_ALIASES[k.replace(/s$/, "")];
		if (v && !out.includes(v)) out.push(v);
	}
	return out;
}

export const INTERIOR_KINDS: SceneKind[] = ["tavern", "dungeon", "crypt", "cave", "temple", "underdark"];
export function isInterior(kind: SceneKind): boolean {
	return INTERIOR_KINDS.includes(kind);
}

export function sceneSeed(scene: Pick<SceneState, "title" | "kind">): number {
	return hashString(`${scene.title}|${scene.kind}`);
}

export interface SkyPalette {
	zenith: string;
	mid: string;
	horizon: string;
	/** Sun or moon disc color. */
	light: string;
	/** Color used to tint distant layers (atmospheric perspective). */
	haze: string;
	/** Darkening applied to land layers. 0 = full day … 1 = night. */
	dark: number;
	night: boolean;
	/** Sun/moon height above horizon in 0..1 (0 = at horizon). */
	lightHeight: number;
	/** Light disc visible through weather. */
	lightVisible: boolean;
	cloudColor: string;
	cloudShadow: string;
}

const BASE_SKY: Record<TimeOfDay, Omit<SkyPalette, "lightVisible" | "cloudColor" | "cloudShadow">> = {
	dawn: { zenith: "#22305e", mid: "#8a6a9a", horizon: "#f6b08e", light: "#ffe2b0", haze: "#e8a898", dark: 0.25, night: false, lightHeight: 0.12 },
	day: { zenith: "#2f6fbf", mid: "#78acdf", horizon: "#d8ecf2", light: "#fff8e0", haze: "#b8d4e4", dark: 0, night: false, lightHeight: 0.75 },
	dusk: { zenith: "#1c1740", mid: "#843c6a", horizon: "#f38a4c", light: "#ffc070", haze: "#c0607a", dark: 0.35, night: false, lightHeight: 0.1 },
	night: { zenith: "#03050c", mid: "#0c1630", horizon: "#22345a", light: "#eef3fb", haze: "#1c2a48", dark: 0.72, night: true, lightHeight: 0.62 },
};

const WEATHER_TINT: Record<Weather, [string, number] | null> = {
	clear: null,
	cloudy: ["#8c939c", 0.3],
	rain: ["#56606c", 0.55],
	storm: ["#262c38", 0.68],
	fog: ["#b4b8bc", 0.6],
	snow: ["#c4ccd6", 0.45],
};

export function skyPalette(time: TimeOfDay, weather: Weather): SkyPalette {
	const b = BASE_SKY[time];
	const tint = WEATHER_TINT[weather];
	const t = (c: string, k = 1) => {
		if (!tint) return c;
		const tc = b.night ? shade(tint[0], -0.42, false) : tint[0];
		return mix(c, tc, tint[1] * k);
	};
	const heavy = weather === "rain" || weather === "storm" || weather === "fog";
	return {
		...b,
		zenith: t(b.zenith),
		mid: t(b.mid),
		horizon: t(b.horizon, 0.9),
		haze: t(b.haze),
		dark: Math.min(0.85, b.dark + (weather === "storm" ? 0.25 : weather === "rain" ? 0.12 : 0)),
		lightVisible: !heavy,
		cloudColor: t(b.night ? "#2a3550" : time === "dusk" ? "#f0a088" : time === "dawn" ? "#f8c8b8" : "#f4f6fa"),
		cloudShadow: t(b.night ? "#121a2c" : time === "dusk" ? "#5a3060" : time === "dawn" ? "#806080" : "#a8b4c8"),
	};
}

/** Ground base colors for outdoor kinds (daylight). */
export const GROUND: Record<SceneKind, string> = {
	tavern: "#4a3020", town: "#55703a", forest: "#2c4a2a", dungeon: "#3a3a40", cave: "#3a3430", mountain: "#58606a",
	coast: "#6a7a48", swamp: "#3c4628", desert: "#c9a062", castle: "#4c6038", temple: "#5a5650", camp: "#3c5a2e",
	road: "#5c7838", crypt: "#34363a", plains: "#6f8e3a", ship: "#5a3e26", underdark: "#22202c",
};

/** Apply time-of-day light + atmospheric depth (0 near … 1 far) to a land color. */
export function landColor(base: string, pal: SkyPalette, depth: number, snow = false): string {
	let c = snow ? mix(base, "#e8eef4", 0.65) : base;
	c = mix(c, pal.haze, Math.min(0.85, depth * 0.72));
	c = mix(c, pal.night ? "#070b16" : "#1a1020", pal.dark * (1 - depth * 0.35));
	return c;
}

export interface MoodGrade {
	/** soft-light overlay color + opacity */
	tint: string;
	tintOpacity: number;
	/** saturation reduction 0..1 */
	desat: number;
	vignette: number;
	vignetteColor: string;
	/** extra bloom/glow color near light sources */
	glow?: string;
}

export const MOOD_GRADES: Record<Mood, MoodGrade> = {
	calm: { tint: "#ffd8a0", tintOpacity: 0.12, desat: 0, vignette: 0.45, vignetteColor: "#000000" },
	mysterious: { tint: "#3a5a9a", tintOpacity: 0.32, desat: 0.15, vignette: 0.6, vignetteColor: "#06081a" },
	tense: { tint: "#6a4a3a", tintOpacity: 0.3, desat: 0.35, vignette: 0.75, vignetteColor: "#0a0505" },
	combat: { tint: "#c03020", tintOpacity: 0.28, desat: 0.15, vignette: 0.8, vignetteColor: "#2a0000" },
	triumphant: { tint: "#ffc040", tintOpacity: 0.3, desat: 0, vignette: 0.35, vignetteColor: "#1a1000", glow: "#ffd880" },
	somber: { tint: "#5a6a80", tintOpacity: 0.35, desat: 0.55, vignette: 0.65, vignetteColor: "#05070c" },
	festive: { tint: "#ff7a50", tintOpacity: 0.22, desat: 0, vignette: 0.35, vignetteColor: "#100008", glow: "#ffb070" },
	eerie: { tint: "#40a070", tintOpacity: 0.3, desat: 0.4, vignette: 0.8, vignetteColor: "#000a05" },
};
