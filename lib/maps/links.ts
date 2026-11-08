import type { GameState, GridMap, MapLink, Tile } from "../game/types";
import { canStand, findFreeSquares, placeEntity, revealAround } from "./grid";

/**
 * Connected maps: a door (or stairs, a gap…) on one map that leads to a square
 * on another map of the same place. Walking onto it out of combat moves the
 * party there. Maps drawn side by side are linked automatically where their
 * touching walls have doors in the same places.
 */

const DOORISH = new Set<Tile>(["door", "door_open", "door_locked"]);
const SIGHT = 12;

const at = (m: GridMap, x: number, y: number): Tile | undefined => (x < 0 || y < 0 || x >= m.width || y >= m.height ? undefined : m.tiles[y * m.width + x]);

export function linkAt(map: GridMap, x: number, y: number): MapLink | undefined {
	return map.links?.find((l) => l.x === x && l.y === y);
}

/** Adds (or replaces) the link on `from` at x,y. */
export function addLink(from: GridMap, link: MapLink): void {
	from.links = [...(from.links ?? []).filter((l) => !(l.x === link.x && l.y === link.y)), link];
}

/** Two-way link between a square on `a` and a square on `b`. */
export function linkBoth(a: GridMap, pa: { x: number; y: number }, b: GridMap, pb: { x: number; y: number }): void {
	addLink(a, { x: pa.x, y: pa.y, toMapId: b.id, toX: pb.x, toY: pb.y });
	addLink(b, { x: pb.x, y: pb.y, toMapId: a.id, toX: pa.x, toY: pa.y });
}

/**
 * Links `fresh` to each of `others` where one map's edge wall meets the other's
 * opposite edge wall (same length) with doors in the same places. Returns
 * human-readable notes of what was linked.
 */
export function autoLink(fresh: GridMap, others: GridMap[]): string[] {
	const notes: string[] = [];
	for (const o of others) {
		const pairs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
		const edge = (len: number, pa: (i: number) => { x: number; y: number }, pb: (i: number) => { x: number; y: number }) => {
			for (let i = 0; i < len; i++) {
				const a = pa(i), b = pb(i);
				if (DOORISH.has(at(fresh, a.x, a.y)!) && DOORISH.has(at(o, b.x, b.y)!)) pairs.push({ a, b });
			}
		};
		if (fresh.width === o.width) {
			edge(fresh.width, (i) => ({ x: i, y: 0 }), (i) => ({ x: i, y: o.height - 1 })); // fresh is south of o
			edge(fresh.width, (i) => ({ x: i, y: fresh.height - 1 }), (i) => ({ x: i, y: 0 })); // fresh is north of o
		}
		if (fresh.height === o.height) {
			edge(fresh.height, (i) => ({ x: 0, y: i }), (i) => ({ x: o.width - 1, y: i })); // fresh is east of o
			edge(fresh.height, (i) => ({ x: fresh.width - 1, y: i }), (i) => ({ x: 0, y: i })); // fresh is west of o
		}
		for (const p of pairs) linkBoth(fresh, p.a, o, p.b);
		if (pairs.length) notes.push(`Linked ${pairs.length} door(s) to ${o.name} [${o.id}]: ${pairs.map((p) => `(${p.a.x},${p.a.y})↔(${p.b.x},${p.b.y})`).join(", ")}`);
	}
	return notes;
}

/** Where someone stepping through to `link`'s target ends up: next to it, inside that map. */
function arrival(map: GridMap, x: number, y: number): { x: number; y: number } {
	const occ = new Set(map.entities.filter((e) => !e.dead && e.kind !== "pc" && e.kind !== "light" && e.kind !== "item").map((e) => `${e.x},${e.y}`));
	// Prefer stepping away from the edge the door sits on.
	const dirs = [
		[0, y === 0 ? 1 : y === map.height - 1 ? -1 : 0],
		[x === 0 ? 1 : x === map.width - 1 ? -1 : 0, 0],
	].filter(([dx, dy]) => dx || dy);
	for (const [dx, dy] of [...dirs, [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
		const nx = x + dx, ny = y + dy;
		if (!linkAt(map, nx, ny) && canStand(map, nx, ny, 1, occ)) return { x: nx, y: ny };
	}
	return findFreeSquares(map, { x, y }, 1)[0] ?? map.entry;
}

/**
 * The party steps through `link`: the active map changes, the PC (and the
 * companions walking with them) appear next to the linked square. Returns the
 * new map, or undefined if the link is broken.
 */
export function crossLink(state: GameState, from: GridMap, link: MapLink): GridMap | undefined {
	const to = state.maps[link.toMapId];
	if (!to) return undefined;
	const pc = from.entities.find((e) => e.kind === "pc");
	const followers = new Set(
		Object.values(state.group?.survivors ?? {})
			.filter((s) => s.status === "with_party")
			.map((s) => s.npcId),
	);
	const moving = from.entities.filter((e) => !e.dead && e.kind === "npc" && e.npcId && followers.has(e.npcId));
	from.entities = from.entities.filter((e) => e.kind !== "pc" && !moving.includes(e));
	to.entities = to.entities.filter((e) => e.kind !== "pc" && !(e.npcId && moving.some((m) => m.npcId === e.npcId)));
	const spot = arrival(to, link.toX, link.toY);
	if (pc) to.entities.push({ ...pc, x: spot.x, y: spot.y });
	else placeEntity(to, { id: `ent_${state.character.id}`, kind: "pc", name: state.character.name, sprite: "pc", disposition: "friendly" }, spot);
	const near = findFreeSquares(to, spot, moving.length);
	moving.forEach((e, i) => to.entities.push({ ...e, ...(near[i] ?? spot) }));
	// The door you came through stands open behind you.
	const i = link.toY * to.width + link.toX;
	if (to.tiles[i] === "door") to.tiles[i] = "door_open";
	revealAround(to, spot.x, spot.y, SIGHT);
	state.activeMapId = to.id;
	return to;
}

/** For the DM: where this map's links lead. */
export function linkSummary(state: GameState, map: GridMap): string {
	return (map.links ?? []).map((l) => `(${l.x},${l.y})→${state.maps[l.toMapId]?.name ?? "missing map"} [${l.toMapId}] (${l.toX},${l.toY})`).join("; ");
}
