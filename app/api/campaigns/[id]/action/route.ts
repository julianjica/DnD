import type { NextRequest } from "next/server";
import type { PlayerCombatAction } from "@/lib/game/types";
import { campaignExists } from "@/lib/store/campaigns";
import { isTurnRunning, runTurn } from "@/lib/dm/turn";
import { withState, type ClientEvent } from "@/lib/dm/context";
import { isPcTurn, playerCombatAction } from "@/lib/dm/combat";
import { exploreMove } from "@/lib/dm/explore";
import { jsonError, sseResponse } from "@/lib/server/sse";

/**
 * POST { action: PlayerCombatAction } — the player's clicked combat action,
 * resolved by the engine immediately (SSE: rolls, fx, state). When the
 * player's turn ends (end_turn, or the PC drops), the DM takes over: it
 * narrates what happened and runs the monsters' turns.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/action">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	const body = (await req.json().catch(() => ({}))) as { action?: PlayerCombatAction };
	if (!body.action?.type) return jsonError("action required");
	const action = body.action;

	return sseResponse(async (emit: (e: ClientEvent) => void) => {
		const tctx = { campaignId: id, emit, rolls: [] };
		let handOff = false;
		let notes: string[] = [];
		try {
			const exploring = await withState(tctx, (tx) => {
				if (tx.state.encounter?.status !== "active") {
					if (action.type !== "move") throw new Error("Not in combat.");
					exploreMove(tx.state, action.path);
					return true;
				}
				if (!isPcTurn(tx.state)) throw new Error("It is not your turn.");
				const log = playerCombatAction(tx, action, tx.rng);
				tx.state.combatNotes = [...(tx.state.combatNotes ?? []), log].filter(Boolean);
				if (!isPcTurn(tx.state)) {
					handOff = true;
					notes = tx.state.combatNotes;
					tx.state.combatNotes = [];
				}
				return false;
			});
			if (exploring) {
				emit({ type: "done" });
				return;
			}
		} catch (error) {
			emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
			emit({ type: "done" });
			return;
		}
		if (!handOff) {
			emit({ type: "done" });
			return;
		}
		await runTurn({
			campaignId: id,
			text: "(The player ended their combat turn.)",
			displayText: "",
			systemNotes: [
				"The player's combat turn was resolved by the engine:",
				...notes,
				"Narrate the player's turn vividly in 1–2 short paragraphs, then resolve each non-player combatant's turn with monster_turn (or auto_monster_turns for minions) until it is the player's turn again or combat ends, narrating briefly. Then suggest_actions.",
			],
			emit,
		});
	});
}
