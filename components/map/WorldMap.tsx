"use client";

import { displayPlace } from "@/lib/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorldLocation, WorldMap as WorldMapState } from "@/lib/game/types";
import { paintWorldBase, paintWorldOverlay, sampleWorld } from "./art/worldPainter";
import { paintTownBase, paintTownOverlay, townRegionView, travelMinutes } from "./art/townPainter";
import { mapFont } from "./mapFont";
import { townFont } from "./townFont";
import { declutter, FULL_VIEW, inView, projectWorld, regionView } from "@/lib/maps/region";
import { useT } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";

/** DOM chrome around the canvas: parchment for fantasy atlases, paper-and-ink for modern town maps. */
const CHROME = {
	fantasy: {
		wrap: "bg-[#2a2118]",
		toggle: "border-[#3b2a1a]/70 bg-[#f1e4c4]/90 text-[#3b2a1a]",
		on: "bg-[#3b2a1a] text-[#f1e4c4]",
		off: "hover:bg-[#e2d1a8]",
		focus: "focus-visible:ring-amber-700",
		tip: "border-[#3b2a1a]/60 bg-[#f1e4c4]/95 text-[#3b2a1a]",
	},
	town: {
		wrap: "bg-[#1b1d1f]",
		toggle: "border-[#2b2d2f]/70 bg-[#fbfaf6]/95 text-[#2b2d2f] font-semibold",
		on: "bg-[#2b2d2f] text-[#fbfaf6]",
		off: "hover:bg-[#e7e5de]",
		focus: "focus-visible:ring-sky-700",
		tip: "border-[#2b2d2f]/40 bg-[#fbfaf6]/95 text-[#1f2124]",
	},
};

export interface WorldMapProps {
	world: WorldMapState;
	onLocationClick?: (location: WorldLocation) => void;
	/** Highlight a location (e.g. travel destination). */
	selectedLocationId?: string | null;
	/** DM/debug view: draw undiscovered locations and routes faded. */
	showUndiscovered?: boolean;
	className?: string;
	/** Start zoomed on the party's region (default) or on the whole world. */
	initialScope?: "region" | "world";
}

/**
 * Parchment overworld map. Terrain is generated from world.seed/terrain
 * (identical to lib/maps/world.ts sampling), painted once per size, and
 * overlaid with routes, location icons and labels. Locations are real buttons.
 */
export default function WorldMap({ world: rawWorld, onLocationClick, selectedLocationId, showUndiscovered, className, initialScope = "region" }: WorldMapProps) {
	const { t, te, lang } = useT();
	const isTown = rawWorld.terrain.style === "town";
	const chrome = isTown ? CHROME.town : CHROME.fantasy;
	const hasHere = rawWorld.locations.some((l) => l.id === rawWorld.currentLocationId);
	const [scopePref, setScope] = useState<"region" | "world">(initialScope);
	const scope = hasHere ? scopePref : "world";
	const view = useMemo(() => (scope === "region" ? (isTown ? townRegionView : regionView)(rawWorld) : FULL_VIEW), [scope, rawWorld, isTown]);
	// Generated place names follow the UI language; the region view re-expresses
	// everything in zoomed coordinates, and close neighbours are spread apart.
	const world = useMemo(() => {
		const named = lang === "en" ? rawWorld : { ...rawWorld, name: displayPlace(lang, rawWorld.name), locations: rawWorld.locations.map((l) => ({ ...l, name: displayPlace(lang, l.name) })) };
		const here = named.locations.find((l) => l.id === named.currentLocationId);
		const proj = scope === "region" && here ? projectWorld(named, view, t("play.map.regionOf", { name: here.name })) : named;
		const shown = proj.locations.filter((l) => (l.discovered || showUndiscovered) && (scope === "world" || inView(l, -0.02)));
		const pos = declutter(shown, scope === "region" ? 0.06 : 0.04, proj.currentLocationId);
		return { ...proj, locations: proj.locations.map((l) => ({ ...l, ...(pos.get(l.id) ?? {}) })) };
	}, [rawWorld, lang, scope, view, showUndiscovered, t]);
	const wrapRef = useRef<HTMLDivElement>(null);
	const baseRef = useRef<HTMLCanvasElement>(null);
	const overRef = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const [fontReady, setFontReady] = useState(false);
	const [hover, setHover] = useState<string | null>(null);
	// Town maps: where the base layer put its title, scale bar and north arrow (labels keep clear).
	const reservedRef = useRef<[number, number, number, number][]>([]);
	const family = isTown ? townFont.style.fontFamily : mapFont.style.fontFamily;
	// Route times: days on the road, minutes and hours inside a town.
	const travelLabel = useMemo(() => (days: number) => {
		if (days >= 1) return t(days === 1 ? "play.map.day" : "play.map.days", { n: days });
		const mins = travelMinutes(days);
		if (mins < 60) return t("play.map.min", { n: mins });
		const h = Math.floor(mins / 60), m = mins % 60;
		return m ? t("play.map.hMin", { h, m }) : t("play.map.h", { n: h });
	}, [t]);

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

	const featureKey = JSON.stringify(world.terrain.features ?? []);
	const viewKey = `${view.x0},${view.y0},${view.s}`;
	const grid = useMemo(() => (isTown ? null : sampleWorld(rawWorld, 300, 200, view)), [isTown, rawWorld.seed, rawWorld.terrain.seaLevel, rawWorld.terrain.biome, featureKey, viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

	const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
	useEffect(() => {
		const c = baseRef.current;
		if (!c || !box || !fontReady) return;
		c.width = Math.round(box.w * dpr);
		c.height = Math.round(box.h * dpr);
		if (grid) paintWorldBase(c, world, grid, family, view.s < 1);
		else {
			const here = world.locations.find((l) => l.id === world.currentLocationId);
			reservedRef.current = paintTownBase(c, rawWorld, view, {
				fontFamily: family,
				pixelRatio: dpr,
				title: lang === "en" ? rawWorld.name : displayPlace(lang, rawWorld.name),
				subtitle: scope === "region" && here ? world.name : t("play.map.town.subtitle"),
				featureName: (f) => {
					const key = `play.map.town.feature.${f.id}` as MessageKey;
					const s = t(key);
					return s === key ? f.name : s;
				},
				damLabel: t("play.map.town.dam"),
				walkLabel: (mins) => t("play.map.town.onFoot", { t: travelLabel(mins / 1440) }),
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [box, grid, world.name, featureKey, fontReady, family, dpr, viewKey, isTown, lang, t, travelLabel]);

	useEffect(() => {
		const c = overRef.current;
		if (!c || !box || !fontReady) return;
		c.width = Math.round(box.w * dpr);
		c.height = Math.round(box.h * dpr);
		(isTown ? paintTownOverlay : paintWorldOverlay)(c.getContext("2d")!, world, c.width, c.height, {
			fontFamily: family,
			showUndiscovered,
			hoverId: hover,
			selectedId: selectedLocationId,
			daysLabel: travelLabel,
			viewScale: view.s,
			pixelRatio: dpr,
			pinHeight: 50 * dpr,
			reserved: isTown ? reservedRef.current : undefined,
		});
	}, [box, world, fontReady, family, showUndiscovered, hover, selectedLocationId, dpr, travelLabel, view.s, isTown]);

	const current = world.locations.find((l) => l.id === world.currentLocationId);
	const visible = world.locations.filter((l) => (l.discovered || showUndiscovered) && (scope === "world" || inView(l, 0)));
	const hovered = visible.find((l) => l.id === hover);

	return (
		<div ref={wrapRef} className={`relative grid h-full w-full place-items-center overflow-hidden ${chrome.wrap} ${isTown ? townFont.className : mapFont.className} ${className ?? ""}`}>
			{box && (
				<div className="relative shadow-[0_10px_40px_rgba(0,0,0,0.6)]" style={{ width: box.w, height: box.h }}>
					<canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
					<canvas ref={overRef} className="absolute inset-0 h-full w-full" />
					{hasHere && (
						<div className={`absolute right-[5%] top-[5%] z-20 flex overflow-hidden rounded border text-sm shadow ${chrome.toggle}`}>
							{(["region", "world"] as const).map((k) => (
								<button
									key={k}
									type="button"
									aria-pressed={scope === k}
									className={`px-3 py-1 ${scope === k ? chrome.on : chrome.off}`}
									onClick={() => { setScope(k); setHover(null); }}
								>
									{t(k === "region" ? "play.map.region" : "play.map.world")}
								</button>
							))}
						</div>
					)}
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
							className={`absolute h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 ${chrome.focus}`}
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
							className={`pointer-events-none absolute z-10 max-w-64 -translate-x-1/2 rounded border px-3 py-1.5 text-center shadow-lg ${chrome.tip}`}
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
