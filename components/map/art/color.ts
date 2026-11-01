/** Tiny color helpers for procedural painting (hex in, CSS strings out). */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
	const h = hex.replace("#", "");
	const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgb(c: RGB, a = 1): string {
	const r = Math.round(Math.max(0, Math.min(255, c[0])));
	const g = Math.round(Math.max(0, Math.min(255, c[1])));
	const b = Math.round(Math.max(0, Math.min(255, c[2])));
	return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/** Lighten (amt > 0) or darken (amt < 0) by a factor in [-1, 1]. */
export function shade(hex: string | RGB, amt: number, a = 1): string {
	const c = typeof hex === "string" ? hexToRgb(hex) : hex;
	const t = amt < 0 ? 0 : 255;
	const p = Math.abs(amt);
	return rgb([c[0] + (t - c[0]) * p, c[1] + (t - c[1]) * p, c[2] + (t - c[2]) * p], a);
}

export function mix(a: string, b: string, t: number): string {
	const A = hexToRgb(a), B = hexToRgb(b);
	return rgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

export function hexNum(hex: string): number {
	return parseInt(hex.replace("#", ""), 16);
}
