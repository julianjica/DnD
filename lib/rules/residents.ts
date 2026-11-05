import type { GameState, Resident } from "../game/types";
import { baseOf } from "./base";
import { gameMinutes } from "./survival";

/**
 * The Quiet: residents of the base, the people sheltering there who aren't
 * companions (docs/zombie.md §7). They have no stat block and never fight or
 * run errands; they matter because they eat. Companions are tracked apart
 * (group.ts) and leave this list when recruited.
 */

export interface ResidentAdd {
	name: string;
	npcId?: string;
	headcount?: number;
	note?: string;
}

export interface ResidentRemove {
	/** Resident id, NPC id or name. */
	who: string;
	reason?: "left" | "died" | "turned" | "recruited" | "moved";
}

export function residentsOf(state: GameState): Resident[] {
	return baseOf(state)?.residents ?? [];
}

/** Everyone the residents stand for. */
export function residentHeadcount(state: GameState): number {
	return residentsOf(state).reduce((n, r) => n + Math.max(1, r.headcount), 0);
}

function findResident(list: Resident[], who: string): Resident | undefined {
	const w = who.trim().toLowerCase();
	return list.find((r) => r.id === who || r.npcId === who) ?? list.find((r) => r.name.toLowerCase() === w);
}

export function updateResidents(state: GameState, a: { add?: ResidentAdd[]; remove?: ResidentRemove[]; edit?: (ResidentAdd & { who: string })[] }, newId: () => string): string {
	const b = baseOf(state);
	if (!b) throw new Error("There is no base yet (claim_base first): residents live at the base.");
	b.residents ??= [];
	const now = gameMinutes(state.time);
	const out: string[] = [];
	for (const x of a.add ?? []) {
		if (x.npcId && !state.npcs[x.npcId]) throw new Error(`Unknown NPC ${x.npcId}.`);
		if (x.npcId && state.group?.survivors[x.npcId] && !["dead", "turned", "left"].includes(state.group.survivors[x.npcId].status))
			throw new Error(`${x.name} is a companion already (Group); companions aren't residents.`);
		const dup = (x.npcId && b.residents.find((r) => r.npcId === x.npcId)) || b.residents.find((r) => r.name.toLowerCase() === x.name.trim().toLowerCase());
		if (dup) {
			out.push(`${dup.name} already lives here.`);
			continue;
		}
		const r: Resident = { id: newId(), name: x.name.trim(), headcount: Math.max(1, Math.floor(x.headcount ?? 1)), since: now, ...(x.npcId ? { npcId: x.npcId } : {}), ...(x.note ? { note: x.note } : {}) };
		b.residents.push(r);
		out.push(`${r.name}${r.headcount > 1 ? ` (${r.headcount} people)` : ""} moved into ${b.name}.`);
	}
	for (const x of a.edit ?? []) {
		const r = findResident(b.residents, x.who);
		if (!r) throw new Error(`No resident "${x.who}".`);
		if (x.name) r.name = x.name.trim();
		if (x.headcount !== undefined) r.headcount = Math.max(1, Math.floor(x.headcount));
		if (x.note !== undefined) r.note = x.note || undefined;
		if (x.npcId !== undefined) r.npcId = x.npcId || undefined;
		out.push(`Updated ${r.name}${r.headcount > 1 ? ` (${r.headcount} people)` : ""}.`);
	}
	for (const x of a.remove ?? []) {
		const r = findResident(b.residents, x.who);
		if (!r) throw new Error(`No resident "${x.who}".`);
		b.residents = b.residents.filter((y) => y !== r);
		out.push(`${r.name} ${x.reason === "died" ? "died" : x.reason === "turned" ? "turned" : x.reason === "recruited" ? "joined the group as a companion" : "left"} (no longer a resident).`);
	}
	return `${out.join(" ")} Residents: ${residentHeadcount(state)} people; with the group, ${residentHeadcount(state) + mouthsBesidesResidents(state)} mouths at the base.`;
}

/** The player and living companions. */
function mouthsBesidesResidents(state: GameState): number {
	return 1 + Object.values(state.group?.survivors ?? {}).filter((sv) => !["dead", "turned", "left"].includes(sv.status)).length;
}

/** A companion recruited from the residents leaves the list. */
export function residentRecruited(state: GameState, npcId: string): void {
	const b = baseOf(state);
	if (b?.residents) b.residents = b.residents.filter((r) => r.npcId !== npcId);
}

/** 08:00: residents eat and drink from the base stock (after the player and companions). */
export function residentsDailyNeeds(state: GameState, at: number): string[] {
	const b = baseOf(state);
	const n = residentHeadcount(state);
	if (!b || !n) return [];
	const food = Math.min(n, b.stock.food);
	const water = Math.min(n, b.stock.water);
	b.stock.food -= food;
	b.stock.water -= water;
	const day = Math.floor(at / 1440);
	if (food >= n && water >= n) {
		b.residentsShortDays = 0;
		return [];
	}
	b.residentsShortDays = (b.residentsShortDays ?? 0) + 1;
	const short = [food < n ? `${n - food} without food` : "", water < n ? `${n - water} without water` : ""].filter(Boolean).join(", ");
	const days = b.residentsShortDays;
	b.log.push({ at, text: `Day ${day}: the residents went short (${short}).`, kind: "residentsShort", params: { food: n - food, water: n - water } });
	return [
		`Day ${day}, 08:00: ${b.name} can't feed its ${n} residents (${short}; ${days} morning(s) in a row). ${days >= 3 ? "People are desperate: some leave, someone steals from the stock or turns on the others; play it out and update_residents." : "Tempers fray: show it (arguments, rationing, a child crying)."}`,
	];
}

/** Digest line for the DM. */
export function residentsDigest(state: GameState): string {
	const list = residentsOf(state);
	if (!list.length) return "residents: none recorded (if people live here who aren't companions, record them with update_residents so they eat from the stock)";
	return `residents (${residentHeadcount(state)} people, eat from the stock at 08:00): ${list.map((r) => `${r.name}${r.npcId ? ` [${r.npcId}]` : ""}${r.headcount > 1 ? ` ×${r.headcount}` : ""}${r.note ? ` (${r.note})` : ""}`).join("; ")}`;
}
