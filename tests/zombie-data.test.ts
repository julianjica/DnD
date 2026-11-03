import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import equipmentJson from "../lib/srd/data/equipment.json";
import spellsJson from "../lib/srd/data/spells.json";
import monstersJson from "../lib/srd/data/monsters.json";
import zEquipment from "../lib/srd/data/zombie/equipment.json";
import zTechniques from "../lib/srd/data/zombie/techniques.json";
import zMonsters from "../lib/srd/data/zombie/monsters.json";
import zKits from "../lib/srd/data/zombie/kits.json";
import { CLASSES, EQUIPMENT, MONSTERS, SPELLS, getEquipment, getMonster, getSpell, type EquipmentData } from "../lib/srd";
import type { MonsterStats, SpellInfo } from "../lib/game/types";

const eq = zEquipment as unknown as EquipmentData[];
const tech = zTechniques as unknown as SpellInfo[];
const mon = zMonsters as unknown as MonsterStats[];
const kits = zKits as unknown as Record<string, { ref: string; qty: number }[]>;
const CASTERS = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"];
const TOKENS = ["zombie", "zombie_crawler", "zombie_horde", "zombie_bloater", "zombie_riot", "zombie_screamer", "zombie_runner", "zombie_brute", "dog", "raider", "soldier", "survivor"];
const XP: Record<number, number> = { 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300 };
const DAMAGE = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const zEq = (ref: string) => eq.find((e) => e.index === ref);

test("zombie content has prefixed, unique indices that never collide with the SRD", () => {
	const srd = new Set([...(equipmentJson as { index: string }[]), ...(spellsJson as { index: string }[]), ...(monstersJson as { index: string }[])].map((x) => x.index));
	for (const [list, prefix] of [[eq, "z-"], [tech, "t-"], [mon, "z-"]] as const) {
		const ids = list.map((x) => x.index);
		assert.equal(new Set(ids).size, ids.length, `duplicate in ${prefix}`);
		for (const id of ids) {
			assert.ok(id.startsWith(prefix), id);
			assert.ok(!srd.has(id), `${id} collides with the SRD`);
		}
	}
	// Merged into the shared lists, tagged.
	assert.equal(getEquipment("z-pistol-9mm")?.ruleset, "zombie");
	assert.equal(getSpell("t-molotov")?.ruleset, "zombie");
	assert.equal(getMonster("z-shambler")?.ruleset, "zombie");
	assert.ok(EQUIPMENT.length > eq.length && SPELLS.length > tech.length && MONSTERS.length > mon.length);
});

test("techniques: engine fields, every casting profession covered, components resolve", () => {
	const classIds = new Set(CLASSES.map((c) => c.index));
	for (const t of tech) {
		assert.ok(t.level >= 0 && t.level <= 5, t.index);
		assert.ok(["1 action", "1 bonus action", "1 reaction", "1 minute"].includes(t.castingTime), `${t.index} castingTime ${t.castingTime}`);
		assert.ok(t.name && t.description && t.range && t.duration && t.school, t.index);
		assert.ok(Array.isArray(t.components) && typeof t.concentration === "boolean" && typeof t.ritual === "boolean", t.index);
		assert.ok(t.classes.length && t.classes.every((c) => classIds.has(c) && CASTERS.includes(c)), `${t.index} classes`);
		assert.doesNotMatch(t.description, /\b(magic|magical|spell|arcane|divine)\b/i, `${t.index} is not magic`);
		if (t.damage) {
			assert.ok(DAMAGE.includes(t.damage.type), t.index);
			assert.ok(t.level === 0 ? t.damage.byCharacterLevel?.[1] : t.damage.bySlotLevel?.[t.level], `${t.index} damage dice at its level`);
		}
		if (t.heal) assert.ok(t.heal.bySlotLevel[t.level], `${t.index} heal dice`);
		if (t.attack) assert.ok(t.damage, `${t.index} attack without damage`);
		for (const c of t.consumes ?? []) {
			assert.ok(zEq(c.ref), `${t.index} consumes unknown ${c.ref}`);
			assert.ok(c.qty >= 1);
		}
		if (t.consumes?.length) assert.ok(t.components.includes("M") && t.material, `${t.index} lists its material`);
	}
	for (const c of CASTERS) {
		const n = tech.filter((t) => t.classes.includes(c)).length;
		assert.ok(n >= 8 && n <= 16, `${c}: ${n} techniques`);
		if (c !== "paladin" && c !== "ranger") assert.ok(tech.some((t) => t.classes.includes(c) && t.level === 0), `${c} has cantrips`);
	}
	assert.deepEqual(getSpell("t-molotov")!.consumes, [{ ref: "z-glass-bottle", qty: 1 }, { ref: "z-gasoline", qty: 1 }, { ref: "z-rag", qty: 1 }]);
});

test("equipment: firearms are loud and name their ammo; quiet ranged too; ammo is scarce", () => {
	for (const e of eq) {
		assert.ok(e.name && e.category && e.cost && e.description, e.index);
		if (e.weapon) {
			assert.ok(DAMAGE.includes(e.weapon.damageType), e.index);
			if (e.weapon.ranged) {
				assert.ok(e.ammo, `${e.index} has ammo`);
				assert.ok(e.weapon.properties.includes("ammunition"), e.index);
				assert.ok(e.weapon.properties.includes("loud") !== e.weapon.properties.includes("quiet"), `${e.index} loud xor quiet`);
			}
		}
		if (e.ammo) {
			const a = zEq(e.ammo);
			assert.equal(a?.category, "ammunition", `${e.index} → ${e.ammo}`);
		}
		if (e.category === "ammunition") assert.ok(e.bundle! >= 6 && e.bundle! <= 15, `${e.index} bundle ${e.bundle}`);
	}
	for (const gun of ["z-pistol-9mm", "z-revolver-38", "z-shotgun", "z-hunting-rifle", "z-carbine"]) assert.ok(getEquipment(gun)!.weapon!.properties.includes("loud"), gun);
	assert.ok(getEquipment("z-hunting-rifle")!.weapon!.properties.includes("loading"));
	// Fantasy bows are untouched: no ammo field.
	assert.equal(getEquipment("longbow")!.ammo, undefined);
	for (const ix of ["z-kitchen-knife", "z-baseball-bat", "z-crowbar", "z-machete", "z-fire-axe", "z-sledgehammer", "z-kevlar-vest", "z-riot-shield", "z-medkit", "z-gasoline", "z-town-map"]) assert.ok(getEquipment(ix), ix);
});

test("kits: all twelve professions, real items, guns are rare", () => {
	assert.deepEqual(Object.keys(kits).sort(), CLASSES.map((c) => c.index).sort());
	let armed = 0;
	for (const [cls, kit] of Object.entries(kits)) {
		for (const k of kit) {
			assert.ok(zEq(k.ref), `${cls}: ${k.ref}`);
			assert.ok(k.qty >= 1);
		}
		assert.ok(kit.some((k) => k.ref === "z-backpack") && kit.some((k) => k.ref === "z-flashlight"), cls);
		const guns = kit.filter((k) => zEq(k.ref)?.weapon?.properties.includes("loud"));
		if (guns.length) armed++;
		for (const g of guns) assert.ok(kit.some((k) => k.ref === zEq(g.ref)!.ammo), `${cls} has ammo for ${g.ref}`);
	}
	assert.ok(armed <= 3, `${armed} professions start with a gun`);
	assert.ok(kits.paladin.some((k) => k.ref === "z-pistol-9mm"));
});

test("monsters: shapes, CR/XP, tokens, the evolving dead and infectious bites", () => {
	const schedule: Record<string, number> = { "z-fresh-turned": 0, "z-shambler": 0, "z-crawler": 1, "z-horde-pack": 1, "z-horde": 1, "z-bloater": 7, "z-riot-dead": 7, "z-screamer": 14, "z-runner": 21, "z-brute": 30 };
	for (const m of mon) {
		assert.ok(TOKENS.includes(m.tokenHint), `${m.index} token ${m.tokenHint}`);
		assert.equal(m.xp, XP[m.cr], `${m.index} xp`);
		for (const k of ["saves", "skills", "abilities", "speed"] as const) assert.equal(typeof m[k], "object", `${m.index}.${k}`);
		for (const k of ["vulnerabilities", "resistances", "immunities", "conditionImmunities", "traits", "actions", "bonusActions", "reactions", "legendaryActions"] as const) assert.ok(Array.isArray(m[k]), `${m.index}.${k}`);
		const names = new Set(m.actions.map((a) => a.name));
		for (const a of m.actions) {
			for (const p of a.multiattack ?? []) assert.ok(names.has(p.action), `${m.index} multiattack ${p.action}`);
			if (a.attack) assert.ok(a.attack.damage.every((d) => /^\d+d\d+([+-]\d+)?$/.test(d.dice) && DAMAGE.includes(d.type)), `${m.index} ${a.name}`);
		}
		if (m.index in schedule) {
			assert.equal(m.type.includes("undead"), true, m.index);
			assert.equal(m.appearsDay, schedule[m.index], m.index);
			const bites = m.actions.filter((a) => /bite/i.test(a.name));
			assert.ok(bites.length, `${m.index} bites`);
			for (const b of bites) assert.match(b.description, /infect/i, `${m.index} ${b.name}`);
		} else assert.equal(m.appearsDay, undefined, m.index);
	}
	assert.deepEqual(Object.keys(schedule).filter((k) => !mon.some((m) => m.index === k)), []);
	for (const living of ["z-feral-dog", "z-raider-thug", "z-raider-gunman", "z-raider-leader", "z-cordon-soldier", "z-desperate-survivor"]) assert.ok(getMonster(living), living);
	assert.equal(getMonster("z-shambler")!.cr, 0.25);
	assert.equal(getMonster("z-fresh-turned")!.cr, 0.5);
	assert.equal(getMonster("z-runner")!.cr, 2);
	assert.ok([5, 6].includes(getMonster("z-brute")!.cr));
});

test("Spanish: every new name and description is translated in z1.json and dict.json", () => {
	const z1 = JSON.parse(fs.readFileSync(`${__dirname}/../lib/srd/es/z1.json`, "utf8")) as Record<string, string>;
	const dict = JSON.parse(fs.readFileSync(`${__dirname}/../lib/srd/es/dict.json`, "utf8")) as Record<string, string>;
	const texts: string[] = [];
	for (const e of eq) texts.push(e.name, e.description!);
	for (const t of tech) texts.push(t.name, t.description, ...(t.material ? [t.material] : []), ...(t.higherLevel ? [t.higherLevel] : []));
	for (const m of mon) {
		texts.push(m.name);
		for (const x of [...m.traits, ...m.actions, ...m.bonusActions, ...m.reactions]) texts.push(x.name, x.description);
	}
	for (const s of texts) {
		assert.ok(z1[s], `z1.json missing: ${s.slice(0, 60)}`);
		assert.equal(dict[s], z1[s], `dict.json not rebuilt for: ${s.slice(0, 60)}`);
	}
});
