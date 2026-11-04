import type { GameState } from "./types";

/**
 * The state as the browser may see it: engine secrets stripped (the hour a
 * bitten character turns is rolled in secret and known only to the DM).
 */
export function clientState(state: GameState): GameState {
	const inf = state.survival?.infection;
	if (!inf) return state;
	const { turnsAt: _secret, ...visible } = inf;
	void _secret;
	return { ...state, survival: { ...state.survival!, infection: { ...visible, turnsAt: 0 } } };
}
