import type { NextRequest } from "next/server";
import type { PortraitSpec } from "@/lib/game/types";
import { campaignExists, mutate } from "@/lib/store/campaigns";
import { jsonError } from "@/lib/server/sse";

/** PUT { portrait } — the player edits their character's portrait (cosmetic only). */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/portrait">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	const body = (await req.json().catch(() => ({}))) as { portrait?: PortraitSpec };
	const p = body.portrait;
	if (!p || typeof p.seed !== "number" || typeof p.skinTone !== "string" || !Array.isArray(p.features)) return jsonError("portrait required");
	const state = await mutate(id, (s) => {
		s.character.portrait = p;
		return s;
	});
	return Response.json({ state });
}
