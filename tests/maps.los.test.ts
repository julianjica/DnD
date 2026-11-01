import { test } from "node:test";
import assert from "node:assert/strict";
import type { GridMap, Tile } from "../lib/game/types";
import { computeFov, revealAround, hasLineOfSight, computePlayerView, computeLightLevels } from "../lib/maps/grid";
import { aoeSquares } from "../lib/maps/aoe";

function mapFrom(rows: string[], lighting: GridMap["lighting"] = "bright"): GridMap {
	const legend: Record<string, Tile> = { ".": "floor", "#": "wall", "+": "door", "'": "door_open", T: "tree", "~": "water" };
	const tiles = rows.join("").split("").map((c) => legend[c]);
	const w = rows[0].length, h = rows.length;
	return { id: "t", name: "t", kind: "dungeon", seed: 1, width: w, height: h, tiles, explored: new Array(w * h).fill(false), rooms: [], entities: [], lighting, entry: { x: 1, y: 1 } };
}

const ROOMS = [
	"#########",
	"#...#...#",
	"#...+...#",
	"#...#...#",
	"#########",
];

test("walls block sight; the wall itself is seen", () => {
	const m = mapFrom(ROOMS);
	const v = computeFov(m, 1, 2, 20);
	assert.ok(v.has("3,2"));
	assert.ok(v.has("4,1"), "wall square visible");
	assert.ok(v.has("4,2"), "door square visible");
	assert.ok(!v.has("6,2"), "behind closed door hidden");
	assert.ok(!v.has("7,1"));
});

test("opening the door reveals the far room", () => {
	const m = mapFrom(ROOMS);
	m.tiles[2 * m.width + 4] = "door_open";
	const v = computeFov(m, 1, 2, 20);
	assert.ok(v.has("6,2"));
	assert.ok(v.has("7,2"));
});

test("revealAround marks explored and respects radius", () => {
	const m = mapFrom(["...........", "...........", "...........", "...#.......", "..........."]);
	const v = revealAround(m, 0, 3, 3);
	assert.ok(m.explored[3 * m.width + 0]);
	assert.ok(m.explored[3 * m.width + 2]);
	assert.ok(!m.explored[3 * m.width + 5], "outside radius");
	assert.equal(v.size, m.explored.filter(Boolean).length);
	// further reveals only add
	revealAround(m, 10, 0, 2);
	assert.ok(m.explored[3 * m.width + 0]);
	assert.ok(m.explored[0 * m.width + 10]);
});

test("hasLineOfSight", () => {
	const m = mapFrom(ROOMS);
	assert.ok(hasLineOfSight(m, { x: 1, y: 1 }, { x: 3, y: 3 }));
	assert.ok(!hasLineOfSight(m, { x: 1, y: 2 }, { x: 7, y: 2 }));
	assert.ok(hasLineOfSight(m, { x: 1, y: 2 }, { x: 4, y: 2 }), "can see the door itself");
});

test("dark maps: only lit squares and darkvision are visible", () => {
	const m = mapFrom(["...............", "...............", "..............."], "dark");
	const v0 = computePlayerView(m, { x: 0, y: 1 });
	assert.ok(v0.has("1,1") && !v0.has("6,1"));
	m.entities.push({ id: "t", kind: "light", name: "torch", sprite: "torch", x: 10, y: 1, size: 1, lightRadius: 2 });
	const light = computeLightLevels(m);
	assert.equal(light[1 * m.width + 10], 1);
	assert.equal(light[1 * m.width + 13], 0.5);
	assert.equal(light[1 * m.width + 0], 0);
	const v = computePlayerView(m, { x: 0, y: 1 });
	assert.ok(v.has("10,1") && v.has("13,1") && !v.has("5,1"));
	const dv = computePlayerView(m, { x: 0, y: 1 }, { darkvision: 12 });
	assert.ok(dv.has("5,1"));
});

test("aoe templates", () => {
	const s = aoeSquares({ shape: "sphere", origin: { x: 10, y: 10 }, size: 20 });
	assert.ok(s.has("10,10") && s.has("14,10") && !s.has("15,10") && !s.has("13,13"));
	const c = aoeSquares({ shape: "cone", origin: { x: 0, y: 5 }, size: 15, toward: { x: 5, y: 5 } });
	assert.ok(c.has("1,5") && c.has("3,5") && c.has("3,4") && !c.has("4,5") && !c.has("1,3"));
	const l = aoeSquares({ shape: "line", origin: { x: 0, y: 0 }, size: 30, toward: { x: 6, y: 0 } });
	assert.equal(l.size, 6);
	const cube = aoeSquares({ shape: "cube", origin: { x: 5, y: 5 }, size: 15, toward: { x: 6, y: 5 } });
	assert.equal(cube.size, 9);
});
