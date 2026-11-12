import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GridMap, Tile } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-sync-"));
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

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

// The crypt from a real session: a hall (PC) below a crypt behind a locked door at (13,8).
const ASCII = [
	"###########################",
	"########...........########",
	"########...........########",
	"########...........########",
	"########...........########",
	"#############L#############",
	"##########.......##########",
	"##########.......##########",
	"##########.......##########",
	"##########.......##########",
	"###########################",
];
function cryptMap(door: Tile): GridMap {
	const tiles = ASCII.join("").split("").map((c) => (c === "#" ? "wall" : c === "L" ? door : "floor")) as Tile[];
	const width = ASCII[0].length, height = ASCII.length;
	return {
		id: "map_crypt", name: "Crypt", kind: "dungeon", seed: 1, width, height, tiles,
		explored: tiles.map(() => true),
		rooms: [{ id: "room-crypt", x: 8, y: 1, w: 11, h: 4, tag: "boss", name: "The crypt" }, { id: "room-hall", x: 10, y: 6, w: 7, h: 4, tag: "hall" }],
		entities: [], lighting: "dark", entry: { x: 13, y: 9 },
	} as unknown as GridMap;
}

async function setup(door: Tile) {
	const settings = m.defaultSettings();
	settings.dm.fights = "turns"; // these tests play fights turn by turn (the default is automatic)
	const s = m.createGame({ settings, character: { name: "Halden", speciesId: "human", classId: "wizard", backgroundId: "sage", abilities: STD } });
	const st = m.loadState(s.id);
	const map = cryptMap(door);
	map.entities.push({ id: `ent_${st.character.id}`, kind: "pc", name: "Halden", sprite: "pc", size: 1, x: 13, y: 8 } as GridMap["entities"][number]);
	st.maps[map.id] = map;
	st.activeMapId = map.id;
	m.saveState(st);
	return s.id;
}

test("start_combat refuses an enemy sealed behind a locked door, and says which door", async () => {
	const id = await setup("door_locked");
	const r = await call(id, "start_combat", { monsters: [{ monster: "kobold", x: 13, y: 2 }] });
	assert.equal(r.isError, true);
	assert.match(r.text, /locked door at \(13,5\)/);
	assert.match(r.text, /room-crypt/);
	assert.equal(m.loadState(id).encounter, undefined);
	// Fix the map as the story says (door opened) and the fight starts.
	await call(id, "set_tile", { x: 13, y: 5, tile: "door_open" });
	const ok = await call(id, "start_combat", { monsters: [{ monster: "kobold", x: 13, y: 2 }] });
	assert.ok(!ok.isError, ok.text);
});

test("closed doors open when walked through in combat; move_player finds line of sight", async () => {
	const id = await setup("door");
	const r = await call(id, "start_combat", { monsters: [{ monster: "kobold", x: 9, y: 1 }] });
	assert.ok(!r.isError, r.text);
	let st = m.loadState(id);
	// Make it the player's turn.
	const enc = st.encounter!;
	enc.turnIndex = enc.order.indexOf(st.character.id);
	m.saveState(st);
	const foe = Object.values(enc.combatants).find((c) => c.side === "enemy")!;
	const mv = await call(id, "move_player", { towardId: foe.id, needSight: true });
	assert.ok(!mv.isError, mv.text);
	assert.match(mv.text, /opens the door/);
	assert.match(mv.text, /now in sight/);
	st = m.loadState(id);
	assert.equal(st.maps.map_crypt.tiles[5 * 27 + 13], "door_open");
});

test("end_combat with enemies standing needs a story reason", async () => {
	const id = await setup("door_open");
	await call(id, "start_combat", { monsters: [{ monster: "kobold", x: 13, y: 2 }] });
	const r = await call(id, "end_combat", { status: "ended" });
	assert.equal(r.isError, true);
	assert.match(r.text, /still standing/);
	const ok = await call(id, "end_combat", { status: "ended", reason: "The mephit surrenders" });
	assert.ok(!ok.isError, ok.text);
});
