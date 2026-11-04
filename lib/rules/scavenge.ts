/**
 * The Quiet: scavenging (docs/zombie.md §5). A search of a kind of place rolls
 * on that place's loot table (lib/srd/data/zombie/loot.json). It costs game
 * time and makes noise; a more thorough search finds more but takes longer and
 * is riskier. Places remember how often they were searched (SurvivalState.looted)
 * and yield less each time; food gets scarcer as the outbreak days pass.
 *
 * Pure rules: mutates the clock, noise and looted counters of the state it is
 * given and returns what was found; the DM tool adds the items to the inventory.
 */
import type { GameState, RollRecord } from "../game/types";
import { getEquipment } from "../srd";
import loot from "../srd/data/zombie/loot.json";
import { checkBreakdown } from "./character";
import { roll, signed, type Rng } from "./dice";
import { outbreakDay } from "./ruleset";
import { addNoise, advanceClock, survivalOf, tick } from "./survival";

export const PLACE_TYPES = [
	"house", "apartment", "pharmacy", "grocery", "gas_station", "police", "hospital", "school",
	"office", "farm", "hardware", "car", "restaurant", "church", "military", "mall",
] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];
export type Thoroughness = "quick" | "careful" | "thorough";

export interface LootEntry {
	ref: string;
	w: number;
	qty: [number, number];
	tag?: "food";
}
export interface LootTable {
	nothing: number;
	junk: number;
	/** Base chance that a thorough search wakes something. */
	danger: number;
	items: LootEntry[];
}

const TABLES = loot.places as unknown as Record<PlaceType, LootTable>;
export const JUNK: readonly string[] = loot.junk;

export function lootTable(place: string): LootTable | undefined {
	return (PLACE_TYPES as readonly string[]).includes(place) ? TABLES[place as PlaceType] : undefined;
}

/** Minutes, noise and table rolls per level of care. */
export const SEARCH = {
	quick: { minutes: 10, noise: 0, rolls: 1, skill: "perception" },
	careful: { minutes: 30, noise: 1, rolls: 2, skill: "investigation" },
	thorough: { minutes: 60, noise: 2, rolls: 3, skill: "investigation" },
} as const satisfies Record<Thoroughness, { minutes: number; noise: number; rolls: number; skill: string }>;

/** Share of a place's loot left after `searches` earlier searches (~mostly empty after 3). */
export function depletion(searches: number): number {
	return [1, 0.6, 0.3, 0.1][searches] ?? 0;
}

/** Food is the first thing people took: its weight shrinks as outbreak days pass. */
export function foodFactor(day: number): number {
	return Math.max(0.15, 1 - day / 25);
}

// ─── clock and noise (shared with barricades) ──────────────────────────────

export function clockText(t: GameState["time"]): string {
	return `day ${t.day}, ${String(t.hour).padStart(2, "0")}:${String(t.minute ?? 0).padStart(2, "0")}`;
}

/**
 * Spends game time on a task, then makes its noise. The survival tick runs for
 * the elapsed minutes first (earlier noise decays, needs and infection advance)
 * so the task's own noise isn't decayed away by the same minutes. Returns the
 * notes for the DM (survival events, noise line, what the noise draws).
 */
export function spendTimeAndNoise(state: GameState, rng: Rng, minutes: number, noise: number, reason: string): string[] {
	survivalOf(state);
	advanceClock(state, minutes);
	const notes: string[] = [];
	const t = tick(state, rng);
	if (t) notes.push(t);
	if (noise > 0) notes.push(addNoise(state, rng, noise, reason));
	return notes;
}

export function isNight(t: GameState["time"]): boolean {
	return t.hour >= 21 || t.hour < 5;
}

// ─── the search ────────────────────────────────────────────────────────────

export interface ScavengeArgs {
	place: string;
	thoroughness: Thoroughness;
	/** World location searched (default: the current one). */
	locationId?: string;
}

export interface ScavengeResult {
	/** "<locationId>|<place>" */
	key: string;
	/** Times this place had been searched before this one. */
	before: number;
	check: RollRecord;
	rolls: number;
	found: { ref: string; name: string; qty: number }[];
	junk: string[];
	minutes: number;
	noise: number;
	/** Set when the search woke something: what the DM must resolve. */
	danger?: string;
	text: string;
}

function pickWeighted<T>(rng: Rng, list: { w: number; v: T }[]): T {
	const total = list.reduce((n, x) => n + x.w, 0);
	let r = rng.next() * total;
	for (const x of list) {
		r -= x.w;
		if (r < 0) return x.v;
	}
	return list[list.length - 1].v;
}

/** Table rolls earned by the check: +1 at 15, +2 at 20, one fewer under 10. */
export function rollsFor(thoroughness: Thoroughness, checkTotal: number): number {
	const bonus = checkTotal >= 20 ? 2 : checkTotal >= 15 ? 1 : checkTotal >= 10 ? 0 : -1;
	return Math.max(0, SEARCH[thoroughness].rolls + bonus);
}

export function scavenge(state: GameState, rng: Rng, a: ScavengeArgs): ScavengeResult {
	const table = lootTable(a.place);
	if (!table) throw new Error(`Unknown place type "${a.place}". Use one of: ${PLACE_TYPES.join(", ")}.`);
	const how = SEARCH[a.thoroughness];
	if (!how) throw new Error(`thoroughness must be quick, careful or thorough.`);
	let locId = state.world.currentLocationId || "here";
	if (a.locationId) {
		const loc = state.world.locations.find((l) => l.id === a.locationId || l.name.toLowerCase() === a.locationId!.toLowerCase());
		if (!loc) throw new Error(`Unknown location ${a.locationId}.`);
		locId = loc.id;
	}
	const survival = survivalOf(state);
	survival.looted ??= {};
	const key = `${locId}|${a.place}`;
	const before = survival.looted[key] ?? 0;

	// The player's search check, rolled by the engine with their real modifiers.
	const c = state.character;
	const { mod, check: chk } = checkBreakdown(c, { kind: "check", skill: how.skill });
	const check = roll(rng, `1d20${signed(mod)}`, { label: `${how.skill === "perception" ? "Perception" : "Investigation"} check (${a.thoroughness} search: ${a.place.replace("_", " ")})`, actor: c.id });
	check.check = chk;

	const raw = rollsFor(a.thoroughness, check.total) * depletion(before);
	const rolls = Math.floor(raw) + (rng.next() < raw - Math.floor(raw) ? 1 : 0);

	const food = foodFactor(outbreakDay(state));
	const options: { w: number; v: LootEntry | "nothing" | "junk" }[] = [
		{ w: table.nothing * (1 + before * 0.5), v: "nothing" },
		{ w: table.junk, v: "junk" },
		...table.items.map((e) => ({ w: e.w * (e.tag === "food" ? food : 1), v: e })),
	];
	const found = new Map<string, number>();
	const junk: string[] = [];
	for (let i = 0; i < rolls; i++) {
		const v = pickWeighted(rng, options);
		if (v === "nothing") continue;
		if (v === "junk") {
			const j = rng.pick(JUNK);
			if (!junk.includes(j)) junk.push(j);
			continue;
		}
		found.set(v.ref, (found.get(v.ref) ?? 0) + rng.int(v.qty[0], v.qty[1]));
	}
	survival.looted[key] = before + 1;

	const notes = spendTimeAndNoise(state, rng, how.minutes, how.noise, `scavenging (${a.place.replace("_", " ")})`);
	const noise = survival.noise.level;

	// A careful or thorough search of a dangerous place may wake something; the DM decides what.
	let danger: string | undefined;
	if (a.thoroughness !== "quick") {
		const night = isNight(state.time);
		const chance = Math.min(0.9, (table.danger + (night ? 0.1 : 0) + noise * 0.02) * (a.thoroughness === "thorough" ? 1 : 0.35));
		if (rng.next() < chance)
			danger = `The search disturbed something${night ? " in the dark" : ""} (${Math.round(chance * 100)}% chance): decide what wakes or comes${table.danger >= 0.2 ? " — this is a dangerous place" : ""} (a few of the dead, a survivor, an alarm) and play it out; noise is now ${noise}/10.`;
	}

	const items = [...found.entries()].map(([ref, qty]) => ({ ref, name: getEquipment(ref)?.name ?? ref, qty }));
	const lines: string[] = [];
	lines.push(`${a.thoroughness[0].toUpperCase()}${a.thoroughness.slice(1)} search of the ${a.place.replace("_", " ")} (${how.minutes} min, search #${before + 1} here): ${check.label} ${check.total} → ${rolls} find${rolls === 1 ? "" : "s"}.`);
	if (items.length) lines.push(`Found: ${items.map((i) => `${i.qty} × ${i.name}`).join(", ")} (added to the inventory).`);
	else lines.push(before >= 3 || rolls === 0 && before > 0 ? "The shelves are bare: this place has been picked clean." : "The shelves are bare: nothing useful.");
	if (junk.length) lines.push(`Also (worthless): ${junk.join("; ")}.`);
	if (depletion(before + 1) <= 0.1) lines.push("This place is now mostly empty.");
	lines.push(`Now ${clockText(state.time)}.${how.noise ? "" : ` Noise ${noise}/10 (a quick look is quiet).`}`);
	lines.push(...notes);
	if (danger) lines.push(`DANGER: ${danger}`);
	return { key, before, check, rolls, found: items, junk, minutes: how.minutes, noise, danger, text: lines.join("\n") };
}
