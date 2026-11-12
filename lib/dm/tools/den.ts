import type { DenUpgradeId, GigKind } from "../../game/types";
import { isCyber } from "../../rules/cyber";
import { buyUpgrade, DEN_UPGRADE_IDS, DEN_UPGRADES, denStatus, payRent, writeProgram } from "../../rules/den";
import { completeGig, GIG_KIND_TEXT, GIG_KINDS, offerGig, takeGig } from "../../rules/gigs";
import { newId, S, tool, withState, type ToolFactory } from "../context";

/**
 * Root Access: the den and the gigs for the DM (docs/cyberpunk.md §6; engine in
 * lib/rules/den.ts and gigs.ts). Always in the tool list (a stable list keeps
 * the DM's session); they refuse outside cyberpunk campaigns.
 */

const notCyber = "This tool only exists in Root Access (cyberpunk-ruleset campaigns).";

const catalogue = DEN_UPGRADE_IDS.map((id) => `${id} (${DEN_UPGRADES[id].prices.join("/")}: ${DEN_UPGRADES[id].effect})`).join("; ");

export const denStatusTool = tool<Record<string, never>>(
	"den_status",
	"Root Access: the PC's den in full: where it is, rent and when it's due, debt to La Tía, installed upgrades and what they do, the program being written, what's for sale and recent den events.",
	S.obj({}),
	async (_a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return denStatus(state);
		}),
);

export const buyUpgradeTool = tool<{ upgrade: DenUpgradeId }>(
	"buy_upgrade",
	`Root Access: the PC buys and installs a den upgrade with their cred (the engine charges it; one level at a time). The player can also buy from the Den tab. Catalogue (price per level: effect): ${catalogue}. Botnet and render farm exclude each other.`,
	S.obj({ upgrade: S.str("Upgrade id", DEN_UPGRADE_IDS) }, ["upgrade"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			const r = buyUpgrade(state, a.upgrade);
			if (!r.ok) throw new Error(r.text);
			return r.text;
		}),
);

export const payRentTool = tool<{ amount: number }>(
	"pay_rent",
	"Root Access: the PC pays La Tía: the debt first, then rent ahead (each full week's rent pushes the due date a week). Rent is also collected on its own when it comes due if the PC has the cred; if not, it goes on the tab as debt (she takes 25% of every gig while they owe her, and repossesses upgrades if it piles up).",
	S.obj({ amount: S.int("Cred to hand over", 1, 1_000_000) }, ["amount"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			const r = payRent(state, a.amount);
			if (!r.ok) throw new Error(r.text);
			return r.text;
		}),
);

export const writeProgramTool = tool<{ program: string }>(
	"write_program",
	"Root Access: the PC writes a new program at the den's workbench (needs the workbench). It must be on their style's program list and of a level they can run (level 1+; routines can't be written). Costs 100 × level² cred and level × 2 days of downtime; the engine adds it to their programs (or the Netrunner's codebook) when the days have passed. One at a time. Let the days pass in the story (lay_low or other downtime).",
	S.obj({ program: S.str("Program id ('p-ghost') or name") }, ["program"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			const r = writeProgram(state, a.program);
			if (!r.ok) throw new Error(r.text);
			return r.text;
		}),
);

export const offerGigTool = tool<{ title: string; client: string; kind: GigKind; pay: number; hat: number; heat: number; risk: number; brief: string; days: number }>(
	"offer_gig",
	`Root Access: put a job on the PC's gig board (from La Tía, a faction or a job board). Kinds: ${GIG_KINDS.map((k) => `${k} = ${GIG_KIND_TEXT[k]}`).join("; ")}. Pay in cred (a small street job 150–400, a corporate data heist 800–2500, the big ones more; black-hat work pays better). Hat: the shift if done (−3 black … +3 white). Heat: added if done (0–4). Risk 1–5. The offer expires after 'days'. Offer a few at a time, matching the PC's hat band (white: Bureau, bug bounties, leaks; black: ransomware, data brokers).`,
	S.obj(
		{
			title: S.str("Short: 'Lift the Halcón payroll'"),
			client: S.str("Who offers it: an NPC name or a faction"),
			kind: S.str(undefined, GIG_KINDS),
			pay: S.int("Cred", 0, 100000),
			hat: S.int("Hat shift when done, −3…+3", -3, 3),
			heat: S.int("Heat added when done, 0…4", 0, 4),
			risk: S.int("1 (easy) … 5 (deadly)", 1, 5),
			brief: S.str("One or two lines, as the client puts it"),
			days: S.int("Days the offer stays open, 1–30", 1, 30),
		},
		["title", "client", "kind", "pay", "hat", "heat", "risk", "brief", "days"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return offerGig(state, a, newId("gig")).text;
		}),
);

export const takeGigTool = tool<{ gig: string }>(
	"take_gig",
	"Root Access: the PC accepts a gig on offer (by id or title).",
	S.obj({ gig: S.str("Gig id ('gig_…') or title") }, ["gig"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return takeGig(state, a.gig).text;
		}),
);

export const completeGigTool = tool<{ gig: string; outcome: "done" | "failed"; why: string }>(
	"complete_gig",
	"Root Access: close a gig. done: the engine pays the PC (La Tía takes 25% toward the debt while they owe her), shifts the Hat and adds the Heat the gig carried; don't also call adjust_currency, shift_hat or add_heat for it. failed: no pay, half the Heat. Report what it returns.",
	S.obj({ gig: S.str("Gig id or title"), outcome: S.str(undefined, ["done", "failed"]), why: S.str("One line: how it went") }, ["gig", "outcome", "why"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return completeGig(state, a.gig, a.outcome === "failed" ? "failed" : "done", a.why).text;
		}),
);

export const DEN_TOOLS: ToolFactory[] = [denStatusTool, buyUpgradeTool, payRentTool, writeProgramTool, offerGigTool, takeGigTool, completeGigTool];
