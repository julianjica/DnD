import type { WorldLocation, WorldMap } from "../game/types";
import { mapDistance } from "./geography";
import { WORLD_ASPECT } from "./world";

/**
 * Region map: a zoomed window on the world map around the party. A view is a
 * square in normalized coords ({x0,y0} top-left, side `s` on both axes), so it
 * keeps the world's 3:2 aspect. Rendering a region = rendering a "projected"
 * world whose coordinates are relative to the view.
 */

export interface MapView {
	x0: number;
	y0: number;
	s: number;
}

export const FULL_VIEW: MapView = { x0: 0, y0: 0, s: 1 };

/** Places within this map distance of the party count as "the region" (~1.5 days on foot). */
const REGION_RADIUS = 0.1;
const MIN_S = 0.07;
const MAX_S = 0.25;

export function regionView(world: WorldMap): MapView {
	const here = world.locations.find((l) => l.id === world.currentLocationId);
	if (!here) return FULL_VIEW;
	const near = world.locations.filter((l) => l.discovered && mapDistance(l, here) <= REGION_RADIUS);
	const pts = [here, ...near];
	const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
	const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
	const s = Math.max(MIN_S, Math.min(MAX_S, Math.max(maxX - minX, maxY - minY) * 1.35));
	// Centre on the cluster but always keep the party well inside the frame.
	let cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
	const lim = s * 0.32;
	cx = Math.max(here.x - lim, Math.min(here.x + lim, cx));
	cy = Math.max(here.y - lim, Math.min(here.y + lim, cy));
	return {
		x0: Math.max(0, Math.min(1 - s, cx - s / 2)),
		y0: Math.max(0, Math.min(1 - s, cy - s / 2)),
		s,
	};
}

export const toView = (v: MapView, p: { x: number; y: number }) => ({ x: (p.x - v.x0) / v.s, y: (p.y - v.y0) / v.s });
export const inView = (p: { x: number; y: number }, m = 0) => p.x >= m && p.x <= 1 - m && p.y >= m && p.y <= 1 - m;

/** The world as seen through `view` (locations and named regions re-expressed in view coords). */
export function projectWorld(world: WorldMap, view: MapView, name?: string): WorldMap {
	if (view.s === 1 && view.x0 === 0 && view.y0 === 0 && !name) return world;
	return {
		...world,
		name: name ?? world.name,
		locations: world.locations.map((l) => ({ ...l, ...toView(view, l) })),
		terrain: {
			...world.terrain,
			features: (world.terrain.features ?? []).map((f) => ({ ...f, ...toView(view, f), r: f.r / view.s })),
		},
	};
}

/**
 * Nudges icons apart for display only, so places a few minutes from each
 * other don't print on top of one another. `minSep` is in map-width units;
 * the current location stays put. Returns new positions by id.
 */
export function declutter(locs: WorldLocation[], minSep: number, pinnedId?: string): Map<string, { x: number; y: number }> {
	const pos = locs.map((l) => ({ id: l.id, x: l.x * WORLD_ASPECT, y: l.y, pinned: l.id === pinnedId }));
	const sep = minSep * WORLD_ASPECT;
	for (let it = 0; it < 60; it++) {
		let moved = false;
		for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
			const a = pos[i], b = pos[j];
			let dx = b.x - a.x, dy = b.y - a.y;
			let d = Math.hypot(dx, dy);
			if (d >= sep) continue;
			if (d < 1e-6) {
				// Coincident: split along a stable direction derived from the ids.
				const ang = ((a.id.length * 7 + b.id.length * 13 + i + j * 3) % 8) * (Math.PI / 4);
				dx = Math.cos(ang); dy = Math.sin(ang); d = 0;
			} else { dx /= d; dy /= d; }
			const push = (sep - d) / 2;
			const wa = a.pinned ? 0 : b.pinned ? 2 : 1, wb = b.pinned ? 0 : a.pinned ? 2 : 1;
			a.x -= dx * push * wa; a.y -= dy * push * wa;
			b.x += dx * push * wb; b.y += dy * push * wb;
			moved = true;
		}
		if (!moved) break;
	}
	return new Map(pos.map((p) => [p.id, { x: p.x / WORLD_ASPECT, y: p.y }]));
}

/** Where the segment from an inside point toward an outside point leaves the frame (with margin). */
export function exitPoint(inside: { x: number; y: number }, outside: { x: number; y: number }, m = 0.04): { x: number; y: number } {
	let lo = 0, hi = 1;
	for (let k = 0; k < 24; k++) {
		const t = (lo + hi) / 2;
		const p = { x: inside.x + (outside.x - inside.x) * t, y: inside.y + (outside.y - inside.y) * t };
		if (inView(p, m)) lo = t; else hi = t;
	}
	return { x: inside.x + (outside.x - inside.x) * lo, y: inside.y + (outside.y - inside.y) * lo };
}
