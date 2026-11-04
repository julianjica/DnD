import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { GameState, InventoryItem } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-base-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	base: typeof import("../lib/rules/base");
	survival: typeof import("../lib/rules/survival");
	digest: typeof import("../lib/dm/digest");
	prompt: typeof import("../lib/dm/prompt");
	en: typeof import("../lib/i18n/en").en;
	es: typeof import("../lib/i18n/es").es;
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		base: await import("../lib/rules/base"),
		survival: await import("../lib/rules/survival"),
		digest: await import("../lib/dm/digest"),
		prompt: await import("../lib/dm/prompt"),
		en: (await import("../lib/i18n/en")).en,
		es: (await import("../lib/i18n/es")).es,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };

function newGame(zombie: boolean): string {
	const settings = m.defaultSettings();
	if (zombie) settings.world.preset = "zombie_outbreak";
	return m.createGame({
		settings,
		character: zombie
			? { name: "Dana", speciesId: "z-origin-streetwise", classId: "fighter", backgroundId: "criminal", abilities: STD }
			: { name: "Thorin", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: STD },
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

const item = (ref: string, name: string, quantity = 1, extra: Partial<InventoryItem> = {}): InventoryItem => ({ id: `it_${ref}_${Math.random().toString(36).slice(2, 7)}`, ref, name, quantity, category: "gear", ...extra });
const count = (s: GameState, ref: string) => s.character.inventory.filter((i) => i.ref === ref).reduce((n, i) => n + i.quantity, 0);

const ROWS = ["##########", "#........#", "#.@......#", "#........#", "####+#####", "----------"];

/** A zombie game at a claimed base (map drawn, quiet daytime). */
async function atBase(opts: { day?: number; hour?: number } = {}): Promise<string> {
	const z = newGame(true);
	edit(z, (s) => {
		s.time = { day: opts.day ?? 3, hour: opts.hour ?? 12, minute: 0 };
		s.scene.timeOfDay = "day";
		s.scene.weather = "clear";
		// Plenty to eat and drink so long time jumps don't kill the PC.
		s.character.inventory.push(item("z-canned-food", "Canned Food", 40), item("z-bottled-water", "Bottled Water", 40));
	});
	const d = await call(z, "draw_map", { name: "Hale's Pharmacy", kind: "town", rows: ROWS });
	assert.notEqual(d.isError, true, d.text);
	const c = await call(z, "claim_base", { name: "the pharmacy" });
	assert.notEqual(c.isError, true, c.text);
	return z;
}

// ─── fantasy untouched ──────────────────────────────────────────────────

test("fantasy campaigns: base tools refuse, no group, no Base line, prompt unchanged", async () => {
	const f = newGame(false);
	for (const [name, args] of [
		["claim_base", { name: "keep" }],
		["stash", { items: [{ ref: "rations", qty: 1 }] }],
		["take_from_stash", { kind: "food", qty: 1 }],
		["build_upgrade", { upgrade: "garden" }],
	] as const) assert.equal((await call(f, name, args)).isError, true, name);
	edit(f, (s) => (s.time = { day: 1, hour: 7, minute: 0 }));
	const lr = await call(f, "long_rest", {});
	assert.match(lr.text, /Long rest complete\. HP/);
	const s = m.loadState(f);
	assert.equal(s.group, undefined);
	assert.doesNotMatch(m.digest.stateDigest(s), /Base:/);
	assert.doesNotMatch(m.prompt.buildSystemPrompt(s.settings), /claim_base/);
	assert.match(m.prompt.buildSystemPrompt(m.loadState(newGame(true)).settings), /claim_base/);
});

// ─── claim ──────────────────────────────────────────────────────────────

test("claim_base: one base at the current place and active map; moving needs a reason", async () => {
	const z = await atBase();
	let s = m.loadState(z);
	const b = s.group!.base!;
	assert.deepEqual(s.group!.survivors, {});
	assert.equal(b.name, "the pharmacy");
	assert.equal(b.locationId, s.world.currentLocationId);
	assert.equal(b.mapId, s.activeMapId);
	assert.deepEqual(b.stock, { food: 0, water: 0, meds: 0, ammo: 0, fuel: 0, materials: 0 });
	assert.equal(b.fortification, 0);
	assert.equal(b.log.at(-1)!.kind, "claimed");
	assert.match(m.digest.stateDigest(s), /Base: the pharmacy at .*fortification 0\/10/);

	// Same place again: rename only.
	assert.match((await call(z, "claim_base", { name: "Hale's", structure: 2 })).text, /Base updated/);
	assert.equal(m.loadState(z).group!.base!.fortification, 2);

	// Another place: refused without a reason, then moved with it (stock kept, upgrades left).
	const other = s.world.locations.find((l) => l.id !== s.world.currentLocationId)!;
	edit(z, (st) => {
		st.group!.base!.upgrades = ["garden"];
		st.group!.base!.stock.food = 5;
	});
	assert.equal((await call(z, "claim_base", { name: "the barn", locationId: other.id })).isError, true);
	const mv = await call(z, "claim_base", { name: "the barn", locationId: other.id, reason: "the pharmacy was overrun" });
	assert.match(mv.text, /Base MOVED to the barn/);
	s = m.loadState(z);
	assert.equal(s.group!.base!.locationId, other.id);
	assert.deepEqual(s.group!.base!.upgrades, []);
	assert.equal(s.group!.base!.stock.food, 5);
	// Away from the base now: stashing refuses.
	assert.equal((await call(z, "take_from_stash", { kind: "food", qty: 1 })).isError, true);
});

// ─── stash / take ───────────────────────────────────────────────────────

test("stash converts items to units; take_from_stash gives them back as items", async () => {
	const z = await atBase();
	edit(z, (s) => {
		s.character.inventory = [
			item("z-canned-food", "Canned Food", 3),
			{ ...item("", "Beef jerky", 2), ref: undefined },
			item("z-bottled-water", "Bottled Water", 2),
			item("z-medkit", "Medkit", 1),
			item("z-bandage", "Bandage", 2),
			item("z-ammo-9mm", "9mm Rounds", 10, { category: "ammunition" }),
			item("z-shells-12ga", "12-Gauge Shells", 6, { category: "ammunition" }),
			item("z-gasoline", "Gasoline Can", 1),
			item("z-planks", "Planks", 2),
			item("z-nails", "Box of Nails", 2),
			item("z-shotgun", "Pump Shotgun", 1, { category: "weapon", equipped: true, weapon: { damage: "2d6", damageType: "piercing", properties: ["ammunition", "loud"] } }),
			item("z-flashlight", "Flashlight", 1),
		];
	});
	const r = await call(z, "stash", {
		items: [
			{ ref: "z-canned-food" }, { ref: "Beef jerky" }, { ref: "z-bottled-water" }, { ref: "z-medkit" }, { ref: "z-bandage", qty: 2 },
			{ ref: "z-ammo-9mm" }, { ref: "z-shells-12ga" }, { ref: "z-gasoline" }, { ref: "z-planks" }, { ref: "z-nails" },
		],
	});
	assert.notEqual(r.isError, true, r.text);
	let s = m.loadState(z);
	assert.deepEqual(s.group!.base!.stock, { food: 5, water: 2, meds: 5, ammo: 16, fuel: 5, materials: 4 });
	assert.deepEqual(s.character.inventory.map((i) => i.ref).sort(), ["z-flashlight", "z-shotgun"]);
	assert.equal((await call(z, "stash", { items: [{ ref: "z-flashlight" }] })).isError, true, "gear can't be stashed");
	assert.equal((await call(z, "stash", { items: [{ ref: "z-medkit" }] })).isError, true, "nothing left");

	// Ammo: the shotgun's shells first.
	const a = await call(z, "take_from_stash", { kind: "ammo", qty: 8 });
	assert.notEqual(a.isError, true, a.text);
	s = m.loadState(z);
	assert.equal(count(s, "z-shells-12ga"), 6);
	assert.equal(count(s, "z-ammo-9mm"), 2);
	// Meds: the medkit (3) comes back whole, then bandages.
	await call(z, "take_from_stash", { kind: "meds", qty: 4 });
	s = m.loadState(z);
	assert.equal(count(s, "z-medkit"), 1);
	assert.equal(count(s, "z-bandage"), 1);
	// Fuel: 5-liter cans only.
	assert.equal((await call(z, "take_from_stash", { kind: "fuel", qty: 3 })).isError, true);
	await call(z, "take_from_stash", { kind: "fuel", qty: 5 });
	// Materials: planks and nails, usable for a barricade.
	await call(z, "take_from_stash", { kind: "materials", qty: 2 });
	s = m.loadState(z);
	assert.equal(count(s, "z-gasoline"), 1);
	assert.equal(count(s, "z-planks"), 1);
	assert.equal(count(s, "z-nails"), 1);
	assert.deepEqual(s.group!.base!.stock, { food: 5, water: 2, meds: 1, ammo: 8, fuel: 0, materials: 2 });
	assert.equal((await call(z, "take_from_stash", { kind: "food", qty: 6 })).isError, true, "more than the stock");
	// Food from untracked (produced) units comes back as canned food.
	edit(z, (st) => (st.group!.base!.stock.food += 2));
	await call(z, "take_from_stash", { kind: "food", qty: 7 });
	s = m.loadState(z);
	assert.equal(count(s, "z-canned-food"), 7, "3 stashed cans back + the untracked units (jerky, production) as canned food");
	assert.equal(s.group!.base!.stock.food, 0);
});

test("unit table: stockValue conversions", () => {
	const v = m.base.stockValue;
	assert.deepEqual(v({ ref: "z-medkit", name: "Medkit", category: "gear" }), { kind: "meds", units: 3 });
	assert.deepEqual(v({ ref: "z-gasoline", name: "Gasoline Can", category: "gear" }), { kind: "fuel", units: 5 });
	assert.deepEqual(v({ ref: "z-arrow", name: "Arrows", category: "ammunition" }), { kind: "ammo", units: 1 });
	assert.deepEqual(v({ ref: "z-preserves", name: "Preserves", category: "gear" }), { kind: "food", units: 1 });
	assert.deepEqual(v({ name: "Scrap metal", category: "gear" }), { kind: "materials", units: 1 });
	assert.equal(v({ ref: "z-flashlight", name: "Flashlight", category: "gear" }), undefined);
});

// ─── upgrades ───────────────────────────────────────────────────────────

test("build_upgrade: pays the cost, finishes after its hours; workshop ×1.5 materials", async () => {
	const z = await atBase();
	assert.equal((await call(z, "build_upgrade", { upgrade: "workshop" })).isError, true, "no materials");
	edit(z, (s) => (s.group!.base!.stock.materials = 6));
	const r = await call(z, "build_upgrade", { upgrade: "workshop" });
	assert.match(r.text, /ready in 8 h/);
	let s = m.loadState(z);
	assert.equal(s.group!.base!.stock.materials, 2);
	assert.deepEqual(s.group!.base!.building!.map((x) => x.upgrade), ["workshop"]);
	assert.equal((await call(z, "build_upgrade", { upgrade: "workshop" })).isError, true, "already building");
	// 7 h later: not yet; 8 h: done.
	edit(z, (st) => (st.time.hour = 19));
	await call(z, "make_noise", { amount: 0, reason: "tick" });
	assert.equal(m.loadState(z).group!.base!.upgrades.length, 0);
	edit(z, (st) => (st.time.hour = 20));
	const t = await call(z, "make_noise", { amount: 0, reason: "tick" });
	assert.match(t.text, /workshop at the pharmacy is finished/);
	s = m.loadState(z);
	assert.deepEqual(s.group!.base!.upgrades, ["workshop"]);
	assert.equal(s.group!.base!.building!.length, 0);
	edit(z, (st) => st.character.inventory.push(item("z-planks", "Planks", 2)));
	await call(z, "stash", { items: [{ ref: "z-planks" }] });
	assert.equal(m.loadState(z).group!.base!.stock.materials, 2 + 3);
	// Every upgrade has a cost in materials and a build time.
	for (const u of m.base.BASE_UPGRADES) {
		assert.ok((m.base.UPGRADES[u].cost.materials ?? 0) > 0, u);
		assert.ok(m.base.UPGRADES[u].hours > 0, u);
	}
	assert.deepEqual(m.base.UPGRADES.generator.cost, { materials: 3, fuel: 5 });
	assert.deepEqual(m.base.UPGRADES.infirmary.cost, { materials: 3, meds: 2 });
});

// ─── fortification ──────────────────────────────────────────────────────

test("fortification: barricade HP on the base map + structure + upgrades, 0..10", async () => {
	const z = await atBase();
	edit(z, (s) => s.character.inventory.push(item("z-planks", "Planks", 3), item("z-nails", "Box of Nails", 3)));
	for (const x of [3, 4, 5]) assert.notEqual((await call(z, "build_barricade", { x, y: 1, material: "planks" })).isError, true);
	let s = m.loadState(z);
	assert.equal(s.group!.base!.fortification, 3, "three plank barricades");
	await call(z, "damage_barricade", { x: 3, y: 1, amount: 20 });
	s = m.loadState(z);
	assert.equal(s.group!.base!.fortification, 2, "a battered barricade counts less");
	const b = s.group!.base!;
	b.upgrades = ["watchtower", "alarm_cans", "generator"];
	b.generatorOn = true;
	b.structure = 3;
	assert.equal(m.base.fortificationOf(s, b), 8);
	b.generatorOn = false;
	assert.equal(m.base.fortificationOf(s, b), 7);
	s.maps[b.mapId!].barricades = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${i},0`, { hp: 40, max: 40 }]));
	b.generatorOn = true;
	assert.equal(m.base.fortificationOf(s, b), 10, "capped at 10");
});

// ─── production ─────────────────────────────────────────────────────────

test("08:00 production: rain catcher (+4 in rain), garden after 7 days, generator fuel", async () => {
	const z = await atBase({ day: 3, hour: 7 });
	edit(z, (s) => {
		const b = s.group!.base!;
		b.upgrades = ["rain_catcher", "garden", "generator"];
		b.completedAt = { garden: 2 * 1440 };
		b.stock.fuel = 1;
		b.lastTick = s.survival!.lastTick;
		s.scene.weather = "rain";
	});
	const s = m.loadState(z);
	s.time = { day: 3, hour: 9, minute: 0 };
	const note = m.survival.tick(s, undefined) ?? "";
	const b = s.group!.base!;
	assert.match(note, /BASE the pharmacy, day 3 08:00: water \+4, fuel -1 \(generator\)/);
	assert.equal(b.stock.water, 4);
	assert.equal(b.stock.food, 0, "the garden isn't 7 days old yet");
	assert.equal(b.generatorOn, true);
	// Four more days: garden bears from day 9, the generator runs dry.
	s.scene.weather = "clear";
	s.time = { day: 9, hour: 9, minute: 0 };
	const n2 = m.survival.tick(s, undefined) ?? "";
	assert.equal(b.stock.water, 4 + 2 * 6);
	assert.equal(b.stock.food, 1, "day 9 = 7 days after the garden was done");
	assert.equal(b.stock.fuel, 0);
	assert.equal(b.generatorOn, false);
	assert.match(n2, /generator at the pharmacy ran dry/);
	assert.equal(b.log.filter((l) => l.kind === "production").length, 7);
	assert.ok(b.log.every((l) => l.text.startsWith("Day ")));
});

// ─── events ─────────────────────────────────────────────────────────────

test("base event roll: deterministic for a seed; chance from day, noise, stock and fortification", async () => {
	const z = await atBase({ day: 8 });
	const s = m.loadState(z);
	const b = s.group!.base!;
	const quiet = m.base.baseEventChance(s, b);
	assert.equal(quiet, 10 + 14);
	b.stock.food = 30;
	b.stock.water = 30;
	assert.equal(m.base.baseEventChance(s, b), 10 + 14 + 10, "supplies draw raiders");
	s.survival!.noise.level = 5;
	assert.equal(m.base.baseEventChance(s, b), 10 + 14 + 10 + 20);
	b.structure = 3;
	assert.equal(m.base.baseEventChance(s, b), 10 + 14 + 10 + 20 - 9);

	const run = (seed: number) => {
		const c = structuredClone(s);
		const ev = m.base.rollBaseEvent(c, new Rng(seed));
		return { ev, base: c.group!.base! };
	};
	const a = run(7), a2 = run(7);
	assert.deepEqual(a.ev, a2.ev, "same seed, same event");
	// Over many seeds every applicable kind shows up, each with a DM instruction and a log line.
	const kinds = new Set<string>();
	for (let seed = 1; seed < 400; seed++) {
		const { ev, base } = run(seed);
		assert.ok(ev.roll >= 1 && ev.roll <= 100);
		if (!ev.kind) {
			assert.ok(ev.roll > ev.chance);
			continue;
		}
		kinds.add(ev.kind);
		assert.match(ev.text, /^BASE EVENT at the pharmacy/);
		assert.equal(base.log.at(-1)!.kind, `event.${ev.kind}`);
		if (ev.kind === "horde_probe") assert.match(ev.text, /z-(shambler|fresh-turned|crawler|runner|bloater|screamer|riot-dead|brute)/);
		if (ev.kind === "raiders") assert.match(ev.text, /z-raider-thug/);
	}
	assert.deepEqual([...kinds].sort(), ["horde_probe", "raiders", "sickness", "spoiled", "stranger"], "no 'leaving' without survivors at the base");
	// Sickness with meds spends one; spoiled loses stock (never below 0).
	for (let seed = 1; seed < 400; seed++) {
		const c = structuredClone(s);
		c.group!.base!.stock.meds = 2;
		const ev = m.base.rollBaseEvent(c, new Rng(seed));
		if (ev.kind === "sickness") {
			assert.equal(c.group!.base!.stock.meds, 1);
			break;
		}
	}
	// Leaving needs survivors at the base.
	const c = structuredClone(s);
	c.group!.survivors.sam = { npcId: "sam", profession: "rogue", level: 1, hp: 8, maxHp: 8, morale: 1, status: "at_base", skills: [], specialty: "", traits: [], joinedAt: 0, gear: [], missedDays: 0 };
	let left = false;
	for (let seed = 1; seed < 200 && !left; seed++) left = m.base.rollBaseEvent(structuredClone(c), new Rng(seed)).kind === "leaving";
	assert.ok(left);
});

test("the daily tick rolls one event at most (latest 08:00) and only with an rng", async () => {
	const z = await atBase({ day: 20, hour: 7 });
	const s = m.loadState(z);
	s.group!.base!.stock = { food: 60, water: 60, meds: 0, ammo: 0, fuel: 0, materials: 0 };
	s.time = { day: 25, hour: 9, minute: 0 };
	const c = structuredClone(s);
	m.survival.tick(c, undefined);
	assert.equal(c.group!.base!.log.filter((l) => l.kind?.startsWith("event.")).length, 0);
	let events = 0;
	for (let seed = 1; seed < 40; seed++) {
		const d = structuredClone(s);
		m.survival.tick(d, new Rng(seed));
		const n = d.group!.base!.log.filter((l) => l.kind?.startsWith("event.")).length;
		assert.ok(n <= 1);
		events += n;
	}
	assert.ok(events > 10, "a big stock on day 24 draws trouble often");
});

// ─── rest at the base ───────────────────────────────────────────────────

test("long rest at the base: secured automatically at fortification 3+; infirmary eases exhaustion", async () => {
	const z = await atBase({ hour: 22 });
	// Fortification 0: secured must be passed.
	assert.equal((await call(z, "long_rest", {})).isError, true);
	edit(z, (s) => {
		const b = s.group!.base!;
		b.structure = 3;
		b.upgrades = ["infirmary"];
		b.stock.meds = 2;
		s.character.exhaustion = 2;
		s.survival!.noise.level = 0;
		s.survival!.needs.lastMeal = s.survival!.needs.lastDrink = 3 * 1440 + 20 * 60;
	});
	let ok = false;
	for (let i = 0; i < 6 && !ok; i++) {
		edit(z, (s) => {
			s.time = { day: 3, hour: 22, minute: 0 };
			s.survival!.lastTick = 3 * 1440 + 22 * 60;
			s.group!.base!.lastTick = s.survival!.lastTick;
			s.character.exhaustion = 2;
			s.rng = 1000 + i;
		});
		const r = await call(z, "long_rest", {});
		assert.notEqual(r.isError, true, r.text);
		if (/INTERRUPTED/.test(r.text)) {
			assert.match(r.text, /\(5% chance\)/, "the secured odds");
			continue;
		}
		ok = true;
		assert.match(r.text, /at the base, fortification 3\/10: secured/);
		assert.match(r.text, /infirmary/);
		const s = m.loadState(z);
		assert.equal(s.character.exhaustion, 0, "-1 from the rest, -1 from the infirmary's meds");
		assert.equal(s.group!.base!.stock.meds, 1);
	}
	assert.ok(ok);
	// Away from the base: no automatic secured.
	edit(z, (s) => (s.world.currentLocationId = s.world.locations.find((l) => l.id !== s.group!.base!.locationId)!.id));
	assert.equal((await call(z, "long_rest", {})).isError, true);
});

// ─── i18n ───────────────────────────────────────────────────────────────

test("i18n: every upgrade, stock kind and event has EN and ES strings", () => {
	const keys = [
		...m.base.BASE_UPGRADES.flatMap((u) => [`base.upgrade.${u}`, `base.upgradeInfo.${u}`]),
		...m.base.STOCK_KINDS.map((k) => `base.stock.${k}`),
		...m.base.BASE_EVENTS.flatMap((k) => [`base.event.${k}`, `base.log.event.${k}`]),
	];
	for (const k of keys) {
		assert.ok((m.en as Record<string, string>)[k], `en ${k}`);
		assert.ok((m.es as Record<string, string>)[k], `es ${k}`);
	}
});
