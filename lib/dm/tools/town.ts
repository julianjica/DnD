import { updateTown, type UpdateTownArgs } from "../../rules/town";
import { S, tool, withState, type ToolFactory } from "../context";

const FACTION = S.obj(
	{
		id: S.str("Faction id (precinct, fold, route9, library, grangers, ventara, guard, or a new one)"),
		name: S.str(),
		homeId: S.str("World location id of their stronghold"),
		strength: S.int("0 wiped out … 10 strongest", 0, 10),
		attitude: S.int("Toward the player: -3 hostile … 0 wary … +3 allied", -3, 3),
		aggression: S.int("0 keeps to itself … 3 raids and grabs", 0, 3),
		goal: S.str("What they're after now (EN)"),
		known: S.bool("The player knows they exist"),
		status: S.str(undefined, ["active", "broken", "gone"]),
		npcIds: S.arr(S.str()),
		remove: S.bool(),
	},
	["id"],
);

export const updateTownTool = tool<UpdateTownArgs>(
	"update_town",
	"The Quiet: edit the living town the engine runs between scenes (digest 'TOWN' block). Factions (attitude toward the player, strength, goal, stronghold, members), hordes (size, where, heading, known to the player), places (intact/looted/overrun/burned/held by a faction) and story events the town should remember. Use it when the story changes the town (the player wipes out a raider camp, burns a building, makes a deal: attitude up) so the engine's next moves follow the story. known=true marks what the player has seen or been told.",
	S.obj({
		factions: S.arr(FACTION),
		hordes: S.arr(S.obj({ id: S.str("Existing horde id (omit to create one)"), size: S.int(undefined, 0), at: S.str("Location id"), heading: S.str("Location id"), known: S.bool(), remove: S.bool() })),
		places: S.arr(S.obj({ locationId: S.str(), status: S.str(undefined, ["intact", "looted", "overrun", "burned", "held"]), heldBy: S.str("Faction id when held"), known: S.bool() }, ["locationId", "status"])),
		events: S.arr(S.obj({ text: S.str("What happened (EN)"), locationId: S.str(), factionId: S.str(), public: S.bool("Loud enough for the radio/rumours"), known: S.bool() }, ["text"])),
		reviewed: S.bool("Set once the seeded factions match the story"),
	}),
	async (a, ctx) => withState(ctx, ({ state, rng }) => updateTown(state, rng, a)),
);

export const TOWN_TOOLS: ToolFactory[] = [updateTownTool];
