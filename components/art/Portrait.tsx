import { useId } from "react";
import type { PortraitSpec } from "@/lib/game/types";
import { BACKGROUND_COLORS, portraitTraits } from "@/lib/art/portrait";
import { mix } from "@/lib/art/color";
import { buildPalette, buildRig, CX, subRng } from "./portrait/rig";
import { r, type Ctx } from "./portrait/ctx";
import { ageLines, brows, ears, eyes, facialHair, freckles, headShading, mouth, nose } from "./portrait/face";
import { body } from "./portrait/body";
import { clothing } from "./portrait/clothing";
import { hair } from "./portrait/hair";
import { headwearBack, headwearFront, marks } from "./portrait/accessories";
import { horns, speciesOver, speciesUnder } from "./portrait/species";
import { signatureBack, signatureFace, signatureFront } from "./portrait/signature";

/**
 * Painted procedural bust portrait. Deterministic for a given spec and SSR-safe
 * (no effects, no randomness outside the spec seed). Key light from the upper
 * left, accent-colored rim light on the right; detail scales with `size`.
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
}

const HEADWEAR = new Set(["hood", "helmet", "circlet", "crown", "headband"]);

export function Portrait({ spec, size = 160, speciesId, name, framed = true, className, title }: PortraitProps) {
	const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const id = (s: string) => `pt${uid}-${s}`;
	const url = (s: string) => `url(#${id(s)})`;
	const t = portraitTraits(spec, speciesId);
	const rig = buildRig(spec, t, speciesId);
	const bg = BACKGROUND_COLORS[spec.background] ?? BACKGROUND_COLORS.slate;
	const pal = buildPalette(spec, t, bg);
	const detail: 0 | 1 | 2 = size <= 64 ? 0 : size <= 110 ? 1 : 2;
	const acc = spec.accessory ?? "none";
	const headwear: Ctx["headwear"] = HEADWEAR.has(acc) ? (acc as Ctx["headwear"]) : t.signature === "wizard_hat" || t.signature === "feathered_hat" ? t.signature : "none";
	const c: Ctx = { spec, t, rig, pal, f: new Set(spec.features), id, url, detail, acc, headwear };
	const hairL = hair(c);
	const tilt = `rotate(${r(rig.tilt)} ${rig.pivot[0]} ${rig.pivot[1]})`;
	const brng = subRng(spec, "bg");
	const patches = Array.from({ length: 3 }, () => [brng.range(20, 180), brng.range(20, 200), brng.range(40, 80)] as const);
	const pointy = c.f.has("pointed_ears") || c.f.has("long_ears");

	return (
		<svg viewBox="0 0 200 240" width={size} height={size * 1.2} className={className} role="img" aria-label={title ?? name ?? "Portrait"} style={{ display: "block" }}>
			<defs>
				<radialGradient id={id("bg")} cx="40%" cy="32%" r="85%">
					<stop offset="0" stopColor={mix(pal.bgA, "#fff4dc", 0.12)} />
					<stop offset="0.5" stopColor={pal.bgA} />
					<stop offset="1" stopColor={pal.bgB} />
				</radialGradient>
				<radialGradient id={id("glow")}>
					<stop offset="0" stopColor={pal.accent} stopOpacity={0.75} />
					<stop offset="0.55" stopColor={pal.accent} stopOpacity={0.25} />
					<stop offset="1" stopColor={pal.accent} stopOpacity={0} />
				</radialGradient>
				<radialGradient id={id("patch")}>
					<stop offset="0" stopColor="#fff2d8" stopOpacity={0.22} />
					<stop offset="1" stopColor="#fff2d8" stopOpacity={0} />
				</radialGradient>
				<radialGradient id={id("dark")}>
					<stop offset="0" stopColor="#000" stopOpacity={0.45} />
					<stop offset="1" stopColor="#000" stopOpacity={0} />
				</radialGradient>
				<linearGradient id={id("skin")} x1="0" y1="0.1" x2="1" y2="0.2">
					<stop offset="0" stopColor={pal.skinLight} />
					<stop offset="0.4" stopColor={pal.skin} />
					<stop offset="0.78" stopColor={mix(pal.skin, pal.skinShadow, 0.6)} />
					<stop offset="1" stopColor={pal.skinShadow} />
				</linearGradient>
				<linearGradient id={id("skinBody")} gradientUnits="userSpaceOnUse" x1={CX - 60} y1={rig.neckTop} x2={CX + 60} y2={rig.neckTop + 40}>
					<stop offset="0" stopColor={pal.skin} />
					<stop offset="0.55" stopColor={mix(pal.skin, pal.skinShadow, 0.5)} />
					<stop offset="1" stopColor={pal.skinShadow} />
				</linearGradient>
				<linearGradient id={id("hair")} x1="0.15" y1="0" x2="0.85" y2="1">
					<stop offset="0" stopColor={pal.hairLight} />
					<stop offset="0.45" stopColor={pal.hair} />
					<stop offset="1" stopColor={pal.hairDark} />
				</linearGradient>
				<linearGradient id={id("hairLock")} x1="0" y1="0" x2="0.3" y2="1">
					<stop offset="0" stopColor={pal.hair} />
					<stop offset="1" stopColor={pal.hairDark} />
				</linearGradient>
				<linearGradient id={id("hairBack")} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor={mix(pal.hair, pal.hairDark, 0.4)} />
					<stop offset="1" stopColor={pal.hairDark} />
				</linearGradient>
				<linearGradient id={id("cloth")} gradientUnits="userSpaceOnUse" x1="10" y1={rig.collarY - 20} x2="190" y2="250">
					<stop offset="0" stopColor={pal.clothLight} />
					<stop offset="0.4" stopColor={pal.cloth} />
					<stop offset="1" stopColor={pal.clothDark} />
				</linearGradient>
				<linearGradient id={id("leather")} gradientUnits="userSpaceOnUse" x1="10" y1={rig.collarY - 20} x2="190" y2="250">
					<stop offset="0" stopColor={mix(mix(pal.cloth, "#6a4428", 0.55), "#e8c890", 0.2)} />
					<stop offset="0.45" stopColor={mix(pal.cloth, "#5a3a20", 0.6)} />
					<stop offset="1" stopColor={mix(pal.cloth, "#1a0e06", 0.7)} />
				</linearGradient>
				<linearGradient id={id("metal")} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#e2e6ea" />
					<stop offset="0.3" stopColor="#8a9098" />
					<stop offset="0.55" stopColor="#b8bec6" />
					<stop offset="1" stopColor="#2c3036" />
				</linearGradient>
				<linearGradient id={id("metalDark")} gradientUnits="userSpaceOnUse" x1="20" y1={rig.collarY} x2="180" y2="250">
					<stop offset="0" stopColor="#9aa0a8" />
					<stop offset="0.5" stopColor="#5a6068" />
					<stop offset="1" stopColor="#24282e" />
				</linearGradient>
				<linearGradient id={id("gold")} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#f8e09a" />
					<stop offset="0.5" stopColor="#c99a3a" />
					<stop offset="1" stopColor="#6a4614" />
				</linearGradient>
				<linearGradient id={id("furGrad")} x1="0" y1="0" x2="0.4" y2="1">
					<stop offset="0" stopColor="#b0a08a" stopOpacity={0.7} />
					<stop offset="1" stopColor="#2a2018" stopOpacity={0.6} />
				</linearGradient>
				<radialGradient id={id("iris")} cx="55%" cy="62%" r="60%">
					<stop offset="0" stopColor="#fff" stopOpacity={0.35} />
					<stop offset="0.5" stopColor="#fff" stopOpacity={0} />
					<stop offset="0.85" stopColor="#000" stopOpacity={0.25} />
					<stop offset="1" stopColor="#000" stopOpacity={0.65} />
				</radialGradient>
				<radialGradient id={id("vig")} cx="50%" cy="42%" r="72%">
					<stop offset="0.55" stopColor="#000" stopOpacity={0} />
					<stop offset="1" stopColor="#000" stopOpacity={0.6} />
				</radialGradient>
				<pattern id={id("rings")} width="3.2" height="2.8" patternUnits="userSpaceOnUse">
					<path d="M0 1.6 a1.6 1.4 0 0 1 3.2 0" stroke="#e8ecf0" strokeWidth="0.45" fill="none" opacity="0.65" />
					<path d="M-1.6 3 a1.6 1.4 0 0 1 3.2 0 M1.6 3 a1.6 1.4 0 0 1 3.2 0" stroke="#0a0c10" strokeWidth="0.5" fill="none" opacity="0.6" />
				</pattern>
				<filter id={id("blurS")} x="-30%" y="-30%" width="160%" height="160%">
					<feGaussianBlur stdDeviation="0.8" />
				</filter>
				<filter id={id("blurM")} x="-30%" y="-30%" width="160%" height="160%">
					<feGaussianBlur stdDeviation="2.2" />
				</filter>
				<filter id={id("blurL")} x="-30%" y="-30%" width="160%" height="160%">
					<feGaussianBlur stdDeviation="5" />
				</filter>
				{detail > 1 && (
					<>
						<filter id={id("grain")}>
							<feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="1" seed={spec.seed % 97} result="n" />
							<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.3" result="a" />
							<feComposite in="SourceGraphic" in2="a" operator="in" />
						</filter>
						<filter id={id("canvas")} x="0" y="0" width="100%" height="100%">
							<feTurbulence type="fractalNoise" baseFrequency="0.75 0.5" numOctaves="2" seed={spec.seed % 89} />
							<feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.5  0 0 0 0 0.42  0 0 0 0.11 0" />
						</filter>
					</>
				)}
				<clipPath id={id("head")}>
					<path d={rig.headD} />
				</clipPath>
				<clipPath id={id("rim")}>
					<rect x={r(CX + rig.w * 0.3)} y="0" width="200" height={r(rig.noseBottom)} />
				</clipPath>
				<clipPath id={id("frame")}>
					<rect x="0" y="0" width="200" height="240" rx="10" />
				</clipPath>
			</defs>

			<g clipPath={url("frame")}>
				{/* painted backdrop with the character's accent glow */}
				<rect width="200" height="240" fill={url("bg")} />
				<ellipse cx={CX - 14} cy={92} rx={110} ry={105} fill={url("glow")} opacity={0.5} />
				{patches.map(([x, y, rr], i) => (
					<ellipse key={i} cx={r(x)} cy={r(y)} rx={r(rr)} ry={r(rr * 0.7)} fill={url(i === 2 ? "dark" : "patch")} />
				))}
				<ellipse cx={CX + 34} cy={150} rx={80} ry={90} fill={url("dark")} opacity={0.7} />

				{signatureBack(c)}
				<g transform={tilt}>
					{headwearBack(c)}
					{hairL.back}
				</g>
				{body(c)}
				{clothing(c)}
				<g transform={tilt}>
					{horns(c, "back")}
					{ears(c)}
					<path d={rig.headD} fill={url("skin")} />
					{headShading(c)}
					{speciesUnder(c)}
					{freckles(c)}
					<path d={rig.headD} fill="none" stroke={pal.skinDeep} strokeWidth={0.8} opacity={0.35} />
					{/* accent rim light on the shadow side */}
					<g clipPath={url("head")}>
						<path d={rig.headD} fill="none" stroke={pal.accentLight} strokeWidth={2.4} opacity={0.4} filter={url("blurS")} clipPath={url("rim")} />
					</g>
					{ageLines(c)}
					{brows(c)}
					{eyes(c)}
					{nose(c)}
					{facialHair(c)}
					{mouth(c)}
					{speciesOver(c)}
					{marks(c)}
					{hairL.front}
					{pointy && !rig.draconic && c.headwear !== "hood" && c.headwear !== "helmet" && hairL.front && ears(c)}
					{horns(c, "front")}
					{headwearFront(c)}
					{signatureFace(c)}
				</g>
				{signatureFront(c)}

				<rect width="200" height="240" fill={url("vig")} />
				{detail > 1 && <rect width="200" height="240" filter={url("canvas")} opacity={0.7} />}
			</g>

			{framed && (
				<g fill="none">
					<rect x="1.5" y="1.5" width="197" height="237" rx="9" stroke="#1a1208" strokeWidth={3} />
					<rect x="3.5" y="3.5" width="193" height="233" rx="8" stroke={url("gold")} strokeWidth={2.2} />
					<rect x="7" y="7" width="186" height="226" rx="6" stroke={pal.accentLight} strokeOpacity={0.35} strokeWidth={0.8} />
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

export type { PortraitTraits } from "@/lib/art/portrait";
export default Portrait;
