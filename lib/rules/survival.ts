import type { BodyPart, Character, Feature, GameState, InventoryItem, MonsterStats, RollRecord, SurvivalState } from "../game/types";
import { MONSTERS } from "../srd";
import { checkBreakdown } from "./character/derived";
import { addExhaustion, applyDamage, grantTempHp, isDead } from "./character/resources";
import { roll, signed, type Rng } from "./dice";
import { outbreakDay, rulesetOf } from "./ruleset";
import { baseDailyTick, refreshBase } from "./base";

/**
 * The Quiet, Phase 2: the survival engine (docs/zombie.md §5). Noise and the
 * dead it draws, the LAZARUS infection from bites, amputation, food and water,
 * and rest interruptions. Everything here is engine-authoritative and only
 * runs in zombie-ruleset campaigns; callers check `isZombie(state)` first.
 *
 * Functions mutate `state` in place (like the DM tools do inside withState)
 * and return short notes for the DM. Visible rolls go through `record` (the
 * dice log); secret rolls (when someone turns, how many dead are coming) use
 * the rng without recording.
 */

export type RecordRoll = (r: RollRecord) => void;

export const isZombie = (state: Pick<GameState, "settings">): boolean => rulesetOf(state.settings) === "zombie";

/** Game minutes since day 0, 00:00 (the unit of every SurvivalState time). */
export function gameMinutes(t: { day: number; hour: number; minute?: number }): number {
	return t.day * 1440 + t.hour * 60 + (t.minute ?? 0);
}

export function advanceClock(state: GameState, minutes: number): void {
	const total = gameMinutes(state.time) + Math.max(0, Math.round(minutes));
	state.time.day = Math.floor(total / 1440);
	state.time.hour = Math.floor((total % 1440) / 60);
	state.time.minute = total % 60;
}

/** The survival state, created on first use (the clock starts now). */
export function survivalOf(state: GameState): SurvivalState {
	if (!state.survival) state.survival = freshSurvival(state);
	return state.survival;
}

function freshSurvival(state: GameState): SurvivalState {
	const now = gameMinutes(state.time);
	return {
		lastTick: now,
		noise: { level: 0, locationId: state.world.currentLocationId, mapId: state.activeMapId },
		amputations: [],
		needs: { lastMeal: now, lastDrink: now, missedMeals: 0, missedDrinks: 0 },
		looted: {},
	};
}

/** Street lights and mains power: the grid fails on outbreak Day 5 (for the art). */
export function powerOn(state: { time: { day: number } }): boolean {
	return outbreakDay(state) < 5;
}

const isNight = (state: GameState) => state.scene.timeOfDay === "night";
const inCombat = (state: GameState) => state.encounter?.status === "active";

/** Keeps the PC combatant (authoritative during combat) in step with the character after a change outside the engine. */
export function syncPcCombatant(state: GameState): void {
	const pc = inCombat(state) ? state.encounter!.combatants?.[state.character.id] : undefined;
	if (!pc) return;
	const c = state.character;
	pc.hp = c.hp;
	pc.tempHp = c.tempHp;
	pc.speed = c.speed;
	if (pc.deathSaves) pc.deathSaves = { ...c.deathSaves };
}

// ─── food & water ─────────────────────────────────────────────────────────

/** Equipment that counts as a day's food / water (by index), plus homebrew items by name. */
export const FOOD_ITEMS = ["z-canned-food", "z-preserves"] as const;
export const WATER_ITEMS = ["z-bottled-water"] as const;
const FOOD_NAME = /\b(canned food|food|ration|rations|jerky|preserves|mre|beans|can of)\b/i;
const WATER_NAME = /\bwater\b/i;

export function isFood(i: Pick<InventoryItem, "ref" | "name">): boolean {
	return (!!i.ref && (FOOD_ITEMS as readonly string[]).includes(i.ref)) || (!i.ref?.startsWith("z-") && FOOD_NAME.test(i.name) && !WATER_NAME.test(i.name));
}
export function isWater(i: Pick<InventoryItem, "ref" | "name">): boolean {
	return (!!i.ref && (WATER_ITEMS as readonly string[]).includes(i.ref)) || (!i.ref?.startsWith("z-") && WATER_NAME.test(i.name));
}

function takeOne(c: Character, pick: (i: InventoryItem) => boolean): InventoryItem | undefined {
	const item = c.inventory.find((i) => i.quantity > 0 && pick(i));
	if (!item) return undefined;
	item.quantity -= 1;
	if (item.quantity <= 0) c.inventory = c.inventory.filter((i) => i.id !== item.id);
	return item;
}

/** Eating/drinking by hand (use_item): records it and clears the missed counter. */
export function recordMeal(state: GameState, kind: "food" | "water"): string {
	const s = survivalOf(state);
	const now = gameMinutes(state.time);
	if (kind === "food") {
		s.needs.lastMeal = now;
		s.needs.missedMeals = 0;
		return "A day's food: eaten.";
	}
	s.needs.lastDrink = now;
	s.needs.missedDrinks = 0;
	return "A day's water: drunk.";
}

/** The daily 08:00 meal and drink, taken from the inventory automatically. */
function dailyNeeds(state: GameState, at: number): string[] {
	const s = survivalOf(state);
	const c = state.character;
	const out: string[] = [];
	const day = Math.floor(at / 1440);
	const food = takeOne(c, isFood);
	if (food) {
		s.needs.lastMeal = at;
		s.needs.missedMeals = 0;
	} else {
		s.needs.missedMeals += 1;
		state.character = addExhaustion(state.character, 1);
	}
	const water = takeOne(state.character, isWater);
	if (water) {
		s.needs.lastDrink = at;
		s.needs.missedDrinks = 0;
	} else {
		s.needs.missedDrinks += 1;
		state.character = addExhaustion(state.character, 1);
	}
	const left = (pick: (i: InventoryItem) => boolean) => state.character.inventory.filter(pick).reduce((n, i) => n + i.quantity, 0);
	out.push(
		`Day ${day}, 08:00 (daily needs): ${food ? `${c.name} ate ${food.name} (${left(isFood)} food left)` : `NO FOOD: +1 exhaustion (${s.needs.missedMeals} day(s) without eating)`}; ${water ? `drank ${water.name} (${left(isWater)} water left)` : `NO WATER: +1 exhaustion (${s.needs.missedDrinks} day(s) without water)`}. Exhaustion now ${state.character.exhaustion}.`,
	);
	return out;
}

// ─── consumables ──────────────────────────────────────────────────────────

/** How a survival consumable works: healing dice (rolled by whoever applies healing) and its action cost in combat. */
export function survivalItem(i: Pick<InventoryItem, "ref" | "name">): { heal?: string; cost: "action" | "bonus" } | undefined {
	switch (i.ref) {
		case "z-medkit": return { heal: "2d4+2", cost: "action" };
		case "z-bandage": return { heal: "1d4", cost: "action" };
		case "z-preserves": return { heal: "1", cost: "action" };
		case "z-painkillers": case "z-antibiotics": case "z-lazarus-antiviral": return { cost: "action" };
	}
	if (isFood(i) || isWater(i)) return { cost: "action" };
	return undefined;
}

/** Effects of a used survival item besides healing (food, water, painkillers, the antiviral). Returns a note. */
export function survivalItemEffect(state: GameState, rng: Rng, record: RecordRoll, i: Pick<InventoryItem, "ref" | "name">): string | undefined {
	const out: string[] = [];
	if (i.ref === "z-bandage") out.push("The bleeding stops.");
	if (i.ref === "z-painkillers") {
		const r = roll(rng, "1d6", { label: "Painkillers (temp HP)", actor: state.character.id });
		record(r);
		state.character = grantTempHp(state.character, r.total);
		syncPcCombatant(state);
		out.push(`The pain backs off: ${state.character.tempHp} temporary HP.`);
	}
	if (i.ref === "z-antibiotics") out.push(survivalOf(state).infection ? "Antibiotics do nothing against LAZARUS: the bite infection is viral and carries on (DM only)." : "Antibiotics: good for infected wounds and fevers; no effect on a bite from the dead.");
	if (i.ref === "z-lazarus-antiviral") out.push(cureInfection(state));
	if (isFood(i)) out.push(recordMeal(state, "food"));
	if (isWater(i)) out.push(recordMeal(state, "water"));
	return out.join(" ") || undefined;
}

// ─── infection ────────────────────────────────────────────────────────────

const INFECTION_HOUR = 60;

/** Bite → CON save. DC 12 (+1 for runners and brutes). Returns the DM note, or undefined if nothing happened. */
export function infectionSave(state: GameState, rng: Rng, record: RecordRoll, bite: { monster?: MonsterStats; attack: string }): string | undefined {
	const s = survivalOf(state);
	const c = state.character;
	if (s.infection && s.infection.stage !== "turned") return `${c.name} is already infected; no new save.`;
	if (isDead(c)) return undefined;
	const idx = bite.monster?.index ?? "";
	const dc = 12 + (idx === "z-runner" || idx === "z-brute" ? 1 : 0);
	const { mod, check } = checkBreakdown(c, { kind: "save", ability: "con" });
	const r = roll(rng, `1d20${signed(mod)}`, {
		label: `CON save vs infection (${bite.monster?.name ?? "bite"})`,
		target: dc,
		actor: c.id,
		...(c.exhaustion >= 3 ? { advantage: "disadvantage" as const } : {}),
	});
	r.check = check;
	record(r);
	if (r.success) return `Bitten (${bite.attack}): CON save ${r.total} vs DC ${dc} SUCCESS. Not infected; just a wound.`;
	const now = gameMinutes(state.time);
	const hours = rng.int(24, 72);
	const part = /ankle|leg/i.test(bite.attack) ? rng.pick<BodyPart>(["left leg", "right leg"]) : pickPart(rng);
	s.infection = { bittenAt: now, turnsAt: now + hours * 60, part, stage: "incubating", ...(bite.monster ? { source: bite.monster.index } : {}) };
	const limb = part.endsWith("arm") || part.endsWith("leg");
	return `Bitten on the ${part} (${bite.attack}): CON save ${r.total} vs DC ${dc} FAILURE. ${c.name} is INFECTED with LAZARUS (secret: the player doesn't know yet; let the symptoms tell them). ${limb ? `Amputating the ${part} within ${INFECTION_HOUR} minutes (amputate tool) can stop it.` : `A bite on the ${part} can't be cut away.`} Fever, then delirium, then death and turning in about ${hours} h (DM only).`;
}

function pickPart(rng: Rng): BodyPart {
	const w: [BodyPart, number][] = [["left arm", 3], ["right arm", 3], ["left leg", 2], ["right leg", 2], ["torso", 1], ["neck", 1]];
	let n = rng.int(1, w.reduce((a, [, k]) => a + k, 0));
	for (const [p, k] of w) if ((n -= k) <= 0) return p;
	return "left arm";
}

/** Advances the infection to whatever stage the clock has reached (several at once after a long jump). */
function advanceInfection(state: GameState, now: number): string[] {
	const inf = state.survival?.infection;
	if (!inf || inf.stage === "turned") return [];
	const out: string[] = [];
	const span = inf.turnsAt - inf.bittenAt;
	const c = () => state.character;
	if (inf.stage === "incubating" && now >= inf.bittenAt + span / 3) {
		inf.stage = "fever";
		state.character = addExhaustion(c(), 1);
		out.push(`INFECTION: ${c().name} runs a fever (sweats, chills, the bite throbs black): +1 exhaustion (now ${c().exhaustion}).`);
	}
	if (inf.stage === "fever" && now >= inf.bittenAt + (2 * span) / 3) {
		inf.stage = "delirium";
		state.character = addExhaustion(c(), 1);
		out.push(`INFECTION: delirium (hallucinations, grey skin, hunger that isn't for food): +1 exhaustion (now ${c().exhaustion}).`);
	}
	if (now >= inf.turnsAt) {
		inf.stage = "turned";
		const next = structuredClone(c());
		next.hp = 0;
		next.deathSaves = { successes: 0, failures: 3 };
		delete next.concentration;
		state.character = next;
		syncPcCombatant(state);
		const note = `${c().name} has died of the LAZARUS infection and TURNED. The character is dead (hp 0). Narrate the end: the last breath, the stillness, and then the eyes opening. The story of this survivor is over.`;
		state.dmNotes.push(note);
		out.push(`DM NOTE: ${note}`);
	}
	return out;
}

/** The antiviral: cures the infection at any stage before turning. */
export function cureInfection(state: GameState): string {
	const s = survivalOf(state);
	if (!s.infection) return "There was no LAZARUS infection to cure; the antiviral does nothing noticeable.";
	if (s.infection.stage === "turned") return "Too late: the character has already turned.";
	const stage = s.infection.stage;
	delete s.infection;
	return `The antiviral works: the LAZARUS infection (${stage}) is gone. Exhaustion already gained stays until rested off.`;
}

// ─── amputation ───────────────────────────────────────────────────────────

const LIMBS: BodyPart[] = ["left arm", "right arm", "left leg", "right leg"];

/** Permanent sheet feature for a lost limb (EN; ES in lib/srd/es/zs.json). */
export function amputationFeature(part: BodyPart): Feature {
	const arm = part.endsWith("arm");
	const title = part.replace(/\b\w/g, (x) => x.toUpperCase());
	return {
		id: `amputation-${part.replace(" ", "-")}`,
		name: `Lost ${title}`,
		source: "survival:amputation",
		description: arm
			? `Your ${part} is gone. You can't use two-handed weapons or a shield, and you have disadvantage on Strength (Athletics) checks to climb.`
			: `Your ${part} is gone. Your speed is halved and you have disadvantage on Dexterity (Acrobatics) checks.`,
	};
}

export function amputate(state: GameState, rng: Rng, record: RecordRoll, part: BodyPart, reason: string): string {
	if (!LIMBS.includes(part)) throw new Error(`Only an arm or a leg can be amputated (${LIMBS.join(", ")}), not the ${part}.`);
	const s = survivalOf(state);
	if (s.amputations.includes(part)) throw new Error(`The ${part} is already gone.`);
	const now = gameMinutes(state.time);
	const lines: string[] = [];
	const inf = s.infection;
	if (inf && inf.stage !== "turned" && inf.part === part) {
		if (now - inf.bittenAt <= INFECTION_HOUR) {
			delete s.infection;
			lines.push(`Cut within ${now - inf.bittenAt} minutes of the bite: the infection is STOPPED.`);
		} else lines.push(`Too late: ${now - inf.bittenAt} minutes since the bite (more than ${INFECTION_HOUR}). The infection is already in the blood and continues (DM only).`);
	} else if (inf && inf.stage !== "turned") lines.push(`The bite was on the ${inf.part}, not the ${part}: the infection continues (DM only).`);
	s.amputations.push(part);
	const r = roll(rng, "2d8", { label: `Amputation (${part})`, actor: state.character.id });
	record(r);
	const dmg = applyDamage(state.character, r.total);
	const c = dmg.character;
	const f = amputationFeature(part);
	if (!c.features.some((x) => x.id === f.id)) c.features.push(f);
	if (part.endsWith("leg")) c.speed = Math.max(5, Math.floor(c.speed / 2 / 5) * 5);
	if (part.endsWith("arm")) for (const i of c.inventory) if (i.equipped && (i.armor?.type === "shield" || i.weapon?.properties.includes("two-handed"))) i.equipped = false;
	state.character = c;
	syncPcCombatant(state);
	lines.unshift(`The ${part} is amputated (${reason}): ${r.total} damage → HP ${c.hp}/${c.maxHp}${dmg.droppedToZero ? " (down: unconscious)" : ""}. New permanent feature: ${f.name}.${part.endsWith("leg") ? ` Speed now ${c.speed} ft.` : ""}`);
	return lines.join(" ");
}

// ─── noise ────────────────────────────────────────────────────────────────

export const NOISE_THRESHOLDS = [4, 7, 10] as const;

/** Loudness of techniques flagged `loud` without a number. */
export const DEFAULT_LOUDNESS = 3;

/** Dead that exist on today's outbreak day (no swarms), for wanderers and rest interruptions. */
function wanderingDead(state: GameState): MonsterStats[] {
	const day = outbreakDay(state);
	return MONSTERS.filter((m) => m.ruleset === "zombie" && /undead/.test(m.type) && !/swarm/.test(m.type) && (m.appearsDay ?? 0) <= day);
}
const exists = (state: GameState, index: string) => MONSTERS.some((m) => m.index === index && (m.appearsDay ?? 0) <= outbreakDay(state));

function rollWanderers(state: GameState, rng: Rng, n: number): string[] {
	const common = wanderingDead(state).filter((m) => ["z-shambler", "z-fresh-turned", "z-crawler"].includes(m.index));
	const pool = common.length ? common : wanderingDead(state);
	return Array.from({ length: n }, () => rng.pick(pool).index);
}

function countText(ids: string[]): string {
	const n = new Map<string, number>();
	for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
	return [...n].map(([id, k]) => `${k} × ${id}`).join(", ");
}

/** What a crossed threshold brings. severity 0 wanderers, 1 pack, 2 horde, 3 horde + pack (night). */
function threatFor(state: GameState, rng: Rng, severity: number): string {
	const minutes = rng.int(1, severity >= 2 ? 4 : severity === 1 ? 6 : 10);
	const special = wanderingDead(state).filter((m) => (m.appearsDay ?? 0) >= 7 && m.index !== "z-brute");
	let what: string[];
	let label: string;
	if (severity <= 0) {
		label = "WANDERERS";
		what = rollWanderers(state, rng, rng.int(1, 4));
	} else if (severity === 1) {
		label = "A PACK";
		what = exists(state, "z-horde-pack") ? ["z-horde-pack"] : rollWanderers(state, rng, rng.int(1, 4) + 2);
		if (special.length && rng.next() < 0.5) what.push(rng.pick(special).index);
	} else {
		label = "A HORDE";
		what = exists(state, "z-horde") ? ["z-horde"] : rollWanderers(state, rng, rng.int(2, 8) + 2);
		if (severity >= 3) what.push(...(exists(state, "z-horde-pack") ? ["z-horde-pack"] : rollWanderers(state, rng, rng.int(1, 4))));
		if (special.length) what.push(rng.pick(special).index);
	}
	return `NOISE THRESHOLD → ${label} is coming: ${countText(what)} arrive in ${minutes} minute${minutes === 1 ? "" : "s"}. DM, make it real: show them coming (sounds, shapes), then place them with start_combat (or add_monsters if a fight is on), passing override "drawn by noise" if the engine flags the budget; if it still refuses, bring the first arrivals as the fight and keep the rest as a closing threat the player must escape or hide from (barricade, flee, go quiet).`;
}

/**
 * Adds noise where the party is now (capped at 10). Crossing 4/7/10 rolls what
 * the noise draws (night adds +1 severity) and returns the instruction.
 */
export function addNoise(state: GameState, rng: Rng, amount: number, reason: string): string {
	const s = survivalOf(state);
	resetIfMoved(state);
	const before = s.noise.level;
	const after = Math.max(0, Math.min(10, before + Math.round(amount)));
	s.noise.level = after;
	s.noise.lastEvent = reason;
	s.noise.locationId = state.world.currentLocationId;
	s.noise.mapId = state.activeMapId;
	const crossed = NOISE_THRESHOLDS.map((t, i) => ({ t, i })).filter(({ t }) => before < t && after >= t).pop();
	const line = `Noise +${after - before} (${reason}): ${after}/10.`;
	if (!crossed) return line;
	return `${line} ${threatFor(state, rng, crossed.i + (isNight(state) ? 1 : 0))}${isNight(state) ? " (Night: worse than by day.)" : ""}`;
}

function resetIfMoved(state: GameState): string | undefined {
	const n = survivalOf(state).noise;
	// A first map drawn where the noise was made (none before) is not a move.
	const moved = n.locationId !== state.world.currentLocationId || (n.mapId !== undefined && n.mapId !== state.activeMapId);
	n.mapId ??= state.activeMapId;
	if (!moved) return;
	const was = n.level;
	n.level = 0;
	n.locationId = state.world.currentLocationId;
	n.mapId = state.activeMapId;
	return was > 0 ? `Left the noise behind (it was ${was}/10 there): noise 0/10 here.` : undefined;
}

// ─── rest ─────────────────────────────────────────────────────────────────

/** Food and drink within the last 24 h (needed to shed exhaustion on a long rest). */
export function fed(state: GameState): boolean {
	const s = survivalOf(state);
	const now = gameMinutes(state.time);
	return now - s.needs.lastMeal <= 1440 && now - s.needs.lastDrink <= 1440;
}

export function restInterruption(state: GameState, rng: Rng, secured: boolean): { interrupted: boolean; chance: number; text?: string; afterMinutes?: number } {
	const s = survivalOf(state);
	resetIfMoved(state);
	const chance = Math.min(95, (secured ? 5 : 30) + 5 * s.noise.level + (isNight(state) && !secured ? 10 : 0));
	// Secret roll (not in the dice log): the player shouldn't see the odds before the DM narrates.
	if (rng.int(1, 100) > chance) return { interrupted: false, chance };
	const afterMinutes = rng.int(1, 7) * 60;
	const who = rollWanderers(state, rng, rng.int(1, 3));
	return {
		interrupted: true,
		chance,
		afterMinutes,
		text: `${countText(who)} ${secured ? "test the barricade" : "stumble onto the camp"} after ${afterMinutes / 60} h of sleep.`,
	};
}

// ─── the tick ─────────────────────────────────────────────────────────────

/**
 * Advances the survival clock from lastTick to now: noise decays (1 per 10
 * minutes, not during combat) and resets when the party moves, the infection
 * advances, and each 08:00 passed takes the day's food and water and runs the
 * base's day (production, event roll: lib/rules/base.ts).
 */
export function tick(state: GameState, rng?: Rng): string | undefined {
	if (!isZombie(state)) return undefined;
	const s = survivalOf(state);
	const now = gameMinutes(state.time);
	const last = s.lastTick;
	const out: string[] = [];
	const moved = resetIfMoved(state);
	if (moved) out.push(moved);
	if (now > last && !isDead(state.character)) {
		if (!inCombat(state) && s.noise.level > 0) {
			const decay = Math.floor(now / 10) - Math.floor(last / 10);
			if (decay > 0) s.noise.level = Math.max(0, s.noise.level - decay);
		}
		// Each 08:00 passed (an 8-hour rest or a time jump can pass several).
		const first = Math.floor((last - 480) / 1440) + 1;
		const lastCrossing = Math.floor((now - 480) / 1440);
		for (let d = first; d <= lastCrossing && !isDead(state.character); d++) {
			const at = d * 1440 + 480;
			out.push(...advanceInfection(state, at));
			out.push(...baseDailyTick(state, rng, at));
			if (!isDead(state.character)) out.push(...dailyNeeds(state, at));
		}
		if (!isDead(state.character)) out.push(...advanceInfection(state, now));
		syncPcCombatant(state);
	}
	if (state.group?.base) out.push(...refreshBase(state, now));
	s.lastTick = Math.max(last, now);
	return out.join("\n") || undefined;
}

// ─── digest ───────────────────────────────────────────────────────────────

const ago = (min: number) => (min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`);

/** One "Survival:" line for the DM digest (hours left on the infection: DM only, never the player). */
export function survivalDigest(state: GameState): string | undefined {
	if (!isZombie(state)) return undefined;
	const s = state.survival ?? freshSurvival(state);
	const now = gameMinutes(state.time);
	const c = state.character;
	const count = (pick: (i: InventoryItem) => boolean) => c.inventory.filter(pick).reduce((n, i) => n + i.quantity, 0);
	const parts = [
		`noise ${s.noise.level}/10${s.noise.lastEvent ? ` (last: ${s.noise.lastEvent})` : ""}`,
		s.infection
			? `INFECTED (${s.infection.stage}, bite on the ${s.infection.part}, ${s.infection.stage === "turned" ? "turned" : `≈${Math.max(0, Math.round((s.infection.turnsAt - now) / 60))} h left, DM only`}${now - s.infection.bittenAt <= INFECTION_HOUR && s.infection.part.match(/arm|leg/) ? `; amputation can still stop it for ${INFECTION_HOUR - (now - s.infection.bittenAt)} more minutes` : ""})`
			: "not infected",
		`food ${count(isFood)} (last meal ${ago(now - s.needs.lastMeal)}${s.needs.missedMeals ? `, ${s.needs.missedMeals} missed` : ""})`,
		`water ${count(isWater)} (last drink ${ago(now - s.needs.lastDrink)}${s.needs.missedDrinks ? `, ${s.needs.missedDrinks} missed` : ""})`,
		s.amputations.length ? `amputations: ${s.amputations.join(", ")}` : "",
		powerOn(state) ? "power on (street lights)" : "power grid down",
	];
	return `Survival: ${parts.filter(Boolean).join("; ")}. Daily food/water is taken automatically at 08:00.`;
}
