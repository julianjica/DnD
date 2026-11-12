import type { Character, CyberState, GameState, ImplantSlot, InstalledImplant, RollRecord } from "../game/types";
import { checkBreakdown } from "./character/derived";
import { roll, signed, type Rng } from "./dice";
import { rulesetOf } from "./ruleset";
import { raidOnHeat } from "./raid";
import { advanceClock, gameMinutes } from "./survival";

/**
 * Root Access: the three meters (docs/cyberpunk.md §5). Hat (−10 black …
 * +10 white), Heat (0…10, how hard they're looking) and Humanity (what the
 * chrome has cost). Engine-authoritative; only cyberpunk campaigns use it
 * (callers check `isCyber(state)` first).
 *
 * The CyberState-level functions mutate the meters in place and return what
 * happened plus a short EN line for the DM; the GameState-level ones (layLow,
 * humanityCheck, cyberTick) also touch the clock, the dice log or DM notes.
 */

export type RecordRoll = (r: RollRecord) => void;

export const isCyber = (state: Pick<GameState, "settings">): boolean => rulesetOf(state.settings) === "cyberpunk";

export const HAT_MIN = -10;
export const HAT_MAX = 10;
export const HEAT_MAX = 10;
/** The Burned opening: they're already looking for you. */
export const START_HEAT = 3;
export const HISTORY_CAP = 40;
export const THERAPY_PER_SESSION = 2;
/** At or below this, a crit fail or a bad shock calls for a Wisdom save. */
export const EPISODE_AT = 10;
/** At or below this, ordinary people sense it. */
export const UNSETTLING_AT = 5;
/** After a Fracture, humanity is set to this. */
export const AFTER_FRACTURE = 5;

/** How many implants each body slot holds. */
export const IMPLANT_SLOTS: Record<ImplantSlot, number> = { neural: 2, eyes: 2, arms: 2, legs: 2, skin: 1, internal: 3 };

/** Hat as "+2", "0", "-3". */
export const hatText = (n: number) => (n > 0 ? `+${n}` : String(n));

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** The meters at the start of a Root Access campaign (the Burned opening). */
export function initCyberState(character: Character, minute: number): CyberState {
	const humanityMax = 10 + (character.abilities?.wis ?? 10);
	return { hat: 0, heat: START_HEAT, humanity: humanityMax, humanityMax, implants: [], history: [], heatDecayedAt: minute };
}

/** The meters, created on first use (older or hand-made saves). */
export function cyberOf(state: GameState): CyberState {
	if (!state.cyber) state.cyber = initCyberState(state.character, gameMinutes(state.time));
	return state.cyber;
}

function log(cy: CyberState, at: number, meter: "hat" | "heat" | "humanity", delta: number, why: string): void {
	if (!delta) return;
	cy.history.push({ at, meter, delta, why: why.trim().slice(0, 160) });
	if (cy.history.length > HISTORY_CAP) cy.history.splice(0, cy.history.length - HISTORY_CAP);
}

// ─── Hat ────────────────────────────────────────────────────────────────────

export type HatBand = "black" | "grey" | "white";

export function hatBand(hat: number): HatBand {
	return hat <= -4 ? "black" : hat >= 4 ? "white" : "grey";
}

/** What each band opens and closes (for the DM digest). */
export const HAT_BANDS: Record<HatBand, { opens: string; closes: string }> = {
	white: {
		opens: "Bureau and bug-bounty work, licensed and reliable gear, crew with a conscience stay",
		closes: "ransomware and data-broker jobs, exotic black-market chrome",
	},
	grey: {
		opens: "a bit of everything: La Tía's ordinary gigs, both markets at a markup",
		closes: "the best of either side (top Bureau contracts, the deep black market)",
	},
	black: {
		opens: "ransomware and data brokers (better paid), exotic black-market chrome",
		closes: "Bureau and bug-bounty work, licensed vendors, crew with a conscience",
	},
};

export function shiftHat(cy: CyberState, delta: number, why: string, now: number): { from: number; to: number; band: HatBand; bandChanged: boolean; text: string } {
	const from = cy.hat;
	cy.hat = clamp(from + delta, HAT_MIN, HAT_MAX);
	const to = cy.hat;
	log(cy, now, "hat", to - from, why);
	const band = hatBand(to);
	const bandChanged = band !== hatBand(from);
	let text = to === from ? `Hat stays ${hatText(to)} (${band}; the scale ends at ${hatText(delta < 0 ? HAT_MIN : HAT_MAX)}).` : `Hat ${hatText(from)} → ${hatText(to)} (${band}): ${why}.`;
	if (bandChanged) text += ` Now ${band.toUpperCase()} hat: opens ${HAT_BANDS[band].opens}; closes ${HAT_BANDS[band].closes}.`;
	return { from, to, band, bandChanged, text };
}

// ─── Heat ───────────────────────────────────────────────────────────────────

export interface HeatThreshold {
	at: 3 | 6 | 8 | 10;
	id: "prices" | "sweep" | "raid" | "bounty";
	/** What happens when Heat reaches it (EN, for the DM). */
	text: string;
	/** What it means while Heat stays at or above it. */
	standing: string;
}

export const HEAT_THRESHOLDS: HeatThreshold[] = [
	{ at: 3, id: "prices", text: "prices rise and La Tía turns cautious", standing: "prices up, La Tía cautious" },
	{ at: 6, id: "sweep", text: "Ferro sweeps through the PC's district: checkpoints, scans, doors kicked in", standing: "Ferro sweeping the district" },
	{ at: 8, id: "raid", text: "a raid on the den is due: someone talked, and a squad is coming", standing: "a den raid is due" },
	{ at: 10, id: "bounty", text: "a bounty is posted on the PC, and the hunters come", standing: "bounty posted, hunters out" },
];

/** Thresholds in effect at this Heat. */
export function activeHeatEffects(heat: number): HeatThreshold[] {
	return HEAT_THRESHOLDS.filter((t) => heat >= t.at);
}

function heatLine(from: number, to: number, crossed: HeatThreshold[], cleared: HeatThreshold[]): string {
	const parts: string[] = [];
	for (const t of crossed) parts.push(`HEAT ${t.at}: ${t.text}. Put it in play.`);
	for (const t of cleared) parts.push(`Below ${t.at}: no longer ${t.standing}.`);
	return parts.join(" ");
}

export function addHeat(cy: CyberState, delta: number, why: string, now: number): { from: number; to: number; crossed: HeatThreshold[]; cleared: HeatThreshold[]; text: string } {
	const from = cy.heat;
	cy.heat = clamp(from + delta, 0, HEAT_MAX);
	const to = cy.heat;
	log(cy, now, "heat", to - from, why);
	const crossed = HEAT_THRESHOLDS.filter((t) => from < t.at && to >= t.at);
	const cleared = HEAT_THRESHOLDS.filter((t) => from >= t.at && to < t.at);
	const head = to === from ? `Heat stays ${to}/${HEAT_MAX}.` : `Heat ${from} → ${to}/${HEAT_MAX}: ${why}.`;
	// Heat 8 / 10 schedules a raid on the den (lib/rules/raid.ts).
	const extra = [heatLine(from, to, crossed, cleared), raidOnHeat(cy, crossed, now)].filter(Boolean).join(" ");
	return { from, to, crossed, cleared, text: extra ? `${head} ${extra}` : head };
}

/** Whole game days between two game minutes (day boundaries crossed). */
const daysBetween = (a: number, b: number) => Math.floor(b / 1440) - Math.floor(a / 1440);

/**
 * Daily decay: Heat drops 1 for each day boundary crossed since the last decay.
 * Returns the DM line, or undefined when no day has passed.
 */
export function decayHeat(cy: CyberState, now: number): string | undefined {
	const last = cy.heatDecayedAt ?? now;
	const days = daysBetween(last, now);
	if (days <= 0) {
		if (cy.heatDecayedAt === undefined) cy.heatDecayedAt = now;
		return undefined;
	}
	cy.heatDecayedAt = now;
	if (cy.heat <= 0) return undefined;
	const r = addHeat(cy, -days, days === 1 ? "a day passed" : `${days} days passed`, now);
	return `CYBER: ${r.text}`;
}

export const LAY_LOW_MAX_DAYS = 14;

/**
 * Lie low for some days: time passes (nothing else happens; the DM narrates),
 * and Heat drops 2 a day (the usual 1 plus 1 for keeping your head down).
 */
export function layLow(state: GameState, days: number): string {
	const cy = cyberOf(state);
	const d = clamp(days, 1, LAY_LOW_MAX_DAYS);
	const before = cy.heat;
	// The usual decay up to now first, so it isn't counted twice.
	decayHeat(cy, gameMinutes(state.time));
	advanceClock(state, d * 1440);
	const now = gameMinutes(state.time);
	addHeat(cy, -d, `lying low ${d} day${d === 1 ? "" : "s"}`, now);
	decayHeat(cy, now);
	const cleared = HEAT_THRESHOLDS.filter((t) => before >= t.at && cy.heat < t.at);
	const t = state.time;
	return [
		`Lay low ${d} day${d === 1 ? "" : "s"}: now Day ${t.day}, ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}. Heat ${before} → ${cy.heat}/${HEAT_MAX}.`,
		cleared.length ? cleared.map((x) => `Below ${x.at}: no longer ${x.standing}.`).join(" ") : "",
		"Nothing else happened (no jobs, no cred earned); narrate the days in hiding briefly.",
	]
		.filter(Boolean)
		.join(" ");
}

// ─── Humanity ───────────────────────────────────────────────────────────────

/** What installImplant needs from an equipment entry. */
export interface ImplantSource {
	index: string;
	name?: string;
	implant?: { slot: ImplantSlot; humanity: number; effect: string };
}

export function slotsUsed(cy: CyberState, slot: ImplantSlot): number {
	return cy.implants.filter((i) => i.slot === slot).length;
}

/** Standing effects of the current Humanity (for the digest and the tools). */
export function humanityEffects(h: number): string[] {
	const out: string[] = [];
	if (h <= UNSETTLING_AT) out.push("ordinary people sense something wrong (disadvantage on Persuasion) and the crew worries");
	if (h <= EPISODE_AT) out.push(`crit fails and bad shocks call for a WIS save (humanity_check, DC ${episodeDc(h)})`);
	return out;
}

export const episodeDc = (h: number) => 10 + (10 - Math.max(0, h));

function crossingNote(from: number, to: number): string {
	if (from > UNSETTLING_AT && to <= UNSETTLING_AT) return ` Humanity ${UNSETTLING_AT} or less: ordinary people now sense it (disadvantage on Persuasion) and the crew worries.`;
	if (from > EPISODE_AT && to <= EPISODE_AT) return ` Humanity ${EPISODE_AT} or less: from now on a crit fail or a bad shock (0 HP, a death they caused) calls for humanity_check.`;
	if (from <= UNSETTLING_AT && to > UNSETTLING_AT) return " Above 5 again: people stop flinching.";
	return "";
}

/**
 * A Fracture (humanity 0): the crew steps in, the most humanity-expensive
 * implant comes out, humanity is set to 5 and the PC wakes in a clinic, in debt.
 * A setback, never the end.
 */
export function fracture(cy: CyberState, now: number, why = "Fracture"): { removed?: InstalledImplant; text: string } {
	let removed: InstalledImplant | undefined;
	if (cy.implants.length) {
		let k = 0;
		cy.implants.forEach((imp, i) => {
			if (imp.humanity > cy.implants[k].humanity) k = i;
		});
		removed = cy.implants.splice(k, 1)[0];
	}
	const from = cy.humanity;
	cy.humanity = Math.min(AFTER_FRACTURE, cy.humanityMax);
	log(cy, now, "humanity", cy.humanity - from, why);
	const text = `FRACTURE: humanity hit 0. The crew steps in; ${removed ? `the ${removed.ref} (${removed.slot}) is pulled out` : "nothing left to pull, but they hold the PC down"}, and the PC wakes up in a clinic chair, IN DEBT for the work (charge it with adjust_currency or as a debt in the story). Humanity is now ${cy.humanity}/${cy.humanityMax}. A setback, never the end: narrate the blackout and the waking, not a death.`;
	return { removed, text };
}

export function installImplant(cy: CyberState, item: ImplantSource, now: number): { ok: boolean; text: string; fractured?: boolean } {
	const imp = item.implant;
	const label = item.name ? `${item.name} [${item.index}]` : item.index;
	if (!imp) return { ok: false, text: `${label} is not cyberware (no implant block).` };
	const cap = IMPLANT_SLOTS[imp.slot];
	const used = slotsUsed(cy, imp.slot);
	if (used >= cap) {
		const there = cy.implants.filter((i) => i.slot === imp.slot).map((i) => i.ref).join(", ");
		return { ok: false, text: `No room: the ${imp.slot} slot holds ${cap} and is full (${there}). Remove one first (remove_implant).` };
	}
	const cost = Math.max(0, Math.round(imp.humanity));
	cy.implants.push({ ref: item.index, slot: imp.slot, humanity: cost, installedAt: now });
	const from = cy.humanity;
	cy.humanity = Math.max(0, from - cost);
	log(cy, now, "humanity", cy.humanity - from, `installed ${item.name ?? item.index}`);
	let text = `Installed ${label} (${imp.slot} ${used + 1}/${cap}): ${imp.effect}. Humanity ${from} → ${cy.humanity}/${cy.humanityMax}.`;
	if (cy.humanity <= 0) {
		const f = fracture(cy, now);
		return { ok: true, fractured: true, text: `${text} ${f.text}` };
	}
	text += crossingNote(from, cy.humanity);
	return { ok: true, text };
}

export function removeImplant(cy: CyberState, ref: string, now: number): { ok: boolean; text: string; removed?: InstalledImplant } {
	const want = ref.trim().toLowerCase();
	let k = -1;
	for (let i = cy.implants.length - 1; i >= 0; i--) if (cy.implants[i].ref.toLowerCase() === want) { k = i; break; }
	if (k < 0) {
		const have = cy.implants.map((i) => i.ref).join(", ") || "none";
		return { ok: false, text: `No installed implant '${ref}'. Installed: ${have}.` };
	}
	const removed = cy.implants.splice(k, 1)[0];
	const from = cy.humanity;
	cy.humanity = Math.min(cy.humanityMax, from + removed.humanity);
	log(cy, now, "humanity", cy.humanity - from, `removed ${removed.ref}`);
	return { ok: true, removed, text: `Removed ${removed.ref} (${removed.slot}). Humanity ${from} → ${cy.humanity}/${cy.humanityMax}.${crossingNote(from, cy.humanity)} The hardware is out; give it back with give_item if the PC keeps it.` };
}

export function therapy(cy: CyberState, sessions: number, now: number): { gained: number; text: string } {
	const n = clamp(sessions, 1, 20);
	const from = cy.humanity;
	cy.humanity = Math.min(cy.humanityMax, from + n * THERAPY_PER_SESSION);
	const gained = cy.humanity - from;
	log(cy, now, "humanity", gained, `therapy ×${n}`);
	const text = gained
		? `Therapy ×${n}: humanity ${from} → ${cy.humanity}/${cy.humanityMax}.${crossingNote(from, cy.humanity)} Charge the sessions' cred with adjust_currency.`
		: `Therapy ×${n}: humanity already at its maximum (${cy.humanityMax}); no gain.`;
	return { gained, text };
}

export type Episode = "lost turn" | "lash out" | "freeze";
export const EPISODES: Record<Episode, string> = {
	"lost turn": "the PC loses their next turn: the world goes static and they just stand there",
	"lash out": "the PC lashes out at the nearest person, friend or foe (one attack or a shove, the DM picks the target)",
	freeze: "the PC freezes: they can't move or act until someone snaps them out of it (an action) or the end of their next turn",
};

/**
 * A crit fail or a bad shock (0 HP, a death they caused): at humanity ≤ 10,
 * a Wisdom save (DC 10 + (10 − humanity)) or an episode (rolled).
 */
export function humanityCheck(state: GameState, rng: Rng, record: RecordRoll, trigger: string): { save?: boolean; episode?: Episode; text: string } {
	const cy = cyberOf(state);
	const h = cy.humanity;
	const standing = humanityEffects(h).filter((e) => !e.startsWith("crit fails"));
	const tail = standing.length ? ` Standing: ${standing.join("; ")}.` : "";
	if (h > EPISODE_AT) return { text: `No check: humanity ${h}/${cy.humanityMax} is above ${EPISODE_AT}; ${trigger} doesn't shake them that way.` };
	const c = state.character;
	const dc = episodeDc(h);
	const { mod, check } = checkBreakdown(c, { kind: "save", ability: "wis" });
	const r = roll(rng, `1d20${signed(mod)}`, { label: `WIS save vs episode (${trigger})`, target: dc, actor: c.id });
	r.check = check;
	record(r);
	if (r.success) return { save: true, text: `Humanity check (${trigger}): WIS save ${r.total} vs DC ${dc} SUCCESS. They hold it together.${tail}` };
	const kinds: Episode[] = ["lost turn", "lash out", "freeze"];
	const episode = kinds[rng.int(1, 3) - 1];
	return { save: false, episode, text: `Humanity check (${trigger}): WIS save ${r.total} vs DC ${dc} FAILURE. EPISODE: ${episode}: ${EPISODES[episode]}. Narrate it as the chrome and the nerves misfiring, not as madness.${tail}` };
}

// ─── engine hooks ───────────────────────────────────────────────────────────

/** Runs after every state mutation in cyberpunk campaigns: daily heat decay. */
export function cyberTick(state: GameState): string | undefined {
	if (!state.cyber) return undefined;
	return decayHeat(state.cyber, gameMinutes(state.time));
}

/** One compact line for the DM digest. */
export function cyberDigest(state: GameState): string | undefined {
	const cy = state.cyber;
	if (!cy) return undefined;
	const band = hatBand(cy.hat);
	const implants = cy.implants.length ? cy.implants.map((i) => `${i.ref} (${i.slot}, −${i.humanity})`).join(", ") : "none";
	const effects = [...activeHeatEffects(cy.heat).map((t) => t.standing), ...humanityEffects(cy.humanity)];
	return `Hat ${hatText(cy.hat)} (${band}: opens ${HAT_BANDS[band].opens}) · Heat ${cy.heat}/${HEAT_MAX} · Humanity ${cy.humanity}/${cy.humanityMax} · implants: ${implants}${effects.length ? ` · in effect: ${effects.join("; ")}` : ""}`;
}
