import type { ReactNode } from "react";
import { mix } from "@/lib/art/color";
import { CX } from "./rig";
import { r, type Ctx } from "./ctx";

/* One memorable item per character, kept by the shoulder/collar so it never covers the face.
 * Hats are headwear (see accessories); the pipe and flower move with the head. */

/** Behind the body: the staff rises past the right shoulder. */
export function signatureBack(c: Ctx): ReactNode {
	const { t, pal, url, rig } = c;
	if (t.signature !== "staff") return null;
	const x = Math.min(186, CX + rig.w + 34);
	return (
		<g>
			<path d={`M${x - 3} 252 L${x - 1} 40 L${x + 4} 40 L${x + 4} 252 Z`} fill="#5a3a20" />
			<path d={`M${x - 2} 252 L${x} 40`} stroke="#9a7048" strokeWidth={1.2} />
			<path d={`M${x + 3} 252 L${x + 3} 40`} stroke="#1e1008" strokeWidth={1.2} />
			<ellipse cx={x + 1} cy={30} rx={18} ry={18} fill={url("glow")} opacity={0.9} />
			<path d={`M${x - 6} 44 C${x - 12} 30 ${x - 4} 18 ${x + 1} 14 C${x + 6} 18 ${x + 14} 30 ${x + 8} 44 Z`} fill="none" stroke="#3a2412" strokeWidth={2.4} />
			<path d={`M${x + 1} 20 l5 9 l-5 10 l-5 -10 Z`} fill={pal.accentLight} stroke={mix(pal.accent, "#000", 0.4)} strokeWidth={0.7} />
			<path d={`M${x - 1} 24 l2 -3`} stroke="#fff" strokeWidth={1} opacity={0.8} />
		</g>
	);
}

/** Inside the head group (moves with the head tilt). */
export function signatureFace(c: Ctx): ReactNode {
	const { t, rig, pal, url } = c;
	if (t.signature === "pipe" && !rig.draconic) {
		const x = CX + rig.mw * 0.5;
		const y = rig.mouthY + 1;
		return (
			<g>
				<path d={`M${r(x)} ${r(y)} Q${r(x + 14)} ${r(y + 6)} ${r(x + 24)} ${r(y + 14)}`} stroke="#2a1a10" strokeWidth={2.4} fill="none" strokeLinecap="round" />
				<path d={`M${r(x + 20)} ${r(y + 6)} L${r(x + 21)} ${r(y + 18)} Q${r(x + 26)} ${r(y + 22)} ${r(x + 31)} ${r(y + 18)} L${r(x + 32)} ${r(y + 6)} Z`} fill="#6a3a1a" stroke="#1e0e06" strokeWidth={0.8} />
				<path d={`M${r(x + 22)} ${r(y + 8)} L${r(x + 22.5)} ${r(y + 16)}`} stroke="#b07a48" strokeWidth={1} opacity={0.7} />
				<ellipse cx={r(x + 26)} cy={r(y + 6)} rx={5.6} ry={1.6} fill="#1a0a04" />
				<ellipse cx={r(x + 26)} cy={r(y + 6)} rx={3} ry={0.9} fill="#e0702a" opacity={0.8} />
				<path d={`M${r(x + 26)} ${r(y + 3)} C${r(x + 22)} ${r(y - 8)} ${r(x + 34)} ${r(y - 14)} ${r(x + 28)} ${r(y - 26)} C${r(x + 24)} ${r(y - 34)} ${r(x + 34)} ${r(y - 40)} ${r(x + 32)} ${r(y - 50)}`} stroke="#e8e4dc" strokeWidth={2.4} fill="none" opacity={0.25} filter={url("blurS")} />
			</g>
		);
	}
	if (t.signature === "flower" && !rig.draconic && c.headwear !== "helmet" && c.headwear !== "hood") {
		const x = CX - rig.w + 2;
		const y = rig.hairline + 10;
		const petal = mix(pal.accent, "#ffe0f0", 0.25);
		return (
			<g>
				<path d={`M${r(x + 4)} ${r(y + 4)} q8 4 14 2`} stroke="#3a6a2a" strokeWidth={1.6} fill="none" />
				{[0, 72, 144, 216, 288].map((a) => (
					<ellipse key={a} cx={r(x + Math.cos((a * Math.PI) / 180) * 3.6)} cy={r(y + Math.sin((a * Math.PI) / 180) * 3.6)} rx={3.6} ry={2.4} fill={petal} stroke={mix(petal, "#000", 0.35)} strokeWidth={0.4} transform={`rotate(${a} ${r(x + Math.cos((a * Math.PI) / 180) * 3.6)} ${r(y + Math.sin((a * Math.PI) / 180) * 3.6)})`} />
				))}
				<circle cx={r(x)} cy={r(y)} r={1.8} fill="#f0c040" />
			</g>
		);
	}
	return null;
}

/** In front of the clothing, by the shoulder or on the chest. */
export function signatureFront(c: Ctx): ReactNode {
	const { t, rig, pal, url, detail } = c;
	const { collarY, neckW: nw, shW, shY } = rig;
	const chest = collarY + 16;
	switch (t.signature) {
		case "holy_symbol":
		case "amulet": {
			const holy = t.signature === "holy_symbol";
			const y = chest + 6;
			return (
				<g>
					<path d={`M${r(CX - nw + 2)} ${r(collarY - 6)} Q${CX - 4} ${r(y - 4)} ${CX} ${r(y - 7)} Q${CX + 4} ${r(y - 4)} ${r(CX + nw - 2)} ${r(collarY - 6)}`} stroke={url("gold")} strokeWidth={1} fill="none" strokeDasharray={detail ? "1.6 0.8" : undefined} />
					{holy ? (
						<g>
							<circle cx={CX} cy={r(y + 2)} r={8} fill={url("gold")} stroke="#3a2a08" strokeWidth={0.8} />
							{Array.from({ length: 8 }, (_, i) => {
								const a = (i * Math.PI) / 4;
								return <path key={i} d={`M${r(CX + Math.cos(a) * 8)} ${r(y + 2 + Math.sin(a) * 8)} L${r(CX + Math.cos(a) * 11.5)} ${r(y + 2 + Math.sin(a) * 11.5)}`} stroke={url("gold")} strokeWidth={1.6} />;
							})}
							<circle cx={CX} cy={r(y + 2)} r={3.6} fill={pal.accentLight} stroke="#3a2a08" strokeWidth={0.6} />
							<path d={`M${CX - 4} ${r(y - 2)} q3 -2 6 0`} stroke="#fff8d0" strokeWidth={0.8} fill="none" opacity={0.8} />
						</g>
					) : (
						<g>
							<path d={`M${CX} ${r(y - 7)} L${CX + 6} ${r(y + 1)} L${CX} ${r(y + 11)} L${CX - 6} ${r(y + 1)} Z`} fill={url("gold")} stroke="#3a2a08" strokeWidth={0.7} />
							<path d={`M${CX} ${r(y - 3)} L${CX + 3.4} ${r(y + 1.5)} L${CX} ${r(y + 7)} L${CX - 3.4} ${r(y + 1.5)} Z`} fill={pal.accent} />
							<circle cx={CX - 1} cy={r(y)} r={0.9} fill="#fff" opacity={0.9} />
							<ellipse cx={CX} cy={r(y + 2)} rx={9} ry={9} fill={url("glow")} opacity={0.5} />
						</g>
					)}
				</g>
			);
		}
		case "mug": {
			const x = 14;
			const y = 196;
			return (
				<g>
					<path d={`M${x} ${y} L${x + 30} ${y} L${x + 28} ${y + 44} L${x + 2} ${y + 44} Z`} fill="#7a5230" stroke="#2a1608" strokeWidth={1} />
					{[0.15, 0.85].map((k) => <rect key={k} x={x - 0.5} y={r(y + 44 * k - 2)} width={31} height={4} fill="#8a8e94" stroke="#2a2c30" strokeWidth={0.6} />)}
					{detail > 0 && [8, 15, 22].map((dx) => <path key={dx} d={`M${x + dx} ${y + 4} L${x + dx - 0.5} ${y + 40}`} stroke="#3a2010" strokeWidth={0.8} opacity={0.6} />)}
					<path d={`M${x + 30} ${y + 8} q12 2 10 16 q-2 10 -11 9`} stroke="#3a2010" strokeWidth={4} fill="none" />
					<path d={`M${x - 2} ${y + 1} q4 -9 10 -4 q4 -7 10 -1 q6 -6 9 1 q5 -1 4 4 L${x + 30} ${y + 3} Z`} fill="#f2ead8" stroke="#b8a888" strokeWidth={0.6} />
					<path d={`M${x + 3} ${y + 6} L${x + 5} ${y + 38}`} stroke="#c8a070" strokeWidth={2} opacity={0.6} />
					{/* fingers around the handle */}
					{[0, 1, 2].map((i) => <rect key={i} x={x + 32} y={y + 9 + i * 6} width={9} height={5.4} rx={2.6} fill={c.pal.skin} stroke={pal.skinLine} strokeWidth={0.5} />)}
				</g>
			);
		}
		case "book": {
			const x = 140;
			const y = 198;
			return (
				<g transform={`rotate(-14 ${x + 20} ${y + 20})`}>
					<rect x={x + 3} y={y + 3} width={44} height={50} rx={2} fill="#e8dcc0" stroke="#6a5a40" strokeWidth={0.6} />
					<rect x={x} y={y} width={44} height={50} rx={2.5} fill={mix(pal.accent, "#3a1a10", 0.55)} stroke="#1a0a06" strokeWidth={1} />
					<rect x={x} y={y} width={6} height={50} fill="#1a0a06" opacity={0.4} />
					<rect x={x + 10} y={y + 8} width={28} height={30} rx={1.5} fill="none" stroke={url("gold")} strokeWidth={1.2} />
					<circle cx={x + 24} cy={y + 23} r={5} fill="none" stroke={url("gold")} strokeWidth={1.2} />
					{[[x + 42, y + 2], [x + 42, y + 46]].map(([cx, cy]) => <path key={cy} d={`M${cx - 4} ${cy} l6 0 l0 ${cy > y + 10 ? 4 : -2} Z`} fill={url("gold")} />)}
					<path d={`M${x + 8} ${y + 3} L${x + 40} ${y + 3}`} stroke="#fff" strokeWidth={1} opacity={0.25} />
				</g>
			);
		}
		case "lantern": {
			const x = 26;
			const y = 186;
			return (
				<g>
					<ellipse cx={x + 9} cy={y + 20} rx={30} ry={30} fill="#ffb040" opacity={0.25} filter={url("blurL")} />
					<path d={`M${x + 9} ${y - 14} L${x + 9} ${y - 2}`} stroke="#2a2420" strokeWidth={1.4} />
					<path d={`M${x + 3} ${y - 2} q6 -8 12 0`} stroke="#2a2420" strokeWidth={1.6} fill="none" />
					<rect x={x} y={y} width={18} height={30} rx={2} fill="#ffcf70" stroke="#2a2420" strokeWidth={1.6} />
					<ellipse cx={x + 9} cy={y + 16} rx={4} ry={7} fill="#fff6d0" />
					<path d={`M${x + 6} ${y} L${x + 6} ${y + 30} M${x + 12} ${y} L${x + 12} ${y + 30}`} stroke="#2a2420" strokeWidth={1.1} />
					<path d={`M${x - 2} ${y} L${x + 20} ${y} M${x - 2} ${y + 30} L${x + 20} ${y + 30}`} stroke="#3a3430" strokeWidth={2.6} strokeLinecap="round" />
				</g>
			);
		}
		case "dagger": {
			// sheathed across the chest, hilt by the left shoulder
			const ax = CX - shW * 0.5;
			const ay = shY - 2;
			return (
				<g transform={`rotate(48 ${r(ax)} ${r(ay)})`}>
					<rect x={r(ax - 3.5)} y={r(ay + 12)} width={7} height={40} rx={2} fill="#2a1a10" stroke="#120a06" strokeWidth={0.7} />
					<rect x={r(ax - 3.5)} y={r(ay + 46)} width={7} height={6} rx={1.5} fill={url("gold")} />
					<rect x={r(ax - 8)} y={r(ay + 9)} width={16} height={3.2} rx={1.4} fill={url("gold")} stroke="#3a2a08" strokeWidth={0.5} />
					<rect x={r(ax - 2.2)} y={r(ay - 4)} width={4.4} height={13} rx={1.5} fill="#3a2214" />
					{[0, 1, 2].map((i) => <path key={i} d={`M${r(ax - 2.2)} ${r(ay - 1 + i * 4)} l4.4 1.4`} stroke="#a07848" strokeWidth={0.6} />)}
					<circle cx={r(ax)} cy={r(ay - 6)} r={2.8} fill={url("gold")} stroke="#3a2a08" strokeWidth={0.5} />
				</g>
			);
		}
		case "quill": {
			const x = CX - nw - 18;
			const y = chest + 6;
			return (
				<g>
					<rect x={r(x - 6)} y={r(y)} width={14} height={14} rx={1.5} fill={pal.clothDark} stroke={mix(pal.clothDark, "#000", 0.4)} strokeWidth={0.6} />
					<path d={`M${r(x)} ${r(y + 6)} C${r(x - 6)} ${r(y - 10)} ${r(x - 10)} ${r(y - 24)} ${r(x - 18)} ${r(y - 34)} C${r(x - 8)} ${r(y - 26)} ${r(x - 2)} ${r(y - 12)} ${r(x + 2)} ${r(y + 6)} Z`} fill="#f2ece0" stroke="#8a8070" strokeWidth={0.6} />
					{detail > 0 && [0, 1, 2, 3, 4].map((i) => <path key={i} d={`M${r(x - 2 - i * 3)} ${r(y - 6 - i * 5)} l-4 1`} stroke="#a8a090" strokeWidth={0.5} />)}
					<path d={`M${r(x + 1)} ${r(y + 6)} C${r(x - 4)} ${r(y - 10)} ${r(x - 9)} ${r(y - 22)} ${r(x - 16)} ${r(y - 32)}`} stroke="#6a6050" strokeWidth={0.6} fill="none" />
				</g>
			);
		}
		case "bird": {
			const x = CX - shW * 0.66;
			const y = shY - 14;
			const ink = "#14141a";
			return (
				<g>
					<path d={`M${r(x - 16)} ${r(y + 2)} C${r(x - 18)} ${r(y - 12)} ${r(x - 6)} ${r(y - 22)} ${r(x + 4)} ${r(y - 22)} C${r(x + 12)} ${r(y - 22)} ${r(x + 14)} ${r(y - 14)} ${r(x + 12)} ${r(y - 8)} C${r(x + 12)} ${r(y + 2)} ${r(x + 6)} ${r(y + 10)} ${r(x - 4)} ${r(y + 12)} L${r(x - 22)} ${r(y + 26)} L${r(x - 18)} ${r(y + 10)} Z`} fill={ink} />
					<path d={`M${r(x - 12)} ${r(y - 2)} C${r(x - 8)} ${r(y - 12)} ${r(x)} ${r(y - 8)} ${r(x + 2)} ${r(y + 4)}`} stroke="#4a5068" strokeWidth={1.6} fill="none" opacity={0.7} />
					<path d={`M${r(x + 10)} ${r(y - 17)} L${r(x + 22)} ${r(y - 14)} L${r(x + 11)} ${r(y - 11)} Z`} fill="#3a3a40" stroke={ink} strokeWidth={0.5} />
					<circle cx={r(x + 6)} cy={r(y - 15)} r={1.6} fill={pal.accentLight} />
					<circle cx={r(x + 5.6)} cy={r(y - 15.4)} r={0.5} fill="#fff" />
					<path d={`M${r(x - 6)} ${r(y + 12)} l-2 6 M${r(x)} ${r(y + 11)} l1 6`} stroke="#3a3020" strokeWidth={1.2} />
				</g>
			);
		}
		default:
			return null;
	}
}
