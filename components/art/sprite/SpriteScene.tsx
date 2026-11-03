"use client";

import { useEffect, useMemo, useRef } from "react";
import type { GridMap, TimeOfDay, Weather } from "@/lib/game/types";
import { frameAround, hasSky, paintPixelScene, skyMask, type Look } from "./pixelScene";

export interface SpriteSceneProps {
	map: GridMap;
	looks: Record<string, Look>;
	time: TimeOfDay;
	weather: Weather;
	/** Entity ids of creatures killed in the current fight. */
	dead?: Set<string>;
	/** Narrowest close-up, in squares (zooms out to fit what is nearby). */
	viewW?: number;
	animate?: boolean;
}

/**
 * Pixel-sprite close-up of the active map, framed on the player, with falling
 * snow or rain. Fills its parent (which sets the 16:9 box).
 */
export function SpriteScene({ map, looks, time, weather, dead, viewW = 18, animate = true }: SpriteSceneProps) {
	const base = useRef<HTMLCanvasElement>(null);
	const fx = useRef<HTMLCanvasElement>(null);
	const frame = useMemo(() => frameAround(map, viewW), [map, viewW]);

	useEffect(() => {
		if (base.current) paintPixelScene(base.current, { map, looks, time, weather, dead }, frame);
	}, [map, looks, time, weather, dead, frame]);

	const mask = useMemo(() => skyMask(map, frame), [map, frame]);
	const falling = hasSky(map) && (weather === "snow" || weather === "rain" || weather === "storm") ? (weather === "snow" ? "snow" : "rain") : null;
	useEffect(() => {
		const c = fx.current;
		if (!c) return;
		const W = (c.width = frame.w * 16), H = (c.height = frame.h * 16);
		const ctx = c.getContext("2d")!;
		ctx.clearRect(0, 0, W, H);
		if (!falling) return;
		const n = falling === "snow" ? 140 : 180;
		const parts = Array.from({ length: n }, (_, i) => ({ x: ((i * 9301 + 49297) % 233280) / 233280 * W, y: ((i * 4096 + 150889) % 714025) / 714025 * H, z: i % 3 === 0 ? 2 : 1, ph: i }));
		const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		let raf = 0, last = performance.now();
		const draw = (now: number) => {
			const dt = Math.min(0.05, (now - last) / 1000);
			last = now;
			ctx.clearRect(0, 0, W, H);
			ctx.fillStyle = falling === "snow" ? "rgba(255,255,255,0.9)" : "rgba(170,200,230,0.55)";
			for (const p of parts) {
				const open = mask[Math.floor(p.y / 16) * frame.w + Math.floor(p.x / 16)];
				if (!open) { /* under a roof */ }
				else if (falling === "snow") {
					ctx.fillRect(Math.round(p.x), Math.round(p.y), p.z, p.z);
				} else ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 3);
				if (falling === "snow") { p.y += (8 + p.z * 6) * dt; p.x += Math.sin(now / 900 + p.ph) * 4 * dt; }
				else { p.y += 160 * dt; p.x -= 30 * dt; }
				if (p.y > H) p.y -= H;
				if (p.x < 0) p.x += W;
				if (p.x > W) p.x -= W;
			}
			if (animate && !reduce) raf = requestAnimationFrame(draw);
		};
		raf = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(raf);
	}, [falling, frame, animate, mask]);

	const labels = map.entities.filter((e) => e.kind === "npc" && !e.hidden && e.x >= frame.x0 && e.x < frame.x0 + frame.w && e.y >= frame.y0 && e.y < frame.y0 + frame.h);

	return (
		<div className="absolute inset-0 bg-black">
			<canvas ref={base} className="absolute inset-0 h-full w-full" style={{ imageRendering: "pixelated" }} />
			<canvas ref={fx} className="pointer-events-none absolute inset-0 h-full w-full" style={{ imageRendering: "pixelated" }} />
			{labels.map((e) => (
				<div
					key={e.id}
					className="pointer-events-none absolute -translate-x-1/2 truncate rounded bg-black/45 px-1 font-serif text-[clamp(9px,0.9vw,12px)] leading-tight text-amber-50/90"
					style={{ left: `${((e.x - frame.x0 + 0.5) / frame.w) * 100}%`, top: `${((e.y - frame.y0 + 1) / frame.h) * 100}%`, maxWidth: `${(3 / frame.w) * 100}%` }}
				>
					{e.name.split(" ")[0]}
				</div>
			))}
		</div>
	);
}
