import type { ReactNode } from "react";
import { mix } from "@/lib/art/color";
import { CX } from "./rig";
import { r, type Ctx } from "./ctx";
import { torsoPath } from "./body";

/* Clothing by style: tunic (+apron), armor (plate / mail / brigandine), robe (+stole, hood down),
 * leather jerkin, cloak (+fur), noble doublet. All share the light from the upper left. */

export function clothing(c: Ctx): ReactNode {
	const style = c.t.clothingStyle;
	const v = c.t.variant;
	switch (style) {
		case "armor":
			return v % 3 === 0 ? plate(c) : v % 3 === 1 ? mail(c) : brigandine(c);
		case "robe":
			return robe(c);
		case "leather":
			return leather(c);
		case "cloak":
			return cloak(c);
		case "noble":
			return noble(c);
		default:
			return tunic(c);
	}
}

/** Shared fabric shading over a torso path. */
function fabric(c: Ctx, d: string, key: string, fill: string, opts: { folds?: boolean; dark?: string; light?: string } = {}): ReactNode {
	const { rig, pal, url, id } = c;
	const { neckW: nw, collarY, shW, shY } = rig;
	const dark = opts.dark ?? pal.clothDark;
	const light = opts.light ?? pal.clothLight;
	return (
		<g key={key}>
			<path d={d} fill={fill} />
			<clipPath id={id(`fab-${key}`)}>
				<path d={d} />
			</clipPath>
			<g clipPath={url(`fab-${key}`)}>
				<g filter={url("blurM")}>
					<path d={`M${r(CX - shW - 10)} ${r(shY - 6)} Q${r(CX - shW * 0.6)} ${r(shY - 14)} ${r(CX - nw - 8)} ${r(collarY)}`} stroke={light} strokeWidth={7} fill="none" opacity={0.45} />
					<rect x={r(CX + shW * 0.35)} y={r(collarY - 10)} width={r(shW)} height={80} fill={dark} opacity={0.5} />
					<ellipse cx={CX + 4} cy={r(collarY + 4)} rx={r(nw + 10)} ry={7} fill={dark} opacity={0.55} />
					{opts.folds !== false && (
						<path d={`M${r(CX - shW * 0.45)} 250 Q${r(CX - shW * 0.5)} ${r(shY + 10)} ${r(CX - shW * 0.7)} ${r(shY)} M${r(CX + shW * 0.45)} 250 Q${r(CX + shW * 0.5)} ${r(shY + 10)} ${r(CX + shW * 0.72)} ${r(shY)} M${r(CX - 12)} 250 Q${r(CX - 16)} ${r(collarY + 24)} ${r(CX - 24)} ${r(collarY + 10)}`} stroke={dark} strokeWidth={4} fill="none" opacity={0.45} />
					)}
				</g>
				{/* rim light on the shadow-side shoulder */}
				<path d={`M${r(CX + shW + 10)} 240 Q${r(CX + shW + 4)} ${r(shY)} ${r(CX + shW * 0.6)} ${r(shY - 10)}`} stroke={pal.accentLight} strokeWidth={2.4} fill="none" opacity={0.35} filter={url("blurS")} />
			</g>
			<path d={d} fill="none" stroke={mix(dark, "#000", 0.4)} strokeWidth={0.8} opacity={0.6} />
		</g>
	);
}

function tunic(c: Ctx): ReactNode {
	const { rig, pal, url, t } = c;
	const { neckW: nw, collarY } = rig;
	const kind = t.variant % 3; // 0 laced V, 1 round + undershirt, 2 folded collar
	const apron = t.signature === "mug";
	const vDepth = kind === 0 ? 30 : 0;
	const out: ReactNode[] = [];
	out.push(fabric(c, torsoPath(c, 3, kind === 1 ? 7 : 4), "tunic", url("cloth")));
	if (kind === 0) {
		// V opening showing skin, with laces
		const v = `M${r(CX - nw + 2)} ${r(collarY - 4)} L${CX} ${r(collarY + vDepth)} L${r(CX + nw - 2)} ${r(collarY - 4)} Z`;
		out.push(
			<g key="v">
				<path d={v} fill={url("skinBody")} />
				<path d={v} fill={pal.skinDeep} opacity={0.35} />
				<path d={`M${r(CX - nw + 2)} ${r(collarY - 4)} L${CX} ${r(collarY + vDepth)} L${r(CX + nw - 2)} ${r(collarY - 4)}`} stroke={pal.trim} strokeWidth={2.2} fill="none" strokeLinejoin="round" />
				{[0.3, 0.55, 0.78].map((k, i) => {
					const y = collarY - 4 + vDepth * k;
					const hw = (nw - 2) * (1 - k);
					return <path key={i} d={`M${r(CX - hw - 1)} ${r(y - 2)} L${r(CX + hw + 1)} ${r(y + 3)} M${r(CX + hw + 1)} ${r(y - 2)} L${r(CX - hw - 1)} ${r(y + 3)}`} stroke={mix(pal.trim, "#3a2a1a", 0.4)} strokeWidth={0.9} />;
				})}
			</g>,
		);
	} else if (kind === 1) {
		out.push(<path key="under" d={`M${r(CX - nw - 2)} ${r(collarY - 4)} Q${CX} ${r(collarY + 4)} ${r(CX + nw + 2)} ${r(collarY - 4)} Q${CX} ${r(collarY + 10)} ${r(CX - nw - 2)} ${r(collarY - 4)} Z`} fill={mix("#d8cbb0", pal.cloth, 0.15)} stroke={mix("#8a7a60", pal.cloth, 0.2)} strokeWidth={0.6} />);
		out.push(<path key="hem" d={`M${r(CX - nw - 3)} ${r(collarY - 3)} Q${CX} ${r(collarY + 11)} ${r(CX + nw + 3)} ${r(collarY - 3)}`} stroke={pal.trim} strokeWidth={1.8} fill="none" opacity={0.85} />);
	} else {
		for (const s of [-1, 1] as const) {
			out.push(<path key={`col${s}`} d={`M${r(CX + s * (nw + 4))} ${r(collarY - 6)} L${r(CX + s * 2)} ${r(collarY + 8)} L${r(CX + s * (nw + 14))} ${r(collarY + 10)} Z`} fill={pal.clothLight} stroke={pal.clothDark} strokeWidth={0.7} />);
		}
	}
	if (apron) {
		const ap = `M${r(CX - nw - 4)} ${r(collarY + 18)} L${r(CX + nw + 4)} ${r(collarY + 18)} L${r(CX + nw + 10)} 252 L${r(CX - nw - 10)} 252 Z`;
		out.push(
			<g key="apron">
				<path d={`M${r(CX - nw - 2)} ${r(collarY + 19)} L${r(CX - nw + 1)} ${r(collarY - 4)} M${r(CX + nw + 2)} ${r(collarY + 19)} L${r(CX + nw - 1)} ${r(collarY - 4)}`} stroke="#c8b898" strokeWidth={3} />
				{fabric(c, ap, "apron", "#cbbd9f", { dark: "#6a5a44", light: "#f0e6d0", folds: false })}
				<ellipse cx={CX + 8} cy={r(collarY + 34)} rx={6} ry={4} fill="#8a6a4a" opacity={0.25} />
			</g>,
		);
	}
	return out;
}

function plate(c: Ctx): ReactNode {
	const { rig, pal, url } = c;
	const { neckW: nw, collarY, shW, shY } = rig;
	const out: ReactNode[] = [];
	out.push(fabric(c, torsoPath(c, 3, 3), "padding", url("cloth"), { folds: false }));
	// breastplate
	const bp = `M${r(CX - nw - 8)} ${r(collarY + 6)} Q${CX} ${r(collarY + 14)} ${r(CX + nw + 8)} ${r(collarY + 6)} L${r(CX + nw + 22)} 252 L${r(CX - nw - 22)} 252 Z`;
	out.push(
		<g key="bp">
			<path d={bp} fill={url("metal")} />
			<path d={`M${CX} ${r(collarY + 12)} L${CX} 252`} stroke="#f2f4f6" strokeWidth={1.4} opacity={0.5} />
			<path d={`M${CX + 1.4} ${r(collarY + 12)} L${CX + 1.4} 252`} stroke="#1a1c20" strokeWidth={1} opacity={0.5} />
			<path d={bp} fill="none" stroke="#14161a" strokeWidth={1} />
			<path d={`M${r(CX - nw - 7)} ${r(collarY + 8)} Q${CX} ${r(collarY + 16)} ${r(CX + nw + 7)} ${r(collarY + 8)}`} stroke={pal.trim} strokeWidth={1.6} fill="none" />
		</g>,
	);
	// gorget
	out.push(
		<g key="gorget">
			<path d={`M${r(CX - nw - 4)} ${r(collarY - 8)} Q${CX} ${r(collarY - 2)} ${r(CX + nw + 4)} ${r(collarY - 8)} L${r(CX + nw + 10)} ${r(collarY + 6)} Q${CX} ${r(collarY + 15)} ${r(CX - nw - 10)} ${r(collarY + 6)} Z`} fill={url("metal")} stroke="#14161a" strokeWidth={0.9} />
			<path d={`M${r(CX - nw - 6)} ${r(collarY - 2)} Q${CX} ${r(collarY + 5)} ${r(CX + nw + 6)} ${r(collarY - 2)}`} stroke="#14161a" strokeWidth={0.7} fill="none" opacity={0.7} />
		</g>,
	);
	// pauldrons: layered lames
	for (const s of [-1, 1] as const) {
		const lames: ReactNode[] = [];
		for (let i = 2; i >= 0; i--) {
			const ox = CX + s * (shW * 0.72 + i * 4);
			const oy = shY - 6 + i * 11;
			const rx = shW * 0.42 - i * 2;
			lames.push(
				<g key={i}>
					<path d={`M${r(ox - rx)} ${r(oy + 10)} Q${r(ox - rx * 0.9)} ${r(oy - 16)} ${r(ox)} ${r(oy - 16)} Q${r(ox + rx * 0.95)} ${r(oy - 16)} ${r(ox + rx)} ${r(oy + 10)} Q${r(ox)} ${r(oy + 2)} ${r(ox - rx)} ${r(oy + 10)} Z`} fill={url("metal")} stroke="#14161a" strokeWidth={0.9} />
					<path d={`M${r(ox - rx * 0.7 * (s < 0 ? 1 : 0.4))} ${r(oy - 8)} Q${r(ox - rx * 0.2)} ${r(oy - 14)} ${r(ox + rx * 0.3)} ${r(oy - 13)}`} stroke="#ffffff" strokeWidth={1.4} fill="none" opacity={s < 0 ? 0.55 : 0.2} />
					{i === 0 && <path d={`M${r(ox - rx + 2)} ${r(oy + 8)} Q${r(ox)} ${r(oy + 1)} ${r(ox + rx - 2)} ${r(oy + 8)}`} stroke={pal.trim} strokeWidth={1.4} fill="none" />}
					<circle cx={r(ox - rx * 0.6)} cy={r(oy + 4)} r={1.1} fill="#e6e6e0" />
					<circle cx={r(ox + rx * 0.6)} cy={r(oy + 4)} r={1.1} fill="#e6e6e0" />
				</g>,
			);
		}
		out.push(<g key={`p${s}`}>{lames}</g>);
	}
	out.push(<rect key="shade" x={CX + 18} y={r(collarY - 10)} width={120} height={80} fill="#05060a" opacity={0.18} />);
	return out;
}

function mail(c: Ctx): ReactNode {
	const { rig, pal, url } = c;
	const { neckW: nw, collarY, shW, shY } = rig;
	const d = torsoPath(c, 2, 2);
	const surcoat = `M${r(CX - nw - 2)} ${r(collarY + 12)} L${r(CX + nw + 2)} ${r(collarY + 12)} L${r(CX + nw + 12)} 252 L${r(CX - nw - 12)} 252 Z`;
	return (
		<g>
			{fabric(c, d, "mail", url("metalDark"), { folds: false, dark: "#0c0e12", light: "#c8ccd2" })}
			{c.detail > 0 && <path d={d} fill={url("rings")} opacity={0.75} />}
			{/* mail coif collar */}
			<path d={`M${r(CX - nw - 3)} ${r(collarY - 10)} Q${CX} ${r(collarY - 2)} ${r(CX + nw + 3)} ${r(collarY - 10)} L${r(CX + nw + 12)} ${r(collarY + 8)} Q${CX} ${r(collarY + 16)} ${r(CX - nw - 12)} ${r(collarY + 8)} Z`} fill={url("metalDark")} stroke="#0c0e12" strokeWidth={0.8} />
			{c.detail > 0 && <path d={`M${r(CX - nw - 3)} ${r(collarY - 10)} Q${CX} ${r(collarY - 2)} ${r(CX + nw + 3)} ${r(collarY - 10)} L${r(CX + nw + 12)} ${r(collarY + 8)} Q${CX} ${r(collarY + 16)} ${r(CX - nw - 12)} ${r(collarY + 8)} Z`} fill={url("rings")} opacity={0.7} />}
			{fabric(c, surcoat, "surcoat", url("cloth"), { folds: true })}
			<path d={surcoat} fill="none" stroke={pal.trim} strokeWidth={2} />
			{/* leather spaulders */}
			{[-1, 1].map((s) => (
				<path key={s} d={`M${r(CX + s * (shW * 0.5))} ${r(shY - 12)} Q${r(CX + s * (shW + 6))} ${r(shY - 14)} ${r(CX + s * (shW + 10))} ${r(shY + 14)} L${r(CX + s * (shW * 0.62))} ${r(shY + 6)} Z`} fill={mix("#5a3a22", pal.cloth, 0.2)} stroke="#1e120a" strokeWidth={0.8} opacity={0.95} />
			))}
		</g>
	);
}

function brigandine(c: Ctx): ReactNode {
	const { rig, pal, url, detail } = c;
	const { neckW: nw, collarY, shW, shY } = rig;
	const d = torsoPath(c, 4, 3);
	const rivets: ReactNode[] = [];
	if (detail > 0) {
		for (let row = 0; row < 6; row++) {
			for (let col = -5; col <= 5; col++) {
				const x = CX + col * 9 + (row % 2) * 4.5;
				const y = collarY + 12 + row * 9;
				if (Math.abs(x - CX) > nw + 30 + row * 6) continue;
				rivets.push(<circle key={`${row}:${col}`} cx={r(x)} cy={r(y)} r={1.1} fill="#e8e2d0" opacity={0.9} />);
			}
		}
	}
	return (
		<g>
			{fabric(c, d, "brig", url("cloth"))}
			<g opacity={0.85}>{rivets}</g>
			<path d={`M${r(CX - nw - 4)} ${r(collarY - 8)} Q${CX} ${r(collarY - 2)} ${r(CX + nw + 4)} ${r(collarY - 8)} L${r(CX + nw + 9)} ${r(collarY + 5)} Q${CX} ${r(collarY + 13)} ${r(CX - nw - 9)} ${r(collarY + 5)} Z`} fill={url("metal")} stroke="#14161a" strokeWidth={0.9} />
			{[-1, 1].map((s) => (
				<g key={s}>
					<path d={`M${r(CX + s * (shW * 0.45))} ${r(shY - 10)} Q${r(CX + s * (shW + 4))} ${r(shY - 18)} ${r(CX + s * (shW + 12))} ${r(shY + 12)} Q${r(CX + s * shW * 0.8)} ${r(shY + 4)} ${r(CX + s * (shW * 0.45))} ${r(shY - 10)} Z`} fill={url("metal")} stroke="#14161a" strokeWidth={0.9} />
					<path d={`M${r(CX + s * (shW * 0.55))} ${r(shY - 11)} Q${r(CX + s * (shW + 1))} ${r(shY - 15)} ${r(CX + s * (shW + 8))} ${r(shY + 6)}`} stroke={pal.trim} strokeWidth={1.3} fill="none" />
				</g>
			))}
		</g>
	);
}

function robe(c: Ctx): ReactNode {
	const { rig, pal, url, t, acc } = c;
	const { neckW: nw, collarY, shW, shY } = rig;
	const stole = t.signature === "holy_symbol" || t.variant % 3 === 0;
	const hoodDown = acc !== "hood" && t.variant % 2 === 1;
	const out: ReactNode[] = [];
	if (hoodDown) {
		out.push(<path key="hood" d={`M${r(CX - nw - 20)} ${r(collarY - 2)} Q${CX} ${r(collarY - 22)} ${r(CX + nw + 20)} ${r(collarY - 2)} L${r(CX + nw + 26)} ${r(collarY + 14)} Q${CX} ${r(collarY + 4)} ${r(CX - nw - 26)} ${r(collarY + 14)} Z`} fill={pal.clothDark} />);
	}
	out.push(fabric(c, torsoPath(c, 2, 2, 2.5), "robe", url("cloth")));
	// wrapped front: two overlapping panels forming a deep V
	const wrapL = `M${r(CX - nw - 2)} ${r(collarY - 4)} L${r(CX + 10)} 252 L${r(CX - 2)} 252 L${r(CX - nw - 8)} ${r(collarY + 4)} Z`;
	out.push(<path key="wrapL" d={wrapL} fill={pal.clothLight} opacity={0.35} />);
	out.push(<path key="wrapEdge" d={`M${r(CX - nw - 2)} ${r(collarY - 4)} Q${r(CX - 2)} ${r(collarY + 20)} ${r(CX + 10)} 252 M${r(CX + nw + 2)} ${r(collarY - 4)} Q${r(CX + 6)} ${r(collarY + 18)} ${r(CX + 4)} ${r(collarY + 34)}`} stroke={pal.clothDark} strokeWidth={1.4} fill="none" />);
	// thick collar band
	out.push(<path key="collar" d={`M${r(CX - nw - 4)} ${r(collarY - 6)} Q${CX} ${r(collarY + 2)} ${r(CX + nw + 4)} ${r(collarY - 6)} L${r(CX + nw + 8)} ${r(collarY - 1)} Q${CX} ${r(collarY + 8)} ${r(CX - nw - 8)} ${r(collarY - 1)} Z`} fill={pal.trim} stroke={mix(pal.trim, "#000", 0.5)} strokeWidth={0.6} />);
	if (stole) {
		for (const s of [-1, 1] as const) {
			const x0 = CX + s * (nw + 4);
			out.push(
				<g key={`st${s}`}>
					<path d={`M${r(x0 - 5)} ${r(collarY - 2)} L${r(x0 + 5)} ${r(collarY - 4)} L${r(x0 + s * 6 + 5)} 252 L${r(x0 + s * 6 - 6)} 252 Z`} fill={mix(mix(pal.accent, pal.cloth, 0.45), "#000", 0.15)} stroke={mix(pal.accent, "#000", 0.6)} strokeWidth={0.6} />
					<path d={`M${r(x0 + s * 2.5)} ${r(collarY + 14)} l0 8 M${r(x0 + s * 2.5 - 4)} ${r(collarY + 18)} l8 0`} stroke={pal.trim} strokeWidth={1.5} />
				</g>,
			);
		}
	}
	out.push(<path key="sleeve" d={`M${r(CX - shW * 0.55)} 252 Q${r(CX - shW * 0.6)} ${r(shY + 18)} ${r(CX - shW * 0.8)} ${r(shY)} M${r(CX + shW * 0.55)} 252 Q${r(CX + shW * 0.6)} ${r(shY + 18)} ${r(CX + shW * 0.8)} ${r(shY)}`} stroke={pal.clothDark} strokeWidth={1.2} fill="none" opacity={0.7} />);
	return out;
}

function leather(c: Ctx): ReactNode {
	const { rig, pal, url, detail, t } = c;
	const { neckW: nw, collarY, shW, shY } = rig;
	const d = torsoPath(c, 1, 1, 1.5, collarY - 8);
	const out: ReactNode[] = [];
	out.push(fabric(c, d, "leather", url("leather"), { dark: "#140a06", light: mix(pal.cloth, "#e0c090", 0.4) }));
	// standing collar
	out.push(<path key="col" d={`M${r(CX - nw - 2)} ${r(collarY - 14)} Q${CX} ${r(collarY - 8)} ${r(CX + nw + 2)} ${r(collarY - 14)} L${r(CX + nw + 5)} ${r(collarY - 2)} Q${CX} ${r(collarY + 4)} ${r(CX - nw - 5)} ${r(collarY - 2)} Z`} fill={url("leather")} stroke="#140a06" strokeWidth={0.8} />);
	// front lacing seam
	out.push(<path key="seam" d={`M${CX} ${r(collarY + 2)} L${CX + 2} 252`} stroke="#140a06" strokeWidth={1.4} />);
	if (detail > 0) {
		out.push(<path key="stitch" d={`M${r(CX - nw - 18)} ${r(collarY + 4)} Q${r(CX - shW * 0.6)} ${r(shY + 4)} ${r(CX - shW * 0.55)} 252 M${r(CX + nw + 18)} ${r(collarY + 4)} Q${r(CX + shW * 0.6)} ${r(shY + 4)} ${r(CX + shW * 0.55)} 252`} stroke={mix(pal.cloth, "#e8d0a0", 0.5)} strokeWidth={0.7} strokeDasharray="2 2.4" fill="none" opacity={0.75} />);
		for (let i = 0; i < 4; i++) out.push(<path key={`lace${i}`} d={`M${CX - 3} ${r(collarY + 8 + i * 9)} L${CX + 4} ${r(collarY + 12 + i * 9)}`} stroke="#c8a878" strokeWidth={0.9} />);
	}
	// baldric strap with buckle, across the chest
	const s = t.variant % 2 ? 1 : -1;
	const strapA = [CX + s * (shW * 0.62), shY - 8];
	const strapB = [CX - s * (shW * 0.5), 252];
	out.push(
		<g key="strap">
			<path d={`M${r(strapA[0])} ${r(strapA[1])} L${r(strapB[0])} ${r(strapB[1])}`} stroke="#2a1a10" strokeWidth={9} />
			<path d={`M${r(strapA[0])} ${r(strapA[1])} L${r(strapB[0])} ${r(strapB[1])}`} stroke={mix("#6a4a2a", pal.accent, 0.12)} strokeWidth={7} />
			{detail > 0 && <path d={`M${r(strapA[0])} ${r(strapA[1])} L${r(strapB[0])} ${r(strapB[1])}`} stroke="#c8a878" strokeWidth={0.6} strokeDasharray="2 2" opacity={0.6} transform="translate(0 2.6)" />}
			<rect x={r(CX - 6 + s * 8)} y={r((strapA[1] + strapB[1]) / 2 - 2)} width={10} height={9} rx={1.5} fill="none" stroke={url("gold")} strokeWidth={2} transform={`rotate(${s * -38} ${r(CX - 1 + s * 8)} ${r((strapA[1] + strapB[1]) / 2 + 2.5)})`} />
		</g>,
	);
	// shoulder guard on the strap side
	out.push(<path key="guard" d={`M${r(CX + s * (shW * 0.48))} ${r(shY - 12)} Q${r(CX + s * (shW + 6))} ${r(shY - 16)} ${r(CX + s * (shW + 12))} ${r(shY + 14)} Q${r(CX + s * shW * 0.82)} ${r(shY + 4)} ${r(CX + s * (shW * 0.48))} ${r(shY - 12)} Z`} fill={url("leather")} stroke="#140a06" strokeWidth={0.9} />);
	return out;
}

function cloak(c: Ctx): ReactNode {
	const { rig, pal, url, t, detail } = c;
	const { neckW: nw, collarY, shW, shY } = rig;
	const fur = t.variant % 3 === 2;
	const out: ReactNode[] = [];
	// tunic underneath
	out.push(fabric(c, torsoPath(c, 3, 6), "under", mix(pal.cloth, "#2a2420", 0.55), { folds: false }));
	// cloak halves draped over the shoulders, open at the front
	for (const s of [-1, 1] as const) {
		const d = `M${r(CX + s * (nw + 2))} ${r(collarY - 8)} Q${r(CX + s * (shW * 0.7))} ${r(shY - 18)} ${r(CX + s * (shW + 10))} ${r(shY + 6)} L${r(CX + s * (shW + 22))} 252 L${r(CX + s * (nw + 18))} 252 Q${r(CX + s * (nw + 8))} ${r(collarY + 30)} ${r(CX + s * (nw + 6))} ${r(collarY + 4)} Z`;
		out.push(fabric(c, d, `cl${s}`, url("cloth")));
	}
	if (fur) {
		const pts: string[] = [];
		const n = 16;
		for (let i = 0; i <= n; i++) {
			const a = -1 + (2 * i) / n;
			const x = CX + a * (shW * 0.85);
			const y = collarY - 6 + Math.abs(a) ** 1.6 * (shY - collarY + 4) + (i % 2 ? 5 : 0);
			pts.push(`${r(x)} ${r(y)}`);
		}
		const furD = `M${r(CX - nw - 4)} ${r(collarY - 12)} Q${CX} ${r(collarY - 4)} ${r(CX + nw + 4)} ${r(collarY - 12)} L${r(CX + shW * 0.85)} ${r(shY - 6)} L${pts.reverse().join(" L")} Z`;
		out.push(
			<g key="fur">
				<path d={furD} fill="#6a5a48" />
				<path d={furD} fill={url("furGrad")} />
				{detail > 0 && <path d={furD} fill="none" stroke="#2a2018" strokeWidth={0.6} opacity={0.6} />}
			</g>,
		);
	}
	// brooch
	const by = collarY + (fur ? 6 : 2);
	out.push(
		<g key="brooch">
			<path d={`M${r(CX - nw - 6)} ${r(by)} Q${CX} ${r(by + 7)} ${r(CX + nw + 6)} ${r(by)}`} stroke={url("gold")} strokeWidth={1.2} fill="none" />
			{[-1, 1].map((s) => (
				<g key={s}>
					<circle cx={r(CX + s * (nw + 6))} cy={r(by)} r={5.5} fill={url("gold")} stroke="#2a1a08" strokeWidth={0.7} />
					<circle cx={r(CX + s * (nw + 6))} cy={r(by)} r={2.6} fill={pal.accent} stroke="#1a0a08" strokeWidth={0.5} />
					<circle cx={r(CX + s * (nw + 6) - 0.9)} cy={r(by - 0.9)} r={0.8} fill="#fff" opacity={0.8} />
				</g>
			))}
		</g>,
	);
	return out;
}

function noble(c: Ctx): ReactNode {
	const { rig, pal, url, t, detail } = c;
	const { neckW: nw, collarY, shW, shY } = rig;
	const ruff = t.variant % 2 === 0;
	const out: ReactNode[] = [];
	out.push(fabric(c, torsoPath(c, 1, 2, 2, collarY - 10), "doublet", url("cloth")));
	// puffed, slashed shoulders
	for (const s of [-1, 1] as const) {
		const ox = CX + s * (shW * 0.8);
		out.push(
			<g key={`puff${s}`}>
				<ellipse cx={r(ox)} cy={r(shY + 2)} rx={r(shW * 0.28)} ry={14} fill={url("cloth")} stroke={pal.clothDark} strokeWidth={0.8} />
				{[-0.5, 0, 0.5].map((k, i) => <path key={i} d={`M${r(ox + k * shW * 0.25)} ${r(shY - 10)} Q${r(ox + k * shW * 0.3)} ${r(shY + 2)} ${r(ox + k * shW * 0.25)} ${r(shY + 14)}`} stroke={pal.accent} strokeWidth={2.2} fill="none" />)}
			</g>,
		);
	}
	// gold trim panels + buttons down the front
	out.push(<path key="placket" d={`M${CX - 5} ${r(collarY - 4)} L${CX - 7} 252 M${CX + 5} ${r(collarY - 4)} L${CX + 7} 252`} stroke={pal.trim} strokeWidth={1.6} />);
	for (let i = 0; i < 5; i++) out.push(<circle key={`b${i}`} cx={CX} cy={r(collarY + 6 + i * 10)} r={1.8} fill={url("gold")} stroke="#2a1a08" strokeWidth={0.4} />);
	if (detail > 0) {
		out.push(<path key="emb" d={`M${r(CX - nw - 20)} ${r(collarY + 14)} q6 -6 12 0 q6 6 12 0 M${r(CX + nw + 20)} ${r(collarY + 14)} q-6 -6 -12 0 q-6 6 -12 0`} stroke={pal.trim} strokeWidth={0.9} fill="none" opacity={0.8} />);
	}
	// sash
	const s = t.variant % 3 === 1 ? 1 : 0;
	if (s) out.push(<path key="sash" d={`M${r(CX - shW * 0.6)} ${r(shY - 6)} L${r(CX + shW * 0.5)} 252 L${r(CX + shW * 0.32)} 252 L${r(CX - shW * 0.72)} ${r(shY + 4)} Z`} fill={pal.accent} opacity={0.9} stroke={mix(pal.accent, "#000", 0.5)} strokeWidth={0.6} />);
	if (ruff) {
		const pts: string[] = [];
		const n = 18;
		for (let i = 0; i <= n; i++) {
			const a = Math.PI * (1 - i / n);
			const rr = i % 2 ? 1 : 0.84;
			pts.push(`${r(CX + Math.cos(a) * (nw + 14) * rr)} ${r(collarY - 8 + Math.sin(a) * 9 * rr)}`);
		}
		out.push(
			<g key="ruff">
				<path d={`M${pts.join(" L")} Q${CX} ${r(collarY - 14)} ${r(CX - nw - 14)} ${r(collarY - 8)} Z`} fill="#ece6d8" stroke="#8a8270" strokeWidth={0.6} />
				<path d={`M${r(CX + 4)} ${r(collarY - 6)} L${r(CX + nw + 14)} ${r(collarY - 4)} L${r(CX + nw + 10)} ${r(collarY + 2)} Z`} fill="#6a6658" opacity={0.25} />
			</g>,
		);
	} else {
		out.push(<path key="highcol" d={`M${r(CX - nw - 1)} ${r(collarY - 16)} Q${CX} ${r(collarY - 10)} ${r(CX + nw + 1)} ${r(collarY - 16)} L${r(CX + nw + 4)} ${r(collarY - 4)} Q${CX} ${r(collarY + 2)} ${r(CX - nw - 4)} ${r(collarY - 4)} Z`} fill={url("cloth")} stroke={pal.trim} strokeWidth={1.2} />);
	}
	return out;
}
