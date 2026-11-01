import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AMBIENCE_TRACKS, SFX_NAMES, audioAssetPaths, getAmbienceEngine } from "../lib/audio/ambience";

const ROOT = join(process.cwd(), "public/assets/audio");

test("every referenced audio file is bundled", () => {
	for (const p of audioAssetPaths()) assert.ok(existsSync(join(ROOT, p)), `missing ${p}`);
});

test("bundled audio stays under 25MB and uses ogg/mp3", () => {
	let total = 0;
	const walk = (d: string) => {
		for (const f of readdirSync(d)) {
			const full = join(d, f);
			if (statSync(full).isDirectory()) walk(full);
			else {
				assert.match(f, /\.(ogg|mp3)$/);
				total += statSync(full).size;
			}
		}
	};
	walk(ROOT);
	assert.ok(total < 25 * 1024 * 1024, `audio is ${total} bytes`);
});

test("catalogs and SSR safety", () => {
	assert.equal(AMBIENCE_TRACKS.length, 15);
	assert.ok(SFX_NAMES.includes("death") && SFX_NAMES.includes("levelup"));
	assert.equal(getAmbienceEngine(), null);
});
