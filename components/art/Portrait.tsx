import { useId, type ReactNode } from "react";
import type { PortraitSpec } from "@/lib/game/types";
import { BACKGROUND_COLORS, portraitTraits, type PortraitTraits } from "@/lib/art/portrait";
import { mix, shade } from "@/lib/art/color";
import { ArtRng, mirrorLoop, r1, smoothPath } from "@/lib/art/rand";
import {
	fullHat, MODERN_FRAME_DEFAULT, modernBackdrop, modernBackdropColors, modernBehindNeck, modernClothes, modernEarbuds, modernFrameBack, modernFrameFront,
	modernGlasses, modernGrit, modernHat, modernHatDefs, modernHoodBack, modernHoodFront, modernLook, modernPhotoOverlay, modernWindow,
	type ModernCtx, type ModernFrame, type ModernWho,
} from "./PortraitModern";

/**
 * Layered procedural SVG bust portrait. Deterministic for a given spec, SSR-safe
 * (no effects, no randomness outside the spec seed). Light comes from the upper
 * left; every layer gets a base fill, a shadow form and a thin outline.
 */
export interface PortraitProps {
	spec: PortraitSpec;
	/** Pixel width; height is 1.2×. Default 160. */
	size?: number;
	/** Optional species id (tunes proportions: dwarf/orc stockier, gnome nose…). */
	speciesId?: string;
	/** Name plate under the bust. */
	name?: string;
	/** Draw the ornate frame (default true). */
	framed?: boolean;
	className?: string;
	title?: string;
	/**
	 * The Quiet (zombie ruleset): present-day clothes by profession/role, modern
	 * headwear and extras, photo frame and background; everyone human. Pass the
	 * PC's class ids or the NPC's role text so the outfit matches the sprite.
	 */
	modern?: boolean | ModernWho;
	/** Modern frame: worn staff ID badge or polaroid (default MODERN_FRAME_DEFAULT). */
	frameStyle?: ModernFrame;
}

const CX = 100;
type P = [number, number];

const MODERN_KEEP_ACC = new Set(["scar", "eyepatch", "earrings"]);

export function Portrait({ spec: specIn, size = 160, speciesId: speciesIn, name, framed = true, className, title, modern, frameStyle }: PortraitProps) {
	const who: ModernWho | null = modern ? (modern === true ? {} : modern) : null;
	// The Quiet: everyone is human; only freckles survive of the species features.
	const spec = who ? { ...specIn, features: (specIn.features ?? []).filter((x) => x === "freckles") } : specIn;
	const speciesId = who ? "human" : speciesIn;
	const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const id = (s: string) => `pt${uid}-${s}`;
	const url = (s: string) => `url(#${id(s)})`;
	const t = portraitTraits(spec, speciesId);
	const f = new Set(spec.features);
	const rng = new ArtRng(spec.seed ^ 0x5bd1e995);
	const draconic = t.head === "draconic";
	const skin = spec.skinTone || "#e0ac83";
	const hair = spec.hairColor || "#3a2a1e";
	const skinHi = shade(skin, 0.1);
	const skinLo = shade(skin, -0.16);
	const skinLine = shade(skin, -0.38);
	const hairLo = shade(hair, -0.14);
	const hairHi = shade(hair, 0.16);
	const hairLine = shade(hair, -0.3);
	const ml = who ? modernLook(spec, who, t.clothing, t.age) : null;
	const frame = frameStyle ?? MODERN_FRAME_DEFAULT;
	const [bgA, bgB] = ml ? modernBackdropColors(frame, spec.background) : BACKGROUND_COLORS[spec.background] ?? BACKGROUND_COLORS.slate;
	const rawAcc = spec.accessory ?? "none";
	const acc = ml && !MODERN_KEEP_ACC.has(rawAcc) ? "none" : rawAcc;
	const fh = spec.facialHair ?? "none";
	const style = draconic ? "bald" : spec.hairStyle;

	// ── Geometry ──────────────────────────────────────────────────────────
	const top = 56;
	const w = t.width;
	const headPts: P[] = draconic
		? mirrorLoop([
				[CX, top - 2], [CX + w * 0.8, top + 6], [CX + w + 2, top + 30], [CX + w + 1, 104], [CX + w * 0.8, 126],
				[CX + 19, 146], [CX + 15, t.chin - 2], [CX, t.chin + 1],
			], CX)
		: mirrorLoop([
				[CX, top], [CX + w * 0.74, top + 6], [CX + w * 0.98, top + 28], [CX + w, 108], [CX + (w + t.jaw) / 2 + 1, 128],
				[CX + t.jaw, 140], [CX + t.jaw * 0.48, t.chin - 4], [CX, t.chin],
			], CX);
	const headD = smoothPath(headPts);
	const eyeY = draconic ? 102 : 108;
	const mouthY = draconic ? t.chin - 12 : t.chin - 15;
	const noseY = draconic ? t.chin - 22 : 125;

	// Background texture rng
	const motes = Array.from({ length: 18 }, () => [rng.range(8, 192), rng.range(8, 232), rng.range(0.6, 2.2), rng.range(0.05, 0.25)] as const);

	// ── Clothing ─────────────────────────────────────────────────────────
	const cloth = t.clothing;
	const clothHi = shade(cloth, 0.1);
	const clothLo = shade(cloth, -0.14);
	const trim = t.clothingTrim;
	const shoulders = "M0 244 C2 204 28 180 72 172 L128 172 C172 180 198 204 200 244 Z";

	const clothing = (
		<g>
			<path d={shoulders} fill={url("cloth")} stroke={shade(cloth, -0.3)} strokeWidth={1.4} />
			{t.clothingStyle === "armor" && (
				<g>
					<path d="M8 244 C10 214 26 196 54 188 C70 196 74 214 70 244 Z" fill={url("metal")} stroke="#1c1e22" strokeWidth={1.2} />
					<path d="M192 244 C190 214 174 196 146 188 C130 196 126 214 130 244 Z" fill={url("metal")} stroke="#1c1e22" strokeWidth={1.2} />
					<path d="M20 222 C30 206 46 198 60 196 M180 222 C170 206 154 198 140 196" stroke="#e8ecf0" strokeOpacity={0.45} strokeWidth={1.5} fill="none" />
					<path d="M70 244 L76 200 L124 200 L130 244 Z" fill={url("metal")} stroke="#1c1e22" strokeWidth={1} opacity={0.95} />
					<circle cx={58} cy={204} r={1.6} fill="#d8d8d0" /><circle cx={142} cy={204} r={1.6} fill="#d8d8d0" />
				</g>
			)}
			{t.clothingStyle === "leather" && (
				<g>
					<path d="M60 182 L140 244" stroke={shade("#5a3a22", -0.1)} strokeWidth={9} />
					<path d="M60 182 L140 244" stroke="#8a6a3a" strokeWidth={1} strokeDasharray="3 4" opacity={0.7} />
					<rect x={92} y={206} width={12} height={9} rx={1.5} fill="none" stroke={trim} strokeWidth={2} transform="rotate(38 98 210)" />
				</g>
			)}
			{t.clothingStyle === "robe" && (
				<g fill="none" stroke={trim} strokeWidth={3}>
					<path d="M76 172 C84 196 92 222 100 244" />
					<path d="M124 172 C116 196 108 222 100 244" />
					<path d="M60 200 C64 214 66 230 64 244 M140 200 C136 214 134 230 136 244" stroke={clothLo} strokeWidth={2} />
				</g>
			)}
			{t.clothingStyle === "cloak" && (
				<g>
					<path d="M2 244 C6 206 30 184 70 176 C80 196 66 222 60 244 Z" fill={shade(cloth, -0.06)} stroke={shade(cloth, -0.32)} strokeWidth={1.2} />
					<path d="M198 244 C194 206 170 184 130 176 C120 196 134 222 140 244 Z" fill={shade(cloth, -0.06)} stroke={shade(cloth, -0.32)} strokeWidth={1.2} />
					<circle cx={76} cy={192} r={5} fill={url("gold")} stroke="#3a2a10" strokeWidth={1} />
					<circle cx={124} cy={192} r={5} fill={url("gold")} stroke="#3a2a10" strokeWidth={1} />
					<path d="M80 192 Q100 200 120 192" stroke={trim} strokeWidth={1.4} fill="none" />
				</g>
			)}
			{t.clothingStyle === "tunic" && (
				<g>
					<path d="M76 172 L100 206 L124 172" fill={shade(cloth, -0.22)} stroke={trim} strokeWidth={2.4} strokeLinejoin="round" />
					<path d="M86 192 L114 192" stroke={trim} strokeWidth={0.8} opacity={0.6} />
				</g>
			)}
			{/* fold shadows */}
			<path d="M40 244 C44 226 50 212 62 200 M160 244 C156 226 150 212 138 200" stroke={clothLo} strokeWidth={3} fill="none" opacity={0.5} filter={url("soft1")} />
			<path d="M20 230 C30 206 48 194 70 186" stroke={clothHi} strokeWidth={2} fill="none" opacity={0.35} />
		</g>
	);

	// ── Neck ─────────────────────────────────────────────────────────────
	const nw = draconic ? 17 : 13 + (t.jaw > 28 ? 3 : 0);
	const neck = (
		<g>
			<path d={`M${CX - nw} 132 C${CX - nw} 158 ${CX - nw - 1} 166 ${CX - nw - 8} 178 L${CX + nw + 8} 178 C${CX + nw + 1} 166 ${CX + nw} 158 ${CX + nw} 132 Z`} fill={skinLo} stroke={skinLine} strokeWidth={1.2} />
			<path d={`M${CX - nw} 140 Q${CX} ${t.chin + 14} ${CX + nw} 140 L${CX + nw} 160 Q${CX} ${t.chin + 22} ${CX - nw} 160 Z`} fill={shade(skin, -0.3)} opacity={0.55} filter={url("soft2")} />
			{!ml && t.clothingStyle !== "armor" && <path d={`M${CX - nw - 8} 177 Q${CX} 186 ${CX + nw + 8} 177`} stroke={shade(cloth, -0.3)} strokeWidth={2} fill="none" />}
			{draconic && <path d={`M${CX - 6} 150 L${CX - 6} 182 M${CX} 152 L${CX} 184 M${CX + 6} 150 L${CX + 6} 182`} stroke={skinHi} strokeOpacity={0.35} strokeWidth={1.4} />}
		</g>
	);

	// ── Ears ─────────────────────────────────────────────────────────────
	const ear = (s: 1 | -1): ReactNode => {
		if (draconic) return null;
		const x0 = CX + s * (w - 3);
		const pointed = f.has("pointed_ears");
		const long = f.has("long_ears");
		const tipX = x0 + s * (long ? 24 : pointed ? 15 : 9);
		const tipY = long ? 72 : pointed ? 82 : 98;
		const d = pointed || long
			? `M${x0} 100 C${x0 + s * 6} ${tipY + 14} ${tipX - s * 4} ${tipY + 4} ${tipX} ${tipY} C${tipX - s * 2} ${tipY + 16} ${x0 + s * 12} 118 ${x0 + s * 4} 128 C${x0} 128 ${x0 - s * 2} 124 ${x0} 120 Z`
			: `M${x0} 100 C${x0 + s * 10} 94 ${x0 + s * 13} 108 ${x0 + s * 10} 118 C${x0 + s * 8} 126 ${x0 + s * 3} 128 ${x0} 124 Z`;
		const inner = pointed || long
			? `M${x0 + s * 2} 106 C${x0 + s * 6} ${tipY + 20} ${tipX - s * 6} ${tipY + 10} ${tipX - s * 3} ${tipY + 6} C${x0 + s * 8} 112 ${x0 + s * 6} 118 ${x0 + s * 3} 120`
			: `M${x0 + s * 2} 104 C${x0 + s * 8} 102 ${x0 + s * 9} 112 ${x0 + s * 6} 118`;
		return (
			<g key={`ear${s}`}>
				<path d={d} fill={s < 0 ? skin : skinLo} stroke={skinLine} strokeWidth={1.2} />
				<path d={inner} fill="none" stroke={skinLine} strokeWidth={1.1} opacity={0.65} />
				{acc === "earrings" && (ml ? <circle cx={x0 + s * 5} cy={130} r={2.2} fill="none" stroke="#c8ccd2" strokeWidth={1.3} /> : <circle cx={x0 + s * 5} cy={131} r={3.2} fill="none" stroke={url("gold")} strokeWidth={1.6} />)}
			</g>
		);
	};

	// ── Hair ─────────────────────────────────────────────────────────────
	const hw = w + 5;
	const hatted = !!ml && fullHat(ml);
	// The Quiet: hair ties and beard clasps are plain elastic/metal, not trim or gold
	const tieColor = ml ? "#2a2a2e" : t.clothingTrim;
	const claspFill = ml ? "#5a5e66" : url("gold");
	const vol0 = style === "cropped" || style === "shaved_sides" ? 4 : style === "wild" ? 14 : style === "curly" ? 12 : 8;
	// under a modern hat the hair is flattened
	const vol = hatted ? Math.min(vol0, 4) : vol0;
	const sideBottom = style === "cropped" ? 98 : 112;
	const hairline = (dip: number, part: number): P[] => [
		[CX + w - 2, 98], [CX + w * 0.7 + part * 0.3, 86 + dip * 0.5], [CX + part + 6, 79 + dip], [CX + part, 75 + dip], [CX + part - 6, 79 + dip], [CX - w * 0.7 + part * 0.3, 86 + dip * 0.5], [CX - w + 2, 98],
	];
	const capPts = (dip = 0, part = 0, v = vol): P[] => [
		[CX, top - v], [CX + w * 0.72, top - v * 0.6 + 2], [CX + hw, top + 26], [CX + hw - 1, sideBottom],
		[CX + w - 3, sideBottom - 2], ...hairline(dip, part), [CX - w + 3, sideBottom - 2],
		[CX - hw + 1, sideBottom], [CX - hw, top + 26], [CX - w * 0.72, top - v * 0.6 + 2],
	];
	const strands = (count: number, bottom: number) => {
		const out: string[] = [];
		for (let i = 0; i < count; i++) {
			const a = -1 + (2 * i) / (count - 1);
			const x1 = CX + a * (hw + 4);
			const sway = rng.range(-6, 6);
			out.push(`M${r1(CX + a * 6)} ${top - vol} Q${r1(CX + a * (hw - 2) + sway)} ${top + 10} ${r1(x1)} ${r1(bottom + rng.range(-8, 4))}`);
		}
		return out;
	};

	let hairBack: ReactNode = null;
	let hairFront: ReactNode = null;
	let hairExtra: ReactNode = null; // drawn over face (braids)
	const hairStroke = { stroke: hairLine, strokeWidth: 1.2, strokeLinejoin: "round" as const };
	const capWithTexture = (d: string, bottom = 110, key = "cap") => (
		<g>
			<clipPath id={id(`hc-${key}`)}><path d={d} /></clipPath>
			<path d={d} fill={url("hair")} {...hairStroke} />
			<g clipPath={url(`hc-${key}`)}>
				{strands(14, bottom).map((s, i) => (
					<path key={i} d={s} fill="none" stroke={i % 3 === 0 ? hairHi : hairLo} strokeWidth={i % 3 === 0 ? 1.1 : 1.5} opacity={i % 3 === 0 ? 0.55 : 0.5} />
				))}
				<ellipse cx={CX - w * 0.35} cy={top + 6} rx={w * 0.4} ry={7} fill={hairHi} opacity={0.35} filter={url("soft2")} />
			</g>
		</g>
	);
	let capD = "";
	switch (style) {
		case "bald":
			break;
		case "long": {
			const back: P[] = [[CX, top - vol], [CX + hw + 4, top + 20], [CX + hw + 10, 150], [CX + hw + 18, 205], [CX + 30, 200], [CX + 16, 150], [CX - 16, 150], [CX - 30, 200], [CX - hw - 18, 205], [CX - hw - 10, 150], [CX - hw - 4, top + 20]];
			hairBack = <path d={smoothPath(back)} fill={hairLo} {...hairStroke} />;
			capD = smoothPath(capPts(2, -4));
			break;
		}
		case "ponytail":
			hairBack = <path d={`M${CX + 20} ${top + 4} C${CX + 64} ${top + 6} ${CX + 70} 150 ${CX + 52} 200 C${CX + 46} 170 ${CX + 40} 120 ${CX + 18} ${top + 16} Z`} fill={hairLo} {...hairStroke} />;
			capD = smoothPath(capPts(-2, 0, 5));
			break;
		case "bun":
			hairBack = <g><circle cx={CX + 4} cy={top - 10} r={15} fill={url("hair")} {...hairStroke} /><path d={`M${CX - 10} ${top - 14} q 14 -8 28 2`} stroke={hairLo} fill="none" strokeWidth={1.4} /></g>;
			capD = smoothPath(capPts(-4, 0, 4));
			break;
		case "topknot":
			hairFront = <g><ellipse cx={CX} cy={top - 18} rx={9} ry={11} fill={url("hair")} {...hairStroke} /><rect x={CX - 6} y={top - 9} width={12} height={4} rx={1.5} fill={tieColor} stroke="#2a1a0a" strokeWidth={0.8} /></g>;
			capD = smoothPath(capPts(-6, 0, 3));
			break;
		case "mohawk": {
			const crest: P[] = [[CX - 6, 82], [CX - 7, top - 4], [CX - 3, top - 26], [CX + 3, top - 30], [CX + 8, top - 8], [CX + 7, 82]];
			hairFront = (
				<g>
					<path d={smoothPath(capPts(-4, 0, 1))} fill={hair} opacity={0.22} />
					<path d={smoothPath(crest)} fill={url("hair")} {...hairStroke} />
					<path d={`M${CX} ${top - 24} L${CX + 1} 80`} stroke={hairHi} strokeWidth={1.2} opacity={0.5} />
				</g>
			);
			break;
		}
		case "shaved_sides": {
			const topPts: P[] = [[CX, top - 10], [CX + w * 0.55, top - 4], [CX + w * 0.6, 82], [CX, 80], [CX - w * 0.6, 82], [CX - w * 0.55, top - 4]];
			hairFront = (
				<g>
					<path d={smoothPath(capPts(-4, 0, 1))} fill={hair} opacity={0.25} />
					{capWithTexture(smoothPath(topPts), 84, "top")}
				</g>
			);
			break;
		}
		case "braids":
			capD = smoothPath(capPts(-2, 0, 5));
			hairExtra = [-1, 1].map((s) => (
				<g key={s}>
					{Array.from({ length: 8 }, (_, i) => (
						<ellipse key={i} cx={CX + s * (hw + 2 - i * 0.6)} cy={112 + i * 11} rx={6.5 - i * 0.25} ry={7} fill={i % 2 ? hairLo : url("hair")} stroke={hairLine} strokeWidth={1} />
					))}
					<rect x={CX + s * (hw - 2) - 4} y={198} width={8} height={4} rx={1} fill={tieColor} />
				</g>
			));
			break;
		case "curly":
		case "wild": {
			const curly = style === "curly";
			const outer: P[] = [];
			const n = curly ? 15 : 13;
			for (let i = 0; i <= n; i++) {
				const a = Math.PI + (Math.PI * i) / n;
				const rx = hw + (curly ? 6 : 8);
				const ry = (top + 26 - (top - vol)) + 4;
				const jitter = curly ? 0 : rng.range(-3, 7);
				outer.push([CX + Math.cos(a) * (rx + jitter), top + 34 + Math.sin(a) * (ry + jitter)]);
			}
			if (curly) {
				const circles = outer.map(([x, y], i) => <circle key={i} cx={r1(x)} cy={r1(y)} r={9 + (i % 3)} fill={i % 2 ? hairLo : hair} {...hairStroke} />);
				hairBack = <g>{circles}<circle cx={CX - hw - 2} cy={118} r={9} fill={hairLo} {...hairStroke} /><circle cx={CX + hw + 2} cy={118} r={9} fill={hairLo} {...hairStroke} /></g>;
				capD = smoothPath(capPts(-6, 0, 8));
				hairFront = (
					<g>
						{[-0.7, -0.35, 0, 0.35, 0.7].map((a, i) => (
							<circle key={i} cx={CX + a * w} cy={80 + Math.abs(a) * 8} r={7} fill={i % 2 ? hairLo : hair} {...hairStroke} />
						))}
					</g>
				);
			} else {
				const spikes: P[] = [];
				outer.forEach(([x, y], i) => {
					spikes.push([x, y]);
					if (i < outer.length - 1) {
						const [x2, y2] = outer[i + 1];
						spikes.push([(x + x2) / 2 + (x - CX) * 0.05, (y + y2) / 2 + 9]);
					}
				});
				const full: P[] = [[CX - hw - 2, 120], ...spikes, [CX + hw + 2, 120], ...hairline(-4, 6)];
				capD = smoothPath(full, true, 0.6);
			}
			break;
		}
		case "sidepart":
			capD = smoothPath([...capPts(4, 12)].map(([x, y]) => (y > 76 && y < 92 && x < CX ? [x, y + 6] : [x, y]) as P));
			hairFront = <path d={`M${CX + 10} ${top - 4} C${CX - 8} ${top + 10} ${CX - w * 0.7} 80 ${CX - w + 2} 100 C${CX - w * 0.4} 86 ${CX - 4} ${top + 16} ${CX + 12} ${top + 2} Z`} fill={url("hair")} {...hairStroke} />;
			break;
		case "cropped":
			capD = smoothPath(capPts(-4, 0, 3));
			break;
		default: // short
			capD = smoothPath(capPts(2, -3));
	}
	if (hatted && (style === "topknot" || style === "mohawk")) hairFront = null;
	if (hatted && style === "bun") hairBack = null;
	const hidesHairTop = acc === "helmet" || acc === "hood" || ml?.hat === "hood";

	// ── Eyes ─────────────────────────────────────────────────────────────
	const eye = (s: 1 | -1): ReactNode => {
		const ex = CX + s * t.eyeSpacing;
		const ey = eyeY;
		const ew = draconic ? 7.5 : 7;
		const up = { almond: 5.4, round: 6.4, narrow: 3.6, hooded: 4.4 }[t.eye];
		const lo = { almond: 3.6, round: 4.6, narrow: 2.6, hooded: 3.4 }[t.eye];
		const shape = `M${ex - ew} ${ey} Q${ex - s * 1} ${ey - up * 1.6} ${ex + ew} ${ey - 1} Q${ex} ${ey + lo * 1.5} ${ex - ew} ${ey} Z`;
		const solid = f.has("solid_eyes");
		const patched = acc === "eyepatch" && s === 1;
		if (patched) return null;
		const tilt = s * t.eyeTilt;
		return (
			<g key={`eye${s}`} transform={`rotate(${r1(-tilt)} ${r1(ex)} ${ey})`}>
				<ellipse cx={ex} cy={ey - 3} rx={10} ry={7} fill={shade(skin, -0.2)} opacity={0.45} filter={url("soft2")} />
				<clipPath id={id(`eyeclip${s}`)}><path d={shape} /></clipPath>
				<path d={shape} fill={solid ? spec.eyeColor : draconic ? mix(spec.eyeColor, "#ffffff", 0.2) : "#f3ece2"} />
				<g clipPath={url(`eyeclip${s}`)}>
					{!solid && !draconic && (
						<>
							<circle cx={ex + s * 0.4} cy={ey - 0.6} r={3.7} fill={spec.eyeColor} />
							<circle cx={ex + s * 0.4} cy={ey - 0.6} r={3.7} fill={url("iris")} />
							<circle cx={ex + s * 0.4} cy={ey - 0.6} r={1.7} fill="#0d0a08" />
						</>
					)}
					{draconic && <ellipse cx={ex} cy={ey - 0.6} rx={1.1} ry={4} fill="#0d0a08" />}
					{solid && <circle cx={ex} cy={ey - 1} r={6} fill={shade(spec.eyeColor, 0.25)} opacity={0.6} filter={url("soft1")} />}
					<path d={`M${ex - ew} ${ey - 3.5} Q${ex} ${ey - up * 1.6 - 2} ${ex + ew} ${ey - 3.5} L${ex + ew} ${ey - 9} L${ex - ew} ${ey - 9} Z`} fill={shade(skin, -0.45)} opacity={0.35} />
				</g>
				<circle cx={ex - 1.2} cy={ey - 2.2} r={1} fill="#fff" opacity={0.9} />
				{/* upper lid line + lashes */}
				<path d={`M${ex - ew - 0.6} ${ey + 0.3} Q${ex - s * 1} ${ey - up * 1.6} ${ex + ew + 0.6} ${ey - 1}`} fill="none" stroke="#1f1410" strokeWidth={t.female ? 1.9 : 1.5} strokeLinecap="round" />
				{t.female && <path d={`M${ex + s * ew} ${ey - 1} l${s * 2.2} -1.6`} stroke="#1f1410" strokeWidth={1.2} strokeLinecap="round" />}
				{/* crease */}
				{t.eye !== "hooded" && <path d={`M${ex - ew + 1} ${ey - 3.6} Q${ex} ${ey - up * 1.6 - 3.4} ${ex + ew - 0.5} ${ey - 4.2}`} fill="none" stroke={skinLine} strokeWidth={0.8} opacity={0.5} />}
				<path d={`M${ex - ew + 1.5} ${ey + 1.4} Q${ex} ${ey + lo * 1.5 + 0.6} ${ex + ew - 1} ${ey + 0.4}`} fill="none" stroke={skinLine} strokeWidth={0.7} opacity={0.45} />
				{t.age > 0.6 && <path d={`M${ex + s * (ew + 1)} ${ey + 1} l${s * 3} 1.5 M${ex + s * (ew + 1)} ${ey - 1} l${s * 3.4} -0.6`} stroke={skinLine} strokeWidth={0.6} opacity={0.5} />}
			</g>
		);
	};

	const brow = (s: 1 | -1): ReactNode => {
		const ex = CX + s * t.eyeSpacing;
		const by = eyeY - (draconic ? 9 : 10);
		const th = t.browThick;
		const inner: P = [ex - s * 8.5, by + 1.5];
		const outer: P = [ex + s * 9, by - 1 - t.browAngle * 0.4];
		const peak: P = [ex + s * 2, by - 3 - t.browAngle * 0.3];
		const d = `M${inner[0]} ${inner[1]} Q${peak[0]} ${peak[1] - th} ${outer[0]} ${outer[1]} Q${peak[0]} ${peak[1] + th * 0.4} ${inner[0]} ${inner[1] + th} Z`;
		if (draconic) {
			return <path key={`brow${s}`} d={`M${CX + s * 4} ${by + 4} Q${ex} ${by - 8} ${ex + s * 14} ${by - 6} Q${ex + s * 4} ${by + 1} ${CX + s * 4} ${by + 6} Z`} fill={skinHi} stroke={skinLine} strokeWidth={1.1} />;
		}
		return <path key={`brow${s}`} d={d} fill={shade(hair, -0.08)} stroke={hairLine} strokeWidth={0.4} />;
	};

	// ── Nose ─────────────────────────────────────────────────────────────
	const ns = t.noseSize;
	let nose: ReactNode;
	if (draconic) {
		nose = (
			<g>
				<path d={`M${CX - 13} ${noseY} q4 -4 7 0 M${CX + 6} ${noseY} q4 -4 7 0`} stroke="#1a1010" strokeWidth={2} fill="none" strokeLinecap="round" />
				<path d={`M${CX - 16} ${noseY - 30} Q${CX} ${noseY - 34} ${CX + 16} ${noseY - 30}`} stroke={skinHi} strokeWidth={1.2} fill="none" opacity={0.6} />
			</g>
		);
	} else {
		const tipY = noseY * 1 + (ns - 1) * 6;
		const nwid = (t.nose === "broad" ? 8 : t.nose === "button" ? 5.5 : 6.5) * ns;
		const bridge = t.nose === "hooked"
			? `M${CX + 2} ${eyeY + 2} C${CX + 6} ${eyeY + 8} ${CX + 7} ${tipY - 8} ${CX + 3} ${tipY - 1}`
			: t.nose === "long"
				? `M${CX + 2} ${eyeY + 2} C${CX + 4} ${eyeY + 10} ${CX + 6} ${tipY - 2} ${CX + 2} ${tipY + 3}`
				: `M${CX + 2} ${eyeY + 2} C${CX + 4} ${eyeY + 8} ${CX + 5} ${tipY - 6} ${CX + 4} ${tipY - 2}`;
		nose = (
			<g>
				<path d={`M${CX + 3} ${eyeY} C${CX + 8} ${eyeY + 8} ${CX + nwid + 1} ${tipY - 6} ${CX + nwid} ${tipY + 1} L${CX + 2} ${tipY + 3} Z`} fill={shade(skin, -0.22)} opacity={0.5} filter={url("soft1")} />
				<path d={bridge} fill="none" stroke={skinLine} strokeWidth={1} opacity={0.55} />
				<path d={`M${CX - nwid} ${tipY} Q${CX - nwid - 2} ${tipY + 4} ${CX - nwid + 3} ${tipY + 4.5} Q${CX} ${tipY + 7} ${CX + nwid - 3} ${tipY + 4.5} Q${CX + nwid + 2} ${tipY + 4} ${CX + nwid} ${tipY}`} fill="none" stroke={skinLine} strokeWidth={1.2} strokeLinecap="round" />
				<ellipse cx={CX - 3} cy={tipY + 4} rx={1.6} ry={1} fill={shade(skin, -0.5)} opacity={0.7} />
				<ellipse cx={CX + 3} cy={tipY + 4} rx={1.6} ry={1} fill={shade(skin, -0.5)} opacity={0.7} />
				<ellipse cx={CX - 1} cy={tipY + 0.5} rx={2.4} ry={1.6} fill={skinHi} opacity={0.6} />
			</g>
		);
	}

	// ── Mouth ────────────────────────────────────────────────────────────
	const mw = draconic ? 22 : t.mouthWidth;
	const curve = { neutral: 0, smile: 2.4, smirk: 1.2, stern: -1.6, full: 0.4 }[t.mouth];
	const lipC = mix(skin, "#a0404a", 0.35);
	const my = mouthY;
	const leftUp = t.mouth === "smirk" ? 0 : curve;
	const rightUp = curve;
	const mouth = draconic ? (
		<g>
			<path d={`M${CX - mw} ${my - 4} Q${CX} ${my + 3} ${CX + mw} ${my - 4}`} stroke="#1a1010" strokeWidth={1.8} fill="none" strokeLinecap="round" />
			<path d={`M${CX - mw + 4} ${my - 2} l2 3 M${CX + mw - 4} ${my - 2} l-2 3`} stroke="#efe6cc" strokeWidth={1.5} />
		</g>
	) : (
		<g>
			{/* lower lip */}
			<path d={`M${CX - mw + 2} ${my - leftUp * 0.5} Q${CX} ${my + (t.mouth === "full" ? 7.5 : 6)} ${CX + mw - 2} ${my - rightUp * 0.5} Z`} fill={shade(lipC, 0.04)} opacity={0.85} />
			<ellipse cx={CX - 1} cy={my + 2.6} rx={4} ry={1.2} fill={shade(lipC, 0.18)} opacity={0.6} />
			{/* upper lip */}
			<path d={`M${CX - mw} ${my - leftUp} Q${CX - 5} ${my - 4} ${CX} ${my - 2.4} Q${CX + 5} ${my - 4} ${CX + mw} ${my - rightUp} Q${CX} ${my + 1} ${CX - mw} ${my - leftUp} Z`} fill={shade(lipC, -0.1)} opacity={0.9} />
			<path d={`M${CX - mw} ${my - leftUp} Q${CX} ${my + 1.6 - curve} ${CX + mw} ${my - rightUp}`} fill="none" stroke={shade(lipC, -0.42)} strokeWidth={1.3} strokeLinecap="round" />
			<path d={`M${CX - 4} ${my + 9} Q${CX} ${my + 10.5} ${CX + 4} ${my + 9}`} stroke={skinLine} strokeWidth={0.8} fill="none" opacity={0.4} />
			<path d={`M${CX - 2} ${noseY + 8} L${CX - 2} ${my - 3.5} M${CX + 2} ${noseY + 8} L${CX + 2} ${my - 3.5}`} stroke={skinLine} strokeWidth={0.5} opacity={0.3} />
		</g>
	);

	// ── Facial hair ──────────────────────────────────────────────────────
	const jawOutline = (grow: number, drop: number): P[] => [
		[CX + w - 1, 110], [CX + (w + t.jaw) / 2 + 2 + grow * 0.5, 128], [CX + t.jaw + grow, 142], [CX + t.jaw * 0.5 + grow * 0.5, t.chin + drop * 0.6], [CX, t.chin + drop],
	];
	const beardShape = (drop: number, grow: number): string => {
		const outerR = jawOutline(grow, drop);
		const outerL = outerR.slice().reverse().map(([x, y]) => [2 * CX - x, y] as P).filter(([x]) => x !== CX);
		const innerL: P[] = [[CX - w + 4, 116], [CX - mw - 6, my - 2], [CX - mw - 2, my + 6], [CX, my + 8]];
		const innerR: P[] = [[CX + mw + 2, my + 6], [CX + mw + 6, my - 2], [CX + w - 4, 116]];
		return smoothPath([...outerR, ...outerL, ...innerL, ...innerR], true, 0.85);
	};
	const mustache = <path d={`M${CX} ${my - 6} C${CX - 6} ${my - 9} ${CX - mw - 2} ${my - 7} ${CX - mw - 4} ${my + 2} C${CX - mw} ${my - 2} ${CX - 6} ${my - 3} ${CX} ${my - 3} C${CX + 6} ${my - 3} ${CX + mw} ${my - 2} ${CX + mw + 4} ${my + 2} C${CX + mw + 2} ${my - 7} ${CX + 6} ${my - 9} ${CX} ${my - 6} Z`} fill={url("hair")} stroke={hairLine} strokeWidth={0.9} />;
	let facial: ReactNode = null;
	if (!draconic) {
		switch (fh) {
			case "stubble":
				facial = <path d={beardShape(2, 1)} fill={hair} opacity={0.22} filter={url("grain")} />;
				break;
			case "mustache":
				facial = mustache;
				break;
			case "goatee":
				facial = <g><path d={`M${CX - 9} ${my + 5} Q${CX} ${my + 9} ${CX + 9} ${my + 5} L${CX + 7} ${t.chin + 6} Q${CX} ${t.chin + 10} ${CX - 7} ${t.chin + 6} Z`} fill={url("hair")} stroke={hairLine} strokeWidth={0.9} />{mustache}</g>;
				break;
			case "sideburns":
				facial = [-1, 1].map((s) => <path key={s} d={`M${CX + s * (w - 1)} 96 L${CX + s * (w + 0.5)} 124 Q${CX + s * (w - 4)} 130 ${CX + s * (w - 7)} 126 L${CX + s * (w - 6)} 98 Z`} fill={url("hair")} stroke={hairLine} strokeWidth={0.8} />);
				break;
			case "short_beard":
			case "full_beard":
			case "braided_beard": {
				const drop = fh === "short_beard" ? 8 : fh === "full_beard" ? 30 : 22;
				const grow = fh === "short_beard" ? 2 : 7;
				facial = (
					<g>
						<path d={beardShape(drop, grow)} fill={url("hair")} stroke={hairLine} strokeWidth={1.1} />
						{Array.from({ length: 9 }, (_, i) => {
							const a = -1 + i / 4;
							return <path key={i} d={`M${r1(CX + a * (t.jaw - 2))} ${r1(132 + Math.abs(a) * -6)} Q${r1(CX + a * (t.jaw + 2))} ${r1(t.chin)} ${r1(CX + a * t.jaw * 0.5)} ${r1(t.chin + drop - 6)}`} stroke={i % 2 ? hairLo : hairHi} strokeWidth={1.1} fill="none" opacity={0.5} />;
						})}
						{fh === "braided_beard" && (
							<g>
								{Array.from({ length: 4 }, (_, i) => (
									<ellipse key={i} cx={CX} cy={t.chin + drop + 4 + i * 8} rx={6 - i * 0.6} ry={5.5} fill={i % 2 ? hairLo : hair} stroke={hairLine} strokeWidth={0.9} />
								))}
								<rect x={CX - 5} y={t.chin + drop - 2} width={10} height={4} rx={1} fill={claspFill} stroke="#3a2a10" strokeWidth={0.6} />
								<rect x={CX - 4} y={t.chin + drop + 30} width={8} height={4} rx={1} fill={claspFill} stroke="#3a2a10" strokeWidth={0.6} />
							</g>
						)}
						{mustache}
					</g>
				);
				break;
			}
		}
	}

	// ── Species overlays ────────────────────────────────────────────────
	const tusks = f.has("tusks") && !draconic ? (
		<g fill="#efe6cc" stroke="#6a5a3a" strokeWidth={0.8}>
			<path d={`M${CX - mw + 3} ${my + 2} C${CX - mw + 2} ${my - 4} ${CX - mw + 3} ${my - 8} ${CX - mw + 5.5} ${my - 10} C${CX - mw + 6} ${my - 6} ${CX - mw + 6.5} ${my - 2} ${CX - mw + 6.5} ${my + 2} Z`} />
			<path d={`M${CX + mw - 3} ${my + 2} C${CX + mw - 2} ${my - 4} ${CX + mw - 3} ${my - 8} ${CX + mw - 5.5} ${my - 10} C${CX + mw - 6} ${my - 6} ${CX + mw - 6.5} ${my - 2} ${CX + mw - 6.5} ${my + 2} Z`} />
		</g>
	) : null;

	const hornColor = draconic ? shade(skin, 0.2) : "#2a2024";
	const hornTip = draconic ? "#efe6cc" : "#6a5560";
	const horns = (f.has("horns") || f.has("ram_horns")) ? (
		<g>
			<defs>
				<linearGradient id={id("horn")} x1="0" y1="1" x2="0" y2="0">
					<stop offset="0" stopColor={hornColor} />
					<stop offset="1" stopColor={hornTip} />
				</linearGradient>
			</defs>
			{[-1, 1].map((s) => {
				if (draconic) {
					return <path key={s} d={`M${CX + s * (w * 0.5)} ${top + 6} C${CX + s * (w + 10)} ${top - 8} ${CX + s * (w + 26)} ${top - 2} ${CX + s * (w + 38)} ${top + 18} C${CX + s * (w + 22)} ${top + 6} ${CX + s * (w + 8)} ${top + 14} ${CX + s * (w * 0.7)} ${top + 18} Z`} fill={url("horn")} stroke={skinLine} strokeWidth={1.1} />;
				}
				if (f.has("ram_horns")) {
					const bx = CX + s * (w - 6);
					return (
						<g key={s}>
							<path d={`M${bx - s * 6} ${top + 14} C${bx + s * 14} ${top - 10} ${bx + s * 34} ${top + 12} ${bx + s * 26} ${top + 40} C${bx + s * 20} ${top + 56} ${bx + s * 4} ${top + 50} ${bx + s * 8} ${top + 38} C${bx + s * 12} ${top + 30} ${bx + s * 18} ${top + 36} ${bx + s * 15} ${top + 30} C${bx + s * 20} ${top + 16} ${bx + s * 4} ${top + 10} ${bx - s * 2} ${top + 22} Z`} fill={url("horn")} stroke="#120c0e" strokeWidth={1.1} />
							{[0, 1, 2, 3].map((k) => <path key={k} d={`M${bx + s * (4 + k * 6)} ${top + 4 + k * 2} l${s * 3} ${6 + k}`} stroke="#120c0e" strokeOpacity={0.4} strokeWidth={0.9} />)}
						</g>
					);
				}
				const bx = CX + s * (w * 0.5);
				return (
					<g key={s}>
						<path d={`M${bx - s * 5} ${top + 12} C${bx - s * 4} ${top - 8} ${bx + s * 6} ${top - 22} ${bx + s * 18} ${top - 30} C${bx + s * 10} ${top - 18} ${bx + s * 8} ${top - 4} ${bx + s * 7} ${top + 12} Z`} fill={url("horn")} stroke="#120c0e" strokeWidth={1.1} />
						{[0, 1, 2].map((k) => <path key={k} d={`M${bx - s * 4 + s * k * 2} ${top + 4 - k * 8} l${s * 10} -2`} stroke="#120c0e" strokeOpacity={0.35} strokeWidth={0.9} />)}
					</g>
				);
			})}
		</g>
	) : null;

	const scales = f.has("scales") ? (
		<g clipPath={url("headclip")} opacity={0.35}>
			{Array.from({ length: 12 }, (_, row) =>
				Array.from({ length: 11 }, (_, col) => {
					const x = CX - 50 + col * 10 + (row % 2) * 5;
					const y = top - 4 + row * 9;
					return <path key={`${row}-${col}`} d={`M${x - 5} ${y} Q${x} ${y + 7} ${x + 5} ${y}`} fill="none" stroke={skinLine} strokeWidth={0.8} />;
				}),
			)}
		</g>
	) : null;

	const cheekSpikes = draconic ? (
		<g>
			{[-1, 1].map((s) => (
				<path key={s} d={`M${CX + s * (w - 2)} 112 l${s * 14} 6 l${s * -12} 2 l${s * 12} 8 l${s * -14} 0 Z`} fill={skinLo} stroke={skinLine} strokeWidth={1} />
			))}
		</g>
	) : null;

	const markings = f.has("markings") ? (
		<g stroke={shade(skin, -0.32)} strokeWidth={1.6} fill="none" opacity={0.7} strokeLinecap="round">
			<path d={`M${CX} ${top + 8} L${CX} ${top + 22} M${CX - 8} ${top + 12} L${CX} ${top + 22} L${CX + 8} ${top + 12}`} />
			<path d={`M${CX - w + 6} ${eyeY + 10} l8 4 l-6 6 M${CX + w - 6} ${eyeY + 10} l-8 4 l6 6`} />
		</g>
	) : null;

	const freckles = f.has("freckles") ? (
		<g fill={shade(skin, -0.28)} opacity={0.6}>
			{Array.from({ length: 16 }, (_, i) => {
				const s = i % 2 ? 1 : -1;
				return <circle key={i} cx={r1(CX + s * rng.range(5, 22))} cy={r1(eyeY + rng.range(6, 16))} r={r1(rng.range(0.5, 1))} />;
			})}
		</g>
	) : null;

	// ── Accessories ─────────────────────────────────────────────────────
	let accBack: ReactNode = null;
	let accFront: ReactNode = null;
	switch (acc) {
		case "hood": {
			const hc = shade(t.clothing, -0.04);
			accBack = <path d={`M${CX} ${top - 22} C${CX + 70} ${top - 18} ${CX + 72} 150 ${CX + 64} 196 L${CX - 64} 196 C${CX - 72} 150 ${CX - 70} ${top - 18} ${CX} ${top - 22} Z`} fill={shade(hc, -0.25)} stroke={shade(hc, -0.4)} strokeWidth={1.2} />;
			accFront = (
				<g>
					<path d={`M${CX} ${top - 22} C${CX + 62} ${top - 20} ${CX + 64} 140 ${CX + 60} 190 L${CX + 46} 190 C${CX + 50} 140 ${CX + 50} ${top - 2} ${CX} ${top - 2} C${CX - 50} ${top - 2} ${CX - 50} 140 ${CX - 46} 190 L${CX - 60} 190 C${CX - 64} 140 ${CX - 62} ${top - 20} ${CX} ${top - 22} Z`} fill={url("hood")} stroke={shade(hc, -0.4)} strokeWidth={1.2} />
					<path d={`M${CX - 40} ${top + 6} Q${CX} ${top - 6} ${CX + 40} ${top + 6}`} stroke={shade(hc, 0.12)} strokeWidth={1.4} fill="none" opacity={0.6} />
					<g clipPath={url("headclip")}><ellipse cx={CX + 6} cy={top + 10} rx={w + 6} ry={26} fill="#0a0608" opacity={0.55} filter={url("soft2")} /></g>
				</g>
			);
			break;
		}
		case "helmet":
			accFront = (
				<g>
					<path d={`M${CX - w - 6} ${eyeY - 12} C${CX - w - 8} ${top - 26} ${CX + w + 8} ${top - 26} ${CX + w + 6} ${eyeY - 12} L${CX + w + 8} ${eyeY + 16} L${CX + w - 2} ${eyeY + 18} L${CX + w - 4} ${eyeY - 8} L${CX - w + 4} ${eyeY - 8} L${CX - w + 2} ${eyeY + 18} L${CX - w - 8} ${eyeY + 16} Z`} fill={url("metal")} stroke="#15171a" strokeWidth={1.3} />
					<path d={`M${CX - 3} ${eyeY - 9} L${CX + 3} ${eyeY - 9} L${CX + 2.5} ${eyeY + 14} L${CX - 2.5} ${eyeY + 14} Z`} fill={url("metal")} stroke="#15171a" strokeWidth={1} />
					<path d={`M${CX - w - 6} ${eyeY - 12} Q${CX} ${eyeY - 20} ${CX + w + 6} ${eyeY - 12}`} stroke={t.clothingTrim} strokeWidth={2.5} fill="none" />
					<path d={`M${CX} ${top - 18} L${CX} ${eyeY - 14}`} stroke="#e8ecf0" strokeOpacity={0.5} strokeWidth={2} />
					{[-0.8, -0.4, 0.4, 0.8].map((a) => <circle key={a} cx={CX + a * (w + 4)} cy={eyeY - 14 + Math.abs(a) * 2} r={1.3} fill="#e0e0d8" />)}
				</g>
			);
			break;
		case "circlet":
			accFront = (
				<g>
					<path d={`M${CX - w + 1} 90 Q${CX} 80 ${CX + w - 1} 90`} stroke={url("gold")} strokeWidth={2.6} fill="none" />
					<path d={`M${CX} 79 l4 5 l-4 5 l-4 -5 Z`} fill="#4ab0d8" stroke="#3a2a10" strokeWidth={0.8} />
					<circle cx={CX - 1} cy={82.5} r={0.9} fill="#fff" />
				</g>
			);
			break;
		case "headband":
			accFront = (
				<g>
					<path d={`M${CX - w} 88 Q${CX} 78 ${CX + w} 88 L${CX + w} 95 Q${CX} 85 ${CX - w} 95 Z`} fill={t.clothing} stroke={shade(t.clothing, -0.35)} strokeWidth={1} />
					<path d={`M${CX + w} 90 l12 10 l-4 2 M${CX + w} 92 l8 16`} stroke={t.clothing} strokeWidth={3} strokeLinecap="round" />
				</g>
			);
			break;
		case "crown":
			accFront = (
				<g>
					<path d={`M${CX - 26} ${top + 2} L${CX - 28} ${top - 18} L${CX - 16} ${top - 6} L${CX - 8} ${top - 22} L${CX} ${top - 8} L${CX + 8} ${top - 22} L${CX + 16} ${top - 6} L${CX + 28} ${top - 18} L${CX + 26} ${top + 2} Q${CX} ${top - 4} ${CX - 26} ${top + 2} Z`} fill={url("gold")} stroke="#3a2a10" strokeWidth={1} />
					<circle cx={CX} cy={top - 2} r={2.4} fill="#c02a3a" stroke="#3a1010" strokeWidth={0.6} />
				</g>
			);
			break;
		case "eyepatch": {
			const ex = CX + t.eyeSpacing;
			accFront = (
				<g>
					<path d={`M${CX - w} ${eyeY - 18} L${CX + w + 2} ${eyeY + 8}`} stroke="#1a1410" strokeWidth={1.8} />
					<ellipse cx={ex} cy={eyeY} rx={8.5} ry={7} fill="#1a1410" stroke="#000" strokeWidth={0.8} />
					<path d={`M${ex - 5} ${eyeY - 3} q5 -3 9 1`} stroke="#4a4038" strokeWidth={1} fill="none" />
				</g>
			);
			break;
		}
		case "scar": {
			const ex = CX - t.eyeSpacing;
			accFront = (
				<g>
					<path d={`M${ex - 4} ${eyeY - 18} L${ex + 6} ${eyeY + 20}`} stroke={mix(skin, "#e8b0a8", 0.6)} strokeWidth={2.4} strokeLinecap="round" />
					<path d={`M${ex - 4} ${eyeY - 18} L${ex + 6} ${eyeY + 20}`} stroke={shade(skin, -0.3)} strokeWidth={0.6} strokeLinecap="round" opacity={0.7} />
					{[-10, 0, 10].map((k) => <path key={k} d={`M${ex - 3 + (k + 18) * 0.26} ${eyeY + k} l4 -1`} stroke={shade(skin, -0.3)} strokeWidth={0.6} />)}
				</g>
			);
			break;
		}
		case "warpaint":
			accFront = (
				<g fill="#b02a2a" opacity={0.7}>
					{[-1, 1].map((s) => (
						<path key={s} d={`M${CX + s * 6} ${eyeY + 6} L${CX + s * (w - 2)} ${eyeY + 2} L${CX + s * (w - 3)} ${eyeY + 7} L${CX + s * 7} ${eyeY + 10} Z`} />
					))}
					<path d={`M${CX - 2} ${top + 18} L${CX + 2} ${top + 18} L${CX + 1.5} ${eyeY - 4} L${CX - 1.5} ${eyeY - 4} Z`} fill="#e8e0d0" />
				</g>
			);
			break;
	}

	const age = t.age > 0.55 ? (
		<g stroke={skinLine} strokeWidth={0.7} fill="none" opacity={(t.age - 0.4) * 0.8}>
			<path d={`M${CX - 14} 76 Q${CX} 73 ${CX + 14} 76 M${CX - 10} 80 Q${CX} 78 ${CX + 10} 80`} />
			<path d={`M${CX - 9} ${noseY + 4} Q${CX - 14} ${noseY + 12} ${CX - mw - 2} ${mouthY + 2} M${CX + 9} ${noseY + 4} Q${CX + 14} ${noseY + 12} ${CX + mw + 2} ${mouthY + 2}`} />
		</g>
	) : null;

	const height = size * 1.2;
	const defs = (
		<defs>
			<radialGradient id={id("bg")} cx="42%" cy="34%" r="80%">
				<stop offset="0" stopColor={shade(bgA, 0.12)} />
				<stop offset="0.55" stopColor={bgA} />
				<stop offset="1" stopColor={bgB} />
			</radialGradient>
			<radialGradient id={id("skin")} cx="38%" cy="34%" r="72%">
				<stop offset="0" stopColor={skinHi} />
				<stop offset="0.55" stopColor={skin} />
				<stop offset="1" stopColor={skinLo} />
			</radialGradient>
			<linearGradient id={id("hair")} x1="0.2" y1="0" x2="0.8" y2="1">
				<stop offset="0" stopColor={hairHi} />
				<stop offset="0.45" stopColor={hair} />
				<stop offset="1" stopColor={hairLo} />
			</linearGradient>
			<linearGradient id={id("cloth")} x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stopColor={clothHi} />
				<stop offset="0.6" stopColor={cloth} />
				<stop offset="1" stopColor={clothLo} />
			</linearGradient>
			<linearGradient id={id("hood")} x1="0" y1="0" x2="1" y2="0">
				<stop offset="0" stopColor={shade(t.clothing, 0.06)} />
				<stop offset="0.5" stopColor={t.clothing} />
				<stop offset="1" stopColor={shade(t.clothing, -0.16)} />
			</linearGradient>
			<linearGradient id={id("metal")} x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stopColor="#c8ccd2" />
				<stop offset="0.35" stopColor="#7c828a" />
				<stop offset="0.6" stopColor="#a8aeb6" />
				<stop offset="1" stopColor="#3a3e44" />
			</linearGradient>
			<linearGradient id={id("gold")} x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stopColor="#f6dc8a" />
				<stop offset="0.5" stopColor="#c99a3a" />
				<stop offset="1" stopColor="#7a5418" />
			</linearGradient>
			<radialGradient id={id("iris")} cx="50%" cy="40%" r="60%">
				<stop offset="0" stopColor="#fff" stopOpacity={0.25} />
				<stop offset="0.7" stopColor="#000" stopOpacity={0} />
				<stop offset="1" stopColor="#000" stopOpacity={0.55} />
			</radialGradient>
			<radialGradient id={id("vig")} cx="50%" cy="45%" r="70%">
				<stop offset="0.6" stopColor="#000" stopOpacity={0} />
				<stop offset="1" stopColor="#000" stopOpacity={0.55} />
			</radialGradient>
			<radialGradient id={id("glow")} cx="50%" cy="50%" r="50%">
				<stop offset="0" stopColor={shade(bgA, 0.25)} stopOpacity={0.8} />
				<stop offset="1" stopColor={shade(bgA, 0.25)} stopOpacity={0} />
			</radialGradient>
			<filter id={id("soft1")} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.4" /></filter>
			<filter id={id("soft2")} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3" /></filter>
			<filter id={id("grain")}>
				<feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed={spec.seed % 97} result="n" />
				<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.4" result="a" />
				<feComposite in="SourceGraphic" in2="a" operator="in" />
			</filter>
			<filter id={id("canvas")} x="0" y="0" width="100%" height="100%">
				<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={spec.seed % 89} />
				<feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0.09 0" />
			</filter>
			<clipPath id={id("headclip")}><path d={headD} /></clipPath>
			<clipPath id={id("frame")}><rect x="0" y="0" width="200" height="240" rx="10" /></clipPath>
		</defs>
	);
	const face = (
		<>
		{/* Head */}
		<path d={headD} fill={url("skin")} />
		<g clipPath={url("headclip")}>
			{/* form shadow on the right side, under the brow and below cheekbones */}
			<path d={`M${CX + w * 0.45} ${top} C${CX + w * 1.1} ${top + 30} ${CX + w * 0.9} 130 ${CX + t.jaw * 0.4} ${t.chin + 4} L${CX + w + 10} ${t.chin + 10} L${CX + w + 10} ${top} Z`} fill={shade(skin, -0.28)} opacity={0.5} filter={url("soft2")} />
			<ellipse cx={CX - w * 0.55} cy={eyeY + 14} rx={8} ry={5} fill="#e05a5a" opacity={0.12} filter={url("soft2")} />
			<ellipse cx={CX + w * 0.55} cy={eyeY + 14} rx={8} ry={5} fill="#e05a5a" opacity={0.1} filter={url("soft2")} />
			<ellipse cx={CX - w * 0.35} cy={top + 18} rx={14} ry={9} fill={skinHi} opacity={0.5} filter={url("soft2")} />
			{!draconic && <path d={`M${CX - w} 132 Q${CX} ${t.chin + 10} ${CX + w} 132`} fill="none" stroke={shade(skin, -0.2)} strokeWidth={6} opacity={0.25} filter={url("soft2")} />}
			{style !== "bald" && !hidesHairTop && <path d={`M${CX - w} 92 Q${CX} 72 ${CX + w} 92`} fill="none" stroke={shade(skin, -0.35)} strokeWidth={8} opacity={0.35} filter={url("soft2")} />}
			{scales}
			{markings}
			{freckles}
		</g>
		{cheekSpikes}
		<path d={headD} fill="none" stroke={skinLine} strokeWidth={1.4} />
		{/* rim light */}
		<path d={headD} fill="none" stroke={shade(bgA, 0.35)} strokeWidth={1.6} opacity={0.5} clipPath={url("rimclip")} />
		<clipPath id={id("rimclip")}><rect x={0} y={0} width={CX - w * 0.55} height={240} /></clipPath>

		{age}
		{brow(-1)}
		{brow(1)}
		{eye(-1)}
		{eye(1)}
		{nose}
		{facial}
		{mouth}
		{tusks}
		</>
	);
	const hairTop = (
		<>
		{/* Hair cap & front */}
		{capD && !hidesHairTop && capWithTexture(capD)}
		{!hidesHairTop && hairFront}
		{hairExtra}
		{!draconic && horns}
		</>
	);
	if (ml) {
		const mc: ModernCtx = { id, url, look: ml, w, nw, top, eyeY, chin: t.chin, eyeSpacing: t.eyeSpacing, skin, seed: spec.seed };
		const clothes = modernClothes(mc);
		const win = modernWindow(frame, framed);
		const shown = name && name.length > 22 ? name.slice(0, 21) + "…" : name;
		return (
			<svg viewBox="0 0 200 240" width={size} height={height} className={className} role="img" aria-label={title ?? name ?? "Portrait"} style={{ display: "block" }}>
				{defs}
				<defs>
					{modernHatDefs(mc)}
					<clipPath id={id("mwin")}><rect x={win.x} y={win.y} width={win.w} height={win.h} rx={win.rx} /></clipPath>
				</defs>
				{framed && modernFrameBack({ id, url }, frame, ml)}
				<g clipPath={url("mwin")}>
					<g transform={win.k === 1 ? undefined : `translate(${win.tx} ${r1(win.ty)}) scale(${win.k})`}>
						<rect width="200" height="240" fill={url("bg")} />
						{modernBackdrop(frame, spec.background, spec.seed)}
						{modernHoodBack(mc)}
						{hairBack}
						{clothes.under}
						{modernBehindNeck(mc)}
						{neck}
						{clothes.collar}
						{ear(-1)}
						{ear(1)}
						{modernEarbuds(mc)}
						{face}
						{modernGlasses(mc)}
						{hairTop}
						{modernGrit(mc)}
						{modernHoodFront(mc)}
						{modernHat(mc)}
						{accFront}
						<rect width="200" height="240" fill={url("vig")} opacity={frame === "badge" ? 0.55 : 1} />
						<rect width="200" height="240" filter={url("canvas")} opacity={0.4} />
						{modernPhotoOverlay(frame)}
					</g>
				</g>
				{framed && modernFrameFront({ id, url }, frame, ml, spec.seed, name)}
				{!framed && shown && (
					<g>
						<rect x="30" y="214" width="140" height="18" rx="3" fill="#14171c" fillOpacity={0.8} />
						<text x="100" y="227" textAnchor="middle" fontSize="11" fontFamily="Inter, 'Helvetica Neue', Arial, sans-serif" fill="#e8ecf0" letterSpacing="0.5">{shown}</text>
					</g>
				)}
			</svg>
		);
	}
	return (
		<svg
			viewBox="0 0 200 240"
			width={size}
			height={height}
			className={className}
			role="img"
			aria-label={title ?? name ?? "Portrait"}
			style={{ display: "block" }}
		>
			{defs}

			<g clipPath={url("frame")}>
				{/* Background */}
				<rect width="200" height="240" fill={url("bg")} />
				<ellipse cx={CX} cy={110} rx={90} ry={95} fill={url("glow")} />
				{motes.map(([x, y, r, o], i) => <circle key={i} cx={r1(x)} cy={r1(y)} r={r1(r)} fill="#fff" opacity={r1(o * 10) / 10} />)}

				{accBack}
				{hairBack}
				{clothing}
				{neck}
				{draconic && horns}
				{ear(-1)}
				{ear(1)}

				{face}

				{hairTop}
				{accFront}

				{/* Vignette + paper grain */}
				<rect width="200" height="240" fill={url("vig")} />
				<rect width="200" height="240" filter={url("canvas")} opacity={0.6} />
			</g>

			{framed && (
				<g fill="none">
					<rect x="1.5" y="1.5" width="197" height="237" rx="9" stroke="#1a1208" strokeWidth={3} />
					<rect x="3.5" y="3.5" width="193" height="233" rx="8" stroke={url("gold")} strokeWidth={2.2} />
					<rect x="7" y="7" width="186" height="226" rx="6" stroke="#f6dc8a" strokeOpacity={0.25} strokeWidth={0.8} />
					{[[8, 8], [192, 8], [8, 232], [192, 232]].map(([x, y]) => (
						<path key={`${x}-${y}`} d={`M${x - 4} ${y} L${x} ${y - 4} L${x + 4} ${y} L${x} ${y + 4} Z`} fill={url("gold")} stroke="#3a2a10" strokeWidth={0.6} />
					))}
				</g>
			)}
			{name && (
				<g>
					<rect x="30" y="214" width="140" height="18" rx="3" fill="#1a1208" fillOpacity={0.82} stroke={url("gold")} strokeWidth={1} />
					<text x="100" y="227" textAnchor="middle" fontSize="11" fontFamily="Georgia, 'Times New Roman', serif" fill="#f3e6c4" letterSpacing="0.5">
						{name.length > 22 ? name.slice(0, 21) + "…" : name}
					</text>
				</g>
			)}
		</svg>
	);
}

export type { PortraitTraits };
export default Portrait;
