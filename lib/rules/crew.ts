/**
 * Root Access, Phase 4: the crew (docs/cyberpunk.md §7, §4 "the van").
 *
 * A crew member's identity (name, portrait, voice) stays in state.npcs; the
 * CrewMember record (state.cyber.crew) holds what the engine needs: hacking
 * style (a class id), level, HP, role, where their own hat sits, loyalty and
 * gear (c- equipment ids).
 *
 * Like the survivors of The Quiet they are deliberately weaker than the
 * player: modest stats, average hit dice, an XP value that fits under the
 * solo ally cap (lib/rules/encounter-budget.ts), so the PC stays the
 * protagonist.
 *
 * Loyalty follows the Hat: every time the PC's Hat moves away from a member
 * who ends up far from it (distance > 6) they lose 1 (2 for a big move);
 * each day far away costs 1 more; close to it (≤ 2) they slowly warm up. At
 * 0 they walk. At loyalty ≤ 2, far from the PC's Hat and with Heat ≥ 5, the
 * daily tick rolls for a betrayal: Heat +2 and a Ferro raid on the den.
 *
 * Everything here mutates the state it is given and returns short English
 * notes for the DM. Zombie survivors (lib/rules/group.ts) stay separate.
 */
import type { Abilities, Ability, Combatant, CrewMember, CrewRole, GameState, MonsterAction, MonsterStats } from "../game/types";
import { rulesetLabelEn } from "../i18n/ruleset-labels";
import { getClass, getEquipment } from "../srd";
import type { MonsterSpawn } from "./combat/types";
import { addHeat, cyberOf, hatText, isCyber, type RecordRoll } from "./cyber";
import { abilityMod, roll, signed, type Rng } from "./dice";
import { allyCap } from "./encounter-budget";
import { scheduleRaid } from "./raid";
import { gameMinutes } from "./survival";

// ─── numbers ────────────────────────────────────────────────────────────────

/** Most crew at once (with the PC, at the den or away). */
export const CREW_CAP = 4;
/** Further than this from the PC's Hat and a member loses loyalty. */
export const HAT_FAR = 6;
/** Within this of the PC's Hat and a member slowly gains loyalty. */
export const HAT_CLOSE = 2;
/** Passive warming stops here; above it only the DM's good moments (crew_loyalty). */
export const PASSIVE_LOYALTY_MAX = 8;
/** Betrayal needs loyalty at or below this… */
export const BETRAYAL_LOYALTY = 2;
/** …and Heat at or above this. */
export const BETRAYAL_HEAT = 5;
/** Heat added by a betrayal. */
export const BETRAYAL_HEAT_GAIN = 2;
/** Hours until the raid a betrayal sends. */
export const BETRAYAL_RAID_HOURS = 6;
/** The van: bonus a runner or tech on the line adds to node checks. */
export const VAN_ASSIST = 2;

export const CREW_ROLES: readonly CrewRole[] = ["driver", "face", "muscle", "medic", "runner", "tech"];
export type CrewStatus = CrewMember["status"];
export const ACTIVE_STATUSES: readonly CrewStatus[] = ["with_pc", "at_den", "away"];
export const isActiveCrew = (m: CrewMember): boolean => ACTIVE_STATUSES.includes(m.status);

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
const pcLevel = (state: GameState) => state.character.classes.reduce((n, k) => n + k.level, 0);

export function crewOf(state: GameState): Record<string, CrewMember> {
	const cy = cyberOf(state);
	cy.crew ??= {};
	return cy.crew;
}

export const crewName = (state: GameState, m: CrewMember): string => state.npcs[m.npcId]?.name ?? m.npcId;

export function crewMember(state: GameState, npcId: string): CrewMember {
	const m = state.cyber?.crew?.[npcId];
	if (!m) throw new Error(`${state.npcs[npcId]?.name ?? npcId} is not in the crew. Recruit them first (recruit_crew).`);
	return m;
}

export const activeCrew = (state: GameState): CrewMember[] =>
	Object.values(state.cyber?.crew ?? {})
		.filter(isActiveCrew)
		.sort((a, b) => a.joinedAt - b.joinedAt);

/** How far a member's hat sits from the PC's. */
export const hatDistance = (m: Pick<CrewMember, "hatPref">, hat: number) => Math.abs(m.hatPref - hat);

// ─── hacking styles ─────────────────────────────────────────────────────────

interface Style {
	primary: Ability;
	secondary: Ability;
	/** Default weapon when the DM gives no gear. */
	weapon: string;
	perk: { name: string; description: string };
	toHit?: { all?: number; ranged?: number };
	hpPerLevel?: number;
	speed?: number;
}

export const STYLES: Record<string, Style> = {
	barbarian: { primary: "str", secondary: "con", weapon: "c-machete", hpPerLevel: 2, perk: { name: "Overdrive", description: "Chromed: hard to put down (extra hit points)." } },
	bard: { primary: "cha", secondary: "dex", weapon: "c-light-pistol", perk: { name: "Silver Tongue", description: "A social engineer: talks their way past doors and guards (DM)." } },
	cleric: { primary: "wis", secondary: "dex", weapon: "c-knife", perk: { name: "Field Surgery", description: "A ripperdoc: as an action patches up an adjacent ally (DM: heal 1d4 + their level). Outside a fight they can stitch the PC up." } },
	druid: { primary: "wis", secondary: "con", weapon: "c-stun-baton", perk: { name: "Chem Kit", description: "A biohacker: stims, sedatives and nanites mixed on the spot (DM)." } },
	fighter: { primary: "dex", secondary: "con", weapon: "c-heavy-pistol", toHit: { all: 1 }, perk: { name: "Trained", description: "A solo: +1 to hit with every weapon." } },
	monk: { primary: "dex", secondary: "wis", weapon: "c-knife", speed: 40, perk: { name: "Wired Reflexes", description: "An edgerunner: fast (speed 40 ft.), unarmed strikes hit hard." } },
	paladin: { primary: "str", secondary: "cha", weapon: "c-stun-baton", perk: { name: "The Code", description: "Code-sworn: never leaves someone behind; won't do what their Code forbids." } },
	ranger: { primary: "dex", secondary: "wis", weapon: "c-light-pistol", toHit: { ranged: 1 }, perk: { name: "Drone Eyes", description: "A drone jockey: +1 to hit at range; sees around corners with a scout drone (DM)." } },
	rogue: { primary: "dex", secondary: "int", weapon: "c-knife", perk: { name: "Light Fingers", description: "An infiltrator: locks, vents and pockets." } },
	sorcerer: { primary: "cha", secondary: "dex", weapon: "c-needle-pistol", perk: { name: "Touch Jack", description: "Wetwired: hacks a device by touching it (DM)." } },
	warlock: { primary: "cha", secondary: "con", weapon: "c-light-pistol", perk: { name: "Someone's Leash", description: "Leashed: their code is lent, and the lender sometimes calls." } },
	wizard: { primary: "int", secondary: "dex", weapon: "c-knife", perk: { name: "Second Runner", description: "A netrunner: can ride along on a run from the van." } },
};

/** Hacking-style names the DM may use instead of class ids ("Netrunner" → wizard). */
const STYLE_ALIASES: Record<string, string> = {
	chromed: "barbarian", "social engineer": "bard", ripperdoc: "cleric", biohacker: "druid", solo: "fighter", edgerunner: "monk",
	"code-sworn": "paladin", "code sworn": "paladin", "drone jockey": "ranger", infiltrator: "rogue", wetwired: "sorcerer", leashed: "warlock", netrunner: "wizard",
};

/** A class id from a class id or a hacking-style name. */
export function styleId(s: string): string {
	const k = s.trim().toLowerCase();
	if (STYLES[k]) return k;
	const id = STYLE_ALIASES[k];
	if (!id) throw new Error(`Unknown hacking style "${s}". Use a class id (${Object.keys(STYLES).join(", ")}) or a style (Netrunner, Solo, Ripperdoc, Infiltrator…).`);
	return id;
}

/** "Netrunner", "Solo" (English, for the DM). */
export function styleLabel(classId: string): string {
	return rulesetLabelEn("cyberpunk", getClass(classId)?.name ?? classId);
}

export function crewAbilities(classId: string): Abilities {
	const p = STYLES[classId] ?? STYLES.fighter;
	const a: Abilities = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
	a[p.secondary] = 12;
	a[p.primary] = 13;
	return a;
}

const prof = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

/** Average hit dice plus CON per level (the PC gets the max die at level 1; crew don't). */
export function crewMaxHp(classId: string, level: number): number {
	const p = STYLES[classId] ?? STYLES.fighter;
	const die = getClass(classId)?.hitDie ?? 8;
	const con = abilityMod(crewAbilities(classId).con);
	return Math.max(1, level * (Math.floor(die / 2) + 1 + con + (p.hpPerLevel ?? 0)));
}

/** XP of a crew stat block: small, so the crew fits under the ally cap at the PC's level. */
export function crewXp(level: number): number {
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

const dmg = (dice: string, mod: number) => `${dice}${mod ? signed(mod) : ""}`;
const avgDice = (dice: string) => {
	const m = /^(\d+)d(\d+)/.exec(dice);
	return m ? (Number(m[1]) * (Number(m[2]) + 1)) / 2 : Number(dice) || 0;
};

/** The crew member as a combatant: original numbers from style, level and gear (guns are assumed loaded). */
export function crewStatBlock(m: CrewMember, name?: string): MonsterStats {
	const p = STYLES[m.classId] ?? STYLES.fighter;
	const ab = crewAbilities(m.classId);
	const str = abilityMod(ab.str);
	const dex = abilityMod(ab.dex);
	const pb = prof(m.level);
	const gear = m.gear.map((ref) => getEquipment(ref)).filter((e): e is NonNullable<typeof e> => !!e);

	const armor = gear.filter((e) => e.armor && e.armor.type !== "shield").sort((a, b) => b.armor!.baseAc - a.armor!.baseAc)[0]?.armor;
	const shield = gear.some((e) => e.armor?.type === "shield");
	let ac = armor ? armor.baseAc + (armor.dex ? Math.min(dex, armor.dexCap ?? 99) : 0) : 10 + dex + (m.classId === "monk" ? abilityMod(ab.wis) : 0);
	if (shield) ac += 2;
	ac = Math.max(10, Math.min(15, ac));

	const actions: MonsterAction[] = [];
	const allBonus = p.toHit?.all ?? 0;
	const melee = gear.filter((e) => e.weapon && !e.weapon.ranged).sort((a, b) => avgDice(b.weapon!.damage) - avgDice(a.weapon!.damage))[0];
	if (melee?.weapon) {
		const w = melee.weapon;
		const mod = w.properties.includes("finesse") ? Math.max(str, dex) : str;
		const hit = pb + mod + allBonus;
		const reach = w.properties.includes("reach") ? 10 : 5;
		const text = `Melee Weapon Attack: ${signed(hit)} to hit, reach ${reach} ft., one target. Hit: ${dmg(w.damage, mod)} ${w.damageType} damage.`;
		actions.push({ name: melee.name, description: text, attack: { name: melee.name, kind: "melee", toHit: hit, reach, damage: [{ dice: dmg(w.damage, mod), type: w.damageType }], description: text } });
	} else {
		const monk = m.classId === "monk";
		const mod = monk ? Math.max(str, dex) : str;
		const dice = monk ? "1d6" : "1d4";
		const label = monk ? "Unarmed Strike" : "Improvised Weapon";
		const hit = pb + mod + allBonus;
		const text = `Melee Weapon Attack: ${signed(hit)} to hit, reach 5 ft., one target. Hit: ${dmg(dice, mod)} bludgeoning damage.`;
		actions.push({ name: label, description: text, attack: { name: label, kind: "melee", toHit: hit, reach: 5, damage: [{ dice: dmg(dice, mod), type: "bludgeoning" }], description: text } });
	}
	const gun = gear.filter((e) => e.weapon?.ranged).sort((a, b) => avgDice(b.weapon!.damage) - avgDice(a.weapon!.damage))[0];
	if (gun?.weapon) {
		const w = gun.weapon;
		const hit = pb + dex + allBonus + (p.toHit?.ranged ?? 0);
		const range = w.range ?? { normal: 30, long: 90 };
		const text = `Ranged Weapon Attack: ${signed(hit)} to hit, range ${range.normal}/${range.long ?? range.normal * 3} ft., one target. Hit: ${dmg(w.damage, dex)} ${w.damageType} damage.`;
		actions.push({ name: gun.name, description: text, attack: { name: gun.name, kind: "ranged", toHit: hit, range, damage: [{ dice: dmg(w.damage, dex), type: w.damageType }], description: text } });
	}
	if (m.classId === "cleric" || m.role === "medic")
		actions.push({ name: "Patch Up", description: `Touches an ally within 5 ft. and stops the bleeding: the ally regains 1d4 + ${m.level} hit points (DM: resolve with the heal tool on that ally).`, usage: { type: "per_day", times: 2 } });

	const xp = crewXp(m.level);
	const die = getClass(m.classId)?.hitDie ?? 8;
	const con = abilityMod(ab.con);
	return {
		index: `crew-${m.npcId}`,
		name: name ?? `Crew (${styleLabel(m.classId)})`,
		ruleset: "cyberpunk",
		size: "medium",
		type: "humanoid (human)",
		alignment: "any alignment",
		ac,
		hp: m.maxHp,
		hitDice: `${m.level}d${die}${con * m.level ? signed(con * m.level) : ""}`,
		speed: { walk: p.speed ?? 30 },
		abilities: ab,
		saves: {},
		skills: {},
		vulnerabilities: [],
		resistances: [],
		immunities: [],
		conditionImmunities: [],
		senses: `passive Perception ${10 + abilityMod(ab.wis)}`,
		languages: "Spanish, English",
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

export interface RecruitCrewArgs {
	npcId: string;
	classId: string;
	level?: number;
	role: CrewRole;
	hatPref: number;
	specialty: string;
	gear?: string[];
}

/** Starting loyalty: 5, one more if their hat sits close to the PC's, one less if far. */
export function startingLoyalty(hatPref: number, hat: number): number {
	const d = Math.abs(hatPref - hat);
	return d <= HAT_CLOSE ? 6 : d > HAT_FAR ? 4 : 5;
}

export function recruitCrew(state: GameState, a: RecruitCrewArgs): CrewMember {
	const npc = state.npcs[a.npcId];
	if (!npc) throw new Error(`Unknown NPC ${a.npcId}. Only someone already met (add_npc) can join the crew.`);
	if (!npc.alive) throw new Error(`${npc.name} is dead.`);
	const crew = crewOf(state);
	const prev = crew[a.npcId];
	if (prev && isActiveCrew(prev)) throw new Error(`${npc.name} is already in the crew (${prev.status}).`);
	if (prev?.status === "dead") throw new Error(`${npc.name} is dead.`);
	if (prev?.status === "betrayed") throw new Error(`${npc.name} sold the PC out. They don't come back to the crew.`);
	const active = activeCrew(state);
	if (active.length >= CREW_CAP) throw new Error(`The crew is full (${CREW_CAP}: ${active.map((m) => crewName(state, m)).join(", ")}). Someone has to go first (crew_dismiss).`);
	if (!CREW_ROLES.includes(a.role)) throw new Error(`role must be one of ${CREW_ROLES.join(", ")}.`);
	const classId = styleId(a.classId);
	// Never stronger than the player: at most the player's level.
	const level = clamp(a.level ?? 1, 1, Math.max(1, pcLevel(state)));
	const gear = (a.gear?.length ? a.gear : [STYLES[classId].weapon]).map((ref) => {
		const e = getEquipment(ref.trim());
		if (!e || e.ruleset !== "cyberpunk") throw new Error(`Unknown gear "${ref}": use Root Access equipment ids (lookup_srd), e.g. c-knife, c-light-pistol, c-armored-jacket.`);
		return e.index;
	});
	const hatPref = clamp(a.hatPref, -10, 10);
	const maxHp = crewMaxHp(classId, level);
	const cy = cyberOf(state);
	const m: CrewMember = {
		npcId: npc.id,
		classId,
		level,
		hp: maxHp,
		maxHp,
		role: a.role,
		hatPref,
		loyalty: startingLoyalty(hatPref, cy.hat),
		status: "with_pc",
		specialty: a.specialty.trim().slice(0, 120),
		gear,
		joinedAt: gameMinutes(state.time),
	};
	crew[npc.id] = m;
	npc.disposition = "friendly";
	npc.locationId = state.world.currentLocationId;
	if (!state.scene.npcIds.includes(npc.id)) state.scene.npcIds = [...state.scene.npcIds, npc.id];
	return m;
}

export function recruitText(state: GameState, m: CrewMember): string {
	const hat = cyberOf(state).hat;
	const gear = m.gear.map((g) => getEquipment(g)?.name ?? g).join(", ");
	return `${crewName(state, m)} joins the crew: ${m.role}, ${styleLabel(m.classId)} ${m.level} [${m.classId}], HP ${m.maxHp}, loyalty ${m.loyalty}/10, their hat ${hatText(m.hatPref)} vs the PC's ${hatText(hat)} (distance ${hatDistance(m, hat)}). Brings: ${m.specialty}. Gear: ${gear}. With the PC now (crew_status to send them to the den or away).`;
}

// ─── loyalty ────────────────────────────────────────────────────────────────

/** Moves a member's loyalty; at 0 they walk. Returns the DM line. */
export function adjustLoyalty(state: GameState, m: CrewMember, delta: number, why: string): string {
	const from = m.loyalty;
	m.loyalty = clamp(from + delta, 0, 10);
	const name = crewName(state, m);
	let text = m.loyalty === from ? `${name}'s loyalty stays ${from}/10 (${why}).` : `${name}'s loyalty ${from} → ${m.loyalty}/10: ${why}.`;
	if (m.loyalty <= 0 && isActiveCrew(m)) text += ` ${leaveCrew(state, m, "loyalty ran out")}`;
	return text;
}

/** A member walks away (loyalty 0 or dismissed). */
export function leaveCrew(state: GameState, m: CrewMember, why: string, dismissed = false): string {
	const name = crewName(state, m);
	m.status = "left";
	const npc = state.npcs[m.npcId];
	if (npc && npc.disposition === "friendly") npc.disposition = "neutral";
	state.scene.npcIds = state.scene.npcIds.filter((id) => id !== m.npcId);
	const text = dismissed ? `${name} is OUT of the crew (${why}).` : `${name} LEAVES the crew (${why}). Play the goodbye, or the empty chair if they just stop answering.`;
	state.dmNotes.push(`Crew: ${name} left (${why}), day ${state.time.day}.`);
	return text;
}

/** The PC's Hat moved from → to: members it moves away from (and leaves far) cool, members it brings close warm up. */
export function crewHatReaction(state: GameState, from: number, to: number): string[] {
	if (from === to) return [];
	const out: string[] = [];
	for (const m of activeCrew(state)) {
		const before = hatDistance(m, from);
		const after = hatDistance(m, to);
		if (after > before && after > HAT_FAR) out.push(`CREW: ${adjustLoyalty(state, m, after - before >= 3 ? -2 : -1, `the PC's hat moved to ${hatText(to)}, far from theirs (${hatText(m.hatPref)})`)}`);
		else if (after < before && after <= HAT_CLOSE && m.loyalty < PASSIVE_LOYALTY_MAX) out.push(`CREW: ${adjustLoyalty(state, m, 1, `the PC's hat moved to ${hatText(to)}, close to theirs (${hatText(m.hatPref)})`)}`);
	}
	return out;
}

/** Can this member sell the PC out today? Their % chance a day, or 0. */
export function betrayalChance(state: GameState, m: CrewMember): number {
	const cy = state.cyber;
	if (!cy || !isActiveCrew(m)) return 0;
	if (m.loyalty > BETRAYAL_LOYALTY || hatDistance(m, cy.hat) <= HAT_FAR || cy.heat < BETRAYAL_HEAT) return 0;
	return Math.min(60, 10 + 10 * (BETRAYAL_LOYALTY + 1 - m.loyalty) + 5 * (cy.heat - BETRAYAL_HEAT));
}

/** A member sells the PC out: Heat +2 and a Ferro raid on the den in 6 hours. */
export function betrayCrew(state: GameState, m: CrewMember): string {
	const name = crewName(state, m);
	m.status = "betrayed";
	const npc = state.npcs[m.npcId];
	if (npc) npc.disposition = "hostile";
	state.scene.npcIds = state.scene.npcIds.filter((id) => id !== m.npcId);
	const now = gameMinutes(state.time);
	const heat = addHeat(cyberOf(state), BETRAYAL_HEAT_GAIN, `${name} sold the PC out`, now);
	const raid = scheduleRaid(state, "ferro", `${name} sold you out`, BETRAYAL_RAID_HOURS);
	const note = `${name} SOLD THE PC OUT to Grupo Ferro, the way Santi did (loyalty ${m.loyalty}, hat ${hatText(m.hatPref)} vs the PC's ${hatText(cyberOf(state).hat)}). ${heat.text} Let the player find out the hard way: a message that never arrives, a door that's unlocked, Ferro knowing too much.`;
	state.dmNotes.push(`Crew: ${name} betrayed the PC to Ferro, day ${state.time.day}.`);
	return `BETRAYAL: ${note}${raid.text ? ` ${raid.text}` : ""}`;
}

// ─── status ─────────────────────────────────────────────────────────────────

export function setCrewStatus(state: GameState, m: CrewMember, status: "with_pc" | "at_den" | "away", why: string): string {
	const name = crewName(state, m);
	if (!isActiveCrew(m)) throw new Error(`${name} is no longer in the crew (${m.status}).`);
	if (m.status === status) return `${name} is already ${status.replace("_", " ")}.`;
	if (state.encounter?.status === "active" && m.status === "with_pc") throw new Error(`Not in the middle of a fight: ${name} can't leave now.`);
	m.status = status;
	if (status === "with_pc") {
		if (!state.scene.npcIds.includes(m.npcId)) state.scene.npcIds = [...state.scene.npcIds, m.npcId];
		const npc = state.npcs[m.npcId];
		if (npc) npc.locationId = state.world.currentLocationId;
	} else state.scene.npcIds = state.scene.npcIds.filter((id) => id !== m.npcId);
	const where = { with_pc: "back with the PC", at_den: "at the den", away: "away" }[status];
	return `${name} is ${where} (${why}).`;
}

export function killCrew(state: GameState, m: CrewMember, how: string): string {
	const name = crewName(state, m);
	m.status = "dead";
	m.hp = 0;
	const npc = state.npcs[m.npcId];
	if (npc) npc.alive = false;
	state.dmNotes.push(`Crew: ${name} died (${how}), day ${state.time.day}.`);
	const others = activeCrew(state).filter((o) => o.npcId !== m.npcId);
	return `${name} is DEAD (${how}).${others.length ? ` The rest of the crew takes it hard; play it.` : ""}`;
}

// ─── the daily tick ─────────────────────────────────────────────────────────

const MAX_DAYS = 30;

/**
 * Runs after every state mutation in Root Access: reacts to Hat moves since
 * the last tick, then for each day boundary crossed drifts loyalty with the
 * Hat and rolls for betrayals (secret rolls).
 */
export function crewTick(state: GameState, rng: Rng): string | undefined {
	const cy = state.cyber;
	if (!cy?.crew || !Object.keys(cy.crew).length) return undefined;
	const now = gameMinutes(state.time);
	const tick = (cy.crewTick ??= { at: now, hat: cy.hat });
	const out: string[] = [];
	if (tick.hat !== cy.hat) {
		out.push(...crewHatReaction(state, tick.hat, cy.hat));
		tick.hat = cy.hat;
	}
	const days = Math.min(MAX_DAYS, Math.floor(now / 1440) - Math.floor(tick.at / 1440));
	for (let i = 1; i <= days; i++) {
		const day = Math.floor(tick.at / 1440) + i;
		for (const m of activeCrew(state)) {
			const d = hatDistance(m, cy.hat);
			const name = crewName(state, m);
			if (d > HAT_FAR) out.push(`CREW: ${adjustLoyalty(state, m, -1, `another day working for a hat (${hatText(cy.hat)}) far from theirs (${hatText(m.hatPref)})`)}`);
			else if (d <= HAT_CLOSE && m.loyalty < PASSIVE_LOYALTY_MAX && day % 2 === 0) out.push(`CREW: ${adjustLoyalty(state, m, 1, "a good stretch: they believe in what the crew does")}`);
			if (!isActiveCrew(m)) continue;
			const chance = betrayalChance(state, m);
			if (chance > 0) {
				if (rng.int(1, 100) <= chance) out.push(betrayCrew(state, m));
				else out.push(`CREW (DM only): ${name} thought about selling the PC out today (${chance}% chance) and didn't. Not yet.`);
			}
		}
	}
	tick.at = Math.max(tick.at, now);
	return out.join("\n") || undefined;
}

// ─── combat ─────────────────────────────────────────────────────────────────

export function crewForCombatant(state: GameState, c: Pick<Combatant, "kind" | "side" | "refId">): CrewMember | undefined {
	if (c.kind !== "npc" || c.side !== "party" || !isCyber(state)) return undefined;
	return state.cyber?.crew?.[c.refId];
}

type MapLike = { id?: string; entities: { id: string; kind: string; npcId?: string; x: number; y: number; dead?: boolean }[] };

export type CrewSpawn = MonsterSpawn & { stats: MonsterStats; id: string; name: string; side: "party"; kind: "npc"; refId: string; hp: number };

/** A spawn for one member on the active map (their token if placed, else next to the PC). */
export function crewSpawn(state: GameState, m: CrewMember, map: MapLike): CrewSpawn {
	const name = crewName(state, m);
	const ent = map.entities.find((e) => e.npcId === m.npcId && !e.dead && e.kind !== "pc");
	const pc = map.entities.find((e) => e.kind === "pc");
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "crew";
	return {
		stats: crewStatBlock(m, name),
		id: `cr-${slug}-${m.npcId.slice(-4)}`,
		name,
		side: "party",
		kind: "npc",
		refId: m.npcId,
		hp: m.hp,
		...(ent ? { entityId: ent.id } : pc ? { near: { x: pc.x, y: pc.y } } : {}),
	};
}

/** A den raid is being fought on this map (raid_begin set raidDue.started before the fight). */
export const raidOnMap = (state: GameState, mapId: string | undefined): boolean => {
	const started = state.cyber?.den?.raidDue?.started;
	return !!started && !!mapId && started.mapId === mapId;
};

/** Is this member in a fight on that map: with the PC, or at the den while the den is raided there. */
export const fightsHere = (state: GameState, m: CrewMember, mapId: string | undefined): boolean =>
	m.status === "with_pc" || (m.status === "at_den" && raidOnMap(state, mapId));

/** The fight is on the net map: the crew is with the body, not in the net. */
const onNet = (state: GameState, map: MapLike) => !!state.cyber?.run && state.cyber.run.netMapId === map.id;

/** Spawns the DM linked to a crew member (npcId) fight as that member: their stat block, HP and side. */
export function crewAsThemselves(state: GameState, spawns: MonsterSpawn[]): MonsterSpawn[] {
	if (!isCyber(state) || !state.cyber?.crew) return spawns;
	const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	return spawns.map((s) => {
		const m = s.kind === "npc" && s.refId ? state.cyber!.crew![s.refId] : undefined;
		if (!m || !map || !fightsHere(state, m, map.id)) return s;
		const own = crewSpawn(state, m, map);
		return { ...s, stats: own.stats, hp: m.hp, side: "party", name: own.name, ...(s.entityId || s.near || s.position ? {} : own.entityId ? { entityId: own.entityId } : own.near ? { near: own.near } : {}) };
	});
}

/**
 * Crew with the PC who join a fight automatically, in the order they joined,
 * while their XP fits under the ally cap left after the DM's allies. The rest
 * hang back (the PC stays the protagonist).
 */
export function crewForCombat(state: GameState, map: MapLike, alliesXp: number, skip: Set<string>): { spawns: CrewSpawn[]; held: string[] } {
	let room = allyCap(pcLevel(state)) - alliesXp;
	const spawns: CrewSpawn[] = [];
	const held: string[] = [];
	for (const m of activeCrew(state).filter((x) => fightsHere(state, x, map.id) && !skip.has(x.npcId))) {
		if (m.hp <= 0) {
			held.push(`${crewName(state, m)} (down, 0 HP)`);
			continue;
		}
		const xp = crewXp(m.level);
		if (xp > room) {
			held.push(`${crewName(state, m)} (hangs back: the ally cap keeps the PC the protagonist)`);
			continue;
		}
		room -= xp;
		spawns.push(crewSpawn(state, m, map));
	}
	return { spawns, held };
}

/** start_combat in Root Access: crew with the PC join (within the ally cap), unless the fight is in the net. */
export function withCrew(state: GameState, map: MapLike, spawns: MonsterSpawn[]): { spawns: MonsterSpawn[]; note: string } {
	if (!isCyber(state) || !activeCrew(state).length) return { spawns, note: "" };
	if (onNet(state, map)) {
		const van = activeCrew(state).filter((m) => m.status === "with_pc");
		return { spawns, note: van.length ? `\nThe crew (${van.map((m) => crewName(state, m)).join(", ")}) is with the PC's body, not in the net: they don't fight here.` : "" };
	}
	const own = crewAsThemselves(state, spawns);
	const crew = state.cyber!.crew!;
	const listed = new Set(own.filter((s) => s.kind === "npc" && s.refId && s.side === "party" && !!crew[s.refId] && fightsHere(state, crew[s.refId], map.id)).map((s) => s.refId!));
	const alliesXp = own.filter((s) => s.side === "party").reduce((n, s) => n + (s.stats.xp ?? 0), 0);
	const { spawns: joined, held } = crewForCombat(state, map, alliesXp, listed);
	const names = [...joined.map((s) => `${s.name} [${s.id}]`), ...[...listed].map((id) => state.npcs[id]?.name ?? id)];
	const note = [
		names.length
			? `\nCrew fighting beside the PC (side party): ${names.join(", ")}. On their turns YOU play them with monster_turn, as the people they are; they help, but never land the decisive blow on an important enemy (the PC is the protagonist).`
			: "",
		held.length ? `\nCrew not fighting: ${held.join("; ")}.` : "",
	].join("");
	return { spawns: [...own, ...joined], note };
}

/** After a spawn: the combatant's max HP is the member's, and the token links to the NPC. */
export function linkCrewCombatants(state: GameState): void {
	const enc = state.encounter;
	if (!enc || !isCyber(state)) return;
	const map = state.maps[enc.mapId];
	for (const c of Object.values(enc.combatants)) {
		const m = crewForCombatant(state, c);
		if (!m) continue;
		c.maxHp = Math.max(c.maxHp, m.maxHp);
		const ent = map?.entities.find((e) => e.id === c.entityId);
		if (ent) {
			ent.npcId = m.npcId;
			ent.kind = "npc";
		}
	}
}

/**
 * After every combat result: HP back to the CrewMember; a member who drops
 * rolls a last d20 (10+: down but alive, else dead).
 */
export function syncCrewFromCombat(state: GameState, rng: Rng, record: RecordRoll): string[] {
	const enc = state.encounter;
	if (!enc || !isCyber(state) || !state.cyber?.crew) return [];
	const out: string[] = [];
	for (const c of Object.values(enc.combatants)) {
		const m = crewForCombatant(state, c);
		if (!m || (m.status !== "with_pc" && m.status !== "at_den")) continue;
		if (!c.dead) {
			m.hp = Math.max(0, Math.min(m.maxHp, c.hp));
			continue;
		}
		if (m.hp <= 0) continue; // already resolved
		const name = crewName(state, m);
		const r = roll(rng, "1d20", { label: `${name}: still breathing?`, target: 10, actor: m.npcId });
		record(r);
		if (r.total >= 10) {
			m.hp = 0;
			out.push(`${name} drops (d20 ${r.total}): down and out of the fight but ALIVE (0 HP; they come round at 1 HP after the fight). DM: describe them falling.`);
		} else out.push(killCrew(state, m, `killed in the fight (d20 ${r.total})`));
	}
	return out;
}

/** End of combat: members who went down but lived get up at 1 HP; their tokens aren't corpses. */
export function crewAfterCombat(state: GameState, enc: NonNullable<GameState["encounter"]>): string | undefined {
	if (!isCyber(state)) return undefined;
	const map = state.maps[enc.mapId];
	const up: string[] = [];
	for (const c of Object.values(enc.combatants)) {
		const m = crewForCombatant(state, c);
		if (!m || (m.status !== "with_pc" && m.status !== "at_den")) continue;
		if (m.hp <= 0) {
			m.hp = 1;
			up.push(crewName(state, m));
		}
		const ent = map?.entities.find((e) => e.id === c.entityId);
		if (ent) ent.dead = false;
	}
	return up.length ? `${up.join(", ")} come${up.length === 1 ? "s" : ""} round at 1 HP.` : undefined;
}

/** Long rest: crew with the PC or at the den get their HP back too. */
export function restCrew(state: GameState): string | undefined {
	if (!isCyber(state)) return undefined;
	const list = activeCrew(state).filter((m) => (m.status === "with_pc" || m.status === "at_den") && m.hp < m.maxHp);
	for (const m of list) m.hp = m.maxHp;
	return list.length ? `The crew rested too: ${list.map((m) => `${crewName(state, m)} HP ${m.hp}/${m.maxHp}`).join(", ")}.` : undefined;
}

// ─── the van (during a net run) ─────────────────────────────────────────────

/** A runner or tech with the PC rides along from the van: +2 to node checks. */
export function vanAssist(state: GameState): { bonus: number; who?: string } {
	if (!isCyber(state) || !state.cyber?.run) return { bonus: 0 };
	const m = activeCrew(state).find((x) => x.status === "with_pc" && x.hp > 0 && (x.role === "runner" || x.role === "tech"));
	return m ? { bonus: VAN_ASSIST, who: crewName(state, m) } : { bonus: 0 };
}

/**
 * Trace 8 with the body onsite: muscle and drivers with the PC hold security
 * off, in a quick abstract skirmish the engine rolls (d20 + proficiency + best
 * attack ability, +2 per extra defender, vs DC 10 + 2 × security). Held: the
 * body is safe this run (scrapes, 1d6 each). Not held: each defender takes
 * security × 1d6 (to 0 HP at worst: down, not dead), the guards reach the
 * body, and the DM runs that fight when the PC jacks out.
 */
export function vanHoldsTheBody(state: GameState, rng: Rng, record: RecordRoll): string[] {
	const run = state.cyber?.run;
	if (!run || !isCyber(state)) return [];
	const defenders = activeCrew(state).filter((m) => m.status === "with_pc" && m.hp > 0 && (m.role === "muscle" || m.role === "driver"));
	if (!defenders.length) {
		const van = activeCrew(state).filter((m) => m.status === "with_pc" && m.hp > 0);
		return van.length ? [`THE VAN: ${van.map((m) => crewName(state, m)).join(", ")} ${van.length === 1 ? "is" : "are"} with the body, but nobody there is muscle or a driver: they can warn the PC, not stop the guards.`] : [];
	}
	const best = defenders
		.map((m) => {
			const ab = crewAbilities(m.classId);
			return { m, mod: prof(m.level) + Math.max(abilityMod(ab.str), abilityMod(ab.dex)) };
		})
		.sort((a, b) => b.mod - a.mod)[0];
	const dc = 10 + 2 * run.security;
	const bonus = best.mod + 2 * (defenders.length - 1);
	const names = defenders.map((m) => crewName(state, m)).join(", ");
	const r = roll(rng, `1d20${signed(bonus)}`, { label: `The van: ${names} hold the body (DC ${dc})`, actor: best.m.npcId, target: dc });
	record(r);
	const hurt: string[] = [];
	for (const m of defenders) {
		const d = roll(rng, r.total >= dc ? "1d6" : `${run.security}d6`, { label: `${crewName(state, m)}: hurt holding the body`, actor: m.npcId });
		record(d);
		m.hp = Math.max(0, m.hp - d.total);
		hurt.push(`${crewName(state, m)} −${d.total} HP → ${m.hp}/${m.maxHp}${m.hp === 0 ? " (DOWN, alive)" : ""}`);
	}
	if (r.total >= dc)
		return [`THE VAN (${r.total} vs DC ${dc}): ${names} HOLD security off. The body is safe for the rest of this run; narrate it in cuts (a door wedged, a car across the ramp, shots in a stairwell). Scrapes: ${hurt.join("; ")}.`];
	return [
		`THE VAN (${r.total} vs DC ${dc}): ${names} couldn't hold them: ${hurt.join("; ")}. The guards reach the body. When the PC jacks out (or is dumped), run that fight at the body (start_combat on the body map with Ferro guards; the crew there join as usual).`,
	];
}

// ─── digest ─────────────────────────────────────────────────────────────────

/** "Crew:" lines for the DM digest, flagging who is wavering. */
export function crewDigest(state: GameState): string | undefined {
	const cy = state.cyber;
	const list = Object.values(cy?.crew ?? {});
	if (!cy || !list.length) return undefined;
	const lines = list
		.sort((a, b) => a.joinedAt - b.joinedAt)
		.map((m) => {
			const d = hatDistance(m, cy.hat);
			const flags: string[] = [];
			if (isActiveCrew(m)) {
				if (d > HAT_FAR) flags.push(`WAVERING: far from their hat, −1 loyalty a day${m.loyalty <= 2 ? `, walks at 0` : ""}`);
				else if (m.loyalty <= 3) flags.push("WAVERING: low loyalty, walks at 0");
				const chance = betrayalChance(state, m);
				if (chance) flags.push(`could SELL THE PC OUT (${chance}% a day; DM only: foreshadow it)`);
			}
			const gear = m.gear.map((g) => getEquipment(g)?.name ?? g).join(", ");
			return `- ${crewName(state, m)} [${m.npcId}] ${m.role}, ${styleLabel(m.classId)} ${m.level} [${m.classId}], HP ${m.hp}/${m.maxHp}, loyalty ${m.loyalty}/10, hat ${hatText(m.hatPref)} vs PC ${hatText(cy.hat)} (distance ${d}), ${m.status}${flags.length ? ` · ${flags.join("; ")}` : ""}; brings: ${m.specialty}; gear: ${gear || "nothing"}`;
		});
	return `Crew (max ${CREW_CAP}; with_pc members fight beside the PC within the ally cap and wait in the van during runs; a runner/tech adds +${VAN_ASSIST} to node checks, muscle/drivers hold the body at trace 8):\n${lines.join("\n")}`;
}
