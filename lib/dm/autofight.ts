import type { Character, Combatant, FightBeat, FightOutcome, FightReplay, FightReplayActor, GameState, PlayerCombatAction, RollRecord } from "../game/types";
import {
	actionKey,
	applyPlayerAction,
	autoMonsterTurn,
	endCombat,
	endTurn,
	isMindless,
	isWayOut,
	pcNextAction,
	removeCombatant,
	shouldFlee,
	builtinFeatureFor,
	type CombatOptions,
	type CombatResult,
	type DeckProgram,
} from "../rules/combat";
import { areHostile, canSee, distanceFeet, footprintOf, isIncapacitated } from "../rules/combat/grid";
import { abilityMod, roll, signed } from "../rules/dice";
import { cyberOf, isCyber } from "../rules/cyber";
import { coolingBonus } from "../rules/den";
import { deckChargesMax, deckOf, deckProgramNumbers, deckUsesOf } from "../rules/deck";
import { activeRun } from "../rules/netrun";
import { isZombie } from "../rules/survival";
import { getSpell } from "../srd";
import { applyCombatResultParts, combatOpts, combatState, finishCombat, isPcTurn } from "./combat";
import { newId, type StateTxn } from "./context";

/**
 * AUTOMATIC FIGHTS (campaign setting `dm.fights`, default "auto"). Once the
 * DM starts a fight, the engine plays every round to the end with the same
 * rules and real dice as turn-by-turn play: the PC follows the policy in
 * lib/rules/combat/auto.ts, allies and monsters their usual AI, and every
 * ruleset hook runs on each step exactly as it does turn by turn (noise and
 * bites in The Quiet, trace ticks and dumps in a net run, crew HP). The fight
 * is recorded as a replay (GameState.fight) for the battle map, and the DM
 * gets a compact summary to narrate.
 */

/**
 * What happens when the PC drops to 0 HP in an automatic fight.
 * - "knocked_out" (default): the fight ends there as a defeat; the PC is not
 *   killed off-screen but knocked out: stable, and they come round at 1 HP
 *   while the DM plays a setback (captured, robbed and left for dead, dragged
 *   out by an ally…). Death still comes from massive damage (5e: the damage
 *   left after 0 HP ≥ max HP) and in fights the DM marks lethal.
 * - "rules_as_written": the fight goes on with death saves as in turn-by-turn
 *   play (monsters don't finish a downed PC; allies keep fighting).
 */
export const AUTO_FIGHT_PC_DOWN: "knocked_out" | "rules_as_written" = "knocked_out";
/** A fight still going after this many rounds breaks off (stalemate). */
export const AUTO_FIGHT_MAX_ROUNDS = 20;
/** Rounds without a single attack, wound, death or rout (nobody can get at anybody) before a fight breaks off. */
export const AUTO_FIGHT_IDLE_ROUNDS = 3;
/** Fleeing: after this many turns on the run, with no foe within 5 ft, the PC has got away. */
export const AUTO_FLEE_TURNS = 3;
/** Morale: an enemy that can think checks once when bloodied with half its side down, and once at a quarter HP. */
export const AUTO_MORALE_DC = 10;

/**
 * Combat options for automatic fights: the usual ones, plus the engine's
 * built-in features (Second Wind, Action Surge) matched on the sheet's names,
 * which may carry a note ("Action Surge (1 use)").
 */
function fightOpts(state: GameState): CombatOptions {
	const opts = combatOpts(state);
	return { ...opts, onUseFeature: (f, st) => opts.onUseFeature?.(f, st) ?? builtinFeatureFor(st.character, f.name.replace(/\s*\(.*\)\s*$/, "")) };
}

export function fightsAuto(state: Pick<GameState, "settings">): boolean {
	return (state.settings.dm.fights ?? "auto") === "auto";
}

export interface AutoFightOptions {
	/** The player's decision: fight it out, or try to get away. */
	choice?: "fight" | "run";
	/** The DM made the stakes deadly: a downed PC makes death saves and can die. */
	lethal?: boolean;
	/** Dice already rolled to start the fight (initiative), for the count in the summary. */
	startRolls?: number;
}

// ─── the recorder ──────────────────────────────────────────────────────────

class Recorder {
	actors: FightReplayActor[] = [];
	beats: FightBeat[] = [];
	rolls = 0;
	private names = new Map<string, string>();
	private itemNames = new Map<string, string>();
	private lastHit = new Map<string, { by: string; round: number }>();
	round = 1;
	kills: { victim: string; by?: string; round: number; seq?: number }[] = [];
	routed: { id: string; why: "fled" | "surrendered" | "removed"; round: number; hp: number; maxHp: number; seq?: number }[] = [];
	downs: { id: string; round: number; seq?: number }[] = [];
	crits: { a: string; d: string; w: string; round: number; seq?: number; dmg?: number }[] = [];
	nearMisses: { a: string; d: string; w: string; round: number; seq?: number; by: number }[] = [];
	bigHits: { a: string; d: string; w: string; n: number; round: number; seq?: number }[] = [];
	spells: { a: string; s: string; round: number; seq?: number; targets: number }[] = [];
	items: { s: string; round: number; seq?: number }[] = [];
	feats: { s: string; round: number; seq?: number }[] = [];
	lastProgress = 1;
	private pendingAtk?: { a: string; d: string; w: string; crit: boolean };

	constructor(state: GameState) {
		const enc = state.encounter!;
		const map = state.maps[enc.mapId];
		for (const id of enc.order) {
			const c = enc.combatants[id];
			const ent = map?.entities.find((e) => e.id === c.entityId);
			this.names.set(id, c.name);
			if (!ent) continue;
			this.actors.push({ id, name: c.name, side: c.side, kind: c.kind, hp: c.hp, maxHp: c.maxHp, entity: structuredClone(ent) });
		}
		for (const i of state.character.inventory) this.itemNames.set(i.id, i.name);
		this.round = enc.round;
		this.lastProgress = enc.round;
		this.beats.push({ k: "round", n: enc.round });
		const cur = enc.order[enc.turnIndex];
		if (cur) this.beats.push({ k: "turn", a: cur });
	}

	name(id: string): string {
		return this.names.get(id) ?? id;
	}

	add(res: CombatResult, state: GameState): void {
		this.rolls += res.rolls.length;
		const rollOf = (id: string): RollRecord | undefined => res.rolls.find((r) => r.id === id);
		for (const c of Object.values(res.encounter.combatants)) if (!this.names.has(c.id)) this.names.set(c.id, c.name);
		for (const i of state.character.inventory) this.itemNames.set(i.id, i.name);
		for (const ev of res.events) {
			switch (ev.type) {
				case "round_start":
					this.round = ev.round;
					this.beats.push({ k: "round", n: ev.round });
					break;
				case "turn_start":
					this.beats.push({ k: "turn", a: ev.combatantId });
					break;
				case "move":
					this.beats.push({ k: "move", a: ev.combatantId, path: ev.path.map((p) => ({ x: p.x, y: p.y })) });
					break;
				case "stand_up":
					this.beats.push({ k: "act", a: ev.combatantId, s: "stand" });
					break;
				case "attack": {
					const r = rollOf(ev.rollId);
					this.beats.push({ k: "atk", a: ev.attackerId, d: ev.targetId, w: ev.name, hit: ev.hit, crit: ev.crit, ...(r ? { roll: r.total, ...(r.target !== undefined ? { ac: r.target } : {}) } : {}) });
					this.lastProgress = this.round;
					this.pendingAtk = { a: ev.attackerId, d: ev.targetId, w: ev.name, crit: ev.crit };
					if (ev.crit) this.crits.push({ a: ev.attackerId, d: ev.targetId, w: ev.name, round: this.round, seq: this.beats.length });
					if (!ev.hit && r?.target !== undefined && r.target - r.total <= 2 && r.critical !== "miss") this.nearMisses.push({ a: ev.attackerId, d: ev.targetId, w: ev.name, round: this.round, seq: this.beats.length, by: r.target - r.total });
					break;
				}
				case "damage": {
					this.beats.push({ k: "dmg", d: ev.targetId, n: ev.amount, hp: ev.hpAfter });
					if (ev.amount > 0) this.lastProgress = this.round;
					if (ev.sourceId) this.lastHit.set(ev.targetId, { by: ev.sourceId, round: this.round });
					const t = res.encounter.combatants[ev.targetId];
					const atk = this.pendingAtk && this.pendingAtk.d === ev.targetId ? this.pendingAtk : undefined;
					if (atk?.crit) {
						const c = [...this.crits].reverse().find((k) => k.a === atk.a && k.d === atk.d);
						if (c && c.dmg === undefined) c.dmg = ev.amount;
					}
					if (t && atk && ev.amount >= Math.max(8, t.maxHp * 0.4)) this.bigHits.push({ a: atk.a, d: ev.targetId, w: atk.w, n: ev.amount, round: this.round, seq: this.beats.length });
					break;
				}
				case "heal":
					this.beats.push({ k: "heal", d: ev.targetId, n: ev.amount, hp: ev.hpAfter });
					break;
				case "spell_cast": {
					const name = getSpell(ev.spell)?.name ?? ev.spell;
					this.beats.push({ k: "spell", a: ev.casterId, s: name, t: ev.targetIds, ...(ev.squares?.length ? { sq: ev.squares.slice(0, 120) } : {}) });
					this.spells.push({ a: ev.casterId, s: name, round: this.round, seq: this.beats.length, targets: ev.targetIds.length });
					this.pendingAtk = undefined;
					break;
				}
				case "item_used": {
					const s = this.itemNames.get(ev.itemId) ?? ev.itemId;
					this.beats.push({ k: "item", a: ev.combatantId, s });
					this.items.push({ s, round: this.round, seq: this.beats.length });
					break;
				}
				case "feature_used": {
					const s = (state.character.features.find((f) => f.id === ev.featureId)?.name ?? ev.featureId).replace(/\s*\(.*\)\s*$/, "");
					this.beats.push({ k: "feat", a: ev.combatantId, s });
					this.feats.push({ s, round: this.round, seq: this.beats.length });
					break;
				}
				case "action_used":
					if (["dash", "disengage", "dodge", "hide", "help"].includes(ev.action)) this.beats.push({ k: "act", a: ev.combatantId, s: ev.action as "dash" });
					break;
				case "save":
					this.beats.push({ k: "save", d: ev.targetId, ab: ev.ability, ok: ev.success, s: ev.source });
					break;
				case "condition_added":
					this.beats.push({ k: "cond", d: ev.targetId, c: ev.condition.id, on: true });
					break;
				case "condition_removed":
					this.beats.push({ k: "cond", d: ev.targetId, c: ev.condition, on: false });
					break;
				case "down":
					this.beats.push({ k: "down", d: ev.targetId });
					this.downs.push({ id: ev.targetId, round: this.round, seq: this.beats.length });
					break;
				case "death": {
					this.beats.push({ k: "die", d: ev.targetId });
					this.lastProgress = this.round;
					this.kills.push({ victim: ev.targetId, by: this.lastHit.get(ev.targetId)?.by, round: this.round, seq: this.beats.length });
					break;
				}
				case "death_save":
					this.beats.push({ k: "ds", d: ev.targetId, nat: ev.natural, s: ev.successes, f: ev.failures });
					break;
				case "removed": {
					const why = /surrender/i.test(ev.reason) ? "surrendered" : /fle|ran|rout/i.test(ev.reason) ? "fled" : "removed";
					this.beats.push({ k: "gone", a: ev.combatantId, why });
					this.lastProgress = this.round;
					break;
				}
			}
		}
	}
}

// ─── the loop ──────────────────────────────────────────────────────────────

interface Snap {
	trace?: number;
	noise?: number;
}
function snap(state: GameState): Snap {
	return { trace: activeRun(state)?.trace, noise: isZombie(state) ? state.survival?.noise.level : undefined };
}

/** Root Access: the deck's built-in programs with charges left, at the deck's numbers. */
function deckPrograms(state: GameState): DeckProgram[] {
	if (!isCyber(state)) return [];
	const c = state.character;
	const deck = deckOf(c);
	if (!deck) return [];
	const cy = cyberOf(state);
	const max = deckChargesMax(c);
	const nums = deckProgramNumbers(c, coolingBonus(cy));
	return deck.deck.programs
		.map((id) => getSpell(id))
		.filter((s): s is NonNullable<typeof s> => !!s && deckUsesOf(cy, s.index) < max)
		.map((spell) => ({ spell, ...nums }));
}

/**
 * Plays the active encounter to its end (start_combat has already set it up),
 * wraps it up like end_combat, stores the replay, and returns the summary for
 * the DM. Uses tx.rng throughout, so a seeded state replays identically.
 */
export function autoFight(tx: StateTxn, o: AutoFightOptions = {}): string {
	const { state, rng } = tx;
	if (state.encounter?.status !== "active") throw new Error("No active fight to resolve.");
	const choice = o.choice ?? "fight";
	const lethal = !!o.lethal || AUTO_FIGHT_PC_DOWN === "rules_as_written";
	const pcId = state.character.id;
	const before: Character = structuredClone(state.character);
	const deckBefore = isCyber(state) ? { ...(cyberOf(state).deckUses ?? {}) } : {};
	const rec = new Recorder(state);
	rec.rolls += o.startRolls ?? 0;
	const notes: string[] = [];
	// Engine dice stay in the replay; the rolls of ruleset hooks (an infection save, a crew member's last breath, dumpshock) go to the player's dice log as usual.
	let engineRolls = new Set<RollRecord>();
	const quiet: StateTxn = { state, rng, roll: (r) => (engineRolls.has(r) ? undefined : tx.roll(r)), fx: () => undefined };
	const map0 = state.maps[state.encounter.mapId];
	const exits = (map0?.links ?? []).map((l) => ({ x: l.x, y: l.y }));
	const onNet = !!activeRun(state) && activeRun(state)!.netMapId === state.encounter.mapId;

	let fleeing = choice === "run";
	let fledTurns = 0;
	let outcome: FightOutcome | undefined;
	const morale = new Map<string, number>();

	const step = (res: CombatResult): boolean => {
		if (!res.ok) return false;
		const s0 = snap(state);
		engineRolls = new Set(res.rolls);
		const parts = applyCombatResultParts(quiet, res);
		engineRolls = new Set();
		rec.add(res, state);
		notes.push(...parts.notes);
		const s1 = snap(state);
		if (s1.trace !== undefined && s1.trace !== s0.trace) rec.beats.push({ k: "trace", n: s1.trace });
		if (s0.trace !== undefined && s1.trace === undefined) rec.beats.push({ k: "trace", n: 10 });
		if (s1.noise !== undefined && s1.noise !== s0.noise) rec.beats.push({ k: "noise", n: s1.noise });
		return true;
	};
	const active = () => state.encounter?.status === "active";
	const pc = (): Combatant | undefined => state.encounter?.combatants[pcId];
	const end = (status: "victory" | "defeat" | "fled" | "ended") => step(endCombat(combatState(state), rng, status, fightOpts(state)));

	/** Can the PC call it an escape at the end of this turn? */
	const escaped = (): boolean => {
		const enc = state.encounter!;
		const map = state.maps[enc.mapId];
		const me = enc.combatants[pcId];
		const fp = map && footprintOf(enc, map, pcId);
		if (!me || !fp || me.hp <= 0) return false;
		if (isWayOut(map, fp, exits)) return true;
		const foes = Object.values(enc.combatants).filter((c) => !c.dead && areHostile(me, c) && !isIncapacitated(c));
		if (!foes.some((f) => canSee(enc, map, f.id, pcId))) return true;
		const adjacent = foes.some((f) => {
			const ff = footprintOf(enc, map, f.id);
			return !!ff && distanceFeet(fp, ff) <= 5;
		});
		return fledTurns >= AUTO_FLEE_TURNS && !adjacent;
	};

	const pcTurn = () => {
		const opts = fightOpts(state);
		if (!fleeing && choice === "fight" && shouldFlee(combatState(state), opts)) {
			fleeing = true;
			notes.push(`The player's character, beaten and out of healing, tried to break away in round ${state.encounter!.round}.`);
		}
		const rejected = new Set<string>();
		for (let guard = 0; guard < 24 && active() && isPcTurn(state); guard++) {
			const action: PlayerCombatAction = pcNextAction({ state: combatState(state), opts, flee: fleeing, deck: deckPrograms(state), rejected, exits, onNet });
			if (action.type === "end_turn") {
				if (fleeing) {
					fledTurns++;
					if (escaped()) {
						end("fled");
						outcome = "escaped";
						return;
					}
				}
			}
			let res: CombatResult;
			try {
				res = applyPlayerAction(combatState(state), rng, action, opts);
			} catch (e) {
				// Data the engine can't roll (a homebrew dice string…): treat it as refused and move on.
				res = { ...combatState(state), ok: false, error: e instanceof Error ? e.message : String(e), rolls: [], log: [], events: [] };
			}
			if (!res.ok) {
				if (action.type === "end_turn") break;
				rejected.add(actionKey(action));
				continue;
			}
			step(res);
			if (action.type === "cast" && action.deck && isCyber(state)) {
				const cy = cyberOf(state);
				cy.deckUses = { ...(cy.deckUses ?? {}), [action.spell]: (cy.deckUses?.[action.spell] ?? 0) + 1 };
			}
			if (action.type === "end_turn") return;
			const me = pc();
			if (me && me.hp <= 0) return;
		}
		// Safety: never leave the PC's turn hanging.
		if (active() && isPcTurn(state)) step(applyPlayerAction(combatState(state), rng, { type: "end_turn" }, fightOpts(state)));
	};

	/** Morale: thinking foes break when the fight turns (a WIS save, DC AUTO_MORALE_DC). Returns true if it left. */
	const breaks = (c: Combatant): boolean => {
		if (c.side !== "enemy" || isMindless(c.stats) || c.stats?.legendaryActions.length) return false;
		const enc = state.encounter!;
		const side = Object.values(enc.combatants).filter((k) => k.side === "enemy");
		const down = side.filter((k) => k.dead).length;
		const level = c.hp <= c.maxHp / 4 ? 2 : c.hp <= c.maxHp / 2 && down * 2 >= side.length ? 1 : 0;
		if (!level || (morale.get(c.id) ?? 0) >= level) return false;
		morale.set(c.id, level);
		const wis = c.stats ? (c.stats.saves.wis ?? abilityMod(c.stats.abilities.wis)) : 0;
		const r = roll(rng, `1d20${wis ? signed(wis) : ""}`, { label: `${c.name} morale (WIS save)`, actor: c.id, target: AUTO_MORALE_DC });
		rec.rolls++;
		if (r.success) return false;
		const surrender = (c.stats?.abilities.int ?? 0) >= 8 && !/beast/i.test(c.stats?.type ?? "");
		// Driving off a foe is beating it: its XP counts.
		state.encounter!.xpPool += c.stats?.xp ?? 0;
		rec.routed.push({ id: c.id, why: surrender ? "surrendered" : "fled", round: enc.round, hp: c.hp, maxHp: c.maxHp, seq: rec.beats.length });
		const map = state.maps[enc.mapId];
		const token = map?.entities.find((e) => e.id === c.entityId);
		const kept = surrender && token ? structuredClone(token) : undefined;
		step(removeCombatant(combatState(state), rng, c.id, surrender ? "surrendered" : "fled", fightOpts(state)));
		// Someone who gives up stays where they dropped their weapon (out of the fight); a runner is gone.
		if (kept) {
			delete kept.combatantId;
			kept.disposition = "neutral";
			state.maps[enc.mapId]?.entities.push(kept);
		}
		return true;
	};

	for (let guard = 0; guard < 2000 && active() && !outcome; guard++) {
		const enc = state.encounter!;
		if (enc.round > AUTO_FIGHT_MAX_ROUNDS || enc.round - rec.lastProgress >= AUTO_FIGHT_IDLE_ROUNDS + (fleeing ? AUTO_FLEE_TURNS : 0)) {
			end("ended");
			outcome = "stalemate";
			break;
		}
		const me = pc();
		if (!me) break;
		if (me.dead) break;
		if (me.hp <= 0 && !lethal) {
			end("defeat");
			outcome = "knocked_out";
			break;
		}
		if (me.hp <= 0 && (me.deathSaves?.successes ?? 0) >= 3 && !Object.values(enc.combatants).some((c) => c.side === "party" && c.id !== pcId && !c.dead)) {
			end("defeat");
			outcome = "defeat";
			break;
		}
		if (isPcTurn(state)) {
			pcTurn();
			continue;
		}
		const id = enc.order[enc.turnIndex];
		const c = enc.combatants[id];
		if (c && !c.dead && breaks(c)) continue;
		let res: CombatResult | undefined;
		try {
			res = autoMonsterTurn(combatState(state), rng, id, { ...fightOpts(state), endTurn: true });
		} catch {
			res = undefined; // a stat block the engine can't roll: the creature loses its turn
		}
		if (!res || !step(res)) step(endTurn(combatState(state), rng, fightOpts(state)));
	}

	// How it ended.
	const enc = state.encounter!;
	const me = enc.combatants[pcId];
	if (!outcome) {
		if (enc.status === "active") {
			end("ended");
			outcome = "stalemate";
		} else if (me?.dead) outcome = "dead";
		else if (enc.status === "victory") outcome = "victory";
		else if (enc.status === "fled") outcome = onNet && !activeRun(state) ? "dumped" : "escaped";
		else if (enc.status === "defeat") outcome = "defeat";
		else outcome = "stalemate";
	}
	if (me?.dead) outcome = "dead";
	rec.beats.push({ k: "end", outcome });

	const status = outcome === "victory" ? "victory" : outcome === "escaped" || outcome === "dumped" ? "fled" : outcome === "stalemate" ? "ended" : "defeat";
	const wrap = finishCombat(quiet, { status });

	// The PC-at-0 rule: knocked out, not killed.
	if (outcome === "knocked_out" || outcome === "defeat") {
		const ch = state.character;
		ch.hp = Math.max(1, ch.hp);
		ch.deathSaves = { successes: 0, failures: 0 };
		ch.conditions = ch.conditions.filter((k) => k.source !== "0 hp" && k.id !== "unconscious" && k.id !== "prone");
	}

	state.fight = {
		id: newId("fight"),
		mapId: enc.mapId,
		choice,
		outcome,
		rounds: rec.round,
		actors: rec.actors,
		beats: rec.beats,
		rolls: rec.rolls,
	} satisfies FightReplay;
	state.view = state.maps[enc.mapId] && state.activeMapId === enc.mapId ? "map" : state.view;

	return summary(state, rec, enc, before, deckBefore, outcome, choice, !!o.lethal, notes, wrap);
}

// ─── the DM's summary ──────────────────────────────────────────────────────

const OUTCOME_TEXT: Record<FightOutcome, string> = {
	victory: "VICTORY: every foe is down, fled or surrendered",
	defeat: "DEFEAT: the player's character went down and was left stable at 0 HP; they come round at 1 HP",
	knocked_out: "KNOCKED OUT (not dead): the player's character dropped and the fight was lost; they come round at 1 HP",
	dead: "DEAD: the player's character died",
	escaped: "ESCAPED: the player's character got away",
	dumped: "DUMPED: the trace completed and threw the PC out of the system mid-fight",
	stalemate: "BROKE OFF: neither side could finish it",
};

function summary(
	state: GameState,
	rec: Recorder,
	enc: NonNullable<GameState["encounter"]>,
	before: Character,
	deckBefore: Record<string, number>,
	outcome: FightOutcome,
	choice: "fight" | "run",
	lethal: boolean,
	notes: string[],
	wrap: string,
): string {
	const pcId = state.character.id;
	const n = (id: string) => (id === pcId ? `${rec.name(id)} (the PC)` : rec.name(id));
	const ch = state.character;
	const lines: string[] = [];
	lines.push(`AUTOMATIC FIGHT, resolved by the engine with real dice (${rec.rolls} rolls). The player watched it play out on the battle map. Do NOT call monster_turn/end_combat or re-roll anything: narrate it.`);
	lines.push(`Player's choice: ${choice === "run" ? "RUN (an escape attempt)" : "FIGHT"}${lethal ? " · marked LETHAL" : ""}. Outcome: ${OUTCOME_TEXT[outcome]}, after ${rec.round} round${rec.round === 1 ? "" : "s"}.`);

	// The PC.
	const spent: string[] = [];
	for (const i of before.inventory) {
		const now = ch.inventory.find((x) => x.id === i.id)?.quantity ?? 0;
		if (now < i.quantity) spent.push(`${i.quantity - now} × ${i.name}`);
	}
	const sc0 = before.spellcasting;
	const sc1 = ch.spellcasting;
	if (sc0 && sc1) {
		sc1.slotsUsed.forEach((u, i) => {
			const d = u - (sc0.slotsUsed[i] ?? 0);
			if (d > 0) spent.push(`${d} level-${i + 1} slot${d === 1 ? "" : "s"}`);
		});
		if (sc1.pact && sc0.pact && sc1.pact.used > sc0.pact.used) spent.push(`${sc1.pact.used - sc0.pact.used} pact slot(s)`);
	}
	for (const f of ch.features) {
		const was = before.features.find((x) => x.id === f.id)?.uses?.used ?? 0;
		if (f.uses && f.uses.used > was) spent.push(f.name.replace(/\s*\(.*\)\s*$/, ""));
	}
	const deckNow = isCyber(state) ? (cyberOf(state).deckUses ?? {}) : {};
	for (const [k, v] of Object.entries(deckNow)) if (v > (deckBefore[k] ?? 0)) spent.push(`${v - (deckBefore[k] ?? 0)} deck charge(s) of ${getSpell(k)?.name ?? k}`);
	const conds = ch.conditions.map((c) => c.id);
	lines.push(`${ch.name}: HP ${before.hp} → ${ch.hp}/${ch.maxHp}${spent.length ? `. Spent: ${spent.join(", ")}` : ""}${conds.length ? `. Conditions now: ${conds.join(", ")}` : ""}.`);
	if (outcome === "knocked_out")
		lines.push(
			"THE PC IS NOT DEAD (automatic fights knock out, they don't kill off-screen). Play a setback that fits the foes and the place: captured and bound, robbed and left for dead, dragged out by an ally, found by someone who wants something. Time passes (advance the clock) and they wake at 1 HP. Make it sting, then hand the player the next choice.",
		);

	// Highlights, in order.
	type H = { round: number; seq: number; text: string };
	const hl: H[] = [];
	const at = (x: { round: number; seq?: number }) => ({ round: x.round, seq: x.seq ?? 0 });
	for (const c of rec.crits) hl.push({ ...at(c), text: `${n(c.a)} lands a CRITICAL hit on ${n(c.d)} (${c.w}${c.dmg !== undefined ? `, ${c.dmg} damage` : ""})` });
	for (const b of rec.bigHits) if (!rec.crits.some((c) => c.a === b.a && c.d === b.d && c.round === b.round)) hl.push({ ...at(b), text: `${n(b.a)} hits ${n(b.d)} hard with ${b.w} (${b.n} damage)` });
	// Kills by the same hand in the same round read as one line.
	const kills: { round: number; seq: number; by?: string; victims: string[] }[] = [];
	for (const k of rec.kills) {
		const last = kills[kills.length - 1];
		if (last && last.round === k.round && last.by === k.by && k.victim !== pcId && !last.victims.includes(pcId)) last.victims.push(k.victim);
		else kills.push({ ...at(k), by: k.by, victims: [k.victim] });
	}
	for (const k of kills) {
		const party = enc.combatants[k.victims[0]]?.side === "party";
		hl.push({ round: k.round, seq: k.seq, text: k.victims[0] === pcId ? `${n(pcId)} DIES` : `${k.victims.map(n).join(", ")} ${k.victims.length > 1 ? "are" : "is"} ${party ? "killed" : "killed"}${k.by ? ` by ${n(k.by)}` : ""}` });
	}
	for (const d of rec.downs) hl.push({ ...at(d), text: `${n(d.id)} drops to 0 HP` });
	for (const r of rec.routed) hl.push({ ...at(r), text: `${n(r.id)} ${r.why === "surrendered" ? "SURRENDERS" : "flees"} at ${r.hp}/${r.maxHp} HP` });
	const spellCount = new Map<string, { round: number; seq: number; times: number; a: string; targets: number }>();
	for (const sp of rec.spells) {
		const k = `${sp.a}|${sp.s}`;
		const e = spellCount.get(k);
		if (e) {
			e.times++;
			e.targets += sp.targets;
		} else spellCount.set(k, { ...at(sp), times: 1, a: sp.a, targets: sp.targets });
	}
	for (const [k, sp] of spellCount) hl.push({ round: sp.round, seq: sp.seq, text: `${n(sp.a)} uses ${k.split("|")[1]}${sp.times > 1 ? ` ×${sp.times}` : ""}${sp.targets ? ` (${sp.targets} target${sp.targets === 1 ? "" : "s"})` : ""}` });
	for (const i of rec.items) hl.push({ ...at(i), text: `${n(pcId)} uses ${i.s}` });
	for (const f of rec.feats) hl.push({ ...at(f), text: `${n(pcId)} uses ${f.s}` });
	for (const m of rec.nearMisses.filter((x) => x.a === pcId || x.d === pcId).sort((a, b) => a.by - b.by).slice(0, 2)) hl.push({ ...at(m), text: `close call: ${n(m.a)}'s ${m.w} misses ${n(m.d)} by ${m.by}` });
	hl.sort((a, b) => a.seq - b.seq);
	if (hl.length) lines.push(`Highlights:\n${hl.slice(0, 16).map((h) => `- R${h.round}: ${h.text}`).join("\n")}`);

	// Everyone else.
	let dealt = 0;
	let taken = 0;
	for (let i = 0; i < rec.beats.length; i++) {
		const b = rec.beats[i];
		if (b.k !== "dmg") continue;
		if (b.d === pcId) taken += b.n;
	}
	const pcAttacks = rec.beats.filter((b): b is Extract<FightBeat, { k: "atk" }> => b.k === "atk" && b.a === pcId);
	const pcHits = pcAttacks.filter((b) => b.hit).length;
	// Damage the PC dealt: damage beats right after the PC's attacks or spells.
	let lastActor: string | undefined;
	for (const b of rec.beats) {
		if (b.k === "atk" || b.k === "spell") lastActor = b.a;
		else if (b.k === "turn") lastActor = undefined;
		else if (b.k === "dmg" && lastActor === pcId && b.d !== pcId) dealt += b.n;
	}
	lines.push(`The PC: ${pcAttacks.length ? `${pcHits}/${pcAttacks.length} attacks hit, ` : ""}~${dealt} damage dealt, ${taken} taken.`);
	const foes = rec.actors.filter((a) => a.side === "enemy");
	const allies = rec.actors.filter((a) => a.side === "party" && a.id !== pcId);
	const fate = (a: FightReplayActor) => {
		const c = enc.combatants[a.id];
		const r = rec.routed.find((x) => x.id === a.id);
		if (r) return r.why;
		if (!c) return "left the fight";
		if (c.dead) return "dead";
		return `${c.hp}/${c.maxHp} HP`;
	};
	if (foes.length) lines.push(`Foes: ${foes.map((a) => `${a.name} [${a.id}] ${fate(a)}`).join("; ")}.`);
	if (allies.length) lines.push(`Allies: ${allies.map((a) => `${a.name} ${fate(a)}`).join("; ")}.`);

	const uniq = [...new Set(notes.filter(Boolean))];
	if (uniq.length) lines.push(`Engine notes (act on these):\n${uniq.slice(0, 14).join("\n")}`);
	const wrapLines = wrap.split("\n").filter((l) => /XP|come round|comes round|get up|gets up/i.test(l));
	if (wrapLines.length) lines.push(wrapLines.join("\n"));
	if (state.settings.structure.leveling !== "xp" && outcome === "victory") lines.push("Milestone leveling: no XP; call level_up_available if this fight was a milestone.");
	lines.push(
		"NOW: narrate the fight as ONE short, vivid scene in the campaign's tone, built on the highlights above (the turning points and what it cost), not a blow-by-blow; don't contradict the outcome or repeat numbers the map showed. Then the aftermath (loot via give_item from the fallen, prisoners, what the noise drew), then suggest_actions.",
	);
	return lines.join("\n");
}
