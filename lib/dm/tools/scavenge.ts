import type { GameState } from "../../game/types";
import { revealAround } from "../../maps";
import { buildBarricade, damageBarricade, type BarricadeMaterial } from "../../rules/barricade";
import { rulesetOf } from "../../rules/ruleset";
import { PLACE_TYPES, scavenge, type Thoroughness } from "../../rules/scavenge";
import { S, newId, tool, withState, type ToolFactory } from "../context";
import { addInventoryItem } from "../items";
import { SIGHT_RADIUS } from "./map";

/** The Quiet only: scavenging and barricades (docs/zombie.md §5). */
function requireZombie(state: GameState) {
	if (rulesetOf(state.settings) !== "zombie") throw new Error("Only in The Quiet (zombie campaigns).");
}

function revealFromPc(state: GameState) {
	const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	const pc = map?.entities.find((e) => e.kind === "pc");
	if (map && pc) revealAround(map, pc.x, pc.y, SIGHT_RADIUS);
}

export const scavengeTool = tool<{ place: string; thoroughness: Thoroughness; locationId?: string }>(
	"scavenge",
	"The Quiet: the player searches a place for supplies. The engine rolls their Perception (quick) or Investigation (careful/thorough) check, rolls on the place's loot table, adds what they find to the inventory, advances the clock (10/30/60 min) and adds noise (+0/+1/+2). Places already searched yield less (~empty after 3 searches); food gets scarcer as days pass. Narrate exactly what it returns; if it reports DANGER, something woke: decide what and play it out. Never hand out scavenged loot with give_item instead.",
	S.obj(
		{
			place: S.str("Kind of place searched", PLACE_TYPES),
			thoroughness: S.str("quick (10 min, quiet), careful (30 min), thorough (60 min, finds most, riskiest)", ["quick", "careful", "thorough"]),
			locationId: S.str("World location searched (default: the current one)"),
		},
		["place", "thoroughness"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll: record }) => {
			requireZombie(state);
			if (state.encounter?.status === "active") throw new Error("No searching in the middle of a fight.");
			const res = scavenge(state, rng, a);
			record(res.check);
			for (const f of res.found) addInventoryItem(state, { name: f.name, ref: f.ref, quantity: f.qty }, () => newId("it"));
			ctx.emit({ type: "fx", fx: { kind: "sfx", sound: res.found.length ? "gem" : "door" } });
			return res.text;
		}),
);

export const buildBarricadeTool = tool<{ x: number; y: number; material: BarricadeMaterial }>(
	"build_barricade",
	"The Quiet: the player barricades a square of the active map (a doorway, a window gap, a corridor) so the dead can't pass or see through. furniture: 15 HP, 20 min, no materials; planks: 25 HP, 10 min, uses 1 Planks + 1 Box of Nails from the inventory, hammering is loud (+2 noise); car: 40 HP, 30 min, a pushed car (outdoors). Only on open floor or door squares nobody stands on. On an existing barricade it repairs it to full (planks still use materials).",
	S.obj(
		{
			x: S.int(undefined, 0),
			y: S.int(undefined, 0),
			material: S.str(undefined, ["furniture", "planks", "car"]),
		},
		["x", "y", "material"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			requireZombie(state);
			const res = buildBarricade(state, rng, a);
			revealFromPc(state);
			ctx.emit({ type: "fx", fx: { kind: "sfx", sound: a.material === "planks" ? "hit" : "door" } });
			return res.text;
		}),
);

export const damageBarricadeTool = tool<{ x: number; y: number; amount: number }>(
	"damage_barricade",
	"The Quiet: damage a barricade on the active map (the dead pounding on it, a ram, an explosion). Returns the HP left; at 0 it collapses into rubble and the way is open. Hordes hit hard: a few shamblers ~1d6 per round between them, a horde 2d10+.",
	S.obj({ x: S.int(undefined, 0), y: S.int(undefined, 0), amount: S.int(undefined, 0) }, ["x", "y", "amount"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			const res = damageBarricade(state, a);
			if (res.destroyed) revealFromPc(state);
			ctx.emit({ type: "fx", fx: { kind: "sfx", sound: "hit" } });
			return res.text;
		}),
);

export const SCAVENGE_TOOLS: ToolFactory[] = [scavengeTool, buildBarricadeTool, damageBarricadeTool];
