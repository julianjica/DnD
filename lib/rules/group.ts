/**
 * The Quiet, Phase 3a: survivors who join the player (docs/zombie.md §7).
 *
 * A survivor's identity (name, portrait, description) stays in state.npcs; the
 * Survivor record holds what the engine needs: profession (a class id), level,
 * HP, morale, gear, errands and the same LAZARUS infection as the player.
 *
 * Survivors are deliberately weaker than the player: modest stats, average
 * hit dice, and an XP value that fits under the solo ally cap
 * (lib/rules/encounter-budget.ts) at the player's level.
 *
 * Everything here mutates the state it is given and returns short English
 * notes for the DM. Errand rolls are secret (no dice log); saves made in
 * front of the player (a bite in combat) are recorded.
 */
import type { Ability, Abilities, Combatant, GameState, GroupState, MonsterAction, MonsterStats, Survivor } from "../game/types";
import { rulesetLabelEn } from "../i18n/ruleset-labels";
import { getClass, getEquipment } from "../srd";
import { abilityMod, roll, signed, type Rng } from "./dice";
import { allyCap } from "./encounter-budget";
import { outbreakDay } from "./ruleset";
import { foodFactor, isNight as isNightTime, lootTable, pickWeighted, type LootEntry, type PlaceType } from "./scavenge";
import { gameMinutes, infectionDc, infectionStageAt, INFECTION_HOUR, isFood, isWater, rollInfection, takeOne, type RecordRoll } from "./survival";

// ─── the group ──────────────────────────────────────────────────────────────

/** The group, created on first use. */
export function groupOf(state: GameState): GroupState {
	state.group ??= { survivors: {}, lastTick: gameMinutes(state.time) };
	return state.group;
}

export function survivorOf(state: GameState, npcId: string): Survivor {
	const sv = state.group?.survivors[npcId];
	if (!sv) throw new Error(`${state.npcs[npcId]?.name ?? npcId} is not a survivor of the group. Recruit them first (recruit_survivor).`);
	return sv;
}

export const nameOf = (state: GameState, sv: Survivor): string => state.npcs[sv.npcId]?.name ?? sv.npcId;

const ACTIVE: Survivor["status"][] = ["with_party", "at_base", "away"];
export const isActive = (sv: Survivor): boolean => ACTIVE.includes(sv.status);

export function adjustMorale(sv: Survivor, delta: number): number {
	sv.morale = Math.max(0, Math.min(10, sv.morale + Math.round(delta)));
	return sv.morale;
}

/** Everyone else still in the group takes a morale hit (a death, a turning). */
function shakeGroup(state: GameState, except: string, delta: number): string {
	const others = Object.values(state.group?.survivors ?? {}).filter((o) => o.npcId !== except && isActive(o));
	for (const o of others) adjustMorale(o, delta);
	return others.length ? ` The others are shaken: morale ${delta} (${others.map((o) => `${nameOf(state, o)} ${o.morale}`).join(", ")}).` : "";
}

// ─── professions ────────────────────────────────────────────────────────────

export type ErrandTask = "scavenge" | "scout" | "fetch_water" | "hunt" | "guard";
export const ERRAND_TASKS: readonly ErrandTask[] = ["scavenge", "scout", "fetch_water", "hunt", "guard"];

interface Profession {
	primary: Ability;
	secondary: Ability;
	/** Default melee weapon when the DM gives no gear (never a gun: guns are scarce). */
	weapon: string;
	/** Tasks they are good at (errands: lower risk, better finds). */
	good: ErrandTask[];
	perk: { name: string; description: string };
	/** Extra to-hit: all attacks, or only firearms/ranged. */
	toHit?: { all?: number; ranged?: number };
	/** Extra HP per level. */
	hpPerLevel?: number;
	speed?: number;
}

export const PROFESSIONS: Record<string, Profession> = {
	barbarian: { primary: "str", secondary: "con", weapon: "z-fire-axe", good: ["guard", "fetch_water"], hpPerLevel: 2, perk: { name: "Tough as Nails", description: "A firefighter: hard to put down (extra hit points)." } },
	bard: { primary: "cha", secondary: "dex", weapon: "z-baseball-bat", good: ["scout"], perk: { name: "Pep Talk", description: "A radio voice: keeps people going. The group's morale drops more slowly around them (DM)." } },
	cleric: { primary: "wis", secondary: "dex", weapon: "z-kitchen-knife", good: ["scavenge"], perk: { name: "Triage", description: "A nurse: as an action they patch up an adjacent ally (DM: heal 1d4 + their level). Outside combat they can treat wounds (update_survivor hp / heal the player)." } },
	druid: { primary: "wis", secondary: "con", weapon: "z-pitchfork", good: ["hunt", "fetch_water"], perk: { name: "Country Sense", description: "A farmer or vet: finds food and clean water where others see none." } },
	fighter: { primary: "str", secondary: "con", weapon: "z-hunting-knife", good: ["guard", "scout"], toHit: { all: 1 }, perk: { name: "Trained", description: "A soldier: +1 to hit with every weapon." } },
	monk: { primary: "dex", secondary: "wis", weapon: "z-baseball-bat", good: ["scout"], perk: { name: "Martial Arts", description: "A martial-arts coach: unarmed strikes hit hard, quick on their feet." } },
	paladin: { primary: "str", secondary: "cha", weapon: "z-police-baton", good: ["guard"], toHit: { ranged: 1 }, perk: { name: "Range Qualified", description: "A police officer: +1 to hit with firearms." } },
	ranger: { primary: "dex", secondary: "wis", weapon: "z-hunting-knife", good: ["hunt", "scout"], toHit: { ranged: 1 }, perk: { name: "Steady Aim", description: "A hunter: +1 to hit with rifles and bows; the best at hunting." } },
	rogue: { primary: "dex", secondary: "int", weapon: "z-crowbar", good: ["scavenge", "scout"], perk: { name: "Light Fingers", description: "A locksmith or thief: gets into places others can't; finds more when scavenging." } },
	sorcerer: { primary: "dex", secondary: "con", weapon: "z-baseball-bat", good: ["scout", "fetch_water"], speed: 40, perk: { name: "Fast", description: "An athlete: speed 40 ft." } },
	warlock: { primary: "cha", secondary: "str", weapon: "z-shiv", good: ["scavenge"], perk: { name: "Yard Rules", description: "An ex-con: knows how desperate people think; owes someone." } },
	wizard: { primary: "int", secondary: "dex", weapon: "z-hammer", good: ["scavenge"], perk: { name: "Jury-Rig", description: "A chemistry teacher or engineer: can improvise devices and fix things at camp (DM)." } },
};

const ALIASES: Record<string, string> = {
	firefighter: "barbarian", "radio host": "bard", radio: "bard", nurse: "cleric", doctor: "cleric", medic: "cleric", farmer: "druid", vet: "druid",
	soldier: "fighter", veteran: "fighter", coach: "monk", "martial-arts coach": "monk", cop: "paladin", police: "paladin", "police officer": "paladin",
	hunter: "ranger", locksmith: "rogue", thief: "rogue", athlete: "sorcerer", "ex-con": "warlock", excon: "warlock", teacher: "wizard", engineer: "wizard", "chemistry teacher": "wizard",
};

/** A class id from a class id or a profession word ("nurse" → "cleric"). */
export function professionId(p: string): string {
	const k = p.trim().toLowerCase();
	if (PROFESSIONS[k]) return k;
	const id = ALIASES[k];
	if (!id) throw new Error(`Unknown profession "${p}". Use a class id (${Object.keys(PROFESSIONS).join(", ")}) or a profession (nurse, cop, soldier, firefighter, hunter…).`);
	return id;
}

/** "Nurse", "Police Officer" (English, for the DM). */
export function professionLabel(classId: string): string {
	return rulesetLabelEn("zombie", getClass(classId)?.name ?? classId);
}

export function survivorAbilities(profession: string): Abilities {
	const p = PROFESSIONS[profession] ?? PROFESSIONS.fighter;
	const a: Abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
	a[p.secondary] = 12;
	a[p.primary] = 13;
	return a;
}

const prof = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

/** Average hit dice of their profession plus CON, per level (the player gets the max die at level 1; they don't). */
export function survivorMaxHp(profession: string, level: number): number {
	const p = PROFESSIONS[profession] ?? PROFESSIONS.fighter;
	const die = getClass(profession)?.hitDie ?? 8;
	const con = abilityMod(survivorAbilities(profession).con);
	return Math.max(1, level * (Math.floor(die / 2) + 1 + con + (p.hpPerLevel ?? 0)));
}

/** XP value of a survivor stat block: small enough that companions fit under the ally cap at the same level. */
export function survivorXp(level: number): number {
	if (level <= 2) return 10;
	if (level <= 4) return 25;
	if (level <= 6) return 50;
	if (level <= 8) return 100;
	if (level <= 10) return 200;
	if (level <= 12) return 450;
	if (level <= 14) return 700;
	if (level <= 16) return 1100;
	return 1800;
}
const CR_BY_XP: Record<number, number> = { 10: 0, 25: 0.125, 50: 0.25, 100: 0.5, 200: 1, 450: 2, 700: 3, 1100: 4, 1800: 5 };

const avgDice = (dice: string) => {
	const m = /^(\d+)d(\d+)/.exec(dice);
	return m ? (Number(m[1]) * (Number(m[2]) + 1)) / 2 : Number(dice) || 0;
};
const dmg = (dice: string, mod: number) => `${dice}${mod ? signed(mod) : ""}`;

/** Their firearm or bow with ammunition in their own gear, if any (best average damage). */
export function survivorRanged(sv: Pick<Survivor, "gear">): { ref: string; ammo: string; rounds: number; name: string } | undefined {
	let best: { ref: string; ammo: string; rounds: number; name: string; avg: number } | undefined;
	for (const g of sv.gear) {
		const e = getEquipment(g.ref);
		if (!e?.weapon?.ranged || !e.ammo || g.qty <= 0) continue;
		const rounds = sv.gear.filter((x) => x.ref === e.ammo).reduce((n, x) => n + x.qty, 0);
		if (rounds <= 0) continue;
		const avg = avgDice(e.weapon.damage);
		if (!best || avg > best.avg) best = { ref: e.index, ammo: e.ammo, rounds, name: e.name, avg };
	}
	return best && { ref: best.ref, ammo: best.ammo, rounds: best.rounds, name: best.name };
}

/**
 * The survivor as a combatant: modern, original numbers from profession,
 * level and their own gear. Melee from their best melee weapon (or bare hands),
 * a firearm/bow only while they carry rounds for it (one use per round carried).
 */
export function survivorStatBlock(sv: Survivor, name?: string): MonsterStats {
	const p = PROFESSIONS[sv.profession] ?? PROFESSIONS.fighter;
	const ab = survivorAbilities(sv.profession);
	const str = abilityMod(ab.str);
	const dex = abilityMod(ab.dex);
	const pb = prof(sv.level);
	const gear = sv.gear.map((g) => ({ ...g, e: getEquipment(g.ref) })).filter((g) => g.e && g.qty > 0);

	// Armour class from what they wear: 10–14.
	const armor = gear.filter((g) => g.e!.armor && g.e!.armor.type !== "shield").sort((a, b) => b.e!.armor!.baseAc - a.e!.armor!.baseAc)[0]?.e!.armor;
	const shield = gear.some((g) => g.e!.armor?.type === "shield");
	let ac = armor ? armor.baseAc + (armor.dex ? Math.min(dex, armor.dexCap ?? 99) : 0) : 10 + dex + (sv.profession === "monk" ? abilityMod(ab.wis) : 0);
	if (shield) ac += 2;
	ac = Math.max(10, Math.min(14, ac));

	const actions: MonsterAction[] = [];
	const melee = gear.filter((g) => g.e!.weapon && !g.e!.weapon.ranged).sort((a, b) => avgDice(b.e!.weapon!.damage) - avgDice(a.e!.weapon!.damage))[0]?.e;
	const allBonus = p.toHit?.all ?? 0;
	if (melee?.weapon) {
		const w = melee.weapon;
		const mod = w.properties.includes("finesse") ? Math.max(str, dex) : str;
		const hit = pb + mod + allBonus;
		const reach = w.properties.includes("reach") ? 10 : 5;
		const text = `Melee Weapon Attack: ${signed(hit)} to hit, reach ${reach} ft., one target. Hit: ${dmg(w.damage, mod)} ${w.damageType} damage.`;
		actions.push({ name: melee.name, description: text, attack: { name: melee.name, kind: "melee", toHit: hit, reach, damage: [{ dice: dmg(w.damage, mod), type: w.damageType }], description: text } });
	} else {
		const monk = sv.profession === "monk";
		const mod = monk ? Math.max(str, dex) : str;
		const dice = monk ? "1d6" : "1d4";
		const label = monk ? "Unarmed Strike" : "Improvised Weapon";
		const hit = pb + mod + allBonus;
		const text = `Melee Weapon Attack: ${signed(hit)} to hit, reach 5 ft., one target. Hit: ${dmg(dice, mod)} bludgeoning damage.`;
		actions.push({ name: label, description: text, attack: { name: label, kind: "melee", toHit: hit, reach: 5, damage: [{ dice: dmg(dice, mod), type: "bludgeoning" }], description: text } });
	}
	const ranged = survivorRanged(sv);
	if (ranged) {
		const w = getEquipment(ranged.ref)!.weapon!;
		const hit = pb + dex + allBonus + (p.toHit?.ranged ?? 0);
		const range = w.range ?? { normal: 30, long: 90 };
		const text = `Ranged Weapon Attack: ${signed(hit)} to hit, range ${range.normal}/${range.long ?? range.normal * 3} ft., one target. Hit: ${dmg(w.damage, dex)} ${w.damageType} damage. ${ranged.rounds} round(s) left.`;
		actions.push({
			name: ranged.name,
			description: text,
			attack: { name: ranged.name, kind: "ranged", toHit: hit, range, damage: [{ dice: dmg(w.damage, dex), type: w.damageType }], description: text },
			usage: { type: "per_day", times: ranged.rounds },
		});
	}
	if (sv.profession === "cleric")
		actions.push({ name: "Patch Up", description: `Touches an ally within 5 ft. and stops the bleeding: the ally regains 1d4 + ${sv.level} hit points (DM: resolve with the heal tool on that ally).`, usage: { type: "per_day", times: 2 } });

	const xp = survivorXp(sv.level);
	const die = getClass(sv.profession)?.hitDie ?? 8;
	const con = abilityMod(ab.con);
	return {
		index: `survivor-${sv.npcId}`,
		name: name ?? `Survivor (${professionLabel(sv.profession)})`,
		ruleset: "zombie",
		size: "medium",
		type: "humanoid (human)",
		alignment: "any alignment",
		ac,
		hp: sv.maxHp,
		hitDice: `${sv.level}d${die}${con * sv.level ? signed(con * sv.level) : ""}`,
		speed: { walk: p.speed ?? 30 },
		abilities: ab,
		saves: {},
		skills: {},
		vulnerabilities: [],
		resistances: [],
		immunities: [],
		conditionImmunities: [],
		senses: `passive Perception ${10 + abilityMod(ab.wis)}`,
		languages: "English",
		cr: CR_BY_XP[xp] ?? 0,
		xp,
		traits: [{ name: p.perk.name, description: p.perk.description }],
		actions,
		bonusActions: [],
		reactions: [],
		legendaryActions: [],
		tokenHint: "survivor",
	} as MonsterStats;
}

// ─── recruiting ─────────────────────────────────────────────────────────────

export interface RecruitArgs {
	npcId: string;
	profession: string;
	level?: number;
	specialty: string;
	traits: string[];
	skills?: string[];
	gear?: { ref: string; qty: number }[];
}

export function recruitSurvivor(state: GameState, rng: Rng, a: RecruitArgs): Survivor {
	const npc = state.npcs[a.npcId];
	if (!npc) throw new Error(`Unknown NPC ${a.npcId}. Only someone already met (add_npc) can join.`);
	if (!npc.alive) throw new Error(`${npc.name} is dead.`);
	const g = groupOf(state);
	const prev = g.survivors[a.npcId];
	if (prev && isActive(prev)) throw new Error(`${npc.name} is already in the group (${prev.status}).`);
	if (prev?.status === "turned" || prev?.status === "dead") throw new Error(`${npc.name} is ${prev.status}.`);
	const profession = professionId(a.profession);
	const pcLevel = state.character.classes.reduce((n, k) => n + k.level, 0);
	// Never stronger than the player: at most the player's level.
	const level = Math.max(1, Math.min(pcLevel, Math.round(a.level ?? 1)));
	const gear = (a.gear?.length ? a.gear : [{ ref: PROFESSIONS[profession].weapon, qty: 1 }]).map((x) => {
		const e = getEquipment(x.ref);
		if (!e || e.ruleset !== "zombie") throw new Error(`Unknown gear "${x.ref}": use equipment ids of The Quiet (lookup_srd), e.g. z-kitchen-knife, z-pistol-9mm, z-ammo-9mm.`);
		return { ref: e.index, qty: Math.max(1, Math.round(x.qty || 1)) };
	});
	const maxHp = survivorMaxHp(profession, level);
	const sv: Survivor = {
		npcId: npc.id,
		profession,
		level,
		hp: maxHp,
		maxHp,
		morale: rng.int(5, 7),
		status: "with_party",
		skills: a.skills ?? [],
		specialty: a.specialty,
		traits: a.traits,
		joinedAt: gameMinutes(state.time),
		gear,
		missedDays: 0,
	};
	g.survivors[npc.id] = sv;
	npc.disposition = "friendly";
	npc.locationId = state.world.currentLocationId;
	if (!state.scene.npcIds.includes(npc.id)) state.scene.npcIds = [...state.scene.npcIds, npc.id];
	return sv;
}

// ─── infection, death and turning ───────────────────────────────────────────

/**
 * A zombie's bite wounded a survivor: the same CON save and secret clock as the
 * player's. A bite that kills them skips the save: they rise within minutes.
 */
export function survivorBitten(state: GameState, rng: Rng, record: RecordRoll, sv: Survivor, bite: { monster?: MonsterStats; attack: string; lethal?: boolean }): string {
	const name = nameOf(state, sv);
	if (sv.infection && sv.infection.stage !== "turned") return `${name} is already infected; no new save.`;
	const now = gameMinutes(state.time);
	if (bite.lethal) {
		const { part } = rollInfection(rng, now, bite.attack);
		sv.infection = { bittenAt: now, turnsAt: now + rng.int(2, 10), part, stage: "incubating" };
		return `${name} was bitten (${bite.attack}) as they fell.`;
	}
	const dc = infectionDc(bite.monster);
	const con = abilityMod(survivorAbilities(sv.profession).con);
	const r = roll(rng, `1d20${signed(con)}`, { label: `${name}: CON save vs infection (${bite.monster?.name ?? "bite"})`, target: dc, actor: sv.npcId });
	record(r);
	if (r.success) return `${name} was bitten (${bite.attack}): CON save ${r.total} vs DC ${dc} SUCCESS. Not infected; just a wound.`;
	const { bittenAt, turnsAt, part, hours } = rollInfection(rng, now, bite.attack);
	sv.infection = { bittenAt, turnsAt, part, stage: "incubating" };
	const limb = part.endsWith("arm") || part.endsWith("leg");
	return `${name} was bitten on the ${part} (${bite.attack}): CON save ${r.total} vs DC ${dc} FAILURE. ${name} is INFECTED with LAZARUS (secret; they may hide the bite). ${limb ? `Cutting off the ${part} within ${INFECTION_HOUR} minutes stops it (update_survivor treat="amputation").` : `A bite on the ${part} can't be cut away.`} Fever, then delirium, then they die and TURN in about ${hours} h (DM only).`;
}

/** The survivor dies of the infection and rises. The most horror beat in the genre: the DM plays it. */
export function turnSurvivor(state: GameState, sv: Survivor, how: string): string {
	const name = nameOf(state, sv);
	const where = sv.status === "with_party" ? "right there, next to the player" : sv.status === "at_base" ? "inside the base, among the others" : "out there, wherever their errand took them";
	sv.status = "turned";
	sv.hp = 0;
	delete sv.away;
	if (sv.infection) sv.infection.stage = "turned";
	const npc = state.npcs[sv.npcId];
	if (npc) {
		npc.alive = false;
		npc.disposition = "hostile";
	}
	const note = `${name} ${how} and TURNED, ${where}. Make them one of the dead: when they get up, use start_combat (or add_monsters) with monster "z-fresh-turned", name "${name}", npcId "${sv.npcId}" (at their body if it is on the map). Let the player see who it was.`;
	state.dmNotes.push(note);
	return `DM NOTE: ${note}${shakeGroup(state, sv.npcId, -2)}`;
}

export function killSurvivor(state: GameState, sv: Survivor, how: string): string {
	const name = nameOf(state, sv);
	sv.status = "dead";
	sv.hp = 0;
	delete sv.away;
	const npc = state.npcs[sv.npcId];
	if (npc) npc.alive = false;
	return `${name} is DEAD (${how}).${shakeGroup(state, sv.npcId, -2)}`;
}

function advanceSurvivorInfection(state: GameState, sv: Survivor, now: number): string[] {
	const inf = sv.infection;
	if (!inf || inf.stage === "turned" || !isActive(sv)) return [];
	const stage = infectionStageAt(inf, now);
	if (stage === inf.stage) return [];
	const name = nameOf(state, sv);
	if (stage === "turned") return [turnSurvivor(state, sv, "died of the LAZARUS infection")];
	inf.stage = stage;
	return [`INFECTION (${name}): ${stage === "fever" ? "fever: sweats, chills, the bite throbs black" : "delirium: grey skin, hallucinations, a hunger that isn't for food"}. They may hide it; show it in small details (DM only: ≈${Math.max(0, Math.round((inf.turnsAt - now) / 60))} h left).`];
}

/** The antiviral cures; amputation within the hour stops a limb bite. */
export function treatSurvivor(state: GameState, sv: Survivor, how: "antiviral" | "amputation", rng: Rng): string {
	const name = nameOf(state, sv);
	const inf = sv.infection;
	const now = gameMinutes(state.time);
	if (how === "antiviral") {
		const vial = state.character.inventory.find((i) => i.ref === "z-lazarus-antiviral" && i.quantity > 0);
		if (!vial) throw new Error("The player has no LAZARUS antiviral (z-lazarus-antiviral) to give.");
		vial.quantity -= 1;
		if (vial.quantity <= 0) state.character.inventory = state.character.inventory.filter((i) => i !== vial);
		if (!inf || inf.stage === "turned") return `${name} gets the antiviral, but there was no infection to cure.`;
		delete sv.infection;
		return `The antiviral works: ${name}'s LAZARUS infection (${inf.stage}) is gone.`;
	}
	const cut = rng.int(2, 16);
	sv.hp = Math.max(0, sv.hp - cut);
	let text = `${name}'s limb is amputated: ${cut} damage → HP ${sv.hp}/${sv.maxHp}.`;
	if (inf && inf.stage !== "turned" && (inf.part.endsWith("arm") || inf.part.endsWith("leg"))) {
		if (now - inf.bittenAt <= INFECTION_HOUR) {
			delete sv.infection;
			text += ` Cut within ${now - inf.bittenAt} minutes of the bite: the infection is STOPPED.`;
		} else text += ` Too late (${now - inf.bittenAt} minutes since the bite): the infection carries on (DM only).`;
	} else if (inf && inf.stage !== "turned") text += ` The bite was on the ${inf.part}: the infection carries on (DM only).`;
	if (sv.hp <= 0) text += ` ${name} is unconscious from the shock.`;
	adjustMorale(sv, -1);
	return text;
}

// ─── errands ────────────────────────────────────────────────────────────────

/** Base risk (%) that something goes wrong on an errand. */
const ERRAND_RISK: Record<ErrandTask, number> = { scavenge: 12, scout: 10, fetch_water: 6, hunt: 8, guard: 2 };
const SCAVENGE_PLACES: PlaceType[] = ["house", "apartment", "grocery", "gas_station", "restaurant", "pharmacy", "hardware", "car", "office", "school"];

function nightDuring(from: number, to: number): boolean {
	for (let t = from; t < to; t += 60) {
		const h = Math.floor((t % 1440) / 60);
		if (isNightTime({ day: 0, hour: h, minute: 0 })) return true;
	}
	return false;
}

/** The secret risk of an errand in %: task, hours, outbreak day, night, profession. */
export function errandRisk(state: GameState, sv: Survivor, task: ErrandTask, from: number, to: number): number {
	const hours = Math.max(1, Math.round((to - from) / 60));
	let risk = ERRAND_RISK[task];
	risk += Math.min(20, Math.max(0, hours - 2) * 2);
	risk += Math.min(15, Math.floor(outbreakDay(state) / 2));
	if (nightDuring(from, to)) risk += 15;
	if (PROFESSIONS[sv.profession]?.good.includes(task)) risk -= 5;
	if (sv.infection && sv.infection.stage !== "incubating") risk += 10;
	return Math.max(0, Math.min(75, risk));
}

export function sendSurvivor(state: GameState, sv: Survivor, task: ErrandTask, hours: number): string {
	const name = nameOf(state, sv);
	if (!ERRAND_TASKS.includes(task)) throw new Error(`task must be one of ${ERRAND_TASKS.join(", ")}.`);
	if (sv.status !== "with_party" && sv.status !== "at_base") throw new Error(`${name} can't go (${sv.status}).`);
	if (sv.hp <= 0) throw new Error(`${name} is down (0 HP) and can't go anywhere.`);
	if (state.encounter?.status === "active") throw new Error("Not in the middle of a fight.");
	if (task === "guard" && !state.group?.base) throw new Error("guard is for watching the base; there is no base yet.");
	const h = Math.max(1, Math.min(24, Math.round(hours)));
	const now = gameMinutes(state.time);
	sv.away = { until: now + h * 60, task, startedAt: now, from: sv.status };
	sv.status = "away";
	state.scene.npcIds = state.scene.npcIds.filter((id) => id !== sv.npcId);
	return `${name} sets out to ${task.replace("_", " ")} for ${h} h (back around day ${Math.floor(sv.away.until / 1440)}, ${String(Math.floor((sv.away.until % 1440) / 60)).padStart(2, "0")}:${String(sv.away.until % 60).padStart(2, "0")}). The engine resolves it when the clock gets there.`;
}

export type AddItem = (state: GameState, item: { name: string; ref: string; quantity: number }) => void;

const MEDS = ["z-medkit", "z-bandage", "z-antibiotics", "z-painkillers", "z-rubbing-alcohol", "z-epinephrine", "z-sedative"];
const MATERIALS = ["z-planks", "z-nails", "z-pipe", "z-duct-tape", "z-rope", "z-snare-wire"];

/** Finds go into the base stock when there is a base (as units), else (and anything that isn't stock) into the player's inventory. */
function deposit(state: GameState, items: Map<string, number>, addItem: AddItem): string {
	const base = state.group?.base;
	const toStock: string[] = [];
	const toInv: string[] = [];
	for (const [ref, qty] of items) {
		const e = getEquipment(ref);
		const name = e?.name ?? ref;
		const it = { ref, name };
		const unit = !base ? undefined : isFood(it) ? "food" : isWater(it) ? "water" : MEDS.includes(ref) ? "meds" : e?.category === "ammunition" ? "ammo" : ref === "z-gasoline" ? "fuel" : MATERIALS.includes(ref) ? "materials" : undefined;
		if (base && unit) {
			base.stock[unit] += qty;
			toStock.push(`${qty} ${unit} (${name})`);
		} else {
			addItem(state, { name, ref, quantity: qty });
			toInv.push(`${qty} × ${name}`);
		}
	}
	return [toStock.length ? `into the base stock: ${toStock.join(", ")}` : "", toInv.length ? `into the inventory: ${toInv.join(", ")}` : ""].filter(Boolean).join("; ");
}

function errandFinds(state: GameState, rng: Rng, task: ErrandTask, finds: number): { items: Map<string, number>; place?: string } {
	const items = new Map<string, number>();
	const add = (ref: string, n: number) => n > 0 && items.set(ref, (items.get(ref) ?? 0) + n);
	if (task === "fetch_water") for (let i = 0; i < finds; i++) add("z-bottled-water", rng.int(1, 2));
	if (task === "hunt") {
		const day = outbreakDay(state);
		for (let i = 0; i < finds; i++) if (rng.next() < Math.max(0.35, 0.8 - day / 60)) add("z-preserves", rng.int(1, 2));
	}
	if (task === "scavenge") {
		const place = rng.pick(SCAVENGE_PLACES);
		const table = lootTable(place)!;
		const food = foodFactor(outbreakDay(state));
		const options: { w: number; v: LootEntry | "nothing" }[] = [
			{ w: table.nothing, v: "nothing" },
			{ w: table.junk, v: "nothing" },
			...table.items.map((e) => ({ w: e.w * (e.tag === "food" ? food : 1), v: e })),
		];
		for (let i = 0; i < finds; i++) {
			const v = pickWeighted(rng, options);
			if (v !== "nothing") add(v.ref, rng.int(v.qty[0], v.qty[1]));
		}
		return { items, place };
	}
	return { items };
}

/**
 * Resolves an errand whose time is up (secret rolls): first whether something
 * goes wrong (injury, a bite, never coming back), then what they bring home.
 */
export function resolveErrand(state: GameState, rng: Rng, sv: Survivor, addItem: AddItem): string {
	const away = sv.away!;
	const task = away.task as ErrandTask;
	const name = nameOf(state, sv);
	const from = away.startedAt ?? away.until - 60;
	const hours = Math.max(1, Math.round((away.until - from) / 60));
	const risk = errandRisk(state, sv, task, from, away.until);
	const back: Survivor["status"] = away.from === "at_base" && state.group?.base ? "at_base" : "with_party";
	const lines: string[] = [];
	let injured = false;
	if (rng.int(1, 100) <= risk) {
		const what = rng.int(1, 100);
		if (what <= 20) {
			// They never come back. Maybe the player meets them again, among the dead.
			return `ERRAND (${name}, ${task.replace("_", " ")}, ${hours} h): ${name} NEVER CAME BACK (risk was ${risk}%). Missing, presumed dead. DM: let the hours stretch; the player may meet them again later among the dead (z-fresh-turned named "${name}").${killSurvivor(state, sv, "missing on an errand")}`;
		}
		if (what <= 50) {
			const r = rng.int(1, 20) + abilityMod(survivorAbilities(sv.profession).con);
			if (r < 12) {
				const { bittenAt, turnsAt, part } = rollInfection(rng, away.until - rng.int(10, 50), "bite");
				if (!sv.infection || sv.infection.stage === "turned") sv.infection = { bittenAt, turnsAt, part, stage: "incubating" };
				lines.push(`${name} came back BITTEN on the ${part} and INFECTED (secret; ${rng.next() < 0.5 ? "they hide it" : "they show it, shaking"}; ≈${Math.round((sv.infection.turnsAt - away.until) / 60)} h until they turn, DM only).`);
			} else lines.push(`${name} came back with a bite-shaped tear in their sleeve: the teeth didn't break the skin (not infected).`);
		}
		const cut = rng.int(1, 6) + sv.level;
		sv.hp = Math.max(1, sv.hp - cut);
		injured = true;
		lines.push(`Hurt out there (−${cut} HP → ${sv.hp}/${sv.maxHp}); they had to cut it short.`);
	}
	sv.status = back;
	delete sv.away;
	if (back === "with_party") state.scene.npcIds = state.scene.npcIds.includes(sv.npcId) ? state.scene.npcIds : [...state.scene.npcIds, sv.npcId];

	const good = PROFESSIONS[sv.profession]?.good.includes(task) ?? false;
	const check = rng.int(1, 20) + prof(sv.level) + (good ? 2 : 0);
	let finds = 1 + Math.min(3, Math.floor(hours / 3)) + (check >= 15 ? 1 : 0) - (check < 8 ? 1 : 0);
	if (injured) finds = Math.floor(finds / 2);
	const head = `ERRAND (${name}, ${task.replace("_", " ")}, ${hours} h, risk ${risk}%):`;
	if (task === "guard") {
		lines.unshift(`${head} ${name} kept watch over the base${injured ? " and something got close" : "; a quiet watch"}.`);
		return lines.join(" ");
	}
	if (task === "scout") {
		lines.unshift(`${head} ${name} is back from scouting${check >= 12 ? " with something useful" : ", with little to show"}. DM: tell the player what they saw${check >= 12 ? " (a safe route, a cache, where the dead are gathering, other survivors)" : " (vague: shapes, sounds, a smell of smoke)"}.`);
		return lines.join(" ");
	}
	const { items, place } = errandFinds(state, rng, task, Math.max(0, finds));
	const where = deposit(state, items, addItem);
	lines.unshift(`${head} ${name} is back${place ? ` from a ${place.replace("_", " ")}` : ""}${where ? `: ${where}` : " empty-handed"}.`);
	if (state.group?.base) state.group.base.log = [...state.group.base.log, { at: away.until, text: `${name}: ${task.replace("_", " ")} → ${where || "nothing"}` }].slice(-30);
	return lines.join(" ");
}

// ─── daily needs and morale ─────────────────────────────────────────────────

const VOLATILE = /volatile|desperate|selfish|greedy|thief|addict|unstable|hothead|hot-headed|paranoid|resentful|bitter|ruthless|violent|coward/i;

/** Morale 0: they walk out, and the volatile ones take supplies with them. */
function moraleBreak(state: GameState, rng: Rng, sv: Survivor): string {
	const name = nameOf(state, sv);
	const npc = state.npcs[sv.npcId];
	const wasAt = sv.status;
	sv.status = "left";
	state.scene.npcIds = state.scene.npcIds.filter((id) => id !== sv.npcId);
	if (!sv.traits.some((t) => VOLATILE.test(t))) {
		if (npc) npc.disposition = "neutral";
		return `MORALE BROKEN: ${name} has had enough and LEAVES the group (taking their own gear). DM: play the goodbye (or the empty bedroll in the morning).`;
	}
	if (npc) npc.disposition = "hostile";
	const taken: string[] = [];
	const base = state.group?.base;
	if (wasAt === "at_base" && base) {
		for (const k of ["food", "water", "meds", "ammo"] as const) {
			const n = Math.floor(base.stock[k] / 3);
			if (n > 0) {
				base.stock[k] -= n;
				taken.push(`${n} ${k}`);
			}
		}
	} else {
		for (let i = 0; i < 2; i++) {
			const f = takeOne(state.character, isFood);
			if (f) taken.push(f.name);
			const w = takeOne(state.character, isWater);
			if (w) taken.push(w.name);
		}
		const valuables = state.character.inventory.filter((i) => !i.equipped && (MEDS.includes(i.ref ?? "") || i.category === "ammunition" || i.ref?.startsWith("z-ammo") || i.ref === "z-shells-12ga"));
		if (valuables.length) {
			const v = rng.pick(valuables);
			v.quantity -= 1;
			if (v.quantity <= 0) state.character.inventory = state.character.inventory.filter((i) => i !== v);
			taken.push(v.name);
		}
	}
	return `MORALE BROKEN: ${name} (${sv.traits.join(", ")}) LEAVES and STEALS supplies: ${taken.join(", ") || "nothing left worth taking"}. DM: the player finds out in the morning; ${name} is now a hostile NPC out there.`;
}

function dailyNeeds(state: GameState, rng: Rng, at: number): string[] {
	const out: string[] = [];
	const day = Math.floor(at / 1440);
	for (const sv of Object.values(state.group?.survivors ?? {})) {
		if (sv.status !== "with_party" && sv.status !== "at_base") continue;
		const name = nameOf(state, sv);
		const base = state.group?.base;
		let ate = false;
		let drank = false;
		if (sv.status === "with_party") {
			ate = !!takeOne(state.character, isFood);
			drank = !!takeOne(state.character, isWater);
		} else if (base) {
			ate = base.stock.food > 0;
			drank = base.stock.water > 0;
			if (ate) base.stock.food -= 1;
			if (drank) base.stock.water -= 1;
		} else continue;
		if (ate && drank) {
			sv.missedDays = 0;
			if (sv.hp > 0 && sv.hp < sv.maxHp) sv.hp = Math.min(sv.maxHp, sv.hp + Math.max(1, sv.level));
			continue;
		}
		sv.missedDays += 1;
		adjustMorale(sv, -1);
		out.push(`Day ${day}, 08:00: ${name} went without ${!ate && !drank ? "food and water" : !ate ? "food" : "water"} (${sv.missedDays} day(s) short${sv.status === "at_base" ? ", base stock" : ", from the party's packs"}): morale −1 → ${sv.morale}/10.`);
		if (sv.morale <= 0) out.push(moraleBreak(state, rng, sv));
	}
	return out;
}

/** Long rest with the party: companions get their HP back too. */
export function restSurvivors(state: GameState): string | undefined {
	const list = Object.values(state.group?.survivors ?? {}).filter((sv) => sv.status === "with_party" && sv.hp < sv.maxHp);
	for (const sv of list) sv.hp = sv.maxHp;
	return list.length ? `Companions rested too: ${list.map((sv) => `${nameOf(state, sv)} HP ${sv.hp}/${sv.maxHp}`).join(", ")}.` : undefined;
}

// ─── the group tick ─────────────────────────────────────────────────────────

/**
 * Runs after the survival tick (so the player has already eaten): errands
 * whose time is up come back, each 08:00 passed feeds the group, and
 * survivors' infections advance.
 */
export function groupTick(state: GameState, rng: Rng, addItem: AddItem): string | undefined {
	const g = state.group;
	if (!g || !Object.keys(g.survivors).length) return undefined;
	const now = gameMinutes(state.time);
	const last = g.lastTick ?? now;
	const out: string[] = [];
	const errandsUntil = (t: number) => {
		const due = Object.values(g.survivors).filter((sv) => sv.status === "away" && sv.away && sv.away.until <= t).sort((a, b) => a.away!.until - b.away!.until);
		for (const sv of due) out.push(resolveErrand(state, rng, sv, addItem));
	};
	const infections = (t: number) => {
		for (const sv of Object.values(g.survivors)) out.push(...advanceSurvivorInfection(state, sv, t));
	};
	if (now > last) {
		const first = Math.floor((last - 480) / 1440) + 1;
		const lastCrossing = Math.floor((now - 480) / 1440);
		for (let d = first; d <= lastCrossing; d++) {
			const at = d * 1440 + 480;
			errandsUntil(at);
			infections(at);
			out.push(...dailyNeeds(state, rng, at));
		}
	}
	errandsUntil(now);
	infections(now);
	g.lastTick = Math.max(last, now);
	return out.join("\n") || undefined;
}

// ─── combat ─────────────────────────────────────────────────────────────────

export function survivorForCombatant(state: GameState, c: Pick<Combatant, "kind" | "side" | "refId">): Survivor | undefined {
	if (c.kind !== "npc" || c.side !== "party") return undefined;
	return state.group?.survivors[c.refId];
}

export interface SurvivorSpawn {
	stats: MonsterStats;
	id: string;
	name: string;
	side: "party";
	kind: "npc";
	refId: string;
	hp: number;
	entityId?: string;
	near?: { x: number; y: number };
}

/** A spawn for one survivor on the active map (their token if placed, else next to the player). */
export function survivorSpawn(state: GameState, sv: Survivor, map: { entities: { id: string; kind: string; npcId?: string; x: number; y: number; dead?: boolean }[] }): SurvivorSpawn {
	const name = nameOf(state, sv);
	const ent = map.entities.find((e) => e.npcId === sv.npcId && !e.dead && e.kind !== "pc");
	const pc = map.entities.find((e) => e.kind === "pc");
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "survivor";
	return {
		stats: survivorStatBlock(sv, name),
		id: `sv-${slug}-${sv.npcId.slice(-4)}`,
		name,
		side: "party",
		kind: "npc",
		refId: sv.npcId,
		hp: sv.hp,
		...(ent ? { entityId: ent.id } : pc ? { near: { x: pc.x, y: pc.y } } : {}),
	};
}

/**
 * Survivors with the party who join a fight automatically, in the order they
 * joined, while their XP fits under the ally cap left after the DM's allies.
 * The rest hang back (the player stays the protagonist).
 */
export function survivorsForCombat(state: GameState, map: Parameters<typeof survivorSpawn>[2], alliesXp: number, skip: Set<string>): { spawns: SurvivorSpawn[]; held: string[] } {
	const level = state.character.classes.reduce((n, k) => n + k.level, 0);
	let room = allyCap(level) - alliesXp;
	const spawns: SurvivorSpawn[] = [];
	const held: string[] = [];
	const list = Object.values(state.group?.survivors ?? {}).filter((sv) => sv.status === "with_party" && !skip.has(sv.npcId)).sort((a, b) => a.joinedAt - b.joinedAt);
	for (const sv of list) {
		if (sv.hp <= 0) {
			held.push(`${nameOf(state, sv)} (down, 0 HP)`);
			continue;
		}
		const xp = survivorXp(sv.level);
		if (xp > room) {
			held.push(`${nameOf(state, sv)} (hangs back: the ally cap keeps the player the protagonist)`);
			continue;
		}
		room -= xp;
		spawns.push(survivorSpawn(state, sv, map));
	}
	return { spawns, held };
}

/** After a spawn: the combatant's max HP is the survivor's, and the token links to the NPC. */
export function linkSurvivorCombatants(state: GameState): void {
	const enc = state.encounter;
	if (!enc) return;
	const map = state.maps[enc.mapId];
	for (const c of Object.values(enc.combatants)) {
		const sv = survivorForCombatant(state, c);
		if (!sv) continue;
		c.maxHp = Math.max(c.maxHp, sv.maxHp);
		const ent = map?.entities.find((e) => e.id === c.entityId);
		if (ent) {
			ent.npcId = sv.npcId;
			ent.kind = "npc";
		}
	}
}

type Ev = { type: string; [k: string]: unknown };

/**
 * After every combat result: HP back to the Survivor, rounds fired out of
 * their gear, and a survivor who drops: bitten/infected → they will turn;
 * otherwise a last d20 (10+: down but alive, else dead).
 */
export function syncSurvivorsFromCombat(state: GameState, rng: Rng, record: RecordRoll, events: Ev[]): string[] {
	const enc = state.encounter;
	if (!enc || !state.group) return [];
	const out: string[] = [];
	for (const ev of events) {
		if (ev.type === "action_used") {
			const c = enc.combatants[ev.combatantId as string];
			const sv = c && survivorForCombatant(state, c);
			const gun = sv && survivorRanged(sv);
			if (sv && gun && ev.action === gun.name) {
				const ammo = sv.gear.find((g) => g.ref === gun.ammo && g.qty > 0);
				if (ammo) ammo.qty -= 1;
				sv.gear = sv.gear.filter((g) => g.qty > 0);
				if (!survivorRanged(sv)) out.push(`${nameOf(state, sv)} is OUT of rounds for the ${gun.name}.`);
			}
		}
	}
	for (const c of Object.values(enc.combatants)) {
		const sv = survivorForCombatant(state, c);
		if (!sv || sv.status !== "with_party") continue;
		if (!c.dead) {
			sv.hp = c.hp;
			continue;
		}
		if (sv.hp <= 0) continue; // already resolved
		const name = nameOf(state, sv);
		if (sv.infection && sv.infection.stage !== "turned") {
			out.push(`${name} goes down with the infection in them.`, turnSurvivor(state, sv, "fell in the fight with a bite in them"));
			continue;
		}
		const r = roll(rng, "1d20", { label: `${name}: still breathing?`, target: 10, actor: sv.npcId });
		record(r);
		if (r.total >= 10) {
			sv.hp = 0;
			out.push(`${name} drops (d20 ${r.total}): down and out of the fight but ALIVE (0 HP; they come round at 1 HP after the fight). DM: describe them falling.`);
		} else out.push(killSurvivor(state, sv, `killed in the fight (d20 ${r.total})`));
	}
	return out;
}

/** End of combat: survivors who went down but lived get up at 1 HP; their tokens are not corpses. */
export function survivorsAfterCombat(state: GameState, enc: NonNullable<GameState["encounter"]>): string | undefined {
	const map = state.maps[enc.mapId];
	const up: string[] = [];
	for (const c of Object.values(enc.combatants)) {
		const sv = survivorForCombatant(state, c);
		if (!sv || sv.status !== "with_party") continue;
		if (sv.hp <= 0) {
			sv.hp = 1;
			up.push(nameOf(state, sv));
		}
		const ent = map?.entities.find((e) => e.id === c.entityId);
		if (ent) ent.dead = false;
	}
	return up.length ? `${up.join(", ")} come${up.length === 1 ? "s" : ""} round at 1 HP.` : undefined;
}

// ─── digest ─────────────────────────────────────────────────────────────────

const clock = (t: number) => `day ${Math.floor(t / 1440)} ${String(Math.floor((t % 1440) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** "Group:" lines for the DM digest (hours left on infections: DM only). */
export function groupDigest(state: GameState): string | undefined {
	const g = state.group;
	if (!g) return undefined;
	const list = Object.values(g.survivors);
	if (!list.length) return undefined;
	const now = gameMinutes(state.time);
	const lines = list.map((sv) => {
		const inf = sv.infection && sv.infection.stage !== "turned" ? `; INFECTED (${sv.infection.stage}, ${sv.infection.part}, ≈${Math.max(0, Math.round((sv.infection.turnsAt - now) / 60))} h left, DM only)` : "";
		const status = sv.status === "away" && sv.away ? `away (${sv.away.task.replace("_", " ")} until ${clock(sv.away.until)})` : sv.status;
		const gear = sv.gear.map((x) => `${getEquipment(x.ref)?.name ?? x.ref}${x.qty > 1 ? ` x${x.qty}` : ""}`).join(", ");
		return `- ${nameOf(state, sv)} [${sv.npcId}] ${professionLabel(sv.profession)} ${sv.level} [${sv.profession}], HP ${sv.hp}/${sv.maxHp}, morale ${sv.morale}/10${sv.missedDays ? ` (${sv.missedDays} day(s) short of food/water)` : ""}, ${status}${inf}; specialty: ${sv.specialty}; traits: ${sv.traits.join(", ") || "—"}; gear: ${gear || "nothing"}`;
	});
	return `Group (companions; their food/water is taken at 08:00 after the player's; send_survivor errands resolve on the clock):\n${lines.join("\n")}`;
}

