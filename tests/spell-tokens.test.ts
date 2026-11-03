import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-spelltok-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	durationMinutes: typeof import("../lib/dm/spellTokens").durationMinutes;
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		durationMinutes: (await import("../lib/dm/spellTokens")).durationMinutes,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { int: 15, con: 14, dex: 13, wis: 12, str: 10, cha: 8 } };
const call = (id: string, name: string, args: Record<string, unknown>) => m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name)!.execute(args);

const ROWS = ["############", "#..........#", "#.@......g.#", "#..........#", "#..........#", "############"];

test("durationMinutes parses SRD durations", () => {
	assert.equal(m.durationMinutes("Up to 1 minute"), 1);
	assert.equal(m.durationMinutes("Up to 10 minutes"), 10);
	assert.equal(m.durationMinutes("Up to 8 hours"), 480);
	assert.equal(m.durationMinutes("Up to 1 round"), 1);
	assert.equal(m.durationMinutes("Instantaneous"), undefined);
});

test("a concentration spell with a visible effect gets a token that follows concentration", async () => {
	const id = m.createGame({ settings: m.defaultSettings(), character: { name: "Halden", speciesId: "human", classId: "wizard", backgroundId: "sage", abilities: STD } }).id;
	const r = await call(id, "draw_map", { name: "Hall", kind: "dungeon", rows: ROWS, key: [{ char: "g", sprite: "goblin", kind: "feature" }] });
	assert.ok(!r.isError, r.text);
	let st = m.loadState(id);
	const map = st.maps[st.activeMapId!];
	map.entities.push({ id: "ent_gob", kind: "monster", name: "Goblin", sprite: "goblin", x: 9, y: 2, size: 1, disposition: "hostile" });
	st.character.concentration = { spell: "flaming-sphere" };
	m.saveState(st);
	const out = await call(id, "update_entity", { id: "ent_gob", hidden: false });
	assert.match(out.text, /Flaming Sphere appears/);
	st = m.loadState(id);
	const sphere = st.maps[st.activeMapId!].entities.find((e) => e.id.startsWith("spell_"));
	assert.ok(sphere, "sphere token placed");
	assert.equal(sphere!.lightRadius, 4);
	assert.ok(Math.abs(sphere!.x - 9) <= 1 && Math.abs(sphere!.y - 2) <= 1, `next to the goblin, got ${sphere!.x},${sphere!.y}`);

	// A minute of game time later the sphere has burned out.
	st.time.minute += 2;
	m.saveState(st);
	const out2 = await call(id, "update_entity", { id: "ent_gob", hidden: false });
	assert.match(out2.text, /concentration ended/);
	st = m.loadState(id);
	assert.equal(st.character.concentration, undefined);
	assert.ok(!st.maps[st.activeMapId!].entities.some((e) => e.id.startsWith("spell_")), "token removed");
});

test("end_concentration and corpses", async () => {
	const id = m.createGame({ settings: m.defaultSettings(), character: { name: "Halden", speciesId: "human", classId: "wizard", backgroundId: "sage", abilities: STD } }).id;
	await call(id, "draw_map", { name: "Hall", kind: "dungeon", rows: ROWS, key: [{ char: "g", sprite: "goblin", kind: "feature" }] });
	let st = m.loadState(id);
	st.character.concentration = { spell: "moonbeam" };
	m.saveState(st);
	const ended = await call(id, "end_concentration", { reason: "dropped it" });
	assert.match(ended.text, /ended/);
	st = m.loadState(id);
	const g = st.maps[st.activeMapId!].entities.find((e) => e.sprite === "goblin")!;
	const dead = await call(id, "update_entity", { id: g.id, dead: true });
	assert.ok(!dead.isError, dead.text);
	assert.equal(m.loadState(id).maps[st.activeMapId!].entities.find((e) => e.id === g.id)!.dead, true);
});
