import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "../lib/rules/dice";
import { makeBear, makeFighter, makeMonster, openMap, ScriptedRng } from "../lib/rules/combat/fixtures";
import { addMonsters, currentCombatant, endCombat, endTurn, removeCombatant, startCombat } from "../lib/rules/combat/encounter";
import { applyConditionTo, applyDamageTo } from "../lib/rules/combat/dm";
import type { CombatResult } from "../lib/rules/combat/types";

function start(rolls: number[], monsters = [makeMonster(), makeMonster()], extra: { pcSurprised?: boolean; surprised?: boolean[] } = {}) {
	const res = startCombat(
		{
			encounterId: "e1",
			map: openMap(),
			character: makeFighter(),
			pcPosition: { x: 1, y: 1 },
			pcSurprised: extra.pcSurprised,
			monsters: monsters.map((stats, i) => ({ stats, position: { x: 8, y: 1 + i * 2 }, surprised: extra.surprised?.[i] })),
		},
		new ScriptedRng(rolls),
	);
	assert.ok(res.ok, res.error);
	return res;
}

test("startCombat builds combatants, places tokens, names duplicates, sorts initiative", () => {
	// PC d20=5 (+2) = 7; goblin 1 d20=15 (+2) = 17; goblin 2 d20=10 = 12
	const r = start([5, 15, 10]);
	assert.deepEqual(r.encounter.order, ["goblin-1", "goblin-2", "pc1"]);
	assert.equal(r.encounter.combatants["goblin-1"].name, "Goblin 1");
	assert.equal(r.encounter.combatants["goblin-2"].name, "Goblin 2");
	assert.equal(r.encounter.combatants.pc1.ac, 18); // chain mail 16 + shield 2
	assert.equal(r.map.entities.length, 3);
	assert.equal(r.encounter.round, 1);
	assert.equal(currentCombatant(r.encounter)?.id, "goblin-1");
	assert.ok(r.events.some((e) => e.type === "turn_start" && e.combatantId === "goblin-1"));
	assert.equal(r.rolls.length, 3);
});

test("initiative ties are broken by DEX score, then the PC", () => {
	// PC dex 14 (+2): roll 10 → 12; goblin dex 14 roll 10 → 12; bear dex 10 (+0) roll 12 → 12
	const r = start([10, 10, 12], [makeMonster(), makeBear()]);
	assert.deepEqual(r.encounter.order, ["pc1", "goblin-1", "brown-bear-1"]);
});

test("surprise gives disadvantage on initiative (SRD 5.2)", () => {
	const r = start([18, 3, 15, 15], [makeMonster()], { pcSurprised: true });
	const pcRoll = r.rolls[0];
	assert.equal(pcRoll.advantage, "disadvantage");
	assert.equal(r.encounter.combatants.pc1.initiative, 3 + 2);
});

test("endTurn advances, wraps rounds, and skips the dead", () => {
	let r: CombatResult = start([20, 10, 5]); // pc, g1, g2
	assert.equal(currentCombatant(r.encounter)?.id, "pc1");
	const rng = new ScriptedRng([]);
	r = applyDamageTo(r, rng, "goblin-1", 50);
	assert.ok(r.encounter.combatants["goblin-1"].dead);
	assert.equal(r.encounter.xpPool, 50);
	r = endTurn(r, rng);
	assert.equal(currentCombatant(r.encounter)?.id, "goblin-2");
	r = endTurn(r, rng);
	assert.equal(currentCombatant(r.encounter)?.id, "pc1");
	assert.equal(r.encounter.round, 2);
	assert.ok(r.events.some((e) => e.type === "round_start" && e.round === 2));
});

test("start of turn resets the budget", () => {
	let r: CombatResult = start([20, 10, 5]);
	r.encounter.combatants.pc1.turn = { movementLeft: 0, action: false, bonusAction: false, reaction: false, attacksLeft: 0 };
	const rng = new ScriptedRng([]);
	r = endTurn(r, rng);
	r = endTurn(r, rng);
	r = endTurn(r, rng);
	assert.deepEqual(r.encounter.combatants.pc1.turn, { movementLeft: 30, action: true, bonusAction: true, reaction: true, attacksLeft: 0 });
});

test("killing every enemy ends combat in victory with the XP pool", () => {
	let r: CombatResult = start([20, 10, 5]);
	const rng = new ScriptedRng([]);
	r = applyDamageTo(r, rng, "goblin-1", 7);
	r = applyDamageTo(r, rng, "goblin-2", 7);
	assert.equal(r.encounter.status, "victory");
	assert.equal(r.encounter.xpPool, 100);
	assert.ok(r.events.some((e) => e.type === "combat_ended" && e.status === "victory"));
	const after = endTurn(r, rng);
	assert.equal(after.ok, false);
});

test("a fleeing enemy is removed; the last one leaving is a victory", () => {
	let r: CombatResult = start([5, 15, 10]); // g1, g2, pc
	const rng = new ScriptedRng([]);
	r = removeCombatant(r, rng, "goblin-1", "fled");
	assert.ok(r.ok);
	assert.deepEqual(r.encounter.order, ["goblin-2", "pc1"]);
	assert.equal(currentCombatant(r.encounter)?.id, "goblin-2");
	assert.equal(r.map.entities.length, 2);
	r = removeCombatant(r, rng, "goblin-2", "fled");
	assert.equal(r.encounter.status, "victory");
	assert.equal(r.encounter.xpPool, 0);
});

test("condition durations tick at the end of the creature's turn; end-of-turn saves can end them", () => {
	let r: CombatResult = start([20, 10, 5]);
	const rng = new ScriptedRng([]);
	r = applyConditionTo(r, rng, "pc1", { id: "poisoned", rounds: 1 });
	r = applyConditionTo(r, rng, "pc1", { id: "frightened", note: "DC 13 WIS save at end of each turn" });
	assert.equal(r.encounter.combatants.pc1.conditions.length, 2);
	rng.push(15); // WIS save: 15 + 1 = 16 ≥ 13
	r = endTurn(r, rng);
	assert.deepEqual(r.encounter.combatants.pc1.conditions, []);
	assert.deepEqual(r.character?.conditions, []);
});

test("recharge abilities roll at the start of the monster's turn", () => {
	const dragonish = makeMonster({
		index: "drake",
		name: "Drake",
		actions: [{ name: "Fire Breath", description: "", save: { ability: "dex", dc: 12, damage: [{ dice: "4d6", type: "fire" }], halfOnSuccess: true }, usage: { type: "recharge", minRoll: 5 } }],
	});
	let r: CombatResult = start([20, 5], [dragonish]);
	r.encounter.combatants["drake-1"].usage["Fire Breath"] = { used: 1, charged: false };
	const rng = new ScriptedRng([5]);
	r = endTurn(r, rng);
	assert.equal(r.encounter.combatants["drake-1"].usage["Fire Breath"].charged, true);
	assert.ok(r.events.some((e) => e.type === "recharge" && e.charged));
});

test("legendary actions reset at the start of the creature's turn", () => {
	const boss = makeMonster({ index: "boss", name: "Boss", legendaryActions: [{ name: "Tail", description: "", attack: { name: "Tail", kind: "melee", toHit: 5, reach: 10, damage: [{ dice: "1d8", type: "bludgeoning" }], description: "" } }] });
	let r: CombatResult = start([20, 5], [boss]);
	assert.equal(r.encounter.combatants["boss-1"].legendaryActionsLeft, 3);
	r.encounter.combatants["boss-1"].legendaryActionsLeft = 0;
	r = endTurn(r, new ScriptedRng([]));
	assert.equal(r.encounter.combatants["boss-1"].legendaryActionsLeft, 3);
});

test("addMonsters inserts reinforcements without changing whose turn it is", () => {
	let r: CombatResult = start([10, 5, 3]); // pc 12, g1 7, g2 5
	const rng = new ScriptedRng([20]); // bear: 20 → top
	r = addMonsters(r, rng, [{ stats: makeBear(), near: { x: 5, y: 5 } }]);
	assert.equal(r.encounter.order[0], "brown-bear-1");
	assert.equal(currentCombatant(r.encounter)?.id, "pc1");
});

test("endCombat ends manually", () => {
	const r = endCombat(start([20, 10, 5]), new ScriptedRng([]), "fled");
	assert.equal(r.encounter.status, "fled");
});

test("same seed → identical results; inputs are not mutated", () => {
	const input = { encounterId: "e1", map: openMap(), character: makeFighter(), monsters: [{ stats: makeMonster(), position: { x: 5, y: 5 } }] };
	const snapshot = JSON.stringify(input);
	const a = startCombat(input, new Rng(42));
	const b = startCombat(input, new Rng(42));
	assert.deepEqual(a.encounter, b.encounter);
	assert.deepEqual(a.rolls.map((x) => x.total), b.rolls.map((x) => x.total));
	assert.equal(JSON.stringify(input), snapshot);
	const before = JSON.stringify(a.encounter);
	endTurn(a, new Rng(1));
	assert.equal(JSON.stringify(a.encounter), before);
});
