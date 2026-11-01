import type { NextRequest } from "next/server";
import { campaignExists, deleteCampaign, loadState, readLog } from "@/lib/store/campaigns";
import { isTurnRunning } from "@/lib/dm/turn";
import { jsonError } from "@/lib/server/sse";

/** GET → { state, log, running } */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	return Response.json({ state: loadState(id), log: readLog(id, { limit: 300 }), running: isTurnRunning(id) });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]">) {
	const { id } = await ctx.params;
	deleteCampaign(id);
	return Response.json({ ok: true });
}
