import type { ReactNode } from "react";
import type { SceneKind } from "@/lib/game/types";
import { mix, shade } from "@/lib/art/color";
import { GROUND, landColor, type SkyPalette } from "@/lib/art/scene";
import { ArtRng, r1 } from "@/lib/art/rand";
import { broadTree, bush, deadTree, grassTufts, house, ink, pine, rock, tower, lantern } from "./elements";
import { gid, type GlowTone, ridge, ridgeLine, ridgePath, ridgeShadows, ridgeY, u, type Pt } from "./geom";

export interface OutCtx {
	rng: ArtRng;
	pal: SkyPalette;
	kind: SceneKind;
	snow: boolean;
	/** Light color for lit facets (sun/moon tinted). */
	light: string;
	windowsLit: boolean;
	/** Sun/moon x position. */
	sunX: number;
}

export interface Layers {
	far: ReactNode;
	mid: ReactNode;
	near: ReactNode;
	fg: ReactNode;
	/** Ground y for props at x. */
	groundAt: (x: number) => number;
	/** Prop scale (near ground). */
	propScale: number;
	/** Interiors: darkness of the multiply pass (default 0.45). */
	darkness?: number;
	/** Interiors: light pools re-applied (screen) above the darkness pass. */
	lights?: { x: number; y: number; r: number; tone: GlowTone; o?: number }[];
}

const H = 900;

function col(ctx: OutCtx, depth: number, base?: string): string {
	return landColor(base ?? GROUND[ctx.kind], ctx.pal, depth, ctx.snow);
}

function rimmed(pts: Pt[], fill: string, rim: string, rimOpacity: number, key: string, extra?: ReactNode): ReactNode {
	return (
		<g key={key}>
			<path d={ridgePath(pts)} fill={fill} />
			{rimOpacity > 0 && <path d={ridgeLine(pts)} stroke={rim} strokeOpacity={rimOpacity} strokeWidth={2.5} fill="none" />}
			{extra}
		</g>
	);
}

/** Distant mountain ranges with optional snow caps (shared by most outdoor kinds). */
export function farMountains(ctx: OutCtx, y = 470, amp = 120, snowCaps = false): ReactNode {
	const { rng, pal } = ctx;
	const a = ridge(rng, { y, amp, freq: 3.2, sharp: 0.7, step: 12 });
	const b = ridge(rng, { y: y + 50, amp: amp * 0.7, freq: 4, sharp: 0.5, step: 12 });
	const ca = landColor("#5a6478", pal, 0.92);
	const cb = landColor("#4a5468", pal, 0.78);
	const peakY = Math.min(...a.map(([, py]) => py));
	return (
		<g>
			<path d={ridgePath(a)} fill={ca} />
			<path d={ridgeShadows(a, -1)} fill={shade(ca, -0.12)} opacity={0.55} />
			{(snowCaps || ctx.snow) && (
				<g>
					<clipPath id={gid("snowcap")}>
						<rect x={0} y={0} width={1600} height={r1(peakY + amp * 0.55)} />
					</clipPath>
					<path d={ridgePath(a)} fill={mix("#f4f8fc", pal.haze, 0.45)} clipPath={u("snowcap")} opacity={0.85} />
				</g>
			)}
			<path d={ridgePath(b)} fill={cb} />
			<path d={ridgeShadows(b, -1)} fill={shade(cb, -0.1)} opacity={0.5} />
			<path d={ridgeLine(b)} stroke={ctx.light} strokeOpacity={pal.night ? 0.08 : 0.18} strokeWidth={2} fill="none" />
		</g>
	);
}

function treeLine(ctx: OutCtx, pts: Pt[], depth: number, h: [number, number], spacing: number, kind: "pine" | "broad" | "mixed", key: string): ReactNode {
	const { rng } = ctx;
	const c = col(ctx, depth, ctx.kind === "swamp" ? "#3a4630" : "#2a4428");
	const k = ink(c, ctx.light);
	const trees: ReactNode[] = [];
	for (let x = -30; x < 1640; x += spacing * rng.range(0.6, 1.3)) {
		const y = ridgeY(pts, x) + 6;
		const th = rng.range(h[0], h[1]);
		const isPine = kind === "pine" || (kind === "mixed" && rng.next() < 0.55);
		trees.push(isPine ? pine(`${key}${x}`, x, y, th, k, rng, ctx.snow) : broadTree(`${key}${x}`, x, y, th, k, rng, shade(c, -0.1)));
	}
	return <g key={key}>{rimmed(pts, c, ctx.light, 0, `${key}g`)}{trees}</g>;
}

function seaPlane(ctx: OutCtx, y: number): ReactNode {
	const { pal, rng } = ctx;
	const top = mix(pal.horizon, "#2a5a7a", pal.night ? 0.5 : 0.35);
	const bottom = mix(pal.zenith, "#0a2a3a", 0.6);
	const lines = Array.from({ length: 34 }, (_, i) => {
		const t = i / 34;
		const ly = y + 4 + t * t * (H - y);
		const x = rng.range(0, 1600);
		const w = 30 + t * 220;
		return <path key={i} d={`M${r1(x - w)} ${r1(ly)}h${r1(w * 2)}`} stroke={mix(pal.horizon, "#ffffff", 0.3)} strokeOpacity={0.12 + t * 0.15} strokeWidth={1 + t * 3} strokeLinecap="round" />;
	});
	return (
		<g>
			<defs>
				<linearGradient id={gid("sea")} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor={top} />
					<stop offset="1" stopColor={bottom} />
				</linearGradient>
			</defs>
			<rect x={0} y={y} width={1600} height={H - y} fill={u("sea")} />
			{pal.lightVisible && (
				<path d={`M${ctx.sunX - 30} ${y}L${ctx.sunX + 30} ${y}L${ctx.sunX + 260} ${H}L${ctx.sunX - 260} ${H}Z`} fill={u("sunpath")} opacity={pal.night ? 0.35 : 0.55} className="dh-shimmer" />
			)}
			<g className="dh-waves">{lines}</g>
			<path d={`M0 ${y}H1600`} stroke={mix(pal.horizon, "#ffffff", 0.4)} strokeOpacity={0.5} strokeWidth={1.5} />
		</g>
	);
}

export function buildOutdoor(ctx: OutCtx): Layers {
	const { rng, pal, kind } = ctx;
	const rimO = pal.night ? 0.12 : 0.3;
	switch (kind) {
		case "forest":
		case "camp": {
			const midPts = ridge(rng, { y: 600, amp: 30, freq: 2 });
			const nearPts = ridge(rng, { y: 770, amp: 25, freq: 1.5 });
			const nearC = col(ctx, 0.15);
			const fgC = shade(col(ctx, 0, "#1e2e1a"), -0.12);
			const fgK = { ...ink(fgC, ctx.light), lit: shade(fgC, 0.04) };
			const clearing = kind === "camp";
			const nearTrees: ReactNode[] = [];
			for (let x = -40; x < 1640; x += rng.range(80, 140)) {
				if (clearing && x > 380 && x < 1220) continue;
				if (!clearing && x > 600 && x < 1000 && rng.next() < 0.7) continue;
				const k = ink(col(ctx, 0.16, "#22402a"), ctx.light);
				nearTrees.push(rng.next() < 0.6 ? pine(`n${x}`, x, ridgeY(nearPts, x) - 40, rng.range(300, 460), k, rng, ctx.snow) : broadTree(`n${x}`, x, ridgeY(nearPts, x) - 40, rng.range(260, 380), k, rng, shade(k.c, -0.1)));
			}
			return {
				far: <g>{farMountains(ctx, 450, 90)}{treeLine(ctx, ridge(rng, { y: 540, amp: 20, freq: 3 }), 0.7, [60, 110], 22, "pine", "tl1")}</g>,
				mid: (
					<g>
						{treeLine(ctx, midPts, 0.5, [120, 210], 34, "mixed", "tl2")}
						{ctx.pal.lightVisible && !ctx.pal.night && (
							<g style={{ mixBlendMode: "screen" }} opacity={0.45}>
								{[0, 1, 2, 3].map((i) => {
									const x = ctx.sunX + 120 + i * rng.range(90, 160);
									const w = rng.range(30, 90);
									return <path key={i} d={`M${r1(x)} -20L${r1(x + w)} -20L${r1(x + w + 420)} 900L${r1(x + 300)} 900Z`} fill={u("shaft")} className={i % 2 ? "dh-shaft" : "dh-shaft2"} />;
								})}
							</g>
						)}
					</g>
				),
				near: (
					<g>
						{nearTrees}
						{rimmed(nearPts, nearC, ctx.light, rimO * 0.6, "ng")}
						{grassTufts("gt", -20, 1620, (x) => ridgeY(nearPts, x), shade(nearC, 0.05), rng, 0.05, 18)}
						{[...Array(5)].map((_, i) => rock(`r${i}`, rng.range(100, 1500), ridgeY(nearPts, 800) + rng.range(30, 90), rng.range(14, 30), ink(col(ctx, 0.1, "#6a6a66"), ctx.light), rng))}
					</g>
				),
				fg: (
					<g>
						{pine("fpl", 60, 1000, 900, fgK, rng, ctx.snow)}
						{pine("fpr", 1560, 1020, 960, fgK, rng, ctx.snow)}
						{rng.next() < 0.5 && pine("fpl2", 250, 1040, 620, fgK, rng, ctx.snow)}
						{bush("b1", 300, 915, 80, fgK, rng)}
						{bush("b2", 1330, 915, 90, fgK, rng)}
						{grassTufts("fgg", -20, 1620, () => 905, fgC, rng, 0.06, 50)}
						{Array.from({ length: 14 }, (_, i) => (
							<circle key={i} cx={r1(rng.range(200, 1400))} cy={r1(rng.range(820, 890))} r={r1(rng.range(2, 4))} fill={rng.pick(["#f0e0a0", "#e0a0c0", "#ffffff", "#a0c0f0"])} opacity={0.8 - ctx.pal.dark * 0.6} />
						))}
					</g>
				),
				groundAt: (x) => ridgeY(nearPts, x) + 60,
				propScale: 0.95,
			};
		}
		case "plains":
		case "road": {
			const midPts = ridge(rng, { y: 600, amp: 40, freq: 1.6, octaves: 3 });
			const nearPts = ridge(rng, { y: 740, amp: 30, freq: 1.2, octaves: 3 });
			const midC = col(ctx, 0.4);
			const nearC = col(ctx, 0.12);
			const lone = rng.range(250, 1350);
			const road = kind === "road";
			const roadC = col(ctx, 0.1, "#8a7a5a");
			const rx = rng.range(700, 900);
			return {
				far: <g>{farMountains(ctx, 470, 70)}{treeLine(ctx, ridge(rng, { y: 560, amp: 12, freq: 3 }), 0.75, [30, 60], 40, "broad", "tl1")}</g>,
				mid: (
					<g>
						{rimmed(midPts, midC, ctx.light, rimO, "mg")}
						{broadTree("lone", lone, ridgeY(midPts, lone) + 6, 150, ink(col(ctx, 0.4, "#24402a"), ctx.light), rng, shade(midC, -0.2))}
						{!road && (
							<g transform={`translate(${r1(1600 - lone)} ${r1(ridgeY(midPts, 1600 - lone))})`}>
								<path d="M-14 0L-9 -90H9L14 0Z" fill={shade(midC, -0.1)} />
								<path d="M-10 -86L0 -104L10 -86Z" fill={shade(midC, -0.2)} />
								<g className="dh-spin" style={{ transformOrigin: "0px -88px", transformBox: "view-box" }}>
									{[0, 90, 180, 270].map((a) => <rect key={a} x={-3} y={-150} width={10} height={60} fill={shade(midC, -0.15)} transform={`rotate(${a} 0 -88)`} />)}
								</g>
							</g>
						)}
					</g>
				),
				near: (
					<g>
						{rimmed(nearPts, nearC, ctx.light, rimO * 0.7, "ng")}
						{road && (
							<path d={`M${rx - 6} ${r1(ridgeY(midPts, rx))}C${rx + 120} 680 ${rx - 260} 760 ${rx - 120} 900H${rx + 260}C${rx + 80} 760 ${rx + 160} 680 ${rx + 6} ${r1(ridgeY(midPts, rx))}Z`} fill={roadC} />
						)}
						{road && Array.from({ length: 7 }, (_, i) => {
							const t = i / 6;
							const px = rx + 280 + t * 520;
							const py = 720 + t * 160;
							return <rect key={i} x={r1(px)} y={r1(py - 30 - t * 40)} width={r1(5 + t * 6)} height={r1(30 + t * 40)} fill={shade(nearC, -0.25)} />;
						})}
						{grassTufts("gt", -20, 1620, (x) => ridgeY(nearPts, x), shade(nearC, 0.08), rng, 0.06, 20)}
					</g>
				),
				fg: (
					<g>
						{grassTufts("fg1", -20, 360, () => 905, shade(nearC, -0.25), rng, 0.25, 90)}
						{grassTufts("fg2", 1260, 1620, () => 905, shade(nearC, -0.25), rng, 0.25, 90)}
					</g>
				),
				groundAt: (x) => ridgeY(nearPts, x) + 70,
				propScale: 0.9,
			};
		}
		case "mountain": {
			const midPts = ridge(rng, { y: 600, amp: 170, freq: 2.6, sharp: 0.85, step: 8 });
			const nearPts = ridge(rng, { y: 760, amp: 50, freq: 1.4, sharp: 0.3 });
			const midC = col(ctx, 0.45, "#5a606c");
			const nearC = col(ctx, 0.12, "#4a4e56");
			const peakY = Math.min(...midPts.map(([, y]) => y));
			return {
				far: farMountains(ctx, 380, 180, true),
				mid: (
					<g>
						<path d={ridgePath(midPts)} fill={midC} />
						<clipPath id={gid("midsnow")}><rect x={0} y={0} width={1600} height={r1(peakY + 60)} /></clipPath>
						<path d={ridgePath(midPts)} fill={mix("#f4f8fc", ctx.pal.haze, 0.3)} clipPath={u("midsnow")} />
						<path d={ridgeShadows(midPts, -1, 0.7)} fill={shade(midC, -0.16)} opacity={0.6} />
						<path d={ridgeLine(midPts)} stroke={ctx.light} strokeOpacity={rimO} strokeWidth={2.5} fill="none" />
						{treeLine(ctx, ridge(rng, { y: 690, amp: 20, freq: 2 }), 0.35, [50, 90], 26, "pine", "tl")}
					</g>
				),
				near: (
					<g>
						{rimmed(nearPts, nearC, ctx.light, rimO, "ng")}
						{[...Array(6)].map((_, i) => rock(`r${i}`, rng.range(80, 1520), ridgeY(nearPts, 800) + rng.range(20, 110), rng.range(20, 50), ink(shade(nearC, 0.04), ctx.light), rng))}
					</g>
				),
				fg: (
					<g>
						<path d={`M-20 900V560L60 520L140 600L200 640L260 760L340 900Z`} fill={shade(nearC, -0.2)} />
						<path d={`M-20 560L60 520L140 600L90 610Z`} fill={mix(shade(nearC, -0.2), ctx.light, 0.2)} />
						<path d={`M1620 900V600L1520 580L1440 660L1380 780L1300 900Z`} fill={shade(nearC, -0.2)} />
						{pine("fp", 1500, 640, 300, ink(shade(nearC, -0.25), ctx.light), rng, ctx.snow)}
					</g>
				),
				groundAt: (x) => ridgeY(nearPts, x) + 60,
				propScale: 0.85,
			};
		}
		case "coast":
		case "ship": {
			const seaY = 560;
			const isShip = kind === "ship";
			const cliffSide = rng.next() < 0.5 ? -1 : 1;
			const nearC = col(ctx, 0.12, "#6a6a52");
			const wood = landColor("#5a3a22", ctx.pal, 0);
			const sailC = landColor("#d8ccb0", ctx.pal, 0.05);
			const head: Pt[] = cliffSide < 0
				? [[-20, 420], [120, 430], [260, 470], [360, 530], [420, seaY + 4]]
				: [[1620, 420], [1480, 430], [1340, 470], [1240, 530], [1180, seaY + 4]];
			const lhX = cliffSide < 0 ? 160 : 1440;
			return {
				far: (
					<g>
						{!isShip && <path d={`M${head.map(([x, y]) => `${x} ${y}`).join("L")}L${cliffSide < 0 ? -20 : 1620} ${seaY + 4}Z`} fill={col(ctx, 0.55, "#5a5a50")} />}
						{!isShip && tower("lh", lhX, 432, 26, 110, col(ctx, 0.5, "#c8c0b0"), ctx.light, col(ctx, 0.5, "#8a2a2a"), ctx.windowsLit ? "#ffe08a" : null)}
						{isShip && <path d={`M${rng.range(200, 500)} ${seaY}q60 -40 140 -30q60 -20 120 30Z`} fill={col(ctx, 0.8, "#4a5a4a")} />}
					</g>
				),
				mid: seaPlane(ctx, seaY),
				near: isShip ? (
					<g>
						{/* distant sail */}
						<g transform={`translate(${r1(rng.range(1000, 1300))} ${seaY + 10})`} opacity={0.7}>
							<path d="M-40 0Q0 14 40 0L34 -10H-34Z" fill={col(ctx, 0.6, "#3a2a1a")} />
							<path d="M0 -10V-90L34 -18Z M-4 -14V-80L-30 -16Z" fill={col(ctx, 0.5, "#e8e0d0")} />
						</g>
					</g>
				) : (
					<g>
						<path d={`M-20 900V690Q300 650 600 700T1200 730Q1450 720 1620 760V900Z`} fill={col(ctx, 0.15, "#c8b080")} />
						<path d={`M-20 692Q300 652 600 702T1200 732Q1450 722 1620 762`} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={3} fill="none" className="dh-surf" />
						{grassTufts("dune", -20, 500, (x) => 690 - x * 0.02, shade(nearC, -0.05), rng, 0.08, 30)}
					</g>
				),
				fg: isShip ? (
					<g>
						{/* deck */}
						<path d="M-20 900V800Q800 770 1620 800V900Z" fill={wood} />
						{Array.from({ length: 8 }, (_, i) => <path key={i} d={`M-20 ${812 + i * 12}Q800 ${784 + i * 13} 1620 ${812 + i * 12}`} stroke={shade(wood, -0.2)} strokeWidth={1.5} fill="none" />)}
						{/* railing */}
						<path d="M-20 720Q800 690 1620 720" stroke={shade(wood, 0.08)} strokeWidth={14} fill="none" />
						<path d="M-20 712Q800 682 1620 712" stroke={mix(wood, ctx.light, 0.3)} strokeWidth={3} fill="none" />
						{Array.from({ length: 17 }, (_, i) => {
							const x = -20 + i * 102;
							return <rect key={i} x={x} y={712 - Math.sin((i / 16) * Math.PI) * 30} width={12} height={92} fill={shade(wood, -0.1)} />;
						})}
						{/* mast & rigging */}
						<rect x={1290} y={-20} width={34} height={840} fill={shade(wood, -0.05)} />
						<rect x={1290} y={-20} width={10} height={840} fill={mix(wood, ctx.light, 0.25)} />
						<path d="M1307 60L1620 400M1307 60L1100 712M1307 200L900 712M1307 60L1620 250" stroke="#1a120c" strokeWidth={2.5} opacity={0.8} />
						{Array.from({ length: 6 }, (_, i) => <path key={i} d={`M${1100 + i * 40} ${712 - i * 108}h${70 - i * 10}`} stroke="#1a120c" strokeWidth={2} />)}
						<path d="M1324 40Q1500 160 1480 420L1324 440Z" fill={sailC} className="dh-sail" style={{ transformOrigin: "1324px 240px", transformBox: "view-box" }} />
						<path d="M1324 40Q1400 200 1390 430L1324 440Z" fill={shade(sailC, -0.12)} />
						{ctx.windowsLit && lantern("ln", 1260, 520, 40, 1.4)}
						{/* barrels & coil */}
						<ellipse cx={240} cy={860} rx={70} ry={18} fill={shade(wood, -0.25)} />
						<ellipse cx={240} cy={852} rx={52} ry={12} fill="none" stroke="#a08a5a" strokeWidth={6} />
						<ellipse cx={240} cy={852} rx={30} ry={7} fill="none" stroke="#a08a5a" strokeWidth={5} />
					</g>
				) : (
					<g>
						{rock("r1", 1400, 900, 120, ink(shade(nearC, -0.3), ctx.light), rng)}
						{rock("r2", 120, 910, 80, ink(shade(nearC, -0.3), ctx.light), rng)}
						{grassTufts("fg", 1280, 1620, () => 840, shade(nearC, -0.3), rng, 0.2, 70)}
					</g>
				),
				groundAt: (x) => (isShip ? 860 : 760 + (x / 1600) * 50),
				propScale: isShip ? 0.9 : 0.85,
			};
		}
		case "swamp": {
			const waterY = 640;
			const farPts = ridge(rng, { y: 600, amp: 18, freq: 3 });
			const islands = ridge(rng, { y: 660, amp: 26, freq: 2.5 });
			const dead = landColor("#2a2a20", ctx.pal, 0.35);
			const deadNear = landColor("#1c1c14", ctx.pal, 0.05);
			const water = mix(landColor("#2c3a24", ctx.pal, 0.2), ctx.pal.horizon, 0.25);
			return {
				far: <g>{farMountains(ctx, 500, 50)}{treeLine(ctx, farPts, 0.7, [50, 100], 30, "broad", "tl")}</g>,
				mid: (
					<g>
						<rect x={0} y={waterY} width={1600} height={260} fill={water} />
						<rect x={0} y={waterY} width={1600} height={260} fill={u("waterfade")} />
						{Array.from({ length: 22 }, (_, i) => <path key={i} d={`M${r1(rng.range(0, 1600))} ${r1(waterY + 10 + i * 11)}h${r1(rng.range(40, 140))}`} stroke={ctx.pal.horizon} strokeOpacity={0.2} strokeWidth={2} className="dh-shimmer" />)}
						<path d={ridgePath(islands, waterY + 70)} fill={landColor("#2c3a22", ctx.pal, 0.3)} />
						{[...Array(7)].map((_, i) => deadTree(`d${i}`, rng.range(80, 1520), waterY + rng.range(10, 40), rng.range(140, 260), dead, rng))}
					</g>
				),
				near: (
					<g>
						{[...Array(4)].map((_, i) => deadTree(`dn${i}`, [180, 520, 1150, 1420][i] + rng.range(-40, 40), 800 + rng.range(0, 40), rng.range(280, 420), deadNear, rng))}
						{grassTufts("reed", 0, 1600, () => 800 + rng.range(-10, 30), landColor("#3a4424", ctx.pal, 0.05), rng, 0.04, 70)}
						<g opacity={0.9}>
							{Array.from({ length: 10 }, (_, i) => (
								<ellipse key={i} cx={r1(rng.range(200, 1400))} cy={r1(rng.range(720, 860))} rx={r1(rng.range(16, 34))} ry={r1(rng.range(4, 8))} fill={landColor("#4a6a2a", ctx.pal, 0.1)} />
							))}
						</g>
					</g>
				),
				fg: (
					<g>
						{grassTufts("fg1", -20, 380, () => 905, deadNear, rng, 0.3, 160)}
						{grassTufts("fg2", 1240, 1620, () => 905, deadNear, rng, 0.3, 160)}
						{[60, 140, 1480, 1530].map((x, i) => (
							<g key={i}>
								<path d={`M${x} 905Q${x + 6} 760 ${x + 2} ${640 + i * 20}`} stroke={deadNear} strokeWidth={3} fill="none" />
								<rect x={x - 4} y={640 + i * 20} width={10} height={40} rx={5} fill={landColor("#3a2414", ctx.pal, 0)} />
							</g>
						))}
					</g>
				),
				groundAt: () => 830,
				propScale: 0.85,
			};
		}
		case "desert": {
			const mesaPts: Pt[] = [];
			const mx = rng.range(200, 1200);
			mesaPts.push([mx - 100, 560], [mx - 60, 440], [mx + 220, 440], [mx + 270, 560]);
			const dune1 = ridge(rng, { y: 620, amp: 50, freq: 1.4, octaves: 2 });
			const dune2 = ridge(rng, { y: 740, amp: 60, freq: 1.1, octaves: 2 });
			const sand = (d: number) => col(ctx, d, "#d0a868");
			const shadowSand = (d: number) => shade(col(ctx, d, "#b8885a"), -0.08);
			return {
				far: (
					<g>
						{farMountains(ctx, 520, 50)}
						<path d={`M${mesaPts.map(([x, y]) => `${r1(x)} ${y}`).join("L")}Z`} fill={col(ctx, 0.65, "#b0704a")} />
						<path d={`M${r1(mx - 60)} 440H${r1(mx + 220)}`} stroke={ctx.light} strokeOpacity={0.4} strokeWidth={3} />
						{[0, 1, 2].map((i) => <path key={i} d={`M${r1(mx - 70 + i * 4)} ${470 + i * 30}H${r1(mx + 230 + i * 12)}`} stroke={col(ctx, 0.6, "#8a5030")} strokeWidth={2} opacity={0.5} />)}
					</g>
				),
				mid: (
					<g>
						<path d={ridgePath(dune1)} fill={sand(0.35)} />
						<path d={ridgeShadows(dune1, -1, 0.5)} fill={shadowSand(0.35)} opacity={0.7} />
						<path d={ridgeLine(dune1)} stroke={ctx.light} strokeOpacity={rimO + 0.1} strokeWidth={2.5} fill="none" />
						{/* obelisk ruin */}
						<g transform={`translate(${r1(1600 - mx)} ${r1(ridgeY(dune1, 1600 - mx) + 10)})`}>
							<path d="M-16 0L-11 -150L0 -168L11 -150L16 0Z" fill={col(ctx, 0.35, "#8a7458")} />
							<path d="M-16 0L-11 -150L0 -168L0 0Z" fill={mix(col(ctx, 0.35, "#8a7458"), ctx.light, 0.3)} />
						</g>
					</g>
				),
				near: (
					<g>
						<path d={ridgePath(dune2)} fill={sand(0.1)} />
						<path d={ridgeShadows(dune2, -1, 0.5)} fill={shadowSand(0.1)} opacity={0.65} />
						<path d={ridgeLine(dune2)} stroke={ctx.light} strokeOpacity={rimO + 0.15} strokeWidth={3} fill="none" />
						{Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${r1(rng.range(0, 1500))} ${r1(rng.range(790, 880))}q40 -6 80 0`} stroke={shade(sand(0.1), -0.1)} strokeWidth={2} fill="none" opacity={0.6} />)}
					</g>
				),
				fg: (
					<g>
						{rock("r1", 120, 905, 90, ink(col(ctx, 0, "#7a5a40"), ctx.light), rng)}
						{rock("r2", 1500, 910, 110, ink(col(ctx, 0, "#7a5a40"), ctx.light), rng)}
						{deadTree("dt", 1420, 830, 160, col(ctx, 0, "#3a2a1a"), rng)}
					</g>
				),
				groundAt: (x) => ridgeY(dune2, x) + 70,
				propScale: 0.9,
			};
		}
		case "town": {
			const hillPts = ridge(rng, { y: 560, amp: 30, freq: 1.5 });
			const wallC = (d: number) => col(ctx, d, "#a89070");
			const roofC = (d: number) => col(ctx, d, rng.pick(["#7a3a2a", "#5a4a40", "#4a3a3a", "#8a4a2a"]));
			const glowC = "#ffc060";
			const midHouses: ReactNode[] = [];
			for (let x = -20; x < 1640; x += rng.range(70, 110)) {
				const w = rng.range(60, 100);
				midHouses.push(house(`m${x}`, x, 640 + rng.range(-8, 8), { w, h: rng.range(50, 90), roofH: rng.range(30, 55), wall: wallC(0.45), roof: roofC(0.45), lit: ctx.light, windowsLit: ctx.windowsLit && rng.next() < 0.7, windowGlow: glowC, chimney: rng.next() < 0.5, snow: ctx.snow }, rng));
			}
			const spireX = rng.range(500, 1100);
			const nearHouses: ReactNode[] = [];
			[[-10, 260], [1350, 290]].forEach(([x, w], i) => {
				nearHouses.push(house(`n${i}`, x + w / 2, 830, { w, h: 230, roofH: 120, wall: wallC(0.08), roof: roofC(0.08), lit: ctx.light, windowsLit: ctx.windowsLit, windowGlow: glowC, chimney: true, timber: true, snow: ctx.snow }, rng));
			});
			const street = col(ctx, 0.12, "#7a7060");
			return {
				far: (
					<g>
						{farMountains(ctx, 470, 80)}
						<path d={ridgePath(hillPts)} fill={col(ctx, 0.6)} />
						<g transform={`translate(${r1(rng.range(100, 400))} ${r1(ridgeY(hillPts, 250) + 4)})`}>
							{tower("ct1", 0, 0, 30, 90, col(ctx, 0.6, "#8a8480"), ctx.light, null, ctx.windowsLit ? glowC : null)}
							<rect x={10} y={-60} width={110} height={60} fill={col(ctx, 0.6, "#8a8480")} />
							{tower("ct2", 130, 0, 36, 120, col(ctx, 0.6, "#8a8480"), ctx.light, col(ctx, 0.6, "#3a3a50"), ctx.windowsLit ? glowC : null)}
						</g>
					</g>
				),
				mid: (
					<g>
						{tower("spire", spireX, 640, 40, 160, wallC(0.45), ctx.light, roofC(0.45), ctx.windowsLit ? glowC : null)}
						{midHouses}
					</g>
				),
				near: (
					<g>
						<path d="M-20 900V720Q800 690 1620 720V900Z" fill={street} />
						{Array.from({ length: 60 }, (_, i) => {
							const row = Math.floor(i / 12);
							const x = (i % 12) * 140 + (row % 2) * 70 + rng.range(-10, 10);
							const y = 740 + row * 34;
							return <ellipse key={i} cx={r1(x)} cy={r1(y)} rx={r1(40 + row * 6)} ry={r1(8 + row * 2)} fill={shade(street, i % 3 ? 0.04 : -0.06)} opacity={0.7} />;
						})}
						{nearHouses}
						{ctx.windowsLit ? lantern("sl", 1180, 690, 0, 1.2) : null}
						<rect x={1176} y={690} width={8} height={170} fill={shade(street, -0.4)} />
					</g>
				),
				fg: <g />,
				groundAt: (x) => 800 + Math.abs(x - 800) * 0.02,
				propScale: 0.85,
			};
		}
		case "castle":
		default: {
			const hillPts = ridge(rng, { y: 620, amp: 60, freq: 1.2, octaves: 3 });
			const cx = rng.range(600, 1000);
			const cy = Math.min(...hillPts.filter(([x]) => Math.abs(x - cx) < 200).map(([, y]) => y)) + 10;
			const wall = col(ctx, 0.4, "#8a8278");
			const roof = col(ctx, 0.4, "#3a3c58");
			const glowC = ctx.windowsLit ? "#ffc060" : null;
			const nearPts = ridge(rng, { y: 790, amp: 30, freq: 1.3 });
			return {
				far: farMountains(ctx, 440, 120, true),
				mid: (
					<g>
						<path d={ridgePath(hillPts)} fill={col(ctx, 0.45)} />
						<path d={ridgeLine(hillPts)} stroke={ctx.light} strokeOpacity={rimO} strokeWidth={2} fill="none" />
						<rect x={r1(cx - 220)} y={r1(cy - 90)} width={440} height={100} fill={wall} />
						{Array.from({ length: 22 }, (_, i) => <rect key={i} x={r1(cx - 220 + i * 20)} y={r1(cy - 102)} width={10} height={12} fill={wall} />)}
						<rect x={r1(cx - 220)} y={r1(cy - 90)} width={130} height={100} fill={ctx.light} opacity={0.12} />
						{tower("t1", cx - 220, cy + 10, 56, 170, wall, ctx.light, roof, glowC)}
						{tower("t2", cx + 220, cy + 10, 56, 170, wall, ctx.light, roof, glowC)}
						{tower("keep", cx + 20, cy - 80, 120, 170, wall, ctx.light, null, glowC)}
						{tower("t3", cx - 60, cy - 80, 50, 240, wall, ctx.light, roof, glowC)}
						<path d={`M${r1(cx - 22)} ${r1(cy + 10)}v-50a22 22 0 0 1 44 0v50Z`} fill={shade(wall, -0.4)} />
						{[cx - 220, cx + 220, cx - 60].map((tx, i) => (
							<g key={i} className="dh-banner" style={{ transformOrigin: `${r1(tx)}px ${r1(cy - (i === 2 ? 380 : 300))}px`, transformBox: "view-box" }}>
								<path d={`M${r1(tx)} ${r1(cy - (i === 2 ? 380 : 300))}v-30h34l-10 8l10 8h-34Z`} fill={col(ctx, 0.3, "#9a1e22")} />
								<path d={`M${r1(tx)} ${r1(cy - (i === 2 ? 350 : 270))}v-60`} stroke={shade(wall, -0.4)} strokeWidth={2} />
							</g>
						))}
						{treeLine(ctx, ridge(rng, { y: 700, amp: 20, freq: 2.5 }), 0.3, [60, 110], 30, "mixed", "tl")}
					</g>
				),
				near: (
					<g>
						{rimmed(nearPts, col(ctx, 0.12), ctx.light, rimO * 0.6, "ng")}
						<path d={`M${r1(cx - 10)} 700C${r1(cx + 80)} 780 ${r1(cx - 200)} 840 ${r1(cx - 120)} 900H${r1(cx + 120)}C${r1(cx + 40)} 840 ${r1(cx + 160)} 760 ${r1(cx + 10)} 700Z`} fill={col(ctx, 0.12, "#8a7a5a")} />
						{grassTufts("gt", -20, 1620, (x) => ridgeY(nearPts, x), col(ctx, 0.1), rng, 0.05, 20)}
					</g>
				),
				fg: (
					<g>
						{pine("fp1", 80, 960, 520, ink(col(ctx, 0, "#152015"), ctx.light), rng, ctx.snow)}
						{pine("fp2", 1520, 980, 600, ink(col(ctx, 0, "#152015"), ctx.light), rng, ctx.snow)}
					</g>
				),
				groundAt: (x) => ridgeY(nearPts, x) + 60,
				propScale: 0.85,
			};
		}
	}
}
