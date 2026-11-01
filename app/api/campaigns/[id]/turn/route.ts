import type { NextRequest } from "next/server";
import { campaignExists } from "@/lib/store/campaigns";
import { abortTurn, isTurnRunning, runTurn } from "@/lib/dm/turn";
import { jsonError, sseResponse } from "@/lib/server/sse";

/** POST { text } → streams the DM's turn as SSE. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/turn">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	const body = (await req.json().catch(() => ({}))) as { text?: string };
	const text = (body.text ?? "").slice(0, 4000);
	return sseResponse((emit) => runTurn({ campaignId: id, text, emit }));
}

/** DELETE → abort the running turn. */
export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/turn">) {
	const { id } = await ctx.params;
	return Response.json({ aborted: abortTurn(id) });
}
