import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { CyberState, DenState, GameState, RollRecord } from "../lib/game/types";
import { addHeat, initCyberState } from "../lib/rules/cyber";
import { initDen } from "../lib/rules/den";
import { jackIn, traceTick } from "../lib/rules/netrun";
import { budgetCap } from "../lib/rules/encounter-budget";
import { gameMinutes } from "../lib/rules/survival";
import {
	endRaid,
	FIXED_UPGRADES,
	heatFactor,
	raidDefences,
	raidDigest,
	raidForce,
	RAID_COOLDOWN_MIN,
	RAID_HOURS,
	scheduleRaid,
	scheduleRaidOn,
	seizeOrder,
	TURRET,
} from "../lib/rules/raid";
import { getMonster } from "../lib/srd/index";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-raid-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	digest: typeof import("../lib/dm/digest");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		digest: await import("../lib/dm/digest"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// ─── fixtures ────────────────────────────────────────────────────────────────

const STD = { method: "standard_array" as const, scores: { str: 8, con: 14, dex: 13, wis: 12, int: 15, cha: 10 } };

function newGame(ruleset: "cyberpunk" | "fantasy" | "zombie" = "cyberpunk"): string {
	const settings = m.defaultSettings();
	if (ruleset === "cyberpunk") settings.world.preset = "marea_burned" as never;
	if (ruleset === "zombie") settings.world.preset = "zombie_outbreak" as never;
	return m.createGame({ settings, character: { name: "Vera", speciesId: "human", classId: "sorcerer", backgroundId: "criminal", abilities: STD } }).id;
}

function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

/** A bare CyberState with the starting den. */
function cyWithDen(heat = 0, hat = 0): CyberState {
	const cy = initCyberState({ abilities: { wis: 12 } } as never, 0);
	cy.heat = heat;
	cy.hat = hat;
	cy.den = { name: "The Capsule Room", locationId: "loc-den", rent: 200, rentDueAt: 7 * 1440, debt: 0, upgrades: {}, raids: [], moves: 0, lastTick: 0, log: [] };
	return cy;
}

/** A den with these upgrades. */
function denWith(upgrades: DenState["upgrades"]): DenState {
	return { name: "The Capsule Room", locationId: "loc-den", rent: 200, rentDueAt: 0, debt: 0, upgrades: { ...upgrades }, raids: [], moves: 0, lastTick: 0, log: [] };
}

// ─── triggers ────────────────────────────────────────────────────────────────

test("Heat reaching 8 schedules a Ferro raid a few hours ahead; a black hat brings a gang", () => {
	const cy = cyWithDen(7);
	const r = addHeat(cy, 1, "trace landed", 1000);
	assert.match(r.text, /RAID DUE/);
	assert.deepEqual({ by: cy.den!.raidDue!.by, at: cy.den!.raidDue!.at }, { by: "ferro", at: 1000 + RAID_HOURS.heat * 60 });
	assert.ok(cy.den!.log.some((l) => /Raid due/.test(l)));

	const black = cyWithDen(6, -6);
	addHeat(black, 3, "ransomware", 0);
	assert.equal(black.den!.raidDue!.by, "gang");

	// Below 8, nothing; staying above 8, no second one.
	const low = cyWithDen(3);
	addHeat(low, 2, "x", 0);
	assert.equal(low.den!.raidDue, undefined);
	const at = cy.den!.raidDue!.at;
	addHeat(cy, 1, "more", 1100);
	assert.equal(cy.den!.raidDue!.at, at);
});

test("Heat 10 brings bounty hunters, escalating a raid already due (sooner wins)", () => {
	const cy = cyWithDen(7);
	addHeat(cy, 1, "x", 0);
	assert.equal(cy.den!.raidDue!.by, "ferro");
	const r = addHeat(cy, 2, "y", 60);
	assert.match(r.text, /RAID ESCALATES/);
	assert.equal(cy.den!.raidDue!.by, "bounty");
	assert.equal(cy.den!.raidDue!.at, RAID_HOURS.heat * 60, "keeps the earlier hour");

	const fresh = cyWithDen(9);
	addHeat(fresh, 1, "z", 0);
	assert.deepEqual({ by: fresh.den!.raidDue!.by, at: fresh.den!.raidDue!.at }, { by: "bounty", at: RAID_HOURS.bounty * 60 });
});

test("no den: no raid scheduled; a recent raid cools the Heat-8 trigger", () => {
	const cy = initCyberState({ abilities: { wis: 12 } } as never, 0);
	cy.heat = 7;
	const r = addHeat(cy, 1, "x", 0);
	assert.equal(cy.den, undefined);
	assert.doesNotMatch(r.text, /RAID DUE/);
	assert.match(scheduleRaidOn(cy, 0, "ferro", "x").text, /no den/);

	const recent = cyWithDen(7);
	recent.den!.raids.push({ at: 0, won: true, seized: [], moved: false });
	addHeat(recent, 1, "x", RAID_COOLDOWN_MIN - 1);
	assert.equal(recent.den!.raidDue, undefined, "cooldown");
	recent.heat = 7;
	addHeat(recent, 1, "x", RAID_COOLDOWN_MIN + 1);
	assert.ok(recent.den!.raidDue, "after the cooldown");
});

test("scheduleRaid (betrayals): sets raidDue hoursAhead; a milder one doesn't replace it", () => {
	const s = { cyber: cyWithDen(2), time: { day: 1, hour: 10, minute: 0 }, character: { abilities: { wis: 12 } } } as unknown as GameState;
	const now = gameMinutes(s.time);
	const r = scheduleRaid(s, "gang", "Nico sold the den to Los Ahogados", 3);
	assert.ok(r.scheduled);
	assert.deepEqual(s.cyber!.den!.raidDue, { reason: "Nico sold the den to Los Ahogados", at: now + 180, by: "gang" });
	assert.equal(scheduleRaid(s, "ferro", "x", 1).scheduled, false);
	assert.equal(s.cyber!.den!.raidDue!.by, "gang");
	assert.equal(s.cyber!.den!.raidDue!.at, now + 60, "sooner hour kept");
	s.cyber!.den!.raidDue!.started = { at: now, force: [], mapId: "m" };
	assert.match(scheduleRaid(s, "bounty", "x").text, /already on/);
	assert.equal(s.cyber!.den!.raidDue!.by, "gang");
});

test("a dump whose den roll hits schedules a raid; the faraday mesh lowers the roll", async () => {
	const id = newGame();
	assert.ok(!(await call(id, "generate_map", { kind: "tavern", name: "The capsule room" })).isError);
	const nodes = [{ kind: "entry" as const, name: "Gate" }, { kind: "data" as const, name: "Logs" }];
	let found = false;
	for (let seed = 1; seed < 60 && !found; seed++) {
		const s = m.loadState(id);
		s.cyber!.heat = 0;
		jackIn(s, { target: "Vantis lab 7", security: 5, body: "den", nodes }, new Rng(seed));
		const list: RollRecord[] = [];
		const out = traceTick(s, 10, "full", new Rng(seed), (r) => list.push(r));
		const d = list.find((r) => r.notation === "1d20+10")!;
		assert.ok(d, "den roll");
		if (d.total >= 20) {
			found = true;
			assert.ok(out.some((l) => /DEN FOUND/.test(l) && /RAID DUE/.test(l)), out.join("\n"));
			assert.equal(s.cyber!.den!.raidDue!.by, "corp", "a Vantis trace brings corp security");
			assert.equal(s.cyber!.den!.raidDue!.at, gameMinutes(s.time) + RAID_HOURS.dump * 60);
		} else assert.equal(s.cyber!.den!.raidDue, undefined);
	}
	assert.ok(found);

	const s = m.loadState(id);
	s.cyber!.den!.upgrades.faraday_mesh = 1;
	jackIn(s, { target: "Office", security: 5, body: "den", nodes }, new Rng(1));
	const list: RollRecord[] = [];
	traceTick(s, 10, "full", new Rng(1), (r) => list.push(r));
	assert.ok(list.some((r) => r.notation === "1d20+5"), "faraday: −5");
});

// ─── the force ───────────────────────────────────────────────────────────────

test("force: under the raid budget, grows with level and Heat, faction rosters, spotter at level 1", () => {
	for (const by of ["ferro", "gang", "bounty", "corp"] as const) {
		for (const level of [3, 5, 9, 15]) {
			const f = raidForce(by, level, "normal", 8);
			assert.ok(f.adjustedXp <= f.target, `${by} L${level}: ${f.summary}`);
			assert.equal(f.target, Math.round(budgetCap(level, "normal") * heatFactor(8)));
			assert.ok(f.list.length >= 1 && f.list.length <= 8);
			for (const ix of f.list) assert.ok(getMonster(ix), ix);
		}
	}
	const ferro = (l: number, h: number) => raidForce("ferro", l, "normal", h).adjustedXp;
	assert.ok(ferro(9, 8) > ferro(3, 8), "level");
	assert.ok(ferro(9, 10) >= ferro(9, 6), "heat");
	assert.ok(raidForce("ferro", 5, "normal", 8).list.every((ix) => ix.startsWith("c-ferro") || ix === "c-security-drone"));
	assert.ok(raidForce("gang", 5, "normal", 8).list.every((ix) => ix.startsWith("c-ahogados")));
	assert.ok(raidForce("bounty", 12, "normal", 10).list.includes("c-bounty-hunter"));
	// Allies (the turret, crew) widen the budget.
	assert.ok(raidForce("ferro", 5, "normal", 8, [50]).target > raidForce("ferro", 5, "normal", 8).target);
	// Level 1: even one Ferro guard is too much; a lone spotter comes ahead.
	const l1 = raidForce("ferro", 1, "normal", 8);
	assert.deepEqual(l1.monsters, [{ monster: "c-ahogados-lookout", count: 1, name: "Ferro Informant" }]);
});

test("turret stat block: c-den-turret, an immobile construct", () => {
	const t = getMonster(TURRET)!;
	assert.ok(t);
	assert.equal(t.speed.walk, 0);
	assert.ok(t.actions.some((a) => a.attack));
});

// ─── defences ────────────────────────────────────────────────────────────────

test("defences: steel door, cameras, turret, hidden exit; surprise only with neither door nor cameras", () => {
	const none = raidDefences(denWith({}));
	assert.deepEqual([none.steelDoor, none.cameras, none.turret, none.hiddenExit, none.pcSurprised], [false, false, false, false, true]);
	assert.equal(raidDefences(denWith({ steel_door: 1 })).pcSurprised, false);
	assert.equal(raidDefences(denWith({ cameras: 1 })).pcSurprised, false);
	const all = raidDefences(denWith({ steel_door: 1, cameras: 1, turret: 1, hidden_exit: 1 }));
	assert.deepEqual([all.steelDoor, all.cameras, all.turret, all.hiddenExit], [true, true, true, true]);
	assert.equal(all.text.length, 4);
});

// ─── outcomes ────────────────────────────────────────────────────────────────

function raidState(upgrades: DenState["upgrades"], started = true): GameState {
	const s = {
		settings: { ruleset: "cyberpunk" },
		time: { day: 3, hour: 22, minute: 0 },
		character: { abilities: { wis: 12 }, inventory: [{ id: "i1", ref: "c-deck-secondhand", name: "Deck", qty: 1 }] },
		cyber: cyWithDen(8),
	} as unknown as GameState;
	const den = s.cyber!.den!;
	den.upgrades = { ...upgrades };
	den.mapId = "map-den";
	den.raidDue = { reason: "Heat 8", at: 0, by: "ferro", ...(started ? { started: { at: 0, force: ["c-ferro-guard"], mapId: "map-den" } } : {}) };
	return s;
}

test("seize order: most valuable first (all levels counted)", () => {
	const den = denWith({ cameras: 1, ram_rack: 2, med_bay: 1, workbench: 1 });
	assert.deepEqual(seizeOrder(den), ["ram_rack", "med_bay", "workbench", "cameras"], "RAM rack ×2 = 4200 > med bay 4000");
	assert.deepEqual(seizeOrder(denWith({ ram_rack: 1, med_bay: 1 }))[0], "med_bay");
});

test("won: Heat −2, nothing seized, the den stays, raid logged", () => {
	const s = raidState({ steel_door: 1, turret: 1 });
	const r = endRaid(s, new Rng(1), "won");
	assert.match(r.text, /RAID WON/);
	const den = s.cyber!.den!;
	assert.equal(s.cyber!.heat, 6);
	assert.equal(den.raidDue, undefined);
	assert.deepEqual(den.raids, [{ at: gameMinutes(s.time), won: true, seized: [], moved: false }]);
	assert.deepEqual(den.upgrades, { steel_door: 1, turret: 1 });
	assert.equal(den.moves, 0);
	assert.throws(() => endRaid(raidState({}, false), new Rng(1), "won"), /never fought/);
});

test("lost: 1–2 most valuable seized, the den moves, fixed defences left behind, rent restarts, carried gear untouched", () => {
	let seenTwo = false;
	let seenOne = false;
	for (let seed = 1; seed < 30; seed++) {
		const s = raidState({ med_bay: 1, turret: 1, ram_rack: 2, cameras: 1, workbench: 1, render_farm: 1 });
		s.cyber!.den!.writing = { program: "x", readyAt: 99999 };
		const inv = JSON.stringify(s.character.inventory);
		const now = gameMinutes(s.time);
		const r = endRaid(s, new Rng(seed), "lost", { name: "A flooded garage", locationId: "loc-garage", rent: 150 });
		const den = s.cyber!.den!;
		const order = ["ram_rack", "med_bay", "turret"];
		assert.deepEqual(r.seized, order.slice(0, r.seized.length));
		assert.ok(r.seized.length === 1 || r.seized.length === 2);
		if (r.seized.length === 2) seenTwo = true;
		else seenOne = true;
		for (const u of r.seized) assert.equal(den.upgrades[u], undefined);
		for (const u of FIXED_UPGRADES) assert.equal(den.upgrades[u], undefined, `${u} stays behind`);
		assert.equal(den.upgrades.workbench, 1, "portable upgrades move");
		assert.equal(den.upgrades.render_farm, 1);
		assert.equal(den.writing?.program, "x", "workbench kept: the program goes on");
		assert.deepEqual([den.name, den.locationId, den.rent, den.rentDueAt, den.moves, den.mapId], ["A flooded garage", "loc-garage", 150, now + 7 * 1440, 1, undefined]);
		assert.equal(den.raidDue, undefined);
		assert.deepEqual(den.raids[0], { at: now, won: false, seized: r.seized, moved: true });
		assert.equal(JSON.stringify(s.character.inventory), inv, "what the PC carries is never seized");
		assert.equal(s.cyber!.heat, 8, "no Heat change");
		assert.match(r.text, /SEIZED/);
		assert.match(r.text, /MOVES/);
	}
	assert.ok(seenOne && seenTwo, "1d2 upgrades");
	// Nothing installed: nothing seized; the rent stays if not named.
	const bare = raidState({});
	const r = endRaid(bare, new Rng(1), "lost", { name: "Somewhere" });
	assert.deepEqual(r.seized, []);
	assert.equal(bare.cyber!.den!.rent, 200);
	// Lost needs a new place; not fought is fine (the PC was away).
	assert.throws(() => endRaid(raidState({}), new Rng(1), "lost"), /name the new place/);
	assert.doesNotThrow(() => endRaid(raidState({}, false), new Rng(1), "lost", { name: "x" }));
	// A seized workbench drops the program in progress.
	const wb = raidState({ workbench: 1 });
	wb.cyber!.den!.writing = { program: "x", readyAt: 1 };
	endRaid(wb, new Rng(1), "lost", { name: "x" });
	assert.equal(wb.cyber!.den!.writing, undefined);
});

test("fled: only with the hidden exit; nothing seized, but the den moves", () => {
	assert.throws(() => endRaid(raidState({ med_bay: 1 }), new Rng(1), "fled", { name: "x" }), /No hidden exit/);
	const s = raidState({ hidden_exit: 1, ram_rack: 1, steel_door: 1 });
	const r = endRaid(s, new Rng(1), "fled", { name: "Tía's cousin's attic" });
	const den = s.cyber!.den!;
	assert.deepEqual(r.seized, []);
	assert.deepEqual(den.upgrades, { ram_rack: 1 });
	assert.deepEqual(r.lostFixed.sort(), ["hidden_exit", "steel_door"]);
	assert.equal(den.moves, 1);
	assert.deepEqual(den.raids[0].seized, []);
	assert.equal(den.raids[0].moved, true);
	assert.match(r.text, /FLED/);
});

test("digest: due (foreshadow), now (raid_begin), on (raid_end)", () => {
	const s = raidState({}, false);
	s.cyber!.den!.raidDue!.at = gameMinutes(s.time) + 300;
	assert.match(raidDigest(s)!, /RAID DUE in ~5 h/);
	s.cyber!.den!.raidDue!.at = gameMinutes(s.time);
	assert.match(raidDigest(s)!, /RAID NOW.*raid_begin/);
	s.cyber!.den!.raidDue!.started = { at: 0, force: [], mapId: "x" };
	assert.match(raidDigest(s)!, /RAID ON.*raid_end/);
	delete s.cyber!.den!.raidDue;
	assert.equal(raidDigest(s), undefined);
});

// ─── tools ───────────────────────────────────────────────────────────────────

test("raid tools are always listed and refuse outside cyberpunk; fantasy and zombie digests unchanged", async () => {
	for (const rs of ["fantasy", "zombie"] as const) {
		const id = newGame(rs);
		const names = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).map((t) => t.name);
		for (const t of ["raid_status", "raid_begin", "raid_end"]) assert.ok(names.includes(t), t);
		for (const [t, args] of [["raid_status", {}], ["raid_begin", {}], ["raid_end", { outcome: "won" }]] as const) {
			const r = await call(id, t, args);
			assert.ok(r.isError, `${rs} ${t}`);
			assert.match(r.text, /only exists in Root Access/);
		}
		const s = m.loadState(id);
		assert.equal(s.cyber, undefined);
		assert.doesNotMatch(m.digest.stateDigest(s), /RAID/);
	}
});

test("raid_begin → fight on the den map with turret, steel door and cameras; raid_end won", async () => {
	const id = newGame();
	assert.ok(!(await call(id, "generate_map", { kind: "tavern", name: "The capsule room" })).isError);
	// Nothing due yet.
	assert.match((await call(id, "raid_begin", {})).text, /No raid is due/);
	edit(id, (s) => {
		s.character.classes[0].level = 5;
		s.cyber!.heat = 8;
		s.cyber!.den!.upgrades = { steel_door: 1, cameras: 1, turret: 1 };
		s.cyber!.den!.raidDue = { reason: "Heat 8", at: gameMinutes(s.time) + 120, by: "ferro" };
	});
	assert.match((await call(id, "raid_begin", {})).text, /Not yet/);
	assert.match((await call(id, "raid_begin", { early: true })).text, /no map yet/);
	assert.match((await call(id, "raid_status", {})).text, /Cameras: a Grupo Ferro squad/);
	const r = await call(id, "raid_begin", { early: true, useActiveMap: true });
	assert.ok(!r.isError, r.text);
	assert.match(r.text, /RAID ON/);
	assert.match(r.text, /STEEL DOOR/);
	let s = m.loadState(id);
	const enc = s.encounter!;
	assert.equal(enc.status, "active");
	assert.equal(s.cyber!.den!.mapId, s.activeMapId);
	assert.ok(s.cyber!.den!.raidDue!.started);
	const cs = Object.values(enc.combatants);
	const turret = cs.find((c) => c.stats?.index === TURRET)!;
	assert.ok(turret, "turret fights");
	assert.equal(turret.side, "party");
	const foes = cs.filter((c) => c.side === "enemy");
	assert.ok(foes.length >= 1);
	assert.ok(foes.every((c) => c.stats?.index?.startsWith("c-ferro") || c.stats?.index === "c-security-drone"));
	assert.ok(foes.every((c) => c.conditions.some((k) => k.id === "incapacitated" && k.rounds === 1)), "steel door: they lose their first turn");
	assert.doesNotMatch(r.text, /Vera rolls initiative: \d+ \(surprised/, "cameras: no surprise");
	assert.match(m.digest.stateDigest(s), /RAID ON/);

	assert.match((await call(id, "raid_end", { outcome: "won" })).text, /still on/);
	assert.ok(!(await call(id, "end_combat", { status: "victory", reason: "they broke and ran" })).isError);
	const end = await call(id, "raid_end", { outcome: "won" });
	assert.ok(!end.isError, end.text);
	s = m.loadState(id);
	assert.equal(s.cyber!.heat, 6);
	assert.equal(s.cyber!.den!.raidDue, undefined);
	assert.equal(s.cyber!.den!.raids.length, 1);
});

test("raid_begin with no defences: the PC is surprised; away from the den it refuses; raid_end lost moves the den", async () => {
	const id = newGame();
	assert.ok(!(await call(id, "generate_map", { kind: "tavern", name: "Den" })).isError);
	edit(id, (s) => {
		s.cyber!.den!.raidDue = { reason: "betrayal", at: gameMinutes(s.time), by: "gang" };
		s.cyber!.den!.mapId = "elsewhere";
	});
	assert.match((await call(id, "raid_begin", {})).text, /no map yet/);
	edit(id, (s) => void (s.cyber!.den!.mapId = s.activeMapId));
	const r = await call(id, "raid_begin", {});
	assert.ok(!r.isError, r.text);
	let s = m.loadState(id);
	const cs = Object.values(s.encounter!.combatants);
	assert.match(r.text, /Vera rolls initiative: \d+ \(surprised/, "no cameras, no door: surprised");
	assert.ok(cs.filter((c) => c.side === "enemy").every((c) => !c.conditions.some((k) => k.id === "incapacitated")));
	await call(id, "end_combat", { status: "defeat", reason: "overrun" });
	assert.match((await call(id, "raid_end", { outcome: "lost" })).text, /name the new place/);
	assert.match((await call(id, "raid_end", { outcome: "fled", newDenName: "x" })).text, /No hidden exit/);
	const end = await call(id, "raid_end", { outcome: "lost", newDenName: "A shipping container on the docks", newRent: 120 });
	assert.ok(!end.isError, end.text);
	s = m.loadState(id);
	assert.equal(s.cyber!.den!.name, "A shipping container on the docks");
	assert.equal(s.cyber!.den!.moves, 1);
	assert.equal(s.cyber!.den!.mapId, undefined);
});
