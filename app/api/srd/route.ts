import type { NextRequest } from "next/server";
import { creationOptions } from "@/lib/rules/character";
import { jsonError } from "@/lib/server/sse";

/** GET ?classId&speciesId&backgroundId&subspeciesId → CreationOptions for the wizard. */
export async function GET(req: NextRequest) {
	const p = req.nextUrl.searchParams;
	try {
		return Response.json(creationOptions(p.get("classId") ?? "fighter", p.get("speciesId") ?? "human", p.get("backgroundId") ?? "acolyte", p.get("subspeciesId") ?? undefined));
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : String(error));
	}
}
