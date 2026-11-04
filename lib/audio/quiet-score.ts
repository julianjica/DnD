/**
 * The Quiet: "film score" layers for the empty town and dread beds.
 *
 * Second pass after listening feedback: fewer elements, slow evolution, lots
 * of space, and no literal synthesized sounds (no barks, heartbeats, breaths or
 * groans). Each layer owns a long private reverb so it sits far back. All
 * harmony and motifs are generated from simple original rules.
 */

import { every, makeImpulse, mtof, noiseSrc, pick, rand, sequence, stopNodes, wander, type Ctx, type Stop } from "./kit";

export const SCORE_KINDS = ["sDusk", "sDistantTone", "sDeepDrone", "sWires", "sFarThuds", "sStrings", "sSubPulse", "sGlass", "sReverseSwell", "sScrape"] as const;
export type ScoreSynthKind = (typeof SCORE_KINDS)[number];
export const isScoreKind = (k: string): k is ScoreSynthKind => (SCORE_KINDS as readonly string[]).includes(k);

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** A private long reverb: returns the node to send into, and a stop that disconnects it. */
function hall(c: Ctx, out: AudioNode, seconds: number, wet: number): { input: AudioNode; stop: Stop } {
	const conv = c.ac.createConvolver();
	conv.buffer = makeImpulse(c.ac, seconds, 2.2);
	const g = c.ac.createGain(); g.gain.value = wet;
	// Darken the tail: film reverbs are warm, not hissy.
	const lp = c.ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
	conv.connect(lp); lp.connect(g); g.connect(out);
	return { input: conv, stop: () => { try { conv.disconnect(); g.disconnect(); } catch { /* ignore */ } } };
}

/**
 * Slow pad: each chord fades in over `attack` seconds while the previous one
 * fades out over `release`; several detuned voices per note through one
 * lowpass whose cutoff breathes over tens of seconds.
 */
function slowPad(c: Ctx, dest: AudioNode, o: {
	chords: number[][]; type: OscillatorType; voices: number; detune: number; chordS: [number, number];
	attack: number; release: number; cutoff: [number, number]; breathe: [number, number]; level: number; onChord?: (chord: number[]) => void;
}): { stop: Stop; bus: GainNode } {
	const ac = c.ac;
	const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.5; lp.frequency.value = o.cutoff[0];
	const bus = ac.createGain(); bus.gain.value = 1;
	lp.connect(bus); bus.connect(dest);
	const s1 = wander(c, lp.frequency, o.cutoff[0], o.cutoff[1], o.breathe[0], o.breathe[1]);
	let idx = Math.floor(Math.random() * o.chords.length);
	let live: { oscs: OscillatorNode[]; g: GainNode } | null = null;
	const all = new Set<OscillatorNode>();
	const play = () => {
		const t = ac.currentTime + 0.05;
		if (live) {
			const old = live;
			old.g.gain.cancelScheduledValues(t);
			old.g.gain.setValueAtTime(old.g.gain.value, t);
			old.g.gain.linearRampToValueAtTime(0, t + o.release);
			setTimeout(() => { stopNodes(old.oscs); old.oscs.forEach((x) => all.delete(x)); }, (o.release + 0.5) * 1000);
		}
		const chord = o.chords[idx++ % o.chords.length];
		o.onChord?.(chord);
		const g = ac.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(o.level, t + o.attack);
		g.connect(lp);
		const oscs: OscillatorNode[] = [];
		const per = 1 / (chord.length * o.voices);
		for (const m of chord) {
			for (let v = 0; v < o.voices; v++) {
				const osc = ac.createOscillator(); osc.type = o.type; osc.frequency.value = mtof(m);
				osc.detune.value = (o.voices === 1 ? 0 : -o.detune + (2 * o.detune * v) / (o.voices - 1)) + rand(-2, 2);
				const vg = ac.createGain(); vg.gain.value = per;
				osc.connect(vg); vg.connect(g);
				osc.start(t + rand(0, 0.3));
				oscs.push(osc); all.add(osc);
			}
		}
		live = { oscs, g };
	};
	play();
	let id: ReturnType<typeof setTimeout> | undefined;
	let alive = true;
	const next = () => { if (!alive) return; play(); id = setTimeout(next, rand(o.chordS[0], o.chordS[1]) * 1000); };
	id = setTimeout(next, rand(o.chordS[0], o.chordS[1]) * 1000);
	return { bus, stop: () => { alive = false; if (id) clearTimeout(id); s1(); stopNodes([...all]); } };
}

/** Clean, soft pluck (guitar/felt-piano-like): a few partials with long, gentle decays. */
function pluck(c: Ctx, out: AudioNode, m: number, t: number, vel: number) {
	const ac = c.ac;
	const f = mtof(m);
	const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.3;
	lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(700, t + 2.5);
	const bus = ac.createGain(); bus.gain.value = vel;
	lp.connect(bus); bus.connect(out);
	const parts: [number, number, number][] = [[1, 0.5, 4.5], [2, 0.22, 2.6], [3, 0.09, 1.6], [4.01, 0.04, 1]];
	for (const [r, a, d] of parts) {
		const o = ac.createOscillator(); o.type = r === 1 ? "triangle" : "sine"; o.frequency.value = f * r;
		const g = ac.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(a, t + 0.004);
		g.gain.setTargetAtTime(0, t + 0.004, d / 3.5);
		o.connect(g); g.connect(lp);
		o.start(t); o.stop(t + d * 1.6 + 0.1);
	}
}

/** A metallic resonance (wind in wires / chain link): noise through very narrow bands. */
function resonantBands(c: Ctx, dest: AudioNode, freqs: number[], q: number, level: number, wanderS: [number, number]): Stop {
	const ac = c.ac;
	const src = noiseSrc(c, "pink");
	const stops: Stop[] = [];
	for (const f of freqs) {
		const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = q;
		const g = ac.createGain(); g.gain.value = 0;
		const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
		src.connect(bp); bp.connect(g);
		if (pan) { pan.pan.value = rand(-0.7, 0.7); g.connect(pan); pan.connect(dest); } else g.connect(dest);
		stops.push(wander(c, g.gain, 0, level, wanderS[0], wanderS[1]));
		stops.push(wander(c, bp.frequency, f * 0.985, f * 1.015, 4, 10));
	}
	return () => { stops.forEach((s) => s()); stopNodes([src]); };
}

// D dorian / Bb lydian colours: open, cold, a little sad.
const DUSK_CHORDS = [[38, 50, 57, 60, 64], [34, 46, 53, 57, 62], [41, 48, 55, 60, 64], [36, 48, 55, 59, 62]];
// C minor, low and string-like.
const DREAD_CHORDS = [[36, 43, 48, 51, 55], [32, 44, 48, 51, 56], [29, 41, 48, 53, 56], [31, 43, 50, 55, 58]];

export function makeScoreSynth(c: Ctx, kind: ScoreSynthKind, out: AudioNode): Stop {
	const ac = c.ac;
	switch (kind) {
		case "sDusk": {
			// Warm low pad + a sparse pluck motif drawn from the current chord, in a long hall.
			const h = hall(c, out, 7, 0.9);
			const dry = ac.createGain(); dry.gain.value = 0.6; dry.connect(out); dry.connect(h.input);
			let chord = DUSK_CHORDS[0];
			const pad = slowPad(c, dry, {
				chords: DUSK_CHORDS, type: "sawtooth", voices: 3, detune: 7, chordS: [18, 26], attack: 9, release: 10,
				cutoff: [260, 820], breathe: [10, 22], level: 0.32, onChord: (ch) => { chord = ch; },
			});
			const sub = ac.createOscillator(); sub.type = "sine"; sub.frequency.value = mtof(38);
			const subG = ac.createGain(); subG.gain.value = 0.05; sub.connect(subG); subG.connect(out); sub.start();
			// Echo for the plucks: a soft dark feedback delay.
			const dl = ac.createDelay(2); dl.delayTime.value = 0.62;
			const fb = ac.createGain(); fb.gain.value = 0.32;
			const dlp = ac.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 1600;
			const pl = ac.createGain(); pl.gain.value = 1;
			pl.connect(dry); pl.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(dry);
			let alive = true;
			let id: ReturnType<typeof setTimeout> | undefined;
			const phrase = () => {
				if (!alive) return;
				// 3–5 notes from the chord's upper tones and a neighbour, falling more than rising.
				const pool = [...chord.slice(2).map((m) => m + 12), chord[2] + 14, chord[3] + 12 + 2].filter((m) => m >= 60 && m <= 79).sort((a, b) => a - b);
				let i = Math.floor(rand(pool.length / 2, pool.length));
				let t = ac.currentTime + 0.1;
				const n = Math.floor(rand(3, 6));
				for (let k = 0; k < n; k++) {
					pluck(c, pl, pool[clamp(i, 0, pool.length - 1)], t, rand(0.16, 0.24));
					i += pick([-1, -1, -2, 1]);
					t += rand(1.1, 2.4);
				}
				id = setTimeout(phrase, (t - ac.currentTime + rand(12, 24)) * 1000);
			};
			id = setTimeout(phrase, rand(4, 9) * 1000);
			return () => { alive = false; if (id) clearTimeout(id); pad.stop(); stopNodes([sub]); h.stop(); };
		}
		case "sDistantTone":
			// Something electronic far away: a soft two-tone warble, rare, almost lost in the hall.
			return every(55, 110, () => {
				const h = hall(c, out, 6, 1);
				const t = ac.currentTime + 0.1;
				const d = rand(4, 6.5);
				const o = ac.createOscillator(); o.type = "triangle";
				const lfo = ac.createOscillator(); lfo.frequency.value = rand(1.6, 2.4);
				const lg = ac.createGain(); lg.gain.value = 140; lfo.connect(lg); lg.connect(o.frequency);
				o.frequency.value = rand(820, 980);
				const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
				const g = ac.createGain();
				g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 1.2); g.gain.setValueAtTime(0.05, t + d - 1.5); g.gain.linearRampToValueAtTime(0, t + d);
				const pan = ac.createStereoPanner(); pan.pan.value = rand(-0.8, 0.8);
				o.connect(lp); lp.connect(g); g.connect(pan); pan.connect(h.input);
				const dry = ac.createGain(); dry.gain.value = 0.15; pan.connect(dry); dry.connect(out);
				o.start(t); lfo.start(t); o.stop(t + d + 0.1); lfo.stop(t + d + 0.1);
				setTimeout(h.stop, (d + 8) * 1000);
			});
		case "sDeepDrone": {
			// Two low tones a hair apart (slow beating) + the fifth, breathing in and out of silence.
			const freqs = [mtof(28), mtof(28) * 1.004, mtof(35), mtof(40) * 0.997];
			const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220; lp.Q.value = 0.4;
			const g = ac.createGain(); g.gain.value = 0;
			lp.connect(g); g.connect(out);
			const oscs = freqs.map((f, i) => {
				const o = ac.createOscillator(); o.type = i < 2 ? "sine" : "triangle"; o.frequency.value = f;
				const vg = ac.createGain(); vg.gain.value = i < 2 ? 0.4 : 0.12;
				o.connect(vg); vg.connect(lp); o.start(); return o;
			});
			const s1 = wander(c, g.gain, 0.03, 0.22, 10, 22);
			const s2 = wander(c, lp.frequency, 140, 320, 12, 25);
			return () => { s1(); s2(); stopNodes(oscs); };
		}
		case "sWires": {
			// Wind singing in power lines / a chain-link fence: narrow inharmonic bands, slow.
			const h = hall(c, out, 6, 0.8);
			const dry = ac.createGain(); dry.gain.value = 0.5; dry.connect(out); dry.connect(h.input);
			const base = rand(380, 460);
			const s = resonantBands(c, dry, [base, base * 1.51, base * 2.27, base * 3.13], 55, 1.1, [6, 16]);
			return () => { s(); h.stop(); };
		}
		case "sFarThuds":
			// Something heavy, far off: a door, a car, who knows. One or two, then a long nothing.
			return every(22, 50, () => {
				const h = hall(c, out, 6, 1);
				const n = Math.random() < 0.6 ? 1 : 2;
				for (let i = 0; i < n; i++) {
					const t = ac.currentTime + 0.1 + i * rand(0.7, 1.4);
					const o = ac.createOscillator(); o.type = "sine";
					o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.6);
					const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.015); g.gain.setTargetAtTime(0, t + 0.015, 0.25);
					const s = noiseSrc(c, "brown");
					const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 160;
					const ng = ac.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.3, t + 0.02); ng.gain.setTargetAtTime(0, t + 0.02, 0.18);
					s.connect(lp); lp.connect(ng);
					const mix = ac.createGain(); mix.gain.value = 1;
					o.connect(g); g.connect(mix); ng.connect(mix);
					mix.connect(h.input);
					const dry = ac.createGain(); dry.gain.value = 0.35; mix.connect(dry); dry.connect(out);
					o.start(t); o.stop(t + 1.6); s.stop(t + 1.6);
				}
				setTimeout(h.stop, 10000);
			});
		case "sStrings": {
			// Low string-like pad in C minor that breathes; now and then a dissonant cluster swells
			// over it, everything drops into near-silence, and the pad slowly comes back.
			const h = hall(c, out, 8, 0.85);
			const dry = ac.createGain(); dry.gain.value = 0.6; dry.connect(out); dry.connect(h.input);
			const duck = ac.createGain(); duck.gain.value = 1; duck.connect(dry);
			const pad = slowPad(c, duck, {
				chords: DREAD_CHORDS, type: "sawtooth", voices: 3, detune: 9, chordS: [24, 36], attack: 12, release: 14,
				cutoff: [220, 1100], breathe: [12, 30], level: 0.4,
			});
			const sub = ac.createOscillator(); sub.type = "sine"; sub.frequency.value = mtof(24);
			const subG = ac.createGain(); subG.gain.value = 0.12; sub.connect(subG); subG.connect(duck); sub.start();
			const s1 = wander(c, subG.gain, 0.06, 0.14, 8, 20);
			const s2 = every(45, 80, () => {
				const t = ac.currentTime + 0.1;
				const d = rand(8, 11);
				const root = pick([49, 50, 54]);
				const oscs: OscillatorNode[] = [];
				const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.7;
				lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2400, t + d);
				const g = ac.createGain();
				g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.02, t + d * 0.5); g.gain.linearRampToValueAtTime(0.11, t + d); g.gain.linearRampToValueAtTime(0, t + d + 1.8);
				lp.connect(g); g.connect(h.input); const gd = ac.createGain(); gd.gain.value = 0.5; g.connect(gd); gd.connect(out);
				for (const iv of [0, 1, 5, 6, 11, 13]) {
					for (const det of [-6, 6]) {
						const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(root + iv); o.detune.value = det;
						o.connect(lp); o.start(t); o.stop(t + d + 2); oscs.push(o);
					}
				}
				// The pad drops out under the swell's peak and creeps back.
				duck.gain.cancelScheduledValues(t);
				duck.gain.setValueAtTime(duck.gain.value, t);
				duck.gain.linearRampToValueAtTime(0.6, t + d * 0.8);
				duck.gain.linearRampToValueAtTime(0.02, t + d + 1.5);
				duck.gain.setValueAtTime(0.02, t + d + 7);
				duck.gain.linearRampToValueAtTime(1, t + d + 19);
			});
			return () => { s1(); s2(); pad.stop(); stopNodes([sub]); h.stop(); };
		}
		case "sSubPulse":
			// ~50 bpm, very low, soft-edged: felt more than heard.
			return sequence(c, 1.2, (_step, t) => {
				const o = ac.createOscillator(); o.type = "sine";
				o.frequency.setValueAtTime(52, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
				const h2 = ac.createOscillator(); h2.type = "sine";
				h2.frequency.setValueAtTime(104, t); h2.frequency.exponentialRampToValueAtTime(76, t + 0.5);
				const hg = ac.createGain(); hg.gain.value = 0.12; h2.connect(hg);
				const g = ac.createGain();
				g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.035); g.gain.setTargetAtTime(0, t + 0.035, 0.22);
				o.connect(g); hg.connect(g); g.connect(out);
				o.start(t); h2.start(t); o.stop(t + 1.15); h2.stop(t + 1.15);
			});
		case "sGlass": {
			// High glassy harmonics drifting in and out, each on its own slow arc, far back in a hall.
			const h = hall(c, out, 8, 1);
			const dry = ac.createGain(); dry.gain.value = 0.3; dry.connect(out); dry.connect(h.input);
			const notes = [79, 84, 86, 91, 93, 96];
			const stops: Stop[] = [];
			const oscs: OscillatorNode[] = [];
			for (const m of notes) {
				const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = mtof(m) * rand(0.998, 1.002);
				const vib = ac.createOscillator(); vib.frequency.value = rand(0.1, 0.3);
				const vg = ac.createGain(); vg.gain.value = rand(3, 8); vib.connect(vg); vg.connect(o.detune);
				const g = ac.createGain(); g.gain.value = 0;
				const pan = ac.createStereoPanner(); pan.pan.value = rand(-0.8, 0.8);
				o.connect(g); g.connect(pan); pan.connect(dry);
				o.start(); vib.start(); oscs.push(o, vib);
				// Mostly silent: each voice surfaces now and then.
				stops.push(every(6, 16, () => g.gain.setTargetAtTime(Math.random() < 0.35 ? rand(0.015, 0.035) : 0, ac.currentTime, rand(2, 5)), true));
			}
			return () => { stops.forEach((s) => s()); stopNodes(oscs); h.stop(); };
		}
		case "sReverseSwell":
			// Reversed-cymbal swell: air rising to a cut-off, then the hall's tail.
			return every(20, 42, () => {
				const h = hall(c, out, 6, 0.9);
				const t = ac.currentTime + 0.1;
				const d = rand(3, 5);
				const s = noiseSrc(c, "white");
				const hp = ac.createBiquadFilter(); hp.type = "highpass";
				hp.frequency.setValueAtTime(6000, t); hp.frequency.exponentialRampToValueAtTime(1800, t + d);
				const bp = ac.createBiquadFilter(); bp.type = "peaking"; bp.Q.value = 2; bp.gain.value = 6;
				bp.frequency.setValueAtTime(3000, t); bp.frequency.exponentialRampToValueAtTime(8000, t + d);
				const g = ac.createGain();
				g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.04);
				s.connect(hp); hp.connect(bp); bp.connect(g); g.connect(h.input);
				const dry = ac.createGain(); dry.gain.value = 0.5; g.connect(dry); dry.connect(out);
				s.stop(t + d + 0.1);
				setTimeout(h.stop, (d + 8) * 1000);
			});
		case "sScrape":
			// A single distant metallic scrape: rough grain through metal resonances, far back.
			return every(30, 70, () => {
				const h = hall(c, out, 7, 1);
				const t = ac.currentTime + 0.1;
				const d = rand(1.6, 3);
				const s = noiseSrc(c, "white");
				const grain = ac.createGain(); grain.gain.value = 0;
				// Stick-slip grain: random jumps of the level.
				for (let x = 0; x < d; x += rand(0.02, 0.06)) grain.gain.setValueAtTime(Math.random() < 0.6 ? rand(0.3, 1) : 0.05, t + x);
				grain.gain.setValueAtTime(0, t + d);
				const env = ac.createGain();
				env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.5, t + d * 0.3); env.gain.linearRampToValueAtTime(0, t + d);
				s.connect(grain); grain.connect(env);
				const base = rand(500, 900);
				const mix = ac.createGain(); mix.gain.value = 1.4;
				for (const r of [1, 2.32, 3.87, 5.1]) {
					const bp = ac.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 40;
					bp.frequency.setValueAtTime(base * r, t); bp.frequency.linearRampToValueAtTime(base * r * rand(0.96, 1.04), t + d);
					env.connect(bp); bp.connect(mix);
				}
				const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
				const pan = ac.createStereoPanner(); pan.pan.value = rand(-0.8, 0.8);
				mix.connect(lp); lp.connect(pan); pan.connect(h.input);
				const dry = ac.createGain(); dry.gain.value = 0.2; pan.connect(dry); dry.connect(out);
				s.stop(t + d + 0.1);
				setTimeout(h.stop, (d + 9) * 1000);
			});
	}
}
