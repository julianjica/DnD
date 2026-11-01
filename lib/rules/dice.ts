import type { RollRecord } from "../game/types";

/**
 * Seeded dice. The RNG state lives in GameState.rng so replays and saves are
 * deterministic. Use `Rng` around a state number and write `rng.state` back.
 */

export class Rng {
	constructor(public state: number) {}

	/** mulberry32 → float in [0, 1). */
	next(): number {
		let t = (this.state = (this.state + 0x6d2b79f5) | 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Integer in [1, sides]. */
	die(sides: number): number {
		return 1 + Math.floor(this.next() * sides);
	}

	/** Integer in [min, max]. */
	int(min: number, max: number): number {
		return min + Math.floor(this.next() * (max - min + 1));
	}

	pick<T>(items: readonly T[]): T {
		return items[Math.floor(this.next() * items.length)];
	}
}

export function newSeed(): number {
	return (Math.random() * 2 ** 32) >>> 0;
}

let rollCounter = 0;
function rollId(): string {
	rollCounter = (rollCounter + 1) % 1e6;
	return `r${Date.now().toString(36)}${rollCounter.toString(36)}`;
}

export interface DiceTerm {
	count: number;
	sides: number;
	/** keep highest/lowest N (e.g. 4d6kh3). */
	keep?: { which: "h" | "l"; n: number };
	sign: 1 | -1;
}

export interface ParsedNotation {
	terms: DiceTerm[];
	modifier: number;
}

/** Parses "2d6+3", "1d20 - 1", "4d6kh3", "8d6", "3", "1d8+1d6+2". */
export function parseNotation(notation: string): ParsedNotation {
	const src = notation.replace(/\s+/g, "").toLowerCase();
	if (!src) throw new Error("Empty dice notation");
	const re = /([+-]?)(\d*)d(\d+)(k[hl]\d+)?|([+-]?)(\d+)/g;
	const terms: DiceTerm[] = [];
	let modifier = 0;
	let consumed = 0;
	for (const m of src.matchAll(re)) {
		if (m.index !== consumed) throw new Error(`Invalid dice notation: ${notation}`);
		consumed += m[0].length;
		if (m[3] !== undefined) {
			const count = m[2] ? Number(m[2]) : 1;
			const sides = Number(m[3]);
			if (count < 1 || count > 200 || sides < 1 || sides > 1000) throw new Error(`Dice out of range: ${m[0]}`);
			const keep = m[4] ? { which: m[4][1] as "h" | "l", n: Number(m[4].slice(2)) } : undefined;
			terms.push({ count, sides, keep, sign: m[1] === "-" ? -1 : 1 });
		} else {
			modifier += (m[5] === "-" ? -1 : 1) * Number(m[6]);
		}
	}
	if (consumed !== src.length) throw new Error(`Invalid dice notation: ${notation}`);
	return { terms, modifier };
}

export interface RollOptions {
	label: string;
	actor?: string;
	advantage?: "advantage" | "disadvantage";
	/** AC or DC to compare against (total >= target is success). */
	target?: number;
	/** Treat a single d20 as an attack roll (nat 20 crit hit, nat 1 crit miss). */
	attack?: boolean;
	/** Crit threshold for attack rolls (Champion: 19). */
	critOn?: number;
}

/**
 * Rolls notation. Advantage/disadvantage applies to the first d20 term with
 * count 1 (rolls two, drops one).
 */
export function roll(rng: Rng, notation: string, opts: RollOptions): RollRecord {
	const parsed = parseNotation(notation);
	const dice: RollRecord["dice"] = [];
	let total = parsed.modifier;
	let natural: number | undefined;
	let advApplied = false;
	for (const term of parsed.terms) {
		if (!advApplied && opts.advantage && term.sides === 20 && term.count === 1) {
			advApplied = true;
			const a = rng.die(20);
			const b = rng.die(20);
			const keepA = opts.advantage === "advantage" ? a >= b : a <= b;
			dice.push({ sides: 20, value: a, dropped: !keepA }, { sides: 20, value: b, dropped: keepA });
			const kept = keepA ? a : b;
			natural ??= kept;
			total += term.sign * kept;
			continue;
		}
		const values = Array.from({ length: term.count }, () => rng.die(term.sides));
		let keptIdx = new Set(values.map((_, i) => i));
		if (term.keep) {
			const sorted = values.map((v, i) => [v, i] as const).sort((x, y) => (term.keep!.which === "h" ? y[0] - x[0] : x[0] - y[0]));
			keptIdx = new Set(sorted.slice(0, term.keep.n).map(([, i]) => i));
		}
		values.forEach((value, i) => {
			const dropped = !keptIdx.has(i);
			dice.push({ sides: term.sides, value, ...(dropped ? { dropped } : {}) });
			if (!dropped) total += term.sign * value;
		});
		if (term.sides === 20 && term.count === 1) natural ??= values[0];
	}
	const rec: RollRecord = {
		id: rollId(),
		notation,
		dice,
		modifier: parsed.modifier,
		total,
		label: opts.label,
		ts: Date.now(),
		...(opts.actor ? { actor: opts.actor } : {}),
		...(opts.advantage ? { advantage: opts.advantage } : {}),
	};
	if (opts.attack && natural !== undefined) {
		if (natural >= (opts.critOn ?? 20)) rec.critical = "hit";
		else if (natural === 1) rec.critical = "miss";
	}
	if (opts.target !== undefined) {
		rec.target = opts.target;
		rec.success = rec.critical === "hit" ? true : rec.critical === "miss" ? false : total >= opts.target;
	}
	return rec;
}

/** Doubles the dice (not the modifier) of a damage notation for a critical hit. */
export function critNotation(notation: string): string {
	const parsed = parseNotation(notation);
	const dice = parsed.terms.map((t) => `${t.sign < 0 ? "-" : "+"}${t.count * 2}d${t.sides}`).join("");
	const mod = parsed.modifier ? (parsed.modifier > 0 ? `+${parsed.modifier}` : `${parsed.modifier}`) : "";
	return (dice + mod).replace(/^\+/, "");
}

export function abilityMod(score: number): number {
	return Math.floor((score - 10) / 2);
}

export function signed(n: number): string {
	return n >= 0 ? `+${n}` : `${n}`;
}
