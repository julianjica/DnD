import type { ReactNode } from "react";
import { mix } from "@/lib/art/color";
import { r1, smoothPath } from "@/lib/art/rand";

/**
 * Men's cuts for the SVG portrait (buzz, undercut, quiff, slicked back,
 * receding, dreadlocks, cornrows, curtains, spiky, flat top). Kept apart from
 * Portrait.tsx so the older styles' drawing (and their seeded draws) stays
 * untouched. Same conventions: light from the upper left, the shared hair
 * gradient, a thin dark outline, strand texture clipped to the hair mass.
 */

type P = [number, number];

export interface MenHairCtx {
	cx: number;
	/** Head half-width. */
	w: number;
	/** Top of the skull. */
	top: number;
	/** Under a modern hat: anything standing above the scalp is hidden. */
	hatted: boolean;
	skin: string;
	hair: string;
	hairHi: string;
	hairLo: string;
	hairLine: string;
	id: (s: string) => string;
	url: (s: string) => string;
}

export interface MenHairLayers {
	/** Behind the head and clothes (locs falling down the back). */
	back: ReactNode;
	/** The hair on the head (hidden under a hood or helmet). */
	front: ReactNode;
	/** Over the face and ears, always drawn (locs over the shoulders). */
	extra: ReactNode;
	/** Hair too short or too high to cast a shadow on the forehead. */
	noBrowShadow?: boolean;
}

const SIDES = [-1, 1] as const;

export function menHair(style: string, c: MenHairCtx): MenHairLayers | null {
	const { cx: CX, w, top, hatted, skin, hair, hairHi, hairLo, hairLine, id, url } = c;
	const hw = w + 5;
	const stroke = { stroke: hairLine, strokeWidth: 1.2, strokeLinejoin: "round" as const };

	const hairline = (dip: number, part = 0): P[] => [
		[CX + w - 2, 98], [CX + w * 0.7 + part * 0.3, 86 + dip * 0.5], [CX + part + 6, 79 + dip], [CX + part, 75 + dip], [CX + part - 6, 79 + dip], [CX - w * 0.7 + part * 0.3, 86 + dip * 0.5], [CX - w + 2, 98],
	];
	/** The hair cap: crown height `v`, sides `out` from the centre down to `bottom`. */
	const cap = (dip: number, v: number, out = hw, bottom = 112): P[] => [
		[CX, top - v], [CX + w * 0.72, top - v * 0.6 + 2], [CX + out, top + 26], [CX + out - 1, bottom],
		[CX + w - 3, bottom - 2], ...hairline(dip), [CX - w + 3, bottom - 2],
		[CX - out + 1, bottom], [CX - out, top + 26], [CX - w * 0.72, top - v * 0.6 + 2],
	];
	/** A hair mass: gradient fill, outline, and texture/highlight clipped inside it. */
	const mass = (d: string, key: string, texture: ReactNode, hi: ReactNode = <ellipse cx={CX - w * 0.35} cy={top + 4} rx={w * 0.42} ry={7} fill={hairHi} opacity={0.35} filter={url("soft2")} />) => (
		<g key={key}>
			<clipPath id={id(`mh-${key}`)}><path d={d} /></clipPath>
			<path d={d} fill={url("hair")} {...stroke} />
			<g clipPath={url(`mh-${key}`)}>
				{texture}
				{hi}
			</g>
		</g>
	);
	/** Clipper-short hair: the scalp shows through a speckled tint. */
	const fuzz = (d: string, key: string, k = 1) => (
		<g key={key}>
			<clipPath id={id(`fz-${key}`)}><path d={d} /></clipPath>
			<g clipPath={url(`fz-${key}`)}>
				<path d={d} fill={mix(hair, skin, 0.3)} opacity={0.62 * k} />
				<path d={d} fill={hairLo} opacity={0.75 * k} filter={url("grain")} />
				<ellipse cx={CX - w * 0.4} cy={top + 8} rx={w * 0.38} ry={8} fill={hairHi} opacity={0.18 * k} filter={url("soft2")} />
			</g>
			<path d={d} fill="none" stroke={hairLine} strokeWidth={0.6} opacity={0.35 * k} />
		</g>
	);
	/** Lines along quadratic curves. */
	const lines = (ds: string[], key: string, width = 1.2, op = 0.5) => (
		<g key={key} fill="none" strokeLinecap="round">
			{ds.map((d, i) => <path key={i} d={d} stroke={i % 3 === 0 ? hairHi : hairLo} strokeWidth={i % 3 === 0 ? width * 0.85 : width} opacity={i % 3 === 0 ? op + 0.1 : op} />)}
		</g>
	);
	const q = (a: P, ctl: P, b: P) => `M${r1(a[0])} ${r1(a[1])} Q${r1(ctl[0])} ${r1(ctl[1])} ${r1(b[0])} ${r1(b[1])}`;
	/** Short cut used for the tall styles under a hat: only the sides show. */
	const underHat = (key: string) => ({ back: null, front: mass(smoothPath(cap(-2, 4, w + 3, 100)), key, null), extra: null });

	switch (style) {
		case "buzz": {
			const d = smoothPath(cap(-1, 1.5, w + 1.6, 101));
			return { back: null, front: fuzz(d, "buzz", 1.15), extra: null, noBrowShadow: true };
		}

		case "undercut": {
			const sides = fuzz(smoothPath(cap(-2, 1, w + 1.6, 101)), "uc-sides", 0.85);
			if (hatted) return { back: null, front: sides, extra: null };
			const topPts: P[] = [
				[CX + 2, top - 11], [CX + w * 0.56, top - 8], [CX + w * 0.78, top + 6], [CX + w * 0.74, 83], [CX + w * 0.5, 77], [CX + w * 0.2, 71.5], [CX + 2, 71],
				[CX - w * 0.2, 71.5], [CX - w * 0.5, 76.5], [CX - w * 0.74, 83], [CX - w * 0.78, top + 6], [CX - w * 0.54, top - 8],
			];
			const d = smoothPath(topPts);
			const sweep = Array.from({ length: 13 }, (_, k) => {
				const a = -0.78 + (1.56 * k) / 12;
				const x0 = CX + a * w;
				const y0 = 72 + Math.abs(a) ** 2 * 14;
				return q([x0, y0], [x0 + a * w * 0.12, top - 1], [CX + a * w * 0.42, top - 13]);
			});
			return {
				back: null,
				front: (
					<g>
						{sides}
						{/* the shadow the longer top casts on the clipped sides (undercut) */}
						{SIDES.map((s) => <path key={s} d={`M${CX + s * w * 0.8} ${top + 8} Q${CX + s * w * 0.84} 76 ${CX + s * w * 0.72} 85`} stroke="#000" strokeWidth={3} opacity={0.18} fill="none" filter={url("soft1")} />)}
						{mass(d, "uc-top", lines(sweep, "uc-l", 1.3, 0.55), <g><ellipse cx={CX - w * 0.3} cy={top - 4} rx={w * 0.4} ry={7} fill={hairHi} opacity={0.4} filter={url("soft2")} /><path d={`M${CX - w * 0.6} 79 Q${CX} 64 ${CX + w * 0.6} 79`} stroke={hairHi} strokeWidth={2.5} fill="none" opacity={0.35} filter={url("soft1")} /></g>)}
					</g>
				),
				extra: null,
			};
		}

		case "quiff": {
			if (hatted) return underHat("qf-hat");
			const sides = smoothPath(cap(-2, 2, w + 2.5, 101));
			const quiffPts: P[] = [
				[CX - w * 0.64, 83], [CX - w * 0.7, top + 4], [CX - w * 0.8, top - 11], [CX - w * 0.58, top - 22], [CX - w * 0.1, top - 25], [CX + w * 0.36, top - 21],
				[CX + w * 0.7, top - 11], [CX + w * 0.72, top + 2], [CX + w * 0.64, 82], [CX + w * 0.35, 76.5], [CX, 75.5], [CX - w * 0.35, 77.5],
			];
			const d = smoothPath(quiffPts);
			const sweep = Array.from({ length: 11 }, (_, k) => {
				const a = -0.62 + (1.24 * k) / 10;
				const x0 = CX + a * w;
				return q([x0, 76 + a * a * 10], [x0 + a * w * 0.25 - w * 0.06, top - 6], [x0 + a * w * 0.2 + w * 0.12, top - 24 + (a + 0.1) ** 2 * 6]);
			});
			return {
				back: null,
				front: (
					<g>
						{mass(sides, "qf-sides", null, <ellipse cx={CX - w * 0.6} cy={top + 18} rx={8} ry={10} fill={hairHi} opacity={0.25} filter={url("soft2")} />)}
						{mass(
							d,
							"qf-top",
							<g>
								{lines(sweep, "qf-l", 1.3, 0.55)}
								{/* the rolled front edge */}
								<path d={`M${CX - w * 0.74} ${top - 9} Q${CX - w * 0.2} ${top - 21} ${CX + w * 0.68} ${top - 8}`} stroke={hairLo} strokeWidth={4} fill="none" opacity={0.55} />
								<path d={`M${CX - w * 0.74} ${top - 7} Q${CX - w * 0.2} ${top - 19} ${CX + w * 0.68} ${top - 6}`} stroke={hairLine} strokeWidth={1} fill="none" opacity={0.5} />
							</g>,
							<ellipse cx={CX - w * 0.25} cy={top - 21} rx={w * 0.42} ry={4} fill={hairHi} opacity={0.55} filter={url("soft1")} />,
						)}
					</g>
				),
				extra: null,
			};
		}

		case "slicked_back": {
			const d = smoothPath(cap(-3, 3, w + 2.5, 104));
			const comb = Array.from({ length: 15 }, (_, k) => {
				const a = -1 + (2 * k) / 14;
				const x0 = CX + a * w * 0.92;
				const y0 = 72 + a * a * 24;
				return q([x0, y0], [CX + a * w * 1.02, top + 8], [CX + a * w * 0.38, top - 8]);
			});
			const gloss = mix(hairHi, "#ffffff", 0.45);
			return {
				back: null,
				front: mass(
					d,
					"sb",
					lines(comb, "sb-l", 1.1, 0.6),
					<g>
						<path d={`M${CX - w * 0.62} ${top + 24} Q${CX - w * 0.42} ${top - 1} ${CX + w * 0.15} ${top - 1}`} stroke={hairHi} strokeWidth={6} fill="none" opacity={0.5} filter={url("soft1")} />
						<path d={`M${CX - w * 0.56} ${top + 20} Q${CX - w * 0.38} ${top + 1} ${CX + w * 0.05} ${top}`} stroke={gloss} strokeWidth={1.3} fill="none" opacity={0.55} strokeLinecap="round" />
						<path d={`M${CX + w * 0.5} ${top + 4} Q${CX + w * 0.7} ${top + 12} ${CX + w * 0.78} ${top + 26}`} stroke={gloss} strokeWidth={1} fill="none" opacity={0.25} strokeLinecap="round" />
					</g>,
				),
				extra: null,
			};
		}

		case "receding": {
			// Deep temples, a forelock island, full sides; the crown thins out.
			const pts: P[] = [
				[CX, top - 2], [CX + w * 0.72, top + 1], [CX + hw - 1, top + 26], [CX + hw - 1.5, 112], [CX + w - 3, 110],
				[CX + w - 2, 98], [CX + w * 0.86, 84], [CX + w * 0.66, 67], [CX + w * 0.42, 69], [CX + w * 0.16, 74], [CX, 75.5],
				[CX - w * 0.16, 74], [CX - w * 0.42, 69], [CX - w * 0.66, 67], [CX - w * 0.86, 84], [CX - w + 2, 98],
				[CX - w + 3, 110], [CX - hw + 1.5, 112], [CX - hw + 1, top + 26], [CX - w * 0.72, top + 1],
			];
			const d = smoothPath(pts);
			const sideClip = id("rc-sides");
			const strands = SIDES.flatMap((s) => Array.from({ length: 5 }, (_, k) => q([CX + s * (w * 0.62 + k * 2.5), top + 12 + k * 2], [CX + s * (hw + 1), top + 30], [CX + s * (w - 1 + k * 1.2), 108])));
			return {
				back: null,
				front: (
					<g>
						<clipPath id={sideClip}>
							<rect x={0} y={0} width={CX - w * 0.5} height={240} />
							<rect x={CX + w * 0.5} y={0} width={200} height={240} />
						</clipPath>
						{/* thin crown: the scalp shows through */}
						<path d={d} fill={url("hair")} opacity={0.32} />
						<path d={d} fill={hairLo} opacity={0.35} filter={url("grain")} />
						<g clipPath={`url(#${sideClip})`}>
							{mass(d, "rc", lines(strands, "rc-l", 1.2, 0.5), <ellipse cx={CX - w * 0.8} cy={top + 30} rx={6} ry={14} fill={hairHi} opacity={0.3} filter={url("soft2")} />)}
						</g>
						<ellipse cx={CX - w * 0.3} cy={top + 10} rx={w * 0.3} ry={7} fill="#fff" opacity={0.12} filter={url("soft2")} />
					</g>
				),
				extra: null,
				noBrowShadow: true,
			};
		}

		case "dreadlocks": {
			const d = smoothPath(cap(-3, hatted ? 4 : 7, hw, 110));
			const loc = (d: string, k: number, wid = 6.4) => (
				<g key={k}>
					<path d={d} stroke={hairLine} strokeWidth={wid + 1.8} fill="none" strokeLinecap="round" />
					<path d={d} stroke={k % 2 ? hairLo : hair} strokeWidth={wid} fill="none" strokeLinecap="round" />
					<path d={d} stroke={hairLine} strokeWidth={wid} fill="none" strokeDasharray="1.1 5.5" opacity={0.45} />
					<path d={d} stroke={hairHi} strokeWidth={1.2} fill="none" strokeLinecap="round" opacity={0.45} transform="translate(-1.3 0)" />
				</g>
			);
			const backLocs = SIDES.flatMap((s) =>
				[0, 1, 2, 3].map((k) => {
					const x0 = CX + s * (w - 6 + k * 5.5);
					const y0 = top + 18 + k * 6;
					const x1 = CX + s * (w + 2 + k * 6.5);
					return loc(q([x0, y0], [x1 + s * 4, (y0 + 190) / 2], [x1 + s * 2, 182 + ((k * 7) % 12)]), k + (s > 0 ? 10 : 0));
				}),
			);
			const frontLocs = SIDES.flatMap((s) =>
				[0, 1].map((k) => {
					const x0 = CX + s * (w + 1 + k * 4);
					return loc(q([x0, 96 + k * 3], [x0 + s * (3 + k * 2), 136], [x0 + s * (k ? 2 : -1), 164 + k * 10]), k + (s > 0 ? 30 : 20), 6);
				}),
			);
			const roots = Array.from({ length: 11 }, (_, k) => {
				const a = -1 + (2 * k) / 10;
				return q([CX + a * 5, top - 4], [CX + a * (w + 2), top + 4], [CX + a * w * 0.86, 86 + Math.abs(a) * 10]);
			});
			return {
				back: <g>{backLocs}</g>,
				front: mass(
					d,
					"dl",
					<g>
						{lines(roots, "dl-l", 2.2, 0.45)}
						{roots.map((r, i) => <path key={i} d={r} stroke={hairLine} strokeWidth={4} fill="none" strokeDasharray="1 6" opacity={0.3} />)}
					</g>,
				),
				extra: <g>{frontLocs}</g>,
			};
		}

		case "cornrows": {
			const d = smoothPath(cap(-1, 2, w + 2, 104));
			const part = mix(skin, hairLo, 0.4);
			const N = 9;
			const row = (a: number) => {
				const x0 = CX + a * w * 0.86;
				const y0 = 74 + Math.min(a * a, 1.1) * 21;
				const a0: P = [x0, y0];
				const ctl: P = [CX + a * w * 1.0, top + 6];
				const b: P = [CX + a * w * 0.3, top - 4];
				return { a0, ctl, b };
			};
			const at = (r: ReturnType<typeof row>, t: number): P => [
				(1 - t) ** 2 * r.a0[0] + 2 * (1 - t) * t * r.ctl[0] + t * t * r.b[0],
				(1 - t) ** 2 * r.a0[1] + 2 * (1 - t) * t * r.ctl[1] + t * t * r.b[1],
			];
			const rows = Array.from({ length: N }, (_, k) => -1.12 + (2.24 * k) / (N - 1));
			const spacing = 2.24 / (N - 1);
			return {
				back: null,
				front: (
					<g>
						<clipPath id={id("cr")}><path d={d} /></clipPath>
						<path d={d} fill={part} {...stroke} strokeWidth={0.9} />
						<g clipPath={url("cr")}>
							{rows.map((a, i) => {
								const r = row(a);
								const steps = 8;
								return (
									<g key={i}>
										<path d={q(r.a0, r.ctl, r.b)} stroke={hairLine} strokeWidth={6.4} fill="none" strokeLinecap="round" />
										<path d={q(r.a0, r.ctl, r.b)} stroke={hair} strokeWidth={4.8} fill="none" strokeLinecap="round" />
										{Array.from({ length: steps }, (_, j) => {
											const t = (j + 0.5) / steps;
											const [x, y] = at(r, t);
											const [x2, y2] = at(r, Math.min(1, t + 0.02));
											const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
											return <ellipse key={j} cx={r1(x)} cy={r1(y)} rx={3} ry={1.9} transform={`rotate(${r1(ang + 35)} ${r1(x)} ${r1(y)})`} fill={j % 2 ? hairLo : hairHi} opacity={0.55} />;
										})}
									</g>
								);
							})}
							{rows.slice(0, -1).map((a, i) => {
								const r = row(a + spacing / 2);
								return <path key={`p${i}`} d={q(r.a0, r.ctl, r.b)} stroke={part} strokeWidth={0.9} fill="none" opacity={0.8} />;
							})}
							<ellipse cx={CX - w * 0.35} cy={top + 6} rx={w * 0.4} ry={8} fill={hairHi} opacity={0.3} filter={url("soft2")} />
						</g>
					</g>
				),
				extra: null,
			};
		}

		case "curtains": {
			const v = hatted ? 4 : 6;
			const pts: P[] = [
				[CX, top - v], [CX + w * 0.72, top - v * 0.6 + 2], [CX + w + 3.5, top + 26], [CX + w + 3, 110], [CX + w - 1, 108],
				[CX + w - 3, 103], [CX + w * 0.84, 97], [CX + w * 0.6, 91], [CX + w * 0.32, 85], [CX + 8, 77], [CX + 3, 70.5], [CX, 69], [CX - 3, 70.5],
				[CX - 8, 77], [CX - w * 0.32, 85], [CX - w * 0.6, 91], [CX - w * 0.84, 97], [CX - w + 3, 103],
				[CX - w + 1, 108], [CX - w - 3, 110], [CX - w - 3.5, top + 26], [CX - w * 0.72, top - v * 0.6 + 2],
			];
			const d = smoothPath(pts);
			const fall = SIDES.flatMap((s) =>
				Array.from({ length: 8 }, (_, k) => {
					const f = k / 7;
					return q([CX + s * 1.5, top - v + 2], [CX + s * (w * 0.12 + f * w * 0.9), top + 2], [CX + s * (w * 0.12 + f * w * 1.0), 82 + f * 26]);
				}),
			);
			return {
				back: null,
				front: mass(
					d,
					"ct",
					<g>
						{lines(fall, "ct-l", 1.3, 0.5)}
						<path d={`M${CX} ${top - v + 1} L${CX} 70`} stroke={mix(skin, hairLo, 0.3)} strokeWidth={1.8} strokeLinecap="round" opacity={0.85} />
					</g>,
					<g>
						<ellipse cx={CX - w * 0.38} cy={top + 8} rx={w * 0.3} ry={9} fill={hairHi} opacity={0.4} filter={url("soft2")} />
						<ellipse cx={CX + w * 0.38} cy={top + 8} rx={w * 0.22} ry={7} fill={hairHi} opacity={0.2} filter={url("soft2")} />
					</g>,
				),
				extra: null,
			};
		}

		case "spiky": {
			if (hatted) return underHat("sp-hat");
			const n = 11;
			const cy = top + 30;
			const crown: P[] = [];
			for (let i = 0; i <= n; i++) {
				const t = Math.PI + 0.2 + ((Math.PI - 0.4) * i) / n;
				crown.push([CX + Math.cos(t) * (w + 9), cy + Math.sin(t) * 46]);
				if (i < n) {
					const tv = t + (Math.PI - 0.4) / n / 2;
					crown.push([CX + Math.cos(tv) * (w + 3), cy + Math.sin(tv) * 36]);
				}
			}
			const fringe: P[] = [
				[CX + w - 3, 98], [CX + w * 0.72, 86], [CX + w * 0.55, 79], [CX + w * 0.42, 86], [CX + w * 0.28, 77], [CX + w * 0.12, 86],
				[CX - w * 0.04, 76], [CX - w * 0.2, 86], [CX - w * 0.36, 77], [CX - w * 0.5, 87], [CX - w * 0.62, 79], [CX - w * 0.76, 88], [CX - w + 3, 98],
			];
			const pts: P[] = [[CX - hw + 2, 101], [CX - hw + 1, top + 30], ...crown, [CX + hw - 1, top + 30], [CX + hw - 2, 101], ...fringe];
			const d = smoothPath(pts, true, 0.45);
			const rays = crown.filter((_, i) => i % 2 === 0).map(([x, y]) => q([CX + (x - CX) * 0.2, top + 22], [CX + (x - CX) * 0.75, top + (y - top) * 0.3 + 4], [x, y]));
			return {
				back: null,
				front: mass(d, "sp", lines(rays, "sp-l", 1.3, 0.55), <ellipse cx={CX - w * 0.3} cy={top - 4} rx={w * 0.45} ry={9} fill={hairHi} opacity={0.4} filter={url("soft2")} />),
				extra: null,
			};
		}

		case "flat_top": {
			const sides = fuzz(smoothPath(cap(-2, 1, w + 1.6, 101)), "ft-sides", 0.9);
			if (hatted) return { back: null, front: sides, extra: null };
			const T = top - 11;
			const d = `M${r1(CX - w * 0.84)} 86 C${r1(CX - w * 0.96)} 72 ${r1(CX - w * 0.98)} ${top + 2} ${r1(CX - w * 0.92)} ${T + 7} Q${r1(CX - w * 0.9)} ${T} ${r1(CX - w * 0.68)} ${T} L${r1(CX + w * 0.68)} ${T} Q${r1(CX + w * 0.9)} ${T} ${r1(CX + w * 0.92)} ${T + 7} C${r1(CX + w * 0.98)} ${top + 2} ${r1(CX + w * 0.96)} 72 ${r1(CX + w * 0.84)} 86 C${r1(CX + w * 0.66)} 80 ${r1(CX + w * 0.4)} 77 ${CX + 6} 75.5 Q${CX} 77 ${CX - 6} 75.5 C${r1(CX - w * 0.4)} 77 ${r1(CX - w * 0.66)} 80 ${r1(CX - w * 0.84)} 86 Z`;
			const bristles = Array.from({ length: 21 }, (_, k) => {
				const x = CX - w * 0.9 + (k * w * 1.8) / 20;
				return `M${r1(x)} ${T + 5} L${r1(x + (x - CX) * 0.06)} ${86}`;
			});
			return {
				back: null,
				front: (
					<g>
						{sides}
						{SIDES.map((s) => <path key={s} d={`M${CX + s * w * 0.95} ${top + 4} Q${CX + s * w * 0.96} 76 ${CX + s * w * 0.82} 87`} stroke="#000" strokeWidth={3} opacity={0.16} fill="none" filter={url("soft1")} />)}
						{mass(
							d,
							"ft",
							lines(bristles, "ft-l", 1.1, 0.45),
							<g>
								<rect x={CX - w} y={T} width={w * 2} height={5} fill={hairHi} opacity={0.5} />
								<path d={`M${CX - w * 0.78} ${T + 5} L${CX + w * 0.78} ${T + 5}`} stroke={hairLine} strokeWidth={0.8} opacity={0.35} />
								<ellipse cx={CX - w * 0.55} cy={top + 8} rx={7} ry={12} fill={hairHi} opacity={0.3} filter={url("soft2")} />
							</g>,
						)}
					</g>
				),
				extra: null,
			};
		}
	}
	return null;
}
