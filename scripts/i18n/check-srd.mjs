// Validates lib/srd/es/NN.json against scripts/i18n/srd-src/NN.json:
// same keys, non-empty values, dice/number tokens preserved.
// Usage: node scripts/i18n/check-srd.mjs [NN ...]
import fs from "node:fs";
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync("scripts/i18n/srd-src").map((f) => f.replace(".json", ""));
let bad = 0;
const dice = (s) => (s.match(/\d+d\d+/g) ?? []).sort().join(",");
for (const id of ids) {
	const src = JSON.parse(fs.readFileSync(`scripts/i18n/srd-src/${id}.json`, "utf8"));
	const p = `lib/srd/es/${id}.json`;
	if (!fs.existsSync(p)) { console.log(`${id}: MISSING ${p}`); bad++; continue; }
	let es;
	try { es = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { console.log(`${id}: invalid JSON: ${e.message}`); bad++; continue; }
	const miss = Object.keys(src).filter((k) => typeof es[k] !== "string" || !es[k].trim());
	const extra = Object.keys(es).filter((k) => !(k in src));
	const diceBad = Object.keys(src).filter((k) => es[k] && dice(k) !== dice(es[k]));
	if (miss.length || extra.length || diceBad.length) bad++;
	console.log(`${id}: ${Object.keys(src).length} keys, missing ${miss.length}, extra ${extra.length}, dice mismatch ${diceBad.length}`);
	for (const k of [...miss.slice(0, 3), ...extra.slice(0, 3), ...diceBad.slice(0, 3)]) console.log("   ", JSON.stringify(k.slice(0, 90)));
}
process.exit(bad ? 1 : 0);
