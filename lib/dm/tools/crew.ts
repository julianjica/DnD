import type { CrewRole } from "../../game/types";
import { isCyber } from "../../rules/cyber";
import { adjustLoyalty, CREW_CAP, CREW_ROLES, crewMember, crewName, isActiveCrew, leaveCrew, recruitCrew, recruitText, setCrewStatus } from "../../rules/crew";
import { S, tool, withState, type ToolFactory } from "../context";

/**
 * Root Access, Phase 4: the crew for the DM (docs/cyberpunk.md §7). The engine
 * owns state.cyber.crew; these tools are always listed (the tool list must
 * stay stable) and refuse outside cyberpunk campaigns.
 */

const notCyber = "This tool only exists in Root Access (cyberpunk-ruleset campaigns).";

export const recruitCrewTool = tool<{ npcId: string; classId: string; level?: number; role: CrewRole; hatPref: number; specialty: string; gear?: string[] }>(
	"recruit_crew",
	`Root Access: an NPC the PC has earned joins the crew (only through the story, after trust is earned; at most ${CREW_CAP}). Give their hacking style (class id or style: Netrunner, Solo, Ripperdoc…), level (never above the PC's), role (driver, face, muscle, medic, runner, tech), where their own hat sits (−10 black … +10 white: drifting far from it costs their loyalty, and a disloyal one may sell the PC out), what they bring, and their gear (c- ids; default a style weapon). The engine builds their stat block; with the PC they fight beside them (within the ally cap).`,
	S.obj(
		{
			npcId: S.str("Existing NPC id (add_npc first)"),
			classId: S.str("Hacking style: class id ('wizard', 'fighter') or style name ('Netrunner', 'Solo')"),
			level: S.int("Level, 1 to the PC's level", 1, 20),
			role: S.str("What they do for the crew", [...CREW_ROLES]),
			hatPref: S.int("Their own hat, −10 black … +10 white", -10, 10),
			specialty: S.str("One line: what they bring ('drives anything with wheels')"),
			gear: S.arr(S.str("Equipment id, e.g. c-light-pistol, c-armored-jacket")),
		},
		["npcId", "classId", "role", "hatPref", "specialty"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return recruitText(state, recruitCrew(state, a));
		}),
);

export const crewLoyaltyTool = tool<{ npcId: string; delta: number; why: string }>(
	"crew_loyalty",
	"Root Access: a moment that changes how much a crew member trusts the PC (0–10): saving their life, keeping a promise, sharing the take (+1…+2); lying to them, leaving them behind, a job that betrays what they believe (−1…−3). Hat drift is the engine's (don't repeat it here). At 0 they walk.",
	S.obj({ npcId: S.str(), delta: S.int("Change, −3…+3", -3, 3), why: S.str("What happened, short") }, ["npcId", "delta", "why"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			const m = crewMember(state, a.npcId);
			if (!isActiveCrew(m)) throw new Error(`${crewName(state, m)} is no longer in the crew (${m.status}).`);
			return adjustLoyalty(state, m, a.delta, a.why);
		}),
);

export const crewStatusTool = tool<{ npcId: string; status: "with_pc" | "at_den" | "away"; why: string }>(
	"crew_status",
	"Root Access: where a crew member is: with_pc (beside the PC: in scenes, in fights, in the van during runs), at_den (minding the den), away (on their own business). Not mid-fight.",
	S.obj({ npcId: S.str(), status: S.str(undefined, ["with_pc", "at_den", "away"]), why: S.str("Short reason") }, ["npcId", "status", "why"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			if (!["with_pc", "at_den", "away"].includes(a.status)) throw new Error("status is with_pc, at_den or away.");
			return setCrewStatus(state, crewMember(state, a.npcId), a.status, a.why);
		}),
);

export const crewDismissTool = tool<{ npcId: string; why: string }>(
	"crew_dismiss",
	"Root Access: the PC lets a crew member go (or they part ways on good terms). They stay in the codex as an NPC.",
	S.obj({ npcId: S.str(), why: S.str("Short reason") }, ["npcId", "why"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			const m = crewMember(state, a.npcId);
			if (!isActiveCrew(m)) throw new Error(`${crewName(state, m)} is no longer in the crew (${m.status}).`);
			if (state.encounter?.status === "active" && m.status === "with_pc") throw new Error("Not in the middle of a fight.");
			return leaveCrew(state, m, a.why, true);
		}),
);

export const CREW_TOOLS: ToolFactory[] = [recruitCrewTool, crewLoyaltyTool, crewStatusTool, crewDismissTool];
