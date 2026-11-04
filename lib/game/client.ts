import type { GameState, GroupState } from "./types";

/**
 * The state as the browser may see it: engine secrets stripped (the hour a
 * bitten character or companion turns is rolled in secret and known only to the DM).
 */
export function clientState(state: GameState): GameState {
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
