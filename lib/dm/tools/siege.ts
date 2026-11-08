import type { GameState } from "../../game/types";
import { isZombie } from "../../rules/survival";
import { PC_SIEGE_ACTIONS, assignPost, breachSpawnCount, baseMapOf, closeSiege, endSiege, partyAtBase, resolveWave, setLights, settleBreach, startSiege, type PcSiegeAction, type WaveResult } from "../../rules/siege";
import { S, tool, withState, type StateTxn, type ToolFactory } from "../context";
import { beginCombat } from "./combat";

/** The Quiet only: night sieges at the base (lib/rules/siege.ts). */
function requireZombie(state: GameState) {
	if (!isZombie(state)) throw new Error("Only in The Quiet (zombie campaigns).");
}

/**
 * The dead broke in: start the fight at the gap on the base map (the engine
 * sized it to the solo budget). Falls back to an exact instruction for the DM
 * when the base map can't host it right now.
 */
export function startBreachFight(tx: StateTxn, br: NonNullable<WaveResult["breach"]>): string {
	const { state } = tx;
	const s = state.siege;
	const b = state.group?.base;
	const map = baseMapOf(state);
	const spawnText = br.spawn.map((x) => `${x.count} × ${x.monster} at (${x.x},${x.y})`).join(", ");
	const fallback = (why: string) =>
		`BREACH: the dead are inside at (${br.x},${br.y}). ${why} DM: use_map ${b?.mapId ?? "(the base map)"} if needed, then start_combat with monsters [{ monster: "z-shambler", count: ${br.spawn[0]?.count ?? 1}, x: ${br.x}, y: ${br.y} }] (${spawnText}). When the fight ends, the siege goes on by itself.`;
	if (!s?.breach || !b || !map) return fallback("The engine couldn't place the fight.");
	if (state.encounter?.status === "active") return fallback("A fight is already on: add_monsters them to it.");
	if (!map.entities.some((e) => e.kind === "pc")) return fallback("The player's token isn't on the base map.");
	const prevMap = state.activeMapId;
	const prevView = state.view;
	state.activeMapId = map.id;
	try {
		const text = beginCombat(tx, { monsters: br.spawn.map((x) => ({ monster: x.monster, count: x.count, x: x.x, y: x.y })), override: "siege breach: the dead pour through the gap" });
		s.breach.combat = true;
		return `BREACH FIGHT STARTED at (${br.x},${br.y}): ${spawnText} pour through the gap; companions with the party come running (as many as the ally cap allows), the rest hold the other posts. Narrate the wall giving way and the first of them coming through, then play the fight as usual (monster_turn). When it ends (end_combat), the siege goes on by itself.\n${text}`;
	} catch (error) {
		state.activeMapId = prevMap;
		state.view = prevView;
		return fallback(`(${error instanceof Error ? error.message : String(error)})`);
	}
}

export interface SiegeWaveOutcome {
	text: string;
	/** A moment for the DM to narrate: the arrival, a breach, the end. */
	narrate: boolean;
}

/** One wave (the player's Hold the line, or siege_wave): resolves it and starts any breach fight. */
export function siegeWave(tx: StateTxn, a: { action?: PcSiegeAction; moveTo?: { x: number; y: number } }): SiegeWaveOutcome {
	const { state, rng, roll } = tx;
	const s = state.siege;
	if (!s) throw new Error("There is no siege.");
	if (!partyAtBase(state)) throw new Error("The party isn't at the base: the engine plays the night on its own when the dead arrive.");
	if (s.breach && !s.breach.combat && state.encounter?.status !== "active") {
		// The fight never started (the map wasn't ready): try again before anything else.
		const text = startBreachFight(tx, { x: s.breach.x, y: s.breach.y, dead: s.breach.dead, spawn: [{ monster: "z-shambler", count: breachSpawnCount(state, s.breach.dead), x: s.breach.x, y: s.breach.y }] });
		return { text, narrate: true };
	}
	const r = resolveWave(state, rng, roll, a);
	let text = r.text;
	if (r.breach) text += `\n${startBreachFight(tx, r.breach)}`;
	return { text, narrate: r.first || !!r.breach || r.over };
}

export const startSiegeTool = tool<{ horde: number; arrivesInMinutes?: number }>(
	"start_siege",
	"The Quiet: the dead come for the BASE tonight (a horde drawn by noise or light, the story's call). Announces a siege: the engine sets when they arrive (watchtower and alarm cans add warning time), how many waves, and the ways in (barricades and outer doors of the base map). Then the PLAYER sets the defence on the Siege panel and holds the line wave by wave; the engine resolves the waves, breaches start a fight on their own. You narrate the warning, the arrival, breaches and the dawn. The engine also starts sieges itself (a town horde reaching the base, a big dawn probe): don't start a second one.",
	S.obj({ horde: S.int("Rough number of the dead (10 a pack, 30 a horde, 60+ the whole street)", 1, 200), arrivesInMinutes: S.int("Minutes until they reach the walls before the upgrades' extra warning (default: 10 at night; by day they come at dusk)", 0, 1440) }, ["horde"]),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			requireZombie(state);
			return startSiege(state, rng, { horde: a.horde, source: "dm", ...(a.arrivesInMinutes !== undefined ? { inMinutes: a.arrivesInMinutes } : {}) });
		}),
);

export const siegeDefenceTool = tool<{ posts?: { who: string; x?: number; y?: number }[]; lights?: boolean }>(
	"siege_defence",
	"The Quiet: set the base's defence for a siege when the player asks for it in words (the Siege panel does the same): who guards which post (a barricade or a door to the outside on the base map; who = 'pc' or a companion's name/npcId; no x/y takes them off their post; two at most per post) and the lights (need the generator and 1 fuel: +2 to hit, but each wave draws 1d4 more dead).",
	S.obj(
		{
			posts: S.arr(S.obj({ who: S.str("'pc' or a companion"), x: S.int(undefined, 0), y: S.int(undefined, 0) }, ["who"]), "Post assignments"),
			lights: S.bool("Lights on (true) or off (false)"),
		},
		[],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			const out: string[] = [];
			for (const p of a.posts ?? []) out.push(assignPost(state, p.who, p.x !== undefined && p.y !== undefined ? { x: p.x, y: p.y } : undefined));
			if (a.lights !== undefined) out.push(setLights(state, a.lights));
			return out.join("\n") || "Nothing changed.";
		}),
);

export const siegeWaveTool = tool<{ action?: PcSiegeAction; moveX?: number; moveY?: number; breach?: "contained" | "lost" }>(
	"siege_wave",
	"The Quiet: resolve the next siege wave when the player says what they do in words instead of using the Siege panel (action: shoot = fire from their post using the base's ammo; hack = melee through the gaps, more kills but hands and teeth; repair = 1 materials to shore up their post; hold). moveX/moveY moves them to another post first. Also settles a breach whose fight you ran yourself: breach='contained' (they plugged it) or 'lost' (the dead are inside: the night is lost). Don't use it to skip the player's choices.",
	S.obj({ action: S.str(undefined, PC_SIEGE_ACTIONS), moveX: S.int(undefined, 0), moveY: S.int(undefined, 0), breach: S.str("Settle a breach you fought with your own tools", ["contained", "lost"]) }, []),
	async (a, ctx) =>
		withState(ctx, (tx) => {
			requireZombie(tx.state);
			const s = tx.state.siege;
			if (a.breach) {
				if (!s?.breach) throw new Error("No breach to settle.");
				if (tx.state.encounter) throw new Error("The fight is still on: end_combat first.");
				const note = settleBreach(tx.state, a.breach === "contained") ?? "";
				return a.breach === "lost" ? `${note}\n${endSiege(tx.state, tx.rng, tx.roll, "breached")}` : note;
			}
			return siegeWave(tx, { action: a.action, ...(a.moveX !== undefined && a.moveY !== undefined ? { moveTo: { x: a.moveX, y: a.moveY } } : {}) }).text;
		}),
);

export const endSiegeTool = tool<{ outcome?: "held" | "fled"; reason?: string }>(
	"end_siege",
	"The Quiet: close a siege. After the engine reports SIEGE OVER and you've narrated the dawn, call it with no arguments to clear it. To call off a siege still on, give a reason: outcome 'fled' (the party abandoned the base) or 'held' (the dead turned away).",
	S.obj({ outcome: S.str(undefined, ["held", "fled"]), reason: S.str("Why it ends early") }, []),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll }) => {
			requireZombie(state);
			return closeSiege(state, rng, roll, a);
		}),
);

export const SIEGE_TOOLS: ToolFactory[] = [startSiegeTool, siegeDefenceTool, siegeWaveTool, endSiegeTool];
