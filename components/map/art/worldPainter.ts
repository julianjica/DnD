import type { LocationKind, WorldLocation, WorldMap } from "@/lib/game/types";
import { hashString, makeNoise2D, rand2 } from "@/lib/maps/noise";
import { mountainLine, worldTerrain, type WorldTerrain } from "@/lib/maps/world";
import { hexToRgb } from "./color";

/**
 * Parchment-style overworld painter (Canvas 2D). The terrain layer depends
 * only on {seed, terrain} and is cached by the caller; the overlay (routes,
 * location icons, labels) is cheap and redrawn when discovery changes.
 */

const INK = "#3b2a1a";
const INK_SOFT = "rgba(59,42,26,0.55)";
const PAPER = "#ecdcb4";

interface Palette { sea: string; deep: string; low: string; mid: string; high: string; peak: string; wet: string; dry: string }
const PALETTES: Record<WorldMap["terrain"]["biome"], Palette> = {
	temperate: { sea: "#aabfb9", deep: "#8ea8a6", low: "#ddd3a2", mid: "#d6c69a", high: "#c9b08a", peak: "#efe8da", wet: "#c8cf98", dry: "#e4cf9f" },
	arid: { sea: "#a9bcb5", deep: "#8ca3a0", low: "#e8d1a0", mid: "#e2c28c", high: "#d1a877", peak: "#c99b6c", wet: "#d9cf9a", dry: "#ecd29c" },
	frozen: { sea: "#b4c6c9", deep: "#97adb3", low: "#e6e1d2", mid: "#ddd8cb", high: "#d1cfc8", peak: "#f8f7f2", wet: "#d6dccb", dry: "#e8e2d2" },
	tropical: { sea: "#a2c3bd", deep: "#82a9a6", low: "#d3d49c", mid: "#c9c98f", high: "#bfae84", peak: "#e6dfcf", wet: "#b9c98c", dry: "#dccf9c" },
	volcanic: { sea: "#a6b6b2", deep: "#889c9a", low: "#d8c9a0", mid: "#c9b28c", high: "#a88c72", peak: "#7a5f52", wet: "#c6c495", dry: "#d9c39a" },
	mixed: { sea: "#aabfb9", deep: "#8ea8a6", low: "#ddd3a2", mid: "#d8c595", high: "#c8ad86", peak: "#efe8da", wet: "#c4ce96", dry: "#e6cd98" },
};

function lerpC(a: string, b: string, t: number): [number, number, number] {
	const A = hexToRgb(a), B = hexToRgb(b);
	const k = Math.max(0, Math.min(1, t));
	return [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
}

export interface WorldGrid {
	gw: number;
	gh: number;
	elev: Float32Array;
	moist: Float32Array;
	T: WorldTerrain;
}

export function sampleWorld(world: Pick<WorldMap, "seed" | "terrain">, gw = 300, gh = 200): WorldGrid {
	const T = worldTerrain(world);
	const elev = new Float32Array(gw * gh), moist = new Float32Array(gw * gh);
	for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
		const s = T.sample((x + 0.5) / gw, (y + 0.5) / gh);
		elev[y * gw + x] = s.elevation;
		moist[y * gw + x] = s.moisture;
	}
	return { gw, gh, elev, moist, T };
}

/** Paints the static terrain (paper, sea, land, coast ripples, relief, forests, rivers, frame, compass). */
export function paintWorldBase(canvas: HTMLCanvasElement, world: WorldMap, grid: WorldGrid, fontFamily: string) {
	const ctx = canvas.getContext("2d")!;
	const W = canvas.width, H = canvas.height;
	const { gw, gh, elev, moist } = grid;
	const sea = world.terrain.seaLevel;
	const ml = mountainLine(sea);
	const pal = PALETTES[world.terrain.biome] ?? PALETTES.temperate;
	const rnd = (a: number, b: number, k = 0) => rand2(a, b, world.seed + k);

	// 1. colour field with hillshade
	const img = new ImageData(gw, gh);
	for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
		const i = y * gw + x;
		const e = elev[i], m = moist[i];
		let c: [number, number, number];
		if (e < sea) {
			const d = (sea - e) / sea;
			c = lerpC(pal.sea, pal.deep, Math.min(1, d * 3));
		} else {
			const h = (e - sea) / (1 - sea);
			const base = h < 0.25 ? lerpC(pal.low, pal.mid, h / 0.25) : h < 0.5 ? lerpC(pal.mid, pal.high, (h - 0.25) / 0.25) : lerpC(pal.high, pal.peak, Math.min(1, (h - 0.5) / 0.35));
			const wet = lerpC(pal.dry, pal.wet, m);
			c = [base[0] * 0.65 + wet[0] * 0.35, base[1] * 0.65 + wet[1] * 0.35, base[2] * 0.65 + wet[2] * 0.35];
			const ex = elev[y * gw + Math.min(gw - 1, x + 1)] - elev[y * gw + Math.max(0, x - 1)];
			const ey = elev[Math.min(gh - 1, y + 1) * gw + x] - elev[Math.max(0, y - 1) * gw + x];
			const shadeK = 1 + (-ex - ey) * 4.5;
			c = [c[0] * shadeK, c[1] * shadeK, c[2] * shadeK];
		}
		img.data[i * 4] = c[0];
		img.data[i * 4 + 1] = c[1];
		img.data[i * 4 + 2] = c[2];
		img.data[i * 4 + 3] = 255;
	}
	const small = document.createElement("canvas");
	small.width = gw;
	small.height = gh;
	small.getContext("2d")!.putImageData(img, 0, 0);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(small, 0, 0, W, H);
	const sx = W / gw, sy = H / gh;

	// 2. sea hatching near coasts + ripple contours
	const dist = seaDistance(grid, sea);
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	for (const [lvl, a, w] of [[2.5, 0.45, 1], [5, 0.3, 1], [8.5, 0.18, 1]] as const) {
		ctx.strokeStyle = `rgba(59,72,80,${a})`;
		ctx.lineWidth = w;
		strokeContours(ctx, dist, gw, gh, lvl, sx, sy);
	}
	// horizontal sea hatching (classic engraving)
	ctx.strokeStyle = "rgba(60,80,90,0.12)";
	ctx.lineWidth = 1;
	for (let y = 4; y < H; y += 7) {
		ctx.beginPath();
		let on = false;
		for (let x = 0; x < W; x += 4) {
			const gx = Math.min(gw - 1, Math.floor(x / sx)), gy = Math.min(gh - 1, Math.floor(y / sy));
			const d = dist[gy * gw + gx];
			const water = elev[gy * gw + gx] < sea && d > 1 && d < 14 && rnd(gx, gy, 3) > 0.1;
			if (water && !on) { ctx.moveTo(x, y); on = true; }
			else if (!water && on) { ctx.lineTo(x, y); on = false; }
		}
		if (on) ctx.lineTo(W, y);
		ctx.stroke();
	}
	// coastline (bold ink)
	ctx.strokeStyle = INK;
	ctx.lineWidth = Math.max(1.6, W / 700);
	strokeContours(ctx, elev, gw, gh, sea, sx, sy);

	// 3. rivers
	const rivers = traceRivers(grid, sea, ml, world.seed);
	for (const r of rivers) {
		ctx.strokeStyle = "rgba(70,105,125,0.9)";
		for (let i = 1; i < r.length; i++) {
			ctx.lineWidth = 0.8 + (i / r.length) * Math.max(1.6, W / 500);
			ctx.beginPath();
			const a = r[i - 1], b = r[i];
			ctx.moveTo((a[0] + 0.5) * sx, (a[1] + 0.5) * sy);
			ctx.lineTo((b[0] + 0.5) * sx, (b[1] + 0.5) * sy);
			ctx.stroke();
		}
	}

	// 4. relief & vegetation glyphs, sorted top-to-bottom
	const glyphs: { x: number; y: number; kind: "mount" | "hill" | "tree" | "pine" | "palm" | "tuft" | "dune"; s: number; k: number }[] = [];
	const step = 3;
	for (let gy = 2; gy < gh - 2; gy += step) for (let gx = 2; gx < gw - 2; gx += step) {
		const jx = gx + (rnd(gx, gy, 10) - 0.5) * step, jy = gy + (rnd(gx, gy, 11) - 0.5) * step;
		const ix = Math.round(jx), iy = Math.round(jy);
		if (ix < 1 || iy < 1 || ix >= gw - 1 || iy >= gh - 1) continue;
		const e = elev[iy * gw + ix], m = moist[iy * gw + ix];
		if (e < sea + 0.01) continue;
		const r = rnd(gx, gy, 12);
		if (e > ml) {
			if (r < 0.75) glyphs.push({ x: jx * sx, y: jy * sy, kind: "mount", s: (0.7 + (e - ml) * 2.4) * W / 90, k: r });
		} else if (e > ml - 0.06) {
			if (r < 0.35) glyphs.push({ x: jx * sx, y: jy * sy, kind: "hill", s: W / 110, k: r });
		} else if (world.terrain.biome === "arid" && m < 0.45) {
			if (r < 0.12) glyphs.push({ x: jx * sx, y: jy * sy, kind: "dune", s: W / 120, k: r });
		} else if (m > 0.6 && e < sea + 0.05) {
			if (r < 0.35) glyphs.push({ x: jx * sx, y: jy * sy, kind: "tuft", s: W / 160, k: r });
		} else if (m > 0.53) {
			const dens = (m - 0.53) * 6;
			if (r < Math.min(0.95, dens)) {
				const kind = world.terrain.biome === "frozen" || e > ml - 0.12 ? "pine" : world.terrain.biome === "tropical" && r < 0.3 ? "palm" : "tree";
				glyphs.push({ x: jx * sx, y: jy * sy, kind, s: W / 150, k: r });
			}
		}
	}
	glyphs.sort((a, b) => a.y - b.y);
	for (const g of glyphs) drawGlyph(ctx, g.kind, g.x, g.y, g.s, g.k, world.terrain.biome);

	// 5. paper texture, stains & vignette
	const noise = makeNoise2D(world.seed ^ 0x5eed);
	for (let i = 0; i < 1800; i++) {
		const x = rnd(i, 1, 20) * W, y = rnd(i, 2, 20) * H;
		ctx.fillStyle = rnd(i, 3, 20) > 0.5 ? "rgba(90,60,30,0.05)" : "rgba(255,250,235,0.06)";
		ctx.fillRect(x, y, 1 + rnd(i, 4, 20) * 2, 1 + rnd(i, 5, 20) * 2);
	}
	for (let i = 0; i < 7; i++) {
		const x = rnd(i, 7, 21) * W, y = rnd(i, 8, 21) * H, r = (0.05 + rnd(i, 9, 21) * 0.12) * W;
		const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
		g.addColorStop(0, "rgba(120,80,30,0)");
		g.addColorStop(0.85, `rgba(120,80,30,${0.04 + noise(i, 0.5) * 0.02})`);
		g.addColorStop(1, "rgba(120,80,30,0)");
		ctx.fillStyle = g;
		ctx.fillRect(x - r, y - r, r * 2, r * 2);
	}
	const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
	vg.addColorStop(0, "rgba(80,50,20,0)");
	vg.addColorStop(1, "rgba(80,50,20,0.38)");
	ctx.fillStyle = vg;
	ctx.fillRect(0, 0, W, H);

	// 6. frame, compass, cartouche
	drawFrame(ctx, W, H);
	drawCompass(ctx, W - W * 0.085, H - W * 0.085, W * 0.055);
	drawCartouche(ctx, world.name, W, H, fontFamily);
}

function seaDistance(g: WorldGrid, sea: number): Float32Array {
	const { gw, gh, elev } = g;
	const d = new Float32Array(gw * gh).fill(1e9);
	const q: number[] = [];
	for (let i = 0; i < gw * gh; i++) if (elev[i] >= sea) { d[i] = 0; q.push(i); }
	for (let qi = 0; qi < q.length; qi++) {
		const i = q[qi], x = i % gw, y = (i / gw) | 0;
		for (const [dx, dy, c] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [-1, 1, 1.41], [1, -1, 1.41], [-1, -1, 1.41]]) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
			const ni = ny * gw + nx;
			if (d[ni] > d[i] + c) { d[ni] = d[i] + c; q.push(ni); }
		}
	}
	return d;
}

/** Marching squares: strokes the iso-line `level` of a scalar field. */
function strokeContours(ctx: CanvasRenderingContext2D, f: Float32Array, gw: number, gh: number, level: number, sx: number, sy: number) {
	ctx.beginPath();
	const v = (x: number, y: number) => f[y * gw + x];
	const lerp = (a: number, b: number) => (level - a) / (b - a || 1e-9);
	for (let y = 0; y < gh - 1; y++) for (let x = 0; x < gw - 1; x++) {
		const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), d = v(x, y + 1);
		const idx = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
		if (idx === 0 || idx === 15) continue;
		const top: [number, number] = [x + lerp(a, b), y];
		const right: [number, number] = [x + 1, y + lerp(b, c)];
		const bottom: [number, number] = [x + lerp(d, c), y + 1];
		const left: [number, number] = [x, y + lerp(a, d)];
		const seg = (p: [number, number], q: [number, number]) => {
			ctx.moveTo((p[0] + 0.5) * sx, (p[1] + 0.5) * sy);
			ctx.lineTo((q[0] + 0.5) * sx, (q[1] + 0.5) * sy);
		};
		switch (idx) {
			case 1: case 14: seg(left, bottom); break;
			case 2: case 13: seg(bottom, right); break;
			case 3: case 12: seg(left, right); break;
			case 4: case 11: seg(top, right); break;
			case 5: seg(left, top); seg(bottom, right); break;
			case 6: case 9: seg(top, bottom); break;
			case 7: case 8: seg(left, top); break;
			case 10: seg(left, bottom); seg(top, right); break;
		}
	}
	ctx.stroke();
}

function traceRivers(g: WorldGrid, sea: number, ml: number, seed: number): [number, number][][] {
	const { gw, gh, elev, moist } = g;
	const cands: number[] = [];
	for (let i = 0; i < gw * gh; i++) if (elev[i] > ml - 0.03 && moist[i] > 0.45 && rand2(i, 0, seed + 99) < 0.02) cands.push(i);
	cands.sort((a, b) => rand2(a, 1, seed) - rand2(b, 1, seed));
	const used = new Uint8Array(gw * gh);
	const out: [number, number][][] = [];
	for (const c of cands.slice(0, 40)) {
		if (out.length >= 7) break;
		let x = c % gw, y = (c / gw) | 0;
		const path: [number, number][] = [[x, y]];
		let ok = false;
		for (let s = 0; s < 400; s++) {
			let best: [number, number] | null = null, be = elev[y * gw + x];
			for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
				const nx = x + dx, ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
				const e = elev[ny * gw + nx] + rand2(nx, ny, seed + 5) * 0.004;
				if (e < be) { be = e; best = [nx, ny]; }
			}
			if (!best) break; // pit
			[x, y] = best;
			path.push([x, y]);
			if (used[y * gw + x]) { ok = true; break; }
			if (elev[y * gw + x] < sea) { ok = true; break; }
		}
		if (!ok || path.length < 12) continue;
		for (const [px, py] of path) used[py * gw + px] = 1;
		out.push(path);
	}
	return out;
}

function drawGlyph(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, s: number, k: number, biome: string) {
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	switch (kind) {
		case "mount": {
			const w = s * (0.9 + k * 0.4), h = s * (1 + k * 0.5);
			const peakX = x + (k - 0.5) * w * 0.3;
			ctx.fillStyle = biome === "volcanic" && k > 0.85 ? "#6b4a3c" : "#e9dcc0";
			ctx.beginPath();
			ctx.moveTo(x - w, y);
			ctx.lineTo(peakX, y - h);
			ctx.lineTo(x + w, y);
			ctx.closePath();
			ctx.fill();
			// shaded east face
			ctx.fillStyle = "rgba(90,65,40,0.35)";
			ctx.beginPath();
			ctx.moveTo(peakX, y - h);
			ctx.lineTo(x + w, y);
			ctx.lineTo(peakX + w * 0.15, y);
			ctx.closePath();
			ctx.fill();
			ctx.strokeStyle = INK;
			ctx.lineWidth = Math.max(1, s * 0.09);
			ctx.beginPath();
			ctx.moveTo(x - w, y);
			ctx.lineTo(peakX, y - h);
			ctx.lineTo(x + w, y);
			ctx.stroke();
			ctx.strokeStyle = INK_SOFT;
			ctx.lineWidth = Math.max(0.7, s * 0.05);
			for (let i = 1; i < 4; i++) {
				const t = i / 4;
				ctx.beginPath();
				ctx.moveTo(peakX + (x + w - peakX) * t * 0.6, y - h + h * t);
				ctx.lineTo(peakX + (x + w - peakX) * t * 0.6 + w * 0.25, y - h + h * t + h * 0.18);
				ctx.stroke();
			}
			if (biome === "frozen" || k > 0.7) {
				ctx.fillStyle = "#fbfaf6";
				ctx.beginPath();
				ctx.moveTo(peakX, y - h);
				ctx.lineTo(peakX - w * 0.28, y - h * 0.7);
				ctx.lineTo(peakX - w * 0.05, y - h * 0.76);
				ctx.lineTo(peakX + w * 0.22, y - h * 0.68);
				ctx.closePath();
				ctx.fill();
			}
			if (biome === "volcanic" && k > 0.85) {
				ctx.fillStyle = "rgba(200,70,30,0.8)";
				ctx.beginPath(); ctx.arc(peakX, y - h, s * 0.18, 0, Math.PI * 2); ctx.fill();
			}
			break;
		}
		case "hill": {
			ctx.strokeStyle = INK_SOFT;
			ctx.lineWidth = Math.max(0.8, s * 0.1);
			ctx.beginPath();
			ctx.arc(x, y, s * 0.8, Math.PI * 1.1, Math.PI * 1.9);
			ctx.stroke();
			break;
		}
		case "tree": {
			ctx.fillStyle = k > 0.5 ? "#7f8f52" : "#8d9a5c";
			ctx.strokeStyle = INK;
			ctx.lineWidth = Math.max(0.7, s * 0.12);
			ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + s * 0.5); ctx.stroke();
			ctx.beginPath(); ctx.arc(x, y - s * 0.2, s * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
			ctx.fillStyle = "rgba(60,70,30,0.35)";
			ctx.beginPath(); ctx.arc(x + s * 0.18, y - s * 0.1, s * 0.35, 0, Math.PI * 2); ctx.fill();
			break;
		}
		case "pine": {
			ctx.fillStyle = "#6f8156";
			ctx.strokeStyle = INK;
			ctx.lineWidth = Math.max(0.7, s * 0.12);
			ctx.beginPath(); ctx.moveTo(x, y - s * 1.1); ctx.lineTo(x - s * 0.55, y + s * 0.2); ctx.lineTo(x + s * 0.55, y + s * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(x, y + s * 0.2); ctx.lineTo(x, y + s * 0.5); ctx.stroke();
			break;
		}
		case "palm": {
			ctx.strokeStyle = INK;
			ctx.lineWidth = Math.max(0.7, s * 0.12);
			ctx.beginPath(); ctx.moveTo(x, y + s * 0.5); ctx.quadraticCurveTo(x + s * 0.2, y, x, y - s * 0.6); ctx.stroke();
			for (const a of [-2.6, -1.9, -1.2, -0.5]) { ctx.beginPath(); ctx.moveTo(x, y - s * 0.6); ctx.quadraticCurveTo(x + Math.cos(a) * s * 0.5, y - s * 0.6 + Math.sin(a) * s * 0.6, x + Math.cos(a) * s * 0.8, y - s * 0.3 + Math.sin(a) * s * 0.3); ctx.stroke(); }
			break;
		}
		case "tuft": {
			ctx.strokeStyle = "rgba(70,80,40,0.75)";
			ctx.lineWidth = 1;
			for (const dx of [-0.4, 0, 0.4]) { ctx.beginPath(); ctx.moveTo(x + dx * s, y); ctx.lineTo(x + dx * s * 1.6, y - s); ctx.stroke(); }
			ctx.strokeStyle = "rgba(70,100,120,0.5)";
			ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.4); ctx.lineTo(x + s, y + s * 0.4); ctx.stroke();
			break;
		}
		case "dune": {
			ctx.strokeStyle = "rgba(120,85,40,0.45)";
			ctx.lineWidth = 1;
			ctx.beginPath(); ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x, y - s * 0.7, x + s, y); ctx.stroke();
			break;
		}
	}
}

function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number) {
	const m = Math.max(8, W * 0.012);
	ctx.strokeStyle = INK;
	ctx.lineWidth = Math.max(2, W / 400);
	ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
	ctx.lineWidth = 1;
	ctx.strokeRect(m + 5, m + 5, W - 2 * m - 10, H - 2 * m - 10);
	// graduated border ticks
	ctx.fillStyle = INK;
	const step = W / 40;
	for (let x = m + 5, i = 0; x < W - m - 5; x += step, i++) if (i % 2) { ctx.fillRect(x, m, step, 5); ctx.fillRect(x, H - m - 5, step, 5); }
	for (let y = m + 5, i = 0; y < H - m - 5; y += step, i++) if (i % 2) { ctx.fillRect(m, y, 5, step); ctx.fillRect(W - m - 5, y, 5, step); }
	// outside the frame: darker paper
	ctx.fillStyle = "rgba(60,40,20,0.25)";
	ctx.fillRect(0, 0, W, m);
	ctx.fillRect(0, H - m, W, m);
	ctx.fillRect(0, m, m, H - 2 * m);
	ctx.fillRect(W - m, m, m, H - 2 * m);
}

function drawCompass(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
	ctx.save();
	ctx.translate(cx, cy);
	ctx.strokeStyle = INK;
	ctx.lineWidth = 1;
	ctx.beginPath(); ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2); ctx.stroke();
	ctx.beginPath(); ctx.arc(0, 0, r * 0.68, 0, Math.PI * 2); ctx.stroke();
	for (let i = 0; i < 8; i++) {
		const a = (i * Math.PI) / 4 - Math.PI / 2;
		const long = i % 2 === 0;
		const L = long ? r : r * 0.55, w = long ? r * 0.16 : r * 0.1;
		for (const side of [-1, 1]) {
			ctx.fillStyle = side < 0 ? INK : PAPER;
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L);
			ctx.lineTo(Math.cos(a + (side * Math.PI) / 2) * w, Math.sin(a + (side * Math.PI) / 2) * w);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		}
	}
	ctx.fillStyle = INK;
	ctx.font = `${Math.round(r * 0.38)}px Georgia, serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";
	ctx.fillText("N", 0, -r * 1.02);
	ctx.restore();
}

function drawCartouche(ctx: CanvasRenderingContext2D, name: string, W: number, H: number, font: string) {
	const fs = Math.round(W / 34);
	ctx.save();
	ctx.font = `${fs}px ${font}`;
	const tw = ctx.measureText(name).width;
	const x = W * 0.04 + 6, y = H * 0.05 + 6, w = tw + fs * 2, h = fs * 1.9;
	ctx.fillStyle = "rgba(236,220,180,0.92)";
	ctx.strokeStyle = INK;
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(x + fs * 0.4, y);
	ctx.lineTo(x + w - fs * 0.4, y);
	ctx.quadraticCurveTo(x + w, y + h / 2, x + w - fs * 0.4, y + h);
	ctx.lineTo(x + fs * 0.4, y + h);
	ctx.quadraticCurveTo(x, y + h / 2, x + fs * 0.4, y);
	ctx.fill();
	ctx.stroke();
	ctx.strokeRect(x + fs * 0.5, y + 4, w - fs, h - 8);
	ctx.fillStyle = INK;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(name, x + w / 2, y + h / 2 + 1);
	ctx.restore();
}

// ─── overlay ─────────────────────────────────────────────────────────────

export interface OverlayOptions {
	fontFamily: string;
	showUndiscovered?: boolean;
	hoverId?: string | null;
	selectedId?: string | null;
}

export function routeCurve(world: WorldMap, r: WorldMap["routes"][number], W: number, H: number): { a: [number, number]; c: [number, number]; b: [number, number] } | null {
	const A = world.locations.find((l) => l.id === r.from), B = world.locations.find((l) => l.id === r.to);
	if (!A || !B) return null;
	const ax = A.x * W, ay = A.y * H, bx = B.x * W, by = B.y * H;
	const mx = (ax + bx) / 2, my = (ay + by) / 2;
	const len = Math.hypot(bx - ax, by - ay);
	const bend = (rand2(hashString(r.id), 0, world.seed) - 0.5) * 0.35 * len;
	return { a: [ax, ay], c: [mx - ((by - ay) / (len || 1)) * bend, my + ((bx - ax) / (len || 1)) * bend], b: [bx, by] };
}

export function paintWorldOverlay(ctx: CanvasRenderingContext2D, world: WorldMap, W: number, H: number, opt: OverlayOptions) {
	ctx.clearRect(0, 0, W, H);
	const show = (l: WorldLocation) => l.discovered || !!opt.showUndiscovered;
	const byId = new Map(world.locations.map((l) => [l.id, l]));
	const u = W / 1000;
	// routes
	for (const r of world.routes) {
		const A = byId.get(r.from), B = byId.get(r.to);
		if (!A || !B) continue;
		if (!opt.showUndiscovered && !(r.discovered && A.discovered && B.discovered)) continue;
		const cv = routeCurve(world, r, W, H);
		if (!cv) continue;
		ctx.save();
		ctx.globalAlpha = r.discovered ? 1 : 0.4;
		const path = () => {
			ctx.beginPath();
			ctx.moveTo(...cv.a);
			ctx.quadraticCurveTo(...cv.c, ...cv.b);
		};
		if (r.kind === "road") {
			ctx.strokeStyle = "rgba(236,220,180,0.8)";
			ctx.lineWidth = 5 * u;
			path(); ctx.stroke();
			ctx.strokeStyle = "#7a2f1f";
			ctx.lineWidth = 2.4 * u;
			ctx.setLineDash([10 * u, 5 * u]);
			path(); ctx.stroke();
		} else if (r.kind === "trail") {
			ctx.strokeStyle = "#5a3d22";
			ctx.lineWidth = 2 * u;
			ctx.setLineDash([2 * u, 6 * u]);
			ctx.lineCap = "round";
			path(); ctx.stroke();
		} else if (r.kind === "sea") {
			ctx.strokeStyle = "#2f5670";
			ctx.lineWidth = 1.8 * u;
			ctx.setLineDash([8 * u, 8 * u]);
			path(); ctx.stroke();
		} else {
			ctx.strokeStyle = "#3e6d8a";
			ctx.lineWidth = 2.4 * u;
			path(); ctx.stroke();
		}
		ctx.setLineDash([]);
		// travel time
		const t = 0.5;
		const px = (1 - t) * (1 - t) * cv.a[0] + 2 * (1 - t) * t * cv.c[0] + t * t * cv.b[0];
		const py = (1 - t) * (1 - t) * cv.a[1] + 2 * (1 - t) * t * cv.c[1] + t * t * cv.b[1];
		ctx.font = `italic ${Math.round(13 * u)}px ${opt.fontFamily}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const label = `${r.travelDays} ${r.travelDays === 1 ? "day" : "days"}`;
		ctx.lineWidth = 3;
		ctx.strokeStyle = "rgba(236,220,180,0.9)";
		ctx.strokeText(label, px, py);
		ctx.fillStyle = "#5a3d22";
		ctx.fillText(label, px, py);
		ctx.restore();
	}
	// locations
	const placedLabels: [number, number, number, number][] = [];
	const locs = world.locations.filter(show).sort((a, b) => a.y - b.y);
	for (const l of locs) {
		const x = l.x * W, y = l.y * H;
		const s = 18 * u * (l.kind === "city" ? 1.35 : l.kind === "village" || l.kind === "camp" ? 0.85 : 1);
		ctx.save();
		ctx.globalAlpha = l.discovered ? 1 : 0.45;
		if (opt.hoverId === l.id || opt.selectedId === l.id) {
			ctx.fillStyle = "rgba(255,240,190,0.55)";
			ctx.beginPath(); ctx.arc(x, y, s * 1.5, 0, Math.PI * 2); ctx.fill();
		}
		drawLocationIcon(ctx, l.kind, x, y, s);
		ctx.restore();
		// label
		const fs = Math.round((l.kind === "city" || l.kind === "town" ? 19 : 16) * u);
		ctx.font = `${l.visited ? "" : "italic "}${fs}px ${opt.fontFamily}`;
		const tw = ctx.measureText(l.name).width;
		let ly = y + s * 1.25 + fs * 0.5;
		const box = (yy: number): [number, number, number, number] => [x - tw / 2, yy - fs / 2, tw, fs];
		const hit = (b: [number, number, number, number]) => placedLabels.some((p) => b[0] < p[0] + p[2] && b[0] + b[2] > p[0] && b[1] < p[1] + p[3] && b[1] + b[3] > p[1]);
		if (hit(box(ly))) ly = y - s * 1.35 - fs * 0.4;
		placedLabels.push(box(ly));
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.lineJoin = "round";
		ctx.lineWidth = Math.max(3, 4 * u);
		ctx.strokeStyle = "rgba(240,228,196,0.92)";
		ctx.globalAlpha = l.discovered ? 1 : 0.5;
		ctx.strokeText(l.name, x, ly);
		ctx.fillStyle = INK;
		ctx.fillText(l.name, x, ly);
		ctx.globalAlpha = 1;
	}
}

function drawLocationIcon(ctx: CanvasRenderingContext2D, kind: LocationKind, x: number, y: number, s: number) {
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	ctx.strokeStyle = INK;
	ctx.lineWidth = Math.max(1.2, s * 0.09);
	const fillP = "#f3e6c4";
	const roof = "#8f3b28";
	const house = (hx: number, hy: number, hw: number, hh: number) => {
		ctx.fillStyle = fillP;
		ctx.fillRect(hx - hw / 2, hy - hh, hw, hh);
		ctx.strokeRect(hx - hw / 2, hy - hh, hw, hh);
		ctx.fillStyle = roof;
		ctx.beginPath(); ctx.moveTo(hx - hw / 2 - hw * 0.15, hy - hh); ctx.lineTo(hx, hy - hh - hw * 0.6); ctx.lineTo(hx + hw / 2 + hw * 0.15, hy - hh); ctx.closePath(); ctx.fill(); ctx.stroke();
	};
	const tower = (tx: number, ty: number, tw: number, th: number, flag = false) => {
		ctx.fillStyle = "#d8c8a4";
		ctx.fillRect(tx - tw / 2, ty - th, tw, th);
		ctx.strokeRect(tx - tw / 2, ty - th, tw, th);
		for (let i = 0; i < 3; i++) { ctx.fillStyle = "#d8c8a4"; const bx = tx - tw / 2 + (i * tw) / 2.5; ctx.fillRect(bx, ty - th - tw * 0.25, tw / 4, tw * 0.25); ctx.strokeRect(bx, ty - th - tw * 0.25, tw / 4, tw * 0.25); }
		ctx.fillStyle = INK;
		ctx.fillRect(tx - tw * 0.12, ty - th * 0.55, tw * 0.24, th * 0.25);
		if (flag) {
			ctx.beginPath(); ctx.moveTo(tx, ty - th - tw * 0.25); ctx.lineTo(tx, ty - th - tw * 1.1); ctx.stroke();
			ctx.fillStyle = "#a3291c";
			ctx.beginPath(); ctx.moveTo(tx, ty - th - tw * 1.1); ctx.lineTo(tx + tw * 0.7, ty - th - tw * 0.9); ctx.lineTo(tx, ty - th - tw * 0.7); ctx.fill();
		}
	};
	// ground shadow
	ctx.fillStyle = "rgba(60,40,20,0.25)";
	ctx.beginPath(); ctx.ellipse(x, y + s * 0.15, s * 0.9, s * 0.25, 0, 0, Math.PI * 2); ctx.fill();
	switch (kind) {
		case "city":
			ctx.fillStyle = "#e3d3ae";
			ctx.beginPath(); ctx.ellipse(x, y - s * 0.05, s * 1.05, s * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
			house(x - s * 0.5, y, s * 0.45, s * 0.4);
			house(x + s * 0.45, y + s * 0.05, s * 0.4, s * 0.35);
			tower(x, y - s * 0.05, s * 0.4, s * 0.85, true);
			break;
		case "town":
			house(x - s * 0.42, y + s * 0.05, s * 0.5, s * 0.42);
			house(x + s * 0.38, y + s * 0.1, s * 0.45, s * 0.38);
			house(x, y - s * 0.1, s * 0.55, s * 0.5);
			break;
		case "village":
			house(x - s * 0.3, y, s * 0.45, s * 0.35);
			house(x + s * 0.32, y + s * 0.08, s * 0.4, s * 0.3);
			break;
		case "castle":
			ctx.fillStyle = "#d8c8a4";
			ctx.fillRect(x - s * 0.75, y - s * 0.55, s * 1.5, s * 0.55);
			ctx.strokeRect(x - s * 0.75, y - s * 0.55, s * 1.5, s * 0.55);
			tower(x - s * 0.7, y, s * 0.35, s * 0.9);
			tower(x + s * 0.7, y, s * 0.35, s * 0.9);
			tower(x, y - s * 0.2, s * 0.45, s * 1.0, true);
			break;
		case "tower":
			tower(x, y, s * 0.45, s * 1.4, true);
			break;
		case "temple":
			ctx.fillStyle = "#efe4c8";
			ctx.beginPath(); ctx.moveTo(x - s * 0.8, y - s * 0.75); ctx.lineTo(x, y - s * 1.2); ctx.lineTo(x + s * 0.8, y - s * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke();
			ctx.fillRect(x - s * 0.75, y - s * 0.12, s * 1.5, s * 0.15);
			ctx.strokeRect(x - s * 0.75, y - s * 0.12, s * 1.5, s * 0.15);
			for (let i = 0; i < 4; i++) { const cx = x - s * 0.55 + i * s * 0.37; ctx.beginPath(); ctx.moveTo(cx, y - s * 0.72); ctx.lineTo(cx, y - s * 0.12); ctx.stroke(); }
			break;
		case "dungeon":
			ctx.fillStyle = "#cbb894";
			ctx.beginPath(); ctx.moveTo(x - s * 0.8, y); ctx.lineTo(x - s * 0.5, y - s * 0.9); ctx.lineTo(x + s * 0.5, y - s * 0.9); ctx.lineTo(x + s * 0.8, y); ctx.closePath(); ctx.fill(); ctx.stroke();
			ctx.fillStyle = "#1f150d";
			ctx.beginPath(); ctx.moveTo(x - s * 0.3, y); ctx.lineTo(x - s * 0.3, y - s * 0.4); ctx.arc(x, y - s * 0.4, s * 0.3, Math.PI, 0); ctx.lineTo(x + s * 0.3, y); ctx.closePath(); ctx.fill();
			ctx.fillStyle = "#f3e6c4";
			ctx.beginPath(); ctx.arc(x, y - s * 0.32, s * 0.12, 0, Math.PI * 2); ctx.fill();
			break;
		case "cave":
			ctx.fillStyle = "#b9a682";
			ctx.beginPath(); ctx.moveTo(x - s, y); ctx.quadraticCurveTo(x - s * 0.6, y - s * 1.3, x + s * 0.1, y - s * 1.05); ctx.quadraticCurveTo(x + s * 0.9, y - s * 0.9, x + s, y); ctx.closePath(); ctx.fill(); ctx.stroke();
			ctx.fillStyle = "#1f150d";
			ctx.beginPath(); ctx.ellipse(x, y - s * 0.05, s * 0.38, s * 0.45, 0, Math.PI, 0); ctx.fill();
			break;
		case "ruins":
			for (const [dx, h] of [[-0.55, 0.9], [-0.15, 0.55], [0.25, 1.0], [0.62, 0.4]]) {
				ctx.fillStyle = "#e3d5b3";
				ctx.fillRect(x + dx * s - s * 0.12, y - h * s, s * 0.24, h * s);
				ctx.strokeRect(x + dx * s - s * 0.12, y - h * s, s * 0.24, h * s);
			}
			ctx.beginPath(); ctx.moveTo(x - s * 0.7, y - s * 0.9); ctx.lineTo(x - s * 0.05, y - s * 0.95); ctx.stroke();
			break;
		case "forest":
			for (const [dx, dy] of [[-0.45, 0.05], [0.45, 0.05], [0, -0.25]]) {
				ctx.fillStyle = "#7f8f52";
				ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s - s * 0.35, s * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
				ctx.beginPath(); ctx.moveTo(x + dx * s, y + dy * s + s * 0.05); ctx.lineTo(x + dx * s, y + dy * s + s * 0.3); ctx.stroke();
			}
			break;
		case "mountain":
			ctx.fillStyle = "#e7dcc3";
			ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x - s * 0.1, y - s * 1.4); ctx.lineTo(x + s, y); ctx.closePath(); ctx.fill(); ctx.stroke();
			ctx.fillStyle = "#fbfaf6";
			ctx.beginPath(); ctx.moveTo(x - s * 0.1, y - s * 1.4); ctx.lineTo(x - s * 0.4, y - s * 0.95); ctx.lineTo(x + s * 0.2, y - s * 0.95); ctx.closePath(); ctx.fill(); ctx.stroke();
			break;
		case "swamp":
			ctx.strokeStyle = "#556b3a";
			for (const dx of [-0.6, -0.2, 0.2, 0.6]) { ctx.beginPath(); ctx.moveTo(x + dx * s, y); ctx.lineTo(x + dx * s * 1.3, y - s * 0.8); ctx.stroke(); }
			ctx.strokeStyle = "#3e6d8a";
			ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.15); ctx.quadraticCurveTo(x, y - s * 0.05, x + s, y + s * 0.15); ctx.stroke();
			break;
		case "coast":
			ctx.beginPath(); ctx.arc(x, y - s * 0.5, s * 0.5, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x, y); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(x - s * 0.3, y - s * 0.95); ctx.lineTo(x + s * 0.3, y - s * 0.95); ctx.stroke();
			ctx.beginPath(); ctx.arc(x, y - s * 1.3, s * 0.12, 0, Math.PI * 2); ctx.stroke();
			break;
		case "camp":
			ctx.fillStyle = "#d9c39a";
			ctx.beginPath(); ctx.moveTo(x - s * 0.7, y); ctx.lineTo(x, y - s * 0.9); ctx.lineTo(x + s * 0.7, y); ctx.closePath(); ctx.fill(); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(x, y - s * 0.9); ctx.lineTo(x, y); ctx.stroke();
			ctx.fillStyle = "#c2410c";
			ctx.beginPath(); ctx.arc(x + s * 0.9, y - s * 0.1, s * 0.15, 0, Math.PI * 2); ctx.fill();
			break;
		default:
			ctx.fillStyle = "#d8c8a4";
			ctx.beginPath(); ctx.moveTo(x - s * 0.2, y); ctx.lineTo(x - s * 0.1, y - s * 1.3); ctx.lineTo(x + s * 0.1, y - s * 1.3); ctx.lineTo(x + s * 0.2, y); ctx.closePath(); ctx.fill(); ctx.stroke();
	}
}
