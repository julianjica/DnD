"use client";

import { useEffect, useRef } from "react";
import type { PortraitSpec } from "@/lib/game/types";
import { Portrait } from "@/components/art/Portrait";
import { creatureCanvas } from "@/components/art/sprite/pixelScene";
import { personLook } from "@/components/art/sprite/person";
import { NATURAL_MALE_HAIR, NEW_MALE_HAIR } from "@/lib/art/portrait";
import { useT } from "@/components/i18n/I18nProvider";

/**
 * PREVIEW ONLY: the natural men's cuts across skin tones, hair colours, ages and
 * beards; under a hood, a helmet and a circlet; in the modern portraits (The
 * Quiet bare, police cap, beanie, hoodie hood; Root Access); at the sidebar size
 * (84px); and as the 16px sprite at 1× and 4×. The old men's styles follow.
 */

type Variant = { label: string; spec: Partial<PortraitSpec>; modern?: "quiet" | "marea"; species?: string };
const VARIANTS: Variant[] = [
	{ label: "pale · blond", spec: { skinTone: "#f6d7c3", hairColor: "#c48a3f", facialHair: "none", age: 0.15 } },
	{ label: "tan · black · beard", spec: { skinTone: "#a8714b", hairColor: "#1c1714", facialHair: "short_beard", age: 0.3 } },
	{ label: "dark · black · full", spec: { skinTone: "#4b2f22", hairColor: "#1c1714", facialHair: "full_beard", age: 0.35 } },
	{ label: "fair · red · goatee", spec: { skinTone: "#eec1a0", hairColor: "#a33a22", facialHair: "goatee", age: 0.25 } },
	{ label: "medium · brown · stubble", spec: { skinTone: "#e0ac83", hairColor: "#5a3a22", facialHair: "stubble", age: 0.3 } },
	{ label: "olive · grey · tache · older", spec: { skinTone: "#c98e65", hairColor: "#8a8a8a", facialHair: "mustache", age: 0.75 } },
	{ label: "white · old · beard", spec: { skinTone: "#eec1a0", hairColor: "#f2f2ee", facialHair: "full_beard", age: 0.92 } },
	{ label: "brown · platinum", spec: { skinTone: "#8a5a3b", hairColor: "#efe0b0", facialHair: "none", age: 0.2 } },
	{ label: "tiefling · blue", spec: { skinTone: "#5f3a74", hairColor: "#2c3a5a", facialHair: "stubble", age: 0.3, features: ["horns"] }, species: "tiefling" },
	{ label: "hood", spec: { skinTone: "#e0ac83", hairColor: "#5a3a22", facialHair: "stubble", accessory: "hood" } },
	{ label: "helmet", spec: { skinTone: "#8a5a3b", hairColor: "#1c1714", facialHair: "full_beard", accessory: "helmet" } },
	{ label: "circlet", spec: { skinTone: "#f6d7c3", hairColor: "#7a4e2a", facialHair: "none", accessory: "circlet" } },
	{ label: "Quiet · bare", spec: { skinTone: "#e0ac83", hairColor: "#7a4e2a", facialHair: "stubble", outfit: "denim" }, modern: "quiet" },
	{ label: "Quiet · police cap", spec: { skinTone: "#6b4430", hairColor: "#1c1714", facialHair: "mustache", outfit: "police" }, modern: "quiet" },
	{ label: "Quiet · beanie", spec: { skinTone: "#c98e65", hairColor: "#3a2a1e", facialHair: "short_beard", accessory: "hood", outfit: "denim" }, modern: "quiet" },
	{ label: "Quiet · hoodie hood", spec: { skinTone: "#eec1a0", hairColor: "#e0c070", accessory: "hood", outfit: "hoodie" }, modern: "quiet" },
	{ label: "Root Access", spec: { skinTone: "#a8714b", hairColor: "#2c3a5a", facialHair: "goatee", outfit: "denim" }, modern: "marea" },
];
const SMALL = [0, 2, 5, 12];

function spec(style: string, v: Variant, i: number): PortraitSpec {
	return {
		seed: 5150 + i * 977,
		gender: "male",
		eyeColor: "#4a2e1a",
		facialHair: "none",
		accessory: "none",
		features: [],
		skinTone: "#e0ac83",
		hairColor: "#3a2a1e",
		background: (["slate", "forest", "azure", "crimson", "teal", "violet", "night", "ember", "gold"] as const)[i % 9],
		hairStyle: style,
		...v.spec,
	};
}

function Sprite({ s, modern, scale }: { s: PortraitSpec; modern?: boolean; scale: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const c = ref.current;
		if (!c) return;
		const ctx = c.getContext("2d")!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, c.width, c.height);
		const look = personLook(s, "human", "none", modern ? { ruleset: "zombie", classes: ["fighter"] } : undefined);
		ctx.drawImage(creatureCanvas({ kind: "npc", sprite: "npc" }, look, false), 0, 0, c.width, c.height);
	}, [s, modern]);
	return <canvas ref={ref} width={16 * scale} height={16 * scale} style={{ imageRendering: "pixelated", width: 16 * scale, height: 16 * scale }} className="rounded-sm bg-[#6b4a2e]" />;
}

const portraitOf = (style: string, v: Variant, i: number, size: number) => (
	<Portrait
		spec={spec(style, v, i)}
		size={size}
		speciesId={v.species ?? "human"}
		modern={v.modern === "quiet" ? { classes: ["fighter"] } : v.modern === "marea" ? { classes: ["rogue"], city: "marea" } : undefined}
	/>
);

function Row({ style, size, cols, isNew, sprites, small }: { style: string; size: number; cols: number[] | null; isNew: boolean; sprites: boolean; small: boolean }) {
	const { te } = useT();
	const spriteSpecs: [PortraitSpec, boolean][] = [
		[spec(style, VARIANTS[0], 0), false],
		[spec(style, VARIANTS[1], 1), false],
		[spec(style, VARIANTS[2], 2), false],
		[spec(style, VARIANTS[3], 3), false],
		[spec(style, VARIANTS[5], 5), false],
		[spec(style, VARIANTS[6], 6), false],
		[spec(style, VARIANTS[12], 12), true],
		[spec(style, VARIANTS[13], 13), true],
	];
	return (
		<div data-shot={style} className={`flex items-center gap-2 rounded border p-2 ${isNew ? "border-amber-700/60 bg-amber-950/20" : "border-stone-800"}`}>
			<div className="w-28 shrink-0 text-xs">
				<div className="font-mono text-amber-300">{style}</div>
				<div className="text-stone-300">{te("portrait", style)}</div>
			</div>
			{VARIANTS.map((v, i) => (cols && !cols.includes(i) ? null : <div key={i} data-pshot={`${style}-${i}`}>{portraitOf(style, v, i, size)}</div>))}
			{small && (
				<div className="grid grid-cols-2 gap-1">
					{SMALL.map((i) => <div key={i}>{portraitOf(style, VARIANTS[i], i, 84)}</div>)}
				</div>
			)}
			{sprites && (
				<div className="flex flex-col items-center gap-1">
					<div className="flex items-end gap-1">{spriteSpecs.map(([s, m], i) => <Sprite key={i} s={s} modern={m} scale={1} />)}</div>
					<div className="grid grid-cols-4 gap-1">{spriteSpecs.map(([s, m], i) => <Sprite key={i} s={s} modern={m} scale={4} />)}</div>
				</div>
			)}
		</div>
	);
}

export default function HairNaturalPreview({ only, size, cols, old, sprites, small, skipNew }: { only: string[] | null; size: number; cols: number[] | null; old: boolean; sprites: boolean; small: boolean; skipNew?: boolean }) {
	const cuts = skipNew ? [] : NATURAL_MALE_HAIR.filter((s) => !only || only.includes(s));
	const olds = old && !only ? ["short", "cropped", "sidepart", "long", "curly", "wild", "shaved_sides", ...NEW_MALE_HAIR] : [];
	return (
		<main className="min-h-screen space-y-3 bg-stone-950 p-4 text-stone-200">
			<h1 className="font-serif text-xl">Natural men&apos;s hair — preview (not live)</h1>
			<p className="text-xs text-stone-400">
				Columns: {VARIANTS.map((v, i) => `${i} ${v.label}`).join(" · ")}; then the sidebar size (84px: columns {SMALL.join(", ")}) and sprites at 1× and 4×. The old men&apos;s styles are at the bottom for comparison.
			</p>
			<div className="space-y-2">{cuts.map((s) => <Row key={s} style={s} size={size} cols={cols} isNew sprites={sprites} small={small} />)}</div>
			{olds.length > 0 && (
				<>
					<h2 className="pt-6 font-serif text-lg text-stone-400">Old styles (for comparison)</h2>
					<div className="space-y-2">{olds.map((s) => <Row key={s} style={s} size={size} cols={cols} isNew={false} sprites={sprites} small={small} />)}</div>
				</>
			)}
		</main>
	);
}
