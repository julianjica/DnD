import type { LocationKind, WorldLocation, WorldMap } from "../game/types";
import { Rng } from "../rules/dice";
import { fbm, hashString, makeNoise2D, ridged } from "./noise";

/**
 * Overworld: a procedural continent described only by {seed, terrain}. Both
 * `generateWorld` (where to put locations) and the WorldMap renderer (what to
 * paint) sample the same `worldTerrain` function, so they always agree.
 * Coordinates are normalized 0..1; the map is drawn at a 3:2 aspect ratio.
 */

export type Biome = WorldMap["terrain"]["biome"];

export const WORLD_ASPECT = 1.5;

export const SEA_LEVEL: Record<Biome, number> = {
	temperate: 0.43, arid: 0.34, frozen: 0.41, tropical: 0.47, volcanic: 0.45, mixed: 0.42,
};

export interface WorldSample {
	/** 0..1 elevation; below `seaLevel` is water. */
	elevation: number;
	/** 0..1 wetness (forests, swamps). */
	moisture: number;
	/** 0..1 ridge strength (mountain ranges). */
	ridge: number;
}

export interface WorldTerrain {
	seaLevel: number;
	biome: Biome;
	sample(x: number, y: number): WorldSample;
}

const cache = new Map<string, WorldTerrain>();

export function worldTerrain(world: Pick<WorldMap, "seed" | "terrain">): WorldTerrain {
	const key = `${world.seed}|${world.terrain.seaLevel}|${world.terrain.biome}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const nE = makeNoise2D(world.seed ^ 0xa11ce);
	const nR = makeNoise2D(world.seed ^ 0xbeef);
	const nM = makeNoise2D(world.seed ^ 0xc0ffee);
	const nW = makeNoise2D(world.seed ^ 0xd00d);
	const t: WorldTerrain = {
		seaLevel: world.terrain.seaLevel,
		biome: world.terrain.biome,
		sample(x: number, y: number): WorldSample {
			const X = x * 3 * WORLD_ASPECT, Y = y * 3;
			// domain warp for natural coastlines
			const wx = fbm(nW, X * 0.6, Y * 0.6, 2) * 0.6, wy = fbm(nW, X * 0.6 + 40, Y * 0.6 - 13, 2) * 0.6;
			const base = fbm(nE, X * 0.55 + wx, Y * 0.55 + wy, 5) * 0.5 + 0.5;
			const ridge = ridged(nR, X * 0.7 + wx, Y * 0.7 + wy, 4);
			// continent falloff (soft rounded rectangle)
			const dx = Math.abs(x - 0.5) * 2, dy = Math.abs(y - 0.5) * 2;
			const edge = Math.pow(Math.pow(dx, 4) + Math.pow(dy, 4), 0.25);
			const fall = Math.max(0, edge - 0.55) * 1.15;
			let e = base * 0.78 + 0.22 + (ridge - 0.5) * 0.3 * Math.max(0, base - 0.35) * 2 - fall;
			e = Math.max(0, Math.min(1, e));
			const moisture = Math.max(0, Math.min(1, fbm(nM, X * 0.8, Y * 0.8, 4) * 0.55 + 0.5 - (e - world.terrain.seaLevel) * 0.25));
			return { elevation: e, moisture, ridge };
		},
	};
	if (cache.size > 16) cache.clear();
	cache.set(key, t);
	return t;
}

/** Elevation above which the renderer draws mountains. */
export const mountainLine = (sea: number) => sea + (1 - sea) * 0.42;

const SYL_A = ["Ash", "Bel", "Cor", "Dun", "El", "Fen", "Gal", "Har", "Ir", "Kel", "Lor", "Mor", "Nar", "Or", "Pel", "Quar", "Ros", "Sar", "Thal", "Ul", "Val", "Wyn", "Yr", "Zan", "Brin", "Cald", "Drak", "Eld", "Gorm", "Hollow"];
const SYL_B = ["a", "e", "i", "o", "u", "ae", "ia", "en", "or", "ar", ""];
const SYL_C = ["dor", "mere", "wick", "ford", "gard", "holm", "mar", "reach", "vale", "stead", "moor", "fell", "crest", "haven", "spire", "watch", "barrow", "grove", "deep", "march"];

export function fantasyName(rng: Rng): string {
	return rng.pick(SYL_A) + rng.pick(SYL_B) + rng.pick(SYL_C);
}

const KIND_SUFFIX: Partial<Record<LocationKind, string[]>> = {
	dungeon: ["Halls of {n}", "{n} Undercroft", "The {n} Vaults"],
	cave: ["{n} Caverns", "{n} Hollows"],
	forest: ["{n} Wood", "The {n} Wilds", "{n} Forest"],
	mountain: ["Mount {n}", "{n} Peaks"],
	ruins: ["Ruins of {n}", "Old {n}"],
	castle: ["Castle {n}", "{n} Keep"],
	temple: ["Temple of {n}", "{n} Abbey"],
	swamp: ["{n} Fen", "{n} Mire"],
	coast: ["{n} Cove", "{n} Strand"],
	camp: ["{n} Camp"],
	tower: ["{n} Tower", "The Spire of {n}"],
	landmark: ["The {n} Stones", "{n} Monolith"],
};

function locationName(rng: Rng, kind: LocationKind): string {
	const n = fantasyName(rng);
	const forms = KIND_SUFFIX[kind];
	return forms ? rng.pick(forms).replace("{n}", n) : n;
}

/** Suitability of a terrain sample for a location kind (higher is better, -Infinity = never). */
function suitability(kind: LocationKind, s: WorldSample, sea: number): number {
	const land = s.elevation - sea;
	if (land < 0.012) return -Infinity;
	const ml = mountainLine(sea) - sea;
	switch (kind) {
		case "coast": return land < 0.05 ? 2 - land * 10 : -2;
		case "mountain": return land > ml * 0.9 ? 1 + land : -1 + land;
		case "swamp": return land < ml * 0.35 ? s.moisture * 2 : -1;
		case "forest": return land < ml ? s.moisture * 2 - 0.5 : -1;
		case "city": case "town": case "village": return land < ml * 0.55 ? 1 - land * 2 + (land < 0.06 ? 0.4 : 0) : -1;
		case "castle": case "tower": return land > ml * 0.3 && land < ml ? 1 : 0;
		case "cave": case "dungeon": return land > ml * 0.45 ? 1 : 0.2;
		default: return land < ml ? 0.5 : 0;
	}
}

const DEFAULT_KINDS: LocationKind[] = ["town", "village", "forest", "dungeon", "ruins", "cave", "castle", "mountain", "temple", "swamp", "coast", "tower"];

export interface GenerateWorldOptions {
	seed: number;
	biome: Biome;
	name?: string;
	locations?: { name: string; kind: LocationKind; description?: string }[];
	/** How many random locations when `locations` is omitted (default 9). */
	count?: number;
}

export function generateWorld(opts: GenerateWorldOptions): WorldMap {
	const seed = opts.seed >>> 0;
	const rng = new Rng((seed ^ hashString("world")) >>> 0 || 1);
	const seaLevel = SEA_LEVEL[opts.biome] ?? 0.42;
	const terrain = { seaLevel, biome: opts.biome };
	const T = worldTerrain({ seed, terrain });
	const specs = opts.locations?.length
		? opts.locations
		: (() => {
				const n = Math.max(3, Math.min(16, opts.count ?? 9));
				const kinds: LocationKind[] = ["town"];
				const pool = shuffled(rng, DEFAULT_KINDS.slice(1));
				while (kinds.length < n) kinds.push(pool[(kinds.length - 1) % pool.length]);
				return kinds.map((k) => ({ name: locationName(rng, k), kind: k, description: undefined as string | undefined }));
			})();

	const placed: WorldLocation[] = [];
	const minD = Math.max(0.1, 0.32 / Math.sqrt(specs.length));
	specs.forEach((spec, i) => {
		let best: { x: number; y: number; s: number } | undefined;
		for (let tries = 0; tries < 220; tries++) {
			const x = 0.08 + rng.next() * 0.84, y = 0.1 + rng.next() * 0.8;
			const s = T.sample(x, y);
			let score = suitability(spec.kind, s, seaLevel);
			if (!Number.isFinite(score)) continue;
			const near = placed.reduce((m, p) => Math.min(m, Math.hypot((p.x - x) * WORLD_ASPECT, p.y - y)), Infinity);
			if (near < minD) score -= (minD - near) * 30;
			if (i === 0) score -= Math.hypot(x - 0.5, y - 0.55) * 2; // start near the middle
			else if (near > minD * 3) score -= (near - minD * 3) * 3; // stay clustered
			if (!best || score > best.s) best = { x, y, s: score };
		}
		const p = best ?? { x: 0.5, y: 0.5, s: 0 };
		placed.push({
			id: `loc-${i + 1}`,
			name: spec.name,
			kind: spec.kind,
			x: round3(p.x),
			y: round3(p.y),
			discovered: i === 0,
			visited: i === 0,
			...(spec.description ? { description: spec.description } : {}),
			mapIds: [],
		});
	});

	// Routes: minimum spanning tree + a few extra short links.
	const routes: WorldMap["routes"] = [];
	const dist = (a: WorldLocation, b: WorldLocation) => Math.hypot((a.x - b.x) * WORLD_ASPECT, a.y - b.y);
	const inTree = new Set([0]);
	const edges: [number, number][] = [];
	while (inTree.size < placed.length) {
		let best: [number, number, number] | undefined;
		for (const i of inTree) for (let j = 0; j < placed.length; j++) {
			if (inTree.has(j)) continue;
			const d = dist(placed[i], placed[j]);
			if (!best || d < best[2]) best = [i, j, d];
		}
		if (!best) break;
		inTree.add(best[1]);
		edges.push([best[0], best[1]]);
	}
	const extra: [number, number, number][] = [];
	for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
		if (edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) continue;
		extra.push([i, j, dist(placed[i], placed[j])]);
	}
	extra.sort((a, b) => a[2] - b[2]);
	for (const [i, j] of extra.slice(0, Math.max(1, Math.floor(placed.length / 4)))) edges.push([i, j]);

	const settled = new Set<LocationKind>(["town", "city", "village", "castle"]);
	for (const [i, j] of edges) {
		const a = placed[i], b = placed[j];
		let water = 0;
		const steps = 24;
		for (let s = 1; s < steps; s++) {
			const t = s / steps;
			if (T.sample(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t).elevation < seaLevel) water++;
		}
		const kind: WorldMap["routes"][number]["kind"] = water > steps * 0.35 ? "sea" : settled.has(a.kind) && settled.has(b.kind) ? "road" : settled.has(a.kind) || settled.has(b.kind) ? (rng.next() < 0.5 ? "road" : "trail") : "trail";
		const d = dist(a, b);
		const speed = kind === "road" ? 1.25 : kind === "sea" ? 1.6 : 1;
		routes.push({ id: `route-${routes.length + 1}`, from: a.id, to: b.id, kind, travelDays: Math.max(1, Math.round((d * 14) / speed)), discovered: false });
	}
	// The start and its direct neighbours are known.
	for (const r of routes) {
		if (r.from === placed[0].id || r.to === placed[0].id) {
			r.discovered = true;
			for (const l of placed) if (l.id === r.from || l.id === r.to) l.discovered = true;
		}
	}
	return {
		seed,
		name: opts.name ?? `The ${rng.pick(["Realm", "Kingdom", "Marches", "Reaches", "Dominion", "Free Lands"])} of ${fantasyName(rng)}`,
		terrain,
		locations: placed,
		routes,
		currentLocationId: placed[0]?.id,
	};
}

function shuffled<T>(rng: Rng, a: T[]): T[] {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng.next() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
