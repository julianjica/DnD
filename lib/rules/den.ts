import type { Character, CyberState, DenState, DenUpgradeId, GameState } from "../game/types";
import { getSpell, SPELLS, toIndex } from "../srd";
import type { SpellInfo } from "../game/types";
import { classLevelOf } from "./character/derived";
import { maxSpellLevelFor } from "./character/slots";
import { getClass } from "../srd";
import { addHeat, cyberOf, HISTORY_CAP, isCyber, shiftHat } from "./cyber";
import type { Rng } from "./dice";
import { gameMinutes } from "./survival";

/**
 * Root Access: the den and its upgrades (docs/cyberpunk.md §6). Pure engine:
 * the PC's home (the capsule room above a noodle stall in Los Anegados at the
 * start), weekly rent to La Tía, debt and repossession, upgrades bought with
 * cred (the character's gp), passive income, the sleep pod and the workbench.
 * Raids (lib/rules/raid.ts) read the defence levels and move the den.
 *
 * Effects live where they apply:
 * - ram_rack: +1 RAM slot per level (lib/rules/deck.ts syncRamSlots, casters only).
 * - cooling: +1 to program save DCs and attacks while jacked in (overclocking
 *   without overheating; synced as spellcasting.overclock by syncRamSlots, and
 *   added to deck built-in programs by the deck_program tool).
 * - proxy_chain: jack_in with body "den" starts the run with proxy 2 (lib/rules/netrun.ts).
 * - faraday_mesh: denFoundModifier (−5 on the den-found roll when dumped; the raid engine calls it).
 * - sleep_pod: every 7 nights spent at the den, +1 Humanity (up to the max).
 * - med_bay: implants can be installed at home (install_implant says so).
 * - botnet / render_farm: cred every day (exclusive); the botnet risks Heat daily and drags the Hat −1 a week.
 * - workbench: write programs (writeProgram; finished by the daily tick).
 * - steel_door, cameras, turret, hidden_exit: raid defences (lib/rules/raid.ts).
 */

export const DAY = 1440;
export const WEEK = 7 * DAY;
/** La Tía's rent for the capsule room, per week. */
export const START_RENT = 200;
/** Her cut of every gig's pay while the PC owes her. */
export const DEBT_CUT = 0.25;
/** Debt above this many weeks of rent: she repossesses the most expensive upgrade (checked when rent comes due). */
export const REPO_WEEKS = 4;
/** Botnet: chance per day that it draws attention (+1 Heat). */
export const BOTNET_HEAT_CHANCE = 5; // 1 in 5
/** Sleep pod: nights at the den for +1 Humanity. */
export const POD_NIGHTS = 7;
export const DEN_LOG_CAP = 30;
/** The faraday mesh's penalty to the "did they find the den?" roll when the PC is dumped. */
export const FARADAY_DEN_FOUND = -5;
/** What cooling adds to program save DCs and attacks during a net run. */
export const COOLING_BONUS = 1;
/** Proxy ticks the proxy chain gives a run started from the den. */
export const PROXY_CHAIN_TICKS = 2;

export type DenUpgradeKind = "net" | "home" | "income" | "defence";

export interface DenUpgradeDef {
	id: DenUpgradeId;
	kind: DenUpgradeKind;
	/** Price of each level in cred (index 0 = level 1). */
	prices: number[];
	/** Bolted to the walls: lost when the den moves (raids). */
	fixed: boolean;
	/** EN name and effect, for the DM. The UI has its own EN/ES strings (lib/i18n/parts/cyber.ts). */
	name: string;
	effect: string;
	/** Can't be installed together with this one. */
	excludes?: DenUpgradeId;
	/** Cred a day (income upgrades). */
	income?: number;
}

/**
 * The catalogue. Prices sit against the gear list (a second-hand deck 150, a
 * tier-1 deck 1500, a RAM expansion implant 5000 for one slot) and the rent
 * (200 a week): early upgrades take a few gigs, the RAM rack's third level is a
 * late-game buy.
 */
export const DEN_UPGRADES: Record<DenUpgradeId, DenUpgradeDef> = {
	ram_rack: { id: "ram_rack", kind: "net", prices: [1200, 3000, 6000], fixed: false, name: "RAM rack", effect: "+1 program slot (RAM) per level, for characters who run programs" },
	cooling: { id: "cooling", kind: "net", prices: [1000], fixed: false, name: "Cooling", effect: `overclock without overheating: +${COOLING_BONUS} to program save DCs and attacks during a net run` },
	proxy_chain: { id: "proxy_chain", kind: "net", prices: [2500], fixed: false, name: "Proxy chain", effect: `runs started from the den ignore the first ${PROXY_CHAIN_TICKS} trace` },
	faraday_mesh: { id: "faraday_mesh", kind: "defence", prices: [1500], fixed: true, name: "Faraday mesh", effect: `when the PC is dumped, the den is harder to find (${FARADAY_DEN_FOUND} to the roll); raid defence` },
	steel_door: { id: "steel_door", kind: "defence", prices: [800], fixed: true, name: "Steel door", effect: "raid defence: the door holds a while" },
	cameras: { id: "cameras", kind: "defence", prices: [600], fixed: true, name: "Cameras", effect: "raid defence: you see them coming" },
	turret: { id: "turret", kind: "defence", prices: [3500], fixed: true, name: "Turret", effect: "raid defence: it shoots back" },
	hidden_exit: { id: "hidden_exit", kind: "defence", prices: [2000], fixed: true, name: "Hidden exit", effect: "escape a lost raid without losing everything" },
	sleep_pod: { id: "sleep_pod", kind: "home", prices: [1200], fixed: true, name: "Sleep pod", effect: `every ${POD_NIGHTS} nights slept at the den: +1 Humanity (up to the max)` },
	med_bay: { id: "med_bay", kind: "home", prices: [4000], fixed: true, name: "Med bay", effect: "install chrome and heal at home, no clinic needed" },
	workbench: { id: "workbench", kind: "home", prices: [1000], fixed: false, name: "Workbench", effect: "write new programs (cred and days of downtime) and build gear" },
	botnet: { id: "botnet", kind: "income", prices: [3000], fixed: false, name: "Botnet rig", income: 40, excludes: "render_farm", effect: "+40 cred a day; each day a 1 in 5 chance of +1 Heat, and the Hat drifts −1 a week" },
	render_farm: { id: "render_farm", kind: "income", prices: [2500], fixed: false, name: "Render farm", income: 20, excludes: "botnet", effect: "+20 cred a day, clean" },
};

export const DEN_UPGRADE_IDS = Object.keys(DEN_UPGRADES) as DenUpgradeId[];
export const maxLevel = (id: DenUpgradeId) => DEN_UPGRADES[id].prices.length;
export const levelOf = (den: Pick<DenState, "upgrades"> | undefined, id: DenUpgradeId): number => den?.upgrades[id] ?? 0;
/** Price of the next level, or undefined when maxed. */
export function nextPrice(den: Pick<DenState, "upgrades"> | undefined, id: DenUpgradeId): number | undefined {
	return DEN_UPGRADES[id].prices[levelOf(den, id)];
}

const cred = (c: Character) => c.currency.gp;
const daysBetween = (a: number, b: number) => Math.floor(b / DAY) - Math.floor(a / DAY);

export function denLog(den: DenState, at: number, line: string): void {
	const d = Math.floor(at / DAY);
	den.log.push(`Day ${d}: ${line}`);
	if (den.log.length > DEN_LOG_CAP) den.log.splice(0, den.log.length - DEN_LOG_CAP);
}

// ─── the den ────────────────────────────────────────────────────────────────

/** The world location of the starting den (lib/maps/marea.ts "den"), else wherever the PC is. */
function startLocation(state: Pick<GameState, "world">): { id: string; name?: string } {
	const w = state.world;
	const loc = w.locations.find((l) => l.id === "loc-ma-den" || l.id.endsWith("-den")) ?? w.locations.find((l) => l.id === w.currentLocationId);
	return { id: loc?.id ?? w.currentLocationId ?? "", name: loc?.name };
}

/** The Burned opening: the capsule room above a noodle stall in Los Anegados, 200 a week, first rent due in a week. */
export function initDen(state: Pick<GameState, "world" | "settings">, minute: number): DenState {
	const loc = startLocation(state);
	const es = state.settings.language === "es";
	return {
		name: loc.name ?? (es ? "La cápsula" : "The Capsule Room"),
		locationId: loc.id,
		rent: START_RENT,
		rentDueAt: minute + WEEK,
		debt: 0,
		upgrades: {},
		raids: [],
		moves: 0,
		lastTick: minute,
		log: [],
	};
}

/** The den, created on first use (older cyber saves). Cyberpunk only (callers check). */
export function denOf(state: GameState): DenState {
	const cy = cyberOf(state);
	if (!cy.den) cy.den = initDen(state, gameMinutes(state.time));
	return cy.den;
}

/** Is the PC at the den right now? */
export const atDen = (state: Pick<GameState, "cyber" | "world">): boolean => !!state.cyber?.den && state.world.currentLocationId === state.cyber.den.locationId;

// ─── effects other engines read ─────────────────────────────────────────────

/** Extra RAM slots from the den's RAM rack (deck.ts adds them for characters with slots). */
export const denRamBonus = (cy: Pick<CyberState, "den"> | undefined): number => levelOf(cy?.den, "ram_rack");

/** Proxy ticks for a run started with the body in the den. */
export const denProxy = (cy: Pick<CyberState, "den"> | undefined, body: string): number => (body === "den" && levelOf(cy?.den, "proxy_chain") > 0 ? PROXY_CHAIN_TICKS : 0);

/** Cooling: +1 to program DCs and attacks while a net run is on. */
export const coolingBonus = (cy: Pick<CyberState, "den" | "run"> | undefined): number => (cy?.run && levelOf(cy.den, "cooling") > 0 ? COOLING_BONUS : 0);

/** Modifier to the "did they find the den?" roll when the PC is dumped (≤ 0). For the raid engine. */
export function denFoundModifier(state: Pick<GameState, "cyber">): number {
	return levelOf(state.cyber?.den, "faraday_mesh") > 0 ? FARADAY_DEN_FOUND : 0;
}

export const hasMedBay = (state: Pick<GameState, "cyber">): boolean => levelOf(state.cyber?.den, "med_bay") > 0;

// ─── buying ─────────────────────────────────────────────────────────────────

export function buyUpgrade(state: GameState, id: DenUpgradeId): { ok: boolean; text: string; level?: number; price?: number } {
	const def = DEN_UPGRADES[id];
	if (!def) return { ok: false, text: `Unknown den upgrade '${id}'. Options: ${DEN_UPGRADE_IDS.join(", ")}.` };
	const den = denOf(state);
	const lvl = levelOf(den, id);
	const price = nextPrice(den, id);
	if (price === undefined) return { ok: false, text: `${def.name} is already at its top level (${lvl}).` };
	if (def.excludes && levelOf(den, def.excludes) > 0) return { ok: false, text: `${def.name} can't run next to the ${DEN_UPGRADES[def.excludes].name}: one or the other (the power and the bandwidth won't stretch).` };
	const c = state.character;
	if (cred(c) < price) return { ok: false, text: `${def.name}${def.prices.length > 1 ? ` level ${lvl + 1}` : ""} costs ${price} cred; ${c.name} has ${cred(c)}.` };
	c.currency.gp -= price;
	den.upgrades[id] = lvl + 1;
	const now = gameMinutes(state.time);
	const label = def.prices.length > 1 ? `${def.name} ${lvl + 1}` : def.name;
	denLog(den, now, `installed ${label} (${price} cred)`);
	return { ok: true, level: lvl + 1, price, text: `Installed ${label} in ${den.name} for ${price} cred (${cred(c)} left): ${def.effect}.` };
}

// ─── rent and debt ──────────────────────────────────────────────────────────

/** Pays La Tía: the debt first, then rent ahead (moves the due date a week per full rent). */
export function payRent(state: GameState, amount: number): { ok: boolean; text: string; paid?: number } {
	const den = denOf(state);
	const c = state.character;
	const want = Math.max(0, Math.round(amount));
	if (!want) return { ok: false, text: "Pay how much?" };
	if (cred(c) < want) return { ok: false, text: `${c.name} has only ${cred(c)} cred.` };
	const now = gameMinutes(state.time);
	let left = want;
	const toDebt = Math.min(left, den.debt);
	den.debt -= toDebt;
	left -= toDebt;
	let weeks = 0;
	while (left >= den.rent && weeks < 8) {
		left -= den.rent;
		den.rentDueAt += WEEK;
		weeks++;
	}
	const paid = want - left;
	if (!paid) return { ok: false, text: `Nothing owed now; a week ahead is ${den.rent} cred (rent is due ${dueText(den, now)}).` };
	c.currency.gp -= paid;
	const parts = [toDebt ? `${toDebt} off the debt (${den.debt} left)` : "", weeks ? `${weeks} week${weeks === 1 ? "" : "s"} of rent ahead` : ""].filter(Boolean).join(", ");
	denLog(den, now, `paid La Tía ${paid} cred: ${parts}`);
	return { ok: true, paid, text: `Paid La Tía ${paid} cred: ${parts}. Next rent ${dueText(den, now)}.${left ? ` (${left} cred kept: less than a week's rent.)` : ""}` };
}

export function dueText(den: DenState, now: number): string {
	const days = Math.ceil((den.rentDueAt - now) / DAY);
	return days <= 0 ? "due now" : `due in ${days} day${days === 1 ? "" : "s"} (Day ${Math.floor(den.rentDueAt / DAY)})`;
}

/** Value of the upgrade La Tía would take: the priciest installed level. */
function priciest(den: DenState): DenUpgradeId | undefined {
	let best: DenUpgradeId | undefined;
	let bestPrice = -1;
	for (const id of DEN_UPGRADE_IDS) {
		const lvl = levelOf(den, id);
		if (!lvl) continue;
		const p = DEN_UPGRADES[id].prices[lvl - 1];
		if (p > bestPrice) {
			best = id;
			bestPrice = p;
		}
	}
	return best;
}

/** La Tía takes the most expensive upgrade (one level of it); she sells it and half its price comes off the debt. */
export function repossess(state: GameState): string | undefined {
	const den = denOf(state);
	const id = priciest(den);
	if (!id) return undefined;
	const lvl = levelOf(den, id);
	const price = DEN_UPGRADES[id].prices[lvl - 1];
	if (lvl <= 1) delete den.upgrades[id];
	else den.upgrades[id] = lvl - 1;
	const credit = Math.floor(price / 2);
	den.debt = Math.max(0, den.debt - credit);
	const name = DEN_UPGRADES[id].name;
	denLog(den, gameMinutes(state.time), `La Tía repossessed the ${name}${lvl > 1 ? ` (level ${lvl})` : ""}; ${credit} cred off the debt`);
	return `La Tía's people came for the ${name}${lvl > 1 ? ` (level ${lvl} → ${lvl - 1})` : ""}: repossessed and sold, ${credit} cred off the debt (${den.debt} left). Play it: polite, unhurried, final.`;
}

// ─── the workbench: writing programs ────────────────────────────────────────

export const programCost = (level: number) => 100 * Math.max(1, level) ** 2;
export const programDays = (level: number) => 2 * Math.max(1, level);

/** A cyberpunk program by id or name. */
export function findProgram(ref: string): SpellInfo | undefined {
	const r = ref.trim();
	const s = getSpell(r) ?? getSpell(`p-${toIndex(r)}`) ?? SPELLS.find((x) => x.ruleset === "cyberpunk" && x.name.toLowerCase() === r.toLowerCase());
	return s?.ruleset === "cyberpunk" ? s : undefined;
}

/** The spellcasting class a written program goes into: one whose list has it, at a level they can run, that learns programs (not one that loads from its whole list). */
function writerClass(c: Character, p: SpellInfo): { entry: NonNullable<Character["spellcasting"]>["classes"][number]; codebook: boolean } | { problem: string } {
	const entries = c.spellcasting?.classes ?? [];
	if (!entries.length) return { problem: `${c.name} doesn't run programs (no RAM to load them into).` };
	let problem = `${p.name} isn't on ${c.name}'s program list.`;
	for (const e of entries) {
		if (!p.classes.includes(e.classId)) continue;
		const max = maxSpellLevelFor(e.classId, classLevelOf(c, e.classId));
		if (p.level > max) {
			problem = `${p.name} is level ${p.level}; ${c.name} can only run up to level ${max} programs.`;
			continue;
		}
		const sc = getClass(e.classId)?.spellcasting;
		const codebook = e.classId === "wizard";
		if (sc?.prepares && !codebook) {
			problem = `${p.name} is already on ${c.name}'s list: they load it from there after a long rest, no need to write it.`;
			continue;
		}
		return { entry: e, codebook };
	}
	return { problem };
}

/** Starts writing a program at the workbench: pays 100 × level² cred, done in level × 2 days (the daily tick). */
export function writeProgram(state: GameState, ref: string): { ok: boolean; text: string } {
	const den = denOf(state);
	if (!levelOf(den, "workbench")) return { ok: false, text: "The den has no workbench (buy_upgrade workbench first)." };
	if (den.writing) return { ok: false, text: `Already writing ${getSpell(den.writing.program)?.name ?? den.writing.program}; one program at a time.` };
	const p = findProgram(ref);
	if (!p) return { ok: false, text: `'${ref}' is not a known program. Use lookup_srd to find program ids (p-…).` };
	if (p.level < 1) return { ok: false, text: `${p.name} is a routine (level 0): routines come from training, not the workbench.` };
	const c = state.character;
	const w = writerClass(c, p);
	if ("problem" in w) return { ok: false, text: w.problem };
	if (w.entry.known.includes(p.index) || w.entry.prepared.includes(p.index)) return { ok: false, text: `${c.name} already has ${p.name}.` };
	const cost = programCost(p.level);
	if (cred(c) < cost) return { ok: false, text: `Writing ${p.name} (level ${p.level}) costs ${cost} cred in compute and stolen libraries; ${c.name} has ${cred(c)}.` };
	c.currency.gp -= cost;
	const now = gameMinutes(state.time);
	const days = programDays(p.level);
	den.writing = { program: p.index, readyAt: now + days * DAY };
	denLog(den, now, `started writing ${p.name} (${cost} cred, ${days} days)`);
	return { ok: true, text: `Writing ${p.name} (level ${p.level}) at the workbench: ${cost} cred spent, ready in ${days} days of downtime (Day ${Math.floor(den.writing.readyAt / DAY)}). The engine adds it to ${w.codebook ? "the codebook" : "their programs"} when it's done.` };
}

/** Adds a finished program to the character. */
function finishWriting(state: GameState, den: DenState, now: number): string {
	const id = den.writing!.program;
	delete den.writing;
	const p = getSpell(id);
	const c = state.character;
	if (!p) return `The program ${id} didn't compile (unknown).`;
	const w = writerClass(c, p);
	if ("problem" in w) return `${p.name} is finished but can't be used: ${w.problem}`;
	if (!w.entry.known.includes(p.index)) w.entry.known.push(p.index);
	if (!w.codebook) {
		if (!w.entry.prepared.includes(p.index)) w.entry.prepared.push(p.index);
		// Doesn't count against programs known at the next level-up.
		if (!c.features.some((f) => f.id === `written-program:${p.index}`))
			c.features.push({ id: `written-program:${p.index}`, name: `Written program: ${p.name}`, source: "den:workbench", description: `${p.name} was written at the den's workbench; it doesn't count against programs known.` });
	}
	denLog(den, now, `finished writing ${p.name}`);
	return `${p.name} is written and compiled: it's in ${w.codebook ? "the codebook (load it after a long rest)" : `${c.name}'s programs`}.`;
}

// ─── the daily den tick ─────────────────────────────────────────────────────

/**
 * Runs after every state mutation in cyberpunk campaigns: for each day passed,
 * income (botnet or render farm; the botnet's Heat risk) and the sleep pod;
 * rent each week (paid from cred if they have it, else debt; the botnet drags
 * the Hat −1; deep debt → repossession); a program finished at the workbench.
 * Returns DM lines, or undefined when nothing happened.
 */
export function denTick(state: GameState, rng: Rng): string | undefined {
	if (!isCyber(state) || !state.cyber) return undefined;
	const cy = state.cyber;
	const den = denOf(state);
	const now = gameMinutes(state.time);
	const out: string[] = [];
	const c = state.character;
	const days = Math.min(366, daysBetween(den.lastTick, now));
	if (days > 0) {
		den.lastTick = now;
		const botnet = levelOf(den, "botnet") > 0;
		const income = (botnet ? DEN_UPGRADES.botnet.income! : 0) + (levelOf(den, "render_farm") ? DEN_UPGRADES.render_farm.income! : 0);
		if (income) {
			c.currency.gp += income * days;
			out.push(`${botnet ? "Botnet" : "Render farm"}: +${income * days} cred (${days} day${days === 1 ? "" : "s"}).`);
		}
		if (botnet) {
			let hits = 0;
			for (let i = 0; i < days; i++) if (rng.int(1, BOTNET_HEAT_CHANCE) === 1) hits++;
			if (hits) out.push(addHeat(cy, hits, "the botnet drew attention", now).text);
		}
		if (levelOf(den, "sleep_pod") && atDen(state)) {
			den.podNights = (den.podNights ?? 0) + days;
			if (den.podNights >= POD_NIGHTS) {
				const gain = Math.floor(den.podNights / POD_NIGHTS);
				den.podNights %= POD_NIGHTS;
				const from = cy.humanity;
				cy.humanity = Math.min(cy.humanityMax, from + gain);
				if (cy.humanity > from) {
					cy.history.push({ at: now, meter: "humanity", delta: cy.humanity - from, why: "a week of real sleep in the pod" });
					if (cy.history.length > HISTORY_CAP) cy.history.splice(0, cy.history.length - HISTORY_CAP);
					out.push(`Sleep pod: a week of real sleep. Humanity ${from} → ${cy.humanity}/${cy.humanityMax}.`);
					denLog(den, now, `a week in the sleep pod (+${cy.humanity - from} Humanity)`);
				}
			}
		}
	}
	// Rent, week by week.
	let weeks = 0;
	while (now >= den.rentDueAt && weeks < 52) {
		weeks++;
		den.rentDueAt += WEEK;
		if (cred(c) >= den.rent) {
			c.currency.gp -= den.rent;
			denLog(den, now, `La Tía collected the rent (${den.rent})`);
			out.push(`Rent: La Tía collected ${den.rent} cred (${cred(c)} left).`);
		} else {
			den.debt += den.rent;
			denLog(den, now, `couldn't pay the rent: debt ${den.debt}`);
			out.push(`Rent: ${c.name} couldn't pay the ${den.rent}; La Tía puts it on the tab. Debt ${den.debt} cred: she takes ${Math.round(DEBT_CUT * 100)}% of every gig until it's paid.`);
		}
		if (levelOf(den, "botnet")) out.push(shiftHat(cy, -1, "a week of running a botnet on strangers' machines", now).text);
		if (den.debt > REPO_WEEKS * den.rent) {
			const r = repossess(state);
			if (r) out.push(r);
		}
	}
	if (den.writing && now >= den.writing.readyAt) out.push(finishWriting(state, den, now));
	return out.length ? out.map((l) => `DEN: ${l}`).join("\n") : undefined;
}

// ─── for the DM ─────────────────────────────────────────────────────────────

export function upgradeLine(den: DenState): string {
	const have = DEN_UPGRADE_IDS.filter((id) => levelOf(den, id));
	return have.length ? have.map((id) => (maxLevel(id) > 1 ? `${DEN_UPGRADES[id].name} ${levelOf(den, id)}` : DEN_UPGRADES[id].name)).join(", ") : "none";
}

/** den_status: everything about the den, with the catalogue. */
export function denStatus(state: GameState): string {
	const den = denOf(state);
	const now = gameMinutes(state.time);
	const c = state.character;
	const lines = [
		`DEN: ${den.name} [${den.locationId}]${atDen(state) ? " (the PC is here)" : ""}. Cred ${cred(c)}. Rent ${den.rent}/week, ${dueText(den, now)}.${den.debt ? ` DEBT to La Tía ${den.debt} (she takes ${Math.round(DEBT_CUT * 100)}% of gig pay; over ${REPO_WEEKS * den.rent} she repossesses).` : ""}`,
		`Installed: ${DEN_UPGRADE_IDS.filter((id) => levelOf(den, id)).map((id) => `${DEN_UPGRADES[id].name}${maxLevel(id) > 1 ? ` ${levelOf(den, id)}` : ""} (${DEN_UPGRADES[id].effect})`).join("; ") || "nothing yet"}.`,
	];
	if (den.writing) lines.push(`Writing: ${getSpell(den.writing.program)?.name ?? den.writing.program}, ready Day ${Math.floor(den.writing.readyAt / DAY)}.`);
	const forSale = DEN_UPGRADE_IDS.filter((id) => nextPrice(den, id) !== undefined).map((id) => `${id} ${nextPrice(den, id)}${maxLevel(id) > 1 ? ` (level ${levelOf(den, id) + 1})` : ""}`);
	lines.push(`For sale (buy_upgrade; the player can also buy on the Den tab): ${forSale.join(", ")}.`);
	if (den.log.length) lines.push(`Recent: ${den.log.slice(-4).join("; ")}.`);
	return lines.join("\n");
}

/** One digest line. */
export function denDigest(state: GameState): string | undefined {
	const den = state.cyber?.den;
	if (!den) return undefined;
	const now = gameMinutes(state.time);
	const bits = [`Den: ${den.name}${atDen(state) ? " (here)" : ""}`, `rent ${den.rent}/wk ${dueText(den, now)}`];
	if (den.debt) bits.push(`DEBT ${den.debt} (La Tía takes ${Math.round(DEBT_CUT * 100)}% of gig pay)`);
	bits.push(`upgrades: ${upgradeLine(den)}`);
	if (den.writing) bits.push(`writing ${getSpell(den.writing.program)?.name ?? den.writing.program} (Day ${Math.floor(den.writing.readyAt / DAY)})`);
	return bits.join(" · ");
}
