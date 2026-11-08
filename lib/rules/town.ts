import type { GameState, Horde, PlaceState, PlaceStatus, TownEvent, TownFaction, TownState } from "../game/types";
import type { Rng } from "./dice";
import { isZombie, gameMinutes } from "./survival";
import { PLACE_TYPES } from "./scavenge";
import { markBeat } from "./threads";
import { startSiege } from "./siege";

/**
 * The Quiet: Kessler Falls moves on without the player (docs/zombie.md §1).
 * Factions scavenge, fortify, raid and expand once a night; hordes drift from
 * place to place every few hours and overrun what they reach. The engine keeps
 * the truth; the player only knows what they've seen, been told or heard on the
 * radio (PlaceState.knownStatus, Horde.known, TownEvent.known), and only that
 * reaches the client.
 */

const HOUR = 60;
const DAY = 1440;
/** Factions act once a night, at 20:00. */
const NIGHT = 20 * HOUR;
const MAX_EVENTS = 80;

type Seed = Omit<TownFaction, "known" | "status" | "homeId"> & { home: string };

/** The canon factions, plus the two the outbreak brings in (Ventara, the Guard). */
const SEEDS: Seed[] = [
	{ id: "precinct", name: "The Precinct", home: "precinct", strength: 6, attitude: 0, aggression: 1, goal: "hold the police station, find ammo and the missing officers, keep order on Main Street" },
	{ id: "fold", name: "The Fold", home: "st-agnes", strength: 5, attitude: 0, aggression: 1, goal: "gather the faithful at St. Agnes; take in the 'worthy', turn the rest away; Pastor Crane's judgment" },
	{ id: "route9", name: "The Route 9 Boys", home: "route9", strength: 6, attitude: -1, aggression: 3, goal: "control fuel and the highway; take supplies and people; tribute from anyone weaker" },
	{ id: "library", name: "The Library", home: "hollis", strength: 3, attitude: 0, aggression: 0, goal: "survive in the library tower; get food; keep their Ventara secret" },
	{ id: "grangers", name: "The Grangers", home: "granger", strength: 4, attitude: 0, aggression: 0, goal: "keep strangers off the farm; trade food only for what they lack" },
	{ id: "ventara", name: "Ventara clean-up team", home: "hollis", strength: 5, attitude: -1, aggression: 2, goal: "recover LAZARUS-7 subjects and samples; erase the evidence; leave no witnesses" },
	{ id: "guard", name: "National Guard remnant", home: "armory", strength: 5, attitude: 0, aggression: 1, goal: "hold the armory and wait for orders that never come; shoot anyone who rushes the fence" },
];

const locId = (state: GameState, short: string) => {
	const id = `loc-kf-${short}`;
	return state.world.locations.some((l) => l.id === id) ? id : undefined;
};

const nameOfLoc = (state: GameState, id?: string) => state.world.locations.find((l) => l.id === id)?.name ?? id ?? "?";

export function townOf(state: GameState): TownState | undefined {
	return state.town;
}

/** Seeds the town for a campaign (no catch-up: the clock starts now). */
export function initTown(state: GameState, rng: Rng): TownState {
	const now = gameMinutes(state.time);
	const factions: Record<string, TownFaction> = {};
	const names = Object.values(state.npcs).map((n) => `${n.name} ${n.role ?? ""}`.toLowerCase());
	for (const s of SEEDS) {
		const homeId = locId(state, s.home);
		// Known once the story has brought in one of their people.
		const hint: Record<string, RegExp> = { precinct: /comisar|precinct|ruiz/, fold: /redil|fold|crane/, route9: /ruta 9|route 9|earl/, library: /torre|tower|library|bibliot/, grangers: /granger/, ventara: /ventara|sloane/, guard: /guardia|guard|arsenal|armory|okonkwo/ };
		const { home: _home, ...rest } = s;
		void _home;
		factions[s.id] = { ...rest, ...(homeId ? { homeId } : {}), known: names.some((n) => hint[s.id]?.test(n)), status: "active" };
	}
	const places: Record<string, PlaceState> = {};
	for (const l of state.world.locations) {
		const status: PlaceStatus = l.id === locId(state, "st-brigids") ? "overrun" : "intact";
		const held = Object.values(factions).find((f) => f.homeId === l.id);
		places[l.id] = { status: held ? "held" : status, ...(held ? { heldBy: held.id } : {}), since: now, ...(l.visited ? { knownStatus: held ? "held" : status, ...(held ? { knownHeldBy: held.id } : {}), lastVisit: now } : {}) };
	}
	const hordes: Horde[] = [];
	const start = (short: string, size: number) => {
		const at = locId(state, short);
		if (at) hordes.push({ id: `h${hordes.length + 1}`, size: size + rng.int(0, 10), at, nextMoveAt: now + rng.int(4, 10) * HOUR, known: false });
	};
	start("st-brigids", 30);
	start("old-mill", 12);
	start("mall", 20);
	state.town = { lastTick: now, factions, hordes, places, events: [] };
	return state.town;
}

/** Neighbours along the town's roads. */
function neighbours(state: GameState, id: string): string[] {
	return state.world.routes.flatMap((r) => (r.from === id ? [r.to] : r.to === id ? [r.from] : []));
}

function dist(state: GameState, a: string, b: string): number {
	const la = state.world.locations.find((l) => l.id === a), lb = state.world.locations.find((l) => l.id === b);
	return la && lb ? Math.hypot(la.x - lb.x, la.y - lb.y) : 1;
}

function addEvent(t: TownState, ev: Omit<TownEvent, "id">): TownEvent {
	const e = { id: `te${t.events.length ? Number(t.events[t.events.length - 1].id.slice(2)) + 1 : 1}`, ...ev };
	t.events.push(e);
	if (t.events.length > MAX_EVENTS) t.events.splice(0, t.events.length - MAX_EVENTS);
	return e;
}

function setPlace(t: TownState, id: string, status: PlaceStatus, at: number, heldBy?: string) {
	const p = (t.places[id] ??= { status: "intact", since: at });
	p.status = status;
	p.since = at;
	if (heldBy) p.heldBy = heldBy;
	else delete p.heldBy;
}

/** A faction stripping a place makes the player's own scavenging there poorer. */
function stripLoot(state: GameState, id: string) {
	const looted = state.survival?.looted;
	if (!looted) return;
	for (const p of PLACE_TYPES) looted[`${id}|${p}`] = (looted[`${id}|${p}`] ?? 0) + 1;
}

const baseLoc = (state: GameState) => {
	const b = state.group?.base;
	if (!b) return undefined;
	return b.locationId ?? (b.mapId ? state.world.locations.find((l) => l.mapIds.includes(b.mapId!))?.id : undefined);
};

// ─── hordes ────────────────────────────────────────────────────────────────

function chooseHeading(state: GameState, rng: Rng, h: Horde): string | undefined {
	const here = state.world.currentLocationId;
	const noise = state.survival?.noise.level ?? 0;
	const base = baseLoc(state);
	const opts: [string, number][] = state.world.locations.filter((l) => l.id !== h.at).map((l) => [l.id, 1 / (1 + dist(state, h.at, l.id) * 6)]);
	const bump = (id: string | undefined, w: number) => {
		const o = opts.find(([k]) => k === id);
		if (o) o[1] += w;
	};
	bump(here, noise * 0.4);
	if (base) bump(base, 0.05 + (state.group?.base ? Math.min(0.25, (state.group.base.stock.food + state.group.base.stock.water) / 160) : 0));
	const total = opts.reduce((n, [, w]) => n + w, 0);
	let r = rng.next() * total;
	for (const [id, w] of opts) if ((r -= w) < 0) return id;
	return undefined;
}

function stepToward(state: GameState, from: string, to: string): string | undefined {
	const ns = neighbours(state, from);
	if (!ns.length) return undefined;
	if (ns.includes(to)) return to;
	return [...ns].sort((a, b) => dist(state, a, to) - dist(state, b, to))[0];
}

/** One horde arrives somewhere: what it does to the place, the faction there, the player. */
function arrive(state: GameState, t: TownState, rng: Rng, h: Horde, at: number, out: string[]) {
	const place = (t.places[h.at] ??= { status: "intact", since: at });
	const where = nameOfLoc(state, h.at);
	const holder = place.heldBy ? t.factions[place.heldBy] : undefined;
	const here = state.world.currentLocationId;
	const base = baseLoc(state);
	if (holder && holder.status === "active") {
		if (h.size > holder.strength * 8 + 10 + rng.int(0, 10)) {
			holder.strength = Math.max(1, holder.strength - rng.int(1, 2));
			h.size = Math.max(0, h.size - rng.int(4, 10));
			if (holder.strength <= 2) {
				setPlace(t, h.at, "overrun", at);
				addEvent(t, { at, kind: "overrun", locId: h.at, factionId: holder.id, hordeId: h.id, text: `A horde (~${h.size}) overran ${where}; ${holder.name} lost their stronghold (strength now ${holder.strength}).`, public: true });
			} else addEvent(t, { at, kind: "repelled", locId: h.at, factionId: holder.id, hordeId: h.id, text: `${holder.name} held ${where} against a horde, at a cost (strength now ${holder.strength}; ~${h.size} dead left).`, public: true });
		} else {
			const lost = rng.int(3, 8);
			h.size = Math.max(0, h.size - lost);
			holder.strength = Math.max(1, holder.strength - (rng.next() < 0.4 ? 1 : 0));
			addEvent(t, { at, kind: "repelled", locId: h.at, factionId: holder.id, hordeId: h.id, text: `${holder.name} held ${where} against a horde (it lost ~${lost}; ~${h.size} left).`, public: true });
		}
	} else if (place.status !== "overrun" && h.at !== here && h.at !== base && h.size >= 20 && rng.next() < (h.size - 15) / 80) {
		setPlace(t, h.at, "overrun", at);
		addEvent(t, { at, kind: "overrun", locId: h.at, hordeId: h.id, text: `A horde (~${h.size}) spread through ${where}: it is overrun.`, public: rng.next() < 0.5 });
	}
	if (h.at === here && state.encounter?.status !== "active") {
		h.known = true;
		markBeat(state, "threat");
		out.push(`TOWN — A HORDE IS HERE: ~${h.size} dead are pouring into ${where} right now (it drifted in from the roads). Play it: the player hears it first (a groan rolling down the street), then sees it. Hiding, fleeing or barricading are the sane choices; a fight against a horde is suicide (start_combat with z-horde if they insist).`);
	}
	if (h.at === base) {
		addEvent(t, { at, kind: "at_base", locId: h.at, hordeId: h.id, text: `A horde (~${h.size}) reached the base at ${where}.`, public: false });
		t.lastBaseHorde = at;
		// It stays to batter the walls for a day before drifting on (the siege plays it out).
		h.nextMoveAt = Math.max(h.nextMoveAt, at + DAY);
		delete h.heading;
		// The siege engine plays it out (lib/rules/siege.ts); without a base map (or with a siege on) it's the DM's.
		let siege: string | undefined;
		try {
			siege = startSiege(state, rng, { horde: h.size, hordeId: h.id, source: "town", from: at });
		} catch {
			siege = undefined;
		}
		out.push(`TOWN — A HORDE REACHED THE BASE at ${where} (~${h.size} dead). ${siege ?? `${state.world.currentLocationId === base ? "The party is there." : "The party is away: the people inside face it."} Treat it as a siege: the dead hit the barricades (damage_barricade), and if they give way it's start_combat.`}`);
	}
}

function moveHordes(state: GameState, t: TownState, rng: Rng, now: number, out: string[]) {
	for (const h of t.hordes) {
		for (let n = 0; n < 8 && h.nextMoveAt <= now; n++) {
			const at = h.nextMoveAt;
			if (!h.heading || h.heading === h.at) h.heading = chooseHeading(state, rng, h);
			const next = h.heading ? stepToward(state, h.at, h.heading) : undefined;
			h.nextMoveAt = at + rng.int(8, 20) * HOUR;
			// The dead keep coming: hordes swell a little as the town dies.
			h.size += rng.int(0, 2);
			if (!next || rng.next() < 0.4) continue; // it lingers
			// The base gets a few days' breather between hordes.
			if (next === baseLoc(state) && at - (t.lastBaseHorde ?? -Infinity) < 4 * DAY) {
				delete h.heading;
				continue;
			}
			h.at = next;
			if (h.at === h.heading) delete h.heading;
			arrive(state, t, rng, h, at, out);
		}
		// You can hear a horde one road away.
		const here = state.world.currentLocationId;
		if (here && (h.at === here || neighbours(state, here).includes(h.at))) h.known = true;
	}
	t.hordes = t.hordes.filter((h) => h.size > 0);
}

// ─── factions ──────────────────────────────────────────────────────────────

function factionNight(state: GameState, t: TownState, rng: Rng, f: TownFaction, at: number, out: string[]) {
	if (f.status !== "active") return;
	// Only the DM finishes a faction (update_town strength 0 / status broken); the engine wears them down to 1.
	if (f.strength <= 0) {
		f.status = "broken";
		addEvent(t, { at, kind: "broken", factionId: f.id, locId: f.homeId, text: `${f.name} is finished: scattered, dead or turned.`, public: true });
		return;
	}
	if (rng.next() > 0.45 + f.aggression * 0.12) return;
	const home = f.homeId && t.places[f.homeId]?.heldBy === f.id ? f.homeId : undefined;
	const around = home ? [home, ...neighbours(state, home)] : f.homeId ? [f.homeId, ...neighbours(state, f.homeId)] : [];
	const near = [...new Set([...around, ...around.flatMap((id) => neighbours(state, id))])];
	const here = state.world.currentLocationId;
	const base = baseLoc(state);
	const rivals = Object.values(t.factions).filter((o) => o.id !== f.id && o.status === "active" && o.homeId && near.includes(o.homeId));
	const weights: [string, number][] = [
		["scavenge", 3],
		["fortify", home ? 1.5 : 0],
		["retake", !home && f.homeId ? 2 : 0],
		["expand", f.strength >= 6 ? 1 : 0],
		["raid", f.aggression >= 2 && rivals.length ? f.aggression : 0],
		// The player's base: only the truly hostile, and not every night.
		["raid_base", base && near.includes(base) && (f.attitude <= -2 || (f.aggression >= 3 && f.attitude <= -1)) && at - (t.lastBaseRaid ?? -Infinity) >= 4 * DAY ? f.aggression / 2 : 0],
	];
	let r = rng.next() * weights.reduce((n, [, w]) => n + w, 0);
	let act = "scavenge";
	for (const [k, w] of weights) if (w > 0 && (r -= w) < 0) {
		act = k;
		break;
	}
	switch (act) {
		case "scavenge": {
			const target = near.filter((id) => id !== home && t.places[id]?.status === "intact" && id !== base);
			if (!target.length) return;
			const id = rng.pick(target);
			setPlace(t, id, "looted", at);
			stripLoot(state, id);
			addEvent(t, { at, kind: "looted", locId: id, factionId: f.id, text: `${f.name} stripped ${nameOfLoc(state, id)} of what was left.`, public: false });
			if (id === here) out.push(`TOWN — ${f.name} came through ${nameOfLoc(state, id)} tonight, where the party is, looking for supplies. Play the encounter (they may not know the player is here).`);
			return;
		}
		case "fortify":
			f.strength = Math.min(10, f.strength + 1);
			addEvent(t, { at, kind: "fortified", locId: home, factionId: f.id, text: `${f.name} dug in at ${nameOfLoc(state, home)} (strength ${f.strength}).`, public: false });
			return;
		case "retake": {
			const p = t.places[f.homeId!];
			const horde = t.hordes.find((h) => h.at === f.homeId);
			if (horde && horde.size > f.strength * 5) return;
			setPlace(t, f.homeId!, "held", at, f.id);
			if (p?.status === "overrun") f.strength = Math.max(1, f.strength - 1);
			addEvent(t, { at, kind: "retook", locId: f.homeId, factionId: f.id, text: `${f.name} took ${nameOfLoc(state, f.homeId)} back.`, public: true });
			return;
		}
		case "expand": {
			const target = near.filter((id) => id !== home && id !== base && (t.places[id]?.status === "looted" || t.places[id]?.status === "intact") && !t.places[id]?.heldBy);
			if (!target.length) return;
			const id = rng.pick(target);
			setPlace(t, id, "held", at, f.id);
			addEvent(t, { at, kind: "expanded", locId: id, factionId: f.id, text: `${f.name} moved people into ${nameOfLoc(state, id)} and now hold it.`, public: true });
			return;
		}
		case "raid": {
			const o = rng.pick(rivals);
			const won = f.strength + rng.int(1, 6) > o.strength + rng.int(1, 6);
			const loser = won ? o : f;
			loser.strength = Math.max(1, loser.strength - rng.int(1, 2));
			if (won && o.homeId && rng.next() < 0.4) {
				setPlace(t, o.homeId, rng.next() < 0.3 ? "burned" : "looted", at);
				stripLoot(state, o.homeId);
			}
			addEvent(t, { at, kind: "raid", locId: o.homeId, factionId: f.id, text: `${f.name} raided ${o.name} at ${nameOfLoc(state, o.homeId)}: ${won ? `${o.name} lost people and supplies${t.places[o.homeId!]?.status === "burned" ? "; the place burned" : ""}` : `${o.name} drove them off`}.`, public: true });
			if (o.homeId === here || f.homeId === here) out.push(`TOWN — tonight ${f.name} attack ${o.name} at ${nameOfLoc(state, o.homeId)}, where the party is. Gunfire, shouting: play it.`);
			return;
		}
		case "raid_base": {
			t.lastBaseRaid = at;
			addEvent(t, { at, kind: "raid_base", locId: base, factionId: f.id, text: `${f.name} came for the player's base at ${nameOfLoc(state, base)}.`, public: false });
			out.push(`TOWN — ${f.name} move on the player's base at ${nameOfLoc(state, base)} tonight (attitude ${f.attitude}, strength ${f.strength}; their goal: ${f.goal}). ${here === base ? "The party is there: play the standoff or the attack." : "The party is away: those at the base face it; the player hears of it (radio, a runner) or finds out on return."} Raiders use z-raider-thug/gunman; a toll comes out with take_from_stash.`);
			return;
		}
	}
}

// ─── knowledge ─────────────────────────────────────────────────────────────

/**
 * The party is at `id`: they see what the place has become. Returns what
 * changed since their last visit (for the travel result), and marks those
 * events known.
 */
export function visitPlace(state: GameState, id: string): string | undefined {
	const t = state.town;
	if (!t) return undefined;
	const now = gameMinutes(state.time);
	const p = (t.places[id] ??= { status: "intact", since: now });
	const last = p.lastVisit;
	const news = t.events.filter((e) => e.locId === id && !e.known && e.at <= now);
	for (const e of news) e.known = true;
	const changed = p.knownStatus !== undefined && (p.knownStatus !== p.status || p.knownHeldBy !== p.heldBy);
	p.knownStatus = p.status;
	if (p.heldBy) p.knownHeldBy = p.heldBy;
	else delete p.knownHeldBy;
	p.lastVisit = now;
	for (const h of t.hordes) if (h.at === id) h.known = true;
	for (const f of Object.values(t.factions)) if (p.heldBy === f.id) f.known = true;
	if (!news.length && !changed) return undefined;
	const holder = p.heldBy ? t.factions[p.heldBy]?.name : undefined;
	return `TOWN — since the player was last here${last !== undefined ? ` (day ${Math.floor(last / DAY)})` : ""}: ${news.map((e) => `day ${Math.floor(e.at / DAY)}: ${e.text}`).join(" ")}${changed ? ` Now: ${p.status}${holder ? ` (held by ${holder})` : ""}.` : ""} Show the traces when they look around (bodies, burnt-out cars, new barricades, sentries).`;
}

/** Marks town events as known (heard on the radio, told by someone). */
export function learnEvents(state: GameState, ids: string[]): void {
	const t = state.town;
	if (!t) return;
	for (const e of t.events) {
		if (!ids.includes(e.id)) continue;
		e.known = true;
		const p = e.locId ? t.places[e.locId] : undefined;
		if (p) {
			p.knownStatus = p.status;
			if (p.heldBy) p.knownHeldBy = p.heldBy;
			else delete p.knownHeldBy;
		}
		const h = e.hordeId ? t.hordes.find((x) => x.id === e.hordeId) : undefined;
		if (h) h.known = true;
		if (e.factionId && t.factions[e.factionId]) t.factions[e.factionId].known = true;
	}
}

// ─── tick ──────────────────────────────────────────────────────────────────

/** Advances the town to now. First call seeds it (no catch-up) and asks the DM to review it. */
export function townTick(state: GameState, rng: Rng): string | undefined {
	if (!isZombie(state)) return undefined;
	const out: string[] = [];
	if (!state.town) {
		initTown(state, rng);
		out.push(townReviewNote(state));
	}
	const t = state.town!;
	const now = gameMinutes(state.time);
	if (now > t.lastTick) {
		moveHordes(state, t, rng, now, out);
		const first = Math.floor((t.lastTick - NIGHT) / DAY) + 1;
		const last = Math.floor((now - NIGHT) / DAY);
		// At most the last 3 nights of a long jump (a week's rest doesn't rewrite the town).
		for (let d = Math.max(first, last - 2); d <= last; d++) {
			const at = d * DAY + NIGHT;
			for (const f of Object.values(t.factions)) factionNight(state, t, rng, f, at, out);
		}
		t.lastTick = now;
	}
	const here = state.world.currentLocationId;
	if (here && state.town?.places[here]?.lastVisit !== undefined) {
		const p = state.town.places[here];
		p.knownStatus = p.status;
		p.lastVisit = now;
	}
	return out.join("\n") || undefined;
}

function townReviewNote(state: GameState): string {
	const t = state.town!;
	return `TOWN SEEDED (one-time, DM only): Kessler Falls now moves without the player: factions act each night, hordes drift between places. Starting picture: ${Object.values(t.factions)
		.map((f) => `${f.name} [${f.id}] at ${nameOfLoc(state, f.homeId)}, strength ${f.strength}, attitude ${f.attitude}${f.known ? ", known" : ""}`)
		.join("; ")}. Before anything else, make it match the story so far with update_town: each faction's attitude toward the player (-3 hostile … +3 allied), their strength, goal, which NPCs belong to them, and any place the story already changed (taken, burned, overrun). Mark reviewed=true when done.`;
}

// ─── digest ────────────────────────────────────────────────────────────────

export function townDigest(state: GameState): string | undefined {
	const t = state.town;
	if (!t) return undefined;
	const now = gameMinutes(state.time);
	const fs = Object.values(t.factions).filter((f) => f.status !== "gone");
	const hordes = t.hordes.map((h) => `~${h.size} at ${nameOfLoc(state, h.at)}${h.heading ? ` → ${nameOfLoc(state, h.heading)}` : ""}${h.known ? " (player knows)" : ""}`);
	const changed = Object.entries(t.places)
		.filter(([, p]) => p.status !== "intact")
		.map(([id, p]) => `${nameOfLoc(state, id)}: ${p.status}${p.heldBy ? ` by ${t.factions[p.heldBy]?.name ?? p.heldBy}` : ""}`);
	const recent = t.events.filter((e) => now - e.at <= 2 * DAY).map((e) => `day ${Math.floor(e.at / DAY)}: ${e.text}${e.known ? "" : " (player doesn't know)"}`);
	return [
		`TOWN (the truth; the player knows only what they saw, were told or heard on the radio)${t.reviewed ? "" : " — NOT REVIEWED YET: fix factions with update_town and set reviewed=true"}:`,
		`Factions: ${fs.map((f) => `${f.name} [${f.id}] ${f.status}${f.homeId ? ` at ${nameOfLoc(state, f.homeId)}` : ""}, str ${f.strength}, attitude ${f.attitude >= 0 ? "+" : ""}${f.attitude}, aggression ${f.aggression}, goal: ${f.goal}`).join("; ")}`,
		`Hordes: ${hordes.join("; ") || "none"}`,
		changed.length ? `Places: ${changed.join("; ")}` : "",
		recent.length ? `Last two days: ${recent.join(" ")}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

// ─── DM edits ──────────────────────────────────────────────────────────────

export type UpdateTownArgs = {
	factions?: (Partial<Omit<TownFaction, "id">> & { id: string; remove?: boolean })[];
	hordes?: { id?: string; size?: number; at?: string; heading?: string; known?: boolean; remove?: boolean }[];
	places?: { locationId: string; status: PlaceStatus; heldBy?: string; known?: boolean }[];
	events?: { text: string; locationId?: string; factionId?: string; public?: boolean; known?: boolean }[];
	reviewed?: boolean;
};

export function updateTown(state: GameState, rng: Rng, a: UpdateTownArgs): string {
	if (!isZombie(state)) throw new Error("Only in The Quiet.");
	const t = state.town ?? initTown(state, rng);
	const now = gameMinutes(state.time);
	const loc = (id: string | undefined) => {
		if (!id) return undefined;
		const l = state.world.locations.find((x) => x.id === id || x.name.toLowerCase() === id.toLowerCase());
		if (!l) throw new Error(`Unknown location ${id}.`);
		return l.id;
	};
	const out: string[] = [];
	for (const f of a.factions ?? []) {
		if (f.remove) {
			delete t.factions[f.id];
			out.push(`Faction ${f.id} removed.`);
			continue;
		}
		const cur = t.factions[f.id];
		if (!cur && !f.name) throw new Error(`New faction ${f.id} needs a name.`);
		const { remove: _r, homeId, ...rest } = f;
		void _r;
		t.factions[f.id] = { ...(cur ?? { id: f.id, name: f.name!, strength: 4, attitude: 0, goal: "", aggression: 1, known: false, status: "active" }), ...rest, ...(homeId !== undefined ? { homeId: loc(homeId) } : {}) };
		const nf = t.factions[f.id];
		nf.strength = Math.max(0, Math.min(10, nf.strength));
		nf.attitude = Math.max(-3, Math.min(3, nf.attitude));
		nf.aggression = Math.max(0, Math.min(3, nf.aggression));
		out.push(`${nf.name} [${nf.id}]: str ${nf.strength}, attitude ${nf.attitude}, ${nf.status}.`);
	}
	for (const h of a.hordes ?? []) {
		const cur = h.id ? t.hordes.find((x) => x.id === h.id) : undefined;
		if (h.remove) {
			t.hordes = t.hordes.filter((x) => x.id !== h.id);
			out.push(`Horde ${h.id} gone.`);
			continue;
		}
		if (cur) {
			if (h.size !== undefined) cur.size = Math.max(0, h.size);
			if (h.at) cur.at = loc(h.at)!;
			if (h.heading) cur.heading = loc(h.heading);
			if (h.known !== undefined) cur.known = h.known;
			out.push(`Horde ${cur.id}: ~${cur.size} at ${nameOfLoc(state, cur.at)}.`);
		} else {
			if (!h.at || !h.size) throw new Error("A new horde needs at and size.");
			const nh: Horde = { id: `h${Date.now().toString(36).slice(-4)}${t.hordes.length}`, size: h.size, at: loc(h.at)!, ...(h.heading ? { heading: loc(h.heading) } : {}), nextMoveAt: now + 6 * HOUR, known: h.known ?? false };
			t.hordes.push(nh);
			out.push(`New horde ${nh.id}: ~${nh.size} at ${nameOfLoc(state, nh.at)}.`);
		}
	}
	for (const p of a.places ?? []) {
		const id = loc(p.locationId)!;
		if (p.heldBy && !t.factions[p.heldBy]) throw new Error(`Unknown faction ${p.heldBy}.`);
		setPlace(t, id, p.status, now, p.status === "held" ? p.heldBy : undefined);
		if (p.known) {
			t.places[id].knownStatus = p.status;
			if (p.heldBy) t.places[id].knownHeldBy = p.heldBy;
		}
		out.push(`${nameOfLoc(state, id)} is now ${p.status}.`);
	}
	for (const e of a.events ?? []) {
		addEvent(t, { at: now, kind: "story", text: e.text, locId: loc(e.locationId), factionId: e.factionId, public: e.public ?? false, known: e.known ?? true });
		out.push(`Event noted.`);
	}
	if (a.reviewed) t.reviewed = true;
	return out.join("\n") || "Nothing changed.";
}
