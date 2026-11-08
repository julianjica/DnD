import type { GameState, GroupState, TownState } from "./types";

/**
 * The state as the browser may see it: engine secrets stripped (the hour a
 * bitten character or companion turns is rolled in secret and known only to the DM).
 */
export function clientState(state: GameState): GameState {
	return state.town ? { ...hideInfection(state), town: clientTown(state.town) } : hideInfection(state);
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
