import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import equipmentJson from "../lib/srd/data/equipment.json";
import monstersJson from "../lib/srd/data/monsters.json";
import zEquipment from "../lib/srd/data/zombie/equipment.json";
import zMonsters from "../lib/srd/data/zombie/monsters.json";
import cEquipment from "../lib/srd/data/cyber/equipment.json";
import cMonsters from "../lib/srd/data/cyber/monsters.json";
import cOrigins from "../lib/srd/data/cyber/origins.json";
import cKits from "../lib/srd/data/cyber/kits.json";
import cPrograms from "../lib/srd/data/cyber/programs.json";
import { CLASSES, SKILLS, getEquipment, getMonster, getSpecies, type EquipmentData, type SpeciesData } from "../lib/srd";
import type { MonsterStats } from "../lib/game/types";

const eq = cEquipment as unknown as EquipmentData[];
const mon = cMonsters as unknown as MonsterStats[];
const origins = cOrigins as unknown as SpeciesData[];
const kits = cKits as unknown as Record<string, { ref: string; qty: number }[]>;
const programs = cPrograms as unknown as { index: string }[];
const cEq = (ref: string) => eq.find((e) => e.index === ref);
const XP: Record<number, number> = { 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800 };
const DAMAGE = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const SLOTS = ["neural", "eyes", "arms", "legs", "skin", "internal"];
const TOKENS = ["soldier", "raider", "survivor", "drone", "spider_drone"];
/** Names from other cyberpunk games stay out. */
const BORROWED = /arasaka|militech|night city|kiroshi|sandevistan|mantis|gorilla arms|cyberpsych/i;

test("cyber content: c- prefixed, unique, no collisions with SRD or The Quiet, tagged cyberpunk", () => {
	const taken = new Set([...(equipmentJson as { index: string }[]), ...(monstersJson as { index: string }[]), ...(zEquipment as { index: string }[]), ...(zMonsters as { index: string }[])].map((x) => x.index));
	for (const list of [eq, mon, origins] as { index: string }[][]) {
		const ids = list.map((x) => x.index);
		assert.equal(new Set(ids).size, ids.length);
		for (const id of ids) {
			assert.ok(id.startsWith("c-"), id);
			assert.ok(!taken.has(id), `${id} collides`);
		}
	}
	assert.equal(getEquipment("c-heavy-pistol")?.ruleset, "cyberpunk");
	assert.equal(getMonster("c-santi-varela")?.ruleset, "cyberpunk");
	assert.equal(getSpecies("c-origin-vantis-trial-kid")?.ruleset, "cyberpunk");
	const all = JSON.stringify([eq, mon, origins]);
	assert.doesNotMatch(all, BORROWED);
});

test("equipment: firearms name existing ammo and are loud xor quiet; costs in cred", () => {
	for (const e of eq) {
		assert.ok(e.name && e.category && e.description, e.index);
		assert.equal(e.cost.unit, "cred", e.index);
		assert.ok(e.cost.qty >= 0, e.index);
		if (e.weapon) {
			assert.ok(DAMAGE.includes(e.weapon.damageType), e.index);
			if (e.weapon.ranged) {
				assert.ok(e.ammo, `${e.index} has ammo`);
				assert.ok(e.weapon.properties.includes("ammunition"), e.index);
				assert.ok(e.weapon.properties.includes("loud") !== e.weapon.properties.includes("quiet"), `${e.index} loud xor quiet`);
			}
		}
		if (e.ammo) assert.equal(cEq(e.ammo)?.category, "ammunition", `${e.index} → ${e.ammo}`);
		if (e.category === "ammunition") assert.ok(e.bundle! >= 6 && e.bundle! <= 15, `${e.index} bundle ${e.bundle}`);
	}
	for (const g of ["c-light-pistol", "c-heavy-pistol", "c-smart-pistol", "c-smg", "c-shotgun", "c-rifle"]) assert.ok(getEquipment(g)?.weapon?.ranged, g);
	for (const m of ["c-knife", "c-stun-baton", "c-monowire-whip", "c-machete"]) assert.equal(getEquipment(m)?.weapon?.ranged, false, m);
	for (const a of ["c-armored-jacket", "c-ballistic-vest", "c-tactical-armor"]) assert.ok(getEquipment(a)?.armor, a);
	// Consumables the programs use up, and the opening's story item.
	for (const ix of ["c-med-patch", "c-chem-vial", "c-nanite-canister", "c-burner-id", "c-drone-battery", "c-bypass-kit", "c-badge-cloner", "c-signal-jammer", "c-burner-phone"]) assert.ok(getEquipment(ix), ix);
	assert.equal(getEquipment("c-vantis-shard")?.cost.qty, 0);
});

test("decks: tiers 0–3 at rising cost, +1 RAM from tier 2, built-in programs exist", () => {
	const decks = eq.filter((e) => e.deck).sort((a, b) => a.deck!.tier - b.deck!.tier);
	assert.deepEqual(decks.map((d) => d.deck!.tier), [0, 1, 2, 3]);
	assert.deepEqual(getEquipment("c-deck-secondhand")!.deck, { tier: 0, ram: 0, programs: ["p-sledgehammer", "p-ghost"] });
	for (let i = 1; i < decks.length; i++) assert.ok(decks[i].cost.qty > decks[i - 1].cost.qty, decks[i].index);
	for (const d of decks) {
		assert.equal(d.deck!.ram, d.deck!.tier >= 2 ? 1 : 0, d.index);
		assert.equal(d.deck!.programs.length, 2, d.index);
		assert.ok(d.deck!.programs.every((p) => p.startsWith("p-")), d.index);
	}
	// The programs are written separately; check the references once they exist.
	if (!programs.length) return;
	const ids = new Set(programs.map((p) => p.index));
	for (const d of decks) for (const p of d.deck!.programs) assert.ok(ids.has(p), `${d.index} built-in ${p} is not a program`);
});

test("cyberware: valid implant blocks with Humanity 1–6", () => {
	const implants = eq.filter((e) => e.implant);
	assert.ok(implants.length >= 12, `${implants.length} implants`);
	for (const e of implants) {
		const { slot, humanity, effect } = e.implant!;
		assert.ok(SLOTS.includes(slot), `${e.index} slot ${slot}`);
		assert.ok(Number.isInteger(humanity) && humanity >= 1 && humanity <= 6, `${e.index} humanity ${humanity}`);
		assert.ok(effect.length > 10, e.index);
		assert.ok(e.cost.qty > 0, e.index);
	}
	for (const slot of SLOTS) assert.ok(implants.some((e) => e.implant!.slot === slot), `no implant for ${slot}`);
	for (const ix of ["c-hawk-eye", "c-quick-nerve", "c-pangolin-skin", "c-crane-arm", "c-retractable-blades", "c-filter-lungs", "c-ram-expansion", "c-voice-modulator", "c-biomonitor"]) assert.ok(getEquipment(ix)?.implant, ix);
});

test("kits: all twelve hacking styles, real items, a deck in each, ammo for every gun", () => {
	assert.deepEqual(Object.keys(kits).sort(), CLASSES.map((c) => c.index).sort());
	for (const [cls, kit] of Object.entries(kits)) {
		for (const k of kit) {
			assert.ok(cEq(k.ref), `${cls}: ${k.ref}`);
			assert.ok(k.qty >= 1);
			assert.equal(cEq(k.ref)!.implant, undefined, `${cls}: kits carry no implants`);
		}
		assert.ok(kit.some((k) => cEq(k.ref)?.deck), `${cls} has a deck`);
		for (const g of kit.filter((k) => cEq(k.ref)?.weapon?.ranged)) assert.ok(kit.some((k) => k.ref === cEq(g.ref)!.ammo), `${cls} has ammo for ${g.ref}`);
		assert.ok(!kit.some((k) => k.ref === "c-vantis-shard"), `${cls}: the shard comes from the opening`);
	}
	const secondhand = Object.values(kits).filter((k) => k.some((x) => x.ref === "c-deck-secondhand")).length;
	assert.ok(secondhand >= 9, `${secondhand} kits with the second-hand deck`);
});

test("origins: eight, human, with skills and the Vantis trial kid's jack", () => {
	assert.equal(origins.length, 8);
	const skillIds = new Set(SKILLS.map((s) => s.index));
	for (const o of origins) {
		assert.ok(o.index.startsWith("c-origin-"), o.index);
		assert.equal(o.size, "medium");
		assert.equal(o.speed, 30);
		assert.deepEqual(o.languages, ["common"]);
		assert.ok(o.traits.length >= 2, o.index);
		for (const s of o.skills) assert.ok(skillIds.has(s), `${o.index} skill ${s}`);
		for (const w of o.weapons) assert.ok(getEquipment(w), `${o.index} weapon ${w}`);
		for (const c of o.choices) assert.ok(c.id.startsWith(`${o.index}:`) && c.options.every((x) => skillIds.has(x.index)), c.id);
	}
	const vantis = getSpecies("c-origin-vantis-trial-kid")!;
	assert.ok(vantis.traits.some((t) => /\+1 RAM/.test(t.description)));
	assert.ok(vantis.traits.some((t) => /resistance to psychic damage/.test(t.description)));
	assert.ok(getSpecies("c-origin-campus-dropout")!.choices.some((c) => c.id.endsWith(":skills")));
});

test("monsters: shapes, CR 1/8–5 with matching XP, multiattack parts, Santi Varela", () => {
	for (const m of mon) {
		assert.ok(TOKENS.includes(m.tokenHint), `${m.index} token ${m.tokenHint}`);
		assert.ok(m.cr >= 0.125 && m.cr <= 5, `${m.index} cr`);
		assert.equal(m.xp, XP[m.cr], `${m.index} xp`);
		assert.equal(m.appearsDay, undefined, m.index);
		for (const k of ["saves", "skills", "abilities", "speed"] as const) assert.equal(typeof m[k], "object", `${m.index}.${k}`);
		for (const k of ["vulnerabilities", "resistances", "immunities", "conditionImmunities", "traits", "actions", "bonusActions", "reactions", "legendaryActions"] as const) assert.ok(Array.isArray(m[k]), `${m.index}.${k}`);
		const names = new Set(m.actions.map((a) => a.name));
		for (const a of m.actions) {
			for (const p of a.multiattack ?? []) assert.ok(names.has(p.action), `${m.index} multiattack ${p.action}`);
			if (a.attack) assert.ok(a.attack.damage.every((d) => /^\d+d\d+([+-]\d+)?$/.test(d.dice) && DAMAGE.includes(d.type)), `${m.index} ${a.name}`);
			if (a.save?.damage) assert.ok(a.save.damage.every((d) => DAMAGE.includes(d.type)), `${m.index} ${a.name}`);
		}
	}
	for (const ix of ["c-ferro-guard", "c-ferro-officer", "c-ferro-tactical", "c-ahogados-ganger", "c-ahogados-enforcer", "c-ahogados-boss", "c-security-drone", "c-spider-drone", "c-bounty-hunter", "c-corporate-bodyguard", "c-rival-hacker", "c-fractured-chromehead", "c-santi-varela"]) assert.ok(getMonster(ix), ix);
	assert.ok(getMonster("c-security-drone")!.speed.fly);
	assert.ok(mon.some((m) => m.cr === 0.125) && mon.some((m) => m.cr === 5));
});

test("Spanish: every cyber text is in c1.json/co.json and dict.json", () => {
	const read = (f: string) => JSON.parse(fs.readFileSync(`${__dirname}/../lib/srd/es/${f}`, "utf8")) as Record<string, string>;
	const c1 = read("c1.json");
	const co = read("co.json");
	const dict = read("dict.json");
	const texts: [Record<string, string>, string][] = [];
	for (const e of eq) {
		texts.push([c1, e.name], [c1, e.description!]);
		if (e.implant) texts.push([c1, e.implant.effect]);
	}
	for (const m of mon) {
		texts.push([c1, m.name]);
		for (const x of [...m.traits, ...m.actions, ...m.bonusActions, ...m.reactions]) texts.push([c1, x.name], [c1, x.description]);
	}
	for (const o of origins) for (const t of [o.name, o.sizeDescription, o.age, o.alignment, o.languageDescription, ...o.traits.flatMap((t) => [t.name, t.description]), ...o.choices.map((c) => c.label)]) texts.push([co, t]);
	for (const [src, s] of texts) {
		assert.ok(src[s], `missing Spanish: ${s.slice(0, 60)}`);
		assert.equal(dict[s], src[s], `dict.json not rebuilt for: ${s.slice(0, 60)}`);
	}
});
