/**
 * Modern-day look for the pixel painter (GridMap.theme === "modern", The Quiet):
 * the same tiles repainted as a present-day river town in late October:
 * asphalt with lane markings and curbs, concrete sidewalks, lawns with fallen
 * leaves, linoleum, hardwood and carpet, brick outside and painted drywall
 * inside, flat tar roofs with AC units, glass doors, desks, store counters,
 * autumn trees, concrete columns, debris and concrete bridges.
 */
import type { GridMap, Tile } from "@/lib/game/types";

const C = 16;

/** What the modern painters need from pixelScene's painter. */
export interface Painter {
	m: GridMap;
	t(x: number, y: number): Tile;
	px(x: number, y: number, w: number, h: number, c: string): void;
	speckle(x: number, y: number, base: string, dots: [string, number][], salt?: number): void;
	sprite(name: string, X: number, Y: number, extra?: Record<string, string>): void;
	groundOf(x: number, y: number): Tile;
	readonly snow: boolean;
	readonly desert: boolean;
}

function rnd(x: number, y: number, k = 0): number {
	let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const OUTDOOR = new Set<Tile>(["grass", "tall_grass", "road", "sand", "mud", "tree", "rock", "ice", "water", "deep_water", "bridge", "building"]);
const WALLISH = new Set<Tile>(["wall", "secret_door", "door", "door_open", "door_locked"]);

/** One pick per map from a list (so a map keeps one linoleum, one wall paint). */
const pick = <T,>(m: GridMap, list: readonly T[], salt: number): T => list[Math.floor(rnd(m.seed, salt, 7) * list.length)];

// ─── ground ────────────────────────────────────────────────────────────────

const LINO = [
	["#c9ccc3", "#bcc0b6"], // hospital pale grey-green
	["#d2c9b4", "#c4baa3"], // school beige
	["#c6c8cc", "#b6b9bf"], // store grey
] as const;
const CARPETS = ["#56657a", "#7a4f4a", "#66694f", "#857560", "#4f5a52"] as const;

/** Connected regions of wood_floor (rooms on drawn maps), cached per map. */
const regions = new WeakMap<Tile[], Int32Array>();
function regionOf(p: Painter, x: number, y: number): number {
	const m = p.m;
	let r = regions.get(m.tiles);
	if (!r) {
		r = new Int32Array(m.width * m.height).fill(-1);
		let n = 0;
		for (let i = 0; i < r.length; i++) {
			if (r[i] >= 0 || m.tiles[i] !== "wood_floor") continue;
			const stack = [i];
			r[i] = n;
			while (stack.length) {
				const j = stack.pop()!;
				const jx = j % m.width, jy = Math.floor(j / m.width);
				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const X = jx + dx, Y = jy + dy;
					if (X < 0 || Y < 0 || X >= m.width || Y >= m.height) continue;
					const k = Y * m.width + X;
					const t = m.tiles[k];
					// furniture stands on the room's floor, so it doesn't split the room
					if (r[k] < 0 && (t === "wood_floor" || t === "table" || t === "bar_counter" || t === "pillar" || t === "void")) {
						r[k] = n;
						stack.push(k);
					}
				}
			}
			n++;
		}
		regions.set(m.tiles, r);
	}
	const cx = Math.max(0, Math.min(m.width - 1, x)), cy = Math.max(0, Math.min(m.height - 1, y));
	return r[cy * m.width + cx];
}

function lawn(p: Painter, x: number, y: number) {
	p.speckle(x, y, "#64793a", [["#586c32", 0.14], ["#728648", 0.1], ["#7d8a46", 0.03], ["#b8662a", 0.012], ["#d39234", 0.01], ["#8a4a22", 0.012]], 21);
}

function asphalt(p: Painter, x: number, y: number) {
	p.speckle(x, y, "#47484c", [["#3c3d41", 0.16], ["#54555a", 0.1], ["#5f6065", 0.025]], 23);
	if (rnd(x, y, 24) < 0.08) {
		// a patched crack
		let cx = 3 + Math.floor(rnd(x, y, 25) * 10);
		for (let cy = 2; cy < 13; cy++) {
			p.px(x * C + cx, y * C + cy, 1, 1, "#2e2f32");
			if (rnd(x, cy, 26) < 0.35) cx += rnd(cy, x, 27) < 0.5 ? -1 : 1;
		}
	}
}

/** Length of the run of `same` tiles through (x,y) along (dx,dy), and how far (x,y) is from its start. */
function run(p: Painter, x: number, y: number, dx: number, dy: number, same: (t: Tile) => boolean): { len: number; at: number } {
	let a = 0, b = 0;
	while (a < 8 && same(p.t(x - dx * (a + 1), y - dy * (a + 1)))) a++;
	while (b < 8 && same(p.t(x + dx * (b + 1), y + dy * (b + 1)))) b++;
	return { len: a + b + 1, at: a };
}

const isRoad = (t: Tile) => t === "road";
const LANE = "#d6ad3a";

/** Dashed yellow centre line on road bands 2 to 5 squares wide (wider asphalt is a lot: no line). */
function lane(p: Painter, x: number, y: number, same: (t: Tile) => boolean, dir?: "h" | "v") {
	const X = x * C, Y = y * C;
	const v = run(p, x, y, 0, 1, same), h = run(p, x, y, 1, 0, same);
	const dash = (i: number) => (i + 2) % 8 < 4;
	if ((dir ?? (h.len > v.len ? "h" : v.len > h.len ? "v" : undefined)) === "h" && v.len >= 2 && v.len <= 5) {
		const line = (yy: number) => { for (let i = 0; i < 16; i++) if (dash(X + i)) p.px(X + i, yy, 1, 1, LANE); };
		if (v.len % 2 === 1 && v.at === (v.len - 1) / 2) line(Y + 7);
		else if (v.len % 2 === 0 && v.at === v.len / 2 - 1) line(Y + 15);
		else if (v.len % 2 === 0 && v.at === v.len / 2) line(Y);
	} else if ((dir ?? (v.len > h.len ? "v" : undefined)) === "v" && h.len >= 2 && h.len <= 5) {
		const line = (xx: number) => { for (let i = 0; i < 16; i++) if (dash(Y + i)) p.px(xx, Y + i, 1, 1, LANE); };
		if (h.len % 2 === 1 && h.at === (h.len - 1) / 2) line(X + 7);
		else if (h.len % 2 === 0 && h.at === h.len / 2 - 1) line(X + 15);
		else if (h.len % 2 === 0 && h.at === h.len / 2) line(X);
	}
}

function road(p: Painter, x: number, y: number) {
	const X = x * C, Y = y * C;
	if (p.snow) {
		p.speckle(x, y, "#9a9a98", [["#85878a", 0.18], ["#dfe5ea", 0.14], ["#c4c9ce", 0.1]], 23);
		return;
	}
	asphalt(p, x, y);
	lane(p, x, y, isRoad);
	// Curbs where the road meets a sidewalk, a lawn or a building.
	const curb = (t: Tile) => !isRoad(t) && t !== "bridge" && t !== "water" && t !== "deep_water" && t !== "mud" && t !== "void";
	if (curb(p.t(x, y - 1))) { p.px(X, Y, C, 1, "#b2afa7"); p.px(X, Y + 1, C, 1, "#2f3033"); }
	if (curb(p.t(x, y + 1))) { p.px(X, Y + 15, C, 1, "#77756f"); p.px(X, Y + 14, C, 1, "#3a3b3e"); }
	if (curb(p.t(x - 1, y))) { p.px(X, Y, 1, C, "#a3a098"); p.px(X + 1, Y, 1, C, "#34353a"); }
	if (curb(p.t(x + 1, y))) { p.px(X + 15, Y, 1, C, "#8a8780"); p.px(X + 14, Y, 1, C, "#3a3b3e"); }
}

function sidewalk(p: Painter, x: number, y: number) {
	const X = x * C, Y = y * C;
	if (p.snow) {
		p.speckle(x, y, "#c9ced2", [["#b3b8bd", 0.1], ["#e6ecf1", 0.14]], 22);
		p.px(X, Y + 15, C, 1, "#aeb3b8");
		return;
	}
	p.speckle(x, y, "#a19e95", [["#95928a", 0.12], ["#aeaba2", 0.09], ["#c06a2c", 0.006], ["#8a4a22", 0.006]], 22);
	// slab seams, one slab per square
	p.px(X, Y + 15, C, 1, "#85827a");
	p.px(X + 15, Y, 1, C, "#85827a");
	p.px(X, Y, C, 1, "#b0ada5");
	if (rnd(x, y, 28) < 0.12) {
		let cy = 2 + Math.floor(rnd(x, y, 29) * 10);
		for (let cx = 1; cx < 14; cx++) {
			p.px(X + cx, Y + cy, 1, 1, "#7a776f");
			if (rnd(cx, y, 30) < 0.3) cy += rnd(x, cx, 31) < 0.5 ? -1 : 1;
		}
	}
}

function linoleum(p: Painter, x: number, y: number) {
	const X = x * C, Y = y * C;
	const [a, b] = pick(p.m, LINO, 1);
	for (let j = 0; j < 2; j++)
		for (let i = 0; i < 2; i++) p.px(X + i * 8, Y + j * 8, 8, 8, (i + j + x + y) % 2 ? b : a);
	// grout and scuffs
	p.px(X, Y, C, 1, "rgba(0,0,0,0.07)");
	p.px(X, Y + 8, C, 1, "rgba(0,0,0,0.07)");
	p.px(X, Y, 1, C, "rgba(0,0,0,0.07)");
	p.px(X + 8, Y, 1, C, "rgba(0,0,0,0.07)");
	for (let i = 0; i < 3; i++) if (rnd(x, y, 32 + i) < 0.5) p.px(X + 1 + Math.floor(rnd(x, y, 35 + i) * 13), Y + 1 + Math.floor(rnd(x, y, 38 + i) * 14), 2, 1, "rgba(60,50,40,0.12)");
}

function hardwood(p: Painter, x: number, y: number) {
	const X = x * C, Y = y * C;
	const tones = ["#8f5f37", "#9a683d", "#855731"];
	for (let r = 0; r < 4; r++) {
		p.px(X, Y + r * 4, C, 4, tones[Math.floor(rnd(x, y * 4 + r, 41) * 3)]);
		p.px(X, Y + r * 4 + 3, C, 1, "#5f3d22");
		p.px(X + Math.floor(rnd(x, y * 4 + r, 42) * 15), Y + r * 4, 1, 3, "#5f3d22");
		p.px(X + Math.floor(rnd(x, y * 4 + r, 43) * 12), Y + r * 4 + 1, 3, 1, "#a8774a");
	}
}

function carpet(p: Painter, x: number, y: number, region: number) {
	const base = CARPETS[Math.floor(rnd(region, p.m.seed, 44) * CARPETS.length)];
	p.speckle(x, y, base, [[shade(base, 0.86), 0.2], [shade(base, 1.12), 0.12]], 45);
}

/** Paints modern ground; false when the fantasy painter should handle it (mud, ice). */
export function modernGround(p: Painter, x: number, y: number, g: Tile): boolean {
	switch (g) {
		case "grass":
		case "tall_grass":
			if (p.snow || p.desert) return false;
			lawn(p, x, y);
			return true;
		case "road":
			road(p, x, y);
			return true;
		case "sand":
			sidewalk(p, x, y);
			return true;
		case "floor":
			linoleum(p, x, y);
			return true;
		case "wood_floor": {
			const r = regionOf(p, x, y);
			if (r >= 0 && rnd(r, p.m.seed, 46) < 0.4) carpet(p, x, y, r);
			else hardwood(p, x, y);
			return true;
		}
	}
	return false;
}

// ─── walls, doors, roofs ───────────────────────────────────────────────────

const PAINTS = ["#d3ccbb", "#b8c6bf", "#c9bfae", "#bcc2c9"] as const;

/** Whether a wall square is part of a building's outside (it touches the street, a lawn…). */
function exterior(p: Painter, x: number, y: number): boolean {
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && OUTDOOR.has(p.t(x + dx, y + dy))) return true;
	return false;
}

export function modernWall(p: Painter, x: number, y: number) {
	const X = x * C, Y = y * C;
	const below = p.t(x, y + 1), above = p.t(x, y - 1);
	const faceShows = !WALLISH.has(below) && below !== "building" && below !== "void";
	if (exterior(p, x, y)) {
		// brick
		p.px(X, Y, C, C, "#a59a8a");
		for (let r = 0; r < 4; r++) {
			const off = (r + y) % 2 ? 0 : 4;
			for (let i = -off; i < 16; i += 8) {
				const tone = ["#8c4632", "#97503a", "#7f3f2d"][Math.floor(rnd(x * 4 + Math.floor((i + 8) / 8), y * 4 + r, 51) * 3)];
				p.px(X + Math.max(0, i), Y + r * 4, Math.min(16, i + 7) - Math.max(0, i), 3, tone);
			}
		}
		if (!WALLISH.has(above)) { p.px(X, Y, C, 2, "#6e6a64"); p.px(X, Y, C, 1, "#8d8982"); }
		if (faceShows) p.px(X, Y + 15, C, 1, "#4a3a30");
		// shop and house windows on walls that face the street; some are smashed
		const doorNear = WALLISH.has(p.t(x - 1, y)) && p.t(x - 1, y) !== "wall" || WALLISH.has(p.t(x + 1, y)) && p.t(x + 1, y) !== "wall";
		if (faceShows && OUTDOOR.has(below) && !doorNear && rnd(x, y, 55) < 0.5) {
			p.px(X + 2, Y + 3, 12, 10, "#3b3f45");
			if (rnd(x, y, 56) < 0.3) {
				p.px(X + 3, Y + 4, 10, 8, "#16181b");
				for (const [i, j] of [[0, 0], [1, 0], [0, 1], [9, 0], [9, 1], [8, 0], [0, 7], [1, 7], [9, 7], [5, 0]]) p.px(X + 3 + i, Y + 4 + j, 1, 1, "#8fb2c4");
			} else {
				p.px(X + 3, Y + 4, 10, 8, "#7f9fb1");
				p.px(X + 3, Y + 4, 10, 1, "#5f7e90");
				for (let i = 0; i < 4; i++) p.px(X + 9 - i, Y + 6 + i, 1, 1, "#b8d0dc");
				p.px(X + 8, Y + 4, 1, 8, "#3b3f45");
			}
			p.px(X + 1, Y + 13, 14, 1, "#b2afa7"); // sill
		}
	} else if (faceShows) {
		// painted drywall seen from the room below, with a baseboard
		const paint = pick(p.m, PAINTS, 2);
		p.px(X, Y, C, 4, "#4e4b46");
		p.px(X, Y, C, 1, "#67635d");
		p.px(X, Y + 4, C, 10, paint);
		p.px(X, Y + 4, C, 1, shade(paint, 0.82));
		p.px(X, Y + 14, C, 2, "#6c655a");
		p.px(X, Y + 14, C, 1, "#8a8276");
		if (rnd(x, y, 52) < 0.08) { p.px(X + 5, Y + 6, 6, 5, "#3e4246"); p.px(X + 6, Y + 7, 4, 3, rnd(x, y, 57) < 0.5 ? "#e8e4d8" : "#9ab0c0"); } // a notice or a framed picture
	} else {
		// the top of an interior wall
		p.px(X, Y, C, C, "#4e4b46");
		p.px(X + 1, Y, 14, C, "#58554f");
		if (!WALLISH.has(above)) p.px(X, Y, C, 1, "#67635d");
	}
	if (p.snow && OUTDOOR.has(above)) {
		p.px(X, Y, C, 3, "#eef3f7");
		p.px(X, Y + 3, C, 1, "#c9d3dd");
	}
}

export function modernDoor(p: Painter, x: number, y: number, t: Tile, ground: (x: number, y: number, g: Tile) => void) {
	const X = x * C, Y = y * C;
	const horiz = WALLISH.has(p.t(x - 1, y)) || WALLISH.has(p.t(x + 1, y));
	const g = p.groundOf(x, y);
	ground(x, y, g === "grass" || g === "tall_grass" ? "sand" : g);
	const FRAME = "#3b3f45", GLASS = "#8fb2c4", GLASS_L = "#cfe3ec", BAR = "#c4c8cc";
	if (horiz) {
		p.px(X, Y + 3, 1, 11, FRAME);
		p.px(X + 15, Y + 3, 1, 11, FRAME);
		if (t === "door_open") {
			p.px(X + 1, Y + 3, 2, 11, FRAME);
			p.px(X + 1, Y + 4, 1, 9, GLASS);
			return;
		}
		p.px(X + 1, Y + 3, 14, 11, FRAME);
		p.px(X + 2, Y + 4, 12, 7, GLASS);
		p.px(X + 2, Y + 4, 3, 1, GLASS_L);
		p.px(X + 2, Y + 5, 1, 2, GLASS_L);
		p.px(X + 2, Y + 11, 12, 2, "#555a61");
		p.px(X + 3, Y + 8, 10, 1, BAR);
		if (t === "door_locked") { p.px(X + 7, Y + 7, 2, 3, "#2a2c30"); p.px(X + 7, Y + 7, 2, 1, "#c8372d"); }
	} else {
		p.px(X + 4, Y, 8, 1, FRAME);
		p.px(X + 4, Y + 15, 8, 1, FRAME);
		if (t === "door_open") {
			p.px(X + 4, Y + 1, 8, 2, FRAME);
			p.px(X + 5, Y + 1, 6, 1, GLASS);
			return;
		}
		p.px(X + 4, Y + 1, 8, 14, FRAME);
		p.px(X + 5, Y + 2, 6, 12, GLASS);
		p.px(X + 5, Y + 2, 1, 4, GLASS_L);
		p.px(X + 8, Y + 4, 1, 8, BAR);
		if (t === "door_locked") { p.px(X + 6, Y + 7, 3, 2, "#2a2c30"); p.px(X + 6, Y + 7, 1, 2, "#c8372d"); }
	}
}

export function modernRoof(p: Painter, x: number, y: number) {
	const X = x * C, Y = y * C;
	if (p.snow) p.speckle(x, y, "#dfe5ea", [["#cbd3db", 0.12], ["#f2f6f9", 0.08]], 53);
	else p.speckle(x, y, "#5c5853", [["#4e4b46", 0.2], ["#6a665f", 0.14], ["#7a756c", 0.04]], 53);
	const roof = (t: Tile) => t === "building";
	const lip = p.snow ? "#b9c2cb" : "#9b968c", sh = p.snow ? "#aab3bc" : "#3a3733";
	// parapet around the roof's edge, with its shadow on the inside
	if (!roof(p.t(x, y - 1))) { p.px(X, Y, C, 2, lip); p.px(X, Y + 2, C, 1, sh); }
	if (!roof(p.t(x, y + 1))) { p.px(X, Y + 14, C, 2, darken(lip, 0.8)); }
	if (!roof(p.t(x - 1, y))) { p.px(X, Y, 2, C, lip); p.px(X + 2, Y, 1, C, sh); }
	if (!roof(p.t(x + 1, y))) p.px(X + 14, Y, 2, C, darken(lip, 0.85));
	const inner = roof(p.t(x - 1, y)) && roof(p.t(x + 1, y)) && roof(p.t(x, y - 1)) && roof(p.t(x, y + 1));
	const r = rnd(x, y, 54);
	if (inner && r < 0.07) {
		// AC unit: a grey box with a round fan grille
		p.px(X + 3, Y + 4, 10, 9, "#2a2c2f");
		p.px(X + 3, Y + 3, 10, 9, "#b9bec2");
		p.px(X + 3, Y + 3, 10, 1, "#d6dadd");
		p.px(X + 12, Y + 3, 1, 9, "#8a9095");
		p.px(X + 5, Y + 5, 6, 5, "#3e4246");
		p.px(X + 6, Y + 4, 4, 1, "#3e4246");
		p.px(X + 6, Y + 10, 4, 1, "#3e4246");
		p.px(X + 7, Y + 7, 2, 1, "#8a9095");
		p.px(X + 5, Y + 7, 6, 1, "#5a5f64");
		p.px(X + 7, Y + 5, 2, 5, "#5a5f64");
	} else if (inner && r < 0.11) {
		// vent pipe
		p.px(X + 6, Y + 8, 4, 3, "#2a2c2f");
		p.px(X + 6, Y + 6, 4, 4, "#8d9297");
		p.px(X + 7, Y + 7, 2, 2, "#2a2c2f");
	} else if (inner && r < 0.14) {
		// skylight
		p.px(X + 4, Y + 4, 8, 8, "#6a6c70");
		p.px(X + 5, Y + 5, 6, 6, "#7fa2b5");
		p.px(X + 5, Y + 5, 2, 1, "#c8dce6");
	}
}

// ─── other tiles ───────────────────────────────────────────────────────────

export function modernRubble(p: Painter, x: number, y: number) {
	const X = x * C, Y = y * C;
	for (let i = 0; i < 5; i++) {
		const rx = Math.floor(rnd(x, y, 60 + i) * 12), ry = Math.floor(rnd(x, y, 70 + i) * 12) + 1;
		const w = 2 + Math.floor(rnd(x, y, 80 + i) * 3);
		p.px(X + rx, Y + ry + 2, w, 1, "#3e3d3a");
		p.px(X + rx, Y + ry, w, 2, i % 2 ? "#8f8b83" : "#a39f96");
		p.px(X + rx, Y + ry, 1, 1, "#bdb9b0");
	}
	// rebar, broken glass, a sheet of paper
	if (rnd(x, y, 90) < 0.5) { const ry = 3 + Math.floor(rnd(x, y, 91) * 9); for (let i = 0; i < 6; i++) p.px(X + 4 + i, Y + ry + (i >> 1), 1, 1, "#7a4a2e"); }
	for (let i = 0; i < 4; i++) p.px(X + 1 + Math.floor(rnd(x, y, 92 + i) * 14), Y + 1 + Math.floor(rnd(x, y, 96 + i) * 14), 1, 1, i % 2 ? "#cfe8f0" : "#9fc4d2");
	if (rnd(x, y, 99) < 0.35) { const px0 = X + 2 + Math.floor(rnd(x, y, 100) * 9); const py0 = Y + 2 + Math.floor(rnd(x, y, 101) * 9); p.px(px0, py0, 4, 3, "#e6e1d4"); p.px(px0 + 1, py0 + 1, 2, 1, "#a9a395"); }
}

export function modernBridge(p: Painter, x: number, y: number, water: (x: number, y: number, deep: boolean) => void) {
	const X = x * C, Y = y * C;
	const wet = (t: Tile) => t === "water" || t === "deep_water";
	const isB = (t: Tile) => t === "bridge";
	water(x, y, false);
	const deck = p.snow ? "#c6cacd" : "#6f6e6a", rail = "#b3b0a8", post = "#5d5b56";
	p.px(X, Y, C, C, deck);
	for (let i = 0; i < 24; i++) p.px(X + Math.floor(rnd(x, y, 104 + i) * 16), Y + Math.floor(rnd(x, y, 130 + i) * 16), 1, 1, darken(deck, rnd(x, y, 160 + i) < 0.5 ? 0.88 : 1.1));
	// rails along the sides that face the water
	const n = wet(p.t(x, y - 1)), s = wet(p.t(x, y + 1)), w = wet(p.t(x - 1, y)), e = wet(p.t(x + 1, y));
	if (n) { p.px(X, Y, C, 2, rail); p.px(X, Y + 2, C, 1, "#3e3d3a"); for (let i = 2; i < 16; i += 6) p.px(X + i, Y, 1, 2, post); }
	if (s) { p.px(X, Y + 13, C, 2, rail); p.px(X, Y + 15, C, 1, "#2f2e2b"); for (let i = 2; i < 16; i += 6) p.px(X + i, Y + 13, 1, 2, post); }
	if (w) { p.px(X, Y, 2, C, rail); p.px(X + 2, Y, 1, C, "#3e3d3a"); for (let i = 2; i < 16; i += 6) p.px(X, Y + i, 2, 1, post); }
	if (e) { p.px(X + 13, Y, 2, C, rail); p.px(X + 15, Y, 1, C, "#2f2e2b"); for (let i = 2; i < 16; i += 6) p.px(X + 13, Y + i, 2, 1, post); }
	if (!p.snow) lane(p, x, y, (t) => isB(t) || isRoad(t), (w || e) && !(n || s) ? "v" : (n || s) && !(w || e) ? "h" : undefined);
}

/** Things standing on a modern tile (trees, columns, desks, counters). False = not handled. */
export function modernObject(p: Painter, x: number, y: number): boolean {
	const t = p.t(x, y), X = x * C, Y = y * C;
	if (t === "tree") {
		const r = rnd(x, y, 110);
		if (p.snow) p.sprite(r < 0.5 ? "bare_tree_snow" : "pineSnow", X, Y - 3);
		else p.sprite(r < 0.12 ? "pine" : r < 0.55 ? "fall_tree" : r < 0.85 ? "fall_tree_red" : "bare_tree", X, Y - 3);
		return true;
	}
	if (t === "pillar") {
		p.sprite("column", X, Y - 2);
		return true;
	}
	if (t === "table") {
		const same = (tt: Tile) => tt === t;
		const l = same(p.t(x - 1, y)), r = same(p.t(x + 1, y));
		const x0 = X + (l ? 0 : 1), w = 16 - (l ? 0 : 1) - (r ? 0 : 1);
		p.px(x0, Y + 12, w, 3, "#2c2e31");
		p.px(x0, Y + 11, w, 2, "#6b6f74"); // front edge
		p.px(x0, Y + 3, w, 8, "#b9a98d"); // laminate top
		p.px(x0, Y + 3, w, 1, "#d2c3a6");
		if (!l) p.px(x0, Y + 13, 1, 2, "#5a5e63");
		if (!r) p.px(x0 + w - 1, Y + 13, 1, 2, "#5a5e63");
		const k = rnd(x, y, 111);
		if (k < 0.35) {
			// monitor and keyboard
			p.px(X + 4, Y + 2, 8, 6, "#26282b");
			p.px(X + 5, Y + 3, 6, 4, "#3d5a6e");
			p.px(X + 5, Y + 3, 2, 1, "#6f93a8");
			p.px(X + 7, Y + 8, 2, 1, "#26282b");
			p.px(X + 5, Y + 9, 6, 1, "#45484c");
		} else if (k < 0.65) {
			// papers and a mug
			p.px(X + 3, Y + 5, 5, 4, "#ebe7dc");
			p.px(X + 4, Y + 6, 3, 1, "#9a968c");
			p.px(X + 4, Y + 7, 2, 1, "#9a968c");
			p.px(X + 10, Y + 5, 2, 3, "#c8372d");
			p.px(X + 10, Y + 5, 2, 1, "#5a2a1e");
		} else if (k < 0.8) {
			p.px(X + 6, Y + 5, 4, 3, "#3a5a8a"); // a binder
			p.px(X + 6, Y + 5, 1, 3, "#24395a");
		}
		return true;
	}
	if (t === "bar_counter") {
		const same = (tt: Tile) => tt === t;
		const l = same(p.t(x - 1, y)), r = same(p.t(x + 1, y));
		const x0 = X + (l ? 0 : 1), w = 16 - (l ? 0 : 1) - (r ? 0 : 1);
		p.px(x0, Y + 14, w, 1, "#232427");
		p.px(x0, Y + 8, w, 6, "#4d5f72"); // front panel
		p.px(x0, Y + 8, w, 1, "#3b4a59");
		p.px(x0, Y + 12, w, 1, "#5d7186");
		p.px(x0, Y + 2, w, 6, "#d6d2c8"); // counter top
		p.px(x0, Y + 2, w, 1, "#ece8e0");
		p.px(x0, Y + 7, w, 1, "#a9a59b");
		if (rnd(x, y, 112) < 0.3) {
			// register
			p.px(X + 4, Y + 1, 7, 5, "#2e3034");
			p.px(X + 5, Y + 2, 5, 2, "#5a8a5a");
			p.px(X + 5, Y + 2, 2, 1, "#9ad09a");
			p.px(X + 4, Y + 6, 7, 1, "#45484c");
		} else if (rnd(x, y, 113) < 0.3) {
			p.px(X + 5, Y + 3, 3, 3, "#c9a227"); // a gum rack / candy
			p.px(X + 8, Y + 3, 3, 3, "#c8372d");
			p.px(X + 5, Y + 3, 6, 1, "#efe6cf");
		}
		return true;
	}
	return false;
}

// ─── colour helpers ────────────────────────────────────────────────────────

function hex(c: string): [number, number, number] {
	const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
	if (!m) return [128, 128, 128];
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function darken(c: string, f: number): string {
	const [r, g, b] = hex(c);
	return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}
function shade(c: string, f: number): string {
	const [r, g, b] = hex(c);
	const k = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 1 ? v + (255 - v) * (f - 1) : v * f)));
	return `#${[k(r), k(g), k(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
