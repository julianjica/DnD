import type { NextRequest } from "next/server";
import type { RadioStation } from "@/lib/game/types";
import { campaignExists } from "@/lib/store/campaigns";
import { isTurnRunning, runTurn } from "@/lib/dm/turn";
import { withState, type ClientEvent } from "@/lib/dm/context";
import { tune, type Tuning } from "@/lib/rules/radio";
import { jsonError, sseResponse } from "@/lib/server/sse";

/**
 * POST { station } — the player tunes the radio for ten minutes. The engine
 * decides what is on the air; the DM writes the words (broadcast tool) and
 * narrates the reaction.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/radio">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	const body = (await req.json().catch(() => ({}))) as { station?: RadioStation; label?: string };
	if (!body.station) return jsonError("station required");
	const station = body.station;

	return sseResponse(async (emit: (e: ClientEvent) => void) => {
		let tuning: Tuning;
		try {
			tuning = await withState({ campaignId: id, emit, rolls: [] }, ({ state, rng, fx }) => {
				const t = tune(state, rng, station);
				fx({ kind: "sfx", sound: "radio" });
				return t;
			});
		} catch (error) {
			emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
			emit({ type: "done" });
			return;
		}
		await runTurn({
			campaignId: id,
			text: `(I tune the radio to ${station} and listen for a while.)`,
			displayText: body.label ?? `📻 ${station}`,
			systemNotes: [
				`The player listened to the radio (${station}) for ten minutes; the engine already advanced the clock.`,
				`What is on the air: ${tuning.facts}`,
				...(tuning.revealed ? [`${tuning.revealed} is now marked on the player's map.`] : []),
				"Call broadcast {station, text} with exactly what they hear (campaign language), then narrate their reaction in a few lines and suggest_actions. Add no facts beyond these.",
			],
			emit,
		});
	});
}
