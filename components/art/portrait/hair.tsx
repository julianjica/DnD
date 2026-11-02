import type { ReactNode } from "react";
import { smoothPath } from "@/lib/art/rand";
import { CX, subRng, type P } from "./rig";
import { r, type Ctx } from "./ctx";

/* Hair: a back mass (behind head and body), a cap over the skull, and locks/braids in front. */

export interface HairLayers {
	back: ReactNode;
	front: ReactNode;
}

type Flow = "back" | "fall" | "none";
type Curve = [P, P, P, P];

function bez([p0, p1, p2, p3]: Curve, t: number): P {
	const u = 1 - t;
	return [
		u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
		u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
	];
}

/** A tapered ribbon (one clump of hair) along a cubic curve. */
export function ribbon(cv: Curve, wMax: number, startW = 0.35): string {
	const n = 9;
	const L: P[] = [];
	const R: P[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const [x, y] = bez(cv, t);
		const [x2, y2] = bez(cv, Math.min(1, t + 0.02));
		const [x1, y1] = bez(cv, Math.max(0, t - 0.02));
		let dx = x2 - x1;
		let dy = y2 - y1;
		const len = Math.hypot(dx, dy) || 1;
		dx /= len;
		dy /= len;
		const wt = wMax * (startW + (1 - startW) * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (1 - t ** 5) * 0.5;
		L.push([x - dy * wt, y + dx * wt]);
		R.push([x + dy * wt, y - dx * wt]);
	}
	return smoothPath([...L, ...R.reverse()], true, 0.9);
}

export function hair(c: Ctx): HairLayers {
	const { rig, t, spec, pal, url, id, detail } = c;
	if (rig.draconic) return { back: null, front: null };
	const style = spec.hairStyle || "short";
	const rng = subRng(spec, "hair");
	const { w, top, H, browY, eyeY, chin, jaw, neckW, shY } = rig;
	const covered = c.headwear === "hood" || c.headwear === "helmet";
	const partSide = t.part < 0 ? -1 : 1;
	const recede = !t.female && t.age > 0.55 ? (t.age - 0.55) * 14 : 0;
	const hairline = rig.hairline + (t.female ? -1 : 1) + recede * 0.4;

	/** Front edge of the hair over the forehead, left temple → right temple. */
	const hairlinePts = (dip: number, partX: number, templeY = browY - 5): P[] => [
		[CX - w + 2.5, templeY],
		[CX - w * 0.8 + recede * 0.3, hairline + 8 + recede * 0.4],
		[CX - w * 0.45, hairline + 1.5 + dip * 0.6],
		[partX, hairline + dip],
		[CX + w * 0.45, hairline + 1.5 + dip * 0.6],
		[CX + w * 0.8 - recede * 0.3, hairline + 8 + recede * 0.4],
		[CX + w - 2.5, templeY],
	];
	/** Outer silhouette over the skull, right temple → left temple (over the top). */
	const domePts = (v: number, sideY: number, sideV = v): P[] => [
		[CX + w + 0.5 + sideV * 0.3, sideY],
		[CX + w + sideV * 0.85, top + H * 0.24],
		[CX + w * 0.7 + v * 0.55, top - v * 0.62 + 3],
		[CX, top - v],
		[CX - w * 0.7 - v * 0.55, top - v * 0.62 + 3],
		[CX - w - sideV * 0.85, top + H * 0.24],
		[CX - w - 0.5 - sideV * 0.3, sideY],
	];
	const capPath = (v: number, dip: number, partX: number, sideY = browY + 1, sideV = v) =>
		smoothPath([...domePts(v, sideY, sideV), ...hairlinePts(dip, partX)], true, 0.9);

	/** Strand strokes for a cap. */
	const strands = (flow: Flow, v: number, partX: number, n: number, sideY: number): ReactNode => {
		if (detail === 0 || flow === "none") return null;
		const out: ReactNode[] = [];
		for (let i = 0; i < n; i++) {
			const a = -1 + (2 * (i + rng.range(0.1, 0.9))) / n;
			let d: string;
			if (flow === "back") {
				const x0 = CX + a * w * 0.86;
				const y0 = hairline + 2 + Math.abs(a) ** 2 * 10 + rng.range(-1, 2);
				const x1 = CX + a * w * 0.42;
				const y1 = top - v + 1;
				d = `M${r(x0)} ${r(y0)} Q${r(CX + a * (w + v) * 0.98)} ${r((y0 + y1) / 2)} ${r(x1)} ${r(y1)}`;
			} else {
				const side = a < (partX - CX) / w ? -1 : 1;
				const x0 = partX + rng.range(-2, 2);
				const y0 = top - v + 3 + rng.range(0, 4);
				const spread = Math.abs(a - (partX - CX) / w);
				const x1 = CX + side * (w * (0.25 + spread * 0.7) + v * 0.7);
				const y1 = sideY - 4 + (1 - spread) * (hairline - sideY + 6) + rng.range(-3, 3);
				d = `M${r(x0)} ${r(y0)} Q${r(CX + side * (w * 0.6 + spread * w * 0.5) + side * v)} ${r(top + 4)} ${r(x1)} ${r(y1)}`;
			}
			const hi = i % 4 === 0;
			out.push(<path key={i} d={d} stroke={hi ? pal.hairLight : pal.hairDark} strokeWidth={hi ? 0.6 : rng.range(0.6, 1.5)} fill="none" opacity={hi ? 0.7 : 0.6} />);
		}
		return out;
	};

	/** A cap with gradient, form shadow, sheen and strands, clipped to itself. */
	/** Clump curves for a cap: hair parted at partX falling to the sides ("fall") or combed back from the hairline ("back"). */
	const clumpCurves = (flow: Flow, v: number, partX: number, sideY: number, fringe: number, span = 1): Curve[] => {
		const out: Curve[] = [];
		if (flow === "fall") {
			const n = 15;
			for (let i = 0; i < n; i++) {
				const a = -1 + (2 * (i + 0.5)) / n; // -1 left … 1 right
				const dir = CX + a * w < partX ? -1 : 1;
				const p0: P = [partX + dir * rng.range(0.5, 2.5), top - v + 3 + rng.range(0, 3)];
				const side = Math.abs(a) > 0.55;
				if (side) {
					const end: P = [CX + dir * (w + v * 0.45) + rng.range(-1.5, 1.5), sideY - rng.range(0, 6) + (Math.abs(a) - 0.55) * 8];
					out.push([p0, [p0[0] + dir * w * 0.55, top - v - 1], [CX + dir * (w + v * 1.05), top + H * 0.12 + Math.abs(a) * 6], end]);
				} else {
					const end: P = [CX + a * w * 0.95 + dir * fringe * 0.6, hairline + 2 + fringe + rng.range(-2, 2) + Math.abs(a) * 3];
					out.push([p0, [p0[0] + dir * w * 0.35, top - v * 0.8], [end[0] + dir * 6, end[1] - 16], end]);
				}
			}
		} else if (flow === "back") {
			const n = 13;
			for (let i = 0; i < n; i++) {
				const a = -1 + (2 * (i + 0.5)) / n;
				const p0: P = [CX + a * w * 0.88 * span, hairline + 1 + Math.abs(a) ** 2 * 11 * span + rng.range(-1, 1)];
				const end: P = [CX + a * w * 0.25 * span, top - v + 1];
				out.push([p0, [p0[0] + a * 4 * span, p0[1] - 12], [CX + a * (w * span + v) * 0.92, top + 2], end]);
			}
		}
		// draw sides first, center last, so the front clumps sit on top
		return out.sort((p, q) => Math.abs(q[3][0] - CX) - Math.abs(p[3][0] - CX));
	};

	const cap = (key: string, d: string, flow: Flow, v: number, partX: number, sideY = browY + 1, opacity = 1, fringe = 0, span = 1): ReactNode => {
		const curves = clumpCurves(flow, v, partX, sideY, fringe, span);
		const clumps = curves.map((cv, i) => {
			const shadeK = rng.range(0, 1);
			const dir = cv[3][0] < CX ? -1 : 1;
			const fill = dir < 0 ? (shadeK < 0.5 ? pal.hair : pal.hairLight) : shadeK < 0.5 ? pal.hairDark : pal.hair;
			const rd = ribbon(cv, detail ? rng.range(7, 11) : 11);
			return (
				<g key={i}>
					<path d={rd} fill={fill} />
					{detail > 0 && <path d={`M${r(cv[0][0])} ${r(cv[0][1])} C${r(cv[1][0] - 1)} ${r(cv[1][1] + 1)} ${r(cv[2][0] - dir * 1.5)} ${r(cv[2][1])} ${r(cv[3][0] - dir * 1)} ${r(cv[3][1] - 2)}`} stroke={pal.hairSheen} strokeWidth={0.7} fill="none" opacity={dir < 0 ? 0.6 : 0.3} />}
					{detail > 0 && <path d={rd} fill="none" stroke={pal.hairDark} strokeWidth={0.6} opacity={0.6} />}
				</g>
			);
		});
		return (
			<g key={key} opacity={opacity}>
				<clipPath id={id(`cap-${key}`)}>
					<path d={d} />
				</clipPath>
				<path d={d} fill={pal.hairDark} filter={url("blurS")} />
				<path d={d} fill={url("hairBack")} />
				{flow === "none" && <path d={d} fill={url("hair")} />}
				{clumps}
				<g clipPath={url(`cap-${key}`)}>
					<g filter={url("blurM")}>
						<path d={`M${r(CX + w * 0.15)} ${top - v - 4} Q${r(CX + w + v + 6)} ${top + 4} ${r(CX + w + v + 4)} ${r(sideY + 6)} L${r(CX + w + v + 12)} ${r(sideY + 8)} L${r(CX + w + v + 12)} ${top - v - 8} Z`} fill={pal.hairDark} opacity={0.5} />
						<path d={`M${r(CX - w - v * 0.6)} ${r(top + H * 0.24)} Q${r(CX - w * 0.6)} ${r(top - v * 0.5 + 2)} ${r(CX + w * 0.15)} ${r(top - v * 0.6 + 4)}`} stroke={pal.hairSheen} strokeWidth={5} fill="none" opacity={0.4} />
					</g>
					{detail > 1 && strands(flow, v, partX, 18, sideY)}
				</g>
			</g>
		);
	};

	/** Soft shadow the hair casts on the forehead. */
	const foreheadShadow = (dip: number, partX: number) => (
		<g key="fs" clipPath={url("head")}>
			<path d={smoothPath(hairlinePts(dip, partX), false)} stroke={pal.skinDeep} strokeWidth={6} fill="none" opacity={0.42} transform="translate(1.5 3)" filter={url("blurM")} />
		</g>
	);

	/** A lock of hair falling in front of the shoulder on side s. */
	const lock = (s: 1 | -1, bottom: number, width: number, key: string): ReactNode => {
		const outer: P[] = [
			[CX + s * (w - 1), browY - 8],
			[CX + s * (w + 5), eyeY + 4],
			[CX + s * (w + 6), chin - 4],
			[CX + s * (neckW + width + 6), shY + 2],
			[CX + s * (neckW + width + 2), bottom],
		];
		const inner: P[] = [
			[CX + s * (neckW + 4), bottom + 2],
			[CX + s * (neckW + 1), chin + 22],
			[CX + s * (jaw + 0.5), rig.jawY],
			[CX + s * (w - 0.5), eyeY + 2],
		];
		const d = smoothPath([...outer, ...inner], true, 0.85);
		const lines: ReactNode[] = [];
		const n = detail ? 7 : 3;
		for (let i = 0; i < n; i++) {
			const k = (i + 0.5) / n;
			const x0 = CX + s * (w - 3 + k * 7);
			const x1 = CX + s * (neckW + 3 + k * width) + rng.range(-2, 2);
			const cv: Curve = [[x0, browY - 6], [x0 + s * 5, eyeY + 16], [CX + s * (jaw + 2 + k * 8), chin + 12], [x1, bottom - rng.range(0, 10)]];
			const rd = ribbon(cv, rng.range(6, 9), 0.7);
			lines.push(
				<g key={i}>
					<path d={rd} fill={i % 2 ? pal.hair : pal.hairDark} />
					{detail > 0 && <path d={`M${r(cv[0][0])} ${r(cv[0][1])} C${r(cv[1][0])} ${r(cv[1][1])} ${r(cv[2][0])} ${r(cv[2][1])} ${r(cv[3][0])} ${r(cv[3][1] - 4)}`} stroke={pal.hairSheen} strokeWidth={0.7} fill="none" opacity={s < 0 ? 0.55 : 0.25} />}
				</g>,
			);
		}
		return (
			<g key={key}>
				<clipPath id={id(`lock-${key}`)}>
					<path d={d} />
				</clipPath>
				<path d={d} fill={url("hairLock")} />
				<g clipPath={url(`lock-${key}`)}>
					{lines}
					<path d={`M${r(CX + s * (w + 3))} ${r(eyeY - 8)} Q${r(CX + s * (w + 4))} ${r(chin)} ${r(CX + s * (neckW + width))} ${r(shY + 10)}`} stroke={s < 0 ? pal.hairSheen : pal.hairLight} strokeWidth={3} fill="none" opacity={s < 0 ? 0.45 : 0.2} filter={url("blurM")} />
					<path d={`M${r(CX + s * (neckW + 2))} ${r(chin + 10)} L${r(CX + s * (neckW + 4))} ${bottom}`} stroke={pal.hairDark} strokeWidth={5} opacity={0.5} filter={url("blurM")} />
				</g>
			</g>
		);
	};

	/** Back mass: dome around the head and sides falling to `bottom`. */
	const backMass = (v: number, bottom: number, spread: number, jag = 0): ReactNode => {
		const pts: P[] = [
			[CX, top - v - 1],
			[CX + w * 0.8 + v * 0.6, top - v * 0.5 + 3],
			[CX + w + v + 2, top + H * 0.3],
			[CX + w + spread * 0.5 + 2, eyeY + 10],
			[CX + w + spread, Math.min(bottom - 10, chin + 10)],
			[CX + neckW + spread + 8, bottom],
			[CX + neckW - 2, bottom],
			[CX + neckW - 4, chin],
			[CX - neckW + 4, chin],
			[CX - neckW + 2, bottom],
			[CX - neckW - spread - 8, bottom],
			[CX - w - spread, Math.min(bottom - 10, chin + 10)],
			[CX - w - spread * 0.5 - 2, eyeY + 10],
			[CX - w - v - 2, top + H * 0.3],
			[CX - w * 0.8 - v * 0.6, top - v * 0.5 + 3],
		];
		const jagged = jag ? pts.map(([x, y], i) => [x + (x - CX) * 0.04 * (i % 2 ? jag : -jag * 0.3), y + (i % 2 ? jag : 0)] as P) : pts;
		const d = smoothPath(jagged, true, 0.9);
		return (
			<g>
				<path d={d} fill={pal.hairDark} />
				<path d={d} fill={url("hairBack")} opacity={0.8} />
			</g>
		);
	};

	let back: ReactNode = null;
	const front: ReactNode[] = [];
	const centerPart = CX + t.part * 4;
	const sidePartX = CX + partSide * w * 0.38;

	switch (style) {
		case "bald": {
			if (!t.female && t.age > 0.45 && !covered) {
				// horseshoe fringe above the ears
				for (const s of [-1, 1] as const) {
					const d = smoothPath([[CX + s * (w - 4), browY - 12], [CX + s * (w + 3), browY - 4], [CX + s * (w + 3), browY + 6], [CX + s * (w - 1), browY + 8], [CX + s * (w - 2), browY - 2]], true, 0.8);
					front.push(<path key={`fr${s}`} d={d} fill={url("hair")} opacity={0.9} />);
				}
			}
			break;
		}
		case "cropped": {
			const d = capPath(2.4, 1, CX, browY + 3, 1.2);
			front.push(foreheadShadow(1, CX), cap("c", d, "back", 2.4, CX, browY + 3, 0.95));
			break;
		}
		case "short": {
			const d = capPath(6, 3, centerPart, browY + 1);
			front.push(foreheadShadow(3, centerPart), cap("c", d, "fall", 6, centerPart, browY + 1, 1, 4));
			// a few fringe tips
			if (detail > 0) {
				front.push(
					<g key="fringe" fill={url("hair")}>
						{[-0.4, -0.15, 0.15, 0.42].map((a, i) => (
							<path key={i} d={`M${r(CX + a * w - 5)} ${r(hairline + 1)} Q${r(CX + a * w)} ${r(hairline + 7 + (i % 2) * 2)} ${r(CX + a * w + 5)} ${r(hairline + 1)} Z`} />
						))}
					</g>,
				);
			}
			break;
		}
		case "sidepart": {
			const d = capPath(7, 0, sidePartX, browY + 1);
			const s = -partSide;
			const sweep = `M${r(sidePartX)} ${r(top - 4)} C${r(CX + s * w * 0.1)} ${r(hairline - 6)} ${r(CX + s * w * 0.6)} ${r(hairline + 2)} ${r(CX + s * (w + 2))} ${r(browY - 2)} C${r(CX + s * w * 0.75)} ${r(hairline + 12)} ${r(CX + s * w * 0.2)} ${r(hairline + 9)} ${r(sidePartX + s * 4)} ${r(hairline + 2)} Z`;
			front.push(foreheadShadow(4, sidePartX), cap("c", d, "fall", 7, sidePartX), cap("sweep", sweep, "none", 2, sidePartX));
			break;
		}
		case "long": {
			back = backMass(7, Math.min(250, shY + 30), 12);
			const d = capPath(6, 2, centerPart, browY + 4);
			front.push(foreheadShadow(2, centerPart), cap("c", d, "fall", 6, centerPart));
			front.push(lock(-1, 238, 16, "l"));
			if (t.variant % 3 !== 0) front.push(lock(1, 236, 14, "r"));
			break;
		}
		case "ponytail": {
			const d = capPath(3.5, -2, CX, browY + 2);
			const s = t.variant % 2 ? 1 : -1;
			const tail = smoothPath([[CX + s * (w * 0.4), top + 6], [CX + s * (w + 16), top + 24], [CX + s * (w + 14), chin], [CX + s * (neckW + 22), shY + 30], [CX + s * (neckW + 12), shY + 34], [CX + s * (w + 4), chin - 6], [CX + s * (w + 2), top + 30]], true, 0.9);
			back = (
				<g>
					<path d={tail} fill={url("hairLock")} />
					<path d={tail} fill="none" stroke={pal.hairDark} strokeWidth={0.8} opacity={0.5} />
				</g>
			);
			front.push(foreheadShadow(-2, CX), cap("c", d, "back", 3.5, CX, browY + 2));
			break;
		}
		case "bun":
		case "topknot": {
			const knot = style === "topknot";
			const d = capPath(knot ? 2.5 : 3.5, -2, CX, browY + 2);
			const by = knot ? top - 14 : top - 8;
			const br = knot ? 9 : 14;
			const bun = (
				<g key="bun">
					<ellipse cx={knot ? CX : CX + 4} cy={by} rx={br} ry={br * 0.85} fill={url("hair")} />
					{detail > 0 && [0, 1, 2, 3].map((i) => <path key={i} d={`M${r(CX - br * 0.7 + i * 2)} ${r(by + 2 - i * 2)} Q${r(CX + i)} ${r(by - br * 0.9 + i * 2)} ${r(CX + br * 0.7)} ${r(by - 1 + i)}`} stroke={i % 2 ? pal.hairLight : pal.hairDark} strokeWidth={0.8} fill="none" opacity={0.6} />)}
					<ellipse cx={CX - br * 0.3} cy={by - br * 0.35} rx={br * 0.45} ry={br * 0.25} fill={pal.hairSheen} opacity={0.35} filter={url("blurS")} />
					{knot && <rect x={CX - 6} y={r(by + br * 0.6)} width={12} height={4} rx={1.5} fill={pal.trim} stroke="#1a1008" strokeWidth={0.5} />}
				</g>
			);
			back = knot ? null : bun;
			front.push(foreheadShadow(-2, CX), cap("c", d, "back", knot ? 2.5 : 3.5, CX, browY + 2, knot && !t.female ? 0.9 : 1));
			if (knot) front.push(bun);
			// loose wisps at the temples
			if (detail > 0 && t.female) front.push(<path key="wisp" d={`M${r(CX - w + 3)} ${r(browY - 8)} q-3 10 0 18 M${r(CX + w - 3)} ${r(browY - 8)} q3 10 0 18`} stroke={pal.hair} strokeWidth={1.4} fill="none" opacity={0.8} />);
			break;
		}
		case "braids": {
			back = backMass(5, chin + 10, 6);
			const d = capPath(4, 0, CX, browY + 3);
			front.push(foreheadShadow(0, CX), cap("c", d, "fall", 4, CX, browY + 3));
			for (const s of [-1, 1] as const) {
				const lobes: ReactNode[] = [];
				for (let i = 0; i < 9; i++) {
					const x = CX + s * (w + 2 - i * 1.9);
					const y = eyeY + 6 + i * 11;
					lobes.push(
						<g key={i}>
							<ellipse cx={r(x)} cy={r(y)} rx={r(6.2 - i * 0.2)} ry={6.6} fill={url("hair")} stroke={pal.hairDark} strokeWidth={0.7} transform={`rotate(${s * (i % 2 ? 22 : -22)} ${r(x)} ${r(y)})`} />
							<path d={`M${r(x - 3)} ${r(y - 2)} q3 -2 6 1`} stroke={pal.hairSheen} strokeWidth={1} fill="none" opacity={0.5} />
						</g>,
					);
				}
				front.push(
					<g key={`br${s}`}>
						{lobes}
						<rect x={r(CX + s * (w + 2 - 9 * 1.9) - 4)} y={r(eyeY + 6 + 9 * 11 - 5)} width={8} height={4} rx={1} fill={pal.trim} />
					</g>,
				);
			}
			break;
		}
		case "mohawk":
		case "shaved_sides": {
			const stubble = capPath(1.2, 1, CX, browY + 2, 0.6);
			front.push(<path key="stub" d={stubble} fill={pal.hairDark} opacity={0.28} filter={url("blurS")} />);
			if (style === "mohawk") {
				const crest: P[] = [[CX - 6, hairline + 4], [CX - 8, top + 6], [CX - 6, top - 14], [CX - 1, top - 26], [CX + 4, top - 18], [CX + 8, top - 4], [CX + 7, hairline + 4]];
				front.push(cap("crest", smoothPath(crest, true, 0.8), "back", 8, CX, hairline, 1, 0, 0.14));
			} else {
				const s = partSide;
				const topPts: P[] = [[CX - w * 0.62, hairline + 6], [CX - w * 0.68, top + 6], [CX - w * 0.3, top - 9], [CX + s * 6, top - 12], [CX + w * 0.5, top - 7], [CX + w * 0.66, top + 6], [CX + w * 0.6, hairline + 6], [CX, hairline - 1]];
				front.push(foreheadShadow(-1, CX), cap("top", smoothPath(topPts, true, 0.85), "back", 9, CX, hairline + 6, 1, 0, 0.62));
			}
			break;
		}
		case "curly":
		case "wild": {
			const curly = style === "curly";
			const v = curly ? 11 : 12;
			const long = t.female || t.variant % 2 === 0;
			back = backMass(v, long ? shY + 4 : chin + 4, curly ? 14 : 16, curly ? 0 : 5);
			// bumpy outline
			const outline: P[] = [];
			const n = curly ? 15 : 13;
			for (let i = 0; i <= n; i++) {
				const a = Math.PI + (Math.PI * i) / n;
				const bump = curly ? (i % 2 ? 3 : -1) : rng.range(-2, 6);
				outline.push([CX + Math.cos(a) * (w + v * 0.7 + bump), top + H * 0.32 + Math.sin(a) * (H * 0.32 + v + bump)]);
			}
			const pts: P[] = [[CX + w + 2, browY + 4], ...outline.slice().reverse(), [CX - w - 2, browY + 4], ...hairlinePts(5, centerPart)];
			const d = smoothPath(pts, true, curly ? 1 : 0.7);
			front.push(foreheadShadow(5, centerPart), cap("c", d, curly ? "none" : "fall", v, centerPart, browY + 4, 1, 6));
			if (curly) {
				// a mass of individual curls, each lit from the upper left
				const balls: [number, number, number][] = [];
				const rows = 6;
				for (let row = 0; row < rows; row++) {
					const y = top - v + 4 + row * ((browY + 2 - (top - v + 4)) / (rows - 1));
					const k = (y - (top + H * 0.32)) / (H * 0.32 + v);
					const half = Math.sqrt(Math.max(0, 1 - Math.min(1, k * k))) * (w + v * 0.7);
					const n = Math.max(3, Math.round((half * 2) / (detail ? 8 : 12)));
					for (let i = 0; i < n; i++) {
						const x = CX - half + ((i + 0.5 + (row % 2) * 0.4) * (half * 2)) / n;
						// keep the forehead clear below the hairline
						if (y > hairline + 4 && Math.abs(x - CX) < w - 4) continue;
						balls.push([x + rng.range(-1.5, 1.5), y + rng.range(-1.5, 1.5), rng.range(4.2, 6.2)]);
					}
				}
				front.push(
					<g key="curls">
						{balls.map(([x, y, rr], i) => {
							const lit = x < CX + 6;
							return (
								<g key={i}>
									<circle cx={r(x)} cy={r(y)} r={r(rr)} fill={lit ? (i % 3 ? pal.hair : pal.hairLight) : i % 3 ? pal.hairDark : pal.hair} />
									{detail > 0 && <path d={`M${r(x - rr * 0.7)} ${r(y + rr * 0.2)} A${r(rr * 0.75)} ${r(rr * 0.75)} 0 0 1 ${r(x + rr * 0.3)} ${r(y - rr * 0.65)}`} stroke={pal.hairSheen} strokeWidth={1} fill="none" opacity={lit ? 0.7 : 0.35} />}
									{detail > 0 && <path d={`M${r(x + rr * 0.8)} ${r(y - rr * 0.1)} A${r(rr * 0.85)} ${r(rr * 0.85)} 0 0 1 ${r(x - rr * 0.2)} ${r(y + rr * 0.8)}`} stroke={pal.hairDark} strokeWidth={1.1} fill="none" opacity={0.7} />}
								</g>
							);
						})}
					</g>,
				);
			}
			// a stray lock over the forehead
			if (!curly) front.push(<path key="stray" d={`M${r(CX + partSide * 4)} ${r(hairline - 4)} q${r(-partSide * 8)} 8 ${r(-partSide * 6)} 18`} stroke={pal.hair} strokeWidth={2} fill="none" strokeLinecap="round" />);
			break;
		}
		default: {
			const d = capPath(5, 2, centerPart);
			front.push(foreheadShadow(2, centerPart), cap("c", d, "fall", 5, centerPart));
		}
	}

	if (covered) {
		// Under a hood or helmet only long locks show.
		const keep = front.filter((n) => {
			const k = (n as { key?: string } | null)?.key ?? "";
			return k === "l" || k === "r" || k.startsWith("br");
		});
		return { back: c.headwear === "hood" ? null : back, front: keep };
	}
	return { back, front };
}
