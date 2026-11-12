import { EQUIPMENT, getEquipment, toIndex } from "../../srd/index";
import { addHeat, cyberOf, HEAT_MAX, humanityCheck, installImplant, isCyber, LAY_LOW_MAX_DAYS, layLow, removeImplant, shiftHat, therapy } from "../../rules/cyber";
import { gameMinutes, takeOne } from "../../rules/survival";
import type { EquipmentData } from "../../srd/types";
import { S, tool, withState, type ToolFactory } from "../context";

/**
 * Root Access: the three meters for the DM (docs/cyberpunk.md §5). The engine
 * owns Hat, Heat and Humanity; these tools only work in cyberpunk campaigns
 * (they refuse elsewhere, like the survival tools of The Quiet).
 */

const notCyber = "This tool only exists in Root Access (cyberpunk-ruleset campaigns).";

/** An implant entry by id ("c-hawk-eye") or name ("Hawk Eye"). */
function findImplant(ref: string): EquipmentData | undefined {
	const r = ref.trim();
	const hit = getEquipment(r) ?? getEquipment(`c-${toIndex(r)}`) ?? EQUIPMENT.find((e) => e.implant && e.name.toLowerCase() === r.toLowerCase());
	return hit?.implant ? hit : undefined;
}

export const shiftHatTool = tool<{ delta: number; why: string }>(
	"shift_hat",
	"Root Access: move the PC's Hat after a job or a choice (−10 black … +10 white; grey is −3…+3). Toward white (+): leaking corporate crimes, protecting people, reporting a flaw. Toward black (−): ransomware, selling personal data, harming bystanders. Typical: a small choice ±1, a job ±2, a defining act ±3. Robbing a corp to feed a barrio is grey (0 or ±1). The band decides who hires and sells to the PC.",
	S.obj({ delta: S.int("Shift, −5…+5 (negative = blacker)", -5, 5), why: S.str("What they did, short: 'sold the clinic's patient list'") }, ["delta", "why"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return shiftHat(cyberOf(state), a.delta, a.why, gameMinutes(state.time)).text;
		}),
);

export const addHeatTool = tool<{ delta: number; why: string }>(
	"add_heat",
	`Root Access: raise (or lower) the PC's Heat, 0–${HEAT_MAX}: how hard Ferro, the corps and the gangs are looking. Raise it for traces that land, black-hat jobs, witnesses, street hacks in public (typical +1, a big mess +2–3). Lower it only for a real cover-up (a scrubbed trail, a bribe). It also drops 1 a day on its own, and faster with lay_low. Crossing 3: prices up, La Tía cautious; 6: Ferro sweeps the district; 8: a den raid is due; 10: a bounty and hunters. Put what it crosses in play.`,
	S.obj({ delta: S.int("Change, −5…+5", -5, 5), why: S.str("What drew the attention: 'trace completed on the Halcón node'") }, ["delta", "why"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return addHeat(cyberOf(state), a.delta, a.why, gameMinutes(state.time)).text;
		}),
);

export const layLowTool = tool<{ days: number }>(
	"lay_low",
	`Root Access: the PC lies low for some days (no jobs, no runs, nothing else happens). Time passes and Heat drops 2 a day instead of 1. Up to ${LAY_LOW_MAX_DAYS} days. Narrate the days in hiding briefly.`,
	S.obj({ days: S.int(`Days in hiding, 1–${LAY_LOW_MAX_DAYS}`, 1, LAY_LOW_MAX_DAYS) }, ["days"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return layLow(state, a.days);
		}),
);

export const installImplantTool = tool<{ ref: string }>(
	"install_implant",
	"Root Access: install a piece of cyberware in the PC (a Ripperdoc anywhere; otherwise a clinic chair or the den's med bay; charge the work with adjust_currency). Takes a body slot (neural 2, eyes 2, arms 2, legs 2, skin 1, internal 3) and costs its Humanity; if the PC carries the item, it is used up. At Humanity 0 the engine runs a Fracture.",
	S.obj({ ref: S.str("Implant equipment id ('c-hawk-eye') or name") }, ["ref"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			const item = findImplant(a.ref);
			if (!item) throw new Error(`'${a.ref}' is not known cyberware. Use lookup_srd to find implant ids (c-…).`);
			const r = installImplant(cyberOf(state), item, gameMinutes(state.time));
			if (!r.ok) throw new Error(r.text);
			const carried = takeOne(state.character, (i) => i.ref === item.index);
			if (r.fractured) state.dmNotes.push(`Fracture on Day ${state.time.day}: the PC woke in a clinic, in debt for the emergency work.`);
			return carried ? `${r.text} (Used the carried ${item.name}.)` : r.text;
		}),
);

export const removeImplantTool = tool<{ ref: string }>(
	"remove_implant",
	"Root Access: take an implant out of the PC (a Ripperdoc, a clinic or the med bay). Gives back the Humanity it cost. The hardware isn't returned automatically: give_item it if the PC keeps it.",
	S.obj({ ref: S.str("Installed implant id ('c-hawk-eye')") }, ["ref"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			const ref = findImplant(a.ref)?.index ?? a.ref;
			const r = removeImplant(cyberOf(state), ref, gameMinutes(state.time));
			if (!r.ok) throw new Error(r.text);
			return r.text;
		}),
);

export const humanityCheckTool = tool<{ trigger: string }>(
	"humanity_check",
	"Root Access: call after a critical failure or a bad shock (the PC drops to 0 HP, causes a death, sees something terrible). At Humanity 10 or less the engine rolls a Wisdom save (DC 10 + (10 − Humanity)); on a failure the PC has an episode (lost turn, lash out or freeze, rolled). Above 10 nothing happens.",
	S.obj({ trigger: S.str("What set it off: 'natural 1 on the breach', 'killed the guard'") }, ["trigger"]),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return humanityCheck(state, rng, roll, a.trigger).text;
		}),
);

export const therapyTool = tool<{ sessions: number }>(
	"therapy",
	"Root Access: the PC goes to therapy (a clinic counsellor, a street priest who listens, a group in the barrio). +2 Humanity per session, up to the maximum. Charge the cred with adjust_currency and let the days pass.",
	S.obj({ sessions: S.int("Sessions, 1–10", 1, 10) }, ["sessions"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return therapy(cyberOf(state), a.sessions, gameMinutes(state.time)).text;
		}),
);

export const CYBER_TOOLS: ToolFactory[] = [shiftHatTool, addHeatTool, layLowTool, installImplantTool, removeImplantTool, humanityCheckTool, therapyTool];
