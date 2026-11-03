import { test } from "node:test";
import assert from "node:assert/strict";
import labels from "../lib/srd/data/zombie/labels.json";
import zo from "../lib/srd/es/zo.json";
import dict from "../lib/srd/es/dict.json";
import { CLASSES, FEATURES, SPECIES, SUBCLASSES, getSpecies } from "../lib/srd/index";
import { rulesetLabelEn, rulesetText } from "../lib/i18n/ruleset-labels";
import { labelSources } from "../scripts/zombie/extract-labels.mjs";

const L = labels as { en: Record<string, string>; es: Record<string, string> };
const sources = (labelSources as () => { key: string; kind: string }[])();
const keys = new Set(sources.map((s) => s.key));

test("every label key is an exact English source text", () => {
	for (const lang of ["en", "es"] as const) {
		const unknown = Object.keys(L[lang]).filter((k) => !keys.has(k));
		assert.deepEqual(unknown, [], `${lang}: keys not found in SRD/homebrew data`);
	}
});

test("every class, subclass and feature name/description has EN and ES labels", () => {
	const texts = [
		...CLASSES.flatMap((c) => [c.name, c.subclassFlavor]),
		...SUBCLASSES.flatMap((s) => [s.name, s.flavor, s.description]),
		...FEATURES.flatMap((f) => [f.name, f.description]),
	].map((t) => t.trim());
	const missing = { en: texts.filter((t) => !L.en[t]), es: texts.filter((t) => !L.es[t]) };
	assert.equal(missing.en.length, 0, `missing EN: ${missing.en.slice(0, 5).join(" | ")}`);
	assert.equal(missing.es.length, 0, `missing ES: ${missing.es.slice(0, 5).join(" | ")}`);
	for (const s of sources) {
		assert.ok(L.en[s.key]?.trim(), `EN label for ${s.kind}: ${s.key.slice(0, 60)}`);
		assert.ok(L.es[s.key]?.trim(), `ES label for ${s.kind}: ${s.key.slice(0, 60)}`);
	}
});

test("professions and key renames read as modern", () => {
	assert.equal(rulesetLabelEn("zombie", "Wizard"), "Chemistry Teacher · Engineer");
	assert.equal(rulesetLabelEn("zombie", "Rage"), "Adrenaline");
	assert.equal(rulesetLabelEn("zombie", "Sneak Attack"), "Cheap Shot");
	assert.equal(rulesetLabelEn("zombie", "Arcana"), "Science");
	assert.equal(rulesetLabelEn("fantasy", "Wizard"), "Wizard");
	assert.equal(rulesetText("zombie", "es", null, "Barbarian"), "Bombero");
	assert.equal(rulesetText("zombie", "es", null, "Acolyte"), "Feligrés");
	// Names carry no magic vocabulary.
	const magic = /\b(spells?|magic\w*|arcane|divine|sacred|eldritch|ki)\b/i;
	const bad = sources.filter((s) => s.kind.endsWith("name") && magic.test(L.en[s.key] ?? ""));
	assert.deepEqual(bad.map((s) => L.en[s.key]), []);
});

test("origins load as zombie species with Spanish text", () => {
	const origins = SPECIES.filter((s) => s.ruleset === "zombie");
	assert.equal(origins.length, 8);
	for (const o of origins) {
		assert.ok(o.index.startsWith("z-origin-"));
		assert.equal(o.size, "medium");
		assert.deepEqual(o.languages, ["common"]);
		assert.equal(o.subspecies.length, 0);
		assert.ok(o.traits.length > 0);
	}
	assert.equal(getSpecies("z-origin-athletic")?.speed, 35);
	assert.equal(getSpecies("z-origin-night-owl")?.darkvision, 30);
	assert.ok(getSpecies("z-origin-bilingual")?.choices.some((c) => c.id.endsWith(":languages") && c.options.length > 5));
	const es = zo as Record<string, string>;
	const d = dict as Record<string, string>;
	for (const o of origins) {
		for (const t of [o.name, o.sizeDescription, o.age, o.alignment, o.languageDescription, ...o.traits.flatMap((t) => [t.name, t.description]), ...o.choices.map((c) => c.label)]) {
			assert.ok(es[t], `zo.json lacks: ${t.slice(0, 60)}`);
			assert.equal(d[t], es[t], "dict.json is rebuilt from zo.json");
		}
	}
	for (const opt of getSpecies("z-origin-bilingual")!.choices[0].options) assert.ok(es[opt.name], `language ${opt.name}`);
});
