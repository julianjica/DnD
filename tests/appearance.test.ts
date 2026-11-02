import { test } from "node:test";
import assert from "node:assert/strict";
import { appearanceFromText, applyAppearance, expressionForDisposition, portraitFromAppearance, repairNpcPortraits } from "../lib/art/appearance";
import { BUILDS, EXPRESSIONS, portraitTraits, randomPortrait, SIGNATURES, SPECIES_IDS } from "../lib/art/portrait";
import type { PortraitSpec } from "../lib/game/types";
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

test("expression, build and signature come from the role and description (EN + ES)", () => {
	const inn = appearanceFromText("innkeeper. A portly, jovial man with a stained apron.");
	assert.equal(inn.signature, "mug");
	assert.equal(inn.build, "heavy");
	assert.equal(inn.expression, "smile");
	assert.equal(inn.clothing, "tunic");
	assert.equal(appearanceFromText("sacerdotisa. Una mujer severa de túnica blanca.").signature, "holy_symbol");
	assert.equal(appearanceFromText("sacerdotisa. Una mujer severa de túnica blanca.").expression, "stern");
	assert.equal(appearanceFromText("escriba del archivo. Delgado y nervioso.").signature, "quill");
	assert.equal(appearanceFromText("escriba del archivo. Delgado y nervioso.").build, "slim");
	assert.equal(appearanceFromText("escriba del archivo. Delgado y nervioso.").expression, "worried");
	assert.equal(appearanceFromText("scholar. Bent over a ledger.").signature, "book");
	assert.equal(appearanceFromText("mago de la torre").signature, "wizard_hat");
	assert.equal(appearanceFromText("warlock in a black cloak, leaning on a gnarled staff").signature, "staff");
	assert.equal(appearanceFromText("Un viejo marinero que fuma en pipa, socarrón.").signature, "pipe");
	assert.equal(appearanceFromText("Un viejo marinero que fuma en pipa, socarrón.").expression, "smirk");
	assert.equal(appearanceFromText("guard. A burly, scowling woman.").build, "broad");
	assert.equal(appearanceFromText("guard. A burly, scowling woman.").expression, "angry");
	assert.equal(appearanceFromText("A farmer.").signature, undefined);
	assert.equal(expressionForDisposition("hostile"), "stern");
	assert.equal(expressionForDisposition("friendly"), "smile");
	assert.equal(expressionForDisposition("neutral"), undefined);
});

test("new portrait fields are honored, kept on update and deterministic", () => {
	const p = portraitFromAppearance(new Rng(3), "human", { expression: "sad", build: "heavy", signature: "lantern" });
	assert.equal(p.expression, "sad");
	assert.equal(p.build, "heavy");
	assert.equal(p.signature, "lantern");
	const tr = portraitTraits(p, "human");
	assert.equal(tr.expression, "sad");
	assert.equal(tr.build, "heavy");
	assert.equal(tr.signature, "lantern");
	const upd = applyAppearance(new Rng(4), p, "human", { headwear: "hood" });
	assert.equal(upd.signature, "lantern");
	assert.equal(upd.expression, "sad");
	assert.equal(applyAppearance(new Rng(4), p, "human", { signature: "book" }).signature, "book");
	// Same spec → same traits; old saves without the new fields get valid seeded defaults.
	for (let i = 1; i < 40; i++) {
		const old = randomPortrait(new Rng(i), SPECIES_IDS[i % SPECIES_IDS.length]);
		delete old.expression;
		delete old.build;
		delete old.signature;
		const a = portraitTraits(old, "dwarf");
		assert.deepEqual(a, portraitTraits({ ...old }, "dwarf"));
		assert.ok((EXPRESSIONS as readonly string[]).includes(a.expression));
		assert.ok((BUILDS as readonly string[]).includes(a.build));
		assert.equal(a.signature, "none");
		assert.match(a.accent, /^#[0-9a-f]{6}$/);
	}
	// Unknown values fall back instead of breaking.
	const odd = { ...randomPortrait(new Rng(9), "elf"), expression: "ecstatic", build: "huge", signature: "banjo" } as unknown as PortraitSpec;
	const tOdd = portraitTraits(odd, "elf");
	assert.ok((EXPRESSIONS as readonly string[]).includes(tOdd.expression));
	assert.equal(tOdd.signature, "none");
});

test("the painted portrait renders deterministically for every species", async () => {
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { Portrait } = await import("../components/art/Portrait");
	for (let i = 0; i < SPECIES_IDS.length * 2; i++) {
		const sp = SPECIES_IDS[i % SPECIES_IDS.length];
		const spec: PortraitSpec = { ...randomPortrait(new Rng(100 + i), sp), signature: SIGNATURES[i % SIGNATURES.length], accessory: i % 3 ? "none" : "hood" };
		const html = renderToStaticMarkup(createElement(Portrait, { spec, speciesId: sp, size: i % 2 ? 56 : 160 }));
		assert.ok(html.startsWith("<svg") && html.length > 2000);
		assert.ok(!html.includes("NaN"), `NaN in ${sp}`);
		assert.equal(html, renderToStaticMarkup(createElement(Portrait, { spec, speciesId: sp, size: i % 2 ? 56 : 160 })));
	}
});
