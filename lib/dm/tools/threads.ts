import { BEATS, markBeat, storyThread, type Beat, type ThreadArgs } from "../../rules/threads";
import { S, newId, tool, withState, type ToolFactory } from "../context";

export const storyThreadTool = tool<ThreadArgs>(
	"story_thread",
	"Keep your promises to the story. plant: record a thread the moment you set it up (a mystery, a name, a debt, a threat, a promise an NPC made) with what it could pay off into. touch: it came back into play (add what changed in planted). resolve: it paid off (payoff = how). drop: it no longer matters. At most 8 open; overdue ones are flagged in the digest so they come back.",
	S.obj(
		{
			op: S.str(undefined, ["plant", "touch", "resolve", "drop"]),
			id: S.str("Thread id (or title) for touch/resolve/drop"),
			title: S.str("Short name, for plant"),
			planted: S.str("What was set up and where it could lead (plant), or what changed (touch)"),
			payoff: S.str("How it paid off (resolve)"),
		},
		["op"],
	),
	async (a, ctx) => withState(ctx, ({ state }) => storyThread(state, a, () => newId("th"))),
);

export const markBeatTool = tool<{ beats: Beat[] }>(
	"mark_beat",
	"Tell the pacing director what this scene was, when it isn't obvious to the engine (fights, sieges and camp scenes are counted automatically): threat (danger or dread, even without a fight), human (a real moment between people), twist (a reveal or reversal). Call it once at the end of a scene that had one.",
	S.obj({ beats: S.arr(S.str(undefined, BEATS)) }, ["beats"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const beats = (a.beats ?? []).filter((b): b is Beat => BEATS.includes(b));
			if (!beats.length) throw new Error(`beats: one or more of ${BEATS.join(", ")}.`);
			markBeat(state, ...beats);
			return `Noted: ${beats.join(", ")}.`;
		}),
);

export const THREAD_TOOLS: ToolFactory[] = [storyThreadTool, markBeatTool];
