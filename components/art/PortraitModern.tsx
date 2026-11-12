import type { ReactNode } from "react";
import type { PortraitSpec } from "@/lib/game/types";
import { mix, shade } from "@/lib/art/color";
import { ArtRng, r1 } from "@/lib/art/rand";
import { modernDress, modernRole, OUTFIT, type Hat, type Outfit } from "./sprite/person";

/**
 * The Quiet (modern zombie ruleset): present-day clothes, headwear, extras and
 * photo frames for the SVG bust portrait. The face is drawn by Portrait.tsx
 * exactly as in fantasy; this module only dresses and frames it. Outfit and
 * headwear come from the same profession/role mapping as the pixel sprites
 * (sprite/person.ts → modernDress), so portrait and sprite match.
 */

/** "badge": worn staff ID card. "polaroid": instant photo taped to a wall. */
export type ModernFrame = "badge" | "polaroid";
/** The frame used when a caller doesn't choose one (flip here once the user picks). */
export const MODERN_FRAME_DEFAULT: ModernFrame = "badge";

/** Who the person is: profession class ids (PC) and/or a role text (NPC). */
export interface ModernWho {
	classes?: string[];
	text?: string;
	/** Root Access: ID cards come from Marea's institutions, not Kessler Falls. */
	city?: "marea";
}

type CivWear = "denim_jacket" | "leather" | "flannel" | "puffer";
type HatKind = Exclude<Hat, "headphones"> | "hood" | "none";
type Dept = "medical" | "police" | "fire" | "army" | "school" | "prison" | "church" | "diner" | "farm" | "civ";

export interface ModernLook {
	outfit: Outfit;
	hat: HatKind;
	/** Radio host: headphones resting around the neck. */
	headphones: boolean;
	civ: CivWear;
	/** Main garment colour. */
	main: string;
	/** Shirt / tee under an open jacket. */
	shirt: string;
	tie: string;
	capColor: string;
	glasses: "none" | "thick" | "wire" | "tortoise";
	earbuds: boolean;
	whistle: boolean;
	grime: 0 | 1 | 2;
	blood: boolean;
	plaster: "none" | "brow" | "cheek" | "chin";
	dept: Dept;
	/** Which city issued the ID card (default Kessler Falls, The Quiet). */
	city?: "marea";
	/** Seeded draws for grit placement. */
	specks: [number, number, number][];
}

const TEES = ["#e8e4d8", "#2a2c30", "#8a8e94", "#8a3a2a", "#3a5a7a", "#5a6a4a", "#c8b48a", "#6a4a6a"];
const TIES = ["#8a2a2a", "#2a3a5a", "#3a5a3a", "#5a2a4a", "#6a5a2a"];
const CAPS = ["#2a3a5a", "#8a2a2a", "#3a5a3a", "#2a2c30", "#b8a07a", "#5a6a7a"];
const LEATHER = ["#2a2624", "#4a2e20", "#3a2a22"];
const PUFFER = ["#1e2024", "#2a3a5a", "#4e5636", "#8a2a26", "#b88a2a", "#5a5e66"];
const PLAID = [
	["#9a2e2a", "#3a1414"],
	["#3e5a3a", "#1a2a3a"],
	["#3a5a8a", "#2a2c34"],
	["#8a6a3a", "#3a2a1a"],
];
const DEPT: Partial<Record<Outfit, Dept>> = {
	scrubs: "medical", police: "police", turnout: "fire", fatigues: "army", labcoat: "school", prison: "prison", clergy: "church", apron: "diner", flannel: "farm",
};

/** Deterministic modern dress for a spec. Uses its own rng: the face's draws are untouched. */
export function modernLook(spec: PortraitSpec, who: ModernWho, cloth: string, age: number): ModernLook {
	const role = modernDress(spec, who);
	const r = new ArtRng((spec.seed ^ 0x2c1b3c6d) >>> 0);
	const civ = r.pick(["denim_jacket", "leather", "flannel", "puffer", "denim_jacket"] as const);
	const shirt = r.pick(TEES);
	const tie = r.pick(TIES);
	const capColor = r.pick(CAPS);
	const leather = r.pick(LEATHER);
	const puffer = r.pick(PUFFER);
	const plaid = r.pick(PLAID);
	const hatRoll = r.next(), glassRoll = r.next(), budRoll = r.next(), grimeRoll = r.next(), bloodRoll = r.next(), plasterRoll = r.next();
	const glassStyle = r.pick(["thick", "wire", "tortoise"] as const);
	const plasterAt = r.pick(["brow", "cheek", "chin"] as const);
	const specks = Array.from({ length: 6 }, () => [r.next(), r.next(), r.next()] as [number, number, number]);

	const o = role.outfit;
	const acc = spec.accessory ?? "none";
	let hat: HatKind = role.hat === "headphones" ? "none" : role.hat;
	if (acc === "hood") hat = o === "hoodie" ? "hood" : hat === "none" ? "beanie" : hat;
	if (acc === "headband" && hat === "none") hat = "sweatband";
	if (hat === "none" && (o === "denim" || o === "hoodie" || o === "prison")) hat = hatRoll < 0.16 ? "cap" : hatRoll < 0.28 ? "beanie" : "none";

	const main =
		o === "hoodie" || o === "cardigan" ? cloth
		: o === "tracksuit" ? (role.gear === "bat" ? "#a82a2a" : OUTFIT.tracksuit.top)
		: o === "denim" ? (civ === "leather" ? leather : civ === "puffer" ? puffer : civ === "flannel" ? plaid[0] : OUTFIT.denim.top)
		: o === "apron" ? spec.seed % 4 === 0 ? "#d89aa8" : spec.seed % 4 === 1 ? "#9ac8b8" : spec.seed % 4 === 2 ? "#9ab8d0" : OUTFIT.apron.top
		: OUTFIT[o].top;
	const glassP = o === "labcoat" ? 0.55 : o === "cardigan" ? 0.45 : o === "fatigues" || o === "turnout" ? 0.08 : 0.2;
	return {
		outfit: o,
		hat,
		headphones: role.hat === "headphones",
		civ,
		main,
		shirt: o === "denim" && civ === "flannel" ? plaid[1] : shirt,
		tie,
		capColor: hat === "beanie" && o === "hoodie" && role.hat === "beanie" ? "#2a2c30" : capColor,
		glasses: acc !== "eyepatch" && glassRoll < glassP ? glassStyle : "none",
		earbuds: age < 0.45 && hat !== "hood" && (o === "denim" || o === "hoodie" || o === "tracksuit" || o === "scrubs") && budRoll < 0.2,
		whistle: o === "tracksuit" && role.gear !== "bat",
		grime: grimeRoll < 0.3 ? 1 : grimeRoll < 0.42 ? 2 : 0,
		blood: bloodRoll < 0.22,
		plaster: plasterRoll < 0.16 ? plasterAt : "none",
		// The ID card is from where they worked (profession/role), whatever they wear now.
		dept: DEPT[modernRole(who).outfit] ?? DEPT[o] ?? "civ",
		...(who.city ? { city: who.city } : {}),
		specks,
	};
}

/** Geometry and helpers shared with Portrait.tsx. */
export interface ModernCtx {
	id: (s: string) => string;
	url: (s: string) => string;
	look: ModernLook;
	/** Head half-width, neck half-width, head top, eye line, chin. */
	w: number;
	nw: number;
	top: number;
	eyeY: number;
	chin: number;
	eyeSpacing: number;
	skin: string;
	seed: number;
}

const CX = 100;
const SH = "M0 244 C2 204 28 180 72 172 L128 172 C172 180 198 204 200 244 Z";
const X = (s: number, o: number) => r1(CX + s * o);
const line = (c: string) => shade(c, -0.32);
const SIDES = [-1, 1] as const;

function grad(id: string, c: string): ReactNode {
	return (
		<linearGradient key={id} id={id} x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stopColor={shade(c, 0.1)} />
			<stop offset="0.6" stopColor={c} />
			<stop offset="1" stopColor={shade(c, -0.14)} />
		</linearGradient>
	);
}

/** The front opening of a jacket/shirt between two panels: inner edges at x offsets ix0 (y 174) → ix1 (y 244). */
const openingD = (ix0: number, ix1: number) =>
	`M${X(-1, ix0)} 174 C${X(-1, ix0)} 200 ${X(-1, ix1 + 2)} 224 ${X(-1, ix1)} 244 L${X(1, ix1)} 244 C${X(1, ix1 + 2)} 224 ${X(1, ix0)} 200 ${X(1, ix0)} 174 Z`;
const edgeD = (s: number, ix0: number, ix1: number) => `M${X(s, ix0)} 174 C${X(s, ix0)} 200 ${X(s, ix1 + 2)} 224 ${X(s, ix1)} 244`;
/** x offset of the opening edge at height y (straight-line approximation). */
const edgeAt = (ix0: number, ix1: number, y: number) => ix0 + ((ix1 - ix0) * (y - 174)) / 70;

/** Skin visible below the neck: a crew (U) or V neckline down to `depth`. */
function chest(c: ModernCtx, half: number, depth: number, v = false): ReactNode {
	const d = v
		? `M${X(-1, half)} 174 L${CX} ${depth} L${X(1, half)} 174 Z`
		: `M${X(-1, half)} 174 Q${CX} ${depth + (depth - 174)} ${X(1, half)} 174 Z`;
	return <path d={d} fill={shade(c.skin, -0.2)} />;
}

/** Crew-neck band of a tee. */
function crew(c: ModernCtx, color: string, half: number, depth = 188): ReactNode {
	const d = `M${X(-1, half)} 174 Q${CX} ${depth + (depth - 174)} ${X(1, half)} 174`;
	return (
		<g fill="none">
			{chest(c, half, depth)}
			<path d={d} stroke={line(color)} strokeWidth={5.4} />
			<path d={d} stroke={shade(color, -0.06)} strokeWidth={3.6} />
		</g>
	);
}

/** Shirt collar leaves (pointing down toward the centre), optionally spread for an open neck. */
function shirtCollar(c: ModernCtx, color: string, spread = 0): ReactNode {
	const n = c.nw;
	return SIDES.map((s) => (
		<path
			key={s}
			d={`M${X(s, n + 2)} 164 C${X(s, n + 8)} 170 ${X(s, n + 14)} 176 ${X(s, n + 16)} 180 L${X(s, 9 + spread)} ${196 + spread * 0.2} L${X(s, 2 + spread * 0.6)} 182 C${X(s, 6)} 176 ${X(s, n - 2)} 170 ${X(s, n + 2)} 164 Z`}
			fill={s < 0 ? shade(color, 0.04) : shade(color, -0.04)}
			stroke={line(color)}
			strokeWidth={1.2}
			strokeLinejoin="round"
		/>
	));
}

/** A tie: knot and blade. */
function tie(color: string): ReactNode {
	return (
		<g stroke={line(color)} strokeWidth={1.1} strokeLinejoin="round">
			<path d={`M${CX - 4} 186 L${CX - 6.5} 230 L${CX} 240 L${CX + 6.5} 230 L${CX + 4} 186 Z`} fill={color} />
			<path d={`M${CX - 5} 180 L${CX + 5} 180 L${CX + 3.6} 188 L${CX - 3.6} 188 Z`} fill={shade(color, 0.08)} />
			<path d={`M${CX - 1} 194 L${CX + 2} 226`} stroke={shade(color, 0.14)} strokeWidth={1.4} opacity={0.6} />
		</g>
	);
}

/** Jacket panels on top of the shirt: draws the shirt region, then shadows and panel edges. */
function opening(c: ModernCtx, ix0: number, ix1: number, shirt: ReactNode, jacket: string): ReactNode {
	const k = c.id("mopen");
	return (
		<g>
			<clipPath id={k}><path d={openingD(ix0, ix1)} /></clipPath>
			<g clipPath={`url(#${k})`}>{shirt}</g>
			<g clipPath={`url(#${k})`} opacity={0.45}>
				{SIDES.map((s) => <path key={s} d={edgeD(s, ix0, ix1)} stroke="#000" strokeWidth={7} fill="none" filter={c.url("soft1")} />)}
			</g>
			{SIDES.map((s) => <path key={s} d={edgeD(s, ix0, ix1)} stroke={line(jacket)} strokeWidth={1.4} fill="none" />)}
		</g>
	);
}

/** Notched lapel lying along an opening edge. */
function lapels(c: ModernCtx, color: string, ix0: number, ix1: number, wide = 0): ReactNode {
	const n = c.nw;
	return SIDES.map((s) => {
		const tipY = 222 + wide;
		const tip = edgeAt(ix0, ix1, tipY);
		const d = `M${X(s, ix0)} 174 L${X(s, n + 24 + wide)} 177 L${X(s, 38 + wide)} 194 L${X(s, 31 + wide * 0.6)} 197 L${X(s, tip + 2)} ${tipY} C${X(s, ix0 + 1)} 206 ${X(s, ix0)} 190 ${X(s, ix0)} 174 Z`;
		return <path key={s} d={d} fill={s < 0 ? shade(color, 0.05) : shade(color, -0.03)} stroke={line(color)} strokeWidth={1.2} strokeLinejoin="round" />;
	});
}

/** Pointed jacket collar (denim, barn, work jacket) lying on the shoulders. */
function jacketCollar(c: ModernCtx, color: string): ReactNode {
	const n = c.nw;
	return SIDES.map((s) => (
		<path key={s} d={`M${X(s, n + 2)} 168 C${X(s, n + 12)} 170 ${X(s, n + 22)} 174 ${X(s, n + 28)} 178 L${X(s, n + 16)} 200 L${X(s, n + 4)} 182 Z`} fill={s < 0 ? shade(color, 0.06) : shade(color, -0.04)} stroke={line(color)} strokeWidth={1.2} strokeLinejoin="round" />
	));
}

/** Stand collar (tracksuit, puffer, clergy) wrapping the base of the neck. */
function standCollar(c: ModernCtx, color: string, h = 16): ReactNode {
	const n = c.nw;
	return <path d={`M${X(-1, n + 9)} 182 L${X(-1, n + 5)} ${178 - h} Q${CX} ${184 - h} ${X(1, n + 5)} ${178 - h} L${X(1, n + 9)} 182 Q${CX} 190 ${X(-1, n + 9)} 182 Z`} fill={shade(color, -0.04)} stroke={line(color)} strokeWidth={1.2} />;
}

function zipper(y0: number, y1: number, pull = true): ReactNode {
	return (
		<g>
			<path d={`M${CX} ${y0} L${CX} ${y1}`} stroke="#3a3c40" strokeWidth={2.2} />
			<path d={`M${CX} ${y0} L${CX} ${y1}`} stroke="#c8ccd2" strokeWidth={1.2} strokeDasharray="1 1.2" />
			{pull && <rect x={CX - 2} y={y0 + 2} width={4} height={8} rx={1.2} fill="#b8bcc2" stroke="#3a3c40" strokeWidth={0.7} />}
		</g>
	);
}

function pens(x: number, y: number): ReactNode {
	return (
		<g strokeWidth={0.7} stroke="#1a1c20">
			<rect x={x} y={y} width={2.6} height={10} rx={1} fill="#2a4a9a" />
			<rect x={x + 4} y={y + 1} width={2.6} height={9} rx={1} fill="#b8302a" />
		</g>
	);
}

/** Clothing under and over the neck, by outfit. */
export function modernClothes(c: ModernCtx): { under: ReactNode; collar: ReactNode } {
	const L = c.look;
	const n = c.nw;
	const main = L.main;
	const defs: ReactNode[] = [grad(c.id("mc"), main)];
	const body = (color: string, key = "mc") => <path d={SH} fill={`url(#${c.id(key)})`} stroke={line(color)} strokeWidth={1.4} />;
	const folds = (color: string) => (
		<g fill="none">
			<path d="M40 244 C44 226 50 212 62 200 M160 244 C156 226 150 212 138 200" stroke={shade(color, -0.16)} strokeWidth={3} opacity={0.5} filter={c.url("soft1")} />
			<path d="M20 230 C30 206 48 194 70 186" stroke={shade(color, 0.12)} strokeWidth={2} opacity={0.35} />
		</g>
	);
	const clip = c.id("mbody");
	const inBody = (node: ReactNode) => <g clipPath={`url(#${clip})`}>{node}</g>;
	let under: ReactNode = null;
	let collar: ReactNode = null;
	const tee = (color: string) => <g><rect x={0} y={150} width={200} height={100} fill={color} /><rect x={0} y={150} width={200} height={100} fill={`url(#${c.id("mshade")})`} /></g>;

	switch (L.outfit) {
		case "hoodie": {
			under = (
				<g>
					{body(main)}
					{folds(main)}
					{/* kangaroo pocket and raglan seams */}
					<path d={`M${X(-1, 44)} 244 Q${X(-1, 40)} 232 ${X(-1, 30)} 230 L${X(1, 30)} 230 Q${X(1, 40)} 232 ${X(1, 44)} 244`} stroke={line(main)} strokeWidth={1.2} fill="none" opacity={0.8} />
					{SIDES.map((s) => <path key={s} d={`M${X(s, n + 22)} 182 Q${X(s, 52)} 204 ${X(s, 62)} 244`} stroke={line(main)} strokeWidth={0.9} fill="none" opacity={0.5} />)}
					{L.hat !== "hood" && (
						<path d={`M${X(-1, n + 27)} 190 C${X(-1, n + 30)} 166 ${X(-1, n + 8)} 158 ${CX} 158 C${X(1, n + 8)} 158 ${X(1, n + 30)} 166 ${X(1, n + 27)} 190 Q${CX} 176 ${X(-1, n + 27)} 190 Z`} fill={shade(main, -0.12)} stroke={line(main)} strokeWidth={1.2} />
					)}
				</g>
			);
			const hem = `M${X(-1, n + 8)} 174 Q${X(-1, 5)} 186 ${CX} 192 Q${X(1, 5)} 186 ${X(1, n + 8)} 174`;
			collar = (
				<g>
					<path d={`${hem} Z`} fill={shade(c.skin, -0.2)} />
					<path d={hem} stroke={line(main)} strokeWidth={6.4} fill="none" />
					<path d={hem} stroke={shade(main, 0.06)} strokeWidth={4.4} fill="none" />
					{SIDES.map((s) => {
						const d = s < 0 ? `M${X(s, 7)} 190 Q${X(s, 10)} 206 ${X(s, 9)} 222` : `M${X(s, 7)} 190 Q${X(s, 9)} 202 ${X(s, 12)} 216`;
						const end = s < 0 ? [X(s, 9), 222] : [X(s, 12), 216];
						return (
							<g key={s}>
								<path d={d} stroke={shade(main, -0.4)} strokeWidth={3.6} fill="none" strokeLinecap="round" />
								<path d={d} stroke="#ece8dc" strokeWidth={2.2} fill="none" strokeLinecap="round" />
								<rect x={end[0] - 1.6} y={end[1] - 1} width={3.2} height={5} rx={1} fill="#9aa0a8" stroke="#3a3c40" strokeWidth={0.6} />
							</g>
						);
					})}
				</g>
			);
			break;
		}
		case "scrubs": {
			under = (
				<g>
					{body(main)}
					{folds(main)}
					{/* stethoscope tubing behind the neck */}
					<path d={`M${X(-1, n + 8)} 182 Q${CX} 160 ${X(1, n + 8)} 182`} stroke="#22242a" strokeWidth={3.4} fill="none" />
					{/* lower pocket with pens */}
					<path d={`M${X(-1, 48)} 222 L${X(-1, 26)} 222 L${X(-1, 27)} 244`} stroke={line(main)} strokeWidth={1.2} fill="none" />
					{pens(X(-1, 44), 214)}
				</g>
			);
			collar = (
				<g>
					{chest(c, n + 8, 206, true)}
					<path d={`M${X(-1, n + 8)} 174 L${CX} 206 L${X(1, n + 8)} 174`} stroke={line(main)} strokeWidth={5.6} fill="none" strokeLinejoin="round" />
					<path d={`M${X(-1, n + 8)} 174 L${CX} 206 L${X(1, n + 8)} 174`} stroke={shade(main, -0.1)} strokeWidth={3.6} fill="none" strokeLinejoin="round" />
					{/* stethoscope */}
					<path d={`M${X(-1, n + 6)} 176 C${X(-1, n + 6)} 196 ${X(-1, 22)} 206 ${X(-1, 21)} 222`} stroke="#22242a" strokeWidth={3.2} fill="none" strokeLinecap="round" />
					<circle cx={X(-1, 21)} cy={226} r={5} fill="#c8ccd2" stroke="#3a3c40" strokeWidth={1} />
					<circle cx={X(-1, 21)} cy={226} r={2.4} fill="#8a9098" />
					<path d={`M${X(1, n + 6)} 176 C${X(1, n + 6)} 192 ${X(1, 22)} 198 ${X(1, 22)} 208`} stroke="#22242a" strokeWidth={3.2} fill="none" strokeLinecap="round" />
					<path d={`M${X(1, 22)} 208 Q${X(1, 16)} 214 ${X(1, 17)} 222 M${X(1, 22)} 208 Q${X(1, 28)} 214 ${X(1, 27)} 222`} stroke="#b8bcc2" strokeWidth={1.8} fill="none" strokeLinecap="round" />
					{/* ID badge on a reel */}
					<circle cx={X(1, 40)} cy={194} r={3} fill="#5a5e66" stroke="#2a2c30" strokeWidth={0.8} />
					<path d={`M${X(1, 40)} 197 L${X(1, 40)} 201`} stroke="#2a2c30" strokeWidth={0.9} />
					<g transform={`rotate(4 ${X(1, 40)} 212)`}>
						<rect x={X(1, 40) - 8} y={201} width={16} height={21} rx={1.6} fill="#f2f0ea" stroke="#5a5e66" strokeWidth={0.9} />
						<rect x={X(1, 40) - 8} y={201} width={16} height={5} rx={1.4} fill="#2f6f7a" />
						<rect x={X(1, 40) - 6} y={208} width={6} height={7} fill="#9aa4ae" />
						<path d={`M${X(1, 40) + 1.5} 209 h4 M${X(1, 40) + 1.5} 212 h4 M${X(1, 40) - 6} 218 h12`} stroke="#6a6e76" strokeWidth={0.9} />
					</g>
				</g>
			);
			break;
		}
		case "police": {
			under = (
				<g>
					{body(main)}
					{folds(main)}
					{/* epaulettes */}
					{SIDES.map((s) => (
						<g key={s}>
							<path d={`M${X(s, n + 14)} 175 L${X(s, 62)} 181 L${X(s, 63)} 188 L${X(s, n + 14)} 182 Z`} fill={shade(main, -0.1)} stroke={line(main)} strokeWidth={1} />
							<circle cx={X(s, n + 18)} cy={179} r={1.5} fill="#c8ccd2" />
						</g>
					))}
					{/* pocket flaps */}
					{SIDES.map((s) => <path key={s} d={`M${X(s, 22)} 210 L${X(s, 48)} 210 L${X(s, 48)} 216 L${X(s, 35)} 219 L${X(s, 22)} 216 Z`} fill={shade(main, -0.04)} stroke={line(main)} strokeWidth={1} />)}
					{/* shoulder patch */}
					<path d="M8 222 Q8 210 18 208 Q28 210 28 222 Q18 232 8 222 Z" fill="#c8a040" stroke="#3a2a10" strokeWidth={0.9} />
					<path d="M12 219 Q18 214 24 219" stroke="#24324e" strokeWidth={2.4} fill="none" />
				</g>
			);
			const bx = X(1, 35), by = 199;
			collar = (
				<g>
					{chest(c, n + 4, 186, true)}
					{tie("#16171a")}
					{shirtCollar(c, shade(main, -0.02))}
					{/* badge */}
					<path d={`M${bx - 7.5} ${by - 8} Q${bx} ${by - 12} ${bx + 7.5} ${by - 8} L${bx + 6.5} ${by + 3} Q${bx} ${by + 10} ${bx - 6.5} ${by + 3} Z`} fill={c.url("mgold")} stroke="#4a3410" strokeWidth={1} />
					<circle cx={bx} cy={by - 1} r={2.6} fill="none" stroke="#7a5418" strokeWidth={0.9} />
					{/* name plate */}
					<rect x={X(-1, 44)} y={201} width={18} height={4.6} rx={0.8} fill="#c8ccd2" stroke="#4a4e56" strokeWidth={0.7} />
					{/* shoulder radio mic with coiled cord */}
					<path d={`M${X(-1, 50)} 199 c-4 3 4 5 0 8 c-4 3 4 5 0 8 c-4 3 4 5 0 8 c-3 3 2 6 -2 10`} stroke="#1a1b1e" strokeWidth={1.6} fill="none" />
					<rect x={X(-1, 50) - 6} y={182} width={12} height={17} rx={2.6} fill="#1e1f22" stroke="#000" strokeWidth={0.8} />
					<path d={`M${X(-1, 50) - 3.5} 187 h7 M${X(-1, 50) - 3.5} 190 h7 M${X(-1, 50) - 3.5} 193 h7`} stroke="#4a4c52" strokeWidth={0.9} />
				</g>
			);
			break;
		}
		case "turnout": {
			under = (
				<g>
					{body(main)}
					{folds(main)}
					{inBody(
						<g>
							<rect x={0} y={215} width={200} height={13} fill="#d4dc4a" stroke="#6a6a20" strokeWidth={1} />
							<rect x={0} y={219.5} width={200} height={4} fill="#e8ecec" />
							<path d="M0 221.5 H200" stroke="#a8acb0" strokeWidth={0.6} strokeDasharray="2 2" />
						</g>,
					)}
					{/* storm flap and clasps */}
					<path d={`M${CX - 8} 184 L${CX - 8} 244 L${CX + 8} 244 L${CX + 8} 184 Z`} fill={shade(main, -0.06)} stroke={line(main)} strokeWidth={1.1} />
					{[200, 236].map((y) => <rect key={y} x={CX + 4} y={y} width={8} height={3.6} rx={1} fill="#1a1a1c" />)}
					{inBody(
						<g opacity={0.35}>
							<ellipse cx={46} cy={238} rx={22} ry={8} fill="#3a2e20" filter={c.url("soft2")} />
							<ellipse cx={150} cy={204} rx={14} ry={6} fill="#3a2e20" filter={c.url("soft2")} />
						</g>,
					)}
				</g>
			);
			// collar turned up, open at the throat over a navy duty tee
			collar = (
				<g>
					{crew(c, "#2a3346", n + 5, 184)}
					{SIDES.map((s) => (
						<g key={s}>
							<path d={`M${X(s, n + 23)} 190 L${X(s, n + 14)} 150 Q${X(s, n + 7)} 146 ${X(s, n)} 151 L${X(s, n - 1)} 166 L${X(s, 6)} 194 Z`} fill={s < 0 ? shade(main, 0.04) : shade(main, -0.06)} stroke={line(main)} strokeWidth={1.3} strokeLinejoin="round" />
							<path d={`M${X(s, n)} 151 L${X(s, n - 1)} 166 L${X(s, 6)} 194`} stroke={shade(main, -0.3)} strokeWidth={2} fill="none" opacity={0.6} />
							<path d={`M${X(s, n + 11)} 156 L${X(s, n + 17)} 184`} stroke={shade(main, -0.22)} strokeWidth={1} opacity={0.7} />
						</g>
					))}
				</g>
			);
			break;
		}
		case "fatigues":
		case "camo": {
			const camo = L.outfit === "fatigues";
			under = (
				<g>
					<path d={SH} fill={c.url(camo ? "mocp" : "mtree")} stroke={line(main)} strokeWidth={1.4} />
					<path d={SH} fill={c.url("mshade")} />
					{folds(main)}
				</g>
			);
			const tee = camo ? "#9a8a64" : "#4a4030";
			const vest = camo ? "#4e5636" : "#e86a1a";
			collar = (
				<g>
					{crew(c, tee, n + 6, 186)}
					{/* uniform collar */}
					{SIDES.map((s) => (
						<path key={s} d={`M${X(s, n + 3)} 166 C${X(s, n + 12)} 170 ${X(s, n + 22)} 174 ${X(s, n + 27)} 180 L${X(s, n + 12)} 198 L${X(s, n + 5)} 180 Z`} fill={c.url(camo ? "mocp" : "mtree")} stroke={line(main)} strokeWidth={1.2} strokeLinejoin="round" />
					))}
					{camo ? (
						<g>
							{/* plate carrier with shoulder straps and MOLLE rows */}
							{SIDES.map((s) => <path key={s} d={`M${X(s, 26)} 199 L${X(s, n + 12)} 178 L${X(s, n + 25)} 180 L${X(s, 40)} 200 Z`} fill={vest} stroke="#262a1a" strokeWidth={1.1} />)}
							<path d={`M${X(-1, 48)} 244 L${X(-1, 46)} 206 Q${X(-1, 44)} 198 ${X(-1, 34)} 198 L${X(1, 34)} 198 Q${X(1, 44)} 198 ${X(1, 46)} 206 L${X(1, 48)} 244 Z`} fill={vest} stroke="#262a1a" strokeWidth={1.3} />
							{[212, 222, 232, 242].map((y) => <path key={y} d={`M${X(-1, 42)} ${y} L${X(1, 42)} ${y}`} stroke="#353b24" strokeWidth={3} strokeDasharray="7 3" />)}
							<rect x={CX - 13} y={201} width={26} height={7} rx={1} fill="#3a4228" stroke="#262a1a" strokeWidth={0.8} />
							<rect x={X(1, 30)} y={202} width={11} height={7} rx={0.8} fill="#5a5e44" stroke="#262a1a" strokeWidth={0.7} />
							<path d={`M${X(1, 30) + 1} 204 h9 M${X(1, 30) + 1} 206.5 h9`} stroke="#3a3e2a" strokeWidth={0.8} />
						</g>
					) : (
						// blaze-orange hunting vest over the camo jacket
						SIDES.map((s) => (
							<path key={s} d={`M${X(s, n + 7)} 176 L${X(s, n + 22)} 177 C${X(s, 50)} 186 ${X(s, 50)} 204 ${X(s, 58)} 244 L${X(s, 13)} 244 C${X(s, 12)} 214 ${X(s, n + 1)} 196 ${X(s, n + 7)} 176 Z`} fill={s < 0 ? vest : shade(vest, -0.06)} stroke="#6a2a08" strokeWidth={1.2} strokeLinejoin="round" />
						))
					)}
					{camo && (
						// dog tags on a ball chain
						<g>
							<path d={`M${X(-1, n + 1)} 172 Q${X(-1, 7)} 190 ${CX - 1} 193 M${X(1, n + 1)} 172 Q${X(1, 7)} 190 ${CX + 1} 193`} stroke="#d8dce0" strokeWidth={1.3} strokeDasharray="1.3 0.9" fill="none" />
							<rect x={CX - 6} y={191} width={7} height={11} rx={2} fill={c.url("msteel")} stroke="#4a4e56" strokeWidth={0.8} transform={`rotate(-10 ${CX - 2} 196)`} />
							<rect x={CX - 1} y={192} width={7} height={11} rx={2} fill={c.url("msteel")} stroke="#4a4e56" strokeWidth={0.8} transform={`rotate(8 ${CX + 2} 197)`} />
						</g>
					)}
					{!camo && zipper(190, 244, false)}
				</g>
			);
			break;
		}
		case "tracksuit": {
			const stripe = (d: string, k: string) => (
				<g key={k}>
					<path d={d} stroke={shade(main, -0.35)} strokeWidth={5} fill="none" />
					<path d={d} stroke="#f0f0ea" strokeWidth={3.2} fill="none" />
				</g>
			);
			under = (
				<g>
					{body(main)}
					{folds(main)}
					{inBody(SIDES.map((s) => (
						<g key={s}>
							{stripe(`M${X(s, 34)} 177 C${X(s, 72)} 184 ${X(s, 92)} 208 ${X(s, 94)} 244`, "a")}
							{stripe(`M${X(s, 36)} 184 C${X(s, 66)} 190 ${X(s, 84)} 212 ${X(s, 86)} 244`, "b")}
						</g>
					)))}
					{zipper(184, 244, false)}
				</g>
			);
			collar = (
				<g>
					{chest(c, n + 6, 180)}
					{standCollar(c, main)}
					{zipper(164, 186)}
					{L.whistle && (
						<g>
							<path d={`M${X(-1, n + 2)} 172 Q${X(-1, 10)} 200 ${X(1, 2)} 212 M${X(1, n + 2)} 172 Q${X(1, 12)} 196 ${X(1, 4)} 211`} stroke="#1a1c20" strokeWidth={1.4} fill="none" />
							<rect x={X(1, 1)} y={210} width={13} height={6.4} rx={3} fill={c.url("msteel")} stroke="#3a3c40" strokeWidth={0.9} />
							<circle cx={X(1, 4)} cy={213} r={1.2} fill="#3a3c40" />
						</g>
					)}
				</g>
			);
			break;
		}
		case "labcoat": {
			const shirt = "#a8c4e0";
			under = (
				<g>
					{body(main)}
					{folds("#b8bcc4")}
					{/* breast pocket with pens */}
					<path d={`M${X(1, 30)} 214 L${X(1, 52)} 214 L${X(1, 51)} 236 L${X(1, 31)} 236 Z`} fill="none" stroke="#9a9ea6" strokeWidth={1.1} />
					{pens(X(1, 46), 206)}
				</g>
			);
			collar = (
				<g>
					{opening(c, n + 4, 20, <g>{tee(shirt)}{tie(L.tie)}</g>, main)}
					{chest(c, n + 2, 184, true)}
					{shirtCollar(c, shirt)}
					{tie(L.tie)}
					{lapels(c, main, n + 4, 20)}
				</g>
			);
			break;
		}
		case "prison": {
			const tank = "#e4e0d4";
			under = (
				<g>
					{body(main)}
					{folds(main)}
					{/* faded, patched, worn */}
					{inBody(
						<g>
							<ellipse cx={40} cy={214} rx={18} ry={10} fill="#f0c890" opacity={0.18} filter={c.url("soft2")} />
							<ellipse cx={160} cy={232} rx={20} ry={9} fill="#f0c890" opacity={0.15} filter={c.url("soft2")} />
							<rect x={142} y={196} width={20} height={16} fill={shade(main, -0.14)} stroke={line(main)} strokeWidth={0.8} transform="rotate(-6 152 204)" />
							<rect x={142} y={196} width={20} height={16} fill="none" stroke="#3a2010" strokeWidth={0.7} strokeDasharray="1.6 1.4" transform="rotate(-6 152 204)" opacity={0.7} />
						</g>,
					)}
				</g>
			);
			collar = (
				<g>
					{opening(c, n + 6, 24, <g>{tee(tank)}{chest(c, n + 12, 198)}</g>, main)}
					<path d={`M${X(-1, n + 12)} 174 Q${CX} 222 ${X(1, n + 12)} 174`} stroke={shade(tank, -0.18)} strokeWidth={2.4} fill="none" />
					{/* neck tattoos */}
					<g stroke="#2e3e52" strokeWidth={1.2} fill="none" opacity={0.7} strokeLinejoin="round">
						<path d={`M${X(-1, n - 5)} 156 l1.6 4.4 l4.6 0.1 l-3.7 2.8 l1.4 4.4 l-3.9 -2.7 l-3.8 2.7 l1.4 -4.4 l-3.7 -2.8 l4.6 -0.1 Z`} />
						<path d={`M${X(1, n - 9)} 158 c2 -3 4 3 6 0 c2 -3 4 3 6 0 M${X(1, n - 8)} 164 c2 -2 3 2 5 0 c2 -2 3 2 5 0`} />
						<path d={`M${X(-1, n - 2)} 172 L${X(1, n - 2)} 172`} strokeDasharray="2 2" opacity={0.6} />
					</g>
					{jacketCollar(c, shade(main, -0.22))}
					{SIDES.map((s) => <path key={s} d={`M${X(s, n + 20)} 177 l1 3 M${X(s, n + 24)} 178 l0.6 3`} stroke="#f0d0a0" strokeWidth={0.8} opacity={0.7} />)}
				</g>
			);
			break;
		}
		case "clergy": {
			const jacket = "#30303a";
			under = <g>{body(jacket, "mjk")}{folds(jacket)}</g>;
			defs.push(grad(c.id("mjk"), jacket));
			collar = (
				<g>
					{opening(c, n + 8, 28, tee(main), jacket)}
					{standCollar(c, main, 14)}
					<rect x={CX - 5} y={166} width={10} height={9} rx={1} fill="#f4f4f0" stroke="#8a8a8a" strokeWidth={0.6} />
					{lapels(c, jacket, n + 8, 28)}
				</g>
			);
			break;
		}
		case "apron": {
			const apron = "#ece8dc";
			under = <g>{body(main)}{folds(main)}</g>;
			collar = (
				<g>
					{chest(c, n + 4, 184, true)}
					{shirtCollar(c, mix(main, "#ffffff", 0.55))}
					{SIDES.map((s) => (
						<g key={s}>
							<path d={`M${X(s, 25)} 204 L${X(s, n + 3)} 174`} stroke={line(apron)} strokeWidth={5} />
							<path d={`M${X(s, 25)} 204 L${X(s, n + 3)} 174`} stroke={apron} strokeWidth={3.2} />
						</g>
					))}
					<path d={`M${X(-1, 28)} 202 L${X(1, 28)} 202 L${X(1, 32)} 244 L${X(-1, 32)} 244 Z`} fill={apron} stroke={line(apron)} strokeWidth={1.2} />
					<path d={`M${X(-1, 14)} 226 L${X(1, 14)} 226 L${X(1, 14)} 240 M${X(-1, 14)} 226 L${X(-1, 14)} 240`} stroke={shade(apron, -0.18)} strokeWidth={1} fill="none" />
					<ellipse cx={X(1, 12)} cy={214} rx={4} ry={2.6} fill="#8a6a3a" opacity={0.3} />
					<ellipse cx={X(-1, 18)} cy={234} rx={3} ry={2} fill="#8a6a3a" opacity={0.25} />
					{/* name tag */}
					<rect x={X(1, 36)} y={188} width={15} height={7} rx={1} fill="#f6f4ee" stroke="#5a5e66" strokeWidth={0.7} />
					<rect x={X(1, 36)} y={188} width={15} height={2.2} fill="#c03a3a" />
				</g>
			);
			break;
		}
		case "cardigan": {
			const shirt = "#d8d0b8";
			under = (
				<g>
					{body(main)}
					{folds(main)}
					{inBody(<g opacity={0.18}>{Array.from({ length: 22 }, (_, i) => <path key={i} d={`M${i * 9 + 4} 170 L${i * 9 + 4} 244`} stroke={shade(main, -0.4)} strokeWidth={1} />)}</g>)}
				</g>
			);
			collar = (
				<g>
					{opening(c, n + 5, 7, tee(shirt), main)}
					{chest(c, n + 1, 184, true)}
					{shirtCollar(c, shirt, 3)}
					{SIDES.map((s) => <path key={s} d={edgeD(s, n + 5, 7)} stroke={shade(main, 0.06)} strokeWidth={4} fill="none" transform={`translate(${s * -2.2} 0)`} />)}
					{[206, 222, 238].map((y) => <circle key={y} cx={X(-1, edgeAt(n + 5, 7, y) + 2.4)} cy={y} r={1.8} fill={shade(main, -0.3)} stroke={line(main)} strokeWidth={0.5} />)}
				</g>
			);
			break;
		}
		case "flannel": {
			// farmer: barn jacket with a corduroy collar over a plaid shirt
			const jacket = "#a08050";
			defs.push(grad(c.id("mjk"), jacket));
			under = (
				<g>
					{body(jacket, "mjk")}
					{folds(jacket)}
					{SIDES.map((s) => <path key={s} d={`M${X(s, 30)} 212 L${X(s, 54)} 212 L${X(s, 54)} 219 L${X(s, 30)} 219 Z`} fill={shade(jacket, -0.06)} stroke={line(jacket)} strokeWidth={1} />)}
				</g>
			);
			collar = (
				<g>
					{opening(c, n + 6, 22, <path d={SH} fill={c.url("mplaid")} />, jacket)}
					{chest(c, n + 2, 186, true)}
					{shirtCollar(c, main)}
					{jacketCollar(c, "#4a3020")}
					{SIDES.map((s) => <path key={s} d={`M${X(s, n + 9)} 173 L${X(s, n + 16)} 194 M${X(s, n + 14)} 174 L${X(s, n + 19)} 186`} stroke="#2e1e12" strokeWidth={0.8} opacity={0.7} />)}
				</g>
			);
			break;
		}
		case "denim":
		default: {
			const civ = L.civ;
			if (civ === "puffer") {
				under = (
					<g>
						{body(main)}
						{inBody(
							<g fill="none">
								{[194, 212, 230].map((y) => (
									<g key={y}>
										<path d={`M0 ${y - 4} Q${CX} ${y + 4} 200 ${y - 4}`} stroke={shade(main, 0.2)} strokeWidth={4} opacity={0.3} filter={c.url("soft1")} />
										<path d={`M0 ${y} Q${CX} ${y + 8} 200 ${y}`} stroke={line(main)} strokeWidth={1.4} />
									</g>
								))}
							</g>,
						)}
						{zipper(184, 244, false)}
					</g>
				);
				collar = <g>{chest(c, n + 6, 180)}{standCollar(c, main, 18)}{zipper(162, 186)}</g>;
				break;
			}
			const shirt = L.shirt;
			const ix0 = civ === "flannel" ? n + 4 : n + 6;
			const ix1 = civ === "flannel" ? 18 : 26;
			under = (
				<g>
					{civ === "flannel" ? <path d={SH} fill={c.url("mplaid")} stroke={line(main)} strokeWidth={1.4} /> : body(main)}
					{civ === "flannel" && <path d={SH} fill={c.url("mshade")} />}
					{folds(main)}
					{civ === "leather" && (
						<g fill="none" stroke="#ffffff" opacity={0.22} strokeLinecap="round">
							<path d="M18 222 C26 202 44 190 66 184" strokeWidth={3} />
							<path d="M182 222 C176 206 162 194 144 188" strokeWidth={2} />
						</g>
					)}
					{civ === "denim_jacket" && (
						<g>
							<path d="M4 206 C40 196 160 196 196 206" stroke="#c89a5a" strokeWidth={0.9} strokeDasharray="2.4 1.8" fill="none" />
							{SIDES.map((s) => (
								<g key={s}>
									<path d={`M${X(s, 30)} 204 L${X(s, 52)} 204 L${X(s, 52)} 211 L${X(s, 41)} 215 L${X(s, 30)} 211 Z`} fill={shade(main, 0.04)} stroke={line(main)} strokeWidth={1} />
									<circle cx={X(s, 41)} cy={211} r={1.6} fill="#b8864a" stroke="#4a3010" strokeWidth={0.5} />
								</g>
							))}
						</g>
					)}
				</g>
			);
			collar = (
				<g>
					{opening(c, ix0, ix1, tee(shirt), main)}
					{crew(c, shirt, n + 6, 186)}
					{civ === "denim_jacket" && jacketCollar(c, shade(main, 0.04))}
					{civ === "denim_jacket" && SIDES.map((s) => <path key={s} d={edgeD(s, ix0 + 3, ix1 + 3)} stroke="#c89a5a" strokeWidth={0.9} strokeDasharray="2.4 1.8" fill="none" />)}
					{civ === "leather" && lapels(c, main, ix0, ix1, 4)}
					{civ === "leather" && <rect x={X(-1, edgeAt(ix0, ix1, 214)) - 1} y={212} width={3} height={7} rx={1} fill="#c8ccd2" stroke="#3a3c40" strokeWidth={0.6} />}
					{civ === "flannel" && shirtCollar(c, main, 6)}
					{civ === "flannel" && [204, 222, 240].map((y) => <circle key={y} cx={X(-1, edgeAt(ix0, ix1, y) + 2.6)} cy={y} r={1.5} fill="#e8e4d8" stroke="#3a3a3a" strokeWidth={0.5} />)}
				</g>
			);
			break;
		}
	}

	const [p1, p2] = L.outfit === "flannel" ? ["#9a2e2a", "#3a1414"] : [main, L.shirt];
	return {
		under: (
			<g>
				<defs>
					{defs}
					<clipPath id={clip}><path d={SH} /></clipPath>
					<linearGradient id={c.id("mshade")} x1="0" y1="0" x2="1" y2="1">
						<stop offset="0" stopColor="#fff" stopOpacity={0.1} />
						<stop offset="0.6" stopColor="#000" stopOpacity={0} />
						<stop offset="1" stopColor="#000" stopOpacity={0.22} />
					</linearGradient>
					<linearGradient id={c.id("msteel")} x1="0" y1="0" x2="1" y2="1">
						<stop offset="0" stopColor="#eef0f2" />
						<stop offset="0.5" stopColor="#a8aeb6" />
						<stop offset="1" stopColor="#5a6068" />
					</linearGradient>
					<linearGradient id={c.id("mgold")} x1="0" y1="0" x2="1" y2="1">
						<stop offset="0" stopColor="#f6dc8a" />
						<stop offset="0.5" stopColor="#c99a3a" />
						<stop offset="1" stopColor="#7a5418" />
					</linearGradient>
					<pattern id={c.id("mplaid")} patternUnits="userSpaceOnUse" width={20} height={20} patternTransform={`translate(${c.seed % 20} 4) rotate(-3)`}>
						<rect width={20} height={20} fill={p1} />
						<rect width={20} height={8} fill={p2} opacity={0.55} />
						<rect width={8} height={20} fill={p2} opacity={0.55} />
						<path d="M13 0 V20 M0 13 H20" stroke="#f0e8d8" strokeWidth={0.8} opacity={0.4} />
					</pattern>
					<pattern id={c.id("mocp")} patternUnits="userSpaceOnUse" width={44} height={44} patternTransform={`translate(${c.seed % 44} 0)`}>
						<rect width={44} height={44} fill="#8c8660" />
						<path d="M4 6 q8 -6 14 2 q-2 8 -12 6 Z M26 20 q10 -4 14 4 q-4 8 -14 4 q-4 -4 0 -8 Z M8 30 q8 -2 10 6 q-6 6 -12 0 Z" fill="#6e6c46" />
						<path d="M20 4 q6 0 6 5 q-5 3 -8 -1 Z M34 34 q6 -2 8 4 q-5 4 -9 0 Z M2 20 q5 -1 6 4 q-4 3 -7 -1 Z" fill="#5a4e36" />
						<path d="M14 16 q5 -2 7 2 q-3 4 -7 1 Z M28 2 q4 0 5 3 q-3 2 -5 0 Z M22 36 q4 -1 5 3 q-3 2 -6 -1 Z" fill="#b0a47e" />
					</pattern>
					<pattern id={c.id("mtree")} patternUnits="userSpaceOnUse" width={40} height={40} patternTransform={`translate(${c.seed % 40} 0)`}>
						<rect width={40} height={40} fill="#7a6a48" />
						<path d="M0 30 Q10 20 18 22 T40 10 M6 40 Q14 28 24 30 M20 0 Q24 10 34 14" stroke="#3e3020" strokeWidth={2.6} fill="none" />
						<path d="M4 8 q6 -4 10 0 q-4 5 -10 0 Z M24 22 q6 -4 10 1 q-5 4 -10 -1 Z M10 18 q4 -2 6 1 q-3 3 -6 -1 Z" fill="#5a4a30" />
						<path d="M30 30 q4 -3 7 0 q-3 3 -7 0 Z M14 34 q3 -2 5 1 q-3 2 -5 -1 Z" fill="#a89870" />
					</pattern>
				</defs>
				{under}
			</g>
		),
		collar: (
			<g>
				{collar}
				{c.look.headphones && headphones(c)}
			</g>
		),
	};
}

function headphones(c: ModernCtx): ReactNode {
	const n = c.nw;
	return (
		<g>
			{SIDES.map((s) => (
				<g key={s} transform={`rotate(${s * 24} ${X(s, n + 13)} 186)`}>
					<ellipse cx={X(s, n + 13)} cy={186} rx={9} ry={11.5} fill="#2a2c30" stroke="#0e0f12" strokeWidth={1.2} />
					<ellipse cx={X(s, n + 13) - s * 1.5} cy={186} rx={6} ry={8.4} fill="#3e4046" />
					<ellipse cx={X(s, n + 13) - s * 1.5} cy={186} rx={6} ry={8.4} fill="none" stroke="#c8372d" strokeWidth={1.4} />
				</g>
			))}
		</g>
	);
}

/** Headphone band behind the neck (drawn before the neck). */
export function modernBehindNeck(c: ModernCtx): ReactNode {
	if (!c.look.headphones) return null;
	const n = c.nw;
	return <path d={`M${X(-1, n + 12)} 184 Q${CX} 156 ${X(1, n + 12)} 184`} stroke="#1e2024" strokeWidth={5} fill="none" />;
}

/** Hood up (hoodie): the back of the hood, behind the hair. */
export function modernHoodBack(c: ModernCtx): ReactNode {
	if (c.look.hat !== "hood") return null;
	const m = c.look.main;
	const top = c.top;
	return <path d={`M${CX} ${top - 20} C${CX + 66} ${top - 18} ${CX + 70} 150 ${CX + 62} 198 L${CX - 62} 198 C${CX - 70} 150 ${CX - 66} ${top - 18} ${CX} ${top - 20} Z`} fill={shade(m, -0.26)} stroke={line(m)} strokeWidth={1.2} />;
}

/** Headwear over the hair. */
export function modernHat(c: ModernCtx): ReactNode {
	const { w, top } = c;
	const L = c.look;
	const hatShadow = (y: number) => (
		<g clipPath={c.url("headclip")}>
			<ellipse cx={CX + 4} cy={y} rx={w + 4} ry={7} fill="#0a0608" opacity={0.4} filter={c.url("soft2")} />
		</g>
	);
	switch (L.hat) {
		case "cap":
		case "blaze_cap": {
			const col = L.hat === "blaze_cap" ? "#e86a1a" : L.outfit === "flannel" ? "#3a5a3a" : L.capColor;
			const ap = top - 10;
			return (
				<g>
					{hatShadow(92)}
					<path d={`M${X(-1, w + 4)} 90 C${X(-1, w + 7)} 64 ${X(-1, w * 0.6)} ${ap} ${CX} ${ap} C${X(1, w * 0.6)} ${ap} ${X(1, w + 7)} 64 ${X(1, w + 4)} 90 Q${CX} 82 ${X(-1, w + 4)} 90 Z`} fill={c.url("mhat")} stroke={line(col)} strokeWidth={1.3} />
					<path d={`M${CX} ${ap} Q${X(-1, w * 0.5)} 62 ${X(-1, w * 0.62)} 86 M${CX} ${ap} Q${X(1, w * 0.5)} 62 ${X(1, w * 0.62)} 86`} stroke={line(col)} strokeWidth={0.9} fill="none" opacity={0.7} />
					<ellipse cx={CX} cy={ap + 1} rx={3} ry={1.6} fill={shade(col, -0.1)} stroke={line(col)} strokeWidth={0.7} />
					{L.hat === "cap" && L.outfit !== "flannel" && <rect x={CX - 7} y={66} width={14} height={9} rx={1.5} fill={mix(col, "#f4f0e4", 0.75)} stroke={line(col)} strokeWidth={0.7} />}
					{L.outfit === "flannel" && <path d={`M${X(-1, w * 0.55)} 70 Q${CX} 62 ${X(1, w * 0.55)} 70 L${X(1, w * 0.62)} 84 Q${CX} 78 ${X(-1, w * 0.62)} 84 Z`} fill="#ece8dc" stroke={line(col)} strokeWidth={0.8} />}
					<path d={`M${X(-1, w)} 84 Q${CX} 70 ${X(1, w)} 84 Q${X(1, w - 5)} 94 ${CX} 95 Q${X(-1, w - 5)} 94 ${X(-1, w)} 84 Z`} fill={shade(col, -0.12)} stroke={line(col)} strokeWidth={1.2} />
					<path d={`M${X(-1, w - 6)} 82 Q${CX} 72 ${X(1, w - 6)} 82`} stroke={shade(col, 0.18)} strokeWidth={1.2} fill="none" opacity={0.7} />
				</g>
			);
		}
		case "beanie": {
			const col = L.capColor;
			const ap = top - 16;
			const cuffTop = (x: number) => 70 + 6 * ((x - CX) / (w + 6)) ** 2;
			return (
				<g>
					<path d={`M${X(-1, w + 5)} 84 C${X(-1, w + 8)} 52 ${X(-1, w * 0.5)} ${ap} ${CX} ${ap} C${X(1, w * 0.5)} ${ap} ${X(1, w + 8)} 52 ${X(1, w + 5)} 84 Z`} fill={c.url("mhat")} stroke={line(col)} strokeWidth={1.3} />
					{[-0.6, -0.3, 0, 0.3, 0.6].map((a) => <path key={a} d={`M${r1(CX + a * 10)} ${ap + 4} Q${r1(CX + a * (w + 2))} ${ap + 10} ${r1(CX + a * (w + 4))} 74`} stroke={shade(col, -0.2)} strokeWidth={1} fill="none" opacity={0.6} />)}
					<path d={`M${X(-1, w + 6)} 92 Q${CX} 80 ${X(1, w + 6)} 92 L${X(1, w + 6)} 76 Q${CX} 64 ${X(-1, w + 6)} 76 Z`} fill={shade(col, 0.04)} stroke={line(col)} strokeWidth={1.3} />
					{Array.from({ length: 15 }, (_, i) => {
						const x = CX - (w + 3) + (i * (2 * w + 6)) / 14;
						const u = (x - CX) / (w + 6);
						return <path key={i} d={`M${r1(x)} ${r1(cuffTop(x) + 2)} L${r1(x)} ${r1(86 + 6 * u * u - 1)}`} stroke={shade(col, -0.18)} strokeWidth={1} />;
					})}
				</g>
			);
		}
		case "sweatband":
			return (
				<g>
					<path d={`M${X(-1, w + 1)} 84 Q${CX} 72 ${X(1, w + 1)} 84 L${X(1, w + 1)} 93 Q${CX} 81 ${X(-1, w + 1)} 93 Z`} fill="#f0f0ea" stroke="#9a9a94" strokeWidth={1.1} />
					<path d={`M${X(-1, w + 1)} 88.5 Q${CX} 76.5 ${X(1, w + 1)} 88.5`} stroke={L.main} strokeWidth={2.2} fill="none" />
				</g>
			);
		case "police_cap": {
			const navy = "#1e2a40";
			return (
				<g>
					{hatShadow(92)}
					<path d={`M${X(-1, w + 2)} 82 L${X(-1, w + 12)} 60 Q${X(-1, w * 0.6)} ${top - 14} ${CX} ${top - 15} Q${X(1, w * 0.6)} ${top - 14} ${X(1, w + 12)} 60 L${X(1, w + 2)} 82 Z`} fill={c.url("mhat")} stroke="#0e1420" strokeWidth={1.3} />
					<path d={`M${X(-1, w + 10)} 61 Q${CX} 52 ${X(1, w + 10)} 61`} stroke={shade(navy, 0.2)} strokeWidth={1.2} fill="none" opacity={0.7} />
					<path d={`M${X(-1, w + 3)} 89 Q${CX} 82 ${X(1, w + 3)} 89 L${X(1, w + 2)} 76 Q${CX} 69 ${X(-1, w + 2)} 76 Z`} fill="#121418" stroke="#000" strokeWidth={1} />
					<path d={`M${X(-1, w + 2)} 84 Q${CX} 77 ${X(1, w + 2)} 84`} stroke="#c8ccd2" strokeWidth={1.1} fill="none" opacity={0.8} />
					<path d={`M${CX - 6} 62 Q${CX} 58 ${CX + 6} 62 L${CX + 5} 71 Q${CX} 76 ${CX - 5} 71 Z`} fill={c.url("mgold")} stroke="#4a3410" strokeWidth={0.9} />
					<path d={`M${X(-1, w - 2)} 87 Q${CX} 78 ${X(1, w - 2)} 87 Q${X(1, w - 6)} 96 ${CX} 97 Q${X(-1, w - 6)} 96 ${X(-1, w - 2)} 87 Z`} fill="#0e0f12" stroke="#000" strokeWidth={1} />
					<path d={`M${X(-1, w - 10)} 87 Q${CX} 81 ${X(1, w - 14)} 86`} stroke="#ffffff" strokeWidth={1.2} fill="none" opacity={0.35} />
				</g>
			);
		}
		case "fire_helmet": {
			const red = "#b8282a";
			const ap = top - 16;
			return (
				<g>
					{hatShadow(94)}
					<path d={`M${X(-1, w + 4)} 86 C${X(-1, w + 7)} 54 ${X(-1, w * 0.5)} ${ap} ${CX} ${ap} C${X(1, w * 0.5)} ${ap} ${X(1, w + 7)} 54 ${X(1, w + 4)} 86 Z`} fill={c.url("mhat")} stroke="#4a0e0e" strokeWidth={1.3} />
					{[-0.5, 0.5].map((a) => <path key={a} d={`M${r1(CX + a * 8)} ${ap + 2} Q${r1(CX + a * (w + 6))} ${ap + 8} ${r1(CX + a * (w + 6))} 84`} stroke={shade(red, -0.2)} strokeWidth={1.4} fill="none" opacity={0.7} />)}
					<path d={`M${CX - 3} ${ap} L${CX + 3} ${ap} L${CX + 3} 70 L${CX - 3} 70 Z`} fill={shade(red, 0.14)} stroke="#4a0e0e" strokeWidth={0.8} />
					<path d={`M${X(-1, w + 24)} 98 C${X(-1, w + 16)} 82 ${X(1, w + 16)} 82 ${X(1, w + 24)} 98 C${X(1, w + 12)} 91 ${X(-1, w + 12)} 91 ${X(-1, w + 24)} 98 Z`} fill={shade(red, -0.08)} stroke="#4a0e0e" strokeWidth={1.2} />
					<path d={`M${CX - 12} 89 L${CX - 14} 66 Q${CX} 58 ${CX + 14} 66 L${CX + 12} 89 Q${CX} 92 ${CX - 12} 89 Z`} fill="#1a1414" stroke="#000" strokeWidth={1} />
					<path d={`M${CX - 10} 86 L${CX - 11.5} 68 Q${CX} 61.5 ${CX + 11.5} 68 L${CX + 10} 86 Q${CX} 88.5 ${CX - 10} 86 Z`} fill="none" stroke="#e8c050" strokeWidth={1.2} />
					<text x={CX} y={82} textAnchor="middle" fontSize={12} fontWeight={700} fontFamily="Arial, Helvetica, sans-serif" fill="#e8c050">3</text>
				</g>
			);
		}
		case "army_helmet": {
			const ap = top - 16;
			return (
				<g>
					{hatShadow(94)}
					{SIDES.map((s) => <path key={s} d={`M${X(s, w + 1)} 104 L${X(s, w - 3)} 136`} stroke="#2a2a1e" strokeWidth={2.4} strokeLinecap="round" />)}
					<path d={`M${X(-1, w + 7)} 106 C${X(-1, w + 10)} 54 ${X(-1, w * 0.55)} ${ap} ${CX} ${ap} C${X(1, w * 0.55)} ${ap} ${X(1, w + 10)} 54 ${X(1, w + 7)} 106 L${X(1, w + 1)} 108 C${X(1, w)} 94 ${X(1, w - 8)} 87 ${CX} 86 C${X(-1, w - 8)} 87 ${X(-1, w)} 94 ${X(-1, w + 1)} 108 Z`} fill={c.url("mocp")} stroke="#262a1a" strokeWidth={1.4} />
					<path d={`M${X(-1, w + 7)} 106 C${X(-1, w + 10)} 54 ${X(-1, w * 0.55)} ${ap} ${CX} ${ap} C${X(1, w * 0.55)} ${ap} ${X(1, w + 10)} 54 ${X(1, w + 7)} 106 L${X(1, w + 1)} 108 C${X(1, w)} 94 ${X(1, w - 8)} 87 ${CX} 86 C${X(-1, w - 8)} 87 ${X(-1, w)} 94 ${X(-1, w + 1)} 108 Z`} fill={c.url("mhatshade")} />
					<path d={`M${X(1, w + 1)} 108 C${X(1, w)} 94 ${X(1, w - 8)} 87 ${CX} 86 C${X(-1, w - 8)} 87 ${X(-1, w)} 94 ${X(-1, w + 1)} 108`} stroke="#3e4230" strokeWidth={2.6} fill="none" />
					<path d={`M${CX - 7} 70 L${CX + 7} 70 L${CX + 6} 80 L${CX - 6} 80 Z`} fill="#22241c" stroke="#0e0f0a" strokeWidth={0.8} />
					<circle cx={CX} cy={75} r={1.4} fill="#5a5e50" />
				</g>
			);
		}
		default:
			return null;
	}
}

/** Hood up (hoodie): the front of the hood framing the face. */
export function modernHoodFront(c: ModernCtx): ReactNode {
	if (c.look.hat !== "hood") return null;
	const m = c.look.main;
	const top = c.top;
	const w = c.w;
	const inner = `M${CX + 34} 190 C${CX + 48} 150 ${CX + 50} ${top - 2} ${CX} ${top - 2} C${CX - 50} ${top - 2} ${CX - 48} 150 ${CX - 34} 190`;
	return (
		<g>
			<path d={`M${CX} ${top - 20} C${CX + 62} ${top - 18} ${CX + 64} 140 ${CX + 58} 192 L${CX + 34} 190 C${CX + 48} 150 ${CX + 50} ${top - 2} ${CX} ${top - 2} C${CX - 50} ${top - 2} ${CX - 48} 150 ${CX - 34} 190 L${CX - 58} 192 C${CX - 64} 140 ${CX - 62} ${top - 18} ${CX} ${top - 20} Z`} fill={c.url("mhat")} stroke={line(m)} strokeWidth={1.2} />
			<path d={inner} stroke={line(m)} strokeWidth={6} fill="none" />
			<path d={inner} stroke={shade(m, 0.08)} strokeWidth={4} fill="none" />
			<g clipPath={c.url("headclip")}><ellipse cx={CX + 6} cy={top + 10} rx={w + 6} ry={24} fill="#0a0608" opacity={0.45} filter={c.url("soft2")} /></g>
			{SIDES.map((s) => (
				<g key={s}>
					<path d={`M${X(s, 30)} 186 Q${X(s, 28)} 204 ${X(s, 30)} 218`} stroke={shade(m, -0.4)} strokeWidth={3.6} fill="none" strokeLinecap="round" />
					<path d={`M${X(s, 30)} 186 Q${X(s, 28)} 204 ${X(s, 30)} 218`} stroke="#ece8dc" strokeWidth={2.2} fill="none" strokeLinecap="round" />
				</g>
			))}
		</g>
	);
}

/** Glasses over the eyes. */
export function modernGlasses(c: ModernCtx): ReactNode {
	const g = c.look.glasses;
	if (g === "none") return null;
	const ey = c.eyeY;
	const frame = g === "thick" ? "#1a1614" : g === "wire" ? "#8a8a88" : "#5a3a22";
	const sw = g === "wire" ? 1.3 : 2.4;
	return (
		<g fill="none">
			{SIDES.map((s) => {
				const ex = CX + s * c.eyeSpacing;
				return (
					<g key={s}>
						<path d={`M${r1(ex + s * 10.5)} ${ey - 3} L${X(s, c.w)} ${ey - 6}`} stroke={frame} strokeWidth={sw * 0.8} />
						{g === "wire" ? (
							<ellipse cx={r1(ex)} cy={ey} rx={9.5} ry={7.6} fill="#ffffff" fillOpacity={0.07} stroke={frame} strokeWidth={sw} />
						) : (
							<rect x={r1(ex - 10.5)} y={ey - 7} width={21} height={14} rx={4} fill="#ffffff" fillOpacity={0.07} stroke={frame} strokeWidth={sw} />
						)}
						<path d={`M${r1(ex - 6)} ${ey + 4} L${r1(ex + 1)} ${ey - 5}`} stroke="#ffffff" strokeWidth={1.4} opacity={0.35} />
					</g>
				);
			})}
			<path d={`M${r1(CX - c.eyeSpacing + 10.5)} ${ey - 2} Q${CX} ${ey - 6} ${r1(CX + c.eyeSpacing - 10.5)} ${ey - 2}`} stroke={frame} strokeWidth={sw} />
			{g === "tortoise" && SIDES.map((s) => <path key={s} d={`M${r1(CX + s * c.eyeSpacing - 6)} ${ey - 7} h3 M${r1(CX + s * c.eyeSpacing + 2)} ${ey + 7} h4`} stroke="#a8743a" strokeWidth={1.2} />)}
		</g>
	);
}

/** Earbuds (drawn with the ears, so hair covers them). */
export function modernEarbuds(c: ModernCtx): ReactNode {
	if (!c.look.earbuds) return null;
	return (
		<g>
			{SIDES.map((s) => (
				<g key={s}>
					<path d={`M${X(s, c.w + 3)} 118 C${X(s, c.w + 4)} 140 ${X(s, c.nw + 4)} 160 ${X(s, 10)} 198`} stroke="#d8d8d4" strokeWidth={1.3} fill="none" />
					<ellipse cx={X(s, c.w + 4)} cy={112} rx={2.8} ry={3.4} fill="#f4f4f2" stroke="#8a8a88" strokeWidth={0.8} />
					<rect x={X(s, c.w + 4) - 1.2} y={114} width={2.4} height={5} rx={1} fill="#f4f4f2" stroke="#8a8a88" strokeWidth={0.6} />
				</g>
			))}
		</g>
	);
}

/** Grime, blood specks and a plaster: subtle, seeded. */
export function modernGrit(c: ModernCtx): ReactNode {
	const L = c.look;
	const { w, eyeY, chin } = c;
	const sp = L.specks;
	return (
		<g>
			{L.grime > 0 && (
				<g clipPath={c.url("headclip")}>
					<ellipse cx={X(sp[0][0] < 0.5 ? -1 : 1, w * 0.55)} cy={eyeY + 22} rx={8} ry={4.4} fill="#4a3a2a" opacity={0.2} filter={c.url("soft1")} />
					{L.grime > 1 && <ellipse cx={X(sp[1][0] < 0.5 ? -1 : 1, 10)} cy={c.top + 20} rx={10} ry={4} fill="#4a3a2a" opacity={0.16} filter={c.url("soft1")} />}
				</g>
			)}
			{L.blood && (
				<g fill="#5a0e0e">
					{sp.slice(0, 5).map(([a, b, r], i) => <circle key={i} cx={r1(54 + a * 92)} cy={r1(190 + b * 46)} r={r1(0.9 + r * 1.1)} opacity={0.6} />)}
					<circle cx={X(sp[5][0] < 0.5 ? -1 : 1, w * 0.45)} cy={r1(chin - 14 - sp[5][1] * 10)} r={1} opacity={0.5} />
					<circle cx={X(sp[5][0] < 0.5 ? -1 : 1, w * 0.45 + 3)} cy={r1(chin - 10 - sp[5][1] * 10)} r={0.7} opacity={0.45} />
				</g>
			)}
			{L.plaster !== "none" && (() => {
				const [x, y, rot] = L.plaster === "brow" ? [X(-1, 16), eyeY - 18, -18] : L.plaster === "cheek" ? [X(1, w * 0.66), eyeY + 9, -40] : [X(-1, w * 0.55), chin - 12, 35];
				return (
					<g transform={`translate(${x} ${y}) rotate(${rot})`}>
						<rect x={-9} y={-3.6} width={18} height={7.2} rx={3.4} fill="#e2c29c" stroke="#8a6a4a" strokeWidth={0.7} />
						<rect x={-3.4} y={-2.8} width={6.8} height={5.6} rx={1} fill="#f4ead8" stroke="#c8a888" strokeWidth={0.4} />
						<circle cx={-5.4} cy={0} r={0.4} fill="#9a7a5a" /><circle cx={5.4} cy={0} r={0.4} fill="#9a7a5a" />
					</g>
				);
			})()}
		</g>
	);
}

/** Gradients for hats/hood (depend on the hat colour). */
export function modernHatDefs(c: ModernCtx): ReactNode {
	const L = c.look;
	const col =
		L.hat === "hood" ? L.main
		: L.hat === "police_cap" ? "#1e2a40"
		: L.hat === "fire_helmet" ? "#b8282a"
		: L.hat === "blaze_cap" ? "#e86a1a"
		: L.hat === "cap" && L.outfit === "flannel" ? "#3a5a3a"
		: L.capColor;
	return (
		<>
			<linearGradient id={c.id("mhat")} x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stopColor={shade(col, 0.12)} />
				<stop offset="0.55" stopColor={col} />
				<stop offset="1" stopColor={shade(col, -0.16)} />
			</linearGradient>
			<linearGradient id={c.id("mhatshade")} x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stopColor="#fff" stopOpacity={0.18} />
				<stop offset="0.55" stopColor="#000" stopOpacity={0} />
				<stop offset="1" stopColor="#000" stopOpacity={0.3} />
			</linearGradient>
		</>
	);
}

/** True when headwear covers the top of the head: hair is flattened and topknots/buns hidden. */
export function fullHat(l: ModernLook): boolean {
	return l.hat !== "none" && l.hat !== "sweatband";
}

// ─── Backgrounds and frames ──────────────────────────────────────────────

type Setting = "booth" | "sodium" | "dusk" | "woods";

/** Background colours [light, dark] for the photo. */
export function modernBackdropColors(frame: ModernFrame, background: string): [string, string] {
	const s = settingOf(frame, background);
	return { booth: ["#c4ced6", "#7a8896"], sodium: ["#8a5a30", "#140c08"], dusk: ["#6e7480", "#1a1e26"], woods: ["#59644f", "#111611"] }[s] as [string, string];
}

function settingOf(frame: ModernFrame, background: string): Setting {
	if (frame === "badge") return "booth";
	if (["ember", "gold", "crimson", "parchment"].includes(background)) return "sodium";
	if (["forest", "teal"].includes(background)) return "woods";
	return "dusk";
}

/** Out-of-focus things behind the person in a polaroid. */
export function modernBackdrop(frame: ModernFrame, background: string, seed: number): ReactNode {
	const s = settingOf(frame, background);
	const r = new ArtRng((seed ^ 0x51ed270b) >>> 0);
	switch (s) {
		case "booth":
			return <ellipse cx={CX} cy={104} rx={86} ry={92} fill="#ffffff" opacity={0.18} />;
		case "sodium":
			return (
				<g>
					{Array.from({ length: 5 }, (_, i) => (
						<circle key={i} cx={r1(r.range(10, 190))} cy={r1(r.range(24, 120))} r={r1(r.range(6, 15))} fill="#ffb050" opacity={r1(r.range(0.18, 0.4) * 10) / 10} />
					))}
					<rect x={r1(r.range(150, 172))} y={0} width={5} height={170} fill="#0c0806" opacity={0.6} />
				</g>
			);
		case "dusk": {
			const px = r1(r.range(150, 176));
			return (
				<g stroke="#0e1014" fill="none" opacity={0.7}>
					<path d={`M${px} 240 L${px + 2} 20`} strokeWidth={6} />
					<path d={`M${px - 22} 34 L${px + 24} 30`} strokeWidth={3} />
					<path d={`M0 54 Q80 78 ${px - 20} 35 M0 70 Q90 96 ${px + 22} 31 M${px + 22} 31 Q190 40 200 48`} strokeWidth={1.1} />
				</g>
			);
		}
		case "woods":
			return (
				<g stroke="#0a0e0a" fill="none" opacity={0.55} strokeLinecap="round">
					<path d="M18 240 L24 0 M24 70 L4 40 M22 110 L44 70" strokeWidth={5} />
					<path d="M176 240 L170 0 M171 60 L192 30 M172 100 L150 64" strokeWidth={6} />
				</g>
			);
	}
}

/** Root Access: the same departments, issued by Marea's institutions (docs/cyberpunk.md). */
const DEPT_HEAD_MAREA: Record<Dept, [string, string]> = {
	medical: ["#2f6f7a", "CLÍNICA LOS ANEGADOS"],
	police: ["#24324e", "GRUPO FERRO"],
	fire: ["#8a2a26", "BOMBEROS DE MAREA"],
	army: ["#4a5236", "FERRO TÁCTICO"],
	school: ["#4a3a6a", "UNIVERSIDAD DE MAREA"],
	prison: ["#8a5a2a", "CENTRO DE DETENCIÓN FERRO"],
	church: ["#3a3a44", "RED LIBRE · CERRO ANTENA"],
	diner: ["#a83a3a", "FIDEOS DOÑA LUPE"],
	farm: ["#5a6a3a", "AGUAS MAREA S.A."],
	civ: ["#3c5a7a", "REGISTRO CIVIL · MAREA"],
};

const deptHead = (look: ModernLook): [string, string] => (look.city === "marea" ? DEPT_HEAD_MAREA : DEPT_HEAD)[look.dept];

const DEPT_HEAD: Record<Dept, [string, string]> = {
	medical: ["#2f6f7a", "ST. BRIGID'S REGIONAL"],
	police: ["#24324e", "KESSLER FALLS POLICE"],
	fire: ["#8a2a26", "KESSLER FALLS FIRE"],
	army: ["#4a5236", "NATIONAL GUARD"],
	school: ["#4a3a6a", "KESSLER FALLS HIGH"],
	prison: ["#8a5a2a", "KESSLER CO. CORRECTIONAL"],
	church: ["#3a3a44", "ST. AGNES PARISH"],
	diner: ["#a83a3a", "ROSIE'S DINER"],
	farm: ["#5a6a3a", "KESSLER CO. FARM BUREAU"],
	civ: ["#3c5a7a", "KESSLER FALLS"],
};

/** Where the photo sits inside the frame, and how the 200×240 bust is scaled into it. */
export function modernWindow(frame: ModernFrame, framed: boolean): { x: number; y: number; w: number; h: number; rx: number; k: number; tx: number; ty: number } {
	if (!framed) return { x: 0, y: 0, w: 200, h: 240, rx: 10, k: 1, tx: 0, ty: 0 };
	if (frame === "badge") return { x: 10, y: 27, w: 180, h: 180, rx: 3, k: 0.9, tx: 10, ty: 27 - 40 * 0.9 };
	return { x: 12, y: 13, w: 176, h: 178, rx: 1, k: 0.88, tx: 12, ty: 13 - 40 * 0.88 };
}

/** Card / instant-film border behind the photo. */
export function modernFrameBack(c: { id: (s: string) => string; url: (s: string) => string }, frame: ModernFrame, look: ModernLook): ReactNode {
	if (frame === "badge") {
		const [hc] = deptHead(look);
		return (
			<g>
				<defs>
					<linearGradient id={c.id("card")} x1="0" y1="0" x2="0.3" y2="1">
						<stop offset="0" stopColor="#f2efe6" />
						<stop offset="1" stopColor="#dcd6c8" />
					</linearGradient>
					<clipPath id={c.id("cardclip")}><rect x={0.5} y={0.5} width={199} height={239} rx={9} /></clipPath>
				</defs>
				<rect x={0.5} y={0.5} width={199} height={239} rx={9} fill={c.url("card")} />
				<g clipPath={c.url("cardclip")}>
					<rect x={0} y={0} width={200} height={24} fill={hc} />
					<rect x={0} y={22} width={200} height={2} fill={shade(hc, -0.15)} />
				</g>
			</g>
		);
	}
	return (
		<g>
			<defs>
				<linearGradient id={c.id("card")} x1="0" y1="0" x2="0.2" y2="1">
					<stop offset="0" stopColor="#f1ecdc" />
					<stop offset="0.7" stopColor="#e9e1c8" />
					<stop offset="1" stopColor="#ddd2b2" />
				</linearGradient>
			</defs>
			<rect x={0.5} y={0.5} width={199} height={239} rx={2} fill={c.url("card")} stroke="#b8ae94" strokeWidth={1} />
		</g>
	);
}

/** Card text, wear, tape and the name, drawn over everything. */
export function modernFrameFront(c: { id: (s: string) => string; url: (s: string) => string }, frame: ModernFrame, look: ModernLook, seed: number, name?: string): ReactNode {
	const r = new ArtRng((seed ^ 0x7f4a7c15) >>> 0);
	const shown = name && name.length > 22 ? name.slice(0, 21) + "…" : name;
	if (frame === "badge") {
		const [hc, label] = deptHead(look);
		const idNo = `${String(seed % 97).padStart(2, "0")}-${String((seed >>> 8) % 9000 + 1000)}`;
		return (
			<g>
				<text x={CX} y={19.5} textAnchor="middle" fontSize={label.length > 20 ? 8.4 : 9.4} fontWeight={700} letterSpacing={1.1} fontFamily="Inter, 'Helvetica Neue', Arial, sans-serif" fill="#f4f2ec">{label}</text>
				<rect x={10} y={27} width={180} height={180} rx={3} fill="none" stroke={shade(hc, -0.2)} strokeOpacity={0.5} strokeWidth={1.2} />
				{/* lanyard slot */}
				<rect x={88} y={3} width={24} height={4.6} rx={2.3} fill="#1a1c20" opacity={0.75} />
				{/* name strip */}
				{shown ? (
					<text x={CX} y={224} textAnchor="middle" fontSize={shown.length > 14 ? 12 : 14} fontWeight={700} letterSpacing={0.6} fontFamily="Inter, 'Helvetica Neue', Arial, sans-serif" fill="#1e2a36">{shown.toUpperCase()}</text>
				) : (
					<rect x={56} y={215} width={88} height={6} rx={2} fill="#b8b4aa" />
				)}
				<text x={14} y={235} fontSize={6.4} fontFamily="'Courier New', monospace" fill="#6a6a66">ID {idNo}</text>
				<g fill="#2a2c30" opacity={0.75}>
					{Array.from({ length: 18 }, (_, i) => <rect key={i} x={140 + i * 2.6} y={229} width={(i * 7 + seed) % 3 === 0 ? 1.6 : 0.8} height={7} />)}
				</g>
				{/* lamination glare, scuffs and a smudge */}
				<path d="M-10 120 L120 -10 L150 -10 L20 120 Z" fill="#ffffff" opacity={0.07} />
				<ellipse cx={r1(r.range(30, 170))} cy={r1(r.range(170, 214))} rx={16} ry={9} fill="#5a4a3a" opacity={0.12} filter={c.url("soft2")} />
				<g stroke="#ffffff" strokeWidth={0.7} opacity={0.35}>
					{Array.from({ length: 3 }, (_, i) => {
						const x = r.range(20, 180), y = r.range(30, 200);
						return <path key={i} d={`M${r1(x)} ${r1(y)} l${r1(r.range(8, 22))} ${r1(r.range(-4, 4))}`} />;
					})}
				</g>
				<rect x={0.5} y={0.5} width={199} height={239} rx={9} fill="none" stroke="#8e8a80" strokeWidth={1.4} />
				{[[4, 4], [196, 236]].map(([x, y]) => <circle key={x} cx={x} cy={y} r={6} fill="#ffffff" opacity={0.25} filter={c.url("soft1")} />)}
			</g>
		);
	}
	const tapeRot = r1(r.range(-6, 6));
	return (
		<g>
			{/* yellowing at the edges and a thumb smudge */}
			<rect x={0.5} y={0.5} width={199} height={239} rx={2} fill="none" stroke="#c8b888" strokeWidth={5} opacity={0.35} filter={c.url("soft1")} />
			<ellipse cx={r1(r.range(30, 170))} cy={r1(r.range(206, 230))} rx={12} ry={7} fill="#6a5a40" opacity={0.12} filter={c.url("soft2")} />
			<rect x={12} y={13} width={176} height={178} fill="none" stroke="#000" strokeOpacity={0.25} strokeWidth={1} />
			{shown && (
				<text x={CX} y={221} textAnchor="middle" fontSize={shown.length > 14 ? 15 : 18} fontFamily="'Bradley Hand', 'Segoe Print', 'Comic Sans MS', 'Marker Felt', cursive" fill="#26283a" transform={`rotate(-2 ${CX} 216)`}>{shown}</text>
			)}
			{/* tape */}
			<g transform={`rotate(${tapeRot} ${CX} 4)`}>
				<path d={`M${CX - 26} -4 L${CX + 26} -4 L${CX + 24} 2 L${CX + 27} 7 L${CX + 25} 13 L${CX - 25} 13 L${CX - 27} 8 L${CX - 24} 3 Z`} fill="#d8cfa8" opacity={0.85} stroke="#a89c74" strokeWidth={0.7} />
			</g>
		</g>
	);
}

/** Photo overlays inside the window (polaroid fade, scratches). */
export function modernPhotoOverlay(frame: ModernFrame): ReactNode {
	if (frame === "badge") return <rect width={200} height={240} fill="#c8d8e8" opacity={0.06} />;
	return <rect width={200} height={240} fill="#f0d8a0" opacity={0.08} />;
}
