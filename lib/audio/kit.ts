/**
 * Small Web Audio toolkit shared by the ambience engine (lib/audio/ambience.ts)
 * and The Quiet's synth layers (lib/audio/quiet.ts): noise buffers, envelopes,
 * random schedulers and an audio-clock step sequencer. Browser-only at call time;
 * nothing here runs at module scope.
 */

export type Stop = () => void;
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface Ctx {
	ac: AudioContext;
	reverb: AudioNode;
	noise: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer };
}

export function makeNoise(ac: BaseAudioContext, color: "white" | "pink" | "brown", seconds = 6): AudioBuffer {
	const len = Math.floor(ac.sampleRate * seconds);
	const buf = ac.createBuffer(2, len, ac.sampleRate);
	for (let ch = 0; ch < 2; ch++) {
		const d = buf.getChannelData(ch);
		let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
		for (let i = 0; i < len; i++) {
			const w = Math.random() * 2 - 1;
			if (color === "white") d[i] = w * 0.5;
			else if (color === "pink") {
				b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
				b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
				d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
			} else {
				last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
			}
		}
		// Short crossfade of the tail into the head so the loop is seamless.
		const fade = Math.floor(ac.sampleRate * 0.05);
		for (let i = 0; i < fade; i++) { const t = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t; }
	}
	return buf;
}

export function makeImpulse(ac: BaseAudioContext, seconds = 3.2, decay = 2.4): AudioBuffer {
	const len = Math.floor(ac.sampleRate * seconds);
	const buf = ac.createBuffer(2, len, ac.sampleRate);
	for (let ch = 0; ch < 2; ch++) {
		const d = buf.getChannelData(ch);
		for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
	}
	return buf;
}

export function noiseSrc(c: Ctx, color: "white" | "pink" | "brown"): AudioBufferSourceNode {
	const s = c.ac.createBufferSource();
	s.buffer = c.noise[color];
	s.loop = true;
	s.loopStart = 0;
	s.start(c.ac.currentTime, Math.random() * 4);
	return s;
}

/** A layer's event generator failed: say so in development instead of going silent. */
function devWarn(e: unknown) {
	if (process.env.NODE_ENV !== "production") console.warn("audio layer event failed", e);
}

/** Repeatedly calls fn at random intervals until stopped. */
export function every(minS: number, maxS: number, fn: () => void, startNow = false): Stop {
	let alive = true;
	let id: ReturnType<typeof setTimeout> | undefined;
	const tick = () => { if (!alive) return; try { fn(); } catch (e) { devWarn(e); } id = setTimeout(tick, rand(minS, maxS) * 1000); };
	id = setTimeout(tick, startNow ? 0 : rand(minS, maxS) * 1000);
	return () => { alive = false; if (id) clearTimeout(id); };
}

/**
 * Audio-clock step sequencer: calls fn(step, time) for every step, scheduled
 * ahead on the AudioContext clock so rhythms don't jitter with timers. If the
 * timer falls far behind (throttled tab), it skips ahead instead of bunching.
 */
export function sequence(c: Ctx, stepS: number | (() => number), fn: (step: number, t: number) => void): Stop {
	const ac = c.ac;
	const len = typeof stepS === "number" ? () => stepS : stepS;
	let next = ac.currentTime + 0.12;
	let step = 0;
	const tick = () => {
		if (next < ac.currentTime - 0.05) next = ac.currentTime + 0.05;
		while (next < ac.currentTime + 0.35) {
			try { fn(step, next); } catch (e) { devWarn(e); }
			step++;
			next += len();
		}
	};
	tick();
	const id = setInterval(tick, 60);
	return () => clearInterval(id);
}

/** Slowly wanders an AudioParam between lo and hi. */
export function wander(c: Ctx, p: AudioParam, lo: number, hi: number, minS: number, maxS: number): Stop {
	p.setValueAtTime(rand(lo, hi), c.ac.currentTime);
	return every(minS, maxS, () => p.setTargetAtTime(rand(lo, hi), c.ac.currentTime, rand(minS, maxS) / 3), true);
}

export function panner(c: Ctx, pan: number, out: AudioNode): AudioNode {
	if (typeof c.ac.createStereoPanner !== "function") return out;
	const p = c.ac.createStereoPanner();
	p.pan.value = Math.max(-1, Math.min(1, pan));
	p.connect(out);
	return p;
}

/** Simple envelope'd tone; returns nothing (self-stopping). */
export function blip(c: Ctx, out: AudioNode, o: { type?: OscillatorType; f0: number; f1?: number; t?: number; a?: number; d: number; g: number; glide?: number; reverb?: number }) {
	const ac = c.ac;
	const t = o.t ?? ac.currentTime;
	const osc = ac.createOscillator();
	osc.type = o.type ?? "sine";
	osc.frequency.setValueAtTime(o.f0, t);
	if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.glide ?? o.d));
	const g = ac.createGain();
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(o.g, t + (o.a ?? 0.005));
	g.gain.exponentialRampToValueAtTime(0.0001, t + (o.a ?? 0.005) + o.d);
	osc.connect(g);
	g.connect(out);
	if (o.reverb) { const s = ac.createGain(); s.gain.value = o.reverb; g.connect(s); s.connect(c.reverb); }
	osc.start(t);
	osc.stop(t + (o.a ?? 0.005) + o.d + 0.05);
}

/** Short filtered noise burst. */
export function burst(c: Ctx, out: AudioNode, o: { color?: "white" | "pink" | "brown"; type?: BiquadFilterType; f: number; q?: number; f1?: number; t?: number; a?: number; d: number; g: number; reverb?: number }) {
	const ac = c.ac;
	const t = o.t ?? ac.currentTime;
	const s = ac.createBufferSource();
	s.buffer = c.noise[o.color ?? "white"];
	const f = ac.createBiquadFilter();
	f.type = o.type ?? "bandpass";
	f.frequency.setValueAtTime(o.f, t);
	if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.d);
	f.Q.value = o.q ?? 1;
	const g = ac.createGain();
	g.gain.setValueAtTime(0.0001, t);
	g.gain.exponentialRampToValueAtTime(o.g, t + (o.a ?? 0.003));
	g.gain.exponentialRampToValueAtTime(0.0001, t + (o.a ?? 0.003) + o.d);
	s.connect(f); f.connect(g); g.connect(out);
	if (o.reverb) { const r = ac.createGain(); r.gain.value = o.reverb; g.connect(r); r.connect(c.reverb); }
	s.start(t, Math.random() * 3);
	s.stop(t + (o.a ?? 0.003) + o.d + 0.05);
}

export function stopNodes(nodes: (AudioScheduledSourceNode | null)[]) {
	for (const n of nodes) { try { n?.stop(); } catch { /* already stopped */ } }
}
