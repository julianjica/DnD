import type { ReactNode } from "react";
import { mix, shade } from "@/lib/art/color";
import { r1 } from "@/lib/art/rand";
import {
	formShade, growClumps, hairlineFull, lerp, lerpP, linePath, paintClumps, qPath, smoothstep,
	type Family, type Guide, type Hairline, type P,
} from "./hairNatural";
import { clipperSides, frontOf, layers, region, yOn, type Cut } from "./hairNaturalKit";

/** Medium and long cuts that fall and move. */

/** Curtains: a middle part, the front falling to both sides of the forehead. */
const curtains: Cut = (k) => {
	const Tt = (u: number) => (k.flat ? 2 : 10 - 3 * u * u - 3 * smoothstep((Math.abs(u) - 0.7) / 0.3));
	const uR = k.sk.uAtY(104);
	// the base mass stays well inside the locks' tips
	const inner = (s: 1 | -1): P[] => [
		[k.cx + s * 1, 69], [k.cx + s * 7, 71], [k.cx + s * k.w * 0.4, 75], [k.cx + s * k.w * 0.66, 81], [k.cx + s * k.w * 0.84, 90], [k.cx + s * (k.w - 1), 102],
	];
	const base = qPath([...k.sk.shell((u) => Tt(u) - 3.5, -uR, uR, 32), ...inner(1).reverse(), ...inner(-1)]);
	const guides = (s: 1 | -1): Guide[] => {
		const gs: Guide[] = [];
		for (let i = 0; i <= 6; i++) {
			const f = i / 6; // 0 front lock … 1 over the ear
			const root: P = [k.cx + s * 1.2, lerp(k.top - 6, 70, 0.75 - 0.6 * f)];
			const tip: P = [k.cx + s * lerp(k.w * 0.42, k.w + 4, f), lerp(85, 110, f)];
			gs.push([root, [k.cx + s * k.w * lerp(0.25, 0.7, f), lerp(62, k.top - 2, f)], [tip[0] + s * lerp(-2, 2, f), tip[1] - 12], tip]);
		}
		return gs;
	};
	const outer = (s: 1 | -1): Guide[] => [0, 1, 2].map((i) => {
		const o = 1 - i * 0.9;
		return [k.sk.at(s * 0.08, Tt(0) - 1.5 - i * 1.5), k.sk.at(s * 0.45, Tt(0.45) + o), k.sk.at(s * 0.85, Tt(0.85) + o), [k.cx + s * (k.w + 3.5 - i * 1.5), 111 - i * 3]] as Guide;
	});
	const cl = [-1, 1].flatMap((s) => [
		...growClumps(k.c, { guides: outer(s as 1 | -1), n: 6, wid: 7, taper: "tip", len: [0.92, 1.04], start: [0, 0.04], jit: 0.8, tone: -0.2 }, k.rng),
		...growClumps(k.c, { guides: guides(s as 1 | -1), n: 9, wid: 8, taper: "tip", len: [0.9, 1.04], start: [0, 0.04], jit: 1.6, hook: s * 1.5 }, k.rng),
		...growClumps(k.c, { guides: guides(s as 1 | -1).slice(0, 5), n: 7, wid: 6, taper: "tip", len: [0.75, 1], start: [0, 0.04], jit: 1.8, tone: 0.4, hook: s * 2 }, k.rng),
	]);
	const tipEdge = (s: 1 | -1): P[] => [[k.cx + s * 2, 72], [k.cx + s * k.w * 0.42, 84], [k.cx + s * k.w * 0.8, 94], [k.cx + s * (k.w - 1), 106]];
	return layers(null, (
		<g>
			{shadeEdge(k.c, [...tipEdge(-1).reverse(), ...tipEdge(1)], "ct-cs", 0.3, 6, 1.5)}
			<path d={base} fill={k.pal.tones[1]} />
			{paintClumps(cl, k.pal, k.rng, "ct-c")}
			{formShade(k.c, "ct-s", base, 0.6)}
			{!k.flat && <path d={`M${k.cx} ${k.top - Tt(0) + 2} Q${k.cx + 0.5} 62 ${k.cx} 69`} fill="none" stroke={mix(k.pal.scalp, k.c.skin, 0.3)} strokeWidth={1} opacity={0.7} />}
		</g>
	));
};

// ─── Falling hair ───────────────────────────────────────────────────────

/**
 * The shadow hair casts on the skin just below an edge. Like the engine's
 * contactShadow, but the blur's filter region is in user space so nearly flat
 * edges (fringes) don't get their blur clipped into a hard band.
 */
function shadeEdge(c: Kit["c"], edge: P[], key: string, opacity = 0.32, width = 5, dy = 1.6): ReactNode {
	const fid = c.id(`flb-${key}`);
	const d = qPath(edge.map(([x, y]) => [x + 0.8, y + dy] as P), false);
	return (
		<g key={key} clipPath={c.url("headclip")}>
			<filter id={fid} filterUnits="userSpaceOnUse" x={0} y={0} width={200} height={240}><feGaussianBlur stdDeviation={1.6} /></filter>
			<path d={d} fill="none" stroke={shade(c.skin, -0.42)} strokeWidth={width} opacity={opacity} filter={`url(#${fid})`} strokeLinecap="round" />
		</g>
	);
}

/** Paint clump groups in order, so each group's strand lines stay under the groups drawn after it. */
function paintGroups(k: Kit, groups: ReturnType<typeof growClumps>[], key: string): ReactNode {
	return groups.map((g, i) => paintClumps(g, k.pal, k.rng, `${key}${i}`));
}

/** Grow a family whose guides are [left side…, right side…] without interpolating across the face. */
function grow2(k: Kit, gs: Guide[], f: Omit<Family, "guides">): ReturnType<typeof growClumps> {
	const h = gs.length / 2;
	return [...growClumps(k.c, { ...f, guides: gs.slice(0, h), n: Math.ceil(f.n / 2) }, k.rng), ...growClumps(k.c, { ...f, guides: gs.slice(h), n: Math.ceil(f.n / 2) }, k.rng)];
}

type S = 1 | -1;
type Kit = Parameters<Cut>[0];

interface Fall {
	/** Part x (absolute). */
	partX: number;
	/** Volume over the crown. */
	T: (u: number) => number;
	/** Where the side locks end (y) and how far they flare out past the head. */
	yEnd: number;
	flare: number;
	/** How far the face-framing lock sits inside the head edge at its tip. */
	inner?: number;
	/** y where the face-framing lock leaves the forehead. */
	frontY?: number;
	n?: number;
}

/** Guides from the part over the head and down one side: face-framing lock first, outermost last. */
function fallGuides(k: Kit, s: S, o: Fall): Guide[] {
	const gs: Guide[] = [];
	const n = o.n ?? 6;
	const T0 = o.T(0);
	const fy = o.frontY ?? 69;
	for (let i = 0; i <= n; i++) {
		const f = i / n;
		const root: P = [o.partX + s * lerp(1.2, 0.4, f), lerp(fy, k.top - T0 + 2.5, Math.min(1, f * 1.4))];
		const uc = s * lerp(0.42, 0.6, f);
		const c1: P = f < 0.25 ? lerpP([k.cx + s * k.w * 0.5, fy - 3], k.sk.at(uc, o.T(uc) + 1), f * 4) : k.sk.at(uc, o.T(uc) + 1);
		const c2: P = [k.cx + s * lerp(k.w * 0.96, k.w + o.T(s) * 0.9 + 2, f), lerp(88, 106, f)];
		const ty = lerp(o.yEnd - 6, o.yEnd, f);
		// hair reaching the shoulders slides outward along them
		const sh = Math.max(0, ty - 166) * 0.45;
		const tip: P = [k.cx + s * (lerp(k.w - 1 - (o.inner ?? 0), k.w + o.flare, f) + sh), ty];
		gs.push([root, c1, sh > 0 ? [c2[0], c2[1] + (ty - c2[1]) * 0.4] : c2, tip]);
	}
	return gs;
}

/** Locks over the crown that follow the head's outline from the part down the side (cover the top). */
function crownGuides(k: Kit, s: S, o: Fall, yTip = 112): Guide[] {
	const gs: Guide[] = [];
	for (let i = 0; i <= 3; i++) {
		const d = i * 1.1;
		const r = k.sk.at(s * 0.04, o.T(0) - 0.8 - d);
		const ua = s * 0.5, ub = s * 0.92;
		gs.push([[o.partX + (r[0] - k.cx), r[1]], k.sk.at(ua, o.T(ua) + 3.2 - d), k.sk.at(ub, o.T(ub) + 2.6 - d), [k.cx + s * (k.w + o.T(s) * 0.8 + 1 - d), yTip - i * 3]]);
	}
	return gs;
}

/** Base (inset) fill for a falling cut, one side: from the part over the top and down to yEnd, back up along the face. */
function fallBase(k: Kit, s: S, o: Fall): P[] {
	const u1 = k.sk.uAtY(100);
	const top = k.sk.shell((u) => o.T(u) - 2.5, 0, s * u1, 14);
	const w = k.w;
	return [
		...top,
		[k.cx + s * (w + o.T(s) * 0.7), 116],
		[k.cx + s * (w + o.flare * 0.7), o.yEnd - 8],
		[k.cx + s * (w + 1 - (o.inner ?? 0)), o.yEnd - 12],
		[k.cx + s * (w - 2.5 - (o.inner ?? 0)), 112],
		[k.cx + s * w * 0.9, 92],
		[k.cx + s * w * 0.62, 75],
		[o.partX + s * 2, (o.frontY ?? 69) + 0.5],
	];
}

/** The hair hanging behind the neck (back layer): from ear level down to yEnd. */
function backMass(k: Kit, key: string, yEnd: number, wid: number, o: { wave?: number; n?: number } = {}): ReactNode {
	const w = k.w;
	const pts: P[] = [
		[k.cx - w - 2, 96], [k.cx - w - wid * 0.6, 130], [k.cx - w - wid * 0.8, yEnd - 22], [k.cx - w * 0.6, yEnd - 12], [k.cx, yEnd - 10],
		[k.cx + w * 0.6, yEnd - 12], [k.cx + w + wid * 0.8, yEnd - 22], [k.cx + w + wid * 0.6, 130], [k.cx + w + 2, 96],
	];
	const gs: Guide[] = [];
	for (let i = 0; i <= 8; i++) {
		const a = -1 + i / 4;
		const x0 = k.cx + a * (w * 0.8);
		gs.push([[x0, 100], [x0 + a * 6, 130], [k.cx + a * (w + wid * 0.8), yEnd - 18], [k.cx + a * (w + wid * 0.9), yEnd + 2 - Math.abs(a) * 4]]);
	}
	const cl = growClumps(k.c, { guides: gs, n: o.n ?? 22, wid: 7, taper: "tip", len: [0.85, 1.02], start: [0, 0.1], jit: 1.5, tone: -1.6, lit: 0.3, wave: o.wave ?? 0, waves: 1.2 }, k.rng);
	return (
		<g key={key}>
			<path d={qPath(pts)} fill={k.pal.tones[0]} />
			{paintClumps(cl, k.pal, k.rng, `${key}-c`, { strands: false })}
		</g>
	);
}

/** Two little shadows where side hair meets the face. */
function sideShadows(k: Kit, key: string, yA: number, yB: number, inset = 2): ReactNode {
	return [-1, 1].map((s) => shadeEdge(k.c, [[k.cx + s * k.w * 0.7, 74], [k.cx + s * (k.w * 0.92 - inset), 92], [k.cx + s * (k.w - 1 - inset), yA], [k.cx + s * (k.w - 3 - inset), yB]], `${key}${s}`, 0.3, 5, 0.6));
}

const flatT = (k: Kit, T: (u: number) => number) => (k.flat ? (u: number) => Math.min(2.2, T(u)) : T);

// ─── Long and medium cuts ───────────────────────────────────────────────

/** Shoulder length, loose, a soft middle-ish part. */
const shoulder: Cut = (k) => {
	const T = flatT(k, (u) => 8 - 2 * u * u);
	const o: Fall = { partX: k.cx + k.w * 0.12, T, yEnd: 172, flare: 9, inner: 1, n: 7 };
	const cl = ([-1, 1] as S[]).flatMap((s) => [
		...growClumps(k.c, { guides: crownGuides(k, s, o), n: 5, wid: 7, taper: "tip", len: [0.9, 1.02], start: [0, 0.03], jit: 0.8, tone: -0.3 }, k.rng),
		...growClumps(k.c, { guides: fallGuides(k, s, o), n: 13, wid: 8.5, taper: "tip", len: [0.86, 1.03], start: [0, 0.04], jit: 1.6, wave: 1.2, waves: 1.1 }, k.rng),
		...growClumps(k.c, { guides: fallGuides(k, s, o).slice(0, 4), n: 6, wid: 6, taper: "tip", len: [0.6, 0.95], start: [0, 0.04], jit: 1.4, tone: 0.5, wave: 1, waves: 1 }, k.rng),
	]);
	const base = qPath([...fallBase(k, -1, o).reverse(), ...fallBase(k, 1, o)]);
	return layers(backMass(k, "sh-b", 168, 9), (
		<g>
			{sideShadows(k, "sh-ss", 120, 150)}
			<path d={base} fill={k.pal.tones[1]} />
			{paintClumps(cl, k.pal, k.rng, "sh-c")}
			{formShade(k.c, "sh-s", base, 0.5)}
			{!k.flat && <path d={`M${r1(o.partX)} ${r1(k.top - T(0) + 3)} Q${r1(o.partX + 0.5)} 63 ${r1(o.partX)} 69.5`} fill="none" stroke={mix(k.pal.scalp, k.c.skin, 0.3)} strokeWidth={0.9} opacity={0.7} />}
		</g>
	));
};

/** Long and loose, past the shoulders, a few locks falling in front. */
const long: Cut = (k) => {
	const T = flatT(k, (u) => 7.5 - 2 * u * u);
	const o: Fall = { partX: k.cx, T, yEnd: 196, flare: 12, inner: 1.5, n: 7 };
	const cl = ([-1, 1] as S[]).flatMap((s) => [
		...growClumps(k.c, { guides: crownGuides(k, s, o), n: 5, wid: 7, taper: "tip", len: [0.9, 1.02], start: [0, 0.03], jit: 0.8, tone: -0.3 }, k.rng),
		...growClumps(k.c, { guides: fallGuides(k, s, o), n: 13, wid: 8.5, taper: "tip", len: [0.84, 1.03], start: [0, 0.04], jit: 1.6, wave: 1.4, waves: 1.3 }, k.rng),
		...growClumps(k.c, { guides: fallGuides(k, s, o).slice(0, 4), n: 6, wid: 6, taper: "tip", len: [0.55, 0.9], start: [0, 0.04], jit: 1.4, tone: 0.5, wave: 1, waves: 1 }, k.rng),
	]);
	const base = qPath([...fallBase(k, -1, o).reverse(), ...fallBase(k, 1, o)]);
	return layers(backMass(k, "lg-b", 210, 13, { wave: 1 }), (
		<g>
			{sideShadows(k, "lg-ss", 120, 150)}
			<path d={base} fill={k.pal.tones[1]} />
			{paintClumps(cl, k.pal, k.rng, "lg-c")}
			{formShade(k.c, "lg-s", base, 0.5)}
			{!k.flat && <path d={`M${k.cx} ${r1(k.top - T(0) + 3)} Q${k.cx + 0.5} 63 ${k.cx} 69.5`} fill="none" stroke={mix(k.pal.scalp, k.c.skin, 0.3)} strokeWidth={0.9} opacity={0.7} />}
		</g>
	));
};

/** Guides from the crown forward and down onto the forehead: a fringe whose tips sit on `tipY(x)`. */
function fringeGuides(k: Kit, T: (u: number) => number, n: number, tipY: (a: number) => number, o: { span?: number; lean?: number; spread?: number } = {}): Guide[] {
	const gs: Guide[] = [];
	const span = o.span ?? 0.92;
	for (let i = 0; i <= n; i++) {
		const a = -1 + (2 * i) / n;
		const u = a * 0.45;
		const r = k.sk.at(u, T(u) - 4.5);
		const tx = k.cx + a * k.w * span + (o.lean ?? 0) * k.w * (1 - a * a * 0.5);
		const ty = tipY(a);
		const mid = k.sk.at(a * 0.72, T(a * 0.72) + 1.2);
		gs.push([r, [lerp(r[0], mid[0], 0.8), mid[1] - 1], [tx + (tx - k.cx) * (o.spread ?? 0.08), lerp(mid[1], ty, 0.55)], [tx, ty]]);
	}
	return gs;
}

/** Hair combed back from the hairline over the top and behind the ears. */
function backGuides(k: Kit, hl: P[], T: (u: number) => number, n: number): Guide[] {
	const front = frontOf(k, hl, 0.9);
	const gs: Guide[] = [];
	for (let i = 0; i <= n; i++) {
		const a = -1 + (2 * i) / n;
		const x = k.cx + a * k.w * 0.86;
		const y = yOn(front, x);
		if (!Number.isFinite(y)) continue;
		if (Math.abs(a) > 0.8) continue;
		const u = a * 0.62;
		// up off the forehead, over the curve of the head, ending along the outline
		const over = k.sk.at(u, T(u) + 1.5);
		const tip = k.sk.at(u * 1.45 + a * 0.12, T(u * 1.45) - 0.5);
		gs.push([[x, y + 0.4], [x + a * 1.2, y - 6], over, tip]);
	}
	return gs;
}

/** Hair line where hair is pulled back off the forehead: soft edge and contact shadow. */
function hairlineSoft(k: Kit, key: string, hl: P[]): ReactNode {
	const front = frontOf(k, hl, 0.95);
	return shadeEdge(k.c, front, key, 0.18, 3, 0.8);
}

/** Chin-length, combed back and tucked behind the ears. */
const tucked: Cut = (k) => {
	const T = flatT(k, (u) => 7.5 - 2.5 * u * u);
	const hlP: Hairline = { y: 70, recess: 2.5, peak: 1, burn: 104, earTop: 97 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	const reg = region(k, (u) => Math.min(T(u), 4) * 0.9 + 1, hl);
	const g = backGuides(k, hl, T, 12);
	const cl = [
		...growClumps(k.c, { guides: g, n: 22, wid: 6.5, taper: "both", len: [0.92, 1.02], start: [0, 0.04], jit: 1.3, wave: 0.6 }, k.rng),
		...growClumps(k.c, { guides: g.slice(2, -2), n: 10, wid: 5, taper: "both", len: [0.6, 0.95], start: [0.05, 0.2], jit: 1.6, tone: 0.5 }, k.rng),
	];
	// behind the ears: hanging to the jaw, flicking out a little
	// behind the ears: visible past the ear and below it, hanging beside the jaw
	const hang: Guide[] = ([-1, 1] as S[]).flatMap((s) => [0, 1, 2, 3, 4].map((i) => [[k.cx + s * (k.w + 1 + i * 1.2), 96 + i], [k.cx + s * (k.w + 8 + i * 0.3), 112], [k.cx + s * (k.w + 3 - i * 2), 136], [k.cx + s * (k.w - 3 - i * 2.2 + (i === 0 ? 10 : 0)), 150 + (i % 2) * 2]] as Guide));
	const hc = grow2(k, hang, { n: 22, wid: 7, taper: "tip", len: [0.84, 1.02], start: [0, 0.05], jit: 1.2, wave: 0.6, tone: -0.7, lit: 0.6 });
	const hangBase = ([-1, 1] as S[]).map((s) => qPath([[k.cx + s * (k.w - 1), 94], [k.cx + s * (k.w + 8), 106], [k.cx + s * (k.w + 8), 126], [k.cx + s * (k.w + 2), 144], [k.cx + s * (k.w - 10), 146], [k.cx + s * (k.w - 6), 120]]));
	const regD = linePath(reg);
	return layers(
		<g>{hangBase.map((d, i) => <path key={i} d={d} fill={k.pal.tones[0]} />)}{paintClumps(hc, k.pal, k.rng, "tk-h")}</g>,
		(
			<g>
				{hairlineSoft(k, "tk-cs", hl)}
				<path d={regD} fill={k.pal.tones[1]} />
				{clipperSides(k, "tk-f", reg, hl, { yTop: 60, yBot: 100, dTop: 0.6, dBot: 0.5, tint: [0.4, 0.4] })}
				{paintClumps(cl, k.pal, k.rng, "tk-c")}
				{formShade(k.c, "tk-s", regD, 0.6)}
			</g>
		),
	);
};

/** Pulled back into a bun at the crown. */
const manBun: Cut = (k) => {
	const T = flatT(k, (u) => 4.5 - 2 * u * u);
	const hlP: Hairline = { y: 70, recess: 2, burn: 104, earTop: 97 };
	const hl = hairlineFull(k.c, hlP, k.rng);
	const reg = region(k, (u) => T(u), hl);
	const regD = linePath(reg);
	const g = backGuides(k, hl, T, 12).map((gd) => {
		// everything converges on the bun
		const tip = gd[3];
		return Math.abs(tip[0] - k.cx) > k.w ? gd : ([gd[0], gd[1], [lerp(gd[2][0], k.cx, 0.4), gd[2][1]], [lerp(tip[0], k.cx, 0.55), tip[1] + 1]] as Guide);
	});
	const cl = growClumps(k.c, { guides: g, n: 26, wid: 5.5, taper: "both", len: [0.92, 1.02], start: [0, 0.04], jit: 1, tone: 0.2 }, k.rng);
	const by = k.top - T(0) - 0.5;
	const bun = k.flat ? null : (() => {
		const sw: Guide[] = [0, 1, 2, 3, 4].map((i) => {
			const a0 = (i / 5) * Math.PI * 2;
			const pt = (a: number, r: number): P => [k.cx + Math.cos(a) * r * 1.25, by + Math.sin(a) * r];
			return [pt(a0, 6.5), pt(a0 + 1, 7.5), pt(a0 + 2, 5), pt(a0 + 2.8, 2)];
		});
		const bc = growClumps(k.c, { guides: sw, n: 7, wid: 5, taper: "both", len: [0.85, 1], start: [0, 0.05], jit: 0.6 }, k.rng);
		return (
			<g>
				<ellipse cx={k.cx} cy={by} rx={10} ry={7.5} fill={k.pal.tones[1]} stroke={k.pal.line} strokeWidth={0.7} strokeOpacity={0.5} />
				{paintClumps(bc, k.pal, k.rng, "mb-bc", { strands: false })}
			</g>
		);
	})();
	return layers(null, (
		<g>
			{bun}
			{hairlineSoft(k, "mb-cs", hl)}
			<path d={regD} fill={k.pal.tones[1]} />
			{clipperSides(k, "mb-f", reg, hl, { yTop: 60, yBot: 100, dTop: 0.6, dBot: 0.55, tint: [0.4, 0.45] })}
			{paintClumps(cl, k.pal, k.rng, "mb-c")}
			{formShade(k.c, "mb-s", regD, 0.6)}
			{!k.flat && <path d={`M${k.cx - 5} ${r1(by + 6.5)} Q${k.cx} ${r1(by + 8.5)} ${k.cx + 5} ${r1(by + 6.5)}`} stroke={k.pal.tones[0]} strokeWidth={1.4} fill="none" opacity={0.8} />}
		</g>
	));
};

/** Wavy, ear length, side part on his right (viewer's left). */
const wavy: Cut = (k) => {
	const T = flatT(k, (u) => 10 - 2.5 * u * u + (u > 0 ? 1.5 : 0));
	const o: Fall = { partX: k.cx - k.w * 0.42, T, yEnd: 118, flare: 6, inner: 0, n: 7, frontY: 70 };
	const cl = ([-1, 1] as S[]).flatMap((s) => [
		...growClumps(k.c, { guides: crownGuides(k, s, { ...o, T: (u) => T(u) - 2 }, 114), n: s === 1 ? 9 : 4, wid: 7, taper: "tip", len: [0.9, 1.04], start: [0, 0.03], jit: 1.2, tone: 0.1, wave: 2.4, waves: 1.8 }, k.rng),
		...growClumps(k.c, { guides: fallGuides(k, s, o), n: s === 1 ? 14 : 8, wid: 8, taper: "tip", len: [0.86, 1.05], start: [0, 0.04], jit: 1.6, wave: 3.4, waves: 2.1, hook: s * 2 }, k.rng),
		...growClumps(k.c, { guides: fallGuides(k, s, o).slice(0, 4), n: s === 1 ? 7 : 3, wid: 6, taper: "tip", len: [0.55, 0.9], start: [0, 0.04], jit: 1.4, tone: 0.6, wave: 3, waves: 2 }, k.rng),
	]);
	// the big side: hair swept from the part over the top toward his left
	const sweep: Guide[] = [0, 1, 2, 3].map((i) => {
		const y0 = k.top - T(0) + 3 + i * 3;
		return [[o.partX + 1, y0 + 2], [k.cx + k.w * 0.1, y0 - 3], [k.cx + k.w * 0.75, y0 + 2 + i], [k.cx + k.w + 3 - i, 84 + i * 5]] as Guide;
	});
	const sw = growClumps(k.c, { guides: sweep, n: 9, wid: 7.5, taper: "tip", len: [0.85, 1.03], start: [0, 0.04], jit: 1.4, wave: 2.4, waves: 1.6, tone: 0.1 }, k.rng);
	const ob: Fall = { ...o, T: (u) => T(u) - 2.5 };
	const base = qPath([...fallBase(k, -1, ob).reverse(), ...fallBase(k, 1, ob)]);
	return layers(null, (
		<g>
			{sideShadows(k, "wv-ss", 106, 116)}
			{shadeEdge(k.c, [[k.cx - k.w * 0.4, 71], [k.cx, 74], [k.cx + k.w * 0.6, 80]], "wv-cs", 0.3, 5, 1.5)}
			<path d={base} fill={k.pal.tones[1]} />
			{paintGroups(k, [sw, cl], "wv-c")}
			{formShade(k.c, "wv-s", base, 0.6)}
			{!k.flat && <path d={`M${r1(o.partX)} ${r1(k.top - T(-0.42) + 3)} Q${r1(o.partX - 0.5)} 64 ${r1(o.partX + 0.5)} 70.5`} fill="none" stroke={mix(k.pal.scalp, k.c.skin, 0.3)} strokeWidth={0.9} opacity={0.7} />}
		</g>
	));
};

/** Messy fringe: textured top pushed forward into an uneven fringe; sides over the ear tops. */
const messyFringe: Cut = (k) => {
	const T = flatT(k, (u) => 9.5 - 3 * u * u);
	const uR = k.sk.uAtY(102);
	const sil = k.sk.shell((u) => T(u) - 3, -uR, uR, 30);
	const tipY = (a: number) => 84.5 + 5 * a * a + 2 * Math.sin(a * 9.3);
	const rimO: Fall = { partX: k.cx, T, yEnd: 104, flare: 2 };
	const base = qPath([...sil, ...Array.from({ length: 9 }, (_, i) => { const a = 1 - i / 4; return [k.cx + a * k.w * 0.9, tipY(a) - 6] as P; })]);
	const fg = fringeGuides(k, T, 10, tipY, { span: 0.9, lean: -0.08 });
	const sides: Guide[] = ([-1, 1] as S[]).flatMap((s) => [0, 1, 2].map((i) => [k.sk.at(s * (0.35 + i * 0.1), T(0.4) - 2), k.sk.at(s * (0.7 + i * 0.05), T(0.8) + 2), [k.cx + s * (k.w + 4 - i), 96 + i * 3], [k.cx + s * (k.w + 2.5 - i * 1.5), 106 + i * 2]] as Guide));
	const cl = [
		...grow2(k, sides, { n: 10, wid: 6.5, taper: "tip", len: [0.88, 1.04], start: [0, 0.05], jit: 1.4, tone: -0.2 }),
		...([-1, 1] as S[]).flatMap((s) => growClumps(k.c, { guides: crownGuides(k, s, rimO, 102), n: 4, wid: 7.5, taper: "tip", len: [0.9, 1.02], start: [0, 0.03], jit: 0.8, tone: -0.1, hook: s * 1.5 }, k.rng)),
		...growClumps(k.c, { guides: fg, n: 13, wid: 8.5, taper: "tip", len: [0.86, 1.03], start: [0, 0.05], jit: 1.8, hook: 2, wave: 0.6, waves: 0.8 }, k.rng),
		...growClumps(k.c, { guides: fg, n: 7, wid: 6, taper: "tip", len: [0.65, 0.98], start: [0.05, 0.2], jit: 1.8, tone: 0.7, hook: -2 }, k.rng),
	];
	const edge = Array.from({ length: 9 }, (_, i) => { const a = -1 + i / 4; return [k.cx + a * k.w * 0.9, tipY(a)] as P; });
	return layers(null, (
		<g>
			{shadeEdge(k.c, edge, "mf-cs", 0.32, 6, 1.4)}
			<path d={base} fill={k.pal.tones[1]} />
			{paintClumps(cl, k.pal, k.rng, "mf-c")}
			{formShade(k.c, "mf-s", base, 0.6)}
		</g>
	));
};

/** Tousled bedhead: volume, locks going every way. */
const bedhead: Cut = (k) => {
	const T = flatT(k, (u) => 12 - 3.5 * u * u);
	const uR = k.sk.uAtY(102);
	const sil = k.sk.shell((u) => T(u) - 3.5, -uR, uR, 30);
	const tipY = (a: number) => 79 + 6 * a * a + 3.5 * Math.sin(a * 7.1 + 1);
	const base = qPath([...sil, ...Array.from({ length: 9 }, (_, i) => { const a = 1 - i / 4; return [k.cx + a * k.w * 0.9, tipY(a) - 7] as P; })]);
	const fg = fringeGuides(k, T, 9, tipY, { span: 0.85, lean: 0.1, spread: 0.2 });
	// tufts standing up and out at the crown
	const up: Guide[] = [];
	for (let i = 0; i <= 8; i++) {
		const a = -1 + i / 4;
		const r = k.sk.at(a * 0.75, T(a * 0.75) - 5);
		const t = k.sk.at(a * 0.85 + 0.08, T(a * 0.85) + 3);
		up.push([r, [r[0] + a * 2, r[1] - 3], [t[0] - a * 2, t[1] + 2], t]);
	}
	const sides: Guide[] = ([-1, 1] as S[]).flatMap((s) => [0, 1, 2].map((i) => [k.sk.at(s * (0.45 + i * 0.1), T(0.5) - 3), k.sk.at(s * (0.75 + i * 0.05), T(0.8) + 2.5), [k.cx + s * (k.w + 6 - i), 98 + i * 3], [k.cx + s * (k.w + 4 + i), 106 + i * 2]] as Guide));
	const cl = [
		...grow2(k, sides, { n: 10, wid: 7, taper: "tip", len: [0.86, 1.06], start: [0, 0.05], jit: 1.8, tone: -0.2, hook: 2 }),
		...growClumps(k.c, { guides: up, n: 14, wid: 7, taper: "tip", len: [0.8, 1.06], start: [0, 0.1], jit: 2.5, tone: 0.2, hook: 2.5 }, k.rng),
		...growClumps(k.c, { guides: fg, n: 14, wid: 7, taper: "tip", len: [0.8, 1.02], start: [0, 0.05], jit: 2.2, hook: 3, wave: 1, waves: 1 }, k.rng),
		...growClumps(k.c, { guides: fg, n: 8, wid: 5, taper: "tip", len: [0.5, 0.9], start: [0.05, 0.25], jit: 3, tone: 0.7, hook: -3 }, k.rng),
	];
	const edge = Array.from({ length: 9 }, (_, i) => { const a = -1 + i / 4; return [k.cx + a * k.w * 0.85, tipY(a)] as P; });
	return layers(null, (
		<g>
			{shadeEdge(k.c, edge, "bh-cs", 0.32, 6, 1.4)}
			<path d={base} fill={k.pal.tones[1]} />
			{paintClumps(cl, k.pal, k.rng, "bh-c")}
			{formShade(k.c, "bh-s", base, 0.6)}
		</g>
	));
};

/** Mod / bowl: round, full fringe to the brows, ears half covered. */
const mod: Cut = (k) => {
	const T = flatT(k, (u) => 9 - 1.5 * u * u);
	const uR = k.sk.uAtY(110);
	const sil = k.sk.shell((u) => T(u) - 2.5, -uR, uR, 30);
	const tipY = (a: number) => 90 + 3 * a * a * a * a + 0.8 * Math.sin(a * 11);
	const fl: P[] = Array.from({ length: 9 }, (_, i) => { const a = 1 - i / 4; return [k.cx + a * k.w * 0.92, tipY(a) - 1.8] as P; });
	const base = qPath([...sil, [k.cx + k.w + 2, 112], ...fl, [k.cx - k.w - 2, 112]]);
	const fg = fringeGuides(k, T, 10, tipY, { span: 0.9, spread: 0.02 });
	const sides: Guide[] = ([-1, 1] as S[]).flatMap((s) => [0, 1, 2, 3].map((i) => [k.sk.at(s * (0.3 + i * 0.08), T(0.3) - 1.5 - i * 0.4), k.sk.at(s * (0.72 + i * 0.04), T(0.7) + 2.5 - i * 0.4), [k.cx + s * (k.w + 5 - i * 1.2), 100], [k.cx + s * (k.w + 3 - i * 1.6), 113 - i]] as Guide));
	const cl = [
		...grow2(k, sides, { n: 14, wid: 7, taper: "blunt", len: [0.94, 1.02], start: [0, 0.05], jit: 1, tone: -0.1 }),
		...growClumps(k.c, { guides: fg, n: 22, wid: 6.5, taper: "blunt", len: [0.96, 1.01], start: [0, 0.05], jit: 0.7 }, k.rng),
		...growClumps(k.c, { guides: fg, n: 8, wid: 5, taper: "tip", len: [0.6, 0.9], start: [0.05, 0.2], jit: 0.9, tone: 0.8 }, k.rng),
	];
	const edge = Array.from({ length: 9 }, (_, i) => { const a = -1 + i / 4; return [k.cx + a * k.w * 0.92, tipY(a)] as P; });
	return layers(null, (
		<g>
			{shadeEdge(k.c, edge, "md-cs", 0.36, 6, 1.6)}
			<path d={base} fill={k.pal.tones[1]} />
			{paintClumps(cl, k.pal, k.rng, "md-c")}
			{formShade(k.c, "md-s", base, 0.6)}
		</g>
	));
};

/** Shag: layered and choppy, wispy middle-ish part, flicks out at the neck. */
const shag: Cut = (k) => {
	const T = flatT(k, (u) => 12 - 3 * u * u);
	const o: Fall = { partX: k.cx + 3, T, yEnd: 146, flare: 12, inner: 3, n: 7, frontY: 72 };
	const crown = ([-1, 1] as S[]).flatMap((s) => growClumps(k.c, { guides: crownGuides(k, s, o, 112), n: 6, wid: 7.5, taper: "tip", len: [0.6, 1.0], start: [0, 0.03], jit: 1.6, tone: -0.2, hook: s * 3 }, k.rng));
	const cl = ([-1, 1] as S[]).flatMap((s) => [
		...growClumps(k.c, { guides: fallGuides(k, s, o), n: 13, wid: 8, taper: "tip", len: [0.8, 1.04], start: [0, 0.04], jit: 2, wave: 1.6, waves: 1.3, hook: s * 7 }, k.rng),
		// short layers ending at different heights: the choppy shag texture
		...growClumps(k.c, { guides: fallGuides(k, s, o), n: 9, wid: 6.5, taper: "tip", len: [0.4, 0.68], start: [0, 0.05], jit: 2.2, tone: 0.5, hook: s * 3 }, k.rng),
		...growClumps(k.c, { guides: fallGuides(k, s, o).slice(0, 3), n: 5, wid: 5.5, taper: "tip", len: [0.35, 0.55], start: [0, 0.04], jit: 1.6, tone: 0.8, hook: s * 2 }, k.rng),
	]);
	// wispy curtain fringe over the forehead
	const fg = fringeGuides(k, T, 8, (a) => 82 + 9 * a * a + 2 * Math.sin(a * 13), { span: 0.75, spread: 0.25 });
	const fringe = (growClumps(k.c, { guides: fg, n: 9, wid: 6.5, taper: "tip", len: [0.82, 1.02], start: [0.05, 0.12], jit: 1.4, hook: 1.2, tone: 0.3 }, k.rng));
	const base = qPath([...fallBase(k, -1, o).reverse(), ...fallBase(k, 1, o)]);
	return layers(backMass(k, "sg-b", 150, 10, { wave: 1.2 }), (
		<g>
			{sideShadows(k, "sg-ss", 112, 140, 3)}
			<path d={base} fill={k.pal.tones[1]} />
			{paintGroups(k, [fringe, crown, cl], "sg-c")}
			{formShade(k.c, "sg-s", base, 0.6)}
		</g>
	));
};

export const FLOW_CUTS: Record<string, Cut> = {
	m_curtains: curtains,
	m_messy_fringe: messyFringe,
	m_bedhead: bedhead,
	m_mod: mod,
	m_shag: shag,
	m_tucked: tucked,
	m_shoulder: shoulder,
	m_long: long,
	m_man_bun: manBun,
	m_wavy: wavy,
};
