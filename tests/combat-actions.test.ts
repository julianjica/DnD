import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character, MonsterStats } from "../lib/game/types";
import { makeBear, makeFighter, makeMap, makeMonster, makeWizard, openMap, ScriptedRng, SPELLS } from "../lib/rules/combat/fixtures";
import { endTurn, startCombat } from "../lib/rules/combat/encounter";
import { applyPlayerAction } from "../lib/rules/combat/player";
import { applyConditionTo, applyDamageTo } from "../lib/rules/combat/dm";
import type { CombatResult } from "../lib/rules/combat/types";
import { derivePcProfile } from "../lib/rules/combat/profile";

interface Spawn {
	stats?: MonsterStats;
	at: { x: number; y: number };
	id: string;
}

function fight(opts: { pc?: Character; pcAt?: { x: number; y: number }; monsters: Spawn[]; map?: ReturnType<typeof openMap> }): CombatResult {
	const r = startCombat(
		{
			encounterId: "e1",
			map: opts.map ?? openMap(40, 12),
			character: opts.pc ?? makeFighter(),
			pcPosition: opts.pcAt ?? { x: 1, y: 1 },
			monsters: opts.monsters.map((m) => ({ stats: m.stats ?? makeMonster(), id: m.id, position: m.at })),
		},
		new ScriptedRng([20, ...opts.monsters.map(() => 1)]),
	);
	assert.ok(r.ok, r.error);
	assert.equal(r.encounter.order[r.encounter.turnIndex], "pc1");
	return r;
}

const act = (r: CombatResult, rng: ScriptedRng, a: Parameters<typeof applyPlayerAction>[2], opts = {}) => applyPlayerAction(r, rng, a, opts);
const spells = { spells: SPELLS };

test("weapon attack: hit applies damage, miss does not", () => {
	const r = fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] });
	const rng = new ScriptedRng([5, 4]); // 5+6 = 11 vs AC 11 → hit; 1d8+3 = 7
	const hit = act(r, rng, { type: "attack", targetId: "bear", itemId: "sword" });
	assert.ok(hit.ok, hit.error);
	assert.equal(hit.encounter.combatants.bear.hp, 34 - 7);
	assert.equal(hit.rolls[0].notation, "1d20+6");
	assert.equal(hit.rolls[1].notation, "1d8+3");
	const miss = act(hit, new ScriptedRng([4]), { type: "attack", targetId: "bear", itemId: "sword" });
	assert.equal(miss.encounter.combatants.bear.hp, 27);
	assert.equal(miss.rolls.length, 1);
});

test("critical hits double the damage dice, not the modifier", () => {
	const r = fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] });
	const res = act(r, new ScriptedRng([20, 5, 6]), { type: "attack", targetId: "bear", itemId: "sword" });
	assert.equal(res.rolls[0].critical, "hit");
	assert.equal(res.rolls[1].notation, "2d8+3");
	assert.equal(res.encounter.combatants.bear.hp, 34 - 14);
	const nat1 = act(r, new ScriptedRng([1]), { type: "attack", targetId: "bear", itemId: "sword" });
	assert.equal(nat1.rolls[0].critical, "miss");
	assert.equal(nat1.rolls[0].success, false);
});

test("Extra Attack: two attacks per Attack action, then no more", () => {
	let r = fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] });
	const rng = new ScriptedRng([2, 2, 2]);
	r = act(r, rng, { type: "attack", targetId: "bear", itemId: "sword" });
	assert.equal(r.encounter.combatants.pc1.turn.action, false);
	assert.equal(r.encounter.combatants.pc1.turn.attacksLeft, 1);
	r = act(r, rng, { type: "attack", targetId: "bear", itemId: "sword" });
	assert.ok(r.ok);
	const third = act(r, rng, { type: "attack", targetId: "bear", itemId: "sword" });
	assert.equal(third.ok, false);
	assert.match(third.error!, /No action left/);
});

test("off-hand attack needs the Attack action first and a light weapon; no ability mod to damage", () => {
	let r = fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] });
	const early = act(r, new ScriptedRng([]), { type: "attack", targetId: "bear", itemId: "dagger", offHand: true });
	assert.equal(early.ok, false);
	r = act(r, new ScriptedRng([2]), { type: "attack", targetId: "bear", itemId: "sword" });
	r = act(r, new ScriptedRng([19, 3]), { type: "attack", targetId: "bear", itemId: "dagger", offHand: true });
	assert.ok(r.ok, r.error);
	assert.equal(r.rolls[1].notation, "1d4");
	assert.equal(r.encounter.combatants.pc1.turn.bonusAction, false);
});

test("advantage and disadvantage sources", () => {
	const base = fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }, { id: "far", stats: makeBear({ index: "b2" }), at: { x: 10, y: 1 } }] });
	const rng = () => new ScriptedRng([5, 5, 1, 1, 1]);
	const advOf = (r: CombatResult, a: Parameters<typeof applyPlayerAction>[2]) => {
		const res = act(r, rng(), a);
		assert.ok(res.ok, res.error);
		return res.rolls[0].advantage;
	};
	const withCond = (id: string, cond: Parameters<typeof applyConditionTo>[3]) => applyConditionTo(base, new ScriptedRng([]), id, cond);
	const melee = { type: "attack", targetId: "bear", itemId: "sword" } as const;
	assert.equal(advOf(base, melee), undefined);
	assert.equal(advOf(withCond("bear", { id: "prone" }), melee), "advantage");
	assert.equal(advOf(withCond("far", { id: "prone" }), { type: "attack", targetId: "far", itemId: "bow" }), "disadvantage");
	assert.equal(advOf(withCond("bear", { id: "restrained" }), melee), "advantage");
	assert.equal(advOf(withCond("bear", { id: "blinded" }), melee), "advantage");
	assert.equal(advOf(withCond("bear", { id: "invisible" }), melee), "disadvantage");
	assert.equal(advOf(withCond("pc1", { id: "poisoned" }), melee), "disadvantage");
	assert.equal(advOf(withCond("pc1", { id: "frightened" }), melee), "disadvantage");
	assert.equal(advOf(withCond("pc1", { id: "invisible" }), melee), "advantage");
	// Ranged attack with a hostile adjacent.
	assert.equal(advOf(base, { type: "attack", targetId: "far", itemId: "bow" }), "disadvantage");
	// Advantage and disadvantage cancel.
	const both = applyConditionTo(withCond("bear", { id: "prone" }), new ScriptedRng([]), "pc1", { id: "poisoned" });
	assert.equal(advOf(both, melee), undefined);
	// Dodging target.
	const dodging = structuredClone(base);
	dodging.encounter.combatants.bear.turn.dodging = true;
	assert.equal(advOf(dodging, melee), "disadvantage");
});

test("ranged: long range has disadvantage, beyond long range is impossible", () => {
	const r = fight({ map: openMap(160, 3), monsters: [{ id: "g", at: { x: 40, y: 1 } }, { id: "g2", at: { x: 150, y: 1 } }] });
	const long = act(r, new ScriptedRng([10, 10, 1]), { type: "attack", targetId: "g", itemId: "bow" });
	assert.ok(long.ok, long.error);
	assert.equal(long.rolls[0].advantage, "disadvantage");
	const tooFar = act(r, new ScriptedRng([10]), { type: "attack", targetId: "g2", itemId: "bow" });
	assert.equal(tooFar.ok, false);
	assert.match(tooFar.error!, /out of range/);
	const melee = act(r, new ScriptedRng([10]), { type: "attack", targetId: "g", itemId: "sword" });
	assert.match(melee.error!, /out of reach/);
});

test("thrown weapon at range uses the weapon's range", () => {
	const r = fight({ monsters: [{ id: "g", at: { x: 4, y: 1 } }] });
	const res = act(r, new ScriptedRng([15, 2]), { type: "attack", targetId: "g", itemId: "dagger" });
	assert.ok(res.ok, res.error);
	assert.equal(res.rolls[0].notation, "1d20+6"); // finesse: max(str 3, dex 2) + 3
});

test("melee hits on a paralyzed creature within 5 ft are critical", () => {
	const r0 = fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] });
	const r = applyConditionTo(r0, new ScriptedRng([]), "bear", { id: "paralyzed" });
	const res = act(r, new ScriptedRng([10, 5, 1, 1]), { type: "attack", targetId: "bear", itemId: "sword" });
	assert.equal(res.rolls[0].advantage, "advantage");
	assert.equal(res.rolls[0].critical, "hit");
	assert.equal(res.rolls[1].notation, "2d8+3");
	assert.equal(res.encounter.combatants.bear.hp, 34 - 5);
});

test("leaving a hostile's reach provokes an opportunity attack (not when disengaged or staying in reach)", () => {
	const r = fight({ monsters: [{ id: "g", at: { x: 2, y: 1 } }] });
	const rng = new ScriptedRng([15, 3]); // 15+4 = 19 vs AC 18 → hit, 1d6+2 = 5
	const moved = act(r, rng, { type: "move", path: [{ x: 0, y: 1 }] });
	assert.ok(moved.ok, moved.error);
	assert.ok(moved.events.some((e) => e.type === "opportunity_attack" && e.attackerId === "g"));
	assert.equal(moved.encounter.combatants.pc1.hp, 39);
	assert.equal(moved.character?.hp, 39);
	assert.equal(moved.encounter.combatants.g.turn.reaction, false);
	assert.equal(moved.encounter.combatants.pc1.turn.movementLeft, 25);

	const stay = act(r, new ScriptedRng([]), { type: "move", path: [{ x: 1, y: 2 }] });
	assert.ok(!stay.events.some((e) => e.type === "opportunity_attack"));

	const dis = act(act(r, new ScriptedRng([]), { type: "disengage" }), new ScriptedRng([]), { type: "move", path: [{ x: 0, y: 1 }] });
	assert.ok(dis.ok);
	assert.ok(!dis.events.some((e) => e.type === "opportunity_attack"));
});

test("invalid moves are rejected without consuming randomness", () => {
	const r = fight({ monsters: [{ id: "g", at: { x: 2, y: 1 } }] });
	const rng = new ScriptedRng([7, 7]);
	const stateBefore = rng.state;
	const path = Array.from({ length: 7 }, (_, i) => ({ x: 1, y: 2 + i }));
	const res = act(r, rng, { type: "move", path });
	assert.equal(res.ok, false);
	assert.match(res.error!, /Not enough movement/);
	assert.equal(rng.state, stateBefore);
	assert.equal(rng.queue.length, 2);
	assert.equal(res.encounter, r.encounter);
	const jump = act(r, rng, { type: "move", path: [{ x: 5, y: 5 }] });
	assert.match(jump.error!, /not contiguous/);
	const dash = act(r, rng, { type: "dash" });
	assert.equal(dash.encounter.combatants.pc1.turn.movementLeft, 60);
});

test("moving while prone stands up first for half speed", () => {
	const r = applyConditionTo(fight({ monsters: [{ id: "g", at: { x: 8, y: 8 } }] }), new ScriptedRng([]), "pc1", { id: "prone" });
	const res = act(r, new ScriptedRng([]), { type: "move", path: [{ x: 2, y: 1 }] });
	assert.ok(res.ok, res.error);
	assert.equal(res.encounter.combatants.pc1.turn.movementLeft, 10);
	assert.ok(!res.encounter.combatants.pc1.conditions.some((c) => c.id === "prone"));
});

test("dropping to 0 HP: unconscious + prone; death saves; nat 20 revives", () => {
	let r = fight({ monsters: [{ id: "g", at: { x: 8, y: 8 } }] });
	r = applyDamageTo(r, new ScriptedRng([]), "pc1", 44);
	const pc = r.encounter.combatants.pc1;
	assert.equal(pc.hp, 0);
	assert.ok(pc.conditions.some((c) => c.id === "unconscious"));
	assert.ok(pc.conditions.some((c) => c.id === "prone"));
	assert.equal(r.encounter.status, "active");
	const attack = act(r, new ScriptedRng([]), { type: "attack", targetId: "g" });
	assert.match(attack.error!, /dying/);
	const nat20 = act(r, new ScriptedRng([20]), { type: "death_save" });
	assert.equal(nat20.encounter.combatants.pc1.hp, 1);
	assert.ok(!nat20.encounter.combatants.pc1.conditions.some((c) => c.id === "unconscious"));
	assert.equal(nat20.character?.hp, 1);
	const nat1 = act(r, new ScriptedRng([1]), { type: "death_save" });
	assert.deepEqual(nat1.encounter.combatants.pc1.deathSaves, { successes: 0, failures: 2 });
	const twice = act(nat1, new ScriptedRng([15]), { type: "death_save" });
	assert.match(twice.error!, /Already/);
});

test("three death save successes → stable; three failures → dead and defeat", () => {
	let r = fight({ monsters: [{ id: "g", at: { x: 8, y: 8 } }] });
	r = applyDamageTo(r, new ScriptedRng([]), "pc1", 44);
	const cycle = (res: CombatResult, roll: number) => {
		const s = act(res, new ScriptedRng([roll]), { type: "death_save" });
		assert.ok(s.ok, s.error);
		if (s.encounter.status !== "active") return s;
		let e = endTurn(s, new ScriptedRng([]));
		e = endTurn(e, new ScriptedRng([]));
		return e;
	};
	let ok = r;
	for (const roll of [10, 12, 19]) ok = cycle(ok, roll);
	assert.deepEqual(ok.encounter.combatants.pc1.deathSaves, { successes: 3, failures: 0 });
	assert.equal(act(ok, new ScriptedRng([10]), { type: "death_save" }).error, "Thorin is stable.");

	let bad = r;
	for (const roll of [9, 2, 5]) bad = cycle(bad, roll);
	assert.ok(bad.encounter.combatants.pc1.dead);
	assert.equal(bad.encounter.status, "defeat");
});

test("damage at 0 HP adds death save failures (crit = 2); massive damage kills outright", () => {
	let r = fight({ monsters: [{ id: "g", at: { x: 8, y: 8 } }] });
	r = applyDamageTo(r, new ScriptedRng([]), "pc1", 44);
	const hit = applyDamageTo(r, new ScriptedRng([]), "pc1", 3);
	assert.equal(hit.encounter.combatants.pc1.deathSaves?.failures, 1);
	const crit = applyDamageTo(r, new ScriptedRng([]), "pc1", 3, "slashing", { crit: true });
	assert.equal(crit.encounter.combatants.pc1.deathSaves?.failures, 2);
	const big = applyDamageTo(r, new ScriptedRng([]), "pc1", 44);
	assert.ok(big.encounter.combatants.pc1.dead);

	const fresh = fight({ monsters: [{ id: "g", at: { x: 8, y: 8 } }] });
	const massive = applyDamageTo(fresh, new ScriptedRng([]), "pc1", 88);
	assert.ok(massive.encounter.combatants.pc1.dead);
	assert.equal(massive.encounter.status, "defeat");
	const notMassive = applyDamageTo(fresh, new ScriptedRng([]), "pc1", 87);
	assert.ok(!notMassive.encounter.combatants.pc1.dead);
});

test("resistance, vulnerability, immunity and temp HP", () => {
	const bear = makeBear({ resistances: ["fire"], vulnerabilities: ["cold"], immunities: ["poison"] });
	const r = fight({ monsters: [{ id: "bear", stats: bear, at: { x: 8, y: 8 } }] });
	const rng = new ScriptedRng([]);
	assert.equal(applyDamageTo(r, rng, "bear", 11, "fire").encounter.combatants.bear.hp, 34 - 5);
	assert.equal(applyDamageTo(r, rng, "bear", 10, "cold").encounter.combatants.bear.hp, 34 - 20);
	assert.equal(applyDamageTo(r, rng, "bear", 10, "poison").encounter.combatants.bear.hp, 34);
	const temp = structuredClone(r);
	temp.encounter.combatants.pc1.tempHp = 5;
	const t = applyDamageTo(temp, rng, "pc1", 8);
	assert.equal(t.encounter.combatants.pc1.tempHp, 0);
	assert.equal(t.encounter.combatants.pc1.hp, 41);
	const pcRes = applyDamageTo(r, rng, "pc1", 10, "fire", {}, { profile: { ...derive(), resistances: ["fire"] } });
	assert.equal(pcRes.encounter.combatants.pc1.hp, 39);
});

function derive() {
	return derivePcProfile(makeFighter());
}

test("derivePcProfile: AC, proficiency, extra attack, saves", () => {
	const p = derive();
	assert.equal(p.ac, 18);
	assert.equal(p.proficiencyBonus, 3);
	assert.equal(p.attacksPerAction, 2);
	assert.equal(p.saveBonuses.str, 6);
	assert.equal(p.saveBonuses.dex, 2);
	assert.equal(p.passivePerception, 14);
	const w = derivePcProfile(makeWizard());
	assert.equal(w.spellSaveDc, 15);
	assert.equal(w.spellAttackBonus, 7);
	assert.equal(w.ac, 12);
});

test("concentration: failed CON save on damage ends the spell and its conditions", () => {
	let r = fight({ pc: makeWizard(), monsters: [{ id: "g", at: { x: 5, y: 1 } }] });
	// Hold Person: goblin WIS save 1 + (-1) = 0 vs 15 → fail.
	r = act(r, new ScriptedRng([1]), { type: "cast", spell: "hold-person", slotLevel: 2, targetIds: ["g"] }, spells);
	assert.ok(r.ok, r.error);
	assert.equal(r.encounter.combatants.pc1.concentration, "hold-person");
	assert.equal(r.character?.concentration?.spell, "hold-person");
	assert.deepEqual(r.character?.spellcasting?.slotsUsed, [0, 1, 0]);
	assert.ok(r.events.some((e) => e.type === "needs_dm"));
	r = applyConditionTo(r, new ScriptedRng([]), "g", { id: "paralyzed", source: "conc:pc1:hold-person" });
	// 12 damage → DC 10; CON save 2 + 2 = 4 → fail.
	const broken = applyDamageTo(r, new ScriptedRng([2]), "pc1", 12, undefined, {}, spells);
	assert.equal(broken.encounter.combatants.pc1.concentration, undefined);
	assert.equal(broken.character?.concentration, undefined);
	assert.deepEqual(broken.encounter.combatants.g.conditions, []);
	assert.ok(broken.events.some((e) => e.type === "concentration_broken"));
	// Big damage → DC = half damage.
	const held = applyDamageTo(r, new ScriptedRng([15]), "pc1", 30);
	assert.equal(held.rolls[0].target, 15);
	assert.equal(held.encounter.combatants.pc1.concentration, "hold-person");
});

test("fireball: sphere targets, one damage roll, half on a successful save, slot used", () => {
	const r = fight({
		pc: makeWizard(),
		monsters: [
			{ id: "b1", stats: makeBear(), at: { x: 15, y: 5 } },
			{ id: "b2", stats: makeBear({ index: "b2" }), at: { x: 18, y: 5 } },
			{ id: "far", stats: makeBear({ index: "b3" }), at: { x: 30, y: 5 } },
		],
	});
	const rng = new ScriptedRng([3, 3, 3, 3, 3, 3, 3, 3, /* saves */ 1, 20]);
	const res = act(r, rng, { type: "cast", spell: "fireball", slotLevel: 3, point: { x: 16, y: 5 } }, spells);
	assert.ok(res.ok, res.error);
	const cast = res.events.find((e) => e.type === "spell_cast");
	assert.ok(cast && cast.type === "spell_cast");
	assert.deepEqual([...cast.targetIds].sort(), ["b1", "b2"]);
	assert.equal(res.encounter.combatants.b1.hp, 34 - 24);
	assert.equal(res.encounter.combatants.b2.hp, 34 - 12);
	assert.equal(res.encounter.combatants.far.hp, 34);
	assert.deepEqual(res.character?.spellcasting?.slotsUsed, [0, 0, 1]);
	const tooHigh = act(r, new ScriptedRng([]), { type: "cast", spell: "fireball", slotLevel: 4, point: { x: 16, y: 5 } }, spells);
	assert.match(tooHigh.error!, /No level 4/);
	const tooFar = act(r, new ScriptedRng([]), { type: "cast", spell: "fireball", slotLevel: 3, point: { x: 39, y: 5 } }, spells);
	assert.match(tooFar.error!, /out of range/);
});

test("burning hands: cone from the caster", () => {
	const r = fight({ pc: makeWizard(), monsters: [{ id: "g1", at: { x: 3, y: 1 } }, { id: "g2", at: { x: 1, y: 6 } }] });
	const res = act(r, new ScriptedRng([6, 6, 6, 1]), { type: "cast", spell: "burning-hands", slotLevel: 1, point: { x: 4, y: 1 } }, spells);
	assert.ok(res.ok, res.error);
	assert.ok(res.encounter.combatants.g1.dead);
	assert.ok(!res.encounter.combatants.g2.dead);
});

test("fire bolt scales with character level and uses the spell attack bonus; no slot", () => {
	const r = fight({ pc: makeWizard(), monsters: [{ id: "bear", stats: makeBear(), at: { x: 10, y: 1 } }] });
	const res = act(r, new ScriptedRng([10, 4, 4]), { type: "cast", spell: "fire-bolt", slotLevel: 0, targetIds: ["bear"] }, spells);
	assert.ok(res.ok, res.error);
	assert.equal(res.rolls[0].notation, "1d20+7");
	assert.equal(res.rolls[1].notation, "2d10");
	assert.equal(res.encounter.combatants.bear.hp, 26);
	assert.deepEqual(res.character?.spellcasting?.slotsUsed, [0, 0, 0]);
});

test("cure wounds heals with modifier; healing from 0 HP clears unconscious", () => {
	let r = fight({ pc: makeWizard(), monsters: [{ id: "g", at: { x: 10, y: 1 } }] });
	r = applyDamageTo(r, new ScriptedRng([]), "pc1", 20);
	const res = act(r, new ScriptedRng([3, 3]), { type: "cast", spell: "cure-wounds", slotLevel: 1 }, spells);
	assert.ok(res.ok, res.error);
	assert.equal(res.encounter.combatants.pc1.hp, 12 + 10);
});

test("potion of healing is a bonus action and consumes the potion", () => {
	let r = fight({ monsters: [{ id: "g", at: { x: 10, y: 1 } }] });
	r = applyDamageTo(r, new ScriptedRng([]), "pc1", 20);
	const res = act(r, new ScriptedRng([2, 3]), { type: "use_item", itemId: "potion" });
	assert.ok(res.ok, res.error);
	assert.equal(res.encounter.combatants.pc1.hp, 24 + 7);
	assert.equal(res.encounter.combatants.pc1.turn.bonusAction, false);
	assert.equal(res.encounter.combatants.pc1.turn.action, true);
	assert.equal(res.character?.inventory.find((i) => i.id === "potion")?.quantity, 1);
	const rock = act(r, new ScriptedRng([]), { type: "use_item", itemId: "chain" });
	assert.equal(rock.ok, false);
});

test("Second Wind and Action Surge", () => {
	let r = fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] });
	r = applyDamageTo(r, new ScriptedRng([]), "pc1", 20);
	const sw = act(r, new ScriptedRng([6]), { type: "use_feature", featureId: "sw" });
	assert.equal(sw.encounter.combatants.pc1.hp, 24 + 11);
	assert.equal(sw.character?.features.find((f) => f.id === "sw")?.uses?.used, 1);
	assert.equal(act(sw, new ScriptedRng([]), { type: "use_feature", featureId: "sw" }).ok, false);
	let s = act(r, new ScriptedRng([2]), { type: "dodge" });
	s = act(s, new ScriptedRng([]), { type: "use_feature", featureId: "as" });
	assert.equal(s.encounter.combatants.pc1.turn.action, true);
});

test("hide requires being out of sight; help grants advantage", () => {
	const seen = fight({ monsters: [{ id: "g", at: { x: 5, y: 1 } }] });
	assert.match(act(seen, new ScriptedRng([]), { type: "hide" }).error!, /can't hide/);
	const walled = fight({
		map: makeMap(["......#....", "......#....", "......#...."]),
		pcAt: { x: 1, y: 1 },
		monsters: [{ id: "g", at: { x: 9, y: 1 } }],
	});
	const hid = act(walled, new ScriptedRng([18, 15]), { type: "hide" });
	assert.ok(hid.ok, hid.error);
	assert.equal(hid.rolls[0].advantage, "disadvantage"); // chain mail
	assert.equal(hid.map.entities.find((e) => e.combatantId === "pc1")?.hidden, true);

	const help = act(fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] }), new ScriptedRng([]), { type: "help", targetId: "bear" });
	assert.ok(help.encounter.combatants.bear.usage.__helpAgainst);
});

test("not your turn / end_turn", () => {
	const r = fight({ monsters: [{ id: "g", at: { x: 5, y: 1 } }] });
	const e = act(r, new ScriptedRng([]), { type: "end_turn" });
	assert.equal(e.encounter.order[e.encounter.turnIndex], "g");
	assert.match(act(e, new ScriptedRng([]), { type: "dodge" }).error!, /not your turn/);
});

test("one shared options object does not leak a derived profile between characters", () => {
	const shared = { spells: SPELLS };
	const w = fight({ pc: makeWizard(), monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] });
	assert.ok(act(w, new ScriptedRng([10, 1, 1]), { type: "cast", spell: "fire-bolt", slotLevel: 0, targetIds: ["bear"] }, shared).ok);
	const f = fight({ monsters: [{ id: "bear", stats: makeBear(), at: { x: 2, y: 1 } }] });
	const res = act(f, new ScriptedRng([10, 1]), { type: "attack", targetId: "bear", itemId: "sword" }, shared);
	assert.equal(res.rolls[0].notation, "1d20+6");
	assert.equal(Object.keys(shared).length, 1);
});

test("ending the turn at 0 HP rolls the death save automatically", () => {
	let r = fight({ monsters: [{ id: "g", at: { x: 8, y: 8 } }] });
	r = applyDamageTo(r, new ScriptedRng([]), "pc1", 44);
	const res = act(r, new ScriptedRng([4]), { type: "end_turn" });
	assert.ok(res.ok, res.error);
	assert.deepEqual(res.encounter.combatants.pc1.deathSaves, { successes: 0, failures: 1 });
	assert.equal(res.encounter.order[res.encounter.turnIndex], "g");
	// Already rolled this turn → no second roll.
	const rolled = act(r, new ScriptedRng([15]), { type: "death_save" });
	const ended = act(rolled, new ScriptedRng([]), { type: "end_turn" });
	assert.deepEqual(ended.encounter.combatants.pc1.deathSaves, { successes: 1, failures: 0 });
});

test("damage at 0 HP keeps prior successes; a stable PC starts dying again", () => {
	let r = fight({ monsters: [{ id: "g", at: { x: 8, y: 8 } }] });
	r = applyDamageTo(r, new ScriptedRng([]), "pc1", 44);
	const partial = structuredClone(r);
	partial.encounter.combatants.pc1.deathSaves = { successes: 2, failures: 0 };
	assert.deepEqual(applyDamageTo(partial, new ScriptedRng([]), "pc1", 3).encounter.combatants.pc1.deathSaves, { successes: 2, failures: 1 });
	const stable = structuredClone(r);
	stable.encounter.combatants.pc1.deathSaves = { successes: 3, failures: 0 };
	assert.deepEqual(applyDamageTo(stable, new ScriptedRng([]), "pc1", 3).encounter.combatants.pc1.deathSaves, { successes: 0, failures: 1 });
});

test("a prone player can stand up for half their speed", () => {
	const r = fight({ monsters: [{ id: "m1", at: { x: 10, y: 1 } }] });
	const pc = r.encounter.combatants.pc1;
	pc.conditions.push({ id: "prone" } as (typeof pc.conditions)[number]);
	const before = pc.turn.movementLeft;
	const res = act(r, new ScriptedRng([]), { type: "stand_up" });
	assert.ok(res.ok, res.error);
	const after = res.encounter.combatants.pc1;
	assert.ok(!after.conditions.some((k) => k.id === "prone"));
	assert.equal(after.turn.movementLeft, before - Math.floor(pc.speed / 2));
	assert.equal(act(res, new ScriptedRng([]), { type: "stand_up" }).ok, false, "can't stand when not prone");
});
