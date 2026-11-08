import type { RadioStation } from "../../game/types";
import { recordBroadcast, STATIONS } from "../../rules/radio";
import { recordCheckIn } from "../../rules/expeditions";
import { gameMinutes } from "../../rules/survival";
import { isZombie } from "../../rules/survival";
import { S, tool, withState, type ToolFactory } from "../context";

export const broadcastTool = tool<{ station: RadioStation; text: string; expeditionId?: string }>(
	"broadcast",
	"The Quiet: record the exact words the player hears on the radio (campaign language), after they tune in — the engine tells you what is on the air. Write it as radio sounds: fragments, static marked with '…' or '[static]', call signs; a few lines, not a speech. It is kept on the player's radio panel. Then narrate their reaction briefly. station 'walkie' (with expeditionId) is an expedition's check-in.",
	S.obj({ station: S.str(undefined, [...STATIONS, "walkie"]), text: S.str("The transmission as heard"), expeditionId: S.str("For walkie check-ins") }, ["station", "text"]),
	async (a, ctx) =>
		withState(ctx, ({ state, fx }) => {
			if (!isZombie(state)) throw new Error("Only in The Quiet.");
			if (!STATIONS.includes(a.station) && a.station !== "walkie") throw new Error(`Unknown station ${a.station}.`);
			if (!a.text.trim()) throw new Error("Write what is heard.");
			if (a.station === "walkie") {
				if (!a.expeditionId) throw new Error("A walkie check-in needs expeditionId.");
				recordCheckIn(state, a.expeditionId, a.text.trim(), gameMinutes(state.time));
			}
			recordBroadcast(state, { station: a.station, text: a.text.trim(), ...(a.expeditionId ? { expeditionId: a.expeditionId } : {}) });
			fx({ kind: "sfx", sound: "radio" });
			return "Transmission recorded on the radio panel.";
		}),
);

export const RADIO_TOOLS: ToolFactory[] = [broadcastTool];
