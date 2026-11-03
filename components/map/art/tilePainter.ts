import type { GridMap, MapKind, Tile } from "@/lib/game/types";
import { fbm, makeNoise2D, rand2, type Noise2D } from "@/lib/maps/noise";
import { hexToRgb, rgb, shade } from "./color";

/**
 * Procedural top-down battle-map painter (Canvas 2D). Paints the static layer
 * of a GridMap — ground, organic terrain edges, walls with bevels and hatching,
 * soft drop shadows, doors, stairs, furniture, boulders, roofs and tree
 * canopies — into one or more canvases (chunked to stay under GPU texture
 * limits). Deterministic per map seed.
 */

export interface Theme {
	floor: string;
	floorStyle: "flag" | "marble" | "cave" | "gravel" | "sand";
	wood: string;
	wall: string;
	wallStyle: "masonry" | "rock" | "cliff" | "rail" | "palisade" | "timber";
	mass: string;
	grass: string;
	trees: "broadleaf" | "mixed" | "swamp" | "pine";
	road: "dirt" | "cobble";
	/** Ground used under walls/objects when the neighbourhood gives no hint. */
	ground: Tile;
	deck?: boolean;
}

const BASE: Theme = { floor: "#6d655a", floorStyle: "flag", wood: "#7a5634", wall: "#3a342e", wallStyle: "masonry", mass: "#15120f", grass: "#5d7a3a", trees: "mixed", road: "dirt", ground: "floor" };

export function themeFor(kind: MapKind): Theme {
	switch (kind) {
		case "dungeon": return { ...BASE };
		case "crypt": return { ...BASE, floor: "#5c5f58", wall: "#34372f", mass: "#0d0f0d" };
		case "temple": return { ...BASE, floor: "#b8ae9c", floorStyle: "marble", wall: "#5b544a", mass: "#1b1814" };
		case "castle": return { ...BASE, floor: "#76736d", wall: "#4a4743", mass: "#1a1918", road: "cobble", grass: "#5f7c3c", ground: "grass" };
		case "cave": return { ...BASE, floor: "#74685a", floorStyle: "cave", wall: "#2c251f", wallStyle: "rock", mass: "#17130f" };
		case "mountain_pass": return { ...BASE, floor: "#8b8170", floorStyle: "gravel", wall: "#6c655b", wallStyle: "cliff", mass: "#3d3934", trees: "pine" };
		case "tavern": return { ...BASE, floor: "#6f6a62", wood: "#86603b", wall: "#3d2a1c", wallStyle: "timber", mass: "#1d140d", road: "cobble", ground: "wood_floor" };
		case "ship": return { ...BASE, wood: "#9a7349", wall: "#5a3b22", wallStyle: "rail", mass: "#2b1c10", deck: true, ground: "wood_floor" };
		case "arena": return { ...BASE, floor: "#7d7366", floorStyle: "sand", wall: "#5d554b", mass: "#2a2621" };
		case "camp": return { ...BASE, wallStyle: "palisade", wall: "#6b4a2b", ground: "grass" };
		case "forest": return { ...BASE, ground: "grass", grass: "#557535", trees: "mixed" };
		case "road": return { ...BASE, ground: "grass", grass: "#66833f", trees: "broadleaf" };
		case "swamp": return { ...BASE, ground: "mud", grass: "#5a6a34", trees: "swamp" };
		case "town": return { ...BASE, ground: "grass", grass: "#67843f", road: "cobble", trees: "broadleaf" };
		default: return { ...BASE };
	}
}

const GROUND = new Set<Tile>(["floor", "wood_floor", "grass", "tall_grass", "road", "sand", "mud", "difficult", "rubble", "ice"]);
const BLOB_ORDER: Tile[] = ["mud", "sand", "road", "water", "deep_water", "lava", "pit"];

export interface PaintChunk {
	canvas: HTMLCanvasElement;
	/** Chunk origin in tiles. */
	x0: number;
	y0: number;
	cols: number;
	rows: number;
}

/** Pick a tile size that keeps the full map texture reasonable (32..64 px). */
export function tileSizeFor(map: Pick<GridMap, "width" | "height">): number {
	const cells = map.width * map.height;
	return cells > 9000 ? 40 : cells > 5000 ? 48 : 64;
}

export function paintMap(map: GridMap, T: number, maxChunkPx = 2048): PaintChunk[] {
	const per = Math.max(8, Math.floor(maxChunkPx / T));
	const out: PaintChunk[] = [];
	const P = new Painter(map, T);
	for (let y0 = 0; y0 < map.height; y0 += per)
		for (let x0 = 0; x0 < map.width; x0 += per) {
			const cols = Math.min(per, map.width - x0), rows = Math.min(per, map.height - y0);
			const canvas = document.createElement("canvas");
			canvas.width = cols * T;
			canvas.height = rows * T;
			P.paint(canvas, x0, y0, cols, rows);
			out.push({ canvas, x0, y0, cols, rows });
		}
	return out;
}

type Ctx = CanvasRenderingContext2D;

class Painter {
	th: Theme;
	n1: Noise2D;
	n2: Noise2D;
	seed: number;
	buildings: { x: number; y: number; w: number; h: number; id: number }[] = [];
	constructor(public map: GridMap, public T: number) {
		this.th = themeFor(map.kind);
		if (map.climate === "snow") this.th = { ...this.th, grass: "#d9e1e8", trees: "pine" };
		if (map.climate === "desert") this.th = { ...this.th, grass: "#c9ad7c" };
		this.seed = map.seed | 0;
		this.n1 = makeNoise2D(map.seed ^ 0x1234);
		this.n2 = makeNoise2D(map.seed ^ 0x9876);
		this.findBuildings();
	}
	t(x: number, y: number): Tile {
		const m = this.map;
		if (x < 0 || y < 0 || x >= m.width || y >= m.height) {
			// extend edges outward so borders look continuous
			const cx = Math.max(0, Math.min(m.width - 1, x)), cy = Math.max(0, Math.min(m.height - 1, y));
			return m.tiles[cy * m.width + cx];
		}
		return m.tiles[y * m.width + x];
	}
	r(x: number, y: number, k = 0) {
		return rand2(x, y, this.seed + k * 7919);
	}
	isWall(t: Tile) {
		return t === "wall" || t === "secret_door" || t === "void";
	}
	/** Ground under a square. */
	ground(x: number, y: number): Tile {
		const t = this.t(x, y);
		if (GROUND.has(t)) return t === "tall_grass" ? "grass" : t === "difficult" || t === "rubble" ? this.neighborGround(x, y, t) : t;
		if (t === "tree") return this.map.kind === "swamp" ? "mud" : "grass";
		if (t === "water" || t === "deep_water" || t === "lava" || t === "pit" || t === "bridge" || this.isWall(t)) return this.neighborGround(x, y, this.th.ground);
		return this.neighborGround(x, y, this.th.ground);
	}
	neighborGround(x: number, y: number, fallback: Tile): Tile {
		const counts = new Map<Tile, number>();
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			if (!dx && !dy) continue;
			let g = this.t(x + dx, y + dy);
			if (g === "tall_grass") g = "grass";
			if (g === "tree") g = this.map.kind === "swamp" ? "mud" : "grass";
			if (g === "difficult" || g === "rubble") g = this.th.ground === "wood_floor" ? "wood_floor" : "floor";
			if (!GROUND.has(g) || g === "road") continue;
			counts.set(g, (counts.get(g) ?? 0) + (dx && dy ? 1 : 2));
		}
		let best = fallback, bc = 0;
		for (const [g, c] of counts) if (c > bc) { bc = c; best = g; }
		if (fallback === "rubble" || fallback === "difficult") return bc ? best : this.th.ground;
		return bc ? best : fallback;
	}
	findBuildings() {
		const m = this.map;
		const seen = new Uint8Array(m.width * m.height);
		let id = 0;
		for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
			const i = y * m.width + x;
			if (seen[i] || m.tiles[i] !== "building") continue;
			let x1 = x, y1 = y, x0 = x, y0 = y;
			const q = [i];
			seen[i] = 1;
			for (let qi = 0; qi < q.length; qi++) {
				const j = q[qi], jx = j % m.width, jy = (j / m.width) | 0;
				x0 = Math.min(x0, jx); y0 = Math.min(y0, jy); x1 = Math.max(x1, jx); y1 = Math.max(y1, jy);
				for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
					const nx = jx + dx, ny = jy + dy;
					if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
					const ni = ny * m.width + nx;
					if (!seen[ni] && m.tiles[ni] === "building") { seen[ni] = 1; q.push(ni); }
				}
			}
			// include doors on the perimeter so the roof reads as one rectangle
			this.buildings.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, id: id++ });
		}
	}

	paint(canvas: HTMLCanvasElement, x0: number, y0: number, cols: number, rows: number) {
		const ctx = canvas.getContext("2d")!;
		const T = this.T;
		ctx.save();
		ctx.translate(-x0 * T, -y0 * T);
		const M = 2;
		const xa = x0 - M, xb = x0 + cols + M, ya = y0 - M, yb = y0 + rows + M;
		const each = (fn: (x: number, y: number, t: Tile) => void) => {
			for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) fn(x, y, this.t(x, y));
		};
		// 1. ground
		each((x, y) => this.paintGround(ctx, x, y, this.ground(x, y)));
		// 2. organic terrain blobs
		for (const layer of BLOB_ORDER) {
			if (layer === "road" && this.th.road === "cobble") continue;
			this.paintBlobs(ctx, layer, xa, xb, ya, yb);
		}
		if (this.th.road === "cobble") each((x, y, t) => { if (t === "road") this.paintCobbles(ctx, x, y); });
		// 3. ground details
		each((x, y, t) => this.paintDetail(ctx, x, y, t));
		// 4. shadows of tall things
		this.paintShadows(ctx, canvas, x0, y0, xa, xb, ya, yb);
		// 5. walls
		if (this.map.kind === "ship") this.paintShipHull(ctx, xa, xb, ya, yb);
		if (this.th.wallStyle === "rock" || this.th.wallStyle === "cliff") this.paintRockWalls(ctx, xa, xb, ya, yb);
		else each((x, y, t) => { if (this.isWall(t)) this.paintWall(ctx, x, y); });
		if (this.th.wallStyle === "masonry" || this.th.wallStyle === "timber" || this.th.wallStyle === "rail") each((x, y, t) => { if (this.isWall(t)) this.paintWallEdges(ctx, x, y); });
		// 6. objects
		each((x, y, t) => this.paintObject(ctx, x, y, t));
		for (const b of this.buildings) if (b.x + b.w >= xa && b.x <= xb && b.y + b.h >= ya && b.y <= yb) this.paintRoof(ctx, b);
		each((x, y, t) => { if (t === "door" || t === "door_open" || t === "door_locked") this.paintDoor(ctx, x, y, t); });
		each((x, y, t) => { if (t === "tree") this.paintTree(ctx, x, y); });
		// 7. subtle vignette-ish large-scale tonal variation
		this.paintTone(ctx, xa, xb, ya, yb);
		ctx.restore();
	}

	// ─── ground ────────────────────────────────────────────────────────
	paintGround(ctx: Ctx, x: number, y: number, g: Tile) {
		const T = this.T, px = x * T, py = y * T;
		const tone = fbm(this.n1, x / 7, y / 7, 3) * 0.12;
		switch (g) {
			case "grass": {
				ctx.fillStyle = shade(this.th.grass, tone);
				ctx.fillRect(px, py, T, T);
				// sub-tile noise blotches
				for (let i = 0; i < 4; i++) {
					const sx = px + (i % 2) * T * 0.5, sy = py + (i >> 1) * T * 0.5;
					const n = fbm(this.n2, (x + (i % 2) * 0.5) / 2.5, (y + (i >> 1) * 0.5) / 2.5, 2);
					ctx.fillStyle = n > 0 ? shade(this.th.grass, 0.12, n * 0.5) : shade(this.th.grass, -0.25, -n * 0.5);
					ctx.fillRect(sx, sy, T * 0.5, T * 0.5);
				}
				break;
			}
			case "wood_floor":
				this.paintPlanks(ctx, x, y, this.th.deck);
				break;
			case "mud":
				ctx.fillStyle = shade("#4d4128", tone);
				ctx.fillRect(px, py, T, T);
				break;
			case "ice": {
				ctx.fillStyle = shade("#a9cadb", tone);
				ctx.fillRect(px, py, T, T);
				ctx.strokeStyle = "rgba(255,255,255,0.45)";
				ctx.lineWidth = Math.max(1, T / 32);
				ctx.beginPath();
				const a = this.r(x, y, 41) * T, b = this.r(x, y, 42) * T;
				ctx.moveTo(px + a, py);
				ctx.lineTo(px + T * 0.5, py + b);
				ctx.lineTo(px + T, py + this.r(x, y, 43) * T);
				ctx.stroke();
				break;
			}
			case "sand":
				ctx.fillStyle = this.map.kind === "mountain_pass" ? shade(this.th.floor, 0.06 + tone) : shade("#c2a878", tone);
				ctx.fillRect(px, py, T, T);
				break;
			case "road":
				ctx.fillStyle = this.th.road === "cobble" ? "#6f6a63" : shade("#7a6447", tone);
				ctx.fillRect(px, py, T, T);
				break;
			default:
				this.paintFloor(ctx, x, y, tone);
		}
	}

	paintFloor(ctx: Ctx, x: number, y: number, tone: number) {
		const T = this.T, px = x * T, py = y * T;
		const base = this.th.floor;
		const style = this.th.floorStyle;
		if (style === "cave" || style === "gravel" || style === "sand") {
			const c = style === "sand" ? "#b49a6e" : base;
			ctx.fillStyle = shade(c, tone);
			ctx.fillRect(px, py, T, T);
			for (let i = 0; i < 5; i++) {
				const r = this.r(x, y, i + 20);
				ctx.fillStyle = shade(c, r > 0.5 ? 0.08 : -0.12, 0.5);
				ctx.beginPath();
				ctx.ellipse(px + this.r(x, y, i) * T, py + this.r(x, y, i + 5) * T, T * (0.15 + r * 0.25), T * (0.1 + r * 0.18), r * 3, 0, Math.PI * 2);
				ctx.fill();
			}
			const pebbles = style === "gravel" ? 7 : 3;
			for (let i = 0; i < pebbles; i++) {
				const r = this.r(x, y, i + 40);
				ctx.fillStyle = shade(c, r > 0.5 ? 0.25 : -0.3, 0.8);
				ctx.beginPath();
				ctx.arc(px + this.r(x, y, i + 50) * T, py + this.r(x, y, i + 60) * T, T * (0.02 + r * 0.03), 0, Math.PI * 2);
				ctx.fill();
			}
			return;
		}
		if (style === "marble") {
			const light = (x + y) % 2 === 0;
			ctx.fillStyle = shade(base, (light ? 0.12 : -0.12) + tone * 0.5);
			ctx.fillRect(px, py, T, T);
			ctx.strokeStyle = shade(base, -0.35, 0.35);
			ctx.lineWidth = Math.max(1, T * 0.02);
			ctx.beginPath();
			const a = this.r(x, y, 3);
			ctx.moveTo(px + a * T, py);
			ctx.bezierCurveTo(px + T * 0.3, py + T * this.r(x, y, 4), px + T * 0.7, py + T * this.r(x, y, 5), px + T * this.r(x, y, 6), py + T);
			ctx.stroke();
			ctx.strokeStyle = "rgba(0,0,0,0.35)";
			ctx.lineWidth = Math.max(1, T * 0.025);
			ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
			return;
		}
		// flagstones: 1, 2 or 4 slabs per square
		ctx.fillStyle = shade(base, -0.45);
		ctx.fillRect(px, py, T, T);
		const kind = this.r(x, y, 1);
		const slabs: [number, number, number, number][] =
			kind < 0.35 ? [[0, 0, 1, 1]] : kind < 0.55 ? [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] : kind < 0.75 ? [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] : [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
		const g = Math.max(1, T * 0.035);
		slabs.forEach(([sx, sy, sw, sh], i) => {
			const v = (this.r(x, y, 10 + i) - 0.5) * 0.18 + tone;
			const X = px + sx * T + g / 2, Y = py + sy * T + g / 2, Wd = sw * T - g, Ht = sh * T - g;
			ctx.fillStyle = shade(base, v);
			roundRect(ctx, X, Y, Wd, Ht, T * 0.04);
			ctx.fill();
			// bevel: light top-left, dark bottom-right
			ctx.fillStyle = "rgba(255,255,255,0.06)";
			ctx.fillRect(X, Y, Wd, g * 0.8);
			ctx.fillStyle = "rgba(0,0,0,0.12)";
			ctx.fillRect(X, Y + Ht - g * 0.8, Wd, g * 0.8);
			// speckles
			for (let k = 0; k < 4; k++) {
				ctx.fillStyle = this.r(x * 3 + i, y, 30 + k) > 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.1)";
				ctx.fillRect(X + this.r(x, y * 5 + i, 40 + k) * Wd, Y + this.r(x, y * 5 + i, 50 + k) * Ht, g, g);
			}
		});
		if (this.r(x, y, 77) < 0.08) {
			ctx.strokeStyle = "rgba(0,0,0,0.35)";
			ctx.lineWidth = Math.max(1, T * 0.018);
			ctx.beginPath();
			let cx = px + this.r(x, y, 78) * T, cy = py + this.r(x, y, 79) * T;
			ctx.moveTo(cx, cy);
			for (let k = 0; k < 4; k++) {
				cx += (this.r(x, y, 80 + k) - 0.5) * T * 0.4;
				cy += (this.r(x, y, 90 + k) - 0.5) * T * 0.4;
				ctx.lineTo(cx, cy);
			}
			ctx.stroke();
		}
	}

	paintPlanks(ctx: Ctx, x: number, y: number, deck?: boolean) {
		const T = this.T, px = x * T, py = y * T;
		const rowsPer = deck ? 3 : 4;
		const ph = T / rowsPer;
		const base = this.th.wood;
		for (let i = 0; i < rowsPer; i++) {
			const row = y * rowsPer + i;
			const L = T * (2 + Math.floor(rand2(row, 0, this.seed) * 2));
			const off = rand2(row, 1, this.seed) * L;
			// planks overlapping this tile in world px
			const a = px, b = px + T;
			let start = Math.floor((a + off) / L) * L - off;
			while (start < b) {
				const idx = Math.round((start + off) / L);
				const v = (rand2(row, idx, this.seed + 5) - 0.5) * 0.2;
				const sx = Math.max(a, start), ex = Math.min(b, start + L);
				ctx.fillStyle = shade(base, v);
				ctx.fillRect(sx, py + i * ph, ex - sx, ph);
				// grain
				ctx.strokeStyle = shade(base, -0.25, 0.35);
				ctx.lineWidth = 1;
				ctx.beginPath();
				const gy = py + i * ph + ph * (0.3 + rand2(row, idx, 9) * 0.4);
				ctx.moveTo(sx, gy);
				ctx.lineTo(ex, gy + (rand2(row, idx, 11) - 0.5) * 2);
				ctx.stroke();
				if (start >= a && start < b) {
					ctx.fillStyle = shade(base, -0.55, 0.9);
					ctx.fillRect(start, py + i * ph, Math.max(1, T * 0.02), ph);
					if (deck) {
						ctx.fillStyle = "rgba(30,20,10,0.6)";
						ctx.fillRect(start + T * 0.04, py + i * ph + ph * 0.25, T * 0.025, T * 0.025);
						ctx.fillRect(start + T * 0.04, py + i * ph + ph * 0.7, T * 0.025, T * 0.025);
					}
				}
				start += L;
			}
			ctx.fillStyle = shade(base, -0.6, 0.85);
			ctx.fillRect(px, py + i * ph, T, Math.max(1, T * 0.018));
		}
	}

	paintBlobs(ctx: Ctx, layer: Tile, xa: number, xb: number, ya: number, yb: number) {
		const T = this.T;
		const cells: [number, number][] = [];
		for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (this.t(x, y) === layer) cells.push([x, y]);
		if (!cells.length) return;
		const blob = (r: number, k: number) => {
			const p = new Path2D();
			for (const [x, y] of cells) {
				const rr = T * r * (0.92 + this.r(x, y, k) * 0.16);
				const cx = (x + 0.5) * T + (this.r(x, y, k + 1) - 0.5) * T * 0.08;
				const cy = (y + 0.5) * T + (this.r(x, y, k + 2) - 0.5) * T * 0.08;
				p.moveTo(cx + rr, cy);
				p.arc(cx, cy, rr, 0, Math.PI * 2);
			}
			// extra circles between neighbouring cells smooth out the scalloped edge
			const set = new Set(cells.map(([x, y]) => y * 100000 + x));
			const rr = T * r;
			for (const [x, y] of cells) {
				for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
					if (!set.has((y + dy) * 100000 + x + dx)) continue;
					const cx = (x + 0.5 + dx / 2) * T, cy = (y + 0.5 + dy / 2) * T;
					p.moveTo(cx + rr, cy);
					p.arc(cx, cy, rr, 0, Math.PI * 2);
				}
			}
			return p;
		};
		switch (layer) {
			case "mud": {
				ctx.fillStyle = "#4a3d26";
				ctx.fill(blob(0.74, 3));
				ctx.fillStyle = "rgba(90,74,46,0.6)";
				for (const [x, y] of cells) {
					ctx.beginPath();
					ctx.ellipse((x + this.r(x, y, 4)) * T, (y + this.r(x, y, 5)) * T, T * 0.25, T * 0.12, this.r(x, y, 6) * 3, 0, Math.PI * 2);
					ctx.fill();
				}
				ctx.fillStyle = "rgba(160,170,150,0.18)";
				for (const [x, y] of cells) if (this.r(x, y, 7) < 0.3) {
					ctx.beginPath();
					ctx.ellipse((x + 0.3 + this.r(x, y, 8) * 0.4) * T, (y + 0.3 + this.r(x, y, 9) * 0.4) * T, T * 0.14, T * 0.07, 0.3, 0, Math.PI * 2);
					ctx.fill();
				}
				break;
			}
			case "sand": {
				ctx.fillStyle = this.map.kind === "mountain_pass" ? "rgba(168,156,136,0.55)" : "#c4a874";
				ctx.fill(blob(0.74, 13));
				if (this.map.kind === "mountain_pass") break;
				ctx.strokeStyle = "rgba(120,95,55,0.25)";
				ctx.lineWidth = Math.max(1, T * 0.02);
				for (const [x, y] of cells) for (let i = 0; i < 2; i++) {
					ctx.beginPath();
					const cy = (y + 0.25 + i * 0.45) * T;
					ctx.moveTo(x * T + T * 0.1, cy);
					ctx.quadraticCurveTo((x + 0.5) * T, cy - T * 0.12, (x + 0.9) * T, cy);
					ctx.stroke();
				}
				break;
			}
			case "road": {
				ctx.fillStyle = "#6b5236";
				ctx.fill(blob(0.8, 23));
				ctx.fillStyle = "#7f6646";
				ctx.fill(blob(0.66, 24));
				for (const [x, y] of cells) {
					for (let i = 0; i < 4; i++) {
						ctx.fillStyle = this.r(x, y, 30 + i) > 0.5 ? "rgba(150,130,100,0.7)" : "rgba(60,45,30,0.6)";
						ctx.beginPath();
						ctx.arc((x + this.r(x, y, 40 + i)) * T, (y + this.r(x, y, 50 + i)) * T, T * (0.02 + this.r(x, y, 60 + i) * 0.03), 0, Math.PI * 2);
						ctx.fill();
					}
				}
				break;
			}
			case "water":
			case "deep_water": {
				const deep = layer === "deep_water";
				if (!deep) {
					ctx.fillStyle = this.map.kind === "swamp" ? "rgba(70,80,45,0.8)" : "rgba(170,160,120,0.55)";
					ctx.fill(blob(0.86, 33));
				}
				const shallow = this.map.kind === "swamp" ? "#3f5a48" : this.map.kind === "cave" ? "#2f5966" : "#3f7f93";
				const deepC = this.map.kind === "swamp" ? "#22362c" : this.map.kind === "cave" ? "#173640" : "#1f4f6e";
				ctx.fillStyle = deep ? deepC : shallow;
				ctx.fill(blob(deep ? 0.78 : 0.72, 34));
				// soft inner gradient & ripples
				ctx.fillStyle = deep ? "rgba(0,10,30,0.25)" : "rgba(255,255,255,0.05)";
				ctx.fill(blob(deep ? 0.5 : 0.45, 35));
				ctx.strokeStyle = "rgba(220,240,255,0.18)";
				ctx.lineWidth = Math.max(1, T * 0.02);
				for (const [x, y] of cells) if (this.r(x, y, 36) < 0.5) {
					ctx.beginPath();
					const cx = (x + 0.2 + this.r(x, y, 37) * 0.6) * T, cy = (y + 0.2 + this.r(x, y, 38) * 0.6) * T;
					ctx.arc(cx, cy, T * 0.15, Math.PI * 1.1, Math.PI * 1.9);
					ctx.stroke();
				}
				if (this.map.kind === "swamp" && !deep) {
					for (const [x, y] of cells) if (this.r(x, y, 39) < 0.35) {
						ctx.fillStyle = "#4f7a35";
						ctx.beginPath();
						const cx = (x + this.r(x, y, 40)) * T, cy = (y + this.r(x, y, 41)) * T;
						ctx.arc(cx, cy, T * 0.1, 0.4, Math.PI * 2 - 0.1);
						ctx.lineTo(cx, cy);
						ctx.fill();
					}
				}
				break;
			}
			case "lava": {
				ctx.fillStyle = "#2a1410";
				ctx.fill(blob(0.84, 43));
				ctx.fillStyle = "#c2410c";
				ctx.fill(blob(0.7, 44));
				ctx.fillStyle = "#fb923c";
				ctx.fill(blob(0.45, 45));
				ctx.fillStyle = "#fde68a";
				ctx.fill(blob(0.18, 46));
				ctx.strokeStyle = "rgba(40,15,10,0.8)";
				ctx.lineWidth = Math.max(1.5, T * 0.04);
				for (const [x, y] of cells) {
					ctx.beginPath();
					ctx.moveTo((x + this.r(x, y, 47)) * T, (y + this.r(x, y, 48)) * T);
					ctx.lineTo((x + this.r(x, y, 49)) * T, (y + this.r(x, y, 50)) * T);
					ctx.lineTo((x + this.r(x, y, 51)) * T, (y + this.r(x, y, 52)) * T);
					ctx.stroke();
				}
				break;
			}
			case "pit": {
				ctx.fillStyle = "rgba(0,0,0,0.5)";
				ctx.fill(blob(0.86, 53));
				ctx.fillStyle = "#0b0908";
				ctx.fill(blob(0.7, 54));
				ctx.fillStyle = "#000";
				ctx.fill(blob(0.45, 55));
				break;
			}
		}
	}

	paintCobbles(ctx: Ctx, x: number, y: number) {
		const T = this.T, px = x * T, py = y * T;
		const n = 4;
		const s = T / n;
		ctx.fillStyle = "#4a4640";
		ctx.fillRect(px, py, T, T);
		for (let j = 0; j < n; j++) {
			const off = (y * n + j) % 2 ? s / 2 : 0;
			for (let i = -1; i < n; i++) {
				const cx = px + i * s + off;
				if (cx + s <= px || cx >= px + T) continue;
				const v = (rand2(x * n + i, y * n + j, this.seed + 3) - 0.5) * 0.25;
				ctx.fillStyle = shade("#8a847a", v);
				const X = Math.max(px, cx + 1), W = Math.min(px + T, cx + s - 1) - X;
				roundRect(ctx, X, py + j * s + 1, W, s - 2, s * 0.3);
				ctx.fill();
				ctx.fillStyle = "rgba(255,255,255,0.08)";
				ctx.fillRect(X + 1, py + j * s + 1.5, W - 2, Math.max(1, s * 0.15));
			}
		}
	}

	paintDetail(ctx: Ctx, x: number, y: number, t: Tile) {
		const T = this.T, px = x * T, py = y * T;
		if (t === "grass" || t === "tall_grass") {
			const n = t === "tall_grass" ? 16 : 7;
			for (let i = 0; i < n; i++) {
				const bx = px + this.r(x, y, 100 + i) * T, by = py + this.r(x, y, 120 + i) * T;
				const len = T * (t === "tall_grass" ? 0.22 + this.r(x, y, 140 + i) * 0.2 : 0.08 + this.r(x, y, 140 + i) * 0.08);
				const lean = (this.r(x, y, 160 + i) - 0.5) * len;
				ctx.strokeStyle = this.r(x, y, 180 + i) > 0.5 ? shade(this.th.grass, t === "tall_grass" ? 0.25 : 0.18) : shade(this.th.grass, -0.3);
				ctx.lineWidth = Math.max(1, T * 0.022);
				ctx.beginPath();
				ctx.moveTo(bx, by);
				ctx.quadraticCurveTo(bx + lean * 0.3, by - len * 0.6, bx + lean, by - len);
				ctx.stroke();
			}
			if (t === "tall_grass" && this.map.kind === "swamp") {
				// cattails
				for (let i = 0; i < 3; i++) {
					ctx.fillStyle = "#5b3a1e";
					ctx.beginPath();
					ctx.ellipse(px + this.r(x, y, 200 + i) * T, py + this.r(x, y, 210 + i) * T, T * 0.03, T * 0.07, 0.2, 0, Math.PI * 2);
					ctx.fill();
				}
			} else if (t === "grass" && this.r(x, y, 220) < 0.06) {
				const colors = ["#f4f1de", "#f2cc8f", "#c9a7eb", "#e07a5f"];
				ctx.fillStyle = colors[Math.floor(this.r(x, y, 221) * colors.length)];
				for (let i = 0; i < 4; i++) {
					ctx.beginPath();
					ctx.arc(px + this.r(x, y, 222 + i) * T, py + this.r(x, y, 230 + i) * T, T * 0.025, 0, Math.PI * 2);
					ctx.fill();
				}
			}
		} else if (t === "rubble" || t === "difficult") {
			if (this.map.kind === "ship" && t === "difficult") {
				// coiled rope
				ctx.strokeStyle = "#c8a46a";
				ctx.lineWidth = T * 0.05;
				for (let k = 0; k < 3; k++) {
					ctx.beginPath();
					ctx.arc(px + T / 2, py + T / 2, T * (0.12 + k * 0.08), 0, Math.PI * 2);
					ctx.stroke();
				}
				return;
			}
			const n = t === "rubble" ? 7 : 4;
			const stone = this.th.wallStyle === "rock" || this.th.wallStyle === "cliff" ? "#7a6e60" : this.th.ground === "grass" ? "#7d7a6e" : shade(this.th.floor, 0.1);
			for (let i = 0; i < n; i++) {
				const cx = px + (0.15 + this.r(x, y, 300 + i) * 0.7) * T, cy = py + (0.15 + this.r(x, y, 310 + i) * 0.7) * T;
				const rr = T * (0.05 + this.r(x, y, 320 + i) * (t === "rubble" ? 0.09 : 0.06));
				ctx.fillStyle = "rgba(0,0,0,0.35)";
				poly(ctx, cx + rr * 0.3, cy + rr * 0.4, rr, 6, this.r(x, y, 330 + i));
				ctx.fill();
				ctx.fillStyle = shade(stone, (this.r(x, y, 340 + i) - 0.5) * 0.4);
				poly(ctx, cx, cy, rr, 6, this.r(x, y, 330 + i));
				ctx.fill();
				ctx.fillStyle = "rgba(255,255,255,0.12)";
				poly(ctx, cx - rr * 0.25, cy - rr * 0.25, rr * 0.45, 5, this.r(x, y, 350 + i));
				ctx.fill();
			}
		}
	}

	// ─── shadows ───────────────────────────────────────────────────────
	paintShadows(ctx: Ctx, canvas: HTMLCanvasElement, x0: number, y0: number, xa: number, xb: number, ya: number, yb: number) {
		const T = this.T;
		const sh = document.createElement("canvas");
		sh.width = canvas.width;
		sh.height = canvas.height;
		const s = sh.getContext("2d")!;
		s.translate(-x0 * T, -y0 * T);
		s.fillStyle = "#000";
		const rocky = this.th.wallStyle === "rock" || this.th.wallStyle === "cliff";
		for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
			const t = this.t(x, y);
			if (this.isWall(t)) {
				if (rocky) { s.beginPath(); s.arc((x + 0.5) * T, (y + 0.5) * T, T * 0.75, 0, Math.PI * 2); s.fill(); }
				else s.fillRect(x * T, y * T, T, T);
			} else if (t === "pillar") { s.beginPath(); s.arc((x + 0.5) * T, (y + 0.5) * T, T * 0.36, 0, Math.PI * 2); s.fill(); }
			else if (t === "rock") { poly(s, (x + 0.5) * T, (y + 0.55) * T, T * 0.42, 9, this.r(x, y, 500)); s.fill(); }
			else if (t === "tree") { s.beginPath(); s.arc((x + 0.5) * T, (y + 0.5) * T, T * 0.62, 0, Math.PI * 2); s.fill(); }
			else if (t === "table" || t === "bar_counter") s.fillRect(x * T + T * 0.12, y * T + T * 0.12, T * 0.76, T * 0.76);
		}
		for (const b of this.buildings) s.fillRect(b.x * T, b.y * T, b.w * T, b.h * T);
		const off = 10000;
		ctx.save();
		ctx.shadowColor = rocky ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.6)";
		ctx.shadowBlur = T * 0.28;
		ctx.shadowOffsetX = off + T * 0.12;
		ctx.shadowOffsetY = T * 0.18;
		ctx.drawImage(sh, x0 * T - off, y0 * T);
		ctx.restore();
	}

	// ─── walls ─────────────────────────────────────────────────────────
	wallEdge(x: number, y: number) {
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !this.isWall(this.t(x + dx, y + dy))) return true;
		return false;
	}

	paintWall(ctx: Ctx, x: number, y: number) {
		const T = this.T, px = x * T, py = y * T;
		const th = this.th;
		const edge = this.wallEdge(x, y);
		if (th.wallStyle === "palisade") {
			const g = this.ground(x, y);
			if (!edge) return;
			void g;
			for (let i = 0; i < 3; i++) {
				const cx = px + (0.2 + i * 0.3) * T + (this.r(x, y, i) - 0.5) * T * 0.1, cy = py + T * (0.5 + (this.r(x, y, i + 3) - 0.5) * 0.3);
				const rr = T * (0.17 + this.r(x, y, i + 6) * 0.05);
				ctx.fillStyle = "#3a2716";
				ctx.beginPath(); ctx.arc(cx, cy, rr + 1.5, 0, Math.PI * 2); ctx.fill();
				ctx.fillStyle = shade(th.wall, (this.r(x, y, i + 9) - 0.5) * 0.3);
				ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
				ctx.strokeStyle = "rgba(40,25,10,0.6)";
				ctx.lineWidth = 1;
				ctx.beginPath(); ctx.arc(cx, cy, rr * 0.55, 0, Math.PI * 2); ctx.stroke();
				ctx.fillStyle = "rgba(255,230,190,0.25)";
				ctx.beginPath(); ctx.arc(cx - rr * 0.3, cy - rr * 0.3, rr * 0.3, 0, Math.PI * 2); ctx.fill();
			}
			return;
		}
		if (!edge) {
			// solid mass: dark with ink hatching near rooms
			ctx.fillStyle = th.mass;
			ctx.fillRect(px, py, T, T);
			let near = false;
			for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) if (!this.isWall(this.t(x + dx, y + dy))) near = true;
			if (near && th.wallStyle === "masonry") {
				ctx.strokeStyle = "rgba(255,255,255,0.07)";
				ctx.lineWidth = Math.max(1, T * 0.025);
				for (let k = 0; k < 3; k++) {
					const a = this.r(x, y, 600 + k) * Math.PI;
					const cx = px + this.r(x, y, 610 + k) * T, cy = py + this.r(x, y, 620 + k) * T;
					for (let l = -2; l <= 2; l++) {
						const ox = Math.cos(a + Math.PI / 2) * l * T * 0.06, oy = Math.sin(a + Math.PI / 2) * l * T * 0.06;
						ctx.beginPath();
						ctx.moveTo(cx + ox - Math.cos(a) * T * 0.14, cy + oy - Math.sin(a) * T * 0.14);
						ctx.lineTo(cx + ox + Math.cos(a) * T * 0.14, cy + oy + Math.sin(a) * T * 0.14);
						ctx.stroke();
					}
				}
			}
			return;
		}
		if (th.wallStyle === "rail" && this.hullEdge(x, y)) return; // drawn by paintShipHull
		if (th.wallStyle === "rail") {
			ctx.fillStyle = th.wall;
			ctx.fillRect(px, py, T, T);
			ctx.fillStyle = shade(th.wall, 0.15);
			ctx.fillRect(px, py + T * 0.15, T, T * 0.7);
			ctx.fillStyle = "rgba(0,0,0,0.3)";
			ctx.fillRect(px + (x % 2 ? 0 : T - 2), py, 2, T);
			return;
		}
		// masonry / timber: block pattern
		const timber = th.wallStyle === "timber";
		ctx.fillStyle = shade(th.wall, -0.2);
		ctx.fillRect(px, py, T, T);
		const rows = timber ? 1 : 2;
		const bh = T / rows;
		const bw = timber ? T : T / 2;
		for (let j = 0; j < rows; j++) {
			const off = timber ? 0 : (y * rows + j) % 2 ? T / 4 : 0;
			for (let i = -1; i < 3; i++) {
				const bx = px + i * bw - off;
				if (bx + bw <= px || bx >= px + T) continue;
				const X = Math.max(px, bx + 1), W = Math.min(px + T, bx + bw - 1) - X;
				if (W <= 0) continue;
				ctx.fillStyle = shade(th.wall, (rand2(x * 4 + i, y * 2 + j, this.seed + 9) - 0.5) * 0.25);
				ctx.fillRect(X, py + j * bh + 1, W, bh - 2);
				ctx.fillStyle = "rgba(255,255,255,0.05)";
				ctx.fillRect(X, py + j * bh + 1, W, Math.max(1, bh * 0.12));
			}
		}
		if (timber) {
			ctx.strokeStyle = "rgba(0,0,0,0.35)";
			ctx.lineWidth = Math.max(1, T * 0.03);
			ctx.beginPath();
			ctx.moveTo(px, py + T / 2);
			ctx.lineTo(px + T, py + T / 2);
			ctx.stroke();
		}
	}

	/** Ship rail tiles that touch open water (the hull outline). */
	hullEdge(x: number, y: number) {
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const t = this.t(x + dx, y + dy);
			if (t === "deep_water" || t === "water" || t === "bridge") return true;
		}
		return false;
	}

	paintShipHull(ctx: Ctx, xa: number, xb: number, ya: number, yb: number) {
		const T = this.T, m = this.map;
		const hull = (t: Tile) => t !== "deep_water" && t !== "water" && t !== "bridge";
		const cols: { x: number; top: number; bot: number }[] = [];
		for (let x = 0; x < m.width; x++) {
			let top = -1, bot = -1;
			for (let y = 0; y < m.height; y++) {
				if (!hull(m.tiles[y * m.width + x])) { if (top >= 0) break; continue; }
				if (top < 0) top = y;
				bot = y;
			}
			if (top >= 0) cols.push({ x, top, bot });
		}
		if (cols.length < 3) return;
		void xa; void xb; void ya; void yb;
		const pts: [number, number][] = [];
		const first = cols[0], last = cols[cols.length - 1];
		const midY = ((last.top + last.bot + 1) / 2) * T;
		pts.push([first.x * T + T * 0.2, (first.top + 0.15) * T]);
		for (const c of cols) pts.push([(c.x + 0.5) * T, c.top * T + T * 0.05]);
		pts.push([(last.x + 1) * T + T * 0.6, midY]);
		for (const c of [...cols].reverse()) pts.push([(c.x + 0.5) * T, (c.bot + 1) * T - T * 0.05]);
		pts.push([first.x * T + T * 0.2, (first.bot + 0.85) * T]);
		const path = new Path2D();
		path.moveTo(pts[0][0], pts[0][1]);
		for (let i = 1; i < pts.length; i++) {
			const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
			path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
		}
		path.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
		path.closePath();
		// hull shadow on the water, then hull, then deck inset
		ctx.save();
		ctx.shadowColor = "rgba(0,10,20,0.6)";
		ctx.shadowBlur = T * 0.5;
		ctx.shadowOffsetX = T * 0.15;
		ctx.shadowOffsetY = T * 0.25;
		ctx.fillStyle = "#3a2414";
		ctx.fill(path);
		ctx.restore();
		ctx.lineWidth = T * 0.5;
		ctx.strokeStyle = "#4a2e18";
		ctx.stroke(path);
		ctx.lineWidth = T * 0.36;
		ctx.strokeStyle = "#7a5230";
		ctx.stroke(path);
		ctx.lineWidth = T * 0.06;
		ctx.strokeStyle = "rgba(255,225,180,0.25)";
		ctx.stroke(path);
		ctx.save();
		ctx.clip(path);
		ctx.lineWidth = T * 0.6;
		for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (hull(m.tiles[y * m.width + x])) this.paintPlanks(ctx, x, y, true);
		ctx.restore();
		ctx.lineWidth = T * 0.2;
		ctx.strokeStyle = "#5a3a20";
		ctx.stroke(path);
		ctx.lineWidth = T * 0.05;
		ctx.strokeStyle = "#20140a";
		ctx.stroke(path);
		// bowsprit
		ctx.strokeStyle = "#5a3a20";
		ctx.lineWidth = T * 0.16;
		ctx.beginPath();
		ctx.moveTo((last.x + 1) * T, midY);
		ctx.lineTo((last.x + 1) * T + T * 1.8, midY);
		ctx.stroke();
	}

	paintWallEdges(ctx: Ctx, x: number, y: number) {
		if (this.map.kind === "ship" && this.hullEdge(x, y)) return;
		const T = this.T, px = x * T, py = y * T;
		const lw = Math.max(2, T * 0.07);
		const sides: [number, number, number, number, number, number][] = [
			[0, -1, px, py, px + T, py],
			[0, 1, px, py + T, px + T, py + T],
			[-1, 0, px, py, px, py + T],
			[1, 0, px + T, py, px + T, py + T],
		];
		for (const [dx, dy, ax, ay, bx, by] of sides) {
			const nt = this.t(x + dx, y + dy);
			if (this.isWall(nt)) continue;
			ctx.strokeStyle = this.th.wallStyle === "rail" ? "#1e130a" : "#0c0a09";
			ctx.lineWidth = lw;
			ctx.lineCap = "square";
			ctx.beginPath();
			ctx.moveTo(ax, ay);
			ctx.lineTo(bx, by);
			ctx.stroke();
			// inner highlight bevel
			ctx.strokeStyle = shade(this.th.wall, 0.35, 0.55);
			ctx.lineWidth = Math.max(1, T * 0.035);
			ctx.beginPath();
			const ix = -dx * lw * 1.1, iy = -dy * lw * 1.1;
			ctx.moveTo(ax + ix, ay + iy);
			ctx.lineTo(bx + ix, by + iy);
			ctx.stroke();
		}
	}

	paintRockWalls(ctx: Ctx, xa: number, xb: number, ya: number, yb: number) {
		const T = this.T;
		const cliff = this.th.wallStyle === "cliff";
		const rim = new Path2D(), lip = new Path2D(), core = new Path2D();
		const lipW = T * 0.13;
		for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
			if (!this.isWall(this.t(x, y))) continue;
			const edge = this.wallEdge(x, y);
			const cx = (x + 0.5) * T, cy = (y + 0.5) * T;
			if (!edge) {
				for (const p of [rim, lip, core]) p.rect(x * T - 1, y * T - 1, T + 2, T + 2);
				continue;
			}
			const rr = T * (0.66 + this.r(x, y, 700) * 0.14);
			const ox = (this.r(x, y, 701) - 0.5) * T * 0.15, oy = (this.r(x, y, 702) - 0.5) * T * 0.15;
			const X = cx + ox, Y = cy + oy;
			rim.moveTo(X + rr + T * 0.05, Y);
			rim.arc(X, Y, rr + T * 0.05, 0, Math.PI * 2);
			lip.moveTo(X + rr, Y);
			lip.arc(X, Y, rr, 0, Math.PI * 2);
			const cr = rr - lipW;
			core.moveTo(X + cr, Y);
			core.arc(X, Y, cr, 0, Math.PI * 2);
			// bridge the core toward neighbouring rock so the lip only shows at open edges
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
				if ((!dx && !dy) || !this.isWall(this.t(x + dx, y + dy))) continue;
				const nx = (x + dx + 0.5) * T, ny = (y + dy + 0.5) * T;
				const len = Math.hypot(nx - X, ny - Y) || 1;
				const px = (-(ny - Y) / len) * cr, py = ((nx - X) / len) * cr;
				// keep the same (clockwise) winding as arc() so nonzero fill unions instead of cancelling
				const q: [number, number][] = [[X + px, Y + py], [nx + px, ny + py], [nx - px, ny - py], [X - px, Y - py]];
				let area = 0;
				for (let i = 0; i < 4; i++) { const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4]; area += ax * by - bx * ay; }
				if (area < 0) q.reverse();
				core.moveTo(q[0][0], q[0][1]);
				for (let i = 1; i < 4; i++) core.lineTo(q[i][0], q[i][1]);
				core.closePath();
			}
		}
		ctx.fillStyle = cliff ? "#2a2622" : "#0b0907";
		ctx.fill(rim);
		ctx.fillStyle = cliff ? "#b3a893" : "#857766";
		ctx.fill(lip);
		ctx.fillStyle = this.th.wall;
		ctx.fill(core);
		ctx.save();
		ctx.clip(core);
		for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
			if (!this.isWall(this.t(x, y))) continue;
			// distance-to-open shading: cliffs get lighter toward their top
			let d = 3;
			for (let r = 1; r <= 2 && d === 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!this.isWall(this.t(x + dx, y + dy))) d = Math.min(d, r);
			const tone = cliff ? (d - 1) * 0.1 : -(d - 1) * 0.18;
			for (let k = 0; k < (cliff ? 2 : 4); k++) {
				const cx = (x + this.r(x, y, 710 + k)) * T, cy = (y + this.r(x, y, 720 + k)) * T;
				const rr = T * (0.2 + this.r(x, y, 730 + k) * 0.25);
				if (!cliff) {
					ctx.fillStyle = shade(this.th.wall, tone + (this.r(x, y, 740 + k) - 0.5) * 0.3, 0.6);
					ctx.beginPath();
					ctx.ellipse(cx, cy, rr, rr * 0.7, this.r(x, y, 750 + k) * 3, 0, Math.PI * 2);
					ctx.fill();
					continue;
				}
				ctx.fillStyle = shade(this.th.wall, tone + (this.r(x, y, 740 + k) - 0.5) * 0.07);
				poly(ctx, cx, cy, rr * 1.6, 7, this.r(x, y, 750 + k));
				ctx.fill();
				ctx.strokeStyle = "rgba(0,0,0,0.15)";
				ctx.lineWidth = Math.max(1, T * 0.02);
				ctx.stroke();
				ctx.fillStyle = "rgba(255,250,235,0.07)";
				poly(ctx, cx - rr * 0.3, cy - rr * 0.35, rr * 0.7, 6, this.r(x, y, 760 + k));
				ctx.fill();
			}
		}
		if (cliff) {
			// contour lines hint at height
			ctx.strokeStyle = "rgba(40,35,30,0.25)";
			ctx.lineWidth = Math.max(1, T * 0.025);
			for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
				if (!this.isWall(this.t(x, y)) || this.r(x, y, 770) > 0.4) continue;
				ctx.beginPath();
				ctx.arc((x + 0.5) * T, (y + 0.5) * T, T * (0.3 + this.r(x, y, 771) * 0.3), this.r(x, y, 772) * 6, this.r(x, y, 772) * 6 + 2);
				ctx.stroke();
			}
		}
		ctx.restore();
	}

	// ─── objects ───────────────────────────────────────────────────────
	paintObject(ctx: Ctx, x: number, y: number, t: Tile) {
		const T = this.T, px = x * T, py = y * T, cx = px + T / 2, cy = py + T / 2;
		switch (t) {
			case "pillar": {
				if (this.map.kind === "ship") {
					// mast with yard and furled sail
					ctx.fillStyle = "#e9dfc6";
					ctx.strokeStyle = "#8a7a5a";
					ctx.lineWidth = 1;
					roundRect(ctx, cx - T * 0.18, cy - T * 3.2, T * 0.36, T * 6.4, T * 0.15);
					ctx.fill();
					ctx.stroke();
					ctx.fillStyle = "#5b3a1f";
					ctx.fillRect(cx - T * 0.06, cy - T * 3.3, T * 0.12, T * 6.6);
					const g = ctx.createRadialGradient(cx - T * 0.1, cy - T * 0.1, 1, cx, cy, T * 0.3);
					g.addColorStop(0, "#a07648");
					g.addColorStop(1, "#4a2e15");
					ctx.fillStyle = g;
					ctx.beginPath(); ctx.arc(cx, cy, T * 0.3, 0, Math.PI * 2); ctx.fill();
					break;
				}
				const g = ctx.createRadialGradient(cx - T * 0.12, cy - T * 0.12, T * 0.02, cx, cy, T * 0.38);
				const stone = this.map.kind === "temple" ? "#d6cdbb" : this.map.kind === "swamp" ? "#7f8576" : "#8d867b";
				g.addColorStop(0, shade(stone, 0.35));
				g.addColorStop(0.7, stone);
				g.addColorStop(1, shade(stone, -0.4));
				ctx.fillStyle = "#151210";
				ctx.beginPath(); ctx.arc(cx, cy, T * 0.4, 0, Math.PI * 2); ctx.fill();
				ctx.fillStyle = g;
				ctx.beginPath(); ctx.arc(cx, cy, T * 0.36, 0, Math.PI * 2); ctx.fill();
				ctx.strokeStyle = "rgba(0,0,0,0.25)";
				ctx.lineWidth = Math.max(1, T * 0.025);
				ctx.beginPath(); ctx.arc(cx, cy, T * 0.25, 0, Math.PI * 2); ctx.stroke();
				break;
			}
			case "rock": {
				const base = this.th.wallStyle === "rock" ? "#7a6d5e" : "#8b877c";
				const seed = this.r(x, y, 500);
				const g = ctx.createLinearGradient(cx - T * 0.4, cy - T * 0.4, cx + T * 0.4, cy + T * 0.4);
				g.addColorStop(0, shade(base, 0.3));
				g.addColorStop(1, shade(base, -0.45));
				ctx.fillStyle = "#1d1a16";
				poly(ctx, cx, cy + T * 0.04, T * 0.46, 9, seed);
				ctx.fill();
				ctx.fillStyle = g;
				poly(ctx, cx, cy, T * 0.42, 9, seed);
				ctx.fill();
				ctx.fillStyle = "rgba(255,255,255,0.12)";
				poly(ctx, cx - T * 0.1, cy - T * 0.12, T * 0.18, 6, seed + 0.3);
				ctx.fill();
				ctx.strokeStyle = "rgba(0,0,0,0.35)";
				ctx.lineWidth = Math.max(1, T * 0.025);
				ctx.beginPath();
				ctx.moveTo(cx - T * 0.1, cy - T * 0.25);
				ctx.lineTo(cx + T * 0.05, cy);
				ctx.lineTo(cx - T * 0.02, cy + T * 0.22);
				ctx.stroke();
				if (this.th.ground === "grass" && this.r(x, y, 501) < 0.5) {
					ctx.fillStyle = "rgba(110,140,60,0.55)";
					ctx.beginPath(); ctx.ellipse(cx + T * 0.12, cy - T * 0.18, T * 0.12, T * 0.07, 0.4, 0, Math.PI * 2); ctx.fill();
				}
				break;
			}
			case "table":
			case "bar_counter": {
				const bar = t === "bar_counter";
				const pew = this.map.kind === "temple" && !bar;
				const same = (dx: number, dy: number) => this.t(x + dx, y + dy) === t;
				const ins = bar ? T * 0.12 : pew ? T * 0.28 : T * 0.12;
				const l = same(-1, 0) ? 0 : ins, r = same(1, 0) ? 0 : ins;
				const tp = same(0, -1) ? 0 : pew ? T * 0.25 : ins, bt = same(0, 1) ? 0 : pew ? T * 0.25 : ins;
				const wood = bar ? "#5a3820" : pew ? "#6a4527" : "#8a6038";
				ctx.fillStyle = shade(wood, -0.5);
				ctx.fillRect(px + l - 1, py + tp - 1, T - l - r + 2, T - tp - bt + 2);
				ctx.fillStyle = wood;
				ctx.fillRect(px + l, py + tp, T - l - r, T - tp - bt);
				ctx.strokeStyle = shade(wood, -0.25, 0.6);
				ctx.lineWidth = 1;
				for (let k = 1; k < 4; k++) {
					ctx.beginPath();
					ctx.moveTo(px + l, py + tp + ((T - tp - bt) * k) / 4);
					ctx.lineTo(px + T - r, py + tp + ((T - tp - bt) * k) / 4);
					ctx.stroke();
				}
				if (bar) {
					ctx.fillStyle = "rgba(255,220,170,0.18)";
					ctx.fillRect(px + l, py + tp, T - l - r, T * 0.08);
				}
				if (!pew) {
					// mugs / plates
					const items = Math.floor(this.r(x, y, 800) * 3);
					for (let k = 0; k < items; k++) {
						const ix = px + l + (0.15 + this.r(x, y, 801 + k) * 0.7) * (T - l - r), iy = py + tp + (0.2 + this.r(x, y, 810 + k) * 0.6) * (T - tp - bt);
						if (this.r(x, y, 820 + k) < 0.5) {
							ctx.fillStyle = "#d9d2c3"; ctx.beginPath(); ctx.arc(ix, iy, T * 0.08, 0, Math.PI * 2); ctx.fill();
							ctx.fillStyle = "#b5ab98"; ctx.beginPath(); ctx.arc(ix, iy, T * 0.05, 0, Math.PI * 2); ctx.fill();
						} else {
							ctx.fillStyle = "#6b4a2a"; ctx.beginPath(); ctx.arc(ix, iy, T * 0.06, 0, Math.PI * 2); ctx.fill();
							ctx.fillStyle = "#f0e2b6"; ctx.beginPath(); ctx.arc(ix, iy, T * 0.04, 0, Math.PI * 2); ctx.fill();
						}
					}
					// stools on free sides
					if (!bar) for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
						const nt = this.t(x + dx, y + dy);
						if (nt !== "wood_floor" && nt !== "floor") continue;
						if (this.r(x * 3 + dx, y * 3 + dy, 830) < 0.35) continue;
						const sx = cx + dx * T * 0.62, sy = cy + dy * T * 0.62;
						ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(sx + 2, sy + 3, T * 0.13, 0, Math.PI * 2); ctx.fill();
						ctx.fillStyle = "#6e4a2a"; ctx.beginPath(); ctx.arc(sx, sy, T * 0.13, 0, Math.PI * 2); ctx.fill();
						ctx.strokeStyle = "#3e2814"; ctx.lineWidth = 1; ctx.stroke();
					}
				}
				break;
			}
			case "stairs_up":
			case "stairs_down": {
				const down = t === "stairs_down";
				// orient toward an open neighbour
				let dir: [number, number] = [0, 1];
				for (const d of [[0, 1], [1, 0], [0, -1], [-1, 0]] as [number, number][]) {
					const nt = this.t(x + d[0], y + d[1]);
					if (!this.isWall(nt)) { dir = d; break; }
				}
				ctx.save();
				ctx.translate(cx, cy);
				ctx.rotate(Math.atan2(dir[1], dir[0]) - Math.PI / 2);
				const n = 6;
				for (let k = 0; k < n; k++) {
					const f = k / (n - 1);
					const v = down ? -0.55 + f * 0.5 : -0.05 - f * 0.4;
					ctx.fillStyle = shade(this.th.ground === "wood_floor" ? this.th.wood : this.th.floor, v);
					ctx.fillRect(-T * 0.45, -T / 2 + (k * T) / n, T * 0.9, T / n);
					ctx.fillStyle = "rgba(0,0,0,0.4)";
					ctx.fillRect(-T * 0.45, -T / 2 + ((k + 1) * T) / n - 1.5, T * 0.9, 1.5);
				}
				ctx.fillStyle = "rgba(0,0,0,0.5)";
				ctx.fillRect(-T * 0.5, -T / 2, T * 0.06, T);
				ctx.fillRect(T * 0.44, -T / 2, T * 0.06, T);
				ctx.restore();
				break;
			}
			case "bridge": {
				const wet = (tt: Tile) => tt === "water" || tt === "deep_water" || tt === "pit" || tt === "lava";
				const horizontalWalk = wet(this.t(x, y - 1)) || wet(this.t(x, y + 1)) || this.t(x - 1, y) === "bridge" || this.t(x + 1, y) === "bridge";
				const vertWalk = wet(this.t(x - 1, y)) || wet(this.t(x + 1, y));
				const alongX = this.map.kind === "ship" ? true : horizontalWalk && !vertWalk ? true : !horizontalWalk && vertWalk ? false : this.t(x - 1, y) === "bridge" || this.t(x + 1, y) === "bridge";
				ctx.save();
				ctx.translate(cx, cy);
				if (!alongX) ctx.rotate(Math.PI / 2);
				const n = 4;
				for (let k = 0; k < n; k++) {
					const v = (this.r(x, y, 900 + k) - 0.5) * 0.25;
					ctx.fillStyle = shade("#8b6a43", v);
					ctx.fillRect(-T / 2 + (k * T) / n + 1, -T * 0.46, T / n - 2, T * 0.92);
					ctx.fillStyle = "rgba(30,20,10,0.5)";
					ctx.fillRect(-T / 2 + (k * T) / n + T * 0.08, -T * 0.4, T * 0.04, T * 0.04);
					ctx.fillRect(-T / 2 + (k * T) / n + T * 0.08, T * 0.36, T * 0.04, T * 0.04);
				}
				// rails where the side is open
				ctx.strokeStyle = "#4a3320";
				ctx.lineWidth = T * 0.06;
				const sideA = alongX ? this.t(x, y - 1) : this.t(x + 1, y);
				const sideB = alongX ? this.t(x, y + 1) : this.t(x - 1, y);
				if (wet(sideA) && this.map.kind !== "ship") { ctx.beginPath(); ctx.moveTo(-T / 2, -T * 0.46); ctx.lineTo(T / 2, -T * 0.46); ctx.stroke(); }
				if (wet(sideB) && this.map.kind !== "ship") { ctx.beginPath(); ctx.moveTo(-T / 2, T * 0.46); ctx.lineTo(T / 2, T * 0.46); ctx.stroke(); }
				ctx.restore();
				break;
			}
			case "secret_door":
				break;
		}
	}

	paintDoor(ctx: Ctx, x: number, y: number, t: Tile) {
		const T = this.T, px = x * T, py = y * T, cx = px + T / 2, cy = py + T / 2;
		const solid = (tt: Tile) => this.isWall(tt) || tt === "building";
		// door panel spans between the solid neighbours
		const horiz = solid(this.t(x - 1, y)) && solid(this.t(x + 1, y)) ? true : solid(this.t(x, y - 1)) && solid(this.t(x, y + 1)) ? false : !(this.t(x, y - 1) === "building" || this.t(x, y + 1) === "building");
		const onBuilding = [this.t(x - 1, y), this.t(x + 1, y), this.t(x, y - 1), this.t(x, y + 1)].some((n) => n === "building");
		ctx.save();
		ctx.translate(cx, cy);
		if (!horiz) ctx.rotate(Math.PI / 2);
		if (onBuilding) {
			// door on a building facade: push it to the street side
			const out = [[0, 1], [0, -1], [1, 0], [-1, 0]].find(([dx, dy]) => !solid(this.t(x + dx, y + dy)) && this.t(x + dx, y + dy) !== "building" && this.t(x - dx, y - dy) === "building");
			if (out) {
				const along = horiz ? out[1] : -out[0];
				ctx.translate(0, along * T * 0.38);
				ctx.fillStyle = "#6f6a63";
				ctx.fillRect(-T * 0.3, along > 0 ? T * 0.08 : -T * 0.2, T * 0.6, T * 0.12);
			}
		}
		const thick = T * 0.24;
		// frame
		ctx.fillStyle = "#14100c";
		ctx.fillRect(-T / 2, -thick / 2 - 2, T * 0.12, thick + 4);
		ctx.fillRect(T / 2 - T * 0.12, -thick / 2 - 2, T * 0.12, thick + 4);
		const wood = t === "door_locked" ? "#5e3b1e" : "#7c5329";
		if (t === "door_open") {
			ctx.save();
			ctx.translate(-T / 2 + T * 0.12, -thick / 2);
			ctx.rotate(-Math.PI / 2 + 0.25);
			ctx.fillStyle = "#14100c";
			ctx.fillRect(-1, -1, T * 0.76 + 2, thick * 0.6 + 2);
			ctx.fillStyle = wood;
			ctx.fillRect(0, 0, T * 0.76, thick * 0.6);
			ctx.restore();
		} else {
			ctx.fillStyle = "#14100c";
			ctx.fillRect(-T / 2 + T * 0.1, -thick / 2 - 1, T * 0.8, thick + 2);
			ctx.fillStyle = wood;
			ctx.fillRect(-T / 2 + T * 0.12, -thick / 2, T * 0.76, thick);
			ctx.strokeStyle = shade(wood, -0.35);
			ctx.lineWidth = 1;
			for (let k = 1; k < 4; k++) {
				ctx.beginPath();
				ctx.moveTo(-T / 2 + T * 0.12 + (T * 0.76 * k) / 4, -thick / 2);
				ctx.lineTo(-T / 2 + T * 0.12 + (T * 0.76 * k) / 4, thick / 2);
				ctx.stroke();
			}
			ctx.fillStyle = "rgba(255,230,190,0.15)";
			ctx.fillRect(-T / 2 + T * 0.12, -thick / 2, T * 0.76, thick * 0.25);
			if (t === "door_locked") {
				ctx.fillStyle = "#3c3c40";
				ctx.fillRect(-T * 0.3, -thick / 2, T * 0.06, thick);
				ctx.fillRect(T * 0.24, -thick / 2, T * 0.06, thick);
				ctx.fillStyle = "#d4a72c";
				ctx.beginPath(); ctx.arc(0, 0, T * 0.07, 0, Math.PI * 2); ctx.fill();
				ctx.fillStyle = "#2a1d08";
				ctx.fillRect(-T * 0.012, -T * 0.01, T * 0.024, T * 0.05);
			} else {
				ctx.fillStyle = "#c8a24a";
				ctx.beginPath(); ctx.arc(T * 0.22, 0, T * 0.03, 0, Math.PI * 2); ctx.fill();
			}
		}
		ctx.restore();
	}

	paintRoof(ctx: Ctx, b: { x: number; y: number; w: number; h: number; id: number }) {
		const T = this.T;
		const X = b.x * T, Y = b.y * T, W = b.w * T, H = b.h * T;
		const palette = ["#8f4a32", "#6b4a3a", "#566070", "#9a7b4f", "#7d3f2c", "#4f5a63"];
		const base = palette[Math.floor(rand2(b.x, b.y, this.seed + 77) * palette.length)];
		const thatch = base === "#9a7b4f";
		const alongX = b.w >= b.h;
		ctx.save();
		// eaves outline
		ctx.fillStyle = "#1d1611";
		ctx.fillRect(X - 2, Y - 2, W + 4, H + 4);
		const halves = alongX
			? [[X, Y, W, H / 2, 0.12], [X, Y + H / 2, W, H / 2, -0.22]]
			: [[X, Y, W / 2, H, 0.12], [X + W / 2, Y, W / 2, H, -0.22]];
		for (const [hx, hy, hw, hh, tone] of halves) {
			const g = alongX ? ctx.createLinearGradient(0, hy, 0, hy + hh) : ctx.createLinearGradient(hx, 0, hx + hw, 0);
			const first = hy === Y && hx === X;
			g.addColorStop(0, shade(base, tone + (first ? -0.08 : 0.04)));
			g.addColorStop(1, shade(base, tone + (first ? 0.06 : -0.1)));
			ctx.fillStyle = g;
			ctx.fillRect(hx, hy, hw, hh);
		}
		// shingle courses
		ctx.strokeStyle = thatch ? "rgba(60,40,20,0.35)" : "rgba(0,0,0,0.28)";
		ctx.lineWidth = Math.max(1, T * 0.025);
		const step = T * (thatch ? 0.14 : 0.2);
		if (alongX) {
			for (let yy = Y + step; yy < Y + H; yy += step) {
				ctx.beginPath(); ctx.moveTo(X, yy); ctx.lineTo(X + W, yy); ctx.stroke();
				if (!thatch) for (let xx = X + ((yy / step) % 2 ? step : step / 2); xx < X + W; xx += step * 1.4) {
					ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy - step); ctx.stroke();
				}
			}
		} else {
			for (let xx = X + step; xx < X + W; xx += step) {
				ctx.beginPath(); ctx.moveTo(xx, Y); ctx.lineTo(xx, Y + H); ctx.stroke();
				if (!thatch) for (let yy = Y + ((xx / step) % 2 ? step : step / 2); yy < Y + H; yy += step * 1.4) {
					ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx - step, yy); ctx.stroke();
				}
			}
		}
		// ridge
		ctx.strokeStyle = shade(base, -0.5);
		ctx.lineWidth = T * 0.1;
		ctx.beginPath();
		if (alongX) { ctx.moveTo(X + T * 0.1, Y + H / 2); ctx.lineTo(X + W - T * 0.1, Y + H / 2); }
		else { ctx.moveTo(X + W / 2, Y + T * 0.1); ctx.lineTo(X + W / 2, Y + H - T * 0.1); }
		ctx.stroke();
		ctx.strokeStyle = shade(base, 0.2, 0.6);
		ctx.lineWidth = T * 0.03;
		ctx.stroke();
		// chimney
		if (rand2(b.x, b.y, this.seed + 78) < 0.6 && b.w * b.h >= 9) {
			const cxp = X + W * (0.2 + rand2(b.x, b.y, 79) * 0.6), cyp = alongX ? Y + H * 0.22 : Y + H * (0.2 + rand2(b.y, b.x, 80) * 0.6);
			ctx.fillStyle = "rgba(0,0,0,0.4)";
			ctx.fillRect(cxp - T * 0.16 + T * 0.08, cyp - T * 0.16 + T * 0.1, T * 0.32, T * 0.32);
			ctx.fillStyle = "#6e6259";
			ctx.fillRect(cxp - T * 0.16, cyp - T * 0.16, T * 0.32, T * 0.32);
			ctx.fillStyle = "#1a1512";
			ctx.fillRect(cxp - T * 0.09, cyp - T * 0.09, T * 0.18, T * 0.18);
		}
		ctx.restore();
	}

	paintTree(ctx: Ctx, x: number, y: number) {
		const T = this.T;
		const cx = (x + 0.5 + (this.r(x, y, 1000) - 0.5) * 0.25) * T, cy = (y + 0.5 + (this.r(x, y, 1001) - 0.5) * 0.25) * T;
		const style = this.th.trees;
		const pick = this.r(x, y, 1002);
		const kind = style === "mixed" ? (pick < 0.3 ? "pine" : "broad") : style === "pine" ? "pine" : style === "swamp" ? (pick < 0.3 ? "dead" : "willow") : "broad";
		const R = T * (0.55 + this.r(x, y, 1003) * 0.25);
		if (kind === "pine") {
			const layers = 3;
			for (let l = 0; l < layers; l++) {
				const rr = R * (1 - l * 0.28);
				const col = shade("#2f4f2f", -0.15 + l * 0.12 + (pick - 0.5) * 0.1);
				ctx.fillStyle = shade("#14231a", 0);
				star(ctx, cx, cy, rr + 1.5, rr * 0.55, 9, pick * 6 + l);
				ctx.fill();
				ctx.fillStyle = col;
				star(ctx, cx, cy, rr, rr * 0.55, 9, pick * 6 + l);
				ctx.fill();
			}
			ctx.fillStyle = "rgba(220,255,200,0.12)";
			ctx.beginPath(); ctx.arc(cx - R * 0.15, cy - R * 0.15, R * 0.18, 0, Math.PI * 2); ctx.fill();
			return;
		}
		if (kind === "dead") {
			ctx.strokeStyle = "#3b3226";
			ctx.lineCap = "round";
			for (let k = 0; k < 6; k++) {
				const a = this.r(x, y, 1010 + k) * Math.PI * 2;
				const l = R * (0.6 + this.r(x, y, 1020 + k) * 0.5);
				ctx.lineWidth = T * 0.07;
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				const mx = cx + Math.cos(a) * l * 0.5, my = cy + Math.sin(a) * l * 0.5;
				ctx.lineTo(mx, my);
				ctx.lineTo(cx + Math.cos(a + 0.3) * l, cy + Math.sin(a + 0.3) * l);
				ctx.stroke();
				ctx.lineWidth = T * 0.035;
				ctx.beginPath();
				ctx.moveTo(mx, my);
				ctx.lineTo(mx + Math.cos(a - 0.7) * l * 0.4, my + Math.sin(a - 0.7) * l * 0.4);
				ctx.stroke();
			}
			ctx.fillStyle = "#4a3e2e";
			ctx.beginPath(); ctx.arc(cx, cy, T * 0.12, 0, Math.PI * 2); ctx.fill();
			return;
		}
		const leaf = kind === "willow" ? "#4d5e2c" : ["#3f6b2a", "#4a7a30", "#365f27", "#56813a"][Math.floor(pick * 4)];
		const blobs = 7;
		const pts: [number, number, number][] = [];
		for (let k = 0; k < blobs; k++) {
			const a = (k / blobs) * Math.PI * 2 + pick * 3;
			const d = R * 0.45;
			pts.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * (0.45 + this.r(x, y, 1030 + k) * 0.18)]);
		}
		pts.push([cx, cy, R * 0.6]);
		ctx.fillStyle = "#16220f";
		for (const [bx, by, br] of pts) { ctx.beginPath(); ctx.arc(bx, by, br + T * 0.035, 0, Math.PI * 2); ctx.fill(); }
		ctx.fillStyle = shade(leaf, -0.2);
		for (const [bx, by, br] of pts) { ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill(); }
		ctx.fillStyle = leaf;
		for (const [bx, by, br] of pts) { ctx.beginPath(); ctx.arc(bx - br * 0.15, by - br * 0.18, br * 0.75, 0, Math.PI * 2); ctx.fill(); }
		ctx.fillStyle = shade(leaf, 0.22);
		for (const [bx, by, br] of pts.slice(0, 4)) { ctx.beginPath(); ctx.arc(bx - br * 0.3, by - br * 0.35, br * 0.35, 0, Math.PI * 2); ctx.fill(); }
		// leaf speckle
		ctx.fillStyle = shade(leaf, -0.35, 0.6);
		for (let k = 0; k < 10; k++) {
			const a = this.r(x, y, 1040 + k) * Math.PI * 2, d = this.r(x, y, 1050 + k) * R * 0.9;
			ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, T * 0.03, 0, Math.PI * 2); ctx.fill();
		}
		if (kind === "willow") {
			ctx.strokeStyle = "rgba(90,110,50,0.7)";
			ctx.lineWidth = 1;
			for (let k = 0; k < 14; k++) {
				const a = (k / 14) * Math.PI * 2;
				ctx.beginPath();
				ctx.moveTo(cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5);
				ctx.lineTo(cx + Math.cos(a) * R * 1.05, cy + Math.sin(a) * R * 1.05 + T * 0.05);
				ctx.stroke();
			}
		}
	}

	paintTone(ctx: Ctx, xa: number, xb: number, ya: number, yb: number) {
		// large soft light/dark patches unify the texture
		const T = this.T;
		for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
			const n = fbm(this.n2, x / 11, y / 11, 2);
			if (Math.abs(n) < 0.1) continue;
			ctx.fillStyle = n > 0 ? `rgba(255,240,210,${Math.min(0.06, (n - 0.1) * 0.15)})` : `rgba(0,0,0,${Math.min(0.12, (-n - 0.1) * 0.3)})`;
			ctx.fillRect(x * T, y * T, T, T);
		}
	}
}

// ─── shape helpers ───────────────────────────────────────────────────────

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	const rr = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.beginPath();
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}

/** Irregular polygon (boulders, pebbles). */
export function poly(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, seed: number) {
	ctx.beginPath();
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2 + seed * 2;
		const rr = r * (0.82 + 0.18 * Math.sin(seed * 97 + i * 2.3));
		const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
}

export function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r1: number, r2: number, n: number, rot: number) {
	ctx.beginPath();
	for (let i = 0; i < n * 2; i++) {
		const a = (i / (n * 2)) * Math.PI * 2 + rot;
		const r = i % 2 ? r2 : r1;
		const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
}

export { hexToRgb, rgb };
