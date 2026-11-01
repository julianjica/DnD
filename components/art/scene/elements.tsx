import type { ReactNode } from "react";
import { mix, shade } from "@/lib/art/color";
import { ArtRng, r1 } from "@/lib/art/rand";
import { poly, u, type GlowTone, type Pt } from "./geom";

/**
 * Reusable illustrated scene elements. Each draws in a flat-painted style:
 * a base silhouette, a lit facet (light from `lightDir`: -1 = from left, 1 = from right),
 * and an optional rim stroke. Coordinates are scene px (1600×900); (x, y) is the base.
 */

export interface Ink {
	/** base color */
	c: string;
	/** lit color */
	lit: string;
	/** shadow color */
	dark: string;
	/** rim light color (or undefined for none) */
	rim?: string;
}

export function ink(c: string, light: string, rimOpacity = 0): Ink {
	return { c, lit: mix(c, light, 0.22), dark: shade(c, -0.08), rim: rimOpacity > 0 ? light : undefined };
}

// ─── Vegetation ────────────────────────────────────────────────────────────

export function pine(key: string | number, x: number, y: number, h: number, k: Ink, rng: ArtRng, snow = false): ReactNode {
	const w = h * rng.range(0.32, 0.42);
	const tiers = 5 + Math.floor(h / 120);
	const pts: Pt[] = [[x, y - h]];
	const right: Pt[] = [];
	for (let i = 1; i <= tiers; i++) {
		const ty = y - h + (h * 0.88 * i) / tiers;
		const tw = (w * (0.25 + (0.75 * i) / tiers)) / 2;
		right.push([x + tw + rng.range(-2, 3), ty]);
		if (i < tiers) right.push([x + tw * 0.45, ty + 2]);
	}
	pts.push(...right);
	pts.push([x + w * 0.06, y - h * 0.12], [x + w * 0.06, y], [x - w * 0.06, y], [x - w * 0.06, y - h * 0.12]);
	pts.push(...right.slice().reverse().map(([px, py]) => [2 * x - px, py] as Pt));
	const lit: Pt[] = [[x, y - h], ...right.map(([px, py]) => [x - (px - x), py] as Pt).filter((_, i) => i % 2 === 0), [x, y - h * 0.12]];
	return (
		<g key={key}>
			<path d={poly(pts)} fill={k.c} />
			<path d={poly(lit)} fill={k.lit} opacity={0.55} />
			{snow && right.filter((_, i) => i % 2 === 0).map(([px, py], i) => (
				<path key={i} d={`M${r1(2 * x - px)} ${r1(py)} Q${x} ${r1(py - 10)} ${r1(px)} ${r1(py)} L${r1(px - 6)} ${r1(py - 4)} Q${x} ${r1(py - 14)} ${r1(2 * x - px + 6)} ${r1(py - 4)} Z`} fill="#eef3f8" opacity={0.8} />
			))}
		</g>
	);
}

export function broadTree(key: string | number, x: number, y: number, h: number, k: Ink, rng: ArtRng, trunk: string): ReactNode {
	const crownR = h * 0.32;
	const cy = y - h + crownR;
	const blobs = Array.from({ length: 7 }, (_, i) => {
		const a = (i / 7) * Math.PI * 2 + rng.range(0, 0.6);
		return [x + Math.cos(a) * crownR * 0.6, cy + Math.sin(a) * crownR * 0.45, crownR * rng.range(0.5, 0.75)] as const;
	});
	return (
		<g key={key}>
			<path d={`M${x - h * 0.03} ${y} L${x - h * 0.02} ${cy + crownR * 0.4} L${x - h * 0.12} ${cy} L${x - h * 0.01} ${cy + crownR * 0.25} L${x + h * 0.01} ${cy - crownR * 0.2} L${x + h * 0.02} ${cy + crownR * 0.4} L${x + h * 0.035} ${y} Z`} fill={trunk} />
			{blobs.map(([bx, by, br], i) => <circle key={i} cx={r1(bx)} cy={r1(by)} r={r1(br)} fill={k.c} />)}
			<circle cx={x} cy={cy} r={crownR * 0.75} fill={k.c} />
			{blobs.filter(([bx, by]) => bx < x && by < cy + 6).map(([bx, by, br], i) => (
				<circle key={`l${i}`} cx={r1(bx - br * 0.15)} cy={r1(by - br * 0.2)} r={r1(br * 0.7)} fill={k.lit} opacity={0.5} />
			))}
		</g>
	);
}

export function deadTree(key: string | number, x: number, y: number, h: number, color: string, rng: ArtRng): ReactNode {
	const branches: string[] = [];
	const grow = (bx: number, by: number, len: number, ang: number, width: number, depth: number) => {
		const ex = bx + Math.cos(ang) * len;
		const ey = by + Math.sin(ang) * len;
		branches.push(`M${r1(bx)} ${r1(by)}L${r1(ex)} ${r1(ey)}|${r1(width)}`);
		if (depth <= 0) return;
		const n = depth > 2 ? 2 : rng.int(1, 2);
		for (let i = 0; i < n; i++) grow(ex, ey, len * rng.range(0.55, 0.75), ang + rng.range(-0.7, 0.7) + (i ? 0.35 : -0.35), width * 0.62, depth - 1);
	};
	grow(x, y, h * 0.45, -Math.PI / 2 + rng.range(-0.15, 0.15), h * 0.06, 4);
	return (
		<g key={key} stroke={color} strokeLinecap="round" fill="none">
			{branches.map((b, i) => {
				const [d, w] = b.split("|");
				return <path key={i} d={d} strokeWidth={w} />;
			})}
			<path d={`M${x - h * 0.06} ${y} Q${x} ${y - 14} ${x + h * 0.07} ${y}`} fill={color} stroke="none" />
		</g>
	);
}

export function bush(key: string | number, x: number, y: number, s: number, k: Ink, rng: ArtRng): ReactNode {
	const n = 4 + Math.floor(rng.next() * 3);
	return (
		<g key={key}>
			{Array.from({ length: n }, (_, i) => {
				const bx = x + (i - n / 2) * s * 0.45 + rng.range(-4, 4);
				const r = s * rng.range(0.35, 0.6);
				return <circle key={i} cx={r1(bx)} cy={r1(y - r * 0.6)} r={r1(r)} fill={i % 3 === 0 ? k.lit : k.c} />;
			})}
		</g>
	);
}

export function grassTufts(key: string, x0: number, x1: number, yAt: (x: number) => number, color: string, rng: ArtRng, density = 0.08, hmax = 22): ReactNode {
	let d = "";
	for (let x = x0; x < x1; x += 1 / density) {
		const bx = x + rng.range(-6, 6);
		const by = yAt(bx) + 2;
		const n = rng.int(2, 4);
		for (let i = 0; i < n; i++) {
			const h = rng.range(hmax * 0.4, hmax);
			const lean = rng.range(-8, 8);
			d += `M${r1(bx + i * 2 - 2)} ${r1(by)}Q${r1(bx + lean * 0.4)} ${r1(by - h * 0.6)} ${r1(bx + lean)} ${r1(by - h)}Q${r1(bx + lean * 0.3 + 2)} ${r1(by - h * 0.5)} ${r1(bx + i * 2 + 1)} ${r1(by)}`;
		}
	}
	return <path key={key} d={d} fill={color} />;
}

export function rock(key: string | number, x: number, y: number, s: number, k: Ink, rng: ArtRng): ReactNode {
	const pts: Pt[] = [];
	const n = 7;
	for (let i = 0; i <= n; i++) {
		const a = Math.PI + (Math.PI * i) / n;
		const r = s * rng.range(0.7, 1.05);
		pts.push([x + Math.cos(a) * r * 1.3, y + Math.sin(a) * r * 0.8]);
	}
	const lit: Pt[] = [pts[0], ...pts.slice(1, 4), [x - s * 0.1, y - s * 0.2], [x - s * 0.6, y]];
	return (
		<g key={key}>
			<path d={poly(pts)} fill={k.c} />
			<path d={poly(lit)} fill={k.lit} opacity={0.6} />
		</g>
	);
}

// ─── Buildings ─────────────────────────────────────────────────────────────

export interface HouseOpts {
	w: number;
	h: number;
	roofH: number;
	wall: string;
	roof: string;
	lit: string;
	windowsLit: boolean;
	windowGlow: string;
	chimney?: boolean;
	timber?: boolean;
	snow?: boolean;
}

export function house(key: string | number, x: number, y: number, o: HouseOpts, rng: ArtRng): ReactNode {
	const { w, h, roofH } = o;
	const left = x - w / 2;
	const top = y - h;
	const win = (wx: number, wy: number, ww: number, wh: number, i: number) => (
		<g key={i}>
			<rect x={r1(wx)} y={r1(wy)} width={r1(ww)} height={r1(wh)} fill={o.windowsLit ? o.windowGlow : shade(o.wall, -0.25)} />
			{o.windowsLit && <rect x={r1(wx - ww)} y={r1(wy - wh * 0.6)} width={r1(ww * 3)} height={r1(wh * 2.2)} fill={o.windowGlow} opacity={0.18} className="dh-flicker-slow" filter={u("blur8")} />}
			<path d={`M${r1(wx + ww / 2)} ${r1(wy)}V${r1(wy + wh)}M${r1(wx)} ${r1(wy + wh / 2)}H${r1(wx + ww)}`} stroke={shade(o.wall, -0.35)} strokeWidth={1.5} />
		</g>
	);
	const windows: ReactNode[] = [];
	const cols = Math.max(1, Math.floor(w / 46));
	const rows = h > 90 ? 2 : 1;
	for (let r = 0; r < rows; r++)
		for (let c = 0; c < cols; c++) {
			if (rng.next() < 0.25) continue;
			const ww = 12;
			const wx = left + ((c + 0.5) * w) / cols - ww / 2;
			windows.push(win(wx, top + 16 + r * (h / rows), ww, 16, r * 10 + c));
		}
	return (
		<g key={key}>
			{o.chimney && <rect x={r1(x + w * 0.2)} y={r1(top - roofH * 0.9)} width={12} height={r1(roofH * 0.7)} fill={shade(o.wall, -0.15)} />}
			<rect x={r1(left)} y={r1(top)} width={r1(w)} height={r1(h)} fill={o.wall} />
			<rect x={r1(left)} y={r1(top)} width={r1(w * 0.35)} height={r1(h)} fill={o.lit} opacity={0.35} />
			{o.timber && (
				<path d={`M${r1(left)} ${r1(top + h * 0.45)}H${r1(left + w)}M${r1(left + w * 0.33)} ${r1(top)}V${r1(y)}M${r1(left + w * 0.66)} ${r1(top)}V${r1(y)}M${r1(left)} ${r1(top)}L${r1(left + w * 0.33)} ${r1(top + h * 0.45)}`} stroke={shade(o.wall, -0.35)} strokeWidth={3} />
			)}
			{windows}
			<rect x={r1(x - 8)} y={r1(y - 26)} width={16} height={26} fill={shade(o.wall, -0.4)} />
			<path d={`M${r1(left - 8)} ${r1(top)}L${r1(x)} ${r1(top - roofH)}L${r1(left + w + 8)} ${r1(top)}Z`} fill={o.roof} />
			<path d={`M${r1(left - 8)} ${r1(top)}L${r1(x)} ${r1(top - roofH)}L${r1(x)} ${r1(top)}Z`} fill={mix(o.roof, o.lit, 0.25)} />
			{o.snow && <path d={`M${r1(left - 8)} ${r1(top)}L${r1(x)} ${r1(top - roofH)}L${r1(left + w + 8)} ${r1(top)}L${r1(left + w)} ${r1(top - 5)}L${r1(x)} ${r1(top - roofH + 8)}L${r1(left)} ${r1(top - 5)}Z`} fill="#eef2f6" opacity={0.85} />}
			<path d={`M${r1(left - 8)} ${r1(top)}H${r1(left + w + 8)}`} stroke={shade(o.roof, -0.3)} strokeWidth={3} />
		</g>
	);
}

export function tower(key: string | number, x: number, y: number, w: number, h: number, wall: string, lit: string, roof: string | null, windowGlow: string | null): ReactNode {
	const left = x - w / 2;
	const nCren = Math.max(3, Math.floor(w / 14));
	const crenel = Array.from({ length: nCren }, (_, i) => {
		const cw = w / (nCren * 2 - 1);
		return <rect key={i} x={r1(left + i * 2 * cw)} y={r1(y - h - 12)} width={r1(cw)} height={12} fill={wall} />;
	});
	return (
		<g key={key}>
			<rect x={r1(left)} y={r1(y - h)} width={r1(w)} height={r1(h)} fill={wall} />
			<rect x={r1(left)} y={r1(y - h)} width={r1(w * 0.3)} height={r1(h)} fill={lit} opacity={0.3} />
			{roof ? (
				<g>
					<path d={`M${r1(left - 6)} ${r1(y - h)}L${r1(x)} ${r1(y - h - w * 1.3)}L${r1(left + w + 6)} ${r1(y - h)}Z`} fill={roof} />
					<path d={`M${r1(left - 6)} ${r1(y - h)}L${r1(x)} ${r1(y - h - w * 1.3)}L${r1(x)} ${r1(y - h)}Z`} fill={mix(roof, lit, 0.25)} />
				</g>
			) : (
				crenel
			)}
			{windowGlow && (
				<g>
					<path d={`M${r1(x - 4)} ${r1(y - h * 0.7)}v-14a4 4 0 0 1 8 0v14Z`} fill={windowGlow} />
					<circle cx={x} cy={r1(y - h * 0.7 - 8)} r={18} fill={windowGlow} opacity={0.15} filter={u("blur8")} />
				</g>
			)}
		</g>
	);
}

// ─── Lights ────────────────────────────────────────────────────────────────

export function flame(key: string | number, x: number, y: number, s: number, cls = "dh-flame"): ReactNode {
	return (
		<g key={key} className={cls} style={{ transformOrigin: `${r1(x)}px ${r1(y)}px`, transformBox: "view-box" }}>
			<path d={`M${r1(x - s * 0.5)} ${r1(y)}C${r1(x - s * 0.7)} ${r1(y - s * 0.8)} ${r1(x - s * 0.1)} ${r1(y - s * 1.2)} ${r1(x)} ${r1(y - s * 2)}C${r1(x + s * 0.2)} ${r1(y - s * 1.2)} ${r1(x + s * 0.75)} ${r1(y - s * 0.8)} ${r1(x + s * 0.5)} ${r1(y)}Z`} fill="#ff6a1a" />
			<path d={`M${r1(x - s * 0.32)} ${r1(y)}C${r1(x - s * 0.45)} ${r1(y - s * 0.6)} ${r1(x - s * 0.05)} ${r1(y - s * 0.9)} ${r1(x + s * 0.05)} ${r1(y - s * 1.45)}C${r1(x + s * 0.15)} ${r1(y - s * 0.9)} ${r1(x + s * 0.45)} ${r1(y - s * 0.6)} ${r1(x + s * 0.32)} ${r1(y)}Z`} fill="#ffb22e" />
			<path d={`M${r1(x - s * 0.16)} ${r1(y)}C${r1(x - s * 0.2)} ${r1(y - s * 0.4)} ${r1(x)} ${r1(y - s * 0.6)} ${r1(x + s * 0.03)} ${r1(y - s * 0.85)}C${r1(x + s * 0.1)} ${r1(y - s * 0.5)} ${r1(x + s * 0.22)} ${r1(y - s * 0.4)} ${r1(x + s * 0.16)} ${r1(y)}Z`} fill="#fff2b0" />
		</g>
	);
}

export function glow(key: string | number, x: number, y: number, r: number, tone: GlowTone, opacity = 0.5, cls = "dh-glow"): ReactNode {
	return <circle key={key} cx={r1(x)} cy={r1(y)} r={r1(r)} fill={u(`glow-${tone}`)} opacity={opacity} className={cls} style={{ mixBlendMode: "screen" }} />;
}

export function torch(key: string | number, x: number, y: number, s = 1, wall = false): ReactNode {
	return (
		<g key={key}>
			{glow("g", x, y - 60 * s, 150 * s, "fire", 0.55)}
			{wall ? (
				<path d={`M${x - 3 * s} ${y - 40 * s}L${x + 3 * s} ${y - 40 * s}L${x + 2 * s} ${y}L${x - 2 * s} ${y}Z M${x - 10 * s} ${y - 10 * s}H${x + 10 * s}V${y - 4 * s}H${x - 10 * s}Z`} fill="#2a1a10" />
			) : (
				<rect x={x - 3 * s} y={y - 50 * s} width={6 * s} height={50 * s} fill="#2a1a10" />
			)}
			<path d={`M${x - 7 * s} ${y - (wall ? 46 : 56) * s}h${14 * s}l-3 ${8 * s}h${-8 * s}Z`} fill="#3a2a1a" />
			{flame("f", x, y - (wall ? 46 : 56) * s, 10 * s)}
		</g>
	);
}

export function lantern(key: string | number, x: number, y: number, chain: number, s = 1, color = "#ffb050", tone: GlowTone = "warm"): ReactNode {
	return (
		<g key={key} className="dh-sway" style={{ transformOrigin: `${r1(x)}px ${r1(y - chain)}px`, transformBox: "view-box" }}>
			<line x1={x} y1={y - chain} x2={x} y2={y - 14 * s} stroke="#1a1410" strokeWidth={2} />
			{glow("g", x, y, 110 * s, tone, 0.6)}
			<path d={`M${x - 9 * s} ${y - 14 * s}h${18 * s}l${-3 * s} ${-5 * s}h${-12 * s}Z`} fill="#2a1e14" />
			<rect x={x - 8 * s} y={y - 14 * s} width={16 * s} height={22 * s} rx={2} fill={color} />
			<rect x={x - 8 * s} y={y - 14 * s} width={16 * s} height={22 * s} rx={2} fill="none" stroke="#2a1e14" strokeWidth={2.5} />
			<path d={`M${x} ${y - 14 * s}v${22 * s}`} stroke="#2a1e14" strokeWidth={1.5} />
			<path d={`M${x - 10 * s} ${y + 8 * s}h${20 * s}l${-4 * s} ${5 * s}h${-12 * s}Z`} fill="#2a1e14" />
		</g>
	);
}
