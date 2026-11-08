import type { Broadcast, GameState, RadioStation } from "../game/types";
import type { Rng } from "./dice";
import { atBase } from "./base";
import { outbreakDay } from "./ruleset";
import { advanceClock, gameMinutes, isZombie } from "./survival";
import { learnEvents } from "./town";

/**
 * The Quiet: the radio. Three bands, each with its own voice:
 * - 101.7 FM: dead air and a tone, except around 3 a.m. when a voice reads
 *   names and coordinates (canon mystery: who's broadcasting). The coordinates
 *   point at a place the player hasn't found; hearing them puts it on the map.
 * - The emergency band: the automated military loop (Operation Tollgate) until
 *   the cordon goes silent on outbreak day 9; then hiss.
 * - CB / scanner: the factions talking. Loud things the town did lately
 *   (TownEvent.public) are heard here, and the player learns of them.
 * The engine picks the facts; the DM writes the words (campaign language) with
 * the broadcast tool, and they're kept for the radio panel.
 */

export const STATIONS: readonly RadioStation[] = ["fm1017", "emergency", "cb"];
const LISTEN_MIN = 10;
const MAX_LOG = 60;

export function radioAccess(state: GameState): "radio" | "base" | undefined {
	// A portable radio, or any radio the story handed over ("Radio de la Guardia").
	if (state.character.inventory.some((i) => i.quantity > 0 && (i.ref === "z-radio" || i.ref === "z-walkie-talkie" || /\bradio\b/i.test(i.name)))) return "radio";
	if (state.group?.base?.upgrades.includes("radio") && atBase(state)) return "base";
	return undefined;
}

export interface Tuning {
	station: RadioStation;
	/** DM instructions: what is on the air (EN). */
	facts: string;
	eventIds: string[];
	/** A place the coordinates revealed. */
	revealed?: string;
}

const nightOfNames = (h: number, m: number) => (h === 2 && m >= 30) || h === 3 || (h === 4 && m === 0);

/** The player listens to `station` for ten minutes. Mutates the clock, the town knowledge and the map. */
export function tune(state: GameState, rng: Rng, station: RadioStation): Tuning {
	if (!isZombie(state)) throw new Error("Only in The Quiet.");
	if (!STATIONS.includes(station)) throw new Error(`Unknown station ${station}.`);
	if (!radioAccess(state)) throw new Error("No radio: find a portable radio, or build the radio at the base and be there.");
	if (state.encounter?.status === "active") throw new Error("Not in the middle of a fight.");
	advanceClock(state, LISTEN_MIN);
	const { hour, minute } = state.time;
	const day = outbreakDay(state);
	const out: Tuning = { station, facts: "", eventIds: [] };
	const town = state.town;
	const now = gameMinutes(state.time);
	const recent = (town?.events ?? []).filter((e) => e.public && !e.known && now - e.at <= 3 * 1440);
	switch (station) {
		case "fm1017": {
			if (!nightOfNames(hour, minute)) {
				out.facts = `101.7 FM, ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}: a steady carrier tone and dead air. Once, faintly, someone breathing close to a microphone, then nothing. (The names are read at 3 a.m.; don't say so outright — let the player work it out.)`;
				break;
			}
			const people = Object.values(state.npcs);
			const known = people.length ? rng.pick(people) : undefined;
			const hidden = state.world.locations.filter((l) => !l.discovered);
			const place = hidden.length ? rng.pick(hidden) : undefined;
			if (place) {
				place.discovered = true;
				out.revealed = place.name;
			}
			out.facts = `101.7 FM, 3 a.m.: THE NAMES. A calm, tired voice reads a list of names, slowly, each followed by a pair of map coordinates, then repeats it. Invent 4–6 names; one of them is someone the player knows: ${known ? `${known.name}${known.alive ? "" : " (who is dead)"}` : "the player's own name"}. ${place ? `The last coordinates point at ${place.name} (${place.description ?? "a place the player hasn't been"}); it is now marked on the player's map.` : "The coordinates point at places the player already knows."} No explanation, no station ID. The voice ends with "…that's all for tonight." Canon: who reads it is a mystery the DM keeps.`;
			break;
		}
		case "emergency": {
			out.facts =
				day < 2
					? "Emergency band: the Emergency Alert System loop. A synthetic voice: a public-health emergency in Kessler County; shelter in place; St. Brigid's is closed; do not approach anyone who appears ill; await instructions. It repeats."
					: day < 9
						? "Emergency band: the military loop, Operation Tollgate. A recorded officer: Kessler Falls is under quarantine; the bridges and Route 9 are closed; anyone approaching the cordon will be fired upon; aid stations are 'being established'; stay indoors. It repeats, crisp and indifferent."
						: "Emergency band: nothing. The Tollgate loop stopped (the cordon went silent on outbreak day 9). Hiss, and once a burst of an automated test tone, then hiss again.";
			break;
		}
		case "cb": {
			const heard = recent.slice(-3);
			out.eventIds = heard.map((e) => e.id);
			const active = Object.values(town?.factions ?? {}).filter((f) => f.status === "active");
			const voice = active.length ? rng.pick(active) : undefined;
			out.facts = heard.length
				? `CB / scanner: chatter between survivors, crackly and partial. What they're talking about (the player now knows these): ${heard.map((e) => e.text).join(" ")} Write it as overheard radio traffic between the people involved (call signs, swearing, fear), not as a news report.`
				: voice
					? `CB / scanner: mostly static; a short exchange from ${voice.name} (their goal: ${voice.goal}) — something small and human that hints at it (a supply run, a sentry checking in, a threat). Keep it to a few lines.`
					: "CB / scanner: static across the channels. Nobody's talking tonight.";
			if (heard.length) learnEvents(state, out.eventIds);
			break;
		}
	}
	return out;
}

export function recordBroadcast(state: GameState, b: Omit<Broadcast, "id" | "at">): Broadcast {
	const r = (state.radio ??= { log: [] });
	const entry: Broadcast = { id: `rb${(r.log.at(-1) ? Number(r.log.at(-1)!.id.slice(2)) : 0) + 1}`, at: gameMinutes(state.time), ...b };
	r.log.push(entry);
	if (r.log.length > MAX_LOG) r.log.splice(0, r.log.length - MAX_LOG);
	return entry;
}

export function radioDigest(state: GameState): string | undefined {
	const access = radioAccess(state);
	if (!access) return undefined;
	return `Radio: the player can listen (${access === "radio" ? "portable radio" : "the base radio"}): 101.7 FM, the emergency band, CB. They tune in from the radio panel; you can also mention it crackling at the right moment.`;
}
