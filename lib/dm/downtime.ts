import type { BaseUpgrade, GameState, LogEntry } from "../game/types";
import { translate, type Lang, type MessageKey } from "../i18n";
import { cyberOf, isCyber, LAY_LOW_MAX_DAYS, layLow } from "../rules/cyber";
import { DAY, denOf, writeProgram } from "../rules/den";
import { declineGig, takeGig } from "../rules/gigs";
import { crewMember, crewName, setCrewStatus } from "../rules/crew";
import { atBase, BASE_UPGRADES, buildUpgrade, stash, STOCK_KINDS, stockValue, takeFromStash, UPGRADES, type StockKind } from "../rules/base";
import { ERRAND_TASKS, isActive, nameOf, sendSurvivor, survivorOf, type ErrandTask } from "../rules/group";
import { gameMinutes, isZombie } from "../rules/survival";
import { getSpell } from "../srd";
import { addInventoryItem } from "./items";

/**
 * Downtime the player plays directly from the sidebar, with no DM turn
 * (components/play/DenPanel.tsx, CrewPanel.tsx, Group.tsx): the engine
 * validates and applies it, the route appends one short system line to the
 * log (in the campaign's language) and the DM reads it, with the engine's
 * own text, in the next turn's digest (lib/dm/digest.ts).
 *
 * Each function throws on a refusal (the message goes back to the player)
 * and returns { log, engine }: the player's line and the DM's facts.
 */

export type CrewPlace = "with_pc" | "at_den" | "away";
export type CyberDowntimeOp =
	| { op: "take_gig"; gig: string }
	| { op: "decline_gig"; gig: string }
	| { op: "crew"; npcId: string; status: CrewPlace }
	| { op: "write"; program: string }
	| { op: "lay_low"; days: number };
export const CYBER_DOWNTIME_OPS = ["take_gig", "decline_gig", "crew", "write", "lay_low"] as const;

export type CompanionPlace = "with_party" | "at_base";
export type BaseDowntimeOp =
	| { op: "stash"; items: { itemId: string; qty?: number }[] }
	| { op: "take"; kind: StockKind; qty: number }
	| { op: "build"; upgrade: BaseUpgrade }
	| { op: "errand"; npcId: string; task: ErrandTask; hours: number }
	| { op: "place"; npcId: string; status: CompanionPlace };
export const BASE_DOWNTIME_OPS = ["stash", "take", "build", "errand", "place"] as const;

export interface DowntimeResult {
	/** The player's line for the log (campaign language). */
	log: string;
	/** What the engine did, for the DM (English). */
	engine: string;
	/** Time passed: what to compare with once the daily ticks have run (afterDays). */
	before?: DaysBefore;
}
export interface DaysBefore {
	cred: number;
	writing?: string;
	debt: number;
}

const langOf = (state: GameState): Lang => (state.settings.language === "es" ? "es" : "en");
const clock = (at: number) => `${String(Math.floor((at % DAY) / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;

/**
 * The system log line for a downtime action: the player sees `log`; the
 * engine's facts (including what the daily ticks did) ride in `tools`, which
 * the chat doesn't show for system lines and the digest passes to the DM.
 */
export function downtimeLogEntry(id: string, log: string, engine: string): LogEntry {
	return { id, role: "system", text: log, tools: [{ name: "downtime", summary: engine }], ts: Date.now() };
}

// ─── Root Access ────────────────────────────────────────────────────────────

/** The Den and Crew tabs. Refuses outside Root Access, mid-fight and while jacked in. */
export function cyberDowntime(state: GameState, op: CyberDowntimeOp): DowntimeResult {
	if (!isCyber(state)) throw new Error("Only in Root Access.");
	if (state.encounter?.status === "active") throw new Error("Not in the middle of a fight.");
	if (state.cyber?.run) throw new Error("Not while jacked in.");
	if (state.challenge?.status === "active") throw new Error(translate(langOf(state), "challenge.busy"));
	const lang = langOf(state);
	const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
	switch (op.op) {
		case "take_gig": {
			// The board sends exact ids; no fuzzy title matching from the UI.
			const g = (state.cyber?.gigs ?? []).find((x) => x.id === op.gig);
			if (!g) throw new Error(`No gig '${op.gig}'.`);
			const r = takeGig(state, g.id);
			return { log: t("downtime.gig.taken", { title: g.title, client: g.client }), engine: `The player took a gig from the Den tab. ${r.text}` };
		}
		case "decline_gig": {
			const r = declineGig(state, op.gig);
			return { log: t("downtime.gig.declined", { title: r.gig.title }), engine: `The player turned down a gig from the Den tab. ${r.text}` };
		}
		case "crew": {
			if (!["with_pc", "at_den", "away"].includes(op.status)) throw new Error("status is with_pc, at_den or away.");
			const m = crewMember(state, op.npcId);
			const name = crewName(state, m);
			if (m.status === op.status) throw new Error(`${name} is already ${op.status.replace("_", " ")}.`);
			const text = setCrewStatus(state, m, op.status, "the player's call, from the Crew tab");
			return { log: t(`downtime.crew.${op.status}` as MessageKey, { name }), engine: text };
		}
		case "write": {
			const r = writeProgram(state, op.program);
			if (!r.ok) throw new Error(r.text);
			const w = denOf(state).writing!;
			const name = getSpell(w.program)?.name ?? w.program;
			return { log: t("downtime.write", { program: name, day: Math.floor(w.readyAt / DAY) }), engine: `From the Den tab: ${r.text}` };
		}
		case "lay_low": {
			const days = Math.round(Number(op.days));
			if (!(days >= 1 && days <= LAY_LOW_MAX_DAYS)) throw new Error(`Lie low 1 to ${LAY_LOW_MAX_DAYS} days.`);
			const den = state.cyber?.den;
			if (den?.raidDue) throw new Error(den.raidDue.started ? "Not during a raid." : "Not now: someone is coming for the den.");
			const cy = cyberOf(state);
			const heat = cy.heat;
			const before = { cred: state.character.currency.gp, writing: den?.writing?.program, debt: den?.debt ?? 0 };
			const text = layLow(state, days);
			return { before, log: t(days === 1 ? "downtime.layLow.one" : "downtime.layLow", { n: days, day: state.time.day, from: heat, to: cy.heat }), engine: `The player lay low from the Den tab. ${text.replace(/ Nothing else happened.*$/, "")} Nothing else happened in those days beyond what the engine reports below; no need to narrate the days.` };
		}
	}
	throw new Error("Unknown op.");
}

/** Extra player-facing facts after time passed (the tick's results the player should see on the log line). */
export function afterDays(state: GameState, before: DaysBefore): string {
	const lang = langOf(state);
	const out: string[] = [];
	const cred = state.character.currency.gp;
	if (cred !== before.cred) out.push(translate(lang, "downtime.after.cred", { from: before.cred, to: cred }));
	const debt = state.cyber?.den?.debt ?? 0;
	if (debt > before.debt) out.push(translate(lang, "downtime.after.debt", { n: debt }));
	if (before.writing && !state.cyber?.den?.writing) out.push(translate(lang, "downtime.after.written", { program: getSpell(before.writing)?.name ?? before.writing }));
	return out.join(" ");
}

// ─── The Quiet ──────────────────────────────────────────────────────────────

/** The Group tab's base and companion controls. Refuses outside The Quiet, mid-fight and during a siege. */
export function baseDowntime(state: GameState, op: BaseDowntimeOp, newId: () => string): DowntimeResult {
	if (!isZombie(state)) throw new Error("Only in The Quiet.");
	if (state.encounter?.status === "active") throw new Error("Not in the middle of a fight.");
	if (state.siege) throw new Error("Not during a siege.");
	if (state.challenge?.status === "active") throw new Error(translate(langOf(state), "challenge.busy"));
	const lang = langOf(state);
	const t = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
	const kindName = (k: StockKind) => t(`group.stock.${k}` as MessageKey).toLowerCase();
	switch (op.op) {
		case "stash": {
			if (!Array.isArray(op.items) || !op.items.length) throw new Error("Nothing to stash.");
			const base = state.group?.base;
			const before = base ? { ...base.stock } : undefined;
			for (const x of op.items) {
				const item = state.character.inventory.find((i) => i.id === x.itemId);
				if (!item) throw new Error(`Not in the inventory: ${x.itemId}.`);
				if (!stockValue(item)) throw new Error(`${item.name} doesn't go into the stock.`);
			}
			const text = stash(state, { items: op.items.map((x) => ({ itemId: x.itemId, ...(x.qty ? { qty: x.qty } : {}) })) });
			const after = state.group!.base!.stock;
			const added = STOCK_KINDS.filter((k) => after[k] > (before?.[k] ?? 0)).map((k) => `${kindName(k)} +${after[k] - (before?.[k] ?? 0)}`);
			return { log: t("downtime.base.stashed", { what: added.join(", ") }), engine: `The player stashed supplies from the Group tab. ${text}` };
		}
		case "take": {
			if (!STOCK_KINDS.includes(op.kind)) throw new Error(`kind must be one of ${STOCK_KINDS.join(", ")}.`);
			const res = takeFromStash(state, op.kind, Number(op.qty));
			for (const i of res.items) addInventoryItem(state, { name: i.name, ref: i.ref, quantity: i.qty }, newId);
			return { log: t("downtime.base.took", { n: res.units, kind: kindName(op.kind) }), engine: `The player took supplies from the Group tab. ${res.text}` };
		}
		case "build": {
			if (!BASE_UPGRADES.includes(op.upgrade)) throw new Error("Unknown upgrade.");
			const text = buildUpgrade(state, op.upgrade);
			const job = state.group!.base!.building!.find((b) => b.upgrade === op.upgrade)!;
			return {
				log: t("downtime.base.build", { name: t(`group.upgrade.${op.upgrade}` as MessageKey), day: Math.floor(job.readyAt / DAY), time: clock(job.readyAt), h: UPGRADES[op.upgrade].hours }),
				engine: `The player started a base upgrade from the Group tab. ${text.replace(/ Building is work.*$/, "")} (Already done; a line of the work is enough.)`,
			};
		}
		case "errand": {
			if (!ERRAND_TASKS.includes(op.task)) throw new Error(`task must be one of ${ERRAND_TASKS.join(", ")}.`);
			const hours = Math.round(Number(op.hours));
			if (!(hours >= 1 && hours <= 24)) throw new Error("An errand lasts 1 to 24 hours.");
			const sv = survivorOf(state, op.npcId);
			const text = sendSurvivor(state, sv, op.task, hours);
			return { log: t("downtime.errand", { name: nameOf(state, sv), task: t(`downtime.task.${op.task}` as MessageKey), h: hours }), engine: `From the Group tab: ${text}` };
		}
		case "place": {
			if (op.status !== "with_party" && op.status !== "at_base") throw new Error("status is with_party or at_base.");
			const sv = survivorOf(state, op.npcId);
			const name = nameOf(state, sv);
			if (!isActive(sv)) throw new Error(`${name} is no longer in the group (${sv.status}).`);
			if (sv.status === "away") throw new Error(`${name} is away until their errand is done.`);
			if (sv.status === op.status) throw new Error(`${name} is already ${op.status.replace("_", " ")}.`);
			if (!state.group?.base) throw new Error("There is no base yet.");
			// Picking someone up from the base means being there.
			if (op.status === "with_party" && !atBase(state)) throw new Error(`${name} is at the base; go there to bring them along.`);
			sv.status = op.status;
			if (op.status === "at_base") state.scene.npcIds = state.scene.npcIds.filter((id) => id !== sv.npcId);
			else {
				if (!state.scene.npcIds.includes(sv.npcId)) state.scene.npcIds = [...state.scene.npcIds, sv.npcId];
				const npc = state.npcs[sv.npcId];
				if (npc) npc.locationId = state.world.currentLocationId;
			}
			const where = op.status === "at_base" ? "stays at the base" : "comes along with the PC";
			return { log: t(`downtime.place.${op.status}` as MessageKey, { name }), engine: `From the Group tab: ${name} ${where} (now ${op.status.replace("_", " ")}), as of ${clock(gameMinutes(state.time))}.` };
		}
	}
	throw new Error("Unknown op.");
}
