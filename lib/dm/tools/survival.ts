import type { BodyPart } from "../../game/types";
import { addNoise, amputate, isZombie } from "../../rules/survival";
import { S, tool, withState, type ToolFactory } from "../context";

/**
 * The Quiet: survival tools for the DM (docs/zombie.md §5). The engine owns
 * noise, infection and amputation; these tools only exist in zombie campaigns
 * (they refuse elsewhere).
 */

const notZombie = "This tool only exists in The Quiet (zombie-ruleset campaigns).";

export const makeNoiseTool = tool<{ amount: number; reason: string }>(
	"make_noise",
	"The Quiet: something loud happens where the player is (not their gunshots or loud techniques: the engine counts those). Typical: shouting 1, breaking glass 2, a slammed door or crash 2, a car alarm 4, an explosion 5. Noise 0–10 decays 1 per 10 quiet minutes and resets when the party moves elsewhere. Crossing 4 brings wanderers, 7 a pack, 10 a horde (one step worse at night); the engine rolls what comes and when, and you must then put them in play.",
	S.obj({ amount: S.int("Noise added, 1–10", 1, 10), reason: S.str("What made it: 'car alarm', 'window smashed'") }, ["amount", "reason"]),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			if (!isZombie(state)) throw new Error(notZombie);
			return addNoise(state, rng, a.amount, a.reason);
		}),
);

export const amputateTool = tool<{ part: BodyPart; reason: string }>(
	"amputate",
	"The Quiet: cut off the player's arm or leg (a desperate act: adjudicate any check first, e.g. Medicine or a steady hand, and call this once it happens). Within 60 minutes of a bite on that same limb it STOPS the LAZARUS infection; later, or another limb, it doesn't. Always: 2d8 damage, a permanent feature on the sheet (arm: no two-handed weapons or shields, disadvantage on Athletics to climb; leg: speed halved, disadvantage on Acrobatics).",
	S.obj({ part: S.str("Which limb", ["left arm", "right arm", "left leg", "right leg"]), reason: S.str("Why and how: 'bitten, fire axe and a belt tourniquet'") }, ["part", "reason"]),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll }) => {
			if (!isZombie(state)) throw new Error(notZombie);
			return amputate(state, rng, roll, a.part, a.reason);
		}),
);

export const SURVIVAL_TOOLS: ToolFactory[] = [makeNoiseTool, amputateTool];
