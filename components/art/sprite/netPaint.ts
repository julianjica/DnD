/**
 * Canvas painting of the net (GridMap.theme === "net"), 16 px per square:
 * a dark field with a glowing grid, corridors as data lines, nodes as glowing
 * structures by kind (open/closed visible), gates, ICE and wireframe avatars.
 * Used by the pixel scene panel and the battle map (via ./pixelScene).
 */
import type { GridMap, MapEntity, NetRun } from "@/lib/game/types";
import { EDGE, ICE_SPRITES, NODE_SPRITES, avatarizePixels, derezPixels, iceKindOf, isSysadmin, netCells, netNodeStates, netPalette, nodeSpriteKey, type NetCell, type NetNodeState, type NetPalette, type NetSprite, type NetStyleId } from "./net";

const C = 16;

export interface NetOpts {
	/** The run in progress: its nodes' open state wins over the map. */
	run?: Pick<NetRun, "netMapId" | "nodes">;
	/** Style override (the /dev/net preview); default NET_STYLE. */
	style?: NetStyleId;
}

function rnd(x: number, y: number, k = 0): number {
	let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgba(c: string, a: number): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(c);
	if (!m) return c;
	const n = parseInt(m[1], 16);
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Draws a net sprite; `halo` adds a 1-px glow ring around its solid pixels. */
export function drawNetSprite(ctx: CanvasRenderingContext2D, sp: NetSprite, X: number, Y: number, pal: Record<string, string>, halo?: string) {
	const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && !!pal[sp.rows[y][x]] && sp.rows[y][x] !== "n";
	if (halo) {
		ctx.fillStyle = halo;
		for (let y = -1; y <= 16; y++)
			for (let x = -1; x <= 16; x++)
				if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) ctx.fillRect(X + x, Y + y, 1, 1);
	}
	for (let y = 0; y < 16; y++)
		for (let x = 0; x < 16; x++) {
			const c = pal[sp.rows[y][x]];
			if (!c) continue;
			ctx.fillStyle = c;
			ctx.fillRect(X + x, Y + y, 1, 1);
		}
}

/** Colours of a node's sprite by kind and state. */
export function nodeColors(P: NetPalette, kind: keyof NetPalette["node"] | "honeypot", open: boolean): { M: string; m: string; H: string; b: string } {
	if (kind === "honeypot") {
		// looks like data until sprung
		if (open) return { M: P.danger[0], m: P.danger[1], H: P.danger[0], b: P.nodeFloor };
		kind = "data";
	}
	const [main, dim] = P.node[kind];
	if (kind === "firewall") return open ? { M: dim, m: P.nodeFloor, H: main, b: P.nodeFloor } : { M: main, m: dim, H: P.packet, b: P.nodeFloor };
	if (kind === "entry") return { M: main, m: dim, H: open ? P.mine[0] : main, b: P.nodeFloor };
	return { M: main, m: dim, H: open ? P.mine[0] : P.packet, b: P.nodeFloor };
}

class NetPainter {
	P: NetPalette;
	states: Record<string, NetNodeState>;
	cells: NetCell[];
	constructor(public map: GridMap, public ctx: CanvasRenderingContext2D, opts: NetOpts) {
		this.P = netPalette(opts.style);
		this.states = netNodeStates(map, opts.run);
		this.cells = netCells(map, this.states);
	}
	cell(x: number, y: number): NetCell {
		if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return { role: "void" };
		return this.cells[y * this.map.width + x];
	}
	px(x: number, y: number, w: number, h: number, c: string) {
		this.ctx.fillStyle = c;
		this.ctx.fillRect(x, y, w, h);
	}
	field(x: number, y: number, base: string) {
		const X = x * C, Y = y * C, P = this.P;
		this.px(X, Y, C, C, base);
		this.px(X, Y, C, 1, y % 4 === 0 ? P.gridMajor : P.grid);
		this.px(X, Y, 1, C, x % 4 === 0 ? P.gridMajor : P.grid);
		if (x % 4 === 0 && y % 4 === 0) {
			this.px(X - 1, Y, 3, 1, P.dust);
			this.px(X, Y - 1, 1, 3, P.dust);
		}
	}
	tile(x: number, y: number) {
		const c = this.cell(x, y);
		const X = x * C, Y = y * C, P = this.P;
		switch (c.role) {
			case "void": {
				this.field(x, y, P.bg);
				for (let k = 0; k < 3; k++) if (rnd(x, y, 40 + k) < 0.18) this.px(X + 2 + Math.floor(rnd(x, y, 50 + k) * 12), Y + 2 + Math.floor(rnd(x, y, 60 + k) * 12), 1, 1, P.dust);
				return;
			}
			case "lane": {
				this.field(x, y, P.lane);
				this.trace(x, y, (d) => this.cell(x + d[0], y + d[1]).role !== "void");
				return;
			}
			case "gate": {
				this.field(x, y, P.lane);
				// the line runs through the gate along the passage
				this.trace(x, y, ([dx]) => (c.vertical ? dx !== 0 : dx === 0));
				const color = c.firewall ? P.node.firewall : P.danger;
				const posts = c.open ? P.mine[1] : color[1];
				if (c.vertical) {
					this.px(X + 5, Y, 6, 3, posts);
					this.px(X + 5, Y + 13, 6, 3, posts);
					if (!c.open) for (const bx of [5, 7, 8, 10]) this.px(X + bx, Y + 3, 1, 10, bx === 7 || bx === 8 ? P.packet : color[0]);
					else {
						this.px(X + 7, Y + 3, 2, 1, P.mine[0]);
						this.px(X + 7, Y + 12, 2, 1, P.mine[0]);
					}
				} else {
					this.px(X, Y + 5, 3, 6, posts);
					this.px(X + 13, Y + 5, 3, 6, posts);
					if (!c.open) for (const by of [5, 7, 8, 10]) this.px(X + 3, Y + by, 10, 1, by === 7 || by === 8 ? P.packet : color[0]);
					else {
						this.px(X + 3, Y + 7, 1, 2, P.mine[0]);
						this.px(X + 12, Y + 7, 1, 2, P.mine[0]);
					}
				}
				return;
			}
			case "node": {
				const col = nodeColors(P, c.kind, c.open);
				this.px(X, Y, C, C, P.nodeFloor);
				for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) this.px(X + i * 4 + 2, Y + j * 4 + 2, 1, 1, col.m);
				const closedWall = c.kind === "firewall" && !c.open;
				const line = col.M;
				const thick = closedWall ? 2 : 1;
				// border, with a socket where a line comes in
				const side = (bit: number, dx: number, dy: number, draw: (a: number, b: number) => void) => {
					if (!(c.edge & bit)) return;
					const n = this.cell(x + dx, y + dy).role;
					if (n === "lane" || n === "gate") {
						draw(0, 5);
						draw(11, 5);
					} else draw(0, 16);
				};
				side(EDGE.N, 0, -1, (a, l) => { this.px(X + a, Y, l, thick, line); this.px(X + a, Y + thick, l, 1, col.m); });
				side(EDGE.S, 0, 1, (a, l) => { this.px(X + a, Y + C - thick, l, thick, line); this.px(X + a, Y + C - thick - 1, l, 1, col.m); });
				side(EDGE.W, -1, 0, (a, l) => { this.px(X, Y + a, thick, l, line); this.px(X + thick, Y + a, 1, l, col.m); });
				side(EDGE.E, 1, 0, (a, l) => { this.px(X + C - thick, Y + a, thick, l, line); this.px(X + C - thick - 1, Y + a, 1, l, col.m); });
				// corner brackets
				const hi = closedWall ? P.packet : col.H === P.packet ? col.M : col.H;
				if ((c.edge & EDGE.N) && (c.edge & EDGE.W)) { this.px(X, Y, 4, 1, hi); this.px(X, Y, 1, 4, hi); }
				if ((c.edge & EDGE.N) && (c.edge & EDGE.E)) { this.px(X + 12, Y, 4, 1, hi); this.px(X + 15, Y, 1, 4, hi); }
				if ((c.edge & EDGE.S) && (c.edge & EDGE.W)) { this.px(X, Y + 15, 4, 1, hi); this.px(X, Y + 12, 1, 4, hi); }
				if ((c.edge & EDGE.S) && (c.edge & EDGE.E)) { this.px(X + 12, Y + 15, 4, 1, hi); this.px(X + 15, Y + 12, 1, 4, hi); }
				// a line arriving at the border continues to the middle of the square
				if (c.edge) this.trace(x, y, ([dx, dy]) => { const r = this.cell(x + dx, y + dy).role; return r === "lane" || r === "gate"; });
				return;
			}
		}
	}
	/** The data line: from the middle of the square toward each linked neighbour, with packets. */
	trace(x: number, y: number, linked: (d: [number, number]) => boolean) {
		const X = x * C, Y = y * C, P = this.P;
		const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
		let any = false;
		for (const d of dirs) {
			if (!linked(d)) continue;
			any = true;
			const [dx, dy] = d;
			if (dx) {
				const x0 = dx > 0 ? X + 7 : X;
				this.px(x0, Y + 7, 9, 2, P.trace);
				for (let i = 0; i < 9; i += 4) this.px(x0 + i + ((x + y) % 2), Y + 7, 1, 1, P.traceHi);
			} else {
				const y0 = dy > 0 ? Y + 7 : Y;
				this.px(X + 7, y0, 2, 9, P.trace);
				for (let i = 0; i < 9; i += 4) this.px(X + 7, y0 + i + ((x + y) % 2), 1, 1, P.traceHi);
			}
		}
		if (!any) return;
		this.px(X + 6, Y + 6, 4, 4, P.trace);
		this.px(X + 7, Y + 7, 2, 2, P.traceHi);
		const out = dirs.filter((dd) => linked(dd));
		if (rnd(x, y, 77) < 0.22) {
			const d = out[Math.floor(rnd(x, y, 78) * out.length)];
			if (d) {
				const t = 2 + Math.floor(rnd(x, y, 79) * 4);
				this.px(X + 7 + d[0] * t, Y + 7 + d[1] * t, 2, 2, P.packet);
			}
		}
	}
	/** Node structures at the middle of each node room, with a soft glow. */
	nodes(glow = true) {
		const P = this.P;
		const ctx = this.ctx;
		for (const r of this.map.rooms) {
			const st = this.states[r.id];
			if (!st) continue;
			const X = Math.round((r.x + r.w / 2) * C - 8), Y = Math.round((r.y + r.h / 2) * C - 8);
			const col = nodeColors(P, st.kind, st.open);
			if (glow) {
				const g = ctx.createRadialGradient(X + 8, Y + 8, 0, X + 8, Y + 8, 22);
				g.addColorStop(0, rgba(col.M, st.open && st.kind !== "honeypot" ? 0.18 : 0.3));
				g.addColorStop(1, rgba(col.M, 0));
				ctx.fillStyle = g;
				ctx.fillRect(X - 14, Y - 14, 44, 44);
			}
			drawNetSprite(ctx, NODE_SPRITES[nodeSpriteKey(st.kind, st.open)], X, Y, col, rgba(col.m, 0.9));
		}
	}
	scanlines(x0: number, y0: number, w: number, h: number) {
		if (!this.P.scan) return;
		this.ctx.fillStyle = `rgba(0,0,0,${this.P.scan})`;
		for (let y = y0 * C; y < (y0 + h) * C; y += 2) this.ctx.fillRect(x0 * C, y + 1, w * C, 1);
	}
}

/** Ground, gates and node structures of a rectangle of squares of a net map (no entities), 16 px per square. Overrun squares draw as empty net. */
export function paintNetTiles(ctx: CanvasRenderingContext2D, map: GridMap, x0: number, y0: number, w: number, h: number, opts: NetOpts = {}) {
	const p = new NetPainter(map, ctx, opts);
	for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) p.tile(x, y);
	p.nodes();
	p.scanlines(x0, y0, w, h);
}

/** Background colour of a net style (fills behind the map). */
export function netBackground(style?: NetStyleId): string {
	return netPalette(style).bg;
}

function toCanvas(data: Uint8ClampedArray): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = c.height = 16;
	const ctx = c.getContext("2d")!;
	const img = ctx.createImageData(16, 16);
	img.data.set(data);
	ctx.putImageData(img, 0, 0);
	return c;
}

/**
 * A creature on a net map, 16×16: ICE by colour, the sysadmin, and people as
 * wireframe avatars of their street sprite (`person` paints that sprite).
 * Dead ones are derezzed.
 */
export function netCreatureCanvas(e: Pick<MapEntity, "kind" | "sprite">, dead: boolean, person: () => HTMLCanvasElement, style?: NetStyleId): HTMLCanvasElement {
	const P = netPalette(style);
	const ice = iceKindOf(e.sprite);
	let c: HTMLCanvasElement;
	if (ice && !isSysadmin(e.sprite)) {
		c = document.createElement("canvas");
		c.width = c.height = 16;
		const [W, w, h] = P.ice[ice.slice(4) as "white" | "grey" | "black"];
		drawNetSprite(c.getContext("2d")!, ICE_SPRITES[ice], 0, 0, { W, w, h, K: ice === "ice_white" ? h : P.bg, E: P.eye, T: P.packet, Y: P.packet, n: "rgba(0,0,0,0.4)" }, rgba(h, 0.85));
	} else {
		const who = isSysadmin(e.sprite) ? P.sysadmin : e.kind === "pc" ? P.mine : e.kind === "monster" ? P.ice.grey.slice(0, 2) as [string, string] : P.other;
		const src = person().getContext("2d")!.getImageData(0, 0, 16, 16).data;
		c = toCanvas(avatarizePixels(src, who[0], who[1]));
		const ctx = c.getContext("2d")!;
		// a projector pad under the feet
		ctx.fillStyle = rgba(who[0], 0.55);
		ctx.fillRect(4, 15, 8, 1);
		ctx.fillStyle = rgba(who[0], 0.25);
		ctx.fillRect(3, 14, 1, 1);
		ctx.fillRect(12, 14, 1, 1);
		if (isSysadmin(e.sprite)) {
			// root: a three-point crown of light over the head
			ctx.fillStyle = who[0];
			for (const x of [5, 7, 8, 10]) ctx.fillRect(x, 0, 1, 1);
		}
	}
	if (!dead) return c;
	return toCanvas(derezPixels(c.getContext("2d")!.getImageData(0, 0, 16, 16).data));
}
