import type { ExpeditionGoal } from "../../game/types";
import { EXPEDITION_GOALS, expeditionEta, recallExpedition, sendExpedition } from "../../rules/expeditions";
import { isZombie } from "../../rules/survival";
import { S, newId, tool, withState, type ToolFactory } from "../context";

export const sendExpeditionTool = tool<{ members: string[]; locationId: string; goal: ExpeditionGoal; note?: string }>(
	"send_expedition",
	"The Quiet: send 1–3 companions on a run to another place on the player's map and back (longer and riskier than an errand). They walk the roads; the engine rolls what the living town throws at them at each stop (hordes, factions, overrun streets), does the job (scavenge: loot into the base/inventory; scout: the player's map learns the area; contact: talk to the faction holding the place; retrieve: what note says) and brings the survivors home. With a walkie-talkie (theirs, the player's, or the base radio) they check in at each stop. Use it when the player asks; the player can also plan one from the Group tab.",
	S.obj(
		{
			members: S.arr(S.str("Companion name or npc id"), "1–3 companions, all with the party or all at the base"),
			locationId: S.str("Destination: a world location id or name on the player's map"),
			goal: S.str(undefined, EXPEDITION_GOALS),
			note: S.str("What exactly (a message, an item, what to look for)"),
		},
		["members", "locationId", "goal"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isZombie(state)) throw new Error("Only in The Quiet.");
			const ex = sendExpedition(state, a, () => newId("ex"));
			const mins = expeditionEta(state, ex.originId, ex.targetId, ex.goal);
			return `Expedition [${ex.id}] set out: ${ex.members.map((id) => state.npcs[id]?.name ?? id).join(", ")} → ${state.world.locations.find((l) => l.id === ex.targetId)?.name} (${ex.goal}). Back in about ${Math.round(mins / 60)} h if nothing goes wrong. ${ex.comms ? "They have a walkie: check-ins will come." : "No radio: no news until they're back."} Play the goodbye briefly.`;
		}),
);

export const recallExpeditionTool = tool<{ expeditionId: string }>(
	"recall_expedition",
	"The Quiet: call an expedition back over the walkie; they turn around at their next stop.",
	S.obj({ expeditionId: S.str() }, ["expeditionId"]),
	async (a, ctx) => withState(ctx, ({ state }) => recallExpedition(state, a.expeditionId)),
);

export const EXPEDITION_TOOLS: ToolFactory[] = [sendExpeditionTool, recallExpeditionTool];
