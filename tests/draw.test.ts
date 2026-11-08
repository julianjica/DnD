import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { climateForPreset, drawMap, DRAW_LEGEND, type DrawInput } from "../lib/maps/draw";

const ROOM = [
	"##########",
	"#,,,,,,,,#",
	"#,,@,,,,,#",
	"#,,,,R,,,#",
	"#,,,,,,1,#",
	"#,,,,,,,,#",
	"####+#####",
];
const base = (over: Partial<DrawInput> = {}): DrawInput => ({ rows: ROOM, kind: "town", name: "Yard", seed: 7, ...over });
const at = (map: { width: number; tiles: string[] }, x: number, y: number) => map.tiles[y * map.width + x];

test("drawMap maps legend characters to tiles", () => {
	const rows = ["#,;.=-:%", "i~wXT+/L", "SOtBrp<>", "bl######", "########", "########"];
	const { map } = drawMap(base({ rows }));
	assert.equal(map.width, 8);
	assert.equal(map.height, 6);
	assert.equal(map.drawn, true);
	assert.equal(map.id, "");
	rows.forEach((row, y) => [...row].forEach((ch, x) => assert.equal(at(map, x, y), DRAW_LEGEND[ch], `"${ch}" at ${x},${y}`)));
	assert.ok(map.explored.every(Boolean));
});

test("@ sets entry and pc; its square takes the surrounding ground", () => {
	const { map, pc, entities } = drawMap(base({ key: { R: { sprite: "runestone" }, "1": { npcId: "npc_a" } } }));
	assert.deepEqual(pc, { x: 3, y: 2 });
	assert.deepEqual(map.entry, { x: 3, y: 2 });
	assert.equal(at(map, 3, 2), "grass");
	assert.ok(!entities.some((e) => e.kind === "pc"), "PC is not an entity");
	// Wooden floor around → wood_floor under the player.
	const inn = ["########", "#======#", "#==@===#", "#======#", "#======#", "########"];
	assert.equal(at(drawMap(base({ rows: inn })).map, 3, 2), "wood_floor");
});

test("key characters become entities with inferred kinds", () => {
	const { map, entities } = drawMap(
		base({
			rows: ["##########", "#,,,,,,,,#", "#,R,,,,,,#", "#,,,h,,,,#", "#,,,,,,1,#", "##########"],
			key: { R: { sprite: "runestone", description: "Old runes" }, h: { sprite: "hearth", lightRadius: 6 }, "1": { npcId: "npc_a", name: "Bryn" } },
		}),
	);
	const byName = (n: string) => entities.find((e) => e.name === n)!;
	assert.equal(entities.length, 3);
	assert.deepEqual({ kind: byName("runestone").kind, x: byName("runestone").x, y: byName("runestone").y, desc: byName("runestone").description }, { kind: "feature", x: 2, y: 2, desc: "Old runes" });
	assert.equal(byName("hearth").kind, "light");
	assert.equal(byName("hearth").lightRadius, 6);
	const npc = byName("Bryn");
	assert.equal(npc.kind, "npc");
	assert.equal(npc.npcId, "npc_a");
	assert.equal(npc.sprite, "npc");
	assert.equal(npc.disposition, "friendly");
	// Marked squares are ground, not void.
	for (const e of entities) assert.equal(at(map, e.x, e.y), "grass");
	// No @: entry falls back to the first open square.
	assert.deepEqual(map.entry, { x: 1, y: 1 });
});

test("unknown characters throw a helpful error", () => {
	assert.throws(() => drawMap(base({ key: { R: { sprite: "runestone" } } })), (e: Error) => /Unknown characters "1"/.test(e.message) && /key/.test(e.message));
	assert.throws(() => drawMap(base()), /"R", "1"|"1", "R"/);
});

test("key characters that clash with the legend throw", () => {
	assert.throws(() => drawMap(base({ key: { T: { sprite: "statue" }, R: {}, "1": {} } })), /Key "T" clashes with the legend/);
	assert.throws(() => drawMap(base({ key: { "@": { sprite: "statue" }, R: {}, "1": {} } })), /Key "@" clashes/);
	assert.throws(() => drawMap(base({ key: { ab: {}, R: {}, "1": {} } })), /single character/);
});

test("ragged rows are padded with void", () => {
	const rows = ["##########", "#,,,,,,,,#", "#,,@,,", "#,,,,,,,,#", "#,,,,", "##########"];
	const { map } = drawMap(base({ rows }));
	assert.equal(map.width, 10);
	assert.equal(map.tiles.length, 60);
	for (let x = 6; x < 10; x++) assert.equal(at(map, x, 2), "void");
	for (let x = 5; x < 10; x++) assert.equal(at(map, x, 4), "void");
	assert.equal(at(map, 9, 3), "wall");
});

test("climate is stored only when not temperate", () => {
	assert.equal("climate" in drawMap(base({ key: { R: {}, "1": {} } })).map, false);
	assert.equal("climate" in drawMap(base({ key: { R: {}, "1": {} }, climate: "temperate" })).map, false);
	assert.equal(drawMap(base({ key: { R: {}, "1": {} }, climate: "snow" })).map.climate, "snow");
	assert.equal(climateForPreset("arctic"), "snow");
	assert.equal(climateForPreset("desert_kingdoms"), "desert");
	assert.equal(climateForPreset("grimdark"), "temperate");
});

test("size limits are enforced", () => {
	assert.throws(() => drawMap(base({ rows: ROOM.slice(0, 4) })), /at least 6 rows/);
	assert.throws(() => drawMap(base({ rows: ["#####", "#####", "#####", "#####", "#####", "#####"] })), /at least 8 squares wide/);
});

// ---- draw_map tool ----

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-draw-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { int: 15, con: 14, dex: 13, wis: 12, str: 10, cha: 8 } };

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

function newGame(preset?: "arctic") {
	const settings = m.defaultSettings();
	if (preset) settings.world.preset = preset;
	return m.createGame({ settings, character: { name: "Halden", speciesId: "human", classId: "wizard", backgroundId: "sage", abilities: STD } }).id;
}

test("new campaigns default to sprite scenes", () => {
	const st = m.loadState(newGame());
	assert.equal(st.settings.art?.scenes, "sprites");
});

test("draw_map creates the active map with the PC at @ and stays on the scene view", async () => {
	const id = newGame();
	const r0 = await call(id, "add_npc", { name: "Bryn", role: "innkeeper", description: "A broad woman with flour on her apron." });
	const npcId = /id (npc_\S+)\./.exec(r0.text)![1];
	const r = await call(id, "draw_map", {
		name: "The Gilded Goose",
		kind: "tavern",
		rows: ["##########", "#========#", "#==@=====#", "#====h===#", "#======1=#", "####+#####"],
		key: [
			{ char: "h", sprite: "hearth", lightRadius: 6 },
			{ char: "1", npcId },
		],
	});
	assert.notEqual(r.isError, true, r.text);
	const st = m.loadState(id);
	const map = st.maps[st.activeMapId!];
	assert.ok(map, "active map");
	assert.equal(map.name, "The Gilded Goose");
	assert.equal(map.drawn, true);
	assert.match(map.id, /^map/);
	const pc = map.entities.find((e) => e.kind === "pc")!;
	assert.deepEqual({ x: pc.x, y: pc.y }, { x: 3, y: 2 });
	const npc = map.entities.find((e) => e.npcId === npcId)!;
	assert.equal(npc.name, "Bryn");
	assert.equal(npc.kind, "npc");
	assert.deepEqual({ x: npc.x, y: npc.y }, { x: 7, y: 4 });
	assert.equal(map.entities.find((e) => e.sprite === "hearth")?.lightRadius, 6);
	assert.equal(st.view, "scene");
	assert.equal("climate" in map, false);
});

test("draw_map rejects an unknown npcId and takes climate from the preset", async () => {
	const id = newGame("arctic");
	const rows = ["##########", "#,,,,,,,,#", "#,,@,,,,,#", "#,,,,,,1,#", "#,,,,,,,,#", "##########"];
	const bad = await call(id, "draw_map", { name: "Camp", kind: "camp", rows, key: [{ char: "1", npcId: "npc_nobody" }] });
	assert.equal(bad.isError, true);
	assert.match(bad.text, /Unknown npcId npc_nobody/);
	const before = m.loadState(id);
	assert.equal(before.activeMapId, undefined);
	const ok = await call(id, "draw_map", { name: "Camp", kind: "camp", rows, key: [{ char: "1", sprite: "campfire", lightRadius: 4 }], show: true });
	assert.notEqual(ok.isError, true, ok.text);
	const st = m.loadState(id);
	assert.equal(st.maps[st.activeMapId!].climate, "snow");
	assert.equal(st.view, "map");
});

test("travelling back to a drawn place reopens its latest map", async () => {
	const id = newGame();
	const rows = ["##########", "#,,,,,,,,#", "#,,@,,,,,#", "#,,,,,,,,#", "#,,,,,,,,#", "##########"];
	const home = m.loadState(id).world.currentLocationId!;
	await call(id, "draw_map", { name: "Yard", kind: "town", rows });
	const yard = m.loadState(id).activeMapId!;
	const away = m.loadState(id).world.locations.find((l) => l.id !== home)!;
	await call(id, "travel", { locationId: away.id, hours: 1 });
	const gone = m.loadState(id);
	assert.equal(gone.activeMapId, undefined, "a new place has no map yet");
	const r = await call(id, "travel", { locationId: home, hours: 1 });
	assert.match(r.text, /Reopened its map Yard/);
	const st = m.loadState(id);
	assert.equal(st.activeMapId, yard);
	assert.ok(st.maps[yard].entities.some((e) => e.kind === "pc"));
});

test("drawing another map of a place first shows its existing maps", async () => {
	const id = newGame();
	const rows = ["##########", "#,,,,,,,,#", "#,,@,,,,,#", "#,,,,,,,,#", "#,,,,,,,,#", "####+#####"];
	await call(id, "draw_map", { name: "Front", kind: "town", rows });
	const gated = await call(id, "draw_map", { name: "Back", kind: "town", rows });
	assert.notEqual(gated.isError, true);
	assert.match(gated.text, /NOTHING WAS DRAWN.*already has 1 map/);
	assert.ok(gated.text.includes("####+#####") && gated.text.includes("#,,@,,,,,#"), gated.text);
	assert.equal(Object.keys(m.loadState(id).maps).length, 1, "nothing drawn");
	const ok = await call(id, "draw_map", { name: "Back", kind: "town", rows });
	assert.notEqual(ok.isError, true, ok.text);
	assert.equal(m.loadState(id).maps[m.loadState(id).activeMapId!].name, "Back");
});
