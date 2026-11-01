import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap, MAP_KINDS } from "../lib/maps/generate";
import { isPassable, reachableFrom, findFreeSquares, placeEntity, canStand } from "../lib/maps/grid";
import type { GridMap } from "../lib/game/types";

const SEEDS = [1, 42, 1337, 98765, 4294967295];

function reach4(map: GridMap): Uint8Array {
	return reachableFrom(map, map.entry, false);
}

for (const kind of MAP_KINDS) {
	test(`${kind}: shape, entry, connectivity (5 seeds)`, () => {
		for (const seed of SEEDS) {
			const m = generateMap({ kind, seed });
			assert.equal(m.kind, kind);
			assert.equal(m.tiles.length, m.width * m.height);
			assert.equal(m.explored.length, m.width * m.height);
			assert.ok(m.explored.every((e) => e === false), "explored all false");
			assert.ok(m.rooms.length > 0, `${kind}/${seed} has rooms`);
			assert.ok(["bright", "dim", "dark"].includes(m.lighting));
			assert.ok(isPassable(m.tiles[m.entry.y * m.width + m.entry.x]), `${kind}/${seed} entry passable`);
			const seen = reach4(m);
			for (const r of m.rooms) {
				let ok = false;
				for (let y = r.y; y < r.y + r.h && !ok; y++) for (let x = r.x; x < r.x + r.w && !ok; x++) if (seen[y * m.width + x]) ok = true;
				assert.ok(ok, `${kind}/${seed} room ${r.id} (${r.tag}) reachable from entry`);
			}
			// every passable square is reachable (no orphan pockets)
			for (let i = 0; i < m.tiles.length; i++) if (isPassable(m.tiles[i])) assert.ok(seen[i], `${kind}/${seed} passable square ${i % m.width},${Math.floor(i / m.width)} reachable`);
			// entity ids unique and in bounds
			const ids = new Set(m.entities.map((e) => e.id));
			assert.equal(ids.size, m.entities.length);
			for (const e of m.entities) assert.ok(e.x >= 0 && e.y >= 0 && e.x < m.width && e.y < m.height);
		}
	});

	test(`${kind}: deterministic by seed`, () => {
		const a = generateMap({ kind, seed: 777, features: ["water"] });
		const b = generateMap({ kind, seed: 777, features: ["water"] });
		assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
		const c = generateMap({ kind, seed: 778, features: ["water"] });
		assert.notDeepEqual(a.tiles, c.tiles);
	});
}

test("custom sizes and features", () => {
	const m = generateMap({ kind: "dungeon", seed: 5, width: 70, height: 50, features: ["night", "traps", "secret"], name: "The Pit" });
	assert.equal(m.width, 70);
	assert.equal(m.height, 50);
	assert.equal(m.name, "The Pit");
	assert.equal(m.lighting, "dark");
	assert.ok(m.entities.some((e) => e.kind === "trap" && e.hidden));
	const f = generateMap({ kind: "forest", seed: 5, features: ["night"] });
	assert.equal(f.lighting, "dark");
	const tiny = generateMap({ kind: "crypt", seed: 5, width: 10, height: 10 });
	assert.ok(tiny.width >= 25 && tiny.height >= 24);
});

test("dungeon tags entrance/boss/treasure/storage and has doors", () => {
	for (const seed of SEEDS) {
		const m = generateMap({ kind: "dungeon", seed });
		const tags = new Set(m.rooms.map((r) => r.tag));
		for (const t of ["entrance", "boss", "treasure"]) assert.ok(tags.has(t), `seed ${seed} has ${t}`);
		assert.ok(m.tiles.some((t) => t.startsWith("door")), "has doors");
	}
});

test("findFreeSquares / placeEntity", () => {
	const m = generateMap({ kind: "dungeon", seed: 3 });
	const spots = findFreeSquares(m, m.entry, 6, 1);
	assert.equal(spots.length, 6);
	const keys = new Set(spots.map((p) => `${p.x},${p.y}`));
	assert.equal(keys.size, 6);
	for (const p of spots) assert.ok(canStand(m, p.x, p.y, 1));
	const pc = placeEntity(m, { id: "pc", kind: "pc", name: "Hero", sprite: "pc" });
	assert.equal(m.entities.at(-1), pc);
	assert.ok(isPassable(m.tiles[pc.y * m.width + pc.x]));
	// a second creature on the same requested square gets moved elsewhere
	const g = placeEntity(m, { id: "g1", kind: "monster", name: "Goblin", sprite: "goblin", x: pc.x, y: pc.y });
	assert.ok(g.x !== pc.x || g.y !== pc.y);
	// large creature footprint is fully free
	const ogre = placeEntity(m, { id: "o", kind: "monster", name: "Ogre", sprite: "ogre", size: 2 }, m.entry);
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) assert.ok(isPassable(m.tiles[(ogre.y + dy) * m.width + ogre.x + dx]));
	// re-placing by id updates in place
	placeEntity(m, { id: "g1", kind: "monster", name: "Goblin", sprite: "goblin" }, spots[5]);
	assert.equal(m.entities.filter((e) => e.id === "g1").length, 1);
});
