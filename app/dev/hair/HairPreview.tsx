"use client";

import { useEffect, useRef } from "react";
import type { PortraitSpec } from "@/lib/game/types";
import { Portrait } from "@/components/art/Portrait";
import { creatureCanvas } from "@/components/art/sprite/pixelScene";
import { personLook } from "@/components/art/sprite/person";
import { HAIR_STYLES, NEW_MALE_HAIR } from "@/lib/art/portrait";
import { useT } from "@/components/i18n/I18nProvider";

/**
 * PREVIEW ONLY: every hair style (the new men's cuts first) across skin tones,
 * hair colours and beards, under a hood and a helmet, in the modern portraits
 * (The Quiet with a cap/hood, Root Access) and as the 16px sprite at 1× and 4×.
 * `?only=new` shows just the new styles, `?only=old` just the existing ones;
 * `?size=` sets the portrait width and `?cols=0,2,8` picks columns.
 */

const NEW = new Set<string>(NEW_MALE_HAIR);

type Variant = { label: string; spec: Partial<PortraitSpec>; modern?: "quiet" | "marea" };
const VARIANTS: Variant[] = [
	{ label: "pale · blond", spec: { skinTone: "#f6d7c3", hairColor: "#c48a3f", facialHair: "none", age: 0.2 } },
	{ label: "tan · black · beard", spec: { skinTone: "#a8714b", hairColor: "#1c1714", facialHair: "short_beard", age: 0.3 } },
	{ label: "dark · brown · full", spec: { skinTone: "#4b2f22", hairColor: "#3a2a1e", facialHair: "full_beard", age: 0.35 } },
	{ label: "fair · red · goatee", spec: { skinTone: "#eec1a0", hairColor: "#a33a22", facialHair: "goatee", age: 0.25 } },
	{ label: "olive · grey · tache", spec: { skinTone: "#c98e65", hairColor: "#8a8a8a", facialHair: "mustache", age: 0.72 } },
	{ label: "tiefling · white", spec: { skinTone: "#7e2a45", hairColor: "#f2f2ee", facialHair: "stubble", age: 0.3, features: ["horns"] } },
	{ label: "hood", spec: { skinTone: "#e0ac83", hairColor: "#5a3a22", facialHair: "stubble", accessory: "hood" } },
	{ label: "helmet", spec: { skinTone: "#8a5a3b", hairColor: "#1c1714", facialHair: "full_beard", accessory: "helmet" } },
	{ label: "Quiet · bare", spec: { skinTone: "#e0ac83", hairColor: "#7a4e2a", facialHair: "stubble", outfit: "denim" }, modern: "quiet" },
	{ label: "Quiet · police cap", spec: { skinTone: "#6b4430", hairColor: "#1c1714", facialHair: "mustache", outfit: "police" }, modern: "quiet" },
	{ label: "Quiet · hoodie hood", spec: { skinTone: "#eec1a0", hairColor: "#e0c070", accessory: "hood", outfit: "hoodie" }, modern: "quiet" },
	{ label: "Quiet · beanie", spec: { skinTone: "#c98e65", hairColor: "#3a2a1e", facialHair: "short_beard", accessory: "hood", outfit: "denim" }, modern: "quiet" },
	{ label: "Root Access", spec: { skinTone: "#a8714b", hairColor: "#2c3a5a", facialHair: "goatee", outfit: "denim" }, modern: "marea" },
];

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

function Row({ style, size, cols }: { style: string; size: number; cols: number[] | null }) {
	const { te } = useT();
	const sprites: [PortraitSpec, boolean][] = [
		[spec(style, VARIANTS[0], 0), false],
		[spec(style, VARIANTS[1], 1), false],
		[spec(style, VARIANTS[2], 2), false],
		[spec(style, VARIANTS[4], 4), false],
		[spec(style, VARIANTS[8], 8), true],
		[spec(style, VARIANTS[9], 9), true],
	];
	return (
		<div className={`flex items-center gap-2 rounded border p-2 ${NEW.has(style) ? "border-amber-700/60 bg-amber-950/20" : "border-stone-800"}`}>
			<div className="w-28 shrink-0 text-xs">
				<div className="font-mono text-amber-300">{style}</div>
				<div className="text-stone-400">{te("portrait", style)}</div>
				{NEW.has(style) && <div className="mt-1 text-[10px] uppercase tracking-wide text-amber-500">new</div>}
			</div>
			{VARIANTS.map((v, i) => (cols && !cols.includes(i) ? null :
				<Portrait key={i} spec={spec(style, v, i)} size={size} speciesId={v.spec.features?.includes("horns") ? "tiefling" : "human"} modern={v.modern === "quiet" ? { classes: ["fighter"] } : v.modern === "marea" ? { classes: ["rogue"], city: "marea" } : undefined} />
			))}
			<div className="flex flex-col items-center gap-1">
				<div className="flex items-end gap-1">{sprites.map(([s, m], i) => <Sprite key={i} s={s} modern={m} scale={1} />)}</div>
				<div className="grid grid-cols-3 gap-1">{sprites.map(([s, m], i) => <Sprite key={i} s={s} modern={m} scale={4} />)}</div>
			</div>
		</div>
	);
}

export default function HairPreview({ only, size, cols }: { only: string | null; size: number; cols: number[] | null }) {
	const styles = HAIR_STYLES.filter((s) => (only === "new" ? NEW.has(s) : only === "old" ? !NEW.has(s) : true)).sort((a, b) => Number(NEW.has(b)) - Number(NEW.has(a)));
	return (
		<main className="min-h-screen space-y-3 bg-stone-950 p-4 text-stone-200">
			<h1 className="font-serif text-xl">Hair styles — preview</h1>
			<p className="text-xs text-stone-400">
				New men&apos;s cuts (amber) first, then the existing styles. Columns: {VARIANTS.map((v) => v.label).join(" · ")} · sprites 1× and 4× (fantasy ×4, The Quiet bare + police cap).
			</p>
			<div className="space-y-2">{styles.map((s) => <Row key={s} style={s} size={size} cols={cols} />)}</div>
		</main>
	);
}
