import type { BaseUpgrade, GameState } from "../../game/types";
import { BASE_UPGRADES, STOCK_KINDS, UPGRADES, buildUpgrade, claimBase, stash, takeFromStash, type StockKind } from "../../rules/base";
import { isZombie } from "../../rules/survival";
import { S, newId, tool, withState, type ToolFactory } from "../context";
import { addInventoryItem } from "../items";
import { updateResidents, type ResidentAdd, type ResidentRemove } from "../../rules/residents";

/** The Quiet only: the base (docs/zombie.md §7). */
function requireZombie(state: GameState) {
	if (!isZombie(state)) throw new Error("Only in The Quiet (zombie campaigns).");
}

export const claimBaseTool = tool<{ name: string; locationId?: string; mapId?: string; structure?: number; reason?: string }>(
	"claim_base",
	"The Quiet: make a building the group's BASE, only once the player has actually secured it in the story (cleared of the dead, doors shut or barricaded). One base at a time; calling again at the same place renames it / changes its map; at another place it MOVES the base and needs a reason (the stock comes along, upgrades stay behind). Its fortification comes from the barricades on its map (draw_map it and build_barricade) plus upgrades; structure 0-3 is how sturdy the building is on its own (steel doors, a fenced yard).",
	S.obj(
		{
			name: S.str("Name the player uses for it ('the pharmacy', 'Granger barn')"),
			locationId: S.str("World location (default: the current one)"),
			mapId: S.str("Tactical map of the base (default: the active map)"),
			structure: S.int("How sturdy the building is on its own, 0 (a house with glass doors) to 3 (a police station, a fenced compound)", 0, 3),
			reason: S.str("Required when moving an existing base elsewhere"),
		},
		["name"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			return claimBase(state, a);
		}),
);

export const stashTool = tool<{ items: { ref?: string; itemId?: string; qty?: number }[] }>(
	"stash",
	"The Quiet: the player puts supplies from their inventory into the base stock (only at the base). Conversions: canned food/preserves/jerky → 1 food each; bottled water → 1 water; medkit → 3 meds, bandage/painkillers/antibiotics → 1 meds; ammunition → 1 ammo per round; gasoline can → 5 fuel; planks/nails/steel pipe → 1 materials each (×1.5 with a workshop). Other gear can't be stashed.",
	S.obj(
		{
			items: S.arr(
				S.obj({ ref: S.str("Equipment index or item name ('z-canned-food')"), itemId: S.str("Inventory item id"), qty: S.int("How many (default: all of them)", 1) }),
				"Items to stash",
			),
		},
		["items"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			return stash(state, a);
		}),
);

export const takeFromStashTool = tool<{ kind: StockKind; qty: number }>(
	"take_from_stash",
	"The Quiet: the player takes supplies out of the base stock into their inventory (only at the base): qty units of one kind, as real items (what was stashed comes back first; ammo returns the rounds their weapons use when possible; fuel in 5-liter cans; materials as planks and nails, usable for build_barricade). Also use it to pay a raiders' toll (narrate the units hauled away).",
	S.obj({ kind: S.str(undefined, STOCK_KINDS), qty: S.int("Units", 1) }, ["kind", "qty"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			const res = takeFromStash(state, a.kind, a.qty);
			for (const i of res.items) addInventoryItem(state, { name: i.name, ref: i.ref, quantity: i.qty }, () => newId("it"));
			return res.text;
		}),
);

export const buildUpgradeTool = tool<{ upgrade: BaseUpgrade }>(
	"build_upgrade",
	`The Quiet: start building an upgrade at the base (only there), paid from the base stock; it finishes on its own after its build time in game hours. ${BASE_UPGRADES.map((u) => `${u} (${Object.entries(UPGRADES[u].cost).map(([k, n]) => `${n} ${k}`).join(" + ")}, ${UPGRADES[u].hours} h): ${UPGRADES[u].effect}`).join("; ")}.`,
	S.obj({ upgrade: S.str(undefined, BASE_UPGRADES) }, ["upgrade"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			return buildUpgrade(state, a.upgrade);
		}),
);

export const updateResidentsTool = tool<{ add?: ResidentAdd[]; remove?: ResidentRemove[]; edit?: (ResidentAdd & { who: string })[] }>(
	"update_residents",
	"The Quiet: keep the base's RESIDENTS list current: everyone sheltering there who is NOT a companion (the cook, the old neighbour, a mother and her kids). They show on the player's Group tab and eat 1 food + 1 water each from the base stock at 08:00, after the player and companions. Add people the moment they move in (link npcId when they have one; one entry can stand for several people with headcount, e.g. 'Teresa Holm and her two kids' = 3), remove them when they leave, die or turn, edit to change notes/headcount. Recruiting a resident as a companion (recruit_survivor) takes them off the list on its own.",
	S.obj(
		{
			add: S.arr(
				S.obj(
					{
						name: S.str("Name as the player knows them"),
						npcId: S.str("NPC id, if they have one"),
						headcount: S.int("People this entry stands for (default 1)", 1),
						note: S.str("Short: who they are / what they do here ('cooks', 'diabetic, 8', 'keeps the stock ledger')"),
					},
					["name"],
				),
				"People moving in",
			),
			remove: S.arr(S.obj({ who: S.str("Resident id, NPC id or name"), reason: S.str(undefined, ["left", "died", "turned", "recruited", "moved"]) }, ["who"]), "People no longer living here"),
			edit: S.arr(
				S.obj({ who: S.str("Resident id, NPC id or name"), name: S.str("New name"), npcId: S.str("Link an NPC"), headcount: S.int("People", 1), note: S.str("New note ('' clears it)") }, ["who"]),
				"Changes to existing residents",
			),
		},
		[],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			return updateResidents(state, a, () => newId("res"));
		}),
);

export const BASE_TOOLS: ToolFactory[] = [claimBaseTool, stashTool, takeFromStashTool, buildUpgradeTool, updateResidentsTool];
