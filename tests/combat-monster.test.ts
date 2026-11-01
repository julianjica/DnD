import assert from "node:assert/strict";
import { test } from "node:test";
import type { MonsterStats } from "../lib/game/types";
import { makeBear, makeFighter, makeMonster, openMap, ScriptedRng } from "../lib/rules/combat/fixtures";
import { startCombat } from "../lib/rules/combat/encounter";
import { autoMonsterTurn, monsterAct } from "../lib/rules/combat/monster";
import { applyDamageTo } from "../lib/rules/combat/dm";
import type { CombatResult } from "../lib/rules/combat/types";

/** Monster `m` goes first (PC initiative roll 1). */
function monsterFirst(stats: MonsterStats, at: { x: number; y: number }, id = "m", pcFirst = false): CombatResult {
	const r = startCombat(
		{ encounterId: "e1", map: openMap(30, 10), character: makeFighter(), pcPosition: { x: 1, y: 1 }, monsters: [{ stats, id, position: at }] },
		new ScriptedRng(pcFirst ? [20, 1] : [1, 20]),
	);
	assert.ok(r.ok, r.error);
	return r;
}

test("multiattack resolves each attack", () => {
	const r = monsterFirst(makeBear(), { x: 2, y: 1 });
	const res = monsterAct(r, new ScriptedRng([15, 4, 15, 3, 3]), "m", { actionName: "Multiattack", targetIds: ["pc1"] });
	assert.ok(res.ok, res.error);
	assert.equal(res.events.filter((e) => e.type === "attack").length, 2);
	assert.equal(res.encounter.combatants.pc1.hp, 44 - 8 - 10);
	assert.equal(res.character?.hp, 26);
	assert.equal(res.encounter.combatants.m.turn.action, false);
	const again = monsterAct(res, new ScriptedRng([]), "m", { actionName: "Bite", targetIds: ["pc1"] });
	assert.match(again.error!, /already used its action/);
});

test("monsterAct moves along an A* path then attacks", () => {
	const r = monsterFirst(makeMonster(), { x: 7, y: 1 });
	const res = monsterAct(r, new ScriptedRng([16, 4]), "m", { actionName: "Scimitar", targetIds: ["pc1"], moveTo: { x: 2, y: 1 } });
	assert.ok(res.ok, res.error);
	assert.deepEqual(res.map.entities.find((e) => e.combatantId === "m") && { x: res.map.entities.find((e) => e.combatantId === "m")!.x, y: 1 }, { x: 2, y: 1 });
	assert.equal(res.encounter.combatants.m.turn.movementLeft, 5);
	assert.equal(res.encounter.combatants.pc1.hp, 44 - 6);
	const tooFar = monsterAct(r, new ScriptedRng([]), "m", { actionName: "Scimitar", targetIds: ["pc1"], moveTo: { x: 25, y: 1 } });
	assert.match(tooFar.error!, /cannot reach/);
	const outOfReach = monsterAct(r, new ScriptedRng([]), "m", { actionName: "Scimitar", targetIds: ["pc1"] });
	assert.match(outOfReach.error!, /out of reach/);
});

test("recharge save actions: damage once, half on success, then must recharge", () => {
	const drake = makeMonster({
		index: "drake",
		name: "Drake",
		actions: [{ name: "Fire Breath", description: "", save: { ability: "dex", dc: 13, damage: [{ dice: "4d6", type: "fire" }], halfOnSuccess: true }, usage: { type: "recharge", minRoll: 5 } }],
	});
	const r = monsterFirst(drake, { x: 4, y: 1 });
	const res = monsterAct(r, new ScriptedRng([6, 6, 6, 6, 1]), "m", { actionName: "Fire Breath", targetIds: ["pc1"] });
	assert.ok(res.ok, res.error);
	assert.equal(res.encounter.combatants.pc1.hp, 44 - 24);
	assert.equal(res.encounter.combatants.m.usage["Fire Breath"].charged, false);
	const saved = monsterAct(r, new ScriptedRng([6, 6, 6, 6, 19]), "m", { actionName: "Fire Breath", targetIds: ["pc1"] });
	assert.equal(saved.encounter.combatants.pc1.hp, 44 - 12);
	const next = structuredClone(res);
	next.encounter.combatants.m.turn.action = true;
	assert.match(monsterAct(next, new ScriptedRng([]), "m", { actionName: "Fire Breath", targetIds: ["pc1"] }).error!, /not recharged/);
});

test("attack riders apply named conditions on a failed save", () => {
	const snake = makeMonster({
		index: "snake",
		name: "Snake",
		actions: [{ name: "Bite", description: "", attack: { name: "Bite", kind: "melee", toHit: 5, reach: 5, damage: [{ dice: "1d4+2", type: "piercing" }], save: { ability: "con", dc: 15, onFail: "The target is poisoned." }, description: "" } }],
	});
	const r = monsterFirst(snake, { x: 2, y: 1 });
	const res = monsterAct(r, new ScriptedRng([18, 2, 3]), "m", { actionName: "Bite", targetIds: ["pc1"] });
	assert.ok(res.ok, res.error);
	assert.ok(res.encounter.combatants.pc1.conditions.some((c) => c.id === "poisoned"));
	assert.ok(res.character?.conditions.some((c) => c.id === "poisoned"));
});

test("legendary actions can be used outside the creature's turn and are limited", () => {
	const boss = makeMonster({
		index: "boss",
		name: "Boss",
		legendaryActions: [
			{ name: "Tail Attack", description: "", attack: { name: "Tail", kind: "melee", toHit: 5, reach: 10, damage: [{ dice: "1d8", type: "bludgeoning" }], description: "" } },
			{ name: "Wing Attack (Costs 2 Actions)", description: "", save: { ability: "dex", dc: 10, damage: [{ dice: "1d6", type: "bludgeoning" }] } },
		],
	});
	const r = monsterFirst(boss, { x: 3, y: 1 }, "m", true);
	const tail = monsterAct(r, new ScriptedRng([2]), "m", { actionName: "Tail Attack", targetIds: ["pc1"] });
	assert.ok(tail.ok, tail.error);
	assert.equal(tail.encounter.combatants.m.legendaryActionsLeft, 2);
	const wing = monsterAct(tail, new ScriptedRng([1, 1]), "m", { actionName: "Wing Attack", targetIds: ["pc1"] });
	assert.equal(wing.encounter.combatants.m.legendaryActionsLeft, 0);
	assert.match(monsterAct(wing, new ScriptedRng([]), "m", { actionName: "Tail Attack", targetIds: ["pc1"] }).error!, /no legendary/);
	assert.match(monsterAct(r, new ScriptedRng([]), "m", { actionName: "Scimitar", targetIds: ["pc1"] }).error!, /not Boss's turn/);
});

test("a fleeing monster provokes the PC's opportunity attack", () => {
	const r = monsterFirst(makeMonster(), { x: 2, y: 1 });
	const res = monsterAct(r, new ScriptedRng([15, 4]), "m", { moveTo: { x: 6, y: 1 } });
	assert.ok(res.ok, res.error);
	assert.ok(res.events.some((e) => e.type === "opportunity_attack" && e.attackerId === "pc1"));
	assert.ok(res.encounter.combatants.m.dead);
	assert.equal(res.encounter.status, "victory");
	assert.equal(res.encounter.combatants.pc1.turn.reaction, false);
	const noAuto = monsterAct(r, new ScriptedRng([]), "m", { moveTo: { x: 6, y: 1 } }, { autoReactions: false });
	assert.ok(!noAuto.events.some((e) => e.type === "opportunity_attack"));
});

test("autoMonsterTurn approaches the nearest foe, attacks, and ends its turn", () => {
	const r = monsterFirst(makeMonster(), { x: 7, y: 1 });
	const res = autoMonsterTurn(r, new ScriptedRng([16, 4]), "m");
	assert.ok(res.ok, res.error);
	const ent = res.map.entities.find((e) => e.combatantId === "m")!;
	assert.equal(Math.max(Math.abs(ent.x - 1), Math.abs(ent.y - 1)), 1);
	assert.equal(res.encounter.combatants.pc1.hp, 44 - 6);
	assert.equal(res.encounter.order[res.encounter.turnIndex], "pc1");
});

test("autoMonsterTurn dashes when the target is out of reach this turn", () => {
	const r = monsterFirst(makeBear({ speed: { walk: 20 } }), { x: 20, y: 1 });
	const res = autoMonsterTurn(r, new ScriptedRng([]), "m", { endTurn: false });
	assert.ok(res.ok, res.error);
	assert.ok(res.events.some((e) => e.type === "action_used" && e.action === "dash"));
	assert.equal(res.map.entities.find((e) => e.combatantId === "m")!.x, 12);
});

test("autoMonsterTurn uses multiattack and leaves a downed PC alone by default", () => {
	const r = monsterFirst(makeBear(), { x: 2, y: 1 });
	const res = autoMonsterTurn(r, new ScriptedRng([2, 2]), "m");
	assert.ok(res.events.some((e) => e.type === "action_used" && e.action === "Multiattack"));
	assert.equal(res.events.filter((e) => e.type === "attack").length, 2);
	const downed = applyDamageTo(r, new ScriptedRng([]), "pc1", 44);
	const idle = autoMonsterTurn(downed, new ScriptedRng([]), "m");
	assert.ok(idle.ok);
	assert.equal(idle.events.filter((e) => e.type === "attack").length, 0);
	// finishDowned: melee hits on an unconscious PC are auto-crits → 2 failures each.
	const brutal = autoMonsterTurn(downed, new ScriptedRng([15, 15, 1, 1, 15, 15, 1, 1, 1, 1]), "m", { finishDowned: true });
	assert.ok(brutal.encounter.combatants.pc1.dead);
	assert.equal(brutal.encounter.status, "defeat");
});

test("monsters can Disengage (or Dash/Dodge) generically, then move without provoking", () => {
	const r = monsterFirst(makeMonster(), { x: 2, y: 1 });
	const res = monsterAct(r, new ScriptedRng([]), "m", { actionName: "Disengage", moveTo: { x: 6, y: 1 } });
	assert.ok(res.ok, res.error);
	assert.ok(!res.events.some((e) => e.type === "opportunity_attack"));
	assert.equal(res.map.entities.find((e) => e.combatantId === "m")!.x, 6);
	const dash = monsterAct(r, new ScriptedRng([15, 4]), "m", { actionName: "Dash", moveTo: { x: 14, y: 1 } });
	assert.ok(dash.ok, dash.error);
});

test("spawning onto a DM-placed token reuses the entity", () => {
	const map = openMap(10, 10);
	map.entities.push({ id: "tok1", kind: "monster", name: "Grik", x: 6, y: 6, size: 1, sprite: "goblin" });
	const r = startCombat({ encounterId: "e", map, character: makeFighter(), monsters: [{ stats: makeMonster(), entityId: "tok1", id: "grik" }] }, new ScriptedRng([10, 10]));
	assert.ok(r.ok, r.error);
	assert.equal(r.map.entities.filter((e) => e.kind === "monster").length, 1);
	assert.equal(r.map.entities.find((e) => e.id === "tok1")?.combatantId, "grik");
	assert.equal(r.encounter.combatants.grik.entityId, "tok1");
});
