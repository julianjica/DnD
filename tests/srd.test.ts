import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { categoryOptions } from "../lib/rules/character/index";
import {
	BACKGROUNDS, CLASSES, FEATURES, getFeature, MONSTERS, SPELLS, SUBCLASSES, EQUIPMENT, getBackground, getClass, getCondition, getEquipment,
	getMagicItem, getMonster, getSpecies, getSpell, getSubclass, lookup, lookupText, searchMonsters, spellsForClass,
} from "../lib/srd/index";

test("data files are present and under 6 MB total", () => {
	const dir = join(__dirname, "..", "lib", "srd", "data");
	const total = readdirSync(dir).reduce((n, f) => n + statSync(join(dir, f)).size, 0);
	assert.ok(total < 6 * 1024 * 1024, `total ${total}`);
	// SRD content only (The Quiet's zombie-marked entries are merged into the same lists).
	assert.equal(MONSTERS.filter((x) => !x.ruleset).length, 334);
	assert.equal(SPELLS.filter((x) => !x.ruleset).length, 319);
	assert.equal(CLASSES.length, 12);
});

test("goblin stat block is structured", () => {
	const g = getMonster("goblin")!;
	assert.equal(g.ac, 15);
	assert.equal(g.hp, 7);
	assert.equal(g.cr, 0.25);
	assert.equal(g.xp, 50);
	assert.equal(g.size, "small");
	assert.equal(g.tokenHint, "goblin");
	assert.deepEqual(g.skills, { stealth: 6 });
	const scim = g.actions.find((a) => a.name === "Scimitar")!.attack!;
	assert.equal(scim.kind, "melee");
	assert.equal(scim.toHit, 4);
	assert.equal(scim.reach, 5);
	assert.deepEqual(scim.damage, [{ dice: "1d6+2", type: "slashing" }]);
	const bow = g.actions.find((a) => a.name === "Shortbow")!.attack!;
	assert.equal(bow.kind, "ranged");
	assert.deepEqual(bow.range, { normal: 80, long: 320 });
});

test("dragon: multiattack, recharge breath with save, legendary actions, immunities", () => {
	const d = getMonster("adult-red-dragon")!;
	assert.equal(d.tokenHint, "dragon");
	assert.deepEqual(d.immunities, ["fire"]);
	assert.equal(d.saves.dex, 6);
	assert.equal(d.speed.fly, 80);
	const multi = d.actions.find((a) => a.name === "Multiattack")!;
	assert.deepEqual(multi.multiattack?.find((m) => m.action === "Claw"), { action: "Claw", count: 2 });
	const breath = d.actions.find((a) => a.name === "Fire Breath")!;
	assert.deepEqual(breath.usage, { type: "recharge", minRoll: 5 });
	assert.equal(breath.save?.dc, 21);
	assert.equal(breath.save?.ability, "dex");
	assert.equal(breath.save?.halfOnSuccess, true);
	assert.deepEqual(breath.save?.damage, [{ dice: "18d6", type: "fire" }]);
	assert.ok(d.legendaryActions.length >= 3);
	assert.ok(d.traits.some((t) => t.name === "Legendary Resistance"));
	const bite = d.actions.find((a) => a.name === "Bite")!.attack!;
	assert.equal(bite.damage.length, 2);
	assert.equal(bite.reach, 10);
});

test("attack riders and qualified resistances", () => {
	const spider = getMonster("giant-spider")!;
	const bite = spider.actions.find((a) => a.name === "Bite")!.attack!;
	assert.equal(bite.save?.ability, "con");
	assert.equal(bite.save?.dc, 11);
	const wight = getMonster("wight")!;
	assert.ok(wight.resistances.length === 1 || wight.resistances.includes("necrotic"));
	assert.ok(wight.traits.some((t) => t.name === "Damage Qualifiers"));
	for (const m of MONSTERS) {
		for (const c of m.conditionImmunities) assert.ok(c !== ("exhaustion" as string));
		assert.ok(m.tokenHint.length > 0);
	}
});

test("spells: fireball, cure wounds, fire bolt", () => {
	const fb = getSpell("fireball")!;
	assert.equal(fb.level, 3);
	assert.equal(fb.save?.ability, "dex");
	assert.equal(fb.save?.halfOnSuccess, true);
	assert.equal(fb.damage?.type, "fire");
	assert.equal(fb.damage?.bySlotLevel?.[3], "8d6");
	assert.deepEqual(fb.area, { shape: "sphere", size: 20 });
	assert.equal(fb.rangeFeet, 150);
	assert.ok(fb.classes.includes("wizard"));
	const cw = getSpell("Cure Wounds")!;
	assert.equal(cw.heal?.bySlotLevel[1], "1d8");
	assert.equal(cw.heal?.addModifier, true);
	const bolt = getSpell("fire-bolt")!;
	assert.equal(bolt.attack, "ranged");
	assert.equal(bolt.damage?.byCharacterLevel?.[5], "2d10");
	assert.equal(getSpell("cure-wounds")!.rangeFeet, undefined);
});

test("spellsForClass", () => {
	const cantrips = spellsForClass("wizard", { level: 0 });
	assert.ok(cantrips.some((s) => s.index === "fire-bolt"));
	assert.ok(cantrips.every((s) => s.level === 0));
	const upTo1 = spellsForClass("cleric", { maxLevel: 1 });
	assert.ok(upTo1.some((s) => s.index === "cure-wounds"));
	assert.ok(upTo1.every((s) => s.level <= 1));
	assert.equal(spellsForClass("fighter").length, 0);
});

test("classes, subclasses, species, backgrounds", () => {
	const f = getClass("fighter")!;
	assert.equal(f.hitDie, 10);
	assert.deepEqual(f.savingThrows, ["str", "con"]);
	assert.deepEqual(f.levels.filter((l) => l.asi).map((l) => l.level), [4, 6, 8, 12, 14, 16, 19]);
	assert.deepEqual(getClass("rogue")!.levels.filter((l) => l.asi).map((l) => l.level), [4, 8, 10, 12, 16, 19]);
	assert.equal(getClass("rogue")!.levels[2].specific.sneak_attack, "2d6");
	assert.equal(getClass("barbarian")!.levels[2].specific.rage_count, 3);
	assert.equal(getClass("fighter")!.levels[10].specific.extra_attacks, 2);
	assert.deepEqual(getClass("wizard")!.levels[4].slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
	assert.equal(getClass("paladin")!.spellcasting?.type, "half");
	assert.equal(getClass("warlock")!.spellcasting?.type, "pact");
	assert.equal(getSubclass("champion")!.classId, "fighter");
	assert.ok(getSubclass("life")!.spells.some((s) => s.spell === "bless"));
	// Every feature referenced by a class/subclass level exists.
	const ids = new Set(FEATURES.map((x) => x.index));
	for (const c of CLASSES) for (const l of c.levels) for (const id of l.features) assert.ok(ids.has(id), `${c.index} ${id}`);
	for (const s of SUBCLASSES) for (const l of s.features) for (const id of l.features) assert.ok(ids.has(id), `${s.index} ${id}`);
	const dwarf = getSpecies("dwarf")!;
	assert.equal(dwarf.speed, 25);
	assert.equal(dwarf.abilityBonuses.con, 2);
	assert.equal(dwarf.subspecies[0].abilityBonuses.wis, 1);
	assert.equal(getSpecies("half-elf")!.choices.find((c) => c.id === "half-elf:ability_bonus")!.choose, 2);
	assert.deepEqual(getBackground("acolyte")!.skills, ["insight", "religion"]);
	assert.ok(getBackground("soldier"));
});

test("equipment and magic items", () => {
	const ls = getEquipment("longsword")!;
	assert.equal(ls.weapon?.category, "martial");
	assert.equal(ls.weapon?.versatile, "1d10");
	const jav = getEquipment("javelin")!;
	assert.deepEqual(jav.weapon?.throwRange, { normal: 30, long: 120 });
	const half = getEquipment("half-plate-armor") ?? EQUIPMENT.find((e) => e.name === "Half Plate")!;
	assert.equal(half.armor?.dexCap, 2);
	assert.equal(getEquipment("chain-mail")!.armor?.strMin, 13);
	assert.ok(getEquipment("explorers-pack")!.contents!.length > 3);
	const boh = getMagicItem("bag-of-holding")!;
	assert.equal(boh.rarity, "Uncommon");
	assert.equal(getCondition("grappled")!.name, "Grappled");
});

test("searchMonsters", () => {
	const undead = searchMonsters({ type: "undead", maxCr: 1 });
	assert.ok(undead.length > 0);
	assert.ok(undead.every((m) => m.type.startsWith("undead") && m.cr <= 1));
	const sorted = searchMonsters({ minCr: 5, maxCr: 10 });
	for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].cr <= sorted[i].cr);
	assert.equal(searchMonsters({ name: "goblin" })[0].index, "goblin");
});

test("fuzzy lookup", () => {
	assert.equal(lookup("fireball")[0].index, "fireball");
	assert.equal(lookup("firebal")[0].index, "fireball"); // typo
	assert.equal(lookup("long sword")[0].index, "longsword");
	assert.equal(lookup("Bag of Holding")[0].category, "magic-item");
	assert.equal(lookup("grappled")[0].category, "condition");
	assert.equal(lookup("spell: cure")[0].index, "cure-wounds");
	assert.equal(lookup("monster:goblin")[0].category, "monster");
	assert.ok(lookup("sneak attack")[0].summary.includes("Sneak Attack"));
	assert.deepEqual(lookup("zzzzqqq"), []);
	assert.match(lookupText("goblin", 1), /AC 15/);
});

test("cross-references resolve", () => {
	for (const s of SUBCLASSES) for (const sp of s.spells) assert.ok(getSpell(sp.spell), `${s.index} → ${sp.spell}`);
	for (const f of FEATURES) {
		if (f.choice?.kind === "feature" || f.choice?.kind === "invocation") {
			for (const o of f.choice.options) assert.ok(getFeature(o.index), `${f.index} → ${o.index}`);
		}
	}
	const grantsOk = (list: typeof CLASSES[number]["equipmentChoices"]) => {
		for (const ch of list) for (const o of ch.options) for (const g of o.grants) {
			if ("ref" in g) assert.ok(getEquipment(g.ref), g.ref);
			else assert.ok(categoryOptions(g.category).length > 0, g.category);
		}
	};
	for (const c of CLASSES) {
		for (const e of c.startingEquipment) assert.ok(getEquipment(e.ref), e.ref);
		grantsOk(c.equipmentChoices);
	}
	for (const b of BACKGROUNDS) {
		for (const e of b.equipment) assert.ok(getEquipment(e.ref), e.ref);
		grantsOk(b.equipmentChoices);
	}
	for (const s of SPELLS) for (const c of s.classes) assert.ok(getClass(c), `${s.index} class ${c}`);
	assert.equal(getClass("rogue")!.multiclass.skillChoose, 1);
	assert.equal(getClass("bard")!.multiclass.skillChoose, 1);
});
