import type { ReactNode } from "react";
import { luminance, mix, shade } from "@/lib/art/color";
import { ArtRng, hashString, r1 } from "@/lib/art/rand";

/**
 * Natural hair: the drawing technique behind the everyday men's cuts
 * (hairNaturalCuts.tsx). Built on the portrait's real head outline:
 *
 * - the hair mass is a shell that sits a chosen thickness off the skull
 *   (`shell`), so short cuts hug the head and fuller cuts keep its shape;
 * - hairlines are drawn, not implied: temples, recession, widow's peak and
 *   sideburns (`hairline`), softened where hair meets skin;
 * - texture is clumps grown along guide curves (`clumps`), toned by the light
 *   (upper left) so strands catch highlights and part into shadow;
 * - clipper-short hair is a field of tiny dashes over a scalp tint (`fuzz`),
 *   with a density that falls off for tapers and fades.
 *
 * Everything is deterministic for a spec seed and uses its own RNG, so the
 * portrait's shared draws (and every existing portrait) are untouched.
 */

export type P = [number, number];
export type Cover = "none" | "hat" | "hood" | "helmet";

export interface NatCtx {
	cx: number;
	/** Head half-width at the cheekbones. */
	w: number;
	/** Top of the skull. */
	top: number;
	jaw: number;
	chin: number;
	/** The head outline's control points (closed Catmull-Rom loop, as drawn). */
	head: P[];
	skin: string;
	hair: string;
	seed: number;
	/** 0 young … 1 old. */
	age: number;
	/** Headwear over the hair: modern hats flatten it, hoods and helmets hide the top. */
	cover: Cover;
	id: (s: string) => string;
	url: (s: string) => string;
}

export interface NatLayers {
	/** Behind the head, neck and clothes (long hair down the back). */
	back: ReactNode;
	/** The hair on the head. Drawn even under hoods and helmets: they are drawn over it. */
	front: ReactNode;
	/** Over the face and clothes (locks falling in front of the shoulders). */
	extra: ReactNode;
}

// ─── Geometry helpers ───────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpP = (a: P, b: P, t: number): P => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const smooth01 = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
export { smooth01 as smoothstep, clamp };

/** Points of a Catmull-Rom spline (same maths as smoothPath), `per` samples per segment. */
export function catmull(pts: P[], closed = true, per = 8, tension = 1): P[] {
	const n = pts.length;
	const get = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
	const out: P[] = [];
	const segs = closed ? n : n - 1;
	const k = tension / 6;
	for (let i = 0; i < segs; i++) {
		const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
		const c1: P = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
		const c2: P = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
		for (let j = 0; j < per; j++) out.push(cubic([p1, c1, c2, p2], j / per));
	}
	if (!closed) out.push(pts[n - 1]);
	return out;
}

export function cubic(g: P[], t: number): P {
	if (g.length === 3) {
		const u = 1 - t;
		return [u * u * g[0][0] + 2 * u * t * g[1][0] + t * t * g[2][0], u * u * g[0][1] + 2 * u * t * g[1][1] + t * t * g[2][1]];
	}
	const u = 1 - t;
	const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
	return [a * g[0][0] + b * g[1][0] + c * g[2][0] + d * g[3][0], a * g[0][1] + b * g[1][1] + c * g[2][1] + d * g[3][1]];
}

/** A smooth closed or open path through points, using midpoint quadratics (cheap and round). */
export function qPath(pts: P[], closed = true): string {
	const n = pts.length;
	if (n < 3) return pts.length ? `M${r1(pts[0][0])} ${r1(pts[0][1])}` + pts.slice(1).map((p) => `L${r1(p[0])} ${r1(p[1])}`).join("") : "";
	const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
	if (closed) {
		const m0 = mid(pts[n - 1], pts[0]);
		let d = `M${r1(m0[0])} ${r1(m0[1])}`;
		for (let i = 0; i < n; i++) {
			const m = mid(pts[i], pts[(i + 1) % n]);
			d += `Q${r1(pts[i][0])} ${r1(pts[i][1])} ${r1(m[0])} ${r1(m[1])}`;
		}
		return d + "Z";
	}
	let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
	for (let i = 1; i < n - 1; i++) {
		const m = mid(pts[i], pts[i + 1]);
		d += `Q${r1(pts[i][0])} ${r1(pts[i][1])} ${r1(m[0])} ${r1(m[1])}`;
	}
	return d + `L${r1(pts[n - 1][0])} ${r1(pts[n - 1][1])}`;
}

/** Straight-segment path (for dense point lists). */
export function linePath(pts: P[], closed = true): string {
	return pts.map((p, i) => `${i ? "L" : "M"}${r1(p[0])} ${r1(p[1])}`).join("") + (closed ? "Z" : "");
}

export function inside(pts: P[], x: number, y: number): boolean {
	let c = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [xi, yi] = pts[i], [xj, yj] = pts[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
	}
	return c;
}

export const mirror = (pts: P[], cx: number): P[] => pts.map(([x, y]) => [2 * cx - x, y] as P);

// ─── The head ───────────────────────────────────────────────────────────

export interface Skull {
	/** Point on the skull outline at u ∈ [-1, 1] (left ear level → top → right ear level) pushed out by `t`. */
	at(u: number, t?: number): P;
	normal(u: number): P;
	/** u where the outline reaches height y on the right side (≥ 0). */
	uAtY(y: number): number;
	/** Head half-width at height y (any y from the crown to the chin). */
	halfW(y: number): number;
	/** Points over the top from u0 to u1, each pushed out by T(u). */
	shell(T: (u: number) => number, u0?: number, u1?: number, n?: number): P[];
	/** Head outline polygon (for inside tests). */
	poly: P[];
}

/** Lowest point (y) of the parametrised skull arc at u = ±1. */
export const SKULL_Y = 112;

export function makeSkull(c: NatCtx): Skull {
	const poly = catmull(c.head, true, 16);
	// right half: from the top going down the right side (head loop starts at the top, right side first)
	const iTop = 0;
	let iChin = poly.length / 2;
	for (let i = 0; i < poly.length; i++) if (poly[i][1] > poly[iChin][1]) iChin = i;
	const right = poly.slice(iTop, iChin + 1);
	const halfW = (y: number) => {
		if (y <= right[0][1]) return 0;
		for (let i = 1; i < right.length; i++) {
			const [x0, y0] = right[i - 1], [x1, y1] = right[i];
			if ((y0 <= y && y <= y1) || (y1 <= y && y <= y0)) {
				const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
				return lerp(x0, x1, t) - c.cx;
			}
		}
		return 0;
	};
	// arc from the top to SKULL_Y on the right, by arclength
	const arc: P[] = [];
	for (const p of right) { arc.push(p); if (p[1] >= SKULL_Y) break; }
	const len: number[] = [0];
	for (let i = 1; i < arc.length; i++) len.push(len[i - 1] + Math.hypot(arc[i][0] - arc[i - 1][0], arc[i][1] - arc[i - 1][1]));
	const L = len[len.length - 1];
	const onRight = (s: number): { p: P; n: P } => {
		const target = clamp(s, 0, 1) * L;
		let i = 1;
		while (i < len.length - 1 && len[i] < target) i++;
		const t = (target - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
		const p = lerpP(arc[i - 1], arc[i], t);
		const dx = arc[i][0] - arc[i - 1][0], dy = arc[i][1] - arc[i - 1][1];
		const m = Math.hypot(dx, dy) || 1;
		return { p, n: [dy / m, -dx / m] };
	};
	const at = (u: number, t = 0): P => {
		const { p, n } = onRight(Math.abs(u));
		const x = u >= 0 ? p[0] : 2 * c.cx - p[0];
		const nx = u >= 0 ? n[0] : -n[0];
		return [x + nx * t, p[1] + n[1] * t];
	};
	const normal = (u: number): P => { const { n } = onRight(Math.abs(u)); return [u >= 0 ? n[0] : -n[0], n[1]]; };
	const uAtY = (y: number) => {
		let lo = 0, hi = 1;
		for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (onRight(m).p[1] < y) lo = m; else hi = m; }
		return (lo + hi) / 2;
	};
	const shell = (T: (u: number) => number, u0 = -1, u1 = 1, n = 28): P[] => {
		const out: P[] = [];
		for (let i = 0; i <= n; i++) { const u = lerp(u0, u1, i / n); out.push(at(u, T(u))); }
		return out;
	};
	return { at, normal, uAtY, halfW, shell, poly };
}

// ─── Hairlines ──────────────────────────────────────────────────────────

export interface Hairline {
	/** Height of the front hairline at the centre (≈ 70 for an adult). */
	y: number;
	/** Widow's peak: how far the centre dips below the hairline. */
	peak?: number;
	/** Temple recession: how far the corners pull up and back (0 full … 12 Norwood 3). */
	recess?: number;
	/** x (fraction of w) of the front corners. */
	corner?: number;
	/** Sideburn bottom (y). */
	burn?: number;
	/** Where the hair meets the top of the ear (y). */
	earTop?: number;
	/** x (fraction of w) of the temple edge above the sideburn. */
	temple?: number;
	/** Irregularity (seeded jitter of the line). */
	rough?: number;
}

/**
 * The right half of a hairline, from just above the ear (outside the head) in to the
 * centre of the forehead. Mirror it for the left.
 */
export function hairlineHalf(c: NatCtx, h: Hairline, rng: ArtRng, side: 1 | -1 = 1): P[] {
	const { cx, w } = c;
	const y = h.y, peak = h.peak ?? 0, rc = h.recess ?? 0, corner = h.corner ?? 0.56, burn = h.burn ?? 106, earTop = h.earTop ?? 96, tx = h.temple ?? 0.86;
	const R = h.rough ?? 0.5;
	const j = () => rng.range(-R, R);
	const X = (f: number) => cx + side * f;
	const pts: P[] = [
		[X(w + 2.2), earTop - 2],
		[X(w + 0.4), earTop - 0.6],
		[X(w - 1.6), earTop + 1.5],
		[X(w - 2.4), burn - 4],
		[X(w - 2.6), burn],
		[X(w - 6.2), burn - 1],
		[X(w * tx + 0.6 + j()), 96],
		[X(w * tx + j() * 0.6), 88 - rc * 0.3],
		[X(w * (tx - 0.04) + j() * 0.6), 80 - rc * 0.55],
		[X(w * 0.76 - rc * 0.4), y + 4.5 - rc * 0.9 + j()],
		[X(w * 0.68 - rc * 0.6), y + 2 - rc * 1.05 + j()],
		[X(w * corner - rc * 0.35), y + 1.6 - rc * 0.5 + j()],
		[X(w * 0.36), y + 0.9 - rc * 0.15 + j()],
		[X(w * 0.18), y + 0.4 + peak * 0.25 + j() * 0.6],
		[X(w * 0.06), y + peak * 0.8],
	];
	return pts;
}

/** A full hairline from the left ear over the forehead to the right ear (centre included once). */
export function hairlineFull(c: NatCtx, h: Hairline, rng: ArtRng): P[] {
	const r = hairlineHalf(c, h, rng, 1);
	const l = hairlineHalf(c, h, rng, -1);
	return [...l, [c.cx, h.y + (h.peak ?? 0)], ...r.slice().reverse()];
}

// ─── Colour ─────────────────────────────────────────────────────────────

export interface HairPal {
	/** 0 deep shadow … 4 highlight. */
	tones: [string, string, string, string, string];
	sheen: string;
	/** Clipper-short hair over the scalp. */
	scalp: string;
	line: string;
}

export function hairPalette(hair: string, skin: string): HairPal {
	const L = luminance(hair);
	let tones: HairPal["tones"];
	let sheen: string;
	if (L < 0.13) {
		// black / near-black: cool, desaturated sheen
		tones = [mix(hair, "#000000", 0.5), mix(hair, "#000000", 0.2), hair, mix(hair, "#5c606a", 0.22), mix(hair, "#8a909c", 0.36)];
		sheen = mix(hair, "#b4bac6", 0.48);
	} else if (L > 0.66) {
		// white, platinum, light blond: the shadows carry the form
		tones = [shade(hair, -0.36), shade(hair, -0.24), shade(hair, -0.12), shade(hair, -0.03), shade(hair, 0.04)];
		sheen = mix(hair, "#ffffff", 0.7);
	} else {
		tones = [shade(hair, -0.24), shade(hair, -0.12), hair, shade(hair, 0.09), shade(hair, 0.18)];
		sheen = mix(shade(hair, 0.26), "#fff6e8", 0.25);
	}
	return {
		tones,
		sheen,
		scalp: mix(hair, skin, 0.55),
		line: L > 0.66 ? shade(hair, -0.48) : L < 0.13 ? "#050404" : shade(hair, -0.36),
	};
}

// ─── Light ──────────────────────────────────────────────────────────────

/** Diffuse light (0…1) on the hair surface at (x, y): light from the upper left. */
export function lightAt(c: NatCtx, x: number, y: number, round = 1): number {
	const nx = clamp((x - c.cx) / (c.w + 10), -1, 1);
	const ny = clamp((y - 98) / 56, -1, 1) * round;
	const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
	const l = -0.42 * nx - 0.62 * ny + 0.66 * nz;
	return clamp(l * 0.9 + 0.12, 0, 1);
}

// ─── Clumps ─────────────────────────────────────────────────────────────

/** A guide curve, root → tip (quadratic or cubic control points). */
export type Guide = P[];

export interface Family {
	guides: Guide[];
	/** Number of clumps spread across the guides. */
	n: number;
	/** Root width of a clump. */
	wid: number;
	/** Width profile: "tip" tapers to a point at the tip, "both" at both ends, "blunt" barely tapers. */
	taper?: "tip" | "both" | "blunt" | "root";
	/** Range of the clump length as a fraction of its guide. */
	len?: [number, number];
	/** Range of the start along its guide. */
	start?: [number, number];
	/** Sideways jitter of each clump (units). */
	jit?: number;
	/** Waviness: amplitude and number of waves along the clump. */
	wave?: number;
	waves?: number;
	/** Tone bias (−2 … +2). */
	tone?: number;
	/** How strongly the light sets the tone (default 1). */
	lit?: number;
	/** Randomness of the tone (default 1). */
	toneVar?: number;
	/** Strand lines along the clump: highlight streaks and dark partings (default true). */
	strands?: boolean;
	/** Tip curl-under for fringes (units the tip hooks sideways). */
	hook?: number;
}

export interface Clump { c: P[]; hw: number[]; tone: number; sheen: number }

function guideAt(gs: Guide[], s: number): Guide {
	const k = clamp(s, 0, gs.length - 1);
	const i = Math.min(gs.length - 2, Math.floor(k));
	if (gs.length === 1) return gs[0];
	const f = k - i;
	return gs[i].map((p, j) => lerpP(p, gs[i + 1][j], f));
}

export function growClumps(c: NatCtx, f: Family, rng: ArtRng): Clump[] {
	const out: Clump[] = [];
	const G = f.guides.length;
	const steps = 9;
	for (let i = 0; i < f.n; i++) {
		const s = G === 1 ? 0 : ((i + rng.range(0.15, 0.85)) / f.n) * (G - 1);
		const g = guideAt(f.guides, s);
		const [l0, l1] = f.len ?? [0.8, 1];
		const [s0, s1] = f.start ?? [0, 0.06];
		const ta = rng.range(s0, s1);
		const tb = Math.max(ta + 0.1, rng.range(l0, l1));
		const jit = rng.range(-1, 1) * (f.jit ?? 1);
		const wav = (f.wave ?? 0) * rng.range(0.6, 1.2);
		const wn = (f.waves ?? 1.5) * rng.range(0.85, 1.15);
		const ph = rng.range(0, Math.PI * 2);
		const pts: P[] = [];
		for (let k = 0; k <= steps; k++) {
			const t = lerp(ta, tb, k / steps);
			pts.push(cubic(g, t));
		}
		// sideways offsets (jitter, waves, hooked tip)
		const cpts: P[] = pts.map((p, k) => {
			const a = pts[Math.max(0, k - 1)], b = pts[Math.min(steps, k + 1)];
			const dx = b[0] - a[0], dy = b[1] - a[1];
			const m = Math.hypot(dx, dy) || 1;
			const nx = -dy / m, ny = dx / m;
			const q = k / steps;
			const off = jit * (0.4 + 0.6 * q) + wav * Math.sin(ph + q * wn * Math.PI * 2) * Math.min(1, q * 3) + (f.hook ?? 0) * q * q * q;
			return [p[0] + nx * off, p[1] + ny * off];
		});
		const W = f.wid * rng.range(0.7, 1.25);
		const prof = (q: number) => {
			switch (f.taper ?? "tip") {
				case "both": return Math.pow(Math.sin(Math.PI * clamp(q, 0.02, 0.98)), 0.7);
				case "blunt": return 1 - 0.45 * q * q;
				case "root": return Math.pow(clamp(q, 0.05, 1), 0.5);
				default: return Math.pow(1 - q, 0.75) * (0.75 + 0.25 * Math.min(1, q * 6));
			}
		};
		const hw = cpts.map((_, k) => (W / 2) * prof(k / steps));
		const mid = cpts[Math.floor(steps * 0.4)];
		const li = lightAt(c, mid[0], mid[1]) * (f.lit ?? 1) + (1 - (f.lit ?? 1)) * 0.5;
		const tone = clamp(Math.round(li * 3.4 + 0.3 + (f.tone ?? 0) + rng.range(-0.9, 0.9) * (f.toneVar ?? 0.6)), 0, 4);
		out.push({ c: cpts, hw, tone, sheen: li });
	}
	return out;
}

/** Outline of a clump as a closed path: `scale` narrows it, `shift` slides it sideways (in half-widths), [q0, q1] trims it. */
function ribbon(cl: Clump, scale = 1, shift = 0, q0 = 0, q1 = 1): string {
	const L: P[] = [], R: P[] = [];
	const n = cl.c.length - 1;
	const k0 = Math.round(q0 * n), k1 = Math.round(q1 * n);
	for (let k = k0; k <= k1; k++) {
		const a = cl.c[Math.max(0, k - 1)], b = cl.c[Math.min(n, k + 1)];
		const dx = b[0] - a[0], dy = b[1] - a[1];
		const m = Math.hypot(dx, dy) || 1;
		const nx = -dy / m, ny = dx / m;
		// trimmed ends taper so inner shapes stay inside their clump
		const e = q0 > 0 || q1 < 1 ? Math.sin(Math.PI * clamp((k - k0) / Math.max(1, k1 - k0), 0.04, 0.96)) : 1;
		const h = cl.hw[k] * scale * e;
		const o = cl.hw[k] * shift;
		const cx = cl.c[k][0] + nx * o, cy = cl.c[k][1] + ny * o;
		L.push([cx + nx * h, cy + ny * h]);
		R.push([cx - nx * h, cy - ny * h]);
	}
	return qPath([...L, ...R.reverse()], true);
}

/** Which side of a clump faces the light (+1 / −1 in ribbon offsets). */
function litSide(cl: Clump): number {
	const n = cl.c.length - 1;
	const a = cl.c[Math.floor(n * 0.3)], b = cl.c[Math.floor(n * 0.6)];
	const dx = b[0] - a[0], dy = b[1] - a[1];
	const m = Math.hypot(dx, dy) || 1;
	const nx = -dy / m, ny = dx / m;
	// light comes from the upper left
	return nx * -0.55 + ny * -0.83 >= 0 ? 1 : -1;
}

/** A sub-range of a clump's centreline as an open path, offset sideways (in half-widths). */
function strandPath(cl: Clump, a: number, b: number, off: number): string {
	const n = cl.c.length - 1;
	const pts: P[] = [];
	for (let k = Math.round(a * n); k <= Math.round(b * n); k++) {
		const p0 = cl.c[Math.max(0, k - 1)], p1 = cl.c[Math.min(n, k + 1)];
		const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
		const m = Math.hypot(dx, dy) || 1;
		pts.push([cl.c[k][0] - (dy / m) * off * cl.hw[k], cl.c[k][1] + (dx / m) * off * cl.hw[k]]);
	}
	return pts.length > 1 ? qPath(pts, false) : "";
}

export interface PaintOpts {
	/** Strand lines (highlight streaks, dark partings). Default true. */
	strands?: boolean;
	/** Strength of the sheen streaks. */
	sheen?: number;
	/** Chance of a dark parting line on a clump. */
	partings?: number;
	/** Draw each clump as a lock with its own lit and shadow side (default true). */
	locks?: boolean;
}

/**
 * Draws clumps in order. Each lock gets its base tone, a lit band on the side
 * facing the light, and a shadow line on the other side, so the hair reads as
 * separate locks rather than a painted cap.
 */
export function paintClumps(clumps: Clump[], pal: HairPal, rng: ArtRng, key: string, opts: PaintOpts = {}): ReactNode {
	const T = pal.tones;
	const out: ReactNode[] = [];
	let hi = "", hi2 = "", dark = "";
	const locks = opts.locks !== false;
	clumps.forEach((cl, i) => {
		const side = litSide(cl);
		out.push(<path key={`b${i}`} d={ribbon(cl)} fill={T[cl.tone]} />);
		if (locks) {
			if (cl.tone < 4) out.push(<path key={`l${i}`} d={ribbon(cl, 0.5, side * 0.42, rng.range(0.06, 0.2), rng.range(0.6, 0.85))} fill={T[Math.min(4, cl.tone + 1)]} />);
			out.push(<path key={`d${i}`} d={strandPath(cl, rng.range(0, 0.1), rng.range(0.7, 0.95), -side * 0.8)} fill="none" stroke={T[Math.max(0, cl.tone - 2)]} strokeWidth={0.7} opacity={0.8} strokeLinecap="round" />);
		}
		if (opts.strands !== false) {
			const a = rng.range(0.08, 0.3), b = a + rng.range(0.25, 0.5);
			if (cl.tone >= 2 && rng.next() < 0.7) {
				const s = strandPath(cl, a, Math.min(0.9, b), side * rng.range(0.1, 0.5));
				if (cl.sheen > 0.6 && cl.tone >= 3) hi2 += s; else hi += s;
			}
			if (rng.next() < (opts.partings ?? 0.35)) dark += strandPath(cl, rng.range(0.05, 0.25), rng.range(0.5, 0.85), rng.range(-0.3, 0.3));
		}
	});
	return (
		<g key={key}>
			{out}
			{dark && <path d={dark} fill="none" stroke={T[0]} strokeWidth={0.45} opacity={0.6} strokeLinecap="round" />}
			{hi && <path d={hi} fill="none" stroke={T[4]} strokeWidth={0.5} opacity={0.6} strokeLinecap="round" />}
			{hi2 && <path d={hi2} fill="none" stroke={pal.sheen} strokeWidth={0.65} opacity={(opts.sheen ?? 1) * 0.7} strokeLinecap="round" />}
		</g>
	);
}

// ─── Fuzz (clipper-short hair) ──────────────────────────────────────────

export interface FuzzOpts {
	/** Probability of a hair at (x, y): 1 dense … 0 bare skin. */
	density: (x: number, y: number) => number;
	/** Direction the hair lies (radians, 0 = +x, π/2 = down). */
	dir: (x: number, y: number) => number;
	len?: [number, number];
	/** Grid spacing (smaller = denser). */
	step?: number;
	wid?: number;
	/** Tone bias. */
	tone?: number;
}

/** Tiny dashes filling a region (polygon), one path per tone. */
export function paintFuzz(c: NatCtx, region: P[], o: FuzzOpts, pal: HairPal, rng: ArtRng, key: string): ReactNode {
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (const [x, y] of region) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
	const step = o.step ?? 1.5;
	const [la, lb] = o.len ?? [1.2, 2.2];
	const by: string[] = ["", "", "", "", ""];
	for (let y = y0; y <= y1; y += step) {
		for (let x = x0 + (Math.round((y - y0) / step) % 2) * step * 0.5; x <= x1; x += step) {
			const px = x + rng.range(-0.45, 0.45) * step, py = y + rng.range(-0.45, 0.45) * step;
			const keep = rng.next() < o.density(px, py);
			const a = o.dir(px, py) + rng.range(-0.35, 0.35);
			const l = rng.range(la, lb);
			const tr = rng.range(-1, 1);
			if (!keep || !inside(region, px, py)) continue;
			const li = lightAt(c, px, py);
			const tone = clamp(Math.round(li * 2.6 + 0.4 + (o.tone ?? 0) + tr), 0, 4);
			by[tone] += `M${r1(px)} ${r1(py)}l${r1(Math.cos(a) * l)} ${r1(Math.sin(a) * l)}`;
		}
	}
	const wid = o.wid ?? 0.6;
	return (
		<g key={key} fill="none" strokeLinecap="round">
			{by.map((d, i) => (d ? <path key={i} d={d} stroke={pal.tones[i]} strokeWidth={wid} opacity={i === 4 ? 0.8 : 0.9} /> : null))}
		</g>
	);
}

// ─── Assembly helpers ───────────────────────────────────────────────────

export function natRng(c: NatCtx, style: string): ArtRng {
	return new ArtRng((c.seed ^ hashString(style)) >>> 0);
}

/** Soft gradient overlay that shades a hair mass (light upper left, dark lower right). */
export function formShade(c: NatCtx, key: string, d: string, strength = 1): ReactNode {
	const gid = c.id(`nf-${key}`);
	return (
		<g key={key}>
			<defs>
				<linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={c.cx - c.w} y1={c.top - 10} x2={c.cx + c.w} y2={c.top + 60}>
					<stop offset="0" stopColor="#ffffff" stopOpacity={0.1 * strength} />
					<stop offset="0.45" stopColor="#000000" stopOpacity={0} />
					<stop offset="1" stopColor="#000000" stopOpacity={0.32 * strength} />
				</linearGradient>
			</defs>
			<path d={d} fill={`url(#${gid})`} />
		</g>
	);
}

/** The shadow hair casts on the skin just below an edge (open path). */
export function contactShadow(c: NatCtx, edge: P[], key: string, opacity = 0.32, width = 5, dy = 1.6): ReactNode {
	const d = qPath(edge.map(([x, y]) => [x + 0.8, y + dy] as P), false);
	// its own blur region: the shared one is relative to the (often flat) stroke and would clip the blur into a band
	const fid = c.id(`ncs-${key}`);
	return (
		<g key={key} clipPath={c.url("headclip")}>
			<filter id={fid} filterUnits="userSpaceOnUse" x={0} y={0} width={200} height={240}><feGaussianBlur stdDeviation={1.4} /></filter>
			<path d={d} fill="none" stroke={shade(c.skin, -0.42)} strokeWidth={width} opacity={opacity} filter={`url(#${fid})`} strokeLinecap="round" />
		</g>
	);
}

/** Clip a group to a path. */
export function clipTo(c: NatCtx, key: string, d: string, body: ReactNode): ReactNode {
	const cid = c.id(`nc-${key}`);
	return (
		<g key={key}>
			<clipPath id={cid}><path d={d} /></clipPath>
			<g clipPath={`url(#${cid})`}>{body}</g>
		</g>
	);
}
