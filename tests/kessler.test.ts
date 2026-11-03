import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-kessler-"));
process.env.DH_DATA_DIR = dir;
after(() => fs.rmSync(dir, { recursive: true, force: true }));

let m: { createGame: typeof import("../lib/dm/newgame").createGame; defaultSettings: typeof import("../components/setup/wizardState").defaultSettings; kesslerFalls: typeof import("../lib/maps/kessler").kesslerFalls };
before(async () => {
	m = { createGame: (await import("../lib/dm/newgame")).createGame, defaultSettings: (await import("../components/setup/wizardState")).defaultSettings, kesslerFalls: (await import("../lib/maps/kessler")).kesslerFalls };
});

test("Kessler Falls: every route joins known places, names in both languages", () => {
	for (const lang of ["en", "es"] as const) {
		const w = m.kesslerFalls(1, lang);
		const ids = new Set(w.locations.map((l) => l.id));
		for (const r of w.routes) assert.ok(ids.has(r.from) && ids.has(r.to), `${r.from}->${r.to}`);
		assert.ok(w.locations.find((l) => l.id === w.currentLocationId)?.visited);
	}
	assert.equal(m.kesslerFalls(1, "es").locations.find((l) => l.id === "loc-kf-downtown")?.name, "Centro de Kessler Falls");
});

test("a zombie campaign starts in Kessler Falls on the outbreak night", () => {
	const settings = m.defaultSettings();
	settings.world.preset = "zombie_outbreak";
	const st = m.createGame({ settings, character: { name: "Sam", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: { method: "standard_array", scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } } } });
	assert.equal(st.world.name, "Kessler Falls");
	assert.equal(st.world.currentLocationId, "loc-kf-downtown");
	assert.deepEqual(st.time, { day: 1, hour: 21, minute: 0 });
	assert.equal(st.scene.timeOfDay, "night");
});
