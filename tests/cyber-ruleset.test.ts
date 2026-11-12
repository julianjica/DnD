import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Abilities, CampaignSettings } from "../lib/game/types";
import { EQUIPMENT, MONSTERS, SPECIES, SPELLS, cyberKit, getEquipment, spellsForClass, zombieKit } from "../lib/srd/index";
import { contentPrefix, isModern, offeredIn, rulesetOf, spellNoun, type Ruleset } from "../lib/rules/ruleset";
import { RulesError, characterRuleset, createCharacter, creationOptions } from "../lib/rules/character/index";
import { tracksFor, sfxFor } from "../lib/audio/ambience";
import { buildSystemPrompt } from "../lib/dm/prompt";
import { marea } from "../lib/maps/marea";
import { tonesFor, tonesOnPresetChange } from "../components/setup/presets";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-cyber-"));
process.env.DH_DATA_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	optionsFor: typeof import("../components/setup/wizardState").optionsFor;
	defaultCharacter: typeof import("../components/setup/wizardState").defaultCharacter;
	content: typeof import("../lib/dm/content");
	digest: typeof import("../lib/dm/digest");
	cyber: typeof import("../lib/rules/cyber");
};
before(async () => {
	const ws = await import("../components/setup/wizardState");
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: ws.defaultSettings,
		optionsFor: ws.optionsFor,
		defaultCharacter: ws.defaultCharacter,
		content: await import("../lib/dm/content"),
		digest: await import("../lib/dm/digest"),
		cyber: await import("../lib/rules/cyber"),
	};
});

const arr = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities => ({ str, dex, con, int, wis, cha });
const STD = { method: "standard_array" as const, scores: arr(10, 13, 14, 15, 12, 8) };
/** A cyber origin if the content agents have written one, else a plain SRD human (tolerated, like in The Quiet). */
const cyberOrigin = () => offeredIn(SPECIES, "cyberpunk")[0]?.index ?? "human";
const settingsFor = (preset: CampaignSettings["world"]["preset"]) => {
	const s = m.defaultSettings();
	s.world.preset = preset;
	return s;
};

test("rulesetOf: marea_burned is Root Access; the other presets are unchanged", () => {
	assert.equal(rulesetOf({ world: { preset: "marea_burned" } }), "cyberpunk");
	assert.equal(rulesetOf({ world: { preset: "zombie_outbreak" } }), "zombie");
	assert.equal(rulesetOf({ world: { preset: "grimdark" } }), "fantasy");
	assert.equal(rulesetOf(undefined), "fantasy");
	assert.ok(isModern("cyberpunk") && isModern("zombie") && !isModern("fantasy"));
	assert.deepEqual(["fantasy", "zombie", "cyberpunk"].map((r) => spellNoun(r as "fantasy")), ["spell", "technique", "program"]);
	assert.equal(contentPrefix("cyberpunk"), "c-");
	assert.equal(contentPrefix("zombie"), "z-");
});

test("content is tagged by ruleset and offered only in its own", () => {
	for (const list of [SPECIES, SPELLS, EQUIPMENT, MONSTERS] as { ruleset?: Ruleset }[][]) {
		assert.ok(offeredIn(list, "cyberpunk").every((x) => x.ruleset === "cyberpunk"));
		assert.ok(!offeredIn(list, "fantasy").some((x) => x.ruleset === "cyberpunk"));
		assert.ok(!offeredIn(list, "zombie").some((x) => x.ruleset === "cyberpunk"));
	}
	// The Quiet and fantasy are untouched.
	assert.equal(offeredIn(SPECIES, "zombie").length, 8);
	assert.ok(spellsForClass("wizard").length > 50 && spellsForClass("wizard").every((s) => (s.ruleset ?? "fantasy") === "fantasy"));
	assert.ok(spellsForClass("wizard", { ruleset: "zombie" }).every((s) => s.ruleset === "zombie"));
	const programs = spellsForClass("wizard", { ruleset: "cyberpunk" });
	assert.ok(programs.every((s) => s.ruleset === "cyberpunk"));
	assert.equal(programs.length, SPELLS.filter((s) => s.ruleset === "cyberpunk" && s.classes.includes("wizard")).length);
	// Kits point at Root Access gear (never fantasy or The Quiet's).
	for (const cls of ["fighter", "wizard", "rogue", "cleric"]) {
		for (const g of cyberKit(cls)) assert.equal(getEquipment(g.ref)?.ruleset, "cyberpunk", `${cls} kit: ${g.ref}`);
		assert.ok(zombieKit(cls).length > 0, "The Quiet keeps its kits");
	}
});

test("creation in Root Access: programs only, real languages, kit and no gold; origins stay in their ruleset", () => {
	const c = { ...m.defaultCharacter(), speciesId: cyberOrigin(), classId: "wizard", backgroundId: "sage" };
	const { opts, error } = m.optionsFor(c, "cyberpunk");
	assert.equal(error, undefined);
	assert.equal(opts!.ruleset, "cyberpunk");
	assert.deepEqual(opts!.equipment, []);
	assert.equal(opts!.startingGold, 0);
	assert.deepEqual(opts!.kit.map((k) => k.ref), cyberKit("wizard").map((k) => k.ref));
	for (const id of ["cantrips", "spells"]) {
		const ch = opts!.choices.find((x) => x.id === id);
		if (ch) assert.ok(ch.options.every((o) => SPELLS.find((s) => s.index === o.index)?.ruleset === "cyberpunk"), `${id} offers only programs`);
	}
	const langs = opts!.choices.find((ch) => ch.id === "background:languages");
	if (langs) assert.ok(langs.options.every((o) => !["elvish", "dwarvish", "infernal", "draconic"].includes(o.index)));
	// Origins of The Quiet don't exist in Marea, and Marea's don't exist elsewhere.
	assert.throws(() => creationOptions("wizard", "z-origin-bookworm", "sage", undefined, "cyberpunk"), RulesError);
	const own = offeredIn(SPECIES, "cyberpunk")[0];
	if (own) {
		assert.throws(() => creationOptions("wizard", own.index, "sage", undefined, "fantasy"), RulesError);
		assert.throws(() => creationOptions("wizard", own.index, "sage", undefined, "zombie"), RulesError);
	}
	const ch = createCharacter({ name: "Vale", speciesId: cyberOrigin(), classId: "wizard", backgroundId: "sage", abilities: STD, ruleset: "cyberpunk" });
	assert.equal(characterRuleset(ch), "cyberpunk");
	assert.equal(ch.currency.gp, 0);
	for (const s of ch.spellcasting?.classes ?? []) for (const id of [...s.cantrips, ...s.known, ...s.prepared]) assert.equal(SPELLS.find((x) => x.index === id)?.ruleset, "cyberpunk", id);
	// Fantasy is unchanged.
	const f = createCharacter({ name: "Thorin", speciesId: "dwarf", subspeciesId: "hill-dwarf", classId: "fighter", backgroundId: "soldier", abilities: STD });
	assert.ok(f.currency.gp > 0 && f.inventory.length > 0 && !f.ruleset);
});

test("a Root Access campaign starts Burned: night, rain, the den in Los Anegados, the meters set", () => {
	const st = m.createGame({ settings: settingsFor("marea_burned"), character: { name: "Vale", speciesId: cyberOrigin(), classId: "rogue", backgroundId: "criminal", abilities: STD } });
	assert.equal(st.world.name, "Marea");
	assert.equal(st.world.terrain.style, "town");
	assert.equal(st.world.currentLocationId, "loc-ma-den");
	assert.ok(st.world.locations.find((l) => l.id === "loc-ma-den")?.visited);
	assert.equal(st.scene.timeOfDay, "night");
	assert.equal(st.scene.weather, "rain");
	assert.equal(st.ambience, "rain");
	assert.deepEqual(st.time, { day: 1, hour: 23, minute: 40 });
	assert.ok(st.cyber, "state.cyber is set");
	const expected = m.cyber.initCyberState(st.character, 1 * 1440 + 23 * 60 + 40);
	assert.equal(st.cyber!.heat, expected.heat);
	assert.equal(st.cyber!.humanityMax, expected.humanityMax);
	assert.equal(st.character.ruleset, "cyberpunk");
	assert.ok(st.character.inventory.some((i) => i.ref === "c-vantis-shard"), "holds the Vantis shard");
	assert.ok(Object.values(st.npcs).some((n) => n.name === "La Tía"));
	assert.ok(st.quests.some((q) => q.status === "active" && q.objectives.some((o) => /La Tía/.test(o.text))));
	assert.ok(!st.survival && !st.town && !st.group, "no zombie systems");
	const es = m.createGame({ settings: { ...settingsFor("marea_burned"), language: "es" }, character: { name: "Vale", speciesId: cyberOrigin(), classId: "fighter", backgroundId: "soldier", abilities: STD } });
	assert.equal(es.world.locations.find((l) => l.id === "loc-ma-den")?.name, "La cápsula");
	assert.match(es.scene.title, /Anegados/);
});

test("fantasy and zombie campaigns start exactly as before", () => {
	const z = m.createGame({ settings: settingsFor("zombie_outbreak"), character: { name: "Sam", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: STD } });
	assert.equal(z.world.name, "Kessler Falls");
	assert.equal(z.ambience, "q_outbreak");
	assert.deepEqual(z.time, { day: 1, hour: 21, minute: 0 });
	assert.ok(!z.cyber && z.town);
	const f = m.createGame({ settings: settingsFor("classic_high_fantasy"), character: { name: "Ari", speciesId: "elf", subspeciesId: "high-elf", classId: "wizard", backgroundId: "sage", abilities: STD } });
	assert.ok(!f.cyber && !f.town);
	assert.equal(f.ambience, "none");
	assert.deepEqual(f.time, { day: 1, hour: 18, minute: 0 });
	assert.equal(f.quests.length, 0);
});

test("Root Access content filters: no fantasy monsters, gear or spells; programs in the digest", () => {
	const st = m.createGame({ settings: settingsFor("marea_burned"), character: { name: "Vale", speciesId: cyberOrigin(), classId: "wizard", backgroundId: "sage", abilities: STD } });
	assert.throws(() => m.content.monsterForCampaign(st, "goblin"), /Root Access/);
	assert.throws(() => m.content.monsterForCampaign(st, "z-shambler"), /Root Access/);
	assert.equal(m.content.equipmentForCampaign("cyberpunk", "longsword", ""), undefined);
	assert.equal(m.content.equipmentForCampaign("cyberpunk", "z-pistol-9mm", ""), undefined);
	assert.throws(() => m.content.assertItemRef("cyberpunk", "potion-of-healing"));
	const look = m.content.lookupForCampaign(st, "spell: fireball", 5);
	assert.doesNotMatch(look, /Fireball —/);
	assert.ok(m.content.availableMonsters(st).every((x) => x.ruleset === "cyberpunk"));
	const d = m.digest.stateDigest(st);
	if (st.character.spellcasting?.slots.some(Boolean)) assert.match(d, /Program slots/);
	assert.doesNotMatch(d, /Spell slots|Technique slots|Outbreak day/);
});

test("audio: Marea gets the neutral city beds, never The Quiet's or the tavern", () => {
	const t = tracksFor("cyberpunk");
	for (const x of ["none", "town", "night", "rain", "storm", "combat", "tension", "boss", "victory", "dungeon"]) assert.ok(t.includes(x as never), x);
	assert.ok(!t.some((x) => x.startsWith("q_") || ["tavern", "forest", "temple"].includes(x)));
	assert.ok(!sfxFor("cyberpunk").some((s) => s === "groan" || s === "bite"));
	assert.ok(tracksFor("zombie").includes("q_outbreak") && tracksFor("fantasy").includes("tavern"));
});

test("the DM prompt carries Marea's canon, the meter tools and the chosen tone", () => {
	const s = settingsFor("marea_burned");
	s.world.tone = ["satire"];
	const p = buildSystemPrompt(s);
	for (const w of ["ROOT ACCESS", "SANTI VARELA", "La Tía", "ECO", "3:00 a.m.", "shift_hat", "add_heat", "lay_low", "install_implant", "remove_implant", "humanity_check", "therapy", "SATIRE"]) assert.ok(p.includes(w), w);
	assert.doesNotMatch(p, /THE QUIET/);
	s.world.tone = [];
	assert.match(buildSystemPrompt(s), /NEON NOIR/);
	const z = buildSystemPrompt(settingsFor("zombie_outbreak"));
	assert.ok(z.includes("THE QUIET") && !z.includes("ROOT ACCESS"));
	assert.ok(!buildSystemPrompt(settingsFor("classic_high_fantasy")).includes("ROOT ACCESS"));
});

test("Marea map: every route joins known places, names in both languages", () => {
	for (const lang of ["en", "es"] as const) {
		const w = marea(7, lang);
		const ids = new Set(w.locations.map((l) => l.id));
		for (const r of w.routes) assert.ok(ids.has(r.from) && ids.has(r.to), `${r.from}->${r.to}`);
		assert.ok(w.locations.find((l) => l.id === w.currentLocationId)?.discovered);
		for (const d of ["anegados", "tianguis", "cerro-antena", "cuspide", "bolsa", "puerto", "plantas", "universitaria"]) assert.ok(ids.has(`loc-ma-${d}`), d);
	}
});

test("setup tones: Root Access picks one of neon noir / grim / satire", () => {
	assert.deepEqual(tonesFor("marea_burned"), { tones: ["neon_noir", "grim", "satire"], single: true });
	assert.equal(tonesFor("grimdark").single, false);
	assert.deepEqual(tonesOnPresetChange("marea_burned", ["heroic"]), ["neon_noir"]);
	assert.deepEqual(tonesOnPresetChange("marea_burned", ["grim"]), ["grim"]);
	assert.deepEqual(tonesOnPresetChange("grimdark", ["grim"]), ["dark", "gritty"]);
	assert.deepEqual(tonesOnPresetChange("grimdark", ["heroic"]), ["heroic"]);
});
