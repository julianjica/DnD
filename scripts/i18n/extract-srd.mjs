// Collects every player-facing English string in lib/srd/data into translation
// chunks: scripts/i18n/srd-src/NN.json = { "English text": "" }.
// Translations live in lib/srd/es/NN.json (same keys → Spanish).
import fs from "node:fs";
import path from "node:path";

const DATA = "lib/srd/data";
const OUT = "scripts/i18n/srd-src";
const TEXT_KEYS = new Set(["name", "description", "higherLevel", "material", "castingTime", "range", "duration", "sizeDescription", "age", "alignment", "languageDescription", "desc", "label", "flavor", "subclassFlavor", "rarity", "personalityTraits", "ideals", "bonds", "flaws", "type", "script"]);
const SKIP_FILE_KEYS = { monsters: new Set(["name"]) }; // monsters: names only
const BUDGET = 70_000;

const seen = new Map(); // text → order
function add(s) {
	if (typeof s !== "string") return;
	const t = s.trim();
	if (!t || /^[\d\s+\-dx×/().,%]+$/i.test(t)) return;
	if (!seen.has(t)) seen.set(t, seen.size);
}
function walk(v, file, key) {
	if (Array.isArray(v)) return v.forEach((x) => walk(x, file, key));
	if (v && typeof v === "object") {
		for (const [k, x] of Object.entries(v)) {
			if (file === "monsters" && v.index !== undefined && !SKIP_FILE_KEYS.monsters.has(k)) continue;
			walk(x, file, k);
		}
		return;
	}
	if (TEXT_KEYS.has(key)) add(v);
}
const order = ["spells", "features", "magic-items", "equipment", "species", "backgrounds", "classes", "subclasses", "feats", "conditions", "skills", "damage-types", "magic-schools", "weapon-properties", "languages", "monsters"];
for (const f of order) walk(JSON.parse(fs.readFileSync(path.join(DATA, `${f}.json`), "utf8")), f, "");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let chunk = {}, size = 0, n = 0, total = 0;
const flush = () => {
	if (!Object.keys(chunk).length) return;
	fs.writeFileSync(path.join(OUT, `${String(n).padStart(2, "0")}.json`), JSON.stringify(chunk, null, 1));
	console.log(`chunk ${n}: ${Object.keys(chunk).length} strings, ${size} chars`);
	n++; chunk = {}; size = 0;
};
for (const t of seen.keys()) {
	if (size + t.length > BUDGET) flush();
	chunk[t] = ""; size += t.length; total += t.length;
}
flush();
console.log(`total ${seen.size} strings, ${total} chars, ${n} chunks`);
