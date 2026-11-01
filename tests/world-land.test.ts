import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, isLand, landNear, repairWorld, worldTerrain } from "../lib/maps/world";
import { Rng } from "../lib/rules/dice";
import type { LocationKind } from "../lib/game/types";

const KINDS: LocationKind[] = ["ruins", "village", "coast", "swamp", "cave", "tower"];

test("landNear never lands in the sea", () => {
	for (const seed of [1, 42, 1352477995, 99991, 7]) {
		for (const biome of ["mixed", "tropical", "temperate"] as const) {
			const w = generateWorld({ seed, biome });
			const rng = new Rng(seed);
			for (let i = 0; i < 40; i++) {
				const anchor = w.locations[i % w.locations.length];
				const p = landNear(w, anchor, rng, { kind: KINDS[i % KINDS.length], minDist: 0.05, maxDist: 0.2, avoid: w.locations });
				assert.ok(isLand(w, p.x, p.y), `seed ${seed} ${biome}: (${p.x},${p.y}) is water`);
			}
		}
	}
});

test("generated worlds put every location on land", () => {
	for (const seed of [3, 5, 8, 13, 21, 34, 55]) {
		const w = generateWorld({ seed, biome: "mixed" });
		for (const l of w.locations) assert.ok(isLand(w, l.x, l.y), `${l.name} in water`);
	}
});

test("repairWorld moves sea locations ashore", () => {
	const w = generateWorld({ seed: 1352477995, biome: "mixed" });
	const T = worldTerrain(w);
	w.locations.push({ id: "x", name: "Sunk", kind: "ruins", x: 0.18, y: 0.91, discovered: true, visited: true, mapIds: [] });
	assert.ok(T.sample(0.18, 0.91).elevation < T.seaLevel);
	assert.equal(repairWorld(w), true);
	const l = w.locations.at(-1)!;
	assert.ok(isLand(w, l.x, l.y));
	assert.equal(repairWorld(w), false);
});
