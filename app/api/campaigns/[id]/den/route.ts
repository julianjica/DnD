import type { NextRequest } from "next/server";
import type { DenUpgradeId } from "@/lib/game/types";
import { clientState } from "@/lib/game/client";
import { appendLog, campaignExists, loadState } from "@/lib/store/campaigns";
import { isTurnRunning } from "@/lib/dm/turn";
import { newId, withState } from "@/lib/dm/context";
import { isCyber } from "@/lib/rules/cyber";
import { buyUpgrade, DEN_UPGRADE_IDS, payRent } from "@/lib/rules/den";
import { jsonError } from "@/lib/server/sse";
import { translate, type MessageKey } from "@/lib/i18n";

type DenOp = { op: "buy"; upgrade: DenUpgradeId } | { op: "pay"; amount: number };

/**
 * POST { op: "buy", upgrade } | { op: "pay", amount } — the player's Den tab
 * (Root Access): buy a den upgrade or pay La Tía, validated and applied by the
 * engine (lib/rules/den.ts). No DM turn; a system line in the log tells the DM.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	if (isTurnRunning(id)) return jsonError("The DM is still narrating.", 409);
	const body = (await req.json().catch(() => ({}))) as Partial<DenOp> & { upgrade?: string; amount?: number };
	if (body.op === "buy" && !DEN_UPGRADE_IDS.includes(body.upgrade as DenUpgradeId)) return jsonError("unknown upgrade");
	if (body.op === "pay" && !(typeof body.amount === "number" && body.amount > 0)) return jsonError("amount must be a positive number");
	if (body.op !== "buy" && body.op !== "pay") return jsonError("op must be buy or pay");
	const op = body as DenOp;
	try {
		let player = "";
		const text = await withState({ campaignId: id, emit: () => {}, rolls: [] }, ({ state }) => {
			if (!isCyber(state)) throw new Error("Only in Root Access.");
			if (state.encounter?.status === "active") throw new Error("Not in the middle of a fight.");
			if (state.cyber?.run) throw new Error("Not while jacked in.");
			const lang = state.settings.language === "es" ? "es" : "en";
			if (op.op === "buy") {
				const r = buyUpgrade(state, op.upgrade);
				if (!r.ok) throw new Error(r.text);
				const name = translate(lang, `play.den.up.${op.upgrade}` as MessageKey) + ((r.level ?? 0) > 1 ? ` ${r.level}` : "");
				player = translate(lang, "play.den.log.bought", { name, n: r.price ?? 0 });
				return r.text;
			}
			const r = payRent(state, op.amount);
			if (!r.ok) throw new Error(r.text);
			player = translate(lang, "play.den.log.paid", { n: r.paid ?? 0 });
			return r.text;
		});
		appendLog(id, { id: newId("l"), role: "system", text: player, ts: Date.now() });
		return Response.json({ text: text.split("\n")[0], state: clientState(loadState(id)) });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : String(error));
	}
}
