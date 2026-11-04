import { clientState } from "@/lib/game/client";
import { rulesetOf } from "@/lib/rules/ruleset";
import type { NextRequest } from "next/server";
import type { CampaignSettings } from "@/lib/game/types";
import { campaignExists, mutate } from "@/lib/store/campaigns";
import { getEngine } from "@/lib/engines";
import { describeSettingsChange } from "@/lib/dm/settings-diff";
import { jsonError } from "@/lib/server/sse";

/**
 * PATCH { settings: Partial<CampaignSettings> } — deep-merges one level.
 * Records a notice for the DM's next turn; resets the engine session when
 * the engine/model changes.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/settings">) {
	const { id } = await ctx.params;
	if (!campaignExists(id)) return jsonError("Campaign not found", 404);
	const body = (await req.json().catch(() => ({}))) as { settings?: Partial<CampaignSettings>; title?: string };
	const state = await mutate(id, (s) => {
		const before = s.settings;
		const patch = body.settings ?? {};
		const next = { ...before } as CampaignSettings;
		for (const key of Object.keys(patch) as (keyof CampaignSettings)[]) {
			const v = patch[key];
			next[key] = (v && typeof v === "object" ? { ...(before[key] as object), ...v } : v) as never;
		}
		// The ruleset (fantasy vs The Quiet) is fixed for a campaign's lifetime.
		if (rulesetOf(before) !== rulesetOf(next)) next.world = { ...next.world, preset: before.world.preset };
		const notice = describeSettingsChange(before, next);
		if (notice) s.dmNotes.push(`SETTINGS CHANGED: ${notice}`);
		if (before.engine.provider !== next.engine.provider || before.engine.model !== next.engine.model || (before.language ?? "en") !== (next.language ?? "en")) {
			getEngine(before.engine.provider).resetSession(id);
		}
		s.settings = next;
		if (body.title) s.title = body.title.slice(0, 120);
		return s;
	});
	return Response.json({ state: clientState(state) });
}
