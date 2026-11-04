import type { GridMap, MapEntity, Tile } from "../game/types";

/**
 * Grid helpers shared by the generators, the combat engine and the renderer:
 * tile properties, line of sight / field of view, fog of war, free squares and
 * entity placement. Everything is pure and deterministic.
 */

export type Point = { x: number; y: number };

export const sqKey = (x: number, y: number): string => `${x},${y}`;
export function parseKey(k: string): Point {
	const i = k.indexOf(",");
	return { x: Number(k.slice(0, i)), y: Number(k.slice(i + 1)) };
}

type GridLike = Pick<GridMap, "width" | "height" | "tiles">;

export function inBounds(map: Pick<GridMap, "width" | "height">, x: number, y: number): boolean {
	return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileAt(map: GridLike, x: number, y: number): Tile {
	return inBounds(map, x, y) ? map.tiles[y * map.width + x] : "void";
}

/** Tiles a creature cannot enter. Doors (even locked/secret) count as passable for connectivity. */
const BLOCKS_MOVE = new Set<Tile>([
	"void", "wall", "building", "pillar", "tree", "deep_water", "lava", "pit", "rock", "table", "bar_counter", "barricade",
]);
/** Tiles that block line of sight. */
const BLOCKS_SIGHT = new Set<Tile>([
	"void", "wall", "building", "pillar", "tree", "rock", "door", "door_locked", "secret_door", "barricade",
]);
/** Passable tiles that cost double movement (5e difficult terrain). */
const DIFFICULT = new Set<Tile>(["difficult", "water", "mud", "rubble", "tall_grass", "sand"]);

export function isPassable(tile: Tile): boolean {
	return !BLOCKS_MOVE.has(tile);
}
export function blocksSight(tile: Tile): boolean {
	return BLOCKS_SIGHT.has(tile);
}
export function isDifficult(tile: Tile): boolean {
	return DIFFICULT.has(tile);
}
/** Movement cost in feet to enter a square (Infinity if impassable). */
export function moveCost(tile: Tile): number {
	if (!isPassable(tile)) return Infinity;
	return isDifficult(tile) ? 10 : 5;
}

/** Squares occupied by an entity of a given size whose top-left is (x,y). */
export function footprint(e: Pick<MapEntity, "x" | "y" | "size">): Point[] {
	const s = Math.max(1, e.size | 0);
	const out: Point[] = [];
	for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) out.push({ x: e.x + dx, y: e.y + dy });
	return out;
}

/** Entity kinds that physically occupy their squares (others can be stood on). */
export function occupiesSquares(e: MapEntity): boolean {
	return e.kind === "pc" || e.kind === "monster" || e.kind === "npc" || e.kind === "feature";
}

// ─── Field of view (recursive shadowcasting) ───────────────────────────────

const MULT = [
	[1, 0, 0, -1, -1, 0, 0, 1],
	[0, 1, -1, 0, 0, -1, 1, 0],
	[0, 1, 1, 0, 0, -1, -1, 0],
	[1, 0, 0, 1, -1, 0, 0, -1],
];

/**
 * Squares visible from (x,y) within `radius` squares (Euclidean). Opaque
 * squares (walls, closed doors, trees…) are themselves visible but block what
 * lies behind them. Returns a Set of "x,y" keys including the origin.
 */
export function computeFov(map: GridLike, x: number, y: number, radius: number, opaque: (t: Tile) => boolean = blocksSight): Set<string> {
	const out = new Set<string>();
	if (!inBounds(map, x, y)) return out;
	out.add(sqKey(x, y));
	const r = Math.max(0, radius);
	const isOpaque = (X: number, Y: number) => !inBounds(map, X, Y) || opaque(map.tiles[Y * map.width + X]);
	const cast = (row: number, start: number, end: number, xx: number, xy: number, yx: number, yy: number) => {
		if (start < end) return;
		let newStart = 0;
		for (let j = row; j <= r; j++) {
			let dx = -j - 1;
			const dy = -j;
			let blocked = false;
			while (dx <= 0) {
				dx++;
				const X = x + dx * xx + dy * xy;
				const Y = y + dx * yx + dy * yy;
				const lSlope = (dx - 0.5) / (dy + 0.5);
				const rSlope = (dx + 0.5) / (dy - 0.5);
				if (start < rSlope) continue;
				if (end > lSlope) break;
				if (dx * dx + dy * dy <= r * r + r && inBounds(map, X, Y)) out.add(sqKey(X, Y));
				if (blocked) {
					if (isOpaque(X, Y)) {
						newStart = rSlope;
						continue;
					}
					blocked = false;
					start = newStart;
				} else if (isOpaque(X, Y) && j < r) {
					blocked = true;
					cast(j + 1, start, lSlope, xx, xy, yx, yy);
					newStart = rSlope;
				}
			}
			if (blocked) break;
		}
	};
	for (let o = 0; o < 8; o++) cast(1, 1, 0, MULT[0][o], MULT[1][o], MULT[2][o], MULT[3][o]);
	return out;
}

/**
 * Point-to-point line of sight between square centers (Bresenham over the
 * squares in between; endpoints themselves never block). Use for targeting.
 */
export function hasLineOfSight(map: GridLike, a: Point, b: Point): boolean {
	let x0 = a.x, y0 = a.y;
	const dx = Math.abs(b.x - x0), dy = Math.abs(b.y - y0);
	const sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
	let err = dx - dy;
	while (!(x0 === b.x && y0 === b.y)) {
		const e2 = 2 * err;
		if (e2 > -dy) { err -= dy; x0 += sx; }
		if (e2 < dx) { err += dx; y0 += sy; }
		if (x0 === b.x && y0 === b.y) break;
		if (blocksSight(tileAt(map, x0, y0))) return false;
	}
	return true;
}

/** Default sight radius (squares) for bright/dim maps. */
export const DEFAULT_SIGHT = 24;

/**
 * Light map: per-square light level 0..1 (row-major), from ambient lighting
 * plus light-emitting entities (lightRadius = bright radius; dim light extends
 * to twice that, like a 5e torch: 20 ft bright + 20 ft dim = 4 + 4 squares).
 */
export function computeLightLevels(map: GridMap, entities: MapEntity[] = map.entities): Float32Array {
	const ambient = map.lighting === "bright" ? 1 : map.lighting === "dim" ? 0.5 : 0;
	const out = new Float32Array(map.width * map.height).fill(ambient);
	if (ambient >= 1) return out;
	for (const e of entities) {
		const r = e.lightRadius ?? 0;
		if (r <= 0) continue;
		const cx = e.x + (e.size - 1) / 2, cy = e.y + (e.size - 1) / 2;
		const ox = Math.round(cx), oy = Math.round(cy);
		for (const k of computeFov(map, ox, oy, r * 2)) {
			const p = parseKey(k);
			const d = Math.hypot(p.x - cx, p.y - cy);
			const lvl = d <= r ? 1 : d <= 2 * r ? 0.5 : 0;
			const i = p.y * map.width + p.x;
			if (lvl > out[i]) out[i] = lvl;
		}
	}
	return out;
}

/**
 * What a viewer at (x,y) can currently see: squares in line of sight that are
 * lit (any light > 0) or within darkvision range. On bright/dim maps this is
 * simply line of sight within `sightRadius`.
 */
export function computePlayerView(
	map: GridMap,
	viewer: Point,
	opts: { sightRadius?: number; darkvision?: number; entities?: MapEntity[] } = {},
): Set<string> {
	const sight = opts.sightRadius ?? DEFAULT_SIGHT;
	const fov = computeFov(map, viewer.x, viewer.y, sight);
	if (map.lighting !== "dark") return fov;
	const light = computeLightLevels(map, opts.entities ?? map.entities);
	const dv = opts.darkvision ?? 0;
	const out = new Set<string>();
	for (const k of fov) {
		const p = parseKey(k);
		const near = Math.hypot(p.x - viewer.x, p.y - viewer.y) <= Math.max(1.5, dv);
		if (near || light[p.y * map.width + p.x] > 0) out.add(k);
	}
	return out;
}

/**
 * Fog-of-war update: marks every square in line of sight of (x,y) within
 * `radius` as explored. Mutates `map.explored` in place (the map is plain
 * state owned by the server) and returns the set of currently visible keys.
 */
export function revealAround(map: GridMap, x: number, y: number, radius: number): Set<string> {
	const vis = computeFov(map, x, y, radius);
	if (map.explored.length !== map.width * map.height) map.explored = new Array(map.width * map.height).fill(false);
	for (const k of vis) {
		const p = parseKey(k);
		map.explored[p.y * map.width + p.x] = true;
	}
	return vis;
}

// ─── Occupancy / placement ────────────────────────────────────────────────

function occupiedSet(map: GridMap, ignoreId?: string): Set<string> {
	const s = new Set<string>();
	for (const e of map.entities) {
		if (e.id === ignoreId || !occupiesSquares(e)) continue;
		for (const p of footprint(e)) s.add(sqKey(p.x, p.y));
	}
	return s;
}

const NO_STAND = new Set<Tile>(["door", "door_locked", "secret_door", "stairs_up", "stairs_down"]);

/** Can an entity of `size` stand with its top-left at (x,y)? */
export function canStand(map: GridMap, x: number, y: number, size = 1, occupied?: Set<string>, opts: { allowDoors?: boolean } = {}): boolean {
	const occ = occupied ?? occupiedSet(map);
	for (let dy = 0; dy < size; dy++)
		for (let dx = 0; dx < size; dx++) {
			const t = tileAt(map, x + dx, y + dy);
			if (!isPassable(t) || t === "deep_water") return false;
			if (!opts.allowDoors && NO_STAND.has(t)) return false;
			if (occ.has(sqKey(x + dx, y + dy))) return false;
		}
	return true;
}

/**
 * Up to `count` free top-left positions for entities of `size`, nearest first
 * by walking distance from `near` (breadth-first over passable squares, so
 * results stay on the same side of walls). Returned footprints don't overlap
 * each other or existing creatures/features.
 */
export function findFreeSquares(map: GridMap, near: Point, count: number, size = 1): Point[] {
	const occ = occupiedSet(map);
	const out: Point[] = [];
	const seen = new Uint8Array(map.width * map.height);
	let start = near;
	if (!inBounds(map, start.x, start.y) || !isPassable(tileAt(map, start.x, start.y))) start = nearestPassable(map, near) ?? map.entry;
	const q: Point[] = [start];
	seen[start.y * map.width + start.x] = 1;
	for (let qi = 0; qi < q.length && out.length < count; qi++) {
		const p = q[qi];
		if (canStand(map, p.x, p.y, size, occ)) {
			out.push(p);
			for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) occ.add(sqKey(p.x + dx, p.y + dy));
		}
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
			const nx = p.x + dx, ny = p.y + dy;
			if (!inBounds(map, nx, ny) || seen[ny * map.width + nx]) continue;
			if (!isPassable(tileAt(map, nx, ny))) continue;
			seen[ny * map.width + nx] = 1;
			q.push({ x: nx, y: ny });
		}
	}
	return out;
}

function nearestPassable(map: GridLike, p: Point): Point | undefined {
	let best: Point | undefined;
	let bd = Infinity;
	for (let y = 0; y < map.height; y++)
		for (let x = 0; x < map.width; x++) {
			if (!isPassable(map.tiles[y * map.width + x])) continue;
			const d = (x - p.x) ** 2 + (y - p.y) ** 2;
			if (d < bd) { bd = d; best = { x, y }; }
		}
	return best;
}

export type EntityInput = Omit<MapEntity, "x" | "y" | "size"> & { x?: number; y?: number; size?: number };

/**
 * Adds an entity to the map (mutates `map.entities`) and returns it. If x/y is
 * given and free it is used; otherwise the nearest free spot to `near` (or to
 * x/y, or the map entry) is chosen. Lights, items and traps may share squares.
 * Throws if no free square exists.
 */
export function placeEntity(map: GridMap, input: EntityInput, near?: Point): MapEntity {
	const size = Math.max(1, input.size ?? 1);
	const e: MapEntity = { ...input, size, x: input.x ?? 0, y: input.y ?? 0 } as MapEntity;
	const needsFree = occupiesSquares(e);
	const hasPos = input.x !== undefined && input.y !== undefined;
	if (hasPos && (!needsFree ? inBounds(map, e.x, e.y) : canStand(map, e.x, e.y, size, occupiedSet(map, e.id), { allowDoors: true }))) {
		// keep given position
	} else {
		const target = near ?? (hasPos ? { x: input.x!, y: input.y! } : map.entry);
		const [spot] = findFreeSquares(map, target, 1, size);
		if (!spot) throw new Error(`No free square for ${e.name} (size ${size})`);
		e.x = spot.x;
		e.y = spot.y;
	}
	const existing = map.entities.findIndex((x) => x.id === e.id);
	if (existing >= 0) map.entities[existing] = e;
	else map.entities.push(e);
	return e;
}

/** Breadth-first reachability from a square over passable tiles (4-neighbour + diagonals). */
export function reachableFrom(map: GridLike, from: Point, diagonals = true): Uint8Array {
	const seen = new Uint8Array(map.width * map.height);
	if (!inBounds(map, from.x, from.y) || !isPassable(tileAt(map, from.x, from.y))) return seen;
	const q = [from.y * map.width + from.x];
	seen[q[0]] = 1;
	const dirs = diagonals ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
	for (let qi = 0; qi < q.length; qi++) {
		const i = q[qi];
		const x = i % map.width, y = (i / map.width) | 0;
		for (const [dx, dy] of dirs) {
			const nx = x + dx, ny = y + dy;
			if (!inBounds(map, nx, ny)) continue;
			const ni = ny * map.width + nx;
			if (seen[ni] || !isPassable(map.tiles[ni])) continue;
			if (dx && dy && (!isPassable(map.tiles[y * map.width + nx]) || !isPassable(map.tiles[ny * map.width + x]))) continue; // no corner cutting
			seen[ni] = 1;
			q.push(ni);
		}
	}
	return seen;
}
