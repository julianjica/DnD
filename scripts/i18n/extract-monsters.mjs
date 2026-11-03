// Monster stat-block text (types, alignments, senses, languages, traits and
// actions) for the creature hover card → scripts/i18n/srd-src/mN.json.
// Translations go to lib/srd/es/mN.json (merged into dict.json by build-srd).
import fs from "node:fs";
import path from "node:path";

const OUT = "scripts/i18n/srd-src";
const BUDGET = 58_000;
const known = JSON.parse(fs.readFileSync("lib/srd/es/dict.json", "utf8"));
const monsters = JSON.parse(fs.readFileSync("lib/srd/data/monsters.json", "utf8"));
const list = Array.isArray(monsters) ? monsters : Object.values(monsters);
const seen = new Set();
const add = (s) => {
	if (typeof s !== "string") return;
	const t = s.trim();
	if (t && !known[t] && !/^[\d\s+\-dx×/().,%]+$/i.test(t)) seen.add(t);
};
for (const m of list) {
	add(m.type); add(m.alignment); add(m.senses); add(m.languages);
	for (const g of ["traits", "actions", "bonusActions", "reactions", "legendaryActions"]) for (const t of m[g] ?? []) { add(t.name); add(t.description); }
}
for (const f of fs.readdirSync(OUT).filter((f) => /^m\d+\.json$/.test(f))) fs.rmSync(path.join(OUT, f));
let chunk = {}, size = 0, n = 0, total = 0;
const flush = () => {
	if (!Object.keys(chunk).length) return;
	fs.writeFileSync(path.join(OUT, `m${n}.json`), JSON.stringify(chunk, null, 1));
	console.log(`m${n}: ${Object.keys(chunk).length} strings, ${size} chars`);
	n++; chunk = {}; size = 0;
};
for (const t of seen) {
	if (size + t.length > BUDGET) flush();
	chunk[t] = ""; size += t.length; total += t.length;
}
flush();
console.log(`total ${seen.size} strings, ${total} chars`);
