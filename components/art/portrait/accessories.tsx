import type { ReactNode } from "react";
import { mix } from "@/lib/art/color";
import { CX } from "./rig";
import { r, type Ctx } from "./ctx";

/* Headwear (hood, helmet, circlet, crown, headband, wizard/feathered hats) and face marks. */

export function headwearBack(c: Ctx): ReactNode {
	const { rig, pal } = c;
	if (c.headwear !== "hood") return null;
	const { w, top, chin } = rig;
	const hc = mix(pal.cloth, "#000", 0.25);
	return <path d={`M${CX} ${top - 20} C${r(CX + w + 34)} ${top - 16} ${r(CX + w + 30)} ${r(chin)} ${r(CX + w + 20)} ${r(chin + 40)} L${r(CX - w - 20)} ${r(chin + 40)} C${r(CX - w - 30)} ${r(chin)} ${r(CX - w - 34)} ${top - 16} ${CX} ${top - 20} Z`} fill={hc} />;
}

export function headwearFront(c: Ctx): ReactNode {
	const { rig, pal, url, detail } = c;
	const { w, top, browY, eyeY, hairline, chin, jaw, noseBottom } = rig;
	switch (c.headwear) {
		case "hood": {
			const outer = `M${CX} ${top - 20} C${r(CX + w + 30)} ${top - 16} ${r(CX + w + 26)} ${r(chin)} ${r(CX + w + 24)} ${r(chin + 44)} L${r(CX + jaw + 6)} ${r(chin + 44)} C${r(CX + w + 6)} ${r(chin + 10)} ${r(CX + w + 8)} ${r(eyeY)} ${r(CX + w * 0.7)} ${r(hairline - 2)} Q${CX} ${r(hairline - 14)} ${r(CX - w * 0.7)} ${r(hairline - 2)} C${r(CX - w - 8)} ${r(eyeY)} ${r(CX - w - 6)} ${r(chin + 10)} ${r(CX - jaw - 6)} ${r(chin + 44)} L${r(CX - w - 24)} ${r(chin + 44)} C${r(CX - w - 26)} ${r(chin)} ${r(CX - w - 30)} ${top - 16} ${CX} ${top - 20} Z`;
			return (
				<g>
					{/* the hood's shadow over the upper face */}
					<g clipPath={url("head")}>
						<ellipse cx={CX + 6} cy={r(hairline + 2)} rx={r(w + 10)} ry={r(browY - hairline + 6)} fill="#0a0608" opacity={0.55} filter={url("blurL")} />
						<path d={`M${r(CX + w * 0.2)} ${top} L${r(CX + w + 6)} ${top} L${r(CX + w + 6)} ${chin + 4} Z`} fill="#0a0608" opacity={0.3} filter={url("blurL")} />
					</g>
					<path d={outer} fill={url("cloth")} />
					<path d={outer} fill="none" stroke={pal.clothDark} strokeWidth={1} />
					<path d={`M${r(CX - w * 0.7)} ${r(hairline - 1)} Q${CX} ${r(hairline - 13)} ${r(CX + w * 0.7)} ${r(hairline - 1)}`} stroke={pal.clothLight} strokeWidth={1.6} fill="none" opacity={0.6} />
					<path d={`M${r(CX - w - 20)} ${r(eyeY)} Q${r(CX - w - 14)} ${r(top + 4)} ${r(CX - 10)} ${top - 14}`} stroke={pal.clothLight} strokeWidth={4} fill="none" opacity={0.35} filter={url("blurM")} />
					<path d={`M${r(CX + w + 6)} ${r(eyeY - 10)} Q${r(CX + w + 10)} ${r(chin)} ${r(CX + w + 14)} ${r(chin + 40)}`} stroke={pal.clothDark} strokeWidth={5} fill="none" opacity={0.5} filter={url("blurM")} />
				</g>
			);
		}
		case "helmet": {
			const d = `M${r(CX - w - 5)} ${r(browY + 1)} C${r(CX - w - 8)} ${top - 24} ${r(CX + w + 8)} ${top - 24} ${r(CX + w + 5)} ${r(browY + 1)} L${r(CX + w + 6)} ${r(noseBottom + 4)} L${r(CX + w - 4)} ${r(noseBottom + 6)} L${r(CX + w - 5)} ${r(browY - 2)} Q${CX} ${r(browY - 7)} ${r(CX - w + 5)} ${r(browY - 2)} L${r(CX - w + 4)} ${r(noseBottom + 6)} L${r(CX - w - 6)} ${r(noseBottom + 4)} Z`;
			return (
				<g>
					<g clipPath={url("head")}>
						<rect x={0} y={r(browY - 4)} width={200} height={10} fill="#0a0608" opacity={0.45} filter={url("blurM")} />
					</g>
					<path d={d} fill={url("metal")} />
					<path d={`M${r(CX - w * 0.6)} ${r(top + 4)} Q${r(CX - w * 0.3)} ${top - 12} ${CX + 4} ${top - 14}`} stroke="#ffffff" strokeWidth={3} fill="none" opacity={0.5} filter={url("blurS")} />
					<path d={`M${r(CX + w * 0.2)} ${top - 10} Q${r(CX + w + 6)} ${top + 10} ${r(CX + w + 5)} ${r(noseBottom)}`} stroke="#0a0c10" strokeWidth={6} fill="none" opacity={0.35} filter={url("blurM")} />
					<path d={d} fill="none" stroke="#12141a" strokeWidth={1.1} />
					<path d={`M${CX - 3} ${r(browY - 6)} L${CX + 3} ${r(browY - 6)} L${CX + 2.4} ${r(noseBottom - 2)} L${CX - 2.4} ${r(noseBottom - 2)} Z`} fill={url("metal")} stroke="#12141a" strokeWidth={0.9} />
					<path d={`M${r(CX - w - 5)} ${r(browY - 2)} Q${CX} ${r(browY - 12)} ${r(CX + w + 5)} ${r(browY - 2)}`} stroke={pal.trim} strokeWidth={2.4} fill="none" />
					<path d={`M${CX} ${top - 18} L${CX} ${r(browY - 9)}`} stroke="#12141a" strokeWidth={1.2} opacity={0.6} />
					{detail > 0 && [-0.8, -0.45, 0.45, 0.8].map((a) => <circle key={a} cx={r(CX + a * (w + 3))} cy={r(browY - 6 + Math.abs(a) * 3)} r={1.1} fill="#ecece4" />)}
				</g>
			);
		}
		case "circlet":
			return (
				<g>
					<path d={`M${r(CX - w + 1)} ${r(hairline + 9)} Q${CX} ${r(hairline - 1)} ${r(CX + w - 1)} ${r(hairline + 9)}`} stroke={url("gold")} strokeWidth={2.2} fill="none" />
					<path d={`M${CX} ${r(hairline - 3)} l4 5 l-4 5 l-4 -5 Z`} fill={pal.accent} stroke="#2a1a08" strokeWidth={0.7} />
					<circle cx={CX - 1} cy={r(hairline + 0.5)} r={0.9} fill="#fff" opacity={0.85} />
				</g>
			);
		case "headband":
			return (
				<g>
					<path d={`M${r(CX - w - 1)} ${r(hairline + 9)} Q${CX} ${r(hairline - 1)} ${r(CX + w + 1)} ${r(hairline + 9)} L${r(CX + w + 1)} ${r(hairline + 16)} Q${CX} ${r(hairline + 6)} ${r(CX - w - 1)} ${r(hairline + 16)} Z`} fill={pal.accent} stroke={mix(pal.accent, "#000", 0.5)} strokeWidth={0.7} />
					<path d={`M${r(CX - w * 0.6)} ${r(hairline + 6)} Q${CX} ${r(hairline - 1)} ${r(CX + w * 0.2)} ${r(hairline + 3)}`} stroke="#fff" strokeWidth={1} fill="none" opacity={0.3} />
					<path d={`M${r(CX + w + 1)} ${r(hairline + 12)} q10 6 12 18 M${r(CX + w + 1)} ${r(hairline + 13)} q6 10 4 24`} stroke={mix(pal.accent, "#000", 0.15)} strokeWidth={3} fill="none" strokeLinecap="round" />
				</g>
			);
		case "crown": {
			const y = top + 4;
			const d = `M${r(CX - w * 0.72)} ${r(y + 10)} L${r(CX - w * 0.78)} ${r(y - 12)} L${r(CX - w * 0.42)} ${r(y - 2)} L${r(CX - w * 0.2)} ${r(y - 18)} L${CX} ${r(y - 4)} L${r(CX + w * 0.2)} ${r(y - 18)} L${r(CX + w * 0.42)} ${r(y - 2)} L${r(CX + w * 0.78)} ${r(y - 12)} L${r(CX + w * 0.72)} ${r(y + 10)} Q${CX} ${r(y + 2)} ${r(CX - w * 0.72)} ${r(y + 10)} Z`;
			return (
				<g>
					<path d={d} fill={url("gold")} stroke="#3a2a10" strokeWidth={0.9} />
					<path d={`M${r(CX - w * 0.72)} ${r(y + 6)} Q${CX} ${r(y - 2)} ${r(CX + w * 0.72)} ${r(y + 6)}`} stroke="#fff4c0" strokeWidth={0.8} fill="none" opacity={0.6} />
					<circle cx={CX} cy={r(y + 3)} r={2.6} fill={pal.accent} stroke="#2a0a08" strokeWidth={0.6} />
					{[-0.5, 0.5].map((a) => <circle key={a} cx={r(CX + a * w)} cy={r(y + 5)} r={1.6} fill="#c02a3a" stroke="#2a0a08" strokeWidth={0.4} />)}
				</g>
			);
		}
		case "wizard_hat": {
			const brimY = hairline + 2;
			const lean = c.t.variant % 2 ? 1 : -1;
			const cone = `M${r(CX - w * 0.78)} ${r(brimY)} C${r(CX - w * 0.5)} ${r(brimY - 30)} ${r(CX + lean * 4)} ${r(top - 40)} ${r(CX + lean * 14)} ${r(top - 62)} C${r(CX + lean * 30)} ${r(top - 58)} ${r(CX + lean * 34)} ${r(top - 46)} ${r(CX + lean * 40)} ${r(top - 38)} C${r(CX + lean * 22)} ${r(top - 44)} ${r(CX + lean * 16)} ${r(top - 36)} ${r(CX + lean * 18)} ${r(top - 30)} C${r(CX + w * 0.5)} ${r(brimY - 30)} ${r(CX + w * 0.78)} ${r(brimY - 6)} ${r(CX + w * 0.8)} ${r(brimY)} Z`;
			const brim = `M${r(CX - w - 26)} ${r(brimY + 6)} Q${CX} ${r(brimY - 16)} ${r(CX + w + 26)} ${r(brimY + 6)} Q${CX} ${r(brimY + 14)} ${r(CX - w - 26)} ${r(brimY + 6)} Z`;
			return (
				<g>
					<g clipPath={url("head")}>
						<rect x={0} y={r(brimY)} width={200} height={14} fill="#0a0608" opacity={0.45} filter={url("blurM")} />
					</g>
					<path d={cone} fill={url("cloth")} stroke={pal.clothDark} strokeWidth={0.9} />
					<path d={`M${r(CX - w * 0.55)} ${r(brimY - 6)} C${r(CX - w * 0.3)} ${r(brimY - 30)} ${r(CX - 2)} ${r(top - 30)} ${r(CX + lean * 8)} ${r(top - 52)}`} stroke={pal.clothLight} strokeWidth={3} fill="none" opacity={0.4} filter={url("blurS")} />
					<path d={`M${r(CX - w * 0.74)} ${r(brimY - 4)} Q${CX} ${r(brimY - 14)} ${r(CX + w * 0.76)} ${r(brimY - 4)} L${r(CX + w * 0.78)} ${r(brimY + 1)} Q${CX} ${r(brimY - 9)} ${r(CX - w * 0.76)} ${r(brimY + 1)} Z`} fill={pal.accent} />
					<path d={brim} fill={url("cloth")} stroke={pal.clothDark} strokeWidth={0.9} />
					<path d={`M${r(CX - w - 22)} ${r(brimY + 5)} Q${CX} ${r(brimY - 14)} ${r(CX + w * 0.4)} ${r(brimY - 6)}`} stroke={pal.clothLight} strokeWidth={1.2} fill="none" opacity={0.55} />
					{detail > 0 && <path d={`M${r(CX - 10)} ${r(brimY - 26)} l1.4 3 3 0.4 -2.3 2 0.6 3 -2.7 -1.5 -2.7 1.5 0.6 -3 -2.3 -2 3 -0.4 Z`} fill={pal.accentLight} opacity={0.85} />}
				</g>
			);
		}
		case "feathered_hat": {
			const brimY = hairline + 1;
			const s = c.t.variant % 2 ? 1 : -1;
			const crown = `M${r(CX - w * 0.72)} ${r(brimY)} C${r(CX - w * 0.74)} ${r(top - 14)} ${r(CX + w * 0.74)} ${r(top - 14)} ${r(CX + w * 0.72)} ${r(brimY)} Z`;
			const brim = `M${r(CX - w - 30)} ${r(brimY + 4 - s * 6)} Q${CX} ${r(brimY - 18)} ${r(CX + w + 30)} ${r(brimY + 4 + s * 6)} Q${CX} ${r(brimY + 10)} ${r(CX - w - 30)} ${r(brimY + 4 - s * 6)} Z`;
			const plume = `M${r(CX + s * w * 0.4)} ${r(brimY - 8)} C${r(CX + s * (w + 10))} ${r(top - 30)} ${r(CX + s * (w + 40))} ${r(top - 20)} ${r(CX + s * (w + 52))} ${r(top + 14)} C${r(CX + s * (w + 32))} ${r(top - 4)} ${r(CX + s * (w + 8))} ${r(top - 6)} ${r(CX + s * w * 0.5)} ${r(brimY - 4)} Z`;
			return (
				<g>
					<g clipPath={url("head")}>
						<rect x={0} y={r(brimY)} width={200} height={14} fill="#0a0608" opacity={0.5} filter={url("blurM")} />
					</g>
					<path d={crown} fill={url("cloth")} stroke={pal.clothDark} strokeWidth={0.9} />
					<path d={`M${r(CX - w * 0.72)} ${r(brimY - 5)} Q${CX} ${r(brimY - 11)} ${r(CX + w * 0.72)} ${r(brimY - 5)} L${r(CX + w * 0.72)} ${r(brimY)} Q${CX} ${r(brimY - 6)} ${r(CX - w * 0.72)} ${r(brimY)} Z`} fill={pal.trim} />
					<path d={plume} fill={pal.accent} stroke={mix(pal.accent, "#000", 0.45)} strokeWidth={0.7} />
					{detail > 0 && Array.from({ length: 8 }, (_, i) => <path key={i} d={`M${r(CX + s * (w * 0.5 + i * 6))} ${r(brimY - 8 - i * 4)} l${r(s * 6)} ${r(i < 5 ? 6 : 9)}`} stroke={pal.accentLight} strokeWidth={0.6} opacity={0.7} />)}
					<path d={brim} fill={url("cloth")} stroke={pal.clothDark} strokeWidth={0.9} />
					<path d={`M${r(CX - w - 26)} ${r(brimY + 3 - s * 6)} Q${CX} ${r(brimY - 16)} ${r(CX + w * 0.5)} ${r(brimY - 6)}`} stroke={pal.clothLight} strokeWidth={1.2} fill="none" opacity={0.5} />
				</g>
			);
		}
		default:
			return null;
	}
}

export function marks(c: Ctx): ReactNode {
	const { rig, pal, url, acc } = c;
	const { eyeSpacing: es, eyeY, ew, w, browY, noseBottom, hairline } = rig;
	switch (acc) {
		case "eyepatch": {
			const ex = CX + es;
			return (
				<g>
					<path d={`M${r(CX - w - 2)} ${r(hairline + 10)} L${r(ex - ew)} ${r(eyeY - 5)} M${r(ex + ew)} ${r(eyeY - 2)} L${r(CX + w + 2)} ${r(eyeY + 4)}`} stroke="#1a1210" strokeWidth={1.8} />
					<path d={`M${r(ex - ew - 2)} ${r(eyeY - 6)} Q${r(ex)} ${r(eyeY - 9)} ${r(ex + ew + 2)} ${r(eyeY - 4)} Q${r(ex + ew + 1)} ${r(eyeY + 7)} ${r(ex)} ${r(eyeY + 8)} Q${r(ex - ew - 1)} ${r(eyeY + 6)} ${r(ex - ew - 2)} ${r(eyeY - 6)} Z`} fill="#1c1410" stroke="#000" strokeWidth={0.6} />
					<path d={`M${r(ex - ew + 1)} ${r(eyeY - 4)} Q${r(ex)} ${r(eyeY - 6)} ${r(ex + ew - 2)} ${r(eyeY - 3)}`} stroke="#5a4a40" strokeWidth={1} fill="none" />
				</g>
			);
		}
		case "scar": {
			const ex = CX - es;
			const d = `M${r(ex - 5)} ${r(browY - 12)} L${r(ex + 1)} ${r(eyeY - 4)} M${r(ex + 2)} ${r(eyeY + 4)} L${r(ex + 8)} ${r(noseBottom + 4)}`;
			return (
				<g strokeLinecap="round">
					<path d={d} stroke={pal.skinDeep} strokeWidth={2.6} opacity={0.35} filter={url("blurS")} />
					<path d={d} stroke={mix(pal.skin, "#f0c0b8", 0.55)} strokeWidth={1.6} />
					<path d={d} stroke={mix(pal.skin, "#7a2a2a", 0.4)} strokeWidth={0.5} opacity={0.8} />
				</g>
			);
		}
		case "warpaint": {
			const col = c.t.variant % 2 ? "#b02a22" : "#1a1a22";
			return (
				<g fill={col} opacity={0.72}>
					{[-1, 1].map((s) => (
						<path key={s} d={`M${r(CX + s * (es - ew))} ${r(eyeY + 6)} L${r(CX + s * (w - 1))} ${r(eyeY + 2)} L${r(CX + s * (w - 2))} ${r(eyeY + 8)} L${r(CX + s * (es - ew + 1))} ${r(eyeY + 10)} Z`} />
					))}
					<path d={`M${CX - 2} ${r(hairline + 4)} L${CX + 2} ${r(hairline + 4)} L${CX + 1.4} ${r(browY - 1)} L${CX - 1.4} ${r(browY - 1)} Z`} />
					<path d={`M${CX - 1.6} ${r(rig.mouthY + 4)} L${CX + 1.6} ${r(rig.mouthY + 4)} L${CX + 1.2} ${r(rig.chin - 2)} L${CX - 1.2} ${r(rig.chin - 2)} Z`} />
				</g>
			);
		}
		default:
			return null;
	}
}
