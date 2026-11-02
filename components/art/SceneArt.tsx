"use client";

import { useCallback, useId, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import type { PortraitSpec, SceneKind, SceneState } from "@/lib/game/types";
import { mix } from "@/lib/art/color";
import { ArtRng } from "@/lib/art/rand";
import { SCENE_KINDS, isInterior, normalizeProps, sceneSeed, skyPalette, type SceneProp } from "@/lib/art/scene";
import { Portrait } from "./Portrait";
import { Haze, MoodGrade, SCENE_CSS, SceneDefs, Sky, Texture, WeatherFx } from "./scene/effects";
import { setIdPrefix } from "./scene/geom";
import { buildInterior } from "./scene/interior";
import { buildOutdoor, type Layers, type OutCtx } from "./scene/outdoor";
import { drawProp, type PropCtx } from "./scene/props";
import { pickBackdrop, type Backdrop } from "@/lib/art/backdrops";

export interface SceneNpc {
	id: string;
	name: string;
	portrait: PortraitSpec;
	speciesId?: string;
	role?: string;
}

export interface SceneArtProps {
	scene: SceneState;
	/** NPCs that may appear; those listed in scene.npcIds are shown as a portrait row. */
	npcs?: SceneNpc[];
	/** Mouse parallax (default true). */
	parallax?: boolean;
	/** Run ambient animations (default true; always off with prefers-reduced-motion). */
	animate?: boolean;
	/** Title + caption overlay (default true). */
	showCaption?: boolean;
	/** Portrait size in px (default 76). */
	portraitSize?: number;
	/** "paintings" (public-domain painted backdrops, default) or "illustrated" (procedural SVG). */
	style?: "paintings" | "illustrated";
	className?: string;
	css?: CSSProperties;
}

const DEFAULT_PROPS: Partial<Record<SceneKind, SceneProp[]>> = {
	camp: ["campfire", "tents"],
	temple: ["altar"],
	crypt: ["candles"],
	underdark: ["mushrooms"],
	road: ["signpost"],
	town: ["well"],
};

const DEPTH = { sky: 3, far: 7, mid: 14, near: 22, props: 26, fg: 38 } as const;

function layerStyle(d: number): CSSProperties {
	return { transform: `translate(calc(var(--px, 0) * ${d}px), calc(var(--py, 0) * ${d * 0.45}px))` };
}

/**
 * Procedural, layered, deterministic scene illustration (16:9, scales to fit).
 * Same SceneState → same picture (seeded from title + kind).
 */
export function SceneArt({ scene, npcs, parallax = true, animate = true, showCaption = true, portraitSize = 76, className, css, style = "paintings" }: SceneArtProps) {
	const rid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const ref = useRef<HTMLDivElement>(null);
	const frame = useRef(0);

	const sceneKey = JSON.stringify([scene.title, scene.kind, scene.timeOfDay, scene.weather, scene.mood, scene.props]);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const backdrop = useMemo(() => (style === "paintings" ? pickBackdrop(scene) : undefined), [style, sceneKey]); // eslint-disable-line react-hooks/exhaustive-deps
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const svg = useMemo(() => (backdrop ? renderPainted(scene, backdrop, `sc${rid}`) : renderScene(scene, `sc${rid}`)), [sceneKey, rid, backdrop]);

	const onMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!parallax || !ref.current) return;
			const el = ref.current;
			const rect = el.getBoundingClientRect();
			const px = ((e.clientX - rect.left) / rect.width) * 2 - 1;
			const py = ((e.clientY - rect.top) / rect.height) * 2 - 1;
			cancelAnimationFrame(frame.current);
			frame.current = requestAnimationFrame(() => {
				el.style.setProperty("--px", (-px).toFixed(3));
				el.style.setProperty("--py", (-py).toFixed(3));
			});
		},
		[parallax],
	);
	const onLeave = useCallback(() => {
		ref.current?.style.setProperty("--px", "0");
		ref.current?.style.setProperty("--py", "0");
	}, []);

	const present = (npcs ?? []).filter((n) => scene.npcIds.includes(n.id));
	// Crowded scenes get smaller portraits.
	const pSize = present.length > 5 ? Math.round(portraitSize * 0.65) : present.length > 3 ? Math.round(portraitSize * 0.8) : portraitSize;

	return (
		<div
			ref={ref}
			className={clsx("dh-scene group/scene relative isolate aspect-video w-full overflow-hidden bg-black select-none", !animate && "dh-still", className)}
			style={css}
			onPointerMove={onMove}
			onPointerLeave={onLeave}
		>
			<style>{SCENE_CSS + PAINTED_CSS}</style>
			{svg}
			{backdrop && (
				<a
					href={backdrop.source}
					target="_blank"
					rel="noreferrer"
					className="absolute top-2 left-2 z-10 max-w-[45%] truncate rounded bg-black/35 px-2 py-0.5 font-serif text-[10px] text-amber-50/60 italic opacity-0 transition-opacity hover:text-amber-50 group-hover/scene:opacity-100"
					title={`${backdrop.title} — ${backdrop.artist}${backdrop.year ? `, ${backdrop.year}` : ""} (${backdrop.license})`}
				>
					{backdrop.title} · {backdrop.artist}
				</a>
			)}
			{showCaption && (scene.title || scene.caption) && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-5 pt-14 pb-4">
					<div className="font-serif text-[clamp(1rem,2.4vw,1.75rem)] leading-tight tracking-wide text-amber-50 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">{scene.title}</div>
					{scene.caption && <div className="mt-1 max-w-[70%] font-serif text-[clamp(0.75rem,1.4vw,1rem)] italic text-amber-100/80">{scene.caption}</div>}
				</div>
			)}
			{present.length > 0 && (
				// Top-right, wrapping leftward, so many portraits never cover the caption at the bottom.
				<div className="absolute top-3 right-3 flex max-w-[70%] flex-row-reverse flex-wrap items-start justify-start gap-2">
					{present.map((n) => (
						<div key={n.id} className="group relative drop-shadow-[0_6px_14px_rgba(0,0,0,0.7)] transition-transform hover:-translate-y-1" title={n.role ? `${n.name} — ${n.role}` : n.name}>
							<Portrait spec={n.portrait} speciesId={n.speciesId} size={pSize} />
							<div className="mt-1 max-w-[--w] truncate text-center font-serif text-[11px] text-amber-50/90" style={{ maxWidth: pSize }}>
								{n.name}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/** Pure render of the scene SVG (also usable server-side). */
export function renderScene(scene: SceneState, idPrefix = "sc"): ReactNode {
	setIdPrefix(idPrefix);
	if (!SCENE_KINDS.includes(scene.kind)) scene = { ...scene, kind: "plains" };
	const seed = sceneSeed(scene);
	const rng = new ArtRng(seed);
	const interior = isInterior(scene.kind);
	const pal = skyPalette(scene.timeOfDay, interior && scene.weather === "snow" ? "cloudy" : scene.weather);
	const sunX = Math.round(rng.range(240, 620));
	const horizon = 560;
	const windowsLit = scene.timeOfDay === "night" || scene.timeOfDay === "dusk" || scene.mood === "festive" || scene.weather === "storm";
	const lightC = pal.night ? "#9ab4e8" : mix(pal.light, "#ffffff", 0.2);
	const ctx: OutCtx = { rng: rng.fork("layers"), pal, kind: scene.kind, snow: scene.weather === "snow" && !interior, light: lightC, windowsLit, sunX };
	const L: Layers = interior ? buildInterior(ctx) : buildOutdoor(ctx);

	let props = normalizeProps(scene.props ?? []);
	if (props.length === 0) props = DEFAULT_PROPS[scene.kind] ?? [];
	const pctx: PropCtx = {
		rng: rng.fork("props"),
		pal,
		light: interior ? "#ffc890" : lightC,
		dark: interior ? 0.35 : pal.dark * 0.8,
		interior,
	};
	const slots = [800, 430, 1170, 220, 1380];
	const propNodes = props.slice(0, 5).map((p, i) => {
		const x = slots[i];
		const s = L.propScale * (i === 0 ? 1 : i < 3 ? 0.88 : 0.75);
		return drawProp(p, `p${i}-${p}`, x, L.groundAt(x), s, pctx);
	});

	const lightPos: [number, number] = interior ? [800, 380] : [sunX, horizon - 40 - pal.lightHeight * (horizon - 120)];

	return (
		<svg
			viewBox="0 0 1600 900"
			preserveAspectRatio="xMidYMid slice"
			className="absolute inset-0 h-full w-full"
			role="img"
			aria-label={`${scene.title}: ${scene.kind}, ${scene.timeOfDay}, ${scene.weather}, ${scene.mood}`}
		>
			{SceneDefs({ pal, seed })}
			<g transform="translate(800 450) scale(1.05) translate(-800 -450)">
				{!interior && (
					<g className="dh-layer" style={layerStyle(DEPTH.sky)}>
						{Sky({ pal, weather: scene.weather, rng: rng.fork("sky"), sunX, horizon })}
					</g>
				)}
				<g className="dh-layer" style={layerStyle(DEPTH.far)}>{L.far}</g>
				{!interior && Haze({ y: horizon - 10, h: 200, opacity: scene.weather === "fog" ? 1 : 0.45 })}
				<g className="dh-layer" style={layerStyle(DEPTH.mid)}>{L.mid}</g>
				{!interior && Haze({ y: horizon + 110, h: 180, opacity: scene.weather === "fog" ? 0.8 : 0.18 })}
				<g className="dh-layer" style={layerStyle(DEPTH.near)}>{L.near}</g>
				<g className="dh-layer" style={layerStyle(DEPTH.props)}>{propNodes}</g>
				<g className="dh-layer" style={layerStyle(DEPTH.fg)}>{L.fg}</g>
				{interior && (
					<g pointerEvents="none">
						<rect x={-100} y={-100} width={1800} height={1100} fill="#120a12" opacity={L.darkness ?? 0.45} style={{ mixBlendMode: "multiply" }} />
						{(L.lights ?? []).map((l, i) => (
							<circle key={i} cx={l.x} cy={l.y} r={l.r} fill={`url(#${idPrefix}-glow-${l.tone})`} opacity={l.o ?? 0.55} className={i % 2 ? "dh-glow" : "dh-glow2"} style={{ mixBlendMode: "screen" }} />
						))}
					</g>
				)}
				{WeatherFx({ weather: scene.weather, interior, pal, rng: rng.fork("weather"), kind: scene.kind })}
			</g>
			{MoodGrade({ mood: scene.mood, lightX: lightPos[0], lightY: lightPos[1] })}
			{Texture()}
		</svg>
	);
}

export default SceneArt;

// ─── Painted backdrops ───────────────────────────────────────────────────

const PAINTED_CSS = `
.dh-scene .dh-kb{animation:dhKB 48s ease-in-out infinite alternate;transform-origin:var(--kbx,50%) var(--kby,50%)}
.dh-scene .dh-fadein{animation:dhFadeIn 1.4s ease-out both}
.dh-scene .dh-torch{animation:dhTorch 2.3s ease-in-out infinite alternate}
.dh-scene .dh-torch2{animation:dhTorch 1.7s ease-in-out infinite alternate-reverse}
@keyframes dhKB{from{transform:scale(1.06) translate(0,0)}to{transform:scale(1.14) translate(-1.6%,-1%)}}
@keyframes dhFadeIn{from{opacity:0;filter:blur(6px)}to{opacity:1;filter:none}}
@keyframes dhTorch{0%{opacity:.55}30%{opacity:.75}60%{opacity:.5}100%{opacity:.8}}
.dh-still .dh-kb,.dh-still .dh-torch,.dh-still .dh-torch2{animation:none}
@media (prefers-reduced-motion: reduce){.dh-scene .dh-kb,.dh-scene .dh-torch,.dh-scene .dh-torch2{animation:none}}
`;

/** How far the painting's own lighting is from the scene's time of day → CSS grade. */
function grade(b: Backdrop, scene: SceneState): { filter: string; overlay?: { bg: string; blend: CSSProperties["mixBlendMode"]; opacity: number } } {
	const f: string[] = [];
	let overlay: ReturnType<typeof grade>["overlay"];
	if (b.monochrome) f.push("sepia(0.55)", "contrast(1.08)");
	if (!b.time.includes(scene.timeOfDay)) {
		switch (scene.timeOfDay) {
			case "night":
				f.push("brightness(0.5)", "saturate(0.55)");
				overlay = { bg: "linear-gradient(180deg,#0b1430,#1a2850)", blend: "multiply", opacity: 0.55 };
				break;
			case "dusk":
				f.push("brightness(0.85)", "saturate(1.05)");
				overlay = { bg: "linear-gradient(180deg,#5a2a6a 0%,#e0763a 55%,#3a1a20 100%)", blend: "soft-light", opacity: 0.6 };
				break;
			case "dawn":
				f.push("brightness(0.95)");
				overlay = { bg: "linear-gradient(180deg,#f0b0a0 0%,#f6d58a 60%,#40304a 100%)", blend: "soft-light", opacity: 0.45 };
				break;
			case "day":
				f.push("brightness(1.18)", "contrast(0.95)");
				break;
		}
	}
	if ((scene.weather === "cloudy" || scene.weather === "rain" || scene.weather === "fog") && !b.weather.includes(scene.weather)) f.push("saturate(0.75)");
	if (scene.weather === "storm" && !b.weather.includes("storm")) f.push("brightness(0.75)", "saturate(0.7)");
	if (b.monochrome && !overlay) {
		const tint: Partial<Record<SceneState["mood"], string>> = { eerie: "#2f6a4a", tense: "#7a2a2a", combat: "#8a2a1a", mysterious: "#2a3f7a", somber: "#3a3a4a" };
		overlay = { bg: tint[scene.mood] ?? "#6a4a2a", blend: "color", opacity: 0.35 };
	}
	return { filter: f.join(" ") || "none", overlay };
}

/** A painting with live grading, weather, firelight and slow camera drift; SVG effects reuse the procedural layer. */
export function renderPainted(scene: SceneState, b: Backdrop, idPrefix = "sc"): ReactNode {
	setIdPrefix(idPrefix);
	const seed = sceneSeed(scene);
	const rng = new ArtRng(seed);
	const interior = b.interior;
	const pal = skyPalette(scene.timeOfDay, scene.weather);
	const g = grade(b, scene);
	const fy = Math.round((b.focusY ?? 0.5) * 100);
	const firelit = interior && (scene.timeOfDay === "night" || scene.timeOfDay === "dusk" || ["crypt", "dungeon", "cave", "underdark", "tavern"].includes(scene.kind));
	const needsFog = scene.weather === "fog" || (scene.mood === "eerie" && !interior);
	return (
		<>
			<div className="dh-layer absolute inset-0" style={layerStyle(10)}>
				{/* key → a crossfade whenever the painting changes */}
				<img
					key={b.file}
					src={`/${b.file}`}
					alt={`${b.title} — ${b.artist}`}
					draggable={false}
					className="dh-kb dh-fadein absolute inset-0 h-full w-full object-cover"
					style={{ objectPosition: `50% ${fy}%`, filter: g.filter, ["--kby" as string]: `${fy}%` }}
				/>
			</div>
			{g.overlay && <div className="pointer-events-none absolute inset-0" style={{ background: g.overlay.bg, mixBlendMode: g.overlay.blend, opacity: g.overlay.opacity }} />}
			{firelit && (
				<>
					<div className="dh-torch pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 30% 70%, rgba(255,150,60,0.35), transparent 55%)", mixBlendMode: "screen" }} />
					<div className="dh-torch2 pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at 75% 60%, rgba(255,120,40,0.25), transparent 50%)", mixBlendMode: "screen" }} />
				</>
			)}
			<svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
				{SceneDefs({ pal, seed })}
				{needsFog && Haze({ y: 520, h: 300, opacity: scene.weather === "fog" ? 0.9 : 0.4 })}
				{needsFog && Haze({ y: 700, h: 260, opacity: scene.weather === "fog" ? 0.7 : 0.25 })}
				{(scene.weather === "rain" || scene.weather === "storm" || scene.weather === "snow") && WeatherFx({ weather: scene.weather, interior, pal, rng: rng.fork("weather"), kind: scene.kind })}
				{MoodGrade({ mood: scene.mood, lightX: 800, lightY: 300 })}
				{Texture()}
			</svg>
			<div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 160px 40px rgba(0,0,0,0.65)" }} />
		</>
	);
}
