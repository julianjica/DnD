import type { Combatant, Encounter, GridMap, MapEntity, Size, Tile } from "../../game/types";

/**
 * Grid geometry for combat. One square = 5 ft. Diagonals cost 5 ft (simple
 * 5e rule). Entities occupy `size × size` squares with (x, y) the top-left.
 */

export interface Point {
	x: number;
	y: number;
}

export interface Footprint extends Point {
	size: number;
}

export const SQUARE_FEET = 5;

export function sizeSquares(size: Size | undefined): number {
	switch (size) {
		case "large":
			return 2;
		case "huge":
			return 3;
		case "gargantuan":
			return 4;
		default:
			return 1;
	}
}

export function sizeRank(size: Size | undefined): number {
	return ["tiny", "small", "medium", "large", "huge", "gargantuan"].indexOf(size ?? "medium");
}

export function inBounds(map: GridMap, x: number, y: number): boolean {
	return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function tileAt(map: GridMap, x: number, y: number): Tile {
	return inBounds(map, x, y) ? map.tiles[y * map.width + x] : "void";
}

// Closed (unlocked) doors don't block movement: a creature opens one as it
// steps through (free object interaction). They still block sight until open.
const ALWAYS_BLOCKED: ReadonlySet<Tile> = new Set<Tile>([
	"void", "wall", "door_locked", "secret_door", "tree", "building", "pillar", "rock", "bar_counter",
]);
const DIFFICULT: ReadonlySet<Tile> = new Set<Tile>(["difficult", "tall_grass", "rubble", "mud", "water", "table"]);
const SIGHT_BLOCKERS: ReadonlySet<Tile> = new Set<Tile>([
	"void", "wall", "door", "door_locked", "secret_door", "building",
]);
const COVER_BLOCKERS: ReadonlySet<Tile> = new Set<Tile>([
	"void", "wall", "door", "door_locked", "secret_door", "building", "pillar", "tree", "rock",
]);

export interface Mobility {
	fly?: boolean;
	swim?: boolean;
}

/** Can a creature stand in/move through this tile (ignoring creatures)? */
export function isPassableTile(tile: Tile, mob: Mobility = {}): boolean {
	if (ALWAYS_BLOCKED.has(tile)) return false;
	if (tile === "deep_water") return !!(mob.swim || mob.fly);
	if (tile === "pit" || tile === "lava") return !!mob.fly;
	return true;
}

export function isDifficultTile(tile: Tile): boolean {
	return DIFFICULT.has(tile);
}

export function blocksSight(tile: Tile): boolean {
	return SIGHT_BLOCKERS.has(tile);
}

export function blocksCover(tile: Tile): boolean {
	return COVER_BLOCKERS.has(tile);
}

export function cells(fp: Footprint): Point[] {
	const out: Point[] = [];
	for (let dy = 0; dy < fp.size; dy++) for (let dx = 0; dx < fp.size; dx++) out.push({ x: fp.x + dx, y: fp.y + dy });
	return out;
}

/** Squares of empty space between two footprints along the worse axis, +1 (adjacent = 1). */
export function gapSquares(a: Footprint, b: Footprint): number {
	const dx = Math.max(0, b.x - (a.x + a.size - 1), a.x - (b.x + b.size - 1));
	const dy = Math.max(0, b.y - (a.y + a.size - 1), a.y - (b.y + b.size - 1));
	return Math.max(dx, dy);
}

/** Distance in feet between two footprints (adjacent = 5, overlapping = 0). */
export function distanceFeet(a: Footprint, b: Footprint): number {
	return gapSquares(a, b) * SQUARE_FEET;
}

// ─── Encounter ↔ map lookups ─────────────────────────────────────────────

export function entityFor(encounter: Encounter, map: GridMap, combatantId: string): MapEntity | undefined {
	const c = encounter.combatants[combatantId];
	if (!c) return undefined;
	return map.entities.find((e) => e.id === c.entityId);
}

export function footprintOf(encounter: Encounter, map: GridMap, combatantId: string): Footprint | undefined {
	const e = entityFor(encounter, map, combatantId);
	return e ? { x: e.x, y: e.y, size: e.size || 1 } : undefined;
}

/** Living creatures (in the encounter) that occupy space. */
export function livingCombatants(encounter: Encounter): Combatant[] {
	return encounter.order.map((id) => encounter.combatants[id]).filter((c): c is Combatant => !!c && !c.dead);
}

export function areHostile(a: Combatant, b: Combatant): boolean {
	if (a.side === "neutral" || b.side === "neutral") return false;
	return a.side !== b.side;
}

const INCAPACITATING = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"] as const;
export function isIncapacitated(c: Combatant): boolean {
	return c.conditions.some((k) => (INCAPACITATING as readonly string[]).includes(k.id)) || (c.kind === "pc" && c.hp <= 0);
}

export function mobilityOf(c: Combatant): Mobility {
	return { fly: !!c.stats?.speed.fly, swim: !!c.stats?.speed.swim };
}

interface Occupant {
	id: string;
	/** Can the mover pass through this square? */
	passable: boolean;
	/** Passing through costs extra (difficult). */
	difficult: boolean;
}

/** Movement context for one mover: who occupies which square and how that affects passage. */
export interface MoveContext {
	map: GridMap;
	moverId: string;
	size: number;
	mob: Mobility;
	occ: Map<number, Occupant>;
}

export function moveContext(encounter: Encounter, map: GridMap, moverId: string): MoveContext {
	const mover = encounter.combatants[moverId];
	const ent = entityFor(encounter, map, moverId);
	const occ = new Map<number, Occupant>();
	const byEntity = new Map<string, Combatant>();
	for (const c of Object.values(encounter.combatants)) byEntity.set(c.entityId, c);
	for (const e of map.entities) {
		if (e.id === ent?.id) continue;
		if (e.kind !== "pc" && e.kind !== "monster" && e.kind !== "npc") continue;
		const c = byEntity.get(e.id);
		if (c?.dead) continue;
		let passable = true;
		let difficult = false;
		if (c && mover && areHostile(mover, c)) {
			const sizeGap = Math.abs(sizeRank(c.stats?.size) - sizeRank(mover.stats?.size));
			const tiny = c.stats?.size === "tiny";
			passable = isIncapacitated(c) || tiny || sizeGap >= 2;
			difficult = passable && !tiny;
		}
		for (const p of cells({ x: e.x, y: e.y, size: e.size || 1 })) {
			occ.set(p.y * map.width + p.x, { id: c?.id ?? e.id, passable, difficult });
		}
	}
	return { map, moverId, size: ent?.size || 1, mob: mover ? mobilityOf(mover) : {}, occ };
}

/** Cost in feet to step into (x, y) for the mover's footprint, or Infinity. */
export function stepCost(mc: MoveContext, x: number, y: number): number {
	let difficult = false;
	for (const p of cells({ x, y, size: mc.size })) {
		const t = tileAt(mc.map, p.x, p.y);
		if (!isPassableTile(t, mc.mob)) return Infinity;
		if (isDifficultTile(t) && !mc.mob.fly) difficult = true;
		const o = mc.occ.get(p.y * mc.map.width + p.x);
		if (o) {
			if (!o.passable) return Infinity;
			if (o.difficult) difficult = true;
		}
	}
	return difficult ? SQUARE_FEET * 2 : SQUARE_FEET;
}

/** Can the mover end its movement with its top-left at (x, y)? */
export function canEndAt(mc: MoveContext, x: number, y: number): boolean {
	if (stepCost(mc, x, y) === Infinity) return false;
	for (const p of cells({ x, y, size: mc.size })) if (mc.occ.has(p.y * mc.map.width + p.x)) return false;
	return true;
}

const NEIGHBORS: Point[] = [
	{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
	{ x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: -1, y: -1 },
];

/** Minimal binary heap keyed by number. */
class Heap<T> {
	private items: { k: number; v: T; s: number }[] = [];
	private seq = 0;
	get size(): number {
		return this.items.length;
	}
	push(k: number, v: T): void {
		const a = this.items;
		a.push({ k, v, s: this.seq++ });
		let i = a.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (this.less(a[i], a[p])) {
				[a[i], a[p]] = [a[p], a[i]];
				i = p;
			} else break;
		}
	}
	pop(): T | undefined {
		const a = this.items;
		if (!a.length) return undefined;
		const top = a[0];
		const last = a.pop()!;
		if (a.length) {
			a[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < a.length && this.less(a[l], a[m])) m = l;
				if (r < a.length && this.less(a[r], a[m])) m = r;
				if (m === i) break;
				[a[i], a[m]] = [a[m], a[i]];
				i = m;
			}
		}
		return top.v;
	}
	private less(a: { k: number; s: number }, b: { k: number; s: number }): boolean {
		return a.k < b.k || (a.k === b.k && a.s < b.s);
	}
}

export interface PathResult {
	/** Squares stepped into, excluding the start. */
	path: Point[];
	/** Movement cost in feet. */
	cost: number;
}

/**
 * Generic best-first search from `start` to any square where `isGoal` holds
 * and the mover can end. `heuristic` must be admissible (feet).
 */
export function searchPath(
	mc: MoveContext,
	start: Point,
	isGoal: (p: Point) => boolean,
	heuristic: (p: Point) => number,
	maxCost = Infinity,
): PathResult | null {
	const W = mc.map.width;
	const key = (p: Point) => p.y * W + p.x;
	const g = new Map<number, number>([[key(start), 0]]);
	const prev = new Map<number, number>();
	const heap = new Heap<Point>();
	heap.push(heuristic(start), start);
	const closed = new Set<number>();
	while (heap.size) {
		const cur = heap.pop()!;
		const ck = key(cur);
		if (closed.has(ck)) continue;
		closed.add(ck);
		const cg = g.get(ck)!;
		if (isGoal(cur) && canEndAt(mc, cur.x, cur.y)) {
			const path: Point[] = [];
			let k: number | undefined = ck;
			while (k !== undefined && k !== key(start)) {
				path.push({ x: k % W, y: Math.floor(k / W) });
				k = prev.get(k);
			}
			path.reverse();
			return { path, cost: cg };
		}
		for (const d of NEIGHBORS) {
			const n = { x: cur.x + d.x, y: cur.y + d.y };
			if (!inBounds(mc.map, n.x, n.y)) continue;
			const sc = stepCost(mc, n.x, n.y);
			if (sc === Infinity) continue;
			const ng = cg + sc;
			if (ng > maxCost) continue;
			const nk = key(n);
			if (ng < (g.get(nk) ?? Infinity)) {
				g.set(nk, ng);
				prev.set(nk, ck);
				heap.push(ng + heuristic(n), n);
			}
		}
	}
	return null;
}

function chebyshevFeet(a: Point, b: Point): number {
	return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * SQUARE_FEET;
}

/**
 * A* path for a combatant to `to` (its new top-left square).
 * `maxCost` defaults to unlimited; pass the turn budget to require reachability.
 */
export function findPath(encounter: Encounter, map: GridMap, combatantId: string, to: Point, maxCost = Infinity): PathResult | null {
	const fp = footprintOf(encounter, map, combatantId);
	if (!fp) return null;
	if (fp.x === to.x && fp.y === to.y) return { path: [], cost: 0 };
	const mc = moveContext(encounter, map, combatantId);
	if (!canEndAt(mc, to.x, to.y)) return null;
	return searchPath(mc, fp, (p) => p.x === to.x && p.y === to.y, (p) => chebyshevFeet(p, to), maxCost);
}

/** Feet a creature must spend to stand up from prone (half its speed). */
export function standUpCost(c: Combatant): number {
	return c.conditions.some((k) => k.id === "prone") ? Math.floor(c.speed / 2) : 0;
}

/**
 * Squares the combatant can end its move on this turn (for UI highlighting),
 * with the cost in feet. Accounts for standing up from prone. Excludes the start.
 */
export function reachable(encounter: Encounter, map: GridMap, combatantId: string): (Point & { cost: number })[] {
	const c = encounter.combatants[combatantId];
	const fp = footprintOf(encounter, map, combatantId);
	if (!c || !fp) return [];
	const budget = c.turn.movementLeft - standUpCost(c);
	if (budget < SQUARE_FEET) return [];
	const mc = moveContext(encounter, map, combatantId);
	const W = map.width;
	const g = new Map<number, number>([[fp.y * W + fp.x, 0]]);
	const heap = new Heap<Point>();
	heap.push(0, fp);
	const done = new Set<number>();
	while (heap.size) {
		const cur = heap.pop()!;
		const ck = cur.y * W + cur.x;
		if (done.has(ck)) continue;
		done.add(ck);
		const cg = g.get(ck)!;
		for (const d of NEIGHBORS) {
			const n = { x: cur.x + d.x, y: cur.y + d.y };
			if (!inBounds(map, n.x, n.y)) continue;
			const sc = stepCost(mc, n.x, n.y);
			const ng = cg + sc;
			if (ng > budget) continue;
			const nk = n.y * W + n.x;
			if (ng < (g.get(nk) ?? Infinity)) {
				g.set(nk, ng);
				heap.push(ng, n);
			}
		}
	}
	const out: (Point & { cost: number })[] = [];
	for (const [k, cost] of g) {
		const p = { x: k % W, y: Math.floor(k / W) };
		if (p.x === fp.x && p.y === fp.y) continue;
		if (canEndAt(mc, p.x, p.y)) out.push({ ...p, cost });
	}
	return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Nearest square (BFS over passable tiles) where a footprint of `size` can stand, free of entities. */
export function nearestFreeSquare(map: GridMap, from: Point, size = 1, extraBlocked: Set<number> = new Set()): Point | null {
	const W = map.width;
	const occupied = new Set<number>(extraBlocked);
	for (const e of map.entities) {
		if (e.kind !== "pc" && e.kind !== "monster" && e.kind !== "npc") continue;
		for (const p of cells({ x: e.x, y: e.y, size: e.size || 1 })) occupied.add(p.y * W + p.x);
	}
	const fits = (x: number, y: number) =>
		cells({ x, y, size }).every((p) => inBounds(map, p.x, p.y) && isPassableTile(tileAt(map, p.x, p.y)) && tileAt(map, p.x, p.y) !== "water" && !occupied.has(p.y * W + p.x));
	const start = { x: Math.max(0, Math.min(W - 1, from.x)), y: Math.max(0, Math.min(map.height - 1, from.y)) };
	const seen = new Set<number>([start.y * W + start.x]);
	const queue: Point[] = [start];
	while (queue.length) {
		const cur = queue.shift()!;
		if (fits(cur.x, cur.y)) return cur;
		for (const d of NEIGHBORS) {
			const n = { x: cur.x + d.x, y: cur.y + d.y };
			const k = n.y * W + n.x;
			if (!inBounds(map, n.x, n.y) || seen.has(k)) continue;
			seen.add(k);
			queue.push(n);
		}
	}
	return null;
}

// ─── Line of sight & cover ───────────────────────────────────────────────

/** Bresenham line between square centers; intermediate squares only. */
export function bresenham(a: Point, b: Point): Point[] {
	const out: Point[] = [];
	let x0 = a.x;
	let y0 = a.y;
	const dx = Math.abs(b.x - x0);
	const dy = -Math.abs(b.y - y0);
	const sx = x0 < b.x ? 1 : -1;
	const sy = y0 < b.y ? 1 : -1;
	let err = dx + dy;
	for (;;) {
		out.push({ x: x0, y: y0 });
		if (x0 === b.x && y0 === b.y) break;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y0 += sy;
		}
	}
	return out;
}

/** True if no sight-blocking tile (walls, closed doors) lies strictly between a and b. */
export function hasLineOfSight(map: GridMap, a: Point, b: Point): boolean {
	const line = bresenham(a, b);
	for (let i = 1; i < line.length - 1; i++) if (blocksSight(tileAt(map, line[i].x, line[i].y))) return false;
	return true;
}

/** Any square of footprint A sees any square of footprint B (symmetric). */
export function footprintsSee(map: GridMap, a: Footprint, b: Footprint): boolean {
	for (const p of cells(a)) for (const q of cells(b)) if (hasLineOfSight(map, p, q) || hasLineOfSight(map, q, p)) return true;
	return false;
}

export function canSee(encounter: Encounter, map: GridMap, fromId: string, toId: string): boolean {
	const a = footprintOf(encounter, map, fromId);
	const b = footprintOf(encounter, map, toId);
	return !!a && !!b && footprintsSee(map, a, b);
}

export type Cover = "none" | "half" | "three_quarters" | "total";
export const COVER_AC: Record<Cover, number> = { none: 0, half: 2, three_quarters: 5, total: Infinity };

function corners(fp: Footprint): Point[] {
	return [
		{ x: fp.x, y: fp.y },
		{ x: fp.x + fp.size, y: fp.y },
		{ x: fp.x, y: fp.y + fp.size },
		{ x: fp.x + fp.size, y: fp.y + fp.size },
	];
}

/**
 * Approximate DMG cover: from the attacker corner with the clearest view, draw
 * lines to the 4 target corners. Lines crossing obstacle squares (walls, closed
 * doors, pillars, trees, rocks) count as blocked: 0 → none, 1–2 → half,
 * 3 → three-quarters, 4 → total. Living creatures in between grant at most half.
 */
export function coverBetween(encounter: Encounter, map: GridMap, attackerId: string, targetId: string): Cover {
	const a = footprintOf(encounter, map, attackerId);
	const b = footprintOf(encounter, map, targetId);
	if (!a || !b) return "none";
	const own = new Set<number>([...cells(a), ...cells(b)].map((p) => p.y * map.width + p.x));
	const creatureCells = new Set<number>();
	for (const c of livingCombatants(encounter)) {
		if (c.id === attackerId || c.id === targetId) continue;
		const fp = footprintOf(encounter, map, c.id);
		if (fp) for (const p of cells(fp)) creatureCells.add(p.y * map.width + p.x);
	}
	// Sample the segment; a sample point is blocked when every square it touches
	// (1, 2 or 4 when on grid lines) is an obstacle. Grazing a single wall edge
	// or corner therefore does not block, but slipping between two walls does.
	const T = 1e-9;
	const touched = (v: number): number[] => {
		const f = Math.floor(v);
		return Math.abs(v - Math.round(v)) < T ? [Math.round(v) - 1, Math.round(v)] : [f];
	};
	const blocked = (p0: Point, p1: Point): { wall: boolean; creature: boolean } => {
		let wall = false;
		let creature = false;
		const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
		const steps = Math.max(2, Math.ceil(len * 20));
		for (let i = 1; i < steps; i++) {
			const t = i / steps;
			const px = p0.x + (p1.x - p0.x) * t;
			const py = p0.y + (p1.y - p0.y) * t;
			let allWall = true;
			let allSolid = true;
			for (const y of touched(py)) {
				for (const x of touched(px)) {
					const k = y * map.width + x;
					const inside = inBounds(map, x, y);
					if (inside && own.has(k)) {
						allWall = false;
						allSolid = false;
						continue;
					}
					const isWall = blocksCover(tileAt(map, x, y));
					const isCreature = inside && creatureCells.has(k);
					if (!isWall) allWall = false;
					if (!isWall && !isCreature) allSolid = false;
				}
			}
			if (allWall) wall = true;
			else if (allSolid) creature = true;
			if (wall) break;
		}
		return { wall, creature };
	};
	let best = 5;
	let bestCreature = false;
	for (const ac of corners(a)) {
		let walls = 0;
		let creature = false;
		for (const tc of corners(b)) {
			const r = blocked(ac, tc);
			if (r.wall) walls++;
			else if (r.creature) creature = true;
		}
		if (walls < best || (walls === best && !creature && bestCreature)) {
			best = walls;
			bestCreature = creature;
		}
	}
	let cover: Cover = best === 0 ? "none" : best <= 2 ? "half" : best === 3 ? "three_quarters" : "total";
	if (cover === "none" && bestCreature) cover = "half";
	return cover;
}

// ─── Areas of effect ─────────────────────────────────────────────────────

export interface AreaSpec {
	shape: "sphere" | "cube" | "cone" | "line" | "cylinder";
	/** Radius (sphere/cylinder), side (cube), length (cone/line) in feet. */
	size: number;
	/** Target point (sphere/cylinder/cube centre) or direction (cone/line/self-cube). */
	point: Point;
	/** Caster footprint: origin for cones/lines and self-cubes. */
	caster?: Footprint;
	/** The area emanates from the caster (cones, lines, "Self (15-foot cube)"). */
	fromCaster?: boolean;
	/** Line width in feet (default 5). */
	width?: number;
}

/** Squares covered by an area template, clipped to the map and to line of effect from its origin. */
export function areaSquares(map: GridMap, spec: AreaSpec): Point[] {
	const out: Point[] = [];
	const n = spec.size / SQUARE_FEET;
	const E = 1e-6;
	const casterCells = spec.caster ? new Set(cells(spec.caster).map((p) => `${p.x},${p.y}`)) : new Set<string>();
	let origin: Point = spec.point;
	const push = (x: number, y: number) => {
		if (!inBounds(map, x, y)) return;
		if (blocksSight(tileAt(map, x, y))) return;
		if (casterCells.has(`${x},${y}`) && (spec.shape === "cone" || spec.shape === "line" || spec.fromCaster)) return;
		out.push({ x, y });
	};
	if (spec.shape === "sphere" || spec.shape === "cylinder") {
		const cx = spec.point.x + 0.5;
		const cy = spec.point.y + 0.5;
		const r = Math.ceil(n);
		for (let y = spec.point.y - r; y <= spec.point.y + r; y++)
			for (let x = spec.point.x - r; x <= spec.point.x + r; x++)
				if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= n + E) push(x, y);
	} else if (spec.shape === "cube") {
		const side = Math.max(1, Math.round(n));
		let x0: number;
		let y0: number;
		if (spec.fromCaster && spec.caster) {
			const c = spec.caster;
			const ccx = c.x + c.size / 2;
			const ccy = c.y + c.size / 2;
			const dx = Math.sign(spec.point.x + 0.5 - ccx);
			const dy = Math.sign(spec.point.y + 0.5 - ccy);
			x0 = dx > 0 ? c.x + c.size : dx < 0 ? c.x - side : c.x + Math.floor((c.size - side) / 2);
			y0 = dy > 0 ? c.y + c.size : dy < 0 ? c.y - side : c.y + Math.floor((c.size - side) / 2);
			origin = { x: c.x, y: c.y };
		} else {
			x0 = spec.point.x - Math.floor((side - 1) / 2);
			y0 = spec.point.y - Math.floor((side - 1) / 2);
		}
		for (let y = y0; y < y0 + side; y++) for (let x = x0; x < x0 + side; x++) push(x, y);
	} else {
		const c = spec.caster ?? { ...spec.point, size: 1 };
		const ox = c.x + c.size / 2;
		const oy = c.y + c.size / 2;
		origin = { x: c.x, y: c.y };
		const vx = spec.point.x + 0.5 - ox;
		const vy = spec.point.y + 0.5 - oy;
		const vl = Math.hypot(vx, vy);
		if (vl < E) return [];
		const ux = vx / vl;
		const uy = vy / vl;
		const reach = n + c.size / 2;
		const R = Math.ceil(reach) + 1;
		const halfAngle = Math.atan(0.5);
		const halfWidth = (spec.width ?? SQUARE_FEET) / SQUARE_FEET / 2;
		for (let y = Math.floor(oy) - R; y <= Math.floor(oy) + R; y++) {
			for (let x = Math.floor(ox) - R; x <= Math.floor(ox) + R; x++) {
				const px = x + 0.5 - ox;
				const py = y + 0.5 - oy;
				const along = px * ux + py * uy;
				if (along <= E || along > reach + E) continue;
				if (spec.shape === "cone") {
					const d = Math.hypot(px, py);
					if (d > reach + E) continue;
					const ang = Math.acos(Math.max(-1, Math.min(1, along / d)));
					if (ang > halfAngle + 1e-3) continue;
				} else {
					const perp = Math.abs(px * uy - py * ux);
					if (perp > halfWidth + E) continue;
				}
				push(x, y);
			}
		}
	}
	// Line of effect from the origin: walls stop the area.
	return out.filter((p) => {
		if (spec.caster && (spec.shape === "cone" || spec.shape === "line" || spec.fromCaster)) {
			return cells(spec.caster).some((o) => hasLineOfSight(map, o, p));
		}
		return hasLineOfSight(map, origin, p);
	});
}

/** Living combatants whose footprint overlaps any of the squares. */
export function combatantsInSquares(encounter: Encounter, map: GridMap, squares: Point[]): string[] {
	const set = new Set(squares.map((p) => `${p.x},${p.y}`));
	return livingCombatants(encounter)
		.filter((c) => {
			const fp = footprintOf(encounter, map, c.id);
			return !!fp && cells(fp).some((p) => set.has(`${p.x},${p.y}`));
		})
		.map((c) => c.id);
}
