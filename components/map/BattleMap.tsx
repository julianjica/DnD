"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GridMap, MapEntity } from "@/lib/game/types";
import type { AoeTemplate } from "@/lib/maps/aoe";
import type { Point } from "@/lib/maps/grid";
import { useT } from "@/components/i18n/I18nProvider";
import type { BattleRenderer, MapFxEvent, RendererCallbacks, TokenStatus } from "./battle/BattleRenderer";
import type { Look } from "@/components/art/sprite/pixelScene";

export type { MapFxEvent, TokenStatus };

export interface BattleMapProps {
	map: GridMap;
	/** Entities to draw (defaults to map.entities). */
	entities?: MapEntity[];
	/** Per-entity combat status (HP bar, side colour, dead), keyed by entity id. */
	status?: Record<string, TokenStatus>;
	onSquareClick?: (p: Point, e: PointerEvent) => void;
	onTokenClick?: (entity: MapEntity, e: PointerEvent) => void;
	onSquareHover?: (p: Point | null) => void;
	/** Reachable / targetable squares as "x,y" keys. */
	highlights?: Set<string>;
	/** Highlight colour (default soft blue). */
	highlightColor?: number;
	/** Movement path preview (square centres, start first). */
	pathPreview?: Point[];
	/** Label at the end of the path (default "<n×5> ft"). */
	pathLabel?: string;
	/** Area-of-effect template preview. */
	aoe?: (AoeTemplate & { color?: number }) | null;
	selectedId?: string;
	/** Camera target: an entity id or a square. Changing it pans smoothly. */
	focus?: string | Point | null;
	/** Bump to re-centre on the same focus target. */
	focusNonce?: number;
	/** Squares the player can currently see ("x,y"). Default: computed from the PC's line of sight. */
	visibleSquares?: Set<string>;
	/** PC darkvision in squares, used when visibleSquares is not given. */
	darkvision?: number;
	/** Floating combat text. Each id plays once. */
	events?: MapFxEvent[];
	/** Show the grid overlay (default true). */
	showGrid?: boolean;
	/** Fog of war (default true). DM/debug views can turn it off. */
	fog?: boolean;
	/** Draw hidden entities semi-transparent (DM view). */
	showHidden?: boolean;
	className?: string;
	/** Initial camera: tactical zoom on the PC (default) or the whole map. */
	initialView?: "focus" | "fit";
	/** Show the zoom/fit/grid controls (default true). */
	controls?: boolean;
	/** Pixel-sprite style with per-entity looks (PCs/NPCs). */
	pixel?: { looks: Record<string, Look> };
	/** The Quiet: false once the grid has failed (outbreak day 5+); street lamps stand dark. Default true. */
	powerOn?: boolean;
	/** Extra hover text per entity id (outside combat). */
	notes?: Record<string, string>;
	/** Exits to other maps, keyed "x,y" → destination name. */
	exits?: Record<string, string>;
}

/**
 * Tactical battle map (PixiJS v8). Pixi is imported lazily inside an effect so
 * the component is SSR-safe; the app is created once per mount (StrictMode
 * double-mount safe) and every prop change is applied incrementally.
 */
export default function BattleMap(props: BattleMapProps) {
	const { t, ts, lang } = useT();
	const hostRef = useRef<HTMLDivElement>(null);
	const rendererRef = useRef<BattleRenderer | null>(null);
	const cbRef = useRef<RendererCallbacks>({});
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// grid toggle: the user's choice wins until the showGrid prop changes
	const [gridPick, setGridPick] = useState<{ prop: boolean | undefined; on: boolean } | null>(null);
	const gridOn = gridPick && gridPick.prop === props.showGrid ? gridPick.on : (props.showGrid ?? true);
	const setGridOn = (f: (g: boolean) => boolean) => setGridPick({ prop: props.showGrid, on: f(gridOn) });
	const initialViewRef = useRef(props.initialView ?? "focus");

	useEffect(() => {
		cbRef.current = { onSquareClick: props.onSquareClick, onTokenClick: props.onTokenClick, onSquareHover: props.onSquareHover };
	});


	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		let cancelled = false;
		let renderer: BattleRenderer | null = null;
		let ro: ResizeObserver | null = null;
		(async () => {
			try {
				const [PIXI, mod] = await Promise.all([import("pixi.js"), import("./battle/BattleRenderer")]);
				if (cancelled) return;
				const app = new PIXI.Application();
				await app.init({ resizeTo: host, antialias: true, backgroundColor: 0x07060a, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), preference: "webgl" });
				if (cancelled) {
					app.destroy(true, { children: true });
					return;
				}
				app.canvas.style.display = "block";
				host.appendChild(app.canvas);
				renderer = new mod.BattleRenderer(PIXI, app, host, cbRef);
				renderer.initialView = initialViewRef.current;
				// resizeTo only follows window resizes; panels/tabs resize the host too
				ro = new ResizeObserver(() => {
					app.queueResize?.();
					renderer?.onResize();
				});
				ro.observe(host);
				rendererRef.current = renderer;
				setReady(true);
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			cancelled = true;
			ro?.disconnect();
			rendererRef.current = null;
			renderer?.destroy();
			setReady(false);
		};
	}, []);

	const { map, entities: rawEntities, status, highlights, highlightColor, pathPreview, pathLabel, aoe, selectedId, visibleSquares, darkvision, fog, showHidden } = props;
	const barricadeLabel = t("play.barricade");
	// Token labels in the UI language (SRD monster/object names).
	const entities = useMemo(() => {
		const list = rawEntities ?? map.entities;
		return lang === "en" ? list : list.map((e) => ({ ...e, name: ts(e.name) }));
	}, [rawEntities, map.entities, lang, ts]);
	useEffect(() => {
		if (!ready) return;
		rendererRef.current?.update({
			map,
			entities,
			status: status ?? {},
			visible: visibleSquares,
			fog: fog ?? true,
			showHidden: showHidden ?? false,
			highlights,
			highlightColor: highlightColor ?? 0x4ea1ff,
			path: pathPreview,
			pathLabel,
			aoe,
			selectedId,
			showGrid: gridOn,
			darkvision,
			pixel: props.pixel,
			powerOn: props.powerOn,
			barricadeLabel,
			notes: props.notes,
			exits: props.exits,
		});
	}, [ready, map, entities, status, visibleSquares, fog, showHidden, highlights, highlightColor, pathPreview, pathLabel, aoe, selectedId, gridOn, darkvision, props.pixel, props.powerOn, barricadeLabel, props.notes, props.exits]);

	const focusKey = props.focus == null ? "" : typeof props.focus === "string" ? props.focus : `${props.focus.x},${props.focus.y}`;
	useEffect(() => {
		if (!ready || !focusKey) return;
		rendererRef.current?.focus(props.focus);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ready, focusKey, props.focusNonce]);

	useEffect(() => {
		if (ready) rendererRef.current?.pushEvents(props.events);
	}, [ready, props.events]);

	const showControls = props.controls ?? true;
	return (
		<div className={`relative h-full w-full overflow-hidden bg-[#07060a] ${props.className ?? ""}`}>
			<div ref={hostRef} className="absolute inset-0" />
			{!ready && !error && <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-stone-400">{t("play.map.drawing")}</div>}
			{error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-red-300">{t("play.map.failed", { err: error })}</div>}
			{showControls && ready && (
				<div className="absolute bottom-3 right-3 flex gap-1 rounded-lg border border-white/10 bg-black/55 p-1 text-stone-200 shadow-lg backdrop-blur">
					<CtlButton label={t("play.map.zoomIn")} onClick={() => rendererRef.current?.zoomBy(1.25)}>+</CtlButton>
					<CtlButton label={t("play.map.zoomOut")} onClick={() => rendererRef.current?.zoomBy(0.8)}>−</CtlButton>
					<CtlButton label={t("play.map.fit")} onClick={() => rendererRef.current?.fitMap()}>⤢</CtlButton>
					<CtlButton label={t("play.map.grid")} active={gridOn} onClick={() => setGridOn((g) => !g)}>#</CtlButton>
				</div>
			)}
		</div>
	);
}

function CtlButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
	return (
		<button type="button" title={label} aria-label={label} onClick={onClick} className={`grid h-8 w-8 place-items-center rounded-md text-base font-semibold transition hover:bg-white/15 ${active ? "bg-white/15 text-amber-200" : ""}`}>
			{children}
		</button>
	);
}
