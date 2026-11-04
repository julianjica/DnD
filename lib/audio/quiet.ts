/**
 * "The Quiet" (zombie ruleset) audio: procedural Web Audio layers and SFX.
 *
 * Every sound here is synthesized at runtime (no recordings, no samples), and
 * every motif is generated from simple original rules (chord tones, random
 * walks), so nothing imitates an existing piece. Recipes that use these layers
 * live in lib/audio/ambience.ts (the q_* tracks). Levels follow the existing
 * beds: individual events peak around 0.1–0.6 before the layer gain.
 */

import { blip, burst, every, makeImpulse, mtof, noiseSrc, panner, pick, rand, sequence, stopNodes, wander, type Ctx, type Stop } from "./kit";

export type QuietSynthKind =
	| "qPadCold" | "qCarAlarm" | "qDogBark" | "qSignCreak" | "qCityRumble"
	| "qSirens" | "qHelicopter" | "qScreams" | "qChurchBell" | "qAlarmBell" | "qFarShots"
	| "qCrickets" | "qMoans" | "qFarShot"
	| "qFluoHum" | "qFlicker" | "qMonitor"
	| "qClock" | "qPiano"
	| "qBreath" | "qSwell" | "qGroanLow"
	| "qHordeBed" | "qMoansNear" | "qShuffle" | "qBanging"
	| "qChase" | "qCombat"
	| "qStatic" | "qTuning" | "qNumbers"
	| "qGrief";

export type QuietSfxName = "groan" | "bite" | "glass" | "car_alarm" | "shotgun" | "radio" | "door_bang";

// ─── Building blocks ────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** Smooth bump 0→1→0 over x∈[0,1] (sin²), used for passes and swells. */
const bell = (x: number) => { const s = Math.sin(Math.PI * clamp(x, 0, 1)); return s * s; };

function curve(dur: number, rate: number, f: (x: number) => number): Float32Array {
	const n = Math.max(2, Math.ceil(dur * rate) + 1);
	const a = new Float32Array(n);
	for (let i = 0; i < n; i++) { const v = f((i / (n - 1)) * dur); a[i] = Number.isFinite(v) ? v : 0; }
	return a;
}

interface CurveVoice {
	t: number;
	dur: number;
	/** Oscillator type, or a noise colour. */
	src: OscillatorType | "white" | "pink" | "brown";
	/** Frequency in Hz over time (oscillators). */
	freq?: (x: number) => number;
	/** Amplitude over time; should start and end at 0. */
	gain: (x: number) => number;
	filter?: { type: BiquadFilterType; f: number | ((x: number) => number); q?: number };
	pan?: number | ((x: number) => number);
	reverb?: number;
	rate?: number;
}

/** One voice whose pitch, level, filter and pan follow curves (sirens, alarms, passes). */
function curveVoice(c: Ctx, out: AudioNode, o: CurveVoice) {
	const ac = c.ac;
	const rate = o.rate ?? 120;
	let src: AudioScheduledSourceNode;
	if (o.src === "white" || o.src === "pink" || o.src === "brown") {
		const s = ac.createBufferSource(); s.buffer = c.noise[o.src]; s.loop = true; src = s;
		s.start(o.t, Math.random() * 3);
	} else {
		const osc = ac.createOscillator(); osc.type = o.src;
		if (o.freq) osc.frequency.setValueCurveAtTime(curve(o.dur, rate, o.freq), o.t, o.dur);
		src = osc;
		osc.start(o.t);
	}
	let head: AudioNode = src;
	if (o.filter) {
		const f = ac.createBiquadFilter(); f.type = o.filter.type; f.Q.value = o.filter.q ?? 0.8;
		const ff = o.filter.f;
		if (typeof ff === "number") f.frequency.value = ff; else f.frequency.setValueCurveAtTime(curve(o.dur, 30, ff), o.t, o.dur);
		head.connect(f); head = f;
	}
	const g = ac.createGain();
	g.gain.value = 0;
	g.gain.setValueCurveAtTime(curve(o.dur, rate, o.gain), o.t, o.dur);
	head.connect(g);
	let dest: AudioNode = out;
	if (typeof o.pan === "number") dest = panner(c, o.pan, out);
	else if (o.pan && typeof ac.createStereoPanner === "function") {
		const pf = o.pan;
		const p = ac.createStereoPanner(); p.pan.value = 0;
		p.pan.setValueCurveAtTime(curve(o.dur, 30, (x) => clamp(pf(x), -1, 1)), o.t, o.dur);
		p.connect(out); dest = p;
	}
	g.connect(dest);
	if (o.reverb) { const s = ac.createGain(); s.gain.value = o.reverb; g.connect(s); s.connect(c.reverb); }
	src.stop(o.t + o.dur + 0.05);
}

/** A lowpass in front of `out`, for "far away" events. */
function distance(c: Ctx, out: AudioNode, cutoff: number): BiquadFilterNode {
	const f = c.ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff; f.Q.value = 0.5;
	f.connect(out);
	return f;
}

/** tanh soft-clip curve for the distorted synths. */
function shaper(c: Ctx, drive: number): WaveShaperNode {
	const ws = c.ac.createWaveShaper();
	const n = 1024; const a = new Float32Array(n); const norm = Math.tanh(drive);
	for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; a[i] = Math.tanh(drive * x) / norm; }
	ws.curve = a; ws.oversample = "2x";
	return ws;
}

/**
 * A dead throat: a sawtooth at a low, sagging pitch through two vocal formants,
 * roughened by fast amplitude flutter, with a breath of noise. `near` keeps the
 * top end; far voices are dull and mostly reverb.
 */
function moan(c: Ctx, out: AudioNode, o: { t?: number; f0: number; dur: number; g: number; near?: boolean; pan?: number }) {
	const ac = c.ac;
	const t = o.t ?? ac.currentTime;
	const d = o.dur;
	const osc = ac.createOscillator(); osc.type = "sawtooth";
	osc.frequency.setValueAtTime(o.f0 * 0.9, t);
	osc.frequency.linearRampToValueAtTime(o.f0 * rand(1.05, 1.18), t + d * rand(0.2, 0.4));
	osc.frequency.exponentialRampToValueAtTime(o.f0 * rand(0.62, 0.8), t + d);
	const vib = ac.createOscillator(); vib.frequency.value = rand(4, 7);
	const vg = ac.createGain(); vg.gain.value = rand(8, 25); vib.connect(vg); vg.connect(osc.detune);
	// Rasp: amplitude flutter at 25–40 Hz.
	const rasp = ac.createGain(); rasp.gain.value = 0.6;
	const fl = ac.createOscillator(); fl.frequency.value = rand(25, 40);
	const flg = ac.createGain(); flg.gain.value = 0.4; fl.connect(flg); flg.connect(rasp.gain);
	osc.connect(rasp);
	const f1 = ac.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = rand(380, 650); f1.Q.value = 5;
	const f2 = ac.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = rand(850, 1250); f2.Q.value = 7;
	f1.frequency.setValueAtTime(f1.frequency.value, t);
	f1.frequency.linearRampToValueAtTime(f1.frequency.value * rand(0.8, 1.2), t + d);
	const mix = ac.createGain(); mix.gain.value = 2.4;
	rasp.connect(f1); rasp.connect(f2); f1.connect(mix); f2.connect(mix);
	const breath = ac.createBufferSource(); breath.buffer = c.noise.pink; breath.loop = true;
	const bf = ac.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = f1.frequency.value * 1.4; bf.Q.value = 1.5;
	const bg = ac.createGain(); bg.gain.value = 0.35;
	breath.connect(bf); bf.connect(bg); bg.connect(mix);
	const env = ac.createGain();
	env.gain.setValueAtTime(0.0001, t);
	env.gain.exponentialRampToValueAtTime(o.g, t + d * rand(0.2, 0.35));
	env.gain.setTargetAtTime(o.g * 0.6, t + d * 0.45, d * 0.2);
	env.gain.exponentialRampToValueAtTime(0.0001, t + d);
	const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = o.near ? rand(2200, 3200) : rand(800, 1300);
	mix.connect(lp); lp.connect(env);
	env.connect(panner(c, o.pan ?? rand(-0.9, 0.9), out));
	const send = ac.createGain(); send.gain.value = o.near ? 0.35 : 0.9; env.connect(send); send.connect(c.reverb);
	for (const s of [osc, vib, fl]) s.start(t);
	breath.start(t, Math.random() * 3);
	for (const s of [osc, vib, fl, breath]) s.stop(t + d + 0.1);
}

/** A gunshot heard from blocks away: dull crack, long slap-back off the buildings. */
function farShot(c: Ctx, out: AudioNode, t: number, g: number) {
	const p = panner(c, rand(-0.8, 0.8), distance(c, out, rand(900, 1500)));
	burst(c, p, { f: 2500, f1: 600, q: 0.7, t, d: 0.08, g: g, reverb: 1 });
	blip(c, p, { f0: 120, f1: 40, t, d: 0.3, g: g * 0.8 });
	burst(c, p, { color: "pink", type: "lowpass", f: 900, f1: 200, t: t + rand(0.25, 0.5), d: 0.7, g: g * 0.35, reverb: 1 });
}

/** Bell-like strike from inharmonic partials (church bell when low, small bells when high). */
function bellStrike(c: Ctx, out: AudioNode, t: number, f: number, g: number, decay = 4) {
	const partials: [number, number, number][] = [[0.5, 0.45, 1.5], [1, 0.6, 1.1], [1.19, 0.32, 0.9], [1.5, 0.18, 0.7], [2, 0.42, 0.75], [2.51, 0.14, 0.5], [2.66, 0.1, 0.45], [3.01, 0.07, 0.35]];
	for (const [r, a, k] of partials) blip(c, out, { f0: f * r * rand(0.998, 1.002), t, a: 0.004, d: decay * k, g: g * a, reverb: 0.7 });
	burst(c, out, { f: 2600, type: "highpass", t, d: 0.03, g: g * 0.25 });
}

/**
 * A car alarm cycling patterns (warble, whoop, beep). `close` is the SFX version:
 * bright and short. Far ones are dull and drenched in reverb.
 */
function carAlarm(c: Ctx, out: AudioNode, o: { t: number; dur: number; g: number; close?: boolean; pan?: number }) {
	const patterns = ["warble", "whoop", "beep", "yelp"] as const;
	const seq = o.close ? (["warble", "beep"] as const) : [pick(patterns), pick(patterns), pick(patterns)];
	const seg = o.dur / seq.length;
	const freq = (x: number) => {
		const p = seq[Math.min(seq.length - 1, Math.floor(x / seg))];
		const lx = x % seg;
		if (p === "warble") return 1000 + 380 * Math.sin(2 * Math.PI * 7 * lx);
		if (p === "whoop") return 620 + 1000 * ((lx % 0.55) / 0.55);
		if (p === "yelp") return 900 + 500 * Math.abs(Math.sin(Math.PI * 3.2 * lx));
		return 1250;
	};
	const gate = (x: number) => {
		const p = seq[Math.min(seq.length - 1, Math.floor(x / seg))];
		const lx = x % seg;
		if (p === "beep") return (lx % 0.32) < 0.16 ? 1 : 0;
		return 1;
	};
	const edge = Math.min(0.08, o.dur / 4);
	const env = (x: number) => Math.min(1, x / edge, (o.dur - x) / edge);
	curveVoice(c, out, {
		t: o.t, dur: o.dur, src: "square", rate: 400, freq,
		gain: (x) => o.g * gate(x) * env(x),
		filter: { type: "lowpass", f: o.close ? 4200 : rand(1100, 1600), q: 0.6 },
		pan: o.pan ?? 0, reverb: o.close ? 0.2 : 0.9,
	});
}

/** One emergency vehicle passing by somewhere in town: wail or yelp, Doppler, pan sweep. */
function sirenPass(c: Ctx, out: AudioNode, o: { t: number; dur: number; g: number }) {
	const yelp = Math.random() < 0.35;
	const period = yelp ? rand(0.3, 0.4) : rand(4, 5.5);
	const lo = rand(620, 720); const hi = lo * rand(1.8, 2.1);
	const mid = o.dur * rand(0.4, 0.6);
	const shift = rand(0.025, 0.045);
	const dir = Math.random() < 0.5 ? 1 : -1;
	const ph = Math.random();
	curveVoice(c, out, {
		t: o.t, dur: o.dur, src: "sawtooth", rate: yelp ? 200 : 60,
		freq: (x) => {
			const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (x / period + ph));
			const doppler = 1 + shift * Math.tanh((mid - x) / (o.dur * 0.1));
			return (lo + (hi - lo) * w) * doppler;
		},
		gain: (x) => o.g * (0.15 + 0.85 * bell(x / o.dur)) * Math.min(1, x / 2, (o.dur - x) / 2),
		filter: { type: "lowpass", f: (x) => 700 + 1300 * bell(x / o.dur), q: 0.7 },
		pan: (x) => dir * (-0.9 + 1.8 * (x / o.dur)),
		reverb: 0.9,
	});
}

/** A helicopter crossing the sky: rotor thump (noise chopped by a falling saw), turbine whine. */
function helicopterPass(c: Ctx, out: AudioNode, o: { t: number; dur: number; g: number }) {
	const ac = c.ac;
	const t = o.t;
	const dir = Math.random() < 0.5 ? 1 : -1;
	const src = ac.createBufferSource(); src.buffer = c.noise.brown; src.loop = true;
	const pk = ac.createBufferSource(); pk.buffer = c.noise.pink; pk.loop = true;
	const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380;
	const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1.2;
	const pkG = ac.createGain(); pkG.gain.value = 0.35;
	const chop = ac.createGain(); chop.gain.value = 0.5;
	const rotor = ac.createOscillator(); rotor.type = "sawtooth";
	const rate = rand(10, 12.5);
	rotor.frequency.setValueCurveAtTime(curve(o.dur, 30, (x) => rate * (1 + 0.03 * Math.tanh((o.dur / 2 - x) / (o.dur * 0.12)))), t, o.dur);
	const depth = ac.createGain(); depth.gain.value = -0.5;
	rotor.connect(depth); depth.connect(chop.gain);
	src.connect(lp); lp.connect(chop);
	pk.connect(bp); bp.connect(pkG); pkG.connect(chop);
	const whine = ac.createOscillator(); whine.type = "sine";
	whine.frequency.setValueCurveAtTime(curve(o.dur, 30, (x) => 1850 * (1 + 0.03 * Math.tanh((o.dur / 2 - x) / (o.dur * 0.12)))), t, o.dur);
	const wg = ac.createGain(); wg.gain.value = 0.025;
	whine.connect(wg);
	const env = ac.createGain(); env.gain.value = 0;
	env.gain.setValueCurveAtTime(curve(o.dur, 30, (x) => o.g * bell(x / o.dur)), t, o.dur);
	chop.connect(env); wg.connect(env);
	const tone = ac.createBiquadFilter(); tone.type = "lowpass";
	tone.frequency.setValueCurveAtTime(curve(o.dur, 30, (x) => 500 + 2200 * bell(x / o.dur)), t, o.dur);
	env.connect(tone);
	let dest: AudioNode = out;
	if (typeof ac.createStereoPanner === "function") {
		const p = ac.createStereoPanner();
		p.pan.setValueCurveAtTime(curve(o.dur, 30, (x) => dir * (-0.85 + 1.7 * (x / o.dur))), t, o.dur);
		p.connect(out); dest = p;
	}
	tone.connect(dest);
	const send = ac.createGain(); send.gain.value = 0.5; tone.connect(send); send.connect(c.reverb);
	src.start(t, Math.random() * 3); pk.start(t, Math.random() * 3); rotor.start(t); whine.start(t);
	for (const s of [src, pk, rotor, whine]) s.stop(t + o.dur + 0.05);
}

/** A far scream: a voice-like saw through two formants, mostly reverb. Used sparingly. */
function farScream(c: Ctx, out: AudioNode, t: number, g: number) {
	const f0 = rand(380, 820);
	const d = rand(0.7, 1.5);
	const vib = rand(5, 7);
	curveVoice(c, out, {
		t, dur: d, src: "sawtooth", rate: 200,
		freq: (x) => {
			const rise = Math.min(1, x / 0.14);
			const fall = x > d * 0.6 ? 1 - 0.25 * ((x - d * 0.6) / (d * 0.4)) : 1;
			return f0 * (0.8 + 0.45 * rise) * fall * (1 + 0.015 * Math.sin(2 * Math.PI * vib * x));
		},
		gain: (x) => g * Math.min(1, x / 0.08) * Math.max(0, 1 - Math.pow(x / d, 3)),
		filter: { type: "bandpass", f: rand(1000, 1500), q: 1.6 },
		pan: rand(-0.9, 0.9), reverb: 1.2,
	});
}

// ─── Piano-ish voice and generative motifs (safehouse, grief) ───────────────

/** Soft felt-piano tone: a few slightly stretched partials, each decaying faster than the last. */
function piano(c: Ctx, out: AudioNode, m: number, t: number, vel: number, dur = 3, send?: AudioNode, sendGain = 0.5) {
	const ac = c.ac;
	const f = mtof(m);
	const bus = ac.createGain(); bus.gain.value = vel;
	const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800 + 1400 * vel; lp.Q.value = 0.3;
	bus.connect(lp); lp.connect(out);
	if (send) { const s = ac.createGain(); s.gain.value = sendGain; lp.connect(s); s.connect(send); }
	const amps = [1, 0.42, 0.2, 0.11, 0.05];
	const oscs: OscillatorNode[] = [];
	amps.forEach((a, i) => {
		const n = i + 1;
		const o = ac.createOscillator(); o.frequency.value = f * n * (1 + 0.0004 * n * n);
		const g = ac.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(a * 0.3, t + 0.006);
		g.gain.setTargetAtTime(0, t + 0.006, dur / (1.5 + 1.2 * i));
		o.connect(g); g.connect(bus);
		o.start(t); o.stop(t + dur * 2.2);
		oscs.push(o);
	});
	burst(c, bus, { color: "pink", type: "bandpass", f: f * 4, q: 1, t, d: 0.02, g: 0.02 });
}

// A minor, warm: i – VI – III – VII and i – iv – VI – v (original, generic progressions).
const SAFE_CHORDS: { bass: number; tones: number[] }[][] = [
	[{ bass: 45, tones: [57, 60, 64] }, { bass: 41, tones: [57, 60, 65] }, { bass: 48, tones: [55, 60, 64] }, { bass: 43, tones: [55, 59, 62] }],
	[{ bass: 45, tones: [57, 60, 64] }, { bass: 38, tones: [57, 62, 65] }, { bass: 41, tones: [57, 60, 65] }, { bass: 40, tones: [55, 59, 64] }],
];
const A_MINOR = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];

/** A 4-bar melody: chord tones on strong beats, stepwise motion between, a long last note. */
function makePhrase(chords: { tones: number[] }[]): { bar: number; beat: number; m: number; len: number }[] {
	const rhythms = [[0, 1.5, 2, 3], [0, 2, 3.5], [0, 1, 2], [0.5, 1, 2.5], [0, 3]];
	const notes: { bar: number; beat: number; m: number; len: number }[] = [];
	let cur = pick([64, 67, 69, 72]);
	chords.forEach((ch, bar) => {
		const r = bar === chords.length - 1 ? [0] : pick(rhythms);
		r.forEach((beat, i) => {
			const strong = beat === 0 || beat === 2;
			if (strong) {
				// nearest chord tone (one or two octaves up) to where the line is
				const cands = ch.tones.flatMap((x) => [x + 12, x + 24]).filter((x) => x >= 62 && x <= 79);
				cur = cands.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a), cands[0]);
			} else {
				const idx = A_MINOR.indexOf(cur);
				const step = pick([-1, -1, 1, 1, -2, 2]);
				cur = idx >= 0 ? A_MINOR[clamp(idx + step, 0, A_MINOR.length - 1)] : cur;
			}
			notes.push({ bar, beat, m: cur, len: bar === chords.length - 1 ? 5 : i === r.length - 1 ? 2.6 : 1.6 });
		});
	});
	return notes;
}

function safehouseMotif(c: Ctx, out: AudioNode): Stop {
	const beat = 0.92; // ~65 bpm
	let prog = pick(SAFE_CHORDS);
	let phrase = makePhrase(prog);
	let cycle = 0;
	// 6 bars per cycle: 4 bars of melody, 2 bars of just rain and the clock.
	return sequence(c, beat, (step, t) => {
		const bar = Math.floor(step / 4) % 6;
		const b = step % 4;
		if (step > 0 && step % 24 === 0) {
			cycle++;
			if (cycle % 3 === 0) { prog = pick(SAFE_CHORDS); phrase = makePhrase(prog); }
			else phrase = phrase.map((n) => (Math.random() < 0.25 ? { ...n, m: A_MINOR[clamp(A_MINOR.indexOf(n.m) + pick([-1, 1]), 0, A_MINOR.length - 1)] ?? n.m } : n));
		}
		if (bar >= 4) return;
		const ch = prog[bar];
		if (b === 0) {
			piano(c, out, ch.bass, t, 0.4, 4, c.reverb, 0.4);
			ch.tones.forEach((m, i) => piano(c, out, m, t + 0.12 * (i + 1), 0.16, 3.5, c.reverb, 0.4));
		}
		for (const n of phrase) if (n.bar === bar && Math.floor(n.beat) === b) piano(c, out, n.m, t + (n.beat - b) * beat, rand(0.42, 0.52), n.len, c.reverb, 0.5);
	});
}

// ─── Music: chase and combat (original 80s-style synth patterns) ────────────

function chase(c: Ctx, out: AudioNode): Stop {
	const ac = c.ac;
	const s16 = 60 / 120 / 4;
	// E minor, harmonic colour on the V (B major): i, VI, iv, V.
	const ROOTS = [40, 40, 36, 36, 45, 45, 47, 47];
	const CHORD: Record<number, number[]> = { 40: [0, 3, 7], 36: [0, 4, 7], 45: [0, 3, 7], 47: [0, 4, 7] };
	const bus = ac.createGain(); bus.gain.value = 0.9; bus.connect(out);
	const send = ac.createGain(); send.gain.value = 0.25; bus.connect(send); send.connect(c.reverb);
	const live: AudioScheduledSourceNode[] = [];
	let padRoot = -1;
	const stopSeq = sequence(c, s16, (step, t) => {
		const bar = Math.floor(step / 16);
		const s = step % 16;
		const section = Math.floor(bar / 4) % 4; // 0 bass+ticks, 1 +kick+pad, 2 +arp, 3 everything, filter open
		const root = ROOTS[bar % 8];
		// Bass: driving 8ths, octave jumps.
		if (s % 2 === 0) {
			const pat = [0, 0, 12, 0, 0, 12, 0, 7];
			const m = root + pat[(s / 2) % 8];
			const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m);
			const sub = ac.createOscillator(); sub.type = "square"; sub.frequency.value = mtof(m - 12);
			const sg = ac.createGain(); sg.gain.value = 0.3; sub.connect(sg);
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 6;
			const open = [500, 700, 900, 1400][section];
			lp.frequency.setValueAtTime(open * 2.2, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.22);
			const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
			o.connect(lp); sg.connect(lp); lp.connect(g); g.connect(bus);
			o.start(t); sub.start(t); o.stop(t + 0.26); sub.stop(t + 0.26);
		}
		// Ticks on every 16th, accented on the off-beats.
		burst(c, bus, { type: "highpass", f: 7500, t, d: 0.02, g: s % 4 === 2 ? 0.14 : 0.06 });
		if (section >= 1 && s % 8 === 0) blip(c, bus, { f0: 95, f1: 42, t, a: 0.003, d: 0.22, g: 0.45 });
		if (section >= 3 && s % 8 === 4) burst(c, bus, { color: "white", f: 1700, q: 0.8, t, d: 0.12, g: 0.16, reverb: 0.4 });
		// Pad: one chord per two bars.
		if (section >= 1 && s === 0 && root !== padRoot) {
			padRoot = root;
			const tones = CHORD[root].map((iv) => root + 12 + iv);
			for (const m of tones) {
				const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m); o.detune.value = rand(-8, 8);
				const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
				const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.6); g.gain.setValueAtTime(0.03, t + 3.4); g.gain.linearRampToValueAtTime(0, t + 4);
				o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + 4.05);
				live.push(o);
				if (live.length > 24) live.splice(0, live.length - 24);
			}
		}
		// Rising arpeggio: climbs an octave across each 4-bar section.
		if (section >= 2) {
			const iv = CHORD[root];
			const idx = s % 8; // 8 notes up through ~2.5 octaves, starting higher in the second half of the section
			const m = root + 12 + (bar % 4 >= 2 ? 7 : 0) + iv[idx % 3] + 12 * Math.floor(idx / 3);
			blip(c, panner(c, s % 2 ? 0.35 : -0.35, bus), { type: "square", f0: mtof(m), t, a: 0.003, d: 0.09, g: section === 3 ? 0.05 : 0.035, reverb: 0.3 });
		}
		// Riser into the loop point.
		if (bar % 16 === 15 && s === 0) burst(c, bus, { color: "white", type: "bandpass", f: 400, f1: 6000, q: 2, t, a: 1.6, d: 0.3, g: 0.12, reverb: 0.5 });
	});
	return () => { stopSeq(); stopNodes(live); };
}

function combat(c: Ctx, out: AudioNode): Stop {
	const ac = c.ac;
	const s16 = 60 / 136 / 4;
	// D minor: i, VI, VII, v (A minor colour) — two bars each.
	const ROOTS = [38, 38, 34, 34, 36, 36, 33, 33];
	const ACC = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1];
	const bus = ac.createGain(); bus.gain.value = 0.85; bus.connect(out);
	const send = ac.createGain(); send.gain.value = 0.2; bus.connect(send); send.connect(c.reverb);
	// Distortion bus for bass and stabs.
	const drive = ac.createGain(); drive.gain.value = 1;
	const ws = shaper(c, 3.5);
	const post = ac.createBiquadFilter(); post.type = "lowpass"; post.frequency.value = 3200;
	const dg = ac.createGain(); dg.gain.value = 0.22;
	drive.connect(ws); ws.connect(post); post.connect(dg); dg.connect(bus);
	return sequence(c, s16, (step, t) => {
		const bar = Math.floor(step / 16);
		const s = step % 16;
		const root = ROOTS[bar % 8];
		const acc = ACC[s];
		// Distorted 16th pulse.
		const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(root + (acc && s === 13 ? 12 : 0));
		const o2 = ac.createOscillator(); o2.type = "sawtooth"; o2.frequency.value = mtof(root) * 1.007;
		const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 4;
		lp.frequency.setValueAtTime(acc ? 1600 : 500, t); lp.frequency.exponentialRampToValueAtTime(150, t + s16 * 0.95);
		const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(acc ? 0.9 : 0.4, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + s16 * 0.95);
		o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(drive);
		o.start(t); o2.start(t); o.stop(t + s16); o2.stop(t + s16);
		// Toms: 3-3-2 feel, a descending fill in the last bar of 8.
		const tom = (f: number, v: number) => {
			blip(c, bus, { f0: f, f1: f * 0.5, t, a: 0.002, d: 0.32, g: 0.55 * v, reverb: 0.3 });
			burst(c, bus, { color: "pink", type: "lowpass", f: 1400, t, d: 0.05, g: 0.18 * v });
		};
		if (bar % 8 === 7 && s >= 8) tom([170, 150, 130, 115, 100, 90, 80, 72][s - 8], 0.85);
		else if (s === 0 || s === 6 || s === 10) tom(s === 0 ? 85 : 120, s === 0 ? 1 : 0.7);
		// Snare-ish crack on 2 and 4.
		if (s === 4 || s === 12) burst(c, bus, { color: "white", type: "bandpass", f: 2000, q: 0.7, t, d: 0.13, g: 0.22, reverb: 0.4 });
		// Chord stab every two bars.
		if (s === 0 && bar % 2 === 0) {
			for (const iv of [12, 15, 19]) {
				const so = ac.createOscillator(); so.type = "sawtooth"; so.frequency.value = mtof(root + iv);
				const sg = ac.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.25, t + 0.005); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
				so.connect(sg); sg.connect(drive); so.start(t); so.stop(t + 0.4);
			}
		}
		if (s % 2 === 0) burst(c, bus, { type: "highpass", f: 8000, t, d: 0.015, g: s % 4 === 2 ? 0.08 : 0.04 });
	});
}

// ─── Radio: static, tuning sweeps, a number-station cycle (no speech) ───────

function radioFilter(c: Ctx, out: AudioNode): AudioNode {
	const hp = c.ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 320;
	const lp = c.ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2800;
	hp.connect(lp); lp.connect(out);
	return hp;
}

const MORSE: Record<string, string> = { A: ".-", E: ".", F: "..-.", I: "..", K: "-.-", L: ".-..", N: "-.", O: "---", R: ".-.", S: "...", T: "-", U: "..-", V: "...-" };

function numbersCycle(c: Ctx, out: AudioNode, t0: number, chime: number[]) {
	const rf = radioFilter(c, out);
	let t = t0;
	// Interval signal: the session's own five-note chime, twice.
	for (let rep = 0; rep < 2; rep++) {
		for (const m of chime) { blip(c, rf, { type: "triangle", f0: mtof(m), t, a: 0.01, d: 0.45, g: 0.16 }); t += 0.38; }
		t += 0.7;
	}
	t += 0.8;
	// Morse-like burst of letters.
	const letters = Array.from({ length: Math.floor(rand(3, 6)) }, () => pick(Object.keys(MORSE)));
	for (const L of letters) {
		for (const sym of MORSE[L]) {
			const d = sym === "." ? 0.075 : 0.22;
			blip(c, rf, { type: "sine", f0: 760, t, a: 0.004, d, g: 0.12 });
			t += d + 0.08;
		}
		t += 0.22;
	}
	t += 0.9;
	// Three groups of five pitched beeps: the "numbers".
	const pitches = [600, 660, 720, 800, 880, 960];
	for (let gi = 0; gi < 3; gi++) {
		for (let k = 0; k < 5; k++) { blip(c, rf, { type: "square", f0: pick(pitches), t, a: 0.004, d: 0.12, g: 0.05 }); t += 0.32; }
		t += 0.85;
	}
	return t - t0;
}

// ─── Layers ─────────────────────────────────────────────────────────────────

export function makeQuietSynth(c: Ctx, kind: QuietSynthKind, out: AudioNode): Stop {
	const ac = c.ac;
	switch (kind) {
		case "qPadCold": {
			// Sparse low pad: open fifths and minor colours, long and slow.
			const chords = [[38, 45, 53, 57], [34, 41, 50, 53], [36, 43, 51, 55], [33, 40, 48, 52]];
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.3;
			const bus = ac.createGain(); bus.gain.value = 0.16;
			lp.connect(bus); bus.connect(out);
			const send = ac.createGain(); send.gain.value = 0.8; bus.connect(send); send.connect(c.reverb);
			let idx = Math.floor(Math.random() * chords.length);
			const live: OscillatorNode[] = [];
			const play = () => {
				const t = ac.currentTime;
				const chord = chords[idx++ % chords.length];
				for (const m of chord) {
					const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = mtof(m); o.detune.value = rand(-6, 6);
					const g = ac.createGain();
					g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 5); g.gain.setValueAtTime(0.25, t + 11); g.gain.linearRampToValueAtTime(0, t + 18);
					o.connect(g); g.connect(lp); o.start(t); o.stop(t + 18.1);
					live.push(o);
				}
				if (live.length > 16) live.splice(0, live.length - 16);
			};
			// A chord every ~14 s, with silences between some of them.
			const s = every(13, 19, () => { if (Math.random() < 0.8) play(); }, true);
			return () => { s(); stopNodes(live); };
		}
		case "qCarAlarm":
			return every(35, 80, () => carAlarm(c, out, { t: ac.currentTime + 0.05, dur: rand(6, 11), g: 0.07, pan: rand(-0.9, 0.9) }));
		case "qDogBark":
			return every(16, 42, () => {
				const p = panner(c, rand(-0.9, 0.9), distance(c, out, rand(1300, 2000)));
				const n = Math.floor(rand(2, 5));
				const f0 = rand(330, 520);
				let t = ac.currentTime + 0.05;
				for (let i = 0; i < n; i++) {
					curveVoice(c, p, {
						t, dur: 0.18, src: "sawtooth", rate: 300,
						freq: (x) => f0 * (x < 0.02 ? 0.85 + 7.5 * x : 1 - 1.8 * (x - 0.02)),
						gain: (x) => 0.35 * Math.min(1, x / 0.01) * Math.max(0, 1 - x / 0.18),
						filter: { type: "bandpass", f: rand(700, 1000), q: 1.5 }, reverb: 1,
					});
					burst(c, p, { color: "pink", f: 1100, q: 1.2, t, d: 0.1, g: 0.12, reverb: 0.8 });
					t += rand(0.28, 0.5);
				}
			});
		case "qSignCreak":
			return every(11, 26, () => {
				const p = panner(c, rand(-0.7, 0.7), out);
				const n = Math.floor(rand(2, 4));
				const base = rand(170, 240);
				const res = rand(1300, 2100);
				for (let i = 0; i < n; i++) {
					const t = ac.currentTime + 0.05 + i * rand(1.6, 2.1);
					const up = i % 2 === 0;
					const d = rand(0.5, 0.8);
					curveVoice(c, p, {
						t, dur: d, src: "sawtooth", rate: 200,
						freq: (x) => base * (up ? 1 + 0.35 * (x / d) : 1.3 - 0.3 * (x / d)) * (1 + 0.04 * Math.sin(2 * Math.PI * 23 * x)),
						gain: (x) => 0.22 * bell(x / d),
						filter: { type: "bandpass", f: res, q: 9 }, reverb: 0.4,
					});
				}
			});
		case "qCityRumble": {
			const src = noiseSrc(c, "brown");
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 150;
			const g = ac.createGain(); g.gain.value = 0.5;
			src.connect(lp); lp.connect(g); g.connect(out);
			const s1 = wander(c, g.gain, 0.35, 0.8, 3, 8);
			return () => { s1(); stopNodes([src]); };
		}
		case "qSirens": {
			const s1 = every(9, 20, () => sirenPass(c, out, { t: ac.currentTime + 0.05, dur: rand(16, 26), g: rand(0.05, 0.11) }), true);
			return s1;
		}
		case "qHelicopter":
			return every(35, 70, () => helicopterPass(c, out, { t: ac.currentTime + 0.05, dur: rand(16, 24), g: 0.6 }));
		case "qScreams":
			return every(7, 20, () => {
				const t = ac.currentTime + 0.05;
				farScream(c, out, t, rand(0.04, 0.09));
				if (Math.random() < 0.3) farScream(c, out, t + rand(0.6, 1.4), rand(0.03, 0.07));
			});
		case "qChurchBell":
			return every(26, 55, () => {
				const p = panner(c, rand(-0.5, 0.5), distance(c, out, 2600));
				const n = Math.floor(rand(5, 10));
				const t0 = ac.currentTime + 0.05;
				for (let i = 0; i < n; i++) bellStrike(c, p, t0 + i * 2.6, 196, 0.16, 4.5);
			}, true);
		case "qAlarmBell":
			return every(18, 40, () => {
				const t = ac.currentTime + 0.05;
				const d = rand(6, 11);
				const rate = rand(16, 20);
				const pan = rand(-0.9, 0.9);
				for (const [f, a] of [[1150, 1], [2790, 0.5]] as const) {
					curveVoice(c, out, {
						t, dur: d, src: "sine", rate: 400,
						freq: () => f,
						gain: (x) => 0.05 * a * Math.min(1, x / 1.2, (d - x) / 1.2) * (Math.sin(2 * Math.PI * rate * x) > 0 ? 1 : 0.15),
						filter: { type: "lowpass", f: 2400 }, pan, reverb: 0.9,
					});
				}
			});
		case "qFarShots":
			return every(18, 50, () => {
				const n = Math.random() < 0.5 ? 1 : Math.floor(rand(2, 4));
				let t = ac.currentTime + 0.05;
				for (let i = 0; i < n; i++) { farShot(c, out, t, rand(0.18, 0.3)); t += rand(0.25, 1.4); }
			});
		case "qFarShot":
			return every(60, 150, () => farShot(c, out, ac.currentTime + 0.05, rand(0.2, 0.3)));
		case "qCrickets": {
			// October: a couple of tired crickets, slow and often silent.
			const stops: Stop[] = [];
			for (let k = 0; k < 2; k++) {
				const p = panner(c, rand(-0.9, 0.9), out);
				const f = rand(3600, 4300);
				stops.push(every(1.4, 4.5, () => {
					if (Math.random() < 0.35) return;
					let t = ac.currentTime + 0.02;
					const pulses = Math.floor(rand(2, 4));
					for (let i = 0; i < pulses; i++) { blip(c, p, { f0: f, t, a: 0.006, d: 0.035, g: 0.045 }); t += 0.075; }
				}));
			}
			return () => stops.forEach((s) => s());
		}
		case "qMoans":
			return every(6, 15, () => moan(c, out, { f0: rand(70, 140), dur: rand(1.6, 3.2), g: rand(0.25, 0.5) }));
		case "qMoansNear":
			return every(1.2, 3.4, () => moan(c, out, { f0: rand(65, 130), dur: rand(1.2, 2.8), g: rand(0.25, 0.55), near: Math.random() < 0.5 }), true);
		case "qGroanLow":
			return every(16, 34, () => moan(c, out, { f0: rand(52, 68), dur: rand(2.5, 4), g: 0.5, near: true, pan: rand(-0.4, 0.4) }));
		case "qFluoHum": {
			const hum = ac.createOscillator(); hum.type = "sawtooth"; hum.frequency.value = 120;
			const mains = ac.createOscillator(); mains.type = "sine"; mains.frequency.value = 60;
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
			const hg = ac.createGain(); hg.gain.value = 0.05;
			const mg = ac.createGain(); mg.gain.value = 0.06;
			const buzz = ac.createBiquadFilter(); buzz.type = "bandpass"; buzz.frequency.value = 3200; buzz.Q.value = 3;
			const bg = ac.createGain(); bg.gain.value = 0.02;
			hum.connect(lp); lp.connect(hg); hg.connect(out);
			mains.connect(mg); mg.connect(out);
			hum.connect(buzz); buzz.connect(bg); bg.connect(out);
			hum.start(); mains.start();
			const s1 = wander(c, bg.gain, 0.008, 0.03, 2, 6);
			return () => { s1(); stopNodes([hum, mains]); };
		}
		case "qFlicker":
			return every(6, 15, () => {
				const t0 = ac.currentTime + 0.05;
				const d = rand(0.4, 1.6);
				const o = ac.createOscillator(); o.type = "square"; o.frequency.value = 120;
				const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2500; bp.Q.value = 2;
				const g = ac.createGain(); g.gain.setValueAtTime(0, t0);
				let t = t0; let on = false;
				while (t < t0 + d) {
					on = !on;
					g.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.003);
					if (on) burst(c, out, { type: "highpass", f: 4000, t, d: 0.006, g: 0.06 });
					t += rand(0.02, 0.13);
				}
				g.gain.setTargetAtTime(0, t, 0.01);
				o.connect(bp); bp.connect(g); g.connect(panner(c, rand(-0.5, 0.5), out));
				o.start(t0); o.stop(t + 0.1);
			});
		case "qMonitor": {
			// A heart monitor: beeps slow down, falter, flatline; silence; it starts again.
			let alive = true;
			let id: ReturnType<typeof setTimeout> | undefined;
			let gap = 0.75;
			const p = panner(c, rand(-0.6, 0.6), out);
			const beat = () => {
				if (!alive) return;
				const t = ac.currentTime + 0.03;
				if (gap > 2.6) {
					// flatline, then a long silence before the next patient
					curveVoice(c, p, { t, dur: 3.6, src: "sine", rate: 100, freq: () => 980, gain: (x) => 0.07 * Math.min(1, x / 0.02, (3.6 - x) / 0.6), reverb: 0.3 });
					gap = 0.75;
					id = setTimeout(beat, rand(18, 32) * 1000);
					return;
				}
				blip(c, p, { f0: 980, t, a: 0.004, d: 0.11, g: 0.09, reverb: 0.25 });
				gap *= rand(1.025, 1.065);
				const skip = Math.random() < 0.06 ? gap * 0.6 : 0;
				id = setTimeout(beat, (gap + skip) * 1000);
			};
			id = setTimeout(beat, rand(0.5, 2) * 1000);
			return () => { alive = false; if (id) clearTimeout(id); };
		}
		case "qClock":
			return sequence(c, 1, (step, t) => {
				const tick = step % 2 === 0;
				burst(c, out, { type: "bandpass", f: tick ? 3400 : 2600, q: 7, t, d: 0.012, g: 0.22 });
				blip(c, out, { f0: tick ? 1900 : 1500, t, a: 0.001, d: 0.02, g: 0.03 });
			});
		case "qPiano":
			return safehouseMotif(c, out);
		case "qBreath": {
			const src = noiseSrc(c, "pink");
			const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.8; bp.frequency.value = 800;
			const g = ac.createGain(); g.gain.value = 0;
			src.connect(bp); bp.connect(g); g.connect(out);
			const send = ac.createGain(); send.gain.value = 0.3; g.connect(send); send.connect(c.reverb);
			let alive = true;
			let id: ReturnType<typeof setTimeout> | undefined;
			const cycle = () => {
				if (!alive) return;
				const t = ac.currentTime + 0.02;
				const inh = rand(1.2, 1.8); const exh = rand(1.8, 2.6); const amp = rand(0.35, 0.6);
				g.gain.cancelScheduledValues(t); bp.frequency.cancelScheduledValues(t);
				g.gain.setValueAtTime(0, t);
				g.gain.linearRampToValueAtTime(amp * 0.7, t + inh);
				g.gain.linearRampToValueAtTime(amp, t + inh + 0.25);
				g.gain.linearRampToValueAtTime(0, t + inh + 0.25 + exh);
				bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(1300, t + inh);
				bp.frequency.linearRampToValueAtTime(650, t + inh + 0.25 + exh);
				id = setTimeout(cycle, (inh + 0.25 + exh + rand(0.8, 2.2)) * 1000);
			};
			cycle();
			return () => { alive = false; if (id) clearTimeout(id); stopNodes([src]); };
		}
		case "qSwell":
			return every(24, 48, () => {
				const t = ac.currentTime + 0.05;
				const d = rand(6, 9);
				const base = rand(46, 52);
				for (const iv of [0, 1, 6, 7, 12]) {
					const f0 = mtof(base + iv);
					curveVoice(c, out, {
						t, dur: d + 0.5, src: "sawtooth", rate: 60,
						freq: (x) => f0 * Math.pow(2, (3 * Math.min(x, d)) / d / 12),
						gain: (x) => (x < d ? 0.05 * Math.pow(x / d, 2.2) : 0.05 * Math.max(0, 1 - (x - d) / 0.5)),
						filter: { type: "lowpass", f: (x) => 250 + 2300 * Math.pow(Math.min(1, x / d), 2) }, pan: rand(-0.5, 0.5), reverb: 0.6,
					});
				}
				curveVoice(c, out, {
					t, dur: d + 0.4, src: "white",
					gain: (x) => (x < d ? 0.12 * Math.pow(x / d, 3) : 0.12 * Math.max(0, 1 - (x - d) / 0.4)),
					filter: { type: "bandpass", f: (x) => 300 + 5000 * Math.pow(Math.min(1, x / d), 2), q: 1.5 }, reverb: 0.6,
				});
			});
		case "qHordeBed": {
			// A wall of throats: several continuous formant voices with drifting pitch and swelling levels.
			const nodes: AudioScheduledSourceNode[] = [];
			const stops: Stop[] = [];
			for (let k = 0; k < 6; k++) {
				const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = rand(60, 115);
				const fl = ac.createOscillator(); fl.frequency.value = rand(24, 38);
				const rasp = ac.createGain(); rasp.gain.value = 0.6;
				const flg = ac.createGain(); flg.gain.value = 0.4; fl.connect(flg); flg.connect(rasp.gain);
				const f1 = ac.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = rand(400, 650); f1.Q.value = 4;
				const f2 = ac.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = rand(900, 1200); f2.Q.value = 5;
				const g = ac.createGain(); g.gain.value = 0;
				const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1500;
				o.connect(rasp); rasp.connect(f1); rasp.connect(f2); f1.connect(lp); f2.connect(lp); lp.connect(g);
				g.connect(panner(c, -0.8 + (1.6 * k) / 5, out));
				o.start(); fl.start();
				nodes.push(o, fl);
				stops.push(wander(c, o.frequency, 55, 120, 1.5, 4), wander(c, g.gain, 0, 0.32, 1.5, 5), wander(c, f1.frequency, 350, 700, 1, 3));
			}
			return () => { stops.forEach((s) => s()); stopNodes(nodes); };
		}
		case "qShuffle":
			return every(0.08, 0.32, () => {
				const long = Math.random() < 0.12;
				burst(c, panner(c, rand(-0.9, 0.9), out), { color: "pink", f: rand(250, 700), q: 1.2, a: long ? 0.12 : 0.03, d: long ? rand(0.4, 0.7) : rand(0.1, 0.25), g: rand(0.05, 0.16) });
			});
		case "qBanging":
			return every(2.5, 7, () => {
				const p = panner(c, rand(-0.8, 0.8), out);
				const metal = Math.random() < 0.4;
				const n = Math.floor(rand(2, 6));
				let t = ac.currentTime + 0.05;
				const v = rand(0.5, 1);
				for (let i = 0; i < n; i++) {
					if (metal) {
						const f = rand(180, 320);
						for (const [r, a] of [[1, 1], [2.76, 0.6], [5.4, 0.35], [8.9, 0.2]] as const) blip(c, p, { f0: f * r, t, a: 0.002, d: rand(0.3, 0.6) / Math.sqrt(r), g: 0.07 * a * v, reverb: 0.4 });
						burst(c, p, { type: "highpass", f: 2500, t, d: 0.03, g: 0.12 * v });
					} else {
						blip(c, p, { f0: 115, f1: 55, t, a: 0.002, d: 0.18, g: 0.55 * v, reverb: 0.3 });
						burst(c, p, { color: "pink", type: "lowpass", f: 900, t, d: 0.08, g: 0.35 * v });
					}
					t += rand(0.18, 0.45);
				}
			});
		case "qChase":
			return chase(c, out);
		case "qCombat":
			return combat(c, out);
		case "qStatic": {
			const src = noiseSrc(c, "white");
			const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 0.5;
			const hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300;
			const g = ac.createGain(); g.gain.value = 0.25;
			src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
			const s1 = wander(c, g.gain, 0.12, 0.4, 0.8, 3);
			const s2 = wander(c, bp.frequency, 1500, 3500, 2, 6);
			const s3 = every(0.05, 0.4, () => burst(c, out, { type: "highpass", f: 3000, d: rand(0.003, 0.012), g: rand(0.06, 0.3) }));
			return () => { s1(); s2(); s3(); stopNodes([src]); };
		}
		case "qTuning":
			return every(7, 15, () => {
				const t = ac.currentTime + 0.05;
				const d = rand(1, 2.4);
				const f0 = rand(300, 2800); const f1 = rand(300, 2800);
				curveVoice(c, out, { t, dur: d, src: "sine", rate: 100, freq: (x) => f0 + (f1 - f0) * (x / d), gain: (x) => 0.05 * bell(x / d) });
				curveVoice(c, out, { t, dur: d, src: "white", gain: (x) => 0.18 * bell(x / d), filter: { type: "bandpass", f: (x) => 600 + 3000 * (x / d), q: 2 } });
				// A garbled scrap of some broadcast passing under the needle (two detuned tones).
				if (Math.random() < 0.6) {
					const rf = radioFilter(c, out);
					const m = pick([57, 60, 62, 64, 67]);
					for (const det of [0, 7]) blip(c, rf, { type: "square", f0: mtof(m + det) * rand(0.99, 1.01), t: t + d * 0.45, a: 0.02, d: rand(0.25, 0.5), g: 0.025 });
				}
			});
		case "qNumbers": {
			const chime = Array.from({ length: 5 }, () => pick([69, 72, 74, 76, 79, 81]));
			let alive = true;
			let id: ReturnType<typeof setTimeout> | undefined;
			const run = () => {
				if (!alive) return;
				const len = numbersCycle(c, out, ac.currentTime + 0.1, chime);
				id = setTimeout(run, (len + rand(8, 18)) * 1000);
			};
			id = setTimeout(run, rand(2, 5) * 1000);
			return () => { alive = false; if (id) clearTimeout(id); };
		}
		case "qGrief": {
			// D minor, very slow, in a long private reverb; a low drone breathes underneath.
			const conv = ac.createConvolver(); conv.buffer = makeImpulse(ac, 6, 2);
			const wet = ac.createGain(); wet.gain.value = 0.5; conv.connect(wet); wet.connect(out);
			const dry = ac.createGain(); dry.gain.value = 0.55; dry.connect(out);
			const drone = [38, 45].map((m) => { const o = ac.createOscillator(); o.frequency.value = mtof(m); o.start(); return o; });
			const dg = ac.createGain(); dg.gain.value = 0.04;
			drone.forEach((o) => o.connect(dg)); dg.connect(out);
			const s1 = wander(c, dg.gain, 0.015, 0.05, 4, 9);
			const SCALE = [50, 52, 53, 55, 57, 58, 60, 62, 64, 65, 67, 69];
			const motif = [62, 65, 64, 60, 62];
			let i = 0;
			let alive = true;
			let id: ReturnType<typeof setTimeout> | undefined;
			const note = () => {
				if (!alive) return;
				const t = ac.currentTime + 0.05;
				const pos = i % (motif.length + 3);
				i++;
				if (pos < motif.length) {
					let m = motif[pos];
					if (Math.random() < 0.3) m = SCALE[clamp(SCALE.indexOf(m) + pick([-1, 1]), 0, SCALE.length - 1)] ?? m;
					piano(c, dry, m, t, rand(0.35, 0.45), 5, conv, 1);
					if (pos === 0) piano(c, dry, 38, t, 0.3, 6, conv, 1);
				}
				id = setTimeout(note, (pos === motif.length - 1 ? rand(7, 10) : rand(2.4, 4)) * 1000);
			};
			id = setTimeout(note, 600);
			return () => { alive = false; if (id) clearTimeout(id); s1(); stopNodes(drone); };
		}
	}
}

// ─── SFX ────────────────────────────────────────────────────────────────────

export function quietSfx(c: Ctx, name: QuietSfxName, out: AudioNode) {
	const ac = c.ac;
	const t = ac.currentTime;
	switch (name) {
		case "groan":
			moan(c, out, { t, f0: rand(70, 110), dur: rand(1.1, 1.6), g: 0.9, near: true, pan: 0 });
			break;
		case "bite":
			// wet crunch: tearing bursts, a low thud, a squelch sweeping down
			blip(c, out, { f0: 140, f1: 60, t, d: 0.15, g: 0.6 });
			for (let i = 0; i < 4; i++) burst(c, out, { f: rand(1200, 3200), q: 2, t: t + i * rand(0.025, 0.06), d: rand(0.02, 0.05), g: rand(0.3, 0.5) });
			burst(c, out, { color: "brown", type: "lowpass", f: 1400, f1: 250, q: 4, t: t + 0.06, a: 0.03, d: 0.35, g: 0.7 });
			break;
		case "glass":
			burst(c, out, { type: "highpass", f: 3000, t, d: 0.12, g: 0.7 });
			burst(c, out, { color: "pink", type: "lowpass", f: 1500, t, d: 0.08, g: 0.4 });
			for (let i = 0; i < 16; i++) {
				const tt = t + 0.02 + Math.pow(Math.random(), 1.6) * 0.8;
				blip(c, panner(c, rand(-0.7, 0.7), out), { f0: rand(2800, 7500), t: tt, a: 0.001, d: rand(0.05, 0.25), g: rand(0.04, 0.12), reverb: 0.2 });
			}
			break;
		case "car_alarm":
			carAlarm(c, out, { t: t + 0.02, dur: 3.2, g: 0.25, close: true });
			break;
		case "shotgun":
			// Bigger than the pistol: wide blast, deep boom, long room tail, then the pump.
			burst(c, out, { f: 2500, f1: 500, q: 0.5, t, d: 0.16, g: 0.8 });
			burst(c, out, { color: "brown", type: "lowpass", f: 900, f1: 120, t, a: 0.002, d: 0.7, g: 0.8 });
			blip(c, out, { f0: 95, f1: 28, t, d: 0.6, g: 0.85 });
			burst(c, out, { color: "pink", type: "lowpass", f: 1200, f1: 200, t: t + 0.03, d: 1.8, g: 0.6, reverb: 1 });
			for (const [dt, f] of [[0.65, 1800], [0.82, 1300]] as const) {
				burst(c, out, { type: "bandpass", f, q: 4, t: t + dt, d: 0.03, g: 0.45 });
				blip(c, out, { type: "square", f0: f * 0.6, t: t + dt, d: 0.02, g: 0.08 });
			}
			break;
		case "radio":
			// push-to-talk: click, a breath of squelch, click
			blip(c, out, { type: "square", f0: 1500, t, d: 0.012, g: 0.25 });
			burst(c, out, { type: "bandpass", f: 2400, q: 0.6, t: t + 0.02, a: 0.01, d: 0.28, g: 0.35 });
			blip(c, out, { type: "square", f0: 1100, t: t + 0.33, d: 0.012, g: 0.2 });
			break;
		case "door_bang":
			for (let i = 0; i < 3; i++) {
				const tt = t + i * rand(0.32, 0.42);
				blip(c, out, { f0: 100, f1: 48, t: tt, a: 0.002, d: 0.22, g: 0.9 - i * 0.1, reverb: 0.3 });
				burst(c, out, { color: "pink", type: "lowpass", f: 800, t: tt, d: 0.1, g: 0.55 });
				burst(c, out, { type: "bandpass", f: rand(2200, 3200), q: 5, t: tt + 0.01, d: 0.08, g: 0.12 });
			}
			break;
	}
}
