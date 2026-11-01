import type { DmTool } from "../../game/types";
import type { ToolContext } from "../context";
import { enrichItem } from "../items";
import { CHARACTER_TOOLS } from "./character";
import { COMBAT_TOOLS } from "./combat";
import { MAP_TOOLS } from "./map";
import { STORY_TOOLS, setItemEnricher } from "./story";

setItemEnricher(enrichItem);

export function allTools(ctx: ToolContext): DmTool[] {
	return [...STORY_TOOLS, ...CHARACTER_TOOLS, ...MAP_TOOLS, ...COMBAT_TOOLS].map((f) => f(ctx));
}
