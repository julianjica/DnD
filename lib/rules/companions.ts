/**
 * The Quiet: companions with their own lives.
 *
 * Each companion has a want, a fear and a secret (defined by the DM with
 * set_companion_profile; never invented here) and feelings about the others
 * (bonds, −3 … +3). Once per game evening (19:00–02:00), out of combat, the
 * engine may hand the DM a small CAMP SCENE (a "beat"): a confession, a
 * clash, a theft, a favour asked, a warm moment, a doubt. The DM plays it and
 * reports the outcome with companion_beat, which moves trust and bonds.
 *
 * Beats are about the companions as people; the player stays the protagonist:
 * the scene asks them to respond, it never plays out without them.
 *
 * This module only reads/writes plain state (no import of group.ts, so the
 * group tick can call it without a cycle).
 */
import type { BaseState, GameState, Survivor } from "../game/types";
import type { Rng } from "./dice";
import { gameMinutes } from "./survival";

export type Facet = "want" | "fear" | "secret";
export const FACETS: readonly Facet[] = ["want", "fear", "secret"];
export type BeatKind = "confession" | "conflict" | "theft" | "favor" | "bonding" | "doubt";

const EVENING = 19 * 60;
/** The evening runs 19:00 → 02:00 (7 hours). */
const EVENING_LEN = 7 * 60;
/** Chance (percent) that an evening brings a camp scene. */
export const BEAT_CHANCE = 55;

/** The game day whose evening (from 19:00) is the latest to have begun at minute t. */
export function eveningDay(t: number): number {
	return Math.floor((t - EVENING) / 1440);
}

export function inEvening(t: number): boolean {
	return (((t - EVENING) % 1440) + 1440) % 1440 < EVENING_LEN;
}

const nameOf = (state: GameState, sv: Survivor) => state.npcs[sv.npcId]?.name ?? sv.npcId;

/** Who can be in a camp scene tonight: with the party, or at the base while the party is there. */
function present(state: GameState): Survivor[] {
	const g = state.group;
	if (!g) return [];
	const home = !!g.base && !!state.world.currentLocationId && state.world.currentLocationId === g.base.locationId;
	return Object.values(g.survivors).filter((sv) => sv.status === "with_party" || (sv.status === "at_base" && home));
}

export const bondOf = (sv: Survivor, other: string): number => sv.bonds?.[other] ?? 0;

/** Supplies are short: someone went hungry, or the base can't feed everyone for a day. */
function short(state: GameState, here: Survivor[]): boolean {
	if (here.some((sv) => sv.missedDays > 0)) return true;
	const b = state.group?.base;
	if (!b) return false;
	const mouths = 1 + Object.values(state.group!.survivors).filter((sv) => sv.status === "with_party" || sv.status === "at_base").length + (b.residents ?? []).reduce((n, r) => n + Math.max(1, r.headcount), 0);
	return b.stock.food < mouths || b.stock.water < mouths;
}

function pickWeighted<T>(rng: Rng, list: [T, number][]): T | undefined {
	const live = list.filter(([, w]) => w > 0);
	if (!live.length) return undefined;
	let r = rng.next() * live.reduce((n, [, w]) => n + w, 0);
	for (const [x, w] of live) {
		r -= w;
		if (r < 0) return x;
	}
	return live[live.length - 1][0];
}

const unrevealed = (sv: Survivor): Facet[] => FACETS.filter((f) => !sv.revealed?.includes(f));
const VOLATILE = /volatile|desperate|selfish|greedy|thief|addict|unstable|hothead|hot-headed|paranoid|resentful|bitter|ruthless|coward/i;
const TOPICS = ["who stands watch tonight", "tomorrow's plan and how risky it is", "something one of them did (or didn't do) in the last fight", "whether to help strangers", "noise and light around camp", "someone they lost", "who carries what"];

/**
 * Tonight's camp scene, if any: call on every group tick. Rolls at most once
 * per evening (first tick at/after 19:00, before 02:00), never in combat, never
 * retroactively (a long jump only ever looks at the evening it lands in).
 * Returns the DM instruction, or undefined.
 */
export function campBeat(state: GameState, rng: Rng, now = gameMinutes(state.time)): string | undefined {
	const g = state.group;
	if (!g) return undefined;
	const day = eveningDay(now);
	// New bookkeeping starts "now": no scene for an evening already under way.
	if (g.lastBeatDay === undefined) {
		g.lastBeatDay = day;
		return undefined;
	}
	if (!inEvening(now) || g.lastBeatDay >= day) return undefined;
	if (state.encounter?.status === "active" || state.mode === "combat") return undefined;
	const here = present(state);
	if (!here.length) return undefined;
	// The evening is spent: one roll, hit or miss.
	g.lastBeatDay = day;
	if (rng.int(1, 100) > BEAT_CHANCE) return undefined;
	// No one carries two evenings in a row.
	const fresh = here.filter((sv) => sv.lastBeatAt === undefined || eveningDay(sv.lastBeatAt) < day - 1);
	if (!fresh.length) return undefined;
	const lack = short(state, here);
	// A pair beat features both, so both must be fresh.
	const freshPairs: [Survivor, Survivor][] = [];
	for (let i = 0; i < fresh.length; i++) for (let j = i + 1; j < fresh.length; j++) freshPairs.push([fresh[i], fresh[j]]);
	const confide = fresh.filter((sv) => sv.morale >= 6 && unrevealed(sv).length);
	const doubters = fresh.filter((sv) => sv.morale <= 4);
	const tense = freshPairs.filter(([a, b]) => bondOf(a, b.npcId) <= 0 || bondOf(b, a.npcId) <= 0);
	const warm = freshPairs.filter(([a, b]) => bondOf(a, b.npcId) >= 1 && bondOf(b, a.npcId) >= 1);
	const kind = pickWeighted<BeatKind>(rng, [
		["confession", confide.length ? 2 : 0],
		["conflict", freshPairs.length ? 1 + (lack ? 2 : 0) + (tense.some(([a, b]) => bondOf(a, b.npcId) < 0) ? 1 : 0) : 0],
		["theft", lack ? 1.5 : 0],
		["favor", fresh.some((sv) => sv.want) ? 1.5 : 1],
		["bonding", warm.length ? 1.5 : 0],
		["doubt", doubters.length ? 2 : 0],
	]);
	if (!kind) return undefined;
	const n = (sv: Survivor) => `${nameOf(state, sv)} [${sv.npcId}]`;
	const define = (sv: Survivor, f: Facet) => (sv[f] ? `"${sv[f]}"` : `(not defined yet: decide it from what the story has shown and call set_companion_profile first)`);
	let who: Survivor[];
	let body: string;
	switch (kind) {
		case "confession": {
			const a = rng.pick(confide);
			const open = unrevealed(a);
			const known = open.filter((f) => a[f]);
			const what = rng.pick(known.length ? known : open);
			who = [a];
			body = `CONFESSION: ${n(a)} (morale ${a.morale}/10: they trust the player) opens up, quietly, and lets their ${what.toUpperCase()} show: ${define(a, what)}. Let the player react. Listened to and kept: companion_beat with reveal {npcId, what: "${what}"} and morale +1; brushed off or mocked: reveal it anyway, morale −1.`;
			break;
		}
		case "conflict": {
			const pool = tense.length ? tense : freshPairs;
			const [a, b] = pickWeighted(rng, pool.map((p) => [p, 1 + Math.max(0, -bondOf(p[0], p[1].npcId))] as [[Survivor, Survivor], number]))!;
			const about = lack ? "food and water: who eats, who goes without" : rng.pick(TOPICS);
			who = [a, b];
			body = `CONFLICT: ${n(a)} and ${n(b)} clash over ${about} (bond ${bondOf(a, b.npcId)}). Something concrete and small, voices raised; they look to the player. Siding with one: companion_beat morale +1 for them, −1 for the other, bond −1; settling it fairly: bond +1 and no loss; ignoring it: bond −1.`;
			break;
		}
		case "theft": {
			const a = pickWeighted(rng, fresh.map((sv) => [sv, 1 + (sv.traits.some((t) => VOLATILE.test(t)) ? 3 : 0) + (sv.morale <= 4 ? 1 : 0) + sv.missedDays] as [Survivor, number]))!;
			const witness = fresh.filter((sv) => sv !== a);
			const w = witness.length ? rng.pick(witness) : undefined;
			who = w ? [a, w] : [a];
			body = `THEFT: supplies are short, and ${n(a)} took more than their share (food or water) after dark${w ? `; ${n(w)} noticed and brings it to the player` : "; the player notices what's missing"}. Why they did it comes from who they are (their want, fear or secret). Forgiven: companion_beat morale +1 for ${nameOf(state, a)}${w ? `, −1 for ${nameOf(state, w)} if it feels unfair` : ""}; punished: −2 for them${w ? `, bond between them −1` : ""}.`;
			break;
		}
		case "favor": {
			const withWant = fresh.filter((sv) => sv.want);
			const a = rng.pick(withWant.length ? withWant : fresh);
			who = [a];
			body = `FAVOR: ${n(a)} asks the player for something tied to what they want most ${define(a, "want")}: small enough to be doable, big enough to matter to them (a detour, an item, a promise). If the player agrees, make it a side quest (add_quest, giverNpcId ${a.npcId}) and companion_beat morale +1; a flat no: −1. Keeping or breaking it later: update_survivor.`;
			break;
		}
		case "bonding": {
			const [a, b] = rng.pick(warm);
			who = [a, b];
			body = `BONDING: a small warm moment between ${n(a)} and ${n(b)} (bond ${bondOf(a, b.npcId)}): shared food, a bad joke, a memory from before. The player can join in or let them have it. companion_beat with bond +1 between them (and morale +1 each if the player shares it).`;
			break;
		}
		case "doubt": {
			const a = rng.pick(doubters);
			const others = here.filter((sv) => sv !== a);
			who = [a];
			body = `DOUBT: ${n(a)} (morale ${a.morale}/10) questions the player's leadership: a recent choice, the plan, the risks they keep taking${others.length ? `, within earshot of ${others.map((o) => nameOf(state, o)).join(", ")}` : ""}. The player answers, not you. A real answer or a fair concession: companion_beat morale +1; dismissing them: −1 (and the others may shift: bonds).`;
			break;
		}
	}
	for (const sv of who) sv.lastBeatAt = now;
	return `CAMP SCENE (play it when the moment allows, briefly: a few lines about them as people, then back to the player's choices; the player's response decides the outcome, then call companion_beat with npcIds [${who.map((sv) => sv.npcId).join(", ")}]): ${body}`;
}

// ─── outcomes ───────────────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Moves the bond between two companions, both ways (−3 … +3). Returns the new value. */
export function shiftBond(a: Survivor, b: Survivor, delta: number): number {
	const v = clamp(bondOf(a, b.npcId) + delta, -3, 3);
	a.bonds = { ...(a.bonds ?? {}), [b.npcId]: v };
	b.bonds = { ...(b.bonds ?? {}), [a.npcId]: v };
	return v;
}

export function reveal(sv: Survivor, what: Facet): void {
	if (!sv.revealed?.includes(what)) sv.revealed = [...(sv.revealed ?? []), what];
}

/** A camp-scene line in the log the Group tab shows (the base log, or the group's own without a base). */
export function logBeat(state: GameState, at: number, names: string, note: string): void {
	const g = state.group;
	if (!g) return;
	const entry: BaseState["log"][number] = { at, text: `Camp: ${names}${note ? `: ${note}` : ""}`, kind: "camp", params: { names, note } };
	if (g.base) g.base.log = [...g.base.log, entry].slice(-30);
	else g.log = [...(g.log ?? []), entry].slice(-30);
}

// ─── digest ─────────────────────────────────────────────────────────────────

/** "; want: … (known); fear: … (hidden); bonds: Wade +2" for a companion's digest line. */
export function profileDigest(state: GameState, sv: Survivor): string {
	const facets = FACETS.filter((f) => sv[f]).map((f) => `${f}: ${sv[f]} (${sv.revealed?.includes(f) ? "known to the player" : "hidden"})`);
	const bonds = Object.entries(sv.bonds ?? {})
		.filter(([id, v]) => v !== 0 && state.group?.survivors[id])
		.map(([id, v]) => `${state.npcs[id]?.name ?? id} ${v > 0 ? "+" : ""}${v}`);
	return `${facets.length ? `; ${facets.join("; ")}` : ""}${bonds.length ? `; bonds: ${bonds.join(", ")}` : ""}`;
}

/** The one line asking the DM to define missing profiles (active companions only). */
export function missingProfiles(state: GameState): string | undefined {
	const list = Object.values(state.group?.survivors ?? {}).filter((sv) => ["with_party", "at_base", "away"].includes(sv.status) && FACETS.some((f) => !sv[f]));
	if (!list.length) return undefined;
	return `DEFINE (set_companion_profile, one short line each, from what the story has shown; don't narrate them yet): ${list.map((sv) => `${nameOf(state, sv)} [${sv.npcId}] needs ${FACETS.filter((f) => !sv[f]).join("/")}`).join("; ")}.`;
}
