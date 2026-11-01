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
	className?: string;
	style?: CSSProperties;
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
export function SceneArt({ scene, npcs, parallax = true, animate = true, showCaption = true, portraitSize = 76, className, style }: SceneArtProps) {
	const rid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const ref = useRef<HTMLDivElement>(null);
	const frame = useRef(0);

	const sceneKey = JSON.stringify([scene.title, scene.kind, scene.timeOfDay, scene.weather, scene.mood, scene.props]);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const svg = useMemo(() => renderScene(scene, `sc${rid}`), [sceneKey, rid]);

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

	return (
		<div
			ref={ref}
			className={clsx("dh-scene relative isolate aspect-video w-full overflow-hidden bg-black select-none", !animate && "dh-still", className)}
			style={style}
			onPointerMove={onMove}
			onPointerLeave={onLeave}
		>
			<style>{SCENE_CSS}</style>
			{svg}
			{showCaption && (scene.title || scene.caption) && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-5 pt-14 pb-4">
					<div className="font-serif text-[clamp(1rem,2.4vw,1.75rem)] leading-tight tracking-wide text-amber-50 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">{scene.title}</div>
					{scene.caption && <div className="mt-1 max-w-[70%] font-serif text-[clamp(0.75rem,1.4vw,1rem)] italic text-amber-100/80">{scene.caption}</div>}
				</div>
			)}
			{present.length > 0 && (
				<div className="absolute right-3 bottom-3 flex items-end gap-2">
					{present.map((n) => (
						<div key={n.id} className="group relative drop-shadow-[0_6px_14px_rgba(0,0,0,0.7)] transition-transform hover:-translate-y-1" title={n.role ? `${n.name} — ${n.role}` : n.name}>
							<Portrait spec={n.portrait} speciesId={n.speciesId} size={portraitSize} />
							<div className="mt-1 max-w-[--w] truncate text-center font-serif text-[11px] text-amber-50/90" style={{ maxWidth: portraitSize }}>
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
