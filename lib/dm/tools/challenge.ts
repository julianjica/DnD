import type { ChallengeApproach, ChallengeCost } from "../../game/types";
import { abandonChallenge, approachOdds, buildChallenge, cancelChallenge, CHALLENGE_KINDS, CLOCK_MAX, CLOCK_MIN, MAX_STAGES, startChallenge, takeApproach, type ChallengeSetup } from "../../rules/challenge";
import { S, tool, withState, type StateTxn, type ToolFactory } from "../context";

/**
 * Timed challenges (lib/rules/challenge.ts): the DM sets one up, the player
 * plays it on the Challenge panel (app/api/campaigns/[id]/challenge), and the
 * DM narrates the end once.
 */

const COST = S.obj(
	{
		clock: S.int("Extra ticks lost", 0, 5),
		hp: S.str('Damage dice ("1d6"); never drops the PC below 1 HP'),
		heat: S.int("Root Access only: Heat added", 0, 4),
		noise: S.int("The Quiet only: noise added", 0, 5),
		item: S.str("An inventory item lost (its name)"),
		alarm: S.str("An alarm raised / pursuers alerted (short, campaign language)"),
	},
	[],
);

const APPROACH = S.obj(
	{
		label: S.str("What the player does, short, in the campaign language"),
		skill: S.str("Skill index (athletics, stealth, sleight-of-hand…) or ability (str…cha)"),
		dc: S.int("10 easy, 13 moderate, 15 hard, 18 very hard", 5, 30),
		success: S.str("What success gains (campaign language, shown to the player)"),
		failure: S.str("What failure costs (campaign language, shown to the player)"),
		time: S.int("Ticks it takes whatever happens: 1 fast (default), 2–3 slow and safe", 1, 3),
		gain: S.int("Progress on success: 1 (default), 2 for a risky shortcut", 1, 2),
		cost: { ...COST, description: "What failure costs the engine applies (default: 1 extra tick)" },
	},
	["label", "skill", "dc", "success", "failure"],
);

/** One step for the route or challenge_act: resolves it and says whether the DM must narrate the end. */
export function challengeStep(tx: StateTxn, pick: { stage?: number; approach: number | ChallengeApproach }): { text: string; narrate: boolean } {
	const r = takeApproach(tx.state, tx.rng, tx.roll, pick);
	return { text: r.ended ? tx.state.challenge!.summary! : r.text, narrate: r.ended };
}

export const startChallengeTool = tool<ChallengeSetup & Record<string, unknown>>(
	"start_challenge",
	"Start a TIMED CHALLENGE when the player's OWN choice turns into a race against time: fleeing pursuers, slipping through a guarded building, a heist, catching someone, escaping a collapse. The player then plays it on the Challenge panel (no DM turns): each stage they pick one approach, the engine rolls with their real bonuses (+2 when a companion or crew member with that skill is with them), burns the clock and applies the costs. When it ends the engine hands you ONE summary to narrate. Build 3–5 stages with 2–4 approaches that really differ: fast and risky (time 1, gain 2 or a high DC) vs slow and safe (time 2–3, low DC), and different skills so different characters shine. Write labels, prompts and stakes in the campaign language. The clock must allow the quickest route with some slack (about stages + 2). Not during a fight.",
	S.obj(
		{
			title: S.str("Short title in the campaign language"),
			kind: S.str(undefined, CHALLENGE_KINDS),
			goal: S.str("What winning means, one line, campaign language"),
			clock: S.int("Ticks on the clock", CLOCK_MIN, CLOCK_MAX),
			target: S.int("Progress needed (default: the number of stages)", 1, MAX_STAGES),
			stages: S.arr(S.obj({ prompt: S.str("The obstacle, campaign language"), approaches: S.arr(APPROACH, "2–4 approaches") }, ["prompt", "approaches"]), "1–6 stages (3–5 is best)"),
			stakes: S.obj({ success: S.str("What success means"), partial: S.str("What a partial success means (the clock ran out halfway there)"), failure: S.str("What failure means"), cost: { ...COST, description: "Applied by the engine when the whole challenge fails" } }, ["success", "failure"]),
			complications: S.arr(S.obj({ text: S.str("What goes wrong, campaign language"), atClock: S.int("Fires when this many ticks are left (default: half the clock)", 0), dcPlus: S.int("Every later DC goes up by this (default 2)", 0, 5), cost: COST }, ["text"]), "0–2 complications that hit when the clock runs low"),
			minutesPerTick: S.int("Game minutes per tick (default: 1 for chases and escapes, 5 for heists)", 1, 60),
		},
		["title", "kind", "goal", "clock", "stages", "stakes"],
	),
	async (a, ctx) => withState(ctx, ({ state }) => startChallenge(state, a)),
);

export const challengeStatusTool = tool<{ cancel?: string; clear?: boolean }>(
	"challenge_status",
	"The current timed challenge: clock, progress, stage, approaches and odds, log. cancel='reason' calls an active one off with no engine consequences (the player turned to fight, surrendered or talked their way out). clear=true marks a finished one as narrated once you have told its end.",
	S.obj({ cancel: S.str("Why it is called off"), clear: S.bool("Clear a finished, narrated challenge") }, []),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const ch = state.challenge;
			if (!ch) return "No challenge.";
			if (a.cancel) return cancelChallenge(state, a.cancel);
			if (a.clear) {
				if (ch.status === "active") throw new Error("It is still running: cancel it with a reason instead.");
				// The result card stays until the player closes it.
				ch.narrated = true;
				return "Marked as narrated (the player closes the result card).";
			}
			const st = ch.stages[ch.stage];
			const odds = st.approaches.map((ap, i) => {
				const o = approachOdds(state, ap);
				return `  ${i}: ${ap.label} — ${ap.skill} ${o.bonus >= 0 ? "+" : ""}${o.bonus} vs DC ${o.dc} (${Math.round(o.chance * 100)}%${o.helper ? `, ${o.helper} helps` : ""}); time ${ap.time}, gain ${ap.gain}`;
			});
			return [
				`"${ch.title}" (${ch.kind}, ${ch.status}): ${ch.goal}`,
				`Clock ${ch.clock}/${ch.clockMax}, progress ${ch.progress}/${ch.target}, stage ${ch.stage + 1}/${ch.stages.length}${ch.dcPlus ? `, DCs +${ch.dcPlus}` : ""}.`,
				ch.status === "active" ? `Now: ${st.prompt}\n${odds.join("\n")}` : (ch.summary ?? ""),
			].join("\n");
		}),
);

export const challengeActTool = tool<{ approach?: number; custom?: Omit<ChallengeApproach, "time" | "gain" | "cost"> & { time?: number; gain?: number; cost?: ChallengeCost }; abandon?: boolean }>(
	"challenge_act",
	"Resolve the current challenge stage when the player says what they do in WORDS instead of clicking the panel: approach = the index of the matching approach, or custom = a new approach built from their idea (fair DC; same fields as start_challenge). abandon=true when they give up the race (it ends as a failure or partial, stakes apply). The engine rolls and applies everything; narrate the result. Never use it to play stages the player didn't choose.",
	S.obj({ approach: S.int("Index of the approach at this stage", 0, 3), custom: APPROACH, abandon: S.bool("The player gives up") }, []),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const ch = tx.state.challenge;
			if (!ch || ch.status !== "active") throw new Error("There is no challenge running.");
			if (tx.state.encounter?.status === "active") throw new Error("A fight is on: the challenge waits until it ends.");
			if (a.abandon) {
				const text = abandonChallenge(tx.state, tx.rng, tx.roll);
				ch.narrated = true;
				return `${text}\nNarrate it now: it is ALREADY applied.`;
			}
			let pick: number | ChallengeApproach;
			if (a.custom) {
				// Validate the custom approach through the same rules as a setup.
				const probe = buildChallenge(tx.state, { title: ch.title, kind: ch.kind, goal: ch.goal, clock: CLOCK_MAX, stages: [{ prompt: "custom", approaches: [a.custom, a.custom] }], stakes: { success: "-", failure: "-" } });
				pick = probe.stages[0].approaches[0];
			} else if (a.approach !== undefined) pick = a.approach;
			else throw new Error("Give approach (an index) or custom (the player's own idea), or abandon.");
			const r = challengeStep(tx, { approach: pick });
			if (r.narrate) ch.narrated = true;
			return r.narrate ? `${r.text}\nIt is ALREADY applied: narrate it now.` : r.text;
		}),
);

export const CHALLENGE_TOOLS: ToolFactory[] = [startChallengeTool, challengeStatusTool, challengeActTool];
