import type { Mood, SceneKind, SceneState, TimeOfDay, Weather } from "../game/types";
import data from "./backdrops.json";

/**
 * Public-domain paintings used as scene backdrops (see scripts/scenes and
 * ASSETS.md). Picked by scene kind, then time of day, weather and mood;
 * the choice is stable for a given scene title so revisiting a place shows
 * the same painting.
 */
export interface Backdrop {
	file: string;
	kind: SceneKind;
	time: TimeOfDay[];
	weather: Weather[];
	mood: Mood[];
	interior: boolean;
	focusY?: number;
	monochrome?: boolean;
	title: string;
	artist: string;
	year?: string;
	source: string;
	license: string;
}

export const BACKDROPS = data as Backdrop[];

/** Close substitutes when a kind has no paintings (or too few). */
const FALLBACK: Partial<Record<SceneKind, SceneKind[]>> = {
	underdark: ["cave", "dungeon"],
	crypt: ["dungeon", "temple"],
	dungeon: ["crypt", "cave"],
	cave: ["underdark", "dungeon"],
	plains: ["road", "camp"],
	road: ["plains", "forest"],
	camp: ["forest", "plains"],
	ship: ["coast"],
	coast: ["ship"],
	swamp: ["forest", "plains"],
	desert: ["plains", "mountain"],
	castle: ["town", "mountain"],
	town: ["castle", "road"],
	tavern: ["town"],
	temple: ["crypt", "castle"],
	mountain: ["plains"],
	forest: ["road"],
};

function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

export function pickBackdrop(scene: Pick<SceneState, "kind" | "title" | "timeOfDay" | "weather" | "mood">, pool: Backdrop[] = BACKDROPS): Backdrop | undefined {
	const kinds = [scene.kind, ...(FALLBACK[scene.kind] ?? [])];
	for (const k of kinds) {
		const cands = pool.filter((b) => b.kind === k);
		if (!cands.length) continue;
		const scored = cands.map((b) => ({
			b,
			s: (b.time.includes(scene.timeOfDay) ? 3 : 0) + (b.weather.includes(scene.weather) ? 2 : 0) + (b.mood.includes(scene.mood) ? 1 : 0),
		}));
		const best = Math.max(...scored.map((x) => x.s));
		// Anything within 1 point of the best is acceptable; the title picks among them.
		const ok = scored.filter((x) => x.s >= best - 1).map((x) => x.b);
		return ok[hash(`${scene.title}|${k}`) % ok.length];
	}
	return undefined;
}
