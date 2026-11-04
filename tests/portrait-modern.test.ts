import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Portrait } from "../components/art/Portrait";
import { modernLook } from "../components/art/PortraitModern";
import { personLook } from "../components/art/sprite/person";
import { portraitTraits, randomPortrait } from "../lib/art/portrait";
import { Rng } from "../lib/rules/dice";

const CLASSES = ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"];

test("modern portraits wear the same outfit as the pixel sprite", () => {
	for (let i = 0; i < 40; i++) {
		const spec = randomPortrait(new Rng(500 + i), "human");
		const who = i < CLASSES.length ? { classes: [CLASSES[i]] } : { text: ["diner waitress", "student", "pastor", "pharmacist", "sheriff's deputy"][i % 5] };
		const t = portraitTraits(spec, "human");
		assert.equal(modernLook(spec, who, t.clothing, t.age).outfit, personLook(spec, "human", "none", { ruleset: "zombie", ...who }).outfit);
	}
});

test("modern mode drops fantasy headgear and frames; fantasy mode is untouched", () => {
	const spec = { ...randomPortrait(new Rng(7), "elf"), accessory: "crown", features: ["pointed_ears", "horns"] };
	const fantasy = renderToStaticMarkup(createElement(Portrait, { spec, speciesId: "elf", name: "Aerin" }));
	const badge = renderToStaticMarkup(createElement(Portrait, { spec, speciesId: "elf", name: "Aerin", modern: { classes: ["paladin"] }, frameStyle: "badge" }));
	const polaroid = renderToStaticMarkup(createElement(Portrait, { spec, speciesId: "elf", name: "Aerin", modern: { classes: ["paladin"] }, frameStyle: "polaroid" }));
	assert.ok(fantasy.includes("Georgia"), "fantasy keeps its serif name plate");
	assert.ok(!fantasy.includes("KESSLER"));
	assert.ok(badge.includes("KESSLER FALLS POLICE") && badge.includes("AERIN"));
	assert.ok(!polaroid.includes("KESSLER") && polaroid.includes("Aerin"));
	for (const html of [badge, polaroid]) {
		assert.ok(!html.includes("Georgia"), "no fantasy name plate");
		assert.ok(!html.includes("-horn"), "no horns in The Quiet");
	}
});
