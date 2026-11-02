// Validates lib/srd/data/homebrew/<class>.json files. Usage: node scripts/homebrew-check.mjs [class ...]
import fs from "node:fs";
const D = "lib/srd/data";
const classes = JSON.parse(fs.readFileSync(`${D}/classes.json`, "utf8"));
const srdSubs = JSON.parse(fs.readFileSync(`${D}/subclasses.json`, "utf8"));
const srdFeatures = JSON.parse(fs.readFileSync(`${D}/features.json`, "utf8"));
const spells = new Set(JSON.parse(fs.readFileSync(`${D}/spells.json`, "utf8")).map((s) => s.index));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(`${D}/homebrew`).map((f) => f.replace(".json", ""));
const allFeatureIdx = new Set(srdFeatures.map((f) => f.index));
const allSubIdx = new Set(srdSubs.map((s) => s.index));
let errors = 0;
const err = (m) => { errors++; console.log("  ✖", m); };
const FORMULA = /^(\d+|prof|str|dex|con|int|wis|cha|level(\/\d+)?)(\+(\d+|prof|str|dex|con|int|wis|cha|level(\/\d+)?))*$/;
for (const id of ids) {
	const file = `${D}/homebrew/${id}.json`;
	let data;
	try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.log(`${id}: invalid JSON ${e.message}`); errors++; continue; }
	console.log(`${id}: ${data.subclasses.length} subclasses, ${data.features.length} features`);
	const cls = classes.find((c) => c.index === id);
	const srdLevels = srdSubs.find((s) => s.classId === id).features.map((f) => f.level).join(",");
	const feats = new Map();
	for (const f of data.features) {
		if (allFeatureIdx.has(f.index) || feats.has(f.index)) err(`duplicate feature index ${f.index}`);
		feats.set(f.index, f);
		for (const k of ["index", "name", "classId", "subclassId", "level", "description"]) if (f[k] === undefined || f[k] === "") err(`${f.index}: missing ${k}`);
		if (f.classId !== id) err(`${f.index}: classId should be ${id}`);
		if (f.description && f.description.length < 120) err(`${f.index}: description too short (${f.description.length} chars)`);
		if (f.uses) {
			if (!["short", "long", "dawn"].includes(f.uses.recharge)) err(`${f.index}: bad recharge`);
			if (typeof f.uses.max !== "number" && !FORMULA.test(String(f.uses.max))) err(`${f.index}: bad uses.max formula ${f.uses.max}`);
		}
	}
	for (const s of data.subclasses) {
		if (allSubIdx.has(s.index)) err(`duplicate subclass index ${s.index}`);
		allSubIdx.add(s.index);
		for (const k of ["index", "classId", "name", "flavor", "description", "features", "spells", "specific"]) if (s[k] === undefined) err(`${s.index}: missing ${k}`);
		if (s.classId !== id) err(`${s.index}: classId should be ${id}`);
		if (s.flavor !== cls.subclassFlavor) err(`${s.index}: flavor should be "${cls.subclassFlavor}"`);
		const lv = s.features.map((f) => f.level).join(",");
		if (lv !== srdLevels) err(`${s.index}: feature levels ${lv} should match the class's subclass levels ${srdLevels}`);
		for (const g of s.features) for (const fi of g.features) {
			const f = feats.get(fi);
			if (!f) err(`${s.index}: feature ${fi} not defined`);
			else if (f.subclassId !== s.index || f.level !== g.level) err(`${fi}: subclassId/level mismatch`);
		}
		for (const sp of s.spells) if (!spells.has(sp.spell)) err(`${s.index}: unknown SRD spell ${sp.spell}`);
	}
	for (const f of data.features) if (!data.subclasses.some((s) => s.index === f.subclassId)) err(`${f.index}: subclass ${f.subclassId} not in file`);
}
console.log(errors ? `${errors} error(s)` : "OK");
process.exit(errors ? 1 : 0);
