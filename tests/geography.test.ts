import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld, isLand, worldTerrain, mountainLine } from "../lib/maps/world";
import { BEARING, angleDiff, bearingOf, directionFromText, distanceForDays, mapDistance, placeFor, reconcileWorld, terrainFor, addTerrainFeature } from "../lib/maps/geography";
import { Rng } from "../lib/rules/dice";

test("reads directions and terrain in English and Spanish", () => {
	assert.equal(directionFromText("Cañones barridos por tormentas al noreste."), "northeast");
	assert.equal(directionFromText("este camino lleva al sur"), "south");
	assert.equal(directionFromText("lies to the north-west"), "northwest");
	assert.equal(terrainFor("village", "A marsh-edge village"), "marsh");
	assert.equal(terrainFor("castle", "Fortaleza al norte del pantano"), undefined);
	assert.equal(terrainFor("swamp"), "marsh");
});

test("placeFor honors direction and travel time, on land", () => {
	for (const seed of [3, 11, 42, 99]) {
		const w = generateWorld({ seed, biome: "temperate" });
		const start = w.locations[0];
		for (const dir of ["north", "northeast", "east", "south", "west"] as const) {
			const p = placeFor(w, new Rng(seed), { anchor: start, days: 2, direction: dir }, w.locations);
			assert.ok(isLand(w, p.x, p.y));
			// Direction is kept (within 45°) unless the sea forces a closer spot in the same cone.
			assert.ok(angleDiff(bearingOf(start, p), BEARING[dir]) < Math.PI / 3, `${seed} ${dir}`);
			assert.ok(mapDistance(start, p) <= distanceForDays(2) * 1.25);
		}
	}
});

test("reconcile moves a 'northeast' place that sits northwest", () => {
	const w = generateWorld({ seed: 7, biome: "temperate" });
	const start = w.locations[0];
	const far = w.locations[3];
	Object.assign(far, { discovered: true, description: "Storm-swept canyons to the northeast.", x: Math.max(0.1, start.x - 0.12), y: Math.max(0.1, start.y - 0.12) });
	w.routes.push({ id: "r", from: start.id, to: far.id, kind: "trail", travelDays: 2, discovered: true });
	assert.equal(reconcileWorld(w), true);
	assert.ok(angleDiff(bearingOf(start, far), BEARING.northeast) < Math.PI / 3);
	assert.equal(reconcileWorld(w), false);
});

test("marsh features make low, wet land without flooding it", () => {
	const w = generateWorld({ seed: 5, biome: "temperate" });
	const l = w.locations[0];
	const before = worldTerrain(w).sample(l.x, l.y);
	addTerrainFeature(w, { terrain: "marsh", x: l.x, y: l.y, r: 0.05 });
	const after = worldTerrain(w).sample(l.x, l.y);
	assert.ok(after.moisture > 0.85 && after.moisture >= before.moisture);
	assert.ok(after.elevation >= w.terrain.seaLevel && after.elevation < mountainLine(w.terrain.seaLevel));
});
