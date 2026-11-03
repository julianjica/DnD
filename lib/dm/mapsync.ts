import type { GridMap, MapEntity } from "../game/types";
import { hasLineOfSight, isPassableTile, tileAt } from "../rules/combat/grid";

/**
 * Keeps the battle map honest with the story: where the player's token is,
 * which room that is, and whether two tokens can actually reach or see each
 * other (closed doors open as you walk; locked and secret doors don't).
 */

type P = { x: number; y: number };

export function roomOf(map: GridMap, p: P): string | undefined {
	const r = map.rooms.find((r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
	return r ? `${r.id}${r.name ? ` "${r.name}"` : r.tag ? ` (${r.tag})` : ""}` : undefined;
}

export const where = (map: GridMap, e: P) => {
	const r = roomOf(map, e);
	return `(${e.x},${e.y})${r ? ` in ${r}` : ""}`;
};

const BARRIERS = new Set(["door_locked", "secret_door"]);

/** Breadth-first over the tiles; `through` decides which tiles may be crossed. */
function bfs(map: GridMap, from: P, to: P, through: (x: number, y: number) => boolean): P[] | null {
	const W = map.width, H = map.height;
	const prev = new Int32Array(W * H).fill(-1);
	const start = from.y * W + from.x, goal = to.y * W + to.x;
	prev[start] = start;
	const q = [start];
	for (let h = 0; h < q.length; h++) {
		const i = q[h];
		if (i === goal) {
			const out: P[] = [];
			for (let k = goal; k !== start; k = prev[k]) out.push({ x: k % W, y: Math.floor(k / W) });
			return out.reverse();
		}
		const x = i % W, y = Math.floor(i / W);
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const nx = x + dx, ny = y + dy;
			if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
			const j = ny * W + nx;
			if (prev[j] !== -1) continue;
			if (j !== goal && !through(nx, ny)) continue;
			prev[j] = i;
			q.push(j);
		}
	}
	return null;
}

export interface Separation {
	/** Locked/secret doors standing between the two tokens. */
	doors: P[];
	/** No route at all (walls). */
	walled: boolean;
}

/**
 * Why `a` can neither reach nor see `b`, or null if it can do one of them.
 * Flying creatures still can't pass doors, so `fly` only lifts pits and water.
 */
export function separation(map: GridMap, a: P, b: P, fly = false): Separation | null {
	if (hasLineOfSight(map, a, b)) return null;
	const walk = (x: number, y: number) => isPassableTile(tileAt(map, x, y), { fly, swim: true });
	if (bfs(map, a, b, walk)) return null;
	const viaDoors = bfs(map, a, b, (x, y) => walk(x, y) || BARRIERS.has(tileAt(map, x, y)));
	if (!viaDoors) return { doors: [], walled: true };
	return { doors: viaDoors.filter((p) => BARRIERS.has(tileAt(map, p.x, p.y))), walled: false };
}

export function describeSeparation(map: GridMap, pc: MapEntity, foe: MapEntity, s: Separation): string {
	const why = s.walled
		? "walls with no way through"
		: s.doors.map((d) => `a ${tileAt(map, d.x, d.y) === "secret_door" ? "secret" : "locked"} door at (${d.x},${d.y})`).join(" and ");
	return `${foe.name} [${foe.id}] at ${where(map, foe)} is cut off from ${pc.name} at ${where(map, pc)} by ${why}`;
}

/** Doors that are not simply open, for the per-turn digest. */
export function doorSummary(map: GridMap): string {
	const out: string[] = [];
	for (let i = 0; i < map.tiles.length; i++) {
		const t = map.tiles[i];
		if (t === "door" || t === "door_locked") out.push(`(${i % map.width},${Math.floor(i / map.width)}) ${t === "door" ? "closed" : "locked"}`);
	}
	return out.join(", ");
}
