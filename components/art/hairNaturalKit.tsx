import type { ReactNode } from "react";
import type { ArtRng } from "@/lib/art/rand";
import {
	clamp, hairPalette, lerp, linePath, makeSkull, natRng, paintFuzz, qPath, smoothstep,
	type Guide, type HairPal, type NatCtx, type NatLayers, type P, type Skull,
} from "./hairNatural";

/** The kit every natural cut is drawn with: the head, the RNG, the palette and shared pieces. */

export interface Kit {
	c: NatCtx;
	sk: Skull;
	rng: ArtRng;
	pal: HairPal;
	cx: number;
	w: number;
	top: number;
	/** Volume multiplier on top (headwear flattens it). */
	flat: boolean;
}

// ─── Shared pieces ──────────────────────────────────────────────────────

/** y of the front hairline at x (the highest crossing). */
export function yOn(pts: P[], x: number): number {
	let best = Infinity;
	for (let i = 1; i < pts.length; i++) {
		const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
		if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) {
			const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
			best = Math.min(best, lerp(y0, y1, t));
		}
	}
	return best;
}

/** The front stretch of a hairline (between the temples), left → right. */
export function frontOf(k: Kit, hl: P[], span = 0.84): P[] {
	return hl.filter(([x, y]) => Math.abs(x - k.cx) <= k.w * span && y < 90);
}

/** Region polygon: the shell over the head from ear to ear, closed along the hairline. */
export function region(k: Kit, T: (u: number) => number, hl: P[], earY = 95): P[] {
	const u = k.sk.uAtY(earY);
	const sh = k.sk.shell(T, -u, u, 32);
	// hairline runs left ear → right ear; walk it back right → left
	return [...sh, ...hl.slice().reverse()];
}

/** Scalp tint under clipper-short hair: strong at the top, fading toward the ears. */
export function scalpTint(k: Kit, key: string, d: string, yA: number, yB: number, oA: number, oB: number, col?: string): ReactNode {
	const gid = k.c.id(`nst-${key}`);
	return (
		<g key={key}>
			<defs>
				<linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={0} y1={yA} x2={0} y2={yB}>
					<stop offset="0" stopColor={col ?? k.pal.scalp} stopOpacity={oA} />
					<stop offset="1" stopColor={col ?? k.pal.scalp} stopOpacity={oB} />
				</linearGradient>
			</defs>
			<path d={d} fill={`url(#${gid})`} />
		</g>
	);
}

/** Thin outline along a silhouette (open path). */
export function rim(k: Kit, pts: P[], key: string, op = 0.55, wid = 0.8): ReactNode {
	return <path key={key} d={qPath(pts, false)} fill="none" stroke={k.pal.line} strokeWidth={wid} opacity={op} strokeLinecap="round" strokeLinejoin="round" />;
}

/** Hair direction for clipper hair: radiating from the crown, falling on the sides. */
export const crownDir = (k: Kit, cy = 26) => (x: number, y: number) => Math.atan2(y - cy, (x - k.cx) * 0.9);

/** Distance (approx.) from a point to a polyline. */
export function distTo(pts: P[], x: number, y: number): number {
	let best = Infinity;
	for (let i = 1; i < pts.length; i++) {
		const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
		const dx = bx - ax, dy = by - ay;
		const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
		best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
	}
	return best;
}

/**
 * Clipper-cut sides (and back): a scalp tint and fuzz whose density falls from
 * `dTop` at y = yTop to `dBot` at y = yBot. Covers `reg` (usually the whole
 * hair region; the longer top is drawn over it).
 */
export function clipperSides(k: Kit, key: string, reg: P[], hl: P[], o: { yTop: number; yBot: number; dTop: number; dBot: number; step?: number; len?: [number, number]; tint?: [number, number] }): ReactNode {
	const d = linePath(reg);
	const edge = hl;
	const dens = (x: number, y: number) => {
		const v = lerp(o.dTop, o.dBot, smoothstep((y - o.yTop) / (o.yBot - o.yTop)));
		// thinner right at the hairline: a soft edge, not a cut line
		const e = distTo(edge, x, y);
		return v * (0.35 + 0.65 * smoothstep(e / 2.6));
	};
	const [ta, tb] = o.tint ?? [0.8, 0.28];
	return (
		<g key={key}>
			{scalpTint(k, `${key}-t`, d, o.yTop, o.yBot, ta, tb)}
			{paintFuzz(k.c, reg, { density: dens, dir: crownDir(k), step: o.step ?? 1.25, len: o.len ?? [1.1, 2], wid: 0.6, tone: -0.6 }, k.pal, k.rng, `${key}-f`)}
		</g>
	);
}

/** Guides from the front hairline up to the silhouette (hair brushed up / back). */
export function upGuides(k: Kit, hlFront: P[], T: (u: number) => number, n: number, o: { span?: number; lean?: number; lift?: number; uMax?: number } = {}): Guide[] {
	const gs: Guide[] = [];
	const span = o.span ?? 0.8;
	for (let i = 0; i <= n; i++) {
		const a = -1 + (2 * i) / n;
		const x = k.cx + a * k.w * span;
		const y = yOn(hlFront, x);
		if (!Number.isFinite(y)) continue;
		const u = a * (o.uMax ?? 0.62);
		const tip = k.sk.at(u, T(u) + 0.5);
		const root: P = [x, y + 0.5];
		const lift = o.lift ?? 6;
		const lean = (o.lean ?? 0) * k.w;
		gs.push([root, [x + lean * 0.3, y - lift], [tip[0] + lean * 0.4, tip[1] + 4], [tip[0] + lean * 0.2, tip[1]]]);
	}
	return gs;
}

export function layers(back: ReactNode, front: ReactNode, extra: ReactNode = null): NatLayers {
	return { back, front, extra };
}

export type Cut = (k: Kit) => NatLayers;

export function makeKit(style: string, c: NatCtx): Kit {
	return { c, sk: makeSkull(c), rng: natRng(c, style), pal: hairPalette(c.hair, c.skin), cx: c.cx, w: c.w, top: c.top, flat: c.cover !== "none" };
}
