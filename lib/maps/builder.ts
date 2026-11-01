import type { MapEntity, MapRoom, Tile } from "../game/types";
import { Rng } from "../rules/dice";
import { isPassable, type Point } from "./grid";

export type Rect = { x: number; y: number; w: number; h: number };

export const center = (r: Rect): Point => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

/** Mutable working grid used by the generators. */
export class Builder {
	tiles: Tile[];
	rooms: MapRoom[] = [];
	entities: MapEntity[] = [];
	entry: Point = { x: 1, y: 1 };
	private n = 0;
	constructor(public w: number, public h: number, public rng: Rng, fillTile: Tile) {
		this.tiles = new Array(w * h).fill(fillTile);
	}
	in(x: number, y: number) {
		return x >= 0 && y >= 0 && x < this.w && y < this.h;
	}
	/** Strictly inside the 1-tile border. */
	inner(x: number, y: number) {
		return x > 0 && y > 0 && x < this.w - 1 && y < this.h - 1;
	}
	get(x: number, y: number): Tile {
		return this.in(x, y) ? this.tiles[y * this.w + x] : "void";
	}
	set(x: number, y: number, t: Tile) {
		if (this.in(x, y)) this.tiles[y * this.w + x] = t;
	}
	fill(r: Rect, t: Tile) {
		for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) this.set(x, y, t);
	}
	/** Fills the rect border with `t` (1 thick). */
	outline(r: Rect, t: Tile) {
		for (let x = r.x; x < r.x + r.w; x++) {
			this.set(x, r.y, t);
			this.set(x, r.y + r.h - 1, t);
		}
		for (let y = r.y; y < r.y + r.h; y++) {
			this.set(r.x, y, t);
			this.set(r.x + r.w - 1, y, t);
		}
	}
	/** Rect plus its mirror across the vertical axis. */
	fillSym(r: Rect, t: Tile) {
		this.fill(r, t);
		this.fill({ ...r, x: this.w - r.x - r.w }, t);
	}
	setSym(x: number, y: number, t: Tile) {
		this.set(x, y, t);
		this.set(this.w - 1 - x, y, t);
	}
	disc(cx: number, cy: number, r: number, t: Tile | ((old: Tile) => Tile), only?: (old: Tile) => boolean) {
		for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
			for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
				if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
				if (!this.in(x, y)) continue;
				const old = this.get(x, y);
				if (only && !only(old)) continue;
				this.set(x, y, typeof t === "function" ? t(old) : t);
			}
	}
	/** L-shaped corridor between two points. */
	corridor(a: Point, b: Point, t: Tile, width = 1, horizontalFirst = this.rng.next() < 0.5, only?: (old: Tile) => boolean) {
		const put = (x: number, y: number) => {
			for (let d = 0; d < width; d++) {
				for (const [px, py] of [[x, y + d], [x + d, y]]) {
					if (!this.inner(px, py)) continue;
					if (only && !only(this.get(px, py))) continue;
					this.set(px, py, t);
				}
			}
		};
		const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
		const line = (p: Point, q: Point) => {
			const dx = Math.sign(q.x - p.x), dy = Math.sign(q.y - p.y);
			let x = p.x, y = p.y;
			put(x, y);
			while (x !== q.x || y !== q.y) {
				x += dx;
				y += dy;
				put(x, y);
			}
		};
		line(a, corner);
		line(corner, b);
	}
	/** Meandering polyline (random walk biased toward the target). */
	path(points: Point[], t: Tile | ((old: Tile) => Tile), width: number | ((f: number) => number), only?: (old: Tile) => boolean) {
		const out: Point[] = [];
		for (let i = 0; i < points.length - 1; i++) {
			const a = points[i], b = points[i + 1];
			const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2;
			for (let s = 0; s <= steps; s++) {
				const f = s / Math.max(1, steps);
				out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
			}
		}
		out.forEach((p, i) => this.disc(p.x, p.y, (typeof width === "function" ? width(i / Math.max(1, out.length - 1)) : width) / 2, t, only));
		return out;
	}
	room(r: Rect, tag?: string): MapRoom {
		const room: MapRoom = { id: `room-${this.rooms.length + 1}`, x: r.x, y: r.y, w: r.w, h: r.h, ...(tag ? { tag } : {}) };
		this.rooms.push(room);
		return room;
	}
	entity(e: Omit<MapEntity, "id" | "size"> & { size?: number; idPrefix?: string }): MapEntity {
		const { idPrefix, ...rest } = e;
		const ent: MapEntity = { size: 1, ...rest, id: `${idPrefix ?? rest.sprite}-${++this.n}` };
		this.entities.push(ent);
		return ent;
	}
	passable(x: number, y: number) {
		return isPassable(this.get(x, y));
	}
	neighbors4(x: number, y: number): Point[] {
		return [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }];
	}
	/** Is a square free of feature entities (so props don't stack)? */
	freeOfEntities(x: number, y: number) {
		return !this.entities.some((e) => e.kind !== "light" && x >= e.x && y >= e.y && x < e.x + e.size && y < e.y + e.size);
	}
}

/** Count 8-neighbours matching pred. */
export function count8(b: Builder, x: number, y: number, pred: (t: Tile) => boolean): number {
	let n = 0;
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && pred(b.get(x + dx, y + dy))) n++;
	return n;
}

/**
 * Guarantees connectivity: every room and every passable region is reachable
 * (4-neighbour moves) from the entry. Unreached regions are joined by the
 * cheapest path through blocking tiles, which are converted via `carve`.
 */
export function ensureConnectivity(b: Builder, carve: (old: Tile) => Tile, avoid: (t: Tile) => number = () => 1) {
	const W = b.w, H = b.h, N = W * H;
	const pass = (i: number) => isPassable(b.tiles[i]);
	const entryI = b.entry.y * W + b.entry.x;
	if (!pass(entryI)) b.tiles[entryI] = carve(b.tiles[entryI]);
	const reached = new Uint8Array(N);
	const flood = (start: number) => {
		const q = [start];
		reached[start] = 1;
		for (let qi = 0; qi < q.length; qi++) {
			const i = q[qi];
			const x = i % W, y = (i / W) | 0;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
				const ni = ny * W + nx;
				if (!reached[ni] && pass(ni)) {
					reached[ni] = 1;
					q.push(ni);
				}
			}
		}
	};
	flood(entryI);
	const connect = (targetCells: number[]) => {
		// Multi-source Dijkstra from the reached set to the nearest target cell.
		const isTarget = new Uint8Array(N);
		for (const t of targetCells) isTarget[t] = 1;
		const dist = new Float64Array(N).fill(Infinity);
		const prev = new Int32Array(N).fill(-1);
		const heap: [number, number][] = [];
		const push = (d: number, i: number) => {
			heap.push([d, i]);
			let c = heap.length - 1;
			while (c > 0) {
				const p = (c - 1) >> 1;
				if (heap[p][0] <= heap[c][0]) break;
				[heap[p], heap[c]] = [heap[c], heap[p]];
				c = p;
			}
		};
		const pop = (): [number, number] => {
			const top = heap[0];
			const last = heap.pop()!;
			if (heap.length) {
				heap[0] = last;
				let c = 0;
				for (;;) {
					const l = 2 * c + 1, r = l + 1;
					let m = c;
					if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
					if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
					if (m === c) break;
					[heap[m], heap[c]] = [heap[c], heap[m]];
					c = m;
				}
			}
			return top;
		};
		for (let i = 0; i < N; i++) if (reached[i]) { dist[i] = 0; push(0, i); }
		let found = -1;
		while (heap.length) {
			const [d, i] = pop();
			if (d > dist[i]) continue;
			if (isTarget[i]) { found = i; break; }
			const x = i % W, y = (i / W) | 0;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
				const ni = ny * W + nx;
				const border = nx === 0 || ny === 0 || nx === W - 1 || ny === H - 1;
				const step = pass(ni) ? 1 : 3 * avoid(b.tiles[ni]) * (border ? 4 : 1);
				if (d + step < dist[ni]) {
					dist[ni] = d + step;
					prev[ni] = i;
					push(dist[ni], ni);
				}
			}
		}
		if (found < 0) return;
		for (let i = found; i >= 0 && !reached[i]; i = prev[i]) {
			if (!pass(i)) b.tiles[i] = carve(b.tiles[i]);
		}
		flood(found);
		// path cells became passable and are adjacent to reached cells; reflood from them
		for (let i = 0; i < N; i++) if (!reached[i] && pass(i)) {
			const x = i % W, y = (i / W) | 0;
			if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H && reached[ny * W + nx]; })) flood(i);
		}
	};
	// Rooms first (their passable cells, or their center if none).
	for (const r of b.rooms) {
		const cells: number[] = [];
		let any = false;
		for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
			if (!b.in(x, y)) continue;
			const i = y * W + x;
			if (reached[i]) any = true;
			if (pass(i)) cells.push(i);
		}
		if (any) continue;
		if (!cells.length) {
			const c = center(r);
			b.set(c.x, c.y, carve(b.get(c.x, c.y)));
			cells.push(c.y * W + c.x);
		}
		connect(cells);
	}
	// Then every remaining passable region.
	for (let guard = 0; guard < 400; guard++) {
		let start = -1;
		for (let i = 0; i < N; i++) if (!reached[i] && pass(i)) { start = i; break; }
		if (start < 0) break;
		// collect region
		const region: number[] = [];
		const seen = new Set<number>([start]);
		const q = [start];
		for (let qi = 0; qi < q.length; qi++) {
			const i = q[qi];
			region.push(i);
			const x = i % W, y = (i / W) | 0;
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
				const ni = ny * W + nx;
				if (!seen.has(ni) && pass(ni)) { seen.add(ni); q.push(ni); }
			}
		}
		connect(region);
		if (!reached[start]) {
			// unreachable (shouldn't happen) — remove the region rather than loop
			for (const i of region) reached[i] = 1;
		}
	}
}
