import type { NextRequest } from "next/server";
import { campaignExists } from "@/lib/store/campaigns";
import { isTurnRunning, runTurn } from "@/lib/dm/turn";
import { withState, type ClientEvent } from "@/lib/dm/context";
import { roll, signed } from "@/lib/rules/dice";
import { saveMod, skillMod } from "@/lib/rules/character";
import { abilityMod } from "@/lib/rules/dice";
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
				if (notation === "1d20") {
					const mod = p.kind === "save" && p.ability ? saveMod(c, p.ability) : p.skill ? skillMod(c, p.skill) : p.ability ? abilityMod(c.abilities[p.ability]) : 0;
					notation = `1d20${signed(mod - 2 * c.exhaustion)}`;
				}
				const r = roll(rng, notation, { label: p.label, advantage: p.advantage, target: p.dc, actor: c.id });
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
