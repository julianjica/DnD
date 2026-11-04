import type { ConditionId, DamageType, GameState } from "../../game/types";
import type { Rng } from "../../rules/dice";
import {
	addMonsters,
	applyConditionTo,
	applyDamageTo,
	autoMonsterTurn,
	endCombat,
	endTurn,
	healTo,
	monsterAct,
	removeCombatant,
	removeConditionFrom,
	startCombat,
	type MonsterSpawn,
} from "../../rules/combat";
import { monsterForCampaign } from "../content";
import { placeEntity, revealAround } from "../../maps";
import { SIGHT_RADIUS } from "./map";
import { checkBudget } from "../../rules/encounter-budget";
import { applyCombatResult, combatOpts, combatState, isPcTurn, playerCombatAction } from "../combat";
import { describeSeparation, separation, where } from "../mapsync";
import { findPath, hasLineOfSight, reachable } from "../../rules/combat";
import type { Encounter, GridMap } from "../../game/types";
import { S, newId, tool, withState, type StateTxn, type ToolFactory } from "../context";
import { applyDamageToCharacter, healCharacter } from "../derived";
import { linkSurvivorCombatants, survivorForCombatant, survivorsAfterCombat, survivorsForCombat, survivorSpawn } from "../../rules/group";
import { isZombie } from "../../rules/survival";

const CONDITIONS: ConditionId[] = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"];
const DAMAGE: DamageType[] = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

interface SpawnArg {
	monster: string;
	count?: number;
	name?: string;
	x?: number;
	y?: number;
	entityId?: string;
	hidden?: boolean;
	surprised?: boolean;
	side?: "enemy" | "neutral" | "party";
	npcId?: string;
}

const spawnSchema = S.arr(
	S.obj(
		{
			monster: S.str("Monster index from lookup_srd, e.g. 'goblin', 'wolf' (fantasy) or 'z-shambler', 'z-raider-thug' (zombie)"),
			count: S.int(undefined, 1, 20),
			name: S.str("Custom display name (e.g. an NPC's name)"),
			x: S.int("Place near this square"),
			y: S.int(),
			entityId: S.str("Use an existing map token (placed with place_entity)"),
			hidden: S.bool(),
			surprised: S.bool(),
			side: S.str(undefined, ["enemy", "neutral", "party"]),
			npcId: S.str("Link to a codex NPC"),
		},
		["monster"],
	),
);

function toSpawns(state: GameState, args: SpawnArg[]): MonsterSpawn[] {
	const out: MonsterSpawn[] = [];
	for (const a of args) {
		// Only this campaign's ruleset; in The Quiet only the variants of the dead that exist by now.
		const stats = monsterForCampaign(state, a.monster);
		for (let i = 0; i < (a.count ?? 1); i++) {
			out.push({
				stats,
				...(a.entityId && i === 0 ? { entityId: a.entityId } : {}),
				...(a.name ? { name: (a.count ?? 1) > 1 ? `${a.name} ${i + 1}` : a.name } : {}),
				...(a.x !== undefined && a.y !== undefined ? { near: { x: a.x, y: a.y } } : {}),
				...(a.hidden ? { hidden: true } : {}),
				...(a.surprised ? { surprised: true } : {}),
				side: a.side ?? "enemy",
				...(a.npcId ? { kind: "npc" as const, refId: a.npcId } : {}),
			});
		}
	}
	if (!state.activeMapId) throw new Error("No active map. Call generate_map first.");
	return out;
}

/** A spawn the DM linked to a survivor (npcId) fights as that survivor: their stat block, HP and side. */
function survivorsAsThemselves(state: GameState, spawns: MonsterSpawn[]): MonsterSpawn[] {
	if (!isZombie(state) || !state.group) return spawns;
	const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	return spawns.map((s) => {
		const sv = s.kind === "npc" && s.refId ? state.group!.survivors[s.refId] : undefined;
		if (!sv || sv.status !== "with_party" || !map) return s;
		const own = survivorSpawn(state, sv, map);
		return { ...s, stats: own.stats, hp: sv.hp, side: "party", name: own.name, ...(s.entityId || s.near || s.position ? {} : own.entityId ? { entityId: own.entityId } : own.near ? { near: own.near } : {}) };
	});
}

/** start_combat in The Quiet: survivors with the party join automatically (within the ally cap); the rest hang back. */
function withSurvivors(state: GameState, map: GridMap, spawns: MonsterSpawn[]): { spawns: MonsterSpawn[]; note: string } {
	if (!isZombie(state) || !state.group) return { spawns, note: "" };
	const own = survivorsAsThemselves(state, spawns);
	// Listed by the DM: companions fighting as themselves; a turned one comes back as the dead and doesn't count.
	const listed = new Set(own.filter((s) => s.kind === "npc" && s.refId && s.side === "party" && state.group!.survivors[s.refId]?.status === "with_party").map((s) => s.refId!));
	const alliesXp = own.filter((s) => s.side === "party").reduce((n, s) => n + (s.stats.xp ?? 0), 0);
	const { spawns: joined, held } = survivorsForCombat(state, map, alliesXp, listed);
	const names = [...joined.map((s) => `${s.name} [${s.id}]`), ...[...listed].map((id) => state.npcs[id]?.name ?? id)];
	const note = [
		names.length ? `\nCompanions fighting beside the player (side party): ${names.join(", ")}. On their turns YOU play them with monster_turn (they act like the people they are: scared, brave, loyal).` : "",
		held.length ? `\nNot fighting: ${held.join("; ")}.` : "",
	].join("");
	return { spawns: [...own, ...joined], note };
}

function turnStatus(state: GameState): string {
	const e = state.encounter;
	if (!e) return "";
	if (e.status !== "active") return `\nCombat over: ${e.status}. XP pool ${e.xpPool}. Call end_combat to award XP and wrap up.`;
	const cur = e.combatants[e.order[e.turnIndex]];
	return isPcTurn(state)
		? `\nIt is now the PLAYER's turn (round ${e.round}). Narrate and stop; the player acts via the map.`
		: `\nNext turn: ${cur.name} [${cur.id}] (round ${e.round})${survivorForCombatant(state, cur) ? ", a companion of the player" : ""}. Resolve it with monster_turn.`;
}

/**
 * Enforces the solo encounter budget for the campaign difficulty and keeps
 * allies weaker than the player. Returns a note for the DM; throws when over
 * budget unless the DM gives an override reason (still capped).
 */
function budgetGate(state: GameState, spawns: MonsterSpawn[], override?: string): string {
	const level = state.character.classes.reduce((n, k) => n + k.level, 0);
	const living = state.encounter?.status === "active" ? Object.values(state.encounter.combatants).filter((c) => !c.dead && c.kind !== "pc") : [];
	const xpOf = (c: { stats?: { xp?: number } }) => c.stats?.xp ?? 0;
	const enemies = [...living.filter((c) => c.side === "enemy").map(xpOf), ...spawns.filter((s) => (s.side ?? "enemy") === "enemy").map((s) => s.stats.xp ?? 0)];
	const allies = [...living.filter((c) => c.side === "party").map(xpOf), ...spawns.filter((s) => s.side === "party").map((s) => s.stats.xp ?? 0)];
	const b = checkBudget(level, state.settings.structure.difficulty, enemies, allies);
	const problems: string[] = [];
	const hardCap = Math.round(b.cap * 1.5);
	if (!b.ok) problems.push(`enemies are ${b.adjustedXp} adjusted XP (${b.band}) but the ${state.settings.structure.difficulty} cap for a level ${level} solo character is ${b.cap} — use fewer or weaker monsters`);
	if (!b.allyOk) problems.push(`allies total ${b.allyXp} XP but may not exceed ${b.allyCap} (the player must stay the strongest on their side) — keep strong NPCs out of the fight narratively, or stat them as weaker creatures (e.g. 'guard', 'commoner', 'acolyte')`);
	if (problems.length && (!override || b.adjustedXp > hardCap)) {
		throw new Error(`Encounter refused: ${problems.join("; ")}.${override && b.adjustedXp > hardCap ? ` Even with an override the hard limit is ${hardCap}.` : " Pass override='<story reason>' only for a deliberate set-piece."}`);
	}
	return `${b.summary}${problems.length ? ` OVERRIDE (${override}): ${problems.join("; ")}.` : ""}`;
}

/** Enemies the player can neither reach nor see: the map disagrees with the story. */
function cutOff(enc: Encounter, map: GridMap, pcId: string): string[] {
	const pcEnt = map.entities.find((e) => e.id === enc.combatants[pcId]?.entityId);
	if (!pcEnt) return [];
	const out: string[] = [];
	for (const c of Object.values(enc.combatants)) {
		if (c.side !== "enemy" || c.dead) continue;
		const ent = map.entities.find((e) => e.id === c.entityId);
		if (!ent) continue;
		const sep = separation(map, pcEnt, ent, !!c.stats?.speed?.fly);
		if (sep) out.push(describeSeparation(map, pcEnt, ent, sep));
	}
	return out;
}

function mapSyncGate(enc: Encounter, map: GridMap, pcId: string, override?: string): string {
	const cut = cutOff(enc, map, pcId);
	if (!cut.length) return "";
	if (override) return `\nNOTE (override): ${cut.join("; ")}.`;
	throw new Error(
		`Encounter refused, the map doesn't match the scene: ${cut.join("; ")}. The player could neither reach nor see them. ` +
			"First make the map agree with your narration: move the player's token to where the story puts them (move_player or update_entity), and open doors they've passed through (set_tile tile='door_open'). Then start the fight. " +
			"Only if the enemies really are sealed off (e.g. about to break the door down), pass override='<reason>'.",
	);
}

export const startCombatTool = tool<{ monsters: SpawnArg[]; pcSurprised?: boolean; override?: string }>(
	"start_combat",
	"Start a combat encounter on the active map with SRD monsters. The engine enforces a solo-character XP budget for the campaign difficulty and caps allies (side='party') so the player stays the protagonist; it refuses over-budget encounters. Rolls initiative; returns the order. Switches the view to the map and the ambience to combat.",
	S.obj({ monsters: spawnSchema, pcSurprised: S.bool(), override: S.str("Story reason to exceed the budget for a deliberate set-piece (still capped at 1.5×)") }, ["monsters"]),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const { state, rng } = tx;
			if (state.encounter?.status === "active") throw new Error("Combat already active; use add_monsters.");
			const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
			const spawns = toSpawns(state, a.monsters);
			if (!map) throw new Error("No active map. Call generate_map first.");
			// The Quiet: companions with the party fight beside the player (as many as the ally cap allows).
			const group = withSurvivors(state, map, spawns);
			const budgetNote = budgetGate(state, group.spawns, a.override);
			const res = startCombat({ encounterId: newId("enc"), map, character: state.character, monsters: group.spawns, pcSurprised: a.pcSurprised }, rng, combatOpts(state));
			const syncNote = res.ok ? mapSyncGate(res.encounter, res.map, state.character.id, a.override) : "";
			const log = applyCombatResult(tx, res) + syncNote + group.note;
			linkSurvivorCombatants(state);
			state.mode = "combat";
			state.view = "map";
			if (state.ambience !== "boss") state.ambience = "combat";
			state.scene.mood = "combat";
			const ids = Object.values(state.encounter!.combatants).map((c) => `${c.name} [${c.id}] @${map.entities.find((e) => e.id === c.entityId)?.x},${map.entities.find((e) => e.id === c.entityId)?.y}`);
			return `${budgetNote}\n${log}\nCombatants: ${ids.join("; ")}${turnStatus(state)}${autoUntilPc(tx, false)}`;
		}),
);

/** Runs the fallback AI for consecutive non-PC turns (used when DM opts in). */
function autoUntilPc(tx: StateTxn, enabled: boolean): string {
	if (!enabled) return "";
	const lines: string[] = [];
	let guard = 0;
	while (tx.state.encounter?.status === "active" && !isPcTurn(tx.state) && guard++ < 30) {
		const e = tx.state.encounter;
		const id = e.order[e.turnIndex];
		lines.push(applyCombatResult(tx, autoMonsterTurn(combatState(tx.state), tx.rng, id, { ...combatOpts(tx.state), endTurn: true })));
	}
	return lines.length ? `\n${lines.join("\n")}${turnStatus(tx.state)}` : "";
}

export const monsterTurnTool = tool<{ combatantId: string; actionName?: string; targetIds?: string[]; moveToX?: number; moveToY?: number; moveAfter?: boolean; endTurn?: boolean; auto?: boolean }>(
	"monster_turn",
	"Resolve a monster/NPC combatant's action on its turn: choose action (stat-block name, or dash/disengage/dodge), targets and destination square; the engine moves, rolls and applies results. By default ends its turn. auto=true lets the engine pick tactics. Can be called with endTurn=false to take a bonus action next, or for legendary actions on others' turns.",
	S.obj(
		{
			combatantId: S.str(),
			actionName: S.str("Exact action name from the stat block, e.g. 'Scimitar', 'Multiattack', 'Fire Breath'"),
			targetIds: S.arr(S.str()),
			moveToX: S.int(),
			moveToY: S.int(),
			moveAfter: S.bool("Move after acting"),
			endTurn: S.bool("Default true"),
			auto: S.bool("Let the engine choose movement and attacks"),
		},
		["combatantId"],
	),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const { state, rng } = tx;
			const cs = combatState(state);
			const opts = combatOpts(state);
			let log: string;
			if (a.auto) log = applyCombatResult(tx, autoMonsterTurn(cs, rng, a.combatantId, { ...opts, endTurn: a.endTurn !== false }));
			else {
				const moveTo = a.moveToX !== undefined && a.moveToY !== undefined ? { x: a.moveToX, y: a.moveToY } : undefined;
				log = applyCombatResult(tx, monsterAct(cs, rng, a.combatantId, { actionName: a.actionName, targetIds: a.targetIds, moveTo, moveAfter: a.moveAfter }, opts));
				const e = state.encounter!;
				if (a.endTurn !== false && e.status === "active" && e.order[e.turnIndex] === a.combatantId) log += `\n${applyCombatResult(tx, endTurn(combatState(state), rng, opts))}`;
			}
			return `${log}${turnStatus(state)}`;
		}),
);

export const autoMonsterTurnsTool = tool<Record<string, never>>(
	"auto_monster_turns",
	"Let the engine run simple tactics for every monster turn until it is the player's turn (for routine minions). Prefer monster_turn for important foes.",
	S.obj({}),
	async (_a, ctx) => withState(ctx, (tx) => autoUntilPc(tx, true).trim() || `Nothing to run.${turnStatus(tx.state)}`),
);

export const addMonstersTool = tool<{ monsters: SpawnArg[]; override?: string }>(
	"add_monsters",
	"Add reinforcements to the active combat (counted against the same encounter budget as start_combat, including living combatants).",
	S.obj({ monsters: spawnSchema, override: S.str("Story reason to exceed the budget") }, ["monsters"]),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const spawns = survivorsAsThemselves(tx.state, toSpawns(tx.state, a.monsters));
			const note = budgetGate(tx.state, spawns, a.override);
			const res = addMonsters(combatState(tx.state), tx.rng, spawns, combatOpts(tx.state));
			const syncNote = res.ok ? mapSyncGate(res.encounter, res.map, tx.state.character.id, a.override) : "";
			const log = applyCombatResult(tx, res);
			linkSurvivorCombatants(tx.state);
			return `${note}\n${log}${syncNote}`;
		}),
);

export const removeCombatantTool = tool<{ combatantId: string; reason?: string }>(
	"remove_combatant",
	"Remove a combatant from combat (fled, surrendered, banished).",
	S.obj({ combatantId: S.str(), reason: S.str() }, ["combatantId"]),
	async (a, ctx) =>
		withState(ctx, (tx) => `${applyCombatResult(tx, removeCombatant(combatState(tx.state), tx.rng, a.combatantId, a.reason ?? "fled", combatOpts(tx.state)))}${turnStatus(tx.state)}`),
);

export const endCombatTool = tool<{ status?: "victory" | "defeat" | "fled" | "ended"; awardXp?: boolean; reason?: string }>(
	"end_combat",
	"End the encounter (if not already ended), award the XP pool (unless milestone leveling or awardXp=false), clear the initiative tracker. While enemies are still standing it needs a story reason (they surrendered, fled, a truce…). Never end combat to get around the map or the rules.",
	S.obj({ status: S.str(undefined, ["victory", "defeat", "fled", "ended"]), awardXp: S.bool(), reason: S.str("Why the fight ends while enemies still stand (surrender, flight, parley)") }),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const { state, rng } = tx;
			const enc = state.encounter;
			if (!enc) throw new Error("No encounter.");
			const standing = Object.values(enc.combatants).filter((c) => c.side === "enemy" && !c.dead);
			if (enc.status === "active" && standing.length && a.status !== "defeat" && a.status !== "fled" && !a.reason?.trim())
				throw new Error(
					`${standing.map((c) => `${c.name} [${c.id}] HP ${c.hp}/${c.maxHp}`).join(", ")} still standing. If the map or a rule is in the way, fix it instead of ending the fight: move_player moves the player's token on their turn, set_tile opens doors. If the fight truly ends (surrender, flight, parley), pass reason='…' and use remove_combatant for those who leave.`,
				);
			let log = "";
			if (enc.status === "active") log = applyCombatResult(tx, endCombat(combatState(state), rng, a.status ?? "ended", combatOpts(state)));
			const xp = state.encounter!.xpPool;
			if (xp > 0 && a.awardXp !== false && state.settings.structure.leveling === "xp") {
				state.character.xp += xp;
				log += `\nAwarded ${xp} XP (total ${state.character.xp}).`;
			}
			// Remove dead monster tokens' combat links; keep corpses on the map.
			const map = state.maps[enc.mapId];
			if (map)
				for (const e of map.entities) {
					const c = Object.values((state.encounter ?? enc).combatants).find((x) => x.entityId === e.id);
					if (c?.dead && e.kind !== "pc") e.dead = true;
					delete e.combatantId;
				}
			// The Quiet: companions who went down but lived get up (their tokens aren't corpses).
			const up = survivorsAfterCombat(state, state.encounter ?? enc);
			if (up) log += `\n${up}`;
			state.encounter = undefined;
			state.mode = "explore";
			state.scene.mood = a.status === "defeat" ? "somber" : "tense";
			return `${log}\nCombat ended.`.trim();
		}),
);

function inCombatTarget(state: GameState, id: string): boolean {
	return !!state.encounter && state.encounter.status === "active" && !!state.encounter.combatants[id];
}

export const damageTool = tool<{ targetId?: string; amount: string; type?: DamageType; reason: string }>(
	"apply_damage",
	"Deal damage (number or dice like '2d6') to the player (default) or a combatant: traps, falling, environmental hazards, spell effects you adjudicate. Applies resistances, temp HP, death saves, concentration.",
	S.obj({ targetId: S.str("Combatant id; omit for the player"), amount: S.str("e.g. '7' or '2d6'"), type: S.str(undefined, DAMAGE), reason: S.str() }, ["amount", "reason"]),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const { state, rng } = tx;
			const target = a.targetId ?? state.character.id;
			const amount = /^\d+$/.test(a.amount) ? Number(a.amount) : a.amount;
			if (inCombatTarget(state, target)) return `${applyCombatResult(tx, applyDamageTo(combatState(state), rng, target, amount, a.type, {}, combatOpts(state)))}${turnStatus(state)}`;
			if (target !== state.character.id) throw new Error("Target is not in combat; only the player can take damage outside combat.");
			return applyDamageToCharacter(tx, rng as Rng, amount, a.type, a.reason);
		}),
);

export const healTool = tool<{ targetId?: string; amount: string; reason: string }>(
	"heal",
	"Restore hit points to the player (default) or a combatant (number or dice).",
	S.obj({ targetId: S.str(), amount: S.str(), reason: S.str() }, ["amount", "reason"]),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const { state, rng } = tx;
			const target = a.targetId ?? state.character.id;
			const amount = /^\d+$/.test(a.amount) ? Number(a.amount) : a.amount;
			if (inCombatTarget(state, target)) return applyCombatResult(tx, healTo(combatState(state), rng, target, amount, combatOpts(state)));
			return healCharacter(tx, rng, amount, a.reason);
		}),
);

export const conditionTool = tool<{ targetId?: string; condition: ConditionId; remove?: boolean; rounds?: number; note?: string; source?: string }>(
	"set_condition",
	"Apply or remove a condition on the player (default) or a combatant. rounds = duration; note e.g. 'DC 13 WIS save at end of each turn'.",
	S.obj({ targetId: S.str(), condition: S.str(undefined, CONDITIONS), remove: S.bool(), rounds: S.int(), note: S.str(), source: S.str() }, ["condition"]),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const { state, rng } = tx;
			const target = a.targetId ?? state.character.id;
			if (inCombatTarget(state, target)) {
				const res = a.remove
					? removeConditionFrom(combatState(state), rng, target, a.condition, combatOpts(state))
					: applyConditionTo(combatState(state), rng, target, { id: a.condition, rounds: a.rounds, note: a.note, source: a.source }, combatOpts(state));
				return applyCombatResult(tx, res) || `${a.remove ? "Removed" : "Applied"} ${a.condition}.`;
			}
			const c = state.character;
			c.conditions = c.conditions.filter((x) => x.id !== a.condition);
			if (!a.remove) c.conditions.push({ id: a.condition, rounds: a.rounds, note: a.note, source: a.source });
			return `${a.remove ? "Removed" : "Applied"} ${a.condition} on ${c.name}.`;
		}),
);

export const movePlayerTool = tool<{ x?: number; y?: number; towardId?: string; needSight?: boolean }>(
	"move_player",
	"Move the PLAYER's token when they say where to go in words (\"I circle the sarcophagus\", \"I run to the door\"). In combat it must be their turn: the engine walks the best path within their remaining movement (opening closed doors, provoking opportunity attacks), and with towardId + needSight it stops at the nearest square that can see that creature/entity. Outside combat it just places the token. Then resolve what they do next (cast_spell, etc.).",
	S.obj({ x: S.int(), y: S.int(), towardId: S.str("Entity or combatant id to move toward"), needSight: S.bool("Stop at the first square with line of sight to towardId (for spells and ranged attacks)") }),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			const { state } = tx;
			const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
			if (!map) throw new Error("No active map.");
			const pc = map.entities.find((e) => e.kind === "pc");
			if (!pc) throw new Error("No player token on the map.");
			const enc = state.encounter?.status === "active" ? state.encounter : undefined;
			const goalEnt = a.towardId ? map.entities.find((e) => e.id === a.towardId || e.combatantId === a.towardId || (enc && enc.combatants[a.towardId!]?.entityId === e.id)) : undefined;
			if (a.towardId && !goalEnt) throw new Error(`Unknown entity ${a.towardId}.`);
			const goal = goalEnt ? { x: goalEnt.x, y: goalEnt.y } : a.x !== undefined && a.y !== undefined ? { x: a.x, y: a.y } : undefined;
			if (!goal) throw new Error("Give x,y or towardId.");
			const cheb = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - goal.x), Math.abs(p.y - goal.y));
			if (!enc) {
				placeEntityNear(map, pc, goal, !!goalEnt);
				return `Moved ${pc.name} to ${where(map, pc)}.`;
			}
			if (!isPcTurn(state)) throw new Error("It isn't the player's turn; they move on their own turn.");
			const pcId = state.character.id;
			const options = reachable(enc, map, pcId);
			if (!options.length) throw new Error(`${pc.name} has no movement left this turn (they can Dash).`);
			const sees = (p: { x: number; y: number }) => hasLineOfSight(map, p, goal) || hasLineOfSight(map, goal, p);
			let pick = a.needSight && goalEnt ? options.filter((p) => sees(p)).sort((p, q) => p.cost - q.cost || cheb(p) - cheb(q))[0] : undefined;
			if (!pick) {
				const exact = options.find((p) => p.x === goal.x && p.y === goal.y);
				pick = exact ?? [...options].sort((p, q) => cheb(p) - cheb(q) || p.cost - q.cost)[0];
			}
			if (a.needSight && goalEnt && sees(pc)) return `${pc.name} at ${where(map, pc)} already sees ${goalEnt.name}; no need to move.`;
			const path = findPath(enc, map, pcId, pick, enc.combatants[pcId].turn.movementLeft);
			if (!path?.path.length) throw new Error("No path.");
			const log = playerCombatAction(tx, { type: "move", path: path.path }, tx.rng);
			const after = state.maps[map.id].entities.find((e) => e.id === pc.id)!;
			const note = goalEnt && a.needSight ? (sees(after) ? ` ${goalEnt.name} is now in sight.` : ` Still no line of sight to ${goalEnt.name}.`) : "";
			return `${log}${note}`;
		}),
);

function placeEntityNear(map: GridMap, pc: GridMap["entities"][number], goal: { x: number; y: number }, adjacent: boolean): void {
	const target = adjacent ? { x: goal.x, y: goal.y + 1 } : goal;
	const placed = placeEntity(map, { ...pc, x: target.x, y: target.y }, goal);
	pc.x = placed.x;
	pc.y = placed.y;
	revealAround(map, pc.x, pc.y, SIGHT_RADIUS);
}

export const COMBAT_TOOLS: ToolFactory[] = [movePlayerTool, startCombatTool, monsterTurnTool, autoMonsterTurnsTool, addMonstersTool, removeCombatantTool, endCombatTool, damageTool, healTool, conditionTool];
