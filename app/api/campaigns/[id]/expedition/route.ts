import type { NextRequest } from "next/server";
import type { ExpeditionGoal } from "@/lib/game/types";
import { campaignExists } from "@/lib/store/campaigns";
import { isTurnRunning, runTurn } from "@/lib/dm/turn";
import { newId, withState, type ClientEvent } from "@/lib/dm/context";
import { recallExpedition, sendExpedition } from "@/lib/rules/expeditions";
import { jsonError, sseResponse } from "@/lib/server/sse";

type Body = { op: "send"; members: string[]; locationId: string; goal: ExpeditionGoal; note?: string; label?: string } | { op: "recall"; expeditionId: string; label?: string };

/** POST — the player sends companions on an expedition (or calls one back); the DM plays the moment. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/expedition">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	const body = (await req.json().catch(() => ({}))) as Body;
	if (body.op !== "send" && body.op !== "recall") return jsonError("op must be send or recall");

	return sseResponse(async (emit: (e: ClientEvent) => void) => {
		let facts: string;
		try {
			facts = await withState({ campaignId: id, emit, rolls: [] }, ({ state }) => {
				if (body.op === "recall") return recallExpedition(state, body.expeditionId);
				const ex = sendExpedition(state, body, () => newId("ex"));
				const names = ex.members.map((m) => state.npcs[m]?.name ?? m).join(", ");
				const to = state.world.locations.find((l) => l.id === ex.targetId)?.name;
				return `Expedition [${ex.id}]: ${names} set out for ${to} (${ex.goal}${ex.note ? `: ${ex.note}` : ""}). ${ex.comms ? "They carry a walkie: check-ins will come." : "No radio: no news until they're back."}`;
			});
		} catch (error) {
			emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
			emit({ type: "done" });
			return;
		}
		await runTurn({
			campaignId: id,
			text: body.op === "send" ? "(I send them out on the expedition.)" : "(I call the team back on the walkie.)",
			displayText: body.label ?? "",
			systemNotes: [
				body.op === "send" ? "The player sent companions on an expedition from the Group tab; the engine has ALREADY started it (don't call send_expedition):" : "The player called the expedition back over the walkie; the engine has ALREADY sent the recall:",
				facts,
				body.op === "send" ? "Play the departure in a few lines (packing, a joke or a fear, the door closing), then suggest_actions." : "Play the short radio exchange (call broadcast station walkie with the expeditionId), then suggest_actions.",
			],
			emit,
		});
	});
}
