"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { AmbienceTrack } from "@/lib/game/types";
import { QUIET_PREVIEW_TRACKS, QUIET_SFX, QUIET_TRACKS, getAmbienceEngine, type PreviewTrack, type SfxName } from "@/lib/audio/ambience";

/**
 * PREVIEW ONLY: The Quiet's new soundtrack. Every bed is synthesized live in the
 * browser. Audio starts only when you click (browser autoplay policy). "A/B"
 * swaps to the fantasy bed a zombie game used before, for comparison.
 */

type CardTrack = Exclude<(typeof QUIET_TRACKS)[number], "q_quiet_town" | "q_dread"> | PreviewTrack;

const INFO: Record<CardTrack, { en: string; es: string; old: AmbienceTrack }> = {
	q_quiet_town_a: { en: "A · Empty street at dusk: far, dark wind; a warm slow pad that breathes; a few plucked notes with long echoes; very rarely a far electronic warble.", es: "A · Calle vacía al anochecer: viento lejano y oscuro; un pad cálido que respira; unas pocas notas punteadas con eco largo; muy de vez en cuando un pitido lejano.", old: "town" },
	q_quiet_town_b: { en: "B · Deserted, uneasy: no melody. A deep, slowly beating drone; wind singing in power lines; a rare heavy thud far away; a lot of silence.", es: "B · Desierto, inquietante: sin melodía. Un dron grave que late despacio; viento que canta en los cables; un golpe pesado y lejano de vez en cuando; mucho silencio.", old: "town" },
	q_dread_a: { en: "A · Low strings in C minor that slowly breathe over a sub bass; now and then a dissonant cluster swells, everything drops into silence and creeps back.", es: "A · Cuerdas graves en do menor que respiran despacio sobre un sub grave; a veces un cluster disonante crece, todo cae al silencio y vuelve poco a poco.", old: "tension" },
	q_dread_b: { en: "B · A slow sub pulse (~50 bpm) felt more than heard; glassy high harmonics drifting in and out; reversed-cymbal swells; a single far metal scrape.", es: "B · Un pulso subgrave lento (~50 bpm) que se siente más que se oye; armónicos agudos de cristal que van y vienen; crescendos de platillo invertido; un roce metálico lejano.", old: "tension" },
	q_outbreak: { en: "Day 0 at a distance: sirens passing, a helicopter, screams, a church bell, alarms, far gunfire.", es: "Día 0 a lo lejos: sirenas que pasan, un helicóptero, gritos, una campana, alarmas, disparos lejanos.", old: "town" },
	q_night: { en: "October night: the last crickets, distant moans, wind, very rarely a far gunshot.", es: "Noche de octubre: los últimos grillos, gemidos lejanos, viento, muy de vez en cuando un disparo.", old: "night" },
	q_hospital: { en: "Fluorescent hum, a flickering tube, a monitor whose beeps slow down and stop, drips.", es: "Zumbido fluorescente, un tubo que parpadea, un monitor cuyos pitidos se frenan y se apagan, goteo.", old: "dungeon" },
	q_safehouse: { en: "Rain on the window, a ticking clock and a quiet piano: the only warm music.", es: "Lluvia en la ventana, un reloj y un piano tranquilo: la única música cálida.", old: "rain" },
	q_horde: { en: "A wall of groans swelling, shuffling feet, fists on wood and metal.", es: "Un muro de gemidos que crece, pies que se arrastran, golpes en madera y metal.", old: "tension" },
	q_chase: { en: "Run: driving 120 bpm synth bass, ticking hats, rising arpeggios.", es: "Corre: bajo sintetizado a 120 bpm, hi-hats, arpegios que suben.", old: "combat" },
	q_combat: { en: "Fight: a distorted synth pulse, tom hits, stabs.", es: "Pelea: pulso de sintetizador distorsionado, toms, golpes de acorde.", old: "combat" },
	q_radio: { en: "Static, tuning sweeps, and a number-station cycle: chime, morse, beeps. No voice.", es: "Estática, barridos de sintonía y una estación de números: campanilla, morse, pitidos. Sin voz.", old: "tension" },
	q_grief: { en: "A slow minor motif in a long reverb over a low drone.", es: "Un motivo lento en menor con reverberación larga sobre un dron grave.", old: "temple" },
};

const SFX_INFO: Record<string, string> = {
	groan: "zombie groan / gruñido",
	bite: "bite / mordisco",
	glass: "glass break / cristal",
	car_alarm: "car alarm / alarma de coche",
	shotgun: "shotgun / escopeta",
	radio: "radio click / clic de radio",
	door_bang: "door bang / golpes en la puerta",
	gunshot: "pistol (existing) / pistola",
};

interface Meter { peak: number; peakPre: number; rms: number; nan: number; ms: number; reset: () => void }
declare global {
	interface Window { __meter?: Meter }
}

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmt = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} dBFS` : "-∞");

export default function AudioQuietPage() {
	const [playing, setPlaying] = useState<CardTrack | null>(null);
	const [ab, setAb] = useState<"new" | "old">("new");
	const [vol, setVol] = useState(0.6);
	const [unlocked, setUnlocked] = useState(false);
	const [read, setRead] = useState({ peak: -Infinity, rms: -Infinity, nan: 0 });
	const meter = useRef<{ post: AnalyserNode; pre: AnalyserNode } | null>(null);

	const ensure = async () => {
		const e = getAmbienceEngine();
		if (!e) return null;
		await e.unlock();
		e.setMuted(false);
		e.setVolumes({ music: vol, sfx: vol });
		if (!meter.current) {
			const post = e.meterTap("post");
			const pre = e.meterTap("pre");
			if (post && pre) meter.current = { post, pre };
		}
		setUnlocked(true);
		return e;
	};

	// Level meter: running peak (post-compressor, what you hear), pre-compressor peak, RMS, NaN count.
	useEffect(() => {
		const m: Meter = { peak: 0, peakPre: 0, rms: 0, nan: 0, ms: 0, reset() { m.peak = 0; m.peakPre = 0; m.nan = 0; sum = 0; n = 0; m.rms = 0; m.ms = 0; } };
		let sum = 0, n = 0;
		Object.assign(globalThis, { __meter: m });
		const buf = new Float32Array(8192);
		const id = setInterval(() => {
			const a = meter.current;
			if (!a) return;
			for (const [which, an] of [["post", a.post], ["pre", a.pre]] as const) {
				an.getFloatTimeDomainData(buf);
				let pk = 0;
				for (let i = 0; i < buf.length; i++) {
					const v = buf[i];
					if (Number.isNaN(v)) { m.nan++; continue; }
					const av = Math.abs(v);
					if (av > pk) pk = av;
					if (which === "post") { sum += v * v; n++; }
				}
				if (which === "post") m.peak = Math.max(m.peak, pk); else m.peakPre = Math.max(m.peakPre, pk);
			}
			m.rms = n ? Math.sqrt(sum / n) : 0;
			m.ms += 100;
		}, 100);
		const ui = setInterval(() => setRead({ peak: db(m.peak), rms: db(m.rms), nan: m.nan }), 400);
		const vis = () => getAmbienceEngine()?.suspend(document.hidden);
		document.addEventListener("visibilitychange", vis);
		return () => { clearInterval(id); clearInterval(ui); document.removeEventListener("visibilitychange", vis); };
	}, []);

	const play = async (t: CardTrack, which: "new" | "old" = "new") => {
		const e = await ensure();
		if (!e) return;
		e.setTrack(which === "new" ? t : INFO[t].old);
		setPlaying(t);
		setAb(which);
		window.__meter?.reset();
	};
	const stop = () => {
		getAmbienceEngine()?.setTrack("none");
		setPlaying(null);
	};
	const sfx = async (s: SfxName) => {
		const e = await ensure();
		e?.playSfx(s);
	};
	const changeVol = (v: number) => {
		setVol(v);
		getAmbienceEngine()?.setVolumes({ music: v, sfx: v });
	};

	return (
		<main className="min-h-screen bg-stone-950 px-4 py-8 text-stone-200 sm:px-8">
			<header className="mx-auto max-w-6xl">
				<p className="text-xs uppercase tracking-[0.3em] text-red-400/80">Preview · The Quiet</p>
				<h1 className="mt-1 font-serif text-3xl text-stone-100">The Quiet: new soundtrack</h1>
				<p className="mt-2 max-w-3xl text-sm text-stone-400">
					Eleven beds for zombie campaigns, all synthesized live in your browser (two reuse the existing CC0 wind and rain loops). Click a track to start; nothing plays until you click. <b>A/B</b> switches to the fantasy bed a zombie game used before.
					<br />
					<span className="text-stone-500">Once beds para partidas de zombis, sintetizados en vivo. Haz clic en una pista para empezar. <b>A/B</b> cambia a la pista de fantasía que se usaba antes.</span>
				</p>
				<div className="sticky top-0 z-10 mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-stone-800 bg-stone-900/95 p-3 backdrop-blur">
					<label className="flex items-center gap-2 text-sm">
						<span className="text-stone-400">Volume / Volumen</span>
						<input type="range" min={0} max={1} step={0.01} value={vol} onChange={(e) => changeVol(Number(e.currentTarget.value))} className="w-40 accent-red-500" aria-label="Volume" />
						<span className="w-10 tabular-nums text-stone-400">{Math.round(vol * 100)}%</span>
					</label>
					<button onClick={stop} className="rounded-lg bg-stone-800 px-4 py-2 text-sm hover:bg-stone-700" data-testid="stop">
						■ Stop
					</button>
					<div className="text-sm text-stone-400" data-testid="now">
						{playing ? (
							<>
								Now / Ahora: <span className="text-stone-100">{ab === "new" ? playing : `${INFO[playing].old} (old fantasy bed)`}</span>
							</>
						) : unlocked ? "Stopped / Parado" : "Click a track to start audio / Haz clic para empezar"}
					</div>
					<div className="ml-auto font-mono text-xs text-stone-500" title="Running peak and RMS of the master output since the last track change">
						peak {fmt(read.peak)} · rms {fmt(read.rms)} · NaN {read.nan}
					</div>
				</div>
			</header>

			<section className="mx-auto mt-6 max-w-6xl rounded-2xl border border-amber-500/40 bg-amber-950/10 p-4">
				<h2 className="flex flex-wrap items-baseline gap-3">
					<span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-stone-950">New — pick one</span>
					<span className="font-serif text-xl text-stone-100">Empty town & Dread, redone</span>
				</h2>
				<p className="mt-1 text-sm text-stone-400">
					Two different takes on each: pick A or B for each pair; the choice replaces q_quiet_town / q_dread. Give each a minute: they evolve slowly.
					<br />
					<span className="text-stone-500">Dos versiones de cada una: elige A o B en cada par. Dales un minuto: evolucionan despacio.</span>
				</p>
				<div className="mt-3 grid gap-3 sm:grid-cols-2">{QUIET_PREVIEW_TRACKS.map((t) => card(t))}</div>
			</section>

			<section className="mx-auto mt-6 grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{QUIET_TRACKS.filter((t) => t !== "q_quiet_town" && t !== "q_dread").map((t) => card(t))}
			</section>

			<section className="mx-auto mt-8 max-w-6xl pb-16">
				<h2 className="font-serif text-xl text-stone-100">Sound effects / Efectos</h2>
				<div className="mt-3 flex flex-wrap gap-2">
					{[...QUIET_SFX, "gunshot" as SfxName].map((s) => (
						<button key={s} onClick={() => sfx(s)} data-sfx={s} className="rounded-lg bg-stone-800 px-4 py-3 text-sm hover:bg-stone-700">
							<span className="font-semibold">{s}</span>
							<span className="ml-2 text-stone-500">{SFX_INFO[s]}</span>
						</button>
					))}
				</div>
			</section>
		</main>
	);

	function card(t: CardTrack) {
					const on = playing === t;
					return (
						<div key={t} className={clsx("flex flex-col rounded-xl border p-4 transition-colors", on ? "border-red-500/60 bg-red-950/30" : "border-stone-800 bg-stone-900/60")}>
							<button onClick={() => play(t, "new")} data-track={t} className={clsx("rounded-lg px-4 py-4 text-left text-lg font-semibold tracking-wide transition-colors", on && ab === "new" ? "bg-red-700 text-white" : "bg-stone-800 hover:bg-stone-700")}>
								{on && ab === "new" ? "▶ " : ""}
								{t}
							</button>
							<p className="mt-3 text-sm text-stone-300">{INFO[t].en}</p>
							<p className="mt-1 text-sm text-stone-500">{INFO[t].es}</p>
							<button
								onClick={() => play(t, on && ab === "old" ? "new" : "old")}
								className={clsx("mt-3 self-start rounded-md px-3 py-1.5 text-xs", on && ab === "old" ? "bg-amber-700 text-white" : "bg-stone-800 text-stone-300 hover:bg-stone-700")}
								data-ab={t}
							>
								A/B · {on && ab === "old" ? `playing old “${INFO[t].old}” → back to new` : `compare with old “${INFO[t].old}”`}
							</button>
						</div>
					);
	}
}
