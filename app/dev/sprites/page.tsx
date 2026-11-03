"use client";

import { useEffect, useRef } from "react";
import { LAYOUTS, type Layout } from "@/components/art/sprite/layouts";
import { renderCrop, renderGlyph, renderPixel } from "@/components/art/sprite/render";

function Canvas({ layout, mode, close }: { layout: Layout; mode: "glyph" | "pixel"; close?: boolean }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		if (!ref.current) return;
		if (close) renderCrop(ref.current, layout, mode);
		else (mode === "glyph" ? renderGlyph : renderPixel)(ref.current, layout, 2);
	}, [layout, mode, close]);
	return <canvas ref={ref} className="w-full rounded border border-stone-700" style={{ imageRendering: "pixelated" }} />;
}

export default function SpritesPreview() {
	return (
		<main className="min-h-screen space-y-8 bg-stone-950 p-6 text-stone-200">
			<h1 className="text-lg">Sprite scenes (preview)</h1>
			{LAYOUTS.map((l) => (
				<section key={l.id} id={l.id} className="space-y-2">
					<h2 className="font-serif text-xl">{l.title}</h2>
					<div className="grid grid-cols-2 gap-4">
						<div><div className="mb-1 text-xs uppercase tracking-widest text-stone-400">A · Glyphs</div><Canvas layout={l} mode="glyph" close /></div>
						<div><div className="mb-1 text-xs uppercase tracking-widest text-stone-400">B · Pixel sprites</div><Canvas layout={l} mode="pixel" close /></div>
					</div>
					<details className="text-xs text-stone-400"><summary>Whole place</summary>
						<div className="mt-2 grid grid-cols-2 gap-4"><Canvas layout={l} mode="glyph" /><Canvas layout={l} mode="pixel" /></div>
					</details>
				</section>
			))}
		</main>
	);
}
