import type { LocationKind, TerrainFeature, TerrainKind, WorldLocation, WorldMap } from "../game/types";
import { Rng } from "../rules/dice";
import { hashString } from "./noise";
import { landNear, WORLD_ASPECT } from "./world";

/**
 * Keeps the world map consistent with the story: travel times set distances,
 * compass directions set bearings, and narrated terrain (marshes, forests…)
 * is painted where the DM says it is. Map units: x is 0..1 across a 3:2 map,
 * so horizontal distances are scaled by WORLD_ASPECT.
 */

type RouteKind = WorldMap["routes"][number]["kind"];

/** Map distance covered in one day (same scale generateWorld uses for travelDays). */
const SPEED: Record<RouteKind, number> = { road: 1.25, trail: 1, river: 1.4, sea: 1.6 };
export function distanceForDays(days: number, kind: RouteKind = "trail"): number {
	return Math.max(0.012, (days * SPEED[kind]) / 14);
}
export function daysForDistance(d: number, kind: RouteKind = "trail"): number {
	return Math.max(0.1, Math.round(((d * 14) / SPEED[kind]) * 10) / 10);
}

export function mapDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
	return Math.hypot((b.x - a.x) * WORLD_ASPECT, b.y - a.y);
}

export type Compass = "north" | "northeast" | "east" | "southeast" | "south" | "southwest" | "west" | "northwest";
/** Screen angle (y grows downward): north = -90°. */
export const BEARING: Record<Compass, number> = {
	east: 0, southeast: Math.PI / 4, south: Math.PI / 2, southwest: (3 * Math.PI) / 4,
	west: Math.PI, northwest: (-3 * Math.PI) / 4, north: -Math.PI / 2, northeast: -Math.PI / 4,
};
const COMPASS_ORDER: Compass[] = ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"];

export function bearingOf(a: { x: number; y: number }, b: { x: number; y: number }): number {
	return Math.atan2(b.y - a.y, (b.x - a.x) * WORLD_ASPECT);
}
export function compassOf(a: { x: number; y: number }, b: { x: number; y: number }): Compass {
	const ang = bearingOf(a, b);
	return COMPASS_ORDER[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}
export function angleDiff(a: number, b: number): number {
	const d = Math.abs(a - b) % (Math.PI * 2);
	return d > Math.PI ? Math.PI * 2 - d : d;
}

/** Case-insensitive whole-word regex that understands accented letters. */
const words = (src: string) => new RegExp(`(?<!\\p{L})(?:${src})(?!\\p{L})`, "iu");

const DIR_WORDS: [Compass, RegExp][] = [
	["northeast", words("north[- ]?east(ern)?|nor[d]?este|nororiente")],
	["northwest", words("north[- ]?west(ern)?|noroeste|norponiente")],
	["southeast", words("south[- ]?east(ern)?|sureste|sudeste")],
	["southwest", words("south[- ]?west(ern)?|suroeste|sudoeste")],
	["north", words("north(ern|ward)?|norte|septentrional")],
	["south", words("south(ern|ward)?|sur|meridional")],
	["east", words("east(ern|ward)?|(al|hacia el|del|por el|en el) este|oriente|levante")],
	["west", words("west(ern|ward)?|oeste|occidente|poniente")],
];
/** First compass direction named in a text ("al noreste", "north of the marsh"). */
export function directionFromText(text: string | undefined): Compass | undefined {
	if (!text) return undefined;
	let best: { c: Compass; i: number } | undefined;
	for (const [c, re] of DIR_WORDS) {
		const m = re.exec(text);
		if (m && (!best || m.index < best.i)) best = { c, i: m.index };
	}
	return best?.c;
}

const TERRAIN_WORDS: [TerrainKind, RegExp][] = [
	["marsh", words("marsh(y|es|land)?|swamp(y|s)?|bog(s)?|fen(s)?|mire|wetlands?|pantano(s)?|ciénaga(s)?|marisma(s)?|humedal(es)?|lodazal|turbera")],
	["forest", words("forest(s)?|wood(s|land)?|grove|thicket|bosque(s)?|selva|arboleda|espesura")],
	["mountains", words("mountain(s)?|peak(s)?|crag(s)?|canyon(s)?|monta(ñ|n)a(s)?|pico(s)?|cumbre(s)?|cañon(es)?|cañón|sierra|cordillera|riscos?")],
	["hills", words("hill(s|y)?|downs|highlands?|colina(s)?|cerro(s)?|loma(s)?|páramo(s)?")],
	["desert", words("desert(s)?|dune(s)?|wastes?|badlands|desierto(s)?|duna(s)?|yermo(s)?|erial")],
	["plains", words("plain(s)?|farmland(s)?|fields|meadow(s)?|prairie|steppe|llanura(s)?|campos|pradera(s)?|estepa|vega")],
];
const KIND_TERRAIN: Partial<Record<LocationKind, TerrainKind>> = { swamp: "marsh", forest: "forest", mountain: "mountains" };

/** Terrain implied by a place's kind or description, if any. */
export function terrainFor(kind: LocationKind, description?: string): TerrainKind | undefined {
	if (KIND_TERRAIN[kind]) return KIND_TERRAIN[kind];
	if (!description) return undefined;
	let best: { t: TerrainKind; i: number } | undefined;
	for (const [t, re] of TERRAIN_WORDS) {
		const m = re.exec(description);
		if (!m) continue;
		// "north of the marsh" / "al norte del pantano" places it NEXT to that terrain, not in it.
		const before = description.slice(Math.max(0, m.index - 28), m.index);
		if (DIR_WORDS.some(([, d]) => d.test(before)) || /\b(beyond|across|past|más allá|al otro lado|tras)\b/i.test(before)) continue;
		if (!best || m.index < best.i) best = { t, i: m.index };
	}
	return best?.t;
}

let featureSeq = 0;
/** Adds narrated terrain unless the same terrain already covers that spot. */
export function addTerrainFeature(world: WorldMap, f: Omit<TerrainFeature, "id">): TerrainFeature {
	const list = (world.terrain.features ??= []);
	const dup = list.find((g) => g.terrain === f.terrain && mapDistance(g, f) < Math.max(g.r, f.r) * 0.6);
	if (dup) {
		if (f.name && !dup.name) dup.name = f.name;
		dup.r = Math.max(dup.r, f.r);
		return dup;
	}
	const feat = { id: `tf-${Date.now().toString(36)}-${(featureSeq++).toString(36)}`, ...f };
	list.push(feat);
	return feat;
}

export const REGION_SIZE = { small: 0.035, medium: 0.06, large: 0.1 } as const;

/** "halfway between A and B" / "a medio camino entre A y B" → the two places, if both are known. */
export function betweenFromText(world: WorldMap, text: string | undefined, self?: WorldLocation): [WorldLocation, WorldLocation] | undefined {
	if (!text || !words("halfway|midway|between|a medio camino|a mitad de camino|entre").test(text)) return undefined;
	const named = world.locations
		.filter((l) => l !== self && l.name.length > 2)
		.map((l) => ({ l, i: text.toLowerCase().indexOf(l.name.toLowerCase()) }))
		.filter((x) => x.i >= 0)
		.sort((a, b) => a.i - b.i);
	return named.length >= 2 ? [named[0].l, named[1].l] : undefined;
}

export interface PlaceSpec {
	anchor?: { x: number; y: number };
	days?: number;
	routeKind?: RouteKind;
	direction?: Compass;
	between?: [{ x: number; y: number }, { x: number; y: number }];
	kind?: LocationKind;
	/** Bearing to keep when no direction was narrated (slide closer/farther, don't flip sides). */
	keepBearing?: number;
}

/** Where a place should go given the story's constraints; always on land. */
export function placeFor(world: WorldMap, rng: Rng, spec: PlaceSpec, avoid: { x: number; y: number }[]): { x: number; y: number } {
	if (spec.between) {
		const [a, b] = spec.between;
		const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		return landNear(world, mid, rng, { kind: spec.kind, minDist: 0, maxDist: Math.max(0.02, mapDistance(a, b) * 0.12), avoid });
	}
	const anchor = spec.anchor ?? { x: 0.5, y: 0.5 };
	const d = distanceForDays(spec.days ?? 1, spec.routeKind ?? "trail");
	return landNear(world, anchor, rng, {
		kind: spec.kind,
		minDist: d * 0.8,
		maxDist: d * 1.2,
		avoid,
		bearing: spec.direction ? BEARING[spec.direction] : spec.keepBearing,
	});
}

/** Does a location's position honor its constraints (±45° bearing, distance within ×1.6)? */
export function fits(loc: { x: number; y: number }, spec: PlaceSpec): boolean {
	if (spec.between) {
		const [a, b] = spec.between;
		const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		return mapDistance(loc, mid) <= Math.max(0.03, mapDistance(a, b) * 0.25);
	}
	if (!spec.anchor) return true;
	const d = mapDistance(spec.anchor, loc);
	if (spec.days !== undefined) {
		const want = distanceForDays(spec.days, spec.routeKind ?? "trail");
		if (d > want * 1.6 + 0.01 || d < want / 1.6 - 0.01) return false;
	}
	if (spec.direction && angleDiff(bearingOf(spec.anchor, loc), BEARING[spec.direction]) > Math.PI / 8) return false;
	return true;
}

/** Re-times undiscovered routes touching a moved location so they match the map. */
export function retimeRoutes(world: WorldMap, locId: string): void {
	const byId = new Map(world.locations.map((l) => [l.id, l]));
	for (const r of world.routes) {
		if (r.discovered || (r.from !== locId && r.to !== locId)) continue;
		const a = byId.get(r.from), b = byId.get(r.to);
		if (a && b) r.travelDays = Math.max(1, Math.round(daysForDistance(mapDistance(a, b), r.kind)));
	}
}

/**
 * One-time repair for worlds saved before geography was enforced: walks the
 * discovered routes outward from the starting town, moves DM-described places
 * that contradict their stated direction / "halfway between" / travel time,
 * and paints the terrain their descriptions mention.
 */
const RECONCILE_VERSION = 2;

export function reconcileWorld(world: WorldMap): boolean {
	if ((world.reconciled ?? 0) >= RECONCILE_VERSION) return false;
	const rng = new Rng((world.seed ^ hashString("reconcile")) >>> 0 || 1);
	// v1 painted terrain at positions that v2 may move; drop those (unnamed) patches and repaint below.
	if (world.reconciled === 1 && world.terrain.features) world.terrain.features = world.terrain.features.filter((f) => f.name);
	const byId = new Map(world.locations.map((l) => [l.id, l]));
	const root = byId.get("loc-1") ?? world.locations.find((l) => l.visited) ?? world.locations[0];
	const routes = world.routes.filter((r) => r.discovered);
	const fixed = new Set<string>(root ? [root.id] : []);
	const queue = root ? [root] : [];
	while (queue.length) {
		const p = queue.shift()!;
		for (const r of routes) {
			const cid = r.from === p.id ? r.to : r.to === p.id ? r.from : undefined;
			if (!cid || fixed.has(cid)) continue;
			const c = byId.get(cid);
			if (!c) continue;
			fixed.add(cid);
			queue.push(c);
			// Only places the DM described carry narrative constraints.
			if (!c.description) continue;
			const between = betweenFromText(world, c.description, c);
			const spec: PlaceSpec = between
				? { between, kind: c.kind }
				: { anchor: p, days: r.travelDays, routeKind: r.kind, direction: directionFromText(c.description), kind: c.kind, keepBearing: bearingOf(p, c) };
			if (!fits(c, spec)) {
				const pos = placeFor(world, rng, spec, world.locations.filter((o) => o !== c));
				c.x = pos.x;
				c.y = pos.y;
				retimeRoutes(world, c.id);
			}
		}
	}
	for (const l of world.locations) {
		if (!l.discovered) continue;
		const t = terrainFor(l.kind, l.description);
		if (t) addTerrainFeature(world, { terrain: t, x: l.x, y: l.y, r: t === "mountains" ? 0.07 : 0.05 });
	}
	world.reconciled = RECONCILE_VERSION;
	return true;
}
