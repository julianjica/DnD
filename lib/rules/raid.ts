import type { CyberState, DenState, DenUpgradeId, GameState } from "../game/types";
import { getMonster } from "../srd/index";
import { addHeat, cyberOf, hatBand, type HeatThreshold } from "./cyber";
import { DEN_UPGRADES, denLog as denLogAt } from "./den";
import type { Rng } from "./dice";
import { allyBonus, allyCap, budgetCap, soloMultiplier, type Difficulty } from "./encounter-budget";
import { gameMinutes } from "./survival";

/**
 * Root Access: raids on the den (docs/cyberpunk.md §5–6). Heat 8, a dump
 * whose trace found the den, or a betrayal schedules one a few game hours
 * ahead (den.raidDue) so the DM can foreshadow it; when the hour comes the DM
 * runs it as an ordinary fight on the den map (raid_begin) with the den's
 * defences in play, and closes it with raid_end (won / lost / fled).
 *
 * A separate, small module: the zombie siege (lib/rules/siege.ts) stays The
 * Quiet's. Pure rules over GameState; lib/dm/tools/raid.ts wraps them.
 */

export type RaidBy = NonNullable<DenState["raidDue"]>["by"];
export type RaidOutcome = "won" | "lost" | "fled";

/** Who comes, for the DM. */
export const RAIDERS: Record<RaidBy, string> = {
	ferro: "a Grupo Ferro squad",
	gang: "Los Ahogados (a gang hit)",
	bounty: "bounty hunters",
	corp: "Vantis corporate security",
};

/** Hours of warning by cause (the DM foreshadows in between). */
export const RAID_HOURS = { heat: 6, bounty: 8, dump: 4, betrayal: 3 } as const;
/** Heat crossing 8 again this soon after a raid doesn't bring another one. */
export const RAID_COOLDOWN_MIN = 2 * 1440;
/** At most this many attackers. */
export const RAID_MAX_FORCE = 8;
export const RAID_HEAT_WON = -2;

/** Bolted into the place: lost when the den moves. The rest moves with you (a literal, not read from den.ts at load: cyber → raid → den import cycle). */
export const FIXED_UPGRADES: DenUpgradeId[] = ["steel_door", "cameras", "turret", "hidden_exit", "faraday_mesh", "sleep_pod", "med_bay"];

/** A worse raid replaces a milder one already due (never the other way round). */
const SEVERITY: Record<RaidBy, number> = { ferro: 0, gang: 1, corp: 2, bounty: 3 };

const hoursText = (min: number) => (min <= 0 ? "now" : min < 90 ? `in ${min} min` : `in ~${Math.round(min / 60)} h`);

/** What an upgrade cost to install, all its levels (seized most valuable first). */
export function upgradeValue(id: DenUpgradeId, level: number): number {
	return (DEN_UPGRADES[id]?.prices ?? []).slice(0, Math.max(1, level)).reduce((a, b) => a + b, 0);
}

// ─── triggers ───────────────────────────────────────────────────────────────

export interface ScheduleResult {
	scheduled: boolean;
	text: string;
}

/** scheduleRaid on the CyberState (addHeat's hook has no GameState). */
export function scheduleRaidOn(cy: CyberState, now: number, by: RaidBy, reason: string, hoursAhead: number = RAID_HOURS.heat): ScheduleResult {
	const den = cy.den;
	const who = RAIDERS[by];
	if (!den) return { scheduled: false, text: `RAID: ${who} would come for the den (${reason}), but the PC has no den yet: they come for the PC in the street instead (the DM's call).` };
	const at = now + Math.max(0, Math.round(hoursAhead * 60));
	const due = den.raidDue;
	if (due?.started) return { scheduled: false, text: `RAID: a raid on the den is already on; ${who} (${reason}) can wait.` };
	if (due) {
		const worse = SEVERITY[by] > SEVERITY[due.by];
		if (worse) {
			due.by = by;
			due.reason = reason.trim().slice(0, 160);
		}
		due.at = Math.min(due.at, at);
		return {
			scheduled: worse,
			text: worse
				? `RAID ESCALATES: it's ${who} now (${reason}), reaching ${den.name} ${hoursText(due.at - now)}. Foreshadow it.`
				: `RAID: one is already due at ${den.name} ${hoursText(due.at - now)} (${RAIDERS[due.by]}).`,
		};
	}
	den.raidDue = { reason: reason.trim().slice(0, 160), at, by };
	denLogAt(den, now, `Raid due (${by}): ${reason}`);
	return {
		scheduled: true,
		text: `RAID DUE: ${who} will hit ${den.name} ${hoursText(at - now)} (${reason}). Foreshadow it before it lands (a car parked too long, a drone over the roof, La Tía's warning); when the hour comes the digest says so: raid_begin if the PC is home.`,
	};
}

/**
 * Schedules a raid on the den `hoursAhead` game hours from now (agent CREW's
 * betrayals, story beats). `by`: who comes. Returns the DM line.
 */
export function scheduleRaid(state: GameState, by: RaidBy, reason: string, hoursAhead: number = RAID_HOURS.betrayal): ScheduleResult {
	return scheduleRaidOn(cyberOf(state), gameMinutes(state.time), by, reason, hoursAhead);
}

/**
 * addHeat's hook: Heat reaching 8 brings a raid (Ferro, or a gang for a black
 * hat), reaching 10 a bounty raid. Returns the DM line ("" when nothing).
 */
export function raidOnHeat(cy: CyberState, crossed: Pick<HeatThreshold, "id">[], now: number): string {
	if (!cy.den) return "";
	if (crossed.some((t) => t.id === "bounty")) return scheduleRaidOn(cy, now, "bounty", "Heat 10: a bounty is posted on the PC", RAID_HOURS.bounty).text;
	if (!crossed.some((t) => t.id === "raid")) return "";
	const last = cy.den.raids[cy.den.raids.length - 1];
	if (last && now - last.at < RAID_COOLDOWN_MIN && !cy.den.raidDue) return "";
	const by: RaidBy = hatBand(cy.hat) === "black" ? "gang" : "ferro";
	return scheduleRaidOn(cy, now, by, by === "gang" ? "Heat 8: a rival crew sold the den's location to Los Ahogados" : "Heat 8: someone talked to Ferro", RAID_HOURS.heat).text;
}

/** The dump's den roll found the den: a raid by the system's owner (Vantis targets bring corp security). */
export function raidOnDump(state: GameState, target: string): string {
	const by: RaidBy = /vantis/i.test(target) ? "corp" : "ferro";
	return scheduleRaid(state, by, `a dump from ${target} traced back to the den`, RAID_HOURS.dump).text;
}

// ─── the force ──────────────────────────────────────────────────────────────

const ROSTERS: Record<RaidBy, { leaders: string[]; grunts: string[] }> = {
	ferro: { leaders: ["c-ferro-tactical", "c-ferro-officer"], grunts: ["c-ferro-guard", "c-security-drone"] },
	gang: { leaders: ["c-ahogados-boss", "c-ahogados-enforcer"], grunts: ["c-ahogados-ganger", "c-ahogados-lookout"] },
	bounty: { leaders: ["c-bounty-hunter"], grunts: ["c-spider-drone", "c-security-drone", "c-ahogados-ganger"] },
	corp: { leaders: ["c-corporate-bodyguard"], grunts: ["c-security-drone", "c-spider-drone", "c-ferro-guard"] },
};
/** When even one of them is too much for a low-level PC: a lone spotter sent ahead. */
const SPOTTER = "c-ahogados-lookout";
const SPOTTER_NAME: Record<RaidBy, string> = { ferro: "Ferro Informant", gang: "Ahogados Lookout", bounty: "Hunter's Scout", corp: "Corporate Scout" };

export const TURRET = "c-den-turret";

const xpOf = (ix: string) => getMonster(ix)?.xp ?? 0;
const adjusted = (list: string[]) => Math.round(list.reduce((n, ix) => n + xpOf(ix), 0) * soloMultiplier(list.length));

/** Share of the budget the raid uses at this Heat (they send more when you're hot). */
export function heatFactor(heat: number): number {
	return heat >= 10 ? 1 : heat >= 8 ? 0.9 : heat >= 6 ? 0.8 : 0.7;
}

export interface RaidForce {
	by: RaidBy;
	monsters: { monster: string; count: number; name?: string }[];
	/** Every attacker, one ref each. */
	list: string[];
	xp: number;
	adjustedXp: number;
	target: number;
	summary: string;
}

/**
 * The attackers, sized to the solo encounter budget (lib/rules/encounter-budget.ts)
 * at the campaign difficulty, scaled by Heat, plus the allies' bonus. A leader
 * first if one fits, then the rank and file. Deterministic.
 */
export function raidForce(by: RaidBy, level: number, difficulty: Difficulty, heat: number, allyXps: number[] = []): RaidForce {
	const allyXp = allyXps.reduce((a, b) => a + b, 0);
	const cap = budgetCap(level, difficulty) + allyBonus(Math.min(allyXp, allyCap(level)));
	const target = Math.round(cap * heatFactor(heat));
	const { leaders, grunts } = ROSTERS[by];
	const list: string[] = [];
	for (const l of [...leaders].sort((a, b) => xpOf(b) - xpOf(a))) {
		if (adjusted([l]) <= target * 0.75) {
			list.push(l);
			break;
		}
	}
	const rank = [...grunts].sort((a, b) => xpOf(b) - xpOf(a));
	for (let k = 0; list.length < RAID_MAX_FORCE; k++) {
		const order = [...rank.slice(k % rank.length), ...rank.slice(0, k % rank.length)];
		const fit = order.find((g) => adjusted([...list, g]) <= target);
		if (!fit) break;
		list.push(fit);
	}
	let spotter = false;
	if (!list.length) {
		const cheapest = [...leaders, ...grunts].sort((a, b) => xpOf(a) - xpOf(b))[0];
		spotter = adjusted([cheapest]) > Math.round(cap * 1.5);
		list.push(spotter ? SPOTTER : cheapest);
	}
	const counts = new Map<string, number>();
	for (const ix of list) counts.set(ix, (counts.get(ix) ?? 0) + 1);
	const monsters = [...counts].map(([monster, count]) => ({ monster, count, ...(spotter ? { name: SPOTTER_NAME[by] } : {}) }));
	const xp = list.reduce((n, ix) => n + xpOf(ix), 0);
	const adjustedXp = adjusted(list);
	const names = monsters.map((m) => `${m.count} × ${m.name ?? getMonster(m.monster)?.name ?? m.monster}`).join(", ");
	return { by, monsters, list, xp, adjustedXp, target, summary: `${RAIDERS[by]}: ${names} (${xp} XP, ${adjustedXp} adjusted; raid budget ${target} at level ${level}, ${difficulty}, Heat ${heat})` };
}

export const pcLevel = (state: GameState) => state.character.classes.reduce((n, k) => n + k.level, 0);

/** The force for the raid due now, for this PC (allies' XP widens it). */
export function forceFor(state: GameState, allyXps: number[] = []): RaidForce | undefined {
	const due = state.cyber?.den?.raidDue;
	if (!due) return undefined;
	return raidForce(due.by, pcLevel(state), state.settings.structure.difficulty, state.cyber!.heat, allyXps);
}

// ─── defences ───────────────────────────────────────────────────────────────

export interface RaidDefences {
	/** The attackers lose their first turn breaching the door (incapacitated for 1 round). */
	steelDoor: boolean;
	/** No surprise, and the PC knows the force. */
	cameras: boolean;
	/** An allied combatant (c-den-turret). */
	turret: boolean;
	/** A lost raid can be fled: nothing seized. */
	hiddenExit: boolean;
	/** The PC is caught by surprise (no cameras, no door to warn them): disadvantage on initiative. */
	pcSurprised: boolean;
	text: string[];
}

export function raidDefences(den: DenState): RaidDefences {
	const has = (u: DenUpgradeId) => (den.upgrades[u] ?? 0) > 0;
	const steelDoor = has("steel_door");
	const cameras = has("cameras");
	const turret = has("turret");
	const hiddenExit = has("hidden_exit");
	const pcSurprised = !cameras && !steelDoor;
	const text = [
		steelDoor ? "STEEL DOOR: every attacker loses its first turn breaching it (charges, a ram)" : "no steel door: they come straight in",
		cameras ? "CAMERAS: no surprise, and the PC saw exactly who is coming" : steelDoor ? "no cameras, but the door's breaching warns the PC: no surprise" : "no cameras and no door: the PC is SURPRISED (disadvantage on initiative)",
		turret ? "TURRET: fights on the PC's side (c-den-turret)" : "",
		hiddenExit ? "HIDDEN EXIT: if it goes badly the PC can slip out (raid_end fled): nothing seized, but the den moves" : "",
	].filter(Boolean);
	return { steelDoor, cameras, turret, hiddenExit, pcSurprised, text };
}

// ─── the outcome ────────────────────────────────────────────────────────────

/** Installed upgrades, most valuable first (the order they are seized in). */
export function seizeOrder(den: DenState): DenUpgradeId[] {
	const ids = (Object.keys(den.upgrades) as DenUpgradeId[]).filter((u) => (den.upgrades[u] ?? 0) > 0);
	return ids.sort((a, b) => upgradeValue(b, den.upgrades[b] ?? 1) - upgradeValue(a, den.upgrades[a] ?? 1) || a.localeCompare(b));
}

export interface NewDen {
	name: string;
	locationId?: string;
	rent?: number;
}

export interface RaidEndResult {
	seized: DenUpgradeId[];
	lostFixed: DenUpgradeId[];
	moved: boolean;
	text: string;
}

/** Moves the den to the new place: fixed defences stay behind, the rest comes along, rent starts over. */
function moveDen(den: DenState, to: NewDen, now: number): DenUpgradeId[] {
	const lost = FIXED_UPGRADES.filter((u) => (den.upgrades[u] ?? 0) > 0);
	for (const u of lost) delete den.upgrades[u];
	den.moves += 1;
	den.name = to.name.trim().slice(0, 80);
	if (to.locationId) den.locationId = to.locationId;
	delete den.mapId;
	if (to.rent !== undefined) den.rent = Math.max(0, Math.round(to.rent));
	den.rentDueAt = now + 7 * 1440;
	return lost;
}

const label = (u: DenUpgradeId) => u.replace(/_/g, " ");

/**
 * Closes the raid. won: Heat −2. lost: 1–2 upgrades seized (most valuable
 * first; what the PC carries is never touched) and the den moves. fled (needs
 * the hidden exit): nothing seized, but the den moves.
 */
export function endRaid(state: GameState, rng: Rng, outcome: RaidOutcome, to?: NewDen): RaidEndResult {
	const cy = cyberOf(state);
	const den = cy.den;
	if (!den?.raidDue) throw new Error("No raid is due or on.");
	const now = gameMinutes(state.time);
	const by = den.raidDue.by;
	const who = RAIDERS[by];
	if (outcome === "won" && !den.raidDue.started) throw new Error("The raid was never fought (raid_begin first). If the PC was away, it's 'lost'.");
	if (outcome === "fled" && !(den.upgrades.hidden_exit ?? 0)) throw new Error("No hidden exit in this den: there was no way out. Use 'lost'.");
	if (outcome !== "won" && !to?.name?.trim()) throw new Error("The den must move: name the new place (newDenName), and its rent if it differs.");
	const out: string[] = [];
	let seized: DenUpgradeId[] = [];
	let lostFixed: DenUpgradeId[] = [];
	if (outcome === "won") {
		const h = addHeat(cy, RAID_HEAT_WON, `fought off the raid on ${den.name}`, now);
		out.push(`RAID WON: ${who} are driven off ${den.name}. ${h.text} Nothing is seized; the den stays.`);
		denLogAt(den, now, `Raid won (${by})`);
	} else {
		if (outcome === "lost") {
			const n = Math.min(rng.int(1, 2), seizeOrder(den).length);
			seized = seizeOrder(den).slice(0, n);
			for (const u of seized) delete den.upgrades[u];
			if (seized.includes("workbench")) delete den.writing;
		}
		const from = den.name;
		lostFixed = moveDen(den, to!, now);
		const head =
			outcome === "lost"
				? `RAID LOST: ${who} take ${from}. ${seized.length ? `SEIZED: ${seized.map(label).join(", ")}.` : "Nothing worth seizing was installed."}`
				: `FLED through the hidden exit: ${who} burst into an empty ${from}. Nothing seized.`;
		out.push(
			head,
			`The den MOVES to ${den.name} (move ${den.moves}).${lostFixed.length ? ` Left behind, bolted into the old place: ${lostFixed.map(label).join(", ")}.` : ""} ${Object.keys(den.upgrades).length ? `Moving with the PC: ${Object.keys(den.upgrades).map((u) => label(u as DenUpgradeId)).join(", ")}.` : "Nothing else to move."} Everything the PC carries stays with them. Rent ${den.rent}/week, first due in 7 days.${den.mapId ? "" : " Draw the new den when the PC gets there."}`,
		);
		denLogAt(den, now, outcome === "lost" ? `Raid lost (${by}); seized ${seized.join(", ") || "nothing"}; moved to ${den.name}` : `Fled the raid (${by}); moved to ${den.name}`);
	}
	den.raids.push({ at: now, won: outcome === "won", seized, moved: outcome !== "won" });
	delete den.raidDue;
	return { seized, lostFixed, moved: outcome !== "won", text: out.join(" ") };
}

// ─── digest ─────────────────────────────────────────────────────────────────

/** The digest line while a raid is due or on (undefined otherwise). */
export function raidDigest(state: GameState): string | undefined {
	const den = state.cyber?.den;
	const due = den?.raidDue;
	if (!den || !due) return undefined;
	const now = gameMinutes(state.time);
	const who = RAIDERS[due.by];
	if (due.started) return `RAID ON at ${den.name}: ${who}. Play the fight; when it ends (end_combat) close it with raid_end won, lost or fled (fled only with the hidden exit).`;
	if (now >= due.at) return `RAID NOW: ${who} reach ${den.name} (${due.reason}). PC at the den: raid_begin (the engine sizes the force and sets the defences). PC away: they hit an empty den: raid_end lost (crew there may hold it in the story).`;
	const cams = (den.upgrades.cameras ?? 0) > 0 ? ` Cameras: the PC can see them coming (raid_status shows the force).` : "";
	return `RAID DUE ${hoursText(due.at - now)}: ${who} are coming for ${den.name} (${due.reason}). Foreshadow it now; let the PC prepare, leave or lie low.${cams}`;
}
