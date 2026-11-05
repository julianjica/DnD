import { test } from "node:test";
import assert from "node:assert/strict";
import type { Abilities, Character } from "../lib/game/types";
import { Rng } from "../lib/rules/dice";
import {
	RulesError, addCondition, addExhaustion, applyClassLevel, applyDamage, armorClass, attacks, attacksPerAction,
	canMulticlass, computeSlots, createCharacter, createCharacterDetailed, creationOptions, deriveSheet, grantTempHp, heal,
	initiativeMod, levelForXp, levelUp, levelUpOptions, longRest, multiclassCasterLevel, pointBuyCost, proficiencyBonus,
	recordDeathSave, removeCondition, rollAbilityScores, shortRest, skillMod, spellSaveDc, spendSlot, speedOf, useFeature,
	validateAbilities, xpForLevel, itemFromEquipment, critRange, hasCondition, effectiveMaxHp, rollDeathSave,
} from "../lib/rules/character/index";

const arr = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities => ({ str, dex, con, int, wis, cha });

function fighter(level = 1, extra: Partial<Parameters<typeof createCharacter>[0]> = {}): Character {
	return createCharacter({
		id: "pc",
		name: "Thorin",
		speciesId: "dwarf",
		subspeciesId: "hill-dwarf",
		classId: "fighter",
		backgroundId: "soldier",
		abilities: { method: "standard_array", scores: arr(15, 13, 14, 8, 12, 10) },
		choices: { "class:skills": ["perception", "survival"], "feature:fighter-fighting-style": ["fighter-fighting-style-defense"] },
		equipment: [{ option: 0 }, { option: 0, picks: ["longsword"] }, { option: 0 }, { option: 0 }],
		level,
		...extra,
	});
}

// ─── tables ────────────────────────────────────────────────────────────────

test("proficiency bonus and XP thresholds", () => {
	assert.deepEqual([1, 4, 5, 8, 9, 13, 17, 20].map(proficiencyBonus), [2, 2, 3, 3, 4, 5, 6, 6]);
	assert.equal(levelForXp(0), 1);
	assert.equal(levelForXp(299), 1);
	assert.equal(levelForXp(300), 2);
	assert.equal(levelForXp(355000), 20);
	assert.equal(xpForLevel(5), 6500);
});

// ─── abilities ─────────────────────────────────────────────────────────────

test("ability methods: standard array, point buy, 4d6", () => {
	assert.throws(() => validateAbilities({ method: "standard_array", scores: arr(15, 15, 13, 12, 10, 8) }), RulesError);
	assert.equal(pointBuyCost(arr(15, 15, 15, 8, 8, 8)), 27);
	validateAbilities({ method: "point_buy", scores: arr(15, 15, 15, 8, 8, 8) });
	assert.throws(() => validateAbilities({ method: "point_buy", scores: arr(15, 15, 15, 9, 8, 8) }), /28 points/);
	assert.throws(() => validateAbilities({ method: "point_buy", scores: arr(16, 8, 8, 8, 8, 8) }), /between 8 and 15/);
	const { scores, rolls } = rollAbilityScores(new Rng(42));
	assert.equal(scores.length, 6);
	assert.ok(scores.every((s) => s >= 3 && s <= 18));
	assert.equal(rolls[0].dice.filter((d) => d.dropped).length, 1);
	const [a, b, c, d, e, f] = scores;
	validateAbilities({ method: "roll", rolled: scores, scores: arr(a, b, c, d, e, f) });
	assert.throws(() => validateAbilities({ method: "roll", rolled: scores, scores: arr(a, a, a, a, a, a + 100) }));
});

// ─── creation ──────────────────────────────────────────────────────────────

test("level-1 Hill Dwarf Fighter", () => {
	const c = fighter();
	assert.deepEqual(c.abilities, arr(15, 13, 16, 8, 13, 10)); // +2 CON dwarf, +1 WIS hill dwarf
	assert.equal(c.maxHp, 14); // 10 + CON 3 + Dwarven Toughness 1
	assert.equal(c.hp, 14);
	assert.equal(c.speed, 25);
	assert.deepEqual(c.savingThrows, ["str", "con"]);
	assert.ok(c.armorProf.includes("heavy") && c.armorProf.includes("shields"));
	assert.ok(c.weaponProf.includes("martial") && c.weaponProf.includes("battleaxe"));
	assert.ok(["perception", "survival", "athletics", "intimidation"].every((s) => c.skills.includes(s)));
	assert.ok(c.languages.includes("dwarvish"));
	assert.deepEqual(c.hitDice, [{ die: 10, total: 1, used: 0 }]);
	assert.ok(c.features.some((f) => f.id === "second-wind" && f.uses?.max === 1 && f.uses.recharge === "short"));
	assert.ok(c.features.some((f) => f.id === "fighter-fighting-style-defense"));
	assert.ok(c.inventory.some((i) => i.ref === "chain-mail" && i.equipped));
	assert.ok(c.inventory.some((i) => i.ref === "torch" && i.quantity === 10)); // pack expanded
	assert.equal(c.currency.gp, 10);
	assert.equal(c.xp, 0);
	const s = deriveSheet(c);
	assert.equal(s.ac, 16 + 2 + 1); // chain mail + shield + Defense
	assert.equal(s.profBonus, 2);
	assert.equal(s.passivePerception, 10 + 1 + 2);
	assert.equal(s.initiative, 1);
	assert.equal(s.speed, 25); // dwarves ignore heavy armor STR penalty
	assert.deepEqual(s.defenses.resistances, ["poison"]);
	const ls = s.attacks.find((a) => a.name === "Longsword")!;
	assert.equal(ls.toHit, 4);
	assert.equal(ls.damage, "1d8+2");
	assert.equal(ls.versatileDamage, "1d10+2");
});

test("creationOptions lists choices for the wizard", () => {
	const o = creationOptions("rogue", "half-elf", "acolyte");
	const ids = o.choices.map((c) => c.id);
	for (const id of ["half-elf:ability_bonus", "half-elf:skills", "half-elf:languages", "class:skills", "background:languages", "feature:rogue-expertise-1"]) assert.ok(ids.includes(id), id);
	assert.equal(o.choices.find((c) => c.id === "class:skills")!.choose, 4);
	assert.ok(!o.choices.find((c) => c.id === "class:skills")!.options.some((x) => x.index === "insight")); // granted by Acolyte
	assert.equal(o.abilityBonuses.cha, 2);
	assert.ok(o.equipment.length >= 3);
	const wiz = creationOptions("wizard", "elf", "sage", "high-elf");
	assert.equal(wiz.choices.find((c) => c.id === "cantrips")!.choose, 3);
	assert.equal(wiz.choices.find((c) => c.id === "spells")!.choose, 6);
	assert.ok(wiz.choices.some((c) => c.id === "high-elf:cantrip"));
	assert.ok(wiz.preparedFormula);
	const cleric = creationOptions("cleric", "human", "acolyte");
	assert.ok(cleric.choices.some((c) => c.id === "subclass"));
	assert.ok(cleric.equipment.some((e) => e.options.some((o2) => o2.picks.length > 0)));
	assert.throws(() => creationOptions("nope", "human", "acolyte"), RulesError);
});

test("strict creation rejects missing or invalid choices", () => {
	assert.throws(() => fighter(1, { strict: true, choices: {} }), /Missing choice/);
	assert.throws(() => fighter(1, { choices: { "class:skills": ["arcana", "history"] } }), /not a valid option/);
	assert.throws(() => fighter(1, { choices: { "class:skills": ["perception"] } }), /exactly 2/);
	assert.throws(() => fighter(1, { name: " " }), /Name/);
	assert.throws(() => fighter(21), /1–20/);
});

test("level-5 Wizard: slots, spells, HP", () => {
	const r = createCharacterDetailed({
		name: "Elara", speciesId: "elf", subspeciesId: "high-elf", classId: "wizard", backgroundId: "sage", level: 5,
		abilities: { method: "point_buy", scores: arr(8, 14, 13, 15, 12, 10) },
		choices: { cantrips: ["fire-bolt", "mage-hand", "prestidigitation"], "high-elf:cantrip": ["light"] },
		levelChoices: { 4: { asi: ["int", "int"] } },
	});
	const c = r.character;
	assert.equal(c.classes[0].level, 5);
	assert.equal(c.classes[0].subclassId, "evocation");
	assert.equal(c.abilities.int, 18); // 15 + 1 high elf + 2 ASI
	assert.equal(c.maxHp, 6 + 1 + 4 * (4 + 1)); // 27
	assert.equal(c.xp, 6500);
	assert.deepEqual(c.spellcasting!.slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
	const wiz = c.spellcasting!.classes.find((x) => x.classId === "wizard")!;
	assert.equal(wiz.known.length, 6 + 4 * 2); // spellbook
	assert.equal(wiz.cantrips.length, 4);
	assert.equal(wiz.prepared.length, 4 + 5); // INT mod + level
	assert.ok(wiz.prepared.every((s) => wiz.known.includes(s)));
	assert.equal(spellSaveDc(c, "int"), 8 + 3 + 4);
	assert.equal(deriveSheet(c).spellcasting.find((s) => s.classId === "wizard")!.attackBonus, 7);
	assert.ok(c.features.some((f) => f.id === "arcane-recovery"));
	assert.ok(r.autoChoices["L5:spells"]);
});

test("starting level 3 picks subclass and features", () => {
	const c = createCharacter({
		name: "Lia", speciesId: "halfling", subspeciesId: "lightfoot-halfling", classId: "rogue", backgroundId: "criminal", level: 3,
		abilities: { method: "standard_array", scores: arr(8, 15, 14, 12, 13, 10) },
		choices: { "class:skills": ["acrobatics", "perception", "investigation", "sleight-of-hand"], "feature:rogue-expertise-1": ["perception", "thieves-tools"] },
	});
	assert.equal(c.classes[0].subclassId, "thief");
	assert.deepEqual(c.expertise.sort(), ["perception", "thieves-tools"]);
	assert.equal(c.size, "small");
	assert.equal(skillMod(c, "perception"), 1 + 2 * 2);
	assert.equal(skillMod(c, "stealth"), 3 + 2);
	assert.equal(deriveSheet(c).classNumbers.sneak_attack, "2d6");
	assert.ok(c.features.some((f) => f.id === "fast-hands"));
	assert.ok(c.features.some((f) => f.id === "cunning-action"));
});

test("dragonborn ancestry, tiefling resistance, half-elf bonuses", () => {
	const db = createCharacter({ name: "Kriv", speciesId: "dragonborn", classId: "paladin", backgroundId: "soldier", abilities: { method: "standard_array", scores: arr(15, 10, 13, 8, 12, 14) }, choices: { "dragonborn:draconic-ancestry": ["draconic-ancestry-blue"] } });
	assert.deepEqual(deriveSheet(db).defenses.resistances, ["lightning"]);
	const tf = createCharacter({ name: "Zara", speciesId: "tiefling", classId: "warlock", backgroundId: "sage", abilities: { method: "standard_array", scores: arr(8, 14, 13, 12, 10, 15) } });
	assert.ok(deriveSheet(tf).defenses.resistances.includes("fire"));
	assert.ok(tf.spellcasting!.classes.some((x) => x.classId === "tiefling" && x.cantrips.includes("thaumaturgy")));
	assert.deepEqual(tf.spellcasting!.pact, { level: 1, max: 1, used: 0 });
	const he = createCharacter({ name: "Ari", speciesId: "half-elf", classId: "bard", backgroundId: "acolyte", abilities: { method: "standard_array", scores: arr(8, 14, 13, 12, 10, 15) }, choices: { "half-elf:ability_bonus": ["dex", "con"] } });
	assert.equal(he.abilities.cha, 17);
	assert.equal(he.abilities.dex, 15);
	assert.equal(he.abilities.con, 14);
	assert.throws(() => createCharacter({ name: "x", speciesId: "half-elf", classId: "bard", backgroundId: "acolyte", abilities: { method: "standard_array", scores: arr(8, 14, 13, 12, 10, 15) }, choices: { "half-elf:ability_bonus": ["cha", "con"] } }), /not a valid option/);
});

// ─── derived stats ─────────────────────────────────────────────────────────

test("unarmored defense (barbarian, monk) and finesse/thrown attacks", () => {
	const barb = createCharacter({ name: "Grog", speciesId: "half-orc", classId: "barbarian", backgroundId: "soldier", abilities: { method: "standard_array", scores: arr(15, 14, 13, 8, 12, 10) } });
	// half-orc: STR 17, CON 14 → 10 + 2 + 2
	assert.equal(armorClass(barb).ac, 14);
	assert.equal(barb.features.find((f) => f.id === "rage")!.uses!.max, 2);
	const jav = attacks(barb).find((a) => a.name === "Javelin")!;
	assert.equal(jav.ability, "str");
	assert.deepEqual(jav.range, { normal: 30, long: 120 });
	assert.equal(jav.reach, 5);
	const monk = createCharacter({ name: "Li", speciesId: "human", classId: "monk", backgroundId: "acolyte", abilities: { method: "standard_array", scores: arr(10, 15, 13, 8, 14, 12) } });
	// human +1: DEX 16, WIS 15 → 10 + 3 + 2
	assert.equal(armorClass(monk).ac, 15);
	const unarmed = attacks(monk).find((a) => a.name === "Unarmed Strike")!;
	assert.equal(unarmed.damage, "1d4+3");
	assert.equal(unarmed.ability, "dex");
	const rogue = createCharacter({ name: "R", speciesId: "human", classId: "rogue", backgroundId: "criminal", abilities: { method: "standard_array", scores: arr(10, 15, 13, 8, 14, 12) }, equipment: [{ option: 0 }, { option: 0 }, { option: 0 }] });
	const rapier = attacks(rogue).find((a) => a.name === "Rapier")!;
	assert.equal(rapier.ability, "dex");
	assert.equal(rapier.toHit, 3 + 2);
	const bow = attacks(rogue).find((a) => a.name === "Shortbow")!;
	assert.equal(bow.kind, "ranged");
	assert.deepEqual(bow.range, { normal: 80, long: 320 });
});

test("jack of all trades applies to initiative and unskilled checks", () => {
	let bard = createCharacter({ name: "B", speciesId: "human", classId: "bard", backgroundId: "acolyte", level: 2, abilities: { method: "standard_array", scores: arr(8, 14, 13, 10, 12, 15) }, choices: { "class:skills": ["performance", "persuasion", "deception"] } });
	assert.equal(initiativeMod(bard), 2 + 1);
	assert.equal(skillMod(bard, "athletics"), -1 + 1);
	assert.equal(skillMod(bard, "performance"), 3 + 2);
	bard = { ...bard, inventory: [...bard.inventory, itemFromEquipment("leather-armor")] };
	assert.ok(deriveSheet(bard).carrying.capacity === 9 * 15);
});

test("champion crit range and fighter extra attacks", () => {
	assert.equal(critRange(fighter(3)), 19);
	assert.equal(critRange(fighter(15)), 18);
	assert.equal(attacksPerAction(fighter(4)), 1);
	assert.equal(attacksPerAction(fighter(5)), 2);
	assert.equal(attacksPerAction(fighter(11)), 3);
	assert.equal(attacksPerAction(fighter(20)), 4);
});

// ─── level-up ──────────────────────────────────────────────────────────────

test("levelUp requires XP, applies average or rolled HP", () => {
	const c = fighter();
	assert.throws(() => levelUp(c, "fighter"), /more XP/);
	const r = levelUp({ ...c, xp: 300 }, "fighter");
	assert.equal(r.character.classes[0].level, 2);
	assert.equal(r.hpGained, 6 + 3 + 1); // avg d10 + CON + toughness
	assert.equal(r.character.maxHp, 24);
	assert.ok(r.character.features.some((f) => f.id === "action-surge-1-use"));
	const rolled = levelUp({ ...c, xp: 300 }, "fighter", {}, { hp: "roll", rng: new Rng(7) });
	assert.ok(rolled.hpRolled! >= 1 && rolled.hpRolled! <= 10);
	assert.equal(rolled.hpGained, Math.max(1, rolled.hpRolled! + 3) + 1);
	assert.throws(() => levelUp({ ...c, xp: 300 }, "fighter", {}, { hp: "roll" }), /Rng/);
	// Milestone leveling.
	assert.equal(levelUp(c, "fighter", {}, { ignoreXp: true }).character.classes[0].level, 2);
});

test("ASI levels: fighter 6/14, rogue 10; CON increase is retroactive", () => {
	const at = (classId: string, lvl: number) => levelUpOptions({ ...fighter(), classes: [{ classId, level: lvl - 1 }] }, classId).asi;
	assert.ok(at("fighter", 6) && at("fighter", 14) && !at("fighter", 7));
	assert.ok(at("rogue", 10) && !at("rogue", 6));
	const c3 = fighter(3);
	const r = levelUp({ ...c3, xp: 2700 }, "fighter", { asi: ["con", "con"] });
	assert.equal(r.character.abilities.con, 18);
	// level 4: avg 6 + CON 4 + 1, plus +1 retroactive for 3 earlier levels
	assert.equal(r.character.maxHp, c3.maxHp + 6 + 4 + 1 + 3);
	assert.throws(() => levelUp({ ...c3, xp: 2700 }, "fighter", { asi: ["wis", "int", "cha"] }), /exactly 2/);
	const feat = levelUp({ ...c3, xp: 2700 }, "fighter", { asi: ["feat:grappler", "feat:grappler"] });
	assert.ok(feat.character.features.some((f) => f.id === "feat:grappler"));
	const opts = levelUpOptions(c3, "fighter");
	assert.ok(opts.choices.some((x) => x.id === "asi"));
});

test("subclass choice at the right level", () => {
	const c2 = fighter(2);
	const opts = levelUpOptions(c2, "fighter");
	assert.equal(opts.choices.find((x) => x.id === "subclass")!.options[0].index, "champion");
	const r = levelUp({ ...c2, xp: 900 }, "fighter", { subclass: ["champion"] });
	assert.equal(r.character.classes[0].subclassId, "champion");
	assert.ok(r.newFeatures.some((f) => f.id === "improved-critical"));
	assert.throws(() => levelUp({ ...c2, xp: 900 }, "fighter", { subclass: ["evocation"] }), /not a valid option/);
});

test("level-up spells for known casters", () => {
	const sorc = createCharacter({ name: "S", speciesId: "human", classId: "sorcerer", backgroundId: "sage", abilities: { method: "standard_array", scores: arr(8, 14, 13, 12, 10, 15) } });
	const opts = levelUpOptions(sorc, "sorcerer");
	assert.equal(opts.choices.find((x) => x.id === "spells")!.choose, 1);
	const r = levelUp({ ...sorc, xp: 300 }, "sorcerer", { spells: ["shield"] });
	const e = r.character.spellcasting!.classes.find((x) => x.classId === "sorcerer")!;
	assert.equal(e.known.length, 3);
	assert.ok(e.known.includes("shield"));
	assert.deepEqual(r.character.spellcasting!.slots.slice(0, 2), [3, 0]);
	assert.ok(r.character.features.some((f) => f.id === "font-of-magic" && f.uses?.max === 2));
	assert.throws(() => levelUp({ ...sorc, xp: 300 }, "sorcerer", { spells: ["fireball"] }), /not a valid option/);
});

// ─── multiclass & slots ────────────────────────────────────────────────────

test("multiclass prerequisites", () => {
	const c = fighter(); // INT 8
	assert.equal(canMulticlass(c, "wizard").ok, false);
	assert.throws(() => levelUp({ ...c, xp: 300 }, "wizard"), /requires INT 13/);
	assert.equal(canMulticlass(c, "cleric").ok, true); // WIS 13, fighter STR 15
	const r = levelUp({ ...c, xp: 300 }, "cleric", { subclass: ["life"] });
	assert.equal(r.character.classes.length, 2);
	assert.equal(r.hpGained, 5 + 3 + 1); // avg d8, not max
	assert.deepEqual(r.character.hitDice.map((h) => h.die).sort(), [10, 8].sort());
	assert.deepEqual(r.character.savingThrows, ["str", "con"]); // no new saves
	assert.ok(r.character.spellcasting!.classes.some((x) => x.classId === "cleric" && x.prepared.includes("bless")));
	assert.deepEqual(r.character.spellcasting!.slots.slice(0, 1), [2]);
});

test("slot tables: single class, multiclass, pact magic", () => {
	assert.deepEqual(computeSlots([{ classId: "wizard", level: 5 }]).slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual(computeSlots([{ classId: "paladin", level: 1 }]).slots, Array(9).fill(0));
	assert.deepEqual(computeSlots([{ classId: "paladin", level: 2 }]).slots.slice(0, 1), [2]);
	assert.equal(multiclassCasterLevel([{ classId: "wizard", level: 3 }, { classId: "cleric", level: 2 }]), 5);
	assert.deepEqual(computeSlots([{ classId: "wizard", level: 3 }, { classId: "cleric", level: 2 }]).slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
	assert.deepEqual(computeSlots([{ classId: "paladin", level: 3 }, { classId: "ranger", level: 3 }]).slots.slice(0, 2), [3, 0]); // caster level 2
	const pw = computeSlots([{ classId: "paladin", level: 2 }, { classId: "warlock", level: 3 }]);
	assert.deepEqual(pw.slots.slice(0, 2), [2, 0]);
	assert.deepEqual(pw.pact, { level: 2, max: 2 });
	assert.deepEqual(computeSlots([{ classId: "warlock", level: 11 }]).pact, { level: 5, max: 3 });
	assert.deepEqual(computeSlots([{ classId: "wizard", level: 20 }]).slots, [4, 3, 3, 3, 3, 2, 2, 1, 1]);
	assert.deepEqual(computeSlots([{ classId: "fighter", level: 5 }]).slots, Array(9).fill(0));
});

// ─── resources & rests ─────────────────────────────────────────────────────

test("useFeature and spendSlot", () => {
	const c = fighter(2);
	const a = useFeature(c, "action-surge");
	assert.equal(a.features.find((f) => f.id === "action-surge-1-use")!.uses!.used, 1);
	assert.throws(() => useFeature(a, "action-surge"), /only 0/);
	assert.throws(() => useFeature(c, "rage"), /doesn't have/);
	const tf = createCharacter({ name: "W", speciesId: "human", classId: "warlock", backgroundId: "sage", level: 3, abilities: { method: "standard_array", scores: arr(8, 14, 13, 12, 10, 15) } });
	const s1 = spendSlot(tf, 2);
	assert.equal(s1.spellcasting!.pact!.used, 1);
	const s2 = spendSlot(s1, 2);
	assert.throws(() => spendSlot(s2, 2), /No level-2/);
	const w = createCharacter({ name: "M", speciesId: "human", classId: "wizard", backgroundId: "sage", level: 3, abilities: { method: "standard_array", scores: arr(8, 14, 13, 15, 12, 10) } });
	const w1 = spendSlot(w, 2);
	assert.equal(w1.spellcasting!.slotsUsed[1], 1);
	assert.equal(w.spellcasting!.slotsUsed[1], 0); // pure
});

test("short rest: hit dice, short-rest features, pact slots, arcane recovery", () => {
	let c = fighter(3);
	c = useFeature(useFeature(c, "second-wind"), "action-surge");
	c = applyDamage(c, 20).character;
	const r = shortRest(c, new Rng(1), { hitDice: 2 });
	assert.equal(r.rolls.length, 2);
	assert.equal(r.character.hitDice[0].used, 2);
	assert.equal(r.character.hp, Math.min(c.maxHp, c.hp + r.rolls.reduce((n, x) => n + Math.max(0, x.total), 0)));
	assert.ok(r.character.features.every((f) => !f.uses || f.uses.used === 0));
	assert.throws(() => shortRest(r.character, new Rng(1), { hitDice: 5 }), /hit dice/);

	let wl = createCharacter({ name: "W", speciesId: "human", classId: "warlock", backgroundId: "sage", level: 2, abilities: { method: "standard_array", scores: arr(8, 14, 13, 12, 10, 15) } });
	wl = spendSlot(spendSlot(wl, 1), 1);
	assert.equal(shortRest(wl, new Rng(1)).character.spellcasting!.pact!.used, 0);

	let wiz = createCharacter({ name: "M", speciesId: "human", classId: "wizard", backgroundId: "sage", level: 4, abilities: { method: "standard_array", scores: arr(8, 14, 13, 15, 12, 10) } });
	wiz = spendSlot(spendSlot(wiz, 2), 1);
	assert.throws(() => shortRest(wiz, new Rng(1), { recoverSlots: [2, 1] }), /at most 2/);
	const rec = shortRest(wiz, new Rng(1), { recoverSlots: [2] });
	assert.equal(rec.character.spellcasting!.slotsUsed[1], 0);
	assert.throws(() => shortRest(rec.character, new Rng(1), { recoverSlots: [1] }), /No slot recovery/);
});

test("long rest restores HP, slots, features, half hit dice, exhaustion", () => {
	let c = fighter(4);
	c = applyDamage(c, 30).character;
	c = { ...c, hitDice: [{ die: 10, total: 4, used: 4 }], exhaustion: 2 };
	c = useFeature(c, "second-wind");
	const r = longRest(c);
	assert.equal(r.hp, r.maxHp);
	assert.equal(r.hitDice[0].used, 2);
	assert.equal(r.exhaustion, 1);
	assert.ok(r.features.every((f) => !f.uses || f.uses.used === 0));
	assert.equal(longRest(c, { fed: false }).exhaustion, 2);
});

test("damage, temp HP, resistance, healing, death saves", () => {
	const c = fighter(); // 14 HP, resistant to poison
	const t = grantTempHp(c, 5);
	assert.equal(grantTempHp(t, 3).tempHp, 5); // no stacking
	const d1 = applyDamage(t, 8);
	assert.equal(d1.absorbedByTemp, 5);
	assert.equal(d1.character.hp, 11);
	const poison = applyDamage(c, 9, { type: "poison" });
	assert.equal(poison.applied, 4);
	assert.equal(poison.modifier, "resisted");
	const rage = applyDamage(c, 9, { type: "slashing", extraResistances: ["slashing"] });
	assert.equal(rage.applied, 4);
	const down = applyDamage(c, 20);
	assert.equal(down.droppedToZero, true);
	assert.equal(down.instantDeath, false);
	assert.ok(hasCondition(down.character, "unconscious"));
	assert.equal(applyDamage(c, 14 + 14).instantDeath, true);
	// Death saves.
	let z = down.character;
	z = recordDeathSave(z, 12).character;
	z = recordDeathSave(z, 1).character;
	assert.deepEqual(z.deathSaves, { successes: 1, failures: 2 });
	assert.equal(applyDamage(z, 1).character.deathSaves.failures, 3);
	const rev = recordDeathSave(z, 20);
	assert.equal(rev.outcome, "revived");
	assert.equal(rev.character.hp, 1);
	assert.ok(!hasCondition(rev.character, "unconscious"));
	const ds = rollDeathSave(down.character, new Rng(3));
	assert.ok(["success", "failure", "revived"].includes(ds.outcome));
	const healed = heal(down.character, 100);
	assert.equal(healed.hp, 14);
	assert.deepEqual(healed.deathSaves, { successes: 0, failures: 0 });
});

test("conditions and exhaustion", () => {
	const c = fighter();
	const p = addCondition(c, { id: "poisoned", source: "spider", rounds: 10 });
	assert.ok(hasCondition(p, "poisoned"));
	assert.ok(!hasCondition(removeCondition(p, "poisoned"), "poisoned"));
	const e2 = addExhaustion(c, 2);
	assert.equal(speedOf(e2), 12);
	const e4 = addExhaustion(c, 4);
	assert.equal(effectiveMaxHp(e4), 7);
	const e6 = addExhaustion(c, 6);
	assert.equal(e6.deathSaves.failures, 3);
});

test("rogue L20 / barbarian L20 sanity", () => {
	const b = createCharacter({ name: "G", speciesId: "human", classId: "barbarian", backgroundId: "soldier", level: 20, abilities: { method: "standard_array", scores: arr(15, 13, 14, 8, 12, 10) } });
	assert.ok(b.abilities.str > 20 && b.abilities.str <= 24); // Primal Champion
	assert.equal(b.features.find((f) => f.id === "rage")!.uses!.max, 99);
	assert.equal(deriveSheet(b).classNumbers.rage_damage_bonus, 4);
	const applied = applyClassLevel(fighter(), "fighter");
	assert.equal(applied.character.classes[0].level, 2);
	// Counters on features this module doesn't know survive a level-up.
	const boon = { ...fighter(), xp: 300, features: [...fighter().features, { id: "dm-boon", name: "Boon", source: "dm", description: "", uses: { max: 3, used: 1, recharge: "long" as const } }] };
	const after = levelUp(boon, "fighter").character.features.find((f) => f.id === "dm-boon")!;
	assert.deepEqual(after.uses, { max: 3, used: 1, recharge: "long" });
});

test("spirit beast: aspect chosen at 3rd level, switchable later", () => {
	const b = createCharacter({ name: "H", speciesId: "human", classId: "barbarian", backgroundId: "soldier", abilities: { method: "standard_array", scores: arr(15, 14, 13, 8, 12, 10) } });
	const b2 = levelUp({ ...b, xp: 300 }, "barbarian").character;
	const o3 = levelUpOptions(b2, "barbarian", { subclass: ["hb-path-of-the-spirit-beast"] });
	assert.deepEqual(o3.choices.find((x) => x.id === "spirit-aspect")!.options.map((o) => o.index), ["stag", "raven", "tortoise", "serpent"]);
	const b3 = levelUp({ ...b2, xp: 900 }, "barbarian", { subclass: ["hb-path-of-the-spirit-beast"], "spirit-aspect": ["tortoise"] }).character;
	assert.ok(b3.features.some((f) => f.id === "hb-path-of-the-spirit-beast-spirit-aspect:tortoise" && f.name === "Spirit Aspect: Tortoise"));
	// Later levels offer it again with the current beast first (auto-fill keeps it).
	const o4 = levelUpOptions(b3, "barbarian");
	assert.equal(o4.choices.find((x) => x.id === "spirit-aspect")!.options[0].index, "tortoise");
	const kept = levelUp({ ...b3, xp: 2700 }, "barbarian").character;
	assert.equal(kept.features.filter((f) => f.id.startsWith("hb-path-of-the-spirit-beast-spirit-aspect:")).length, 1);
	const switched = levelUp({ ...b3, xp: 2700 }, "barbarian", { "spirit-aspect": ["serpent"] }).character;
	const aspects = switched.features.filter((f) => f.id.startsWith("hb-path-of-the-spirit-beast-spirit-aspect:"));
	assert.deepEqual(aspects.map((f) => f.id), ["hb-path-of-the-spirit-beast-spirit-aspect:serpent"]);
	// Other subclasses never see it.
	assert.ok(!levelUpOptions(b2, "barbarian").choices.some((x) => x.id === "spirit-aspect"));
});
