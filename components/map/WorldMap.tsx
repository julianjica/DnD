"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorldLocation, WorldMap as WorldMapState } from "@/lib/game/types";
import { paintWorldBase, paintWorldOverlay, sampleWorld } from "./art/worldPainter";
import { mapFont } from "./mapFont";
import { useT } from "@/components/i18n/I18nProvider";

export interface WorldMapProps {
	world: WorldMapState;
	onLocationClick?: (location: WorldLocation) => void;
	/** Highlight a location (e.g. travel destination). */
	selectedLocationId?: string | null;
	/** DM/debug view: draw undiscovered locations and routes faded. */
	showUndiscovered?: boolean;
	className?: string;
}

/**
 * Parchment overworld map. Terrain is generated from world.seed/terrain
 * (identical to lib/maps/world.ts sampling), painted once per size, and
 * overlaid with routes, location icons and labels. Locations are real buttons.
 */
export default function WorldMap({ world, onLocationClick, selectedLocationId, showUndiscovered, className }: WorldMapProps) {
	const { t, te } = useT();
	const wrapRef = useRef<HTMLDivElement>(null);
	const baseRef = useRef<HTMLCanvasElement>(null);
	const overRef = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const [fontReady, setFontReady] = useState(false);
	const [hover, setHover] = useState<string | null>(null);
	const family = mapFont.style.fontFamily;

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			const w = Math.round(entry.contentRect.width);
			const h = Math.round(entry.contentRect.height);
			if (w > 0 && h > 0) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		let alive = true;
		document.fonts.load(`20px ${family}`).catch(() => undefined).finally(() => alive && setFontReady(true));
		return () => { alive = false; };
	}, [family]);

	// Fit a 3:2 map inside the container.
	const box = useMemo(() => {
		if (!size) return null;
		const w = Math.min(size.w, size.h * 1.5);
		return { w: Math.floor(w), h: Math.floor(w / 1.5) };
	}, [size]);

	const grid = useMemo(() => sampleWorld(world, 300, 200), [world.seed, world.terrain.seaLevel, world.terrain.biome]); // eslint-disable-line react-hooks/exhaustive-deps

	const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
	useEffect(() => {
		const c = baseRef.current;
		if (!c || !box || !fontReady) return;
		c.width = Math.round(box.w * dpr);
		c.height = Math.round(box.h * dpr);
		paintWorldBase(c, world, grid, family);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [box, grid, world.name, fontReady, family, dpr]);

	useEffect(() => {
		const c = overRef.current;
		if (!c || !box || !fontReady) return;
		c.width = Math.round(box.w * dpr);
		c.height = Math.round(box.h * dpr);
		paintWorldOverlay(c.getContext("2d")!, world, c.width, c.height, {
			fontFamily: family,
			showUndiscovered,
			hoverId: hover,
			selectedId: selectedLocationId,
			daysLabel: (n) => t(n === 1 ? "play.map.day" : "play.map.days", { n }),
		});
	}, [box, world, fontReady, family, showUndiscovered, hover, selectedLocationId, dpr, t]);

	const current = world.locations.find((l) => l.id === world.currentLocationId);
	const visible = world.locations.filter((l) => l.discovered || showUndiscovered);
	const hovered = visible.find((l) => l.id === hover);

	return (
		<div ref={wrapRef} className={`relative grid h-full w-full place-items-center overflow-hidden bg-[#2a2118] ${mapFont.className} ${className ?? ""}`}>
			{box && (
				<div className="relative shadow-[0_10px_40px_rgba(0,0,0,0.6)]" style={{ width: box.w, height: box.h }}>
					<canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
					<canvas ref={overRef} className="absolute inset-0 h-full w-full" />
					{current && (
						<div className="pointer-events-none absolute" style={{ left: current.x * box.w, top: current.y * box.h, transform: "translate(-50%, -50%)" }}>
							<span className="absolute -left-5 -top-5 h-10 w-10 animate-ping rounded-full border-2 border-red-700/70" />
							<span className="absolute -left-3.5 -top-3.5 h-7 w-7 rounded-full border-[3px] border-red-800 shadow-[0_0_10px_rgba(160,30,20,0.7)]" />
							<svg className="absolute -left-3 -top-[46px] h-8 w-6 drop-shadow" viewBox="0 0 24 32" aria-hidden>
								<path d="M12 31C12 31 2 18 2 11a10 10 0 0 1 20 0c0 7-10 20-10 20z" fill="#9b1c12" stroke="#3b2a1a" strokeWidth="1.5" />
								<circle cx="12" cy="11" r="4" fill="#f3e6c4" />
							</svg>
						</div>
					)}
					{visible.map((l) => (
						<button
							key={l.id}
							type="button"
							aria-label={`${l.name} (${te("location", l.kind)})`}
							className="absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
							style={{ left: l.x * box.w, top: l.y * box.h - 6, cursor: onLocationClick ? "pointer" : "default" }}
							onMouseEnter={() => setHover(l.id)}
							onMouseLeave={() => setHover((h) => (h === l.id ? null : h))}
							onFocus={() => setHover(l.id)}
							onBlur={() => setHover((h) => (h === l.id ? null : h))}
							onClick={() => onLocationClick?.(l)}
						/>
					))}
					{hovered && (
						<div
							className="pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 rounded border border-[#3b2a1a]/60 bg-[#f1e4c4]/95 px-3 py-1.5 text-center text-[#3b2a1a] shadow-lg"
							style={{ left: hovered.x * box.w, top: hovered.y * box.h + 34 }}
						>
							<div className="text-base leading-tight">{hovered.name}</div>
							<div className="text-xs italic opacity-80">
								{te("location", hovered.kind)}
								{hovered.id === world.currentLocationId ? ` · ${t("play.map.youAreHere")}` : hovered.visited ? ` · ${t("play.map.visited")}` : ""}
							</div>
							{hovered.description && <div className="mt-1 text-xs">{hovered.description}</div>}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
