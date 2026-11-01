import type { ReactNode } from "react";
import type { Mood, SceneKind, Weather } from "@/lib/game/types";
import { mix, shade } from "@/lib/art/color";
import { MOOD_GRADES, type SkyPalette } from "@/lib/art/scene";
import { ArtRng, r1 } from "@/lib/art/rand";
import { GLOW_TONES, gid, u, type GlowTone } from "./geom";

/** Keyframes for all scene animations (class names are global but identical across instances). */
export const SCENE_CSS = `
.dh-scene .dh-flame{animation:dhFlick .7s ease-in-out infinite alternate}
.dh-scene .dh-flame2{animation:dhFlick .53s ease-in-out infinite alternate-reverse}
.dh-scene .dh-flame3{animation:dhFlick2 .9s ease-in-out infinite alternate}
.dh-scene .dh-glow{animation:dhFO 1.3s ease-in-out infinite alternate}
.dh-scene .dh-glow2{animation:dhFO .8s ease-in-out infinite alternate-reverse}
.dh-scene .dh-glow-slow{animation:dhFO 4.5s ease-in-out infinite alternate}
.dh-scene .dh-flicker-slow{animation:dhFO 2.7s ease-in-out infinite alternate}
.dh-scene .dh-twinkle{animation:dhTw 3.2s ease-in-out infinite alternate}
.dh-scene .dh-sway{animation:dhSway 4.2s ease-in-out infinite alternate}
.dh-scene .dh-banner{animation:dhBanner 3.1s ease-in-out infinite alternate}
.dh-scene .dh-sail{animation:dhSail 5s ease-in-out infinite alternate}
.dh-scene .dh-spin{animation:dhSpin 24s linear infinite}
.dh-scene .dh-shimmer{animation:dhShim 3.4s ease-in-out infinite alternate}
.dh-scene .dh-waves{animation:dhShim 6s ease-in-out infinite alternate-reverse}
.dh-scene .dh-surf{animation:dhSurf 3.8s ease-in-out infinite alternate}
.dh-scene .dh-cloud{animation:dhCloud var(--dur,120s) ease-in-out infinite alternate}
.dh-scene .dh-rain{animation:dhRain .38s linear infinite}
.dh-scene .dh-rain2{animation:dhRain2 .6s linear infinite}
.dh-scene .dh-snow{animation:dhSnow 9s linear infinite}
.dh-scene .dh-snow2{animation:dhSnow2 15s linear infinite}
.dh-scene .dh-snowsway{animation:dhSway2 4s ease-in-out infinite alternate}
.dh-scene .dh-fog{animation:dhFog var(--dur,40s) ease-in-out infinite alternate}
.dh-scene .dh-lightning{animation:dhBolt 9s linear infinite}
.dh-scene .dh-sparks circle{animation:dhSpark 2.6s ease-out infinite}
.dh-scene .dh-bubble{animation:dhSpark 2s ease-out infinite}
.dh-scene .dh-shaft{animation:dhFO 7s ease-in-out infinite alternate}
.dh-scene .dh-shaft2{animation:dhFO 5s ease-in-out infinite alternate-reverse}
.dh-scene .dh-dust{animation:dhDust 14s ease-in-out infinite alternate}
.dh-scene .dh-portal{animation:dhPulse 3s ease-in-out infinite alternate}
.dh-scene .dh-layer{transition:transform .9s cubic-bezier(.2,.7,.3,1)}
@keyframes dhFlick{0%{transform:scale(1,1)}35%{transform:scale(.9,1.1) skewX(3deg)}70%{transform:scale(1.06,.92) skewX(-2deg)}100%{transform:scale(.96,1.05)}}
@keyframes dhFlick2{0%{transform:scale(1,.95)}50%{transform:scale(.94,1.1) skewX(-3deg)}100%{transform:scale(1.04,1)}}
@keyframes dhFO{0%{fill-opacity:1}40%{fill-opacity:.72}70%{fill-opacity:.9}100%{fill-opacity:.66}}
@keyframes dhTw{0%{fill-opacity:1}100%{fill-opacity:.15}}
@keyframes dhSway{0%{transform:rotate(-2.5deg)}100%{transform:rotate(2.5deg)}}
@keyframes dhSway2{0%{transform:translateX(-25px)}100%{transform:translateX(25px)}}
@keyframes dhBanner{0%{transform:skewY(-3deg) scaleX(1)}100%{transform:skewY(3deg) scaleX(.94)}}
@keyframes dhSail{0%{transform:scaleX(.95)}100%{transform:scaleX(1.03)}}
@keyframes dhSpin{to{transform:rotate(360deg)}}
@keyframes dhShim{0%{transform:translateX(-8px)}100%{transform:translateX(8px)}}
@keyframes dhSurf{0%{transform:translateY(0)}100%{transform:translateY(7px)}}
@keyframes dhCloud{0%{transform:translateX(calc(var(--drift,80px) * -1))}100%{transform:translateX(var(--drift,80px))}}
@keyframes dhRain{0%{transform:translateY(0)}100%{transform:translateY(120px)}}
@keyframes dhRain2{0%{transform:translateY(0)}100%{transform:translateY(160px)}}
@keyframes dhSnow{0%{transform:translateY(0)}100%{transform:translateY(200px)}}
@keyframes dhSnow2{0%{transform:translateY(0)}100%{transform:translateY(300px)}}
@keyframes dhFog{0%{transform:translateX(-90px)}100%{transform:translateX(90px)}}
@keyframes dhBolt{0%,100%{opacity:0}1%{opacity:.75}2%{opacity:.05}3.5%{opacity:.55}5%{opacity:0}}
@keyframes dhSpark{0%{transform:translateY(0);fill-opacity:1}100%{transform:translateY(-140px) translateX(14px);fill-opacity:0}}
@keyframes dhDust{0%{transform:translate(0,0)}100%{transform:translate(30px,-50px)}}
@keyframes dhPulse{0%{transform:scale(.96)}100%{transform:scale(1.04)}}
.dh-scene.dh-still *,.dh-scene.dh-still{animation:none!important;transition:none!important}
@media (prefers-reduced-motion: reduce){.dh-scene *{animation:none!important;transition:none!important}}
`;

export function SceneDefs({ pal, seed }: { pal: SkyPalette; seed: number }): ReactNode {
	const tones = Object.entries(GLOW_TONES) as [GlowTone, string][];
	return (
		<defs>
			<linearGradient id={gid("sky")} x1="0" y1="0" x2="0" y2="640" gradientUnits="userSpaceOnUse">
				<stop offset="0" stopColor={pal.zenith} />
				<stop offset="0.55" stopColor={pal.mid} />
				<stop offset="0.92" stopColor={pal.horizon} />
				<stop offset="1" stopColor={pal.horizon} />
			</linearGradient>
			<radialGradient id={gid("sunglow")}>
				<stop offset="0" stopColor={pal.light} stopOpacity={0.9} />
				<stop offset="0.12" stopColor={pal.light} stopOpacity={0.55} />
				<stop offset="0.4" stopColor={pal.light} stopOpacity={0.12} />
				<stop offset="1" stopColor={pal.light} stopOpacity={0} />
			</radialGradient>
			<linearGradient id={gid("sunpath")} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stopColor={pal.light} stopOpacity={0.8} />
				<stop offset="1" stopColor={pal.light} stopOpacity={0} />
			</linearGradient>
			<linearGradient id={gid("haze")} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stopColor={pal.haze} stopOpacity={0} />
				<stop offset="0.6" stopColor={pal.haze} stopOpacity={0.55} />
				<stop offset="1" stopColor={pal.haze} stopOpacity={0} />
			</linearGradient>
			{tones.map(([t, c]) => (
				<radialGradient key={t} id={gid(`glow-${t}`)}>
					<stop offset="0" stopColor={c} stopOpacity={0.85} />
					<stop offset="0.25" stopColor={c} stopOpacity={0.4} />
					<stop offset="0.6" stopColor={c} stopOpacity={0.1} />
					<stop offset="1" stopColor={c} stopOpacity={0} />
				</radialGradient>
			))}
			<radialGradient id={gid("cloud")}>
				<stop offset="0" stopColor={pal.cloudColor} stopOpacity={0.95} />
				<stop offset="0.6" stopColor={pal.cloudColor} stopOpacity={0.75} />
				<stop offset="1" stopColor={pal.cloudColor} stopOpacity={0} />
			</radialGradient>
			<radialGradient id={gid("cloudshade")}>
				<stop offset="0" stopColor={pal.cloudShadow} stopOpacity={0.9} />
				<stop offset="0.6" stopColor={pal.cloudShadow} stopOpacity={0.6} />
				<stop offset="1" stopColor={pal.cloudShadow} stopOpacity={0} />
			</radialGradient>
			<radialGradient id={gid("fogblob")}>
				<stop offset="0" stopColor={pal.night ? "#4a5468" : mix(pal.haze, "#e8ecf0", 0.6)} stopOpacity={0.7} />
				<stop offset="1" stopColor={pal.night ? "#4a5468" : mix(pal.haze, "#e8ecf0", 0.6)} stopOpacity={0} />
			</radialGradient>
			<radialGradient id={gid("deep")} cx="50%" cy="60%" r="60%">
				<stop offset="0" stopColor="#000" />
				<stop offset="1" stopColor="#14101a" />
			</radialGradient>
			<linearGradient id={gid("walldepthL")} x1="0" y1="0" x2="1" y2="0">
				<stop offset="0" stopColor="#000" stopOpacity={0.15} />
				<stop offset="1" stopColor="#000" stopOpacity={0.9} />
			</linearGradient>
			<linearGradient id={gid("walldepthR")} x1="1" y1="0" x2="0" y2="0">
				<stop offset="0" stopColor="#000" stopOpacity={0.15} />
				<stop offset="1" stopColor="#000" stopOpacity={0.9} />
			</linearGradient>
			<linearGradient id={gid("floordepth")} x1="0" y1="1" x2="0" y2="0">
				<stop offset="0" stopColor="#000" stopOpacity={0.1} />
				<stop offset="1" stopColor="#000" stopOpacity={0.92} />
			</linearGradient>
			<linearGradient id={gid("shaft")} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stopColor={pal.night ? "#9ab0e0" : "#fff2c8"} stopOpacity={pal.night ? 0.18 : 0.38} />
				<stop offset="1" stopColor={pal.night ? "#9ab0e0" : "#fff2c8"} stopOpacity={0} />
			</linearGradient>
			<linearGradient id={gid("templeback")} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stopColor="#100c14" />
				<stop offset="1" stopColor="#4a4038" />
			</linearGradient>
			<radialGradient id={gid("underdark")} cx="50%" cy="55%" r="70%">
				<stop offset="0" stopColor="#2a2a52" />
				<stop offset="0.5" stopColor="#141428" />
				<stop offset="1" stopColor="#05040c" />
			</radialGradient>
			<radialGradient id={gid("portal")}>
				<stop offset="0" stopColor="#ffffff" />
				<stop offset="0.3" stopColor="#d0a0ff" />
				<stop offset="0.8" stopColor="#5a20a0" />
				<stop offset="1" stopColor="#200a40" />
			</radialGradient>
			<linearGradient id={gid("waterfade")} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stopColor="#000" stopOpacity={0} />
				<stop offset="1" stopColor="#000" stopOpacity={0.5} />
			</linearGradient>
			<filter id={gid("blur8")} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8" /></filter>
			<filter id={gid("blur3")} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3" /></filter>
			<filter id={gid("grain")} x="0" y="0" width="100%" height="100%">
				<feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed={seed % 1000} stitchTiles="stitch" />
				<feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0.55 0" />
			</filter>
			<filter id={gid("paper")} x="0" y="0" width="100%" height="100%">
				<feTurbulence type="fractalNoise" baseFrequency="0.012 0.04" numOctaves="3" seed={(seed >> 3) % 1000} />
				<feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.35 0" />
			</filter>
			<pattern id={gid("rain")} width="40" height="120" patternUnits="userSpaceOnUse">
				<path d="M6 0l-3 34M26 50l-3 30M16 90l-2 24M36 20l-2 22" stroke="#cfd8e8" strokeWidth="1.3" strokeOpacity="0.55" strokeLinecap="round" />
			</pattern>
			<pattern id={gid("rain2")} width="70" height="160" patternUnits="userSpaceOnUse">
				<path d="M10 0l-4 56M45 80l-4 50" stroke="#dfe6f2" strokeWidth="2.2" strokeOpacity="0.5" strokeLinecap="round" />
			</pattern>
			<pattern id={gid("snow")} width="200" height="200" patternUnits="userSpaceOnUse">
				{[[20, 30, 2], [80, 120, 1.6], [150, 60, 2.4], [110, 180, 1.4], [180, 150, 1.8], [50, 90, 1.2], [130, 10, 1.5]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity={0.85} />)}
			</pattern>
			<pattern id={gid("snow2")} width="300" height="300" patternUnits="userSpaceOnUse">
				{[[40, 60, 4], [200, 140, 3.4], [120, 250, 4.4], [260, 20, 3]].map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity={0.9} />)}
			</pattern>
			<radialGradient id={gid("vignette")} cx="50%" cy="48%" r="72%">
				<stop offset="0.55" stopColor="#000" stopOpacity={0} />
				<stop offset="1" stopColor="#000" stopOpacity={1} />
			</radialGradient>
		</defs>
	);
}

function cloud(key: number, rng: ArtRng, x: number, y: number, w: number, dark: boolean): ReactNode {
	const lumps = 5 + Math.floor(rng.next() * 4);
	const items: ReactNode[] = [];
	for (let i = 0; i < lumps; i++) {
		const t = i / (lumps - 1);
		const lx = x - w / 2 + t * w + rng.range(-10, 10);
		const lr = w * (0.18 + Math.sin(t * Math.PI) * 0.16) * rng.range(0.8, 1.2);
		items.push(<ellipse key={`s${i}`} cx={r1(lx)} cy={r1(y + lr * 0.35)} rx={r1(lr * 1.3)} ry={r1(lr * 0.6)} fill={u("cloudshade")} />);
		items.push(<ellipse key={`l${i}`} cx={r1(lx - lr * 0.1)} cy={r1(y - lr * 0.25)} rx={r1(lr * 1.15)} ry={r1(lr * 0.85)} fill={u(dark ? "cloudshade" : "cloud")} />);
	}
	return <g key={key}>{items}</g>;
}

export function Sky({ pal, weather, rng, sunX, horizon }: { pal: SkyPalette; weather: Weather; rng: ArtRng; sunX: number; horizon: number }): ReactNode {
	const sunY = horizon - 40 - pal.lightHeight * (horizon - 120);
	const stars = pal.night && (weather === "clear" || weather === "cloudy");
	const cloudCount = { clear: 3, cloudy: 9, rain: 12, storm: 14, fog: 0, snow: 8 }[weather];
	const dark = weather === "storm" || weather === "rain";
	return (
		<g>
			<rect x={-100} y={-100} width={1800} height={1100} fill={u("sky")} />
			{stars && (
				<g>
					{Array.from({ length: 140 }, (_, i) => {
						const y = rng.range(0, horizon - 60);
						const r = rng.next() < 0.1 ? rng.range(1.4, 2.2) : rng.range(0.5, 1.2);
						return <circle key={i} cx={r1(rng.range(0, 1600))} cy={r1(y)} r={r1(r)} fill="#fff" opacity={r1(Math.max(0.2, 1 - y / horizon))} className={i % 4 === 0 ? "dh-twinkle" : undefined} style={i % 4 === 0 ? { animationDelay: `${r1(rng.range(0, 3))}s` } : undefined} />;
					})}
					<path d={`M-50 ${horizon - 380}Q600 ${horizon - 520} 1650 ${horizon - 260}`} stroke="#b0c0ff" strokeOpacity={0.06} strokeWidth={120} fill="none" filter={u("blur8")} />
				</g>
			)}
			{/* sun / moon */}
			<circle cx={sunX} cy={r1(sunY)} r={pal.lightVisible ? 420 : 600} fill={u("sunglow")} opacity={pal.lightVisible ? (pal.night ? 0.45 : 0.9) : 0.35} />
			{pal.lightVisible && !pal.night && <circle cx={sunX} cy={r1(sunY)} r={pal.lightHeight > 0.5 ? 34 : 46} fill={mix(pal.light, "#ffffff", 0.5)} />}
			{pal.lightVisible && pal.night && (
				<g>
					<circle cx={sunX} cy={r1(sunY)} r={28} fill="#eef3fb" />
					<circle cx={sunX + 7} cy={r1(sunY + 4)} r={24} fill="#b8c4d8" opacity={0.35} />
					<circle cx={sunX - 9} cy={r1(sunY - 6)} r={5} fill="#c8d0dc" opacity={0.7} />
					<circle cx={sunX + 8} cy={r1(sunY - 9)} r={3.5} fill="#c8d0dc" opacity={0.6} />
					<circle cx={sunX + 2} cy={r1(sunY + 11)} r={6} fill="#c8d0dc" opacity={0.5} />
				</g>
			)}
			{/* clouds */}
			{Array.from({ length: cloudCount }, (_, i) => {
				const y = rng.range(60, horizon - 160) * (dark ? 0.7 : 1);
				const w = rng.range(220, 520) * (dark ? 1.5 : 1);
				const x = rng.range(-100, 1700);
				const dur = r1(rng.range(70, 160));
				return (
					<g key={i} className="dh-cloud" style={{ ["--dur" as string]: `${dur}s`, ["--drift" as string]: `${r1(rng.range(40, 140))}px`, animationDelay: `${-r1(rng.range(0, dur))}s` }}>
						{cloud(i, rng, x, y, w, dark && i % 2 === 0)}
					</g>
				);
			})}
			{dark && <rect x={-100} y={-100} width={1800} height={horizon + 100} fill={pal.cloudShadow} opacity={0.35} />}
		</g>
	);
}

export function Haze({ y, h, opacity = 1 }: { y: number; h: number; opacity?: number }): ReactNode {
	return <rect x={-100} y={y - h / 2} width={1800} height={h} fill={u("haze")} opacity={opacity} />;
}

export function WeatherFx({ weather, interior, pal, rng, kind }: { weather: Weather; interior: boolean; pal: SkyPalette; rng: ArtRng; kind: SceneKind }): ReactNode {
	const out: ReactNode[] = [];
	const showPrecip = !interior || kind === "cave";
	if ((weather === "rain" || weather === "storm") && showPrecip) {
		out.push(
			<g key="rain" transform="rotate(14 800 450)" opacity={interior ? 0.5 : 1}>
				<rect className="dh-rain" x={-400} y={-1300} width={2400} height={2600} fill={u("rain")} />
				<rect className="dh-rain2" x={-400} y={-1300} width={2400} height={2600} fill={u("rain2")} />
			</g>,
		);
	}
	if (weather === "storm") {
		const bx = rng.range(300, 1300);
		out.push(
			<g key="bolt" className="dh-lightning" style={{ mixBlendMode: "screen", opacity: 0 }}>
				<rect x={-100} y={-100} width={1800} height={1100} fill="#dfe8ff" opacity={0.6} />
				{!interior && <path d={`M${r1(bx)} 0L${r1(bx - 30)} 140L${r1(bx + 10)} 150L${r1(bx - 40)} 330L${r1(bx + 4)} 340L${r1(bx - 50)} 520`} stroke="#ffffff" strokeWidth={4} fill="none" />}
			</g>,
		);
	}
	if (weather === "snow" && showPrecip) {
		out.push(
			<g key="snow" className="dh-snowsway">
				<rect className="dh-snow" x={-200} y={-1100} width={2000} height={2200} fill={u("snow")} />
				<rect className="dh-snow2" x={-200} y={-1100} width={2000} height={2200} fill={u("snow2")} />
			</g>,
		);
	}
	if (weather === "fog" || kind === "swamp" || (interior && kind === "crypt")) {
		const heavy = weather === "fog";
		out.push(
			<g key="fog" opacity={heavy ? 1 : 0.55}>
				{Array.from({ length: heavy ? 9 : 5 }, (_, i) => {
					const dur = r1(rng.range(30, 60));
					return (
						<ellipse key={i} cx={r1(rng.range(-100, 1700))} cy={r1(rng.range(heavy ? 380 : 620, 860))} rx={r1(rng.range(400, 800))} ry={r1(rng.range(60, 140))} fill={u("fogblob")} className="dh-fog" style={{ ["--dur" as string]: `${dur}s`, animationDelay: `${-r1(rng.range(0, dur))}s` }} />
					);
				})}
				{heavy && <rect x={-100} y={-100} width={1800} height={1100} fill={pal.night ? "#2a3240" : mix(pal.haze, "#dde2e6", 0.5)} opacity={0.32} />}
			</g>,
		);
	}
	return <g>{out}</g>;
}

export function MoodGrade({ mood, lightX, lightY }: { mood: Mood; lightX: number; lightY: number }): ReactNode {
	const g = MOOD_GRADES[mood];
	return (
		<g pointerEvents="none">
			<rect x={-100} y={-100} width={1800} height={1100} fill={g.tint} opacity={g.tintOpacity * 1.6} style={{ mixBlendMode: "soft-light" }} />
			{g.desat > 0 && <rect x={-100} y={-100} width={1800} height={1100} fill="#808080" opacity={g.desat} style={{ mixBlendMode: "saturation" }} />}
			{g.glow && <circle cx={lightX} cy={lightY} r={700} fill={u("glow-gold")} opacity={0.35} style={{ mixBlendMode: "screen" }} />}
			{mood === "combat" && <rect x={-100} y={-100} width={1800} height={1100} fill={u("vignette")} opacity={0.5} style={{ mixBlendMode: "multiply", color: "#a00" }} />}
			<rect x={-100} y={-100} width={1800} height={1100} fill={u("vignette")} opacity={g.vignette} />
			{g.vignetteColor !== "#000000" && <rect x={-100} y={-100} width={1800} height={1100} fill={shade(g.vignetteColor, 0.1)} opacity={0.15} style={{ mixBlendMode: "multiply" }} />}
		</g>
	);
}

export function Texture(): ReactNode {
	return (
		<g pointerEvents="none">
			<rect x={0} y={0} width={1600} height={900} filter={u("paper")} style={{ mixBlendMode: "overlay" }} opacity={0.5} />
			<rect x={0} y={0} width={1600} height={900} filter={u("grain")} style={{ mixBlendMode: "overlay" }} opacity={0.35} />
		</g>
	);
}
