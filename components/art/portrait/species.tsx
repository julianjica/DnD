import type { ReactNode } from "react";
import { mix } from "@/lib/art/color";
import { CX } from "./rig";
import { r, type Ctx } from "./ctx";

/* Species features: scales, markings, heavy brows, tusks, draconic muzzle, horns. */

/** Drawn on the skin, under the eyes/brows. */
export function speciesUnder(c: Ctx): ReactNode {
	const { rig, pal, f, url, detail } = c;
	const out: ReactNode[] = [];
	const { w, top, eyeY, browY, chin, eyeSpacing: es, ew } = rig;
	if (f.has("scales") && detail > 0) {
		const rows: ReactNode[] = [];
		for (let row = 0; row < 16; row++) {
			for (let col = -6; col <= 6; col++) {
				const x = CX + col * 8 + (row % 2) * 4;
				const y = top - 4 + row * 7.5;
				rows.push(<path key={`${row}:${col}`} d={`M${r(x - 4)} ${r(y)} Q${r(x)} ${r(y + 6)} ${r(x + 4)} ${r(y)}`} fill="none" stroke={pal.skinDeep} strokeWidth={0.7} />);
			}
		}
		out.push(
			<g key="scales" clipPath={url("head")} opacity={0.45}>
				{rows}
			</g>,
		);
	}
	if (rig.draconic) {
		// lighter muzzle plates and heavy brow ridges
		out.push(
			<g key="muzzle" clipPath={url("head")}>
				<path d={`M${CX - 13} ${r(eyeY + 4)} Q${CX} ${r(eyeY - 2)} ${CX + 13} ${r(eyeY + 4)} L${CX + 15} ${r(chin + 4)} Q${CX} ${r(chin + 14)} ${CX - 15} ${r(chin + 4)} Z`} fill={pal.skinLight} opacity={0.35} filter={url("blurM")} />
				{[0, 1, 2, 3, 4].map((i) => (
					<path key={i} d={`M${r(CX - 12 + i)} ${r(eyeY + 12 + i * 9)} Q${CX} ${r(eyeY + 9 + i * 9)} ${r(CX + 12 - i)} ${r(eyeY + 12 + i * 9)}`} stroke={pal.skinDeep} strokeWidth={0.9} fill="none" opacity={0.5} />
				))}
				{[-1, 1].map((s) => (
					<path key={`b${s}`} d={`M${r(CX + s * 6)} ${r(browY + 2)} Q${r(CX + s * es)} ${r(browY - 10)} ${r(CX + s * (es + ew + 8))} ${r(browY - 2)} Q${r(CX + s * (es + 2))} ${r(browY + 2)} ${r(CX + s * 6)} ${r(browY + 6)} Z`} fill={pal.skinLight} opacity={0.6} />
				))}
				<path d={`M${r(CX + w * 0.4)} ${top - 4} L${r(CX + w + 6)} ${top} L${r(CX + w + 6)} ${chin + 12} L${CX + 8} ${chin + 12} Z`} fill={pal.skinDeep} opacity={0.25} filter={url("blurL")} />
			</g>,
		);
	}
	if (f.has("markings")) {
		const ink = mix(pal.skin, "#1a1420", 0.55);
		out.push(
			<g key="mark" stroke={ink} strokeWidth={1.4} fill="none" opacity={0.65} strokeLinecap="round">
				<path d={`M${CX} ${r(top + 8)} L${CX} ${r(browY - 10)} M${CX - 9} ${r(top + 14)} L${CX} ${r(browY - 10)} L${CX + 9} ${r(top + 14)}`} />
				<path d={`M${r(CX - w + 5)} ${r(eyeY + 10)} l9 4 l-6 7 M${r(CX + w - 5)} ${r(eyeY + 10)} l-9 4 l6 7`} />
				<circle cx={r(CX - es - ew)} cy={r(browY - 6)} r={1.4} fill={ink} />
				<circle cx={r(CX + es + ew)} cy={r(browY - 6)} r={1.4} fill={ink} />
			</g>,
		);
	}
	const sp = rig.sp;
	if (!rig.draconic && (sp === "orc" || sp === "half-orc" || sp === "goliath")) {
		// heavy brow ridge overhang
		out.push(
			<g key="ridge" clipPath={url("head")}>
				<path d={`M${r(CX - w)} ${r(browY - 4)} Q${CX} ${r(browY - 10)} ${r(CX + w)} ${r(browY - 4)}`} stroke={pal.skinLight} strokeWidth={4} fill="none" opacity={0.35} filter={url("blurM")} />
				<path d={`M${r(CX - w)} ${r(browY + 3)} Q${CX} ${r(browY - 2)} ${r(CX + w)} ${r(browY + 3)}`} stroke={pal.skinDeep} strokeWidth={4} fill="none" opacity={0.45} filter={url("blurM")} />
			</g>,
		);
	}
	return out;
}

/** Drawn over the mouth: tusks; draconic nostrils and mouth. */
export function speciesOver(c: Ctx): ReactNode {
	const { rig, pal, f } = c;
	const out: ReactNode[] = [];
	const { mouthY: my, mw, chin, eyeY, w } = rig;
	if (f.has("tusks") && !rig.draconic) {
		const big = rig.sp === "orc";
		const h = big ? 10 : 7;
		for (const s of [-1, 1] as const) {
			const x = CX + s * (mw - 3.5);
			out.push(
				<g key={`t${s}`}>
					<path d={`M${r(x - 2.6)} ${r(my + 3)} C${r(x - 2.8)} ${r(my - h * 0.5)} ${r(x + s * 0.5)} ${r(my - h)} ${r(x + s * 2)} ${r(my - h - 1)} C${r(x + s * 2.4)} ${r(my - h * 0.4)} ${r(x + 2.6)} ${r(my)} ${r(x + 2.6)} ${r(my + 3)} Z`} fill="#ece2c4" stroke="#6a5a3a" strokeWidth={0.6} />
					<path d={`M${r(x - 1)} ${r(my + 1)} Q${r(x - 1)} ${r(my - h * 0.5)} ${r(x + s * 1)} ${r(my - h + 1)}`} stroke="#fffaf0" strokeWidth={0.8} fill="none" opacity={0.7} />
				</g>,
			);
		}
	}
	if (rig.draconic) {
		const dark = "#160c0c";
		out.push(
			<g key="drac">
				{[-1, 1].map((s) => (
					<path key={`n${s}`} d={`M${CX + s * 4} ${r(chin - 3)} q${s * 3} -3 ${s * 6} -1`} stroke={dark} strokeWidth={1.8} fill="none" strokeLinecap="round" />
				))}
				{[-1, 1].map((s) => (
					<g key={`m${s}`}>
						<path d={`M${r(CX + s * (w * 0.62))} ${r(eyeY + 22)} Q${r(CX + s * 20)} ${r(chin - 4)} ${r(CX + s * 12)} ${r(chin + 8)}`} stroke={dark} strokeWidth={1.6} fill="none" strokeLinecap="round" />
						{[0, 1, 2].map((k) => (
							<path key={k} d={`M${r(CX + s * (w * 0.55 - k * 6))} ${r(eyeY + 25 + k * 8)} l${s * -1.2} 3`} stroke="#efe6cc" strokeWidth={1.3} strokeLinecap="round" />
						))}
					</g>
				))}
				<path d={`M${CX - 10} ${r(eyeY + 6)} Q${CX} ${r(eyeY + 3)} ${CX + 10} ${r(eyeY + 6)}`} stroke={pal.skinLight} strokeWidth={1.2} fill="none" opacity={0.6} />
			</g>,
		);
	}
	return out;
}

/** Horns (and draconic frills). "back" draws behind the head, "front" over the hair. */
export function horns(c: Ctx, part: "back" | "front"): ReactNode {
	const { rig, pal, f, id, url, detail } = c;
	const { w, top, hairline, eyeY, chin } = rig;
	const has = f.has("horns") || f.has("ram_horns");
	if (rig.draconic) {
		if (part !== "back") return null;
		const base = mix(pal.skin, "#f0e6cc", 0.45);
		return (
			<g>
				<defs>
					<linearGradient id={id("hornD")} x1="0" y1="1" x2="1" y2="0">
						<stop offset="0" stopColor={mix(pal.skin, "#000", 0.2)} />
						<stop offset="1" stopColor={base} />
					</linearGradient>
				</defs>
				{[-1, 1].map((s) => (
					<g key={s}>
						<path d={`M${r(CX + s * w * 0.55)} ${top + 4} C${r(CX + s * (w + 12))} ${top - 14} ${r(CX + s * (w + 30))} ${top - 8} ${r(CX + s * (w + 44))} ${top + 16} C${r(CX + s * (w + 24))} ${top + 4} ${r(CX + s * (w + 10))} ${top + 14} ${r(CX + s * w * 0.8)} ${top + 22} Z`} fill={url("hornD")} stroke={pal.skinLine} strokeWidth={0.9} />
						{/* cheek frills */}
						<path d={`M${r(CX + s * (w - 2))} ${r(eyeY + 2)} l${s * 16} -2 l${s * -10} 7 l${s * 14} 5 l${s * -12} 4 l${s * 9} 8 L${r(CX + s * (w - 8))} ${r(chin - 10)} Z`} fill={mix(pal.skin, "#000", 0.15)} stroke={pal.skinLine} strokeWidth={0.8} />
					</g>
				))}
			</g>
		);
	}
	if (!has || c.headwear === "helmet" || part !== "front") return null;
	const ram = f.has("ram_horns");
	const dark = mix("#2a2024", pal.skin, 0.15);
	const tip = "#8a7480";
	return (
		<g>
			<defs>
				<linearGradient id={id("horn")} x1="0" y1="1" x2="0.4" y2="0">
					<stop offset="0" stopColor={dark} />
					<stop offset="1" stopColor={tip} />
				</linearGradient>
			</defs>
			{[-1, 1].map((s) => {
				if (ram) {
					const bx = CX + s * (w - 6);
					const by = hairline;
					return (
						<g key={s}>
							<path d={`M${r(bx - s * 8)} ${r(by)} C${r(bx + s * 14)} ${r(by - 22)} ${r(bx + s * 38)} ${r(by - 4)} ${r(bx + s * 30)} ${r(by + 26)} C${r(bx + s * 24)} ${r(by + 44)} ${r(bx + s * 4)} ${r(by + 38)} ${r(bx + s * 8)} ${r(by + 24)} C${r(bx + s * 12)} ${r(by + 16)} ${r(bx + s * 20)} ${r(by + 22)} ${r(bx + s * 17)} ${r(by + 14)} C${r(bx + s * 20)} ${r(by)} ${r(bx + s * 4)} ${r(by - 4)} ${r(bx - s * 2)} ${r(by + 8)} Z`} fill={url("horn")} stroke="#120c0e" strokeWidth={0.9} />
							{detail > 0 && [0, 1, 2, 3, 4].map((k) => <path key={k} d={`M${r(bx + s * (2 + k * 6))} ${r(by - 6 + k * 3)} l${s * 3} ${6 + k}`} stroke="#120c0e" strokeOpacity={0.4} strokeWidth={0.8} />)}
							<path d={`M${r(bx)} ${r(by - 6)} C${r(bx + s * 14)} ${r(by - 16)} ${r(bx + s * 28)} ${r(by - 6)} ${r(bx + s * 30)} ${r(by + 10)}`} stroke="#d0c0c8" strokeWidth={1.4} fill="none" opacity={s < 0 ? 0.45 : 0.15} />
						</g>
					);
				}
				const bx = CX + s * w * 0.42;
				const by = hairline + 4;
				return (
					<g key={s}>
						<path d={`M${r(bx - s * 6)} ${r(by)} C${r(bx - s * 6)} ${r(by - 20)} ${r(bx + s * 6)} ${r(by - 36)} ${r(bx + s * 22)} ${r(by - 46)} C${r(bx + s * 12)} ${r(by - 30)} ${r(bx + s * 8)} ${r(by - 14)} ${r(bx + s * 8)} ${r(by + 2)} Z`} fill={url("horn")} stroke="#120c0e" strokeWidth={0.9} />
						{detail > 0 && [0, 1, 2, 3].map((k) => <path key={k} d={`M${r(bx - s * 5 + s * k * 2)} ${r(by - 6 - k * 8)} l${s * 11} -2`} stroke="#120c0e" strokeOpacity={0.35} strokeWidth={0.8} />)}
						<path d={`M${r(bx - s * 3)} ${r(by - 4)} C${r(bx - s * 2)} ${r(by - 20)} ${r(bx + s * 6)} ${r(by - 32)} ${r(bx + s * 18)} ${r(by - 42)}`} stroke="#d8c8d0" strokeWidth={1.2} fill="none" opacity={s < 0 ? 0.5 : 0.2} />
						<ellipse cx={r(bx + s)} cy={r(by + 1)} rx={8} ry={2.4} fill="#0a0608" opacity={0.35} filter={url("blurS")} />
					</g>
				);
			})}
		</g>
	);
}
