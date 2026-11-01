import assert from "node:assert/strict";
import { test } from "node:test";
import { makeBear, makeFighter, makeMap, makeMonster, openMap, ScriptedRng } from "../lib/rules/combat/fixtures";
import {
	areaSquares,
	bresenham,
	coverBetween,
	distanceFeet,
	findPath,
	hasLineOfSight,
	reachable,
	sizeSquares,
} from "../lib/rules/combat/grid";
import { startCombat } from "../lib/rules/combat/encounter";
import type { GridMap, MonsterStats } from "../lib/game/types";

function setup(map: GridMap, pc: { x: number; y: number }, monsters: { stats?: MonsterStats; at: { x: number; y: number }; side?: "enemy" | "party" }[] = []) {
	const rng = new ScriptedRng([20, ...monsters.map(() => 1)]);
	const res = startCombat(
		{ encounterId: "e1", map, character: makeFighter(), pcPosition: pc, monsters: monsters.map((m, i) => ({ stats: m.stats ?? makeMonster(), id: `m${i}`, position: m.at, side: m.side })) },
		rng,
	);
	assert.ok(res.ok, res.error);
	return res;
}

test("distanceFeet: adjacent = 5, diagonal = 5, sizes respected", () => {
	assert.equal(distanceFeet({ x: 0, y: 0, size: 1 }, { x: 1, y: 1, size: 1 }), 5);
	assert.equal(distanceFeet({ x: 0, y: 0, size: 1 }, { x: 3, y: 1, size: 1 }), 15);
	// Large creature at (2,2) occupies 2..3; target at (5,3) is 2 squares from its edge.
	assert.equal(distanceFeet({ x: 2, y: 2, size: 2 }, { x: 5, y: 3, size: 1 }), 10);
	assert.equal(sizeSquares("huge"), 3);
});

test("findPath goes around a wall and diagonals cost 5 ft", () => {
	const map = makeMap([
		".....",
		".###.",
		".....",
	]);
	const { encounter, map: m } = setup(map, { x: 2, y: 0 });
	const p = findPath(encounter, m, "pc1", { x: 2, y: 2 });
	assert.ok(p);
	// (2,0)→(1,0)? no: best is (3,0)/(1,0) then diagonal down… 4 steps * 5 ft
	assert.equal(p.cost, 20);
	assert.deepEqual(p.path[p.path.length - 1], { x: 2, y: 2 });
	const straight = findPath(encounter, m, "pc1", { x: 4, y: 0 });
	assert.equal(straight?.cost, 10);
});

test("difficult terrain costs double; budget limits reachability", () => {
	const map = makeMap([
		".,,,.",
		".....",
	]);
	const { encounter, map: m } = setup(map, { x: 0, y: 0 });
	// Through the rubble row: 5 + 10 + 10 + 10... vs going around row 1 (5,5,5,5 = 20)
	const p = findPath(encounter, m, "pc1", { x: 4, y: 0 });
	assert.equal(p?.cost, 20);
	const onRubble = findPath(encounter, m, "pc1", { x: 2, y: 0 });
	assert.equal(onRubble?.cost, 15); // diagonal 5 + rubble 10
	assert.equal(findPath(encounter, m, "pc1", { x: 4, y: 0 }, 15), null);
});

test("tall grass, mud and shallow water are difficult; deep water and closed doors block", () => {
	const map = makeMap([
		".gmw~D.",
	]);
	const { encounter, map: m } = setup(map, { x: 0, y: 0 });
	assert.equal(findPath(encounter, m, "pc1", { x: 3, y: 0 })?.cost, 30);
	assert.equal(findPath(encounter, m, "pc1", { x: 6, y: 0 }), null);
});

test("reachable highlights squares within movement, excluding occupied ones", () => {
	const { encounter, map } = setup(openMap(20, 20), { x: 10, y: 10 }, [{ at: { x: 11, y: 10 } }]);
	const sq = reachable(encounter, map, "pc1");
	// 30 ft = 6 squares Chebyshev → 13x13 - self, minus goblin square
	assert.equal(sq.length, 13 * 13 - 1 - 1);
	assert.ok(!sq.some((s) => s.x === 11 && s.y === 10));
	assert.ok(sq.every((s) => s.cost <= 30));
});

test("hostile squares cannot be passed; allies can be passed but not ended on", () => {
	const map = makeMap([
		"#####",
		"..x..",
		"#####",
	].map((r) => r.replace("x", ".")));
	const blocked = setup(map, { x: 0, y: 1 }, [{ at: { x: 2, y: 1 }, stats: makeMonster({ size: "medium" }) }]);
	assert.equal(findPath(blocked.encounter, blocked.map, "pc1", { x: 4, y: 1 }), null);
	const ally = setup(map, { x: 0, y: 1 }, [{ at: { x: 2, y: 1 }, side: "party", stats: makeMonster({ size: "medium" }) }]);
	assert.equal(findPath(ally.encounter, ally.map, "pc1", { x: 4, y: 1 })?.cost, 20);
	assert.equal(findPath(ally.encounter, ally.map, "pc1", { x: 2, y: 1 }), null);
});

test("large creatures need 2x2 room", () => {
	const map = makeMap([
		"......",
		"......",
		"###.##",
		"......",
		"......",
	]);
	const { encounter, map: m } = setup(map, { x: 0, y: 4 }, [{ at: { x: 0, y: 0 }, stats: makeBear() }]);
	assert.equal(findPath(encounter, m, "m0", { x: 3, y: 3 }), null);
	assert.ok(findPath(encounter, m, "pc1", { x: 3, y: 0 }));
});

test("line of sight is blocked by walls and closed doors, not open doors", () => {
	const map = makeMap([
		"..#..",
		"..D..",
		"..d..",
	]);
	assert.equal(hasLineOfSight(map, { x: 0, y: 0 }, { x: 4, y: 0 }), false);
	assert.equal(hasLineOfSight(map, { x: 0, y: 1 }, { x: 4, y: 1 }), false);
	assert.equal(hasLineOfSight(map, { x: 0, y: 2 }, { x: 4, y: 2 }), true);
	assert.equal(bresenham({ x: 0, y: 0 }, { x: 3, y: 1 }).length, 4);
});

test("cover: none in the open, half/three-quarters behind walls, total behind a full wall", () => {
	const open = setup(openMap(10, 10), { x: 0, y: 0 }, [{ at: { x: 5, y: 0 } }]);
	assert.equal(coverBetween(open.encounter, open.map, "pc1", "m0"), "none");

	const full = setup(makeMap(["...#...", "...#...", "...#..."]), { x: 0, y: 1 }, [{ at: { x: 6, y: 1 } }]);
	assert.equal(coverBetween(full.encounter, full.map, "pc1", "m0"), "total");

	// Low wall segment directly in front of the target partially blocks.
	const partial = setup(makeMap([".......", ".....#.", "......."]), { x: 0, y: 2 }, [{ at: { x: 6, y: 1 } }]);
	const c = coverBetween(partial.encounter, partial.map, "pc1", "m0");
	assert.ok(c === "half" || c === "three_quarters", c);

	// A creature in between gives half cover.
	const crowd = setup(openMap(10, 3), { x: 0, y: 1 }, [{ at: { x: 4, y: 1 } }, { at: { x: 2, y: 1 } }]);
	assert.equal(coverBetween(crowd.encounter, crowd.map, "pc1", "m0"), "half");
});

test("area templates: sphere, cube, cone and line", () => {
	const map = openMap(30, 30);
	const sphere = areaSquares(map, { shape: "sphere", size: 20, point: { x: 15, y: 15 } });
	assert.ok(sphere.length > 40 && sphere.length < 60, `sphere ${sphere.length}`);
	assert.ok(sphere.some((p) => p.x === 19 && p.y === 15));
	assert.ok(!sphere.some((p) => p.x === 19 && p.y === 19));

	const cube = areaSquares(map, { shape: "cube", size: 15, point: { x: 10, y: 10 } });
	assert.equal(cube.length, 9);

	const caster = { x: 5, y: 5, size: 1 };
	const selfCube = areaSquares(map, { shape: "cube", size: 15, point: { x: 9, y: 5 }, caster, fromCaster: true });
	assert.equal(selfCube.length, 9);
	assert.ok(selfCube.every((p) => p.x >= 6 && p.x <= 8));

	const cone = areaSquares(map, { shape: "cone", size: 15, point: { x: 10, y: 5 }, caster, fromCaster: true });
	assert.ok(cone.some((p) => p.x === 6 && p.y === 5));
	assert.ok(cone.some((p) => p.x === 8 && p.y === 6));
	assert.ok(cone.every((p) => p.x > 5 && p.x <= 8));
	assert.ok(!cone.some((p) => p.x === 6 && p.y === 6));

	const line = areaSquares(map, { shape: "line", size: 30, point: { x: 20, y: 5 }, caster, fromCaster: true });
	assert.equal(line.length, 6);
	assert.ok(line.every((p) => p.y === 5));
});

test("areas are stopped by walls", () => {
	const map = makeMap([
		".......",
		"...#...",
		".......",
	]);
	const line = areaSquares(map, { shape: "line", size: 30, point: { x: 6, y: 1 }, caster: { x: 0, y: 1, size: 1 }, fromCaster: true });
	assert.deepEqual(line.map((p) => p.x), [1, 2]);
});

test("scripted rng sanity", () => {
	const r = new ScriptedRng([3, 4]);
	assert.equal(r.die(6), 3);
	assert.equal(r.die(6), 4);
	assert.ok(r.die(6) >= 1);
});

test("cover: grazing along a corridor wall gives no cover", () => {
	const r = setup(makeMap(["#######", ".......", "......."]), { x: 0, y: 1 }, [{ at: { x: 6, y: 1 } }]);
	assert.equal(coverBetween(r.encounter, r.map, "pc1", "m0"), "none");
});
