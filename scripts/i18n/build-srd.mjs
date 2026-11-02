// Merges lib/srd/es/NN.json chunks into lib/srd/es/dict.json (loaded lazily by the UI).
import fs from "node:fs";
const dir = "lib/srd/es";
const out = {};
for (const f of fs.readdirSync(dir).filter((f) => /^(\d+|hb)\.json$/.test(f)).sort()) Object.assign(out, JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")));
fs.writeFileSync(`${dir}/dict.json`, JSON.stringify(out));
console.log(`dict.json: ${Object.keys(out).length} strings`);
