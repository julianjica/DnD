import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { Character, CyberState, GameState, RollRecord } from "../lib/game/types";
import {
	activeHeatEffects,
	addHeat,
	cyberDigest,
	cyberTick,
	decayHeat,
	episodeDc,
	hatBand,
	HAT_BANDS,
	HISTORY_CAP,
	humanityCheck,
	humanityEffects,
	IMPLANT_SLOTS,
	initCyberState,
	installImplant,
	layLow,
	removeImplant,
	shiftHat,
	therapy,
	type ImplantSource,
} from "../lib/rules/cyber";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-cyber-"));
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

const pc = (wis: number) => ({ abilities: { str: 10, dex: 10, con: 10, int: 10, wis, cha: 10 } }) as unknown as Character;
const fresh = (wis = 14): CyberState => initCyberState(pc(wis), 0);

const EYE: ImplantSource = { index: "c-test-eye", name: "Test Eye", implant: { slot: "eyes", humanity: 2, effect: "see in the dark" } };
const SKIN: ImplantSource = { index: "c-test-skin", name: "Test Skin", implant: { slot: "skin", humanity: 4, effect: "+1 AC" } };
const ARM: ImplantSource = { index: "c-test-arm", name: "Test Arm", implant: { slot: "arms", humanity: 6, effect: "hydraulic grip" } };
const NERVE: ImplantSource = { index: "c-test-nerve", name: "Test Nerve", implant: { slot: "neural", humanity: 3, effect: "+2 initiative" } };
const JACKET: ImplantSource = { index: "c-jacket", name: "Jacket" };

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };

/** A campaign switched to the Root Access preset (the cyber setup lives with agent P). */
function newGame(cyber: boolean): string {
	const id = m.createGame({ settings: m.defaultSettings(), character: { name: "Vera", speciesId: "human", classId: "rogue", backgroundId: "criminal", abilities: STD } }).id;
	if (cyber)
		edit(id, (s) => {
			s.settings.world.preset = "marea_burned";
			s.cyber = initCyberState(s.character, s.time.day * 1440 + s.time.hour * 60 + s.time.minute);
		});
	return id;
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

// ─── init ────────────────────────────────────────────────────────────────────

test("initCyberState: hat 0, heat 3 (Burned), humanity = 10 + WIS score", () => {
	const cy = initCyberState(pc(14), 1234);
	assert.deepEqual(cy, { hat: 0, heat: 3, humanity: 24, humanityMax: 24, implants: [], history: [], heatDecayedAt: 1234 });
	assert.equal(initCyberState(pc(8), 0).humanityMax, 18);
});

// ─── hat ─────────────────────────────────────────────────────────────────────

test("hat: bands at −4 / +4 and clamped to −10…+10", () => {
	assert.equal(hatBand(-4), "black");
	assert.equal(hatBand(-3), "grey");
	assert.equal(hatBand(3), "grey");
	assert.equal(hatBand(4), "white");
	const cy = fresh();
	const r = shiftHat(cy, 3, "leaked the dossier", 10);
	assert.equal(r.to, 3);
	assert.equal(r.bandChanged, false);
	const w = shiftHat(cy, 2, "reported the flaw", 20);
	assert.equal(w.band, "white");
	assert.ok(w.bandChanged);
	assert.match(w.text, /WHITE hat: opens Bureau/);
	shiftHat(cy, 20, "saint", 30);
	assert.equal(cy.hat, 10);
	shiftHat(cy, -50, "ransomware on a hospital", 40);
	assert.equal(cy.hat, -10);
	assert.equal(hatBand(cy.hat), "black");
	assert.ok(HAT_BANDS.black.opens.includes("ransomware"));
	assert.deepEqual(cy.history.map((h) => h.delta), [3, 2, 5, -20]);
	assert.equal(cy.history[0].why, "leaked the dossier");
});

// ─── heat ────────────────────────────────────────────────────────────────────

test("heat: clamped 0…10, threshold crossings up and down", () => {
	const cy = fresh();
	const up = addHeat(cy, 4, "trace landed", 0);
	assert.equal(up.to, 7);
	assert.deepEqual(up.crossed.map((t) => t.at), [6]);
	assert.match(up.text, /Ferro sweeps/);
	const top = addHeat(cy, 9, "everything", 0);
	assert.equal(top.to, 10);
	assert.deepEqual(top.crossed.map((t) => t.at), [8, 10]);
	assert.match(top.text, /raid on the den/);
	assert.match(top.text, /bounty/);
	assert.deepEqual(activeHeatEffects(10).map((t) => t.id), ["prices", "sweep", "raid", "bounty"]);
	const down = addHeat(cy, -20, "scrubbed", 0);
	assert.equal(down.to, 0);
	assert.deepEqual(down.cleared.map((t) => t.at), [3, 6, 8, 10]);
	assert.deepEqual(activeHeatEffects(2), []);
	// From the Burned start (3), the "prices" threshold is already in effect, not crossed again.
	assert.deepEqual(addHeat(fresh(), 1, "x", 0).crossed, []);
});

test("heat: decays 1 per day boundary crossed, tracked by heatDecayedAt", () => {
	const cy = fresh();
	cy.heat = 5;
	cy.heatDecayedAt = 1 * 1440 + 600; // day 1, 10:00
	assert.equal(decayHeat(cy, 1 * 1440 + 1400), undefined); // same day
	assert.equal(cy.heat, 5);
	const line = decayHeat(cy, 2 * 1440 + 60); // day 2, 01:00
	assert.match(line ?? "", /Heat 5 → 4/);
	assert.equal(cy.heatDecayedAt, 2 * 1440 + 60);
	assert.equal(decayHeat(cy, 2 * 1440 + 900), undefined); // no double count the same day
	decayHeat(cy, 5 * 1440); // three more days
	assert.equal(cy.heat, 1);
	decayHeat(cy, 9 * 1440);
	assert.equal(cy.heat, 0);
	assert.equal(decayHeat(cy, 12 * 1440), undefined); // nothing to cool
});

test("layLow: time passes and heat drops 2 a day", () => {
	const s = { settings: { world: { preset: "marea_burned" } }, time: { day: 3, hour: 9, minute: 0 }, character: pc(12) } as unknown as GameState;
	s.cyber = initCyberState(s.character, 3 * 1440 + 9 * 60);
	s.cyber.heat = 9;
	const text = layLow(s, 3);
	assert.equal(s.time.day, 6);
	assert.equal(s.time.hour, 9);
	assert.equal(s.cyber.heat, 3);
	assert.match(text, /Heat 9 → 3/);
	assert.match(text, /no longer a den raid is due/);
	// the daily tick has nothing left to decay
	assert.equal(cyberTick(s), undefined);
	assert.equal(s.cyber.heat, 3);
});

// ─── humanity ────────────────────────────────────────────────────────────────

test("installImplant: costs humanity, respects slot limits, refuses non-implants", () => {
	assert.deepEqual(IMPLANT_SLOTS, { neural: 2, eyes: 2, arms: 2, legs: 2, skin: 1, internal: 3 });
	const cy = fresh(14); // 24
	assert.ok(installImplant(cy, EYE, 5).ok);
	assert.equal(cy.humanity, 22);
	assert.equal(cy.implants[0].installedAt, 5);
	assert.ok(installImplant(cy, EYE, 6).ok);
	const full = installImplant(cy, EYE, 7);
	assert.equal(full.ok, false);
	assert.match(full.text, /eyes slot holds 2 and is full/);
	assert.equal(cy.humanity, 20);
	assert.ok(installImplant(cy, SKIN, 8).ok);
	assert.equal(installImplant(cy, SKIN, 9).ok, false); // skin holds 1
	assert.equal(installImplant(cy, JACKET, 9).ok, false);
	assert.equal(cy.implants.length, 3);
	assert.deepEqual(cy.history.map((h) => h.delta), [-2, -2, -4]);
});

test("removeImplant gives the cost back (never above max); therapy +2 a session up to max", () => {
	const cy = fresh(10); // 20
	installImplant(cy, ARM, 0);
	installImplant(cy, NERVE, 0);
	assert.equal(cy.humanity, 11);
	const r = removeImplant(cy, "c-test-arm", 1);
	assert.ok(r.ok);
	assert.equal(cy.humanity, 17);
	assert.equal(removeImplant(cy, "c-nope", 1).ok, false);
	const t1 = therapy(cy, 1, 2);
	assert.equal(t1.gained, 2);
	assert.equal(cy.humanity, 19);
	const t2 = therapy(cy, 5, 3);
	assert.equal(t2.gained, 1);
	assert.equal(cy.humanity, 20);
	assert.equal(therapy(cy, 1, 4).gained, 0);
});

test("humanity thresholds: standing effects at ≤ 10 and ≤ 5, crossing notes", () => {
	assert.deepEqual(humanityEffects(11), []);
	assert.equal(humanityEffects(10).length, 1);
	assert.equal(humanityEffects(5).length, 2);
	assert.match(humanityEffects(5)[0], /Persuasion/);
	assert.equal(episodeDc(10), 10);
	assert.equal(episodeDc(4), 16);
	const cy = fresh(10);
	cy.humanity = 12;
	assert.match(installImplant(cy, NERVE, 0).text, /10 or less/);
	cy.humanity = 8;
	assert.match(installImplant(cy, NERVE, 0).text, /people now sense it/);
});

test("Fracture at 0: the most expensive implant comes out, humanity 5, clinic debt", () => {
	const cy = fresh(10);
	installImplant(cy, NERVE, 0); // 17
	installImplant(cy, SKIN, 0); // 13
	cy.humanity = 6;
	const r = installImplant(cy, ARM, 1); // 6 - 6 = 0
	assert.ok(r.ok);
	assert.ok(r.fractured);
	assert.match(r.text, /FRACTURE/);
	assert.match(r.text, /IN DEBT/);
	assert.match(r.text, /never the end/);
	assert.equal(cy.humanity, 5);
	assert.deepEqual(cy.implants.map((i) => i.ref).sort(), ["c-test-nerve", "c-test-skin"]); // the arm (6) came out
});

test("humanityCheck: no save above 10; at ≤ 10 a WIS save vs 10 + (10 − humanity), episodes rolled", () => {
	const mk = (h: number, seed: number) => {
		const s = { settings: { world: { preset: "marea_burned" } }, time: { day: 0, hour: 0, minute: 0 }, character: { ...pc(10), id: "pc", savingThrows: [], classes: [{ classId: "rogue", level: 1 }], exhaustion: 0 } } as unknown as GameState;
		s.cyber = initCyberState(s.character, 0);
		s.cyber.humanity = h;
		return { s, rng: new Rng(seed) };
	};
	const rolls: RollRecord[] = [];
	const hi = mk(15, 1);
	const none = humanityCheck(hi.s, hi.rng, (r) => rolls.push(r), "crit fail");
	assert.equal(none.save, undefined);
	assert.equal(rolls.length, 0);
	const seen = new Set<string>();
	let saves = 0;
	for (let seed = 1; seed < 400; seed++) {
		const { s, rng } = mk(3, seed);
		const out: RollRecord[] = [];
		const r = humanityCheck(s, rng, (x) => out.push(x), "killed the guard");
		assert.equal(out.length, 1);
		assert.equal(out[0].target, 17);
		assert.equal(out[0].check?.ability, "wis");
		if (r.save) saves++;
		else {
			assert.ok(r.episode);
			seen.add(r.episode!);
			assert.match(r.text, /EPISODE/);
			assert.match(r.text, /Persuasion/); // ≤ 5 standing effect reported
		}
	}
	assert.ok(saves > 0);
	assert.deepEqual([...seen].sort(), ["freeze", "lash out", "lost turn"]);
});

test("history is capped", () => {
	const cy = fresh();
	for (let i = 0; i < HISTORY_CAP + 15; i++) shiftHat(cy, i % 2 ? 1 : -1, `move ${i}`, i);
	assert.equal(cy.history.length, HISTORY_CAP);
	assert.equal(cy.history.at(-1)!.why, `move ${HISTORY_CAP + 14}`);
});

test("cyberDigest: one compact line with the meters, implants and effects", () => {
	const s = { settings: { world: { preset: "marea_burned" } }, time: { day: 0, hour: 0, minute: 0 } } as unknown as GameState;
	assert.equal(cyberDigest(s), undefined);
	s.cyber = fresh(14);
	s.cyber.hat = 2;
	s.cyber.heat = 6;
	installImplant(s.cyber, EYE, 0);
	const line = cyberDigest(s)!;
	assert.match(line, /^Hat \+2 \(grey/);
	assert.match(line, /Heat 6\/10/);
	assert.match(line, /Humanity 22\/24/);
	assert.match(line, /implants: c-test-eye \(eyes, −2\)/);
	assert.match(line, /Ferro sweeping/);
});

// ─── DM tools ────────────────────────────────────────────────────────────────

test("tools refuse outside Root Access", async () => {
	const id = newGame(false);
	for (const [name, args] of [["shift_hat", { delta: 1, why: "x" }], ["add_heat", { delta: 1, why: "x" }], ["lay_low", { days: 1 }], ["install_implant", { ref: "c-x" }], ["remove_implant", { ref: "c-x" }], ["humanity_check", { trigger: "x" }], ["therapy", { sessions: 1 }]] as const) {
		const r = await call(id, name, args);
		assert.ok(r.isError, name);
		assert.match(r.text, /only exists in Root Access/);
	}
	assert.equal(m.loadState(id).cyber, undefined);
});

test("tools move the meters in a cyberpunk campaign; digest shows them", async () => {
	const id = newGame(true);
	const start = m.loadState(id).cyber!;
	assert.equal(start.humanityMax, 10 + m.loadState(id).character.abilities.wis);
	assert.match((await call(id, "shift_hat", { delta: -2, why: "sold the list" })).text, /Hat 0 → -2/);
	assert.match((await call(id, "add_heat", { delta: 3, why: "trace" })).text, /HEAT 6: Ferro/);
	assert.match((await call(id, "humanity_check", { trigger: "crit" })).text, /No check/);
	assert.match((await call(id, "therapy", { sessions: 1 })).text, /already at its maximum/);
	const bad = await call(id, "install_implant", { ref: "not-a-real-implant" });
	assert.ok(bad.isError);
	assert.ok((await call(id, "remove_implant", { ref: "c-nothing" })).isError);
	const ll = await call(id, "lay_low", { days: 2 });
	assert.match(ll.text, /Heat 6 → 2/);
	const s = m.loadState(id);
	assert.equal(s.cyber!.hat, -2);
	assert.equal(s.cyber!.heat, 2);
	assert.match(m.digest.stateDigest(s), /Hat -2 \(grey.*Heat 2\/10 · Humanity/);
});

test("game time passing a day boundary cools heat through the tool tick", async () => {
	const id = newGame(true);
	edit(id, (s) => void (s.cyber!.heat = 5));
	await call(id, "advance_time", { days: 2 });
	assert.equal(m.loadState(id).cyber!.heat, 3);
	await call(id, "advance_time", { hours: 1 });
	assert.equal(m.loadState(id).cyber!.heat, 3);
});
