import { restoreFeature, restoreSlot } from "../../rules/character";
import { S, tool, withState, type ToolFactory } from "../context";
import { castSpell, findFeatureRef, spendFeatureUse, consumeItem } from "../resources";

/**
 * The player's limited resources are owned by the engine. These tools are the
 * ONLY way the DM spends them; each refuses when the resource is gone, and the
 * DM must narrate that refusal instead of the effect.
 */

export const castSpellTool = tool<{ spell: string; slotLevel?: number; ritual?: boolean; targetIds?: string[]; healSelf?: boolean }>(
	"cast_spell",
	"The PLAYER casts a spell (any time they cast one, in or out of combat). Validates they know/prepared it, spends the slot (lowest available unless slotLevel), tracks concentration, and rolls self-healing for healing spells. On the player's combat turn it resolves through the combat engine (targetIds = combatant ids). FAILS if no slot is left — then the spell is NOT cast.",
	S.obj(
		{
			spell: S.str("Spell name or SRD index"),
			slotLevel: S.int(undefined, 1, 9),
			ritual: S.bool("Cast as a ritual (no slot, +10 min) if the spell has the ritual tag"),
			targetIds: S.arr(S.str()),
			healSelf: S.bool("For healing spells: apply the healing to the player (default true). Set false when healing someone else."),
		},
		["spell"],
	),
	async (a, ctx) => withState(ctx, (tx) => castSpell(tx, a)),
);

export const useItemTool = tool<{ item: string; quantity?: number; keep?: boolean; heal?: string }>(
	"use_item",
	"The PLAYER uses/consumes an inventory item (drinks a potion, eats a ration, burns a torch, throws oil, reads a scroll, hands an item over). Decrements the quantity (unless keep=true) and applies known effects (healing potions roll automatically). FAILS if they don't have it — then it doesn't happen.",
	S.obj(
		{
			item: S.str("Item name or id"),
			quantity: S.int(undefined, 1),
			keep: S.bool("The item is used but not consumed"),
			heal: S.str("Healing dice for a healing item that isn't a standard potion, e.g. '1d4'"),
		},
		["item"],
	),
	async (a, ctx) => withState(ctx, (tx) => consumeItem(tx, a)),
);

export const useFeatureTool = tool<{ feature: string; amount?: number }>(
	"use_feature",
	"The PLAYER uses a class/species feature with limited uses (Second Wind, Rage, Channel Divinity, Bardic Inspiration, Lay on Hands points, Ki points, Divine Sense…). Spends the use(s) and applies built-in effects. FAILS when no uses remain — then it doesn't happen.",
	S.obj({ feature: S.str("Feature name or id"), amount: S.int("Uses/points to spend (default 1)", 1) }, ["feature"]),
	async (a, ctx) => withState(ctx, (tx) => spendFeatureUse(tx, a)),
);

export const restoreResourceTool = tool<{ feature?: string; slotLevel?: number; amount?: number; reason: string }>(
	"restore_resource",
	"Restore spent uses of a feature or a spell slot outside of rests (Arcane Recovery, a magic item, divine boon). Rests already restore resources automatically — do not use this for rests.",
	S.obj({ feature: S.str(), slotLevel: S.int(undefined, 1, 9), amount: S.int(undefined, 1), reason: S.str() }, ["reason"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const out: string[] = [];
			if (a.feature) {
				const f = findFeatureRef(state.character, a.feature);
				if (!f) throw new Error(`No feature "${a.feature}".`);
				state.character = restoreFeature(state.character, f.id, a.amount);
				out.push(`${f.name} restored.`);
			}
			if (a.slotLevel) {
				for (let k = 0; k < (a.amount ?? 1); k++) state.character = restoreSlot(state.character, a.slotLevel);
				out.push(`Restored ${a.amount ?? 1} level-${a.slotLevel} slot(s).`);
			}
			if (!out.length) throw new Error("Give feature and/or slotLevel.");
			return out.join(" ");
		}),
);

export const endConcentrationTool = tool<{ reason: string }>(
	"end_concentration",
	"End the player's concentration outside combat (they drop the spell, or the story says it ended). It also ends by itself when the spell's duration passes on the game clock, on a long rest, and through damage/conditions in combat.",
	S.obj({ reason: S.str() }, ["reason"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const c = state.character.concentration;
			if (!c) return "Not concentrating on anything.";
			if (state.encounter?.status === "active") throw new Error("In combat, concentration ends through the engine (damage, conditions, casting another concentration spell).");
			delete state.character.concentration;
			return `Concentration on ${c.spell} ended (${a.reason}).`;
		}),
);

export const RESOURCE_TOOLS: ToolFactory[] = [castSpellTool, useItemTool, useFeatureTool, restoreResourceTool, endConcentrationTool];
