import type { Combatant } from "../../game/types";
import { evaluateAttack, performAttack, potentialOpportunityAttackers } from "./attack";
import { type Ctx, emit, fail, getC, pcProfile, removeCondition, say } from "./core";
import { canEndAt, distanceFeet, entityFor, footprintOf, isIncapacitated, moveContext, type Point, standUpCost, stepCost } from "./grid";
import { type AttackProfile, averageDamage, monsterAttackProfile, pcBestMelee } from "./profile";

/** Best melee attack a creature can make against a target `distance` feet away (for OAs / AI). */
export function bestMeleeAttack(ctx: Ctx, c: Combatant, distance = 5): AttackProfile | undefined {
	if (c.kind === "pc") {
		const p = pcProfile(ctx);
		if (!ctx.character || !p) return undefined;
		const ap = pcBestMelee(ctx.character, p);
		return ap.reach >= distance ? ap : undefined;
	}
	const options = (c.stats?.actions ?? [])
		.filter((a) => a.attack && (a.attack.kind === "melee" || a.attack.kind === "melee_or_ranged"))
		.map((a) => monsterAttackProfile(a.attack!))
		.filter((ap) => ap.reach >= distance);
	return options.sort((x, y) => averageDamage(y.damage) - averageDamage(x.damage))[0];
}

/** Melee reach in feet (0 if the creature has no melee attack). */
export function meleeReach(ctx: Ctx, c: Combatant): number {
	if (c.kind === "pc") return ctx.character && pcProfile(ctx) ? (bestMeleeAttack(ctx, c, 0)?.reach ?? 5) : 5;
	const reaches = (c.stats?.actions ?? [])
		.filter((a) => a.attack && a.attack.kind !== "ranged")
		.map((a) => a.attack!.reach ?? 5);
	return reaches.length ? Math.max(...reaches) : 0;
}

/** Effective speed at the start of a turn. */
export function effectiveSpeed(ctx: Ctx, c: Combatant): number {
	if (["grappled", "restrained", "paralyzed", "stunned", "unconscious", "petrified"].some((k) => c.conditions.some((x) => x.id === k))) return 0;
	if (c.kind === "pc" && c.hp <= 0) return 0;
	const exh = c.kind === "pc" && ctx.character?.id === c.id ? ctx.character.exhaustion : 0;
	return Math.max(0, c.speed - 5 * exh);
}

/**
 * Moves a combatant along `path` (squares stepped into; a leading square equal
 * to the current position is ignored). Validates adjacency, terrain, budget and
 * the end square before anything happens. Stands up from prone first (half
 * speed). Resolves opportunity attacks when leaving a hostile's reach unless
 * Disengaged; movement stops if the mover drops or becomes incapacitated.
 * Returns the squares actually traversed.
 */
export function moveAlong(ctx: Ctx, moverId: string, rawPath: Point[]): Point[] {
	const c = getC(ctx, moverId);
	const ent = entityFor(ctx.enc, ctx.map, moverId);
	if (!ent) fail(`${c.name} has no token on the map.`);
	const path = rawPath.slice();
	if (path.length && path[0].x === ent.x && path[0].y === ent.y) path.shift();
	if (!path.length) fail("Empty path.");
	if (isIncapacitated(c)) fail(`${c.name} cannot move while incapacitated.`);
	const stand = standUpCost(c);
	const mc = moveContext(ctx.enc, ctx.map, moverId);
	let cost = 0;
	let prev: Point = { x: ent.x, y: ent.y };
	const costs: number[] = [];
	for (const p of path) {
		if (Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y)) !== 1) fail(`Path is not contiguous at (${p.x},${p.y}).`);
		const sc = stepCost(mc, p.x, p.y);
		if (sc === Infinity) fail(`Square (${p.x},${p.y}) is blocked.`);
		cost += sc;
		costs.push(sc);
		prev = p;
	}
	const last = path[path.length - 1];
	if (!canEndAt(mc, last.x, last.y)) fail(`Cannot end movement on (${last.x},${last.y}).`);
	if (cost + stand > c.turn.movementLeft) fail(`Not enough movement: path costs ${cost} ft${stand ? ` (+${stand} ft to stand up)` : ""}, ${c.turn.movementLeft} ft left.`);

	if (stand) {
		c.turn.movementLeft -= stand;
		removeCondition(ctx, moverId, "prone");
		emit(ctx, { type: "stand_up", combatantId: moverId });
		say(ctx, `${c.name} stands up (${stand} ft).`);
	}
	const traversed: Point[] = [];
	let spent = 0;
	for (let i = 0; i < path.length; i++) {
		const from = { x: ent.x, y: ent.y, size: ent.size || 1 };
		const to = { ...path[i], size: ent.size || 1 };
		if (!c.turn.disengaged) {
			for (const o of potentialOpportunityAttackers(ctx, moverId)) {
				if (o.kind === "pc" && ctx.opts.autoReactions === false) continue;
				const fo = footprintOf(ctx.enc, ctx.map, o.id);
				if (!fo) continue;
				const reach = meleeReach(ctx, o);
				if (reach <= 0) continue;
				if (distanceFeet(from, fo) <= reach && distanceFeet(to, fo) > reach) {
					const ap = bestMeleeAttack(ctx, o, distanceFeet(from, fo));
					if (!ap || typeof evaluateAttack(ctx, o.id, moverId, ap) === "string") continue;
					o.turn.reaction = false;
					emit(ctx, { type: "opportunity_attack", attackerId: o.id, targetId: moverId });
					performAttack(ctx, o.id, moverId, ap, { opportunity: true });
					if (c.dead || isIncapacitated(c) || ctx.enc.status !== "active") break;
				}
			}
			if (c.dead || isIncapacitated(c) || ctx.enc.status !== "active") {
				say(ctx, `${c.name}'s movement is stopped.`);
				break;
			}
		}
		ent.x = to.x;
		ent.y = to.y;
		const ti = to.y * ctx.map.width + to.x;
		if (ctx.map.tiles[ti] === "door") {
			ctx.map.tiles[ti] = "door_open";
			say(ctx, `${c.name} opens the door at (${to.x},${to.y}).`);
		}
		c.turn.movementLeft -= costs[i];
		spent += costs[i];
		traversed.push({ x: to.x, y: to.y });
	}
	if (traversed.length) {
		emit(ctx, { type: "move", combatantId: moverId, path: traversed, cost: spent });
		say(ctx, `${c.name} moves ${spent} ft to (${ent.x},${ent.y}).`);
	}
	return traversed;
}
