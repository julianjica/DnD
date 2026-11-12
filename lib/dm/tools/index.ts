import type { DmTool } from "../../game/types";
import type { ToolContext } from "../context";
import { enrichItem } from "../items";
import { BASE_TOOLS } from "./base";
import { CHARACTER_TOOLS } from "./character";
import { COMBAT_TOOLS } from "./combat";
import { MAP_TOOLS } from "./map";
import { RESOURCE_TOOLS } from "./resources";
import { SCAVENGE_TOOLS } from "./scavenge";
import { STORY_TOOLS, setItemEnricher } from "./story";
import { SURVIVAL_TOOLS } from "./survival";
import { GROUP_TOOLS } from "./group";
import { TOWN_TOOLS } from "./town";
import { RADIO_TOOLS } from "./radio";
import { SIEGE_TOOLS } from "./siege";
import { EXPEDITION_TOOLS } from "./expeditions";
import { THREAD_TOOLS } from "./threads";
import { CYBER_TOOLS } from "./cyber";
import { DECK_TOOLS } from "./deck";
import { NETRUN_TOOLS } from "./netrun";

setItemEnricher(enrichItem);

export function allTools(ctx: ToolContext): DmTool[] {
	return [...STORY_TOOLS, ...CHARACTER_TOOLS, ...RESOURCE_TOOLS, ...MAP_TOOLS, ...COMBAT_TOOLS, ...SCAVENGE_TOOLS, ...SURVIVAL_TOOLS, ...BASE_TOOLS, ...GROUP_TOOLS, ...TOWN_TOOLS, ...RADIO_TOOLS, ...SIEGE_TOOLS, ...EXPEDITION_TOOLS, ...THREAD_TOOLS, ...CYBER_TOOLS, ...DECK_TOOLS, ...NETRUN_TOOLS].map((f) => f(ctx));
}
