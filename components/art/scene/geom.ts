import { ArtRng, r1 } from "@/lib/art/rand";

export type Pt = [number, number];

/** Seeded 1-D fractal value noise in [-1, 1]. */
export function noise1d(rng: ArtRng, octaves = 4): (x: number) => number {
	const lattices = Array.from({ length: octaves }, () => Array.from({ length: 64 }, () => rng.next() * 2 - 1));
	return (x: number) => {
		let sum = 0;
		let amp = 1;
		let freq = 1;
		let norm = 0;
		for (let o = 0; o < octaves; o++) {
			const lat = lattices[o];
			const xf = x * freq;
			const i = Math.floor(xf);
			const f = xf - i;
			const a = lat[((i % 64) + 64) % 64];
			const b = lat[(((i + 1) % 64) + 64) % 64];
			const t = (1 - Math.cos(f * Math.PI)) / 2;
			sum += (a + (b - a) * t) * amp;
			norm += amp;
			amp *= 0.5;
			freq *= 2.1;
		}
		return sum / norm;
	};
}

export interface RidgeOpts {
	/** Base y of the ridge line. */
	y: number;
	/** Vertical amplitude. */
	amp: number;
	/** Features per 1600px. */
	freq: number;
	/** Sharpen peaks (0 = rolling hills, 1 = jagged peaks). */
	sharp?: number;
	x0?: number;
	x1?: number;
	step?: number;
	octaves?: number;
	/** Bottom y to close the shape. */
	bottom?: number;
}

/** Silhouette ridge points left→right. */
export function ridge(rng: ArtRng, o: RidgeOpts): Pt[] {
	const n = noise1d(rng, o.octaves ?? 4);
	const x0 = o.x0 ?? -40;
	const x1 = o.x1 ?? 1640;
	const step = o.step ?? 16;
	const pts: Pt[] = [];
	const sharp = o.sharp ?? 0;
	for (let x = x0; x <= x1 + step; x += step) {
		let v = n((x / 1600) * o.freq);
		if (sharp > 0) {
			const ridged = Math.pow(1 - Math.min(1, Math.abs(v) * 1.6), 2) * 2 - 1;
			v = v * (1 - sharp) + ridged * sharp;
		}
		pts.push([x, o.y - v * o.amp]);
	}
	return pts;
}

export function ridgePath(pts: Pt[], bottom = 960): string {
	let d = `M${r1(pts[0][0])} ${bottom}`;
	for (const [x, y] of pts) d += `L${r1(x)} ${r1(y)}`;
	d += `L${r1(pts[pts.length - 1][0])} ${bottom}Z`;
	return d;
}

/** Open polyline along the ridge (for rim-light strokes). */
export function ridgeLine(pts: Pt[]): string {
	return pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join("");
}

/** y of the ridge at x (linear interpolation). */
export function ridgeY(pts: Pt[], x: number): number {
	for (let i = 1; i < pts.length; i++) {
		if (pts[i][0] >= x) {
			const [xa, ya] = pts[i - 1];
			const [xb, yb] = pts[i];
			return ya + ((yb - ya) * (x - xa)) / (xb - xa || 1);
		}
	}
	return pts[pts.length - 1][1];
}

export function poly(pts: Pt[]): string {
	return pts.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join("") + "Z";
}

// ─── SVG id scoping ───────────────────────────────────────────────────────
// Scene builders run synchronously inside one SceneArt render, which sets the
// prefix first; this keeps <defs> ids unique per SVG without threading a param.
let idPrefix = "dh";
export function setIdPrefix(p: string): void {
	idPrefix = p;
}
/** Scoped id for <defs>. */
export function gid(name: string): string {
	return `${idPrefix}-${name}`;
}
/** url(#scoped-id). */
export function u(name: string): string {
	return `url(#${idPrefix}-${name})`;
}

export type GlowTone = "fire" | "warm" | "cold" | "green" | "violet" | "gold" | "white";
export const GLOW_TONES: Record<GlowTone, string> = {
	fire: "#ff8a2a",
	warm: "#ffc870",
	cold: "#8ab8ff",
	green: "#6aff9a",
	violet: "#c080ff",
	gold: "#ffd860",
	white: "#ffffff",
};

/**
 * Faceted shadow polygons for a ridge lit from one side (lightDir -1 = light from the
 * left, so right-facing slopes are shaded). Returns one path string.
 */
export function ridgeShadows(pts: Pt[], lightDir: -1 | 1, depth = 0.85): string {
	let d = "";
	const n = pts.length;
	const isPeak = (i: number) => i > 0 && i < n - 1 && pts[i][1] <= pts[i - 1][1] && pts[i][1] < pts[i + 1][1];
	const isValley = (i: number) => i > 0 && i < n - 1 && pts[i][1] >= pts[i - 1][1] && pts[i][1] > pts[i + 1][1];
	const bottom = Math.max(...pts.map(([, y]) => y)) + 60;
	for (let i = 1; i < n - 1; i++) {
		if (!isPeak(i)) continue;
		const step = lightDir < 0 ? 1 : -1;
		let j = i + step;
		while (j > 0 && j < n - 1 && !isValley(j)) j += step;
		const seg = lightDir < 0 ? pts.slice(i, j + 1) : pts.slice(j, i + 1).reverse();
		if (seg.length < 2) continue;
		const [px, py] = pts[i];
		const [vx] = pts[j];
		const foot: Pt = [px + (vx - px) * 0.15, py + (bottom - py) * depth];
		d += `M${px.toFixed(1)} ${py.toFixed(1)}` + seg.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join("") + `L${pts[j][0].toFixed(1)} ${bottom.toFixed(1)}L${foot[0].toFixed(1)} ${foot[1].toFixed(1)}Z`;
	}
	return d;
}
