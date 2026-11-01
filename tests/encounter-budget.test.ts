import { test } from "node:test";
import assert from "node:assert/strict";
import { allyCap, budgetCap, checkBudget, soloMultiplier } from "../lib/rules/encounter-budget";

test("solo multiplier is one step up", () => {
	assert.equal(soloMultiplier(1), 1.5);
	assert.equal(soloMultiplier(3), 2.5);
	assert.equal(soloMultiplier(8), 3);
});

test("three zombies vs a level 2 paladin on normal is refused", () => {
	const b = checkBudget(2, "normal", [50, 50, 50]);
	assert.equal(b.adjustedXp, 375);
	assert.equal(b.cap, budgetCap(2, "normal"));
	assert.equal(b.ok, false);
	assert.equal(b.band, "beyond deadly");
});

test("a single zombie is fine at level 2 normal", () => {
	assert.equal(checkBudget(2, "normal", [50]).ok, true);
});

test("a veteran ally (700 XP) is too strong for level 2; a guard is fine", () => {
	assert.equal(checkBudget(2, "normal", [50], [700]).allyOk, false);
	assert.equal(checkBudget(2, "normal", [50], [25]).allyOk, true);
	assert.equal(allyCap(2), 50);
});
