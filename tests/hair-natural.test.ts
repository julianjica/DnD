import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Portrait } from "../components/art/Portrait";
import { NATURAL_CUT_IDS } from "../components/art/hairNaturalCuts";
import { paintPerson, personLook } from "../components/art/sprite/person";
import { DM_HAIR_IDS, appearanceFromText } from "../lib/art/appearance";
import { HAIR_STYLES, NATURAL_HAIR_LIVE, NATURAL_MALE_HAIR, NEW_MALE_HAIR, hairStyleChoices, portraitOptions, randomPortrait } from "../lib/art/portrait";
import { Rng } from "../lib/rules/dice";

test("every natural men's cut has a drawing and a sprite", () => {
	assert.deepEqual([...NATURAL_CUT_IDS].sort(), [...NATURAL_MALE_HAIR].sort());
	const base = { ...randomPortrait(new Rng(7), "human"), gender: "male" as const, accessory: "none" };
	const plain = renderToStaticMarkup(createElement(Portrait, { spec: { ...base, hairStyle: "bald" } }));
	for (const id of NATURAL_MALE_HAIR) {
		for (const accessory of ["none", "hood", "helmet"]) {
			const svg = renderToStaticMarkup(createElement(Portrait, { spec: { ...base, hairStyle: id, accessory } }));
			assert.ok(svg.startsWith("<svg") && !svg.includes("NaN"), `${id} ${accessory}`);
			if (accessory === "none") assert.notEqual(svg, plain, id);
		}
		const modern = renderToStaticMarkup(createElement(Portrait, { spec: { ...base, hairStyle: id, outfit: "police" }, modern: { classes: ["fighter"] } }));
		assert.ok(!modern.includes("NaN"), id);
		const px: string[] = [];
		paintPerson((x, y, c) => px.push(`${x},${y},${c}`), personLook({ ...base, hairStyle: id }, "human", "none"));
		const bald: string[] = [];
		paintPerson((x, y, c) => bald.push(`${x},${y},${c}`), personLook({ ...base, hairStyle: "bald" }, "human", "none"));
		assert.notEqual(px.join(";"), bald.join(";"), `${id} sprite`);
	}
});

test("natural cuts stay held back until NATURAL_HAIR_LIVE", () => {
	if (NATURAL_HAIR_LIVE) return;
	assert.equal(portraitOptions.hairStyle, HAIR_STYLES);
	for (const id of NATURAL_MALE_HAIR) {
		assert.ok(!HAIR_STYLES.includes(id as never), id);
		assert.ok(!DM_HAIR_IDS.includes(id), id);
	}
	for (let i = 0; i < 200; i++) assert.ok(!randomPortrait(new Rng(i), "human").hairStyle.startsWith("m_"));
	assert.equal(appearanceFromText("A soldier with a buzz cut.").hair, "buzz");
	// a character already wearing a style keeps it in the list
	assert.ok(hairStyleChoices("m_crew", true).includes("m_crew"));
	assert.ok(hairStyleChoices("buzz", true).includes("buzz"));
	assert.ok(NEW_MALE_HAIR.every((h) => hairStyleChoices(undefined, true).includes(h)));
});
