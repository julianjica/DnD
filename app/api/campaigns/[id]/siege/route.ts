import type { NextRequest } from "next/server";
import { campaignExists } from "@/lib/store/campaigns";
import { isTurnRunning, runTurn } from "@/lib/dm/turn";
import { withState, type ClientEvent } from "@/lib/dm/context";
import { siegeWave } from "@/lib/dm/tools/siege";
import { assignPost, PC_SIEGE_ACTIONS, setLights, type PcSiegeAction } from "@/lib/rules/siege";
import { isZombie } from "@/lib/rules/survival";
import { jsonError, sseResponse } from "@/lib/server/sse";

type SiegeOp =
	| { op: "assign"; who: string; x?: number; y?: number }
	| { op: "lights"; on: boolean }
	| { op: "wave"; action?: PcSiegeAction; moveTo?: { x: number; y: number } };

/**
 * POST { op } — the player's siege controls (The Quiet), resolved by the engine
 * at once (SSE: rolls, state). Setting posts and lights is silent; a wave is
 * silent too, except the moments the DM narrates: the dead arriving, a breach
 * (the engine has started the fight) and the end of the night.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/siege">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	const body = (await req.json().catch(() => ({}))) as Partial<SiegeOp>;
	if (body.op !== "assign" && body.op !== "lights" && body.op !== "wave") return jsonError("op must be assign, lights or wave");
	if (body.op === "wave" && body.action && !PC_SIEGE_ACTIONS.includes(body.action)) return jsonError("unknown action");
	const op = body as SiegeOp;

	return sseResponse(async (emit: (e: ClientEvent) => void) => {
		const tctx = { campaignId: id, emit, rolls: [] };
		let narrate: string | undefined;
		try {
			narrate = await withState(tctx, (tx) => {
				if (!isZombie(tx.state)) throw new Error("Only in The Quiet.");
				if (!tx.state.siege) throw new Error("There is no siege.");
				if (op.op === "assign") {
					assignPost(tx.state, op.who, typeof op.x === "number" && typeof op.y === "number" ? { x: op.x, y: op.y } : undefined);
					return undefined;
				}
				if (op.op === "lights") {
					setLights(tx.state, !!op.on);
					return undefined;
				}
				const res = siegeWave(tx, { action: op.action, moveTo: op.moveTo });
				return res.narrate ? res.text : undefined;
			});
		} catch (error) {
			emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
			emit({ type: "done" });
			return;
		}
		if (!narrate) {
			emit({ type: "done" });
			return;
		}
		await runTurn({
			campaignId: id,
			text: "(I hold the line.)",
			displayText: "",
			systemNotes: [
				"The player is holding the base against the night siege. The engine has ALREADY resolved this (do NOT call siege_wave or damage_barricade for it, do NOT start another fight):",
				narrate,
				"Narrate it in 1–2 short paragraphs, in the player's language, with the player at the centre (their post, their shots, the planks they nail): the dead reaching the walls, the breach and the fight it started, or the dawn and its toll. If a fight was started, run the non-player turns as usual. Then suggest_actions.",
			],
			emit,
		});
	});
}
