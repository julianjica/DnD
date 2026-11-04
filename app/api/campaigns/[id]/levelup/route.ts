import { clientState } from "@/lib/game/client";
import type { NextRequest } from "next/server";
import { campaignExists, loadState, appendLog } from "@/lib/store/campaigns";
import { canLevelUp, canMulticlass, levelUp, levelUpOptions } from "@/lib/rules/character";
import { withState, newId } from "@/lib/dm/context";
import { getClass } from "@/lib/srd";
import { jsonError } from "@/lib/server/sse";

function available(state: ReturnType<typeof loadState>): boolean {
	return state.settings.structure.leveling === "xp" ? canLevelUp(state.character) : (state.levelUpsGranted ?? 0) > 0;
}

/** GET ?classId= → { available, options, classes } */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/levelup">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	const state = loadState(id);
	const classId = req.nextUrl.searchParams.get("classId") ?? state.character.classes[0].classId;
	try {
		const options = levelUpOptions(state.character, classId);
		const multiclass = ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"].filter(
			(c) => state.character.classes.some((k) => k.classId === c) || canMulticlass(state.character, c),
		);
		return Response.json({ available: available(state), options, classes: multiclass.map((c) => ({ index: c, name: getClass(c)?.name ?? c })) });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : String(error));
	}
}

/** POST { classId, choices, hp: "average" | "roll" } */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/levelup">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	const body = (await req.json().catch(() => ({}))) as { classId?: string; choices?: Record<string, string[]>; hp?: "average" | "roll" };
	const events: unknown[] = [];
	try {
		const result = await withState({ campaignId: id, emit: (e) => events.push(e), rolls: [] }, (tx) => {
			const { state, rng } = tx;
			if (!available(state)) throw new Error("No level-up available.");
			const milestone = state.settings.structure.leveling === "milestone";
			const res = levelUp(state.character, body.classId ?? state.character.classes[0].classId, body.choices ?? {}, { hp: body.hp ?? "average", rng, ignoreXp: milestone });
			state.character = res.character;
			if (milestone) state.levelUpsGranted = Math.max(0, (state.levelUpsGranted ?? 1) - 1);
			const lvl = res.character.classes.reduce((n, c) => n + c.level, 0);
			tx.fx({ kind: "level_up", level: lvl });
			state.dmNotes.push(`Player reached level ${lvl} (${body.classId}); new features: ${res.newFeatures.map((f) => f.name).join(", ") || "none"}.`);
			return { level: lvl, hpGained: res.hpGained, newFeatures: res.newFeatures, autoChoices: res.autoChoices };
		});
		appendLog(id, { id: newId("l"), role: "system", text: `Level up! Now level ${result.level} (+${result.hpGained} HP).`, ts: Date.now() });
		return Response.json({ ...result, state: clientState(loadState(id)) });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : String(error));
	}
}
