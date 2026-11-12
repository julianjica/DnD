import type { ReactNode } from "react";
import { mix } from "@/lib/art/color";
import {
	clipTo, contactShadow, formShade, growClumps, hairlineFull, lerp, lerpP, linePath, paintClumps, qPath, smoothstep,
	type Family, type Guide, type Hairline, type NatLayers, type P,
} from "./hairNatural";
import { clipperSides, frontOf, layers, region, rim, upGuides, yOn, type Cut, type Kit } from "./hairNaturalKit";

/** Short and clipper cuts. */

const buzz: Cut = (k) => {
	const hlP: Hairline = { y: 70.5, recess: 2.5, burn: 103, earTop: 96 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	const reg = region(k, () => 1.2, hl);
	const d = linePath(reg);
	const sil = k.sk.shell(() => 1.2, -k.sk.uAtY(95), k.sk.uAtY(95), 32);
	return layers(null, (
		<g>
			{clipperSides(k, "bz", reg, hl, { yTop: 60, yBot: 100, dTop: 0.95, dBot: 0.7, step: 1.15, len: [0.9, 1.6], tint: [0.78, 0.55] })}
			<ellipse cx={k.cx - k.w * 0.35} cy={k.top + 9} rx={k.w * 0.42} ry={8} fill="#ffffff" opacity={0.12} filter={k.c.url("soft2")} />
			{formShade(k.c, "bz-s", d, 0.8)}
			{rim(k, sil, "bz-r", 0.35, 0.7)}
		</g>
	));
};

const crew: Cut = (k) => {
	const hlP: Hairline = { y: 70, recess: 3, burn: 104, earTop: 96 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	const Tt = (u: number) => (k.flat ? 1.8 : 6.5 - 3.5 * u * u);
	const reg = region(k, (u) => Math.max(1.4, Tt(u) - 3 * smoothstep((Math.abs(u) - 0.5) / 0.35)), hl);
	const front = frontOf(k, hl, 0.84);
	const uR = k.sk.uAtY(78);
	const sil = k.sk.shell((u) => Tt(u) - 1.6, -uR, uR, 26);
	const topD = qPath([...sil, ...front.map(([x, y]) => [x, y - 1.2] as P).reverse()]);
	const g = upGuides(k, front, Tt, 12, { span: 0.84, lift: 3, uMax: 0.66 });
	// short tufts in staggered rows: the crew's texture, tips breaking the outline
	const cl = [0.62, 0.36, 0.12, 0].flatMap((st, r) =>
		growClumps(k.c, { guides: g, n: 16 + r * 2, wid: 4.6 - r * 0.3, taper: r === 0 ? "both" : "tip", len: [Math.min(0.97, st + 0.36), Math.min(0.99, st + 0.48)], start: [st, st + 0.06], jit: 1.4, tone: 0.3 - r * 0.15 }, k.rng),
	);
	return layers(null, (
		<g>
			{contactShadow(k.c, front, "cr-cs", 0.22, 4, 1.2)}
			{clipperSides(k, "cr", reg, hl, { yTop: 72, yBot: 100, dTop: 0.95, dBot: 0.5 })}
			<path d={topD} fill={k.pal.tones[1]} />
			{paintClumps(cl, k.pal, k.rng, "cr-c")}
			{formShade(k.c, "cr-s", topD, 0.7)}
		</g>
	));
};

/** Classic side part, tapered: the top combed over from a part on his left (viewer's right). */
const sidePart: Cut = (k) => {
	const hlP: Hairline = { y: 70, recess: 2, burn: 105, earTop: 96 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	const px = k.cx + k.w * 0.42; // part
	const Tt = (u: number) => (k.flat ? 1.8 : u < 0.4 ? 11 - 6 * smoothstep((-u + 0.1) / 0.9) : 6 - 3 * smoothstep((u - 0.5) / 0.4));
	const reg = region(k, (u) => Math.max(1.4, Math.min(4, Tt(u))), hl);
	const uR = k.sk.uAtY(84);
	const sil = k.sk.shell((u) => Tt(u) - 1.5, -uR, uR, 30);
	const front = frontOf(k, hl, 0.9);
	// the combed-over front edge sits a little above the hairline on the swept side
	const edge = front.map(([x, y]) => [x, y - (k.flat ? 0 : 2.5 * smoothstep((px - x) / (k.w * 0.5)) * (1 - smoothstep((k.cx - k.w * 0.7 - x) / -6)))] as P);
	const topD = qPath([...sil, ...edge.slice().reverse()]);
	const partTop = k.sk.at(0.3, Tt(0.3) - 2);
	const partFront: P = [px, yOn(front, px) - 1];
	const big: Guide[] = [];
	for (let i = 0; i <= 5; i++) {
		const f = i / 5; // 0 front … 1 back
		const root = lerpP(partFront, partTop, f);
		const tipY = lerp(84, 66, f);
		const tip: P = [k.cx - k.w - lerp(0, 3, f) - (k.flat ? 0 : 1.5), tipY];
		const lift = k.flat ? 2 : lerp(9, 5, f);
		big.push([root, [root[0] - 8, root[1] - lift], [tip[0] + 18, lerp(70, 54, f) - lift * 0.6], tip]);
	}
	const small: Guide[] = [];
	for (let i = 0; i <= 3; i++) {
		const f = i / 3;
		const root = lerpP(partFront, partTop, f);
		const tip: P = [k.cx + k.w + 1.5, lerp(88, 70, f)];
		small.push([root, [root[0] + 3, root[1] - 4], [tip[0] - 3, tip[1] - 10], tip]);
	}
	const cl = [
		...growClumps(k.c, { guides: small, n: 7, wid: 5, taper: "tip", len: [0.85, 1], start: [0, 0.05], jit: 1 }, k.rng),
		...growClumps(k.c, { guides: big.slice(2), n: 10, wid: 7, taper: "tip", len: [0.8, 1], start: [0, 0.05], jit: 1.4 }, k.rng),
		...growClumps(k.c, { guides: big.slice(0, 4), n: 12, wid: 6.5, taper: "tip", len: [0.82, 1.02], start: [0, 0.05], jit: 1.2, tone: 0.2 }, k.rng),
		...growClumps(k.c, { guides: big.slice(0, 2), n: 5, wid: 5.5, taper: "tip", len: [0.6, 0.95], start: [0, 0.04], jit: 0.8, tone: 0.5 }, k.rng),
	];
	return layers(null, (
		<g>
			{contactShadow(k.c, edge, "sp-cs", 0.3, 5, 2)}
			{clipperSides(k, "sp", reg, hl, { yTop: 80, yBot: 100, dTop: 0.95, dBot: 0.45 })}
			<path d={topD} fill={k.pal.tones[1]} />
			{paintClumps(cl, k.pal, k.rng, "sp-c")}
			{formShade(k.c, "sp-s", topD, 0.7)}
			{/* the part: a fine line of scalp */}
			{!k.flat && <path d={qPath([[partFront[0], partFront[1] + 0.5], lerpP(partFront, partTop, 0.5), partTop], false)} fill="none" stroke={mix(k.pal.scalp, k.c.skin, 0.4)} strokeWidth={0.8} opacity={0.7} strokeLinecap="round" />}
		</g>
	));
};

/** Under headwear the hair lies flat on the scalp. */
const flatT = (k: Kit, T: (u: number) => number) => (k.flat ? (u: number) => Math.min(1.8, T(u)) : T);

// ─── Shared shape for clipper-sided cuts with a longer top ───────────────

interface TopCut {
	hl: Hairline;
	/** Thickness of the top over the skull, u ∈ [−1, 1]. */
	T: (u: number) => number;
	/** Most the sides stand off the skull (clipper length). */
	sideT?: number;
	/** The top ends on the sides at this height. */
	topY?: number;
	/** Clipper fade on the sides. */
	fade: { yTop: number; yBot: number; dTop: number; dBot: number; tint?: [number, number] };
	/** Front edge of the top (default: just above the hairline). */
	edge?: (front: P[]) => P[];
	/** Clump families, given the front hairline, the front edge and the top's outline. */
	locks: (g: { front: P[]; edge: P[]; sil: P[]; hl: P[] }) => Family[];
	/** Lock painting: sheen strength and parting density. */
	sheen?: number;
	partings?: number;
	/** Shadow under the front edge. */
	shadow?: number;
	/** Extra drawing over the top (part lines, a seam). */
	over?: (g: { front: P[]; edge: P[]; sil: P[] }) => ReactNode;
	/** Drawn between the sides and the top (the shadow of a disconnected top). */
	under?: (g: { front: P[]; edge: P[]; sil: P[] }) => ReactNode;
	back?: ReactNode;
	/** Keep the locks inside a smooth outline (groomed cuts). */
	smooth?: boolean;
}

function topCut(k: Kit, key: string, o: TopCut): NatLayers {
	const hl = hairlineFull(k.c, o.hl, k.rng);
	const sideT = o.sideT ?? 2.6;
	const reg = region(k, (u) => Math.max(1.3, Math.min(sideT, o.T(u))), hl);
	const front = frontOf(k, hl, 0.86);
	const uR = k.sk.uAtY(o.topY ?? 80);
	const T = (u: number) => (k.flat ? Math.min(1.8, o.T(u)) : o.T(u));
	const sil = k.sk.shell((u) => T(u) - 1.5, -uR, uR, 30);
	const edge = k.flat ? front.map(([x, y]) => [x, y - 1] as P) : o.edge ? o.edge(front) : front.map(([x, y]) => [x, y - 1.2] as P);
	const topD = qPath([...sil, ...edge.slice().reverse()]);
	const outD = qPath([...k.sk.shell((u) => T(u) + 0.3, -uR, uR, 30), ...edge.slice().reverse()]);
	const g = { front, edge, sil, hl };
	const fams = o.locks(g);
	const cl = fams.flatMap((f) => growClumps(k.c, f, k.rng));
	return layers(o.back ?? null, (
		<g>
			{contactShadow(k.c, edge, `${key}-cs`, o.shadow ?? 0.26, 5, 1.8)}
			{clipperSides(k, key, reg, hl, o.fade)}
			{o.under?.(g)}
			<path d={o.smooth ? outD : topD} fill={k.pal.tones[1]} />
			{o.smooth
				? clipTo(k.c, `${key}-k`, outD, paintClumps(cl, k.pal, k.rng, `${key}-c`, { sheen: o.sheen, partings: o.partings }))
				: paintClumps(cl, k.pal, k.rng, `${key}-c`, { sheen: o.sheen, partings: o.partings })}
			{formShade(k.c, `${key}-s`, o.smooth ? outD : topD, 0.7)}
			{o.smooth && <path d={qPath(k.sk.shell((u) => T(u) + 0.3, -uR, uR, 30), false)} fill="none" stroke={k.pal.line} strokeWidth={0.8} opacity={0.45} />}
			{!k.flat && o.over?.(g)}
		</g>
	));
}

/** Guides from the top (behind the silhouette) forward and down to a fringe line. */
function forwardGuides(k: Kit, T: (u: number) => number, fringe: (x: number) => number, n: number, span = 0.8, uMax = 0.55): Guide[] {
	T = flatT(k, T);
	const gs: Guide[] = [];
	for (let i = 0; i <= n; i++) {
		const a = -1 + (2 * i) / n;
		const u = a * uMax;
		const root = k.sk.at(u, T(u) - 2.5);
		const tx = k.cx + a * k.w * span;
		const tip: P = [tx, fringe(tx)];
		// over the crown, then down the front, slightly fanned
		gs.push([root, [lerp(root[0], tx, 0.55), root[1] - 1], [lerp(root[0], tx, 0.95), lerp(root[1], tip[1], 0.5)], tip]);
	}
	return gs;
}

/** Guides from the front edge straight back over the top (combed back). */
function backGuides(k: Kit, edge: P[], T: (u: number) => number, n: number, o: { span?: number; lift?: number; uMax?: number; sweep?: number } = {}): Guide[] {
	T = flatT(k, T);
	const gs: Guide[] = [];
	const span = o.span ?? 0.84;
	for (let i = 0; i <= n; i++) {
		const a = -1 + (2 * i) / n;
		const x = k.cx + a * k.w * span;
		const y = yOn(edge, x);
		if (!Number.isFinite(y)) continue;
		const u = a * (o.uMax ?? 0.5) + (o.sweep ?? 0);
		const tip = k.sk.at(u, T(u) - 0.5);
		const lift = (o.lift ?? 8) * (k.flat ? 0.15 : 1);
		gs.push([[x, y + 1], [x + (tip[0] - x) * 0.1, y - lift], [tip[0], tip[1] + lift * 0.5], tip]);
	}
	return gs;
}

/** Side hair combed back from the temples (visible strip above the ears). */
function templeGuides(k: Kit, s: 1 | -1, T: (u: number) => number): Guide[] {
	T = flatT(k, T);
	return [0, 1, 2].map((i) => {
		const y0 = 92 - i * 7;
		const root: P = [k.cx + s * (k.w * 0.88 + i * 0.6), y0];
		const u = s * (0.78 - i * 0.12);
		const tip = k.sk.at(u, T(u) - 0.5);
		return [root, [root[0] + s * 1.5, y0 - 6], [tip[0] - s * 0.5, tip[1] + 6], tip] as Guide;
	});
}

const caesar: Cut = (k) => {
	const T = (u: number) => 5.2 - 2.4 * u * u;
	const fr = (x: number) => 78 + 5 * ((x - k.cx) / k.w) ** 4 + Math.sin(x * 1.7) * 0.5;
	return topCut(k, "cs", {
		hl: { y: 70, recess: 2, burn: 104 },
		T,
		fade: { yTop: 74, yBot: 100, dTop: 0.95, dBot: 0.5 },
		edge: (front) => front.map(([x]) => [x, fr(x) - 3.5] as P),
		locks: () => {
			const g = forwardGuides(k, T, fr, 12, 0.84, 0.3);
			// short forward tufts in rows; the front row makes a near-straight, finely broken fringe
			return [0, 0.25, 0.5].map((st, r) => ({ guides: g, n: 22, wid: 4.2 - r * 0.3, taper: "tip" as const, len: [st + 0.5, st + 0.52] as [number, number], start: [st, st + 0.05] as [number, number], jit: 1.3, tone: 0.1 + r * 0.25 }))
				.concat([{ guides: g, n: 26, wid: 3.8, taper: "tip", len: [0.97, 1.02], start: [0.55, 0.62], jit: 1.1, tone: -0.1 }]);
		},
		shadow: 0.34,
	});
};

const frenchCrop: Cut = (k) => {
	const T = (u: number) => 7.5 - 3.5 * u * u;
	const fr = (x: number) => 80 + 3.5 * ((x - k.cx) / k.w) ** 2 + (Math.sin(x * 2.3) + Math.sin(x * 0.9)) * 0.9;
	return topCut(k, "fc", {
		hl: { y: 70, recess: 3, burn: 100, earTop: 96 },
		T,
		sideT: 2,
		topY: 72,
		fade: { yTop: 68, yBot: 92, dTop: 0.92, dBot: 0.02, tint: [0.8, 0] },
		edge: (front) => front.filter(([x]) => Math.abs(x - k.cx) < k.w * 0.8).map(([x]) => [x, fr(x) - 5.5] as P),
		locks: () => {
			const g = forwardGuides(k, T, fr, 11, 0.76, 0.3);
			return [
				{ guides: g, n: 16, wid: 5.2, taper: "tip", len: [0.92, 1.04], start: [0, 0.1], jit: 2.2, tone: -0.1 },
				{ guides: g, n: 16, wid: 4.6, taper: "tip", len: [0.55, 0.85], start: [0, 0.3], jit: 2.4, tone: 0.3 },
				{ guides: g, n: 14, wid: 4, taper: "both", len: [0.4, 0.6], start: [0, 0.2], jit: 2.5, tone: 0.5 },
			];
		},
		shadow: 0.36,
	});
};

const ivy: Cut = (k) => {
	const px = k.cx + k.w * 0.38;
	const T = (u: number) => (u < 0.38 ? 8 - 4 * smoothstep((-u + 0.2) / 0.9) : 5.5 - 2.5 * smoothstep((u - 0.5) / 0.4));
	return topCut(k, "iv", {
		hl: { y: 70, recess: 3, burn: 104 },
		T,
		fade: { yTop: 78, yBot: 100, dTop: 0.95, dBot: 0.45 },
		edge: (front) => front.map(([x, y]) => [x, y - 2.5 * smoothstep((px - x) / (k.w * 0.6)) * smoothstep((x - (k.cx - k.w * 0.85)) / 8)] as P),
		locks: ({ edge }) => {
			const pf: P = [px, yOn(edge, px) - 0.5];
			const pt = k.sk.at(0.28, T(0.28) - 2);
			const big: Guide[] = [0, 0.25, 0.5, 0.75, 1].map((f) => {
				const r = lerpP(pf, pt, f);
				const tip: P = [k.cx - k.w * 0.98 - f * 2, lerp(82, 66, f)];
				return [r, [r[0] - 6, r[1] - (k.flat ? 1 : 7 - f * 2)], [tip[0] + 14, k.flat ? lerp(72, 62, f) : lerp(66, 54, f)], tip];
			});
			const small: Guide[] = [0, 0.5, 1].map((f) => {
				const r = lerpP(pf, pt, f);
				const tip: P = [k.cx + k.w + 1, lerp(86, 72, f)];
				return [r, [r[0] + 3, r[1] - 3], [tip[0] - 3, tip[1] - (k.flat ? 4 : 9)], tip];
			});
			return [
				{ guides: small, n: 6, wid: 4.4, taper: "tip", len: [0.85, 1] },
				{ guides: big, n: 14, wid: 5, taper: "tip", len: [0.8, 1], jit: 1.6 },
				{ guides: big, n: 14, wid: 4, taper: "tip", len: [0.4, 0.7], start: [0, 0.25], jit: 2, tone: 0.4 },
			];
		},
		over: ({ edge }) => <path d={qPath([[px, yOn(edge, px)], [px - 1, 64], k.sk.at(0.28, T(0.28) - 2)], false)} fill="none" stroke={mix(k.pal.scalp, k.c.skin, 0.4)} strokeWidth={0.6} opacity={0.5} />,
	});
};

/** Short back and sides: a soft scissor taper, the top loosely swept to one side. */
const shortBackSides: Cut = (k) => {
	const T = (u: number) => 8 - 3.5 * u * u + (u < 0 ? 1 : 0) * -u * 1.5;
	return topCut(k, "sbs", {
		hl: { y: 70, recess: 2, burn: 106 },
		T,
		sideT: 3.4,
		fade: { yTop: 82, yBot: 102, dTop: 0.98, dBot: 0.75, tint: [0.85, 0.55] },
		edge: (front) => front.map(([x, y]) => [x, y + 1.2 - 2 * smoothstep((x - k.cx) / k.w + 0.2)] as P),
		locks: ({ edge }) => {
			const gs: Guide[] = [];
			for (let i = 0; i <= 8; i++) {
				const a = -1 + i / 4;
				const u = 0.15 + a * 0.45;
				const root = k.sk.at(u, T(u) - 2.5);
				const tx = k.cx + (a * 0.85 - 0.18) * k.w;
				const tip: P = [tx, yOn(edge, tx) + 1.5];
				if (!Number.isFinite(tip[1])) continue;
				gs.push([root, [root[0] - 4, root[1] - 1], [tx + 5, lerp(root[1], tip[1], 0.5) - 3], tip]);
			}
			return [
				...[-1, 1].map((s) => ({ guides: templeGuides(k, s as 1 | -1, T), n: 5, wid: 4.4, taper: "both" as const, len: [0.85, 1] as [number, number], tone: -0.2, jit: 1 })),
				{ guides: gs, n: 18, wid: 6, taper: "tip", len: [0.88, 0.99], jit: 1.6 },
				{ guides: gs, n: 12, wid: 4.4, taper: "tip", len: [0.5, 0.8], start: [0.05, 0.3], jit: 2, tone: 0.4 },
			];
		},
		shadow: 0.32,
	});
};

const slickBack: Cut = (k) => {
	const T = (u: number) => 6.5 - 2.5 * u * u;
	return topCut(k, "sb", {
		hl: { y: 69.5, recess: 4, peak: 1.2, burn: 104 },
		T,
		fade: { yTop: 80, yBot: 100, dTop: 0.95, dBot: 0.5 },
		edge: (front) => front.map(([x, y]) => [x, y - 0.6] as P),
		locks: ({ edge }) => {
			const g = backGuides(k, edge, T, 12, { lift: 5, uMax: 0.42 });
			return [
				...[-1, 1].map((s) => ({ guides: templeGuides(k, s as 1 | -1, T), n: 5, wid: 3.6, taper: "tip" as const, len: [0.9, 1] as [number, number], tone: -0.2 })),
				{ guides: g, n: 22, wid: 4.4, taper: "root", len: [0.97, 1.02], start: [0, 0.04], jit: 0.8, toneVar: 0.4 },
				{ guides: g, n: 10, wid: 3, taper: "both", len: [0.9, 1], start: [0.05, 0.15], jit: 1, tone: 0.8 },
			];
		},
		sheen: 1.6,
		partings: 0.6,
		shadow: 0.18,
	});
};

const brushedBack: Cut = (k) => {
	const T = (u: number) => 10 - 4.5 * u * u;
	return topCut(k, "bb", {
		hl: { y: 70, recess: 3, burn: 105 },
		T,
		sideT: 3,
		fade: { yTop: 80, yBot: 101, dTop: 0.95, dBot: 0.55 },
		edge: (front) => front.map(([x, y]) => [x, y - 1] as P),
		locks: ({ edge }) => {
			const g = backGuides(k, edge, T, 11, { lift: 10, uMax: 0.55 });
			return [
				...[-1, 1].map((s) => ({ guides: templeGuides(k, s as 1 | -1, T), n: 5, wid: 4.4, taper: "tip" as const, len: [0.85, 1] as [number, number], tone: -0.2, jit: 1.2 })),
				{ guides: g, n: 16, wid: 6.2, taper: "root", len: [0.94, 1.03], jit: 1.8, wave: 0.8 },
				{ guides: g, n: 12, wid: 4.4, taper: "both", len: [0.5, 0.85], start: [0.1, 0.3], jit: 2, tone: 0.4, wave: 0.6 },
			];
		},
		shadow: 0.2,
	});
};

/** Low quiff: the front brushed up and back with some lift, short sides. */
const quiff: Cut = (k) => {
	const T = (u: number) => 12 * Math.exp(-((u + 0.05) ** 2) / 0.18) + 4 - 1.5 * u * u;
	return topCut(k, "qf", {
		hl: { y: 70, recess: 3.5, burn: 102 },
		T,
		sideT: 2.2,
		topY: 76,
		fade: { yTop: 72, yBot: 98, dTop: 0.92, dBot: 0.25, tint: [0.8, 0.15] },
		edge: (front) => front.map(([x, y]) => [x, y - 1.5 - 2.5 * Math.exp(-(((x - k.cx) / k.w) ** 2) / 0.12)] as P),
		locks: ({ edge }) => {
			const g = backGuides(k, edge, T, 10, { lift: 16, uMax: 0.5, sweep: 0.08, span: 0.78 });
			return [
				{ guides: g, n: 16, wid: 6, taper: "root", len: [0.95, 1.03], jit: 1.6 },
				{ guides: g.slice(2, 9), n: 10, wid: 4.6, taper: "both", len: [0.55, 0.95], start: [0.05, 0.25], jit: 1.6, tone: 0.5 },
			];
		},
		sheen: 1.2,
		shadow: 0.24,
	});
};

const pompadour: Cut = (k) => {
	const T = (u: number) => 18 * Math.exp(-(u ** 2) / 0.16) + 3.5 - 1.5 * u * u;
	return topCut(k, "pd", {
		hl: { y: 70, recess: 3, burn: 102 },
		T,
		sideT: 2.4,
		topY: 76,
		fade: { yTop: 72, yBot: 98, dTop: 0.92, dBot: 0.3, tint: [0.8, 0.2] },
		edge: (front) => front.map(([x, y]) => [x, y - 3 - 4 * Math.exp(-(((x - k.cx) / k.w) ** 2) / 0.14)] as P),
		locks: ({ edge }) => {
			const g = backGuides(k, edge, T, 10, { lift: 30, uMax: 0.5, span: 0.8 });
			return [
				{ guides: g, n: 16, wid: 7, taper: "root", len: [0.98, 1.02], jit: 0.5, toneVar: 0.25, lit: 0.6 },
				{ guides: g.slice(2, 9), n: 7, wid: 3, taper: "both", len: [0.75, 0.95], start: [0.08, 0.2], jit: 0.6, tone: 1, strands: false },
			];
		},
		sheen: 2,
		partings: 0.25,
		smooth: true,
		shadow: 0.3,
		over: ({ sil }) => <path d={qPath(sil.slice(8, 22), false)} fill="none" stroke={k.pal.sheen} strokeWidth={1.4} opacity={0.35} transform="translate(0 3)" filter={k.c.url("soft1")} />,
	});
};

/** Disconnected undercut: a long top combed back over clippered sides. */
const undercut: Cut = (k) => {
	const T = (u: number) => 10 - 6 * u * u;
	return topCut(k, "uc", {
		hl: { y: 70, recess: 3, burn: 101 },
		T,
		sideT: 1.4,
		topY: 70,
		fade: { yTop: 64, yBot: 98, dTop: 0.8, dBot: 0.55, tint: [0.62, 0.45] },
		edge: (front) => front.filter(([x]) => Math.abs(x - k.cx) < k.w * 0.74).map(([x, y]) => [x, y - 1.5] as P),
		locks: ({ edge }) => {
			const g = backGuides(k, edge, T, 10, { lift: 9, uMax: 0.42, sweep: -0.08, span: 0.72 });
			return [
				{ guides: g, n: 16, wid: 6, taper: "root", len: [0.96, 1.03], jit: 1.4 },
				{ guides: g, n: 10, wid: 4, taper: "both", len: [0.6, 0.9], start: [0.1, 0.25], jit: 1.5, tone: 0.5 },
			];
		},
		under: ({ sil }) => <path d={qPath(sil, false)} fill="none" stroke="#000000" strokeWidth={4} opacity={0.22} filter={k.c.url("soft1")} transform="translate(0.6 1.6)" />,
		sheen: 1.2,
	});
};

/** Receding (Norwood 3): deep temples, a forelock, short sides. */
const receding: Cut = (k) => {
	const T = (u: number) => 5.5 - 2 * u * u;
	return topCut(k, "rc", {
		hl: { y: 70, recess: 11, peak: 1.5, burn: 104, corner: 0.42 },
		T,
		fade: { yTop: 76, yBot: 100, dTop: 0.95, dBot: 0.5 },
		edge: (front) => front.map(([x, y]) => [x, y - 0.6] as P),
		locks: ({ edge }) => {
			const g = backGuides(k, edge.filter(([x]) => Math.abs(x - k.cx) < k.w * 0.5), T, 8, { lift: 5, uMax: 0.35, span: 0.42 });
			return [
				...[-1, 1].map((s) => ({ guides: templeGuides(k, s as 1 | -1, T), n: 5, wid: 3.6, taper: "tip" as const, len: [0.85, 1] as [number, number], tone: -0.2 })),
				{ guides: g, n: 14, wid: 4.4, taper: "root", len: [0.9, 1.02], jit: 1.2 },
				{ guides: g, n: 8, wid: 3.4, taper: "both", len: [0.5, 0.8], start: [0.1, 0.2], jit: 1.2, tone: 0.4 },
			];
		},
		shadow: 0.16,
	});
};

/** Thinning crown (Norwood 6): bald on top, a horseshoe of short hair round the sides and back. */
const horseshoe: Cut = (k) => {
	const hl = hairlineFull(k.c, { y: 70, recess: 0, burn: 104 }, k.rng);
	const u0 = k.sk.uAtY(70), u1 = k.sk.uAtY(95);
	const band = (s: 1 | -1): P[] => {
		const outer = k.sk.shell((u) => 3.6 * smoothstep((Math.abs(u) - u0) / 0.08) + 0.4, s * u0, s * u1, 12);
		const side = hl.filter(([x, y]) => (x - k.cx) * s > k.w * 0.8 && y > 82);
		// inner (top) edge: thin, irregular, going in front of the ear up toward the crown
		const topEdge: P[] = [[k.cx + s * (k.w * 0.85), 86], [k.cx + s * k.w * 0.84, 80], [k.cx + s * k.w * 0.86, 74]];
		return s > 0 ? [...outer, ...side.slice().reverse(), ...topEdge.reverse()] : [...outer.reverse(), ...side, ...topEdge.reverse()];
	};
	const g = (s: 1 | -1): Guide[] => [0, 1, 2, 3].map((i) => {
		const u = s * lerp(u0 + 0.04, u1 - 0.05, i / 3);
		const p = k.sk.at(u, -4);
		const q = k.sk.at(u, 3.2);
		return [p, lerpP(p, q, 0.3), lerpP(p, q, 0.7), [q[0] + s * 0.5, q[1] + 3]] as Guide;
	});
	return layers(null, (
		<g>
			{[-1, 1].map((s) => {
				const reg = band(s as 1 | -1);
				return (
					<g key={s}>
						{clipperSides(k, `hs${s}`, reg, hl, { yTop: 76, yBot: 102, dTop: 0.85, dBot: 0.6, tint: [0.6, 0.5] })}
						{paintClumps(growClumps(k.c, { guides: g(s as 1 | -1), n: 12, wid: 4, taper: "both", len: [0.6, 1], jit: 1.2, tone: -0.2 }, k.rng), k.pal, k.rng, `hsc${s}`, { strands: false })}
					</g>
				);
			})}
			{/* wisps on the crown, a scalp sheen */}
			<path d={`M${k.cx - 8} ${k.top + 2} q4 -3 9 -1 M${k.cx + 2} ${k.top + 1} q4 -2 8 0`} fill="none" stroke={k.pal.tones[2]} strokeWidth={0.5} opacity={0.4} />
			<ellipse cx={k.cx - k.w * 0.3} cy={k.top + 9} rx={k.w * 0.35} ry={7} fill="#ffffff" opacity={0.18} filter={k.c.url("soft2")} />
		</g>
	));
};

/** Modern mullet: a textured top, tapered sides, the back left longer at the nape. */
const mullet: Cut = (k) => {
	const T = (u: number) => 8 - 3 * u * u;
	const fr = (x: number) => 79 + 4 * ((x - k.cx) / k.w) ** 2 + (Math.sin(x * 2.1) + Math.sin(x * 0.7)) * 0.9;
	const nape = (s: 1 | -1): Guide[] => [0, 1, 2].map((i) => {
		const x0 = k.cx + s * (k.w + 1 - i * 4);
		return [[x0, 98], [x0 + s * 4, 118], [x0 + s * 6, 132 + i * 3], [x0 + s * (9 - i), 146 + i * 4]] as Guide;
	});
	const backMass = [-1, 1].map((s) => {
		const X = (f: number) => k.cx + s * f;
		return qPath([[X(k.w - 6), 96], [X(k.w + 3), 98], [X(k.w + 7), 114], [X(k.w + 9), 136], [X(k.w + 6), 148], [X(k.w - 4), 146], [X(k.w - 8), 120]]);
	});
	const backLocks = [-1, 1].flatMap((s) => growClumps(k.c, { guides: nape(s as 1 | -1), n: 9, wid: 8.5, taper: "tip", len: [0.8, 1.04], jit: 2, tone: -0.4, hook: s * 4, wave: 0.8 }, k.rng));
	return topCut(k, "ml", {
		hl: { y: 70, recess: 2, burn: 102 },
		T,
		sideT: 2.4,
		fade: { yTop: 82, yBot: 98, dTop: 0.9, dBot: 0.2, tint: [0.75, 0.2] },
		edge: (front) => front.map(([x]) => [x, fr(x) - 3.5] as P),
		locks: () => {
			const g = forwardGuides(k, T, fr, 11, 0.8, 0.32);
			return [
				{ guides: g, n: 16, wid: 5.6, taper: "tip", len: [0.92, 1.04], jit: 2.4, wave: 0.8 },
				{ guides: g, n: 14, wid: 4.4, taper: "tip", len: [0.5, 0.85], start: [0, 0.2], jit: 2.4, tone: 0.4, wave: 0.6 },
			];
		},
		shadow: 0.34,
		back: k.c.cover === "helmet" ? null : <g>{backMass.map((d, i) => <path key={i} d={d} fill={k.pal.tones[0]} />)}{paintClumps(backLocks, k.pal, k.rng, "ml-b")}</g>,
	});
};

export const SHORT_CUTS: Record<string, Cut> = {
	m_buzz: buzz,
	m_crew: crew,
	m_caesar: caesar,
	m_french_crop: frenchCrop,
	m_ivy: ivy,
	m_short_back_sides: shortBackSides,
	m_side_part: sidePart,
	m_slick_back: slickBack,
	m_brushed_back: brushedBack,
	m_quiff: quiff,
	m_pompadour: pompadour,
	m_undercut: undercut,
	m_receding: receding,
	m_horseshoe: horseshoe,
	m_mullet: mullet,
};
