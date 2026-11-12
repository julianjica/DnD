/**
 * DungeonHarness audio engine: crossfading ambience beds + one-shot SFX.
 *
 * Hybrid design: every AmbienceTrack is a recipe of layers. "file" layers play
 * bundled CC0 recordings from /assets/audio (see ASSETS.md); "synth" layers are
 * procedural Web Audio generators (wind, rain, fire, drips, drones, pads…) that
 * add life on top of the recordings and stand in for them if a file can't be
 * fetched or decoded. SFX work the same way: a file variant when available,
 * otherwise a synthesized version.
 *
 * Browser-only and SSR-safe: nothing touches `window` at module scope. Use
 * `getAmbienceEngine()` (returns null on the server). The AudioContext is only
 * created inside `unlock()`, which must be called from a user gesture.
 */

import type { AmbienceTrack } from "../game/types";
import type { Ruleset } from "../rules/ruleset";
import { blip, burst, every, makeImpulse, makeNoise, mtof, noiseSrc, panner, pick, rand, stopNodes, wander, type Ctx, type Stop } from "./kit";
import { makeQuietSynth, quietSfx, type QuietSfxName, type QuietSynthKind } from "./quiet";
import { isScoreKind, makeScoreSynth, type ScoreSynthKind } from "./quiet-score";

export type SfxName =
	| "dice"
	| "sword"
	| "hit"
	| "spell"
	| "fire"
	| "door"
	| "coin"
	| "levelup"
	| "death"
	| "roar"
	| "hurt"
	| "lock"
	| "book"
	| "gem"
	| "gong"
	| "victory"
	| "draw"
	| "footstep"
	| "gunshot"
	| QuietSfxName;

export const SFX_NAMES: SfxName[] = [
	"dice", "sword", "hit", "spell", "fire", "door", "coin", "levelup", "death",
	"roar", "hurt", "lock", "book", "gem", "gong", "victory", "draw", "footstep", "gunshot",
	"groan", "bite", "glass", "car_alarm", "shotgun", "radio", "door_bang",
];

/** The Quiet's own effects: never offered to fantasy campaigns. */
export const QUIET_SFX: SfxName[] = ["groan", "bite", "glass", "car_alarm", "shotgun", "radio", "door_bang"];
/** Fantasy-only effects: not offered to zombie campaigns. */
const FANTASY_ONLY_SFX: SfxName[] = ["spell", "gem", "gong", "levelup", "victory"];

/** Root Access: a modern city with programs (the "spell" zap) but no dead and no temple gongs. */
const CYBER_EXCLUDED_SFX: SfxName[] = ["groan", "bite", "gong"];

/** SFX the DM may play in a campaign of this ruleset. */
export function sfxFor(rs: Ruleset): SfxName[] {
	if (rs === "cyberpunk") return SFX_NAMES.filter((s) => !CYBER_EXCLUDED_SFX.includes(s));
	return rs === "zombie" ? SFX_NAMES.filter((s) => !FANTASY_ONLY_SFX.includes(s)) : SFX_NAMES.filter((s) => !QUIET_SFX.includes(s));
}

/** The Quiet (zombie ruleset) beds. */
export const QUIET_TRACKS = [
	"q_outbreak", "q_quiet_town", "q_night", "q_hospital", "q_safehouse", "q_dread",
	"q_horde", "q_chase", "q_combat", "q_radio", "q_grief",
] as const satisfies readonly AmbienceTrack[];

export const FANTASY_TRACKS: AmbienceTrack[] = [
	"none", "tavern", "town", "forest", "dungeon", "cave", "combat", "boss", "rain",
	"storm", "night", "temple", "sea", "tension", "victory",
];

export const AMBIENCE_TRACKS: AmbienceTrack[] = [...FANTASY_TRACKS, ...QUIET_TRACKS];

/** Root Access (Marea): the neutral beds that fit a rainy megacity; no q_ tracks, no tavern/forest/temple. */
export const CYBER_TRACKS: AmbienceTrack[] = ["none", "town", "night", "rain", "storm", "combat", "tension", "boss", "victory", "dungeon"];

/** Beds offered in a ruleset: zombie games get the q_ tracks plus rain/storm weather; fantasy never sees q_. */
export function tracksFor(rs: Ruleset): AmbienceTrack[] {
	if (rs === "cyberpunk") return CYBER_TRACKS;
	return rs === "zombie" ? ["none", ...QUIET_TRACKS, "rain", "storm"] : FANTASY_TRACKS;
}

export interface AudioVolumes {
	/** 0..1 — ambience and music beds. */
	music: number;
	/** 0..1 — one-shot effects. */
	sfx: number;
}

export interface SfxOptions {
	/** Extra gain multiplier (default 1). */
	volume?: number;
	/** Stereo pan -1..1 (default 0). */
	pan?: number;
}

export interface AmbienceEngineState {
	unlocked: boolean;
	muted: boolean;
	track: PlayableTrack;
	volumes: AudioVolumes;
}

type EngineEvent = "state" | "thunder";

const BASE = "/assets/audio/";
const CROSSFADE_S = 2.2;

// ─── Recipes ────────────────────────────────────────────────────────────────

type SynthKind =
	| "wind" | "softWind" | "rain" | "fire" | "drips" | "drone" | "darkDrone" | "birds"
	| "crickets" | "surf" | "thunder" | "padWarm" | "padMinor" | "padMajor" | "choir"
	| "heartbeat" | "drums" | "crowd" | "creaks" | "owl"
	| QuietSynthKind
	| ScoreSynthKind;

type Layer =
	| {
			kind: "file";
			src: string;
			gain: number;
			/** xfade: overlap-looped (for recordings not cut as loops); native: seamless loop; once: play once. */
			mode: "xfade" | "native" | "once";
			/** Synth layers to use instead if the file fails to load/decode. */
			fallback?: SynthKind[];
			/** Optional lowpass cutoff (Hz) to push a recording far back. */
			lowpass?: number;
	  }
	| { kind: "synth"; synth: SynthKind; gain: number };

const file = (src: string, gain: number, mode: "xfade" | "native" | "once", fallback?: SynthKind[], lowpass?: number): Layer => ({ kind: "file", src, gain, mode, fallback, lowpass });
const synth = (s: SynthKind, gain: number): Layer => ({ kind: "synth", synth: s, gain });

/**
 * Candidate versions of two Quiet beds, playable only from the listening page
 * (never offered to the DM). The chosen one becomes the recipe of the real id.
 */
export const QUIET_PREVIEW_TRACKS = ["q_quiet_town_a", "q_quiet_town_b", "q_dread_a", "q_dread_b"] as const;
export type PreviewTrack = (typeof QUIET_PREVIEW_TRACKS)[number];
/** Anything the engine can play: a real track or a preview candidate. */
export type PlayableTrack = AmbienceTrack | PreviewTrack;

const PREVIEW_RECIPES: Record<PreviewTrack, Layer[]> = {
	// A: empty street at dusk — far, dark wind; warm slow pad; a few plucked notes; a rare far electronic tone.
	q_quiet_town_a: [file("amb/wind-winter.mp3", 0.3, "xfade", ["softWind"], 650), synth("sDusk", 0.9), synth("sDistantTone", 1)],
	// B: deserted, uneasy — no melody: deep beating drone, wind singing in wires, rare far thuds, silence.
	q_quiet_town_b: [file("amb/wind-winter.mp3", 0.24, "xfade", ["softWind"], 480), synth("sDeepDrone", 1.1), synth("sWires", 0.6), synth("sFarThuds", 1)],
	// A: slow breathing low strings with a sub; rare dissonant clusters that drop into silence.
	q_dread_a: [synth("sStrings", 1.05)],
	// B: a slow sub pulse, glassy harmonics, reverse swells, a far metal scrape.
	q_dread_b: [synth("sSubPulse", 0.8), synth("sGlass", 1), synth("sReverseSwell", 1), synth("sScrape", 1), synth("sDeepDrone", 0.35)],
};

const RECIPES: Record<Exclude<AmbienceTrack, "none">, Layer[]> = {
	tavern: [file("amb/tavern-crowded-pub.mp3", 0.85, "xfade", ["crowd", "padWarm"]), synth("fire", 0.32)],
	town: [file("amb/town-market-day.mp3", 0.45, "native", ["padMajor", "crowd"]), synth("softWind", 0.25), synth("birds", 0.12)],
	forest: [file("amb/forest-ambience.mp3", 0.9, "xfade", ["birds"]), synth("softWind", 0.35), synth("birds", 0.1)],
	dungeon: [file("amb/dungeon-ambience.ogg", 0.8, "xfade", ["darkDrone"]), synth("drips", 0.35), synth("drone", 0.18)],
	cave: [file("amb/cave-dark-cavern.ogg", 0.85, "xfade", ["darkDrone"]), synth("drips", 0.5), synth("softWind", 0.12)],
	combat: [file("amb/combat-battle-theme-b.mp3", 0.5, "native", ["drums", "padMinor"])],
	boss: [file("amb/boss-battle-theme-a.mp3", 0.55, "native", ["drums", "darkDrone"]), synth("darkDrone", 0.15)],
	rain: [file("amb/rain-loop.mp3", 0.85, "xfade", ["rain"]), synth("rain", 0.18), synth("softWind", 0.15)],
	storm: [file("amb/rain-loop.mp3", 0.9, "xfade", ["rain"]), synth("rain", 0.3), synth("wind", 0.5), synth("thunder", 0.9)],
	night: [file("amb/night-crickets.mp3", 0.7, "xfade", ["crickets"]), synth("softWind", 0.2), synth("owl", 0.18)],
	temple: [file("amb/temple-fantasy-choir.mp3", 0.4, "native", ["choir"]), synth("choir", 0.08), synth("drone", 0.08)],
	sea: [file("amb/sea-waves.ogg", 0.7, "xfade", ["surf"]), synth("surf", 0.45), synth("wind", 0.22), synth("creaks", 0.4)],
	tension: [synth("darkDrone", 0.4), synth("heartbeat", 0.4), file("amb/wind-winter.mp3", 0.25, "xfade", ["wind"])],
	victory: [file("amb/victory-fanfare.ogg", 0.55, "once", ["padMajor"]), synth("padMajor", 0.16)],

	// ── The Quiet (zombie ruleset): all procedural, plus two existing CC0 beds (wind, rain).
	// Variant A until the user picks one (PREVIEW_RECIPES above).
	q_quiet_town: PREVIEW_RECIPES.q_quiet_town_a,
	q_outbreak: [synth("qCityRumble", 0.6), synth("softWind", 0.25), synth("qSirens", 1), synth("qHelicopter", 0.7), synth("qScreams", 0.9), synth("qChurchBell", 0.8), synth("qAlarmBell", 0.8), synth("qCarAlarm", 0.7), synth("qFarShots", 0.7)],
	q_night: [synth("softWind", 0.4), synth("qCrickets", 1), synth("qMoans", 0.6), synth("qFarShot", 0.8), synth("qPadCold", 0.45)],
	q_hospital: [synth("qFluoHum", 1), synth("qFlicker", 0.9), synth("qMonitor", 1), synth("drips", 0.3), synth("darkDrone", 0.12), synth("qMoans", 0.25)],
	q_safehouse: [file("amb/rain-loop.mp3", 0.5, "xfade", ["rain"]), synth("rain", 0.06), synth("qClock", 0.7), synth("qPiano", 0.9)],
	q_dread: PREVIEW_RECIPES.q_dread_a,
	q_horde: [synth("qHordeBed", 0.8), synth("qMoansNear", 0.7), synth("qShuffle", 0.8), synth("qBanging", 0.7), synth("darkDrone", 0.15)],
	q_chase: [synth("qChase", 0.9)],
	q_combat: [synth("qCombat", 0.7)],
	q_radio: [synth("qStatic", 0.8), synth("qTuning", 1.1), synth("qNumbers", 1.4)],
	q_grief: [synth("qGrief", 1.2), synth("softWind", 0.12)],
};

interface SfxSpec {
	files: { src: string; offset?: number; duration?: number }[];
	gain: number;
	/** Synth layer always added on top (or alone when files fail). */
	synthAlways?: boolean;
	/** Random playback-rate jitter (±). */
	jitter?: number;
}

// Slices of the "2 dice roll (29 throws)" recording, one throw each.
const DICE_SLICES: [number, number][] = [[0.0, 0.75], [1.28, 0.75], [2.62, 0.9], [4.08, 0.8], [4.98, 1.1], [6.22, 1.15]];

const SFX: Record<SfxName, SfxSpec> = {
	dice: { files: DICE_SLICES.map(([offset, duration]) => ({ src: "sfx/dice-roll.ogg", offset, duration })), gain: 1, jitter: 0.06 },
	// Synthesized only (no recording bundled): sharp crack, low thump, room echo.
	gunshot: { files: [], gain: 1, synthAlways: true, jitter: 0.05 },
	sword: { files: [{ src: "sfx/sword-1.ogg" }, { src: "sfx/sword-2.ogg" }, { src: "sfx/sword-3.ogg" }], gain: 0.9, jitter: 0.06 },
	hit: { files: [{ src: "sfx/hit-1.ogg" }, { src: "sfx/hit-2.ogg" }], gain: 0.9, jitter: 0.08 },
	spell: { files: [{ src: "sfx/spell-1.ogg" }, { src: "sfx/spell-2.ogg" }], gain: 0.8, synthAlways: true, jitter: 0.04 },
	fire: { files: [{ src: "sfx/spell-fire.ogg" }], gain: 0.9, jitter: 0.05 },
	door: { files: [{ src: "sfx/door-open.ogg" }, { src: "sfx/door-close.ogg" }, { src: "sfx/creak.ogg" }], gain: 0.9, jitter: 0.04 },
	coin: { files: [{ src: "sfx/coin-1.ogg" }, { src: "sfx/coin-2.ogg" }, { src: "sfx/coin-3.ogg" }], gain: 0.9, jitter: 0.05 },
	levelup: { files: [{ src: "sfx/level-up.mp3" }], gain: 0.7, synthAlways: true },
	death: { files: [{ src: "sfx/gong.ogg" }], gain: 0.7, synthAlways: true },
	roar: { files: [{ src: "sfx/roar.ogg" }], gain: 0.9, jitter: 0.08 },
	hurt: { files: [{ src: "sfx/hurt.ogg" }], gain: 0.9, jitter: 0.08 },
	lock: { files: [{ src: "sfx/lock.ogg" }], gain: 0.9, jitter: 0.04 },
	book: { files: [{ src: "sfx/book.ogg" }, { src: "sfx/page.ogg" }], gain: 0.9, jitter: 0.05 },
	gem: { files: [{ src: "sfx/gem.ogg" }], gain: 0.8, jitter: 0.05 },
	gong: { files: [{ src: "sfx/gong.ogg" }], gain: 0.8 },
	victory: { files: [{ src: "sfx/victory-sting.ogg" }], gain: 0.7 },
	draw: { files: [{ src: "sfx/draw-blade.ogg" }], gain: 0.9, jitter: 0.05 },
	footstep: { files: [{ src: "sfx/footstep.ogg" }], gain: 0.8, jitter: 0.1 },
	// The Quiet: synthesized only.
	groan: { files: [], gain: 0.7, synthAlways: true },
	bite: { files: [], gain: 0.9, synthAlways: true },
	glass: { files: [], gain: 0.9, synthAlways: true },
	car_alarm: { files: [], gain: 1, synthAlways: true },
	shotgun: { files: [], gain: 0.85, synthAlways: true },
	radio: { files: [], gain: 1, synthAlways: true },
	door_bang: { files: [], gain: 0.8, synthAlways: true },
};

/** Every bundled file path (relative to /assets/audio/), for preloading/tests. */
export function audioAssetPaths(): string[] {
	const s = new Set<string>();
	for (const layers of Object.values(RECIPES)) for (const l of layers) if (l.kind === "file") s.add(l.src);
	for (const spec of Object.values(SFX)) for (const f of spec.files) s.add(f.src);
	return [...s];
}

// ─── Synth layers ───────────────────────────────────────────────────────────

const CHORDS = {
	padWarm: [[57, 64, 69, 72], [53, 60, 65, 69], [55, 62, 67, 71], [52, 59, 64, 67]],
	padMinor: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 58], [40, 47, 52, 56]],
	padMajor: [[48, 55, 60, 64, 67], [53, 60, 65, 69], [55, 62, 67, 71], [48, 55, 64, 67, 72]],
	choir: [[50, 57, 62, 65], [46, 53, 58, 62], [48, 55, 60, 64], [45, 52, 57, 61]],
};

function synthPad(c: Ctx, out: AudioNode, chords: number[][], opts: { type: OscillatorType; cutoff: number; formant?: boolean; seconds: number; reverb: number }): Stop {
	const ac = c.ac;
	const filt = ac.createBiquadFilter();
	filt.type = "lowpass";
	filt.frequency.value = opts.cutoff;
	filt.Q.value = 0.4;
	const bus = ac.createGain();
	bus.gain.value = 0.18;
	let head: AudioNode = filt;
	if (opts.formant) {
		// "Aah" vowel: two resonant bands in parallel.
		const f1 = ac.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 760; f1.Q.value = 5;
		const f2 = ac.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 1180; f2.Q.value = 6;
		const mix = ac.createGain(); mix.gain.value = 2.2;
		filt.connect(f1); filt.connect(f2); f1.connect(mix); f2.connect(mix);
		head = mix;
	}
	head.connect(bus);
	bus.connect(out);
	const send = ac.createGain(); send.gain.value = opts.reverb; bus.connect(send); send.connect(c.reverb);
	let idx = Math.floor(Math.random() * chords.length);
	const live: { oscs: OscillatorNode[]; g: GainNode }[] = [];
	const play = () => {
		const t = ac.currentTime;
		// release previous
		for (const v of live.splice(0)) {
			v.g.gain.cancelScheduledValues(t);
			v.g.gain.setTargetAtTime(0, t, 1.2);
			setTimeout(() => stopNodes(v.oscs), 6000);
		}
		const chord = chords[idx++ % chords.length];
		for (const m of chord) {
			const g = ac.createGain();
			g.gain.setValueAtTime(0, t);
			g.gain.setTargetAtTime(1 / chord.length, t, 1.4);
			g.connect(filt);
			const oscs = [-7, 7].map((det) => {
				const o = ac.createOscillator();
				o.type = opts.type;
				o.frequency.value = mtof(m);
				o.detune.value = det + rand(-3, 3);
				if (opts.formant) {
					const lfo = ac.createOscillator(); lfo.frequency.value = rand(4.5, 5.5);
					const lg = ac.createGain(); lg.gain.value = 9; lfo.connect(lg); lg.connect(o.detune); lfo.start(t);
					setTimeout(() => stopNodes([lfo]), (opts.seconds + 8) * 1000);
				}
				o.connect(g);
				o.start(t);
				return o;
			});
			live.push({ oscs, g });
		}
	};
	play();
	const stopTimer = every(opts.seconds, opts.seconds, play);
	return () => { stopTimer(); for (const v of live) stopNodes(v.oscs); };
}

function makeSynth(c: Ctx, kind: SynthKind, out: AudioNode, emit: (e: EngineEvent) => void): Stop {
	const ac = c.ac;
	switch (kind) {
		case "wind":
		case "softWind": {
			const strong = kind === "wind";
			const src = noiseSrc(c, "brown");
			const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = strong ? 0.9 : 0.6;
			const g = ac.createGain();
			src.connect(bp); bp.connect(g); g.connect(out);
			const s1 = wander(c, bp.frequency, strong ? 250 : 180, strong ? 1100 : 600, 3, 8);
			const s2 = wander(c, g.gain, strong ? 0.35 : 0.2, strong ? 1.3 : 0.6, 2, 7);
			return () => { s1(); s2(); stopNodes([src]); };
		}
		case "rain": {
			const src = noiseSrc(c, "pink");
			const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7500;
			const g = ac.createGain(); g.gain.value = 0.9;
			src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);
			const s1 = wander(c, g.gain, 0.7, 1.0, 3, 9);
			const s2 = every(0.03, 0.12, () => burst(c, panner(c, rand(-0.8, 0.8), out), { f: rand(2500, 6000), q: 3, d: rand(0.01, 0.03), g: rand(0.05, 0.2) }));
			return () => { s1(); s2(); stopNodes([src]); };
		}
		case "fire": {
			const src = noiseSrc(c, "brown");
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
			const g = ac.createGain(); g.gain.value = 0.5;
			src.connect(lp); lp.connect(g); g.connect(out);
			const s1 = wander(c, g.gain, 0.3, 0.7, 0.5, 2);
			const s2 = every(0.04, 0.35, () => {
				const p = panner(c, rand(-0.3, 0.3), out);
				const n = Math.random() < 0.25 ? 3 : 1;
				for (let i = 0; i < n; i++) burst(c, p, { f: rand(1500, 5000), q: rand(1, 4), t: ac.currentTime + i * rand(0.01, 0.04), d: rand(0.006, 0.04), g: rand(0.15, 0.6) });
			});
			return () => { s1(); s2(); stopNodes([src]); };
		}
		case "drips":
			return every(0.8, 4.5, () => {
				const f = rand(700, 1500);
				blip(c, panner(c, rand(-0.9, 0.9), out), { f0: f, f1: f * rand(1.6, 2.4), glide: 0.035, d: rand(0.06, 0.14), g: rand(0.15, 0.4), reverb: 0.9 });
			});
		case "drone":
		case "darkDrone": {
			const dark = kind === "darkDrone";
			const base = dark ? rand(36, 41) : rand(48, 55);
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = dark ? 240 : 380; lp.Q.value = 3;
			const g = ac.createGain(); g.gain.value = 0.22;
			lp.connect(g); g.connect(out);
			const send = ac.createGain(); send.gain.value = 0.35; g.connect(send); send.connect(c.reverb);
			const ratios = dark ? [1, 1.006, 1.414, 2.01] : [1, 1.004, 1.5, 2];
			const oscs = ratios.map((r, i) => {
				const o = ac.createOscillator(); o.type = i === 2 ? "triangle" : "sawtooth"; o.frequency.value = base * r; o.connect(lp); o.start(); return o;
			});
			const s1 = wander(c, lp.frequency, dark ? 120 : 200, dark ? 420 : 650, 4, 10);
			let s2: Stop = () => {};
			if (dark) s2 = every(9, 20, () => burst(c, out, { color: "brown", type: "lowpass", f: 180, d: rand(2, 4), a: 1.2, g: 0.5, reverb: 0.6 }));
			return () => { s1(); s2(); stopNodes(oscs); };
		}
		case "birds":
			return every(1.5, 6, () => {
				const p = panner(c, rand(-0.9, 0.9), out);
				const base = rand(2400, 4200);
				const n = Math.floor(rand(2, 6));
				let t = ac.currentTime;
				for (let i = 0; i < n; i++) {
					const f = base * rand(0.85, 1.2);
					blip(c, p, { f0: f, f1: f * rand(0.7, 1.4), t, d: rand(0.05, 0.12), a: 0.01, g: rand(0.05, 0.14), reverb: 0.2 });
					t += rand(0.08, 0.2);
				}
			});
		case "owl":
			return every(9, 22, () => {
				const p = panner(c, rand(-0.8, 0.8), out);
				const t = ac.currentTime;
				const f = rand(340, 400);
				blip(c, p, { f0: f, f1: f * 0.92, t, a: 0.06, d: 0.28, g: 0.25, reverb: 0.7 });
				blip(c, p, { f0: f * 1.02, f1: f * 0.9, t: t + 0.55, a: 0.05, d: 0.18, g: 0.18, reverb: 0.7 });
				blip(c, p, { f0: f, f1: f * 0.88, t: t + 0.85, a: 0.08, d: 0.45, g: 0.25, reverb: 0.7 });
			});
		case "crickets": {
			const stops: Stop[] = [];
			for (let k = 0; k < 3; k++) {
				const p = panner(c, rand(-0.9, 0.9), out);
				const f = rand(4200, 5200);
				stops.push(every(0.4, 1.4, () => {
					let t = ac.currentTime;
					const pulses = Math.floor(rand(2, 5));
					for (let i = 0; i < pulses; i++) { blip(c, p, { f0: f, t, a: 0.004, d: 0.03, g: 0.05 }); t += 0.045; }
				}));
			}
			return () => stops.forEach((s) => s());
		}
		case "surf": {
			const src = noiseSrc(c, "pink");
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 500;
			const g = ac.createGain(); g.gain.value = 0.1;
			src.connect(lp); lp.connect(g); g.connect(out);
			const swell = () => {
				const t = ac.currentTime; const up = rand(2.5, 4); const down = rand(3, 5);
				g.gain.cancelScheduledValues(t); lp.frequency.cancelScheduledValues(t);
				g.gain.setTargetAtTime(rand(0.6, 1), t, up / 3); g.gain.setTargetAtTime(0.1, t + up, down / 3);
				lp.frequency.setTargetAtTime(rand(1500, 2600), t, up / 3); lp.frequency.setTargetAtTime(450, t + up, down / 3);
			};
			const s = every(6.5, 10, swell, true);
			return () => { s(); stopNodes([src]); };
		}
		case "thunder":
			return every(10, 28, () => {
				const t = ac.currentTime;
				emit("thunder");
				if (Math.random() < 0.6) burst(c, out, { f: 3000, type: "highpass", t, d: 0.25, g: 0.4, reverb: 0.5 });
				burst(c, out, { color: "brown", type: "lowpass", f: rand(500, 900), f1: 120, t: t + rand(0.05, 0.6), a: rand(0.05, 0.4), d: rand(3, 6), g: 1, reverb: 0.8 });
			});
		case "padWarm":
			return synthPad(c, out, CHORDS.padWarm, { type: "triangle", cutoff: 1400, seconds: 9, reverb: 0.5 });
		case "padMinor":
			return synthPad(c, out, CHORDS.padMinor, { type: "sawtooth", cutoff: 700, seconds: 7, reverb: 0.5 });
		case "padMajor":
			return synthPad(c, out, CHORDS.padMajor, { type: "triangle", cutoff: 2200, seconds: 6, reverb: 0.6 });
		case "choir":
			return synthPad(c, out, CHORDS.choir, { type: "sawtooth", cutoff: 2600, formant: true, seconds: 10, reverb: 0.9 });
		case "heartbeat":
			return every(1.05, 1.15, () => {
				const t = ac.currentTime;
				blip(c, out, { f0: 70, f1: 40, t, a: 0.01, d: 0.18, g: 0.9 });
				blip(c, out, { f0: 60, f1: 36, t: t + 0.24, a: 0.01, d: 0.22, g: 0.65 });
			}, true);
		case "drums": {
			const pattern = [1, 0, 0.5, 0, 1, 0.4, 0.6, 0];
			let step = 0;
			return every(0.21, 0.21, () => {
				const t = ac.currentTime; const v = pattern[step++ % pattern.length];
				if (v) blip(c, out, { f0: 110, f1: 50, t, a: 0.004, d: 0.35, g: 0.8 * v, reverb: 0.4 });
				if (step % 8 === 5) burst(c, out, { f: 1800, q: 0.7, t, d: 0.12, g: 0.25, reverb: 0.3 });
			}, true);
		}
		case "crowd": {
			// Murmur: several formant-filtered noise voices with random swells, plus mug clinks.
			const stops: Stop[] = [];
			const srcs: AudioBufferSourceNode[] = [];
			for (let k = 0; k < 5; k++) {
				const src = noiseSrc(c, "pink");
				const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 4;
				const g = ac.createGain();
				src.connect(bp); bp.connect(g); g.connect(panner(c, rand(-0.7, 0.7), out));
				stops.push(wander(c, bp.frequency, 300, 1400, 0.12, 0.35), wander(c, g.gain, 0, 0.5, 0.15, 0.6));
				srcs.push(src);
			}
			stops.push(every(2, 7, () => blip(c, panner(c, rand(-0.8, 0.8), out), { f0: rand(2200, 3400), t: ac.currentTime, d: 0.25, g: 0.06, reverb: 0.4 })));
			return () => { stops.forEach((s) => s()); stopNodes(srcs); };
		}
		case "creaks":
			return every(6, 15, () => {
				const t = ac.currentTime;
				const o = ac.createOscillator(); o.type = "sawtooth";
				o.frequency.setValueAtTime(rand(90, 140), t);
				o.frequency.linearRampToValueAtTime(rand(60, 110), t + 0.8);
				const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 6;
				const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
				o.connect(bp); bp.connect(g); g.connect(panner(c, rand(-0.6, 0.6), out));
				o.start(t); o.stop(t + 1);
			});
		default:
			return isScoreKind(kind) ? makeScoreSynth(c, kind, out) : makeQuietSynth(c, kind, out);
	}
}

// ─── Synth SFX ──────────────────────────────────────────────────────────────

function synthSfx(c: Ctx, name: SfxName, out: AudioNode) {
	const ac = c.ac;
	const t = ac.currentTime;
	switch (name) {
		case "dice": {
			let tt = t;
			for (let i = 0; i < 9; i++) {
				burst(c, out, { f: rand(2000, 4500), q: 3, t: tt, d: rand(0.01, 0.03), g: rand(0.2, 0.6) * (1 - i / 11) });
				tt += rand(0.03, 0.12) * (1 + i * 0.12);
			}
			break;
		}
		case "gunshot":
			burst(c, out, { f: 3500, f1: 900, q: 0.7, t, d: 0.09, g: 1 });
			blip(c, out, { f0: 140, f1: 40, t, d: 0.25, g: 0.9 });
			burst(c, out, { color: "pink", type: "lowpass", f: 1400, f1: 300, t: t + 0.02, d: 0.9, g: 0.35, reverb: 0.9 });
			break;
		case "sword":
		case "draw":
			burst(c, out, { f: 5000, f1: 2500, q: 1.5, t, d: 0.18, g: 0.5 });
			for (const r of [1, 2.76, 5.4]) blip(c, out, { type: "sine", f0: 820 * r * rand(0.97, 1.03), t, d: 0.6 / r, g: 0.12 / r, reverb: 0.3 });
			break;
		case "hit":
		case "hurt":
			blip(c, out, { f0: 160, f1: 50, t, d: 0.2, g: 0.8 });
			burst(c, out, { color: "pink", type: "lowpass", f: 1200, t, d: 0.12, g: 0.5 });
			break;
		case "spell":
		case "gem":
			for (let i = 0; i < 10; i++) blip(c, panner(c, rand(-0.6, 0.6), out), { f0: mtof(72 + pick([0, 4, 7, 11, 12, 16, 19])), t: t + i * 0.045, d: 0.5, g: 0.07, reverb: 0.8 });
			burst(c, out, { f: 600, f1: 5000, q: 2, t, a: 0.25, d: 0.5, g: 0.2, reverb: 0.6 });
			break;
		case "fire":
			burst(c, out, { color: "brown", type: "lowpass", f: 300, f1: 2500, t, a: 0.1, d: 0.8, g: 0.9, reverb: 0.3 });
			break;
		case "door":
			blip(c, out, { type: "sawtooth", f0: 120, f1: 80, t, a: 0.15, d: 0.7, g: 0.12 });
			blip(c, out, { f0: 90, f1: 45, t: t + 0.75, d: 0.25, g: 0.7, reverb: 0.4 });
			break;
		case "coin":
			for (let i = 0; i < 4; i++) blip(c, out, { f0: rand(3800, 5200), t: t + i * rand(0.04, 0.09), d: 0.25, g: 0.12, reverb: 0.2 });
			break;
		case "levelup":
			[60, 64, 67, 72, 76, 79, 84].forEach((m, i) => blip(c, out, { type: "triangle", f0: mtof(m), t: t + i * 0.07, d: 0.9, g: 0.1, reverb: 0.7 }));
			break;
		case "death":
			for (const [m, dt] of [[45, 0], [40, 0.5], [33, 1.1]] as const) {
				blip(c, out, { type: "sawtooth", f0: mtof(m), f1: mtof(m) * 0.94, t: t + dt, a: 0.08, d: 2.4, g: 0.08, reverb: 0.9 });
				blip(c, out, { f0: mtof(m - 12), t: t + dt, a: 0.05, d: 2.8, g: 0.25, reverb: 0.9 });
			}
			break;
		case "roar":
			burst(c, out, { color: "brown", type: "bandpass", f: 300, f1: 160, q: 2, t, a: 0.12, d: 1, g: 1 });
			break;
		case "lock":
			blip(c, out, { type: "square", f0: 1800, t, d: 0.03, g: 0.15 });
			blip(c, out, { type: "square", f0: 1200, t: t + 0.12, d: 0.04, g: 0.2 });
			break;
		case "book":
			burst(c, out, { f: 3000, q: 0.5, t, a: 0.05, d: 0.25, g: 0.3 });
			break;
		case "gong":
			for (const r of [1, 1.52, 2.31, 2.9]) blip(c, out, { f0: 110 * r, t, a: 0.01, d: 3 / r, g: 0.2 / r, reverb: 0.9 });
			break;
		case "victory":
			[[60, 0], [64, 0.15], [67, 0.3], [72, 0.45]].forEach(([m, dt]) => blip(c, out, { type: "triangle", f0: mtof(m), t: t + dt, d: dt === 0.45 ? 1.4 : 0.3, g: 0.15, reverb: 0.6 }));
			break;
		case "footstep":
			burst(c, out, { color: "pink", type: "lowpass", f: 600, t, d: 0.1, g: 0.5 });
			break;
		default:
			quietSfx(c, name, out);
	}
}

// ─── Engine ─────────────────────────────────────────────────────────────────

interface ActiveTrack {
	track: PlayableTrack;
	gain: GainNode;
	stops: Stop[];
	token: number;
}

export class AmbienceEngine {
	private c: Ctx | null = null;
	private master: GainNode | null = null;
	private comp: DynamicsCompressorNode | null = null;
	private musicBus: GainNode | null = null;
	private sfxBus: GainNode | null = null;
	private active: ActiveTrack | null = null;
	private token = 0;
	private buffers = new Map<string, Promise<AudioBuffer | null>>();
	private listeners = new Map<EngineEvent, Set<() => void>>();
	private state: AmbienceEngineState = { unlocked: false, muted: false, track: "none", volumes: { music: 0.6, sfx: 0.8 } };
	private unlocking: Promise<void> | null = null;

	getState(): AmbienceEngineState {
		return this.state;
	}

	/** Subscribe to "state" (unlock/mute/track/volume changes) or "thunder" (storm flashes). */
	on(event: EngineEvent, cb: () => void): () => void {
		let set = this.listeners.get(event);
		if (!set) this.listeners.set(event, (set = new Set()));
		set.add(cb);
		return () => set!.delete(cb);
	}

	private emit(event: EngineEvent) {
		this.listeners.get(event)?.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
	}

	private patch(p: Partial<AmbienceEngineState>) {
		this.state = { ...this.state, ...p };
		this.emit("state");
	}

	/** Must be called from a user gesture (click/keydown). Safe to call repeatedly. */
	unlock(): Promise<void> {
		if (typeof window === "undefined") return Promise.resolve();
		if (this.c) {
			if (this.c.ac.state === "suspended") return this.c.ac.resume().catch(() => {});
			return Promise.resolve();
		}
		if (this.unlocking) return this.unlocking;
		const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AC) return Promise.resolve();
		const ac = new AC({ latencyHint: "playback" });
		const comp = ac.createDynamicsCompressor();
		comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
		comp.connect(ac.destination);
		this.comp = comp;
		this.master = ac.createGain();
		this.master.gain.value = this.state.muted ? 0 : 1;
		this.master.connect(comp);
		this.musicBus = ac.createGain();
		this.sfxBus = ac.createGain();
		this.musicBus.connect(this.master);
		this.sfxBus.connect(this.master);
		const conv = ac.createConvolver();
		conv.buffer = makeImpulse(ac);
		const wet = ac.createGain(); wet.gain.value = 0.35;
		conv.connect(wet); wet.connect(this.musicBus);
		this.c = { ac, reverb: conv, noise: { white: makeNoise(ac, "white"), pink: makeNoise(ac, "pink"), brown: makeNoise(ac, "brown") } };
		this.applyVolumes(true);
		this.unlocking = ac.resume().catch(() => {}).then(() => {
			this.unlocking = null;
			this.patch({ unlocked: true });
			const want = this.state.track;
			this.state = { ...this.state, track: "none" };
			this.setTrack(want);
		});
		return this.unlocking;
	}

	/** Pause/resume the whole context (e.g. when the tab is hidden). */
	suspend(suspended: boolean) {
		const ac = this.c?.ac;
		if (!ac) return;
		if (suspended && ac.state === "running") ac.suspend().catch(() => {});
		if (!suspended && ac.state === "suspended") ac.resume().catch(() => {});
	}

	setVolumes(v: Partial<AudioVolumes>) {
		const volumes = { ...this.state.volumes, ...v };
		volumes.music = Math.max(0, Math.min(1, volumes.music));
		volumes.sfx = Math.max(0, Math.min(1, volumes.sfx));
		if (volumes.music === this.state.volumes.music && volumes.sfx === this.state.volumes.sfx) return;
		this.state = { ...this.state, volumes };
		this.applyVolumes();
		this.emit("state");
	}

	private applyVolumes(immediate = false) {
		if (!this.c || !this.musicBus || !this.sfxBus) return;
		const t = this.c.ac.currentTime;
		// Squared curve feels more linear to the ear.
		const m = this.state.volumes.music ** 2;
		const s = this.state.volumes.sfx ** 2;
		if (immediate) { this.musicBus.gain.value = m; this.sfxBus.gain.value = s; return; }
		this.musicBus.gain.setTargetAtTime(m, t, 0.08);
		this.sfxBus.gain.setTargetAtTime(s, t, 0.05);
	}

	setMuted(muted: boolean) {
		if (muted === this.state.muted) return;
		if (this.master && this.c) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.c.ac.currentTime, 0.12);
		this.patch({ muted });
	}

	/** Crossfades to a new ambience bed. Before unlock it just remembers the request. */
	setTrack(track: PlayableTrack) {
		if (track === this.state.track && (this.active?.track === track || !this.c)) return;
		this.patch({ track });
		const c = this.c;
		if (!c || !this.musicBus || !this.state.unlocked) return;
		const now = c.ac.currentTime;
		const old = this.active;
		if (old) {
			old.gain.gain.cancelScheduledValues(now);
			old.gain.gain.setValueAtTime(old.gain.gain.value, now);
			old.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_S);
			setTimeout(() => { old.stops.forEach((s) => s()); try { old.gain.disconnect(); } catch { /* ignore */ } }, (CROSSFADE_S + 0.3) * 1000);
		}
		this.active = null;
		if (track === "none") return;
		const token = ++this.token;
		const gain = c.ac.createGain();
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(1, now + CROSSFADE_S);
		gain.connect(this.musicBus);
		const active: ActiveTrack = { track, gain, stops: [], token };
		this.active = active;
		const emit = (e: EngineEvent) => { if (this.active === active) this.emit(e); };
		const recipe = (QUIET_PREVIEW_TRACKS as readonly string[]).includes(track) ? PREVIEW_RECIPES[track as PreviewTrack] : RECIPES[track as Exclude<AmbienceTrack, "none">];
		for (const layer of recipe) {
			const lg = c.ac.createGain();
			if (layer.kind === "file" && layer.lowpass) {
				const lp = c.ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = layer.lowpass; lp.Q.value = 0.4;
				lg.connect(lp); lp.connect(gain);
			} else lg.connect(gain);
			if (layer.kind === "synth") {
				lg.gain.value = layer.gain;
				active.stops.push(makeSynth(c, layer.synth, lg, emit));
				continue;
			}
			lg.gain.value = 0;
			this.load(layer.src).then((buf) => {
				if (this.active !== active || active.token !== token) return;
				if (!buf) {
					lg.gain.value = layer.gain;
					for (const s of layer.fallback ?? []) active.stops.push(makeSynth(c, s, lg, emit));
					return;
				}
				const t = c.ac.currentTime;
				lg.gain.setValueAtTime(0, t);
				lg.gain.linearRampToValueAtTime(layer.gain, t + 1.5);
				active.stops.push(this.playLoop(buf, lg, layer.mode));
			});
		}
	}

	private playLoop(buf: AudioBuffer, out: AudioNode, mode: "xfade" | "native" | "once"): Stop {
		const ac = this.c!.ac;
		if (mode !== "xfade" || buf.duration < 8) {
			const s = ac.createBufferSource();
			s.buffer = buf;
			s.loop = mode !== "once";
			s.connect(out);
			s.start(ac.currentTime, mode === "native" || mode === "once" ? 0 : Math.random() * buf.duration);
			return () => stopNodes([s]);
		}
		// Overlap-loop: alternating sources with equal-power-ish fades, random start.
		const fade = Math.min(3, buf.duration / 4);
		const segLen = buf.duration - fade;
		let alive = true;
		let next = ac.currentTime;
		let offset = Math.random() * segLen * 0.6;
		const srcs = new Set<AudioBufferSourceNode>();
		const schedule = () => {
			while (alive && next < ac.currentTime + 4) {
				const s = ac.createBufferSource();
				s.buffer = buf;
				const g = ac.createGain();
				const len = buf.duration - offset;
				g.gain.setValueAtTime(0, next);
				g.gain.linearRampToValueAtTime(1, next + fade);
				g.gain.setValueAtTime(1, next + len - fade);
				g.gain.linearRampToValueAtTime(0, next + len);
				s.connect(g); g.connect(out);
				s.start(next, offset);
				s.stop(next + len + 0.05);
				srcs.add(s);
				s.onended = () => { srcs.delete(s); try { g.disconnect(); } catch { /* ignore */ } };
				next += len - fade;
				offset = 0;
			}
		};
		schedule();
		const id = setInterval(schedule, 1000);
		return () => { alive = false; clearInterval(id); stopNodes([...srcs]); };
	}

	private load(src: string): Promise<AudioBuffer | null> {
		const c = this.c;
		if (!c) return Promise.resolve(null);
		let p = this.buffers.get(src);
		if (!p) {
			p = fetch(BASE + src)
				.then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
				.then((ab) => new Promise<AudioBuffer>((res, rej) => { const pr = c.ac.decodeAudioData(ab, res, rej); if (pr && typeof pr.catch === "function") pr.catch(rej); }))
				.catch(() => null);
			this.buffers.set(src, p);
		}
		return p;
	}

	/** Warm the cache for SFX (call after unlock). */
	preloadSfx(names: SfxName[] = SFX_NAMES) {
		if (!this.c) return;
		for (const n of names) for (const f of SFX[n].files) void this.load(f.src);
	}

	/** Plays a one-shot effect. Ignored until audio is unlocked. */
	playSfx(name: SfxName, opts: SfxOptions = {}) {
		const c = this.c;
		if (!c || !this.sfxBus || c.ac.state !== "running") return;
		const spec = SFX[name];
		if (!spec) return;
		const g = c.ac.createGain();
		g.gain.value = spec.gain * (opts.volume ?? 1);
		g.connect(this.sfxBus);
		const out = opts.pan ? panner(c, opts.pan, g) : g;
		const variant = spec.files.length ? pick(spec.files) : null;
		let synthDone = false;
		const doSynth = () => { if (!synthDone) { synthDone = true; synthSfx(c, name, out); } };
		if (spec.synthAlways || !variant) doSynth();
		if (!variant) return;
		this.load(variant.src).then((buf) => {
			if (!buf) return doSynth();
			const s = c.ac.createBufferSource();
			s.buffer = buf;
			if (spec.jitter) s.playbackRate.value = 1 + rand(-spec.jitter, spec.jitter);
			const t = c.ac.currentTime;
			if (variant.duration) {
				// Fade the tail of a slice to avoid clicks.
				const fg = c.ac.createGain();
				s.connect(fg); fg.connect(out);
				fg.gain.setValueAtTime(1, t + variant.duration - 0.12);
				fg.gain.linearRampToValueAtTime(0, t + variant.duration);
				s.start(t, variant.offset ?? 0, variant.duration);
			} else {
				s.connect(out);
				s.start(t);
			}
			s.onended = () => { try { g.disconnect(); } catch { /* ignore */ } };
		});
	}

	/**
	 * Dev/QA only: an AnalyserNode tapping the mix before ("pre") or after
	 * ("post") the master compressor, for level checks. Null before unlock.
	 */
	meterTap(where: "pre" | "post" = "post"): AnalyserNode | null {
		const c = this.c;
		const node = where === "pre" ? this.master : this.comp;
		if (!c || !node) return null;
		const an = c.ac.createAnalyser();
		an.fftSize = 8192;
		node.connect(an);
		return an;
	}

	dispose() {
		this.active?.stops.forEach((s) => s());
		this.active = null;
		void this.c?.ac.close().catch(() => {});
		this.c = null;
		this.buffers.clear();
		this.patch({ unlocked: false });
	}
}

let singleton: AmbienceEngine | null = null;

/** Shared engine instance in the browser; null during SSR. */
export function getAmbienceEngine(): AmbienceEngine | null {
	if (typeof window === "undefined") return null;
	return (singleton ??= new AmbienceEngine());
}

/** Fire-and-forget SFX helper (no-op on the server or before unlock). */
export function playSfx(name: SfxName, opts?: SfxOptions): void {
	getAmbienceEngine()?.playSfx(name, opts);
}
