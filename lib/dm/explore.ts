import type { GameState } from "../game/types";
import { canStand, revealAround } from "../maps";
import { crossLink, linkAt } from "../maps/links";
import { SIGHT_RADIUS } from "./tools/map";

/**
 * Free (out-of-combat) movement of the PC token along a clicked path; reveals
 * fog as it goes. Stepping onto a linked door takes the party to the connected
 * map: returns that map's name.
 */
export function exploreMove(state: GameState, path: { x: number; y: number }[]): { crossedTo?: string } {
	const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	if (!map) throw new Error("No active map.");
	const pc = map.entities.find((e) => e.kind === "pc");
	if (!pc) throw new Error("No player token on the map.");
	if (!path.length || path.length > 200) throw new Error("Invalid path.");
	let cur = { x: pc.x, y: pc.y };
	const occupied = new Set(map.entities.filter((e) => e.id !== pc.id && !e.dead && (e.kind === "monster" || e.kind === "npc" || e.kind === "feature")).map((e) => `${e.x},${e.y}`));
	for (const step of path) {
		if (Math.max(Math.abs(step.x - cur.x), Math.abs(step.y - cur.y)) !== 1) throw new Error("Path must be contiguous.");
		if (!canStand(map, step.x, step.y, pc.size, occupied, { allowDoors: true })) break;
		// Locked and secret doors stop you (the DM opens them with set_tile).
		const t = map.tiles[step.y * map.width + step.x];
		if (t === "door_locked" || t === "secret_door") break;
		cur = step;
		revealAround(map, cur.x, cur.y, SIGHT_RADIUS);
		const link = linkAt(map, cur.x, cur.y);
		if (link) {
			const to = crossLink(state, map, link);
			if (to) return { crossedTo: to.name };
		}
	}
	pc.x = cur.x;
	pc.y = cur.y;
	// Opening doors by walking into them.
	const i = cur.y * map.width + cur.x;
	if (map.tiles[i] === "door") map.tiles[i] = "door_open";
	return {};
}
