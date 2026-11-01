import { Rng } from "../rules/dice";

/** Seeded 2D gradient (Perlin) noise and fractal helpers. Output roughly in [-1, 1]. */
export type Noise2D = (x: number, y: number) => number;

export function makeNoise2D(seed: number): Noise2D {
	const rng = new Rng(seed >>> 0 || 1);
	const perm = new Uint8Array(512);
	const p = Array.from({ length: 256 }, (_, i) => i);
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(rng.next() * (i + 1));
		[p[i], p[j]] = [p[j], p[i]];
	}
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
	const gx = new Float32Array(256), gy = new Float32Array(256);
	for (let i = 0; i < 256; i++) {
		const a = rng.next() * Math.PI * 2;
		gx[i] = Math.cos(a);
		gy[i] = Math.sin(a);
	}
	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	return (x: number, y: number) => {
		const xi = Math.floor(x), yi = Math.floor(y);
		const xf = x - xi, yf = y - yi;
		const X = xi & 255, Y = yi & 255;
		const g = (ix: number, iy: number, dx: number, dy: number) => {
			const h = perm[perm[ix] + iy];
			return gx[h] * dx + gy[h] * dy;
		};
		const n00 = g(X, Y, xf, yf);
		const n10 = g(X + 1, Y, xf - 1, yf);
		const n01 = g(X, Y + 1, xf, yf - 1);
		const n11 = g(X + 1, Y + 1, xf - 1, yf - 1);
		const u = fade(xf), v = fade(yf);
		const a = n00 + u * (n10 - n00);
		const b = n01 + u * (n11 - n01);
		return (a + v * (b - a)) * 1.414;
	};
}

/** Fractal Brownian motion. */
export function fbm(noise: Noise2D, x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
	let amp = 1, freq = 1, sum = 0, norm = 0;
	for (let o = 0; o < octaves; o++) {
		sum += amp * noise(x * freq + o * 17.3, y * freq - o * 9.1);
		norm += amp;
		amp *= gain;
		freq *= lacunarity;
	}
	return sum / norm;
}

/** Ridged multifractal (sharp crests for mountain ranges), output ~[0,1]. */
export function ridged(noise: Noise2D, x: number, y: number, octaves = 4): number {
	let amp = 0.5, freq = 1, sum = 0, norm = 0;
	for (let o = 0; o < octaves; o++) {
		const n = 1 - Math.abs(noise(x * freq + o * 31.7, y * freq + o * 11.3));
		sum += amp * n * n;
		norm += amp;
		amp *= 0.5;
		freq *= 2;
	}
	return sum / norm;
}

/** Stable 32-bit hash of integers (for per-tile variation without an RNG stream). */
export function hash2(x: number, y: number, seed = 0): number {
	let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
}
/** Hash to float in [0,1). */
export function rand2(x: number, y: number, seed = 0): number {
	return hash2(x, y, seed) / 4294967296;
}

export function hashString(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}
