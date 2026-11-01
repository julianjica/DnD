import type { Combatant, ConditionId, MonsterAction } from "../../game/types";
import type { Rng } from "../dice";
import { evaluateAttack, performAttack } from "./attack";
import { addCondition, applyDamage, type Ctx, doRoll, emit, fail, getC, revealIfHidden, rollSave, run, say } from "./core";
import { endTurnCtx } from "./encounter";
import {
	areHostile,
	canEndAt,
	distanceFeet,
	findPath,
	footprintOf,
	isIncapacitated,
	livingCombatants,
	moveContext,
	type Point,
	searchPath,
	SQUARE_FEET,
	standUpCost,
	stepCost,
} from "./grid";
import { moveAlong } from "./movement";
import { type AttackProfile, averageDamage, monsterAttackProfile } from "./profile";
import type { CombatOptions, CombatResult, CombatState } from "./types";

export interface MonsterActInput {
	/** Name of an action / bonus action / legendary action from the stat block. */
	actionName?: string;
	targetIds?: string[];
	/** Destination square (top-left); pathed with A* within the movement budget. Moves before acting. */
	moveTo?: Point;
	/** Explicit path instead of moveTo. */
	path?: Point[];
	/** Move after acting instead of before. */
	moveAfter?: boolean;
}

/** Standard actions any creature can take (applied before movement). */
const GENERIC = ["dash", "disengage", "dodge"] as const;

const CONDITION_WORDS: ConditionId[] = [
	"blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed",
	"petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
];

function findAction(c: Combatant, name: string): { action: MonsterAction; list: "action" | "bonus" | "legendary" } | undefined {
	const n = name.trim().toLowerCase();
	const s = c.stats;
	if (!s) return undefined;
	const lists: [MonsterAction[], "action" | "bonus" | "legendary"][] = [[s.actions, "action"], [s.bonusActions, "bonus"], [s.legendaryActions, "legendary"]];
	for (const [list, kind] of lists) {
		const a = list.find((x) => x.name.toLowerCase() === n) ?? list.find((x) => x.name.toLowerCase().startsWith(n));
		if (a) return { action: a, list: kind };
	}
	return undefined;
}

function legendaryCost(a: MonsterAction): number {
	const m = /costs?\s+(\d+)\s+actions?/i.exec(`${a.name} ${a.description}`);
	return m ? Number(m[1]) : 1;
}

function attackFor(ctx: Ctx, c: Combatant, a: MonsterAction, targetId: string): AttackProfile {
	const atk = a.attack!;
	if (atk.kind === "melee_or_ranged") {
		const melee = monsterAttackProfile(atk, false);
		const fa = footprintOf(ctx.enc, ctx.map, c.id);
		const ft = footprintOf(ctx.enc, ctx.map, targetId);
		if (fa && ft && distanceFeet(fa, ft) > melee.reach) return monsterAttackProfile(atk, true);
		return melee;
	}
	return monsterAttackProfile(atk);
}

/** Resolves one stat-block action (no economy spending). */
function resolveAction(ctx: Ctx, c: Combatant, a: MonsterAction, targetIds: string[], depth = 0): void {
	revealIfHidden(ctx, c);
	if (a.multiattack?.length && depth === 0) {
		say(ctx, `${c.name} uses ${a.name}.`);
		let ti = 0;
		let attacksMade = 0;
		for (const part of a.multiattack) {
			const sub = c.stats!.actions.find((x) => x.name.toLowerCase() === part.action.toLowerCase());
			if (!sub) {
				emit(ctx, { type: "needs_dm", text: `${c.name}'s multiattack includes "${part.action}", which has no stat entry.` });
				continue;
			}
			for (let i = 0; i < part.count; i++) {
				if (c.dead || isIncapacitated(c) || ctx.enc.status !== "active") return;
				if (sub.attack) {
					// Next living target that this attack can reach (targets cycle in the order given).
					let chosen: string | undefined;
					for (let k = 0; k < targetIds.length; k++) {
						const id = targetIds[(ti + k) % targetIds.length];
						const t = ctx.enc.combatants[id];
						if (!t || t.dead) continue;
						if (typeof evaluateAttack(ctx, c.id, id, attackFor(ctx, c, sub, id)) === "string") continue;
						chosen = id;
						ti = (ti + k) % targetIds.length;
						break;
					}
					if (!chosen) {
						say(ctx, `${c.name} has no valid target for ${sub.name}.`);
						continue;
					}
					performAttack(ctx, c.id, chosen, attackFor(ctx, c, sub, chosen));
					attacksMade++;
					applyRider(ctx, c, sub, chosen);
					if (targetIds.length > 1 && (ctx.enc.combatants[chosen]?.dead ?? true)) ti = (ti + 1) % targetIds.length;
				} else {
					resolveAction(ctx, c, sub, targetIds, depth + 1);
					attacksMade++;
				}
			}
		}
		if (attacksMade === 0) fail(`${c.name} cannot reach any target with ${a.name}.`);
		return;
	}
	if (a.attack) {
		const t = targetIds[0];
		if (!t) fail(`${a.name} needs a target.`);
		performAttack(ctx, c.id, t, attackFor(ctx, c, a, t));
		applyRider(ctx, c, a, t);
		return;
	}
	if (a.save) {
		if (!targetIds.length) fail(`${a.name} needs targets.`);
		say(ctx, `${c.name} uses ${a.name}.`);
		let parts: { amount: number; type: (typeof a.save.damage & {})[number]["type"] }[] = [];
		if (a.save.damage?.length) {
			parts = a.save.damage.map((d) => {
				const r = doRoll(ctx, d.dice, { label: `${a.name} damage (${d.type})`, actor: c.id });
				return { amount: Math.max(0, r.total), type: d.type };
			});
		}
		const failed: string[] = [];
		for (const id of targetIds) {
			const t = getC(ctx, id);
			if (t.dead) continue;
			const ok = rollSave(ctx, id, a.save.ability, a.save.dc, a.name);
			if (!ok) failed.push(t.name);
			if (parts.length) {
				const half = a.save.halfOnSuccess ?? true;
				const dealt = parts.map((p) => ({ type: p.type, amount: ok ? (half ? Math.floor(p.amount / 2) : 0) : p.amount }));
				if (dealt.some((p) => p.amount > 0)) applyDamage(ctx, id, dealt, { sourceId: c.id });
			}
		}
		if (failed.length && !parts.length) emit(ctx, { type: "needs_dm", text: `${failed.join(", ")} failed the save vs ${c.name}'s ${a.name}: ${a.description.slice(0, 300)}` });
		return;
	}
	say(ctx, `${c.name} uses ${a.name}.`);
	emit(ctx, { type: "needs_dm", text: `${c.name} uses ${a.name}: ${a.description.slice(0, 300)}` });
}

/** Attack riders ("DC 11 CON save or be poisoned"): roll the save, apply named conditions on failure. */
function applyRider(ctx: Ctx, c: Combatant, a: MonsterAction, targetId: string): void {
	const rider = a.attack?.save;
	if (!rider) return;
	const hitEv = [...ctx.events].reverse().find((e) => e.type === "attack" && e.attackerId === c.id);
	if (!hitEv || hitEv.type !== "attack" || hitEv.targetId !== targetId || !hitEv.hit) return;
	const t = ctx.enc.combatants[targetId];
	if (!t || t.dead) return;
	const ok = rollSave(ctx, targetId, rider.ability, rider.dc, a.name);
	if (ok) return;
	const text = rider.onFail ?? "";
	const conds = CONDITION_WORDS.filter((k) => new RegExp(`\\b${k}\\b`, "i").test(text));
	for (const k of conds) addCondition(ctx, targetId, { id: k, source: c.id, note: text.slice(0, 200) });
	if (!conds.length || /damage|until|escape/i.test(text)) emit(ctx, { type: "needs_dm", text: `${t.name} failed the save vs ${c.name}'s ${a.name}: ${text || a.description.slice(0, 200)}` });
}

function moveMonster(ctx: Ctx, c: Combatant, input: MonsterActInput): void {
	if (input.path?.length) {
		moveAlong(ctx, c.id, input.path);
		return;
	}
	if (input.moveTo) {
		const fp = footprintOf(ctx.enc, ctx.map, c.id);
		if (fp && fp.x === input.moveTo.x && fp.y === input.moveTo.y) return;
		const res = findPath(ctx.enc, ctx.map, c.id, input.moveTo, c.turn.movementLeft - standUpCost(c));
		if (!res) fail(`${c.name} cannot reach (${input.moveTo.x},${input.moveTo.y}) this turn.`);
		moveAlong(ctx, c.id, res.path);
	}
}

function doMonsterAct(ctx: Ctx, combatantId: string, input: MonsterActInput): void {
	if (ctx.enc.status !== "active") fail("Combat is not active.");
	const c = getC(ctx, combatantId);
	if (c.kind === "pc") fail("Use applyPlayerAction for the player character.");
	if (c.dead) fail(`${c.name} is dead.`);
	const isTurn = ctx.enc.order[ctx.enc.turnIndex] === c.id;
	const found = input.actionName ? findAction(c, input.actionName) : undefined;
	const generic = !found && input.actionName ? GENERIC.find((g) => g === input.actionName!.trim().toLowerCase()) : undefined;
	if (input.actionName && !found && !generic) fail(`${c.name} has no action named "${input.actionName}".`);
	const legendary = found?.list === "legendary";
	if (!isTurn && !legendary) fail(`It is not ${c.name}'s turn.`);
	if (isIncapacitated(c)) fail(`${c.name} is incapacitated.`);
	if (!isTurn && (input.moveTo || input.path)) fail("Only legendary actions can be taken outside the creature's turn, and they cannot include free movement.");

	if (generic) {
		if (!isTurn) fail(`It is not ${c.name}'s turn.`);
		if (!c.turn.action) fail(`${c.name} has already used its action.`);
		c.turn.action = false;
		if (generic === "dash") c.turn.movementLeft += c.speed;
		c.turn[generic === "dash" ? "dashed" : generic === "disengage" ? "disengaged" : "dodging"] = true;
		emit(ctx, { type: "action_used", combatantId: c.id, action: generic });
		say(ctx, `${c.name} takes the ${generic[0].toUpperCase()}${generic.slice(1)} action.`);
	}
	if (!input.moveAfter) moveMonster(ctx, c, input);
	if (found && !c.dead && !isIncapacitated(c) && ctx.enc.status === "active") {
		const a = found.action;
		if (legendary) {
			const cost = legendaryCost(a);
			if ((c.legendaryActionsLeft ?? 0) < cost) fail(`${c.name} has no legendary actions left.`);
			c.legendaryActionsLeft = (c.legendaryActionsLeft ?? 0) - cost;
		} else if (found.list === "bonus") {
			if (!c.turn.bonusAction) fail(`${c.name} has already used its bonus action.`);
			c.turn.bonusAction = false;
		} else {
			if (!c.turn.action) fail(`${c.name} has already used its action.`);
			c.turn.action = false;
		}
		const u = c.usage[a.name];
		if (a.usage?.type === "recharge") {
			if (u && u.charged === false) fail(`${a.name} has not recharged.`);
			c.usage[a.name] = { used: (u?.used ?? 0) + 1, charged: false };
		} else if (a.usage?.type === "per_day") {
			if ((u?.used ?? 0) >= (a.usage.times ?? 1)) fail(`${a.name} has no uses left today.`);
			c.usage[a.name] = { used: (u?.used ?? 0) + 1 };
		}
		emit(ctx, { type: "action_used", combatantId: c.id, action: a.name });
		resolveAction(ctx, c, a, input.targetIds ?? []);
	}
	if (input.moveAfter && !c.dead && ctx.enc.status === "active") moveMonster(ctx, c, input);
}

/**
 * Resolves a DM-chosen monster/NPC action: optional movement (A* to `moveTo`
 * or explicit `path`, provoking OAs), then the named action (attack,
 * multiattack, save action, or a text-only action → needs_dm). Legendary
 * actions may be used outside the creature's turn.
 */
export function monsterAct(state: CombatState, rng: Rng, combatantId: string, input: MonsterActInput, opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => doMonsterAct(ctx, combatantId, input));
}

// ─── Fallback AI ─────────────────────────────────────────────────────────

interface Plan {
	action: MonsterAction;
	/** Attack used for positioning. */
	positioning: AttackProfile | undefined;
	score: number;
}

function plans(c: Combatant): Plan[] {
	const out: Plan[] = [];
	const actions = c.stats?.actions ?? [];
	for (const a of actions) {
		if (a.usage?.type === "recharge" && c.usage[a.name]?.charged === false) continue;
		if (a.usage?.type === "per_day" && (c.usage[a.name]?.used ?? 0) >= (a.usage.times ?? 1)) continue;
		if (a.multiattack?.length) {
			let score = 0;
			let pos: AttackProfile | undefined;
			for (const p of a.multiattack) {
				const sub = actions.find((x) => x.name.toLowerCase() === p.action.toLowerCase());
				if (sub?.attack) {
					const ap = monsterAttackProfile(sub.attack);
					score += averageDamage(ap.damage) * p.count;
					pos ??= ap;
				}
			}
			if (pos) out.push({ action: a, positioning: pos, score });
		} else if (a.attack) {
			const ap = monsterAttackProfile(a.attack);
			out.push({ action: a, positioning: ap, score: averageDamage(ap.damage) });
		} else if (a.save?.damage?.length && a.usage?.type === "recharge") {
			out.push({ action: a, positioning: { name: a.name, kind: "ranged", toHit: 0, damage: [], reach: 5, range: { normal: 30 } }, score: averageDamage(a.save.damage) * 1.5 });
		}
	}
	return out.sort((x, y) => y.score - x.score);
}

/** Truncates a path to what the budget allows, ending on a square the mover may stop in. */
function truncatePath(ctx: Ctx, moverId: string, path: Point[], budget: number): Point[] {
	const mc = moveContext(ctx.enc, ctx.map, moverId);
	let cost = 0;
	let lastOk = -1;
	for (let i = 0; i < path.length; i++) {
		cost += stepCost(mc, path[i].x, path[i].y);
		if (cost > budget) break;
		if (canEndAt(mc, path[i].x, path[i].y)) lastOk = i;
	}
	return path.slice(0, lastOk + 1);
}

function inPosition(ctx: Ctx, c: Combatant, targetId: string, ap: AttackProfile): boolean {
	const fa = footprintOf(ctx.enc, ctx.map, c.id);
	const ft = footprintOf(ctx.enc, ctx.map, targetId);
	if (!fa || !ft) return false;
	const d = distanceFeet(fa, ft);
	return ap.kind === "melee" ? d <= ap.reach : d <= (ap.range?.normal ?? 5);
}

function approach(ctx: Ctx, c: Combatant, targetId: string, ap: AttackProfile): void {
	const ft = footprintOf(ctx.enc, ctx.map, targetId);
	const fa = footprintOf(ctx.enc, ctx.map, c.id);
	if (!ft || !fa) return;
	const want = ap.kind === "melee" ? ap.reach : (ap.range?.normal ?? 5);
	const mc = moveContext(ctx.enc, ctx.map, c.id);
	const res = searchPath(
		mc,
		fa,
		(p) => distanceFeet({ ...p, size: fa.size }, ft) <= want,
		(p) => Math.max(0, distanceFeet({ ...p, size: fa.size }, ft) - want),
		Math.max(c.speed * 4, SQUARE_FEET * (ctx.map.width + ctx.map.height)),
	);
	if (!res || !res.path.length) return;
	const steps = truncatePath(ctx, c.id, res.path, c.turn.movementLeft - standUpCost(c));
	if (steps.length) moveAlong(ctx, c.id, steps);
}

/**
 * Simple fallback AI: pick the nearest conscious hostile (downed PCs are left
 * alone unless `finishDowned`), use the best available plan (multiattack,
 * strongest attack, or a charged recharge breath weapon), move into
 * reach/range (Dashing if it cannot get there otherwise), act, and end the turn.
 */
export function autoMonsterTurn(
	state: CombatState,
	rng: Rng,
	combatantId: string,
	opts: CombatOptions & { endTurn?: boolean; finishDowned?: boolean } = {},
): CombatResult {
	return run(state, rng, opts, (ctx) => {
		if (ctx.enc.status !== "active") fail("Combat is not active.");
		const c = getC(ctx, combatantId);
		if (ctx.enc.order[ctx.enc.turnIndex] !== c.id) fail(`It is not ${c.name}'s turn.`);
		if (c.kind === "pc") fail("The player character is not AI-controlled.");
		act: {
			if (c.dead || isIncapacitated(c)) {
				say(ctx, `${c.name} cannot act.`);
				break act;
			}
			const fa = footprintOf(ctx.enc, ctx.map, c.id);
			const foes = livingCombatants(ctx.enc).filter((o) => areHostile(c, o) && (opts.finishDowned || o.hp > 0));
			if (!fa || !foes.length) {
				say(ctx, `${c.name} has no one to fight.`);
				break act;
			}
			const dist = (id: string) => distanceFeet(fa, footprintOf(ctx.enc, ctx.map, id)!);
			const target = foes.sort((x, y) => dist(x.id) - dist(y.id) || (x.kind === "pc" ? -1 : 1))[0];
			const options = plans(c);
			if (!options.length) {
				emit(ctx, { type: "needs_dm", text: `${c.name} has no attack the AI understands; the DM should describe its action.` });
				break act;
			}
			// Prefer the best plan; a recharge breath weapon only if the target is (or gets) within 30 ft.
			const plan = options[0];
			const ap = plan.positioning!;
			if (!inPosition(ctx, c, target.id, ap) && c.turn.movementLeft > 0) approach(ctx, c, target.id, ap);
			if (!inPosition(ctx, c, target.id, ap) && c.turn.action && !c.dead && !isIncapacitated(c)) {
				// Can't attack this turn: Dash toward the target instead.
				c.turn.action = false;
				c.turn.movementLeft += c.speed;
				c.turn.dashed = true;
				say(ctx, `${c.name} dashes.`);
				emit(ctx, { type: "action_used", combatantId: c.id, action: "dash" });
				approach(ctx, c, target.id, ap);
			}
			if (c.dead || isIncapacitated(c) || ctx.enc.status !== "active" || !c.turn.action) break act;
			if (!inPosition(ctx, c, target.id, ap) && plan.action.save) break act;
			const a = plan.action;
			c.turn.action = false;
			if (a.usage?.type === "recharge") c.usage[a.name] = { used: (c.usage[a.name]?.used ?? 0) + 1, charged: false };
			if (a.usage?.type === "per_day") c.usage[a.name] = { used: (c.usage[a.name]?.used ?? 0) + 1 };
			emit(ctx, { type: "action_used", combatantId: c.id, action: a.name });
			const targets = a.save ? [target.id] : [target.id, ...foes.filter((f) => f.id !== target.id).map((f) => f.id)];
			if (a.attack && typeof evaluateAttack(ctx, c.id, target.id, attackFor(ctx, c, a, target.id)) === "string") {
				say(ctx, `${c.name} cannot reach ${target.name}.`);
				break act;
			}
			try {
				resolveAction(ctx, c, a, targets);
			} catch (e) {
				// A multiattack with nothing in reach: the turn simply ends.
				if (!(e instanceof Error) || !/cannot reach/.test(e.message)) throw e;
				say(ctx, e.message);
			}
		}
		if (opts.endTurn !== false && ctx.enc.status === "active") endTurnCtx(ctx);
	});
}
