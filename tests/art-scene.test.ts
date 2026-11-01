import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderScene } from "../components/art/SceneArt";
import { Portrait } from "../components/art/Portrait";
import { MOODS, SCENE_KINDS, TIMES, WEATHERS, normalizeProps, sceneSeed } from "../lib/art/scene";
import { portraitOptions, randomPortrait, SPECIES_IDS } from "../lib/art/portrait";
import { hashString } from "../lib/art/rand";
import { Rng } from "../lib/rules/dice";
import type { SceneState } from "../lib/game/types";

const svg = (s: SceneState, prefix = "t") => renderToStaticMarkup(createElement("div", null, renderScene(s, prefix)));

test("title hash is stable", () => {
	assert.equal(hashString("The Whispering Wood"), hashString("The Whispering Wood"));
	assert.notEqual(sceneSeed({ title: "a", kind: "forest" }), sceneSeed({ title: "b", kind: "forest" }));
	assert.equal(hashString(""), 0x811c9dc5);
});

test("every kind × time renders deterministically", () => {
	for (const kind of SCENE_KINDS) {
		for (const timeOfDay of TIMES) {
			const s: SceneState = { title: `T ${kind}`, kind, timeOfDay, weather: "clear", mood: "calm", npcIds: [], props: [] };
			const a = svg(s);
			assert.ok(a.includes("<svg"), kind);
			assert.ok(!a.includes("NaN"), `NaN in ${kind}/${timeOfDay}`);
			assert.equal(a, svg(s), `non-deterministic ${kind}/${timeOfDay}`);
		}
	}
});

test("all weathers, moods and props render", () => {
	const props = ["campfire", "altar", "statue", "cart", "tents", "torches", "Barrel", "wagon", "unknown-thing"];
	for (const weather of WEATHERS)
		for (const mood of MOODS) {
			const out = svg({ title: "w", kind: "plains", timeOfDay: "night", weather, mood, npcIds: [], props });
			assert.ok(!out.includes("NaN"), `${weather}/${mood}`);
		}
	assert.deepEqual(normalizeProps(["Barrel", "wagon", "unknown-thing", "standing stones"]), ["barrels", "cart", "standing_stones"]);
});

test("defs ids are scoped per prefix and every url(#…) reference resolves", () => {
	const out = svg({ title: "x", kind: "dungeon", timeOfDay: "day", weather: "rain", mood: "eerie", npcIds: [], props: ["portal", "crystals"] }, "pfx");
	const ids = new Set([...out.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
	for (const m of out.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.has(m[1]), `dangling ref ${m[1]}`);
	for (const id of ids) assert.ok(id.startsWith("pfx-"), `unscoped id ${id}`);
});

test("randomPortrait is deterministic and uses known options", () => {
	for (const sp of SPECIES_IDS) {
		const a = randomPortrait(new Rng(42), sp);
		const b = randomPortrait(new Rng(42), sp);
		assert.deepEqual(a, b);
		assert.ok(portraitOptions.hairStyle.includes(a.hairStyle), a.hairStyle);
		assert.ok(portraitOptions.skinTone.includes(a.skinTone), a.skinTone);
		assert.ok(portraitOptions.background.includes(a.background));
		if (a.facialHair) assert.ok(portraitOptions.facialHair.includes(a.facialHair));
		if (a.accessory) assert.ok(portraitOptions.accessory.includes(a.accessory));
		for (const f of a.features) assert.ok(portraitOptions.features.includes(f), f);
	}
	assert.ok(randomPortrait(new Rng(1), "tiefling").features.some((f) => f.includes("horns")));
	assert.ok(randomPortrait(new Rng(1), "dragonborn").features.includes("scales"));
	assert.ok(randomPortrait(new Rng(1), "half-orc").features.includes("tusks"));
});

test("portraits render for many seeds without NaN", () => {
	const rng = new Rng(7);
	for (let i = 0; i < 60; i++) {
		const sp = SPECIES_IDS[i % SPECIES_IDS.length];
		const out = renderToStaticMarkup(createElement(Portrait, { spec: randomPortrait(rng, sp), speciesId: sp, name: "Test" }));
		assert.ok(out.startsWith("<svg"));
		assert.ok(!out.includes("NaN"), `NaN for ${sp}`);
	}
});
