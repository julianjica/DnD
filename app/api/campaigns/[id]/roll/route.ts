import type { NextRequest } from "next/server";
import { campaignExists } from "@/lib/store/campaigns";
import { isTurnRunning, runTurn } from "@/lib/dm/turn";
import { withState, type ClientEvent } from "@/lib/dm/context";
import { roll, signed } from "@/lib/rules/dice";
import { checkBreakdown } from "@/lib/rules/character";
import type { RollCheck } from "@/lib/game/types";
import { jsonError, sseResponse } from "@/lib/server/sse";

/** POST → the player rolls the DM's pending roll; the DM then continues. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/roll">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	return sseResponse(async (emit: (e: ClientEvent) => void) => {
		const tctx = { campaignId: id, emit, rolls: [] };
		let summary = "";
		try {
			summary = await withState(tctx, ({ state, rng, roll: record }) => {
				const p = state.pendingRoll;
				if (!p) throw new Error("No roll pending.");
				const c = state.character;
				let notation = p.notation;
				let check: RollCheck | undefined;
				if ((p.kind === "check" || p.kind === "save") && (p.ability || p.skill)) {
					const b = checkBreakdown(c, { kind: p.kind, ability: p.ability, skill: p.skill });
					check = b.check;
					if (notation === "1d20") notation = `1d20${signed(b.mod)}`;
				}
				const r = roll(rng, notation, { label: p.label, advantage: p.advantage, target: p.dc, actor: c.id });
				if (check) r.check = check;
				record(r);
				state.pendingRoll = undefined;
				return `${p.label}: rolled ${r.total}${p.dc !== undefined ? ` vs DC ${p.dc} → ${r.success ? "SUCCESS" : "FAILURE"}` : ""}`;
			});
		} catch (error) {
			emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
			emit({ type: "done" });
			return;
		}
		await runTurn({ campaignId: id, text: `(I roll.) ${summary}`, displayText: `🎲 ${summary}`, emit });
	});
}
