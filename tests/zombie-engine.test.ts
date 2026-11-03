import assert from "node:assert/strict";
import { test } from "node:test";
import type { Character, InventoryItem } from "../lib/game/types";
import { makeFighter, makeMonster, makeWizard, openMap, ScriptedRng } from "../lib/rules/combat/fixtures";
import { startCombat } from "../lib/rules/combat/encounter";
import { applyPlayerAction } from "../lib/rules/combat/player";
import type { CombatOptions, CombatResult } from "../lib/rules/combat/types";
import { missingSupplies, spendSupplies, supplyCount } from "../lib/rules/combat/supplies";
import { getEquipment, getMonster, getSpell } from "../lib/srd";
import { autoMonsterTurn } from "../lib/rules/combat/monster";

const opts: CombatOptions = { equipment: (i) => getEquipment(i), spells: (i) => getSpell(i) };

const pistol: InventoryItem = { id: "gun", ref: "z-pistol-9mm", name: "9mm Pistol", quantity: 1, category: "weapon", equipped: true, weapon: { damage: "1d10", damageType: "piercing", properties: ["ammunition", "loud", "light"], range: { normal: 50, long: 150 } } };
const bow: InventoryItem = { id: "cbow", ref: "z-compound-bow", name: "Compound Bow", quantity: 1, category: "weapon", weapon: { damage: "1d8", damageType: "piercing", properties: ["ammunition", "two-handed", "quiet"], range: { normal: 150, long: 600 } } };
const rounds = (n: number): InventoryItem => ({ id: "r9", ref: "z-ammo-9mm", name: "9mm Rounds", quantity: n, category: "ammunition" });

function fight(pc: Character): CombatResult {
	const r = startCombat(
		{ encounterId: "e1", map: openMap(30, 10), character: pc, pcPosition: { x: 1, y: 1 }, monsters: [{ stats: makeMonster({ hp: 200 }), id: "z1", position: { x: 6, y: 1 } }] },
		new ScriptedRng([20, 1]),
		opts,
	);
	assert.ok(r.ok, r.error);
	return r;
}

test("firearms use up one round per attack (hit or miss) and are loud", () => {
	const pc = makeFighter({ inventory: [...makeFighter().inventory, { ...pistol }, rounds(2)] });
	const r = fight(pc);
	const a = applyPlayerAction(r, new ScriptedRng([2]), { type: "attack", targetId: "z1", itemId: "gun" }, opts); // a miss still spends the round
	assert.ok(a.ok, a.error);
	assert.equal(a.character!.inventory.find((i) => i.ref === "z-ammo-9mm")!.quantity, 1);
	assert.ok(a.log.some((l) => /Gunshot: loud/.test(l)));
	assert.ok(a.log.some((l) => /Used 1 × 9mm Rounds \(1 left\)/.test(l)));
	assert.deepEqual(a.events.filter((e) => e.type === "noise"), [{ type: "noise", combatantId: "pc1", source: "9mm Pistol", loudness: 3 }]);
	// Extra Attack: the second attack spends the last round and the empty stack leaves the inventory.
	const b = applyPlayerAction(a, new ScriptedRng([18, 5]), { type: "attack", targetId: "z1", itemId: "gun" }, opts);
	assert.ok(b.ok, b.error);
	assert.equal(b.character!.inventory.some((i) => i.ref === "z-ammo-9mm"), false);
});

test("no ammo, no shot: the attack fails with a clear message and nothing is spent", () => {
	const r = fight(makeFighter({ inventory: [{ ...pistol }] }));
	const res = applyPlayerAction(r, new ScriptedRng([15, 5]), { type: "attack", targetId: "z1", itemId: "gun" }, opts);
	assert.equal(res.ok, false);
	assert.match(res.error!, /Out of 9mm Rounds/);
	assert.equal(res.encounter.combatants.pc1.turn.action, true);
});

test("quiet bows use arrows but make no noise; fantasy bows are unchanged", () => {
	const pc = makeFighter({ inventory: [...makeFighter().inventory, { ...bow }, { id: "arr", ref: "z-arrow", name: "Arrows", quantity: 3, category: "ammunition" }] });
	const r = fight(pc);
	const a = applyPlayerAction(r, new ScriptedRng([15, 4]), { type: "attack", targetId: "z1", itemId: "cbow" }, opts);
	assert.ok(a.ok, a.error);
	assert.equal(a.character!.inventory.find((i) => i.ref === "z-arrow")!.quantity, 2);
	assert.equal(a.events.some((e) => e.type === "noise"), false);
	// The fixture Longbow has no ref/ammo entry: it fires without arrows, as before.
	const f = applyPlayerAction(r, new ScriptedRng([15, 4]), { type: "attack", targetId: "z1", itemId: "bow" }, opts);
	assert.ok(f.ok, f.error);
	// The SRD longbow by ref has no `ammo` either.
	const srdBow = makeFighter({ inventory: [{ ...makeFighter().inventory[1], ref: "longbow" }] });
	const g = applyPlayerAction(fight(srdBow), new ScriptedRng([15, 4]), { type: "attack", targetId: "z1", itemId: "bow" }, opts);
	assert.ok(g.ok, g.error);
});

test("monster attacks don't track ammo", () => {
	const pc = makeFighter({ inventory: [...makeFighter().inventory, { ...pistol }, rounds(5)] });
	const r = startCombat(
		{ encounterId: "e1", map: openMap(30, 10), character: pc, pcPosition: { x: 1, y: 1 }, monsters: [{ stats: getMonster("z-raider-gunman")!, id: "g1", position: { x: 10, y: 1 } }] },
		new ScriptedRng([1, 20]),
		opts,
	);
	assert.ok(r.ok, r.error);
	assert.equal(r.encounter.order[r.encounter.turnIndex], "g1");
	const t = autoMonsterTurn(r, new ScriptedRng(), "g1", opts);
	assert.ok(t.ok, t.error);
	assert.ok(t.events.some((e) => e.type === "attack"), "the gunman shoots");
	assert.equal(t.events.some((e) => e.type === "noise"), false);
	assert.equal((t.character ?? pc).inventory.find((i) => i.ref === "z-ammo-9mm")!.quantity, 5);
});

const molotovKit = (): InventoryItem[] => [
	{ id: "b", ref: "z-glass-bottle", name: "Glass Bottle", quantity: 2, category: "gear" },
	{ id: "g", ref: "z-gasoline", name: "Gasoline Can", quantity: 1, category: "gear" },
	{ id: "r", ref: "z-rag", name: "Rag", quantity: 1, category: "gear" },
];
const chemist = (inv: InventoryItem[]) =>
	makeWizard({ inventory: inv, spellcasting: { classes: [{ classId: "wizard", ability: "int", known: [], prepared: ["t-molotov"], cantrips: ["t-taser"] }], slots: [4, 3, 2], slotsUsed: [0, 0, 0] } });

test("techniques with components use them up in combat; missing components refuse the cast", () => {
	const r = fight(chemist(molotovKit()));
	const ok = applyPlayerAction(r, new ScriptedRng(), { type: "cast", spell: "t-molotov", slotLevel: 1, point: { x: 6, y: 1 } }, opts);
	assert.ok(ok.ok, ok.error);
	const inv = ok.character!.inventory;
	assert.equal(inv.find((i) => i.ref === "z-glass-bottle")!.quantity, 1);
	assert.equal(inv.some((i) => i.ref === "z-gasoline" || i.ref === "z-rag"), false);
	assert.equal(ok.character!.spellcasting!.slotsUsed[0], 1);
	assert.ok(ok.encounter.combatants.z1.hp < 200);
	// Second throw: no gasoline left.
	const ok2 = { ...ok, encounter: { ...ok.encounter, combatants: { ...ok.encounter.combatants, pc1: { ...ok.encounter.combatants.pc1, turn: { ...ok.encounter.combatants.pc1.turn, action: true } } } } };
	const no = applyPlayerAction(ok2, new ScriptedRng(), { type: "cast", spell: "t-molotov", slotLevel: 1, point: { x: 6, y: 1 } }, opts);
	assert.equal(no.ok, false);
	assert.match(no.error!, /Molotov needs .*Missing: Gasoline Can \(have 0, need 1\), Rag \(have 0, need 1\)/);
	// Cantrips without components need nothing.
	const tz = applyPlayerAction(fight(chemist([])), new ScriptedRng([15, 4]), { type: "cast", spell: "t-taser", slotLevel: 0, targetIds: ["z1"] }, opts);
	assert.equal(tz.ok, false, "out of reach"); // 25 ft away: a touch technique needs adjacency
	assert.match(tz.error!, /out of range/);
});

test("supplies helpers count across stacks and by name for hand-added items", () => {
	const c = { inventory: [{ id: "a", ref: "z-bandage", name: "Bandage", quantity: 1, category: "gear" }, { id: "b", name: "bandage", quantity: 2, category: "gear" }, { id: "c", name: "Empty", quantity: 0, category: "gear" }] as InventoryItem[] };
	const nameOf = (r: string) => getEquipment(r)?.name;
	assert.equal(supplyCount(c, "z-bandage", nameOf), 3);
	assert.deepEqual(missingSupplies(c, [{ ref: "z-bandage", qty: 4 }], nameOf), ["Bandage (have 3, need 4)"]);
	spendSupplies(c, [{ ref: "z-bandage", qty: 2 }], nameOf);
	assert.deepEqual(c.inventory.map((i) => [i.id, i.quantity]), [["b", 1], ["c", 0]]);
});
