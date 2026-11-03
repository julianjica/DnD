import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "../lib/maps/world";
import { declutter, exitPoint, inView, projectWorld, regionView } from "../lib/maps/region";
import { mapDistance } from "../lib/maps/geography";

test("region view frames the party and nearby discovered places", () => {
	const world = generateWorld({ seed: 4242, biome: "temperate" });
	const here = world.locations.find((l) => l.id === world.currentLocationId)!;
	const v = regionView(world);
	assert.ok(v.s < 1 && v.s >= 0.07);
	assert.ok(v.x0 >= 0 && v.y0 >= 0 && v.x0 + v.s <= 1 + 1e-9 && v.y0 + v.s <= 1 + 1e-9);
	const proj = projectWorld(world, v, "Environs");
	const ph = proj.locations.find((l) => l.id === here.id)!;
	assert.ok(inView(ph, 0.1), "party well inside the frame");
	for (const l of world.locations) if (l.discovered && mapDistance(l, here) <= 0.1 && v.s < 0.25) assert.ok(inView(proj.locations.find((p) => p.id === l.id)!, 0));
	assert.equal(proj.name, "Environs");
});

test("declutter separates coincident places and keeps the pinned one still", () => {
	const mk = (id: string, x: number, y: number) => ({ id, name: id, kind: "landmark" as const, x, y, discovered: true, visited: false, mapIds: [] as string[] });
	const locs = [mk("a", 0.5, 0.5), mk("b", 0.5, 0.5), mk("c", 0.501, 0.5)];
	const pos = declutter(locs, 0.05, "a");
	assert.deepEqual(pos.get("a"), { x: 0.5, y: 0.5 });
	const pts = [...pos.values()];
	for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(mapDistance(pts[i], pts[j]) > 0.05 * 1.5 * 0.9);
});

test("exitPoint lands on the frame edge toward the outside place", () => {
	const p = exitPoint({ x: 0.5, y: 0.5 }, { x: 2, y: 0.5 }, 0.05);
	assert.ok(Math.abs(p.x - 0.95) < 0.01 && Math.abs(p.y - 0.5) < 1e-6);
});
