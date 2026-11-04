import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeFighter, makeMap, makeMonster, ScriptedRng } from "../lib/rules/combat/fixtures";
import { blocksSight as combatBlocksSight, blocksCover, findPath, hasLineOfSight, isPassableTile } from "../lib/rules/combat/grid";
import { startCombat } from "../lib/rules/combat/encounter";
import { blocksSight, canStand, computeFov, isPassable } from "../lib/maps/grid";
import { drawMap } from "../lib/maps/draw";
import { stateDigest } from "../lib/dm/digest";
import type { GameState, GridMap } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-barricade-"));
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
	return m.createGame({ settings, character: { name: "Dana", speciesId: "human", classId: "fighter", backgroundId: "sage", abilities: STD } }).id;
}

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

const minutes = (s: GameState) => s.time.day * 1440 + s.time.hour * 60 + (s.time.minute ?? 0);
const tileOf = (map: GridMap, x: number, y: number) => map.tiles[y * map.width + x];
const activeMap = (s: GameState) => s.maps[s.activeMapId!];

// A house: a room with one door (5,3) to the street; the player inside at (2,2).
const ROWS = [
	"##########",
	"#........#",
	"#.@......#",
	"#####+####",
	"----------",
	"----------",
];

test("a barricade blocks movement and sight in both grid modules", () => {
	assert.equal(isPassable("barricade"), false);
	assert.equal(blocksSight("barricade"), true);
	assert.equal(isPassableTile("barricade", {}), false);
	assert.equal(isPassableTile("barricade", { fly: true }), false);
	assert.equal(combatBlocksSight("barricade"), true);
	assert.equal(blocksCover("barricade"), true);

	// A corridor sealed by a barricade: no path through, no line of sight, no FOV beyond.
	const map = makeMap([
		"#########",
		"#...#...#",
		"#.......#",
		"#...#...#",
		"#########",
	]);
	const pc = { x: 1, y: 2 }, mon = { x: 7, y: 2 };
	const res = startCombat(
		{ encounterId: "e1", map, character: makeFighter(), pcPosition: pc, monsters: [{ stats: makeMonster(), id: "z", position: mon }] },
		new ScriptedRng([20, 1]),
	);
	assert.ok(res.ok, res.error);
	const zid = Object.values(res.encounter.combatants).find((c) => c.side === "enemy")!.id;
	assert.ok(findPath(res.encounter, res.map, zid, { x: 2, y: 2 }), "open before");
	assert.ok(hasLineOfSight(res.map, pc, mon));
	res.map.tiles[2 * res.map.width + 4] = "barricade";
	assert.equal(findPath(res.encounter, res.map, zid, { x: 2, y: 2 }), null);
	assert.equal(hasLineOfSight(res.map, pc, mon), false);
	const fov = computeFov(res.map, pc.x, pc.y, 12);
	assert.ok(fov.has("4,2"), "the barricade itself is seen");
	assert.equal(fov.has("6,2"), false);
	assert.equal(canStand(res.map, 4, 2, 1, new Set(), { allowDoors: true }), false);
});

test("draw_map: H draws a barricade with 25 HP", () => {
	const r = drawMap({ rows: ["#####+####", "#..H.....#", "#........#", "#........#", "#........#", "##########"], kind: "town", name: "x", seed: 1 });
	assert.equal(tileOf(r.map, 3, 1), "barricade");
	assert.deepEqual(r.map.barricades, { "3,1": { hp: 25, max: 25 } });
	assert.equal(drawMap({ rows: ROWS, kind: "town", name: "y", seed: 1 }).map.barricades, undefined);
});

test("build_barricade: planks use materials, take time, make noise; validation", async () => {
	const id = newGame(true);
	const d = await call(id, "draw_map", { name: "The Hale House", kind: "town", rows: ROWS });
	assert.notEqual(d.isError, true, d.text);

	// Planks without materials: refused, nothing changes.
	const no = await call(id, "build_barricade", { x: 5, y: 3, material: "planks" });
	assert.equal(no.isError, true);
	assert.match(no.text, /Not enough materials.*Planks.*Box of Nails/);
	assert.equal(tileOf(activeMap(m.loadState(id)), 5, 3), "door");

	await call(id, "give_item", { name: "Planks", ref: "z-planks", quantity: 2 });
	await call(id, "give_item", { name: "Box of Nails", ref: "z-nails", quantity: 1 });
	const before = m.loadState(id);
	const ok = await call(id, "build_barricade", { x: 5, y: 3, material: "planks" });
	assert.notEqual(ok.isError, true, ok.text);
	assert.match(ok.text, /Barricaded \(5,3\) with planks and nails: 25\/25 HP/);
	const s = m.loadState(id);
	const map = activeMap(s);
	assert.equal(tileOf(map, 5, 3), "barricade");
	assert.deepEqual(map.barricades, { "5,3": { hp: 25, max: 25 } });
	assert.equal(s.character.inventory.find((i) => i.ref === "z-planks")?.quantity, 1);
	assert.equal(s.character.inventory.some((i) => i.ref === "z-nails"), false);
	assert.equal(minutes(s) - minutes(before), 10);
	assert.equal(s.survival!.noise.level, 2);

	// Walls, the player's own square and off-map squares are refused.
	assert.match((await call(id, "build_barricade", { x: 0, y: 0, material: "furniture" })).text, /Can't barricade \(0,0\): it is wall/);
	assert.match((await call(id, "build_barricade", { x: 2, y: 2, material: "furniture" })).text, /occupied/);
	assert.equal((await call(id, "build_barricade", { x: 40, y: 2, material: "furniture" })).isError, true);
});

test("damage_barricade: hp drops, at 0 it becomes rubble; build on it repairs", async () => {
	const id = newGame(true);
	await call(id, "draw_map", { name: "Corner Store", kind: "town", rows: ROWS });
	const b = await call(id, "build_barricade", { x: 5, y: 3, material: "furniture" });
	assert.notEqual(b.isError, true, b.text);
	assert.deepEqual(activeMap(m.loadState(id)).barricades, { "5,3": { hp: 15, max: 15 } });
	assert.match(stateDigest(m.loadState(id)), /Barricades \(.*\): \(5,3\) 15\/15/);

	const hit = await call(id, "damage_barricade", { x: 5, y: 3, amount: 9 });
	assert.match(hit.text, /6\/15 HP left \(badly damaged/);
	const fix = await call(id, "build_barricade", { x: 5, y: 3, material: "car" });
	assert.match(fix.text, /Repaired the barricade at \(5,3\).*6 → 40\/40/);
	assert.deepEqual(activeMap(m.loadState(id)).barricades, { "5,3": { hp: 40, max: 40 } });

	const gone = await call(id, "damage_barricade", { x: 5, y: 3, amount: 50 });
	assert.match(gone.text, /gives way.*rubble/);
	const map = activeMap(m.loadState(id));
	assert.equal(tileOf(map, 5, 3), "rubble");
	assert.deepEqual(map.barricades, {});
	assert.equal((await call(id, "damage_barricade", { x: 5, y: 3, amount: 1 })).isError, true);

	// set_tile over a barricade drops its hit points.
	await call(id, "build_barricade", { x: 4, y: 1, material: "furniture" });
	await call(id, "set_tile", { x: 4, y: 1, tile: "floor" });
	assert.deepEqual(activeMap(m.loadState(id)).barricades, {});
});

test("fantasy campaigns: no barricade tools", async () => {
	const id = newGame(false);
	await call(id, "draw_map", { name: "Inn", kind: "tavern", rows: ROWS });
	const r = await call(id, "build_barricade", { x: 5, y: 3, material: "furniture" });
	assert.equal(r.isError, true);
	assert.match(r.text, /Only in The Quiet/);
	assert.equal(tileOf(activeMap(m.loadState(id)), 5, 3), "door");
	assert.equal((await call(id, "damage_barricade", { x: 5, y: 3, amount: 1 })).isError, true);
});
