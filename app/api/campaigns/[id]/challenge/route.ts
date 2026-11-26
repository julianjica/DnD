import type { NextRequest } from "next/server";
import { campaignExists, mutate } from "@/lib/store/campaigns";
import { isTurnRunning, runTurn } from "@/lib/dm/turn";
import { withState, type ClientEvent } from "@/lib/dm/context";
import { challengeStep } from "@/lib/dm/tools/challenge";
import { abandonChallenge, dismissChallenge } from "@/lib/rules/challenge";
import { jsonError, sseResponse } from "@/lib/server/sse";

type ChallengeOp = { op: "pick"; stage: number; approach: number } | { op: "abandon" } | { op: "dismiss" };

/**
 * POST { op } — the player's moves on the Challenge panel, resolved by the
 * engine at once (SSE: rolls, state) with no DM turn. When the challenge ends
 * (a pick that finishes it, or the player breaking off), ONE DM turn follows
 * to narrate the engine's summary. dismiss clears a finished challenge (or retries
 * its narration if the DM's end turn failed).
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/challenge">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	const body = (await req.json().catch(() => ({}))) as Partial<ChallengeOp> & { stage?: unknown; approach?: unknown };
	if (body.op !== "pick" && body.op !== "abandon" && body.op !== "dismiss") return jsonError("op must be pick, abandon or dismiss");
	if (body.op === "pick" && (typeof body.stage !== "number" || typeof body.approach !== "number")) return jsonError("pick needs stage and approach numbers");
	const op = body as ChallengeOp;

	return sseResponse(async (emit: (e: ClientEvent) => void) => {
		const tctx = { campaignId: id, emit, rolls: [] };
		let narrate: string | undefined;
		try {
			narrate = await withState(tctx, (tx) => {
				const ch = tx.state.challenge;
				if (!ch) throw new Error("There is no challenge.");
				if (op.op === "dismiss") return dismissChallenge(tx.state);
				if (op.op === "abandon") return abandonChallenge(tx.state, tx.rng, tx.roll);
				const r = challengeStep(tx, { stage: op.stage, approach: op.approach });
				return r.narrate ? r.text : undefined;
			});
		} catch (error) {
			emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
			emit({ type: "done" });
			return;
		}
		if (!narrate) {
			emit({ type: "done" });
			return;
		}
		let failed = false;
		let told = false;
		await runTurn({
			campaignId: id,
			text: "(The challenge is over.)",
			displayText: "",
			systemNotes: [
				"The player has just played a timed challenge on the Challenge panel. The engine has ALREADY resolved it and applied every cost (do NOT roll checks for it again, and do NOT call add_heat, make_noise, damage or remove_item for what it lists):",
				narrate,
				"Narrate it in a few lines (within your word budget), in the player's language, with the player at the centre: the key moments it lists and where it leaves them. Put any threshold the engine reports (noise, Heat) into play. Then suggest_actions (the player closes the result card themselves).",
			],
			emit: (e) => {
				if (e.type === "error") failed = true;
				if (e.type === "text" && e.delta.trim()) told = true;
				emit(e);
			},
		});
		// The end is narrated: the digest stops asking for it (a failed turn leaves it there for the next one).
		if (!failed && told)
			await mutate(id, (s) => {
				if (s.challenge && s.challenge.status !== "active") s.challenge.narrated = true;
			}).catch(() => undefined);
	});
}
