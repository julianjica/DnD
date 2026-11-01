import { Rng } from "../rules/dice";

/** FNV-1a 32-bit string hash → unsigned seed. Stable across runtimes. */
export function hashString(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** A seeded RNG with float helpers used by the procedural art. */
export class ArtRng extends Rng {
	constructor(seed: number) {
		super(seed >>> 0);
		// Warm up so nearby seeds diverge.
		this.next();
		this.next();
	}
	range(min: number, max: number): number {
		return min + this.next() * (max - min);
	}
	chance(p: number): boolean {
		return this.next() < p;
	}
	/** Approximately normal in [-1, 1]. */
	jitter(): number {
		return (this.next() + this.next() + this.next()) / 1.5 - 1;
	}
	fork(salt: string | number): ArtRng {
		return new ArtRng((this.state ^ hashString(String(salt))) >>> 0);
	}
}

/** Rounds to 1 decimal to keep SVG strings short and SSR/CSR identical. */
export function r1(n: number): number {
	return Math.round(n * 10) / 10;
}

/** Catmull-Rom → cubic Bézier path through points (closed or open). */
export function smoothPath(pts: [number, number][], closed = true, tension = 1): string {
	if (pts.length < 2) return "";
	const n = pts.length;
	const get = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
	let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
	const segs = closed ? n : n - 1;
	for (let i = 0; i < segs; i++) {
		const p0 = get(i - 1);
		const p1 = get(i);
		const p2 = get(i + 1);
		const p3 = get(i + 2);
		const t = tension / 6;
		const c1x = p1[0] + (p2[0] - p0[0]) * t;
		const c1y = p1[1] + (p2[1] - p0[1]) * t;
		const c2x = p2[0] - (p3[0] - p1[0]) * t;
		const c2y = p2[1] - (p3[1] - p1[1]) * t;
		d += `C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2[0])} ${r1(p2[1])}`;
	}
	return closed ? d + "Z" : d;
}

/** Mirrors a right-half outline (top → bottom, x >= cx) into a full closed loop. */
export function mirrorLoop(right: [number, number][], cx: number): [number, number][] {
	const left = right.slice().reverse().map(([x, y]) => [2 * cx - x, y] as [number, number]);
	// Avoid duplicating points on the axis.
	const l = left.filter(([x]) => Math.abs(x - cx) > 0.01);
	return [...right, ...l];
}
