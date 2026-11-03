/**
 * Pixel-sprite picture of a GridMap (the scene panel). Ground is painted
 * procedurally per tile (seeded, so it is stable), objects and people use the
 * 16×16 sprites in ./sprites. The result is a close-up framed on the party.
 */
import type { GridMap, MapEntity, Tile, TimeOfDay, Weather } from "@/lib/game/types";
import { FEATURE_ALIASES, LIGHTS, SPRITES, type Sprite } from "./sprites";
import { creatureSprite } from "./creatures";

const C = 16;

export interface Look {
	hair: string;
	cloth: string;
	skin: string;
}

export interface PixelSceneInput {
	map: GridMap;
	/** Visible look per entity id (PC and NPCs). */
	looks: Record<string, Look>;
	time: TimeOfDay;
	weather: Weather;
	/** Close-up width in squares (16:9). */
	viewW?: number;
	/** Entity ids of creatures that are dead (from the encounter). */
	dead?: Set<string>;
	/** Entity to centre on (default the PC). */
	focusId?: string;
}

export interface Frame {
	/** Visible window, in squares. */
	x0: number;
	y0: number;
	w: number;
	h: number;
}

function rnd(x: number, y: number, k = 0): number {
	let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hex(c: string): [number, number, number] {
	const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
	if (!m) return [128, 128, 128];
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function darken(c: string, f: number): string {
	const [r, g, b] = hex(c);
	return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

const INDOOR_KINDS = new Set(["dungeon", "cave", "tavern", "crypt", "temple", "ship"]);
const LOG_WALLS = new Set(["town", "tavern", "camp", "road", "forest", "swamp"]);
const ROCK_WALLS = new Set(["cave", "mountain_pass"]);
const OUTDOOR_GROUND = new Set<Tile>(["grass", "tall_grass", "road", "sand", "mud", "tree", "rock", "ice"]);

class P {
	ctx: CanvasRenderingContext2D;
	constructor(public m: GridMap, ctx: CanvasRenderingContext2D) {
		this.ctx = ctx;
	}
	t(x: number, y: number): Tile {
		const m = this.m;
		if (x < 0 || y < 0 || x >= m.width || y >= m.height) return m.tiles[Math.max(0, Math.min(m.height - 1, y)) * m.width + Math.max(0, Math.min(m.width - 1, x))];
		return m.tiles[y * m.width + x];
	}
	get snow() { return this.m.climate === "snow"; }
	get desert() { return this.m.climate === "desert"; }
	px(x: number, y: number, w: number, h: number, c: string) {
		this.ctx.fillStyle = c;
		this.ctx.fillRect(x, y, w, h);
	}
	speckle(x: number, y: number, base: string, dots: [string, number][], salt = 0) {
		this.px(x * C, y * C, C, C, base);
		for (let i = 0; i < 256; i++) {
			const r = rnd(x * 16 + (i & 15), y * 16 + (i >> 4), salt + this.m.seed);
			let acc = 0;
			for (const [c, p] of dots) {
				acc += p;
				if (r < acc) {
					this.px(x * C + (i & 15), y * C + (i >> 4), 1, 1, c);
					break;
				}
			}
		}
	}
	sprite(name: string, X: number, Y: number, extra: Record<string, string> = {}) {
		const s = SPRITES[name];
		if (s) this.draw(s, X, Y, extra);
	}
	draw(s: Sprite, X: number, Y: number, extra: Record<string, string> = {}) {
		const pal = { ...s.pal, ...extra };
		for (let y = 0; y < 16; y++) {
			const row = s.rows[y];
			for (let x = 0; x < 16; x++) {
				const k = row[x];
				if (k === "." || !pal[k]) continue;
				this.px(X + x, Y + y, 1, 1, pal[k]);
			}
		}
	}
	/** The ground a non-ground tile stands on. */
	groundOf(x: number, y: number): Tile {
		const t = this.t(x, y);
		if (["grass", "tall_grass", "floor", "wood_floor", "road", "sand", "mud", "ice"].includes(t)) return t;
		const count = new Map<Tile, number>();
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const n = this.t(x + dx, y + dy);
				if (["grass", "floor", "wood_floor", "road", "sand", "mud", "ice"].includes(n)) count.set(n, (count.get(n) ?? 0) + 1);
			}
		const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		if (best) return best;
		if (t === "tree" || t === "rock") return "grass";
		return this.m.kind === "tavern" || this.m.kind === "ship" ? "wood_floor" : "floor";
	}

	// ─── ground ──────────────────────────────────────────────────────────
	ground(x: number, y: number, g: Tile) {
		const X = x * C, Y = y * C;
		switch (g) {
			case "grass":
			case "tall_grass":
				if (this.snow) this.speckle(x, y, "#dde5ec", [["#c8d2dd", 0.08], ["#f5f8fb", 0.06]]);
				else if (this.desert) this.speckle(x, y, "#cdb07c", [["#b89a66", 0.12], ["#dcc394", 0.08]]);
				else this.speckle(x, y, "#5d7a3a", [["#4e6a2f", 0.14], ["#6f8d47", 0.1], ["#7d9a52", 0.03]]);
				return;
			case "wood_floor": {
				this.px(X, Y, C, C, "#6b4a2e");
				for (let r = 0; r < 4; r++) {
					this.px(X, Y + r * 4 + 3, C, 1, "#553a22");
					this.px(X + Math.floor(rnd(x, y * 4 + r, 3) * 14) + 1, Y + r * 4, 1, 3, "#553a22");
					this.px(X + ((x * 5 + r * 7) % 12), Y + r * 4 + 1, 3, 1, "#7a5636");
				}
				return;
			}
			case "floor":
				if (ROCK_WALLS.has(this.m.kind)) this.speckle(x, y, "#3a3c41", [["#2e2f33", 0.15], ["#4a4c52", 0.1]], 4);
				else {
					const base = this.m.kind === "temple" ? "#a49c8c" : "#5f5c56";
					this.speckle(x, y, base, [[darken(base, 0.85), 0.12], [darken(base, 1.12), 0.08]], 4);
					const off = (y % 2) * 8;
					this.px(X, Y + 7, C, 1, darken(base, 0.7));
					this.px(X + ((off + 3) % 16), Y, 1, 7, darken(base, 0.7));
					this.px(X + ((off + 11) % 16), Y + 8, 1, 8, darken(base, 0.7));
				}
				return;
			case "road":
				if (this.snow) this.speckle(x, y, "#b9b6ae", [["#9d968a", 0.18], ["#dfe5ea", 0.1]], 7);
				else this.speckle(x, y, "#7a6447", [["#6a563c", 0.18], ["#8d7656", 0.12]], 7);
				return;
			case "sand":
				if (this.snow) this.speckle(x, y, "#8e887a", [["#6f6a5e", 0.18], ["#aaa496", 0.12], ["#e6ecf1", 0.1]], 8);
				else this.speckle(x, y, "#c2a878", [["#ad9365", 0.14], ["#d5bd8f", 0.1]], 8);
				return;
			case "mud":
				this.speckle(x, y, "#4d4128", [["#3d331f", 0.18], ["#5e5034", 0.1]], 9);
				return;
			case "ice": {
				this.speckle(x, y, "#a9cadb", [["#bcd8e6", 0.12], ["#93b8cb", 0.06]], 6);
				this.px(X + Math.floor(rnd(x, y, 16) * 12), Y + (x % 3) * 5 + 2, 4, 1, "#d6eaf3");
				if (rnd(x, y, 19) < 0.25) {
					let cx = Math.floor(rnd(x, y, 17) * 16);
					for (let cy = 0; cy < 16; cy++) {
						this.px(X + Math.max(0, Math.min(15, cx)), Y + cy, 1, 1, "#7fa3b8");
						cx += rnd(x, y * 31 + cy, 18) < 0.5 ? -1 : 1;
					}
				}
				return;
			}
		}
	}

	water(x: number, y: number, deep: boolean) {
		const X = x * C, Y = y * C;
		this.px(X, Y, C, C, deep ? "#0f2232" : "#1f4560");
		for (let r = 0; r < 3; r++) this.px(X + Math.floor(rnd(x, y, r + 11) * 10), Y + 3 + r * 5, 4, 1, deep ? "#1d3d55" : "#3a6d8c");
		const edge = (t: Tile) => !["water", "deep_water", "bridge"].includes(t);
		const rim = (t: Tile) => (t === "ice" || this.snow ? "#e6f3f9" : "#8a7d5c");
		const n = this.t(x, y - 1), s = this.t(x, y + 1), w = this.t(x - 1, y), e = this.t(x + 1, y);
		if (edge(n)) for (let i = 0; i < 16; i += 2) this.px(X + i, Y, 2, 1 + Math.floor(rnd(X + i, y, 12) * 3), rim(n));
		if (edge(s)) for (let i = 0; i < 16; i += 2) { const h = 1 + Math.floor(rnd(X + i, y, 13) * 3); this.px(X + i, Y + 16 - h, 2, h, rim(s)); }
		if (edge(w)) for (let i = 0; i < 16; i += 2) this.px(X, Y + i, 1 + Math.floor(rnd(x, Y + i, 14) * 3), 2, rim(w));
		if (edge(e)) for (let i = 0; i < 16; i += 2) { const ww = 1 + Math.floor(rnd(x, Y + i, 15) * 3); this.px(X + 16 - ww, Y + i, ww, 2, rim(e)); }
	}

	outdoorAbove(x: number, y: number) {
		const a = this.t(x, y - 1);
		return OUTDOOR_GROUND.has(a) || a === "water";
	}

	wall(x: number, y: number) {
		const X = x * C, Y = y * C, k = this.m.kind;
		const isW = (t: Tile) => ["wall", "secret_door", "door", "door_open", "door_locked"].includes(t);
		if (ROCK_WALLS.has(k)) {
			this.rockMass(x, y);
			return;
		}
		if (LOG_WALLS.has(k)) {
			this.px(X, Y, C, C, "#4a2f18");
			for (let r = 0; r < 4; r++) {
				this.px(X, Y + r * 4, C, 3, "#7a5233");
				this.px(X, Y + r * 4, C, 1, "#93683f");
				this.px(X, Y + r * 4 + 3, C, 1, "#2e1c0d");
			}
			if (!isW(this.t(x - 1, y))) this.px(X, Y, 2, C, "#5a3a1e");
			if (!isW(this.t(x + 1, y))) this.px(X + 14, Y, 2, C, "#3a2410");
		} else {
			// masonry
			this.px(X, Y, C, C, "#55524c");
			for (let r = 0; r < 4; r++) {
				const off = (r + y) % 2 ? 0 : 4;
				this.px(X, Y + r * 4 + 3, C, 1, "#34322e");
				for (let i = off; i < 16; i += 8) this.px(X + i, Y + r * 4, 1, 3, "#34322e");
				this.px(X, Y + r * 4, C, 1, "#6d6a63");
			}
		}
		if (this.snow && this.outdoorAbove(x, y)) {
			this.px(X, Y, C, 3, "#eef3f7");
			this.px(X, Y + 3, C, 1, "#c9d3dd");
		}
	}

	rockMass(x: number, y: number) {
		const X = x * C, Y = y * C;
		this.speckle(x, y, "#5d5f66", [["#4a4c52", 0.2], ["#71747b", 0.12]], 2);
		const open = (t: Tile) => !["wall", "rock", "void", "secret_door"].includes(t);
		if (open(this.t(x, y + 1))) { this.px(X, Y + 12, C, 4, "#3a3b40"); this.px(X, Y + 15, C, 1, "#2a2b2f"); }
		if (open(this.t(x, y - 1))) this.px(X, Y, C, 2, this.snow && this.outdoorAbove(x, y) ? "#eef3f7" : "#7d8088");
		if (open(this.t(x - 1, y))) this.px(X, Y, 1, C, "#71747b");
		if (open(this.t(x + 1, y))) this.px(X + 15, Y, 1, C, "#3a3b40");
	}

	door(x: number, y: number, t: Tile) {
		const X = x * C, Y = y * C;
		const horiz = ["wall", "door", "door_locked"].includes(this.t(x - 1, y)) || ["wall"].includes(this.t(x + 1, y));
		this.ground(x, y, this.groundOf(x, y) === "wood_floor" || LOG_WALLS.has(this.m.kind) ? "wood_floor" : "floor");
		if (t === "door_open") {
			if (horiz) { this.px(X, Y, 3, 14, "#3a2614"); this.px(X + 1, Y + 1, 1, 12, "#8a6038"); }
			else { this.px(X, Y, 14, 3, "#3a2614"); this.px(X + 1, Y + 1, 12, 1, "#8a6038"); }
			return;
		}
		const r = horiz ? { x: X, y: Y + 4, w: 16, h: 8 } : { x: X + 4, y: Y, w: 8, h: 16 };
		this.px(r.x, r.y, r.w, r.h, "#3a2614");
		this.px(r.x + 1, r.y + 1, r.w - 2, r.h - 2, "#8a5a32");
		if (horiz) for (let i = 4; i < 16; i += 4) this.px(X + i, Y + 5, 1, 6, "#5e3a1c");
		else for (let i = 4; i < 16; i += 4) this.px(X + 5, Y + i, 6, 1, "#5e3a1c");
		if (t === "door_locked") { this.px(X + 7, Y + 7, 2, 2, "#c9a227"); this.px(X + 7, Y + 9, 2, 1, "#2a2a2e"); }
	}

	tile(x: number, y: number) {
		const t = this.t(x, y), X = x * C, Y = y * C;
		switch (t) {
			case "void": this.px(X, Y, C, C, "#0b0b0d"); return;
			case "wall": this.wall(x, y); return;
			case "secret_door": this.wall(x, y); return;
			case "door": case "door_open": case "door_locked": this.door(x, y, t); return;
			case "water": this.water(x, y, false); return;
			case "deep_water": this.water(x, y, true); return;
			case "lava": this.speckle(x, y, "#c2410c", [["#fb923c", 0.2], ["#fde047", 0.05], ["#7c2d12", 0.12]], 13); return;
			case "pit": {
				this.ground(x, y, this.groundOf(x, y));
				this.px(X + 1, Y + 1, 14, 14, "#2a2420");
				this.px(X + 2, Y + 3, 12, 12, "#050404");
				return;
			}
			case "rock": {
				const isR = (tt: Tile) => tt === "rock" || tt === "wall";
				const around = [this.t(x - 1, y), this.t(x + 1, y), this.t(x, y - 1), this.t(x, y + 1)].filter(isR).length;
				if (around >= 2) this.rockMass(x, y);
				else { this.ground(x, y, this.groundOf(x, y)); }
				return;
			}
			case "bridge": {
				this.water(x, y, false);
				this.px(X, Y + 1, C, 14, "#6b4a2e");
				for (let i = 0; i < 16; i += 3) this.px(X + i, Y + 1, 1, 14, "#4e321a");
				this.px(X, Y + 1, C, 1, "#3a2410");
				this.px(X, Y + 14, C, 1, "#3a2410");
				return;
			}
			case "stairs_up": case "stairs_down": {
				this.ground(x, y, "floor");
				const down = t === "stairs_down";
				for (let i = 0; i < 4; i++) {
					const c = down ? darken("#7a766e", 1 - i * 0.18) : darken("#7a766e", 0.5 + i * 0.18);
					this.px(X + 1, Y + 1 + i * 4, 14, 3, c);
				}
				return;
			}
			case "building": {
				// Roof seen from above.
				this.px(X, Y, C, C, this.snow ? "#e6ecf1" : "#7a3b2a");
				for (let r = 0; r < 4; r++) this.px(X, Y + r * 4 + 3, C, 1, this.snow ? "#bfcad4" : "#5a2a1e");
				return;
			}
			case "rubble":
			case "difficult": {
				this.ground(x, y, this.groundOf(x, y));
				for (let i = 0; i < 6; i++) {
					const rx = Math.floor(rnd(x, y, 30 + i) * 13), ry = Math.floor(rnd(x, y, 40 + i) * 13);
					this.px(X + rx, Y + ry, 3, 2, "#6b6e75");
					this.px(X + rx, Y + ry + 2, 3, 1, "#3e4045");
				}
				return;
			}
			default:
				this.ground(x, y, this.groundOf(x, y));
		}
	}

	/** Things standing on a tile: trees, boulders, furniture. Drawn after all ground. */
	object(x: number, y: number) {
		const t = this.t(x, y), X = x * C, Y = y * C;
		if (t === "tree") {
			const pine = this.snow || this.m.kind === "mountain_pass" || rnd(x, y, 50) < 0.15;
			this.sprite(pine ? (this.snow ? "pineSnow" : "pine") : "oak", X, Y - 3);
		} else if (t === "tall_grass") {
			const c = this.snow ? "#8a9a8a" : this.desert ? "#9a8a5a" : "#3e5a26";
			for (let i = 0; i < 5; i++) {
				const gx = Math.floor(rnd(x, y, 60 + i) * 14), gy = Math.floor(rnd(x, y, 70 + i) * 12) + 2;
				this.px(X + gx, Y + gy, 1, 3, c);
				this.px(X + gx + 1, Y + gy - 1, 1, 3, c);
			}
		} else if (t === "rock") {
			const isR = (tt: Tile) => tt === "rock" || tt === "wall";
			const around = [this.t(x - 1, y), this.t(x + 1, y), this.t(x, y - 1), this.t(x, y + 1)].filter(isR).length;
			if (around < 2) this.sprite("boulder", X, Y);
		} else if (t === "pillar") this.sprite("pillar", X, Y - 2);
		else if (t === "table" || t === "bar_counter") {
			const same = (tt: Tile) => tt === t;
			const l = same(this.t(x - 1, y)), r = same(this.t(x + 1, y));
			const top = t === "table" ? "#9a6c3e" : "#6e4a26", hi = t === "table" ? "#b5824e" : "#8a5f36";
			const x0 = X + (l ? 0 : 1), w = 16 - (l ? 0 : 1) - (r ? 0 : 1);
			this.px(x0, Y + 13, w, 2, "#2f2016");
			this.px(x0, Y + 2, w, 11, top);
			this.px(x0, Y + 2, w, 1, hi);
			if (rnd(x, y, 21) < 0.4) { this.px(X + 5, Y + 4, 4, 3, "#c9c2b0"); this.px(X + 6, Y + 5, 2, 1, "#6b3a1a"); }
			if (rnd(x, y, 22) < 0.3) { this.px(X + 10, Y + 6, 2, 3, "#8a6a3a"); this.px(X + 10, Y + 6, 2, 1, "#c9a227"); }
		}
	}
}

function featureSprite(e: MapEntity): string {
	const raw = (e.sprite || e.name || "").toLowerCase().trim().replace(/[\s-]+/g, "_");
	if (SPRITES[raw]) return raw;
	if (FEATURE_ALIASES[raw]) return FEATURE_ALIASES[raw];
	for (const [k, v] of Object.entries(FEATURE_ALIASES)) if (raw.includes(k)) return v;
	for (const k of Object.keys(SPRITES)) if (raw.includes(k)) return k;
	return "marker";
}

/** The square window to show: `w` wide, 16:9, centred on the focus, clamped to the map. */
export function frameFor(map: GridMap, focus: { x: number; y: number } | undefined, w = 24): Frame {
	const W = Math.min(w, map.width);
	const H = Math.round((W * 9) / 16);
	// The caption covers the bottom quarter, so the focus sits above centre and the
	// frame may run a few rows past the bottom edge (edge ground repeats there).
	const over = Math.round(H * 0.3);
	const fx = focus ? focus.x + 0.5 : map.width / 2, fy = focus ? focus.y + 0.5 + H * 0.15 : map.height / 2;
	const yMax = map.height - H + over;
	const yMin = Math.min(0, Math.round((map.height - H) / 2));
	return {
		x0: Math.max(0, Math.min(map.width - W, Math.round(fx - W / 2))),
		y0: Math.max(yMin, Math.min(yMax, Math.round(fy - H / 2))),
		w: W,
		h: H,
	};
}

/**
 * Frame that shows the party and what's around them: the PC, NPCs, monsters
 * and features within `reach` squares, zoomed between `minW` and `maxW` wide.
 */
export function frameAround(map: GridMap, minW = 18, maxW = 32, reach = 12): Frame {
	const pc = map.entities.find((e) => e.kind === "pc");
	if (!pc) return frameFor(map, undefined, minW);
	const pts = map.entities.filter((e) => !e.hidden && e.sprite !== "footprints" && Math.max(Math.abs(e.x - pc.x), Math.abs(e.y - pc.y)) <= reach);
	const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
	const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
	// Room for the caption: the box needs ~35% extra height.
	const need = Math.max(x1 - x0 + 4, ((y1 - y0 + 3) * 1.35 * 16) / 9);
	const W = Math.max(minW, Math.min(maxW, Math.ceil(need)));
	return frameFor(map, { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) }, W);
}

/** Index of a square, clamped to the map (frames may run past the edge). */
const idx = (map: GridMap, x: number, y: number) => Math.max(0, Math.min(map.height - 1, y)) * map.width + Math.max(0, Math.min(map.width - 1, x));

const CREATURES = new Set(["pc", "npc", "monster"]);

/** Paints the static picture (ground, objects, people, light) of the frame into `canvas` at 1 px per sprite pixel. */
export function paintPixelScene(canvas: HTMLCanvasElement, input: PixelSceneInput, frame: Frame) {
	const { map } = input;
	canvas.width = frame.w * C;
	canvas.height = frame.h * C;
	const ctx = canvas.getContext("2d")!;
	ctx.imageSmoothingEnabled = false;
	ctx.save();
	ctx.translate(-frame.x0 * C, -frame.y0 * C);
	const p = new P(map, ctx);
	const xs = frame.x0 - 1, xe = frame.x0 + frame.w + 1;
	const ys = frame.y0 - 1, ye = frame.y0 + frame.h + 1;
	for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) p.tile(x, y);
	const ents = map.entities.filter((e) => !e.hidden && e.x >= xs - 1 && e.x < xe + 1 && e.y >= ys - 1 && e.y < ye + 1);
	// Flat features (footprints, beds, rugs) first, then rows top to bottom so lower things overlap upper ones.
	const lights: { x: number; y: number; r: number; color: string; a: number }[] = [];
	const draws: { y: number; fn: () => void }[] = [];
	for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) if (x >= 0 && y >= 0 && x < map.width && y < map.height) draws.push({ y: y + 0.1, fn: () => p.object(x, y) });
	for (const e of ents) {
		const X = e.x * C, Y = e.y * C;
		if (CREATURES.has(e.kind)) {
			const look = input.looks[e.id];
			const size = Math.max(1, e.size);
			draws.push({
				y: e.y + 0.5,
				fn: () => {
					const dead = !!e.dead || !!input.dead?.has(e.id);
					ctx.drawImage(creatureCanvas(e, look, dead), X, Y - (dead || e.kind === "monster" ? 0 : 1), 16 * size, 16 * size);
				},
			});
		} else {
			const name = featureSprite(e);
			const flat = name === "footprints" || name === "bed" || name === "shelf";
			draws.push({ y: flat ? e.y : e.y + 0.3, fn: () => p.sprite(name === "campfire" && (e.sprite === "hearth" || e.name.toLowerCase().includes("hearth")) ? "flame" : name, X, Y - (name === "standing_stone" || name === "statue" ? 2 : 0)) });
			const L = LIGHTS[name];
			if (L || e.lightRadius) lights.push({ x: e.x + 0.5, y: e.y + 0.5, r: e.lightRadius ?? L.r, color: L?.color ?? "255,190,110", a: L?.a ?? 0.35 });
		}
	}
	draws.sort((a, b) => a.y - b.y);
	for (const d of draws) d.fn();
	ctx.restore();

	// Lighting: time of day outdoors, darkness indoors, glow around light sources.
	const W = canvas.width, H = canvas.height;
	const indoor = INDOOR_KINDS.has(map.kind) || map.lighting !== "bright";
	const dark = map.lighting === "dark" ? 0.62 : map.lighting === "dim" ? 0.35 : 0;
	ctx.save();
	ctx.globalCompositeOperation = "multiply";
	if (!indoor || map.kind === "tavern") {
		const tint = { dawn: "rgba(110,115,170,0.55)", day: "rgba(255,255,255,0)", dusk: "rgba(190,110,90,0.5)", night: "rgba(30,40,90,0.85)" }[input.time];
		ctx.fillStyle = tint;
		ctx.fillRect(0, 0, W, H);
	}
	if (dark > 0) {
		ctx.fillStyle = `rgba(10,10,20,${dark})`;
		ctx.fillRect(0, 0, W, H);
	}
	ctx.globalCompositeOperation = "screen";
	const lit = dark > 0 || input.time === "night" || input.time === "dusk" ? 1.6 : 1;
	for (const l of lights) {
		const px = (l.x - frame.x0) * C, py = (l.y - frame.y0) * C, r = l.r * C;
		const g = ctx.createRadialGradient(px, py, 0, px, py, r);
		g.addColorStop(0, `rgba(${l.color},${Math.min(0.8, l.a * lit)})`);
		g.addColorStop(1, `rgba(${l.color},0)`);
		ctx.fillStyle = g;
		ctx.fillRect(px - r, py - r, r * 2, r * 2);
	}
	ctx.restore();
	// Fog: squares the player has never seen are black.
	if (map.explored.length === map.width * map.height) {
		ctx.fillStyle = "#050506";
		for (let y = frame.y0; y < frame.y0 + frame.h; y++)
			for (let x = frame.x0; x < frame.x0 + frame.w; x++)
				if (!map.explored[idx(map, x, y)]) ctx.fillRect((x - frame.x0) * C, (y - frame.y0) * C, C, C);
	}
}

/** Whether falling snow/rain should be drawn over this map. */
export function hasSky(map: GridMap): boolean {
	return !INDOOR_KINDS.has(map.kind) || map.tiles.includes("grass");
}

const SKY_TILES = new Set<Tile>(["grass", "tall_grass", "road", "sand", "mud", "ice", "water", "deep_water", "tree", "rock", "bridge", "pit", "rubble", "building"]);
/** Squares open to the sky (weather falls there): outdoor ground, and everything on an outdoor map. */
export function skyMask(map: GridMap, frame: Frame): boolean[] {
	const out: boolean[] = [];
	const allOut = !INDOOR_KINDS.has(map.kind) && !map.drawn;
	for (let y = frame.y0; y < frame.y0 + frame.h; y++)
		for (let x = frame.x0; x < frame.x0 + frame.w; x++) out.push(allOut || SKY_TILES.has(map.tiles[idx(map, x, y)]));
	return out;
}

// ─── battle map (Map tab) ─────────────────────────────────────────────────

/** Ground and fixed objects (trees, tables, pillars) of a rectangle of squares, 16 px per square, no entities. */
export function paintPixelTiles(ctx: CanvasRenderingContext2D, map: GridMap, x0: number, y0: number, w: number, h: number) {
	ctx.save();
	ctx.imageSmoothingEnabled = false;
	ctx.translate(-x0 * C, -y0 * C);
	const p = new P(map, ctx);
	for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) p.tile(x, y);
	// Objects may overhang the square above, so draw one extra row below the chunk too.
	for (let y = y0; y < Math.min(map.height, y0 + h + 1); y++) for (let x = x0; x < x0 + w; x++) p.object(x, y);
	ctx.restore();
}

/** Same contract as tilePainter's paintMap: chunks of the whole map at T px per square (T a multiple of 16). */
export function paintPixelMap(map: GridMap, T: number, maxChunkPx = 2048): { canvas: HTMLCanvasElement; x0: number; y0: number; cols: number; rows: number }[] {
	const per = Math.max(8, Math.floor(maxChunkPx / T));
	const out: { canvas: HTMLCanvasElement; x0: number; y0: number; cols: number; rows: number }[] = [];
	for (let y0 = 0; y0 < map.height; y0 += per)
		for (let x0 = 0; x0 < map.width; x0 += per) {
			const cols = Math.min(per, map.width - x0), rows = Math.min(per, map.height - y0);
			const small = document.createElement("canvas");
			small.width = cols * C;
			small.height = rows * C;
			paintPixelTiles(small.getContext("2d")!, map, x0, y0, cols, rows);
			const canvas = document.createElement("canvas");
			canvas.width = cols * T;
			canvas.height = rows * T;
			const ctx = canvas.getContext("2d")!;
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
			out.push({ canvas, x0, y0, cols, rows });
		}
	return out;
}

function upscale(draw: (p: P) => void, map: GridMap | undefined, px: number, n = 1): HTMLCanvasElement {
	const small = document.createElement("canvas");
	small.width = small.height = 16 * n;
	const p = new P(map ?? ({ seed: 1 } as GridMap), small.getContext("2d")!);
	draw(p);
	const c = document.createElement("canvas");
	c.width = c.height = px;
	const ctx = c.getContext("2d")!;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(small, 0, 0, px, px);
	return c;
}

/** A creature token for the battle map: the sprite standing on a coloured ring (side / disposition). */
export function pixelToken(px: number, opts: { kind: MapEntity["kind"]; sprite: string; look?: Look; ring: string; dead?: boolean }): HTMLCanvasElement {
	return upscale((p) => {
		const ctx = p.ctx;
		if (opts.dead) {
			ctx.drawImage(creatureCanvas({ kind: opts.kind, sprite: opts.sprite }, opts.look, true), 0, 0);
			return;
		}
		// ring at the feet
		ctx.fillStyle = opts.ring;
		ctx.fillRect(3, 13, 10, 1);
		ctx.fillRect(2, 14, 12, 1);
		ctx.fillRect(3, 15, 10, 1);
		ctx.fillStyle = "rgba(0,0,0,0.35)";
		ctx.fillRect(4, 14, 8, 1);
		ctx.drawImage(creatureCanvas({ kind: opts.kind, sprite: opts.sprite }, opts.look, false), 0, opts.kind === "monster" ? -1 : -2);
	}, undefined, px);
}

/** A feature/item/light for the battle map. */
export function pixelProp(px: number, e: Pick<MapEntity, "sprite" | "name" | "kind">): HTMLCanvasElement {
	const name = featureSprite(e as MapEntity);
	return upscale((p) => p.sprite(name === "campfire" && /hearth/i.test(`${e.sprite} ${e.name}`) ? "flame" : name, 0, 0), undefined, px);
}

/** A creature's 16×16 sprite; dead ones lie on their side, drained of colour, in a pool of blood. */
export function creatureCanvas(e: Pick<MapEntity, "kind" | "sprite">, look: Look | undefined, dead: boolean): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = c.height = 16;
	const p = new P({ seed: 1 } as GridMap, c.getContext("2d")!);
	if (e.kind === "monster") p.draw(creatureSprite(e.sprite, "monster"), 0, 0);
	else {
		const l = look ?? { hair: "#5a3a1e", cloth: e.kind === "pc" ? "#3f4f86" : "#6b5a3a", skin: "#e4b48c" };
		p.sprite("person", 0, 0, { H: l.hair, C: l.cloth, c: darken(l.cloth, 0.7), S: l.skin });
	}
	if (!dead) return c;
	const ctx = c.getContext("2d")!;
	const src = ctx.getImageData(0, 0, 16, 16);
	const out = ctx.createImageData(16, 16);
	// Rotate 90° clockwise, drop the shadow row, desaturate and darken.
	for (let y = 0; y < 16; y++)
		for (let x = 0; x < 16; x++) {
			const i = (y * 16 + x) * 4;
			if (src.data[i + 3] < 200) continue;
			const nx = 15 - y, ny = x;
			const o = (ny * 16 + nx) * 4;
			const g = (src.data[i] * 0.3 + src.data[i + 1] * 0.59 + src.data[i + 2] * 0.11) * 0.75;
			out.data[o] = Math.round(src.data[i] * 0.35 + g * 0.65);
			out.data[o + 1] = Math.round(src.data[i + 1] * 0.25 + g * 0.6);
			out.data[o + 2] = Math.round(src.data[i + 2] * 0.25 + g * 0.6);
			out.data[o + 3] = 255;
		}
	ctx.clearRect(0, 0, 16, 16);
	// blood pool under the body
	ctx.fillStyle = "rgba(110,12,12,0.85)";
	ctx.fillRect(3, 8, 11, 6);
	ctx.fillRect(2, 9, 13, 4);
	ctx.fillRect(5, 14, 6, 1);
	ctx.fillStyle = "rgba(160,24,20,0.9)";
	ctx.fillRect(5, 10, 5, 2);
	const body = document.createElement("canvas");
	body.width = body.height = 16;
	body.getContext("2d")!.putImageData(out, 0, 0);
	ctx.drawImage(body, 0, 2);
	return c;
}
