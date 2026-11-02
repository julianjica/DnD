// Merges scripts/scenes/manifest-*.json into lib/art/backdrops.json (drops entries whose file is missing)
// and regenerates the painting credits section of ASSETS.md.
import fs from "node:fs";
const all = [];
for (const f of fs.readdirSync("scripts/scenes").filter((f) => /^manifest-.*\.json$/.test(f)).sort()) {
	for (const e of JSON.parse(fs.readFileSync(`scripts/scenes/${f}`, "utf8"))) {
		if (!fs.existsSync(`public/${e.file}`)) { console.warn("missing", e.file); continue; }
		all.push(e);
	}
}
fs.writeFileSync("lib/art/backdrops.json", JSON.stringify(all, null, 1));
const byKind = {};
for (const e of all) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
console.log(`backdrops.json: ${all.length} paintings`, byKind);
const credits = ["## Scene paintings (public domain, via Wikimedia Commons)", "", "| File | Title | Artist | Year | Source |", "|---|---|---|---|---|",
	...all.map((e) => `| ${e.file} | ${String(e.title).replace(/\|/g, "/")} | ${e.artist} | ${e.year ?? ""} | ${e.source} |`), ""].join("\n");
const assets = fs.existsSync("ASSETS.md") ? fs.readFileSync("ASSETS.md", "utf8") : "# Assets\n";
const marker = "## Scene paintings (public domain, via Wikimedia Commons)";
const i = assets.indexOf(marker);
const next = i >= 0 ? assets.indexOf("\n## ", i + marker.length) : -1;
const out = i < 0 ? `${assets.trimEnd()}\n\n${credits}` : assets.slice(0, i) + credits + (next >= 0 ? assets.slice(next + 1) : "");
fs.writeFileSync("ASSETS.md", out);
