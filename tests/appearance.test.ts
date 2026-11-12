import { test } from "node:test";
import assert from "node:assert/strict";
import { appearanceFromText, portraitFromAppearance, repairNpcPortraits } from "../lib/art/appearance";
import { portraitTraits, randomPortrait } from "../lib/art/portrait";
import { Rng } from "../lib/rules/dice";

test("reads gender, age, beard and clothing from English and Spanish", () => {
	assert.deepEqual(appearanceFromText("plague-friar. A gaunt human friar in ash-grey robes; his hands shake.").gender, "male");
	const elsie = appearanceFromText("superviviente. Niña humana de unos nueve años, con el pelo enmarañado; sobrina del hermano Cuthbert.");
	assert.equal(elsie.gender, "female");
	assert.equal(elsie.age, "child");
	const ros = appearanceFromText("A rangy, weather-burned woman in her forties wearing a patched brigandine. A burn scar runs from her jaw.");
	assert.equal(ros.gender, "female");
	assert.equal(ros.age, "middle-aged");
	assert.equal(ros.clothing, "armor");
	const old = appearanceFromText("Un anciano calvo de barba larga y túnica negra.");
	assert.equal(old.gender, "male");
	assert.equal(old.age, "old");
	assert.equal(old.hair, "bald");
	assert.equal(old.facialHair, "full_beard");
	assert.equal(old.clothing, "robe");
});

test("portraits honor the appearance; women never get beards", () => {
	for (let i = 1; i < 50; i++) {
		const p = portraitFromAppearance(new Rng(i), "dwarf", { gender: "female", age: "old" });
		assert.equal(p.gender, "female");
		assert.equal(p.facialHair, "none");
		const tr = portraitTraits(p, "dwarf");
		assert.equal(tr.female, true);
		assert.ok(tr.age >= 0.75);
	}
	for (let i = 1; i < 50; i++) {
		const p = randomPortrait(new Rng(i), "human");
		if (p.gender === "female") assert.equal(p.facialHair, "none");
	}
});

test("repair fixes old random portraits once", () => {
	const portrait = { ...randomPortrait(new Rng(7), "human"), facialHair: "full_beard" };
	delete (portrait as { gender?: string }).gender;
	const npcs = { a: { name: "Elsie", role: "survivor", description: "A girl of nine years.", speciesId: "human", portrait } };
	assert.equal(repairNpcPortraits(npcs), true);
	assert.equal(npcs.a.portrait.gender, "female");
	assert.equal(npcs.a.portrait.facialHair, "none");
	assert.equal(repairNpcPortraits(npcs), false);
});

test("reads men's cuts from English and Spanish descriptions", () => {
	assert.equal(appearanceFromText("A wiry man with dreadlocks to his shoulders.").hair, "dreadlocks");
	assert.equal(appearanceFromText("Un hombre joven con rastas y barba corta.").hair, "dreadlocks");
	assert.equal(appearanceFromText("A bouncer with tight cornrows.").hair, "cornrows");
	assert.equal(appearanceFromText("A soldier with a buzz cut.").hair, "buzz");
	assert.equal(appearanceFromText("A banker, hair slicked back.").hair, "slicked_back");
	assert.equal(appearanceFromText("Un tabernero de mediana edad con entradas pronunciadas.").hair, "receding");
	assert.equal(appearanceFromText("A mechanic with a flat top.").hair, "flat_top");
	assert.equal(appearanceFromText("A guard who dreads the dark, standing by the curtains.").hair, undefined);
});
