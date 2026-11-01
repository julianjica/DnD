"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridMap, MapEntity, MapKind, WorldMap as WorldMapState } from "@/lib/game/types";
import { generateMap, MAP_KINDS } from "@/lib/maps/generate";
import { generateWorld, type Biome } from "@/lib/maps/world";
import { computePlayerView, findFreeSquares, isPassable, revealAround, sqKey, type Point } from "@/lib/maps/grid";
import type { MapFxEvent, TokenStatus } from "@/components/map/BattleMap";

const BattleMap = dynamic(() => import("@/components/map/BattleMap"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-stone-500">Loading renderer…</div> });
const WorldMap = dynamic(() => import("@/components/map/WorldMap"), { ssr: false });

const FEATURES = ["night", "dim", "water", "lava", "traps", "secret", "chasm", "palisade", "treasure"];
const BIOMES: Biome[] = ["temperate", "arid", "frozen", "tropical", "volcanic", "mixed"];
const MONSTERS = ["goblin", "orc", "skeleton", "wolf", "cultist", "spider", "ooze", "bandit", "zombie", "ogre", "fiend", "elemental"];

function demoEntities(map: GridMap, seed: number): { entities: MapEntity[]; status: Record<string, TokenStatus> } {
	const ents: MapEntity[] = [...map.entities];
	const m: GridMap = { ...map, entities: ents };
	const [pcSpot] = findFreeSquares(m, map.entry, 1, 1);
	const pc: MapEntity = { id: "pc", kind: "pc", name: "Aria (you)", sprite: "pc_fighter", x: pcSpot?.x ?? map.entry.x, y: pcSpot?.y ?? map.entry.y, size: 1, disposition: "friendly" };
	ents.push(pc);
	const status: Record<string, TokenStatus> = { pc: { hp: 24, maxHp: 31, side: "party" } };
	const [comp] = findFreeSquares(m, map.entry, 1, 1);
	if (comp) {
		ents.push({ id: "npc-1", kind: "npc", name: "Brother Odo", sprite: "priest", x: comp.x, y: comp.y, size: 1, disposition: "friendly" });
		status["npc-1"] = { hp: 9, maxHp: 9, side: "party" };
	}
	const rooms = map.rooms.filter((r) => r.tag !== "entrance");
	rooms.slice(0, 5).forEach((r, i) => {
		const big = i === 0 && (r.tag === "boss" || r.w * r.h > 30);
		const spots = findFreeSquares(m, { x: r.x + (r.w >> 1), y: r.y + (r.h >> 1) }, big ? 1 : 2, big ? 2 : 1);
		spots.forEach((p, j) => {
			const sprite = big ? (seed % 2 ? "dragon" : "ogre") : MONSTERS[(seed + i * 3 + j) % MONSTERS.length];
			const id = `m-${i}-${j}`;
			ents.push({ id, kind: "monster", name: `${sprite[0].toUpperCase()}${sprite.slice(1)} ${i + 1}${j ? "b" : ""}`, sprite, x: p.x, y: p.y, size: big ? 2 : 1, disposition: "hostile" });
			const max = big ? 60 : 7 + ((i + j) % 4) * 4;
			status[id] = { hp: Math.round(max * (0.4 + ((i * 7 + j * 3) % 6) / 10)), maxHp: max, side: "enemy" };
		});
	});
	return { entities: ents, status };
}

function bfsPath(map: GridMap, occupied: Set<string>, from: Point, to: Point, max = 60): Point[] | null {
	const W = map.width;
	const prev = new Map<number, number>();
	const s = from.y * W + from.x, t = to.y * W + to.x;
	const q = [s];
	prev.set(s, -1);
	for (let qi = 0; qi < q.length; qi++) {
		const i = q[qi];
		if (i === t) break;
		const x = i % W, y = (i / W) | 0;
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= W || ny >= map.height) continue;
			const ni = ny * W + nx;
			if (prev.has(ni) || !isPassable(map.tiles[ni]) || (occupied.has(sqKey(nx, ny)) && ni !== t)) continue;
			if (dx && dy && (!isPassable(map.tiles[y * W + nx]) || !isPassable(map.tiles[ny * W + x]))) continue;
			prev.set(ni, i);
			q.push(ni);
		}
	}
	if (!prev.has(t)) return null;
	const out: Point[] = [];
	for (let i = t; i !== -1; i = prev.get(i)!) out.push({ x: i % W, y: (i / W) | 0 });
	out.reverse();
	return out.length - 1 <= max ? out : null;
}

function reachable(map: GridMap, occupied: Set<string>, from: Point, steps: number): Set<string> {
	const W = map.width;
	const dist = new Map<number, number>([[from.y * W + from.x, 0]]);
	const q = [from.y * W + from.x];
	const out = new Set<string>();
	for (let qi = 0; qi < q.length; qi++) {
		const i = q[qi], d = dist.get(i)!;
		if (d >= steps) continue;
		const x = i % W, y = (i / W) | 0;
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= W || ny >= map.height) continue;
			const ni = ny * W + nx;
			if (dist.has(ni) || !isPassable(map.tiles[ni]) || occupied.has(sqKey(nx, ny))) continue;
			if (dx && dy && (!isPassable(map.tiles[y * W + nx]) || !isPassable(map.tiles[ny * W + x]))) continue;
			dist.set(ni, d + 1);
			q.push(ni);
			out.add(sqKey(nx, ny));
		}
	}
	return out;
}

export default function MapsPreview() {
	const [view, setView] = useState<MapKind | "world">("dungeon");
	const [seed, setSeed] = useState(1234);
	const [features, setFeatures] = useState<string[]>([]);
	const [fog, setFog] = useState(true);
	const [showHidden, setShowHidden] = useState(false);
	const [biome, setBiome] = useState<Biome>("temperate");
	const [selected, setSelected] = useState<string | undefined>("pc");
	const [hoverSq, setHoverSq] = useState<Point | null>(null);
	const [aoeOn, setAoeOn] = useState(false);
	const [events, setEvents] = useState<MapFxEvent[]>([]);
	const [focusNonce, setFocusNonce] = useState(0);
	const [fit, setFit] = useState(false);

	// Sync from the URL once (?kind=&seed=&fog=0&features=a,b&biome=&aoe=1&fit=1&sel=0) — an external source.
	const [noSel, setNoSel] = useState(false);
	useEffect(() => {
		const q = new URLSearchParams(window.location.search);
		const k = q.get("kind");
		/* eslint-disable react-hooks/set-state-in-effect */
		if (k && (MAP_KINDS as string[]).concat("world").includes(k)) setView(k as MapKind | "world");
		if (q.get("seed")) setSeed(Number(q.get("seed")) >>> 0);
		if (q.get("fog") === "0") setFog(false);
		if (q.get("features")) setFeatures(q.get("features")!.split(","));
		if (q.get("biome")) setBiome(q.get("biome") as Biome);
		if (q.get("aoe") === "1") setAoeOn(true);
		if (q.get("fit") === "1") setFit(true);
		if (q.get("sel") === "0") setNoSel(true);
		/* eslint-enable react-hooks/set-state-in-effect */
	}, []);

	const base = useMemo(() => (view === "world" ? null : generateMap({ kind: view, seed, features })), [view, seed, features]);
	type DemoState = { map: GridMap; entities: MapEntity[]; status: Record<string, TokenStatus> };
	const [state, setState] = useState<DemoState | null>(null);
	const [stateFor, setStateFor] = useState<GridMap | null>(null);
	// Derive fresh demo state whenever the generated map changes (render-time reset pattern).
	if (base !== stateFor) {
		setStateFor(base);
		if (!base) setState(null);
		else {
			const demo = demoEntities(base, seed);
			const map: GridMap = { ...base, explored: base.explored.slice() };
			const pc = demo.entities.find((e) => e.kind === "pc")!;
			revealAround(map, pc.x, pc.y, 24);
			setState({ map, entities: demo.entities, status: demo.status });
			setSelected(noSel ? undefined : "pc");
		}
	}

	const world: WorldMapState | null = useMemo(() => {
		if (view !== "world") return null;
		const w = generateWorld({ seed, biome });
		// reveal everything nearby for the preview
		return { ...w, locations: w.locations.map((l, i) => ({ ...l, discovered: l.discovered || i < 6 })), routes: w.routes.map((r) => ({ ...r, discovered: true })) };
	}, [view, seed, biome]);

	const occupied = useMemo(() => {
		const s = new Set<string>();
		for (const e of state?.entities ?? []) if (e.kind !== "light" && e.kind !== "item" && e.kind !== "trap") for (let dy = 0; dy < e.size; dy++) for (let dx = 0; dx < e.size; dx++) s.add(sqKey(e.x + dx, e.y + dy));
		return s;
	}, [state]);

	const sel = state?.entities.find((e) => e.id === selected);
	const selCreature = sel && (sel.kind === "pc" || sel.kind === "monster" || sel.kind === "npc") ? sel : undefined;
	const highlights = useMemo(() => {
		if (!state || !selCreature || aoeOn) return undefined;
		const occ = new Set(occupied);
		for (let dy = 0; dy < selCreature.size; dy++) for (let dx = 0; dx < selCreature.size; dx++) occ.delete(sqKey(selCreature.x + dx, selCreature.y + dy));
		return reachable(state.map, occ, selCreature, 6);
	}, [state, selCreature, occupied, aoeOn]);
	const path = useMemo(() => {
		if (!state || !selCreature || !hoverSq || aoeOn || !highlights?.has(sqKey(hoverSq.x, hoverSq.y))) return undefined;
		return bfsPath(state.map, occupied, selCreature, hoverSq, 12) ?? undefined;
	}, [state, selCreature, hoverSq, occupied, aoeOn, highlights]);
	const aoe = useMemo(() => (aoeOn && hoverSq ? { shape: "sphere" as const, origin: hoverSq, size: 20, color: 0xff6a2a } : null), [aoeOn, hoverSq]);

	const visibleSquares = useMemo(() => {
		if (!state) return undefined;
		const pc = state.entities.find((e) => e.kind === "pc");
		return pc ? computePlayerView(state.map, pc, { entities: state.entities, darkvision: 0 }) : undefined;
	}, [state]);

	const onSquareClick = useCallback((p: Point) => {
		if (!state) return;
		if (aoeOn) {
			const hit = state.entities.filter((e) => e.kind === "monster" && Math.hypot(e.x - p.x, e.y - p.y) <= 4);
			setEvents((ev) => [...ev.slice(-20), ...hit.map((h, i) => ({ id: `fx-${Date.now()}-${i}`, entityId: h.id, text: `-${8 + ((h.x * 7 + h.y) % 15)}`, kind: "damage" as const }))]);
			if (!hit.length) setEvents((ev) => [...ev.slice(-20), { id: `fx-${Date.now()}`, x: p.x, y: p.y, text: "Fireball!", kind: "info" }]);
			return;
		}
		if (!selCreature || !highlights?.has(sqKey(p.x, p.y))) return;
		const map = { ...state.map, explored: state.map.explored.slice() };
		const entities = state.entities.map((e) => (e.id === selCreature.id ? { ...e, x: p.x, y: p.y } : e));
		if (selCreature.kind === "pc") revealAround(map, p.x, p.y, 24);
		setState({ ...state, map, entities });
	}, [state, selCreature, highlights, aoeOn]);

	const onTokenClick = useCallback((e: MapEntity) => {
		if (!state) return;
		if (sel && sel.id !== e.id && e.kind === "monster" && sel.kind === "pc") {
			const st = state.status[e.id];
			const roll = (e.x * 13 + e.y * 7 + Date.now()) % 20;
			const crit = roll === 19, miss = roll < 6;
			const dmg = miss ? 0 : crit ? 14 : 6 + (roll % 5);
			setEvents((ev) => [...ev.slice(-20), { id: `fx-${Date.now()}`, entityId: e.id, text: miss ? "Miss" : crit ? `CRIT -${dmg}` : `-${dmg}`, kind: miss ? "miss" : crit ? "crit" : "damage" }]);
			if (st?.hp !== undefined) setState({ ...state, status: { ...state.status, [e.id]: { ...st, hp: Math.max(0, st.hp - dmg), dead: st.hp - dmg <= 0 } } });
			return;
		}
		setSelected(e.id);
	}, [state, sel]);

	const toggleFeature = (f: string) => setFeatures((fs) => (fs.includes(f) ? fs.filter((x) => x !== f) : [...fs, f]));

	return (
		<div className="flex h-screen w-full bg-stone-950 text-stone-200">
			<aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-white/10 p-4 text-sm">
				<div>
					<h1 className="text-lg font-semibold text-amber-200">Map preview</h1>
					<p className="text-xs text-stone-400">Procedural generators + renderers (dev only).</p>
				</div>
				<div>
					<div className="mb-1 text-xs uppercase tracking-wide text-stone-500">Kind</div>
					<div className="grid grid-cols-2 gap-1">
						{[...MAP_KINDS, "world" as const].map((k) => (
							<button key={k} onClick={() => setView(k)} className={`rounded px-2 py-1 text-left capitalize ${view === k ? "bg-amber-700/60 text-amber-50" : "bg-white/5 hover:bg-white/10"}`}>
								{k.replace("_", " ")}
							</button>
						))}
					</div>
				</div>
				<div>
					<div className="mb-1 text-xs uppercase tracking-wide text-stone-500">Seed</div>
					<div className="flex gap-1">
						<button className="rounded bg-white/5 px-2 hover:bg-white/10" onClick={() => setSeed((s) => Math.max(0, s - 1))}>‹</button>
						<input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) >>> 0)} className="w-full rounded bg-black/40 px-2 py-1 text-center" />
						<button className="rounded bg-white/5 px-2 hover:bg-white/10" onClick={() => setSeed((s) => s + 1)}>›</button>
						<button className="rounded bg-white/5 px-2 hover:bg-white/10" title="Random" onClick={() => setSeed(Math.floor(Math.random() * 1e6))}>⚄</button>
					</div>
				</div>
				{view === "world" ? (
					<div>
						<div className="mb-1 text-xs uppercase tracking-wide text-stone-500">Biome</div>
						<div className="grid grid-cols-2 gap-1">
							{BIOMES.map((b) => (
								<button key={b} onClick={() => setBiome(b)} className={`rounded px-2 py-1 capitalize ${biome === b ? "bg-amber-700/60" : "bg-white/5 hover:bg-white/10"}`}>{b}</button>
							))}
						</div>
					</div>
				) : (
					<>
						<div>
							<div className="mb-1 text-xs uppercase tracking-wide text-stone-500">Features</div>
							<div className="flex flex-wrap gap-1">
								{FEATURES.map((f) => (
									<button key={f} onClick={() => toggleFeature(f)} className={`rounded-full px-2 py-0.5 text-xs ${features.includes(f) ? "bg-sky-700/70" : "bg-white/5 hover:bg-white/10"}`}>{f}</button>
								))}
							</div>
						</div>
						<div className="flex flex-col gap-1">
							<label className="flex items-center gap-2"><input type="checkbox" checked={fog} onChange={(e) => setFog(e.target.checked)} /> Fog of war</label>
							<label className="flex items-center gap-2"><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden (DM)</label>
							<label className="flex items-center gap-2"><input type="checkbox" checked={aoeOn} onChange={(e) => setAoeOn(e.target.checked)} /> Fireball template (20 ft)</label>
						</div>
						{state && (
							<div className="space-y-1 text-xs text-stone-400">
								<div>{state.map.name} · {state.map.width}×{state.map.height} · {state.map.lighting}</div>
								<div>Rooms: {state.map.rooms.map((r) => r.tag).join(", ")}</div>
								<div className="pt-2 text-stone-300">Click a token to select it; click a blue square to move. With the PC selected, click a monster to attack. Wheel to zoom, drag to pan.</div>
								<button className="mt-2 rounded bg-white/5 px-2 py-1 hover:bg-white/10" onClick={() => setFocusNonce((n) => n + 1)}>Center on PC</button>
							</div>
						)}
					</>
				)}
			</aside>
			<main className="relative min-w-0 flex-1">
				{view === "world" && world ? (
					<WorldMap world={world} onLocationClick={(l) => alert(`${l.name} (${l.kind})`)} />
				) : state ? (
					<BattleMap
						map={state.map}
						entities={state.entities}
						status={state.status}
						selectedId={selected}
						highlights={highlights}
						pathPreview={path}
						aoe={aoe}
						events={events}
						fog={fog}
						showHidden={showHidden}
						visibleSquares={fog ? visibleSquares : undefined}
						focus="pc"
						initialView={fit ? "fit" : "focus"}
						focusNonce={focusNonce}
						onSquareClick={onSquareClick}
						onTokenClick={onTokenClick}
						onSquareHover={setHoverSq}
					/>
				) : null}
			</main>
		</div>
	);
}
