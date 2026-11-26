import type { NextRequest } from "next/server";
import { clientState } from "@/lib/game/client";
import { appendLog, campaignExists, loadState } from "@/lib/store/campaigns";
import { isTurnRunning } from "@/lib/dm/turn";
import { newId, withState } from "@/lib/dm/context";
import { BASE_DOWNTIME_OPS, baseDowntime, downtimeLogEntry, type BaseDowntimeOp } from "@/lib/dm/downtime";
import { jsonError } from "@/lib/server/sse";

/**
 * POST — The Quiet's Group tab, played directly (lib/dm/downtime.ts):
 * { op: "stash", items: [{ itemId, qty? }] } | { op: "take", kind, qty } |
 * { op: "build", upgrade } | { op: "errand", npcId, task, hours } |
 * { op: "place", npcId, status: "with_party" | "at_base" }. Validated and
 * applied by the engine (lib/rules/base.ts, group.ts). No DM turn: one system
 * line in the log, with the engine's facts for the DM's next digest.
 * (Expeditions keep their own route: they start a DM turn.)
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	const body = (await req.json().catch(() => ({}))) as { op?: string };
	if (!(BASE_DOWNTIME_OPS as readonly string[]).includes(body.op as string)) return jsonError(`op must be ${BASE_DOWNTIME_OPS.join(", ")}`);
	try {
		let log = "";
		const text = await withState({ campaignId: id, emit: () => {}, rolls: [] }, ({ state }) => {
			const r = baseDowntime(state, body as BaseDowntimeOp, () => newId("it"));
			log = r.log;
			return r.engine;
		});
		appendLog(id, downtimeLogEntry(newId("l"), log, text));
		return Response.json({ text: log, state: clientState(loadState(id)) });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : String(error));
	}
}
