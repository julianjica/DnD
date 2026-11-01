import type { ReactNode } from "react";
import { mix, shade } from "@/lib/art/color";
import { ArtRng, r1 } from "@/lib/art/rand";
import { flame, glow, lantern, torch } from "./elements";
import { gid, poly, ridge, ridgePath, u, type GlowTone, type Pt } from "./geom";
import type { Layers, OutCtx } from "./outdoor";

const W = 1600;
const H = 900;

/** Simple 1-point perspective around a vanishing point. */
function makePersp(vx: number, vy: number, k = 2.6) {
	return (X: number, Y: number, z: number): Pt => {
		const s = 1 / (1 + z * k);
		return [vx + X * s, vy + Y * s];
	};
}

function stoneTexture(key: string, rng: ArtRng, pts: Pt[], base: string, rows: number, cols: number, quad: [Pt, Pt, Pt, Pt]): ReactNode {
	// Bilinear brick grid inside a quad (tl, tr, br, bl).
	const [tl, tr, br, bl] = quad;
	const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
	const at = (uu: number, vv: number): Pt => lerp(lerp(tl, tr, uu), lerp(bl, br, uu), vv);
	let d = "";
	const fills: ReactNode[] = [];
	for (let r = 0; r < rows; r++) {
		const v0 = r / rows;
		const v1 = (r + 1) / rows;
		const off = (r % 2) * 0.5;
		for (let c = -1; c < cols; c++) {
			const u0 = Math.max(0, (c + off) / cols);
			const u1 = Math.min(1, (c + 1 + off) / cols);
			if (u1 <= u0) continue;
			const q = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)] as Pt[];
			d += poly(q);
			const tone = rng.range(-0.06, 0.05);
			if (Math.abs(tone) > 0.025) fills.push(<path key={`${r}-${c}`} d={poly(q)} fill={shade(base, tone)} />);
		}
	}
	return (
		<g key={key}>
			<path d={poly(pts)} fill={base} />
			{fills}
			<path d={d} fill="none" stroke={shade(base, -0.22)} strokeWidth={1.4} opacity={0.8} />
		</g>
	);
}

function archPath(cx: number, base: number, w: number, h: number): string {
	const r = w / 2;
	return `M${r1(cx - r)} ${r1(base)}V${r1(base - h + r)}A${r1(r)} ${r1(r)} 0 0 1 ${r1(cx + r)} ${r1(base - h + r)}V${r1(base)}Z`;
}

function skyWindow(ctx: OutCtx, x: number, y: number, w: number, h: number, key: string, arched = true): ReactNode {
	const { pal } = ctx;
	const clip = gid(`win-${key}`);
	const d = arched ? archPath(x, y + h, w, h) : poly([[x - w / 2, y], [x + w / 2, y], [x + w / 2, y + h], [x - w / 2, y + h]]);
	return (
		<g key={key}>
			<clipPath id={clip}><path d={d} /></clipPath>
			<g clipPath={`url(#${clip})`}>
				<rect x={x - w / 2} y={y} width={w} height={h} fill={u("sky")} />
				{pal.night && <circle cx={x + w * 0.2} cy={y + h * 0.3} r={w * 0.12} fill="#eef3fb" opacity={0.9} />}
				<path d={ridgePath(ridge(ctx.rng, { y: y + h * 0.82, amp: h * 0.1, freq: 6, x0: x - w, x1: x + w, step: 8 }), y + h)} fill={mix(pal.haze, "#101820", 0.5)} />
			</g>
			<path d={d} fill="none" stroke="#24180e" strokeWidth={10} />
			<path d={`M${x} ${y}V${y + h}M${x - w / 2} ${y + h * 0.55}H${x + w / 2}`} stroke="#24180e" strokeWidth={6} />
			{!pal.night && <path d={`M${x - w / 2} ${y + h}L${x + w / 2} ${y + h}L${x + w * 1.6} ${H}L${x - w * 0.2} ${H}Z`} fill={pal.light} opacity={0.06} />}
		</g>
	);
}

// ─── Tavern ───────────────────────────────────────────────────────────────
function tavern(ctx: OutCtx): Layers {
	const { rng } = ctx;
	const plaster = "#7a6248";
	const woodC = "#4a2e1a";
	const woodLit = "#6a4426";
	const floorC = "#3a2414";
	const bottles = Array.from({ length: 26 }, (_, i) => {
		const shelf = Math.floor(i / 13);
		const x = 930 + (i % 13) * 34 + rng.range(-4, 4);
		const y = 400 + shelf * 80;
		const h = rng.range(26, 42);
		const c = rng.pick(["#3a6a3a", "#6a2a2a", "#8a6a2a", "#2a4a6a", "#5a3a6a", "#a08a5a"]);
		return (
			<g key={i}>
				<rect x={x - 6} y={y - h} width={12} height={h} rx={3} fill={c} />
				<rect x={x - 3} y={y - h - 10} width={6} height={12} fill={c} />
				<rect x={x - 4} y={y - h + 4} width={2.5} height={h - 10} fill="#fff" opacity={0.3} />
			</g>
		);
	});
	return {
		far: (
			<g>
				<rect x={0} y={0} width={W} height={H} fill={plaster} />
				{Array.from({ length: 40 }, (_, i) => <rect key={i} x={r1(rng.range(0, W))} y={r1(rng.range(80, 470))} width={r1(rng.range(30, 90))} height={r1(rng.range(10, 30))} fill={shade(plaster, rng.range(-0.06, 0.04))} opacity={0.6} />)}
				{/* timber frame */}
				{[0, 300, 620, 1260, 1600].map((x) => <rect key={x} x={x - 16} y={0} width={32} height={520} fill={woodC} />)}
				<path d="M300 520L620 200M1260 520L1600 220" stroke={woodC} strokeWidth={26} />
				{skyWindow(ctx, 460, 170, 190, 230, "w1")}
				{/* wainscot */}
				<rect x={0} y={500} width={W} height={180} fill={woodC} />
				{Array.from({ length: 24 }, (_, i) => <rect key={i} x={i * 70 + 8} y={516} width={54} height={150} fill={woodLit} opacity={0.35} />)}
				<rect x={0} y={496} width={W} height={10} fill={woodLit} />
				{/* fireplace */}
				<path d="M40 680V300H300V680Z" fill="#5a5450" />
				{Array.from({ length: 30 }, (_, i) => <rect key={i} x={40 + (i % 5) * 52 + (Math.floor(i / 5) % 2) * 26} y={300 + Math.floor(i / 5) * 64} width={52} height={64} fill="none" stroke="#3a3430" strokeWidth={2} />)}
				<path d="M20 300H320V270H20Z" fill={woodLit} />
				<path d="M90 680V470A80 80 0 0 1 250 470V680Z" fill="#120a06" />
				{glow("fpg", 170, 600, 420, "fire", 0.75, "dh-glow")}
				{flame("ff1", 140, 660, 30, "dh-flame")}
				{flame("ff2", 200, 664, 26, "dh-flame2")}
				{flame("ff3", 170, 662, 42, "dh-flame3")}
				<path d="M110 668h120v12h-120Z" fill="#2a1a10" />
				{/* shield & antlers */}
				<circle cx={1430} cy={330} r={56} fill="#7a2a22" stroke="#c9a24a" strokeWidth={8} />
				<path d="M1430 278V382M1378 330H1482" stroke="#c9a24a" strokeWidth={6} />
			</g>
		),
		mid: (
			<g>
				{/* back bar shelves */}
				<rect x={900} y={300} width={460} height={230} fill="#2a1a10" />
				{[400, 480].map((y) => <rect key={y} x={900} y={y} width={460} height={8} fill={woodLit} />)}
				{bottles}
				{/* kegs */}
				{[[960, 300], [1040, 300], [1120, 300]].map(([x, y], i) => (
					<g key={i}>
						<circle cx={x} cy={y - 36} r={36} fill={woodLit} stroke={woodC} strokeWidth={5} />
						<circle cx={x} cy={y - 36} r={22} fill="none" stroke="#2a2420" strokeWidth={3} />
						<rect x={x - 3} y={y - 40} width={6} height={18} fill="#c9a24a" />
					</g>
				))}
				{/* counter */}
				<path d="M760 560H1600V760H760Z" fill={woodC} />
				<path d="M740 548H1620V572H740Z" fill={woodLit} />
				{Array.from({ length: 8 }, (_, i) => <rect key={i} x={790 + i * 104} y={590} width={80} height={150} fill={woodLit} opacity={0.25} />)}
				{/* mugs */}
				{[900, 1010, 1290].map((x) => (
					<g key={x}>
						<rect x={x} y={518} width={26} height={32} rx={3} fill="#8a6a3a" />
						<path d={`M${x + 26} ${526}q14 0 14 10t-14 10`} stroke="#8a6a3a" strokeWidth={4} fill="none" />
						<ellipse cx={x + 13} cy={518} rx={13} ry={4} fill="#f4ecd8" />
					</g>
				))}
			</g>
		),
		near: (
			<g>
				{/* floor */}
				<path d="M0 680H1600V900H0Z" fill={floorC} />
				{Array.from({ length: 22 }, (_, i) => {
					const x = -400 + i * 110;
					return <path key={i} d={`M${r1(800 + (x - 800) * 0.6)} 680L${r1(800 + (x - 800) * 1.8)} 900`} stroke={shade(floorC, -0.25)} strokeWidth={2} />;
				})}
				{[700, 730, 772, 830].map((y) => <path key={y} d={`M0 ${y}H1600`} stroke={shade(floorC, -0.2)} strokeWidth={1.5} opacity={0.5} />)}
				{glow("floorfire", 200, 760, 380, "fire", 0.35, "dh-glow")}
				{/* ceiling beams */}
				<rect x={0} y={0} width={W} height={60} fill="#1e120a" />
				{[100, 500, 900, 1300].map((x) => <rect key={x} x={x} y={0} width={60} height={80} fill="#24160c" />)}
				<path d="M0 60H1600" stroke="#3a2414" strokeWidth={10} />
				{lantern("l1", 700, 230, 230, 1.6)}
				{lantern("l2", 1180, 200, 200, 1.4)}
			</g>
		),
		fg: (
			<g>
				{/* table + stool silhouettes */}
				<path d="M-20 760H520L500 790H-20Z" fill="#1c100a" />
				<path d="M420 790h24v120h-24Z M40 790h24v120h-24Z" fill="#160c06" />
				<path d="M-20 752H530" stroke="#5a3a20" strokeWidth={6} />
				<rect x={330} y={700} width={36} height={52} rx={4} fill="#5a3a20" />
				<ellipse cx={348} cy={700} rx={18} ry={5} fill="#e8dcc0" />
				<rect x={180} y={712} width={14} height={40} fill="#e8dcc0" />
				{flame("cf", 187, 712, 7, "dh-flame2")}
				{glow("cg", 187, 700, 120, "warm", 0.6)}
				<path d="M1380 900V800H1560V900Z M1360 790H1580V810H1360Z" fill="#160c06" />
			</g>
		),
		groundAt: (x) => 800 + (x > 800 ? 40 : 0),
		propScale: 0.7,
		darkness: 0.55,
		lights: [
			{ x: 170, y: 600, r: 560, tone: "fire", o: 0.75 },
			{ x: 700, y: 230, r: 340, tone: "warm", o: 0.6 },
			{ x: 1180, y: 200, r: 320, tone: "warm", o: 0.55 },
			{ x: 187, y: 700, r: 170, tone: "warm", o: 0.6 },
			{ x: 460, y: 290, r: 260, tone: ctx.pal.night ? "cold" : "white", o: 0.3 },
		],
	};
}

// ─── Dungeon / crypt corridor ────────────────────────────────────────────
function corridor(ctx: OutCtx, crypt: boolean): Layers {
	const { rng, pal } = ctx;
	const P = makePersp(800, 470);
	const halfW = crypt ? 900 : 760;
	const floorY = 430;
	const ceilY = -470;
	const wallBase = crypt ? "#4a4a50" : "#4a4440";
	const floorBase = crypt ? "#3a3a3e" : "#3c3632";
	const zFar = 2.2;
	const L = (z: number) => P(-halfW, floorY, z);
	const Lt = (z: number) => P(-halfW, ceilY * 0.55, z);
	const R = (z: number) => P(halfW, floorY, z);
	const Rt = (z: number) => P(halfW, ceilY * 0.55, z);
	const leftWall: Pt[] = [Lt(0), Lt(zFar), L(zFar), L(0)];
	const rightWall: Pt[] = [Rt(zFar), Rt(0), R(0), R(zFar)];
	const floor: Pt[] = [L(0), L(zFar), R(zFar), R(0)];
	const backW = R(zFar)[0] - L(zFar)[0];
	const arches: ReactNode[] = [];
	const torches: ReactNode[] = [];
	const lights: NonNullable<Layers["lights"]> = [];
	const ribs = 5;
	for (let i = ribs; i >= 0; i--) {
		const z = (i / ribs) * zFar;
		const [lx, ly] = L(z);
		const [rx] = R(z);
		const [, ty] = Lt(z);
		const s = 1 / (1 + z * 2.6);
		const thick = 70 * s;
		const fade = Math.min(0.85, z / zFar);
		const c = mix(wallBase, "#05040a", fade * 0.85);
		const aw = rx - lx;
		const outer = `M${r1(lx - thick)} ${r1(ly)}V${r1(ty + aw * 0.1)}Q${r1(lx - thick)} ${r1(ty - aw * 0.32 - thick)} ${r1((lx + rx) / 2)} ${r1(ty - aw * 0.34 - thick)}Q${r1(rx + thick)} ${r1(ty - aw * 0.32 - thick)} ${r1(rx + thick)} ${r1(ty + aw * 0.1)}V${r1(ly)}H${r1(rx)}V${r1(ty + aw * 0.1)}Q${r1(rx)} ${r1(ty - aw * 0.3)} ${r1((lx + rx) / 2)} ${r1(ty - aw * 0.32)}Q${r1(lx)} ${r1(ty - aw * 0.3)} ${r1(lx)} ${r1(ty + aw * 0.1)}V${r1(ly)}Z`;
		arches.push(
			<g key={`a${i}`}>
				<path d={outer} fill={c} />
				<path d={`M${r1(lx)} ${r1(ly)}V${r1(ty + aw * 0.1)}Q${r1(lx)} ${r1(ty - aw * 0.3)} ${r1((lx + rx) / 2)} ${r1(ty - aw * 0.32)}`} stroke={mix(c, "#ffb070", 0.25)} strokeWidth={3 * s + 1} fill="none" opacity={0.6} />
			</g>,
		);
		if (i > 0 && i < ribs && i % 2 === 1) {
			const tz = z - zFar / ribs / 2;
			const [tlx, tly] = P(-halfW, -60, tz);
			const [trx] = P(halfW, -60, tz);
			const ts = 1 / (1 + tz * 2.6);
			torches.push(torch(`tl${i}`, tlx + 14 * ts, tly, ts * 1.6, true), torch(`tr${i}`, trx - 14 * ts, tly, ts * 1.6, true));
			lights.push({ x: tlx + 14 * ts, y: tly - 70 * ts, r: 420 * ts, tone: "fire", o: 0.7 }, { x: trx - 14 * ts, y: tly - 70 * ts, r: 420 * ts, tone: "fire", o: 0.7 });
		}
	}
	const back = archPath(800, L(zFar)[1], backW, (L(zFar)[1] - Lt(zFar)[1]) * 1.25);
	// Floor flagstones
	let flags = "";
	for (let j = 0; j <= 8; j++) {
		const z = (j / 8) ** 1.4 * zFar;
		const [ax, ay] = L(z);
		const [bx] = R(z);
		flags += `M${r1(ax)} ${r1(ay)}H${r1(bx)}`;
	}
	for (let k = -6; k <= 6; k++) {
		const [ax, ay] = P((k / 6) * halfW, floorY, 0);
		const [bx, by] = P((k / 6) * halfW, floorY, zFar);
		flags += `M${r1(ax)} ${r1(ay)}L${r1(bx)} ${r1(by)}`;
	}
	const crypts: ReactNode[] = [];
	if (crypt) {
		[0.35, 1.1].forEach((z, i) => {
			[-1, 1].forEach((side) => {
				const [x, y] = P(side * halfW * 0.62, floorY, z);
				const s = 1 / (1 + z * 2.6);
				const st = mix("#6a6a70", "#05040a", z / zFar * 0.7);
				crypts.push(
					<g key={`s${i}${side}`}>
						<path d={`M${r1(x - 160 * s)} ${r1(y)}V${r1(y - 90 * s)}H${r1(x + 160 * s)}V${r1(y)}Z`} fill={st} />
						<path d={`M${r1(x - 176 * s)} ${r1(y - 90 * s)}L${r1(x - 150 * s)} ${r1(y - 120 * s)}H${r1(x + 150 * s)}L${r1(x + 176 * s)} ${r1(y - 90 * s)}Z`} fill={shade(st, 0.1)} />
						<path d={`M${r1(x - 110 * s)} ${r1(y - 120 * s)}Q${r1(x)} ${r1(y - 150 * s)} ${r1(x + 110 * s)} ${r1(y - 120 * s)}`} stroke={shade(st, 0.15)} strokeWidth={14 * s} fill="none" />
					</g>,
				);
			});
		});
	}
	const chains = !crypt ? (
		<g stroke="#1a1614" strokeWidth={4} fill="none">
			{[[-500, 0.3], [460, 0.6]].map(([X, z], i) => {
				const [x, y] = P(X, ceilY * 0.7, z);
				return <path key={i} d={`M${r1(x)} ${r1(y)}v${r1(220 / (1 + z * 2.6))}`} strokeDasharray="10 4" className="dh-sway" style={{ transformOrigin: `${r1(x)}px ${r1(y)}px`, transformBox: "view-box" }} />;
			})}
		</g>
	) : null;
	const cobwebs = crypt ? (
		<g stroke="#d8d8e0" strokeOpacity={0.35} strokeWidth={1.2} fill="none">
			{[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M0 ${i * 40}L${200 - i * 40} 0`} />)}
			{[60, 110, 160].map((r) => <path key={r} d={`M0 ${r}Q${r * 0.5} ${r * 0.5} ${r} 0`} />)}
			{[0, 1, 2, 3, 4].map((i) => <path key={`b${i}`} d={`M1600 ${i * 40}L${1400 + i * 40} 0`} />)}
			{[60, 110, 160].map((r) => <path key={`c${r}`} d={`M1600 ${r}Q${1600 - r * 0.5} ${r * 0.5} ${1600 - r} 0`} />)}
		</g>
	) : null;
	return {
		far: (
			<g>
				<rect x={0} y={0} width={W} height={H} fill="#07060a" />
				<path d={back} fill={u("deep")} />
				{crypt && glow("deepglow", 800, L(zFar)[1] - 60, 200, "green", 0.45, "dh-glow-slow")}
			</g>
		),
		mid: (
			<g>
				{stoneTexture("lw", rng, leftWall, wallBase, 7, 10, [Lt(0), Lt(zFar), L(zFar), L(0)])}
				{stoneTexture("rw", rng, rightWall, wallBase, 7, 10, [Rt(zFar), Rt(0), R(0), R(zFar)])}
				<path d={poly(leftWall)} fill={u("walldepthL")} />
				<path d={poly(rightWall)} fill={u("walldepthR")} />
				<path d={poly(floor)} fill={floorBase} />
				<path d={flags} stroke={shade(floorBase, -0.3)} strokeWidth={2} fill="none" />
				<path d={poly(floor)} fill={u("floordepth")} />
				{!pal.night && pal.dark < 0.3 && !crypt && (
					<path d={`M700 -10L820 -10L980 ${floorY + 470}L620 ${floorY + 470}Z`} fill={u("shaft")} className="dh-shaft" />
				)}
				<ellipse cx={r1(P(-120, floorY, 0.3)[0])} cy={r1(P(-120, floorY, 0.3)[1])} rx={120} ry={14} fill="#8aa0c0" opacity={0.15} />
				{crypts}
				{arches}
				{torches}
				{chains}
			</g>
		),
		near: <g />,
		fg: (
			<g>
				{cobwebs}
				<rect x={0} y={0} width={W} height={50} fill="#050408" opacity={0.6} />
			</g>
		),
		groundAt: (x) => 840 + Math.abs(x - 800) * 0.02,
		propScale: 0.8,
		darkness: crypt ? 0.62 : 0.55,
		lights: [...lights, ...(crypt ? [{ x: 800, y: 420, r: 320, tone: "green" as const, o: 0.5 }] : []), ...(!pal.night && !crypt ? [{ x: 800, y: 300, r: 380, tone: "white" as const, o: 0.25 }] : [])],
	};
}

// ─── Cave / underdark ─────────────────────────────────────────────────────
function rockMass(key: string, rng: ArtRng, pts: Pt[], base: string, light: string, litSide: number): ReactNode {
	const facets: ReactNode[] = [];
	for (let i = 0; i < pts.length - 1; i += 2) {
		const [x, y] = pts[i];
		const [x2, y2] = pts[i + 1];
		const nx = (x + x2) / 2 + litSide * rng.range(10, 50);
		const ny = (y + y2) / 2 + rng.range(10, 40);
		facets.push(<path key={i} d={poly([[x, y], [x2, y2], [nx, ny]])} fill={mix(base, light, rng.range(0.05, 0.25))} opacity={0.75} />);
	}
	return (
		<g key={key}>
			<path d={poly(pts)} fill={base} />
			{facets}
		</g>
	);
}

function jaggedEdge(rng: ArtRng, from: Pt, to: Pt, n: number, jitter: number): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		out.push([from[0] + (to[0] - from[0]) * t + rng.range(-jitter, jitter), from[1] + (to[1] - from[1]) * t + rng.range(-jitter, jitter)]);
	}
	return out;
}

function cave(ctx: OutCtx, under: boolean): Layers {
	const { rng, pal } = ctx;
	const rockC = under ? "#1e1a26" : "#2e2824";
	const rockMid = under ? "#2a2436" : "#3e3630";
	const light = under ? "#7a60c0" : pal.night ? "#4a5a80" : mix(pal.light, "#ffb070", 0.3);
	const mouthX = rng.range(650, 950);
	const stal = (x: number, len: number, w: number, c: string, key: string, up = false) => (
		<path key={key} d={up ? `M${r1(x - w)} 905Q${r1(x - w * 0.3)} ${r1(905 - len * 0.5)} ${r1(x)} ${r1(905 - len)}Q${r1(x + w * 0.3)} ${r1(905 - len * 0.5)} ${r1(x + w)} 905Z` : `M${r1(x - w)} -5Q${r1(x - w * 0.3)} ${r1(len * 0.5)} ${r1(x)} ${r1(len)}Q${r1(x + w * 0.3)} ${r1(len * 0.5)} ${r1(x + w)} -5Z`} fill={c} />
	);
	if (under) {
		const pillars = Array.from({ length: 6 }, (_, i) => {
			const x = 120 + i * 280 + rng.range(-60, 60);
			const w = rng.range(40, 90);
			const c = mix("#2a2440", "#5a4a8a", 0.4);
			return (
				<g key={i} opacity={0.75}>
					<path d={`M${r1(x - w)} 0Q${r1(x - w * 0.2)} 300 ${r1(x - w * 0.4)} 420Q${r1(x)} 470 ${r1(x + w * 0.4)} 420Q${r1(x + w * 0.2)} 300 ${r1(x + w)} 0Z`} fill={c} />
					<path d={`M${r1(x - w * 0.6)} 620Q${r1(x)} 470 ${r1(x + w * 0.6)} 620Z`} fill={c} />
				</g>
			);
		});
		const riverY = 600;
		return {
			far: (
				<g>
					<rect x={0} y={0} width={W} height={H} fill={u("underdark")} />
					{pillars}
					{Array.from({ length: 30 }, (_, i) => <circle key={i} cx={r1(rng.range(0, W))} cy={r1(rng.range(100, 600))} r={r1(rng.range(1, 3))} fill={rng.pick(["#80ffd0", "#c0a0ff"])} className="dh-twinkle" style={{ animationDelay: `${r1(rng.range(0, 4))}s` }} />)}
				</g>
			),
			mid: (
				<g>
					<path d={ridgePath(ridge(rng, { y: 590, amp: 40, freq: 3, sharp: 0.4 }))} fill="#1a1626" />
					<path d={`M0 ${riverY + 30}Q400 ${riverY}  800 ${riverY + 40}T1600 ${riverY + 20}V${riverY + 70}Q1200 ${riverY + 90} 800 ${riverY + 70}T0 ${riverY + 80}Z`} fill="#3ad0e0" opacity={0.7} className="dh-shimmer" />
					{glow("rv", 800, riverY + 50, 600, "cold", 0.35, "dh-glow-slow")}
					{[200, 520, 1100, 1380].map((x, i) => (
						<g key={i}>
							{glow(`m${i}`, x, 640, 160, i % 2 ? "green" : "violet", 0.5, "dh-glow-slow")}
							<path d={`M${x - 8} 680Q${x - 4} 600 ${x - 6} 560H${x + 6}Q${x + 4} 600 ${x + 8} 680Z`} fill="#c8c0d8" opacity={0.6} />
							<path d={`M${x - 60} 566Q${x} 470 ${x + 60} 566Z`} fill={i % 2 ? "#30c0a0" : "#9a60e0"} opacity={0.85} />
						</g>
					))}
				</g>
			),
			near: (
				<g>
					{rockMass("l", rng, [[-20, 900], ...jaggedEdge(rng, [-20, 560], [520, 900], 10, 26)], rockC, light, 1)}
					{rockMass("r", rng, [[1620, 900], ...jaggedEdge(rng, [1620, 520], [1060, 900], 10, 26)], rockC, light, -1)}
					<path d={`M300 900Q800 760 1300 900Z`} fill={rockMid} />
				</g>
			),
			fg: (
				<g>
					{Array.from({ length: 9 }, (_, i) => stal(i * 200 + rng.range(-40, 40), rng.range(60, 200), rng.range(18, 40), "#0e0c14", `s${i}`))}
				</g>
			),
			groundAt: (x) => 820 + Math.abs(x - 800) * 0.05,
			propScale: 0.8,
			darkness: 0.35,
			lights: [
				{ x: 800, y: riverY + 50, r: 700, tone: "cold", o: 0.4 },
				...[200, 520, 1100, 1380].map((x, i) => ({ x, y: 600, r: 220, tone: (i % 2 ? "green" : "violet") as GlowTone, o: 0.55 })),
			],
		};
	}
	// Cave looking out toward its mouth.
	const mouthTop = 200;
	const mouth = jaggedEdge(rng, [mouthX - 330, 640], [mouthX - 150, mouthTop + 40], 6, 18)
		.concat(jaggedEdge(rng, [mouthX - 120, mouthTop], [mouthX + 160, mouthTop + 20], 6, 14))
		.concat(jaggedEdge(rng, [mouthX + 200, mouthTop + 60], [mouthX + 360, 640], 6, 18));
	const outer: Pt[] = [[-20, -20], [1620, -20], [1620, 920], [-20, 920], [-20, 640], ...mouth, [1620, 640], [1620, 920], [-20, 920]];
	return {
		far: (
			<g>
				<rect x={0} y={0} width={W} height={700} fill={u("sky")} />
				<path d={ridgePath(ridge(rng, { y: 560, amp: 60, freq: 3, sharp: 0.6 }))} fill={mix(pal.haze, "#3a4050", 0.4)} />
				<path d={ridgePath(ridge(rng, { y: 620, amp: 30, freq: 2.4 }))} fill={mix(pal.haze, "#2a3a2a", 0.6)} />
				{!pal.night && glow("sunin", mouthX, 500, 520, "warm", 0.5, "dh-glow-slow")}
			</g>
		),
		mid: (
			<g>
				{/* cave floor inside */}
				<path d={`M-20 920V680Q${mouthX} 620 1620 690V920Z`} fill={shade(rockMid, -0.05)} />
				{!pal.night && <path d={`M${mouthX - 300} 640L${mouthX + 340} 640L${mouthX + 700} 920L${mouthX - 600} 920Z`} fill={pal.light} opacity={0.08} />}
				<path d={poly(outer)} fill={rockMid} fillRule="evenodd" />
				{rockMass("rl", rng, [[-20, -20], [mouthX - 200, -20], ...jaggedEdge(rng, [mouthX - 260, 150], [mouthX - 400, 700], 7, 30), [-20, 920]], rockC, light, 1)}
				{rockMass("rr", rng, [[1620, -20], [mouthX + 240, -20], ...jaggedEdge(rng, [mouthX + 300, 150], [mouthX + 460, 700], 7, 30), [1620, 920]], rockC, light, -1)}
				<path d={mouth.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join("")} stroke={light} strokeOpacity={0.4} strokeWidth={4} fill="none" />
			</g>
		),
		near: (
			<g>
				{Array.from({ length: 6 }, (_, i) => stal(mouthX - 260 + i * 110 + rng.range(-20, 20), rng.range(100, 190), rng.range(14, 26), rockC, `st${i}`))}
				{Array.from({ length: 5 }, (_, i) => stal(rng.range(200, 1400), rng.range(60, 160), rng.range(20, 40), shade(rockC, 0.04), `sg${i}`, true))}
				{Array.from({ length: 6 }, (_, i) => <ellipse key={i} cx={r1(rng.range(300, 1300))} cy={r1(rng.range(740, 860))} rx={r1(rng.range(30, 80))} ry={6} fill="#8aa0c0" opacity={0.12} />)}
			</g>
		),
		fg: (
			<g>
				{Array.from({ length: 10 }, (_, i) => stal(i * 170 + rng.range(-30, 30), rng.range(80, 240), rng.range(20, 50), "#120e0c", `f${i}`))}
			</g>
		),
		groundAt: (x) => 820 + Math.abs(x - 800) * 0.04,
		propScale: 0.8,
		darkness: 0.45,
		lights: [{ x: mouthX, y: 480, r: 650, tone: pal.night ? "cold" : "warm", o: pal.night ? 0.3 : 0.55 }],
	};
}

// ─── Temple ───────────────────────────────────────────────────────────────
function temple(ctx: OutCtx): Layers {
	const { rng, pal } = ctx;
	const P = makePersp(800, 500, 1.8);
	const stone = "#8a8278";
	const halfW = 820;
	const floorY = 400;
	const zFar = 2.4;
	const columns: ReactNode[] = [];
	const braziers: NonNullable<Layers["lights"]> = [];
	const n = 5;
	for (let i = n - 1; i >= 0; i--) {
		const z = (i / (n - 1)) * zFar * 0.92;
		[-1, 1].forEach((side) => {
			const [x, yb] = P(side * halfW * 0.82, floorY, z);
			const [, yt] = P(side * halfW * 0.82, -900, z);
			const s = 1 / (1 + z * 1.8);
			const w = 70 * s;
			if (i === 1) braziers.push({ x: x + side * w * 2.4, y: yb - 100 * s, r: 420 * s, tone: "fire", o: 0.7 });
			const c = mix(stone, "#14101a", (z / zFar) * 0.6);
			columns.push(
				<g key={`${i}${side}`}>
					<rect x={r1(x - w)} y={r1(yt)} width={r1(w * 2)} height={r1(yb - yt)} fill={c} />
					<rect x={r1(x - w)} y={r1(yt)} width={r1(w * 0.6)} height={r1(yb - yt)} fill={mix(c, "#fff0d0", 0.18)} />
					{[0.25, 0.5, 0.75].map((t) => <path key={t} d={`M${r1(x - w + w * 2 * t)} ${r1(yt)}V${r1(yb)}`} stroke={shade(c, -0.15)} strokeWidth={2 * s + 0.5} />)}
					<rect x={r1(x - w * 1.3)} y={r1(yb - 30 * s)} width={r1(w * 2.6)} height={r1(30 * s)} fill={shade(c, 0.05)} />
					<rect x={r1(x - w * 1.3)} y={r1(yt)} width={r1(w * 2.6)} height={r1(28 * s)} fill={shade(c, 0.05)} />
					{i % 2 === 1 && (
						<g>
							<path d={`M${r1(x - side * w * 1.4)} ${r1(yt + 60 * s)}h${r1(-side * 90 * s)}v${r1(260 * s)}l${r1(side * 45 * s)} ${r1(-30 * s)}l${r1(side * 45 * s)} ${r1(30 * s)}Z`} fill={mix("#7a1e22", "#14101a", (z / zFar) * 0.6)} className="dh-banner" style={{ transformOrigin: `${r1(x)}px ${r1(yt)}px`, transformBox: "view-box" }} />
						</g>
					)}
					{i === 1 && (
						<g>
							<path d={`M${r1(x + side * w * 2.4 - 30 * s)} ${r1(yb)}l${r1(10 * s)} ${r1(-70 * s)}h${r1(40 * s)}l${r1(10 * s)} ${r1(70 * s)}Z`} fill="#3a3028" />
							{flame(`br${side}`, x + side * w * 2.4, yb - 70 * s, 26 * s, "dh-flame3")}
							{glow(`bg${side}`, x + side * w * 2.4, yb - 100 * s, 260 * s, "fire", 0.55)}
						</g>
					)}
				</g>,
			);
		});
	}
	// floor tiles
	const tiles: ReactNode[] = [];
	for (let j = 0; j < 10; j++) {
		for (let k = -6; k < 6; k++) {
			if ((j + k) % 2 === 0) continue;
			const z0 = (j / 10) * zFar;
			const z1 = ((j + 1) / 10) * zFar;
			const X0 = (k / 6) * halfW;
			const X1 = ((k + 1) / 6) * halfW;
			tiles.push(<path key={`${j}${k}`} d={poly([P(X0, floorY, z0), P(X1, floorY, z0), P(X1, floorY, z1), P(X0, floorY, z1)])} fill="#000000" opacity={0.18} />);
		}
	}
	const [, backFloor] = P(0, floorY, zFar);
	const glass = ["#c03030", "#3050c0", "#d0a030", "#30a060", "#8040c0"];
	const winW = 260;
	const winH = 420;
	const winY = backFloor - winH - 40;
	const panes = Array.from({ length: 24 }, (_, i) => {
		const cx = 800 + ((i % 6) - 2.5) * (winW / 6);
		const cy = winY + 30 + Math.floor(i / 6) * (winH / 5);
		return <rect key={i} x={r1(cx - winW / 12)} y={r1(cy)} width={r1(winW / 6)} height={r1(winH / 5)} fill={rng.pick(glass)} opacity={pal.night ? 0.45 : 0.85} />;
	});
	return {
		far: (
			<g>
				<rect x={0} y={0} width={W} height={H} fill={mix(stone, "#1a1420", 0.55)} />
				<rect x={0} y={0} width={W} height={backFloor} fill={u("templeback")} />
				<clipPath id={gid("glass")}><path d={archPath(800, winY + winH, winW, winH)} /></clipPath>
				<g clipPath={`url(#${gid("glass")})`}>
					<rect x={800 - winW / 2} y={winY} width={winW} height={winH} fill={pal.night ? "#1a2040" : "#fff4d8"} />
					{panes}
					<circle cx={800} cy={winY + 110} r={70} fill="none" stroke="#24180e" strokeWidth={10} />
					<path d={`M800 ${winY}V${winY + winH}`} stroke="#24180e" strokeWidth={8} />
				</g>
				<path d={archPath(800, winY + winH, winW, winH)} fill="none" stroke="#3a3028" strokeWidth={18} />
				{glow("winglow", 800, winY + 180, 420, pal.night ? "cold" : "warm", 0.5, "dh-glow-slow")}
			</g>
		),
		mid: (
			<g>
				<path d={poly([P(-halfW * 1.4, floorY, 0), P(-halfW, floorY, zFar), P(halfW, floorY, zFar), P(halfW * 1.4, floorY, 0)])} fill={mix(stone, "#2a2228", 0.35)} />
				{tiles}
				<path d={poly([P(-halfW * 0.2, floorY, 0), P(-halfW * 0.12, floorY, zFar), P(halfW * 0.12, floorY, zFar), P(halfW * 0.2, floorY, 0)])} fill="#6a1a22" opacity={0.85} />
				<path d={`M${800 - winW * 0.35} ${winY + winH}L${800 + winW * 0.35} ${winY + winH}L1100 920L500 920Z`} fill={u("shaft")} className="dh-shaft" />
				<path d={`M${800 - winW * 0.4} ${winY + 60}L${800 - winW * 0.1} ${winY + 40}L560 920L240 920Z`} fill={u("shaft")} opacity={0.5} className="dh-shaft2" />
				{columns}
			</g>
		),
		near: <g />,
		fg: (
			<g>
				<rect x={0} y={0} width={W} height={70} fill="#120e14" />
				<path d={`M0 70H1600`} stroke="#3a3028" strokeWidth={14} />
				{Array.from({ length: 30 }, (_, i) => <circle key={i} cx={r1(rng.range(400, 1200))} cy={r1(rng.range(200, 800))} r={r1(rng.range(1, 2.5))} fill="#fff4d0" opacity={0.6} className="dh-dust" style={{ animationDelay: `${r1(rng.range(0, 10))}s` }} />)}
			</g>
		),
		groundAt: () => P(0, floorY, 1.0)[1] + 10,
		propScale: 0.6,
		darkness: 0.45,
		lights: [{ x: 800, y: winY + 180, r: 520, tone: pal.night ? "cold" : "warm", o: 0.55 }, ...braziers],
	};
}

export function buildInterior(ctx: OutCtx): Layers {
	switch (ctx.kind) {
		case "tavern":
			return tavern(ctx);
		case "crypt":
			return corridor(ctx, true);
		case "cave":
			return cave(ctx, false);
		case "underdark":
			return cave(ctx, true);
		case "temple":
			return temple(ctx);
		case "dungeon":
		default:
			return corridor(ctx, false);
	}
}
