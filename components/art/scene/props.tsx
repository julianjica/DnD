import type { ReactNode } from "react";
import { mix, shade } from "@/lib/art/color";
import type { SceneProp, SkyPalette } from "@/lib/art/scene";
import { ArtRng, r1 } from "@/lib/art/rand";
import { flame, glow, lantern, torch } from "./elements";
import { u } from "./geom";

export interface PropCtx {
	rng: ArtRng;
	pal: SkyPalette;
	/** Light color for lit facets. */
	light: string;
	/** Darkness 0..1 (how much props are in shadow). */
	dark: number;
	interior: boolean;
}

/** Tints a material by the scene's darkness. */
function m(c: string, ctx: PropCtx): string {
	return mix(c, ctx.pal.night ? "#05070e" : "#140c14", ctx.dark * 0.65);
}

function stone(ctx: PropCtx) {
	const c = m("#7a7670", ctx);
	return { c, lit: mix(c, ctx.light, 0.3), dark: shade(c, -0.15), line: shade(c, -0.3) };
}
function wood(ctx: PropCtx) {
	const c = m("#6a4528", ctx);
	return { c, lit: mix(c, ctx.light, 0.25), dark: shade(c, -0.15), line: shade(c, -0.3) };
}

/** Draw one prop with its base centered at (x, y), scale s (1 ≈ human-sized at the foreground). */
export function drawProp(prop: SceneProp, key: string, x: number, y: number, s: number, ctx: PropCtx): ReactNode {
	const { rng } = ctx;
	const S = (n: number) => r1(n * s);
	const shadow = <ellipse cx={x} cy={y} rx={S(70)} ry={S(10)} fill="#000" opacity={0.3} />;
	switch (prop) {
		case "campfire": {
			const w = wood(ctx);
			return (
				<g key={key}>
					{glow("g1", x, y - S(30), S(420), "fire", 0.55, "dh-glow")}
					{glow("g2", x, y - S(20), S(160), "warm", 0.6, "dh-glow2")}
					<ellipse cx={x} cy={y} rx={S(70)} ry={S(14)} fill="#ff9a3a" opacity={0.18} className="dh-glow" />
					{Array.from({ length: 9 }, (_, i) => {
						const a = (i / 9) * Math.PI * 2;
						return <ellipse key={i} cx={r1(x + Math.cos(a) * S(44))} cy={r1(y + Math.sin(a) * S(9))} rx={S(11)} ry={S(7)} fill={stone(ctx).c} stroke={stone(ctx).line} strokeWidth={1} />;
					})}
					<path d={`M${x - S(40)} ${y - S(2)}L${x + S(30)} ${y - S(18)}L${x + S(34)} ${y - S(8)}L${x - S(36)} ${y + S(8)}Z`} fill={w.c} />
					<path d={`M${x + S(40)} ${y - S(2)}L${x - S(30)} ${y - S(18)}L${x - S(34)} ${y - S(8)}L${x + S(36)} ${y + S(8)}Z`} fill={w.dark} />
					<ellipse cx={x} cy={y - S(6)} rx={S(26)} ry={S(7)} fill="#ff5a10" opacity={0.85} />
					{flame("f1", x - S(10), y - S(8), S(18), "dh-flame")}
					{flame("f2", x + S(10), y - S(6), S(15), "dh-flame2")}
					{flame("f3", x, y - S(6), S(24), "dh-flame3")}
					<g className="dh-sparks">
						{Array.from({ length: 8 }, (_, i) => (
							<circle key={i} cx={r1(x + rng.range(-24, 24) * s)} cy={r1(y - S(60) - rng.range(0, 90) * s)} r={r1(rng.range(1, 2.4))} fill="#ffd27a" style={{ animationDelay: `${r1(rng.range(0, 3))}s` }} />
						))}
					</g>
				</g>
			);
		}
		case "torches":
			return (
				<g key={key}>
					{torch("a", x - S(90), y, s)}
					{torch("b", x + S(90), y, s)}
				</g>
			);
		case "lanterns":
			return (
				<g key={key}>
					<path d={`M${x - S(260)} ${y - S(260)}Q${x} ${y - S(200)} ${x + S(260)} ${y - S(260)}`} stroke="#1a1410" strokeWidth={2} fill="none" />
					{[-0.75, -0.25, 0.25, 0.75].map((t, i) => lantern(i, x + t * S(260), y - S(222) + Math.abs(t) * S(-30) + S(18), S(10), s * 0.8, ["#ffb050", "#ff7a6a", "#ffd070", "#9ad0ff"][i], i === 3 ? "cold" : "warm"))}
				</g>
			);
		case "altar": {
			const st = stone(ctx);
			return (
				<g key={key}>
					{shadow}
					{glow("g", x, y - S(120), S(220), ctx.interior ? "gold" : "warm", 0.35, "dh-glow-slow")}
					<path d={`M${x - S(80)} ${y}L${x - S(70)} ${y - S(70)}H${x + S(70)}L${x + S(80)} ${y}Z`} fill={st.c} />
					<path d={`M${x - S(80)} ${y}L${x - S(70)} ${y - S(70)}H${x - S(30)}L${x - S(36)} ${y}Z`} fill={st.lit} opacity={0.6} />
					<rect x={x - S(92)} y={y - S(84)} width={S(184)} height={S(16)} fill={st.lit} stroke={st.line} strokeWidth={1.5} />
					<path d={`M${x - S(40)} ${y - S(84)}H${x + S(40)}V${y - S(30)}L${x} ${y - S(16)}L${x - S(40)} ${y - S(30)}Z`} fill={m("#7a1e22", ctx)} />
					<path d={`M${x} ${y - S(74)}v${S(36)}M${x - S(10)} ${y - S(62)}h${S(20)}`} stroke="#d8b050" strokeWidth={S(3)} />
					{[-70, 70].map((dx) => (
						<g key={dx}>
							<rect x={x + S(dx) - S(4)} y={y - S(106)} width={S(8)} height={S(22)} fill="#efe6cc" />
							{flame(`f${dx}`, x + S(dx), y - S(106), S(5), "dh-flame2")}
							{glow(`g${dx}`, x + S(dx), y - S(112), S(50), "warm", 0.6)}
						</g>
					))}
				</g>
			);
		}
		case "statue": {
			const st = stone(ctx);
			return (
				<g key={key}>
					{shadow}
					<rect x={x - S(46)} y={y - S(60)} width={S(92)} height={S(60)} fill={st.c} stroke={st.line} strokeWidth={1.5} />
					<rect x={x - S(54)} y={y - S(70)} width={S(108)} height={S(12)} fill={st.lit} />
					{/* robed figure holding a sword */}
					<path d={`M${x - S(30)} ${y - S(70)}C${x - S(34)} ${y - S(140)} ${x - S(30)} ${y - S(200)} ${x - S(16)} ${y - S(230)}L${x + S(16)} ${y - S(230)}C${x + S(30)} ${y - S(200)} ${x + S(34)} ${y - S(140)} ${x + S(30)} ${y - S(70)}Z`} fill={st.c} />
					<path d={`M${x - S(30)} ${y - S(70)}C${x - S(34)} ${y - S(140)} ${x - S(30)} ${y - S(200)} ${x - S(16)} ${y - S(230)}L${x - S(4)} ${y - S(230)}C${x - S(10)} ${y - S(170)} ${x - S(12)} ${y - S(120)} ${x - S(8)} ${y - S(70)}Z`} fill={st.lit} opacity={0.6} />
					<circle cx={x} cy={y - S(248)} r={S(17)} fill={st.c} />
					<path d={`M${x - S(14)} ${y - S(252)}a${S(14)} ${S(14)} 0 0 1 ${S(14)} ${S(-12)}v${S(26)}a${S(14)} ${S(14)} 0 0 1 ${S(-14)} ${S(-14)}Z`} fill={st.lit} opacity={0.6} />
					<path d={`M${x} ${y - S(80)}V${y - S(210)}`} stroke={st.lit} strokeWidth={S(5)} />
					<path d={`M${x - S(20)} ${y - S(196)}H${x + S(20)}`} stroke={st.lit} strokeWidth={S(6)} strokeLinecap="round" />
					<path d={`M${x - S(30)} ${y - S(150)}Q${x} ${y - S(140)} ${x + S(30)} ${y - S(150)}M${x - S(28)} ${y - S(110)}Q${x} ${y - S(100)} ${x + S(28)} ${y - S(110)}`} stroke={st.line} strokeWidth={1.5} fill="none" opacity={0.6} />
					<path d={`M${x + S(20)} ${y - S(160)}l${S(8)} ${S(30)}M${x + S(10)} ${y - S(40)}l${S(14)} ${S(-6)}`} stroke={st.line} strokeWidth={1.2} opacity={0.6} />
				</g>
			);
		}
		case "cart": {
			const w = wood(ctx);
			const wheel = (wx: number) => (
				<g key={wx}>
					<circle cx={wx} cy={y - S(32)} r={S(32)} fill="none" stroke={w.dark} strokeWidth={S(7)} />
					{[0, 1, 2, 3].map((i) => <path key={i} d={`M${wx} ${y - S(32)}l${r1(Math.cos((i * Math.PI) / 4) * S(30))} ${r1(Math.sin((i * Math.PI) / 4) * S(30))}M${wx} ${y - S(32)}l${r1(-Math.cos((i * Math.PI) / 4) * S(30))} ${r1(-Math.sin((i * Math.PI) / 4) * S(30))}`} stroke={w.dark} strokeWidth={S(3)} />)}
					<circle cx={wx} cy={y - S(32)} r={S(6)} fill={w.line} />
				</g>
			);
			return (
				<g key={key}>
					{shadow}
					<path d={`M${x - S(150)} ${y - S(52)}L${x - S(220)} ${y - S(30)}`} stroke={w.dark} strokeWidth={S(6)} />
					<rect x={x - S(140)} y={y - S(100)} width={S(220)} height={S(48)} fill={w.c} stroke={w.line} strokeWidth={2} />
					{[0, 1, 2].map((i) => <path key={i} d={`M${x - S(140)} ${y - S(84) + i * S(14)}h${S(220)}`} stroke={w.line} strokeWidth={1} opacity={0.6} />)}
					<rect x={x - S(140)} y={y - S(100)} width={S(220)} height={S(8)} fill={w.lit} />
					<path d={`M${x - S(120)} ${y - S(100)}Q${x - S(30)} ${y - S(190)} ${x + S(60)} ${y - S(100)}Z`} fill={m("#cfc0a0", ctx)} />
					<path d={`M${x - S(120)} ${y - S(100)}Q${x - S(60)} ${y - S(170)} ${x - S(30)} ${y - S(145)}L${x - S(40)} ${y - S(100)}Z`} fill={mix(m("#cfc0a0", ctx), ctx.light, 0.25)} />
					{wheel(x - S(100))}
					{wheel(x + S(40))}
				</g>
			);
		}
		case "tents": {
			const tent = (tx: number, ty: number, ts: number, col: string, k: string) => {
				const c = m(col, ctx);
				return (
					<g key={k}>
						<ellipse cx={tx} cy={ty} rx={ts * 110} ry={ts * 12} fill="#000" opacity={0.25} />
						<path d={`M${tx - ts * 100} ${ty}L${tx} ${ty - ts * 120}L${tx + ts * 100} ${ty}Z`} fill={c} />
						<path d={`M${tx - ts * 100} ${ty}L${tx} ${ty - ts * 120}L${tx - ts * 10} ${ty}Z`} fill={mix(c, ctx.light, 0.25)} />
						<path d={`M${tx - ts * 24} ${ty}L${tx} ${ty - ts * 70}L${tx + ts * 24} ${ty}Z`} fill={shade(c, -0.3)} />
						{ctx.dark > 0.4 && <path d={`M${tx - ts * 20} ${ty}L${tx} ${ty - ts * 60}L${tx + ts * 20} ${ty}Z`} fill="#ffb060" opacity={0.5} className="dh-flicker-slow" />}
						<path d={`M${tx} ${ty - ts * 120}l${-ts * 4} ${-ts * 18}M${tx} ${ty - ts * 120}l${ts * 130} ${ts * 120}M${tx} ${ty - ts * 120}l${-ts * 130} ${ts * 120}`} stroke={shade(c, -0.4)} strokeWidth={1.5} />
					</g>
				);
			};
			return (
				<g key={key}>
					{tent(x - S(160), y - S(30), s * 0.75, "#8a6a40", "t1")}
					{tent(x + S(120), y - S(20), s * 0.85, "#6a3a30", "t2")}
					{tent(x - S(10), y, s, "#a08860", "t3")}
				</g>
			);
		}
		case "barrels":
		case "crates": {
			const w = wood(ctx);
			const barrel = (bx: number, by: number, bs: number, k: string) => (
				<g key={k}>
					<path d={`M${bx - bs * 28} ${by}Q${bx - bs * 36} ${by - bs * 40} ${bx - bs * 28} ${by - bs * 80}H${bx + bs * 28}Q${bx + bs * 36} ${by - bs * 40} ${bx + bs * 28} ${by}Z`} fill={w.c} />
					<path d={`M${bx - bs * 28} ${by}Q${bx - bs * 36} ${by - bs * 40} ${bx - bs * 28} ${by - bs * 80}H${bx - bs * 8}Q${bx - bs * 14} ${by - bs * 40} ${bx - bs * 8} ${by}Z`} fill={w.lit} opacity={0.6} />
					{[0.18, 0.82].map((t) => <path key={t} d={`M${bx - bs * 32} ${by - bs * 80 * t}H${bx + bs * 32}`} stroke={m("#2a2420", ctx)} strokeWidth={bs * 5} />)}
					<ellipse cx={bx} cy={by - bs * 80} rx={bs * 28} ry={bs * 7} fill={w.dark} stroke={w.line} />
				</g>
			);
			const crate = (cx: number, cy: number, cs: number, k: string) => (
				<g key={k}>
					<rect x={cx - cs * 36} y={cy - cs * 66} width={cs * 72} height={cs * 66} fill={w.c} stroke={w.line} strokeWidth={2} />
					<path d={`M${cx - cs * 36} ${cy - cs * 66}L${cx + cs * 36} ${cy}M${cx - cs * 36} ${cy}L${cx + cs * 36} ${cy - cs * 66}`} stroke={w.dark} strokeWidth={cs * 6} />
					<rect x={cx - cs * 36} y={cy - cs * 66} width={cs * 20} height={cs * 66} fill={w.lit} opacity={0.35} />
				</g>
			);
			return prop === "barrels" ? (
				<g key={key}>{shadow}{barrel(x - S(40), y, s, "a")}{barrel(x + S(30), y + S(4), s * 1.05, "b")}{barrel(x - S(6), y - S(80), s * 0.95, "c")}</g>
			) : (
				<g key={key}>{shadow}{crate(x - S(40), y, s, "a")}{crate(x + S(36), y + S(2), s * 0.9, "b")}{crate(x - S(20), y - S(66), s * 0.8, "c")}</g>
			);
		}
		case "chest": {
			const w = wood(ctx);
			return (
				<g key={key}>
					<ellipse cx={x} cy={y} rx={S(60)} ry={S(8)} fill="#000" opacity={0.3} />
					{glow("g", x, y - S(50), S(120), "gold", 0.45, "dh-glow-slow")}
					<rect x={x - S(50)} y={y - S(50)} width={S(100)} height={S(50)} fill={w.c} stroke={w.line} strokeWidth={2} />
					<path d={`M${x - S(50)} ${y - S(50)}Q${x} ${y - S(86)} ${x + S(50)} ${y - S(50)}Z`} fill={w.lit} stroke={w.line} strokeWidth={2} />
					{[-36, 36].map((d) => <path key={d} d={`M${x + S(d)} ${y}V${y - S(62)}`} stroke="#c9a24a" strokeWidth={S(6)} />)}
					<rect x={x - S(7)} y={y - S(56)} width={S(14)} height={S(16)} fill="#d8b050" stroke="#3a2a10" />
				</g>
			);
		}
		case "well": {
			const st = stone(ctx);
			const w = wood(ctx);
			return (
				<g key={key}>
					{shadow}
					<path d={`M${x - S(60)} ${y}V${y - S(56)}H${x + S(60)}V${y}Z`} fill={st.c} />
					{[0, 1, 2].map((r) => Array.from({ length: 4 }, (_, i) => <rect key={`${r}${i}`} x={x - S(60) + i * S(30) + (r % 2) * S(15)} y={y - S(56) + r * S(19)} width={S(30)} height={S(19)} fill="none" stroke={st.line} strokeWidth={1} />))}
					<ellipse cx={x} cy={y - S(56)} rx={S(62)} ry={S(12)} fill={st.lit} />
					<ellipse cx={x} cy={y - S(56)} rx={S(48)} ry={S(8)} fill="#0a0a10" />
					<path d={`M${x - S(52)} ${y - S(56)}V${y - S(150)}M${x + S(52)} ${y - S(56)}V${y - S(150)}`} stroke={w.c} strokeWidth={S(8)} />
					<path d={`M${x - S(72)} ${y - S(140)}L${x} ${y - S(186)}L${x + S(72)} ${y - S(140)}Z`} fill={m("#6a3a2a", ctx)} />
					<path d={`M${x - S(72)} ${y - S(140)}L${x} ${y - S(186)}L${x} ${y - S(140)}Z`} fill={mix(m("#6a3a2a", ctx), ctx.light, 0.25)} />
					<path d={`M${x} ${y - S(130)}V${y - S(80)}`} stroke="#8a7a5a" strokeWidth={1.5} />
					<rect x={x - S(10)} y={y - S(82)} width={S(20)} height={S(16)} fill={w.dark} />
				</g>
			);
		}
		case "signpost": {
			const w = wood(ctx);
			return (
				<g key={key}>
					<rect x={x - S(5)} y={y - S(170)} width={S(10)} height={S(170)} fill={w.c} />
					<path d={`M${x} ${y - S(160)}h${S(90)}l${S(14)} ${S(12)}l${S(-14)} ${S(12)}h${S(-90)}Z`} fill={w.lit} stroke={w.line} />
					<path d={`M${x} ${y - S(124)}h${S(-80)}l${S(-14)} ${S(12)}l${S(14)} ${S(12)}h${S(80)}Z`} fill={w.c} stroke={w.line} />
					<path d={`M${x + S(14)} ${y - S(148)}h${S(60)}M${x - S(70)} ${y - S(112)}h${S(54)}`} stroke={w.line} strokeWidth={2} strokeDasharray="6 3" />
				</g>
			);
		}
		case "banners":
			return (
				<g key={key}>
					{[-140, 140].map((dx, i) => {
						const bx = x + S(dx);
						const col = m(i ? "#2a3a7a" : "#8a1e22", ctx);
						return (
							<g key={dx}>
								<rect x={bx - S(4)} y={y - S(300)} width={S(8)} height={S(300)} fill={m("#2a2018", ctx)} />
								<circle cx={bx} cy={y - S(304)} r={S(7)} fill="#c9a24a" />
								<g className="dh-banner" style={{ transformOrigin: `${r1(bx)}px ${r1(y - S(290))}px`, transformBox: "view-box" }}>
									<path d={`M${bx + S(4)} ${y - S(292)}h${S(70)}v${S(130)}l${S(-35)} ${S(-22)}l${S(-35)} ${S(22)}Z`} fill={col} />
									<path d={`M${bx + S(4)} ${y - S(292)}h${S(24)}v${S(145)}l${S(-24)} ${S(14)}Z`} fill={mix(col, ctx.light, 0.25)} />
									<circle cx={bx + S(39)} cy={y - S(240)} r={S(14)} fill="none" stroke="#d8b050" strokeWidth={S(3)} />
								</g>
							</g>
						);
					})}
				</g>
			);
		case "boat": {
			const w = wood(ctx);
			return (
				<g key={key}>
					<path d={`M${x - S(130)} ${y - S(40)}Q${x - S(110)} ${y + S(6)} ${x - S(40)} ${y + S(8)}H${x + S(70)}Q${x + S(120)} ${y} ${x + S(140)} ${y - S(46)}Z`} fill={w.c} stroke={w.line} strokeWidth={2} />
					<path d={`M${x - S(126)} ${y - S(36)}H${x + S(136)}`} stroke={w.lit} strokeWidth={S(5)} />
					<path d={`M${x - S(110)} ${y - S(20)}Q${x} ${y - S(10)} ${x + S(126)} ${y - S(24)}`} stroke={w.line} strokeWidth={1.5} fill="none" />
					<path d={`M${x - S(40)} ${y - S(40)}l${S(-80)} ${S(-30)}`} stroke={w.dark} strokeWidth={S(4)} />
				</g>
			);
		}
		case "bones":
			return (
				<g key={key} fill={m("#d8d0bc", ctx)}>
					{[-50, 0, 46].map((dx, i) => (
						<g key={dx} transform={`translate(${r1(x + S(dx))} ${r1(y - S(4))}) rotate(${i * 50 - 40}) scale(${s})`}>
							<rect x={-26} y={-3} width={52} height={6} rx={3} />
							<circle cx={-26} cy={-4} r={5} /><circle cx={-26} cy={4} r={5} /><circle cx={26} cy={-4} r={5} /><circle cx={26} cy={4} r={5} />
						</g>
					))}
					<path d={`M${x + S(10)} ${y - S(4)}a${S(20)} ${S(20)} 0 1 1 ${S(36)} 0v${S(8)}h${S(-36)}Z`} />
					<circle cx={x + S(21)} cy={y - S(12)} r={S(5)} fill="#1a1410" />
					<circle cx={x + S(36)} cy={y - S(12)} r={S(5)} fill="#1a1410" />
				</g>
			);
		case "throne": {
			const st = stone(ctx);
			return (
				<g key={key}>
					{shadow}
					<path d={`M${x - S(60)} ${y}V${y - S(240)}L${x} ${y - S(290)}L${x + S(60)} ${y - S(240)}V${y}Z`} fill={st.c} stroke={st.line} strokeWidth={2} />
					<path d={`M${x - S(40)} ${y - S(70)}V${y - S(220)}L${x} ${y - S(250)}L${x + S(40)} ${y - S(220)}V${y - S(70)}Z`} fill={m("#6a1a28", ctx)} />
					<rect x={x - S(80)} y={y - S(90)} width={S(160)} height={S(24)} fill={st.lit} />
					<rect x={x - S(80)} y={y - S(130)} width={S(20)} height={S(130)} fill={st.lit} />
					<rect x={x + S(60)} y={y - S(130)} width={S(20)} height={S(130)} fill={st.c} />
					<circle cx={x} cy={y - S(262)} r={S(9)} fill="#d8b050" />
				</g>
			);
		}
		case "fountain": {
			const st = stone(ctx);
			return (
				<g key={key}>
					{shadow}
					<path d={`M${x - S(120)} ${y}V${y - S(40)}H${x + S(120)}V${y}Z`} fill={st.c} />
					<ellipse cx={x} cy={y - S(40)} rx={S(124)} ry={S(16)} fill={st.lit} />
					<ellipse cx={x} cy={y - S(40)} rx={S(110)} ry={S(11)} fill={m("#3a6a8a", ctx)} />
					<rect x={x - S(10)} y={y - S(130)} width={S(20)} height={S(90)} fill={st.c} />
					<ellipse cx={x} cy={y - S(130)} rx={S(46)} ry={S(9)} fill={st.lit} />
					<path d={`M${x} ${y - S(150)}Q${x - S(40)} ${y - S(170)} ${x - S(60)} ${y - S(46)}M${x} ${y - S(150)}Q${x + S(40)} ${y - S(170)} ${x + S(60)} ${y - S(46)}`} stroke="#bfe6ff" strokeWidth={S(3)} fill="none" opacity={0.7} className="dh-shimmer" />
				</g>
			);
		}
		case "gravestones": {
			const st = stone(ctx);
			return (
				<g key={key}>
					{[-170, -60, 50, 160].map((dx, i) => {
						const gx = x + S(dx);
						const gy = y - S(i % 2 ? 10 : 0);
						const h = S(60 + (i % 3) * 18);
						const tilt = (i - 1.5) * 4;
						return (
							<g key={dx} transform={`rotate(${tilt} ${r1(gx)} ${r1(gy)})`}>
								{i === 2 ? (
									<path d={`M${gx - S(6)} ${gy}V${gy - h}M${gx - S(26)} ${gy - h * 0.7}H${gx + S(26)}`} stroke={st.c} strokeWidth={S(12)} />
								) : (
									<path d={`M${gx - S(24)} ${gy}V${gy - h + S(24)}A${S(24)} ${S(24)} 0 0 1 ${gx + S(24)} ${gy - h + S(24)}V${gy}Z`} fill={st.c} stroke={st.line} strokeWidth={1.5} />
								)}
								{i !== 2 && <path d={`M${gx - S(24)} ${gy}V${gy - h + S(24)}A${S(24)} ${S(24)} 0 0 1 ${gx - S(4)} ${gy - h + S(2)}V${gy}Z`} fill={st.lit} opacity={0.5} />}
							</g>
						);
					})}
				</g>
			);
		}
		case "ruins": {
			const st = stone(ctx);
			return (
				<g key={key}>
					{[-150, -50, 90].map((dx, i) => {
						const h = S([260, 170, 220][i]);
						const cx = x + S(dx);
						return (
							<g key={dx}>
								<path d={`M${cx - S(22)} ${y}V${y - h}l${S(10)} ${S(-12)}l${S(12)} ${S(8)}l${S(10)} ${S(-6)}l${S(12)} ${S(10)}V${y}Z`} fill={st.c} />
								<rect x={cx - S(22)} y={y - h} width={S(14)} height={h} fill={st.lit} opacity={0.5} />
								{Array.from({ length: 4 }, (_, k) => <path key={k} d={`M${cx - S(22)} ${y - (h * (k + 1)) / 5}h${S(44)}`} stroke={st.line} strokeWidth={1} opacity={0.6} />)}
							</g>
						);
					})}
					<path d={`M${x - S(180)} ${y - S(250)}H${x - S(20)}V${y - S(232)}H${x - S(180)}Z`} fill={st.lit} />
					<path d={`M${x + S(20)} ${y}l${S(30)} ${S(-26)}l${S(40)} ${S(4)}l${S(10)} ${S(22)}Z`} fill={st.dark} />
				</g>
			);
		}
		case "standing_stones": {
			const st = stone(ctx);
			return (
				<g key={key}>
					{glow("g", x, y - S(80), S(260), "cold", 0.25, "dh-glow-slow")}
					{[-220, -110, 0, 110, 220].map((dx, i) => {
						const sx = x + S(dx);
						const h = S([150, 200, 240, 190, 160][i]);
						const sy = y - S(Math.abs(dx) * 0.12);
						return (
							<g key={dx}>
								<path d={`M${sx - S(24)} ${sy}L${sx - S(20)} ${sy - h}Q${sx} ${sy - h - S(14)} ${sx + S(22)} ${sy - h + S(6)}L${sx + S(26)} ${sy}Z`} fill={st.c} />
								<path d={`M${sx - S(24)} ${sy}L${sx - S(20)} ${sy - h}Q${sx - S(10)} ${sy - h - S(8)} ${sx - S(4)} ${sy - h}L${sx - S(6)} ${sy}Z`} fill={st.lit} opacity={0.55} />
								<path d={`M${sx - S(6)} ${sy - h * 0.6}l${S(8)} ${S(10)}l${S(-6)} ${S(12)}`} stroke="#8ad0ff" strokeWidth={S(2)} fill="none" opacity={0.7} className="dh-glow-slow" />
							</g>
						);
					})}
				</g>
			);
		}
		case "candles":
			return (
				<g key={key}>
					{[-60, -34, -10, 18, 44, 66].map((dx, i) => {
						const cx = x + S(dx);
						const h = S(14 + ((i * 7) % 4) * 9);
						const cy = y - S(i % 2 ? 0 : 6);
						return (
							<g key={dx}>
								<rect x={cx - S(4)} y={cy - h} width={S(8)} height={h} fill="#e8dcc0" />
								<path d={`M${cx - S(4)} ${cy - h}q${S(2)} ${S(6)} 0 ${S(10)}`} stroke="#fff6e0" strokeWidth={1.5} fill="none" />
								{flame(`f${i}`, cx, cy - h, S(4), i % 2 ? "dh-flame2" : "dh-flame")}
								{glow(`g${i}`, cx, cy - h - S(6), S(40), "warm", 0.6)}
							</g>
						);
					})}
				</g>
			);
		case "crystals":
			return (
				<g key={key}>
					{glow("g", x, y - S(60), S(220), "violet", 0.5, "dh-glow-slow")}
					{[[-50, 120, -14], [0, 170, 4], [44, 100, 18], [-90, 70, -30], [80, 60, 30]].map(([dx, h, rot], i) => {
						const cx = x + S(dx);
						const c = i % 2 ? "#9a6ae8" : "#6ab8f0";
						return (
							<g key={i} transform={`rotate(${rot} ${r1(cx)} ${y})`}>
								<path d={`M${cx - S(14)} ${y}L${cx - S(14)} ${y - S(h) * 0.75}L${cx} ${y - S(h)}L${cx + S(14)} ${y - S(h) * 0.75}L${cx + S(14)} ${y}Z`} fill={c} opacity={0.85} />
								<path d={`M${cx - S(14)} ${y}L${cx - S(14)} ${y - S(h) * 0.75}L${cx} ${y - S(h)}L${cx} ${y}Z`} fill="#ffffff" opacity={0.35} />
							</g>
						);
					})}
				</g>
			);
		case "mushrooms":
			return (
				<g key={key}>
					{[[-70, 60, 30], [-20, 100, 44], [40, 70, 34], [90, 40, 22]].map(([dx, h, r], i) => {
						const cx = x + S(dx);
						const cap = i % 2 ? "#40e0c0" : "#b070ff";
						return (
							<g key={i}>
								{glow(`g${i}`, cx, y - S(h), S(r * 3), i % 2 ? "green" : "violet", 0.45, "dh-glow-slow")}
								<path d={`M${cx - S(6)} ${y}Q${cx - S(4)} ${y - S(h) / 2} ${cx - S(5)} ${y - S(h)}H${cx + S(5)}Q${cx + S(6)} ${y - S(h) / 2} ${cx + S(6)} ${y}Z`} fill="#d8d0e8" opacity={0.85} />
								<path d={`M${cx - S(r)} ${y - S(h) + S(4)}Q${cx} ${y - S(h) - S(r) * 1.2} ${cx + S(r)} ${y - S(h) + S(4)}Z`} fill={cap} />
								{[0.4, -0.3, 0.1].map((t, k) => <circle key={k} cx={cx + t * S(r)} cy={y - S(h) - S(r) * 0.3 + k * 2} r={S(2.5)} fill="#ffffff" opacity={0.7} />)}
							</g>
						);
					})}
				</g>
			);
		case "cauldron":
			return (
				<g key={key}>
					{glow("g", x, y - S(60), S(160), "green", 0.5, "dh-glow")}
					<path d={`M${x - S(30)} ${y}l${S(10)} ${S(-30)}M${x + S(30)} ${y}l${S(-10)} ${S(-30)}`} stroke="#1a1612" strokeWidth={S(6)} />
					<path d={`M${x - S(60)} ${y - S(80)}Q${x - S(70)} ${y - S(10)} ${x} ${y - S(14)}Q${x + S(70)} ${y - S(10)} ${x + S(60)} ${y - S(80)}Z`} fill={m("#24221e", ctx)} />
					<ellipse cx={x} cy={y - S(80)} rx={S(62)} ry={S(12)} fill="#3a3630" />
					<ellipse cx={x} cy={y - S(80)} rx={S(54)} ry={S(8)} fill="#6aff8a" opacity={0.85} />
					{[-20, 6, 26].map((dx, i) => <circle key={i} cx={x + S(dx)} cy={y - S(92) - i * S(6)} r={S(6 - i)} fill="#9affb0" opacity={0.6} className="dh-bubble" style={{ animationDelay: `${i * 0.7}s` }} />)}
					{flame("f", x, y - S(2), S(14), "dh-flame2")}
				</g>
			);
		case "portal":
			return (
				<g key={key}>
					{glow("g", x, y - S(150), S(300), "violet", 0.6, "dh-glow-slow")}
					<ellipse cx={x} cy={y - S(150)} rx={S(80)} ry={S(140)} fill={u("portal")} className="dh-portal" style={{ transformOrigin: `${r1(x)}px ${r1(y - S(150))}px`, transformBox: "view-box" }} />
					<ellipse cx={x} cy={y - S(150)} rx={S(80)} ry={S(140)} fill="none" stroke="#e0c0ff" strokeWidth={S(4)} opacity={0.8} />
				</g>
			);
		case "bridge": {
			const w = wood(ctx);
			return (
				<g key={key}>
					<path d={`M${x - S(260)} ${y - S(20)}Q${x} ${y - S(90)} ${x + S(260)} ${y - S(20)}`} stroke={w.c} strokeWidth={S(16)} fill="none" />
					<path d={`M${x - S(260)} ${y - S(70)}Q${x} ${y - S(140)} ${x + S(260)} ${y - S(70)}`} stroke={w.lit} strokeWidth={S(5)} fill="none" />
					{Array.from({ length: 9 }, (_, i) => {
						const t = i / 8;
						const px = x - S(260) + t * S(520);
						const py = y - S(20) - Math.sin(t * Math.PI) * S(52);
						return <path key={i} d={`M${r1(px)} ${r1(py)}V${r1(py - S(52))}`} stroke={w.dark} strokeWidth={S(5)} />;
					})}
				</g>
			);
		}
	}
	return null;
}
