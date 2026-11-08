import type { GameState, GroupState, Survivor, TownState } from "./types";

/**
 * The state as the browser may see it: engine secrets stripped (the hour a
 * bitten character or companion turns is rolled in secret and known only to the DM).
 */
export function clientState(state: GameState): GameState {
	const out = hideDmNotes(hideExpeditions(hideProfiles(hideInfection(state))));
	const shown = state.town ? { ...out, town: clientTown(state.town) } : out;
	// The siege's end-of-night summary is the DM's instruction (it may name a secret infection).
	return shown.siege?.summary ? { ...shown, siege: { ...shown.siege, summary: undefined } } : shown;
}

/** NPC secrets and voice cards, story threads and pacing are the DM's working notes. */
function hideDmNotes(state: GameState): GameState {
	const npcs: GameState["npcs"] = {};
	for (const [id, n] of Object.entries(state.npcs)) {
		const { secret: _s, voice: _v, wants: _w, opinion: _o, ...rest } = n;
		void _s, void _v, void _w, void _o;
		npcs[id] = rest;
	}
	const { threads: _t, pacing: _p, canon: _c, canonMark: _m, ...rest } = state;
	void _t, void _p, void _c, void _m;
	return { ...rest, npcs, dmNotes: [] };
}

/** Expeditions as the player knows them: what they heard, not what happened out there. */
function hideExpeditions(state: GameState): GameState {
	const list = state.group?.expeditions;
	if (!list?.length) return state;
	const expeditions = list.map((ex) => ({
		id: ex.id,
		members: ex.members,
		from: ex.from,
		originId: ex.originId,
		targetId: ex.targetId,
		goal: ex.goal,
		...(ex.note ? { note: ex.note } : {}),
		startedAt: ex.startedAt,
		eta: ex.eta,
		path: [],
		nextAt: 0,
		at: ex.lastKnownAt ?? ex.originId,
		stage: ex.knownStage ?? "outbound",
		comms: ex.comms,
		events: [],
		...(ex.heard ? { heard: ex.heard } : {}),
		...(ex.lastKnownAt ? { lastKnownAt: ex.lastKnownAt } : {}),
		...(ex.lastHeardAt !== undefined ? { lastHeardAt: ex.lastHeardAt } : {}),
		haul: [],
		...(ex.recalled ? { recalled: true } : {}),
	}));
	// Out there, everyone is just "away on the run" until the player hears otherwise.
	const survivors = { ...state.group!.survivors };
	for (const ex of list) {
		// Even after silence they're missing, not dead, until someone finds out.
		if (ex.knownStage === "back") continue;
		for (const id of ex.members) {
			const sv = survivors[id];
			if (!sv) continue;
			const { infection: _i, ...rest } = sv;
			void _i;
			survivors[id] = { ...rest, status: "away", away: { until: ex.eta, task: "expedition", startedAt: ex.startedAt, from: ex.from } };
		}
	}
	return { ...state, group: { ...state.group!, survivors, expeditions } };
}

/** A companion's want / fear / secret reach the browser only once the player has learnt them. */
function hideProfiles(state: GameState): GameState {
	const g = state.group;
	const hidden = (sv: Survivor) => (["want", "fear", "secret"] as const).some((f) => sv[f] !== undefined && !sv.revealed?.includes(f));
	if (!g || !Object.values(g.survivors).some(hidden)) return state;
	const survivors: GroupState["survivors"] = {};
	for (const [id, sv] of Object.entries(g.survivors)) {
		if (!hidden(sv)) {
			survivors[id] = sv;
			continue;
		}
		const { want, fear, secret, ...rest } = sv;
		const known = sv.revealed ?? [];
		survivors[id] = { ...rest, ...(known.includes("want") && want !== undefined ? { want } : {}), ...(known.includes("fear") && fear !== undefined ? { fear } : {}), ...(known.includes("secret") && secret !== undefined ? { secret } : {}) };
	}
	return { ...state, group: { ...g, survivors } };
}

/** The town as the player knows it: no secret goals, unknown hordes or unseen changes. */
function clientTown(t: TownState): TownState {
	const places: TownState["places"] = {};
	for (const [id, p] of Object.entries(t.places)) {
		if (p.knownStatus === undefined) continue;
		places[id] = { status: p.knownStatus, ...(p.knownHeldBy ? { heldBy: p.knownHeldBy } : {}), since: 0, knownStatus: p.knownStatus, ...(p.knownHeldBy ? { knownHeldBy: p.knownHeldBy } : {}), ...(p.lastVisit !== undefined ? { lastVisit: p.lastVisit } : {}) };
	}
	const factions: TownState["factions"] = {};
	for (const f of Object.values(t.factions)) if (f.known) factions[f.id] = { ...f, goal: "", aggression: 0, strength: 0 };
	return {
		lastTick: t.lastTick,
		factions,
		hordes: t.hordes.filter((h) => h.known).map((h) => ({ id: h.id, size: h.size, at: h.at, nextMoveAt: 0, known: true })),
		places,
		events: t.events.filter((e) => e.known),
	};
}

function hideInfection(state: GameState): GameState {
	const inf = state.survival?.infection;
	const survivorsInfected = Object.values(state.group?.survivors ?? {}).some((sv) => sv.infection);
	if (!inf && !survivorsInfected) return state;
	let out: GameState = state;
	if (inf) {
		const { turnsAt: _secret, ...visible } = inf;
		void _secret;
		out = { ...out, survival: { ...state.survival!, infection: { ...visible, turnsAt: 0 } } };
	}
	if (survivorsInfected) {
		const survivors: GroupState["survivors"] = {};
		for (const [id, sv] of Object.entries(state.group!.survivors)) survivors[id] = sv.infection ? { ...sv, infection: { ...sv.infection, turnsAt: 0 } } : sv;
		out = { ...out, group: { ...state.group!, survivors } };
	}
	return out;
}
