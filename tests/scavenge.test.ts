import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import loot from "../lib/srd/data/zombie/loot.json";
import { getEquipment } from "../lib/srd";
import { Rng } from "../lib/rules/dice";
import { depletion, foodFactor, lootTable, PLACE_TYPES, scavenge, type ScavengeArgs } from "../lib/rules/scavenge";
import { survivalOf } from "../lib/rules/survival";
import type { GameState, RollRecord } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-scavenge-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { int: 15, con: 14, dex: 13, wis: 12, str: 10, cha: 8 } };

function newGame(zombie: boolean) {
	const settings = m.defaultSettings();
	if (zombie) settings.world.preset = "zombie_outbreak";
	return m.createGame({ settings, character: { name: "Dana", speciesId: "human", classId: "wizard", backgroundId: "sage", abilities: STD } }).id;
}

async function call(id: string, name: string, args: Record<string, unknown>, rolls: RollRecord[] = []) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

const minutes = (s: GameState) => s.time.day * 1440 + s.time.hour * 60 + (s.time.minute ?? 0);

test("loot tables: every place has one and every ref is modern equipment", () => {
	const places = loot.places as Record<string, { nothing: number; junk: number; danger: number; items: { ref: string; w: number; qty: number[] }[] }>;
	assert.deepEqual(Object.keys(places).sort(), [...PLACE_TYPES].sort());
	for (const [place, t] of Object.entries(places)) {
		assert.ok(t.nothing > 0 && t.junk > 0 && t.danger >= 0 && t.danger < 1, place);
		assert.ok(t.items.length >= 5, place);
		for (const e of t.items) {
			const eq = getEquipment(e.ref);
			assert.ok(eq, `${place}: ${e.ref} missing from equipment.json`);
			assert.equal((eq as { ruleset?: string }).ruleset, "zombie", e.ref);
			assert.ok(e.w > 0 && e.qty[0] >= 1 && e.qty[0] <= e.qty[1], `${place}: ${e.ref}`);
		}
	}
	// Guns are rare outside police/military; medicine is concentrated in pharmacy/hospital.
	const weight = (place: string, pred: (ref: string) => boolean) => {
		const t = lootTable(place)!;
		return t.items.filter((e) => pred(e.ref)).reduce((n, e) => n + e.w, 0) / (t.items.reduce((n, e) => n + e.w, 0) + t.nothing + t.junk);
	};
	const gun = (ref: string) => getEquipment(ref)?.category === "weapon" && !!(getEquipment(ref) as { weapon?: { ranged?: boolean } }).weapon?.ranged;
	for (const p of ["house", "grocery", "school", "office", "church", "restaurant"]) assert.ok(weight(p, gun) < weight("police", gun) / 4, p);
	const meds = (ref: string) => ["z-antibiotics", "z-medkit", "z-painkillers", "z-bandage"].includes(ref);
	for (const p of ["house", "grocery", "office", "gas_station"]) assert.ok(weight(p, meds) < weight("pharmacy", meds) / 2 && weight(p, meds) < weight("hospital", meds) / 2, p);
});

function zombieState(): GameState {
	return m.loadState(newGame(true));
}

function runMany(base: GameState, args: ScavengeArgs, n: number, tweak?: (s: GameState) => void) {
	let items = 0, food = 0, dangers = 0;
	for (let seed = 1; seed <= n; seed++) {
		const s = structuredClone(base);
		tweak?.(s);
		const r = scavenge(s, new Rng(seed * 7919), args);
		items += r.found.length;
		food += r.found.filter((f) => f.ref === "z-canned-food" || f.ref === "z-bottled-water").length;
		if (r.danger) dangers++;
	}
	return { items, food, dangers };
}

test("depletion: each search of the same place yields less; after ~3 it is mostly empty", () => {
	assert.equal(depletion(0), 1);
	assert.ok(depletion(1) > depletion(2) && depletion(2) > depletion(3));
	assert.ok(depletion(3) <= 0.1 && depletion(4) === 0);
	const base = zombieState();
	const key = `${base.world.currentLocationId}|grocery`;
	const fresh = runMany(base, { place: "grocery", thoroughness: "thorough" }, 150);
	const twice = runMany(base, { place: "grocery", thoroughness: "thorough" }, 150, (s) => (survivalOf(s).looted[key] = 2));
	const gone = runMany(base, { place: "grocery", thoroughness: "thorough" }, 60, (s) => (survivalOf(s).looted[key] = 4));
	assert.ok(fresh.items > twice.items * 2, `${fresh.items} vs ${twice.items}`);
	assert.equal(gone.items, 0);
});

test("food gets scarcer as outbreak days pass", () => {
	assert.ok(foodFactor(0) === 1 && foodFactor(10) < foodFactor(2) && foodFactor(60) > 0);
	const base = zombieState();
	const early = runMany(base, { place: "grocery", thoroughness: "careful" }, 200);
	const late = runMany(base, { place: "grocery", thoroughness: "careful" }, 200, (s) => (s.time.day = 31));
	assert.ok(early.food > late.food * 2, `${early.food} vs ${late.food}`);
});

test("thorough searches of dangerous places can wake something; quick ones never do", () => {
	const base = zombieState();
	const night = (s: GameState) => (s.time.hour = 23);
	assert.equal(runMany(base, { place: "hospital", thoroughness: "quick" }, 100, night).dangers, 0);
	const hosp = runMany(base, { place: "hospital", thoroughness: "thorough" }, 200, night).dangers;
	const house = runMany(base, { place: "house", thoroughness: "thorough" }, 200).dangers;
	assert.ok(hosp > 40 && hosp > house * 2, `${hosp} vs ${house}`);
});

test("scavenge tool: rolls the check, advances the clock, adds noise and stacks the loot", async () => {
	const id = newGame(true);
	await call(id, "give_item", { name: "Bandage", ref: "z-bandage", quantity: 1 });
	const st = m.loadState(id);
	const args = { place: "pharmacy", thoroughness: "careful" } as const;
	// Pick a seed whose search finds something, then let the tool replay it.
	let seed = 1;
	let expect: ReturnType<typeof scavenge> | undefined;
	for (; seed < 500; seed++) {
		const r = scavenge(structuredClone(st), new Rng(seed), args);
		if (r.found.length) { expect = r; break; }
	}
	assert.ok(expect);
	st.rng = seed;
	m.saveState(st);
	const t0 = minutes(st);
	const q0 = (ref: string) => st.character.inventory.filter((i) => i.ref === ref).reduce((n, i) => n + i.quantity, 0);
	const rolls: RollRecord[] = [];
	const r = await call(id, "scavenge", args, rolls);
	assert.notEqual(r.isError, true, r.text);
	assert.match(r.text, /Careful search of the pharmacy \(30 min, search #1 here\)/);
	assert.match(r.text, /Found: /);
	const check = rolls.find((x) => x.check);
	assert.ok(check, "check in the dice log");
	assert.equal(check!.check!.skill, "investigation");
	const s = m.loadState(id);
	assert.equal(minutes(s) - t0, 30);
	assert.equal(s.survival!.noise.level, 1);
	assert.equal(s.survival!.looted[`${s.world.currentLocationId}|pharmacy`], 1);
	for (const f of expect!.found) {
		const it = s.character.inventory.find((i) => i.ref === f.ref);
		assert.ok(it, f.ref);
		assert.equal(s.character.inventory.filter((i) => i.ref === f.ref).reduce((n, i) => n + i.quantity, 0), q0(f.ref) + f.qty, f.ref);
	}
	// Stacked onto what the player already carried, not duplicated.
	for (const f of expect!.found) if (q0(f.ref)) assert.equal(s.character.inventory.filter((i) => i.ref === f.ref).length, st.character.inventory.filter((i) => i.ref === f.ref).length, f.ref);
});

test("scavenge tool: a picked-clean place has bare shelves; quick searches are quiet", async () => {
	const id = newGame(true);
	const st = m.loadState(id);
	st.survival = { lastTick: minutes(st), noise: { level: 0, locationId: st.world.currentLocationId, mapId: st.activeMapId }, amputations: [], needs: { lastMeal: minutes(st), lastDrink: minutes(st), missedMeals: 0, missedDrinks: 0 }, looted: { [`${st.world.currentLocationId}|house`]: 5 } };
	m.saveState(st);
	const inv0 = JSON.stringify(st.character.inventory);
	const rolls: RollRecord[] = [];
	const r = await call(id, "scavenge", { place: "house", thoroughness: "quick" }, rolls);
	assert.notEqual(r.isError, true, r.text);
	assert.match(r.text, /shelves are bare/);
	assert.equal(rolls.find((x) => x.check)?.check?.skill, "perception");
	const s = m.loadState(id);
	assert.equal(JSON.stringify(s.character.inventory), inv0);
	assert.equal(s.survival!.noise.level, 0);
	assert.equal(s.survival!.looted[`${s.world.currentLocationId}|house`], 6);
	assert.equal(minutes(s) - minutes(st), 10);
	assert.equal((await call(id, "scavenge", { place: "castle", thoroughness: "quick" })).isError, true);
});

test("fantasy campaigns: no scavenging", async () => {
	const id = newGame(false);
	const r = await call(id, "scavenge", { place: "house", thoroughness: "quick" });
	assert.equal(r.isError, true);
	assert.match(r.text, /Only in The Quiet/);
	assert.equal(m.loadState(id).survival, undefined);
});
