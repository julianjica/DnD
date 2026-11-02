import type { ReactNode } from "react";
import { CX } from "./rig";
import { r, type Ctx } from "./ctx";

/* Neck, shoulders and upper chest (skin). Clothing is drawn over this. */

/** Shoulder outline on side s (= ±1): neck point, trapezius curve, deltoid, off-frame bottom. */
function shoulderPts(c: Ctx, s: 1 | -1, grow: number) {
	const { neckW: nw, collarY, shW, shY } = c.rig;
	const x = (dx: number) => r(CX + s * dx);
	return {
		A: `${x(nw + 8 + grow)} ${r(collarY - 4 - grow * 0.4)}`,
		C1: `${x(shW * 0.55 + grow)} ${r(shY - 12 - grow)}`,
		C2: `${x(shW + grow)} ${r(shY - 3 - grow)}`,
		B: `${x(shW + 7 + grow)} ${r(shY + 14)}`,
		E: `${x(shW + 15 + grow)} 252`,
	};
}

/** Path fragment from the neck outward and down off-frame (starts with L). */
export function shoulderOut(c: Ctx, s: 1 | -1, grow = 0): string {
	const p = shoulderPts(c, s, grow);
	return `L${p.A} C${p.C1} ${p.C2} ${p.B} L${p.E}`;
}

/** Path fragment from off-frame bottom back up to the neck (starts with L). */
export function shoulderIn(c: Ctx, s: 1 | -1, grow = 0): string {
	const p = shoulderPts(c, s, grow);
	return `L${p.E} L${p.B} C${p.C2} ${p.C1} ${p.A}`;
}

/** Torso garment outline: neckline from (±open, y) with a center dip, out over the shoulders. */
export function torsoPath(c: Ctx, open: number, dip: number, grow = 1.5, neckY?: number): string {
	const { neckW: nw, collarY } = c.rig;
	const y = neckY ?? collarY - 4;
	return `M${r(CX - nw - open)} ${r(y)} Q${CX} ${r(y + dip)} ${r(CX + nw + open)} ${r(y)} ${shoulderOut(c, 1, grow)} ${shoulderIn(c, -1, grow)} Z`;
}

export function body(c: Ctx): ReactNode {
	const { rig, pal, url, t } = c;
	const { neckW: nw, neckTop, collarY, chin, jaw } = rig;
	const d = `M${r(CX - nw)} ${r(neckTop)} C${r(CX - nw + 0.5)} ${r(collarY - 16)} ${r(CX - nw - 1)} ${r(collarY - 9)} ${r(CX - nw - 8)} ${r(collarY - 4)} ${shoulderOut(c, -1)} ${shoulderIn(c, 1)} C${r(CX + nw + 1)} ${r(collarY - 9)} ${r(CX + nw - 0.5)} ${r(collarY - 16)} ${r(CX + nw)} ${r(neckTop)} Z`;
	const tendons = t.age > 0.6 || t.build === "slim";
	return (
		<g>
			<path d={d} fill={url("skinBody")} />
			<g clipPath={url("body")}>
				<g filter={url("blurM")}>
					{/* cast shadow of the jaw */}
					<path d={`M${r(CX - jaw - 4)} ${r(neckTop - 4)} Q${CX + 4} ${r(chin + 16)} ${r(CX + jaw + 6)} ${r(neckTop - 4)} L${r(CX + jaw + 6)} ${r(chin + 2)} Q${CX + 6} ${r(chin + 24)} ${r(CX - jaw - 4)} ${r(chin + 2)} Z`} fill={pal.skinDeep} opacity={0.95} />
					{/* shadow side of the neck */}
					<rect x={r(CX + nw * 0.35)} y={r(neckTop)} width={r(nw)} height={r(collarY - neckTop + 6)} fill={pal.skinShadow} opacity={0.6} />
					{/* sternocleidomastoid + pit of the throat */}
					<path d={`M${r(CX - nw + 2)} ${r(neckTop + 2)} L${r(CX - 4)} ${r(collarY + 2)} M${r(CX + nw - 2)} ${r(neckTop + 2)} L${r(CX + 4)} ${r(collarY + 2)}`} stroke={pal.skinShadow} strokeWidth={tendons ? 2.4 : 1.6} opacity={tendons ? 0.55 : 0.32} />
					<ellipse cx={CX} cy={r(collarY + 2)} rx={4} ry={3} fill={pal.skinDeep} opacity={0.45} />
					<ellipse cx={r(CX - nw * 0.5)} cy={r(collarY - 10)} rx={r(nw * 0.35)} ry={8} fill={pal.skinLight} opacity={0.35} />
					{/* collarbones */}
					<path d={`M${CX - 6} ${r(collarY + 6)} Q${r(CX - 22)} ${r(collarY + 4)} ${r(CX - nw - 26)} ${r(collarY + 8)} M${CX + 6} ${r(collarY + 6)} Q${r(CX + 22)} ${r(collarY + 4)} ${r(CX + nw + 26)} ${r(collarY + 8)}`} stroke={pal.skinLight} strokeWidth={2} fill="none" opacity={0.4} />
					<path d={`M${CX - 6} ${r(collarY + 9)} Q${r(CX - 22)} ${r(collarY + 7)} ${r(CX - nw - 26)} ${r(collarY + 11)} M${CX + 6} ${r(collarY + 9)} Q${r(CX + 22)} ${r(collarY + 7)} ${r(CX + nw + 26)} ${r(collarY + 11)}`} stroke={pal.skinShadow} strokeWidth={2} fill="none" opacity={0.4} />
				</g>
				{t.age > 0.7 && <path d={`M${r(CX - nw + 4)} ${r(neckTop + 12)} q${r(nw - 4)} 3 ${r(2 * nw - 8)} 0 M${r(CX - nw + 5)} ${r(neckTop + 18)} q${r(nw - 5)} 3 ${r(2 * nw - 10)} 0`} stroke={pal.skinLine} strokeWidth={0.6} fill="none" opacity={0.35} />}
			</g>
			<clipPath id={c.id("body")}>
				<path d={d} />
			</clipPath>
		</g>
	);
}
