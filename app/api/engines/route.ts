import { engineStatus, listModels, planLimits } from "@/lib/engines";

/** GET → { models, status, limits } for the engine picker and settings. */
export async function GET() {
	const [models, limits] = await Promise.all([listModels(), planLimits().catch(() => [])]);
	return Response.json({ models, status: engineStatus(), limits });
}
