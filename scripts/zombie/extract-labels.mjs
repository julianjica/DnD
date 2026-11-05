// Lists every English SRD/homebrew text that The Quiet (zombie ruleset) shows
// with a modern label: class names, subclass names/flavor/descriptions, class
// and subclass feature names/descriptions, background names and features, and
// the fantasy-sounding skill names. Keys of lib/srd/data/zombie/labels.json
// must equal these texts exactly (trimmed, as rulesetText looks them up).
//
//   node scripts/zombie/extract-labels.mjs            → coverage report
//   node scripts/zombie/extract-labels.mjs --out DIR  → DIR/<group>.json work lists
//                                                       ({ key, kind, es } with the current SRD Spanish)
//   node scripts/zombie/extract-labels.mjs --check    → exit 1 if a key is missing or unknown
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

export const CLASS_IDS = ["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"];
/** Skills whose names read as fantasy; the others stay as they are. */
export const RELABELED_SKILLS = ["arcana", "religion"];

/** All label sources as [key, kind, group]; group is a class id or "common". First owner wins. */
export function labelSources() {
	const classes = read("lib/srd/data/classes.json");
	const subclasses = read("lib/srd/data/subclasses.json");
	const features = read("lib/srd/data/features.json");
	const backgrounds = read("lib/srd/data/backgrounds.json");
	const skills = read("lib/srd/data/skills.json");
	const hb = CLASS_IDS.map((c) => read(`lib/srd/data/homebrew/${c}.json`));
	const out = new Map();
	const add = (text, kind, group) => {
		const k = text?.trim();
		if (!k) return;
		if (!out.has(k)) out.set(k, { key: k, kind, group });
	};
	for (const c of classes) {
		add(c.name, "class.name", "common");
		add(c.subclassFlavor, "class.subclassFlavor", "common");
	}
	for (const b of backgrounds) {
		add(b.name, "background.name", "common");
		add(b.feature.name, "background.feature.name", "common");
		add(b.feature.description, "background.feature.description", "common");
	}
	for (const s of skills) if (RELABELED_SKILLS.includes(s.index)) add(s.name, "skill.name", "common");
	// Texts shared by several classes (Ability Score Improvement, Extra Attack, fighting styles…) go to "common".
	const allFeatures = [...features, ...hb.flatMap((h) => h.features)];
	const owners = new Map();
	for (const f of allFeatures) for (const t of [f.name, f.description]) {
		const k = t?.trim();
		if (!k) continue;
		if (!owners.has(k)) owners.set(k, new Set());
		owners.get(k).add(f.classId);
	}
	const groupOf = (text, cls) => ((owners.get(text.trim())?.size ?? 1) > 1 ? "common" : cls);
	for (const s of [...subclasses, ...hb.flatMap((h) => h.subclasses)]) {
		add(s.name, "subclass.name", s.classId);
		add(s.flavor, "subclass.flavor", "common");
		add(s.description, "subclass.description", s.classId);
	}
	for (const f of allFeatures) {
		add(f.name, "feature.name", groupOf(f.name, f.classId));
		add(f.description, "feature.description", groupOf(f.description, f.classId));
		if (f.choice?.kind === "string") for (const o of f.choice.options) add(o.name, "feature.option", f.classId);
	}
	for (const h of hb) for (const a of h.spiritAspects ?? []) {
		add(a.name, "feature.option", "barbarian");
		add(`Spirit Aspect: ${a.name}`, "feature.option", "barbarian");
		add(a.description, "feature.description", "barbarian");
	}
	return [...out.values()];
}

function main() {
	const args = process.argv.slice(2);
	const src = labelSources();
	const labels = read("lib/srd/data/zombie/labels.json");
	const keys = new Set(src.map((s) => s.key));
	const missing = { en: src.filter((s) => !(s.key in labels.en)), es: src.filter((s) => !(s.key in labels.es)) };
	const unknown = [...new Set([...Object.keys(labels.en), ...Object.keys(labels.es)])].filter((k) => !keys.has(k));
	const outIdx = args.indexOf("--out");
	if (outIdx >= 0) {
		const dir = args[outIdx + 1];
		fs.mkdirSync(dir, { recursive: true });
		const dict = read("lib/srd/es/dict.json");
		const groups = {};
		for (const s of src) (groups[s.group] ??= []).push({ key: s.key, kind: s.kind, es: dict[s.key] ?? null });
		for (const [g, list] of Object.entries(groups)) fs.writeFileSync(path.join(dir, `${g}.json`), JSON.stringify(list, null, 1));
		console.log(Object.entries(groups).map(([g, l]) => `${g}: ${l.length} (${l.reduce((n, x) => n + x.key.length, 0)} chars)`).join("\n"));
	}
	console.log(`label sources: ${src.length} · missing en ${missing.en.length} · missing es ${missing.es.length} · unknown keys ${unknown.length}`);
	if (unknown.length) console.log("unknown:", unknown.slice(0, 20));
	if (args.includes("--check") && (missing.en.length || missing.es.length || unknown.length)) {
		for (const m of missing.en.slice(0, 20)) console.log("missing en:", m.kind, m.key.slice(0, 80));
		for (const m of missing.es.slice(0, 20)) console.log("missing es:", m.kind, m.key.slice(0, 80));
		process.exit(1);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main();
