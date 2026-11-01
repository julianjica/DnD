import type { GridMap, MapKind, MapRoom, Tile } from "../game/types";
import { Rng } from "../rules/dice";
import { Builder, center, count8, ensureConnectivity, type Rect } from "./builder";
import { isPassable, type Point } from "./grid";
import { fbm, hashString, makeNoise2D } from "./noise";

export { findFreeSquares, placeEntity, revealAround, computeFov, computePlayerView, computeLightLevels, hasLineOfSight, isPassable, blocksSight, moveCost, sqKey } from "./grid";
export { generateWorld } from "./world";

/**
 * Procedural tactical maps. `generateMap` is pure and deterministic: the same
 * {kind, seed, width, height, features} always yields the same map.
 *
 * Supported `features` (all optional, unknown ones are ignored):
 *  - lighting: "night" | "dark" → dark, "dim" → dim, "bright" | "day" → bright
 *  - "water" (add pools/streams), "no_water", "lava" (caves/dungeons), "secret" (secret doors),
 *    "chasm" (mountain pass), "palisade" (camp), "traps" (hidden trap entities), "treasure" (extra chests)
 */
export interface GenerateMapOptions {
	kind: MapKind;
	seed: number;
	width?: number;
	height?: number;
	features?: string[];
	name?: string;
}

const DEFAULT_SIZE: Record<MapKind, [number, number]> = {
	dungeon: [48, 36], crypt: [41, 33], temple: [37, 31], cave: [50, 38], forest: [42, 30], swamp: [42, 30],
	mountain_pass: [46, 30], road: [44, 26], camp: [34, 26], town: [52, 40], tavern: [28, 20], castle: [47, 42],
	ship: [42, 20], arena: [33, 33],
};

const MIN_SIZE: Partial<Record<MapKind, [number, number]>> = {
	crypt: [27, 26], temple: [27, 26], castle: [37, 34], dungeon: [24, 20], tavern: [20, 14], ship: [26, 14], arena: [21, 21], town: [30, 24],
};

const DEFAULT_LIGHT: Record<MapKind, GridMap["lighting"]> = {
	dungeon: "dark", crypt: "dark", cave: "dark", temple: "dim", castle: "bright", tavern: "bright", ship: "bright",
	forest: "bright", swamp: "dim", mountain_pass: "bright", road: "bright", camp: "bright", town: "bright", arena: "bright",
};

const DEFAULT_NAME: Record<MapKind, string> = {
	dungeon: "Forgotten Dungeon", crypt: "Silent Crypt", temple: "Old Temple", cave: "Winding Caves", forest: "Deep Woods",
	swamp: "Murk Fen", mountain_pass: "High Pass", road: "Wilderness Road", camp: "Camp", town: "Market Town",
	tavern: "Tavern", castle: "Castle", ship: "Ship", arena: "Arena",
};

type Feat = { has: (f: string) => boolean };

export function generateMap(opts: GenerateMapOptions): GridMap {
	const kind = opts.kind;
	const [dw, dh] = DEFAULT_SIZE[kind] ?? [40, 30];
	const [mw, mh] = MIN_SIZE[kind] ?? [16, 12];
	const w0 = clamp(Math.round(opts.width ?? dw), mw, 160);
	const h0 = clamp(Math.round(opts.height ?? dh), mh, 160);
	const seed = opts.seed >>> 0;
	const rng = new Rng((seed ^ hashString(kind)) >>> 0 || 1);
	const feats = new Set((opts.features ?? []).map((f) => f.toLowerCase().trim()));
	const f: Feat = { has: (x) => feats.has(x) };
	const gen = GENERATORS[kind] ?? genDungeon;
	const b = gen(w0, h0, rng, f, seed);
	const w = b.w, h = b.h; // some generators force an odd width for symmetry

	addGenericFeatures(b, f, kind);
	ensureConnectivity(b, carverFor(kind), avoidCost);
	for (const r of b.rooms) clampRoom(r, w, h);

	let lighting = DEFAULT_LIGHT[kind];
	if (f.has("night") || f.has("dark")) lighting = "dark";
	else if (f.has("dim") || f.has("dusk")) lighting = "dim";
	else if (f.has("bright") || f.has("day")) lighting = "bright";

	return {
		id: `map-${kind}-${seed.toString(36)}`,
		name: opts.name ?? DEFAULT_NAME[kind],
		kind,
		seed,
		width: w,
		height: h,
		tiles: b.tiles,
		explored: new Array(w * h).fill(false),
		rooms: b.rooms,
		entities: b.entities.filter((e) => e.x >= 0 && e.y >= 0 && e.x < w && e.y < h),
		lighting,
		entry: { ...b.entry },
	};
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clampRoom(r: MapRoom, w: number, h: number) {
	r.x = clamp(r.x, 0, w - 1);
	r.y = clamp(r.y, 0, h - 1);
	r.w = clamp(r.w, 1, w - r.x);
	r.h = clamp(r.h, 1, h - r.y);
}

const INDOOR_CARVE: Partial<Record<MapKind, Tile>> = { dungeon: "floor", crypt: "floor", temple: "floor", cave: "floor", castle: "floor", tavern: "wood_floor", arena: "sand", mountain_pass: "floor", ship: "wood_floor" };

function carverFor(kind: MapKind): (old: Tile) => Tile {
	const base: Tile = INDOOR_CARVE[kind] ?? (kind === "swamp" ? "mud" : "grass");
	return (old) => {
		switch (old) {
			case "deep_water": return kind === "ship" ? "bridge" : "water";
			case "pit": return "bridge";
			case "lava": return "rubble";
			case "tree": case "rock": return kind === "swamp" ? "mud" : kind === "cave" || kind === "mountain_pass" ? "rubble" : "grass";
			case "table": case "bar_counter": case "pillar": return kind === "tavern" ? "wood_floor" : "floor";
			case "building": return "road";
			default: return base;
		}
	};
}

function avoidCost(t: Tile): number {
	switch (t) {
		case "building": return 40;
		case "table": case "bar_counter": return 12;
		case "deep_water": case "lava": case "pit": return 5;
		case "void": return 8;
		case "wall": return 2;
		default: return 1;
	}
}

// ─── Shared decoration helpers ────────────────────────────────────────────

function interior(r: Rect): Point[] {
	const out: Point[] = [];
	for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
	return out;
}

const isWallish = (t: Tile) => t === "wall" || t === "void";

/** Free floor squares in a rect, optionally only those against a wall. */
function spots(b: Builder, r: Rect, againstWall = false, floor: Tile[] = ["floor", "wood_floor", "grass", "sand", "road"]): Point[] {
	return interior(r).filter((p) => {
		const t = b.get(p.x, p.y);
		if (!floor.includes(t) || !b.freeOfEntities(p.x, p.y)) return false;
		// never block doorways
		if (b.neighbors4(p.x, p.y).some((n) => /door/.test(b.get(n.x, n.y)))) return false;
		if (againstWall) return b.neighbors4(p.x, p.y).some((n) => isWallish(b.get(n.x, n.y)));
		return true;
	});
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng.next() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function addProps(b: Builder, r: Rect, sprite: string, name: string, n: number, againstWall = true, extra: { lightRadius?: number; kind?: "feature" | "light" | "item" } = {}) {
	const s = shuffle(b.rng, spots(b, r, againstWall));
	for (let i = 0; i < Math.min(n, s.length); i++) {
		b.entity({ kind: extra.kind ?? "feature", name, sprite, x: s[i].x, y: s[i].y, ...(extra.lightRadius ? { lightRadius: extra.lightRadius } : {}) });
	}
}

function addTorches(b: Builder, r: Rect, n: number, sprite = "torch", radius = 3, name = "Wall torch") {
	const s = shuffle(b.rng, spots(b, r, true, ["floor", "wood_floor", "sand", "road", "grass"]));
	const placed: Point[] = [];
	for (const p of s) {
		if (placed.length >= n) break;
		if (placed.some((q) => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < 4)) continue;
		placed.push(p);
		b.entity({ kind: "light", name, sprite, x: p.x, y: p.y, lightRadius: radius });
	}
}

function addGenericFeatures(b: Builder, f: Feat, kind: MapKind) {
	if (f.has("traps")) {
		const rooms = b.rooms.filter((r) => r.tag !== "entrance");
		for (const r of rooms.slice(0, 3)) {
			const s = spots(b, r, false, ["floor", "wood_floor", "grass", "road", "sand"]);
			if (s.length) {
				const p = b.rng.pick(s);
				b.entity({ kind: "trap", name: kind === "forest" || kind === "road" ? "Snare" : "Pressure plate", sprite: "trap", x: p.x, y: p.y, hidden: true });
			}
		}
	}
	if (f.has("treasure")) {
		const r = b.rooms.find((x) => x.tag === "treasure" || x.tag === "boss") ?? b.rooms[b.rooms.length - 1];
		if (r) addProps(b, r, "chest", "Treasure chest", 1, true);
	}
}

// ─── Dungeon (BSP) ─────────────────────────────────────────────────────────

type BspNode = { r: Rect; a?: BspNode; b?: BspNode; room?: Rect };

function genDungeon(W: number, H: number, rng: Rng, f: Feat): Builder {
	const b = new Builder(W, H, rng, "wall");
	const MIN = 9;
	const split = (r: Rect, depth: number): BspNode => {
		const node: BspNode = { r };
		const canH = r.h >= MIN * 2, canV = r.w >= MIN * 2;
		if ((!canH && !canV) || depth > 5 || (depth > 2 && rng.next() < 0.12)) {
			const rw = rng.int(4, Math.min(r.w - 2, 13));
			const rh = rng.int(4, Math.min(r.h - 2, 10));
			const rx = r.x + rng.int(1, r.w - rw - 1);
			const ry = r.y + rng.int(1, r.h - rh - 1);
			node.room = { x: rx, y: ry, w: rw, h: rh };
			return node;
		}
		const horiz = canH && (!canV || r.h > r.w * 1.2 || (r.w <= r.h * 1.2 && rng.next() < 0.5));
		if (horiz) {
			const cut = rng.int(MIN, r.h - MIN);
			node.a = split({ x: r.x, y: r.y, w: r.w, h: cut }, depth + 1);
			node.b = split({ x: r.x, y: r.y + cut, w: r.w, h: r.h - cut }, depth + 1);
		} else {
			const cut = rng.int(MIN, r.w - MIN);
			node.a = split({ x: r.x, y: r.y, w: cut, h: r.h }, depth + 1);
			node.b = split({ x: r.x + cut, y: r.y, w: r.w - cut, h: r.h }, depth + 1);
		}
		return node;
	};
	const root = split({ x: 0, y: 0, w: W, h: H }, 0);
	const rects: Rect[] = [];
	const collect = (n: BspNode): Rect[] => (n.room ? [n.room] : [...collect(n.a!), ...collect(n.b!)]);
	for (const r of collect(root)) {
		b.fill(r, "floor");
		rects.push(r);
	}
	const connect = (n: BspNode) => {
		if (n.room) return;
		connect(n.a!);
		connect(n.b!);
		const A = collect(n.a!), B = collect(n.b!);
		let best: [Rect, Rect] = [A[0], B[0]];
		let bd = Infinity;
		for (const ra of A) for (const rb of B) {
			const ca = center(ra), cb = center(rb);
			const d = Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
			if (d < bd) { bd = d; best = [ra, rb]; }
		}
		b.corridor(center(best[0]), center(best[1]), "floor", rng.next() < 0.2 ? 2 : 1);
	};
	connect(root);
	// A couple of loops so it's not a pure tree.
	for (let i = 0; i < Math.floor(rects.length / 4); i++) {
		const ra = rng.pick(rects), rb = rng.pick(rects);
		if (ra !== rb) b.corridor(center(ra), center(rb), "floor", 1, undefined, (t) => t === "wall" || t === "floor");
	}

	// Doors where corridors meet rooms.
	for (const r of rects) placeDoors(b, r, f.has("secret") ? 0.15 : 0, 0.12);

	// Tag rooms by walking distance from the entrance.
	const entrance = rects.reduce((a, c) => (center(c).x + center(c).y * 0.3 < center(a).x + center(a).y * 0.3 ? c : a));
	b.entry = center(entrance);
	const dist = walkDistances(b, b.entry);
	const dOf = (r: Rect) => { const c = center(r); return dist[c.y * W + c.x]; };
	const others = rects.filter((r) => r !== entrance).sort((x, y) => dOf(y) - dOf(x));
	const boss = others.find((r) => r.w * r.h >= 30) ?? others[0];
	const rest = others.filter((r) => r !== boss);
	const deadEnd = (r: Rect) => openings(b, r);
	const treasure = [...rest].sort((x, y) => deadEnd(x) - deadEnd(y) || dOf(y) - dOf(x))[0];
	const flavor = ["guardroom", "barracks", "shrine", "library", "prison", "hall"];
	for (const r of rects) {
		const tag = r === entrance ? "entrance" : r === boss ? "boss" : r === treasure ? "treasure" : rest.indexOf(r) % 3 === 1 ? "storage" : rng.pick(flavor);
		b.room(r, tag);
	}
	// Dressing.
	for (const room of b.rooms) decorateDungeonRoom(b, room, f);
	// Rubble in corridors.
	for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
		if (b.get(x, y) !== "floor" || rects.some((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h)) continue;
		if (rng.next() < 0.05) b.set(x, y, "rubble");
	}
	return b;
}

function openings(b: Builder, r: Rect): number {
	let n = 0;
	for (let x = r.x; x < r.x + r.w; x++) for (const y of [r.y - 1, r.y + r.h]) if (b.passable(x, y)) n++;
	for (let y = r.y; y < r.y + r.h; y++) for (const x of [r.x - 1, r.x + r.w]) if (b.passable(x, y)) n++;
	return n;
}

function placeDoors(b: Builder, r: Rect, secretChance: number, lockedChance: number) {
	const ring: [number, number, boolean][] = [];
	for (let x = r.x; x < r.x + r.w; x++) ring.push([x, r.y - 1, true], [x, r.y + r.h, true]);
	for (let y = r.y; y < r.y + r.h; y++) ring.push([r.x - 1, y, false], [r.x + r.w, y, false]);
	for (const [x, y, horizWall] of ring) {
		if (b.get(x, y) !== "floor" && b.get(x, y) !== "rubble") continue;
		const flankA = horizWall ? b.get(x - 1, y) : b.get(x, y - 1);
		const flankB = horizWall ? b.get(x + 1, y) : b.get(x, y + 1);
		if (flankA !== "wall" || flankB !== "wall") continue;
		if (count8(b, x, y, (t) => /door/.test(t)) > 0) continue;
		const roll = b.rng.next();
		if (roll < 0.25) continue;
		b.set(x, y, roll < 0.25 + secretChance ? "secret_door" : roll < 0.25 + secretChance + lockedChance ? "door_locked" : b.rng.next() < 0.3 ? "door_open" : "door");
	}
}

function walkDistances(b: Builder, from: Point): Int32Array {
	const d = new Int32Array(b.w * b.h).fill(1 << 29);
	const q = [from.y * b.w + from.x];
	d[q[0]] = 0;
	for (let qi = 0; qi < q.length; qi++) {
		const i = q[qi];
		const x = i % b.w, y = (i / b.w) | 0;
		for (const n of b.neighbors4(x, y)) {
			if (!b.in(n.x, n.y)) continue;
			const ni = n.y * b.w + n.x;
			if (d[ni] <= d[i] + 1 || !isPassable(b.tiles[ni])) continue;
			d[ni] = d[i] + 1;
			q.push(ni);
		}
	}
	return d;
}

function pillarRows(b: Builder, r: Rect, step = 2) {
	if (r.w < 7 || r.h < 7) return;
	for (let i = 0; ; i++) {
		const xl = r.x + 1 + i * step, xr = r.x + r.w - 2 - i * step;
		if (xl > xr || xr - xl === 1) break;
		for (const y of [r.y + 1, r.y + r.h - 2]) for (const x of [xl, xr]) if (b.get(x, y) === "floor") b.set(x, y, "pillar");
	}
}

function decorateDungeonRoom(b: Builder, room: MapRoom, f: Feat) {
	const rng = b.rng;
	const c = center(room);
	switch (room.tag) {
		case "entrance":
			b.set(room.x, room.y, "stairs_up");
			addTorches(b, room, 2);
			break;
		case "boss":
			if (room.w >= 7 && room.h >= 7) pillarRows(b, { x: room.x + 1, y: room.y, w: room.w - 2, h: room.h });
			b.entity({ kind: "feature", name: "Bone throne", sprite: "throne", x: c.x, y: room.y + 1 });
			b.entity({ kind: "light", name: "Brazier", sprite: "brazier", x: Math.max(room.x, c.x - 2), y: room.y + 1, lightRadius: 3 });
			b.entity({ kind: "light", name: "Brazier", sprite: "brazier", x: Math.min(room.x + room.w - 1, c.x + 2), y: room.y + 1, lightRadius: 3 });
			if (room.w * room.h > 40) b.set(room.x + room.w - 1, room.y + room.h - 1, "stairs_down");
			break;
		case "treasure":
			addProps(b, room, "chest", "Iron-bound chest", rng.int(1, 2));
			addProps(b, room, "coins", "Scattered coins", 1, false, { kind: "item" });
			break;
		case "storage":
			addProps(b, room, "barrel", "Barrel", rng.int(2, 4));
			addProps(b, room, "crate", "Crate", rng.int(1, 3));
			if (rng.next() < 0.5) addTorches(b, room, 1);
			break;
		case "shrine":
			b.entity({ kind: "feature", name: "Defaced altar", sprite: "altar", x: c.x, y: c.y });
			b.entity({ kind: "light", name: "Candles", sprite: "candles", x: Math.min(room.x + room.w - 1, c.x + 1), y: c.y, lightRadius: 2 });
			break;
		case "library":
			addProps(b, room, "bookshelf", "Bookshelf", Math.min(4, room.w - 1));
			addTorches(b, room, 1, "candles", 2, "Candles");
			break;
		case "guardroom":
		case "barracks":
			if (room.w >= 5 && room.h >= 4) {
				b.set(c.x, c.y, "table");
				if (room.w >= 6) b.set(c.x + 1, c.y, "table");
			}
			addTorches(b, room, 1);
			if (room.tag === "barracks") addProps(b, room, "bedroll", "Bedroll", rng.int(2, 3));
			break;
		case "prison":
			addProps(b, room, "chains", "Wall shackles", 2);
			break;
		case "hall":
			pillarRows(b, room);
			addTorches(b, room, 2);
			break;
	}
	if ((f.has("water") && !f.has("no_water") && rng.next() < 0.35) || (room.tag === "hall" && rng.next() < 0.3)) {
		if (room.w >= 6 && room.h >= 6) {
			b.disc(c.x + 0.5, c.y + 0.5, Math.min(room.w, room.h) / 3, "water", (t) => t === "floor");
			b.disc(c.x + 0.5, c.y + 0.5, Math.min(room.w, room.h) / 6, "deep_water", (t) => t === "water");
		}
	}
	if (f.has("lava") && room.tag === "boss" && room.w >= 7) {
		b.disc(room.x + 1.5, room.y + room.h - 1.5, 1.6, "lava", (t) => t === "floor");
	}
}

// ─── Crypt & temple (mirrored halls) ───────────────────────────────────────

function genSymmetric(W: number, H: number, rng: Rng, f: Feat, temple: boolean): Builder {
	if (W % 2 === 0) W -= 1; // odd width → true centre column
	const b = new Builder(W, H, rng, "wall");
	const mid = Math.floor(W / 2);
	const nw = temple ? (rng.next() < 0.5 ? 7 : 9) : rng.next() < 0.5 ? 5 : 7;
	const hw = nw >> 1;
	// Vestibule
	const vest: Rect = { x: mid - 4, y: H - 7, w: 9, h: 5 };
	b.fill(vest, "floor");
	b.set(mid, H - 2, "door");
	b.fill({ x: mid, y: H - 1, w: 1, h: 1 }, "floor");
	// Nave
	const nave: Rect = { x: mid - hw, y: 9, w: nw, h: H - 9 - 8 };
	b.fill(nave, "floor");
	b.set(mid, H - 8, temple ? "door_open" : "door");
	if (temple) { b.set(mid - 1, H - 8, "floor"); b.set(mid + 1, H - 8, "floor"); }
	// Sanctum / tomb
	const sanct: Rect = { x: mid - 5, y: 2, w: 11, h: 6 };
	b.fill(sanct, "floor");
	if (temple) b.disc(mid, 5, 4.6, "floor", (t) => t === "wall");
	b.set(mid, 8, temple ? "door_open" : rng.next() < 0.5 ? "door_locked" : "door");
	// Pillars along the nave
	for (let y = nave.y + 1; y < nave.y + nave.h - 1; y += 2) {
		b.setSym(mid - hw + 1, y, "pillar");
		if (temple && nw >= 9) b.setSym(mid - hw + 1, y, "pillar");
	}
	// Side chambers
	const cw = rng.int(5, Math.max(5, Math.min(8, mid - hw - 3)));
	const ch = rng.int(4, 5);
	const sideRooms: [Rect, Rect][] = [];
	for (let y = nave.y + 1; y + ch < nave.y + nave.h; y += ch + 1 + (rng.next() < 0.4 ? 1 : 0)) {
		const L: Rect = { x: mid - hw - 1 - cw, y, w: cw, h: ch };
		if (L.x < 1) break;
		const R: Rect = { ...L, x: W - L.x - L.w };
		b.fillSym(L, "floor");
		const dy = y + (ch >> 1);
		if (temple) {
			for (let k = -1; k <= 1; k++) b.setSym(mid - hw - 1, dy + k, "floor");
		} else {
			b.setSym(mid - hw - 1, dy, "door");
		}
		sideRooms.push([L, R]);
	}
	// Burial niches on outer walls (crypt)
	if (!temple) {
		for (const [L] of sideRooms) {
			for (let y = L.y; y < L.y + L.h; y += 2) if (L.x - 1 > 0) b.setSym(L.x - 1, y, "floor");
		}
	}
	// Rooms
	b.room(vest, "entrance");
	b.room(nave, temple ? "nave" : "hall");
	b.room(sanct, temple ? "sanctum" : "boss");
	sideRooms.forEach(([L, R], i) => {
		const last = i === sideRooms.length - 1;
		b.room(L, last ? "treasure" : temple ? "chapel" : i === 0 ? "storage" : "tomb");
		b.room(R, temple ? "chapel" : last ? "tomb" : i === 0 ? "ossuary" : "tomb");
	});
	b.entry = { x: mid, y: H - 4 };
	b.set(mid, H - 3, "stairs_up");

	// Dressing
	const sc = { x: mid, y: 4 };
	if (temple) {
		b.entity({ kind: "feature", name: "High altar", sprite: "altar", x: sc.x, y: 3 });
		b.entity({ kind: "light", name: "Brazier", sprite: "brazier", x: mid - 3, y: 3, lightRadius: 3 });
		b.entity({ kind: "light", name: "Brazier", sprite: "brazier", x: mid + 3, y: 3, lightRadius: 3 });
		b.fillSym({ x: vest.x + 1, y: vest.y + 1, w: 1, h: 1 }, "water");
		for (const [L, R] of sideRooms) {
			for (const r of [L, R]) {
				const sx = r === L ? r.x : r.x + r.w - 1;
				b.entity({ kind: "feature", name: "Saint's statue", sprite: "statue", x: sx, y: r.y + (r.h >> 1) });
			}
			b.entity({ kind: "light", name: "Candles", sprite: "candles", x: L.x + 1, y: L.y, lightRadius: 2 });
			b.entity({ kind: "light", name: "Candles", sprite: "candles", x: R.x + R.w - 2, y: R.y, lightRadius: 2 });
		}
		for (let y = nave.y + 3; y < nave.y + nave.h - 4; y += 3) for (let x = mid - hw + 2; x < mid; x++) if (b.get(x, y) === "floor") b.setSym(x, y, "table"); // pews
	} else {
		b.entity({ kind: "feature", name: "Stone sarcophagus", sprite: "sarcophagus", x: sc.x, y: 4 });
		b.entity({ kind: "light", name: "Candles", sprite: "candles", x: mid - 2, y: 3, lightRadius: 2 });
		b.entity({ kind: "light", name: "Candles", sprite: "candles", x: mid + 2, y: 3, lightRadius: 2 });
		for (const [L, R] of sideRooms) {
			for (const r of [L, R]) {
				const c = center(r);
				b.entity({ kind: "feature", name: "Coffin", sprite: "coffin", x: c.x, y: c.y });
				if (rng.next() < 0.5) b.entity({ kind: "light", name: "Grave candles", sprite: "candles", x: r === L ? r.x + 1 : r.x + r.w - 2, y: r.y + r.h - 1, lightRadius: 2 });
			}
		}
		for (let i = 0; i < W * H * 0.01; i++) {
			const x = rng.int(1, W - 2), y = rng.int(1, H - 2);
			if (b.get(x, y) === "floor" && b.freeOfEntities(x, y)) b.set(x, y, "rubble");
		}
		const lastPair = sideRooms[sideRooms.length - 1];
		if (lastPair) addProps(b, lastPair[0], "chest", "Grave goods", 1, true);
	}
	if (f.has("water") && !temple) b.disc(mid, nave.y + nave.h / 2, 1.5, "water", (t) => t === "floor");
	return b;
}

// ─── Cave (cellular automata) ─────────────────────────────────────────────

function genCave(W: number, H: number, rng: Rng, f: Feat, seed: number): Builder {
	const b = new Builder(W, H, rng, "wall");
	for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) b.set(x, y, rng.next() < 0.6 ? "wall" : "floor");
	for (let it = 0; it < 6; it++) {
		const next = b.tiles.slice();
		for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
			const n = count8(b, x, y, (t) => t === "wall");
			let n2 = 0;
			if (it < 3) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (b.get(x + dx, y + dy) === "wall") n2++;
			next[y * W + x] = n >= 5 || (it < 3 && n2 <= 2) ? "wall" : "floor";
		}
		b.tiles = next;
	}
	// Drop tiny regions.
	const regionOf = new Int32Array(W * H).fill(-1);
	const regions: number[][] = [];
	for (let i = 0; i < W * H; i++) {
		if (b.tiles[i] !== "floor" || regionOf[i] >= 0) continue;
		const reg: number[] = [];
		const q = [i];
		regionOf[i] = regions.length;
		for (let qi = 0; qi < q.length; qi++) {
			const j = q[qi];
			reg.push(j);
			const x = j % W, y = (j / W) | 0;
			for (const n of b.neighbors4(x, y)) {
				const nj = n.y * W + n.x;
				if (b.in(n.x, n.y) && b.tiles[nj] === "floor" && regionOf[nj] < 0) { regionOf[nj] = regions.length; q.push(nj); }
			}
		}
		regions.push(reg);
	}
	for (const reg of regions) if (reg.length < 14) for (const i of reg) b.tiles[i] = "wall";
	if (!b.tiles.includes("floor")) b.fill({ x: 2, y: 2, w: W - 4, h: H - 4 }, "floor");

	// Distance to wall → cavern centres.
	const dist = distanceToWall(b);
	const cand: number[] = [];
	for (let i = 0; i < W * H; i++) if (dist[i] >= 2) cand.push(i);
	cand.sort((a, c) => dist[c] - dist[a] || a - c);
	const centres: Point[] = [];
	for (const i of cand) {
		const p = { x: i % W, y: (i / W) | 0 };
		if (centres.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 8)) continue;
		centres.push(p);
		if (centres.length >= 9) break;
	}
	// Entry: westmost floor near the middle.
	let entry: Point = { x: 2, y: H >> 1 };
	let best = Infinity;
	for (let i = 0; i < W * H; i++) if (b.tiles[i] === "floor") {
		const x = i % W, y = (i / W) | 0;
		const s = x + Math.abs(y - H / 2) * 0.35;
		if (s < best) { best = s; entry = { x, y }; }
	}
	b.entry = entry;
	// Tunnel mouth to the west edge.
	for (let x = 0; x <= entry.x; x++) b.set(x, entry.y, "floor");

	// Water / lava pools from noise.
	const noise = makeNoise2D(seed ^ 0x51ab);
	const liquid: Tile = f.has("lava") ? "lava" : "water";
	if (!f.has("no_water")) {
		for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
			if (b.get(x, y) !== "floor") continue;
			const n = fbm(noise, x / 9, y / 9, 3);
			if (Math.hypot(x - entry.x, y - entry.y) < 5) continue;
			if (n > 0.32) b.set(x, y, liquid === "lava" ? (n > 0.42 ? "lava" : "rubble") : n > 0.47 && dist[y * W + x] >= 2 ? "deep_water" : "water");
		}
	}
	// Stalagmites and scree.
	for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
		if (b.get(x, y) !== "floor") continue;
		const d = dist[y * W + x];
		const r = rng.next();
		if (d >= 2 && r < 0.025) b.set(x, y, "rock");
		else if (d === 1 && r < 0.12) b.set(x, y, "rubble");
	}

	// Rooms from caverns.
	const wd = walkDistances(b, entry);
	const sized = centres.map((c) => {
		const r = Math.max(2, Math.min(5, dist[c.y * W + c.x]));
		return { c, rect: { x: c.x - r, y: c.y - r, w: r * 2 + 1, h: r * 2 + 1 } as Rect };
	});
	if (sized.length) {
		const byWalk = [...sized].sort((a, c) => (wd[c.c.y * W + c.c.x] % (1 << 29)) - (wd[a.c.y * W + a.c.x] % (1 << 29)));
		const entranceRoom = [...sized].sort((a, c) => Math.hypot(a.c.x - entry.x, a.c.y - entry.y) - Math.hypot(c.c.x - entry.x, c.c.y - entry.y))[0];
		const boss = byWalk.find((s) => s !== entranceRoom);
		const treasure = byWalk.find((s) => s !== entranceRoom && s !== boss);
		for (const s of sized) {
			const hasWater = interior(s.rect).some((p) => /water|lava/.test(b.get(p.x, p.y)));
			const tag = s === entranceRoom ? "entrance" : s === boss ? "boss" : s === treasure ? "treasure" : hasWater ? "pool" : "cavern";
			b.room(s.rect, tag);
		}
	}
	b.room({ x: Math.max(0, entry.x - 1), y: entry.y - 1, w: 3, h: 3 }, "mouth");
	// Glowing fungus and a lair.
	for (const room of b.rooms) {
		if (room.tag === "cavern" || room.tag === "pool") {
			if (rng.next() < 0.6) addTorches(b, room, 1, "glowshroom", 2, "Glowing fungus");
		}
		if (room.tag === "boss") addProps(b, room, "bones", "Gnawed bones", 2, false, { kind: "item" });
		if (room.tag === "treasure") addProps(b, room, "chest", "Rotting chest", 1, true);
	}
	return b;
}

function distanceToWall(b: Builder): Int32Array {
	const d = new Int32Array(b.w * b.h).fill(1 << 20);
	const q: number[] = [];
	for (let i = 0; i < b.w * b.h; i++) if (!isPassable(b.tiles[i]) || b.tiles[i] === "rock") { d[i] = 0; q.push(i); }
	for (let qi = 0; qi < q.length; qi++) {
		const i = q[qi];
		const x = i % b.w, y = (i / b.w) | 0;
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const nx = x + dx, ny = y + dy;
			if (!b.in(nx, ny)) continue;
			const ni = ny * b.w + nx;
			if (d[ni] > d[i] + 1) { d[ni] = d[i] + 1; q.push(ni); }
		}
	}
	return d;
}

// ─── Wilderness ───────────────────────────────────────────────────────────

function meander(rng: Rng, from: Point, to: Point, segments: number, wobble: number, W: number, H: number): Point[] {
	const pts = [from];
	for (let i = 1; i < segments; i++) {
		const t = i / segments;
		pts.push({ x: clamp(from.x + (to.x - from.x) * t + (rng.next() - 0.5) * wobble, 2, W - 3), y: clamp(from.y + (to.y - from.y) * t + (rng.next() - 0.5) * wobble, 2, H - 3) });
	}
	pts.push(to);
	return pts;
}

/** Path tiles: water becomes bridge, everything else road. */
const roadOver = (t: Tile): Tile => (t === "water" || t === "deep_water" ? "bridge" : t === "bridge" ? "bridge" : "road");

function genForest(W: number, H: number, rng: Rng, f: Feat, seed: number): Builder {
	const b = new Builder(W, H, rng, "grass");
	const n1 = makeNoise2D(seed ^ 0x1f), n2 = makeNoise2D(seed ^ 0x2e);
	const clearing = { x: W * (0.4 + rng.next() * 0.2), y: H * (0.4 + rng.next() * 0.2), r: rng.int(4, 6) };
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
		const dens = fbm(n1, x / 8, y / 8, 3) + (edge < 2 ? 0.35 : 0) - (Math.hypot(x - clearing.x, y - clearing.y) < clearing.r + 1 ? 1 : 0);
		if (dens + rng.next() * 0.35 > 0.32) b.set(x, y, "tree");
		else if (fbm(n2, x / 6, y / 6, 2) > 0.18) b.set(x, y, "tall_grass");
		else if (rng.next() < 0.012) b.set(x, y, "rock");
	}
	// Stream
	const stream = (f.has("water") || rng.next() < 0.45) && !f.has("no_water");
	if (stream) {
		const sx = W * (0.65 + rng.next() * 0.2);
		b.path(meander(rng, { x: sx, y: 0 }, { x: sx + (rng.next() - 0.5) * 10, y: H - 1 }, 5, 6, W, H), (t) => (t === "tree" ? "water" : "water"), (fr) => 2.2 + Math.sin(fr * 9) * 0.6);
	}
	// Path west → clearing → east
	const y0 = rng.int(4, H - 5), y1 = rng.int(4, H - 5);
	const pts = [...meander(rng, { x: 0, y: y0 }, { x: clearing.x, y: clearing.y }, 3, 5, W, H), ...meander(rng, { x: clearing.x, y: clearing.y }, { x: W - 1, y: y1 }, 3, 5, W, H).slice(1)];
	b.path(pts, roadOver, 2.2);
	b.disc(clearing.x, clearing.y, clearing.r, (t) => (t === "tree" || t === "rock" ? "grass" : t), (t) => t !== "road" && t !== "water" && t !== "bridge");
	b.entry = { x: 0, y: y0 };
	b.set(0, y0, "road");
	const cr = { x: Math.round(clearing.x - clearing.r), y: Math.round(clearing.y - clearing.r), w: clearing.r * 2 + 1, h: clearing.r * 2 + 1 };
	b.room({ x: 0, y: y0 - 2, w: 4, h: 5 }, "entrance");
	b.room(cr, "clearing");
	b.room({ x: W - 4, y: y1 - 2, w: 4, h: 5 }, "exit");
	// A hidden grove off the path.
	const gx = rng.int(4, W - 6), gy = rng.next() < 0.5 ? rng.int(2, 5) : rng.int(H - 7, H - 4);
	b.disc(gx + 1.5, gy + 1.5, 2.2, "grass", (t) => t === "tree" || t === "tall_grass" || t === "rock");
	b.room({ x: gx, y: gy, w: 4, h: 4 }, "grove");
	if (rng.next() < 0.6) b.entity({ kind: "feature", name: "Standing stone", sprite: "standing_stone", x: gx + 1, y: gy + 1 });
	if (rng.next() < 0.5) addProps(b, cr, "log", "Fallen log", 1, false);
	return b;
}

function genSwamp(W: number, H: number, rng: Rng, f: Feat, seed: number): Builder {
	const b = new Builder(W, H, rng, "mud");
	const n = makeNoise2D(seed ^ 0x77), n2 = makeNoise2D(seed ^ 0x99);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const h = fbm(n, x / 10, y / 10, 4);
		const r = rng.next();
		if (h < -0.32) b.set(x, y, "deep_water");
		else if (h < -0.12) b.set(x, y, "water");
		else if (h < 0.0) b.set(x, y, r < 0.5 ? "tall_grass" : "mud");
		else if (h > 0.2) b.set(x, y, r < 0.22 ? "tree" : fbm(n2, x / 5, y / 5, 2) > 0.2 ? "tall_grass" : "grass");
		else if (r < 0.06) b.set(x, y, "tree");
	}
	const y0 = rng.int(4, H - 5), y1 = rng.int(4, H - 5);
	b.path(meander(rng, { x: 0, y: y0 }, { x: W - 1, y: y1 }, 5, 7, W, H), (t) => (t === "water" || t === "deep_water" ? "bridge" : t === "tree" ? "mud" : t), 1.6);
	b.entry = { x: 0, y: y0 };
	if (!isPassable(b.get(0, y0))) b.set(0, y0, "mud");
	b.room({ x: 0, y: y0 - 2, w: 4, h: 5 }, "entrance");
	// Witch hut on an island
	const hx = rng.int(Math.floor(W * 0.55), W - 9), hy = rng.int(3, H - 9);
	b.disc(hx + 2.5, hy + 2.5, 4, (t) => (t === "deep_water" || t === "water" || t === "tree" ? "grass" : t === "mud" ? "grass" : t));
	b.fill({ x: hx + 1, y: hy + 1, w: 4, h: 3 }, "building");
	b.set(hx + 2, hy + 4, "door");
	b.room({ x: hx + 1, y: hy + 1, w: 4, h: 4 }, "hut");
	b.room({ x: W - 4, y: y1 - 2, w: 4, h: 5 }, "exit");
	// Sunken ruin
	const rx = rng.int(4, Math.floor(W * 0.45)), ry = rng.int(3, H - 8);
	b.fill({ x: rx, y: ry, w: 5, h: 5 }, "floor");
	for (const p of [[rx, ry], [rx + 4, ry], [rx, ry + 4], [rx + 4, ry + 4]]) b.set(p[0], p[1], "pillar");
	b.set(rx + 2, ry + 2, "rubble");
	b.room({ x: rx, y: ry, w: 5, h: 5 }, "ruin");
	for (let i = 0; i < 3; i++) {
		const x = rng.int(3, W - 4), y = rng.int(3, H - 4);
		if (/water/.test(b.get(x, y))) b.entity({ kind: "light", name: "Will-o'-wisp glow", sprite: "wisp", x, y, lightRadius: 1 });
	}
	return b;
}

function genMountainPass(W: number, H: number, rng: Rng, f: Feat, seed: number): Builder {
	const b = new Builder(W, H, rng, "wall");
	const nz = makeNoise2D(seed ^ 0x3a);
	const y0 = rng.int(Math.floor(H * 0.3), Math.floor(H * 0.7)), y1 = rng.int(Math.floor(H * 0.3), Math.floor(H * 0.7));
	const pts = meander(rng, { x: 0, y: y0 }, { x: W - 1, y: y1 }, 5, H * 0.45, W, H);
	const line = b.path(pts, "floor", (fr) => 4.5 + 2.5 * (fbm(nz, fr * 6, 0.5, 2) + 1));
	// Side pockets / ledges
	const pockets: Rect[] = [];
	for (let i = 0; i < 4; i++) {
		const p = line[Math.floor(((i + 0.5) / 4) * line.length)];
		const side = rng.next() < 0.5 ? -1 : 1;
		const c = { x: p.x + rng.int(-2, 2), y: clamp(p.y + side * rng.int(4, 6), 3, H - 4) };
		b.disc(c.x, c.y, rng.int(2, 3) + 0.4, "floor");
		b.path([p, c], "floor", 2);
		pockets.push({ x: Math.round(c.x) - 2, y: Math.round(c.y) - 2, w: 5, h: 5 });
	}
	// Scree, boulders, gravel
	const dist = distanceToWall(b);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		if (b.get(x, y) !== "floor") continue;
		const d = dist[y * W + x], r = rng.next();
		if (d === 1 && r < 0.25) b.set(x, y, "rubble");
		else if (d >= 2 && r < 0.035) b.set(x, y, "rock");
		else if (fbm(nz, x / 5, y / 5, 2) > 0.35) b.set(x, y, "sand");
	}
	// Chasm with a rope bridge.
	if (f.has("chasm") || rng.next() < 0.55) {
		const i = Math.floor(line.length * (0.45 + rng.next() * 0.15));
		const p = line[i], q = line[Math.min(line.length - 1, i + 4)];
		const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
		const ux = dx / len, uy = dy / len;
		for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
			const t = b.get(x, y);
			if (!isPassable(t) && t !== "rock") continue;
			const along = (x - p.x) * ux + (y - p.y) * uy;
			const across = -(x - p.x) * uy + (y - p.y) * ux;
			if (Math.abs(along) < 1.1 && Math.abs(across) < 16) b.set(x, y, Math.abs(across) < 1.1 ? "bridge" : "pit");
		}
		b.room({ x: Math.round(p.x) - 2, y: Math.round(p.y) - 2, w: 5, h: 5 }, "chasm");
	}
	b.entry = { x: 0, y: y0 };
	b.room({ x: 0, y: y0 - 2, w: 4, h: 5 }, "entrance");
	pockets.forEach((r, i) => b.room(r, i % 2 ? "overlook" : "ambush"));
	b.room({ x: W - 4, y: y1 - 2, w: 4, h: 5 }, "exit");
	return b;
}

function genRoad(W: number, H: number, rng: Rng, f: Feat, seed: number): Builder {
	const b = new Builder(W, H, rng, "grass");
	const n1 = makeNoise2D(seed ^ 0x11), n2 = makeNoise2D(seed ^ 0x22);
	const y0 = rng.int(Math.floor(H * 0.35), Math.floor(H * 0.65)), y1 = rng.int(Math.floor(H * 0.35), Math.floor(H * 0.65));
	const pts = meander(rng, { x: 0, y: y0 }, { x: W - 1, y: y1 }, 4, 6, W, H);
	// distance to road centreline (approx) to keep the road clear
	const line: Point[] = [];
	for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s <= 20; s++) line.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * (s / 20), y: pts[i].y + (pts[i + 1].y - pts[i].y) * (s / 20) });
	const dRoad = (x: number, y: number) => line.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y)), Infinity);
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const d = dRoad(x, y);
		const dens = fbm(n1, x / 7, y / 7, 3) + (d - 6) * 0.07;
		if (d > 3 && dens + rng.next() * 0.3 > 0.3) b.set(x, y, "tree");
		else if (d > 2 && fbm(n2, x / 5, y / 5, 2) > 0.15) b.set(x, y, "tall_grass");
	}
	if ((f.has("water") || rng.next() < 0.4) && !f.has("no_water")) {
		const sx = W * (0.25 + rng.next() * 0.5);
		b.path(meander(rng, { x: sx, y: 0 }, { x: sx + (rng.next() - 0.5) * 8, y: H - 1 }, 4, 5, W, H), "water", 2.4);
	}
	b.path(pts, roadOver, 3);
	// Ambush cover clusters on both sides
	const cover: Rect[] = [];
	for (let i = 0; i < 3; i++) {
		const p = line[Math.floor(((i + 0.6) / 3.4) * line.length)];
		const side = i % 2 ? -1 : 1;
		const c = { x: Math.round(p.x), y: clamp(Math.round(p.y + side * rng.int(3, 5)), 2, H - 3) };
		b.disc(c.x, c.y, 2.5, "grass", (t) => t !== "road" && t !== "bridge" && t !== "water");
		const kind = rng.next();
		for (let k = 0; k < 4; k++) {
			const x = c.x + rng.int(-2, 2), y = c.y + rng.int(-1, 1);
			const t = b.get(x, y);
			if (t === "road" || t === "bridge" || t === "water") continue;
			b.set(x, y, kind < 0.5 ? "rock" : k % 2 ? "tree" : "tall_grass");
		}
		cover.push({ x: c.x - 2, y: c.y - 2, w: 5, h: 5 });
	}
	b.entry = { x: 0, y: y0 };
	b.room({ x: 0, y: y0 - 2, w: 4, h: 5 }, "entrance");
	cover.forEach((r) => b.room(r, "ambush"));
	b.room({ x: W - 4, y: y1 - 2, w: 4, h: 5 }, "exit");
	const mid = line[Math.floor(line.length * 0.55)];
	if (rng.next() < 0.6) b.entity({ kind: "feature", name: "Overturned cart", sprite: "cart", x: Math.round(mid.x), y: Math.round(mid.y) - 1, size: 2 });
	return b;
}

function genCamp(W: number, H: number, rng: Rng, f: Feat, seed: number): Builder {
	const b = new Builder(W, H, rng, "grass");
	const n1 = makeNoise2D(seed ^ 0x5c);
	const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
	const R = Math.min(W, H) / 2 - 3;
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		const d = Math.hypot((x - cx) * (H / W) * 1.15, y - cy);
		if (d > R + fbm(n1, x / 5, y / 5, 2) * 3 && rng.next() < 0.75) b.set(x, y, "tree");
		else if (d > R - 2 && rng.next() < 0.2) b.set(x, y, "tall_grass");
	}
	const palisade = f.has("palisade") || rng.next() < 0.4;
	if (palisade) {
		const rx = Math.floor(W / 2) - 3, ry = Math.floor(H / 2) - 3;
		for (let a = 0; a < Math.PI * 2; a += 0.02) {
			const x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry);
			if (Math.abs(a - Math.PI) < 0.18) continue; // west gate
			b.set(x, y, "wall");
		}
		for (let a = 0; a < Math.PI * 2; a += 0.02) b.disc(cx + Math.cos(a) * (rx + 1.2), cy + Math.sin(a) * (ry + 1.2), 0.6, "grass", (t) => t === "tree");
	}
	// Entry path from west
	b.path([{ x: 0, y: cy }, { x: cx - 3, y: cy }], (t) => (t === "wall" ? "road" : "road"), 2);
	b.disc(cx, cy, 3.4, "grass", (t) => t === "road" || t === "tall_grass");
	b.entity({ kind: "feature", name: "Campfire", sprite: "campfire", x: cx, y: cy, lightRadius: 4 });
	for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) if (rng.next() < 0.7) b.entity({ kind: "feature", name: "Log seat", sprite: "log", x: cx + dx, y: cy + dy });
	const nt = rng.int(3, 5);
	for (let i = 0; i < nt; i++) {
		const a = (i / nt) * Math.PI * 2 + 0.6;
		const x = Math.round(cx + Math.cos(a) * (R * 0.62) * (W / H) * 0.8) - 1, y = Math.round(cy + Math.sin(a) * R * 0.62) - 1;
		if (x < 1 || y < 1 || x > W - 3 || y > H - 3) continue;
		b.fill({ x, y, w: 2, h: 2 }, "grass");
		b.entity({ kind: "feature", name: "Tent", sprite: "tent", x, y, size: 2 });
		b.room({ x, y, w: 2, h: 2 }, "tent");
	}
	const sx = cx + Math.round(R * 0.4), sy = cy + Math.round(R * 0.5);
	b.room({ x: sx - 1, y: sy - 1, w: 3, h: 3 }, "storage");
	b.disc(sx, sy, 1.5, "grass");
	for (const [dx, dy, s] of [[-1, 0, "crate"], [0, 0, "barrel"], [1, 0, "crate"]] as const) b.entity({ kind: "feature", name: s === "crate" ? "Supply crate" : "Water barrel", sprite: s, x: sx + dx, y: sy + dy });
	b.room({ x: cx - 3, y: cy - 3, w: 7, h: 7 }, "fire");
	b.entry = { x: 0, y: cy };
	b.room({ x: 0, y: cy - 2, w: 4, h: 5 }, "entrance");
	return b;
}

// ─── Town ────────────────────────────────────────────────────────────────

function genTown(W: number, H: number, rng: Rng, f: Feat, seed: number): Builder {
	const b = new Builder(W, H, rng, "grass");
	const n1 = makeNoise2D(seed ^ 0x7e);
	// Streets
	const vx = [Math.floor(W / 2) + rng.int(-3, 3)];
	const hy = [Math.floor(H / 2) + rng.int(-2, 2)];
	if (W >= 36) { vx.push(rng.int(7, vx[0] - 9)); vx.push(rng.int(vx[0] + 10, W - 8)); }
	if (H >= 30) { hy.push(rng.int(6, hy[0] - 8)); if (rng.next() < 0.6) hy.push(rng.int(hy[0] + 9, H - 7)); }
	vx.sort((a, c) => a - c);
	hy.sort((a, c) => a - c);
	const mainW = 3, sideW = 2;
	for (const x of vx) {
		const w = x === vx[Math.floor(vx.length / 2)] ? mainW : sideW;
		const top = x === vx[Math.floor(vx.length / 2)] ? 0 : hy[0];
		const bot = x === vx[Math.floor(vx.length / 2)] ? H - 1 : hy[hy.length - 1];
		b.fill({ x: x - (w >> 1), y: top, w, h: bot - top + 1 }, "road");
	}
	for (const y of hy) {
		const main = y === hy[Math.floor(hy.length / 2)];
		const w = main ? mainW : sideW;
		const l = main ? 0 : vx[0], r = main ? W - 1 : vx[vx.length - 1];
		b.fill({ x: l, y: y - (w >> 1), w: r - l + 1, h: w }, "road");
	}
	// Plaza
	const pc = { x: vx[Math.floor(vx.length / 2)], y: hy[Math.floor(hy.length / 2)] };
	const plaza: Rect = { x: pc.x - 5, y: pc.y - 4, w: 11, h: 9 };
	b.fill(plaza, "road");
	b.entity({ kind: "feature", name: "Town well", sprite: "well", x: pc.x, y: pc.y });
	addTorches(b, plaza, 0);
	b.room(plaza, "plaza");
	// Blocks between streets → lots
	const xs = [0, ...vx, W - 1];
	const ys = [0, ...hy, H - 1];
	const isStreet = (x: number, y: number) => b.get(x, y) === "road";
	const buildingTags = ["inn", "temple", "smithy", "general_store", "guardhouse", "alchemist", "stable"];
	let tagI = 0;
	const lots: Rect[] = [];
	for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
		let bx0 = xs[i] + 1, bx1 = xs[i + 1] - 1, by0 = ys[j] + 1, by1 = ys[j + 1] - 1;
		while (bx0 <= bx1 && isStreet(bx0, (by0 + by1) >> 1)) bx0++;
		while (bx1 >= bx0 && isStreet(bx1, (by0 + by1) >> 1)) bx1--;
		while (by0 <= by1 && isStreet((bx0 + bx1) >> 1, by0)) by0++;
		while (by1 >= by0 && isStreet((bx0 + bx1) >> 1, by1)) by1--;
		const block: Rect = { x: bx0, y: by0, w: bx1 - bx0 + 1, h: by1 - by0 + 1 };
		if (block.w < 5 || block.h < 5) continue;
		// two rows of lots along the long axis
		const horiz = block.w >= block.h;
		const len = horiz ? block.w : block.h;
		const depth = horiz ? block.h : block.w;
		const rows = depth >= 12 ? 2 : 1;
		for (let rI = 0; rI < rows; rI++) {
			let pos = 0;
			while (pos < len - 3) {
				const lw = Math.min(len - pos, rng.int(5, 8));
				if (lw < 4) break;
				const d = rows === 2 ? Math.floor(depth / 2) : depth;
				const lot: Rect = horiz ? { x: block.x + pos, y: block.y + rI * (depth - d), w: lw, h: d } : { x: block.x + rI * (depth - d), y: block.y + pos, w: d, h: lw };
				lots.push(lot);
				pos += lw;
			}
		}
	}
	for (const lot of lots) {
		const r = rng.next();
		const inner: Rect = { x: lot.x + 1, y: lot.y + 1, w: lot.w - 2, h: lot.h - 2 };
		if (inner.w < 3 || inner.h < 3 || r < 0.12) {
			// garden / orchard
			for (const p of interior(lot)) if (b.get(p.x, p.y) === "grass" && rng.next() < 0.25) b.set(p.x, p.y, rng.next() < 0.5 ? "tree" : "tall_grass");
			continue;
		}
		// shrink a bit randomly for variety, keep 1-tile yard ring
		const bw = Math.max(3, inner.w - (rng.next() < 0.3 ? 1 : 0));
		const bh = Math.max(3, inner.h - (rng.next() < 0.3 ? 1 : 0));
		const br: Rect = { x: inner.x + (inner.w - bw > 0 && rng.next() < 0.5 ? 1 : 0), y: inner.y + (inner.h - bh > 0 && rng.next() < 0.5 ? 1 : 0), w: bw, h: bh };
		b.fill(br, "building");
		// Door facing the nearest street.
		const c = center(br);
		const options: { p: Point; out: Point; d: number }[] = [
			{ p: { x: c.x, y: br.y + br.h - 1 }, out: { x: c.x, y: br.y + br.h }, d: 0 },
			{ p: { x: c.x, y: br.y }, out: { x: c.x, y: br.y - 1 }, d: 0 },
			{ p: { x: br.x, y: c.y }, out: { x: br.x - 1, y: c.y }, d: 0 },
			{ p: { x: br.x + br.w - 1, y: c.y }, out: { x: br.x + br.w, y: c.y }, d: 0 },
		];
		for (const o of options) {
			let d = 0;
			let x = o.out.x, y = o.out.y;
			const sx = Math.sign(o.out.x - o.p.x), sy = Math.sign(o.out.y - o.p.y);
			while (b.in(x, y) && !isStreet(x, y) && d < 30) { x += sx; y += sy; d++; }
			o.d = b.in(x, y) ? d : 99;
		}
		options.sort((a, c2) => a.d - c2.d);
		const door = options[0];
		b.set(door.p.x, door.p.y, "door");
		if (b.get(door.out.x, door.out.y) !== "road") b.set(door.out.x, door.out.y, "road");
		const tag = br.w * br.h >= 20 && tagI < buildingTags.length ? buildingTags[tagI++] : "house";
		b.room(br, tag);
	}
	// Lamps along the main street, a few trees on remaining grass.
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
		if (b.get(x, y) === "grass" && fbm(n1, x / 6, y / 6, 2) > 0.3 && rng.next() < 0.3) b.set(x, y, "tree");
	}
	const mainY = hy[Math.floor(hy.length / 2)];
	for (let x = 4; x < W - 4; x += 8) {
		const y = mainY - 2;
		if (b.get(x, y) === "grass" || b.get(x, y) === "road") b.entity({ kind: "light", name: "Street lamp", sprite: "lamp", x, y, lightRadius: 3 });
	}
	b.entry = { x: 0, y: mainY };
	b.room({ x: 0, y: mainY - 2, w: 4, h: 5 }, "entrance");
	// Market stalls in the plaza
	for (const [dx, dy] of [[-3, -2], [3, -2], [-3, 2], [3, 2]]) if (rng.next() < 0.7) b.entity({ kind: "feature", name: "Market stall", sprite: "stall", x: pc.x + dx, y: pc.y + dy });
	return b;
}

// ─── Tavern interior ──────────────────────────────────────────────────────

function genTavern(W: number, H: number, rng: Rng): Builder {
	const b = new Builder(W, H, rng, "grass");
	const street: Rect = { x: 0, y: H - 3, w: W, h: 3 };
	b.fill(street, "road");
	const shell: Rect = { x: 1, y: 1, w: W - 2, h: H - 4 };
	b.fill(shell, "wall");
	const inside: Rect = { x: 2, y: 2, w: W - 4, h: H - 6 };
	b.fill(inside, "wood_floor");
	// Back rooms on the right
	const backW = Math.max(6, Math.floor(inside.w * 0.3));
	const wallX = inside.x + inside.w - backW - 1;
	for (let y = inside.y; y < inside.y + inside.h; y++) b.set(wallX, y, "wall");
	const kitchenH = Math.floor(inside.h / 2);
	const kitchen: Rect = { x: wallX + 1, y: inside.y, w: backW, h: kitchenH };
	const storage: Rect = { x: wallX + 1, y: inside.y + kitchenH + 1, w: backW, h: inside.h - kitchenH - 1 };
	b.fill(kitchen, "floor");
	for (let x = wallX + 1; x < inside.x + inside.w; x++) b.set(x, inside.y + kitchenH, "wall");
	b.set(wallX, kitchen.y + Math.floor(kitchen.h / 2), "door");
	b.set(kitchen.x + Math.floor(kitchen.w / 2), inside.y + kitchenH, "door");
	// Private room top-left
	const priv: Rect = { x: inside.x, y: inside.y, w: 5, h: 4 };
	for (let x = priv.x; x <= priv.x + priv.w; x++) b.set(x, priv.y + priv.h, "wall");
	for (let y = priv.y; y <= priv.y + priv.h; y++) b.set(priv.x + priv.w, y, "wall");
	b.set(priv.x + priv.w, priv.y + 2, "door");
	b.set(priv.x + 2, priv.y + 1, "table");
	b.set(priv.x + 3, priv.y + 1, "table");
	// Common room
	const common: Rect = { x: inside.x, y: inside.y, w: wallX - inside.x, h: inside.h };
	// Bar along the back wall
	const barX = wallX - 3;
	const barTop = inside.y + 2, barBot = inside.y + inside.h - 4;
	for (let y = barTop; y <= barBot; y++) b.set(barX, y, "bar_counter");
	b.set(barX + 1, barBot, "bar_counter");
	const behindBar: Rect = { x: barX + 1, y: barTop, w: 2, h: barBot - barTop };
	// Tables
	for (let ty = inside.y + 2; ty < inside.y + inside.h - 2; ty += 3) {
		for (let tx = inside.x + 2; tx < barX - 3; tx += 4) {
			if (tx <= priv.x + priv.w + 1 && ty <= priv.y + priv.h + 1) continue;
			const doorX = Math.floor(W / 2);
			if (Math.abs(tx - doorX) <= 1 && ty >= inside.y + inside.h - 4) continue;
			b.set(tx, ty, "table");
			if (rng.next() < 0.5) b.set(tx + 1, ty, "table");
		}
	}
	// Front door
	const doorX = Math.floor(W / 2) - 2;
	b.set(doorX, H - 4, "door_open");
	b.set(doorX, H - 5, "wood_floor");
	b.set(inside.x, inside.y + inside.h - 1, "stairs_up");
	// Rooms & props
	b.room(common, "common_room");
	b.room(behindBar, "bar");
	b.room(kitchen, "kitchen");
	b.room(storage, "storage");
	b.room(priv, "private");
	b.room({ x: doorX - 2, y: H - 3, w: 5, h: 3 }, "entrance");
	b.entity({ kind: "feature", name: "Hearth", sprite: "hearth", x: inside.x, y: inside.y + Math.floor(inside.h / 2) + 1, lightRadius: 4 });
	addProps(b, behindBar, "barrel", "Ale cask", 2, true);
	addProps(b, storage, "barrel", "Barrel", rng.int(2, 4));
	addProps(b, storage, "crate", "Crate", rng.int(1, 3));
	b.entity({ kind: "feature", name: "Cooking fire", sprite: "hearth", x: kitchen.x + kitchen.w - 1, y: kitchen.y, lightRadius: 3 });
	addProps(b, kitchen, "table_small", "Prep table", 1, true);
	for (let i = 0; i < 3; i++) {
		const tx = rng.int(common.x + 1, barX - 2), ty = rng.int(common.y + 1, common.y + common.h - 2);
		if (b.get(tx, ty) === "table") b.entity({ kind: "light", name: "Candle", sprite: "candles", x: tx, y: ty, lightRadius: 2 });
	}
	b.entity({ kind: "light", name: "Lantern", sprite: "lantern", x: doorX + 1, y: H - 3, lightRadius: 3 });
	b.entry = { x: doorX, y: H - 2 };
	return b;
}

// ─── Castle ──────────────────────────────────────────────────────────────

function genCastle(W: number, H: number, rng: Rng): Builder {
	if (W % 2 === 0) W -= 1;
	const b = new Builder(W, H, rng, "grass");
	const mid = Math.floor(W / 2);
	// Moat
	const moat: Rect = { x: 1, y: 1, w: W - 2, h: H - 4 };
	b.outline(moat, "deep_water");
	b.outline({ x: 2, y: 2, w: W - 4, h: H - 6 }, "deep_water");
	// Curtain wall (2 thick) directly behind the moat
	const wallR: Rect = { x: 3, y: 3, w: W - 6, h: H - 8 };
	b.outline(wallR, "wall");
	b.outline({ x: 4, y: 4, w: W - 8, h: H - 10 }, "wall");
	const court: Rect = { x: 5, y: 5, w: W - 10, h: H - 12 };
	b.fill(court, "grass");
	// Gate + bridge
	const gy = wallR.y + wallR.h - 1;
	for (let x = mid - 1; x <= mid + 1; x++) {
		b.set(x, gy, "door_open");
		b.set(x, gy - 1, "floor");
		for (let y = gy + 1; y < H; y++) b.set(x, y, y >= H - 4 + 0 && y <= H - 4 + 1 ? "road" : b.get(x, y) === "deep_water" ? "bridge" : "road");
	}
	// Towers in corners
	const towers: Rect[] = [];
	for (const [tx, ty] of [[wallR.x + 1, wallR.y + 1], [wallR.x + wallR.w - 2, wallR.y + 1], [wallR.x + 1, wallR.y + wallR.h - 2], [wallR.x + wallR.w - 2, wallR.y + wallR.h - 2]]) {
		b.disc(tx + 0.5, ty + 0.5, 3.3, "wall");
		b.disc(tx + 0.5, ty + 0.5, 1.6, "floor");
		towers.push({ x: tx - 1, y: ty - 1, w: 3, h: 3 });
		// door toward courtyard
		const dx = tx < mid ? 1 : -1, dy = ty < H / 2 ? 1 : -1;
		const doorP = { x: tx + dx * 2, y: ty + dy * 2 };
		b.set(doorP.x, doorP.y, "door");
		b.set(doorP.x + dx, doorP.y + dy, "grass");
		b.set(tx + dx, ty + dy, "floor");
	}
	// Keep
	const keep: Rect = { x: mid - 9, y: court.y + 1, w: 19, h: Math.min(15, Math.floor(court.h * 0.5)) };
	b.fill(keep, "wall");
	const hall: Rect = { x: keep.x + 5, y: keep.y + 1, w: keep.w - 10, h: keep.h - 2 };
	b.fill(hall, "floor");
	pillarRows(b, { x: hall.x, y: hall.y + 2, w: hall.w, h: hall.h - 3 }, 2);
	const leftR: Rect = { x: keep.x + 1, y: keep.y + 1, w: 3, h: keep.h - 2 };
	const rightR: Rect = { x: keep.x + keep.w - 4, y: keep.y + 1, w: 3, h: keep.h - 2 };
	const lTop: Rect = { ...leftR, h: Math.floor(leftR.h / 2) };
	const lBot: Rect = { ...leftR, y: leftR.y + lTop.h + 1, h: leftR.h - lTop.h - 1 };
	b.fill(lTop, "floor");
	b.fill(lBot, "floor");
	b.fill(rightR, "floor");
	b.set(keep.x + 4, lTop.y + 1, "door");
	b.set(keep.x + 4, lBot.y + 1, "door");
	b.set(keep.x + keep.w - 5, rightR.y + Math.floor(rightR.h / 2), "door_locked");
	for (let x = mid - 1; x <= mid + 1; x++) b.set(x, keep.y + keep.h - 1, x === mid ? "door" : "wall");
	b.entity({ kind: "feature", name: "Throne", sprite: "throne", x: mid, y: hall.y });
	b.entity({ kind: "feature", name: "Banner", sprite: "banner", x: mid - 2, y: hall.y });
	b.entity({ kind: "feature", name: "Banner", sprite: "banner", x: mid + 2, y: hall.y });
	addTorches(b, hall, 4);
	addProps(b, rightR, "chest", "Strongbox", 2, true);
	addProps(b, lBot, "bedroll", "Bunk", 2, true);
	addProps(b, lTop, "weapon_rack", "Weapon rack", 2, true);
	// Courtyard: road to keep, well, stables
	b.path([{ x: mid, y: gy - 1 }, { x: mid, y: keep.y + keep.h }], (t) => (t === "grass" ? "road" : t), 3);
	// Courtyard greenery
	for (let i = 0; i < 14; i++) {
		const x = rng.int(court.x + 1, court.x + court.w - 2), y = rng.int(keep.y + keep.h + 1, court.y + court.h - 2);
		if (b.get(x, y) === "grass" && Math.abs(x - mid) > 2) b.set(x, y, rng.next() < 0.4 ? "tree" : "tall_grass");
	}
	const stableLeft = rng.next() < 0.5;
	const stable: Rect = { x: stableLeft ? court.x + 1 : court.x + court.w - 8, y: court.y + court.h - 6, w: 7, h: 4 };
	b.fill(stable, "building");
	b.set(stable.x + 3, stable.y, "door");
	const wellX = stableLeft ? court.x + court.w - 6 : court.x + 5;
	b.set(wellX, court.y + court.h - 5, "grass");
	b.entity({ kind: "feature", name: "Well", sprite: "well", x: wellX, y: court.y + court.h - 5 });
	addProps(b, { x: stableLeft ? court.x + court.w - 8 : court.x + 2, y: court.y + court.h - 3, w: 6, h: 2 }, "crate", "Supply crate", 3, false);
	b.room({ x: mid - 3, y: gy, w: 7, h: H - gy }, "entrance");
	b.room(court, "courtyard");
	b.room(hall, "throne");
	b.room(lTop, "armory");
	b.room(lBot, "barracks");
	b.room(rightR, "treasure");
	b.room(stable, "stable");
	towers.forEach((t) => b.room(t, "tower"));
	b.entry = { x: mid, y: H - 2 };
	return b;
}

// ─── Ship ────────────────────────────────────────────────────────────────

function genShip(W: number, H: number, rng: Rng): Builder {
	const b = new Builder(W, H, rng, "deep_water");
	const dockH = 3;
	const cy = (H - dockH) / 2;
	const x0 = 3, x1 = W - 3;
	const maxHW = Math.min((H - dockH) / 2 - 1.5, 5.5);
	const hwAt = (x: number) => {
		const t = (x - x0) / (x1 - x0);
		if (t < 0 || t > 1) return -1;
		if (t > 0.7) return maxHW * Math.sqrt(Math.max(0, 1 - ((t - 0.7) / 0.3) ** 2));
		if (t < 0.08) return maxHW * (0.8 + t * 2.5);
		return maxHW;
	};
	for (let y = 0; y < H - dockH; y++) for (let x = x0; x <= x1; x++) {
		const hw = hwAt(x);
		const dy = Math.abs(y + 0.5 - cy);
		if (hw < 0 || dy > hw + 0.5) continue;
		b.set(x, y, dy > hw - 0.5 ? "wall" : "wood_floor");
	}
	// Fix bow/stern tips as rail
	for (let y = 0; y < H - dockH; y++) for (let x = 0; x < W; x++) {
		if (b.get(x, y) !== "wood_floor") continue;
		if (b.neighbors4(x, y).some((n) => b.get(n.x, n.y) === "deep_water")) b.set(x, y, "wall");
	}
	// Cabin at the stern: a bulkhead across the whole hull
	const bulk = x0 + 8;
	let top = H, bot = 0;
	for (let y = 0; y < H - dockH; y++) if (b.get(bulk, y) === "wood_floor") { b.set(bulk, y, "wall"); top = Math.min(top, y); bot = Math.max(bot, y); }
	const cabin: Rect = { x: x0 + 1, y: top, w: bulk - x0 - 1, h: Math.max(1, bot - top + 1) };
	b.set(bulk, Math.round(cy), "door");
	// Masts & hatch
	const masts = rng.next() < 0.5
		? [Math.round(x0 + (x1 - x0) * (0.4 + rng.next() * 0.05)), Math.round(x0 + (x1 - x0) * (0.66 + rng.next() * 0.06))]
		: [Math.round(x0 + (x1 - x0) * 0.36), Math.round(x0 + (x1 - x0) * 0.54), Math.round(x0 + (x1 - x0) * 0.72)];
	const my = Math.floor(cy);
	for (const mx of masts) b.set(mx, my, "pillar");
	const hatchX = masts[0] + 2 + rng.int(0, 2);
	b.set(hatchX, my + (rng.next() < 0.5 ? 1 : -1), "stairs_down");
	// coiled ropes / loose planks
	for (let i = 0; i < 4; i++) {
		const x = rng.int(bulk + 2, x1 - 3), y = rng.int(1, H - dockH - 2);
		if (b.get(x, y) === "wood_floor" && rng.next() < 0.6) b.set(x, y, "difficult");
	}
	// Dock and gangplank
	b.fill({ x: 0, y: H - dockH, w: W, h: dockH }, "bridge");
	const gx = masts[0] + 2;
	let gy = H - dockH - 1;
	while (gy > 0 && b.get(gx, gy) === "deep_water") { b.set(gx, gy, "bridge"); gy--; }
	if (b.get(gx, gy) === "wall") b.set(gx, gy, "wood_floor");
	b.entry = { x: gx, y: H - 2 };
	// Props
	const deck: Rect = { x: cabin.x + cabin.w + 1, y: 0, w: x1 - cabin.x - cabin.w - 1, h: H - dockH };
	addProps(b, deck, "barrel", "Barrel", rng.int(2, 4), true);
	addProps(b, deck, "crate", "Cargo crate", rng.int(2, 3), true);
	b.entity({ kind: "feature", name: "Ship's wheel", sprite: "wheel", x: cabin.x + cabin.w + 1, y: my });
	addProps(b, cabin, "chest", "Captain's chest", 1, true);
	addProps(b, cabin, "table_small", "Chart table", 1, false);
	b.entity({ kind: "light", name: "Lantern", sprite: "lantern", x: masts[0], y: my + 1, lightRadius: 3 });
	b.entity({ kind: "light", name: "Lantern", sprite: "lantern", x: masts[1], y: my - 1, lightRadius: 3 });
	for (let x = 2; x < W - 2; x += 7) b.entity({ kind: "feature", name: "Bollard", sprite: "bollard", x, y: H - dockH });
	b.room({ x: 0, y: H - dockH, w: W, h: dockH }, "entrance");
	b.room(deck, "deck");
	b.room(cabin, "cabin");
	b.room({ x: hatchX - 1, y: my - 1, w: 3, h: 3 }, "hatch");
	return b;
}

// ─── Arena ───────────────────────────────────────────────────────────────

function genArena(W: number, H: number, rng: Rng): Builder {
	const b = new Builder(W, H, rng, "wall");
	const cx = (W - 1) / 2, cy = (H - 1) / 2;
	const rx = W / 2 - 6, ry = H / 2 - 5;
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) b.set(x, y, "sand");
	// Gates W/E with holding rooms
	const gyy = Math.round(cy);
	const west: Rect = { x: 1, y: gyy - 2, w: 4, h: 5 };
	const east: Rect = { x: W - 5, y: gyy - 2, w: 4, h: 5 };
	b.fill(west, "floor");
	b.fill(east, "floor");
	for (let x = west.x + west.w; x < cx - rx + 1; x++) b.set(x, gyy, "floor");
	for (let x = Math.floor(cx + rx); x < east.x; x++) b.set(x, gyy, "floor");
	b.set(Math.ceil(cx - rx), gyy, "door");
	b.set(Math.floor(cx + rx), gyy, "door");
	for (let x = Math.ceil(cx - rx) - 1; x > west.x + west.w - 1; x--) if (b.get(x, gyy) === "wall") b.set(x, gyy, "floor");
	// Obstacles
	const off = Math.floor(Math.min(rx, ry) * 0.5);
	for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.set(Math.round(cx + dx * off), Math.round(cy + dy * off), "pillar");
	if (rng.next() < 0.5) b.disc(cx, cy, 1.6, "pit");
	else for (let i = 0; i < 3; i++) b.set(Math.round(cx + rng.int(-2, 2)), Math.round(cy + rng.int(-2, 2)), "rock");
	for (let i = 0; i < 6; i++) {
		const a = rng.next() * Math.PI * 2, r = rng.next() * 0.8;
		const x = Math.round(cx + Math.cos(a) * rx * r), y = Math.round(cy + Math.sin(a) * ry * r);
		if (b.get(x, y) === "sand") b.set(x, y, "rubble");
	}
	for (const [dx, dy] of [[0, -1], [0, 1]]) b.entity({ kind: "light", name: "Brazier", sprite: "brazier", x: Math.round(cx + dx * rx * 0.85), y: Math.round(cy + dy * ry * 0.85), lightRadius: 4 });
	b.room({ x: Math.round(cx - rx), y: Math.round(cy - ry), w: Math.round(rx * 2), h: Math.round(ry * 2) }, "arena");
	b.room(west, "entrance");
	b.room(east, "boss");
	b.entry = { x: west.x + 1, y: gyy };
	addProps(b, west, "weapon_rack", "Weapon rack", 1, true);
	addTorches(b, west, 1);
	addTorches(b, east, 1);
	return b;
}

// ─── Registry ────────────────────────────────────────────────────────────

type Gen = (W: number, H: number, rng: Rng, f: Feat, seed: number) => Builder;

const GENERATORS: Record<MapKind, Gen> = {
	dungeon: genDungeon,
	crypt: (W, H, rng, f) => genSymmetric(W, H, rng, f, false),
	temple: (W, H, rng, f) => genSymmetric(W, H, rng, f, true),
	cave: genCave,
	forest: genForest,
	swamp: genSwamp,
	mountain_pass: genMountainPass,
	road: genRoad,
	camp: genCamp,
	town: genTown,
	tavern: (W, H, rng) => genTavern(W, H, rng),
	castle: (W, H, rng) => genCastle(W, H, rng),
	ship: (W, H, rng) => genShip(W, H, rng),
	arena: (W, H, rng) => genArena(W, H, rng),
};

export const MAP_KINDS = Object.keys(GENERATORS) as MapKind[];
