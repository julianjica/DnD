import type { NextRequest } from "next/server";
import { deleteApiKey, listKeyStatuses, saveApiKey } from "@/lib/engines";
import { jsonError } from "@/lib/server/sse";

export async function GET() {
	return Response.json({ keys: listKeyStatuses() });
}

/** POST { provider, key } saves; { provider, key: "" } deletes. */
export async function POST(req: NextRequest) {
	const body = (await req.json().catch(() => ({}))) as { provider?: string; key?: string };
	if (!body.provider) return jsonError("provider required");
	try {
		const status = body.key ? saveApiKey(body.provider, body.key.trim()) : deleteApiKey(body.provider);
		return Response.json({ status });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : String(error));
	}
}
