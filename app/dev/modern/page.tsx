"use client";

import { useEffect, useRef } from "react";
import type { GridMap, MapEntity, PortraitSpec, Tile } from "@/lib/game/types";
import { drawMap, MODERN_FEATURE_SPRITES, type DrawKey } from "@/lib/maps/draw";
import { paintPixelScene, type Look } from "@/components/art/sprite/pixelScene";
import { MODERN_CREATURES } from "@/components/art/sprite/creatures";
import { gearFor, personLook } from "@/components/art/sprite/person";

/**
 * PREVIEW ONLY: The Quiet's modern pixel art. Two hand-drawn places painted
 * with the modern theme, every modern prop and creature, and one person per
 * profession.
 */

const DRAW_TILES = new Set<Tile>(["sand", "road", "grass", "floor", "wood_floor"]);

type Scene = { map: GridMap; looks: Record<string, Look>; time: "day" | "dusk" | "night" };

/** Draws a place; "^" squares become flat roofs (the DM legend has no roof). */
type Key = Omit<DrawKey, "kind"> & { kind?: DrawKey["kind"] | "monster" };
function place(rows: string[], key: Record<string, Key>, seed: number, lighting: GridMap["lighting"] = "bright"): GridMap {
	const w = Math.max(...rows.map((r) => r.length));
	rows.forEach((r, i) => { if (r.length !== w) console.warn(`row ${i} is ${r.length} wide, not ${w}`); });
	const roofs: number[] = [];
	const clean = rows.map((r, y) => [...r.padEnd(w, ",")].map((ch, x) => (ch === "^" ? (roofs.push(y * w + x), "#") : ch)).join(""));
	const monsters = new Set(Object.entries(key).filter(([, k]) => k.kind === "monster").map(([c]) => c));
	const dk: Record<string, DrawKey> = {};
	for (const [c, k] of Object.entries(key)) dk[c] = k.kind === "monster" ? { sprite: k.sprite, name: k.sprite } : { ...k, kind: k.kind };
	const res = drawMap({ rows: clean, key: dk, kind: "town", name: "preview", seed, lighting });
	for (const i of roofs) res.map.tiles[i] = "building" as Tile;
	// A prop on a sidewalk stands on the sidewalk (drawMap takes the commonest ground around, often the road).
	for (const e of res.entities) {
		const l = res.map.tiles[e.y * w + e.x - 1], r = res.map.tiles[e.y * w + e.x + 1];
		if (e.x > 0 && e.x < w - 1 && l === r && DRAW_TILES.has(l)) res.map.tiles[e.y * w + e.x] = l;
	}
	const map: GridMap = { ...res.map, theme: "modern" };
	let n = 0;
	const ents: MapEntity[] = res.entities.map((e) => ({ ...e, id: `e${n++}` }));
	// monsters: the key char is remembered through the name
	for (const e of ents) for (const c of monsters) if (key[c].sprite === e.sprite && e.kind === "feature") e.kind = "monster";
	if (res.pc) ents.push({ id: "pc", kind: "pc", name: "you", sprite: "pc", x: res.pc.x, y: res.pc.y, size: 1 });
	map.entities = ents;
	return map;
}

const MAIN_STREET = place(
	[
		"^^^^^^^^^^^^,,,,,##############,,,,,^^^^^^^^",
		"^^^^^^^^^^^^,T,,,#............#,,T,,^^^^^^^^",
		"^^^^^^^^^^^^,,,,,#.BBBBBB...Fv#,,,,,^^^^^^^^",
		"^^^^^^^^^^^^,,,,,#............#,,,,,^^^^^^^^",
		"^^^^^^^^^^^^,,,,,#.tt.tt.tt...#,,,,,^^^^^^^^",
		"^^^^^^^^^^^^,,,,,#..2.........#,,,,,^^^^^^^^",
		"############:::::#............#:::::########",
		"#####+######::D::######/#######:::::###+####",
		":Y::H::N::::M:::::::Y:::::::::::::Y:::::G:::",
		"---C-------------A--------------------------",
		"---------Q---------------------------P------",
		"----------------------1---------K-----------",
		"-------------U---------------V-V------------",
		":Y:::::::Z:::::::Y:::-----@::::::Y::::::::::",
		",,T,,,,,,,T,,,,,,,,,,-----,,,T,,,,,,,T,,,,,,",
		",,,,,3,,,,,,,,,,,,,,,----r,,,,,,,,,,,,,,,,,,",
		",,,T,,,,,,,,T,,,,,,,,-----,,,,,,,T,,,,,,,T,,",
		"~~~~~~~~~~~~~~~~~~~~~bbbbb~~~~~~~~~~~~~~~~~~",
		"~~~~~~~~~~~~~~~~~~~~~bbbbb~~~~~~~~~~~~~~~~~~",
		",,,,,,T,,,,,,,,,,,,,,-----,,,,,,,,,T,,,,,,,,",
		",,T,,,,,,,,,,T,,,,,,,-----,,,,,,,,,,,,,T,,,,",
	],
	{
		Y: { sprite: "street_lamp", kind: "light" },
		H: { sprite: "fire_hydrant" },
		N: { sprite: "bench" },
		M: { sprite: "mailbox" },
		G: { sprite: "road_sign" },
		D: { sprite: "dumpster" },
		C: { sprite: "car" },
		A: { sprite: "ambulance" },
		Q: { sprite: "car_wreck" },
		P: { sprite: "police_car" },
		K: { sprite: "pickup_truck" },
		U: { sprite: "bus" },
		V: { sprite: "traffic_cone" },
		Z: { sprite: "shopping_cart" },
		F: { sprite: "fridge" },
		v: { sprite: "vending_machine" },
		"1": { sprite: "zombie", kind: "monster" },
		"2": { sprite: "zombie_crawler", kind: "monster" },
		"3": { sprite: "dog", kind: "monster" },
	},
	11,
);

const HOSPITAL = place(
	[
		"####################################",
		"#......#......#......#.............#",
		"#.h..h.#.h..h.#.h....#..BBBBBB.....#",
		"#......#......#......#..B..........#",
		"#.j....#......#..z...#..B...v..f...#",
		"###/######/######/####.............#",
		"#..................................#",
		"#..g.......z.....1..g.......EEE..@.#",
		"#..................................#",
		"###+######+######/#####+############",
		"#......#......#.....#......#=======#",
		"#.c..y.#.k..k.#.t.t.#.o..u.#==x==s=#",
		"#......#......#.q.q.#......#=======#",
		"#..R...#......#.....#......#===2===#",
		"####################################",
	],
	{
		h: { sprite: "hospital_bed" },
		j: { sprite: "body_bag" },
		z: { sprite: "blood_pool" },
		v: { sprite: "vending_machine" },
		f: { sprite: "filing_cabinet" },
		g: { sprite: "gurney" },
		E: { sprite: "barricade" },
		c: { sprite: "couch" },
		y: { sprite: "tv" },
		k: { sprite: "washing_machine" },
		q: { sprite: "office_chair" },
		o: { sprite: "toilet" },
		u: { sprite: "bathtub" },
		x: { sprite: "generator" },
		s: { sprite: "store_shelf" },
		R: { sprite: "radio" },
		"1": { sprite: "zombie_riot", kind: "monster" },
		"2": { sprite: "zombie_bloater", kind: "monster" },
	},
	5,
);

/** A strip of `ground` with one entity per pair of squares. */
function strip(ground: Tile, ents: Omit<MapEntity, "id" | "x" | "y" | "size">[], looks: Record<string, Look> = {}, gap = 2): Scene {
	const w = Math.max(2, ents.length * gap + 1), h = 2;
	const map: GridMap = {
		id: "s", name: "strip", kind: "town", seed: 3, width: w, height: h, tiles: new Array(w * h).fill(ground), explored: new Array(w * h).fill(true),
		rooms: [], lighting: "bright", entry: { x: 0, y: 0 }, theme: "modern",
		entities: ents.map((e, i) => ({ ...e, id: `s${i}`, x: Math.min(gap, 1) + i * gap, y: 1, size: 1 })),
	};
	return { map, looks, time: "day" };
}

const PEOPLE: { cls: string; label: string; spec: Partial<PortraitSpec> }[] = [
	{ cls: "barbarian", label: "Firefighter", spec: { skinTone: "#c68a5e", hairStyle: "cropped", hairColor: "#2b1d14", gender: "male", facialHair: "stubble" } },
	{ cls: "bard", label: "Radio host", spec: { skinTone: "#8a5a3a", hairStyle: "curly", hairColor: "#1e1612", gender: "female" } },
	{ cls: "cleric", label: "Nurse", spec: { skinTone: "#f0c8a0", hairStyle: "ponytail", hairColor: "#7a4a22", gender: "female" } },
	{ cls: "druid", label: "Farmer / vet", spec: { skinTone: "#e0b088", hairStyle: "short", hairColor: "#a07040", gender: "male", facialHair: "full_beard", age: 0.6 } },
	{ cls: "fighter", label: "Soldier", spec: { skinTone: "#6a4430", hairStyle: "cropped", hairColor: "#1e1612", gender: "male" } },
	{ cls: "monk", label: "Martial-arts coach", spec: { skinTone: "#e8c090", hairStyle: "bun", hairColor: "#1e1612", gender: "female" } },
	{ cls: "paladin", label: "Police officer", spec: { skinTone: "#d8a878", hairStyle: "sidepart", hairColor: "#4a3020", gender: "male", facialHair: "mustache" } },
	{ cls: "ranger", label: "Hunter", spec: { skinTone: "#e0b088", hairStyle: "long", hairColor: "#c8a050", gender: "female" } },
	{ cls: "rogue", label: "Locksmith / thief", spec: { skinTone: "#b07850", hairStyle: "shaved_sides", hairColor: "#2b1d14", gender: "male", facialHair: "goatee" } },
	{ cls: "sorcerer", label: "Athlete", spec: { skinTone: "#5a3a26", hairStyle: "braids", hairColor: "#1e1612", gender: "female" } },
	{ cls: "warlock", label: "Ex-con", spec: { skinTone: "#e8c4a0", hairStyle: "bald", hairColor: "#3a2a20", gender: "male", accessory: "scar", facialHair: "short_beard" } },
	{ cls: "wizard", label: "Chemistry teacher", spec: { skinTone: "#f0d0b0", hairStyle: "sidepart", hairColor: "#8a8a88", gender: "male", age: 0.65 } },
	{ cls: "", label: "Civilian (no class)", spec: { skinTone: "#d8a878", hairStyle: "wild", hairColor: "#c4502a", gender: "male" } },
];

function spec(p: Partial<PortraitSpec>, i: number): PortraitSpec {
	return { seed: i + 1, skinTone: "#e0b088", hairStyle: "short", hairColor: "#3a2a20", eyeColor: "#4a3a2a", features: [], background: "plain", age: 0.35, ...p };
}

function peopleOn(ground: Tile): Scene {
	const looks: Record<string, Look> = {};
	const ents = PEOPLE.map((p) => ({ kind: "npc" as const, name: p.label, sprite: "npc" }));
	const sc = strip(ground, ents);
	PEOPLE.forEach((p, i) => {
		const classes = p.cls ? [p.cls] : undefined;
		looks[`s${i}`] = personLook(spec(p.spec, i), "human", gearFor({ ruleset: "zombie", classes, text: p.cls ? undefined : "survivor" }), { ruleset: "zombie", classes, text: p.cls ? undefined : "survivor" });
	});
	return { ...sc, looks };
}

function Picture({ scene, scale, label }: { scene: Scene; scale: number; label?: string }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const c = ref.current;
		if (!c) return;
		const small = document.createElement("canvas");
		const { map } = scene;
		paintPixelScene(small, { map, looks: scene.looks, time: scene.time, weather: "clear" }, { x0: 0, y0: 0, w: map.width, h: map.height });
		c.width = small.width * scale;
		c.height = small.height * scale;
		const g = c.getContext("2d")!;
		g.imageSmoothingEnabled = false;
		g.drawImage(small, 0, 0, c.width, c.height);
	}, [scene, scale]);
	return (
		<figure className="space-y-1">
			<canvas ref={ref} style={{ imageRendering: "pixelated", maxWidth: "100%" }} className="rounded border border-stone-700" />
			{label && <figcaption className="text-[11px] text-stone-400">{label}</figcaption>}
		</figure>
	);
}

const FEATS = (ground: Tile, list: readonly string[]) => strip(ground, list.map((s) => ({ kind: "feature" as const, name: s, sprite: s })), {}, 1);
const chunks = <T,>(xs: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const MONS = (ground: Tile) => strip(ground, MODERN_CREATURES.map((s) => ({ kind: "monster" as const, name: s, sprite: s })));

export default function ModernPreview() {
	return (
		<main className="min-h-screen space-y-6 bg-stone-950 p-4 text-stone-200">
			<h1 className="text-lg">The Quiet: modern pixel art (preview)</h1>
			<Picture scene={{ map: MAIN_STREET, looks: {}, time: "day" }} scale={2} label="Main Street, Kessler Falls (day)" />
			<Picture scene={{ map: HOSPITAL, looks: {}, time: "day" }} scale={2} label="St. Brigid's ER corridor" />
			<section className="space-y-2">
				<h2 className="text-xs uppercase tracking-widest text-stone-400">Props ({MODERN_FEATURE_SPRITES.length}): {MODERN_FEATURE_SPRITES.join(" · ")}</h2>
				{chunks([...MODERN_FEATURE_SPRITES, "fall_tree", "fall_tree_red", "bare_tree", "column"], 13).map((list, i) => (
					<div key={i} className="grid grid-cols-2 gap-2">
						<Picture scene={FEATS("road", list)} scale={3} />
						<Picture scene={FEATS(i % 2 ? "sand" : "floor", list)} scale={3} />
					</div>
				))}
			</section>
			<section className="space-y-2">
				<h2 className="text-xs uppercase tracking-widest text-stone-400">Creatures: {MODERN_CREATURES.join(" · ")}</h2>
				<Picture scene={MONS("road")} scale={4} />
				<Picture scene={MONS("grass")} scale={4} />
			</section>
			<section className="space-y-2">
				<h2 className="text-xs uppercase tracking-widest text-stone-400">People: {PEOPLE.map((p) => p.label).join(" · ")}</h2>
				<Picture scene={peopleOn("road")} scale={4} />
				<Picture scene={peopleOn("floor")} scale={4} />
			</section>
			<section className="grid grid-cols-[auto_auto] items-start gap-4">
				<Picture scene={{ map: MAIN_STREET, looks: {}, time: "night" }} scale={1} label="Main Street at night" />
				<Picture scene={{ map: HOSPITAL, looks: {}, time: "dusk" }} scale={1} label="ER at dusk" />
			</section>
		</main>
	);
}
