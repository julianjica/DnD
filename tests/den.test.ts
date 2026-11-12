import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Abilities, DenUpgradeId, GameState, RollRecord } from "../lib/game/types";
import {
	buyUpgrade,
	coolingBonus,
	DEN_UPGRADE_IDS,
	DEN_UPGRADES,
	denDigest,
	denFoundModifier,
	denOf,
	denTick,
	initDen,
	levelOf,
	nextPrice,
	payRent,
	programCost,
	programDays,
	repossess,
	START_RENT,
	WEEK,
	DAY,
	writeProgram,
} from "../lib/rules/den";
import { syncRamSlots, deckProgramNumbers } from "../lib/rules/deck";
import { jackIn, type NetNodeInput } from "../lib/rules/netrun";
import { spellSaveDc } from "../lib/rules/character";
import { Rng } from "../lib/rules/dice";
import { gameMinutes } from "../lib/rules/survival";
import { getEquipment, spellsForClass } from "../lib/srd";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-den-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	digest: typeof import("../lib/dm/digest");
	route: typeof import("../app/api/campaigns/[id]/den/route");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		digest: await import("../lib/dm/digest"),
		route: await import("../app/api/campaigns/[id]/den/route"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const arr = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities => ({ str, dex, con, int, wis, cha });
const STD = { method: "standard_array" as const, scores: arr(10, 13, 14, 15, 12, 8) };

function newGame(preset: string, classId: string, speciesId = "c-origin-barrio-kid"): string {
	const settings = m.defaultSettings();
	settings.world.preset = preset as never;
	return m.createGame({ settings, seed: 11, character: { name: "Vale", speciesId, classId, backgroundId: "criminal", abilities: STD } }).id;
}
const cyberGame = (classId = "wizard") => newGame("marea_burned", classId);
const cyberState = (classId = "wizard") => m.loadState(cyberGame(classId));

function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}
async function call(id: string, name: string, args: Record<string, unknown>, rolls: RollRecord[] = []) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}
const now = (s: GameState) => gameMinutes(s.time);
/** Moves the clock forward by `minutes` (no ticks: call denTick yourself). */
function pass(s: GameState, minutes: number): void {
	const t = now(s) + minutes;
	s.time = { day: Math.floor(t / DAY), hour: Math.floor((t % DAY) / 60), minute: t % 60 };
}
/** An Rng whose d-anything always comes up 1 (or always max). */
const fixedRng = (low: boolean) => ({ int: (lo: number, hi: number) => (low ? lo : hi) }) as unknown as Rng;
const NODES: NetNodeInput[] = [{ kind: "entry", name: "Router" }, { kind: "data", name: "Files", holds: "x" }, { kind: "admin", name: "Root" }];

// ─── the den itself ─────────────────────────────────────────────────────────

test("the Burned opening starts in the capsule room: 200 a week to La Tía, first rent in a week", () => {
	const s = cyberState();
	const den = s.cyber!.den!;
	assert.ok(den);
	assert.equal(den.locationId, "loc-ma-den");
	assert.equal(den.locationId, s.world.currentLocationId);
	assert.match(den.name, /Capsule Room/);
	assert.equal(den.rent, START_RENT);
	assert.equal(den.rent, 200);
	assert.equal(den.debt, 0);
	assert.deepEqual(den.upgrades, {});
	assert.equal(den.rentDueAt, now(s) + WEEK);
	assert.equal(den.moves, 0);
	assert.deepEqual(den.raids, []);
});

test("older cyber saves get the den lazily (tools and the tick)", async () => {
	const id = cyberGame();
	edit(id, (s) => void delete s.cyber!.den);
	const r = await call(id, "den_status", {});
	assert.ok(!r.isError, r.text);
	assert.match(r.text, /DEN: The Capsule Room/);
	assert.ok(m.loadState(id).cyber!.den);
	const s = m.loadState(id);
	delete s.cyber!.den;
	denTick(s, new Rng(1));
	assert.ok(s.cyber!.den);
});

test("fantasy and zombie campaigns get no den, gigs or Den tab line", () => {
	for (const [preset, cls, sp] of [["classic_high_fantasy", "wizard", "human"], ["zombie_outbreak", "fighter", "z-origin-streetwise"]] as const) {
		const id = newGame(preset, cls, sp);
		const s = m.loadState(id);
		assert.equal(s.cyber?.den, undefined, preset);
		assert.equal(denTick(s, new Rng(1)), undefined);
		assert.equal(s.cyber?.den, undefined);
		assert.doesNotMatch(m.digest.stateDigest(s), /Den:|Gigs/);
	}
});

// ─── catalogue and buying ───────────────────────────────────────────────────

test("catalogue: every upgrade priced in cred, against the gear list and the rent", () => {
	assert.equal(DEN_UPGRADE_IDS.length, 13);
	for (const id of DEN_UPGRADE_IDS) {
		const d = DEN_UPGRADES[id];
		assert.equal(d.id, id);
		assert.ok(d.prices.length >= 1 && d.prices.length <= 3, id);
		for (let i = 0; i < d.prices.length; i++) {
			assert.ok(d.prices[i] >= 3 * START_RENT, `${id} at least a few weeks of rent`);
			assert.ok(d.prices[i] <= 10000, `${id} below top chrome`);
			if (i) assert.ok(d.prices[i] > d.prices[i - 1], `${id} levels get dearer`);
		}
		assert.ok(d.effect.length > 10);
	}
	assert.equal(DEN_UPGRADES.ram_rack.prices.length, 3);
	// One RAM slot from the rack is cheaper than the RAM expansion implant (5000) at level 1.
	assert.ok(DEN_UPGRADES.ram_rack.prices[0] < getEquipment("c-ram-expansion")!.cost!.qty);
	assert.ok(DEN_UPGRADES.workbench.prices[0] < getEquipment("c-deck-tier1")!.cost!.qty);
	// Botnet ≈ rent/5 a day; the render farm about half, clean.
	assert.equal(DEN_UPGRADES.botnet.income, START_RENT / 5);
	assert.equal(DEN_UPGRADES.render_farm.income, DEN_UPGRADES.botnet.income! / 2);
	assert.equal(DEN_UPGRADES.botnet.excludes, "render_farm");
	assert.equal(DEN_UPGRADES.render_farm.excludes, "botnet");
	for (const id of ["steel_door", "cameras", "turret", "hidden_exit", "faraday_mesh", "sleep_pod", "med_bay"] as DenUpgradeId[]) assert.equal(DEN_UPGRADES[id].fixed, true, id);
});

test("buying: needs the cred, charges it, levels one at a time, stops at the top", () => {
	const s = cyberState();
	s.character.currency.gp = 1000;
	assert.equal(buyUpgrade(s, "ram_rack").ok, false);
	assert.equal(s.character.currency.gp, 1000);
	s.character.currency.gp = 20000;
	const r1 = buyUpgrade(s, "ram_rack");
	assert.ok(r1.ok, r1.text);
	assert.equal(r1.price, 1200);
	assert.equal(s.character.currency.gp, 18800);
	assert.equal(levelOf(s.cyber!.den, "ram_rack"), 1);
	assert.equal(nextPrice(s.cyber!.den, "ram_rack"), 3000);
	assert.ok(buyUpgrade(s, "ram_rack").ok);
	assert.ok(buyUpgrade(s, "ram_rack").ok);
	assert.equal(levelOf(s.cyber!.den, "ram_rack"), 3);
	const top = buyUpgrade(s, "ram_rack");
	assert.equal(top.ok, false);
	assert.match(top.text, /top level/);
	assert.equal(s.character.currency.gp, 20000 - 1200 - 3000 - 6000);
	assert.match(s.cyber!.den!.log.join("\n"), /installed RAM rack 3/);
	assert.equal(buyUpgrade(s, "nope" as DenUpgradeId).ok, false);
});

test("botnet and render farm exclude each other", () => {
	const s = cyberState();
	s.character.currency.gp = 10000;
	assert.ok(buyUpgrade(s, "botnet").ok);
	const r = buyUpgrade(s, "render_farm");
	assert.equal(r.ok, false);
	assert.match(r.text, /one or the other/);
	const t = cyberState();
	t.character.currency.gp = 10000;
	assert.ok(buyUpgrade(t, "render_farm").ok);
	assert.equal(buyUpgrade(t, "botnet").ok, false);
});

// ─── effects ────────────────────────────────────────────────────────────────

test("RAM rack: +1 RAM slot per level for programmers, nothing for a Solo", () => {
	const s = cyberState("wizard");
	syncRamSlots(s);
	const base = s.character.spellcasting!.slots[0];
	s.cyber!.den!.upgrades.ram_rack = 2;
	syncRamSlots(s);
	assert.equal(s.character.spellcasting!.slots[0], base + 2);
	s.cyber!.den!.upgrades.ram_rack = 1;
	syncRamSlots(s);
	assert.equal(s.character.spellcasting!.slots[0], base + 1);
	const solo = cyberState("fighter");
	solo.cyber!.den!.upgrades.ram_rack = 3;
	syncRamSlots(solo);
	assert.equal(solo.character.spellcasting?.slots.some(Boolean) ?? false, false);
});

test("proxy chain: a run from the den starts with proxy 2; from anywhere else, none", () => {
	const s = cyberState("wizard");
	s.cyber!.den!.upgrades.proxy_chain = 1;
	jackIn(s, { target: "Café", security: 1, body: "den", nodes: NODES }, new Rng(3));
	assert.equal(s.cyber!.run!.proxy, 2);
	const p = cyberState("wizard");
	p.cyber!.den!.upgrades.proxy_chain = 1;
	jackIn(p, { target: "Café", security: 1, body: "public", nodes: NODES }, new Rng(3));
	assert.equal(p.cyber!.run!.proxy, 0);
	const n = cyberState("wizard");
	jackIn(n, { target: "Café", security: 1, body: "den", nodes: NODES }, new Rng(3));
	assert.equal(n.cyber!.run!.proxy, 0);
});

test("cooling: +1 to program save DCs and attacks only while jacked in", () => {
	const s = cyberState("wizard");
	syncRamSlots(s);
	const dc = spellSaveDc(s.character, "int");
	const deck = deckProgramNumbers(s.character, coolingBonus(s.cyber));
	s.cyber!.den!.upgrades.cooling = 1;
	syncRamSlots(s);
	assert.equal(spellSaveDc(s.character, "int"), dc, "no bonus outside a run");
	jackIn(s, { target: "Café", security: 1, body: "den", nodes: NODES }, new Rng(3));
	syncRamSlots(s);
	assert.equal(spellSaveDc(s.character, "int"), dc + 1);
	assert.equal(deckProgramNumbers(s.character, coolingBonus(s.cyber)).saveDc, deck.saveDc + 1);
	delete s.cyber!.run;
	syncRamSlots(s);
	assert.equal(spellSaveDc(s.character, "int"), dc);
});

test("faraday mesh: a modifier on the den-found roll for the raid engine", () => {
	const s = cyberState();
	assert.equal(denFoundModifier(s), 0);
	s.cyber!.den!.upgrades.faraday_mesh = 1;
	assert.ok(denFoundModifier(s) < 0);
	assert.equal(denFoundModifier({ cyber: undefined }), 0);
});

test("sleep pod: +1 Humanity per week slept at the den, never above the max, nothing away from home", () => {
	const s = cyberState();
	const cy = s.cyber!;
	cy.humanity = cy.humanityMax - 3;
	s.cyber!.den!.upgrades.sleep_pod = 1;
	s.character.currency.gp = 10000; // rent stays paid
	pass(s, 6 * DAY);
	denTick(s, new Rng(1));
	assert.equal(cy.humanity, cy.humanityMax - 3);
	pass(s, DAY);
	const line = denTick(s, new Rng(1));
	assert.equal(cy.humanity, cy.humanityMax - 2);
	assert.match(line ?? "", /Sleep pod/);
	// Away from the den: nothing.
	s.world.currentLocationId = "loc-ma-tianguis";
	pass(s, 14 * DAY);
	denTick(s, new Rng(1));
	assert.equal(cy.humanity, cy.humanityMax - 2);
	// Cap.
	s.world.currentLocationId = s.cyber!.den!.locationId;
	cy.humanity = cy.humanityMax;
	pass(s, 7 * DAY);
	denTick(s, new Rng(1));
	assert.equal(cy.humanity, cy.humanityMax);
	// No pod: nothing.
	const t = cyberState();
	t.cyber!.humanity = 5;
	t.character.currency.gp = 10000;
	pass(t, 14 * DAY);
	denTick(t, new Rng(1));
	assert.equal(t.cyber!.humanity, 5);
});

test("med bay: install_implant says the work can be done at home", async () => {
	const id = cyberGame();
	const plain = await call(id, "install_implant", { ref: "c-skull-comm" });
	assert.ok(!plain.isError, plain.text);
	assert.doesNotMatch(plain.text, /med bay/);
	edit(id, (s) => void (s.cyber!.den!.upgrades.med_bay = 1));
	const r = await call(id, "install_implant", { ref: "c-biomonitor" });
	assert.ok(!r.isError, r.text);
	assert.match(r.text, /med bay can do this work at home/);
});

test("botnet: +40 a day, a chance of Heat each day, the Hat drifts −1 a week", () => {
	const s = cyberState();
	const cy = s.cyber!;
	s.cyber!.den!.upgrades.botnet = 1;
	s.character.currency.gp = 0;
	cy.heat = 0;
	pass(s, 2 * DAY);
	denTick(s, fixedRng(true)); // every daily roll comes up 1: Heat each day
	assert.equal(s.character.currency.gp, 80);
	assert.equal(cy.heat, 2);
	cy.heat = 0;
	pass(s, DAY);
	denTick(s, fixedRng(false));
	assert.equal(cy.heat, 0, "unlucky dice: no Heat");
	assert.equal(s.character.currency.gp, 120);
	// A week passes: the rent (200) is collected and the Hat slides.
	s.character.currency.gp = 1000;
	const hat = cy.hat;
	pass(s, 4 * DAY);
	const line = denTick(s, fixedRng(false));
	assert.equal(cy.hat, hat - 1);
	assert.match(line ?? "", /botnet/);
	assert.equal(s.character.currency.gp, 1000 + 4 * 40 - 200);
});

test("render farm: +20 a day, clean (no Heat, no Hat)", () => {
	const s = cyberState();
	const cy = s.cyber!;
	s.cyber!.den!.upgrades.render_farm = 1;
	s.character.currency.gp = 1000;
	cy.heat = 0;
	const hat = cy.hat;
	pass(s, 7 * DAY);
	denTick(s, fixedRng(true));
	assert.equal(cy.heat, 0);
	assert.equal(cy.hat, hat);
	assert.equal(s.character.currency.gp, 1000 + 7 * 20 - 200);
});

// ─── rent, debt, repossession ───────────────────────────────────────────────

test("rent: collected from cred when due; unpaid rent becomes debt", () => {
	const s = cyberState();
	const den = s.cyber!.den!;
	s.character.currency.gp = 250;
	pass(s, WEEK - 60);
	assert.equal(denTick(s, new Rng(1)), undefined);
	pass(s, 60);
	const line = denTick(s, new Rng(1));
	assert.match(line ?? "", /La Tía collected 200/);
	assert.equal(s.character.currency.gp, 50);
	assert.equal(den.debt, 0);
	pass(s, WEEK);
	assert.match(denTick(s, new Rng(1)) ?? "", /couldn't pay/);
	assert.equal(den.debt, 200);
	assert.equal(s.character.currency.gp, 50, "she doesn't take a partial payment");
});

test("pay_rent: the debt first, then weeks ahead", () => {
	const s = cyberState();
	const den = s.cyber!.den!;
	den.debt = 300;
	s.character.currency.gp = 600;
	const due = den.rentDueAt;
	const r = payRent(s, 550);
	assert.ok(r.ok, r.text);
	assert.equal(den.debt, 0);
	assert.equal(den.rentDueAt, due + WEEK);
	assert.equal(r.paid, 500);
	assert.equal(s.character.currency.gp, 100);
	assert.equal(payRent(s, 5000).ok, false);
});

test("deep debt: La Tía repossesses the most expensive upgrade when rent comes due (logged)", () => {
	const s = cyberState();
	const den = s.cyber!.den!;
	den.upgrades = { cameras: 1, med_bay: 1, ram_rack: 2 };
	den.debt = 4 * den.rent; // exactly 4 weeks: not yet
	s.character.currency.gp = 0;
	pass(s, WEEK);
	const line = denTick(s, new Rng(1)) ?? "";
	assert.equal(levelOf(den, "med_bay"), 0, "the med bay (4000) went");
	assert.equal(levelOf(den, "ram_rack"), 2);
	assert.match(line, /repossessed/);
	assert.match(den.log.join("\n"), /La Tía repossessed the Med bay/);
	assert.equal(den.debt, 0, "half the med bay (2000) clears the 1000 owed");
	// Below the line: nothing more.
	pass(s, WEEK);
	denTick(s, new Rng(1));
	assert.equal(levelOf(den, "ram_rack"), 2);
	// repossess() on its own takes one level of the dearest.
	den.upgrades = { ram_rack: 3, cameras: 1 };
	repossess(s);
	assert.equal(levelOf(den, "ram_rack"), 2);
	den.upgrades = {};
	assert.equal(repossess(s), undefined);
});

// ─── the workbench ──────────────────────────────────────────────────────────

const firstUnknown = (s: GameState, classId: string, level: number) => {
	const e = s.character.spellcasting!.classes.find((x) => x.classId === classId)!;
	return spellsForClass(classId, { level, ruleset: "cyberpunk" }).find((p) => !e.known.includes(p.index) && !e.prepared.includes(p.index))!.index;
};

test("write_program: needs the workbench and the cred; a Netrunner's codebook gets it after level × 2 days", () => {
	const s = cyberState("wizard");
	const prog = firstUnknown(s, "wizard", 1);
	s.character.currency.gp = 1000;
	assert.match(writeProgram(s, prog).text, /no workbench/);
	s.cyber!.den!.upgrades.workbench = 1;
	assert.equal(programCost(1), 100);
	assert.equal(programCost(3), 900);
	assert.equal(programDays(2), 4);
	const r = writeProgram(s, prog);
	assert.ok(r.ok, r.text);
	assert.equal(s.character.currency.gp, 900);
	assert.equal(s.cyber!.den!.writing!.program, prog);
	assert.match(writeProgram(s, prog).text, /one program at a time/);
	pass(s, DAY);
	denTick(s, new Rng(1));
	assert.ok(s.cyber!.den!.writing, "not yet");
	pass(s, DAY);
	const line = denTick(s, new Rng(1)) ?? "";
	assert.match(line, /written and compiled/);
	assert.equal(s.cyber!.den!.writing, undefined);
	const e = s.character.spellcasting!.classes.find((x) => x.classId === "wizard")!;
	assert.ok(e.known.includes(prog));
	assert.match(writeProgram(s, prog).text, /already has/);
});

test("write_program: limits (level they can run, their list, no routines, loaders don't need it)", () => {
	const s = cyberState("wizard");
	s.cyber!.den!.upgrades.workbench = 1;
	s.character.currency.gp = 100000;
	assert.match(writeProgram(s, firstUnknown(s, "wizard", 2)).text, /only run up to level 1/);
	assert.match(writeProgram(s, "p-sledgehammer").text, /routine/);
	assert.match(writeProgram(s, "p-stitch-up").text, /isn't on/);
	assert.match(writeProgram(s, "no-such-program").text, /not a known program/);
	const doc = cyberState("cleric");
	doc.cyber!.den!.upgrades.workbench = 1;
	doc.character.currency.gp = 1000;
	assert.match(writeProgram(doc, "p-stitch-up").text, /already on/);
	const solo = cyberState("fighter");
	solo.cyber!.den!.upgrades.workbench = 1;
	solo.character.currency.gp = 1000;
	assert.match(writeProgram(solo, "p-ghost").text, /doesn't run programs/);
	const poor = cyberState("wizard");
	poor.cyber!.den!.upgrades.workbench = 1;
	poor.character.currency.gp = 10;
	assert.match(writeProgram(poor, firstUnknown(poor, "wizard", 1)).text, /costs 100/);
});

test("write_program for a Social Engineer: added to their programs, outside the known count", () => {
	const s = cyberState("bard");
	s.cyber!.den!.upgrades.workbench = 1;
	s.character.currency.gp = 500;
	const prog = firstUnknown(s, "bard", 1);
	assert.ok(writeProgram(s, prog).ok);
	pass(s, 2 * DAY);
	denTick(s, new Rng(1));
	const e = s.character.spellcasting!.classes.find((x) => x.classId === "bard")!;
	assert.ok(e.known.includes(prog));
	assert.ok(e.prepared.includes(prog));
	assert.ok(s.character.features.some((f) => f.id === `written-program:${prog}`));
});

// ─── tools, digest, API ─────────────────────────────────────────────────────

test("den tools are always listed and refuse outside cyberpunk", async () => {
	const id = newGame("classic_high_fantasy", "wizard", "human");
	const names = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).map((t) => t.name);
	for (const n of ["den_status", "buy_upgrade", "pay_rent", "write_program", "offer_gig", "take_gig", "complete_gig"]) assert.ok(names.includes(n), n);
	for (const [name, args] of [
		["den_status", {}],
		["buy_upgrade", { upgrade: "cooling" }],
		["pay_rent", { amount: 10 }],
		["write_program", { program: "p-ghost" }],
		["offer_gig", { title: "x", client: "y", kind: "heist", pay: 1, hat: 0, heat: 0, risk: 1, brief: "", days: 1 }],
		["take_gig", { gig: "x" }],
		["complete_gig", { gig: "x", outcome: "done", why: "" }],
	] as const) {
		const r = await call(id, name, args);
		assert.ok(r.isError, name);
		assert.match(r.text, /only exists in Root Access/);
	}
	assert.equal(m.loadState(id).cyber, undefined);
});

test("den tools in a cyberpunk campaign; the digest shows the den", async () => {
	const id = cyberGame();
	edit(id, (s) => void (s.character.currency.gp = 5000));
	const b = await call(id, "buy_upgrade", { upgrade: "workbench" });
	assert.ok(!b.isError, b.text);
	assert.match(b.text, /Installed Workbench/);
	assert.ok(!(await call(id, "buy_upgrade", { upgrade: "turret" })).isError);
	assert.ok((await call(id, "buy_upgrade", { upgrade: "med_bay" })).isError, "500 left: can't afford 4000");
	const st = await call(id, "den_status", {});
	assert.match(st.text, /Workbench/);
	assert.match(st.text, /For sale/);
	const pr = await call(id, "pay_rent", { amount: 200 });
	assert.ok(!pr.isError, pr.text);
	const s = m.loadState(id);
	assert.equal(s.character.currency.gp, 5000 - 1000 - 3500 - 200);
	const d = denDigest(s)!;
	assert.match(d, /Den: The Capsule Room \(here\)/);
	assert.match(d, /upgrades: Turret, Workbench|upgrades: Workbench, Turret|Turret.*Workbench|Workbench.*Turret/);
	assert.match(m.digest.stateDigest(s), /Den: The Capsule Room/);
});

test("the Den tab's API: buy and pay, validated on the server", async () => {
	const id = cyberGame();
	edit(id, (s) => void (s.character.currency.gp = 1500));
	const post = (body: unknown) => m.route.POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) });
	let res = await post({ op: "buy", upgrade: "cooling" });
	assert.equal(res.status, 200);
	const data = (await res.json()) as { state: GameState; text: string };
	assert.equal(data.state.cyber!.den!.upgrades.cooling, 1);
	assert.equal(data.state.character.currency.gp, 500);
	res = await post({ op: "buy", upgrade: "turret" });
	assert.equal(res.status, 400);
	assert.match(((await res.json()) as { error: string }).error, /costs 3500/);
	res = await post({ op: "buy", upgrade: "jacuzzi" });
	assert.equal(res.status, 400);
	res = await post({ op: "pay", amount: 200 });
	assert.equal(res.status, 200);
	assert.equal(m.loadState(id).character.currency.gp, 300);
	res = await post({ op: "steal" });
	assert.equal(res.status, 400);
	// Not in a fantasy campaign.
	const f = newGame("classic_high_fantasy", "wizard", "human");
	const fr = await m.route.POST(new Request("http://x/api", { method: "POST", body: JSON.stringify({ op: "buy", upgrade: "cooling" }) }) as never, { params: Promise.resolve({ id: f }) });
	assert.equal(fr.status, 400);
	assert.equal(m.loadState(f).cyber, undefined);
});

test("initDen falls back to wherever the PC is when the map has no den", () => {
	const s = cyberState();
	s.world.locations = s.world.locations.filter((l) => !l.id.endsWith("-den"));
	s.world.currentLocationId = "loc-ma-anegados";
	const den = initDen(s, 0);
	assert.equal(den.locationId, "loc-ma-anegados");
	assert.equal(den.rentDueAt, WEEK);
	assert.ok(denOf(s));
});
