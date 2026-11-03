/**
 * PREVIEW ONLY. Two Dwarf-Fortress-like renderers over the same cell layout:
 * "glyph" (classic text symbols on coloured cells) and "pixel" (16px sprites).
 */
import { GRID_H, GRID_W, type Layout, type Person } from "./layouts";

export const CELL = 16;

// ─── shared helpers ──────────────────────────────────────────────────────

function rnd(x: number, y: number, k = 0): number {
	let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const at = (L: Layout, x: number, y: number) => (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H ? "" : L.rows[y][x]);
const isPerson = (L: Layout, c: string) => c in L.people;

/** What's underneath a person/marker: the most common neighbouring ground. */
function groundUnder(L: Layout, x: number, y: number): string {
	const count: Record<string, number> = {};
	for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) {
		const c = at(L, x + dx, y + dy);
		if (!c || isPerson(L, c) || "fWt#I".includes(c)) continue;
		const g = "=:.,i_".includes(c) ? c : c === "+" ? "=" : null;
		if (g) count[g] = (count[g] ?? 0) + 1;
	}
	return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ".";
}

interface Light { x: number; y: number; r: number; color: string; a: number }

function lights(L: Layout): Light[] {
	const out: Light[] = [];
	for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
		const c = L.rows[y][x];
		if (c === "F") out.push({ x: x + 0.5, y: y + 0.5, r: 5, color: "255,150,60", a: 0.18 });
		if (c === "t") out.push({ x: x + 0.5, y: y + 0.8, r: 3.5, color: "255,170,80", a: 0.35 });
		if (c === "R") out.push({ x: x + 0.5, y: y + 0.5, r: 1.6, color: "120,210,255", a: 0.35 });
	}
	return out;
}

/** Time-of-day grade, firelight, falling snow. Draws over whatever the renderer painted. */
function atmosphere(ctx: CanvasRenderingContext2D, L: Layout, s: number) {
	const W = GRID_W * CELL * s, H = GRID_H * CELL * s;
	const tint = { dawn: "rgba(70,80,140,0.28)", day: "rgba(0,0,0,0)", dusk: "rgba(150,70,60,0.25)", night: "rgba(10,20,60,0.55)" }[L.time];
	ctx.save();
	ctx.globalCompositeOperation = "multiply";
	ctx.fillStyle = tint;
	ctx.fillRect(0, 0, W, H);
	if (L.time === "dawn") {
		const g = ctx.createLinearGradient(0, 0, 0, H);
		g.addColorStop(0, "rgba(255,190,190,0.0)");
		g.addColorStop(1, "rgba(120,130,190,0.25)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, W, H);
	}
	ctx.globalCompositeOperation = "screen";
	for (const l of lights(L)) {
		const px = l.x * CELL * s, py = l.y * CELL * s, r = l.r * CELL * s;
		const g = ctx.createRadialGradient(px, py, 0, px, py, r);
		g.addColorStop(0, `rgba(${l.color},${l.a})`);
		g.addColorStop(1, `rgba(${l.color},0)`);
		ctx.fillStyle = g;
		ctx.fillRect(px - r, py - r, r * 2, r * 2);
	}
	ctx.restore();
	if (L.snow) {
		ctx.fillStyle = "rgba(255,255,255,0.85)";
		for (let i = 0; i < 260; i++) {
			const x = rnd(i, 1, 7) * W, y = rnd(i, 2, 7) * H;
			const z = (rnd(i, 3, 7) < 0.3 ? 2 : 1) * s;
			ctx.fillRect(Math.round(x / s) * s, Math.round(y / s) * s, z, z);
		}
	}
}

// ─── glyph renderer ──────────────────────────────────────────────────────

const G_SNOW_BG = "#cfd8e0";

interface GCell { ch: string; fg: string; bg: string }

function wallGlyph(L: Layout, x: number, y: number): string {
	const w = (c: string) => "Wt+".includes(c) && c !== "";
	const n = w(at(L, x, y - 1)), s = w(at(L, x, y + 1)), e = w(at(L, x + 1, y)), o = w(at(L, x - 1, y));
	const key = `${n ? 1 : 0}${s ? 1 : 0}${e ? 1 : 0}${o ? 1 : 0}`;
	return ({ "0011": "═", "0010": "═", "0001": "═", "1100": "║", "1000": "║", "0100": "║", "0110": "╔", "0101": "╗", "1010": "╚", "1001": "╝", "1111": "╬", "0111": "╦", "1011": "╩", "1110": "╠", "1101": "╣" } as Record<string, string>)[key] ?? "■";
}

function glyphCell(L: Layout, x: number, y: number, c: string): GCell {
	const r = rnd(x, y);
	const pick = (s: string) => s[Math.floor(r * s.length)];
	switch (c) {
		case ".": return { ch: pick("  .,`'  "), fg: "#9aa7b4", bg: G_SNOW_BG };
		case ",": return { ch: pick("\"\"'"), fg: "#7e8f73", bg: G_SNOW_BG };
		case "^": return { ch: r < 0.5 ? "♠" : "↑", fg: r < 0.5 ? "#1f5a44" : "#2b6b4f", bg: G_SNOW_BG };
		case "o": return { ch: "●", fg: "#5e6168", bg: G_SNOW_BG };
		case "#": return { ch: pick("▓▓▒"), fg: "#7b7f88", bg: "#3a3c42" };
		case "W": return { ch: wallGlyph(L, x, y), fg: "#c79a62", bg: "#3b2716" };
		case "t": return { ch: "¡", fg: "#ffb347", bg: "#3b2716" };
		case "=": return { ch: pick("+ ·"), fg: "#7d5a3a", bg: "#4a3020" };
		case "+": return { ch: "◘", fg: "#d8a66a", bg: "#4a3020" };
		case "F": return { ch: pick("☼*☼"), fg: r < 0.5 ? "#ffcf5a" : "#ff7a2a", bg: "#5a1e0c" };
		case "k": return { ch: "■", fg: "#75706a", bg: "#4a3020" };
		case "T": return { ch: "╥", fg: "#d0a06a", bg: "#4a3020" };
		case "h": return { ch: "▬", fg: "#a87a4a", bg: "#4a3020" };
		case "R": return { ch: "Ω", fg: "#8fe0ff", bg: "#4a3020" };
		case "B": return { ch: "0", fg: "#c08a4a", bg: "#4a3020" };
		case "~": return { ch: pick("≈~≈"), fg: "#4f86a8", bg: "#102536" };
		case "i": return { ch: pick(" ·  -"), fg: "#e2f0f6", bg: "#9cc0d2" };
		case "I": return { ch: pick("%÷/\\"), fg: "#eef8fc", bg: "#7fa7bd" };
		case ":": return { ch: pick("·.,` "), fg: "#6d7078", bg: "#2a2b30" };
		case "A": return { ch: "▲", fg: "#9a9ca3", bg: "#2a2b30" };
		case "d": return { ch: "≈", fg: "#7fb8d6", bg: "#1f3442" };
		case "b": return { ch: "≡", fg: "#a8784a", bg: G_SNOW_BG };
		case "_": return { ch: pick("·,.:"), fg: "#6f6a5e", bg: "#a39d8e" };
		case "f": return { ch: pick("¨¨."), fg: "#8794a2", bg: G_SNOW_BG };
		default: return { ch: "?", fg: "#f0f", bg: "#000" };
	}
}

export function renderGlyph(canvas: HTMLCanvasElement, L: Layout, s = 2) {
	canvas.width = GRID_W * CELL * s;
	canvas.height = GRID_H * CELL * s;
	const ctx = canvas.getContext("2d")!;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = `bold ${CELL * s * 0.9}px Menlo, "DejaVu Sans Mono", monospace`;
	for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
		const c = L.rows[y][x];
		let cell: GCell;
		if (isPerson(L, c)) {
			const p = L.people[c];
			const bg = glyphCell(L, x, y, groundUnder(L, x, y)).bg;
			cell = { ch: c === "@" ? "☻" : "☺", fg: c === "@" ? "#fff3b0" : p.hair, bg };
		} else if (c === "f") cell = { ...glyphCell(L, x, y, c), bg: glyphCell(L, x, y, groundUnder(L, x, y)).bg };
		else cell = glyphCell(L, x, y, c);
		ctx.fillStyle = cell.bg;
		ctx.fillRect(x * CELL * s, y * CELL * s, CELL * s, CELL * s);
		if (cell.ch.trim()) {
			ctx.fillStyle = cell.fg;
			ctx.fillText(cell.ch, (x + 0.5) * CELL * s, (y + 0.55) * CELL * s);
		}
	}
	atmosphere(ctx, L, s);
}

// ─── pixel renderer ──────────────────────────────────────────────────────

type Pal = Record<string, string>;

/** 16×16 sprites; "." is transparent. */
const SPR: Record<string, { rows: string[]; pal: Pal }> = {
	pine: {
		pal: { G: "#1f4a3a", g: "#2f6650", w: "#e8eef4", T: "#4a2f1c", n: "#a9b6c4" },
		rows: [
			".......w........",
			"......wGw.......",
			".....GgGGw......",
			"......GGG.......",
			".....wGgGww.....",
			"....GgGGGgGw....",
			".....GGGGGG.....",
			"...wGGgGGGgGw...",
			"...GgGGGGGGGGw..",
			"....GGGGgGGGG...",
			"..wGGgGGGGGgGGw.",
			"..GGGGGGGGGGGGG.",
			"....nnnTTnnn....",
			".......TT.......",
			"................",
			"................",
		],
	},
	boulder: {
		pal: { R: "#6b6e75", r: "#4b4d53", l: "#8d9097", w: "#eef2f6", n: "#a9b6c4" },
		rows: [
			"................",
			"................",
			"................",
			"....wwwwww......",
			"...wwlllllww....",
			"..wlRRRRRRRRr...",
			"..lRRRRrRRRRr...",
			".lRRRRRRRRrRRr..",
			".RRrRRRRRRRRRr..",
			".RRRRRRRRRRRrr..",
			"..rRRRRRRRRrr...",
			"...rrrrrrrrr....",
			"....nnnnnnnnn...",
			"................",
			"................",
			"................",
		],
	},
	flame: {
		pal: { y: "#ffe27a", o: "#ff9a2a", O: "#e8561c", R: "#a8240e" },
		rows: [
			"................",
			"................",
			"......y.........",
			".....yo.....y...",
			".....oO....yo...",
			"....yOOo...oO...",
			"...yoORO..yOOo..",
			"...oORRO.yoRRo..",
			"..yORRROyoORROy.",
			"..oORRRROOORRRo.",
			"..OORRRRRRRRROO.",
			"...ORRRRRRRRRO..",
			"................",
			"................",
			"................",
			"................",
		],
	},
	runestone: {
		pal: { S: "#7d8088", s: "#5d6067", b: "#8fe0ff", n: "#2f2016" },
		rows: [
			"................",
			"......SSSS......",
			".....SSSSSS.....",
			".....SsSSsS.....",
			"....SSSbSSSS....",
			"....SSbSbSSS....",
			"....SSSbSSSS....",
			"....SSSbSSsS....",
			"....SsSbSSSS....",
			"....SSbSbSSS....",
			"....SSSSSSSS....",
			"....SSSsSSSS....",
			"...SSSSSSSSSS...",
			"..nnnnnnnnnnnn..",
			"................",
			"................",
		],
	},
	torch: {
		pal: { y: "#ffe27a", o: "#ff9a2a", O: "#e8561c", b: "#6b4422", k: "#2a2a2a" },
		rows: [
			"................",
			".......y........",
			"......yoy.......",
			"......oOo.......",
			".......O........",
			"......kbk.......",
			".......b........",
			".......b........",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
			"................",
		],
	},
	barrel: {
		pal: { B: "#8a5a2e", b: "#6a4220", i: "#3a3a3e", k: "#5a3a1a", n: "#2f2016" },
		rows: [
			"................",
			"................",
			".....kkkkkk.....",
			"....kBBBBBBk....",
			"....BbBBBBbB....",
			"....iiiiiiii....",
			"....BBBBBBBB....",
			"....BbBBBBbB....",
			"....BBBBBBBB....",
			"....iiiiiiii....",
			"....BbBBBBbB....",
			".....BBBBBB.....",
			"......nnnn......",
			"................",
			"................",
			"................",
		],
	},
	stalagmite: {
		pal: { L: "#8a8c93", l: "#5d5f66", n: "#1c1d21" },
		rows: [
			"................",
			"................",
			".......L........",
			".......Ll.......",
			"......LLl.......",
			"......LLl.......",
			".....LLLLl......",
			".....LLLLl......",
			"....LLLLLLl.....",
			"....LLLLLLl.....",
			"...LLLLLLLLl....",
			"...LLLLLLLLl....",
			"..nnnnnnnnnnn...",
			"................",
			"................",
			"................",
		],
	},
	boat: {
		pal: { P: "#8a5a2e", p: "#5e3a1c", d: "#3f2812", w: "#eef2f6" },
		rows: [
			"................",
			"................",
			"................",
			"................",
			"..wwwwwwwwwww...",
			".pPPPPPPPPPPPp..",
			"pPddddPddddPPPp.",
			"pPddddPddddPPPPp",
			"pPddddPddddPPPp.",
			".pPPPPPPPPPPPp..",
			"..ppppppppppp...",
			"................",
			"................",
			"................",
			"................",
			"................",
		],
	},
	person: {
		pal: { k: "#1a1410", S: "#e4b48c", s: "#c08d68", B: "#2b1d14", n: "rgba(0,0,0,0.25)" },
		rows: [
			"................",
			"......HHHH......",
			".....HHHHHH.....",
			".....HSSSSH.....",
			".....HSkSkH.....",
			"......SSSS......",
			"....CCCCCCCC....",
			"...CCCCCCCCCC...",
			"...SCCcCCcCCS...",
			"...SCCCCCCCCS...",
			"....CCCCCCCC....",
			"....cccccccc....",
			".....cc..cc.....",
			".....cc..cc.....",
			"....nBBnnBBn....",
			"................",
		],
	},
};

function hex(c: string): [number, number, number] {
	const n = parseInt(c.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function darken(c: string, f: number): string {
	const [r, g, b] = hex(c);
	return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

function drawSprite(ctx: CanvasRenderingContext2D, name: string, ox: number, oy: number, extra: Pal = {}) {
	const sp = SPR[name];
	const pal = { ...sp.pal, ...extra };
	for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
		const k = sp.rows[y][x];
		if (k === ".") continue;
		const col = pal[k];
		if (!col) continue;
		ctx.fillStyle = col;
		ctx.fillRect(ox + x, oy + y, 1, 1);
	}
}

/** Fills a 16×16 cell with a base colour and seeded speckles. */
function speckle(ctx: CanvasRenderingContext2D, x: number, y: number, base: string, dots: [string, number][], salt = 0) {
	ctx.fillStyle = base;
	ctx.fillRect(x * 16, y * 16, 16, 16);
	for (let i = 0; i < 256; i++) {
		const r = rnd(x * 16 + (i & 15), y * 16 + (i >> 4), salt);
		let acc = 0;
		for (const [c, p] of dots) {
			acc += p;
			if (r < acc) {
				ctx.fillStyle = c;
				ctx.fillRect(x * 16 + (i & 15), y * 16 + (i >> 4), 1, 1);
				break;
			}
		}
	}
}

function ground(ctx: CanvasRenderingContext2D, L: Layout, x: number, y: number, c: string) {
	const X = x * 16, Y = y * 16;
	switch (c) {
		case ".": case ",": case "f": case "^": case "o": case "b":
			speckle(ctx, x, y, "#dde5ec", [["#c8d2dd", 0.08], ["#f5f8fb", 0.06]]);
			if (c === ",") for (const [dx, dy] of [[4, 9], [5, 8], [6, 9], [10, 5], [11, 4], [12, 5]]) { ctx.fillStyle = "#7e8f73"; ctx.fillRect(X + dx, Y + dy, 1, 1); }
			if (c === "f") { ctx.fillStyle = "#aab6c4"; const o = (x + y) % 2 ? 0 : 3; ctx.fillRect(X + 4 + o, Y + 3, 2, 3); ctx.fillRect(X + 9 - o, Y + 10, 2, 3); }
			return;
		case "=": case "+": case "T": case "h": case "R": case "B": case "k": {
			ctx.fillStyle = "#6b4a2e";
			ctx.fillRect(X, Y, 16, 16);
			ctx.fillStyle = "#553a22";
			for (let r = 0; r < 4; r++) {
				ctx.fillRect(X, Y + r * 4 + 3, 16, 1);
				const seam = Math.floor(rnd(x, y * 4 + r, 3) * 14) + 1;
				ctx.fillRect(X + seam, Y + r * 4, 1, 3);
			}
			ctx.fillStyle = "#7a5636";
			for (let r = 0; r < 4; r++) ctx.fillRect(X + ((x * 5 + r * 7) % 12), Y + r * 4 + 1, 3, 1);
			if (c === "k") {
				speckle(ctx, x, y, "#6e6a64", [["#57534e", 0.18], ["#86817a", 0.1]], 5);
				ctx.fillStyle = "#3e3a36";
				ctx.fillRect(X, Y + 15, 16, 1); ctx.fillRect(X + 15, Y, 1, 16);
			}
			if (c === "+") { ctx.fillStyle = "#3a2614"; ctx.fillRect(X + 1, Y, 3, 14); ctx.fillStyle = "#8a6038"; ctx.fillRect(X + 2, Y + 1, 1, 12); }
			return;
		}
		case "F": {
			speckle(ctx, x, y, "#3a160a", [["#ff7a2a", 0.12], ["#ffcf5a", 0.04], ["#1e0a04", 0.1]], 9);
			return;
		}
		case "W": case "t": {
			ctx.fillStyle = "#4a2f18";
			ctx.fillRect(X, Y, 16, 16);
			for (let r = 0; r < 4; r++) {
				ctx.fillStyle = "#7a5233"; ctx.fillRect(X, Y + r * 4, 16, 3);
				ctx.fillStyle = "#93683f"; ctx.fillRect(X, Y + r * 4, 16, 1);
				ctx.fillStyle = "#2e1c0d"; ctx.fillRect(X, Y + r * 4 + 3, 16, 1);
			}
			if (L.snow && ".,^o_f".includes(at(L, x, y - 1) || "_")) { ctx.fillStyle = "#eef3f7"; ctx.fillRect(X, Y, 16, 3); ctx.fillStyle = "#c9d3dd"; ctx.fillRect(X, Y + 3, 16, 1); }
			return;
		}
		case "#": {
			speckle(ctx, x, y, "#5d5f66", [["#4a4c52", 0.2], ["#71747b", 0.12]], 2);
			const open = (c2: string) => c2 !== "#" && c2 !== "";
			if (open(at(L, x, y + 1))) { ctx.fillStyle = "#3a3b40"; ctx.fillRect(X, Y + 12, 16, 4); ctx.fillStyle = "#2a2b2f"; ctx.fillRect(X, Y + 15, 16, 1); }
			if (open(at(L, x, y - 1))) {
				const snowy = L.snow && ".,^o_f".includes(at(L, x, y - 1));
				ctx.fillStyle = snowy ? "#eef3f7" : "#7d8088"; ctx.fillRect(X, Y, 16, 2);
			}
			if (open(at(L, x - 1, y))) { ctx.fillStyle = "#71747b"; ctx.fillRect(X, Y, 1, 16); }
			if (open(at(L, x + 1, y))) { ctx.fillStyle = "#3a3b40"; ctx.fillRect(X + 15, Y, 1, 16); }
			return;
		}
		case ":": case "A": case "d":
			speckle(ctx, x, y, "#34363b", [["#2a2b2f", 0.15], ["#43454b", 0.1]], 4);
			if (c === "d") {
				ctx.fillStyle = "#2c4d60"; ctx.fillRect(X + 3, Y + 5, 10, 7); ctx.fillRect(X + 2, Y + 6, 12, 5);
				ctx.fillStyle = "#6fa6c2"; ctx.fillRect(X + 5, Y + 7, 3, 1); ctx.fillRect(X + 9, Y + 9, 2, 1);
			}
			return;
		case "~": {
			ctx.fillStyle = "#11293a"; ctx.fillRect(X, Y, 16, 16);
			ctx.fillStyle = "#24506a";
			for (let r = 0; r < 3; r++) { const o = Math.floor(rnd(x, y, r + 11) * 10); ctx.fillRect(X + o, Y + 3 + r * 5, 4, 1); }
			const ice = (cc: string) => "iI".includes(cc);
			ctx.fillStyle = "#e6f3f9";
			if (ice(at(L, x, y - 1))) for (let i = 0; i < 16; i += 2) ctx.fillRect(X + i, Y, 2, 1 + Math.floor(rnd(x * 16 + i, y, 12) * 3));
			if (ice(at(L, x, y + 1))) for (let i = 0; i < 16; i += 2) { const h = 1 + Math.floor(rnd(x * 16 + i, y, 13) * 3); ctx.fillRect(X + i, Y + 16 - h, 2, h); }
			if (ice(at(L, x - 1, y))) for (let i = 0; i < 16; i += 2) ctx.fillRect(X, Y + i, 1 + Math.floor(rnd(x, y * 16 + i, 14) * 3), 2);
			if (ice(at(L, x + 1, y))) for (let i = 0; i < 16; i += 2) { const w = 1 + Math.floor(rnd(x, y * 16 + i, 15) * 3); ctx.fillRect(X + 16 - w, Y + i, w, 2); }
			return;
		}
		case "i": case "I": {
			speckle(ctx, x, y, "#a9cadb", [["#bcd8e6", 0.12], ["#93b8cb", 0.06]], 6);
			ctx.fillStyle = "#d6eaf3";
			const o = Math.floor(rnd(x, y, 16) * 12);
			ctx.fillRect(X + o, Y + (x % 3) * 5 + 2, 4, 1);
			if (c === "I") {
				ctx.fillStyle = "#5f8aa1";
				let cx = Math.floor(rnd(x, y, 17) * 16), cy = 0;
				while (cy < 16) { ctx.fillRect(X + Math.max(0, Math.min(15, cx)), Y + cy, 1, 1); cy++; cx += rnd(x, y * 31 + cy, 18) < 0.5 ? -1 : 1; }
				ctx.fillStyle = "#eef8fc"; ctx.fillRect(X + 2, Y + 11, 3, 1);
			}
			return;
		}
		case "_":
			speckle(ctx, x, y, "#8e887a", [["#6f6a5e", 0.18], ["#aaa496", 0.12], ["#e6ecf1", 0.1]], 8);
			return;
	}
}

export function renderPixel(canvas: HTMLCanvasElement, L: Layout, s = 2) {
	const off = document.createElement("canvas");
	off.width = GRID_W * 16;
	off.height = GRID_H * 16;
	const o = off.getContext("2d")!;
	// Pass 1: ground.
	for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
		const c = L.rows[y][x];
		ground(o, L, x, y, isPerson(L, c) || (c === "f" && groundUnder(L, x, y) !== ".") ? groundUnder(L, x, y) : c);
		if (c === "f") { o.fillStyle = "#7f93a3"; const k = (x + y) % 2 ? 0 : 3; o.fillRect(x * 16 + 4 + k, y * 16 + 3, 2, 3); o.fillRect(x * 16 + 9 - k, y * 16 + 10, 2, 3); }
	}
	// Pass 2: furniture (tables/benches join up with their neighbours).
	for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
		const c = L.rows[y][x], X = x * 16, Y = y * 16;
		if (c === "T") {
			const l = at(L, x - 1, y) === "T", r = at(L, x + 1, y) === "T";
			o.fillStyle = "#2f2016"; o.fillRect(X + (l ? 0 : 1), Y + 13, 16 - (l ? 0 : 1) - (r ? 0 : 1), 2);
			o.fillStyle = "#9a6c3e"; o.fillRect(X + (l ? 0 : 1), Y + 2, 16 - (l ? 0 : 1) - (r ? 0 : 1), 11);
			o.fillStyle = "#b5824e"; o.fillRect(X + (l ? 0 : 1), Y + 2, 16 - (l ? 0 : 1) - (r ? 0 : 1), 1);
			o.fillStyle = "#7d5530"; o.fillRect(X, Y + 7, 16, 1);
			if (rnd(x, y, 21) < 0.5) { o.fillStyle = "#c9c2b0"; o.fillRect(X + 5, Y + 4, 4, 3); o.fillStyle = "#6b3a1a"; o.fillRect(X + 6, Y + 5, 2, 1); }
		}
		if (c === "h") {
			const l = at(L, x - 1, y) === "h", r = at(L, x + 1, y) === "h";
			o.fillStyle = "#2f2016"; o.fillRect(X + (l ? 0 : 2), Y + 11, 16 - (l ? 0 : 2) - (r ? 0 : 2), 2);
			o.fillStyle = "#8a5f36"; o.fillRect(X + (l ? 0 : 2), Y + 5, 16 - (l ? 0 : 2) - (r ? 0 : 2), 6);
			o.fillStyle = "#a6774a"; o.fillRect(X + (l ? 0 : 2), Y + 5, 16 - (l ? 0 : 2) - (r ? 0 : 2), 1);
		}
	}
	// Pass 3: objects and people.
	for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
		const c = L.rows[y][x], X = x * 16, Y = y * 16;
		const sprite = ({ "^": "pine", o: "boulder", F: "flame", R: "runestone", t: "torch", B: "barrel", A: "stalagmite", b: "boat" } as Record<string, string>)[c];
		if (sprite) drawSprite(o, sprite, X, Y - (c === "^" ? 2 : 0));
		if (isPerson(L, c)) {
			const p: Person = L.people[c];
			drawSprite(o, "person", X, Y - 1, { H: p.hair, C: p.cloth, c: darken(p.cloth, 0.7) });
			if (c === "@") { o.fillStyle = "#fff3b0"; o.fillRect(X + 7, Y - 3, 2, 1); }
		}
	}
	canvas.width = off.width * s;
	canvas.height = off.height * s;
	const ctx = canvas.getContext("2d")!;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
	atmosphere(ctx, L, s);
}

/** Close-up: `w` cells wide (16:9), centred on the player, clamped to the layout. */
export function renderCrop(canvas: HTMLCanvasElement, L: Layout, mode: "glyph" | "pixel", w = 24, s = 3) {
	const full = document.createElement("canvas");
	(mode === "glyph" ? renderGlyph : renderPixel)(full, L, s);
	const h = (w * 9) / 16;
	let px = GRID_W / 2, py = GRID_H / 2, n = 0, sx = 0, sy = 0;
	for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (isPerson(L, L.rows[y][x])) { sx += x; sy += y; n++; }
	if (n) { px = sx / n + 0.5; py = sy / n + 0.5; }
	const x0 = Math.max(0, Math.min(GRID_W - w, px - w / 2)), y0 = Math.max(0, Math.min(GRID_H - h, py - h / 2));
	const u = CELL * s;
	canvas.width = Math.round(w * u);
	canvas.height = Math.round(h * u);
	const ctx = canvas.getContext("2d")!;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(full, Math.round(x0 * u), Math.round(y0 * u), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
}
