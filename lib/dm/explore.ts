import type { GameState } from "../game/types";
import { canStand, revealAround } from "../maps";
import { SIGHT_RADIUS } from "./tools/map";

/** Free (out-of-combat) movement of the PC token along a clicked path; reveals fog as it goes. */
export function exploreMove(state: GameState, path: { x: number; y: number }[]): void {
	const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	if (!map) throw new Error("No active map.");
	const pc = map.entities.find((e) => e.kind === "pc");
	if (!pc) throw new Error("No player token on the map.");
	if (!path.length || path.length > 200) throw new Error("Invalid path.");
	let cur = { x: pc.x, y: pc.y };
	const occupied = new Set(map.entities.filter((e) => e.id !== pc.id && (e.kind === "monster" || e.kind === "npc" || e.kind === "feature")).map((e) => `${e.x},${e.y}`));
	for (const step of path) {
		if (Math.max(Math.abs(step.x - cur.x), Math.abs(step.y - cur.y)) !== 1) throw new Error("Path must be contiguous.");
		if (!canStand(map, step.x, step.y, pc.size, occupied, { allowDoors: true })) break;
		cur = step;
		revealAround(map, cur.x, cur.y, SIGHT_RADIUS);
	}
	pc.x = cur.x;
	pc.y = cur.y;
	// Opening doors by walking into them.
	const i = cur.y * map.width + cur.x;
	if (map.tiles[i] === "door") map.tiles[i] = "door_open";
}
