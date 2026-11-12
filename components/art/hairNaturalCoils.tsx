import type { ReactNode } from "react";
import { mix } from "@/lib/art/color";
import { r1, type ArtRng } from "@/lib/art/rand";
import {
	clamp, contactShadow, cubic, formShade, hairlineFull, inside, lerp, lightAt, linePath, qPath, smoothstep,
	type Guide, type Hairline, type P,
} from "./hairNatural";
import { clipperSides, distTo, frontOf, layers, region, type Cut, type Kit } from "./hairNaturalKit";

/**
 * Curly, coily and textured cuts: curly top, afros, twists, locs, cornrows.
 *
 * Coily hair is painted as clusters (`paintCoils`): small irregular curl
 * clumps toned by the light, each casting a little shadow on the ones behind,
 * with fine coil arcs on the lit ones. The clusters on the outside make the
 * soft, bumpy silhouette. Twists and locs are ropes (`paintRopes`) grown from
 * the scalp; cornrows are plaited rows over a visible scalp.
 */

const SIDES = [-1, 1] as const;

// ─── Coils ──────────────────────────────────────────────────────────────

interface CoilOpts {
	/** Cluster radius. */
	r: number;
	/** Hairline (open polyline): clusters shrink near it for a soft, fine edge. */
	edge?: P[];
	/** Tone bias. */
	tone?: number;
	/** Grid spacing as a multiple of r (default 1.1). */
	gap?: number;
	/** Extra clusters only along the outer silhouette (open polyline) for a bumpy outline. */
	rim?: P[];
}

function blob(rng: ArtRng, x: number, y: number, r: number): string {
	const n = 7;
	const a0 = rng.range(0, Math.PI * 2);
	const pts: P[] = [];
	for (let i = 0; i < n; i++) {
		const a = a0 + (i / n) * Math.PI * 2;
		const rr = r * rng.range(0.82, 1.12);
		pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.92]);
	}
	return qPath(pts, true);
}

function arc(x: number, y: number, r: number, a0: number, span: number): string {
	const a1 = a0 + span;
	return `M${r1(x + Math.cos(a0) * r)} ${r1(y + Math.sin(a0) * r)}A${r1(r)} ${r1(r)} 0 ${span > Math.PI ? 1 : 0} 1 ${r1(x + Math.cos(a1) * r)} ${r1(y + Math.sin(a1) * r)}`;
}

/** Coily texture over a region polygon. */
function paintCoils(k: Kit, key: string, reg: P[], o: CoilOpts): ReactNode {
	const { rng, pal } = k;
	const T = pal.tones;
	let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
	for (const [x, y] of reg) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
	const step = o.r * (o.gap ?? 1.1);
	type B = { x: number; y: number; r: number; tone: number };
	const bs: B[] = [];
	const add = (x: number, y: number, r: number) => {
		const li = lightAt(k.c, x, y);
		const tone = clamp(Math.round(li * 3.2 - 0.1 + (o.tone ?? 0) + rng.range(-0.55, 0.55)), 0, 3);
		bs.push({ x, y, r, tone });
	};
	let row = 0;
	for (let y = y0; y <= y1 + step; y += step * 0.86, row++) {
		for (let x = x0 + (row % 2) * step * 0.5; x <= x1; x += step) {
			const px = x + rng.range(-0.35, 0.35) * step, py = y + rng.range(-0.35, 0.35) * step;
			if (!inside(reg, px, py)) continue;
			let r = o.r * rng.range(0.8, 1.15);
			if (o.edge) r *= lerp(0.42, 1, smoothstep(distTo(o.edge, px, py) / (o.r * 2.2)));
			add(px, py, r);
		}
	}
	if (o.rim) {
		for (let i = 0; i < o.rim.length; i++) {
			const [x, y] = o.rim[i];
			add(x + rng.range(-0.6, 0.6), y + rng.range(-0.6, 0.6), o.r * rng.range(0.75, 1.05));
		}
	}
	const body: string[] = ["", "", "", ""];
	const shad: string[] = ["", "", "", ""];
	const micro: string[] = ["", "", "", "", ""];
	const sh = Math.max(0.5, o.r * 0.22);
	for (const b of bs) {
		const d = blob(rng, b.x, b.y, b.r);
		body[b.tone] += d;
		if (b.tone > 0) shad[b.tone] += blob(rng, b.x + sh * 0.7, b.y + sh, b.r * 0.95);
		// fine coils: small arcs on the cluster's lit side
		const m = b.tone >= 1 ? (b.r > 2 ? 2 : 1) : 0;
		for (let j = 0; j < m; j++) {
			const rm = b.r * rng.range(0.32, 0.48);
			const cx = b.x + rng.range(-0.45, 0.25) * b.r, cy = b.y + rng.range(-0.45, 0.25) * b.r;
			micro[Math.min(4, b.tone + 1)] += arc(cx, cy, rm, rng.range(2.6, 3.6), rng.range(2.2, 3.3));
		}
	}
	return (
		<g key={key}>
			{[0, 1, 2, 3].map((t) => (
				<g key={t}>
					{shad[t] && <path d={shad[t]} fill={T[0]} opacity={0.4} />}
					{body[t] && <path d={body[t]} fill={T[t]} />}
				</g>
			))}
			<g fill="none" strokeLinecap="round">
				{micro.map((d, t) => (d ? <path key={t} d={d} stroke={T[t]} strokeWidth={Math.max(0.4, o.r * 0.16)} opacity={0.7} /> : null))}
			</g>
		</g>
	);
}

/** The outside of a shell as points spaced ~`gap` apart (for rim clusters). */
function rimPoints(k: Kit, T: (u: number) => number, u0: number, u1: number, inset: number, n: number): P[] {
	return k.sk.shell((u) => T(u) - inset, u0, u1, n);
}

// ─── Ropes (twists, locs) ───────────────────────────────────────────────

interface Rope {
	/** Centreline control points (cubic or quadratic), root → tip. */
	g: Guide;
	wid: number;
}

function ropeLine(g: Guide, n = 12): P[] {
	return Array.from({ length: n + 1 }, (_, i) => cubic(g, i / n));
}

function ribbonAround(pts: P[], hw: (q: number) => number, shift = 0): string {
	const L: P[] = [], R: P[] = [];
	const n = pts.length - 1;
	for (let k = 0; k <= n; k++) {
		const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n, k + 1)];
		const dx = b[0] - a[0], dy = b[1] - a[1];
		const m = Math.hypot(dx, dy) || 1;
		const nx = -dy / m, ny = dx / m;
		const h = hw(k / n);
		const o = h * shift;
		L.push([pts[k][0] + nx * (o + h), pts[k][1] + ny * (o + h)]);
		R.push([pts[k][0] + nx * (o - h), pts[k][1] + ny * (o - h)]);
	}
	// rounded tip: a point beyond the end
	const e = pts[n], p = pts[n - 1];
	const dx = e[0] - p[0], dy = e[1] - p[1];
	const m = Math.hypot(dx, dy) || 1;
	const cap: P = [e[0] + (dx / m) * hw(1) * 0.9, e[1] + (dy / m) * hw(1) * 0.9];
	return qPath([...L, cap, ...R.reverse()], true);
}

/**
 * Ropes in order (first = furthest back). "twist": two strands wound round each
 * other (slanted segments); "loc": a matted cylinder with a lit side and fine
 * cross texture.
 */
function paintRopes(k: Kit, key: string, ropes: Rope[], kind: "twist" | "loc"): ReactNode {
	const { rng, pal } = k;
	const T = pal.tones;
	const out: ReactNode[] = [];
	ropes.forEach((rp, i) => {
		const pts = ropeLine(rp.g);
		const mid = pts[Math.floor(pts.length / 2)];
		const li = lightAt(k.c, mid[0], mid[1]);
		const tone = clamp(Math.round(li * 3 + 0.2 + rng.range(-0.6, 0.6)), 1, 3);
		const hw = (q: number) => (rp.wid / 2) * (kind === "twist" ? 1 - 0.25 * q : 1 - 0.12 * q) * (q < 0.06 ? 0.75 + q * 4 : 1);
		// which side faces the light
		const a = pts[2], b = pts[pts.length - 3];
		const dx = b[0] - a[0], dy = b[1] - a[1];
		const m = Math.hypot(dx, dy) || 1;
		const side = (-dy / m) * -0.55 + (dx / m) * -0.83 >= 0 ? 1 : -1;
		const body = ribbonAround(pts, hw);
		out.push(<path key={`o${i}`} d={body} fill={T[tone - 1]} stroke={T[0]} strokeWidth={0.5} strokeOpacity={0.7} />);
		if (kind === "twist") {
			// slanted segments of the two strands, wound round each other
			const len = pts.reduce((s, p, j) => (j ? s + Math.hypot(p[0] - pts[j - 1][0], p[1] - pts[j - 1][1]) : 0), 0);
			const nSeg = Math.max(2, Math.round(len / (rp.wid * 0.78)));
			out.push(
				<g key={`s${i}`}>
					{Array.from({ length: nSeg }, (_, j) => {
						const t = (j + 0.5) / nSeg;
						const [x, y] = cubic(rp.g, t);
						const [x2, y2] = cubic(rp.g, Math.min(1, t + 0.03));
						const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI + 58;
						const h = hw(t);
						return <ellipse key={j} cx={r1(x)} cy={r1(y)} rx={r1(h * 1.0)} ry={r1(Math.max(0.5, h * 0.52))} transform={`rotate(${r1(ang)} ${r1(x)} ${r1(y)})`} fill={T[tone]} />;
					})}
				</g>,
			);
			out.push(<path key={`h${i}`} d={ribbonAround(pts.slice(1, -2), (q) => hw(q) * 0.32, side * 0.55)} fill={T[Math.min(4, tone + 1)]} opacity={0.75} />);
		} else {
			out.push(<path key={`b${i}`} d={ribbonAround(pts, (q) => hw(q) * 0.82, -side * 0.12)} fill={T[tone]} />);
			out.push(<path key={`h${i}`} d={ribbonAround(pts.slice(1, -1), (q) => hw(q) * 0.36, side * 0.5)} fill={T[Math.min(4, tone + 1)]} opacity={0.8} />);
			// matted texture: short slanted dashes across
			let tex = "";
			const nT = Math.round(pts.length * 1.6);
			for (let j = 1; j < nT; j++) {
				const t = j / nT;
				const [x, y] = cubic(rp.g, t);
				const [x2, y2] = cubic(rp.g, Math.min(1, t + 0.02));
				const dx2 = x2 - x, dy2 = y2 - y, mm = Math.hypot(dx2, dy2) || 1;
				const nx = -dy2 / mm, ny = dx2 / mm;
				const h = hw(t) * rng.range(0.4, 0.85);
				const sk = rng.range(0.3, 0.7) * h;
				tex += `M${r1(x - nx * h - (dx2 / mm) * sk)} ${r1(y - ny * h - (dy2 / mm) * sk)}L${r1(x + nx * h + (dx2 / mm) * sk)} ${r1(y + ny * h + (dy2 / mm) * sk)}`;
			}
			out.push(<path key={`t${i}`} d={tex} stroke={T[Math.max(0, tone - 1)]} strokeWidth={0.5} opacity={0.65} fill="none" strokeLinecap="round" />);
		}
	});
	return <g key={key}>{out}</g>;
}

// ─── Shared shapes ──────────────────────────────────────────────────────

/** The faded sides plus the region polygon for a cut with a fuller top. */
function fadedSides(k: Kit, key: string, hlP: Hairline, yTop = 78) {
	const hl = hairlineFull(k.c, hlP, k.rng);
	const reg = region(k, (u) => (Math.abs(u) > 0.5 ? 1.4 : 2.4), hl);
	return { hl, reg, node: clipperSides(k, key, reg, hl, { yTop, yBot: 100, dTop: 0.95, dBot: 0.4 }) };
}

/** Top mass polygon: shell over [−uR, uR] closed along the front hairline. */
function topRegion(k: Kit, T: (u: number) => number, hl: P[], yR: number, span = 0.84, lift = 0): P[] {
	const uR = k.sk.uAtY(yR);
	const front = frontOf(k, hl, span).map(([x, y]) => [x, y - lift] as P);
	return [...k.sk.shell(T, -uR, uR, 30), ...front.reverse()];
}

// ─── The cuts ───────────────────────────────────────────────────────────

const afroShort: Cut = (k) => {
	const hlP: Hairline = { y: 70.5, recess: 1, burn: 104, earTop: 95, rough: 0.3 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	const T = (u: number) => (k.flat ? 2.2 : 7.2 - 1.6 * u * u);
	const reg = region(k, (u) => T(u) - 1.6, hl);
	const u95 = k.sk.uAtY(94);
	const front = frontOf(k, hl, 0.9);
	return layers(null, (
		<g>
			{contactShadow(k.c, front, "as-cs", 0.28, 4, 1.4)}
			<path d={linePath(reg)} fill={k.pal.tones[1]} />
			{paintCoils(k, "as-c", reg, { r: 2.3, edge: hl, rim: rimPoints(k, T, -u95, u95, 2.2, 26) })}
			{formShade(k.c, "as-s", linePath(region(k, T, hl)), 0.55)}
		</g>
	));
};

const afro: Cut = (k) => {
	const hlP: Hairline = { y: 70.5, recess: 1, burn: 104, earTop: 103, rough: 0.3 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	// rounded: full on top and at the temples, tucking in toward the ears
	const T = (u: number) => (k.flat ? 2.6 : 17 - 3 * u * u - 6 * smoothstep((Math.abs(u) - 0.72) / 0.28));
	const reg = region(k, (u) => T(u) - 2.6, hl, 103);
	const u0 = k.sk.uAtY(103);
	const front = frontOf(k, hl, 0.9);
	return layers(null, (
		<g>
			{contactShadow(k.c, front, "af-cs", 0.32, 5, 1.6)}
			<path d={linePath(reg)} fill={k.pal.tones[1]} />
			{paintCoils(k, "af-c", reg, { r: 3, edge: hl, rim: rimPoints(k, T, -u0, u0, 3, 34) })}
			{formShade(k.c, "af-s", linePath(region(k, T, hl, 103)), 0.6)}
		</g>
	));
};

const curlyTop: Cut = (k) => {
	const hlP: Hairline = { y: 70, recess: 2.5, burn: 104, earTop: 96 };
	const sides = fadedSides(k, "ct", hlP, 76);
	const T = (u: number) => (k.flat ? 2 : 12.5 - 7.5 * u * u);
	const top = topRegion(k, (u) => T(u) - 2, sides.hl, 80, 0.82, 1);
	const uR = k.sk.uAtY(80);
	const front = frontOf(k, sides.hl, 0.82);
	// a few loose curls dropping onto the forehead
	return layers(null, (
		<g>
			{sides.node}
			{contactShadow(k.c, front, "ct-cs", 0.3, 5, 2.4)}
			<path d={linePath(top)} fill={k.pal.tones[1]} />
			{paintCoils(k, "ct-c", top, { r: 3.2, gap: 1.05, rim: rimPoints(k, T, -uR, uR, 2.6, 20) })}
			{formShade(k.c, "ct-s", linePath(top), 0.5)}
		</g>
	));
};

function yOn2(pts: P[], x: number): number {
	let best = Infinity;
	for (let i = 1; i < pts.length; i++) {
		const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
		if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) best = Math.min(best, lerp(y0, y1, x1 === x0 ? 0 : (x - x0) / (x1 - x0)));
	}
	return Number.isFinite(best) ? best : 72;
}

const twists: Cut = (k) => {
	const hlP: Hairline = { y: 70, recess: 2, burn: 104, earTop: 96 };
	const sides = fadedSides(k, "tw", hlP, 76);
	const front = frontOf(k, sides.hl, 0.82);
	const top = topRegion(k, () => 1.5, sides.hl, 80, 0.82);
	const ropes: Rope[] = [];
	const rows = 5;
	for (let r = rows - 1; r >= 0; r--) {
		const f = r / (rows - 1); // 0 front row … 1 back (top of the head)
		const n = Math.round(lerp(9, 6, f));
		for (let i = 0; i < n; i++) {
			const a = -0.8 + (1.6 * (i + 0.5 + k.rng.range(-0.3, 0.3))) / n;
			const x = k.cx + a * k.w * lerp(0.98, 0.78, f);
			const hy = yOn2(front, k.cx + a * k.w * 0.95);
			const u = a * lerp(0.55, 0.32, f);
			const sp = k.sk.at(u, 0);
			const root: P = [x, lerp(hy + 1, sp[1] + 4, f)];
			const nrm = k.sk.normal(u);
			const len = k.flat ? 3 : k.rng.range(8, 11) * lerp(0.9, 1.05, f);
			// up and out from the scalp, then bending over under their own weight
			const tw = k.rng.range(-0.45, 0.45);
			let dx = nrm[0] * 0.7 + tw, dy = nrm[1] - 0.15;
			const m = Math.hypot(dx, dy) || 1;
			dx /= m; dy /= m;
			const mid: P = [root[0] + dx * len * 0.6, root[1] + dy * len * 0.6];
			const bend = (a < 0 ? -1 : 1) * k.rng.range(1, 3.5) + tw * 3;
			const tip: P = [mid[0] + dx * len * 0.3 + bend, mid[1] + dy * len * 0.2 + k.rng.range(1.5, 3.5)];
			ropes.push({ g: [root, mid, tip], wid: k.rng.range(3.6, 4.4) });
		}
	}
	return layers(null, (
		<g>
			{sides.node}
			{contactShadow(k.c, front, "tw-cs", 0.25, 4, 1.4)}
			<path d={linePath(top)} fill={mix(k.pal.tones[0], k.pal.scalp, 0.35)} />
			{paintRopes(k, "tw-r", ropes, "twist")}
		</g>
	));
};

/** Locs grown from a crown grid and falling to `len` (y of the side tips). */
function locsCut(k: Kit, key: string, long: boolean) {
	const hlP: Hairline = { y: 70.5, recess: 1.5, burn: 104, earTop: 96 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	const front = frontOf(k, hl, 0.86);
	const T0 = k.flat ? 2 : 6.5;
	const reg = region(k, () => 2.2, hl);
	const ropes: Rope[] = [];
	const backRopes: Rope[] = [];
	const extraRopes: Rope[] = [];
	const wid = long ? 3.6 : 3.4;
	// side locs: from the top, over the skull, down past the ears
	for (const s of SIDES) {
		const n = 6;
		for (let i = 0; i < n; i++) {
			const f = i / (n - 1); // 0 near the part … 1 lowest on the side
			const u = s * lerp(0.12, 0.7, f);
			const root = k.sk.at(u, 1);
			const over = k.sk.at(s * Math.min(0.95, Math.abs(u) + 0.3), T0 + 1);
			const tipY = long ? k.rng.range(150, 175) - f * 6 : k.rng.range(112, 124) - f * 4;
			const tipX = k.cx + s * (k.w + lerp(2, 8, f) + k.rng.range(-1, 1.5));
			ropes.push({ g: [root, over, [k.cx + s * (k.w + 5 + f * 3), (over[1] + tipY) / 2], [tipX, tipY]], wid: wid * k.rng.range(0.9, 1.1) });
		}
	}
	// locs over the top: from the crown, arcing out and down over the skull (behind the front ones)
	const topL: Rope[] = [];
	for (let i = 0; i < 9; i++) {
		const a = -0.85 + (1.7 * (i + 0.5)) / 9 + k.rng.range(-0.05, 0.05);
		const root = k.sk.at(a * 0.15, -1);
		const over = k.sk.at(a * 0.55, T0 + 1.2);
		const end = k.sk.at(Math.sign(a) * Math.min(0.92, Math.abs(a) * 0.95 + 0.12), T0);
		topL.push({ g: [root, over, [end[0], end[1] + 6]], wid: wid * k.rng.range(0.95, 1.1) });
	}
	// front locs: parted from the middle, falling forward and to the sides, short of the eyes
	const fr: Rope[] = [];
	const nF = 8;
	for (let i = 0; i < nF; i++) {
		const a = -0.9 + (1.8 * (i + 0.5)) / nF + k.rng.range(-0.04, 0.04);
		const s = a < 0 ? -1 : 1;
		const root = k.sk.at(a * 0.3, T0 * 0.6);
		const hx = k.cx + a * k.w * 0.9;
		const drop = (long ? 14 : 11) - Math.abs(a) * 2 + k.rng.range(-4, 3.5) - (Math.abs(a) < 0.3 ? 3 : 0);
		const ty = Math.min(90, yOn2(front, hx) + drop);
		const crest = k.sk.at(a * 0.55, T0 + 2);
		const tip: P = [hx + s * (4 + Math.abs(a) * 10) + k.rng.range(-2, 2), k.flat ? Math.min(ty, 80) : ty];
		fr.push({ g: [root, crest, [tip[0] - s * k.rng.range(2, 5), tip[1] - 9], tip], wid: wid * k.rng.range(0.92, 1.12) });
	}
	// outermost first, the middle ones on top
	fr.sort((p, q) => Math.abs(q.g[0][0] - k.cx) - Math.abs(p.g[0][0] - k.cx));
	if (long) {
		for (const s of SIDES) {
			// the mass down the back, between the shoulders
			for (let i = 0; i < 6; i++) {
				const x = k.cx + s * (k.w * lerp(0.35, 1.05, i / 5));
				backRopes.push({ g: [[x, k.top + 20], [x + s * 6, 120], [x + s * (8 + i), 170], [x + s * (9 + i * 1.6), k.rng.range(196, 214)]], wid: wid * 1.05 });
			}
			// two or three over the front of each shoulder, clear of the face
			for (let i = 0; i < 3; i++) {
				const x0 = k.cx + s * (k.w + 1 + i * 3.4);
				extraRopes.push({ g: [[x0, 112], [x0 + s * (1 + i), 140], [x0 + s * (3 + i * 2), 170], [x0 + s * (4 + i * 2.6), k.rng.range(192, 208)]], wid: wid * k.rng.range(0.9, 1.05) });
			}
		}
	}
	const back = long ? (
		<g>
			<path d={qPath([[k.cx - k.w - 8, k.top + 26], [k.cx + k.w + 8, k.top + 26], [k.cx + k.w + 20, 200], [k.cx - k.w - 20, 200]])} fill={k.pal.tones[0]} />
			{paintRopes(k, `${key}-b`, backRopes, "loc")}
		</g>
	) : null;
	return layers(back, (
		<g>
			{contactShadow(k.c, front, `${key}-cs`, 0.3, 5, 1.8)}
			<path d={linePath(reg)} fill={mix(k.pal.tones[0], k.pal.scalp, 0.4)} />
			{paintRopes(k, `${key}-s`, ropes, "loc")}
			{paintRopes(k, `${key}-t`, topL, "loc")}
			{paintRopes(k, `${key}-f`, fr, "loc")}
		</g>
	), long ? paintRopes(k, `${key}-x`, extraRopes, "loc") : null);
}

const locsShort: Cut = (k) => locsCut(k, "ls", false);
const locsLong: Cut = (k) => locsCut(k, "ll", true);

const cornrows: Cut = (k) => {
	const hlP: Hairline = { y: 70.5, recess: 1, burn: 104, earTop: 96, rough: 0.3 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	const reg = region(k, () => 1.6, hl);
	const regD = linePath(reg);
	const front = frontOf(k, hl, 0.86);
	const T = k.pal.tones;
	// rows: start at the hairline, run straight back over the top
	const rows: { g: Guide; w0: number; w1: number }[] = [];
	const N = 7;
	for (let i = 0; i < N; i++) {
		const a = -1 + (2 * (i + 0.5)) / N;
		const x0 = k.cx + a * k.w * 0.72;
		const y0 = yOn2(front, x0) + 0.5;
		const top = k.sk.at(a * 0.42, 2.6);
		rows.push({ g: [[x0, y0], [x0 + a * 1.5, (y0 + top[1]) / 2 - 2], [top[0], top[1] - 0.5]], w0: 2.6, w1: 4.6 });
	}
	for (const s of SIDES) {
		// side rows: from the temple and above the ear, following the side of the skull back
		for (const [yy, uu, xf] of [[80, 0.74, 0.9], [90, 0.88, 0.96]] as const) {
			const x0 = k.cx + s * k.w * xf;
			const top = k.sk.at(s * uu, 2.6);
			const mid = k.sk.at(s * Math.min(0.98, uu + 0.12), 2.4);
			rows.push({ g: [[x0, yy], [mid[0], mid[1] + 4], [top[0], top[1]]], w0: 2.4, w1: 4 });
		}
	}
	const plaits: ReactNode[] = [];
	rows.forEach((rw, i) => {
		const pts = ropeLine(rw.g, 14);
		const hw = (q: number) => lerp(rw.w0, rw.w1, q) / 2;
		plaits.push(<path key={`r${i}`} d={ribbonAround(pts, hw)} fill={T[0]} />);
		const len = pts.reduce((s, p, j) => (j ? s + Math.hypot(p[0] - pts[j - 1][0], p[1] - pts[j - 1][1]) : 0), 0);
		const n = Math.max(3, Math.round(len / 2.3));
		for (let j = 0; j < n; j++) {
			const t = (j + 0.5) / n;
			const [x, y] = cubic(rw.g, t);
			const [x2, y2] = cubic(rw.g, Math.min(1, t + 0.03));
			const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
			const h = hw(t);
			const li = lightAt(k.c, x, y);
			const tone = clamp(Math.round(li * 3 + 0.4), 1, 3);
			for (const sd of [-1, 1]) {
				const ox = Math.cos(((ang + 90) * Math.PI) / 180) * h * 0.42 * sd;
				const oy = Math.sin(((ang + 90) * Math.PI) / 180) * h * 0.42 * sd;
				plaits.push(
					<ellipse key={`p${i}-${j}-${sd}`} cx={r1(x + ox)} cy={r1(y + oy)} rx={r1(Math.max(0.9, h * 0.62))} ry={r1(Math.max(0.5, h * 0.36))} transform={`rotate(${r1(ang + sd * 38)} ${r1(x + ox)} ${r1(y + oy)})`} fill={T[sd < 0 ? tone : tone - 1]} />,
				);
			}
		}
		plaits.push(<path key={`h${i}`} d={ribbonAround(pts.slice(2, -1), (q) => hw(q) * 0.22, -0.55)} fill={T[4]} opacity={0.35} />);
	});
	return layers(null, (
		<g>
			{/* the scalp between the rows, with fine baby hair at the edge */}
			<path d={regD} fill={mix(k.pal.scalp, k.c.skin, 0.25)} />
			{clipperSides(k, "cr-e", reg, hl, { yTop: 60, yBot: 100, dTop: 0.25, dBot: 0.25, tint: [0.25, 0.2] })}
			{plaits}
			{formShade(k.c, "cr-s", regD, 0.6)}
		</g>
	));
};

export const COIL_CUTS: Record<string, Cut> = {
	m_curly_top: curlyTop,
	m_afro_short: afroShort,
	m_afro: afro,
	m_twists: twists,
	m_locs_short: locsShort,
	m_locs_long: locsLong,
	m_cornrows: cornrows,
};
