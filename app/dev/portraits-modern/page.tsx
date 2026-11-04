"use client";

import { useState } from "react";
import type { PortraitSpec } from "@/lib/game/types";
import { Portrait } from "@/components/art/Portrait";
import type { ModernFrame } from "@/components/art/PortraitModern";
import { randomPortrait } from "@/lib/art/portrait";
import { Rng } from "@/lib/rules/dice";

/**
 * PREVIEW ONLY: The Quiet's modern portraits. One person per profession in
 * both frame styles (A: staff ID badge, B: polaroid), some random civilians
 * by role, and four fantasy portraits for comparison (unchanged).
 */

type Lang = "en" | "es";
type L2 = Record<Lang, string>;

const PROS: { cls: string; label: L2; spec: Partial<PortraitSpec> }[] = [
	{ cls: "barbarian", label: { en: "Firefighter", es: "Bombero" }, spec: { skinTone: "#c98e65", hairStyle: "cropped", hairColor: "#2b1d14", gender: "male", facialHair: "stubble", age: 0.3, background: "ember" } },
	{ cls: "bard", label: { en: "Radio host", es: "Locutora de radio" }, spec: { skinTone: "#8a5a3b", hairStyle: "curly", hairColor: "#1c1714", gender: "female", age: 0.35, accessory: "earrings", background: "night" } },
	{ cls: "cleric", label: { en: "Nurse", es: "Enfermera" }, spec: { skinTone: "#f6d7c3", hairStyle: "ponytail", hairColor: "#7a4e2a", gender: "female", age: 0.25, background: "slate" } },
	{ cls: "druid", label: { en: "Farmer / vet", es: "Granjero / veterinario" }, spec: { skinTone: "#e0ac83", hairStyle: "short", hairColor: "#a0672e", gender: "male", facialHair: "full_beard", age: 0.62, background: "forest" } },
	{ cls: "fighter", label: { en: "Soldier / veteran", es: "Soldado / veterano" }, spec: { skinTone: "#6b4430", hairStyle: "cropped", hairColor: "#1c1714", gender: "male", age: 0.2, background: "slate" } },
	{ cls: "monk", label: { en: "Martial-arts coach", es: "Entrenadora de artes marciales" }, spec: { skinTone: "#eec1a0", hairStyle: "bun", hairColor: "#1c1714", gender: "female", age: 0.4, background: "azure" } },
	{ cls: "paladin", label: { en: "Police officer", es: "Policía" }, spec: { skinTone: "#e0ac83", hairStyle: "sidepart", hairColor: "#5a3a22", gender: "male", facialHair: "mustache", age: 0.45, background: "night" } },
	{ cls: "ranger", label: { en: "Hunter", es: "Cazadora" }, spec: { skinTone: "#eec1a0", hairStyle: "long", hairColor: "#c48a3f", gender: "female", age: 0.3, accessory: "scar", background: "forest" } },
	{ cls: "rogue", label: { en: "Locksmith / petty thief", es: "Cerrajero / ratero" }, spec: { skinTone: "#a8714b", hairStyle: "shaved_sides", hairColor: "#2b1d14", gender: "male", facialHair: "goatee", age: 0.2, background: "ember" } },
	{ cls: "sorcerer", label: { en: "Athlete", es: "Atleta" }, spec: { skinTone: "#4b2f22", hairStyle: "braids", hairColor: "#1c1714", gender: "female", age: 0.15, background: "gold" } },
	{ cls: "warlock", label: { en: "Ex-con", es: "Expresidiario" }, spec: { skinTone: "#eec1a0", hairStyle: "bald", hairColor: "#3a2a1e", gender: "male", facialHair: "short_beard", age: 0.45, background: "crimson" } },
	{ cls: "wizard", label: { en: "Chemistry teacher / engineer", es: "Profesor de química / ingeniero" }, spec: { skinTone: "#f6d7c3", hairStyle: "sidepart", hairColor: "#8a8a8a", gender: "male", age: 0.7, background: "slate" } },
];

const CIVS: { role: L2; seed: number; acc?: string; look?: Partial<PortraitSpec> }[] = [
	{ role: { en: "diner waitress", es: "mesera del diner" }, seed: 11, look: { gender: "female", age: 0.3 } },
	{ role: { en: "pharmacist", es: "farmacéutico" }, seed: 23, look: { gender: "male", age: 0.55 } },
	{ role: { en: "student", es: "estudiante" }, seed: 37, acc: "hood" },
	{ role: { en: "pastor", es: "pastor" }, seed: 41, look: { gender: "male", age: 0.6 } },
	{ role: { en: "mechanic", es: "mecánica" }, seed: 58, look: { gender: "female", age: 0.35 } },
	{ role: { en: "bus driver", es: "conductor de autobús" }, seed: 64, look: { gender: "male", age: 0.5 } },
	{ role: { en: "paramedic", es: "paramédico" }, seed: 77 },
	{ role: { en: "retired mail carrier", es: "cartero jubilado" }, seed: 92, look: { gender: "male", age: 0.85, facialHair: "mustache" } },
];
const NAMES = ["Dana Ruiz", "Mike Kowalski", "Tasha Greene", "Hal Brenner", "Rosa Medina", "Lou Pratt", "Jin Park", "Earl Duffy", "Kim Ochoa", "Sam Reyes", "Ray Tully", "Ada Novak"];

function proSpec(p: Partial<PortraitSpec>, i: number): PortraitSpec {
	return { seed: 9001 + i * 131, eyeColor: "#4a2e1a", facialHair: "none", accessory: "none", features: [], skinTone: "#e0ac83", hairStyle: "short", hairColor: "#3a2a1e", background: "slate", ...p };
}

const civSpecs = CIVS.map((c) => {
	const s = randomPortrait(new Rng(c.seed * 977), "human");
	return { ...s, ...c.look, accessory: c.acc ?? s.accessory, facialHair: c.look?.gender === "female" ? "none" : c.look?.facialHair ?? s.facialHair };
});
const fantasy = (["human", "elf", "dwarf", "tiefling"] as const).map((sp, i) => ({ sp, spec: randomPortrait(new Rng(4242 + i * 17), sp) }));

const T = {
	title: { en: "The Quiet — modern portraits (preview)", es: "The Quiet — retratos modernos (vista previa)" },
	intro: {
		en: "Faces are unchanged; only clothes, headwear, extras, background and frame differ. Pick a frame style: A (ID badge) or B (polaroid).",
		es: "Las caras no cambian; solo la ropa, lo que llevan en la cabeza, los extras, el fondo y el marco. Elige un estilo de marco: A (credencial) o B (polaroid).",
	},
	a: { en: "Style A — staff ID badge", es: "Estilo A — credencial de trabajo" },
	b: { en: "Style B — polaroid", es: "Estilo B — polaroid" },
	civ: { en: "Random civilians (NPCs by role)", es: "Civiles al azar (PNJ por rol)" },
	small: { en: "At play sizes (76 px scene strip, 56 px codex, unframed)", es: "A tamaño de juego (76 px escena, 56 px códice, sin marco)" },
	fantasy: { en: "Fantasy, for comparison (unchanged)", es: "Fantasía, para comparar (sin cambios)" },
	size: { en: "Size", es: "Tamaño" },
};

export default function ModernPortraitsPreview() {
	const [lang, setLang] = useState<Lang>("en");
	const [size, setSize] = useState(120);
	const tr = (k: keyof typeof T) => T[k][lang];
	const grid = (frame: ModernFrame) => (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
			{PROS.map((p, i) => (
				<figure key={p.cls} className="flex flex-col items-center gap-1">
					<Portrait spec={proSpec(p.spec, i)} size={size} modern={{ classes: [p.cls] }} frameStyle={frame} name={NAMES[i]} />
					<figcaption className="text-center text-xs text-stone-300">{p.label[lang]}<span className="block text-[10px] text-stone-500">{p.cls}</span></figcaption>
				</figure>
			))}
		</div>
	);
	return (
		<main className="min-h-screen space-y-8 bg-stone-950 p-6 text-stone-200">
			<header className="flex flex-wrap items-center gap-4">
				<h1 className="font-serif text-2xl">{tr("title")}</h1>
				<div className="ml-auto flex items-center gap-2 text-sm">
					<span className="text-stone-400">{tr("size")}</span>
					{[76, 96, 120, 160].map((s) => (
						<button key={s} type="button" onClick={() => setSize(s)} className={`rounded border px-2 py-0.5 ${size === s ? "border-amber-400 text-amber-300" : "border-stone-700"}`}>{s}</button>
					))}
					<button type="button" onClick={() => setLang(lang === "en" ? "es" : "en")} className="ml-3 rounded border border-stone-700 px-2 py-0.5">{lang === "en" ? "ES" : "EN"}</button>
				</div>
				<p className="w-full text-sm text-stone-400">{tr("intro")}</p>
			</header>
			<section id="a">
				<h2 className="mb-3 font-serif text-xl">{tr("a")}</h2>
				{grid("badge")}
			</section>
			<section id="b">
				<h2 className="mb-3 font-serif text-xl">{tr("b")}</h2>
				{grid("polaroid")}
			</section>
			<section id="civ">
				<h2 className="mb-3 font-serif text-xl">{tr("civ")}</h2>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
					{CIVS.flatMap((c, i) =>
						(["badge", "polaroid"] as const).map((f) => (
							<figure key={`${i}${f}`} className="flex flex-col items-center gap-1">
								<Portrait spec={civSpecs[i]} size={size} modern={{ text: c.role.en }} frameStyle={f} />
								<figcaption className="text-center text-xs text-stone-300">{c.role[lang]} <span className="text-stone-500">({f === "badge" ? "A" : "B"})</span></figcaption>
							</figure>
						)),
					)}
				</div>
			</section>
			<section id="small">
				<h2 className="mb-3 font-serif text-xl">{tr("small")}</h2>
				{(["badge", "polaroid"] as const).map((f) => (
					<div key={f} className="mb-3 flex flex-wrap items-end gap-2">
						<span className="w-6 text-sm text-stone-400">{f === "badge" ? "A" : "B"}</span>
						{PROS.map((p, i) => <Portrait key={p.cls} spec={proSpec(p.spec, i)} size={76} modern={{ classes: [p.cls] }} frameStyle={f} />)}
						{PROS.slice(0, 6).map((p, i) => <Portrait key={`u${p.cls}`} spec={proSpec(p.spec, i)} size={56} modern={{ classes: [p.cls] }} frameStyle={f} framed={false} />)}
					</div>
				))}
			</section>
			<section id="fantasy">
				<h2 className="mb-3 font-serif text-xl">{tr("fantasy")}</h2>
				<div className="flex flex-wrap gap-4">
					{fantasy.map((f) => <Portrait key={f.sp} spec={f.spec} speciesId={f.sp} size={size} name={f.sp} />)}
				</div>
			</section>
		</main>
	);
}
