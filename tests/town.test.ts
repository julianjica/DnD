import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-town-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	town: typeof import("../lib/rules/town");
	client: typeof import("../lib/game/client");
	digest: typeof import("../lib/dm/digest");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		town: await import("../lib/rules/town"),
		client: await import("../lib/game/client"),
		digest: await import("../lib/dm/digest"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };

function newGame(): string {
	const settings = m.defaultSettings();
	settings.world.preset = "zombie_outbreak";
	return m.createGame({ settings, character: { name: "Dana", speciesId: "z-origin-streetwise", classId: "fighter", backgroundId: "criminal", abilities: STD } }).id;
}

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

test("the town seeds on first tick without catching up, and asks the DM to review it", async () => {
	const id = newGame();
	const st = m.loadState(id);
	assert.ok(st.town?.reviewed, "new campaigns start seeded");
	delete st.town; // a save from before the living town
	st.time.day = 10;
	const note = m.town.townTick(st, new Rng(1));
	assert.match(note ?? "", /TOWN SEEDED/);
	const t = st.town!;
	assert.equal(t.events.length, 0, "no synthetic history");
	assert.equal(t.places["loc-kf-st-brigids"].status, "overrun");
	assert.equal(t.places["loc-kf-precinct"].heldBy, "precinct");
	assert.ok(t.hordes.length >= 3);
	assert.equal(m.town.townTick(st, new Rng(2)), undefined, "nothing happens without time passing");
});

test("two weeks pass: factions act at night (at most 3 nights) and hordes move along roads", () => {
	const id = newGame();
	const st = m.loadState(id);
	m.town.townTick(st, new Rng(3));
	const before = JSON.stringify(st.town!.hordes.map((h) => h.at));
	const rng = new Rng(4);
	for (let d = 0; d < 14; d++) {
		st.time.day += 1;
		m.town.townTick(st, rng);
	}
	const t = st.town!;
	assert.notEqual(JSON.stringify(t.hordes.map((h) => h.at)), before, "some horde moved");
	// A long jump only plays the last 3 nights.
	const jump = m.loadState(id);
	m.town.townTick(jump, new Rng(9));
	jump.time.day += 10;
	m.town.townTick(jump, new Rng(10));
	const nights = new Set(jump.town!.events.filter((e) => !["overrun", "repelled", "at_base"].includes(e.kind)).map((e) => Math.floor(e.at / 1440)));
	assert.ok(nights.size <= 3, `faction nights capped (${[...nights]})`);
	assert.ok(Object.values(t.factions).every((f) => f.strength >= 1), "the engine never finishes a faction");
	for (const h of t.hordes) assert.ok(st.world.locations.some((l) => l.id === h.at));
});

test("travel reports what changed since the last visit; the client sees only what the player knows", async () => {
	const id = newGame();
	let st = m.loadState(id);
	m.town.townTick(st, new Rng(5));
	// Make the precinct known, then change it behind the player's back.
	m.town.visitPlace(st, "loc-kf-precinct");
	st.town!.hordes.push({ id: "hx", size: 40, at: "loc-kf-hollis", nextMoveAt: 1e9, known: false });
	m.saveState(st);
	const r = await call(id, "update_town", { places: [{ locationId: "loc-kf-precinct", status: "burned" }], events: [{ text: "The precinct burned.", locationId: "loc-kf-precinct", public: true, known: false }] });
	assert.notEqual(r.isError, true, r.text);
	st = m.loadState(id);
	const seen = m.client.clientState(st).town!;
	assert.equal(seen.places["loc-kf-precinct"].status, "held", "the player still thinks it stands");
	assert.ok(!seen.hordes.some((h) => h.id === "hx"), "unknown hordes stay hidden");
	assert.ok(Object.values(seen.factions).every((f) => f.goal === ""), "goals are secret");
	const tr = await call(id, "travel", { locationId: "loc-kf-precinct", hours: 1, show: false });
	assert.match(tr.text, /since the player was last here.*The precinct burned.*Now: burned/s);
	st = m.loadState(id);
	assert.equal(m.client.clientState(st).town!.places["loc-kf-precinct"].status, "burned");
	assert.match(m.digest.stateDigest(st), /TOWN \(the truth/);
});

test("update_town edits factions and validates input", async () => {
	const id = newGame();
	await call(id, "update_town", { reviewed: false });
	const ok = await call(id, "update_town", { factions: [{ id: "route9", attitude: -3, strength: 8, known: true }, { id: "crows", name: "The Crows", homeId: "loc-kf-old-mill", attitude: 1 }], reviewed: true });
	assert.notEqual(ok.isError, true, ok.text);
	const t = m.loadState(id).town!;
	assert.equal(t.factions.route9.attitude, -3);
	assert.equal(t.factions.crows.homeId, "loc-kf-old-mill");
	assert.equal(t.reviewed, true);
	const bad = await call(id, "update_town", { factions: [{ id: "nobody" }] });
	assert.equal(bad.isError, true);
	const badLoc = await call(id, "update_town", { places: [{ locationId: "atlantis", status: "burned" }] });
	assert.equal(badLoc.isError, true);
});

test("fantasy campaigns have no town", () => {
	const settings = m.defaultSettings();
	const id = m.createGame({ settings, character: { name: "Thorin", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: STD } }).id;
	const st = m.loadState(id);
	assert.equal(m.town.townTick(st, new Rng(1)), undefined);
	assert.equal(st.town, undefined);
});
