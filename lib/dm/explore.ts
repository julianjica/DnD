import type { GameState } from "../game/types";
import { canStand, revealAround } from "../maps";
import { crossLink, linkAt } from "../maps/links";
import { appendLog } from "../store/campaigns";
import { SIGHT_RADIUS } from "./tools/map";
import { newId, type ClientEvent, type StateTxn } from "./context";
import { discoverAt, discoveryLine, discoveryNote, type Found } from "./discover";
import { runTurn } from "./turn";

/**
 * Free (out-of-combat) movement of the PC token along a clicked path; reveals
 * fog as it goes. Stepping onto a linked door takes the party to the connected
 * map: returns that map's name. Walking up to something with a `discover` text
 * (or into a room with one) finds it and stops the walk there.
 */
export function exploreMove(state: GameState, path: { x: number; y: number }[]): { crossedTo?: string; found: Found[] } {
	const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	if (!map) throw new Error("No active map.");
	const pc = map.entities.find((e) => e.kind === "pc");
	if (!pc) throw new Error("No player token on the map.");
	if (!path.length || path.length > 200) throw new Error("Invalid path.");
	let cur = { x: pc.x, y: pc.y };
	let found: Found[] = [];
	// A hidden thing waiting to be discovered doesn't block the square the player can't see it on.
	const occupied = new Set(map.entities.filter((e) => e.id !== pc.id && !e.dead && !(e.hidden && e.discover) && (e.kind === "monster" || e.kind === "npc" || e.kind === "feature")).map((e) => `${e.x},${e.y}`));
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
			if (to) {
				const there = to.entities.find((e) => e.kind === "pc");
				return { crossedTo: to.name, found: there ? discoverAt(state, to, there) : [] };
			}
		}
		found = discoverAt(state, map, cur);
		if (found.length) break;
	}
	pc.x = cur.x;
	pc.y = cur.y;
	// Opening doors by walking into them.
	const i = cur.y * map.width + cur.x;
	if (map.tiles[i] === "door") map.tiles[i] = "door_open";
	return { found };
}

/** exploreMove inside a state transaction, with a caption on the map for each discovery. */
export function exploreStep(tx: StateTxn, path: { x: number; y: number }[]): { crossedTo?: string; found: Found[] } {
	const r = exploreMove(tx.state, path);
	// They walk on the Map tab: keep it (the view is server state; the scene would snap back otherwise).
	tx.state.view = "map";
	for (const f of r.found) tx.fx({ kind: "discover", entityId: f.entityId, name: f.name, text: f.text, significant: f.significant || undefined, item: f.item });
	return r;
}

/**
 * After a free move: log the door crossed and what was found (no DM call), and
 * hand the turn to the DM only for significant discoveries. Returns true when
 * a DM turn ran (it emits its own "done").
 */
export async function exploreFollowUp(campaignId: string, emit: (e: ClientEvent) => void, r: { crossedTo?: string; found: Found[] }): Promise<boolean> {
	// Walked through a connected door: a marker in the chat (and the DM's history).
	if (r.crossedTo) appendLog(campaignId, { id: newId("l"), role: "system", text: `→ ${r.crossedTo}`, ts: Date.now() });
	if (r.found.length) appendLog(campaignId, ...r.found.map((f) => ({ id: newId("l"), role: "discovery" as const, text: discoveryLine(f), ts: Date.now() })));
	if (!r.found.some((f) => f.significant)) return false;
	await runTurn({ campaignId, text: "(I explore the place on my own.)", displayText: "", systemNotes: discoveryNote(r.found), emit });
	return true;
}
