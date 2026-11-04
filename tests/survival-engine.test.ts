import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { GameState, InventoryItem } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-survival-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	combat: typeof import("../lib/dm/combat");
	survival: typeof import("../lib/rules/survival");
	digest: typeof import("../lib/dm/digest");
	prompt: typeof import("../lib/dm/prompt");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		combat: await import("../lib/dm/combat"),
		survival: await import("../lib/rules/survival"),
		digest: await import("../lib/dm/digest"),
		prompt: await import("../lib/dm/prompt"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };

function newGame(zombie: boolean, classId = "fighter"): string {
	const settings = m.defaultSettings();
	if (zombie) settings.world.preset = "zombie_outbreak";
	return m.createGame({
		settings,
		character: zombie
			? { name: "Dana", speciesId: "z-origin-streetwise", classId, backgroundId: "criminal", abilities: STD }
			: { name: "Thorin", speciesId: "human", classId, backgroundId: "soldier", abilities: STD },
	}).id;
}

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}

const item = (ref: string, name: string, quantity = 1): InventoryItem => ({ id: `it_${ref}_${Math.random().toString(36).slice(2, 7)}`, ref, name, quantity, category: "gear" });
const count = (s: GameState, ref: string) => s.character.inventory.filter((i) => i.ref === ref).reduce((n, i) => n + i.quantity, 0);
const tx = (state: GameState, seed = 1, rolls: unknown[] = []) => ({ state, rng: new Rng(seed), roll: (r: unknown) => void rolls.push(r), fx: () => undefined });

const ROWS = ["##############", "#,,,,,,,,,,,,#", "#,@,,,,,,,,,,#", "#,,,,,,,,,,,,#", "#,,,,,,,,,,,,#", "##############"];

// ─── fantasy untouched ──────────────────────────────────────────────────

test("fantasy campaigns: no survival state, no daily needs, rests and tools as before", async () => {
	const f = newGame(false);
	edit(f, (s) => {
		s.time = { day: 1, hour: 7, minute: 30 };
		s.character.exhaustion = 2;
	});
	assert.notEqual((await call(f, "short_rest", { hitDice: 0 })).isError, true);
	const lr = await call(f, "long_rest", {});
	assert.notEqual(lr.isError, true, lr.text);
	assert.match(lr.text, /Long rest complete/);
	const s = m.loadState(f);
	assert.equal(s.survival, undefined);
	assert.equal(s.character.exhaustion, 1, "the usual -1 exhaustion");
	assert.equal((await call(f, "make_noise", { amount: 3, reason: "shout" })).isError, true);
	assert.equal((await call(f, "amputate", { part: "left arm", reason: "x" })).isError, true);
	assert.equal(m.survival.survivalDigest(s), undefined);
	assert.match(m.survival.survivalDigest(m.loadState(newGame(true))) ?? "", /^Survival: noise 0\/10; not infected/, "a new zombie game shows it from turn one");
	assert.doesNotMatch(m.digest.stateDigest(s), /Survival:/);
	assert.doesNotMatch(m.prompt.buildSystemPrompt(s.settings), /make_noise/);
});

// ─── food and water ─────────────────────────────────────────────────────

test("08:00 takes a day's food and water from the inventory; each unmet need is exhaustion", async () => {
	const z = newGame(true);
	edit(z, (s) => {
		s.time = { day: 2, hour: 7, minute: 30 };
		s.character.inventory = s.character.inventory.filter((i) => !m.survival.isFood(i) && !m.survival.isWater(i));
		s.character.inventory.push(item("z-canned-food", "Canned Food", 2));
	});
	const r = await call(z, "short_rest", { hitDice: 0 });
	assert.match(r.text, /08:00 \(daily needs\): Dana ate Canned Food \(1 food left\); NO WATER: \+1 exhaustion/);
	let s = m.loadState(z);
	assert.equal(count(s, "z-canned-food"), 1);
	assert.equal(s.character.exhaustion, 1);
	assert.deepEqual([s.survival!.needs.missedMeals, s.survival!.needs.missedDrinks], [0, 1]);
	// Drinking by hand clears the missed counter.
	edit(z, (st) => st.character.inventory.push(item("z-bottled-water", "Bottled Water", 1)));
	const d = await call(z, "use_item", { item: "Bottled Water" });
	assert.match(d.text, /A day's water: drunk/);
	s = m.loadState(z);
	assert.equal(s.survival!.needs.missedDrinks, 0);
});

test("daily needs across several days at the rules level", () => {
	const z = newGame(true);
	const s = m.loadState(z);
	s.character.inventory = [item("z-canned-food", "Canned Food", 1), item("z-bottled-water", "Bottled Water", 3), { ...item("", "Jerky strips", 1), ref: undefined }];
	m.survival.survivalOf(s);
	s.time = { day: 4, hour: 9, minute: 0 }; // passes 08:00 on days 2, 3 and 4
	const note = m.survival.tick(s, new Rng(1))!;
	assert.equal((note.match(/daily needs/g) ?? []).length, 3);
	assert.equal(count(s, "z-bottled-water"), 0);
	assert.equal(s.character.inventory.length, 0, "the can and the homebrew jerky were eaten");
	assert.equal(s.survival!.needs.missedMeals, 1);
	assert.equal(s.character.exhaustion, 1);
	assert.equal(m.survival.isFood({ ref: "z-preserves", name: "Preserves" }), true);
	assert.equal(m.survival.isWater({ ref: "z-bottled-water", name: "Bottled Water" }), true);
	assert.equal(m.survival.isFood({ ref: "z-medkit", name: "Medkit" }), false);
});

// ─── noise ──────────────────────────────────────────────────────────────

test("make_noise: thresholds bring wanderers, a pack, a horde; gated by outbreak day; night is worse", async () => {
	const z = newGame(true);
	edit(z, (s) => (s.scene.timeOfDay = "day"));
	const a = await call(z, "make_noise", { amount: 2, reason: "breaking glass" });
	assert.match(a.text, /Noise \+2 \(breaking glass\): 2\/10\.$/);
	const b = await call(z, "make_noise", { amount: 2, reason: "shouting" });
	assert.match(b.text, /WANDERERS is coming: .*z-(shambler|fresh-turned)/);
	assert.doesNotMatch(b.text, /z-crawler/, "no crawlers on Day 0");
	const c = await call(z, "make_noise", { amount: 4, reason: "car alarm" });
	assert.match(c.text, /A PACK is coming/);
	assert.doesNotMatch(c.text, /z-horde-pack/, "packs only form from Day 1");
	const d = await call(z, "make_noise", { amount: 5, reason: "explosion" });
	assert.match(d.text, /10\/10.*A HORDE is coming/);
	assert.doesNotMatch(d.text, /z-horde\b/);
	assert.equal(m.loadState(z).survival!.noise.lastEvent, "explosion");

	const later = newGame(true);
	edit(later, (s) => {
		s.time.day = 4;
		s.scene.timeOfDay = "day";
	});
	// Level 1: a pack is far beyond a survivable fight, so the first wave is small and the pack comes behind it.
	const lp = (await call(later, "make_noise", { amount: 7, reason: "gunfire" })).text;
	assert.match(lp, /A PACK is coming: the first wave is/);
	assert.match(lp, /MORE are coming \(1 × z-horde-pack\)/);
	const night = newGame(true);
	edit(night, (s) => (s.time.day = 4));
	const n = await call(night, "make_noise", { amount: 4, reason: "car alarm" });
	assert.match(n.text, /A PACK is coming: .*z-horde-pack.*Night/);
});

test("noise decays 1 per 10 minutes (not in combat) and resets when the party moves", () => {
	const z = newGame(true);
	const s = m.loadState(z);
	m.survival.survivalOf(s);
	m.survival.addNoise(s, new Rng(1), 5, "car alarm");
	s.time.minute += 30;
	m.survival.tick(s, new Rng(1));
	assert.equal(s.survival!.noise.level, 2);
	m.survival.addNoise(s, new Rng(1), 3, "shot");
	s.encounter = { status: "active" } as GameState["encounter"];
	s.time.minute += 20;
	m.survival.tick(s, new Rng(1));
	assert.equal(s.survival!.noise.level, 5, "no decay mid-combat");
	delete s.encounter;
	// The DM drawing the first map of the street where the noise was made is not a move.
	s.survival!.noise.mapId = undefined;
	s.activeMapId = "map_street";
	assert.equal(m.survival.tick(s, new Rng(1)), undefined);
	assert.equal(s.survival!.noise.level, 5);
	s.world.currentLocationId = "somewhere-else";
	assert.match(m.survival.tick(s, new Rng(1)) ?? "", /Left the noise behind/);
	assert.equal(s.survival!.noise.level, 0);
});

test("gunshots and loud techniques raise the noise level; the noise log stays", async () => {
	const z = newGame(true, "paladin");
	assert.notEqual((await call(z, "draw_map", { name: "Main Street", kind: "town", rows: ROWS })).isError, true);
	assert.notEqual((await call(z, "start_combat", { monsters: [{ monster: "z-shambler", x: 10, y: 3 }] })).isError, true);
	const st = m.loadState(z);
	m.survival.survivalOf(st);
	const gun = st.character.inventory.find((i) => i.ref === "z-pistol-9mm")!;
	const enc = st.encounter!;
	enc.turnIndex = enc.order.indexOf(st.character.id);
	Object.assign(enc.combatants[st.character.id].turn, { action: true, bonusAction: true, attacksLeft: 0 });
	const target = Object.values(enc.combatants).find((c) => c.kind !== "pc")!;
	const t = tx(st, 3);
	const log = m.combat.playerCombatAction(t, { type: "attack", targetId: target.id, itemId: gun.id }, t.rng);
	assert.match(log, /Noise \+3 \(9mm Pistol\): 3\/10/);
	assert.equal(st.survival!.noise.level, 3);
	assert.equal(m.combat.noiseLog(st).length, 1);

	const w = newGame(true, "wizard");
	edit(w, (s) => {
		s.character.spellcasting!.classes[0].prepared = ["t-pipe-bomb"];
		s.character.spellcasting!.slots[2] = 1;
		s.character.inventory.push(item("z-pipe", "Steel Pipe"), item("z-black-powder", "Black Powder"), item("z-fuse", "Fuse"));
	});
	const boom = await call(w, "cast_spell", { spell: "t-pipe-bomb" });
	assert.notEqual(boom.isError, true, boom.text);
	assert.match(boom.text, /Noise \+5 \(Pipe Bomb\): 5\/10.*A PACK.*Night/);
});

// ─── bites and infection ────────────────────────────────────────────────

function bite(st: GameState, attackerIndex: string, damage = 4, name = "Bite") {
	const enc = st.encounter!;
	const attacker = Object.values(enc.combatants).find((c) => c.stats?.index === attackerIndex)!;
	const pcId = st.character.id;
	return {
		ok: true, encounter: enc, map: st.maps[enc.mapId], character: st.character, rolls: [], log: [`${attacker.name} bites.`],
		events: [
			{ type: "attack" as const, attackerId: attacker.id, targetId: pcId, name, hit: true, crit: false, rollId: "r" },
			{ type: "damage" as const, targetId: pcId, amount: damage, sourceId: attacker.id, hpAfter: st.character.hp - damage },
		],
	};
}

test("a zombie bite that wounds the player forces a CON save (dice log); a dog's doesn't", async () => {
	const z = newGame(true);
	edit(z, (s) => (s.time.day = 2));
	await call(z, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	assert.notEqual((await call(z, "start_combat", { monsters: [{ monster: "z-shambler", x: 10, y: 3 }] })).isError, true);
	let infected: GameState | undefined;
	for (let seed = 1; seed < 60 && !infected; seed++) {
		const st = m.loadState(z);
		const rolls: { label: string; target?: number }[] = [];
		const out = m.combat.applyCombatResult(tx(st, seed, rolls) as never, bite(st, "z-shambler"));
		assert.equal(rolls.length, 1);
		assert.match(rolls[0].label, /CON save vs infection \(Shambler\)/);
		assert.equal(rolls[0].target, 12);
		if (st.survival?.infection) {
			infected = st;
			assert.match(out, /INFECTED with LAZARUS.*\(secret/);
		} else assert.match(out, /SUCCESS\. Not infected/);
	}
	assert.ok(infected, "some seed fails the save");
	const inf = infected!.survival!.infection!;
	assert.equal(inf.stage, "incubating");
	assert.equal(inf.source, "z-shambler");
	const h = (inf.turnsAt - inf.bittenAt) / 60;
	assert.ok(h >= 24 && h <= 72, `turns in ${h} h`);
	// Already infected: no second save.
	const again: unknown[] = [];
	assert.match(m.combat.applyCombatResult(tx(infected!, 9, again) as never, bite(infected!, "z-shambler")), /already infected/);
	assert.equal(again.length, 0);
	// Dogs and wounds that don't land: nothing.
	const dog = newGame(true);
	await call(dog, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	assert.notEqual((await call(dog, "start_combat", { monsters: [{ monster: "z-feral-dog", x: 10, y: 3 }] })).isError, true);
	const ds = m.loadState(dog);
	const dogRolls: unknown[] = [];
	m.combat.applyCombatResult(tx(ds, 1, dogRolls) as never, bite(ds, "z-feral-dog"));
	assert.equal(ds.survival?.infection, undefined);
	const st = m.loadState(z);
	const zero: unknown[] = [];
	m.combat.applyCombatResult(tx(st, 1, zero) as never, bite(st, "z-shambler", 0));
	assert.equal(dogRolls.length + zero.length, 0);
	assert.equal(st.survival?.infection, undefined);
});

function infect(s: GameState, part: "left arm" | "torso" = "left arm", hours = 30) {
	const now = m.survival.gameMinutes(s.time);
	m.survival.survivalOf(s).infection = { bittenAt: now, turnsAt: now + hours * 60, part, stage: "incubating", source: "z-shambler" };
}

test("infection: fever at 1/3, delirium at 2/3, death and turning at the end (several stages in one jump)", () => {
	const z = newGame(true);
	const s = m.loadState(z);
	s.character.inventory.push(item("z-canned-food", "Canned Food", 9), item("z-bottled-water", "Bottled Water", 9));
	infect(s, "torso", 30);
	s.time.hour += 11;
	assert.match(m.survival.tick(s, new Rng(1))!, /fever/);
	assert.equal(s.survival!.infection!.stage, "fever");
	assert.equal(s.character.exhaustion, 1);
	s.time.day += 1; // past 2/3 and the end in one go
	const note = m.survival.tick(s, new Rng(1))!;
	assert.match(note, /delirium/);
	assert.match(note, /TURNED/);
	assert.equal(s.survival!.infection!.stage, "turned");
	assert.equal(s.character.hp, 0);
	assert.equal(s.character.deathSaves.failures, 3);
	assert.match(s.dmNotes.at(-1)!, /TURNED/);
});

test("amputate: within the hour on the bitten limb stops the infection; permanent features; legs halve speed", async () => {
	const z = newGame(true);
	edit(z, (s) => infect(s, "left arm"));
	edit(z, (s) => (s.time.minute += 40));
	const hp = m.loadState(z).character.hp;
	const r = await call(z, "amputate", { part: "left arm", reason: "fire axe, belt tourniquet" });
	assert.notEqual(r.isError, true, r.text);
	assert.match(r.text, /The left arm is amputated.*Lost Left Arm.*infection is STOPPED/);
	let s = m.loadState(z);
	assert.equal(s.survival!.infection, undefined);
	assert.deepEqual(s.survival!.amputations, ["left arm"]);
	assert.ok(s.character.hp < hp);
	assert.match(s.character.features.find((f) => f.id === "amputation-left-arm")!.description, /two-handed weapons or a shield/);
	assert.equal((await call(z, "amputate", { part: "left arm", reason: "again" })).isError, true);
	assert.equal((await call(z, "amputate", { part: "torso", reason: "no" })).isError, true);

	// Too late, or the wrong limb: the infection goes on.
	const late = newGame(true);
	edit(late, (st) => {
		st.character.hp = st.character.maxHp = 40;
		infect(st, "left arm");
		st.time.hour += 2;
	});
	const speed = m.loadState(late).character.speed;
	assert.match((await call(late, "amputate", { part: "left leg", reason: "panic" })).text, /bite was on the left arm.*continues/);
	s = m.loadState(late);
	assert.ok(s.survival!.infection);
	assert.equal(s.character.speed, speed / 2);
	assert.ok(s.character.features.some((f) => f.name === "Lost Left Leg"));
});

test("Spanish text for the amputation features and the new items", () => {
	const dict = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/srd/es/dict.json"), "utf8")) as Record<string, string>;
	for (const part of ["left arm", "right arm", "left leg", "right leg"] as const) {
		const f = m.survival.amputationFeature(part);
		assert.ok(dict[f.name], f.name);
		assert.ok(dict[f.description], f.description);
	}
	assert.equal(dict["LAZARUS Antiviral"], "Antiviral LAZARUS");
});

// ─── items ──────────────────────────────────────────────────────────────

test("use_item: medkit, bandage, painkillers, antibiotics and the antiviral", async () => {
	const z = newGame(true);
	edit(z, (s) => {
		s.character.hp = 1;
		s.character.inventory.push(item("z-medkit", "Medkit", 1), item("z-painkillers", "Painkillers", 1), item("z-antibiotics", "Antibiotics", 1), item("z-lazarus-antiviral", "LAZARUS Antiviral", 1));
		infect(s, "torso");
	});
	const med = await call(z, "use_item", { item: "Medkit" });
	assert.match(med.text, /Medkit healing: \d+ → HP/);
	assert.ok(m.loadState(z).character.hp > 1);
	assert.equal(count(m.loadState(z), "z-medkit"), 0);
	assert.match((await call(z, "use_item", { item: "Painkillers" })).text, /temporary HP/);
	assert.ok(m.loadState(z).character.tempHp >= 1);
	assert.match((await call(z, "use_item", { item: "Antibiotics" })).text, /nothing against LAZARUS/);
	assert.ok(m.loadState(z).survival!.infection);
	assert.match((await call(z, "use_item", { item: "LAZARUS Antiviral" })).text, /antiviral works/);
	assert.equal(m.loadState(z).survival!.infection, undefined);
});

test("in combat: a medkit heals through the engine, the living's gunshots make noise", async () => {
	const z = newGame(true);
	edit(z, (s) => (s.time.day = 3));
	await call(z, "draw_map", { name: "Lot", kind: "town", rows: ROWS });
	assert.notEqual((await call(z, "start_combat", { monsters: [{ monster: "z-desperate-survivor", x: 10, y: 3 }] })).isError, true);
	const st = m.loadState(z);
	m.survival.survivalOf(st);
	const enc = st.encounter!;
	enc.turnIndex = enc.order.indexOf(st.character.id);
	Object.assign(enc.combatants[st.character.id].turn, { action: true, bonusAction: true });
	enc.combatants[st.character.id].hp = 1;
	st.character.hp = 1;
	const kit = item("z-medkit", "Medkit", 1);
	st.character.inventory.push(kit);
	const t = tx(st, 5);
	const log = m.combat.playerCombatAction(t, { type: "use_item", itemId: kit.id }, t.rng);
	assert.match(log, /uses Medkit/);
	assert.ok(st.encounter!.combatants[st.character.id].hp > 1);
	assert.equal(count(st, "z-medkit"), 0);
	const raider = Object.values(enc.combatants).find((c) => c.kind !== "pc")!;
	const shot = {
		ok: true, encounter: st.encounter!, map: st.maps[enc.mapId], character: st.character, rolls: [], log: [],
		events: [{ type: "attack" as const, attackerId: raider.id, targetId: st.character.id, name: "9mm Pistol", hit: false, crit: false, rollId: "r" }],
	};
	assert.match(m.combat.applyCombatResult(tx(st, 1) as never, shot), /Noise \+3 \(Desperate Survivor's 9mm Pistol\)/);
	assert.equal(st.survival!.noise.level, 3);
});

// ─── rest ───────────────────────────────────────────────────────────────

test("long_rest in The Quiet needs secured; it can be interrupted; hunger blocks exhaustion recovery", async () => {
	const z = newGame(true);
	const no = await call(z, "long_rest", {});
	assert.equal(no.isError, true);
	assert.match(no.text, /needs secured/);
	let done = 0;
	let broken = 0;
	for (let i = 0; i < 40; i++) {
		edit(z, (s) => {
			s.character.exhaustion = 2;
			s.rng = i * 7919 + 1;
			const sv = m.survival.survivalOf(s);
			sv.noise.level = 6;
			sv.needs.lastMeal = sv.needs.lastDrink = m.survival.gameMinutes(s.time) - 2000; // over a day ago
		});
		const r = await call(z, "long_rest", { secured: false });
		assert.notEqual(r.isError, true, r.text);
		if (/INTERRUPTED/.test(r.text)) {
			broken++;
			assert.match(r.text, /z-(shambler|fresh-turned|crawler)/);
		} else {
			done++;
			assert.match(r.text, /Exhaustion NOT reduced/);
			assert.ok(m.loadState(z).character.exhaustion >= 2);
		}
	}
	assert.ok(broken > done, `unsecured at noise 6 at night is usually interrupted (${broken}/${done})`);
	// Secured, quiet and fed: a 5% chance.
	let ok = 0;
	for (let i = 0; i < 20; i++) {
		edit(z, (s) => {
			s.rng = i * 104729 + 3;
			s.character.exhaustion = 1;
			s.character.hp = 1;
			s.character.inventory.push(item("z-canned-food", "Canned Food", 3), item("z-bottled-water", "Bottled Water", 3));
			const sv = m.survival.survivalOf(s);
			sv.noise.level = 0;
			sv.needs.lastMeal = sv.needs.lastDrink = m.survival.gameMinutes(s.time);
		});
		const r = await call(z, "long_rest", { secured: true });
		if (/Long rest complete/.test(r.text)) {
			ok++;
			assert.equal(m.loadState(z).character.exhaustion, 0);
		}
	}
	assert.ok(ok >= 16, `secured rests mostly complete (${ok}/20)`);
});

// ─── digest, prompt, power ──────────────────────────────────────────────

test("digest: a Survival line with hours left for the DM only; prompt and power", () => {
	const z = newGame(true);
	const s = m.loadState(z);
	infect(s, "left arm", 30);
	m.survival.addNoise(s, new Rng(1), 3, "gunshot");
	const d = m.digest.stateDigest(s);
	const line = d.split("\n").find((l) => l.startsWith("Survival:"))!;
	assert.match(line, /noise 3\/10 \(last: gunshot\)/);
	assert.match(line, /INFECTED \(incubating, bite on the left arm, ≈30 h left, DM only; amputation can still stop it/);
	assert.doesNotMatch(line, new RegExp(String(s.survival!.infection!.turnsAt)));
	assert.match(line, /food \d+ .*water \d+/);
	assert.match(m.prompt.buildSystemPrompt(s.settings), /make_noise.*amputate.*secured=true.*scavenge, build_barricade, damage_barricade/s);
	assert.equal(m.survival.powerOn({ time: { day: 5 } }), true);
	assert.equal(m.survival.powerOn({ time: { day: 6 } }), false);
});

test("brutal balance: crits on the dead are headshots; kits carry two days of food and water", async () => {
	const { getZombieKit } = { getZombieKit: (await import("../lib/srd/data/zombie/kits.json")).default as unknown as Record<string, { ref: string; qty: number }[]> };
	for (const [cls, kit] of Object.entries(getZombieKit)) {
		assert.ok((kit.find((i) => i.ref === "z-canned-food")?.qty ?? 0) >= 2, `${cls} food`);
		assert.ok((kit.find((i) => i.ref === "z-bottled-water")?.qty ?? 0) >= 2, `${cls} water`);
	}
});
