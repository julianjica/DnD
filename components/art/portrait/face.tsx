import type { ReactNode } from "react";
import { mix } from "@/lib/art/color";
import { smoothPath } from "@/lib/art/rand";
import { CX, subRng, type P } from "./rig";
import { r, type Ctx } from "./ctx";

/* Face: skull fill + light planes, ears, eyes, brows, nose, mouth, age, facial hair. */

/** Soft light/shadow planes over the face, all inside the head clip. */
export function headShading(c: Ctx): ReactNode {
	const { rig, pal, url, t } = c;
	const { w, top, H, eyeY, browY, noseBottom, mouthY, chin, eyeSpacing: es, ew, noseW, mw, jaw } = rig;
	const smile = t.expression === "smile" || t.expression === "smirk";
	const hollow = 0.16 + t.cheekbones * 0.12 + Math.max(0, t.age - 0.5) * 0.3 + (t.build === "slim" ? 0.08 : 0);
	const old = Math.max(0, t.age - 0.45) / 0.55;
	return (
		<g clipPath={url("head")}>
			<g filter={url("blurL")}>
				{/* shadow side (light from the upper left) */}
				<path
					d={`M${r(CX + w * 0.1)} ${top - 6} C${r(CX + w * 0.6)} ${r(top + H * 0.22)} ${r(CX + w * 0.36)} ${r(eyeY + 6)} ${r(CX + w * 0.52)} ${r(mouthY - 2)} C${r(CX + w * 0.42)} ${r(chin - 8)} ${CX + 8} ${chin} ${CX + 2} ${chin + 6} L${r(CX + w + 12)} ${chin + 12} L${r(CX + w + 12)} ${top - 6} Z`}
					fill={pal.skinShadow}
					opacity={0.8}
				/>
				{/* forehead + lit cheek */}
				<ellipse cx={r(CX - w * 0.28)} cy={r(top + H * 0.2)} rx={r(w * 0.42)} ry={r(H * 0.13)} fill={pal.skinLight} opacity={0.6} />
				<ellipse cx={r(CX - w * 0.5)} cy={r(eyeY + 15 - (smile ? 2 : 0))} rx={9} ry={6} fill={pal.skinLight} opacity={0.5} />
				{/* jaw underside */}
				<path d={`M${r(CX - jaw - 6)} ${r(rig.jawY + 4)} Q${CX} ${chin + 12} ${r(CX + jaw + 6)} ${r(rig.jawY + 4)} L${r(CX + jaw + 6)} ${chin + 20} L${r(CX - jaw - 6)} ${chin + 20} Z`} fill={pal.skinDeep} opacity={0.5} />
				{/* warm cheeks + nose */}
				<ellipse cx={r(CX - w * 0.48)} cy={r(eyeY + 17)} rx={9} ry={6.5} fill={pal.blush} opacity={t.female ? 0.2 : 0.12} />
				<ellipse cx={r(CX + w * 0.48)} cy={r(eyeY + 17)} rx={9} ry={6.5} fill={pal.blush} opacity={t.female ? 0.16 : 0.1} />
			</g>
			<g filter={url("blurM")}>
				{/* temples */}
				<ellipse cx={r(CX + w - 2)} cy={r(browY - 6)} rx={7} ry={13} fill={pal.skinDeep} opacity={0.35} />
				<ellipse cx={r(CX - w + 2)} cy={r(browY - 6)} rx={6} ry={12} fill={pal.skinShadow} opacity={0.25} />
				{/* eye sockets */}
				{[-1, 1].map((s) => (
					<ellipse key={s} cx={r(CX + s * es + s * 0.5)} cy={r(eyeY - 1.5)} rx={r(ew * 1.45)} ry={r(ew * 0.9 + t.browRidge * 1.5)} fill={pal.skinDeep} opacity={s > 0 ? 0.42 : 0.3} />
				))}
				{/* brow ridge highlight */}
				<ellipse cx={r(CX - es + 1)} cy={r(browY - 4)} rx={r(ew * 1.1)} ry={2.4} fill={pal.skinLight} opacity={0.35 + t.browRidge * 0.2} />
				<ellipse cx={CX - 1} cy={r(browY - 1)} rx={4} ry={5} fill={pal.skinLight} opacity={0.3} />
				{/* under-cheekbone hollows */}
				{[-1, 1].map((s) => (
					<path key={`h${s}`} d={`M${r(CX + s * (w - 2))} ${r(eyeY + 17)} Q${r(CX + s * (w - 9))} ${r(mouthY - 6)} ${r(CX + s * (mw + 7))} ${r(mouthY + 3)}`} stroke={pal.skinDeep} strokeWidth={6} fill="none" opacity={r(hollow * (s > 0 ? 1.6 : 1))} />
				))}
				{/* nose: side plane and cast shadow */}
				<path d={`M${CX + 2.5} ${r(browY + 4)} C${r(CX + noseW * 0.45)} ${r(eyeY + 8)} ${r(CX + noseW * 0.85)} ${r(noseBottom - 11)} ${r(CX + noseW + 1)} ${r(noseBottom - 3)} L${CX + 2} ${r(noseBottom - 1)} Z`} fill={pal.skinDeep} opacity={0.6} />
				<path d={`M${r(CX - 2)} ${r(browY + 5)} C${r(CX - noseW * 0.55)} ${r(eyeY + 6)} ${r(CX - noseW * 0.7)} ${r(noseBottom - 12)} ${r(CX - noseW - 0.5)} ${r(noseBottom - 4)}`} stroke={pal.skinShadow} strokeWidth={2.2} fill="none" opacity={0.35} />
				<ellipse cx={CX + 3.5} cy={r(noseBottom + 2.6)} rx={r(noseW * 1.05)} ry={2.8} fill={pal.skinDeep} opacity={0.65} />
				{/* nasolabial folds */}
				{[-1, 1].map((s) => (
					<path key={`n${s}`} d={`M${r(CX + s * (noseW + 1.5))} ${r(noseBottom - 3)} Q${r(CX + s * (mw + 6))} ${r(noseBottom + 4)} ${r(CX + s * (mw + 3.5))} ${r(mouthY + 5)}`} stroke={pal.skinDeep} strokeWidth={2.4} fill="none" opacity={r((s > 0 ? 0.32 : 0.22) + old * 0.25 + (smile ? 0.15 : 0))} />
				))}
				{/* lips area, chin */}
				<ellipse cx={CX + 1} cy={r(mouthY + 7.5 * t.lipFullness)} rx={r(mw * 0.55)} ry={2.4} fill={pal.skinDeep} opacity={0.45} />
				<ellipse cx={CX - 3} cy={r(chin - 9)} rx={r(rig.chinW * 0.6)} ry={4} fill={pal.skinLight} opacity={0.45} />
				<ellipse cx={CX - 1} cy={r(noseBottom - 5)} rx={r(noseW * 0.55)} ry={3} fill={pal.blush} opacity={0.14} />
			</g>
			<g filter={url("blurS")}>
				{/* nose bridge + tip highlight */}
				{noseHighlight(c)}
				<ellipse cx={r(CX - 1.6)} cy={r(noseBottom - 5)} rx={r(noseW * 0.36)} ry={2.4} fill={pal.skinLight} opacity={0.75} />
				{/* upper lip highlight ridge */}
				<path d={`M${r(CX - mw * 0.55)} ${r(mouthY - 4.6 * t.lipFullness)} Q${CX - 2} ${r(mouthY - 6.5)} ${CX + 1} ${r(mouthY - 4.2 * t.lipFullness)}`} stroke={pal.skinLight} strokeWidth={1.2} fill="none" opacity={0.45} />
			</g>
		</g>
	);
}

function noseHighlight(c: Ctx): ReactNode {
	const { rig, pal, t } = c;
	const { eyeY, noseBottom } = rig;
	const form = t.noseForm;
	if (form === "hooked" || form === "aquiline") {
		const bump = form === "hooked" ? 2.4 : 1.4;
		return <path d={`M${CX - 1.5} ${r(eyeY + 1)} Q${r(CX - 1.5 + bump)} ${r((eyeY + noseBottom) / 2 - 2)} ${CX - 1} ${r(noseBottom - 7)}`} stroke={pal.skinLight} strokeWidth={2.2} fill="none" opacity={0.6} />;
	}
	if (form === "snub" || form === "button") {
		return <path d={`M${CX - 1.5} ${r(eyeY + 6)} Q${CX - 2.5} ${r(noseBottom - 9)} ${CX - 1.5} ${r(noseBottom - 7)}`} stroke={pal.skinLight} strokeWidth={2.4} fill="none" opacity={0.5} />;
	}
	const wide = form === "broad" || form === "flat";
	return <path d={`M${CX - 1.5} ${r(eyeY + 2)} L${CX - 1.8} ${r(noseBottom - 7)}`} stroke={pal.skinLight} strokeWidth={wide ? 3.4 : 2} fill="none" opacity={wide ? 0.4 : 0.6} />;
}

/** Ears sit behind the head silhouette. */
export function ears(c: Ctx): ReactNode {
	const { rig, pal, f, url } = c;
	if (rig.draconic) return null;
	const pointed = f.has("pointed_ears");
	const long = f.has("long_ears");
	const out: ReactNode[] = [];
	for (const s of [-1, 1] as const) {
		const x0 = CX + s * (rig.w - 4);
		const yT = rig.browY - 1;
		const yB = rig.noseBottom + 2;
		const lobeX = x0 + s * 4;
		let d: string;
		let inner: string;
		if (pointed || long) {
			const tipX = x0 + s * (long ? 27 : 16);
			const tipY = yT - (long ? 24 : 11);
			d = `M${r(x0 - s * 1)} ${r(yT + 3)} C${r(x0 + s * 5)} ${r(yT - 3)} ${r(tipX - s * 6)} ${r(tipY + 9)} ${r(tipX)} ${r(tipY)} C${r(tipX - s * 2)} ${r(tipY + 12)} ${r(x0 + s * 12)} ${r(yT + 14)} ${r(x0 + s * 10)} ${r(yT + 24)} C${r(x0 + s * 8)} ${r(yB - 4)} ${r(lobeX + s * 2)} ${r(yB + 1)} ${r(lobeX)} ${r(yB + 1)} C${r(x0)} ${r(yB + 2)} ${r(x0 - s * 1)} ${r(yB - 3)} ${r(x0 - s * 1)} ${r(yB - 5)} Z`;
			inner = `M${r(x0 + s * 2)} ${r(yT + 6)} C${r(x0 + s * 6)} ${r(yT)} ${r(tipX - s * 7)} ${r(tipY + 12)} ${r(tipX - s * 4)} ${r(tipY + 6)} C${r(x0 + s * 9)} ${r(yT + 14)} ${r(x0 + s * 7)} ${r(yB - 8)} ${r(x0 + s * 3)} ${r(yB - 6)} Z`;
		} else {
			d = `M${r(x0 - s * 1)} ${r(yT + 3)} C${r(x0 + s * 7)} ${r(yT - 4)} ${r(x0 + s * 12)} ${r(yT + 3)} ${r(x0 + s * 11)} ${r(yT + 13)} C${r(x0 + s * 10)} ${r(yT + 22)} ${r(x0 + s * 7)} ${r(yB - 5)} ${r(lobeX + s * 1.5)} ${r(yB)} C${r(x0 + s * 1)} ${r(yB + 3)} ${r(x0 - s * 1)} ${r(yB - 2)} ${r(x0 - s * 1)} ${r(yB - 5)} Z`;
			inner = `M${r(x0 + s * 2)} ${r(yT + 5)} C${r(x0 + s * 7)} ${r(yT + 1)} ${r(x0 + s * 9)} ${r(yT + 8)} ${r(x0 + s * 7.5)} ${r(yT + 15)} C${r(x0 + s * 6)} ${r(yB - 9)} ${r(x0 + s * 4)} ${r(yB - 8)} ${r(x0 + s * 2)} ${r(yB - 7)} Z`;
		}
		out.push(
			<g key={s}>
				<path d={d} fill={s < 0 ? pal.skin : pal.skinShadow} />
				<path d={d} fill={pal.blush} opacity={0.14} />
				<path d={inner} fill={pal.skinDeep} opacity={s < 0 ? 0.42 : 0.55} filter={url("blurS")} />
				{s < 0 && <path d={d} fill="none" stroke={pal.skinLight} strokeWidth={1} opacity={0.5} />}
				<path d={d} fill="none" stroke={pal.skinLine} strokeWidth={0.7} opacity={0.5} />
				{/* shadow where the ear meets the head */}
				<path d={`M${r(x0 + s * 1)} ${r(yT + 5)} L${r(x0 + s * 1)} ${r(yB - 4)}`} stroke={pal.skinDeep} strokeWidth={3} opacity={0.35} filter={url("blurS")} />
				{c.acc === "earrings" && (
					<g>
						<circle cx={r(lobeX)} cy={r(yB + 5)} r={3.4} fill="none" stroke={url("gold")} strokeWidth={1.5} />
						<circle cx={r(lobeX - 1.2)} cy={r(yB + 2)} r={0.7} fill="#fff6d0" opacity={0.8} />
					</g>
				)}
			</g>,
		);
	}
	return out;
}

const BROW: Record<string, [number, number, number]> = {
	neutral: [0, 0, 0],
	smile: [-0.6, -1.2, 0],
	smirk: [0, 0, 0],
	stern: [2.2, 0.8, 0],
	angry: [3.8, 1.2, -1],
	worried: [-3.2, -1.6, 0.8],
	sad: [-2.6, -0.4, 1.8],
};

export function brows(c: Ctx): ReactNode {
	const { rig, pal, t, url, detail } = c;
	const { eyeSpacing: es, ew, browY, draconic } = rig;
	if (draconic) return null;
	const rng = subRng(c.spec, "brow");
	const out: ReactNode[] = [];
	for (const s of [-1, 1] as const) {
		let [di, dp, dout] = BROW[t.expression] ?? BROW.neutral;
		if (t.expression === "smirk" && s < 0) { di -= 2.6; dp -= 3; dout -= 2; }
		const ex = CX + s * es;
		const th = Math.max(1.8, t.browThick * 1.25 + t.browRidge * 0.8) * (t.age > 0.75 ? 1.15 : 1);
		const angle = t.browAngle * 0.25;
		const inner: P = [ex - s * (ew * 1.02 - (t.expression === "angry" ? 1.4 : 0)), browY + 1.5 + di];
		const peak: P = [ex + s * ew * 0.4, browY - 2.4 + dp - angle * 0.4];
		const outer: P = [ex + s * ew * 1.3, browY + 1.2 + dout - angle * 0.2];
		const d = `M${r(inner[0])} ${r(inner[1] + th * 0.5)} C${r(inner[0])} ${r(inner[1] - th * 0.6)} ${r(peak[0] - s * 4)} ${r(peak[1] - th * 0.55)} ${r(peak[0])} ${r(peak[1] - th * 0.5)} Q${r(outer[0] - s * 3)} ${r(outer[1] - th * 0.6)} ${r(outer[0])} ${r(outer[1])} Q${r(peak[0] + s * 2)} ${r(peak[1] + th * 0.25)} ${r(inner[0] + s * 3)} ${r(inner[1] + th * 0.75)} Z`;
		out.push(
			<g key={s}>
				<path d={d} fill={pal.brow} opacity={0.7} filter={url("blurS")} />
				<path d={d} fill={pal.brow} opacity={0.85} />
				{detail > 0 &&
					Array.from({ length: 9 }, (_, i) => {
						const k = i / 8;
						const x = inner[0] + (outer[0] - inner[0]) * k;
						const y = inner[1] + (peak[1] - inner[1]) * Math.sin(Math.min(1, k * 1.5) * Math.PI * 0.5) * (k < 0.66 ? 1 : 1 - (k - 0.66) * 1.5) + th * 0.35;
						const len = (1 - k * 0.6) * th * 1.3 + 1.5;
						return <path key={i} d={`M${r(x)} ${r(y)} l${r(s * len * 0.9)} ${r(-len * (0.7 + rng.range(-0.15, 0.15)))}`} stroke={i % 3 === 0 ? mix(pal.brow, "#fff", 0.25) : mix(pal.brow, "#000", 0.35)} strokeWidth={0.7} opacity={0.75} strokeLinecap="round" />;
					})}
			</g>,
		);
	}
	// frown lines between the brows
	if (t.expression === "angry" || t.expression === "stern" || t.age > 0.6) {
		const k = t.expression === "angry" ? 0.55 : t.expression === "stern" ? 0.35 : 0.25;
		out.push(<path key="glabella" d={`M${CX - 2.5} ${r(browY - 1)} q-0.6 4 0.4 7 M${CX + 2.5} ${r(browY - 1)} q0.6 4 -0.4 7`} stroke={pal.skinLine} strokeWidth={0.8} fill="none" opacity={k} />);
	}
	return out;
}

export function eyes(c: Ctx): ReactNode {
	const { rig, pal, t, f, url, id, detail } = c;
	const { eyeSpacing: es, ew, eyeY, up, lo, draconic } = rig;
	const solid = f.has("solid_eyes");
	const out: ReactNode[] = [];
	const lash = mix(pal.hairDark, "#140c0a", 0.55);
	for (const s of [-1, 1] as const) {
		if (c.acc === "eyepatch" && s === 1) continue;
		const ex = CX + s * es;
		const ey = eyeY;
		const tilt = rig.eyeTilt * 0.45;
		const I: P = [ex - s * ew, ey + 0.6];
		const O: P = [ex + s * ew, ey - tilt];
		const smirkSquint = t.expression === "smirk" && s > 0 ? 0.85 : 1;
		const u = up * smirkSquint;
		const shape = `M${r(I[0])} ${r(I[1])} C${r(I[0] + s * ew * 0.35)} ${r(ey - u * 1.25)} ${r(O[0] - s * ew * 0.55)} ${r(ey - u * 1.35 - tilt * 0.5)} ${r(O[0])} ${r(O[1])} C${r(O[0] - s * ew * 0.35)} ${r(ey + lo * 1.2)} ${r(I[0] + s * ew * 0.5)} ${r(ey + lo * 1.3)} ${r(I[0])} ${r(I[1])} Z`;
		const upperLid = `M${r(I[0] - s * 0.4)} ${r(I[1] + 0.2)} C${r(I[0] + s * ew * 0.35)} ${r(ey - u * 1.25)} ${r(O[0] - s * ew * 0.55)} ${r(ey - u * 1.35 - tilt * 0.5)} ${r(O[0] + s * 0.6)} ${r(O[1] + 0.3)}`;
		const crease = `M${r(I[0] + s * 1.2)} ${r(ey - u * 0.7)} C${r(I[0] + s * ew * 0.4)} ${r(ey - u * 1.9 - 1.5)} ${r(O[0] - s * ew * 0.5)} ${r(ey - u * 1.9 - 1.8 - tilt * 0.5)} ${r(O[0] + s * 0.5)} ${r(O[1] - u * 0.6)}`;
		const lowerLid = `M${r(I[0] + s * 1.5)} ${r(ey + 1.6)} C${r(I[0] + s * ew * 0.6)} ${r(ey + lo * 1.4 + 0.8)} ${r(O[0] - s * ew * 0.4)} ${r(ey + lo * 1.3 + 0.6)} ${r(O[0] - s * 0.6)} ${r(O[1] + 0.6)}`;
		const ir = draconic ? ew * 0.82 : ew * 0.52;
		const ix = ex + s * 0.3;
		const iy = ey - u * 0.32;
		const clip = `eye${s}`;
		out.push(
			<g key={s}>
				<clipPath id={id(clip)}>
					<path d={shape} />
				</clipPath>
				<path d={shape} fill={solid ? pal.eye : draconic ? mix(pal.eye, "#f8e8a0", 0.25) : mix("#ece2d6", pal.skin, 0.18)} />
				<g clipPath={url(clip)}>
					{!solid && !draconic && (
						<>
							<circle cx={r(ix)} cy={r(iy)} r={r(ir)} fill={pal.eye} />
							<circle cx={r(ix)} cy={r(iy)} r={r(ir)} fill={url("iris")} />
							<circle cx={r(ix)} cy={r(iy)} r={r(ir * 0.4)} fill="#0b0807" />
							<circle cx={r(ix)} cy={r(iy)} r={r(ir)} fill="none" stroke={mix(pal.eye, "#000", 0.6)} strokeWidth={0.7} opacity={0.8} />
						</>
					)}
					{draconic && (
						<>
							<circle cx={r(ix)} cy={r(iy)} r={r(ir)} fill={pal.eye} />
							<circle cx={r(ix)} cy={r(iy)} r={r(ir)} fill={url("iris")} />
							<ellipse cx={r(ix)} cy={r(iy)} rx={1.2} ry={r(ir * 0.85)} fill="#0b0807" />
						</>
					)}
					{solid && <ellipse cx={r(ex)} cy={r(ey - 0.5)} rx={r(ew * 0.7)} ry={r(lo + 1)} fill={mix(pal.eye, "#ffffff", 0.55)} opacity={0.7} filter={url("blurS")} />}
					{/* upper lid casts a shadow on the eyeball */}
					<path d={upperLid} stroke="#2a1410" strokeWidth={3.2} fill="none" opacity={solid ? 0.25 : 0.45} filter={url("blurS")} transform="translate(0 1.2)" />
					<ellipse cx={r(O[0])} cy={r(ey)} rx={3} ry={4} fill={pal.skinDeep} opacity={0.3} filter={url("blurS")} />
				</g>
				{!solid && (
					<>
						<circle cx={r(ix - ir * 0.32)} cy={r(iy - ir * 0.3)} r={r(Math.max(0.7, ir * 0.2))} fill="#fffaf2" opacity={0.95} />
						{detail > 1 && <circle cx={r(ix + ir * 0.35)} cy={r(iy + ir * 0.35)} r={0.5} fill="#fffaf2" opacity={0.5} />}
					</>
				)}
				{solid && <ellipse cx={r(ex)} cy={r(ey - 1)} rx={r(ew * 1.3)} ry={r(lo + 3)} fill={pal.eye} opacity={0.35} filter={url("blurM")} />}
				{/* tear duct */}
				{!draconic && <ellipse cx={r(I[0] + s * 1.2)} cy={r(I[1] + 0.2)} rx={1.1} ry={0.8} fill={mix(pal.skin, "#c86070", 0.4)} opacity={0.7} />}
				{/* lid crease and lid skin */}
				<path d={crease} stroke={pal.skinLine} strokeWidth={t.eye === "hooded" ? 1.4 : 0.9} fill="none" opacity={t.eye === "hooded" ? 0.55 : 0.4} />
				<path d={crease} stroke={pal.skinLight} strokeWidth={1} fill="none" opacity={0.25} transform="translate(0 -1.3)" />
				{/* lash line */}
				<path d={upperLid} stroke={lash} strokeWidth={t.female ? 1.8 : 1.4} fill="none" strokeLinecap="round" />
				<path d={`M${r(ex + s * ew * 0.1)} ${r(ey - u * 1.05)} Q${r(O[0] - s * ew * 0.3)} ${r(ey - u * 1.1 - tilt * 0.5)} ${r(O[0] + s * 0.6)} ${r(O[1] + 0.3)}`} stroke={lash} strokeWidth={t.female ? 2.4 : 1.8} fill="none" strokeLinecap="round" />
				{t.female && <path d={`M${r(O[0])} ${r(O[1])} l${r(s * 2.6)} -1.6 M${r(O[0] - s * 2)} ${r(O[1] - u * 0.45)} l${r(s * 1.8)} -2`} stroke={lash} strokeWidth={0.9} strokeLinecap="round" />}
				{/* lower lid: wet line + soft shadow */}
				<path d={lowerLid} stroke={mix(pal.skin, "#d08080", 0.35)} strokeWidth={0.9} fill="none" opacity={0.7} />
				<path d={lowerLid} stroke={pal.skinDeep} strokeWidth={1.4} fill="none" opacity={0.3} transform="translate(0 1.4)" filter={url("blurS")} />
				{t.expression === "smile" && <path d={lowerLid} stroke={pal.skinLine} strokeWidth={0.7} fill="none" opacity={0.35} transform="translate(0 3)" />}
				{t.age > 0.5 && <path d={lowerLid} stroke={pal.skinLine} strokeWidth={0.7} fill="none" opacity={r((t.age - 0.5) * 1)} transform="translate(0 4.2)" />}
				{(t.age > 0.55 || (t.expression === "smile" && t.age > 0.3)) &&
					[0, 1, 2].map((k) => (
						<path key={k} d={`M${r(O[0] + s * 2.5)} ${r(O[1] - 1 + k * 2.6)} l${r(s * (4 - k * 0.6))} ${r(-1.6 + k * 1.6)}`} stroke={pal.skinLine} strokeWidth={0.6} opacity={r(0.2 + Math.max(0, t.age - 0.5))} strokeLinecap="round" />
					))}
			</g>,
		);
	}
	return out;
}

export function nose(c: Ctx): ReactNode {
	const { rig, pal, t } = c;
	if (rig.draconic) return null;
	const { noseW: nw, noseBottom: nb } = rig;
	const form = t.noseForm;
	const tipDrop = form === "long" || form === "hooked" ? 2 : 0;
	const flare = form === "broad" || form === "flat" ? 1.2 : form === "snub" || form === "button" ? 0.9 : 1;
	const nostril = (s: number) => (
		<ellipse key={s} cx={r(CX + s * nw * 0.42)} cy={r(nb - 0.6)} rx={r(nw * (form === "snub" ? 0.25 : 0.2) * flare)} ry={form === "snub" || form === "button" ? 1.6 : 1.25} fill={mix(pal.skinDeep, "#1a0608", 0.35)} opacity={0.9} transform={`rotate(${s * 14} ${r(CX + s * nw * 0.42)} ${r(nb - 0.6)})`} />
	);
	const wing = (s: number) => (
		<path key={`w${s}`} d={`M${r(CX + s * nw * 0.5)} ${r(nb - 7.5)} C${r(CX + s * nw * 1.12 * flare)} ${r(nb - 7)} ${r(CX + s * nw * 1.15 * flare)} ${r(nb - 0.8)} ${r(CX + s * nw * 0.62)} ${r(nb + 0.2)}`} stroke={pal.skinDeep} strokeWidth={1.3} fill="none" opacity={s > 0 ? 0.8 : 0.6} strokeLinecap="round" />
	);
	return (
		<g>
			{wing(-1)}
			{wing(1)}
			{nostril(-1)}
			{nostril(1)}
			{/* underside of the tip */}
			<path d={`M${r(CX - nw * 0.3)} ${r(nb - 0.6 + tipDrop)} Q${CX} ${r(nb + 1.1 + tipDrop)} ${r(CX + nw * 0.3)} ${r(nb - 0.6 + tipDrop)}`} stroke={pal.skinShadow} strokeWidth={1} fill="none" opacity={0.6} />
			{(form === "hooked" || form === "aquiline") && <path d={`M${CX + 1.5} ${r(rig.eyeY + 6)} q2.2 5 0.6 10`} stroke={pal.skinLine} strokeWidth={0.6} fill="none" opacity={0.35} />}
		</g>
	);
}

const MOUTH: Record<string, { l: number; r: number; mid: number; press: number }> = {
	neutral: { l: 0, r: 0, mid: 0.6, press: 1 },
	smile: { l: -2.8, r: -2.8, mid: 1.4, press: 0.95 },
	smirk: { l: 0.4, r: -2.6, mid: 0.6, press: 0.95 },
	stern: { l: 1, r: 1, mid: 0, press: 0.72 },
	angry: { l: 2.2, r: 2.2, mid: -0.4, press: 0.7 },
	worried: { l: 1.4, r: 1.2, mid: 0.2, press: 0.85 },
	sad: { l: 2.8, r: 2.8, mid: -0.3, press: 0.92 },
};

export function mouth(c: Ctx): ReactNode {
	const { rig, pal, t, url } = c;
	if (rig.draconic) return null;
	const m = MOUTH[t.expression] ?? MOUTH.neutral;
	const mw = rig.mw;
	const y = rig.mouthY;
	const full = t.lipFullness * (t.female ? 1.18 : 1) * (1 - Math.max(0, t.age - 0.6) * 0.5);
	const uh = 3.1 * full * m.press;
	const lh = 4 * full * m.press;
	const L: P = [CX - mw, y + m.l];
	const R: P = [CX + mw, y + m.r];
	const midY = y + m.mid;
	const slit = `M${r(L[0])} ${r(L[1])} C${r(CX - mw * 0.55)} ${r(midY + (m.l < 0 ? 0.6 : -0.2))} ${r(CX - mw * 0.25)} ${r(midY)} ${CX} ${r(midY - 0.1)} C${r(CX + mw * 0.25)} ${r(midY)} ${r(CX + mw * 0.55)} ${r(midY + (m.r < 0 ? 0.6 : -0.2))} ${r(R[0])} ${r(R[1])}`;
	const upper = `${slit} C${r(CX + mw * 0.7)} ${r(R[1] - uh * 0.5)} ${r(CX + mw * 0.36)} ${r(y - uh * 1.05)} ${r(CX + mw * 0.24)} ${r(y - uh)} Q${r(CX + 1.5)} ${r(y - uh * 1.02)} ${CX} ${r(y - uh * 0.7)} Q${r(CX - 1.5)} ${r(y - uh * 1.02)} ${r(CX - mw * 0.24)} ${r(y - uh)} C${r(CX - mw * 0.36)} ${r(y - uh * 1.05)} ${r(CX - mw * 0.7)} ${r(L[1] - uh * 0.5)} ${r(L[0])} ${r(L[1])} Z`;
	const lower = `${slit} C${r(CX + mw * 0.75)} ${r(midY + lh * 0.9)} ${r(CX + mw * 0.3)} ${r(midY + lh * 1.25)} ${CX} ${r(midY + lh * 1.2)} C${r(CX - mw * 0.3)} ${r(midY + lh * 1.25)} ${r(CX - mw * 0.75)} ${r(midY + lh * 0.9)} ${r(L[0])} ${r(L[1])} Z`;
	return (
		<g>
			<path d={lower} fill={mix(pal.lip, "#ffffff", 0.04)} />
			<path d={upper} fill={mix(pal.lip, "#3a1018", 0.18)} />
			<ellipse cx={CX - 2} cy={r(midY + lh * 0.55)} rx={r(mw * 0.36)} ry={r(lh * 0.28)} fill={mix(pal.lip, "#fff4f0", 0.4)} opacity={0.55} filter={url("blurS")} />
			<path d={lower} fill="none" stroke={pal.lip} strokeWidth={0.6} opacity={0.4} />
			<path d={slit} stroke={mix(pal.lip, "#1a0608", 0.62)} strokeWidth={1.1} fill="none" strokeLinecap="round" />
			{/* corner pits */}
			<circle cx={r(L[0] - 0.6)} cy={r(L[1] + 0.2)} r={1.3} fill={pal.skinDeep} opacity={0.45} filter={url("blurS")} />
			<circle cx={r(R[0] + 0.6)} cy={r(R[1] + 0.2)} r={1.3} fill={pal.skinDeep} opacity={0.55} filter={url("blurS")} />
			{/* philtrum */}
			<path d={`M${CX - 2} ${r(rig.noseBottom + 2)} L${r(CX - 2.6)} ${r(y - uh - 0.4)} M${CX + 2} ${r(rig.noseBottom + 2)} L${r(CX + 2.6)} ${r(y - uh - 0.4)}`} stroke={pal.skinShadow} strokeWidth={0.8} opacity={0.35} />
			{(t.expression === "smile" || t.expression === "smirk") && (
				<path d={`M${r(R[0] + 1)} ${r(R[1] - 1)} q1.6 1.4 0.8 3.6`} stroke={pal.skinLine} strokeWidth={0.7} fill="none" opacity={0.4} />
			)}
			{t.expression === "smile" && <path d={`M${r(L[0] - 1)} ${r(L[1] - 1)} q-1.6 1.4 -0.8 3.6`} stroke={pal.skinLine} strokeWidth={0.7} fill="none" opacity={0.4} />}
		</g>
	);
}

/** Wrinkles: a dark crease with a lit edge under it. */
export function ageLines(c: Ctx): ReactNode {
	const { rig, pal, t } = c;
	if (rig.draconic || t.age < 0.5) return null;
	const k = Math.min(1, (t.age - 0.5) / 0.4);
	const { w, browY, top, mw, mouthY, chin, H } = rig;
	const lines: string[] = [];
	const forehead = t.expression === "worried" || t.expression === "sad" ? 4 : 3;
	for (let i = 0; i < forehead; i++) {
		const y = browY - 9 - i * 5.5;
		if (y < top + H * 0.2) break;
		const span = w * (0.5 - i * 0.05);
		lines.push(`M${r(CX - span)} ${r(y + 1.5)} Q${CX} ${r(y - 2.5)} ${r(CX + span)} ${r(y + 1.5)}`);
	}
	// marionette lines + jowls
	if (t.age > 0.7) {
		lines.push(`M${r(CX - mw - 1)} ${r(mouthY + 3)} q-1.5 6 -0.5 10`, `M${r(CX + mw + 1)} ${r(mouthY + 3)} q1.5 6 0.5 10`);
		lines.push(`M${r(CX - rig.jaw + 2)} ${r(rig.jawY + 2)} q4 6 10 7`, `M${r(CX + rig.jaw - 2)} ${r(rig.jawY + 2)} q-4 6 -10 7`);
		lines.push(`M${CX - 5} ${r(chin - 4)} q5 2 10 0`);
	}
	const d = lines.join(" ");
	return (
		<g fill="none" strokeLinecap="round">
			<path d={d} stroke={pal.skinLine} strokeWidth={0.75} opacity={r(0.22 + k * 0.3)} />
			<path d={d} stroke={pal.skinLight} strokeWidth={0.8} opacity={r(0.15 + k * 0.2)} transform="translate(0 1.1)" />
		</g>
	);
}

/** Beards, mustaches, stubble. */
export function facialHair(c: Ctx): ReactNode {
	const { rig, pal, t, spec, url, detail } = c;
	const fh = spec.facialHair ?? "none";
	if (rig.draconic || fh === "none" || t.female) return null;
	const rng = subRng(spec, "beard");
	const { w, jaw, jawY, chin, mouthY: my, mw, eyeY, browY, noseBottom } = rig;
	const mUp = (MOUTH[t.expression] ?? MOUTH.neutral);
	const mustache = (
		<g>
			<path
				d={`M${CX} ${r(noseBottom + 2.5)} C${r(CX - 6)} ${r(noseBottom + 1)} ${r(CX - mw - 1)} ${r(my - 5)} ${r(CX - mw - 4)} ${r(my + 3 + mUp.l * 0.5)} C${r(CX - mw - 1)} ${r(my - 0.5)} ${r(CX - 7)} ${r(my - 2.4)} ${CX} ${r(my - 2.2)} C${r(CX + 7)} ${r(my - 2.4)} ${r(CX + mw + 1)} ${r(my - 0.5)} ${r(CX + mw + 4)} ${r(my + 3 + mUp.r * 0.5)} C${r(CX + mw + 1)} ${r(my - 5)} ${r(CX + 6)} ${r(noseBottom + 1)} ${CX} ${r(noseBottom + 2.5)} Z`}
				fill={url("hair")}
			/>
			{detail > 0 &&
				Array.from({ length: 10 }, (_, i) => {
					const s = i % 2 ? 1 : -1;
					const k = Math.floor(i / 2) / 5;
					return <path key={i} d={`M${r(CX + s * (1 + k * mw))} ${r(noseBottom + 2.5 + k * 2)} q${r(s * 2)} 2 ${r(s * 3)} ${r(4.5 + k * 1.5)}`} stroke={i % 3 ? pal.hairDark : pal.hairLight} strokeWidth={0.6} fill="none" opacity={0.6} />;
				})}
		</g>
	);
	if (fh === "mustache") return mustache;
	if (fh === "sideburns") {
		return [-1, 1].map((s) => (
			<path key={s} d={`M${r(CX + s * (w - 0.5))} ${r(browY - 2)} L${r(CX + s * (w + 0.5))} ${r(eyeY + 20)} Q${r(CX + s * (w - 4))} ${r(eyeY + 26)} ${r(CX + s * (w - 8))} ${r(eyeY + 22)} L${r(CX + s * (w - 6))} ${r(browY - 2)} Z`} fill={url("hair")} opacity={0.95} />
		));
	}
	if (fh === "goatee") {
		return (
			<g>
				<path d={`M${r(CX - mw * 0.75)} ${r(my + 5)} Q${CX} ${r(my + 8.5)} ${r(CX + mw * 0.75)} ${r(my + 5)} C${r(CX + mw * 0.8)} ${r(chin - 2)} ${CX + 6} ${chin + 7} ${CX} ${chin + 8} C${CX - 6} ${chin + 7} ${r(CX - mw * 0.8)} ${r(chin - 2)} ${r(CX - mw * 0.75)} ${r(my + 5)} Z`} fill={url("hair")} />
				{detail > 0 && Array.from({ length: 6 }, (_, i) => <path key={i} d={`M${r(CX - 5 + i * 2)} ${r(my + 7)} q${r(rng.range(-1, 1))} 6 ${r((i - 2.5) * 0.4)} ${r(chin + 4 - my)}`} stroke={i % 2 ? pal.hairDark : pal.hairLight} strokeWidth={0.6} fill="none" opacity={0.55} />)}
				{mustache}
			</g>
		);
	}
	const drop = fh === "stubble" ? 0 : fh === "short_beard" ? 7 : fh === "full_beard" ? 32 : 24;
	const grow = fh === "stubble" ? 0 : fh === "short_beard" ? 2.5 : 8;
	const outer: P[] = [
		[CX + w - 1, browY + 2],
		[CX + w + grow * 0.3, eyeY + 14],
		[CX + (w + jaw) / 2 + 2 + grow * 0.6, my - 6],
		[CX + jaw + grow, jawY + drop * 0.25],
		[CX + jaw * 0.6 + grow * 0.6, chin + drop * 0.7],
		[CX, chin + drop + 2],
	];
	const innerR: P[] = [
		[CX + mw + 3, my + 6],
		[CX + mw + 5.5, my - 3],
		[CX + w * 0.62, eyeY + 18 - (fh === "stubble" ? 0 : 1)],
		[CX + w - 5, browY + 4],
	];
	const outerL = outer.slice(0, -1).reverse().map(([x, y]) => [2 * CX - x, y] as P);
	const innerL = innerR.slice().reverse().map(([x, y]) => [2 * CX - x, y] as P);
	const pts: P[] = [...outer, ...outerL, ...innerL, [CX, my + 6.5], ...innerR];
	const d = smoothPath(pts, true, 0.8);
	if (fh === "stubble") {
		return (
			<g>
				<path d={d} fill={pal.hairDark} opacity={0.2} filter={url("blurS")} />
				{detail > 1 && <path d={d} fill={pal.hairDark} opacity={0.35} filter={url("grain")} />}
				<path d={`M${CX} ${r(noseBottom + 2.5)} C${CX - 8} ${r(noseBottom + 2)} ${r(CX - mw - 2)} ${r(my - 5)} ${r(CX - mw - 2)} ${r(my)} L${r(CX + mw + 2)} ${r(my)} C${r(CX + mw + 2)} ${r(my - 5)} ${CX + 8} ${r(noseBottom + 2)} ${CX} ${r(noseBottom + 2.5)} Z`} fill={pal.hairDark} opacity={0.18} filter={url("blurS")} />
			</g>
		);
	}
	// fringe of tips along the bottom edge
	const strands = detail > 0 ? 22 : 0;
	return (
		<g>
			<path d={d} fill={url("hair")} />
			<path d={d} fill="none" stroke={pal.hairDark} strokeWidth={1} opacity={0.4} />
			<clipPath id={c.id("beard")}>
				<path d={d} />
			</clipPath>
			<g clipPath={url("beard")}>
				<ellipse cx={CX + 10} cy={r(chin + drop * 0.4)} rx={r(jaw + 4)} ry={r(10 + drop * 0.5)} fill={pal.hairDark} opacity={0.45} filter={url("blurM")} />
				<ellipse cx={CX - 8} cy={r(my + 10)} rx={10} ry={5} fill={pal.hairSheen} opacity={0.3} filter={url("blurM")} />
				{Array.from({ length: strands }, (_, i) => {
					const a = -1 + (2 * i) / (strands - 1);
					const x0 = CX + a * (jaw + grow * 0.5);
					const y0 = my - 4 + Math.abs(a) * -10;
					const x1 = CX + a * (jaw * 0.4) + rng.range(-3, 3);
					const y1 = chin + drop * (1 - Math.abs(a) * 0.5) + rng.range(-4, 2);
					return <path key={i} d={`M${r(x0)} ${r(y0)} Q${r(x0 + a * 4)} ${r((y0 + y1) / 2)} ${r(x1)} ${r(y1)}`} stroke={i % 3 === 0 ? pal.hairLight : pal.hairDark} strokeWidth={i % 3 === 0 ? 0.7 : 1} fill="none" opacity={0.5} />;
				})}
			</g>
			{fh === "braided_beard" && (
				<g>
					{Array.from({ length: 4 }, (_, i) => (
						<ellipse key={i} cx={CX} cy={r(chin + drop + 2 + i * 7.5)} rx={r(6 - i * 0.5)} ry={4.8} fill={i % 2 ? pal.hairDark : url("hair")} stroke={pal.hairDark} strokeWidth={0.6} />
					))}
					<rect x={CX - 5} y={r(chin + drop - 2)} width={10} height={3.6} rx={1} fill={url("gold")} />
					<rect x={CX - 4} y={r(chin + drop + 30)} width={8} height={3.6} rx={1} fill={url("gold")} />
				</g>
			)}
			{mustache}
		</g>
	);
}

export function freckles(c: Ctx): ReactNode {
	const { rig, pal, f, detail } = c;
	if (!f.has("freckles") || detail === 0) return null;
	const rng = subRng(c.spec, "freckles");
	return (
		<g fill={mix(pal.skin, "#5a2a14", 0.45)} opacity={0.5}>
			{Array.from({ length: 26 }, (_, i) => {
				const s = i % 2 ? 1 : -1;
				const x = CX + s * rng.range(2, rig.w * 0.62);
				const y = rig.eyeY + rng.range(5, 16) - (Math.abs(x - CX) < 6 ? 2 : 0);
				return <circle key={i} cx={r(x)} cy={r(y)} r={r(rng.range(0.4, 0.95))} />;
			})}
		</g>
	);
}
