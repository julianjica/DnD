import type { NextRequest } from "next/server";
import type { PlayerCombatAction } from "@/lib/game/types";
import { appendLog, campaignExists } from "@/lib/store/campaigns";
import { newId } from "@/lib/dm/context";
import { isTurnRunning, runTurn } from "@/lib/dm/turn";
import { withState, type ClientEvent } from "@/lib/dm/context";
import { isPcTurn, playerCombatAction } from "@/lib/dm/combat";
import { exploreMove } from "@/lib/dm/explore";
import { castSpell, spendFeatureUse, consumeItem } from "@/lib/dm/resources";
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
			let used: string | undefined;
			let crossedTo: string | undefined;
			const exploring = await withState(tctx, (tx) => {
				if (tx.state.encounter?.status !== "active") {
					// Out of combat: free movement, or spending a resource from the sheet.
					if (action.type === "move") crossedTo = exploreMove(tx.state, action.path).crossedTo;
					else if (action.type === "use_item") used = consumeItem(tx, { item: action.itemId });
					else if (action.type === "use_feature") used = spendFeatureUse(tx, { feature: action.featureId });
					else if (action.type === "cast") used = castSpell(tx, { spell: action.spell, slotLevel: action.slotLevel || undefined });
					else throw new Error("Not in combat.");
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
			if (exploring && used) {
				await runTurn({
					campaignId: id,
					text: `(I use this from my character sheet.)`,
					displayText: used.split(". ")[0].replace(/\.$/, "") + ".",
					systemNotes: [
						"The player used a resource from their sheet; the engine has ALREADY applied it (do NOT call cast_spell/use_item/use_feature for it again):",
						used,
						"Narrate the effect in the fiction (briefly), resolving anything the engine left to you, then suggest_actions.",
					],
					emit,
				});
				return;
			}
			if (exploring) {
				// Walked through a connected door: a marker in the chat (and the DM's history).
				if (crossedTo) appendLog(id, { id: newId("l"), role: "system", text: `→ ${crossedTo}`, ts: Date.now() });
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
