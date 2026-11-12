import type { Character, Combatant, Feature, InventoryItem, MonsterStats, PlayerCombatAction, SpellInfo } from "../../game/types";
import { abilityMod, parseNotation, Rng } from "../dice";
import { evaluateAttack } from "./attack";
import { type Ctx, pcProfile, run, saveBonus } from "./core";
import {
	areHostile,
	canEndAt,
	COVER_AC,
	distanceFeet,
	entityFor,
	footprintOf,
	footprintsSee,
	inBounds,
	isIncapacitated,
	isPassableTile,
	livingCombatants,
	moveContext,
	type Point,
	searchPath,
	SQUARE_FEET,
	standUpCost,
	stepCost,
	tileAt,
} from "./grid";
import { builtinFeatureFor, builtinItem } from "./player";
import { type AttackProfile, averageDamage, characterLevel, isRangedWeapon, monsterAttackProfile, pcAttackProfile } from "./profile";
import { spellArea, spellAttackProfile, spellDamageDice, spellRangeFeet } from "./spells";
import type { CombatOptions, CombatState, PcCombatProfile } from "./types";

/**
 * The player character's policy for AUTOMATIC fights (lib/dm/autofight.ts
 * drives the loop). Pure: given the live CombatState it returns the PC's next
 * action; the caller applies it through `applyPlayerAction` and asks again
 * until `end_turn`. Actions the engine rejected are passed back in `rejected`
 * so the policy falls through to its next idea (out of ammo, no slot, …).
 *
 * The policy: get up if prone; drink a potion / Second Wind / heal when low;
 * otherwise pick the (option, target) with the best expected damage, weighted
 * toward the most dangerous foe, finishing blows and foes threatening hurt
 * allies; leveled spells only when they beat the at-will options clearly
 * and the fight isn't nearly over ("strong options early"); Action Surge
 * early; an off-hand attack with a spare light weapon; walk or Dash into
 * range. When fleeing: Disengage/Dash toward the nearest way out.
 */

export interface DeckProgram {
	spell: SpellInfo;
	attackBonus: number;
	saveDc: number;
}

export interface PcPolicyInput {
	state: CombatState;
	opts: CombatOptions;
	/** Try to get away instead of fighting. */
	flee: boolean;
	/** Root Access: built-in deck programs with charges left (run without RAM). */
	deck?: DeckProgram[];
	/** Actions the engine refused this turn (keys from `actionKey`). */
	rejected: Set<string>;
	/** Squares that lead off the map (links to other maps); the map's border counts too. */
	exits?: Point[];
	/** Root Access: the fight is in a network (net-only programs work there and only there). */
	onNet?: boolean;
}

export function actionKey(a: PlayerCombatAction): string {
	return a.type === "move" ? "move" : JSON.stringify(a);
}

const END: PlayerCombatAction = { type: "end_turn" };

/** Creatures that never run or surrender: the dead, machines, ICE, oozes, swarms. */
export function isMindless(stats: MonsterStats | undefined): boolean {
	if (!stats) return false;
	if (stats.index.startsWith("c-ice-") || stats.index === "c-den-turret") return true;
	return /undead|construct|ooze|swarm|plant/i.test(stats.type) || stats.abilities.int <= 3;
}

/** Chance that a d20 + toHit meets `ac` (nat 1 misses, nat 20 hits). */
export function hitChance(toHit: number, ac: number, adv?: "advantage" | "disadvantage"): number {
	const p = Math.min(0.95, Math.max(0.05, (21 - (ac - toHit)) / 20));
	return adv === "advantage" ? 1 - (1 - p) ** 2 : adv === "disadvantage" ? p * p : p;
}

function advOf(adv: string[], dis: string[]): "advantage" | "disadvantage" | undefined {
	return adv.length && !dis.length ? "advantage" : dis.length && !adv.length ? "disadvantage" : undefined;
}

/** A foe's damage per round, roughly (best stat-block plan, 60% hit rate). */
export function threatOf(c: Combatant): number {
	if (!c.stats) return 5;
	let best = 0;
	for (const a of c.stats.actions) {
		if (a.multiattack?.length) {
			let sum = 0;
			for (const p of a.multiattack) {
				const sub = c.stats.actions.find((x) => x.name.toLowerCase() === p.action.toLowerCase());
				if (sub?.attack) sum += averageDamage(monsterAttackProfile(sub.attack).damage) * p.count;
			}
			best = Math.max(best, sum);
		} else if (a.attack) best = Math.max(best, averageDamage(monsterAttackProfile(a.attack).damage));
		else if (a.save?.damage?.length) best = Math.max(best, averageDamage(a.save.damage) * 0.7);
	}
	return best * 0.6;
}

/** Dice the engine can roll ("1d8+MOD" placeholders can't be: those spells are the DM's). */
function parses(dice: string): boolean {
	try {
		parseNotation(dice);
		return true;
	} catch {
		return false;
	}
}

function lookup(opts: CombatOptions, index: string): SpellInfo | undefined {
	if (!opts.spells) return undefined;
	return typeof opts.spells === "function" ? opts.spells(index) : opts.spells[index];
}

function castCost(spell: SpellInfo): "action" | "bonus" | undefined {
	const ct = spell.castingTime.toLowerCase();
	if (ct.includes("reaction")) return undefined;
	if (ct.includes("bonus")) return "bonus";
	if (ct.includes("action")) return "action";
	return undefined;
}

/** Lowest slot level ≥ `level` the character can still spend (0 for cantrips), or undefined. */
export function slotFor(ch: Character, level: number): number | undefined {
	if (level === 0) return 0;
	const sc = ch.spellcasting;
	if (!sc) return undefined;
	for (let l = level; l <= 9; l++) {
		if ((sc.slots[l - 1] ?? 0) - (sc.slotsUsed[l - 1] ?? 0) > 0) return l;
		if (sc.pact && sc.pact.level === l && sc.pact.used < sc.pact.max) return l;
	}
	return undefined;
}

/** Spells the character can cast in combat right now (known, prepared and cantrips; deduplicated). */
function castable(ch: Character, opts: CombatOptions, onNet = false): SpellInfo[] {
	const sc = ch.spellcasting;
	if (!sc) return [];
	const ids = new Set<string>();
	for (const k of sc.classes) for (const id of [...k.cantrips, ...k.prepared, ...k.known]) ids.add(id);
	const out: SpellInfo[] = [];
	for (const id of ids) {
		const s = lookup(opts, id);
		if (s && castCost(s) && !s.concentration && (s.scope !== "net" || onNet)) out.push(s);
	}
	return out;
}

function healOfItem(item: InventoryItem, state: CombatState, opts: CombatOptions) {
	if (item.quantity <= 0) return undefined;
	const o = opts.onUseItem?.(item, state) ?? builtinItem(item.name);
	return o?.heal ? { item, cost: o.cost ?? "action" } : undefined;
}

function healOfFeature(f: Feature, ch: Character, state: CombatState, opts: CombatOptions) {
	if (f.uses && f.uses.used >= f.uses.max) return undefined;
	const o = opts.onUseFeature?.(f, state) ?? builtinFeatureFor(ch, f.name);
	return o?.heal ? { f, cost: o.cost ?? "action" } : undefined;
}

/** Healing the PC could still use: potions/medkits, Second Wind, healing spells. */
export function healOptions(state: CombatState, opts: CombatOptions, onNet = false): { action: PlayerCombatAction; cost: string }[] {
	const ch = state.character;
	if (!ch) return [];
	const out: { action: PlayerCombatAction; cost: string }[] = [];
	for (const i of ch.inventory) {
		const h = healOfItem(i, state, opts);
		if (h) out.push({ action: { type: "use_item", itemId: i.id }, cost: h.cost });
	}
	for (const f of ch.features) {
		const h = healOfFeature(f, ch, state, opts);
		if (h) out.push({ action: { type: "use_feature", featureId: f.id }, cost: h.cost });
	}
	for (const s of castable(ch, opts, onNet)) {
		if (!s.heal) continue;
		const slot = slotFor(ch, s.level);
		if (slot === undefined) continue;
		const base = Object.entries(s.heal.bySlotLevel).sort((a, b) => Number(a[0]) - Number(b[0])).find(([k]) => Number(k) >= slot)?.[1];
		if (base && !/^\d+$/.test(base) && !parses(base)) continue;
		out.push({ action: { type: "cast", spell: s.index, slotLevel: slot, targetIds: [ch.id] }, cost: castCost(s)! });
	}
	return out;
}

// ─── geometry ───────────────────────────────────────────────────────────────

/** Moves a footprint can make, cut to the turn's budget, ending where it may stop. */
function truncate(ctx: Ctx, id: string, path: Point[], budget: number): Point[] {
	const mc = moveContext(ctx.enc, ctx.map, id);
	let cost = 0;
	let lastOk = -1;
	for (let i = 0; i < path.length; i++) {
		cost += stepCost(mc, path[i].x, path[i].y);
		if (cost > budget) break;
		if (canEndAt(mc, path[i].x, path[i].y)) lastOk = i;
	}
	return path.slice(0, lastOk + 1);
}

interface Pos {
	/** Path to walk first (empty: already there). */
	path: Point[];
}

/**
 * Where the PC can attack `targetId` with a reach/range of `want` feet (and
 * sight): already there, or a path within the movement left. Ranged options
 * prefer squares no hostile is next to.
 */
function positionFor(ctx: Ctx, pc: Combatant, targetId: string, want: number, ranged: boolean): Pos | undefined {
	const fa = footprintOf(ctx.enc, ctx.map, pc.id);
	const ft = footprintOf(ctx.enc, ctx.map, targetId);
	if (!fa || !ft) return undefined;
	const ok = (p: Point) => distanceFeet({ ...p, size: fa.size }, ft) <= want && footprintsSee(ctx.map, { ...p, size: fa.size }, ft);
	if (ok(fa)) return { path: [] };
	const budget = pc.turn.movementLeft - standUpCost(pc);
	if (budget < SQUARE_FEET || isIncapacitated(pc)) return undefined;
	const mc = moveContext(ctx.enc, ctx.map, pc.id);
	const threatened = (p: Point) =>
		livingCombatants(ctx.enc).some((o) => areHostile(pc, o) && !isIncapacitated(o) && distanceFeet({ ...p, size: fa.size }, footprintOf(ctx.enc, ctx.map, o.id) ?? { x: -99, y: -99, size: 1 }) <= 5);
	const goal = ranged ? (p: Point) => ok(p) && !threatened(p) : ok;
	const res = searchPath(mc, fa, goal, (p) => Math.max(0, distanceFeet({ ...p, size: fa.size }, ft) - want), budget) ?? (ranged ? searchPath(mc, fa, ok, () => 0, budget) : null);
	return res ? { path: res.path } : undefined;
}

/** A step toward the target (as far as the movement left goes). */
function approachPath(ctx: Ctx, pc: Combatant, targetId: string, want: number): Point[] {
	const fa = footprintOf(ctx.enc, ctx.map, pc.id);
	const ft = footprintOf(ctx.enc, ctx.map, targetId);
	if (!fa || !ft) return [];
	const mc = moveContext(ctx.enc, ctx.map, pc.id);
	const res = searchPath(
		mc,
		fa,
		(p) => distanceFeet({ ...p, size: fa.size }, ft) <= want,
		(p) => Math.max(0, distanceFeet({ ...p, size: fa.size }, ft) - want),
		Math.max(pc.speed * 6, SQUARE_FEET * (ctx.map.width + ctx.map.height) * 2),
	);
	if (!res?.path.length) return [];
	return truncate(ctx, pc.id, res.path, pc.turn.movementLeft - standUpCost(pc));
}

/** Squares that get the PC away: map links, else the passable border. */
export function isWayOut(map: CombatState["map"], p: Point, exits?: Point[]): boolean {
	if (exits?.some((e) => e.x === p.x && e.y === p.y)) return true;
	if (!inBounds(map, p.x, p.y) || !isPassableTile(tileAt(map, p.x, p.y))) return false;
	return p.x === 0 || p.y === 0 || p.x === map.width - 1 || p.y === map.height - 1;
}

function fleePath(ctx: Ctx, pc: Combatant, exits?: Point[]): Point[] {
	const fa = footprintOf(ctx.enc, ctx.map, pc.id);
	if (!fa) return [];
	const foes = livingCombatants(ctx.enc).filter((o) => areHostile(pc, o) && !isIncapacitated(o));
	const foeFps = foes.map((o) => footprintOf(ctx.enc, ctx.map, o.id)).filter((f): f is NonNullable<typeof f> => !!f);
	const near = (p: Point) => Math.min(Infinity, ...foeFps.map((f) => distanceFeet({ ...p, size: fa.size }, f)));
	const mc = moveContext(ctx.enc, ctx.map, pc.id);
	const limit = SQUARE_FEET * (ctx.map.width + ctx.map.height) * 3;
	// A way out the PC reaches before the foes (closer to it than any of them), else any way out, else away.
	const res =
		searchPath(mc, fa, (p) => isWayOut(ctx.map, p, exits) && near(p) > 10, () => 0, limit) ??
		searchPath(mc, fa, (p) => isWayOut(ctx.map, p, exits), () => 0, limit);
	const budget = pc.turn.movementLeft - standUpCost(pc);
	if (res?.path.length) return truncate(ctx, pc.id, res.path, budget);
	// No way out at all: the reachable square farthest from the foes.
	const away = searchPath(mc, fa, (p) => near(p) >= near(fa) + budget, (p) => Math.max(0, near(fa) + budget - near(p)), budget);
	return away?.path ?? [];
}

// ─── offence ───────────────────────────────────────────────────────────────

interface Pick {
	action: PlayerCombatAction;
	value: number;
	pos: Pos;
	leveled: boolean;
	/** Expected damage (for the "worth a slot" check). */
	dmg: number;
}

/** How much of a damage type gets through (immune 0, resistant ½, vulnerable 2). */
function typeFactor(foe: Combatant, type: string | undefined): number {
	const st = foe.stats;
	if (!st || !type) return 1;
	if (st.immunities.includes(type as never)) return 0;
	if (st.resistances.includes(type as never)) return 0.5;
	if (st.vulnerabilities.includes(type as never)) return 2;
	return 1;
}

function valueOf(foe: Combatant, dmg: number, allyHurt: boolean, moving: boolean): number {
	const danger = 1 + Math.log2(1 + (foe.stats?.xp ?? 25) / 50) * 0.6 + threatOf(foe) / 20;
	const kill = dmg >= foe.hp ? 1.5 : 1;
	return Math.min(dmg, foe.hp + 3) * danger * kill * (allyHurt ? 1.3 : 1) * (moving ? 0.92 : 1);
}

function offence(ctx: Ctx, inp: PcPolicyInput, pc: Combatant, ch: Character, profile: PcCombatProfile): Pick | undefined {
	const t = pc.turn;
	const foes = livingCombatants(ctx.enc).filter((o) => areHostile(pc, o) && !entityFor(ctx.enc, ctx.map, o.id)?.hidden);
	if (!foes.length) return undefined;
	const allies = livingCombatants(ctx.enc).filter((o) => o.side === pc.side && o.id !== pc.id && o.hp < o.maxHp / 2);
	const nextToHurtAlly = (f: Combatant) => {
		const ff = footprintOf(ctx.enc, ctx.map, f.id);
		return !!ff && allies.some((a) => {
			const af = footprintOf(ctx.enc, ctx.map, a.id);
			return !!af && distanceFeet(ff, af) <= 5;
		});
	};
	const picks: Pick[] = [];
	const reject = (a: PlayerCombatAction) => inp.rejected.has(actionKey(a));
	const movesOk = !inp.rejected.has("move");

	// Weapons (and the unarmed strike when no melee weapon is at hand).
	const attacks = t.attacksLeft > 0 ? t.attacksLeft : t.action ? profile.attacksPerAction : 0;
	if (attacks > 0) {
		const weapons = ch.inventory.filter((i) => i.weapon && i.quantity > 0);
		const melee = weapons.filter((i) => !isRangedWeapon(i));
		const list: (InventoryItem | undefined)[] = [...weapons];
		if (!melee.some((i) => i.equipped)) list.push(undefined);
		for (const item of list) {
			const ap: AttackProfile = pcAttackProfile(ch, profile, item);
			const ranged = ap.kind === "ranged";
			const want = ranged ? (ap.range?.normal ?? 5) : ap.reach;
			for (const f of foes) {
				const action: PlayerCombatAction = { type: "attack", targetId: f.id, ...(item ? { itemId: item.id } : {}) };
				if (reject(action)) continue;
				const pos = positionFor(ctx, pc, f.id, want, ranged);
				if (!pos || (pos.path.length && !movesOk)) continue;
				let p = hitChance(ap.toHit, f.ac);
				if (!pos.path.length) {
					const ev = evaluateAttack(ctx, pc.id, f.id, ap);
					if (typeof ev === "string") continue;
					p = hitChance(ap.toHit, f.ac + COVER_AC[ev.cover], advOf(ev.advantage, ev.disadvantage));
				}
				const dmg = attacks * p * averageDamage(ap.damage) * typeFactor(f, ap.damage[0]?.type) * (item?.equipped ? 1 : 0.97);
				if (dmg <= 0) continue;
				picks.push({ action, value: valueOf(f, dmg, nextToHurtAlly(f), pos.path.length > 0), pos, leveled: false, dmg });
			}
		}
	}

	// Spells and programs that deal damage (no concentration: those need the DM).
	const lvl = characterLevel(ch);
	const mod = profile.spellcastingAbility ? abilityMod(ch.abilities[profile.spellcastingAbility]) : 0;
	const atkBonus = profile.spellAttackBonus ?? profile.proficiencyBonus + mod;
	const dc = profile.spellSaveDc ?? 8 + profile.proficiencyBonus + mod;
	const spellPicks = (s: SpellInfo, slot: number, nums: { attackBonus: number; saveDc: number }, deck?: DeckProgram) => {
		const cost = castCost(s);
		if (!cost || (cost === "action" ? !t.action || t.attacksLeft > 0 : !t.bonusAction)) return;
		if (!s.damage || (!s.attack && !s.save && !s.damage)) return;
		const dice = spellDamageDice(s, slot, lvl);
		if (!dice || !parses(dice)) return;
		const avg = averageDamage([{ dice }]);
		const leveled = s.level > 0 && !deck;
		const range = Math.max(5, spellRangeFeet(s));
		const deckArg = deck ? { deck: { attackBonus: deck.attackBonus, saveDc: deck.saveDc } } : {};
		if (s.area) {
			// Centred on a foe (or toward it for self cones/lines), from where the PC stands; never on friends.
			for (const f of foes) {
				const ft = footprintOf(ctx.enc, ctx.map, f.id);
				if (!ft) continue;
				let area: { targetIds: string[] };
				try {
					area = spellArea(ctx, pc.id, s, { x: ft.x, y: ft.y });
				} catch {
					continue;
				}
				const hit = area.targetIds.map((id) => ctx.enc.combatants[id]).filter((c) => c && !c.dead);
				if (hit.some((c) => !areHostile(pc, c))) continue;
				if (!hit.length) continue;
				let dmg = 0;
				let value = 0;
				for (const c of hit) {
					const fail = s.save ? Math.min(0.95, Math.max(0.05, (nums.saveDc - 1 - saveBonus(ctx, c, s.save.ability)) / 20)) : 1;
					const d = avg * (fail + (1 - fail) * (s.save?.halfOnSuccess ? 0.5 : 0)) * typeFactor(c, s.damage?.type);
					dmg += d;
					value += valueOf(c, d, nextToHurtAlly(c), false);
				}
				const action: PlayerCombatAction = { type: "cast", spell: s.index, slotLevel: slot, point: { x: ft.x, y: ft.y }, ...deckArg };
				if (dmg > 0 && !reject(action)) picks.push({ action, value, pos: { path: [] }, leveled, dmg });
			}
			return;
		}
		for (const f of foes) {
			const action: PlayerCombatAction = { type: "cast", spell: s.index, slotLevel: slot, targetIds: [f.id], ...deckArg };
			if (reject(action)) continue;
			const pos = positionFor(ctx, pc, f.id, range, s.attack !== "melee");
			if (!pos || (pos.path.length && !movesOk)) continue;
			let p = 1;
			if (s.attack) {
				const ap = spellAttackProfile(s, nums.attackBonus, [{ dice, type: s.damage!.type }]);
				p = hitChance(nums.attackBonus, f.ac);
				if (!pos.path.length) {
					const ev = evaluateAttack(ctx, pc.id, f.id, ap);
					if (typeof ev === "string") continue;
					p = hitChance(nums.attackBonus, f.ac + COVER_AC[ev.cover], advOf(ev.advantage, ev.disadvantage));
				}
			} else if (s.save) {
				const fail = Math.min(0.95, Math.max(0.05, (nums.saveDc - 1 - saveBonus(ctx, f, s.save.ability)) / 20));
				p = fail + (1 - fail) * (s.save.halfOnSuccess ? 0.5 : 0);
			}
			const dmg = avg * p * typeFactor(f, s.damage!.type);
			if (dmg <= 0) continue;
			picks.push({ action, value: valueOf(f, dmg, nextToHurtAlly(f), pos.path.length > 0), pos, leveled, dmg });
		}
	};
	for (const s of castable(ch, inp.opts, inp.onNet)) {
		if (s.heal) continue;
		const slot = slotFor(ch, s.level);
		if (slot === undefined) continue;
		spellPicks(s, slot, { attackBonus: atkBonus, saveDc: dc });
	}
	for (const d of inp.deck ?? []) if (castCost(d.spell) && !d.spell.concentration && (d.spell.scope !== "net" || inp.onNet)) spellPicks(d.spell, d.spell.level, d, d);

	if (!picks.length) return undefined;
	// Strong options early: a slot is worth it when it clearly beats the at-will options and the fight isn't nearly won.
	const atWill = picks.filter((p) => !p.leveled);
	const bestAtWill = atWill.reduce((m, p) => Math.max(m, p.dmg), 0);
	const foesHp = foes.reduce((n, f) => n + f.hp, 0);
	const usable = picks.filter((p) => !p.leveled || (p.dmg >= bestAtWill * 1.25 && foesHp > bestAtWill * 1.5));
	return (usable.length ? usable : atWill).sort((a, b) => b.value - a.value)[0];
}

// ─── the policy ────────────────────────────────────────────────────────────

function decide(ctx: Ctx, inp: PcPolicyInput): PlayerCombatAction {
	const ch = ctx.character;
	if (!ch) return END;
	const pc = ctx.enc.combatants[ch.id];
	const profile = pcProfile(ctx);
	if (!pc || !profile || pc.dead || pc.hp <= 0) return END;
	const t = pc.turn;
	const ok = (a: PlayerCombatAction | undefined): a is PlayerCombatAction => !!a && !inp.rejected.has(actionKey(a));
	const state: CombatState = { encounter: ctx.enc, map: ctx.map, character: ch };
	const foes = livingCombatants(ctx.enc).filter((o) => areHostile(pc, o));
	if (!foes.length) return END;

	// Up off the floor first (moving would do it too, but a prone attacker swings at disadvantage).
	if (pc.conditions.some((k) => k.id === "prone") && t.movementLeft >= Math.floor(pc.speed / 2) && ok({ type: "stand_up" })) return { type: "stand_up" };

	// Hurt: patch up (bonus-action potions and Second Wind first; an action on it only when it's bad).
	if (pc.hp <= pc.maxHp * 0.4) {
		const heals = healOptions(state, inp.opts, inp.onNet).filter((h) => ok(h.action));
		const bonus = heals.find((h) => h.cost === "bonus" || h.cost === "free");
		if (bonus && t.bonusAction) return bonus.action;
		const action = heals.find((h) => h.cost === "action");
		if (action && t.action && t.attacksLeft === 0 && pc.hp <= pc.maxHp * 0.25) return action.action;
	}

	if (inp.flee) {
		const adjacent = foes.some((o) => {
			if (isIncapacitated(o)) return false;
			const fa = footprintOf(ctx.enc, ctx.map, pc.id);
			const fo = footprintOf(ctx.enc, ctx.map, o.id);
			return !!fa && !!fo && distanceFeet(fa, fo) <= 5;
		});
		const fa = footprintOf(ctx.enc, ctx.map, pc.id);
		if (fa && isWayOut(ctx.map, fa, inp.exits)) return END;
		const cunning = !!profile.cunningAction;
		if (adjacent && !t.disengaged && (t.action || (cunning && t.bonusAction)) && ok({ type: "disengage" })) return { type: "disengage" };
		if (!t.dashed && (t.action || (cunning && t.bonusAction)) && ok({ type: "dash" })) return { type: "dash" };
		if (!inp.rejected.has("move") && t.movementLeft >= SQUARE_FEET) {
			const path = fleePath(ctx, pc, inp.exits);
			if (path.length) return { type: "move", path };
		}
		if (t.action && ok({ type: "dodge" })) return { type: "dodge" };
		return END;
	}

	// Action Surge early, once the first action is spent.
	if (!t.action && t.attacksLeft === 0) {
		const surge = ch.features.find((f) => (!f.uses || f.uses.used < f.uses.max) && (inp.opts.onUseFeature?.(f, state) ?? builtinFeatureFor(ch, f.name))?.grantAction);
		const left = foes.reduce((n, f) => n + f.hp, 0);
		if (surge && left > 8 && ok({ type: "use_feature", featureId: surge.id })) return { type: "use_feature", featureId: surge.id };
	}

	const pick = offence(ctx, inp, pc, ch, profile);
	if (pick) return pick.pos.path.length ? { type: "move", path: pick.pos.path } : pick.action;

	// Off-hand attack with a spare light melee weapon after the Attack action.
	if (pc.usage.__turn_attacked && t.bonusAction) {
		const light = ch.inventory.find((i) => i.equipped && i.weapon && !isRangedWeapon(i) && i.weapon.properties.some((p) => p.toLowerCase() === "light"));
		if (light) {
			const fa = footprintOf(ctx.enc, ctx.map, pc.id);
			for (const f of foes) {
				const fo = footprintOf(ctx.enc, ctx.map, f.id);
				const a: PlayerCombatAction = { type: "attack", targetId: f.id, itemId: light.id, offHand: true };
				if (fa && fo && distanceFeet(fa, fo) <= 5 && ok(a)) return a;
			}
		}
	}

	// Nothing in reach this turn (the action is still unspent): walk, then Dash, toward the most dangerous foe the PC can get to.
	if (t.action && t.attacksLeft === 0 && !inp.rejected.has("move")) {
		const reach = Math.max(5, ...ch.inventory.filter((i) => i.weapon && !isRangedWeapon(i)).map((i) => (i.weapon!.properties.some((p) => p.toLowerCase() === "reach") ? 10 : 5)));
		const targets = foes.filter((f) => !isIncapacitated(f) || f.hp > 0).sort((a, b) => threatOf(b) - threatOf(a));
		for (const f of targets) {
			if (t.movementLeft >= SQUARE_FEET) {
				const path = approachPath(ctx, pc, f.id, reach);
				if (path.length) return { type: "move", path };
			}
			if (t.action && t.attacksLeft === 0 && !t.dashed && ok({ type: "dash" })) return { type: "dash" };
		}
	}
	if (t.action && t.attacksLeft === 0 && ok({ type: "dodge" })) return { type: "dodge" };
	return END;
}

/** The PC's next action in an automatic fight (end_turn when there's nothing more to do). */
export function pcNextAction(inp: PcPolicyInput): PlayerCombatAction {
	let out: PlayerCombatAction = END;
	const res = run(inp.state, new Rng(0), inp.opts, (ctx) => {
		out = decide(ctx, inp);
	});
	return res.ok ? out : END;
}

/**
 * The fight is clearly lost: the PC is low, has no healing left, and the foes
 * will drop them well before the party can finish the foes.
 */
export function shouldFlee(state: CombatState, opts: CombatOptions): boolean {
	const ch = state.character;
	if (!ch) return false;
	const pc = state.encounter.combatants[ch.id];
	if (!pc || pc.hp <= 0 || pc.hp > pc.maxHp * 0.35) return false;
	if (healOptions(state, opts).length) return false;
	const living = livingCombatants(state.encounter);
	const foes = living.filter((o) => areHostile(pc, o) && !isIncapacitated(o));
	if (!foes.length) return false;
	const allies = living.filter((o) => o.side === pc.side && o.id !== pc.id);
	const profile = opts.profile;
	const weapon = Math.max(
		1,
		...ch.inventory.filter((i) => i.weapon && i.quantity > 0).map((i) => (profile ? averageDamage(pcAttackProfile(ch, profile, i).damage) : 4)),
	);
	const partyDpr = weapon * (profile?.attacksPerAction ?? 1) * 0.6 + allies.reduce((n, a) => n + threatOf(a), 0);
	const foesDpr = foes.reduce((n, f) => n + threatOf(f), 0) / (1 + allies.length);
	const roundsToWin = foes.reduce((n, f) => n + f.hp, 0) / Math.max(1, partyDpr);
	const roundsToDrop = pc.hp / Math.max(0.5, foesDpr);
	return roundsToDrop <= 1.5 && roundsToDrop < roundsToWin;
}
