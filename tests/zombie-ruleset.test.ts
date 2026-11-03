import { test } from "node:test";
import assert from "node:assert/strict";
import type { Abilities } from "../lib/game/types";
import { SPECIES, SPELLS, getEquipment, spellsForClass, zombieKit } from "../lib/srd/index";
import { offeredIn } from "../lib/rules/ruleset";
import { RulesError, characterRuleset, createCharacter, creationOptions, levelUpOptions } from "../lib/rules/character/index";
import { optionsFor, defaultCharacter } from "../components/setup/wizardState";

const arr = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities => ({ str, dex, con, int, wis, cha });

test("species offered by ruleset: origins only in The Quiet", () => {
	const z = offeredIn(SPECIES, "zombie");
	const f = offeredIn(SPECIES, "fantasy");
	assert.equal(z.length, 8);
	assert.ok(z.every((s) => s.index.startsWith("z-origin-")));
	assert.ok(f.some((s) => s.index === "elf") && !f.some((s) => s.ruleset === "zombie"));
});

test("class spell lists follow the ruleset", () => {
	assert.ok(spellsForClass("wizard").length > 50);
	assert.ok(spellsForClass("wizard").every((s) => (s.ruleset ?? "fantasy") === "fantasy"));
	const techniques = spellsForClass("wizard", { ruleset: "zombie" });
	assert.ok(techniques.every((s) => s.ruleset === "zombie"));
	assert.equal(techniques.length, SPELLS.filter((s) => s.ruleset === "zombie" && s.classes.includes("wizard")).length);
});

test("wizard helpers: zombie creation options offer techniques, real languages, no gear choices or gold", () => {
	const c = { ...defaultCharacter(), speciesId: "z-origin-bookworm", classId: "wizard", backgroundId: "sage" };
	const { opts, error } = optionsFor(c, "zombie");
	assert.equal(error, undefined);
	assert.equal(opts!.ruleset, "zombie");
	assert.deepEqual(opts!.equipment, []);
	assert.equal(opts!.startingGold, 0);
	const langs = opts!.choices.find((ch) => ch.id === "background:languages")!;
	assert.ok(langs.options.length > 0 && langs.options.every((o) => !["elvish", "dwarvish", "infernal", "draconic"].includes(o.index)));
	for (const id of ["cantrips", "spells"]) {
		const ch = opts!.choices.find((x) => x.id === id);
		if (ch) assert.ok(ch.options.every((o) => o.index.startsWith("t-")), `${id} offers only techniques`);
	}
	// An origin isn't available in a fantasy game.
	assert.throws(() => creationOptions("wizard", "z-origin-bookworm", "sage", undefined, "fantasy"), RulesError);
	const fantasy = creationOptions("wizard", "elf", "sage", "high-elf");
	assert.equal(fantasy.ruleset, "fantasy");
	assert.ok(fantasy.choices.find((x) => x.id === "cantrips")!.options.some((o) => o.index === "fire-bolt"));
	assert.ok(fantasy.startingGold > 0);
});

test("createCharacter in The Quiet uses the profession kit and no gold", () => {
	for (const classId of ["fighter", "wizard", "rogue", "cleric"]) {
		const c = createCharacter({ name: "Dana", speciesId: "z-origin-streetwise", classId, backgroundId: "criminal", abilities: { method: "standard_array", scores: arr(15, 14, 13, 12, 10, 8) }, ruleset: "zombie" });
		assert.equal(characterRuleset(c), "zombie");
		assert.equal(c.currency.gp, 0);
		const kitRefs = zombieKit(classId).flatMap((g) => getEquipment(g.ref)?.contents?.map((x) => x.ref) ?? [g.ref]);
		for (const item of c.inventory) assert.ok(item.ref && kitRefs.includes(item.ref), `${classId}: ${item.ref} comes from the kit`);
		assert.equal(c.inventory.length === 0, kitRefs.length === 0);
		for (const s of c.spellcasting?.classes ?? []) for (const id of [...s.cantrips, ...s.known, ...s.prepared]) assert.ok(id.startsWith("t-"), `${classId}: ${id} is a technique`);
		assert.ok(c.languages.every((l) => !["elvish", "dwarvish", "infernal"].includes(l)));
	}
	// Ruleset follows the origin when not given; fantasy stays unchanged.
	const f = createCharacter({ name: "Thorin", speciesId: "dwarf", subspeciesId: "hill-dwarf", classId: "fighter", backgroundId: "soldier", abilities: { method: "standard_array", scores: arr(15, 14, 13, 12, 10, 8) } });
	assert.ok(f.currency.gp > 0 && f.inventory.length > 0);
});

test("level-up in The Quiet offers only techniques", () => {
	const c = createCharacter({ name: "Lee", speciesId: "z-origin-bookworm", classId: "wizard", backgroundId: "sage", abilities: { method: "standard_array", scores: arr(8, 14, 13, 15, 12, 10) }, ruleset: "zombie" });
	const o = levelUpOptions(c, "wizard");
	for (const ch of o.choices.filter((x) => x.id === "spells" || x.id === "cantrips")) assert.ok(ch.options.every((x) => x.index.startsWith("t-")));
});
