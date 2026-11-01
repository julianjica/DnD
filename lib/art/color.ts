/** Small color helpers for procedural art (pure, SSR-safe). */

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
	let h = hex.replace("#", "").trim();
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const n = parseInt(h.slice(0, 6), 16);
	if (Number.isNaN(n)) return [128, 128, 128];
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
	const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
	return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear mix of two hex colors, t in [0,1]. */
export function mix(a: string, b: string, t: number): string {
	const x = hexToRgb(a);
	const y = hexToRgb(b);
	return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
	h = ((h % 360) + 360) % 360;
	s = Math.max(0, Math.min(1, s));
	l = Math.max(0, Math.min(1, l));
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let rgb: Rgb;
	if (h < 60) rgb = [c, x, 0];
	else if (h < 120) rgb = [x, c, 0];
	else if (h < 180) rgb = [0, c, x];
	else if (h < 240) rgb = [0, x, c];
	else if (h < 300) rgb = [x, 0, c];
	else rgb = [c, 0, x];
	return rgbToHex([(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255]);
}

/** Lighten (amt > 0) or darken (amt < 0) in HSL lightness, with a slight hue shift
 * toward warm on highlights and cool on shadows (painterly). */
export function shade(hex: string, amt: number, hueShift = true): string {
	const [h, s, l] = rgbToHsl(hexToRgb(hex));
	const shift = hueShift ? (amt > 0 ? -8 : 10) * Math.min(1, Math.abs(amt) * 3) : 0;
	let nh = h;
	if (hueShift) {
		// Move toward ~40° (warm) for highlights, toward ~250° (cool) for shadows.
		const target = amt > 0 ? 40 : 250;
		const diff = ((target - h + 540) % 360) - 180;
		nh = h + Math.sign(diff) * Math.min(Math.abs(diff), Math.abs(shift));
	}
	return hslToHex(nh, s * (amt < 0 ? 1 + Math.abs(amt) * 0.2 : 1), l + amt);
}

export function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
