import type { Combatant, Encounter, MapEntity, TurnBudget } from "../../game/types";
import { abilityMod, signed, type Rng } from "../dice";
import {
	breakConcentration,
	checkEnd,
	type Ctx,
	doRoll,
	emit,
	fail,
	getC,
	pcProfile,
	removeCondition,
	rollSave,
	run,
	say,
} from "./core";
import { isIncapacitated, nearestFreeSquare, sizeSquares } from "./grid";
import { effectiveSpeed } from "./movement";
import { derivePcProfile } from "./profile";
import type { CombatOptions, CombatResult, CombatState, MonsterSpawn, StartCombatInput } from "./types";

export function freshBudget(speed: number): TurnBudget {
	return { movementLeft: speed, action: true, bonusAction: true, reaction: true, attacksLeft: 0 };
}

export function currentCombatant(encounter: Encounter): Combatant | undefined {
	return encounter.combatants[encounter.order[encounter.turnIndex]];
}

function dexScore(ctx: Ctx, c: Combatant): number {
	if (c.kind === "pc") return ctx.character?.abilities.dex ?? 10;
	return c.stats?.abilities.dex ?? 10;
}

function sortOrder(ctx: Ctx): void {
	const idx = new Map(ctx.enc.order.map((id, i) => [id, i]));
	ctx.enc.order.sort((a, b) => {
		const ca = ctx.enc.combatants[a];
		const cb = ctx.enc.combatants[b];
		return cb.initiative - ca.initiative || dexScore(ctx, cb) - dexScore(ctx, ca) || (ca.kind === "pc" ? -1 : cb.kind === "pc" ? 1 : 0) || idx.get(a)! - idx.get(b)!;
	});
}

function rollInitiative(ctx: Ctx, c: Combatant, surprised: boolean): void {
	const bonus = c.kind === "pc" ? (pcProfile(ctx)?.initiativeBonus ?? 0) : abilityMod(c.stats?.abilities.dex ?? 10);
	const r = doRoll(ctx, `1d20${bonus ? signed(bonus) : ""}`, {
		label: `${c.name} initiative${surprised ? " (surprised)" : ""}`,
		actor: c.id,
		...(surprised ? { advantage: "disadvantage" as const } : {}),
	});
	c.initiative = r.total;
	emit(ctx, { type: "initiative", combatantId: c.id, total: r.total });
	say(ctx, `${c.name} rolls initiative: ${r.total}${surprised ? " (surprised, disadvantage)" : ""}.`);
}

function uniqueId(ctx: Ctx, base: string): string {
	let i = 1;
	while (ctx.enc.combatants[`${base}-${i}`] || ctx.map.entities.some((e) => e.id === `ent_${base}-${i}`)) i++;
	return `${base}-${i}`;
}

function spawnMonsters(ctx: Ctx, spawns: MonsterSpawn[]): Combatant[] {
	const created: Combatant[] = [];
	const counts = new Map<string, number>();
	for (const s of spawns) counts.set(s.stats.index, (counts.get(s.stats.index) ?? 0) + 1);
	const existingSame = (index: string) => Object.values(ctx.enc.combatants).filter((c) => c.stats?.index === index).length;
	for (const s of spawns) {
		const st = s.stats;
		const id = s.id ?? uniqueId(ctx, st.index);
		if (ctx.enc.combatants[id]) fail(`Duplicate combatant id ${id}.`);
		const many = (counts.get(st.index) ?? 0) > 1 || existingSame(st.index) > 0;
		const name = s.name ?? (many ? `${st.name} ${existingSame(st.index) + 1}` : st.name);
		const size = sizeSquares(st.size);
		const existing = s.entityId ? ctx.map.entities.find((e) => e.id === s.entityId) : undefined;
		if (s.entityId && !existing) fail(`No map entity ${s.entityId}.`);
		const want = s.position ?? s.near ?? ctx.map.entry;
		const spot = existing ? { x: existing.x, y: existing.y } : nearestFreeSquare(ctx.map, want, size);
		if (!spot) fail(`No free square for ${name}.`);
		let hp = s.hp ?? st.hp;
		if (s.hp === undefined && s.rollHp) {
			const m = /^(\d+)d(\d+)/.exec(st.hitDice);
			if (m) {
				const conBonus = abilityMod(st.abilities.con) * Number(m[1]);
				const r = doRoll(ctx, `${m[1]}d${m[2]}${conBonus ? signed(conBonus) : ""}`, { label: `${name} hit points`, actor: id });
				hp = Math.max(1, r.total);
			}
		}
		const side = s.side ?? "enemy";
		const ent: MapEntity = {
			id: existing?.id ?? `ent_${id}`,
			kind: s.kind === "npc" ? "npc" : "monster",
			name,
			x: spot.x,
			y: spot.y,
			size,
			sprite: st.tokenHint || st.index,
			combatantId: id,
			disposition: side === "enemy" ? "hostile" : side === "party" ? "friendly" : "neutral",
			...(s.hidden ? { hidden: true } : {}),
		};
		if (existing) Object.assign(existing, ent, { name: existing.name || ent.name, sprite: existing.sprite || ent.sprite });
		else ctx.map.entities.push(ent);
		const speed = Math.max(st.speed.walk ?? 0, st.speed.fly ?? 0) || st.speed.swim || st.speed.climb || 30;
		const c: Combatant = {
			id,
			kind: s.kind ?? "monster",
			name,
			refId: s.refId ?? st.index,
			stats: structuredClone(st),
			initiative: 0,
			hp,
			maxHp: hp,
			tempHp: 0,
			ac: st.ac,
			speed,
			side,
			conditions: [],
			turn: freshBudget(speed),
			entityId: ent.id,
			dead: false,
			usage: {},
			...(st.legendaryActions.length ? { legendaryActionsLeft: 3 } : {}),
		};
		if (s.hidden) c.usage.__hidden = { used: 10 };
		ctx.enc.combatants[id] = c;
		ctx.enc.order.push(id);
		created.push(c);
		emit(ctx, { type: "added", combatantId: id });
	}
	return created;
}

/**
 * Starts an encounter: places the PC (existing "pc" entity, else `pcPosition`
 * or map.entry) and monsters (exact square or nearest free square), rolls
 * initiative (SRD 5.2: surprised creatures roll with disadvantage; ties broken
 * by DEX score, then PC first), and begins the first turn.
 */
export function startCombat(input: StartCombatInput, rng: Rng, opts: CombatOptions = {}): CombatResult {
	const profile = opts.profile ?? derivePcProfile(input.character);
	const encounter: Encounter = { id: input.encounterId, mapId: input.map.id, round: 1, turnIndex: 0, order: [], combatants: {}, status: "active", xpPool: 0 };
	return run({ encounter, map: input.map, character: input.character }, rng, { ...opts, profile }, (ctx) => {
		const ch = ctx.character!;
		let pcEnt = ctx.map.entities.find((e) => e.kind === "pc");
		if (!pcEnt) {
			const spot = nearestFreeSquare(ctx.map, input.pcPosition ?? ctx.map.entry, sizeSquares(ch.size));
			if (!spot) fail("No free square for the player character.");
			pcEnt = { id: `ent_${ch.id}`, kind: "pc", name: ch.name, x: spot.x, y: spot.y, size: sizeSquares(ch.size), sprite: "pc", disposition: "friendly" };
			ctx.map.entities.push(pcEnt);
		} else if (input.pcPosition) {
			pcEnt.x = input.pcPosition.x;
			pcEnt.y = input.pcPosition.y;
		}
		pcEnt.combatantId = ch.id;
		const pc: Combatant = {
			id: ch.id,
			kind: "pc",
			name: ch.name,
			refId: ch.id,
			initiative: 0,
			hp: ch.hp,
			maxHp: ch.maxHp,
			tempHp: ch.tempHp,
			ac: profile.ac,
			speed: profile.speed,
			side: "party",
			conditions: structuredClone(ch.conditions),
			turn: freshBudget(profile.speed),
			entityId: pcEnt.id,
			dead: false,
			usage: {},
			deathSaves: { ...ch.deathSaves },
			...(ch.concentration ? { concentration: ch.concentration.spell } : {}),
		};
		ctx.enc.combatants[pc.id] = pc;
		ctx.enc.order.push(pc.id);
		const monsters = spawnMonsters(ctx, input.monsters);
		rollInitiative(ctx, pc, !!input.pcSurprised);
		monsters.forEach((c, i) => rollInitiative(ctx, c, !!input.monsters[i].surprised));
		sortOrder(ctx);
		emit(ctx, { type: "combat_started", order: [...ctx.enc.order] });
		say(ctx, `Combat begins! Order: ${ctx.enc.order.map((id) => `${ctx.enc.combatants[id].name} (${ctx.enc.combatants[id].initiative})`).join(", ")}.`);
		emit(ctx, { type: "round_start", round: 1 });
		beginTurn(ctx);
	});
}

/** Adds reinforcements mid-combat (rolls their initiative and slots them into the order). */
export function addMonsters(state: CombatState, rng: Rng, spawns: MonsterSpawn[], opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => {
		const current = ctx.enc.order[ctx.enc.turnIndex];
		spawnMonsters(ctx, spawns).forEach((c, i) => rollInitiative(ctx, c, !!spawns[i].surprised));
		sortOrder(ctx);
		ctx.enc.turnIndex = Math.max(0, ctx.enc.order.indexOf(current));
	});
}

/** Start-of-turn bookkeeping for the current combatant. */
export function beginTurn(ctx: Ctx): void {
	const c = ctx.enc.combatants[ctx.enc.order[ctx.enc.turnIndex]];
	if (!c) return;
	for (const k of Object.keys(c.usage)) if (k.startsWith("__turn_")) delete c.usage[k];
	const speed = effectiveSpeed(ctx, c);
	c.turn = freshBudget(speed);
	if (isIncapacitated(c)) {
		c.turn.action = false;
		c.turn.bonusAction = false;
		c.turn.reaction = false;
	}
	if (c.stats) {
		for (const a of [...c.stats.actions, ...c.stats.bonusActions, ...c.stats.legendaryActions]) {
			if (a.usage?.type !== "recharge") continue;
			const u = c.usage[a.name];
			if (!u || u.charged !== false) continue;
			const min = a.usage.minRoll ?? 6;
			const r = doRoll(ctx, "1d6", { label: `${c.name} recharge ${a.name} (${min}–6)`, actor: c.id, target: min });
			u.charged = !!r.success;
			emit(ctx, { type: "recharge", combatantId: c.id, action: a.name, charged: u.charged });
			say(ctx, `${c.name}'s ${a.name} ${u.charged ? "recharges" : "does not recharge"} (${r.total}).`);
		}
		if (c.stats.legendaryActions.length) c.legendaryActionsLeft = 3;
	}
	emit(ctx, { type: "turn_start", combatantId: c.id, round: ctx.enc.round });
	say(ctx, `— Round ${ctx.enc.round}: ${c.name}'s turn.`);
	if (c.kind === "pc" && c.hp <= 0 && !c.dead && (c.deathSaves?.successes ?? 0) < 3) {
		say(ctx, `${c.name} is dying and must make a death saving throw.`);
	}
}

const SAVE_NOTE = /DC\s*(\d+)\s*(STR|DEX|CON|INT|WIS|CHA)\b/i;

/** End-of-turn effects: condition saves noted on conditions ("DC 13 WIS save at end of each turn") and durations. */
function finishTurn(ctx: Ctx, c: Combatant): void {
	for (const cond of [...c.conditions]) {
		const m = cond.note ? SAVE_NOTE.exec(cond.note) : null;
		if (m && /end of/i.test(cond.note!) && !c.dead) {
			const ok = rollSave(ctx, c.id, m[2].toLowerCase() as "str", Number(m[1]), cond.id);
			if (ok) {
				removeCondition(ctx, c.id, cond.id);
				continue;
			}
		}
		if (cond.rounds !== undefined) {
			const live = c.conditions.find((k) => k.id === cond.id);
			if (!live || live.rounds === undefined) continue;
			live.rounds -= 1;
			if (live.rounds <= 0) removeCondition(ctx, c.id, cond.id);
		}
	}
	emit(ctx, { type: "turn_end", combatantId: c.id });
}

function advance(ctx: Ctx): void {
	const n = ctx.enc.order.length;
	for (let i = 0; i < n; i++) {
		ctx.enc.turnIndex += 1;
		if (ctx.enc.turnIndex >= n) {
			ctx.enc.turnIndex = 0;
			ctx.enc.round += 1;
			emit(ctx, { type: "round_start", round: ctx.enc.round });
		}
		const next = ctx.enc.combatants[ctx.enc.order[ctx.enc.turnIndex]];
		if (next && !next.dead) {
			beginTurn(ctx);
			return;
		}
	}
}

export function endTurnCtx(ctx: Ctx): void {
	if (ctx.enc.status !== "active") fail("Combat is not active.");
	const c = ctx.enc.combatants[ctx.enc.order[ctx.enc.turnIndex]];
	if (c && !c.dead) finishTurn(ctx, c);
	checkEnd(ctx);
	if (ctx.enc.status !== "active") return;
	advance(ctx);
}

/** Ends the current combatant's turn and starts the next living combatant's turn. */
export function endTurn(state: CombatState, rng: Rng, opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, endTurnCtx);
}

/** Removes a combatant (fled, dismissed, …). Its token is removed from the map. */
export function removeCombatant(state: CombatState, rng: Rng, combatantId: string, reason = "fled", opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => {
		const c = getC(ctx, combatantId);
		if (c.kind === "pc") fail("Use endCombat to remove the player character.");
		if (c.concentration) breakConcentration(ctx, c.id, reason);
		const idx = ctx.enc.order.indexOf(combatantId);
		const wasCurrent = idx === ctx.enc.turnIndex;
		ctx.enc.order.splice(idx, 1);
		delete ctx.enc.combatants[combatantId];
		ctx.map.entities = ctx.map.entities.filter((e) => e.id !== c.entityId);
		emit(ctx, { type: "removed", combatantId, reason });
		say(ctx, `${c.name} leaves the battle (${reason}).`);
		if (idx < ctx.enc.turnIndex) ctx.enc.turnIndex -= 1;
		checkEnd(ctx);
		if (ctx.enc.status !== "active") return;
		if (wasCurrent) {
			// The creature now at `idx` is next; advance() increments first.
			ctx.enc.turnIndex = idx - 1;
			advance(ctx);
		}
	});
}

/** Ends combat manually (DM decision: parley, flight, …). */
export function endCombat(state: CombatState, rng: Rng, status: Encounter["status"] = "ended", opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => {
		if (ctx.enc.status !== "active") fail("Combat is not active.");
		ctx.enc.status = status;
		emit(ctx, { type: "combat_ended", status, xp: ctx.enc.xpPool });
		say(ctx, `Combat ends (${status}). XP pool: ${ctx.enc.xpPool}.`);
	});
}

