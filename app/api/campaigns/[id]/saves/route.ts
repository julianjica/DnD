import type { NextRequest } from "next/server";
import { campaignExists, deleteSave, listSaves, loadSave, writeSave } from "@/lib/store/campaigns";
import { isTurnRunning } from "@/lib/dm/turn";
import { getEngine } from "@/lib/engines";
import { loadState } from "@/lib/store/campaigns";
import { jsonError } from "@/lib/server/sse";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/saves">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	return Response.json({ saves: listSaves(id) });
}

/** POST { op: "save", slot, label } | { op: "load", slot } | { op: "delete", slot } */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/saves">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("Wait for the DM to finish.", 409);
	const body = (await req.json().catch(() => ({}))) as { op?: string; slot?: string; label?: string };
	try {
		if (body.op === "save") return Response.json({ save: writeSave(id, body.slot ?? `slot-${Date.now()}`, body.label ?? "Manual save") });
		if (body.op === "load" && body.slot) {
			const state = loadSave(id, body.slot);
			// The engine session remembers events after the save point: start fresh.
			getEngine(loadState(id).settings.engine.provider).resetSession(id);
			return Response.json({ state });
		}
		if (body.op === "delete" && body.slot) {
			deleteSave(id, body.slot);
			return Response.json({ ok: true });
		}
		return jsonError("Unknown op");
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : String(error));
	}
}
