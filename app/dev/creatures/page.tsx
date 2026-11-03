"use client";

import { useEffect, useRef } from "react";
import { CREATURE_SPRITES } from "@/components/art/sprite/creatures";
import type { Sprite } from "@/components/art/sprite/sprites";

const SCALE = 4;

function draw(canvas: HTMLCanvasElement, s: Sprite, bg: string) {
	canvas.width = 16 * SCALE;
	canvas.height = 16 * SCALE;
	const g = canvas.getContext("2d");
	if (!g) return;
	g.imageSmoothingEnabled = false;
	g.fillStyle = bg;
	g.fillRect(0, 0, canvas.width, canvas.height);
	s.rows.forEach((row, y) => {
		for (let x = 0; x < row.length; x++) {
			const c = s.pal[row[x]];
			if (!c) continue;
			g.fillStyle = c;
			g.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
		}
	});
}

function Cell({ name, sprite, bg }: { name: string; sprite: Sprite; bg: string }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		if (ref.current) draw(ref.current, sprite, bg);
	}, [sprite, bg]);
	return (
		<figure className="flex flex-col items-center gap-1">
			<canvas ref={ref} width={64} height={64} style={{ imageRendering: "pixelated", width: 64, height: 64 }} />
			<figcaption className="text-[10px] text-stone-400">{name}</figcaption>
		</figure>
	);
}

const BACKGROUNDS = [
	{ label: "Snow", bg: "#dfe7ee" },
	{ label: "Stone", bg: "#34322f" },
];

export default function CreaturesPreview() {
	const entries = Object.entries(CREATURE_SPRITES);
	return (
		<main className="min-h-screen space-y-6 bg-stone-950 p-6 text-stone-200">
			<h1 className="text-lg">Creature sprites ({entries.length})</h1>
			{BACKGROUNDS.map(({ label, bg }) => (
				<section key={label} className="space-y-2">
					<h2 className="text-xs uppercase tracking-widest text-stone-400">{label}</h2>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-2">
						{entries.map(([name, s]) => (
							<Cell key={name} name={name} sprite={s} bg={bg} />
						))}
					</div>
				</section>
			))}
		</main>
	);
}
