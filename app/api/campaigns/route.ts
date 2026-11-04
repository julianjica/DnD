import { clientState } from "@/lib/game/client";
import type { NextRequest } from "next/server";
import { listCampaigns } from "@/lib/store/campaigns";
import { createGame, type NewGameInput } from "@/lib/dm/newgame";
import { jsonError } from "@/lib/server/sse";

export async function GET() {
	return Response.json({ campaigns: listCampaigns() });
}

/** POST NewGameInput → { state }. The opening narration is a separate POST /turn with empty text. */
export async function POST(req: NextRequest) {
	const body = (await req.json().catch(() => null)) as NewGameInput | null;
	if (!body?.settings || !body.character) return jsonError("settings and character required");
	try {
		return Response.json({ state: clientState(createGame(body)) });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : String(error));
	}
}
