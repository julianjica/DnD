import { test } from "node:test";
import assert from "node:assert/strict";
import { NARRATION_BUDGET, narrationWords } from "../lib/dm/prompt";

test("narration budgets are numbers, smallest to largest, and words are counted like a reader would", () => {
	assert.deepEqual(NARRATION_BUDGET, { minimal: 60, terse: 90, balanced: 160, rich: 300 });
	assert.equal(narrationWords("Te volteas hacia **Chucho**.  —Deuda saldada —le dices—."), 8);
	assert.equal(narrationWords("A sword — 3 goblins, *one* fled!"), 6);
	assert.equal(narrationWords(""), 0);
});
