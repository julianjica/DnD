import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import spellsJson from "../lib/srd/data/spells.json";
import zTechniques from "../lib/srd/data/zombie/techniques.json";
import cPrograms from "../lib/srd/data/cyber/programs.json";
import { CLASSES, getEquipment, getSpell } from "../lib/srd";
import { CURATED_SPELL_TAGS } from "../lib/srd/spell-tags";
import type { SpellInfo } from "../lib/game/types";

const progs = cPrograms as unknown as SpellInfo[];
const CASTERS = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"];
const DAMAGE = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const CONSUMABLES = ["c-med-patch", "c-chem-vial", "c-nanite-canister", "c-burner-id", "c-drone-battery"];
const BORROWED = /arasaka|militech|night city|kiroshi|sandevistan|quickhack|cyberpsych|mantis|gorilla arms/i;

test("programs: p- prefixed, unique, no collisions, merged and tagged cyberpunk", () => {
	const taken = new Set([...(spellsJson as { index: string }[]), ...(zTechniques as { index: string }[])].map((x) => x.index));
	const ids = progs.map((p) => p.index);
	assert.equal(new Set(ids).size, ids.length);
	for (const id of ids) {
		assert.ok(id.startsWith("p-"), id);
		assert.ok(!taken.has(id), `${id} collides`);
	}
	for (const id of ["p-sledgehammer", "p-ghost", "p-backdoor", "p-worm"]) assert.equal(getSpell(id)?.ruleset, "cyberpunk", id);
	assert.equal(getSpell("p-sledgehammer")!.level, 0);
	assert.equal(getSpell("p-sledgehammer")!.scope, "net");
	assert.equal(getSpell("p-ghost")!.level, 1);
	assert.equal(getSpell("p-ghost")!.scope, "net");
	assert.doesNotMatch(JSON.stringify(progs), BORROWED);
});

test("programs: engine fields, scope and heat, every hacking style covered, consumables resolve", () => {
	const classIds = new Set(CLASSES.map((c) => c.index));
	for (const p of progs) {
		assert.ok(p.level >= 0 && p.level <= 5, p.index);
		assert.ok(["1 action", "1 bonus action", "1 reaction", "1 minute", "1 hour", "24 hours"].includes(p.castingTime), `${p.index} castingTime ${p.castingTime}`);
		assert.ok(p.name && p.description && p.range && p.duration && p.school, p.index);
		assert.ok(Array.isArray(p.components) && typeof p.concentration === "boolean" && typeof p.ritual === "boolean", p.index);
		assert.ok(p.classes.length && p.classes.every((c) => classIds.has(c) && CASTERS.includes(c)), `${p.index} classes`);
		assert.doesNotMatch(`${p.description} ${p.higherLevel ?? ""}`, /\b(magic|magical|spell|spells|arcane|divine|cast|cantrip)\b/i, `${p.index} is not magic`);
		assert.ok(p.scope === "net" || p.scope === "both", `${p.index} scope`);
		if (p.heat !== undefined) assert.ok(Number.isInteger(p.heat) && p.heat >= 1 && p.heat <= 3, `${p.index} heat`);
		if (p.damage) {
			assert.ok(DAMAGE.includes(p.damage.type), p.index);
			assert.ok(p.level === 0 ? p.damage.byCharacterLevel?.[1] : p.damage.bySlotLevel?.[p.level], `${p.index} damage dice at its level`);
		}
		if (p.heal) assert.ok(p.heal.bySlotLevel[p.level], `${p.index} heal dice`);
		if (p.attack) assert.ok(p.damage, `${p.index} attack without damage`);
		for (const c of p.consumes ?? []) {
			assert.ok(CONSUMABLES.includes(c.ref), `${p.index} consumes ${c.ref}`);
			assert.equal(getEquipment(c.ref)?.ruleset, "cyberpunk", `${p.index} consumes unknown ${c.ref}`);
			assert.ok(c.qty >= 1);
		}
		if (p.consumes?.length) assert.ok(p.components.includes("M") && p.material, `${p.index} lists its material`);
		if (/advantage/i.test(`${p.description} ${p.higherLevel ?? ""}`)) assert.ok(p.index in CURATED_SPELL_TAGS, `${p.index} mentions advantage but isn't curated`);
	}
	for (const c of CASTERS) {
		const n = progs.filter((p) => p.classes.includes(c)).length;
		assert.ok(n >= 8 && n <= (c === "wizard" ? 50 : 30), `${c}: ${n} programs`);
		for (let lvl = 1; lvl <= 5; lvl++) assert.ok(progs.some((p) => p.classes.includes(c) && p.level === lvl), `${c} has a level ${lvl} program`);
		if (c !== "paladin" && c !== "ranger") assert.ok(progs.some((p) => p.classes.includes(c) && p.level === 0), `${c} has scripts`);
		else assert.ok(!progs.some((p) => p.classes.includes(c) && p.level === 0), `${c} has no scripts`);
	}
	// Each consumable is used by the style it belongs to.
	const uses = (ref: string, cls: string) => progs.some((p) => p.classes.includes(cls) && p.consumes?.some((c) => c.ref === ref));
	assert.ok(uses("c-med-patch", "cleric") && uses("c-chem-vial", "druid") && uses("c-nanite-canister", "druid") && uses("c-burner-id", "bard") && uses("c-drone-battery", "ranger"));
});

test("Spanish: every program name, description, material, higher-level text and school is in cp.json and dict.json", () => {
	const cp = JSON.parse(fs.readFileSync(`${__dirname}/../lib/srd/es/cp.json`, "utf8")) as Record<string, string>;
	const dict = JSON.parse(fs.readFileSync(`${__dirname}/../lib/srd/es/dict.json`, "utf8")) as Record<string, string>;
	for (const p of progs) {
		for (const s of [p.name, p.description, p.school, ...(p.material ? [p.material] : []), ...(p.higherLevel ? [p.higherLevel] : [])]) {
			assert.ok(cp[s], `cp.json missing: ${s.slice(0, 60)}`);
			assert.equal(dict[s], cp[s], `dict.json not rebuilt for: ${s.slice(0, 60)}`);
		}
		for (const s of [p.range, p.duration, p.castingTime]) assert.ok(dict[s], `dict.json lacks ${s}`);
	}
});
