import type { RadioStation } from "../../game/types";
import { recordBroadcast, STATIONS } from "../../rules/radio";
import { isZombie } from "../../rules/survival";
import { S, tool, withState, type ToolFactory } from "../context";

export const broadcastTool = tool<{ station: RadioStation; text: string }>(
	"broadcast",
	"The Quiet: record the exact words the player hears on the radio (campaign language), after they tune in — the engine tells you what is on the air. Write it as radio sounds: fragments, static marked with '…' or '[static]', call signs; a few lines, not a speech. It is kept on the player's radio panel. Then narrate their reaction briefly.",
	S.obj({ station: S.str(undefined, STATIONS), text: S.str("The transmission as heard") }, ["station", "text"]),
	async (a, ctx) =>
		withState(ctx, ({ state, fx }) => {
			if (!isZombie(state)) throw new Error("Only in The Quiet.");
			if (!STATIONS.includes(a.station)) throw new Error(`Unknown station ${a.station}.`);
			if (!a.text.trim()) throw new Error("Write what is heard.");
			recordBroadcast(state, { station: a.station, text: a.text.trim() });
			fx({ kind: "sfx", sound: "radio" });
			return "Transmission recorded on the radio panel.";
		}),
);

export const RADIO_TOOLS: ToolFactory[] = [broadcastTool];
