/**
 * The Quiet: night sieges at the base (docs/zombie.md §7). Some nights the dead
 * come to the walls. A siege is announced (phase "warning"), the player sets
 * the defence on the base map ("prep": who guards which barricade or outer
 * door, lights on or off), then the night plays out in waves ("active") that
 * the engine resolves when the player holds the line. Barricades give way; a
 * breach is a real fight. At dawn (or when the horde is spent) it is "over":
 * residents lost, morale, stock spent, and a summary for the DM.
 *
 * The player is the protagonist by construction: they get the most attack
 * rolls, the only repair action and the breach fights; companions help (one
 * roll each, only those that fit under the ally cap) and their kills can never
 * run ahead of the player's by more than SIEGE.allyEdge.
 *
 * Pure rules over GameState (mutated in place inside withState). Nothing about
 * future waves is precomputed: every wave is rolled when it is resolved, so the
 * client sees no secret schedule.
 */
import type { BaseState, Character, GameState, GridMap, InventoryItem, MonsterStats, SiegeState, Survivor, Tile } from "../game/types";
import { getEquipment, getMonster } from "../srd";
import { applyDamage, isDead } from "./character/resources";
import { derivePcProfile, isRangedWeapon, pcAttackProfile } from "./combat/profile";
import { abilityMod, roll, signed, type Rng } from "./dice";
import { allyCap, budgetCap, soloMultiplier, type Difficulty } from "./encounter-budget";
import { barricadeKey, damageBarricadeOn } from "./barricade";
import { adjustMorale, nameOf, survivorAbilities, survivorBitten, survivorStatBlock, survivorXp } from "./group";
import { residentHeadcount } from "./residents";
import { advanceClock, gameMinutes, infectionSave, isZombie, type RecordRoll } from "./survival";

export const SIEGE = {
	/** Game minutes one wave (and the lull after it) takes. */
	waveMinutes: 45,
	/** Warning before the dead reach the walls (minutes), plus what the upgrades add. */
	warnBase: 10,
	warnAlarm: 20,
	warnTower: 40,
	/** A dawn probe this big (number of dead) turns into a siege that night. */
	probeMin: 6,
	/** The dead come at dusk: 21:00 + up to 90 minutes. */
	dusk: 21 * 60,
	/** Siege HP of an outer door. */
	doorHp: { door: 10, door_locked: 18 } as Record<string, number>,
	/** DC to drop one of the dead through a gap: shooting, hacking at arm's length. */
	dcRanged: 12,
	dcMelee: 10,
	/** Lights: +2 to hit, the hands through the gaps are easier to see, but the dead see the base (+1d4 per wave). */
	lightsBonus: 2,
	/** Repair with 1 materials from the stock (half when the player also moved). */
	repair: "2d6+4",
	repairMoved: "1d6+2",
	/** Companions' kills may lead the player's by at most this many. */
	allyEdge: 2,
	/** Two defenders fit at one post. */
	perPost: 2,
	/** The siege leaves the state a day after it ended (or when the DM closes it). */
	clearAfter: 1440,
} as const;

export type PcSiegeAction = "shoot" | "hack" | "repair" | "hold";
export const PC_SIEGE_ACTIONS: readonly PcSiegeAction[] = ["shoot", "hack", "repair", "hold"];

// ─── helpers ───────────────────────────────────────────────────────────────

const baseOf = (state: GameState): BaseState | undefined => state.group?.base;
const now = (state: GameState) => gameMinutes(state.time);
const clock = (t: number) => `day ${Math.floor(t / 1440)} ${String(Math.floor((t % 1440) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
const pcLevel = (state: GameState) => state.character.classes.reduce((n, k) => n + k.level, 0);

export function siegeOf(state: GameState): SiegeState | undefined {
	return state.siege;
}

/** The party stands at the base's world location. */
export function partyAtBase(state: GameState): boolean {
	const b = baseOf(state);
	return !!b && !!state.world.currentLocationId && state.world.currentLocationId === b.locationId;
}

export function baseMapOf(state: GameState): GridMap | undefined {
	const b = baseOf(state);
	return b?.mapId ? state.maps[b.mapId] : undefined;
}

/** Minutes of warning the base gets: alarm cans and a watchtower see them coming. */
export function warningMinutes(b: BaseState): number {
	return SIEGE.warnBase + (b.upgrades.includes("alarm_cans") ? SIEGE.warnAlarm : 0) + (b.upgrades.includes("watchtower") ? SIEGE.warnTower : 0);
}

export function isNightAt(min: number): boolean {
	const h = Math.floor((min % 1440) / 60);
	return h >= 20 || h < 6;
}

/** Waves in a night: 3, plus one per 20 dead, at most 6. */
export function wavesFor(horde: number): number {
	return Math.max(3, Math.min(6, 3 + Math.floor(horde / 20)));
}

const OUTSIDE = new Set<Tile>(["grass", "tall_grass", "road", "sand", "mud", "tree", "rock", "water", "deep_water", "ice", "void", "bridge"]);
const DOORS = new Set<Tile>(["door", "door_locked"]);

/** A way in the dead can batter: a barricade, or a closed door that opens to the outside. */
export interface Entry {
	key: string;
	x: number;
	y: number;
	kind: "barricade" | "door";
	hp: number;
	max: number;
}

function outerDoor(map: GridMap, x: number, y: number): boolean {
	if (!DOORS.has(map.tiles[y * map.width + x])) return false;
	return [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	].some(([dx, dy]) => {
		const nx = x + dx, ny = y + dy;
		return nx < 0 || ny < 0 || nx >= map.width || ny >= map.height || OUTSIDE.has(map.tiles[ny * map.width + nx]);
	});
}

/** The base map's ways in, with their current HP (barricades from the map, doors from the siege). */
export function entryPoints(map: GridMap, s?: Pick<SiegeState, "doors">): Entry[] {
	const out: Entry[] = [];
	for (let y = 0; y < map.height; y++)
		for (let x = 0; x < map.width; x++) {
			const t = map.tiles[y * map.width + x];
			const key = barricadeKey(x, y);
			if (t === "barricade") {
				const b = map.barricades?.[key] ?? { hp: 25, max: 25 };
				out.push({ key, x, y, kind: "barricade", hp: b.hp, max: b.max });
			} else if (outerDoor(map, x, y)) {
				const d = s?.doors?.[key] ?? { hp: SIEGE.doorHp[t] ?? 10, max: SIEGE.doorHp[t] ?? 10 };
				out.push({ key, x, y, kind: "door", hp: d.hp, max: d.max });
			}
		}
	return out;
}

function siegeLog(s: SiegeState, line: string) {
	s.log.push(line);
	if (s.log.length > 40) s.log.splice(0, s.log.length - 40);
}

const freshStats = (): NonNullable<SiegeState["stats"]> => ({ pcKills: 0, allyKills: 0, pcSaved: 0, allySaved: 0, ammo: 0, materials: 0, drawn: 0, residentsLost: 0, hurt: [], bitten: [] });

function requireSiege(state: GameState): SiegeState {
	const s = state.siege;
	if (!s) throw new Error("There is no siege.");
	return s;
}

/** A companion who can stand a post tonight: alive, not turned, at the base (or with the party, when the party is there). */
function canDefend(state: GameState, sv: Survivor | undefined): sv is Survivor {
	if (!sv || sv.hp <= 0) return false;
	if (sv.status === "at_base") return true;
	return sv.status === "with_party" && partyAtBase(state);
}

function findSurvivor(state: GameState, who: string): Survivor | undefined {
	const list = Object.values(state.group?.survivors ?? {});
	const w = who.trim().toLowerCase();
	return state.group?.survivors[who] ?? list.find((sv) => nameOf(state, sv).toLowerCase() === w) ?? list.find((sv) => nameOf(state, sv).toLowerCase().split(/\s+/)[0] === w);
}

const whoName = (state: GameState, id: string) => (id === "pc" ? state.character.name : (state.npcs[id]?.name ?? id));

// ─── start ─────────────────────────────────────────────────────────────────

export interface StartArgs {
	horde: number;
	source: NonNullable<SiegeState["source"]>;
	hordeId?: string;
	/** Exact arrival (game minute); default: now + warning (at night) or tonight's dusk (by day). */
	arrivesAt?: number;
	/** DM: minutes until they arrive, before the upgrades' extra warning. */
	inMinutes?: number;
	/** When the threat was noticed (default now). */
	from?: number;
}

/**
 * Announces a siege. Throws when there's no base, the base has no map, or a
 * siege is already on. Returns the DM instruction.
 */
export function startSiege(state: GameState, rng: Rng, a: StartArgs): string {
	if (!isZombie(state)) throw new Error("Only in The Quiet.");
	const b = baseOf(state);
	if (!b) throw new Error("There is no base (claim_base first): a siege is the dead coming for the base.");
	const map = baseMapOf(state);
	if (!map) throw new Error(`The base has no map: draw it (draw_map) and claim_base with mapId first, so the defence can be set on it.`);
	if (state.siege && state.siege.phase !== "over") throw new Error(`A siege is already on (${state.siege.phase}, ~${state.siege.horde} dead).`);
	const horde = Math.max(1, Math.round(a.horde));
	const t0 = Math.max(now(state), a.from ?? now(state));
	const warn = warningMinutes(b);
	let arrivesAt: number;
	if (a.arrivesAt !== undefined) arrivesAt = Math.max(t0, a.arrivesAt);
	else if (a.inMinutes !== undefined) arrivesAt = t0 + Math.max(0, Math.round(a.inMinutes)) + warn - SIEGE.warnBase;
	else if (isNightAt(t0)) arrivesAt = t0 + warn;
	else arrivesAt = Math.floor(t0 / 1440) * 1440 + SIEGE.dusk + rng.int(0, 90);
	const doors: Record<string, { hp: number; max: number }> = {};
	for (const e of entryPoints(map)) if (e.kind === "door") doors[e.key] = { hp: e.hp, max: e.max };
	const s: SiegeState = {
		phase: "warning",
		arrivesAt,
		horde,
		hordeStart: horde,
		...(a.hordeId ? { hordeId: a.hordeId } : {}),
		wave: 0,
		waves: wavesFor(horde),
		posts: {},
		lights: false,
		log: [],
		startedAt: t0,
		source: a.source,
		doors,
		stats: freshStats(),
	};
	state.siege = s;
	const entries = entryPoints(map, s);
	siegeLog(s, `${clock(t0)}: ~${horde} dead coming for ${b.name}; at the walls ${clock(arrivesAt)} (${s.waves} waves).`);
	const here = partyAtBase(state);
	const tools = [b.upgrades.includes("watchtower") ? "the watchtower spotted them" : "", b.upgrades.includes("alarm_cans") ? "the alarm cans rattled" : ""].filter(Boolean);
	const lead = arrivesAt - t0;
	return [
		`SIEGE WARNING at ${b.name}: ~${horde} dead are coming; they reach the walls at ${clock(arrivesAt)} (${lead >= 120 ? `about ${Math.round(lead / 60)} h from now` : `${lead} minutes from now`}${tools.length ? `; ${tools.join(" and ")}, so there is time to prepare` : "; no watchtower or alarm cans, so little warning"}). ${s.waves} waves through the night.`,
		`Ways in on the base map [${map.id}]: ${entries.length ? entries.map((e) => `(${e.key}) ${e.kind} ${e.hp}/${e.max}`).join(", ") : "NONE (no barricades, no outer doors): the first wave walks straight in"}.`,
		here
			? "The party is AT the base. Play the warning now (a groan rolling down the street, a shape at the fence, the cans), briefly. The player sets the defence on the Siege panel (who guards which barricade or door, lights on or off) and holds the line wave by wave; the engine resolves the waves. Don't resolve the waves yourself, don't call damage_barricade for them."
			: "The party is AWAY: if they don't get back before the dead arrive, the people inside face it alone and the engine resolves the night; tell it over the radio or let them find out when they return.",
	].join(" ");
}

/** The 08:00 probe was the vanguard: a big one turns into a siege that night. Returns the extra DM text, or undefined. */
export function probeSiege(state: GameState, rng: Rng, probe: number, at: number): string | undefined {
	if (probe < SIEGE.probeMin || (state.siege && state.siege.phase !== "over") || !baseMapOf(state)) return undefined;
	const horde = probe * 3 + rng.int(0, 6);
	// At dusk, or (when the dawn roll is processed late, after a long jump) with the usual warning.
	const b = baseOf(state)!;
	const arrivesAt = Math.max(Math.floor(at / 1440) * 1440 + SIEGE.dusk + rng.int(0, 90), Math.max(now(state), at) + warningMinutes(b));
	try {
		return startSiege(state, rng, { horde, source: "probe", arrivesAt, from: at });
	} catch {
		return undefined;
	}
}

// ─── prep ──────────────────────────────────────────────────────────────────

function requirePrep(state: GameState): SiegeState {
	const s = requireSiege(state);
	if (s.phase === "over") throw new Error("The siege is over.");
	return s;
}

/**
 * Puts a defender ("pc" or a companion) on a post: a barricade or an outer
 * door square of the base map. No position takes them off their post.
 */
export function assignPost(state: GameState, who: string, at?: { x: number; y: number }): string {
	const s = requirePrep(state);
	const map = baseMapOf(state);
	if (!map) throw new Error("The base has no map.");
	let id: string;
	if (who === "pc" || who === state.character.id || who.trim().toLowerCase() === state.character.name.toLowerCase()) {
		if (!partyAtBase(state)) throw new Error(`${state.character.name} isn't at the base.`);
		if (isDead(state.character) || state.character.hp <= 0) throw new Error(`${state.character.name} can't stand a post now.`);
		id = "pc";
	} else {
		const sv = findSurvivor(state, who);
		if (!sv) throw new Error(`No companion "${who}". Defenders: the player ("pc") and companions at the base${partyAtBase(state) ? " or with the party" : ""}.`);
		const why = sv.hp <= 0 ? "down" : sv.status === "with_party" ? "away with the party" : sv.status;
		if (!canDefend(state, sv)) throw new Error(`${nameOf(state, sv)} can't defend the base tonight (${why}).`);
		id = sv.npcId;
	}
	if (!at) {
		delete s.posts[id];
		siegeLog(s, `${whoName(state, id)} left their post.`);
		if (s.phase === "warning") s.phase = "prep";
		return `${whoName(state, id)} has no post now.`;
	}
	const key = barricadeKey(at.x, at.y);
	const entry = entryPoints(map, s).find((e) => e.key === key);
	if (!entry) {
		const list = entryPoints(map, s);
		throw new Error(`(${key}) isn't a way in: posts go on a barricade or a door to the outside. ${list.length ? `Posts: ${list.map((e) => `(${e.key}) ${e.kind}`).join(", ")}.` : "The base map has none."}`);
	}
	const there = Object.entries(s.posts).filter(([k, p]) => k !== id && barricadeKey(p.x, p.y) === key);
	if (there.length >= SIEGE.perPost) throw new Error(`(${key}) is already held by ${there.map(([k]) => whoName(state, k)).join(" and ")}: two at most at one post.`);
	s.posts[id] = { x: at.x, y: at.y };
	if (s.phase === "warning") s.phase = "prep";
	// Posted once the night has begun: they stand with the party too.
	const sv = state.group?.survivors[id];
	if (s.phase === "active" && sv?.status === "at_base" && partyAtBase(state)) {
		sv.status = "with_party";
		(s.joined ??= []).push(id);
	}
	siegeLog(s, `${whoName(state, id)} takes the ${entry.kind} at (${key}).`);
	return `${whoName(state, id)} guards the ${entry.kind} at (${key}) (${entry.hp}/${entry.max} HP).`;
}

/** Can the base light up tonight? */
export function lightsAvailable(state: GameState): { ok: boolean; why?: string } {
	const b = baseOf(state);
	if (!b?.upgrades.includes("generator")) return { ok: false, why: "there is no generator at the base" };
	if (!b.generatorOn && b.stock.fuel < 1) return { ok: false, why: "the generator has no fuel" };
	if (!state.siege?.lightsFueled && b.stock.fuel < 1) return { ok: false, why: "no fuel left in the stock for the lights (1 fuel a night)" };
	return { ok: true };
}

export function setLights(state: GameState, on: boolean): string {
	const s = requirePrep(state);
	if (on) {
		const ok = lightsAvailable(state);
		if (!ok.ok) throw new Error(`No lights: ${ok.why}.`);
	}
	s.lights = on;
	if (s.phase === "warning") s.phase = "prep";
	siegeLog(s, on ? "Lights ON: better aim, but the dead see the base." : "Lights OFF: dark, harder to aim, fewer of them drawn.");
	return on
		? `Lights ON (generator; 1 fuel tonight): defenders get +${SIEGE.lightsBonus} to hit and the hands through the gaps are easier to see, but every wave draws 1d4 more dead.`
		: "Lights OFF: the base stays dark; no extra dead drawn, no aiming bonus.";
}

// ─── the night ─────────────────────────────────────────────────────────────

/** The dead are at the walls: phase active. Companions on posts who live at the base stand with the party tonight. */
function beginNight(state: GameState): string[] {
	const s = requireSiege(state);
	const out: string[] = [];
	if (now(state) < s.arrivesAt) advanceClock(state, s.arrivesAt - now(state));
	s.phase = "active";
	if (partyAtBase(state)) {
		for (const id of Object.keys(s.posts)) {
			const sv = state.group?.survivors[id];
			if (sv?.status === "at_base") {
				sv.status = "with_party";
				(s.joined ??= []).push(id);
			}
		}
	}
	// Posts nobody can hold any more (left, down, away).
	for (const id of Object.keys(s.posts)) if (id !== "pc" && !canDefend(state, state.group?.survivors[id])) delete s.posts[id];
	if (!partyAtBase(state)) delete s.posts.pc;
	siegeLog(s, `${clock(now(state))}: the dead reach the walls.`);
	out.push(`The dead reach the walls of ${baseOf(state)?.name ?? "the base"} (${clock(now(state))}).`);
	return out;
}

interface Weapon {
	name: string;
	toHit: number;
	critOn: number;
	ammo?: string;
	item?: InventoryItem;
}

function pcWeapon(c: Character, kind: "ranged" | "melee"): Weapon | undefined {
	const profile = derivePcProfile(c);
	const items = [...c.inventory].filter((i) => i.weapon && (kind === "ranged" ? isRangedWeapon(i) : !isRangedWeapon(i))).sort((x, y) => Number(!!y.equipped) - Number(!!x.equipped));
	const item = items[0];
	if (!item && kind === "ranged") return undefined;
	const atk = pcAttackProfile(c, profile, item);
	return { name: atk.name, toHit: atk.toHit, critOn: atk.critOn ?? 20, ammo: item?.ref ? getEquipment(item.ref)?.ammo : undefined, item };
}

/** Rounds the player can fire: the base stock first, then rounds for that weapon in their inventory. */
function pcRounds(state: GameState, w: Weapon): number {
	const inv = w.ammo ? state.character.inventory.filter((i) => i.ref === w.ammo).reduce((n, i) => n + i.quantity, 0) : 0;
	return (baseOf(state)?.stock.ammo ?? 0) + inv;
}

function spendPcRound(state: GameState, w: Weapon): boolean {
	const b = baseOf(state);
	if (b && b.stock.ammo > 0) {
		b.stock.ammo -= 1;
		const bucket = b.items?.ammo;
		if (bucket) {
			// Keep the tracked rounds within the stock (takeFromStash trims the same way).
			let tracked = Object.values(bucket).reduce((n, k) => n + k, 0);
			for (const ref of Object.keys(bucket)) {
				while (tracked > b.stock.ammo && bucket[ref] > 0) {
					bucket[ref] -= 1;
					tracked -= 1;
				}
				if (!bucket[ref]) delete bucket[ref];
			}
		}
		return true;
	}
	const it = w.ammo ? state.character.inventory.find((i) => i.ref === w.ammo && i.quantity > 0) : undefined;
	if (!it) return false;
	it.quantity -= 1;
	if (it.quantity <= 0) state.character.inventory = state.character.inventory.filter((i) => i !== it);
	return true;
}

/** What the player can do this wave (UI and errors). */
export function pcOptions(state: GameState): Record<PcSiegeAction, { ok: boolean; why?: string }> {
	const s = state.siege;
	const at = partyAtBase(state);
	const post = s?.posts.pc;
	const map = baseMapOf(state);
	const entry = post && map ? entryPoints(map, s).find((e) => e.key === barricadeKey(post.x, post.y)) : undefined;
	const gun = pcWeapon(state.character, "ranged");
	const base = baseOf(state);
	const no = (why: string) => ({ ok: false, why });
	if (!at) return { shoot: no("not at the base"), hack: no("not at the base"), repair: no("not at the base"), hold: no("not at the base") };
	return {
		shoot: !gun ? no("no ranged weapon") : pcRounds(state, gun) <= 0 ? no("no ammunition (stock or inventory)") : { ok: true },
		hack: { ok: true },
		repair: (base?.stock.materials ?? 0) < 1 ? no("no materials in the stock") : !post || !entry ? no("no post") : { ok: true },
		hold: { ok: true },
	};
}

export interface WaveArgs {
	action?: PcSiegeAction;
	/** The player moves to another post first (costs one attack, halves a repair). */
	moveTo?: { x: number; y: number };
}

export interface WaveResult {
	text: string;
	/** The dead broke in: the caller starts the fight (or tells the DM to). */
	breach?: { x: number; y: number; spawn: { monster: string; count: number; x: number; y: number }[]; dead: number };
	over: boolean;
	/** The first wave of the night (the DM narrates the arrival). */
	first: boolean;
}

const SHAMBLER = () => getMonster("z-shambler") as MonsterStats | undefined;

/** Shamblers that fit the solo budget (at least 1, at most `dead`). */
export function breachSpawnCount(state: GameState, dead: number): number {
	const cap = budgetCap(pcLevel(state), (state.settings.structure?.difficulty ?? "normal") as Difficulty);
	const xp = SHAMBLER()?.xp ?? 50;
	let n = 1;
	while (n < dead && (n + 1) * xp * soloMultiplier(n + 1) <= cap) n++;
	return Math.max(1, Math.min(n, Math.max(1, dead)));
}

/**
 * Settles a breach whose fight is over (end_combat cleared the encounter, so
 * the bodies are corpses): contained when the player is still standing; the gap
 * is jammed shut with whatever is at hand. `force` settles it regardless (the night ends).
 */
export function settleBreach(state: GameState, contained?: boolean, force = false): string | undefined {
	const s = state.siege;
	const br = s?.breach;
	if (!s || !br) return undefined;
	if (state.encounter && !force) return undefined;
	const held = contained ?? (state.character.hp > 0 && !isDead(state.character));
	const map = baseMapOf(state);
	const squares = [{ x: br.x, y: br.y }, ...(br.more ?? [])];
	(s.breaches ??= []).push(...squares.map((q) => ({ ...q, contained: held })));
	delete s.breach;
	if (held && map) {
		for (const q of squares) {
			const i = q.y * map.width + q.x;
			if (map.entities.some((e) => !e.dead && e.x === q.x && e.y === q.y && e.kind !== "item" && e.kind !== "light" && e.kind !== "feature")) continue;
			map.tiles[i] = "barricade";
			map.barricades = { ...(map.barricades ?? {}), [barricadeKey(q.x, q.y)]: { hp: 8, max: 15 } };
			delete s.doors?.[barricadeKey(q.x, q.y)];
		}
		siegeLog(s, `The breach at (${br.x},${br.y}) was held and jammed shut (8/15).`);
		return `SIEGE: the breach at (${br.x},${br.y}) is CONTAINED; the gap is jammed with a table and a mattress (barricade 8/15). ${s.wave >= s.waves || s.horde <= 0 ? "That was the last of them." : `~${s.horde} dead still outside, wave ${s.wave}/${s.waves} done: the player holds the line again on the Siege panel.`}`;
	}
	siegeLog(s, `The breach at (${br.x},${br.y}) could not be held.`);
	return `SIEGE: the breach at (${br.x},${br.y}) was NOT contained: the dead are inside.`;
}

/** Defenders (pc and companions) at each post key who can act. */
function postsByKey(state: GameState, s: SiegeState): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [id, p] of Object.entries(s.posts)) {
		if (id === "pc" ? !partyAtBase(state) || state.character.hp <= 0 : !canDefend(state, state.group?.survivors[id])) continue;
		const k = barricadeKey(p.x, p.y);
		out.set(k, [...(out.get(k) ?? []), id]);
	}
	return out;
}

/**
 * Resolves one wave. The horde pressure (its night share: start ÷ waves) spreads
 * over the ways in; defenders drop the dead at their posts before they hit; a
 * guarded way in takes half; the building's structure soaks a little. A way in
 * at 0 HP is a breach.
 */
export function resolveWave(state: GameState, rng: Rng, record: RecordRoll, a: WaveArgs = {}): WaveResult {
	const s = requireSiege(state);
	if (s.phase === "over") throw new Error("The siege is over.");
	if (state.encounter?.status === "active" && partyAtBase(state)) throw new Error("Finish the fight first.");
	if (s.breach) throw new Error(`The dead broke in at (${s.breach.x},${s.breach.y}): that fight comes first.`);
	const b = baseOf(state);
	const map = baseMapOf(state);
	if (!b || !map) throw new Error("The base or its map is gone.");
	const out: string[] = [];
	const first = s.phase !== "active";
	if (first) out.push(...beginNight(state));
	const stats = (s.stats ??= freshStats());
	const c = state.character;
	const here = partyAtBase(state);

	// The player's move happens before the wave.
	let moved = false;
	if (a.moveTo && here) {
		out.push(assignPost(state, "pc", a.moveTo));
		moved = true;
	}

	s.wave += 1;
	const W = s.wave;
	const bonus = s.lights ? SIEGE.lightsBonus : 0;
	if (s.lights && !s.lightsFueled) {
		if (b.stock.fuel >= 1) {
			b.stock.fuel -= 1;
			s.lightsFueled = true;
			out.push("The generator coughs and the floodlights come on (1 fuel).");
		} else {
			s.lights = false;
			out.push("No fuel for the lights: they stay dark.");
		}
	}
	if (s.lights) {
		const drawn = rng.die(4);
		s.horde += drawn;
		stats.drawn += drawn;
		out.push(`The lights draw ${drawn} more dead out of the dark.`);
	}
	// Steady pressure: the night's share of the whole horde comes at the walls each wave (the ones not
	// put down fall back and come again), so the last wave isn't the whole horde at once.
	const attackers = Math.min(s.horde, Math.ceil((s.hordeStart + stats.drawn) / s.waves));
	let entries = entryPoints(map, s);
	const atEntry = new Map<string, number>();
	if (entries.length) for (let i = 0; i < attackers; i++) {
		const e = rng.pick(entries);
		atEntry.set(e.key, (atEntry.get(e.key) ?? 0) + 1);
	}
	const posts = postsByKey(state, s);
	const killsAt = new Map<string, number>();
	const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
	let pcKills = 0;
	let allyKills = 0;
	const pcPost = here && s.posts.pc ? barricadeKey(s.posts.pc.x, s.posts.pc.y) : undefined;
	const lines: string[] = [];

	// ── the player (first, and with the most dice) ──
	if (pcPost && c.hp > 0) {
		const profile = derivePcProfile(c);
		let action: PcSiegeAction = a.action ?? "hold";
		const opts = pcOptions(state);
		if (!opts[action].ok) throw new Error(`Can't ${action}: ${opts[action].why}.`);
		const rolls = Math.max(1, 2 + profile.attacksPerAction - (moved ? 1 : 0));
		const there = atEntry.get(pcPost) ?? 0;
		if (action === "repair") {
			const entry = entries.find((e) => e.key === pcPost);
			if (!entry) action = "hold";
			else {
				b.stock.materials -= 1;
				stats.materials += 1;
				const r = roll(rng, moved ? SIEGE.repairMoved : SIEGE.repair, { label: `Siege wave ${W}: ${c.name} shores up (${pcPost})`, actor: c.id });
				record(r);
				if (entry.kind === "barricade") {
					const bar = map.barricades?.[pcPost] ?? { hp: entry.hp, max: entry.max };
					const hp = Math.min(bar.max, bar.hp + r.total);
					stats.pcSaved += hp - bar.hp;
					map.barricades = { ...(map.barricades ?? {}), [pcPost]: { hp, max: bar.max } };
					lines.push(`${c.name} nails planks over the (${pcPost}) barricade: ${bar.hp} → ${hp}/${bar.max}.`);
				} else {
					// Boarding up a door turns it into a plank barricade.
					const hp = Math.min(25, entry.hp + r.total);
					stats.pcSaved += hp - entry.hp;
					map.tiles[entry.y * map.width + entry.x] = "barricade";
					map.barricades = { ...(map.barricades ?? {}), [pcPost]: { hp, max: 25 } };
					delete s.doors?.[pcPost];
					lines.push(`${c.name} boards up the door at (${pcPost}): it is a barricade now, ${hp}/25.`);
				}
				entries = entryPoints(map, s);
			}
		}
		if (action === "shoot" || action === "hack" || action === "hold") {
			const ranged = action === "shoot";
			const w = pcWeapon(c, ranged ? "ranged" : "melee")!;
			const n = action === "hold" ? 1 : rolls;
			let fired = 0;
			for (let i = 0; i < n; i++) {
				if (ranged && !spendPcRound(state, w)) break;
				if (ranged) fired++;
				const r = roll(rng, `1d20${signed(w.toHit + bonus)}`, { label: `Siege wave ${W}: ${c.name}, ${w.name} (${pcPost})`, target: ranged ? SIEGE.dcRanged : SIEGE.dcMelee, actor: c.id, attack: true, critOn: w.critOn });
				record(r);
				if (r.success) pcKills += r.critical === "hit" ? 2 : 1;
			}
			stats.ammo += fired;
			lines.push(`${c.name} ${ranged ? `fires ${fired} round(s) from the ${w.name}` : action === "hold" ? `holds the (${pcPost}) post with the ${w.name}` : `hacks through the gaps with the ${w.name}`}: ${pcKills} of the dead drop.`);
			// Melee through the gaps: hands, teeth.
			if (!ranged && there > 0) lines.push(...pcGrabbed(state, rng, record, there, bonus, W));
		}
		add(killsAt, pcPost, pcKills);
	} else if (here) lines.push(`${c.name} has no post this wave (set one on the Siege panel).`);

	// ── the companions (one roll each, within the ally cap; never far ahead of the player) ──
	let room = allyCap(pcLevel(state));
	const allowed = () => Math.max(0, stats.pcKills + pcKills + SIEGE.allyEdge - stats.allyKills - allyKills);
	const defenders = [...posts.entries()].flatMap(([k, ids]) => ids.filter((id) => id !== "pc").map((id) => ({ k, sv: state.group!.survivors[id] })));
	defenders.sort((x, y) => x.sv.joinedAt - y.sv.joinedAt);
	for (const { k, sv } of defenders) {
		const name = nameOf(state, sv);
		const xp = survivorXp(sv.level);
		if (xp > room) {
			lines.push(`${name} braces the (${k}) ${entries.find((e) => e.key === k)?.kind ?? "post"} and passes ammo (no shot of their own: the player stays the one who turns the night).`);
			continue;
		}
		room -= xp;
		const gun = sv.gear.map((g) => getEquipment(g.ref)).find((e) => e?.weapon?.ranged && e.ammo);
		const own = gun ? sv.gear.filter((g) => g.ref === gun.ammo).reduce((n, g) => n + g.qty, 0) : 0;
		const shoots = !!gun && (b.stock.ammo > 0 || own > 0);
		const block = survivorStatBlock(shoots && !own ? { ...sv, gear: [...sv.gear, { ref: gun!.ammo!, qty: 1 }] } : sv, name);
		const atk = block.actions.map((x) => x.attack).find((x) => x?.kind === (shoots ? "ranged" : "melee"));
		if (!atk) continue;
		if (shoots) {
			if (b.stock.ammo > 0) {
				b.stock.ammo -= 1;
				stats.ammo += 1;
			} else {
				const g = sv.gear.find((x) => x.ref === gun!.ammo && x.qty > 0)!;
				g.qty -= 1;
				sv.gear = sv.gear.filter((x) => x.qty > 0);
			}
		}
		const r = roll(rng, `1d20${signed(atk.toHit + bonus)}`, { label: `Siege wave ${W}: ${name}, ${atk.name} (${k})`, target: shoots ? SIEGE.dcRanged : SIEGE.dcMelee, actor: sv.npcId, attack: true });
		record(r);
		if (r.success) {
			const k2 = Math.min(r.critical === "hit" ? 2 : 1, allowed());
			if (k2 > 0) {
				allyKills += k2;
				add(killsAt, k, k2);
				lines.push(`${name} drops ${k2 === 1 ? "one" : "two"} at (${k}).`);
			} else {
				// They help, but the night is the player's: a hit shoves one back instead.
				atEntry.set(k, Math.max(0, (atEntry.get(k) ?? 0) - 1));
				lines.push(`${name} shoves one back from the (${k}) gap.`);
			}
		} else lines.push(`${name} misses at (${k}).`);
		if (!shoots && (atEntry.get(k) ?? 0) > 0) lines.push(...companionGrabbed(state, rng, record, sv, atEntry.get(k) ?? 0, bonus));
	}

	// ── the dead hit the ways in ──
	const damage: Record<string, number> = {};
	const fell: Entry[] = [];
	let breachDead = 0;
	const structure = b.structure ?? 0;
	for (const e of entries) {
		const n = atEntry.get(e.key) ?? 0;
		if (!n) continue;
		const left = Math.max(0, n - (killsAt.get(e.key) ?? 0));
		const guards = posts.get(e.key) ?? [];
		let raw = 0;
		if (left) {
			const r = roll(rng, `${left}d3`, { label: `Siege wave ${W}: ${left} dead batter (${e.key})`, actor: "dm" });
			record(r);
			raw = r.total;
		}
		const guarded = guards.length > 0;
		const after = Math.max(0, (guarded ? Math.floor(raw / 2) : raw) - structure);
		const saved = raw - after;
		if (guarded && saved > 0) {
			if (guards.includes("pc")) stats.pcSaved += saved;
			else stats.allySaved += saved;
		}
		damage[e.key] = after;
		if (!after) continue;
		if (e.kind === "barricade") {
			const res = damageBarricadeOn(map, { x: e.x, y: e.y, amount: after });
			if (res.destroyed) {
				fell.push(e);
				breachDead += left;
			}
		} else {
			const d = (s.doors ??= {})[e.key] ?? { hp: e.hp, max: e.max };
			d.hp = Math.max(0, d.hp - after);
			s.doors[e.key] = d;
			if (d.hp <= 0) {
				map.tiles[e.y * map.width + e.x] = "door_open";
				delete s.doors[e.key];
				fell.push(e);
				breachDead += left;
			}
		}
	}
	// No way in at all: they walk in.
	if (!entries.length && attackers > 0) {
		fell.push({ key: barricadeKey(map.entry.x, map.entry.y), x: map.entry.x, y: map.entry.y, kind: "door", hp: 0, max: 0 });
		breachDead = attackers;
	}

	const kills = Math.min(s.horde, pcKills + allyKills);
	s.horde = Math.max(0, s.horde - kills);
	stats.pcKills += Math.min(pcKills, kills);
	stats.allyKills += Math.max(0, kills - Math.min(pcKills, kills));
	s.last = { wave: W, pcKills, allyKills, damage };
	const hits = Object.entries(damage)
		.filter(([, d]) => d > 0)
		.map(([k, d]) => {
			const e = entryPoints(map, s).find((x) => x.key === k);
			return `(${k}) -${d}${e ? ` → ${e.hp}/${e.max}` : " → GONE"}`;
		});
	siegeLog(s, `Wave ${W}/${s.waves}: ${attackers} came; ${c.name} dropped ${pcKills}, the others ${allyKills}; ${hits.join(", ") || "the walls held"}. ~${s.horde} left.`);
	out.push(`WAVE ${W}/${s.waves} (${attackers} of ~${s.horde + kills} dead hit the walls${s.lights ? ", lights on" : ", dark"}):`, ...lines, `Walls: ${hits.join(", ") || "no damage"}.`, `~${s.horde} dead left outside.`);

	let breach: WaveResult["breach"];
	if (fell.length) {
		const [f, ...more] = fell;
		const dead = Math.max(1, Math.min(s.horde, breachDead));
		s.breach = { x: f.x, y: f.y, at: now(state), dead, ...(more.length ? { more: more.map((e) => ({ x: e.x, y: e.y })) } : {}) };
		const count = breachSpawnCount(state, dead);
		s.horde = Math.max(0, s.horde - count);
		breach = { x: f.x, y: f.y, dead, spawn: [{ monster: "z-shambler", count, x: f.x, y: f.y }] };
		siegeLog(s, `BREACH at (${f.x},${f.y}): ${count} dead pour in.`);
		out.push(`BREACH: the ${f.kind} at (${f.key}) gives way${more.length ? ` (and ${more.map((e) => `(${e.key})`).join(", ")})` : ""}: ${count} dead pour in.`);
	}
	advanceClock(state, SIEGE.waveMinutes);
	let over = false;
	if (!s.breach && (s.horde <= 0 || s.wave >= s.waves)) {
		out.push(endSiege(state, rng, record));
		over = true;
	}
	return { text: out.join("\n"), breach, over, first };
}

function pcGrabbed(state: GameState, rng: Rng, record: RecordRoll, there: number, bonus: number, W: number): string[] {
	const c = state.character;
	const dc = 8 + Math.min(6, there) - bonus;
	const save = derivePcProfile(c).saveBonuses.dex ?? abilityMod(c.abilities.dex);
	const r = roll(rng, `1d20${signed(save)}`, { label: `Siege wave ${W}: hands through the gaps (DEX save)`, target: dc, actor: c.id });
	record(r);
	if (r.success) return [];
	// A natural 1 with a crowd at the gap (3+): teeth, not just hands.
	const bite = r.dice.find((d) => d.sides === 20 && !d.dropped)?.value === 1 && there >= 3;
	const out: string[] = [];
	const d = roll(rng, bite ? "1d6" : "1d4", { label: bite ? "Bite through the boards" : "Clawed through the gaps", actor: "dm" });
	record(d);
	const res = applyDamage(c, d.total, { type: bite ? "piercing" : "slashing" });
	state.character = res.character;
	out.push(`Hands catch ${c.name} through the gap (DEX save ${r.total} vs DC ${dc}): ${res.applied} damage, HP ${res.character.hp}/${res.character.maxHp}.${res.character.hp <= 0 ? " DOWN at 0 HP: the others drag them back (death saves)." : ""}`);
	(state.siege!.stats ??= freshStats()).hurt.push(c.name);
	if (bite) {
		const note = infectionSave(state, rng, record, { monster: SHAMBLER(), attack: "a bite through the boards" });
		if (note) out.push(`BITTEN: ${note}`);
		state.siege!.stats!.bitten.push(c.name);
	}
	return out;
}

function companionGrabbed(state: GameState, rng: Rng, record: RecordRoll, sv: Survivor, there: number, bonus: number): string[] {
	const name = nameOf(state, sv);
	const dc = 8 + Math.min(6, there) - bonus;
	const dex = abilityMod(survivorAbilities(sv.profession).dex);
	const r = roll(rng, `1d20${signed(dex)}`, { label: `${name}: hands through the gaps (DEX save)`, target: dc, actor: sv.npcId });
	record(r);
	if (r.success) return [];
	const bite = r.dice.find((d) => d.sides === 20 && !d.dropped)?.value === 1 && there >= 3;
	const d = roll(rng, "1d4", { label: `${name}: clawed through the gaps`, actor: "dm" });
	record(d);
	sv.hp = Math.max(0, sv.hp - d.total);
	const stats = (state.siege!.stats ??= freshStats());
	stats.hurt.push(name);
	const out = [`${name} is grabbed through the gap: ${d.total} damage (HP ${sv.hp}/${sv.maxHp})${sv.hp <= 0 ? ", DOWN: dragged back from the post" : ""}.`];
	if (bite) {
		out.push(`BITTEN: ${survivorBitten(state, rng, record, sv, { monster: SHAMBLER(), attack: "a bite through the boards" })}`);
		stats.bitten.push(name);
	}
	return out;
}

// ─── the end ───────────────────────────────────────────────────────────────

/** Residents lost to breaches nobody contained (taken from the last listed, one person at a time). */
function loseResidents(state: GameState, n: number): string[] {
	const b = baseOf(state);
	const out: string[] = [];
	if (!b?.residents?.length || n <= 0) return out;
	for (let i = 0; i < n && b.residents.length; i++) {
		const r = b.residents[b.residents.length - 1];
		if (r.headcount > 1) {
			r.headcount -= 1;
			out.push(`one of ${r.name}`);
		} else {
			b.residents.pop();
			out.push(r.name);
		}
	}
	return out;
}

/** Ends the night: the summary for the DM, residents, morale, the town horde. */
export function endSiege(state: GameState, rng: Rng, record: RecordRoll, outcome?: SiegeState["outcome"]): string {
	void rng;
	void record;
	const s = requireSiege(state);
	if (s.phase === "over") return s.summary ?? "The siege is over.";
	const b = baseOf(state);
	const stats = (s.stats ??= freshStats());
	if (s.breach) settleBreach(state, false, true);
	const lostBreaches = (s.breaches ?? []).filter((x) => !x.contained);
	const result: NonNullable<SiegeState["outcome"]> = outcome ?? (lostBreaches.length ? "breached" : "held");
	// The dead inside: one resident per breach nobody held, plus one per 15 of the dead still out there.
	const lost = result === "breached" ? loseResidents(state, Math.min(residentHeadcount(state), lostBreaches.length + Math.floor(s.horde / 15))) : [];
	stats.residentsLost = lost.length;
	// Morale: a held night binds the group; a broken one shakes it.
	const group = Object.values(state.group?.survivors ?? {}).filter((sv) => sv.status === "at_base" || sv.status === "with_party");
	const delta = result === "held" ? 1 : -1 - (lost.length ? 1 : 0);
	for (const sv of group) adjustMorale(sv, delta);
	// Companions who stood with the party go back to living at the base.
	for (const id of s.joined ?? []) {
		const sv = state.group?.survivors[id];
		if (sv?.status === "with_party") sv.status = "at_base";
	}
	delete s.joined;
	// The town horde is what's left of it; it drifts on.
	const h = s.hordeId ? state.town?.hordes.find((x) => x.id === s.hordeId) : undefined;
	if (h && state.town) {
		h.size = s.horde;
		h.nextMoveAt = Math.min(h.nextMoveAt, now(state) + 6 * 60);
		state.town.hordes = state.town.hordes.filter((x) => x.size > 0);
	}
	s.phase = "over";
	s.outcome = result;
	s.endedAt = now(state);
	const c = state.character;
	const total = stats.pcKills + stats.allyKills;
	const map = baseMapOf(state);
	const walls = map ? entryPoints(map, s).map((e) => `(${e.key}) ${e.hp}/${e.max}`).join(", ") : "";
	const summary = [
		`SIEGE OVER at ${b?.name ?? "the base"} (${clock(now(state))}): ${result === "held" ? "THE BASE HELD" : result === "fled" ? "THEY FLED" : "THE BASE WAS BREACHED"}.`,
		`The dead: ~${s.hordeStart}${stats.drawn ? ` (+${stats.drawn} drawn by the lights)` : ""} came, ${total} were put down, ~${s.horde} ${s.horde ? "drift off at first light" : "left: none"}. ${c.name} put down ${stats.pcKills} and saved ${stats.pcSaved} HP of wall${stats.pcSaved ? "" : "s"}; the companions ${stats.allyKills} (and ${stats.allySaved} HP).`,
		`Spent: ${stats.ammo} rounds, ${stats.materials} materials${s.lightsFueled ? ", 1 fuel for the lights" : ""}. Walls now: ${walls || "none"}.`,
		(s.breaches ?? []).length ? `Breaches: ${(s.breaches ?? []).map((x) => `(${x.x},${x.y}) ${x.contained ? "contained" : "NOT contained"}`).join(", ")}.` : "No breach.",
		lost.length ? `Residents lost: ${lost.join(", ")} (taken off the list).` : "",
		stats.hurt.length ? `Hurt: ${[...new Set(stats.hurt)].join(", ")}.` : "",
		stats.bitten.length ? `Bitten: ${[...new Set(stats.bitten)].join(", ")} (the engine rolled the infection; keep it secret if it took).` : "",
		`Morale ${delta > 0 ? "+1" : delta} for the companions at the base.`,
		`DM: narrate the dawn (or the aftermath) in a short paragraph: what ${c.name} did that turned the night (their post, their shots, the planks they nailed), the bodies against the walls, who is hurt, who is missing. Then close it with end_siege.`,
	]
		.filter(Boolean)
		.join(" ");
	s.summary = summary;
	siegeLog(s, `Over: ${result}.`);
	return summary;
}

/**
 * Nobody holds the line interactively (the party is away, or time jumped past
 * the night): the engine plays the remaining waves. A breach with the player
 * at the base is fought off (contained, at a cost); without them it isn't.
 */
export function autoResolve(state: GameState, rng: Rng, record: RecordRoll): string {
	const s = requireSiege(state);
	const out: string[] = [];
	const map = baseMapOf(state);
	if (!partyAtBase(state) && map) {
		// Companions at the base take the ways in themselves.
		const entries = entryPoints(map, s);
		const free = Object.values(state.group?.survivors ?? {}).filter((sv) => sv.status === "at_base" && sv.hp > 0 && !s.posts[sv.npcId]);
		free.forEach((sv, i) => {
			if (entries.length) s.posts[sv.npcId] = { x: entries[i % entries.length].x, y: entries[i % entries.length].y };
		});
	}
	let guard = 0;
	while (state.siege && state.siege.phase !== "over" && guard++ < 12) {
		if (s.breach) {
			const fought = partyAtBase(state) && state.character.hp > 0;
			if (fought) {
				const d = roll(rng, "2d6", { label: "Fighting off the breach in the dark", actor: "dm" });
				record(d);
				const res = applyDamage(state.character, d.total, { type: "slashing" });
				state.character = res.character;
				out.push(`The breach is fought off in the dark: ${state.character.name} takes ${res.applied} damage.`);
			}
			out.push(settleBreach(state, fought) ?? "");
			if (!fought) {
				out.push(endSiege(state, rng, record, "breached"));
				break;
			}
			if (s.horde <= 0 || s.wave >= s.waves) {
				out.push(endSiege(state, rng, record));
				break;
			}
			continue;
		}
		const r = resolveWave(state, rng, record, { action: "hold" });
		out.push(r.text);
		if (r.over) break;
	}
	return out.filter(Boolean).join("\n");
}

/** Closes a finished siege (the DM narrated it), or calls one off (the party fled, the dead turned away). */
export function closeSiege(state: GameState, rng: Rng, record: RecordRoll, a: { outcome?: "fled" | "held"; reason?: string } = {}): string {
	const s = requireSiege(state);
	if (state.encounter?.status === "active") throw new Error("Finish the fight first.");
	let text = "";
	if (s.phase !== "over") {
		if (!a.reason?.trim()) throw new Error(`The siege is still on (${s.phase}, wave ${s.wave}/${s.waves}, ~${s.horde} dead). To call it off, give a reason (outcome fled: the party abandoned the base; held: the dead turned away).`);
		siegeLog(s, `Called off: ${a.reason.trim()}.`);
		text = endSiege(state, rng, record, a.outcome ?? "held");
	}
	delete state.siege;
	return `${text}${text ? "\n" : ""}Siege closed.`;
}

/** Runs after every tool: the dead arrive, breaches settle, the night auto-resolves when nobody is there, old sieges clear. */
export function siegeTick(state: GameState, rng: Rng, record: RecordRoll = () => undefined): string | undefined {
	try {
		return tickSiege(state, rng, record);
	} catch (error) {
		// Never break the tool that triggered the tick.
		return `SIEGE engine note: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function tickSiege(state: GameState, rng: Rng, record: RecordRoll): string | undefined {
	const s = state.siege;
	if (!s || !isZombie(state)) return undefined;
	const t = now(state);
	if (s.phase === "over") {
		if (t - (s.endedAt ?? t) >= SIEGE.clearAfter) delete state.siege;
		return undefined;
	}
	if (!baseOf(state) || !baseMapOf(state)) {
		delete state.siege;
		return "SIEGE called off: there is no base (or no base map) any more.";
	}
	const out: string[] = [];
	// The DM started the breach fight themselves (the engine couldn't): it counts.
	if (s.breach && !s.breach.combat && state.encounter?.status === "active" && partyAtBase(state)) s.breach.combat = true;
	if (s.breach?.combat && !state.encounter) {
		const note = settleBreach(state);
		if (note) out.push(note);
		if (!s.breaches?.at(-1)?.contained) out.push(endSiege(state, rng, record, "breached"));
		else if (s.horde <= 0 || s.wave >= s.waves) out.push(endSiege(state, rng, record));
	}
	if (state.siege?.phase === "warning" || state.siege?.phase === "prep") {
		if (t >= s.arrivesAt) {
			if (!partyAtBase(state)) out.push(`SIEGE (the party is away): the dead hit ${baseOf(state)!.name} and those inside face them alone.`, autoResolve(state, rng, record));
			else if (state.encounter?.status !== "active") {
				out.push(...beginNight(state));
				out.push("SIEGE — THE DEAD ARE AT THE WALLS. The player holds the line wave by wave on the Siege panel; narrate the first blows on the barricades, briefly, and let them act.");
			}
		}
	} else if (state.siege?.phase === "active" && !state.siege.breach && state.encounter?.status !== "active") {
		if (!partyAtBase(state)) out.push(`SIEGE: the party left ${baseOf(state)!.name} in the middle of the night; those inside face the rest alone.`, autoResolve(state, rng, record));
		else if (t >= s.arrivesAt + s.waves * SIEGE.waveMinutes + 180) out.push("SIEGE: the night passed without anyone holding the line; the engine played the rest.", autoResolve(state, rng, record));
	}
	return out.filter(Boolean).join("\n") || undefined;
}

// ─── digest ────────────────────────────────────────────────────────────────

/** "SIEGE:" line for the DM digest. */
export function siegeDigest(state: GameState): string | undefined {
	const s = state.siege;
	if (!s) return undefined;
	const map = baseMapOf(state);
	const t = now(state);
	const walls = map ? entryPoints(map, s).map((e) => `(${e.key}) ${e.kind} ${e.hp}/${e.max}`).join(", ") : "";
	const posts = Object.entries(s.posts).map(([id, p]) => `${whoName(state, id)} @(${p.x},${p.y})`).join(", ");
	if (s.phase === "over") return `SIEGE OVER (${s.outcome}): ${s.summary ?? ""} Close it with end_siege once narrated.`;
	const phase =
		s.phase === "warning"
			? `WARNING (new: play the warning if you haven't; the dead arrive ${clock(s.arrivesAt)}, ${Math.max(0, s.arrivesAt - t)} min from now)`
			: s.phase === "prep"
				? `PREP (the player is setting the defence; the dead arrive ${clock(s.arrivesAt)}, ${Math.max(0, s.arrivesAt - t)} min)`
				: `ACTIVE, wave ${s.wave}/${s.waves}${s.breach ? `, BREACH at (${s.breach.x},${s.breach.y})${s.breach.combat ? " (fight on)" : " — start_combat with the dead there, or siege_wave breach=contained/lost"}` : ""}`;
	return `SIEGE ${phase}: ~${s.horde}/${s.hordeStart} dead outside; lights ${s.lights ? "ON" : "off"}; posts: ${posts || "nobody posted"}; ways in: ${walls || "none"}. The engine resolves the waves (the player's Hold the line, or siege_wave); you narrate the arrival, breaches and the end, not every wave.`;
}
