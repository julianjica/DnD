import type { GameState, GridMap } from "../../game/types";
import { canStand, reachableFrom } from "../../maps/grid";
import { cyberOf, isCyber } from "../../rules/cyber";
import { endRaid, forceFor, pcLevel, raidDefences, raidDigest, RAIDERS, TURRET, type NewDen, type RaidOutcome } from "../../rules/raid";
import { getMonster } from "../../srd/index";
import { gameMinutes } from "../../rules/survival";
import { applyConditionTo } from "../../rules/combat";
import { applyCombatResult, combatOpts, combatState } from "../combat";
import { S, tool, withState, type StateTxn, type ToolFactory } from "../context";
import { beginCombat, type SpawnArg } from "./combat";

/**
 * Root Access: raids on the den for the DM (lib/rules/raid.ts). Always listed
 * (the tool list stays stable for the engine sessions); they refuse outside
 * cyberpunk campaigns.
 */

const notCyber = "This tool only exists in Root Access (cyberpunk-ruleset campaigns).";

function requireCyber(state: GameState) {
	if (!isCyber(state)) throw new Error(notCyber);
}

/** Where the attackers come in: the map's entry, unless the PC stands on it; then the reachable square farthest from the PC. */
function breachPoint(map: GridMap, pc: { x: number; y: number }): { x: number; y: number } {
	const cheb = (p: { x: number; y: number }) => Math.max(Math.abs(p.x - pc.x), Math.abs(p.y - pc.y));
	if (cheb(map.entry) >= 4) return map.entry;
	const seen = reachableFrom(map, pc);
	let best = map.entry;
	let bd = cheb(best);
	for (let i = 0; i < seen.length; i++) {
		if (!seen[i]) continue;
		const p = { x: i % map.width, y: Math.floor(i / map.width) };
		const d = cheb(p);
		if (d > bd && canStand(map, p.x, p.y)) {
			best = p;
			bd = d;
		}
	}
	return best;
}

type AllyArg = { monster: string; name?: string; npcId?: string };

/** Starts the raid fight on the den map. */
export function beginRaid(tx: StateTxn, a: { early?: boolean; useActiveMap?: boolean; allies?: AllyArg[] }): string {
	const { state } = tx;
	requireCyber(state);
	const den = cyberOf(state).den;
	const due = den?.raidDue;
	if (!den || !due) throw new Error("No raid is due. (Raids come from Heat 8/10, a dump that found the den, or a betrayal; they show in the digest.)");
	if (due.started) throw new Error("The raid is already on. When the fight ends, close it with raid_end.");
	const now = gameMinutes(state.time);
	if (now < due.at && !a.early) throw new Error(`Not yet: ${RAIDERS[due.by]} reach the den in ${Math.ceil((due.at - now) / 60)} h. Keep foreshadowing (or advance time); pass early=true only if the story brings it forward.`);
	if (state.encounter?.status === "active") throw new Error("A fight is already on: finish it first (end_combat).");
	if (!den.mapId || !state.maps[den.mapId]) {
		const active = state.activeMapId ? state.maps[state.activeMapId] : undefined;
		if (a.useActiveMap && active && active.theme !== "net") den.mapId = active.id;
		else throw new Error(`The den has no map yet. Draw ${den.name} (draw_map, with its door to the street), make sure the PC's token is inside, then call raid_begin again with useActiveMap=true to make it the den's map.`);
	}
	if (state.activeMapId !== den.mapId) throw new Error(`The PC isn't on the den's map (${state.maps[den.mapId!]?.name}). If they're at the den, use_map it first. If they're away, the raid hits an empty den: raid_end outcome 'lost' (and name the new den).`);
	const map = state.maps[den.mapId!];
	const pc = map.entities.find((e) => e.kind === "pc");
	if (!pc) throw new Error("The PC's token isn't on the den map: place them first (move_player).");

	const def = raidDefences(den);
	const allies: SpawnArg[] = (a.allies ?? []).map((x) => ({ monster: x.monster, ...(x.name ? { name: x.name } : {}), ...(x.npcId ? { npcId: x.npcId } : {}), side: "party", x: pc.x, y: pc.y }));
	if (def.turret) allies.unshift({ monster: TURRET, name: "Den Turret", side: "party", x: pc.x, y: pc.y });
	const allyXps = allies.map((s) => getMonster(s.monster)?.xp ?? 0);
	const force = forceFor(state, allyXps)!;
	const at = breachPoint(map, pc);
	const enemies: SpawnArg[] = force.monsters.map((m) => ({ monster: m.monster, count: m.count, ...(m.name ? { name: m.name } : {}), x: at.x, y: at.y }));
	// Marked before the fight starts so the combat hooks (crew at the den) can see a raid is on; undone if it can't start.
	due.started = { at: now, force: force.list, mapId: map.id };
	let text: string;
	try {
		text = beginCombat(tx, { monsters: [...enemies, ...allies], pcSurprised: def.pcSurprised, override: `den raid by ${RAIDERS[due.by]}` });
	} catch (error) {
		delete due.started;
		throw error;
	}
	// The steel door holds them a round: every attacker spends its first turn breaching it.
	if (def.steelDoor) {
		for (const c of Object.values(state.encounter!.combatants)) {
			if (c.side !== "enemy" || c.dead) continue;
			const res = applyConditionTo(combatState(state), tx.rng, c.id, { id: "incapacitated", rounds: 1, source: "steel door", note: "breaching the den's steel door (loses its first turn)" }, combatOpts(state));
			if (res.ok) applyCombatResult(tx, res);
		}
	}
	return [
		`RAID ON ${den.name}: ${force.summary}. They come in at (${at.x},${at.y}).`,
		`Defences: ${def.text.join("; ")}.`,
		def.cameras ? "The PC saw them on the cameras: tell the player exactly who is coming." : "",
		"Crew at the den fight beside the PC (pass them as allies). Play the fight as usual; when it ends (end_combat), close the raid with raid_end: won, lost (1–2 upgrades seized, the den moves) or fled (hidden exit only).",
		text,
	]
		.filter(Boolean)
		.join("\n");
}

export const raidStatusTool = tool<Record<string, never>>(
	"raid_status",
	"Root Access: the den's raid picture: whether a raid is due (who, why, when) or on, the den's defences, the force that would come (exact with cameras) and past raids.",
	S.obj({}),
	async (_a, ctx) =>
		withState(ctx, ({ state }) => {
			requireCyber(state);
			const den = state.cyber?.den;
			if (!den) return "The PC has no den yet.";
			const def = raidDefences(den);
			const lines = [raidDigest(state) ?? `No raid due on ${den.name}.`, `Defences: ${def.text.join("; ")}.`];
			if (den.raidDue && !den.raidDue.started) {
				const f = forceFor(state, def.turret ? [getMonster(TURRET)?.xp ?? 0] : [])!;
				lines.push(def.cameras ? `Cameras: ${f.summary}.` : `No cameras: the PC doesn't know who exactly is coming (roughly ${RAIDERS[f.by]}, ${f.list.length} of them; DM's eyes only: ${f.summary}).`);
			}
			lines.push(den.raids.length ? `Past raids: ${den.raids.map((r) => `${r.won ? "won" : r.moved && !r.seized.length ? "fled/lost" : "lost"}${r.seized.length ? ` (seized ${r.seized.join(", ")})` : ""}`).join("; ")}. The den has moved ${den.moves} time${den.moves === 1 ? "" : "s"}.` : "No raids yet.");
			lines.push(`PC level ${pcLevel(state)}, Heat ${state.cyber!.heat}.`);
			return lines.join("\n");
		}),
);

export const raidBeginTool = tool<{ early?: boolean; useActiveMap?: boolean; allies?: AllyArg[] }>(
	"raid_begin",
	"Root Access: the raid on the den lands (when the digest says RAID NOW and the PC is at the den). The engine sizes the attacking force to the PC's level, the campaign difficulty and Heat (Ferro, a gang, bounty hunters or corp security, whoever is due) and starts the fight on the den map with the defences in play: steel door (they lose their first round breaching), cameras (no surprise; the PC knows the force), turret (fights on the PC's side), hidden exit (a way out: raid_end fled). Crew at the den fight too: list them in allies. If the den has no map, draw it first (draw_map) and pass useActiveMap=true.",
	S.obj(
		{
			early: S.bool("The story brings the raid forward (before its hour)"),
			useActiveMap: S.bool("Make the active map the den's map (after drawing it)"),
			allies: S.arr(S.obj({ monster: S.str("Stat block (c-…)"), name: S.str(), npcId: S.str("The crew member's NPC id") }, ["monster"]), "Crew at the den who fight beside the PC"),
		},
		[],
	),
	async (a, ctx) => withState(ctx, (tx) => beginRaid(tx, a)),
);

export const raidEndTool = tool<{ outcome: RaidOutcome; newDenName?: string; newLocationId?: string; newRent?: number }>(
	"raid_end",
	"Root Access: close the raid on the den after the fight (end_combat first). won: Heat −2, the den stays. lost: 1–2 den upgrades are seized (most valuable first; what the PC carries is never taken) and the den MOVES: the fixed defences (steel door, cameras, turret, hidden exit, faraday mesh, sleep pod, med bay) stay behind, the rest comes along, and the rent starts over at the new place (name it: newDenName, and newRent if it differs). fled: only with the hidden exit: nothing seized, but the den moves. If the PC was away when the raid landed, use lost.",
	S.obj(
		{
			outcome: S.str(undefined, ["won", "lost", "fled"]),
			newDenName: S.str("lost/fled: the new den ('a flooded garage in Los Anegados')"),
			newLocationId: S.str("lost/fled: its world location id, if it has one"),
			newRent: S.int("lost/fled: the new place's weekly rent in cred (default: the same)", 0, 100000),
		},
		["outcome"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			requireCyber(state);
			const due = state.cyber?.den?.raidDue;
			if (due?.started && state.encounter?.status === "active" && state.encounter.mapId === due.started.mapId) throw new Error("The fight is still on: end_combat first.");
			const to: NewDen | undefined = a.newDenName ? { name: a.newDenName, ...(a.newLocationId ? { locationId: a.newLocationId } : {}), ...(a.newRent !== undefined ? { rent: a.newRent } : {}) } : undefined;
			return endRaid(state, rng, a.outcome, to).text;
		}),
);

export const RAID_TOOLS: ToolFactory[] = [raidStatusTool, raidBeginTool, raidEndTool];
