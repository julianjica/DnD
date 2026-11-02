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
	const feats = world.terrain.features ?? [];
	const key = `${world.seed}|${world.terrain.seaLevel}|${world.terrain.biome}|${feats.map((f) => `${f.terrain}:${f.x},${f.y},${f.r}`).join(";")}`;
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
			let moisture = Math.max(0, Math.min(1, fbm(nM, X * 0.8, Y * 0.8, 4) * 0.55 + 0.5 - (e - world.terrain.seaLevel) * 0.25));
			// Narrated terrain: blend each feature in with a soft, noisy edge. Never turns land into sea or sea into land.
			if (feats.length) {
				const sea = world.terrain.seaLevel;
				const ml = mountainLine(sea);
				const wasLand = e >= sea;
				for (const f of feats) {
					const d = Math.hypot((x - f.x) * WORLD_ASPECT, y - f.y) / (f.r * (0.85 + 0.3 * (fbm(nW, X * 2 + f.x * 9, Y * 2 + f.y * 9, 2) * 0.5 + 0.5)));
					if (d >= 1) continue;
					const w = 1 - d * d * (3 - 2 * d); // smoothstep falloff
					const mix = (a: number, b: number) => a + (b - a) * w;
					switch (f.terrain) {
						case "marsh": e = mix(e, Math.min(e, sea + 0.03)); moisture = mix(moisture, 0.93); break;
						case "forest": moisture = mix(moisture, 0.82); if (e > ml - 0.02) e = mix(e, ml - 0.04); break;
						case "hills": e = mix(e, Math.max(e, ml - 0.035)); break;
						case "mountains": e = mix(e, Math.max(e, ml + 0.1)); break;
						case "plains": moisture = mix(moisture, 0.42); e = mix(e, Math.min(e, sea + 0.12)); break;
						case "desert": moisture = mix(moisture, 0.08); e = mix(e, Math.min(e, ml - 0.1)); break;
					}
				}
				if (wasLand) e = Math.max(e, sea + 0.016);
				else e = Math.min(e, sea - 0.001);
			}
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

const KIND_SUFFIX_ES: Partial<Record<LocationKind, string[]>> = {
	dungeon: ["Salas de {n}", "Criptas de {n}", "Las bóvedas de {n}"],
	cave: ["Cavernas de {n}", "Grutas de {n}"],
	forest: ["Bosque de {n}", "Las espesuras de {n}", "Selva de {n}"],
	mountain: ["Monte {n}", "Picos de {n}"],
	ruins: ["Ruinas de {n}", "Antigua {n}"],
	castle: ["Castillo de {n}", "Fortaleza de {n}"],
	temple: ["Templo de {n}", "Abadía de {n}"],
	swamp: ["Ciénaga de {n}", "Pantano de {n}"],
	coast: ["Cala de {n}", "Playa de {n}"],
	camp: ["Campamento {n}"],
	tower: ["Torre de {n}", "La aguja de {n}"],
	landmark: ["Las piedras de {n}", "Monolito de {n}"],
};

function locationName(rng: Rng, kind: LocationKind, lang: "en" | "es" = "en"): string {
	const n = fantasyName(rng);
	const forms = (lang === "es" ? KIND_SUFFIX_ES : KIND_SUFFIX)[kind];
	return forms ? rng.pick(forms).replace("{n}", n) : n;
}

/** Suitability of a terrain sample for a location kind (higher is better, -Infinity = never). */
function suitability(kind: LocationKind, s: WorldSample, sea: number): number {
	const land = s.elevation - sea;
	if (land < LAND_MARGIN) return -Infinity;
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

/** Minimum elevation above sea level for a location to count as on land. */
export const LAND_MARGIN = 0.015;

export function isLand(world: Pick<WorldMap, "seed" | "terrain">, x: number, y: number): boolean {
	const T = worldTerrain(world);
	return T.sample(x, y).elevation >= T.seaLevel + LAND_MARGIN;
}

/**
 * Finds a land position near `anchor` (an annulus of minDist..maxDist), best
 * suited to `kind` and not on top of `avoid`. Widens the search until it finds
 * land; never returns a water square unless the whole world is ocean.
 */
export function landNear(
	world: Pick<WorldMap, "seed" | "terrain">,
	anchor: { x: number; y: number },
	rng: Rng,
	opts: { kind?: LocationKind; minDist?: number; maxDist?: number; avoid?: { x: number; y: number }[]; bearing?: number } = {},
): { x: number; y: number; s: number } {
	const T = worldTerrain(world);
	const sea = T.seaLevel;
	const avoid = opts.avoid ?? [];
	let minD = opts.minDist ?? 0;
	let maxD = opts.maxDist ?? 0.12;
	// Don't let "avoid other places" push a very close place (a stone's throw) away.
	const crowdR = Math.min(0.04, Math.max(0.006, (minD + maxD) * 0.3));
	for (let ring = 0; ring < 6; ring++) {
		let best: { x: number; y: number; s: number } | undefined;
		// With a bearing, stay within a cone that widens each ring (±25°, ±40°, …).
		// Keep the direction first (try closer), only then widen the cone.
		const cone = opts.bearing === undefined ? Math.PI * 2 : Math.min(Math.PI * 2, 0.6 + Math.max(0, ring - 2) * 0.5);
		for (let i = 0; i < 80; i++) {
			const ang = opts.bearing === undefined ? rng.next() * Math.PI * 2 : opts.bearing + (rng.next() - 0.5) * cone;
			const d = minD + rng.next() * (maxD - minD);
			const x = round3(Math.min(0.95, Math.max(0.05, anchor.x + (Math.cos(ang) * d) / WORLD_ASPECT)));
			const y = round3(Math.min(0.94, Math.max(0.06, anchor.y + Math.sin(ang) * d)));
			const smp = T.sample(x, y);
			if (smp.elevation < sea + LAND_MARGIN) continue;
			let score = opts.kind ? suitability(opts.kind, smp, sea) : 0;
			if (!Number.isFinite(score)) score = -5;
			const crowd = avoid.reduce((m, p) => Math.min(m, Math.hypot((p.x - x) * WORLD_ASPECT, p.y - y)), Infinity);
			if (crowd < crowdR) score -= (crowdR - crowd) * 60;
			score -= Math.hypot((x - anchor.x) * WORLD_ASPECT, y - anchor.y) * 4;
			if (!best || score > best.s) best = { x, y, s: score };
		}
		if (best) return best;
		if (opts.bearing === undefined) {
			minD = 0;
			maxD = Math.min(1.2, maxD * 2);
		} else if (ring < 2) {
			minD *= 0.65;
			maxD *= 0.8;
		} else maxD = Math.min(1.2, maxD * 1.35);
	}
	// Last resort: global scan for the highest point.
	let top = { x: 0.5, y: 0.5, s: -Infinity };
	for (let gy = 0.06; gy < 0.95; gy += 0.02)
		for (let gx = 0.05; gx < 0.96; gx += 0.02) {
			const e = T.sample(gx, gy).elevation;
			if (e > top.s) top = { x: round3(gx), y: round3(gy), s: e };
		}
	return top;
}

/**
 * Moves any location that sits in the sea onto the nearest land. Idempotent;
 * returns true when something moved. Repairs worlds saved before placement
 * was terrain-aware.
 */
export function repairWorld(world: WorldMap): boolean {
	let moved = false;
	const rng = new Rng((world.seed ^ hashString("repair")) >>> 0 || 1);
	for (const l of world.locations) {
		if (isLand(world, l.x, l.y)) continue;
		const p = landNear(world, l, rng, { kind: l.kind, maxDist: 0.05, avoid: world.locations.filter((o) => o !== l) });
		l.x = p.x;
		l.y = p.y;
		moved = true;
	}
	return moved;
}

const DEFAULT_KINDS: LocationKind[] = ["town", "village", "forest", "dungeon", "ruins", "cave", "castle", "mountain", "temple", "swamp", "coast", "tower"];

export interface GenerateWorldOptions {
	seed: number;
	biome: Biome;
	name?: string;
	locations?: { name: string; kind: LocationKind; description?: string }[];
	/** Language for generated place names (default English). */
	lang?: "en" | "es";
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
				return kinds.map((k) => ({ name: locationName(rng, k, opts.lang), kind: k, description: undefined as string | undefined }));
			})();

	const placed: WorldLocation[] = [];
	const minD = Math.max(0.1, 0.32 / Math.sqrt(specs.length));
	specs.forEach((spec, i) => {
		let best: { x: number; y: number; s: number } | undefined;
		for (let tries = 0; tries < 220; tries++) {
			const x = round3(0.08 + rng.next() * 0.84), y = round3(0.1 + rng.next() * 0.8);
			const s = T.sample(x, y);
			let score = suitability(spec.kind, s, seaLevel);
			if (!Number.isFinite(score)) continue;
			const near = placed.reduce((m, p) => Math.min(m, Math.hypot((p.x - x) * WORLD_ASPECT, p.y - y)), Infinity);
			if (near < minD) score -= (minD - near) * 30;
			if (i === 0) score -= Math.hypot(x - 0.5, y - 0.55) * 2; // start near the middle
			else if (near > minD * 3) score -= (near - minD * 3) * 3; // stay clustered
			if (!best || score > best.s) best = { x, y, s: score };
		}
		const p = best ?? landNear({ seed, terrain }, { x: 0.5, y: 0.5 }, rng, { kind: spec.kind });
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
		name:
			opts.name ??
			(opts.lang === "es"
				? `${rng.pick(["El Reino", "El Señorío", "Las Marcas", "Los Confines", "El Dominio", "Las Tierras Libres"])} de ${fantasyName(rng)}`
				: `The ${rng.pick(["Realm", "Kingdom", "Marches", "Reaches", "Dominion", "Free Lands"])} of ${fantasyName(rng)}`),
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
