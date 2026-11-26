import type { GameState, GridMap, MapDiscovery, MapEntity, MapRoom } from "../game/types";
import { addInventoryItem } from "./items";
import { newId } from "./context";

/**
 * Discoveries: things the DM tagged with a short `discover` text when laying a
 * place out (draw_map key entries, place_entity, rooms). When the player walks
 * their own token up to one (or into the room), the engine shows the text at
 * once, with no DM turn; only `significant` ones hand the turn to the DM.
 */

/** Captions stay short: a verbose DM can't rebuild the wall of prose here. */
export const DISCOVER_MAX = 240;

export interface Found {
	name: string;
	text: string;
	significant: boolean;
	/** The item handed over ("Rusty key"), if any. */
	item?: string;
	entityId?: string;
	roomId?: string;
}

/** Builds a discovery from tool arguments (undefined when there is no text). */
export function makeDiscovery(text?: string, significant?: boolean, item?: string): MapDiscovery | undefined {
	const t = text?.trim().replace(/\s+/g, " ");
	if (!t) return undefined;
	const it = item?.trim().slice(0, 60);
	return { text: t.length > DISCOVER_MAX ? `${t.slice(0, DISCOVER_MAX - 1).trimEnd()}…` : t, ...(significant ? { significant: true } : {}), ...(it ? { item: it } : {}) };
}

/** "2 Silver coins" / "3x Arrows" → quantity and name; anything else is one item. */
export function parseItem(item: string): { name: string; quantity: number } {
	const m = /^(\d{1,3})\s*[x×]?\s+(.+)$/i.exec(item.trim());
	return m ? { name: m[2], quantity: Math.max(1, Number(m[1])) } : { name: item.trim(), quantity: 1 };
}

/** The square p is on or next to the entity's footprint (diagonals count). */
export function isNextTo(e: Pick<MapEntity, "x" | "y" | "size">, p: { x: number; y: number }): boolean {
	const s = Math.max(1, e.size || 1);
	return p.x >= e.x - 1 && p.x <= e.x + s && p.y >= e.y - 1 && p.y <= e.y + s;
}

const inRoom = (r: MapRoom, p: { x: number; y: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/** Entities whose discovery is still waiting to be found (dead creatures and the PC never). */
export function pendingDiscoveries(map: GridMap): MapEntity[] {
	return map.entities.filter((e) => e.discover && !e.discover.found && e.kind !== "pc" && !e.dead);
}

/**
 * Finds what the player's token at p discovers on the map: marks each found
 * (shown once), reveals hidden ones and hands over their item. `silent` (the
 * DM moved the token itself) marks them found but leaves the item to the DM.
 */
export function discoverAt(state: GameState, map: GridMap, p: { x: number; y: number }, opts: { silent?: boolean } = {}): Found[] {
	const out: Found[] = [];
	for (const e of pendingDiscoveries(map)) {
		if (!isNextTo(e, p)) continue;
		const d = e.discover!;
		d.found = true;
		if (e.hidden) e.hidden = false;
		let item: string | undefined;
		if (d.item && !opts.silent) {
			const { name, quantity } = parseItem(d.item);
			addInventoryItem(state, { name, quantity, description: d.text }, () => newId("it"));
			item = quantity > 1 ? `${quantity} ${name}` : name;
		} else item = d.item;
		out.push({ name: e.name, text: d.text, significant: !!d.significant, ...(item ? { item } : {}), entityId: e.id });
	}
	for (const r of map.rooms) {
		if (!r.discover || r.discover.found || !inRoom(r, p)) continue;
		r.discover.found = true;
		out.push({ name: r.name ?? r.tag ?? r.id, text: r.discover.text, significant: !!r.discover.significant, roomId: r.id });
	}
	return out;
}

/** The discovery log line (also what the DM reads in "Recent play"). */
export function discoveryLine(f: Found): string {
	return `${f.name}: ${f.text}${f.item ? ` (+ ${f.item})` : ""}`;
}

/** The ENGINE NOTE for the DM turn a significant discovery hands over. */
export function discoveryNote(found: Found[]): string[] {
	const sig = found.filter((f) => f.significant);
	return [
		...sig.map((f) => `The player reached ${f.name} on their own, exploring the map; the engine already showed them: "${f.text}"${f.item ? ` and gave them ${f.item} (already in the inventory)` : ""}.`),
		...(found.length > sig.length ? [`Also found on the way (already shown): ${found.filter((f) => !f.significant).map((f) => f.name).join(", ")}.`] : []),
		"React in a few lines (at most ~60 words): what it means, or the person there speaks to them. Don't repeat the discovery text. Then suggest_actions.",
	];
}

/** For a tool result: what the DM-moved token is now next to (marked found; the DM narrates it). */
export function silentNote(found: Found[]): string {
	if (!found.length) return "";
	return ` Now next to: ${found.map((f) => `${f.name} — "${f.text}"${f.item ? ` (holds ${f.item}: give_item if they take it)` : ""}`).join("; ")}. Marked as discovered: narrate it yourself.`;
}

/** Short tag for map summaries and the digest. */
export function discoverTag(d?: MapDiscovery): string {
	if (!d) return "";
	return d.found ? " (discovered)" : ` (discover${d.significant ? ", significant" : ""}${d.item ? `, holds ${d.item}` : ""})`;
}
