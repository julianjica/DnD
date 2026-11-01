import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, worldTerrain } from "../lib/maps/world";

test("world: deterministic, locations on land, connected routes", () => {
	for (const biome of ["temperate", "arid", "frozen", "tropical", "volcanic", "mixed"] as const) {
		const w = generateWorld({ seed: 99, biome });
		assert.deepEqual(w, generateWorld({ seed: 99, biome }));
		assert.ok(w.locations.length >= 3);
		const T = worldTerrain(w);
		for (const l of w.locations) {
			assert.ok(l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1);
			assert.ok(T.sample(l.x, l.y).elevation >= w.terrain.seaLevel, `${biome} ${l.name} on land`);
		}
		assert.equal(w.currentLocationId, w.locations[0].id);
		assert.ok(w.locations[0].discovered && w.locations[0].visited);
		// routes connect everything
		const adj = new Map<string, string[]>();
		for (const r of w.routes) {
			adj.set(r.from, [...(adj.get(r.from) ?? []), r.to]);
			adj.set(r.to, [...(adj.get(r.to) ?? []), r.from]);
			assert.ok(r.travelDays >= 1);
		}
		const seen = new Set([w.locations[0].id]);
		const q = [w.locations[0].id];
		while (q.length) for (const n of adj.get(q.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
		assert.equal(seen.size, w.locations.length);
	}
});

test("world: custom locations keep names/kinds", () => {
	const w = generateWorld({ seed: 7, biome: "temperate", locations: [{ name: "Phandalin", kind: "village" }, { name: "Cragmaw Hideout", kind: "cave" }, { name: "Wave Echo Cave", kind: "dungeon" }] });
	assert.deepEqual(w.locations.map((l) => l.name), ["Phandalin", "Cragmaw Hideout", "Wave Echo Cave"]);
	assert.equal(w.locations[1].kind, "cave");
});
