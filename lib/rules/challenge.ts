import type { Ability, CrewRole, ChallengeApproach, ChallengeComplication, ChallengeCost, ChallengeKind, ChallengeLogEntry, ChallengeStage, ChallengeState, GameState, RollCheck, RollRecord } from "../game/types";
import { checkBreakdown } from "./character/derived";
import { SKILL_ABILITY } from "./character/tables";
import { roll, signed, type Rng } from "./dice";
import { advanceClock, addNoise, gameMinutes, isZombie } from "./survival";
import { addHeat, cyberOf, isCyber } from "./cyber";
import { activeCrew, crewName } from "./crew";

/**
 * Timed challenges: chases, heists, escapes, infiltrations, races.
 *
 * The DM sets one up (start_challenge) when the player's own action turns
 * into a race against time: a CLOCK of ticks, a TARGET of progress and 1–6
 * STAGES, each with 2–4 APPROACHES (a skill or ability, a DC, how long it
 * takes, what success gains and what failure costs). The player plays it on
 * the Challenge panel: they pick an approach per stage, the engine rolls with
 * their real bonuses (+2 when a companion or crew member with the right skill
 * is with them), applies the result and burns the clock. A success moves on
 * to the next stage; a failure keeps them at the same obstacle and costs what
 * the DM set (time by default; HP, Heat, noise, an item, an alarm).
 * Complications the DM planted fire when the clock runs low. It ends in
 * SUCCESS (progress reaches the target), PARTIAL (the clock runs out with at
 * least half the progress) or FAILURE; the engine applies the stakes' cost on
 * a failure and hands the DM one summary to narrate.
 */

export type RecordRoll = (r: RollRecord) => void;

export const CHALLENGE_KINDS: readonly ChallengeKind[] = ["chase", "heist", "escape", "infiltration", "race", "other"];
export const CLOCK_MIN = 2;
export const CLOCK_MAX = 20;
export const MAX_STAGES = 6;
export const DC_MIN = 5;
export const DC_MAX = 30;
/** Flat bonus when someone with the right skill helps (like the van's +2). */
export const HELP_BONUS = 2;
/** A failure with no cost given loses this many extra ticks. */
export const DEFAULT_FAIL_CLOCK = 1;

const ABILITIES: readonly Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_NAMES: Record<string, Ability> = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };

/** "Sleight of Hand" → "sleight-of-hand"; "Dexterity" → "dex". Throws with the valid values. */
export function normaliseSkill(raw: string): string {
	const s = String(raw ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
	if (SKILL_ABILITY[s]) return s;
	if ((ABILITIES as readonly string[]).includes(s)) return s;
	if (ABILITY_NAMES[s]) return ABILITY_NAMES[s];
	throw new Error(`Unknown skill "${raw}". Use a skill (${Object.keys(SKILL_ABILITY).join(", ")}) or an ability (${ABILITIES.join(", ")}).`);
}

const isAbility = (s: string): s is Ability => (ABILITIES as readonly string[]).includes(s);

// ─── setup ────────────────────────────────────────────────────────────────

export interface ChallengeSetup {
	title: string;
	kind?: string;
	goal: string;
	clock: number;
	target?: number;
	stages: { prompt: string; approaches: { label: string; skill: string; dc: number; success: string; failure: string; time?: number; gain?: number; cost?: ChallengeCost }[] }[];
	stakes: { success: string; partial?: string; failure: string; cost?: ChallengeCost };
	complications?: { text: string; atClock?: number; dcPlus?: number; cost?: ChallengeCost }[];
	minutesPerTick?: number;
}

const clampInt = (n: unknown, lo: number, hi: number, dflt: number) => {
	const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : dflt;
	return Math.max(lo, Math.min(hi, v));
};
const need = (v: unknown, what: string): string => {
	const s = typeof v === "string" ? v.trim() : "";
	if (!s) throw new Error(`${what} is required.`);
	return s;
};

/** Checks a cost against the campaign's ruleset (Heat only in Root Access, noise only in The Quiet). */
function normaliseCost(state: GameState, c: ChallengeCost | undefined, where: string): ChallengeCost {
	if (!c) return {};
	const out: ChallengeCost = {};
	if (c.clock) out.clock = clampInt(c.clock, 0, 5, 0);
	if (c.hp) {
		const hp = String(c.hp).trim();
		if (!/^(\d+d\d+([+-]\d+)?|\d+)$/i.test(hp)) throw new Error(`${where}: hp must be dice like "1d6" or a number, not "${c.hp}".`);
		out.hp = hp;
	}
	if (c.heat) {
		if (!isCyber(state)) throw new Error(`${where}: heat exists only in Root Access; use hp, clock, item or alarm here.`);
		out.heat = clampInt(c.heat, 0, 4, 0);
	}
	if (c.noise) {
		if (!isZombie(state)) throw new Error(`${where}: noise exists only in The Quiet; use hp, clock, item or alarm here.`);
		out.noise = clampInt(c.noise, 0, 5, 0);
	}
	if (c.item?.trim()) out.item = c.item.trim();
	if (c.alarm?.trim()) out.alarm = c.alarm.trim();
	return out;
}

const DEFAULT_MINUTES: Record<ChallengeKind, number> = { chase: 1, escape: 1, race: 1, heist: 5, infiltration: 5, other: 2 };

/** Fewest ticks to reach the target, taking the quickest approach at each stage. */
export function minTicks(stages: ChallengeStage[], target: number): number {
	let progress = 0;
	let ticks = 0;
	for (const st of stages) {
		if (progress >= target) break;
		const best = [...st.approaches].sort((a, b) => a.time / a.gain - b.time / b.gain)[0];
		ticks += best.time;
		progress += best.gain;
	}
	return progress >= target ? ticks : Infinity;
}

/** Validates and normalises the DM's setup into a fresh ChallengeState (throws with what to fix). */
export function buildChallenge(state: GameState, a: ChallengeSetup, id = `ch_${Date.now().toString(36)}`): ChallengeState {
	const title = need(a.title, "title");
	const goal = need(a.goal, "goal");
	const kind = (CHALLENGE_KINDS as readonly string[]).includes(String(a.kind)) ? (a.kind as ChallengeKind) : "other";
	if (!Array.isArray(a.stages) || !a.stages.length) throw new Error("stages: give 3–5 stages (1–6 allowed), each with 2–4 approaches.");
	if (a.stages.length > MAX_STAGES) throw new Error(`stages: at most ${MAX_STAGES}.`);
	const stages: ChallengeStage[] = a.stages.map((st, i) => {
		const prompt = need(st?.prompt, `stages[${i}].prompt`);
		const list = Array.isArray(st?.approaches) ? st.approaches : [];
		if (list.length < 2 || list.length > 4) throw new Error(`stages[${i}]: give 2–4 approaches that differ (fast and risky vs slow and safe, different skills), not ${list.length}.`);
		const approaches: ChallengeApproach[] = list.map((ap, j) => {
			const where = `stages[${i}].approaches[${j}]`;
			const dc = Number(ap?.dc);
			if (!Number.isFinite(dc)) throw new Error(`${where}.dc must be a number (${DC_MIN}–${DC_MAX}; 10 easy, 13 moderate, 15 hard, 18 very hard).`);
			return {
				label: need(ap?.label, `${where}.label`),
				skill: normaliseSkill(ap?.skill),
				dc: clampInt(dc, DC_MIN, DC_MAX, 13),
				success: need(ap?.success, `${where}.success`),
				failure: need(ap?.failure, `${where}.failure`),
				time: clampInt(ap?.time, 1, 3, 1),
				gain: clampInt(ap?.gain, 1, 2, 1),
				cost: normaliseCost(state, ap?.cost, where),
			};
		});
		return { prompt, approaches };
	});
	const clock = clampInt(a.clock, CLOCK_MIN, CLOCK_MAX, 6);
	const target = clampInt(a.target, 1, stages.length, stages.length);
	const fastest = minTicks(stages, target);
	if (fastest > clock) throw new Error(`The clock (${clock}) is shorter than the quickest way through (${fastest === Infinity ? "unreachable" : `${fastest} ticks`}): give more clock, a lower target or quicker approaches.`);
	const stakes = a.stakes ?? ({} as ChallengeSetup["stakes"]);
	const complications: ChallengeComplication[] = (a.complications ?? []).slice(0, 3).map((c, i) => ({
		text: need(c?.text, `complications[${i}].text`),
		atClock: clampInt(c?.atClock, 0, clock - 1, Math.floor(clock / 2)),
		dcPlus: clampInt(c?.dcPlus, 0, 5, 2),
		...(c?.cost ? { cost: normaliseCost(state, c.cost, `complications[${i}]`) } : {}),
	}));
	return {
		id,
		title,
		kind,
		goal,
		clock,
		clockMax: clock,
		progress: 0,
		target,
		stage: 0,
		stages,
		stakes: {
			success: need(stakes.success, "stakes.success"),
			partial: typeof stakes.partial === "string" && stakes.partial.trim() ? stakes.partial.trim() : need(stakes.success, "stakes.success"),
			failure: need(stakes.failure, "stakes.failure"),
			...(stakes.cost ? { cost: normaliseCost(state, stakes.cost, "stakes") } : {}),
		},
		complications,
		dcPlus: 0,
		minutesPerTick: clampInt(a.minutesPerTick, 1, 60, DEFAULT_MINUTES[kind]),
		startedAt: gameMinutes(state.time),
		status: "active",
		log: [],
		pending: [],
	};
}

/** The DM's start: refuses during a fight or while another challenge runs. */
export function startChallenge(state: GameState, a: ChallengeSetup): string {
	if (state.encounter?.status === "active") throw new Error("A fight is on: challenges are for races against time outside fights. Finish the fight first.");
	if (state.challenge?.status === "active") throw new Error(`A challenge is already on ("${state.challenge.title}"). Let the player play it out, or challenge_status cancel to call it off.`);
	const ch = buildChallenge(state, a);
	state.challenge = ch;
	const first = ch.stages[0];
	return `CHALLENGE STARTED: "${ch.title}" (${ch.kind}; goal: ${ch.goal}). Clock ${ch.clock}, target ${ch.target} over ${ch.stages.length} stages; first: ${first.prompt}. The PLAYER now plays it on the Challenge panel (no more DM turns until it ends). Narrate the moment it starts in 1–2 sentences (the danger, the clock), end with suggest_actions as usual, and don't resolve any stage yourself.`;
}

// ─── odds and helpers ─────────────────────────────────────────────────────

/** Which skills each crew role helps with (Root Access). */
const ROLE_SKILLS: Record<CrewRole, string[]> = {
	driver: ["acrobatics", "athletics", "perception", "dex"],
	face: ["persuasion", "deception", "intimidation", "insight", "performance", "cha"],
	muscle: ["athletics", "intimidation", "str", "con"],
	medic: ["medicine", "insight", "wis"],
	runner: ["acrobatics", "stealth", "athletics", "sleight-of-hand", "dex"],
	tech: ["investigation", "arcana", "sleight-of-hand", "perception", "int"],
};

/** Someone with the player who knows this (a companion proficient in it, or crew whose role fits). */
export function helperFor(state: GameState, skill: string): string | undefined {
	if (isZombie(state)) {
		const sv = Object.values(state.group?.survivors ?? {})
			.filter((s) => s.status === "with_party" && s.hp > 0 && s.skills.includes(skill))
			.sort((a, b) => a.joinedAt - b.joinedAt)[0];
		return sv ? (state.npcs[sv.npcId]?.name ?? sv.npcId) : undefined;
	}
	if (isCyber(state)) {
		const m = activeCrew(state).find((x) => x.status === "with_pc" && x.hp > 0 && ROLE_SKILLS[x.role]?.includes(skill));
		return m ? crewName(state, m) : undefined;
	}
	return undefined;
}

export interface ApproachOdds {
	/** The PC's modifier (with any help). */
	bonus: number;
	dc: number;
	helper?: string;
	/** Chance to succeed, 0–1. */
	chance: number;
	band: "easy" | "risky" | "hard" | "desperate";
	check: RollCheck;
}

/** The PC's real modifier for an approach (checkBreakdown), help and the current DC. */
export function approachOdds(state: GameState, ap: Pick<ChallengeApproach, "skill" | "dc">, dcPlus = state.challenge?.dcPlus ?? 0): ApproachOdds {
	const skill = ap.skill;
	const { mod, check } = checkBreakdown(state.character, isAbility(skill) ? { kind: "check", ability: skill } : { kind: "check", skill });
	const helper = helperFor(state, skill);
	const bonus = mod + (helper ? HELP_BONUS : 0);
	const dc = ap.dc + dcPlus;
	// d20 + bonus ≥ dc (no automatic 1/20 on checks).
	const chance = Math.max(0, Math.min(1, (21 - (dc - bonus)) / 20));
	const band = chance >= 0.7 ? "easy" : chance >= 0.45 ? "risky" : chance >= 0.2 ? "hard" : "desperate";
	return { bonus, dc, ...(helper ? { helper } : {}), chance, band, check };
}

// ─── costs ────────────────────────────────────────────────────────────────

function loseItem(state: GameState, name: string): string | undefined {
	const want = name.toLowerCase();
	const inv = state.character.inventory;
	const it = inv.find((i) => i.name.toLowerCase() === want) ?? inv.find((i) => i.name.toLowerCase().includes(want) || want.includes(i.name.toLowerCase()));
	if (!it) return undefined;
	if (it.quantity > 1) it.quantity -= 1;
	else inv.splice(inv.indexOf(it), 1);
	return it.name;
}

/** Applies a cost and returns what was actually paid; threshold lines (noise, Heat) go to ch.pending for the DM. */
export function applyCost(state: GameState, rng: Rng, record: RecordRoll, ch: ChallengeState, cost: ChallengeCost, why: string): NonNullable<ChallengeLogEntry["paid"]> {
	const paid: NonNullable<ChallengeLogEntry["paid"]> = {};
	if (cost.clock) {
		const n = Math.min(ch.clock, cost.clock);
		ch.clock -= n;
		if (n) paid.clock = n;
	}
	if (cost.hp) {
		const c = state.character;
		const r = roll(rng, cost.hp, { label: `${why}: damage`, actor: c.id });
		record(r);
		// A challenge hurts, but never knocks the PC out off-screen.
		const lost = Math.max(0, Math.min(r.total, c.hp - 1));
		c.hp -= lost;
		if (lost) paid.hp = lost;
	}
	if (cost.heat && isCyber(state)) {
		const h = addHeat(cyberOf(state), cost.heat, why, gameMinutes(state.time));
		if (h.to !== h.from) paid.heat = h.to - h.from;
		if (h.crossed.length) ch.pending.push(h.text);
	}
	if (cost.noise && isZombie(state)) {
		const line = addNoise(state, rng, cost.noise, why);
		paid.noise = cost.noise;
		if (/THRESHOLD/.test(line)) ch.pending.push(line);
	}
	if (cost.item) {
		const lost = loseItem(state, cost.item);
		if (lost) paid.item = lost;
	}
	if (cost.alarm) paid.alarm = cost.alarm;
	return paid;
}

// ─── play ─────────────────────────────────────────────────────────────────

export interface StepResult {
	entry: ChallengeLogEntry;
	/** The challenge ended with this step. */
	ended: boolean;
	/** EN line for the DM tool result. */
	text: string;
}

/** Complications whose clock mark has been reached fire now (DCs go up, costs apply). */
function fireComplications(state: GameState, rng: Rng, record: RecordRoll, ch: ChallengeState): void {
	for (const c of ch.complications) {
		if (c.fired || ch.clock > c.atClock || ch.status !== "active") continue;
		c.fired = true;
		ch.dcPlus += c.dcPlus;
		const paid = c.cost ? applyCost(state, rng, record, ch, c.cost, `complication: ${c.text}`) : undefined;
		ch.log.push({ kind: "complication", stage: ch.stage, label: c.text, ...(c.dcPlus ? { dc: c.dcPlus } : {}), ...(paid && Object.keys(paid).length ? { paid } : {}) });
	}
}

/**
 * The player takes one approach at the current stage (an index into its
 * approaches, or a custom one the DM built from the player's own words).
 * `stage` guards against a stale click on a stage already passed.
 */
export function takeApproach(state: GameState, rng: Rng, record: RecordRoll, pick: { stage?: number; approach: number | ChallengeApproach }): StepResult {
	const ch = state.challenge;
	if (!ch) throw new Error("There is no challenge.");
	if (ch.status !== "active") throw new Error("The challenge is over.");
	if (state.encounter?.status === "active") throw new Error("A fight is on: the challenge waits until it ends.");
	if (pick.stage !== undefined && pick.stage !== ch.stage) throw new Error("That stage is already behind you.");
	const st = ch.stages[ch.stage];
	const ap = typeof pick.approach === "number" ? st.approaches[pick.approach] : pick.approach;
	if (!ap) throw new Error(`No approach ${String(pick.approach)} at this stage (0–${st.approaches.length - 1}).`);
	const odds = approachOdds(state, ap);
	const c = state.character;
	const r = roll(rng, `1d20${signed(odds.bonus)}`, { label: `${ap.label} (${ch.title})`, target: odds.dc, actor: c.id });
	r.check = odds.helper ? { ...odds.check, parts: [...odds.check.parts, { k: "bonus" as const, value: HELP_BONUS }] } : odds.check;
	record(r);
	const success = !!r.success;
	const stageAt = ch.stage;
	// The attempt takes its time whatever happens.
	const ticks = Math.min(ch.clock, ap.time);
	ch.clock -= ticks;
	let paid: ChallengeLogEntry["paid"];
	if (success) {
		ch.progress += ap.gain;
		ch.stage = Math.min(ch.stages.length - 1, ch.stage + 1);
	} else {
		const cost = Object.keys(ap.cost).length ? ap.cost : { clock: DEFAULT_FAIL_CLOCK };
		paid = applyCost(state, rng, record, ch, cost, `${ch.title}: ${ap.label} failed`);
	}
	const entry: ChallengeLogEntry = {
		kind: "attempt",
		stage: stageAt,
		label: ap.label,
		skill: ap.skill,
		dc: odds.dc,
		total: r.total,
		bonus: odds.bonus,
		success,
		...(odds.helper ? { helper: odds.helper } : {}),
		ticks,
		...(success ? { gain: ap.gain } : {}),
		...(paid && Object.keys(paid).length ? { paid } : {}),
	};
	ch.log.push(entry);
	const allCleared = success && stageAt === ch.stages.length - 1;
	if (ch.progress >= ch.target || allCleared) finish(state, rng, record, "success");
	else if (ch.clock <= 0) finish(state, rng, record, ch.progress * 2 >= ch.target ? "partial" : "failure");
	else {
		fireComplications(state, rng, record, ch);
		// A complication that burns the last ticks ends it too.
		if (ch.status === "active" && ch.clock <= 0) finish(state, rng, record, ch.progress * 2 >= ch.target ? "partial" : "failure");
	}
	const text = `${ap.label} (${ap.skill} ${r.total} vs DC ${odds.dc}${odds.helper ? `, helped by ${odds.helper}` : ""}): ${success ? `SUCCESS — ${ap.success}` : `FAILURE — ${ap.failure}`}. ${paidText(entry.paid)}Clock ${ch.clock}/${ch.clockMax}, progress ${ch.progress}/${ch.target}.`;
	return { entry, ended: ch.status !== "active", text: ch.status !== "active" ? `${text}\n${ch.summary}` : text };
}

export function paidText(p: ChallengeLogEntry["paid"]): string {
	if (!p) return "";
	const parts = [
		p.clock ? `−${p.clock} clock` : "",
		p.hp ? `−${p.hp} HP` : "",
		p.heat ? `Heat +${p.heat}` : "",
		p.noise ? `noise +${p.noise}` : "",
		p.item ? `lost ${p.item}` : "",
		p.alarm ? `alarm: ${p.alarm}` : "",
	].filter(Boolean);
	return parts.length ? `Paid: ${parts.join(", ")}. ` : "";
}

/** Ends the challenge: applies the failure stakes, passes game time and writes the DM's summary. */
export function finish(state: GameState, rng: Rng, record: RecordRoll, status: "success" | "partial" | "failure"): void {
	const ch = state.challenge!;
	ch.status = status;
	let stakesPaid: ChallengeLogEntry["paid"];
	if (status === "failure" && ch.stakes.cost && Object.keys(ch.stakes.cost).length) stakesPaid = applyCost(state, rng, record, ch, { ...ch.stakes.cost, clock: 0 }, `${ch.title} failed`);
	const ticks = ch.clockMax - ch.clock;
	advanceClock(state, ticks * ch.minutesPerTick);
	ch.summary = summaryFor(state, ch, stakesPaid);
}

function summaryFor(state: GameState, ch: ChallengeState, stakesPaid: ChallengeLogEntry["paid"]): string {
	const head = { success: "SUCCESS", partial: "PARTIAL SUCCESS", failure: "FAILURE" }[ch.status as "success" | "partial" | "failure"];
	const stakes = ch.status === "success" ? ch.stakes.success : ch.status === "partial" ? ch.stakes.partial : ch.stakes.failure;
	const steps = ch.log
		.map((e, i) =>
			e.kind === "complication"
				? `${i + 1}. COMPLICATION: ${e.label}${e.paid ? ` (${paidText(e.paid).trim()})` : ""}`
				: `${i + 1}. [${ch.stages[e.stage]?.prompt ?? "?"}] ${e.label}: ${e.skill} ${e.total} vs DC ${e.dc} ${e.success ? "success" : "FAIL"}${e.helper ? ` (helped by ${e.helper})` : ""}${e.paid ? ` — ${paidText(e.paid).trim()}` : ""}`,
		)
		.join("\n");
	const alarms = ch.log.flatMap((e) => (e.paid?.alarm ? [e.paid.alarm] : []));
	const lines = [
		`CHALLENGE OVER — ${head}: "${ch.title}" (goal: ${ch.goal}). Progress ${ch.progress}/${ch.target}, clock ${ch.clock}/${ch.clockMax} left; ${(ch.clockMax - ch.clock) * ch.minutesPerTick} game minutes passed.`,
		`What happened:\n${steps}`,
		`Outcome you set: ${stakes}`,
		stakesPaid && Object.keys(stakesPaid).length ? `Failure cost applied: ${paidText(stakesPaid).replace(/^Paid: /, "").trim()}` : "",
		alarms.length ? `Alarms raised: ${alarms.join("; ")}. The world reacts to them.` : "",
		...ch.pending,
		`HP now ${state.character.hp}/${state.character.maxHp}.`,
	];
	return lines.filter(Boolean).join("\n");
}

/**
 * The player closes the result card. An end the DM never narrated (its turn
 * failed or was stopped) is handed back for narration instead of dropped.
 */
export function dismissChallenge(state: GameState): string | undefined {
	const ch = state.challenge;
	if (!ch) throw new Error("There is no challenge.");
	if (ch.status === "active") throw new Error("The challenge is still running.");
	if (!ch.narrated) return ch.summary;
	delete state.challenge;
	return undefined;
}

/** Calls a challenge off with no engine consequences (the player broke off, the story changed). */
export function cancelChallenge(state: GameState, reason: string): string {
	const ch = state.challenge;
	if (!ch) throw new Error("There is no challenge.");
	const was = ch.status;
	delete state.challenge;
	return was === "active" ? `Challenge "${ch.title}" called off (${reason}). No engine consequences beyond what was already paid; play on from here.` : `Finished challenge "${ch.title}" cleared.`;
}

/** The player gives up mid-challenge: it ends as a failure (stakes apply). */
export function abandonChallenge(state: GameState, rng: Rng, record: RecordRoll): string {
	const ch = state.challenge;
	if (!ch || ch.status !== "active") throw new Error("There is no challenge running.");
	ch.log.push({ kind: "complication", stage: ch.stage, label: "The player broke off." });
	finish(state, rng, record, ch.progress * 2 >= ch.target ? "partial" : "failure");
	return ch.summary!;
}

// ─── digest ───────────────────────────────────────────────────────────────

/** "CHALLENGE" line for the DM digest. */
export function challengeDigest(state: GameState): string | undefined {
	const ch = state.challenge;
	if (!ch) return undefined;
	if (ch.status !== "active") {
		if (ch.narrated) return undefined;
		return `CHALLENGE OVER, NOT YET NARRATED (all its costs are ALREADY applied):\n${ch.summary ?? ""}\nNarrate it in a few lines, then challenge_status clear=true.`;
	}
	const st = ch.stages[ch.stage];
	return `CHALLENGE ACTIVE: "${ch.title}" (${ch.kind}; goal: ${ch.goal}). Clock ${ch.clock}/${ch.clockMax}, progress ${ch.progress}/${ch.target}, stage ${ch.stage + 1}/${ch.stages.length}: ${st.prompt} [${st.approaches.map((a, i) => `${i}: ${a.label} (${a.skill} DC ${a.dc + ch.dcPlus})`).join("; ")}]. The player plays it on the Challenge panel. If they describe what they do in words instead, resolve it with challenge_act (the matching approach index, or a custom approach built from their words); never ability_check its stages. If they turn away from it (stand and fight, surrender, talk), challenge_status cancel with the reason, then play what they chose.`;
}
