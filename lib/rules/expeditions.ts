import type { Expedition, ExpeditionGoal, GameState, Survivor } from "../game/types";
import type { Rng } from "./dice";
import { abilityMod } from "./dice";
import { outbreakDay } from "./ruleset";
import { gameMinutes, rollInfection } from "./survival";
import { isNight } from "./scavenge";
import { deposit, errandFinds, killSurvivor, nameOf, PROFESSIONS, survivorAbilities, type AddItem } from "./group";
import { learnEvents } from "./town";
import { radioAccess } from "./radio";

/**
 * The Quiet: expeditions. One to three companions walk to another place in
 * town along the roads, meet whatever the living town has put there (hordes,
 * factions, overrun streets), do the job and walk back. With a walkie-talkie
 * they check in at each stop and the player hears it (if they have a radio
 * too); a missed check-in is silence on the channel.
 *
 * The engine decides what happens (secret rolls) and tells the DM the facts;
 * the DM writes the words heard on the walkie (broadcast, station "walkie").
 */

export const EXPEDITION_GOALS: readonly ExpeditionGoal[] = ["scavenge", "scout", "contact", "retrieve"];
const DWELL: Record<ExpeditionGoal, number> = { scavenge: 4, scout: 2, contact: 3, retrieve: 4 };
const MAX_STEPS = 40;

const prof = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);
const locName = (state: GameState, id?: string) => state.world.locations.find((l) => l.id === id)?.name ?? id ?? "?";
const clock = (t: number) => `day ${Math.floor(t / 1440)} ${String(Math.floor((t % 1440) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;

/** Road path from `from` to `to` (inclusive of `to`, exclusive of `from`), or a straight walk if no roads link them. */
export function roadPath(state: GameState, from: string, to: string): string[] {
	if (from === to) return [];
	const prev = new Map<string, string>([[from, from]]);
	const q = [from];
	while (q.length) {
		const cur = q.shift()!;
		if (cur === to) break;
		for (const r of state.world.routes) {
			const n = r.from === cur ? r.to : r.to === cur ? r.from : undefined;
			if (n && !prev.has(n)) {
				prev.set(n, cur);
				q.push(n);
			}
		}
	}
	if (!prev.has(to)) return [to];
	const out: string[] = [];
	for (let c = to; c !== from; c = prev.get(c)!) out.unshift(c);
	return out;
}

/** Walking minutes between two neighbouring places (a loaded team walks a bit slower). */
export function legMinutes(state: GameState, a: string, b: string): number {
	const r = state.world.routes.find((x) => (x.from === a && x.to === b) || (x.to === a && x.from === b));
	if (r) return Math.max(15, Math.round(r.travelDays * 1440 * 1.2));
	const la = state.world.locations.find((l) => l.id === a), lb = state.world.locations.find((l) => l.id === b);
	const d = la && lb ? Math.hypot(la.x - lb.x, la.y - lb.y) : 0.2;
	return Math.max(30, Math.round(d * 10 * 60 * 1.2));
}

/** Estimated minutes out and back (no trouble), for the planner. */
export function expeditionEta(state: GameState, from: string, to: string, goal: ExpeditionGoal): number {
	const there = roadPath(state, from, to);
	let t = 0;
	let cur = from;
	for (const p of there) {
		t += legMinutes(state, cur, p);
		cur = p;
	}
	return t * 2 + DWELL[goal] * 60;
}

export function expeditionsOf(state: GameState): Expedition[] {
	return state.group?.expeditions ?? [];
}

const hasWalkie = (state: GameState, members: Survivor[]) =>
	members.some((m) => m.gear.some((g) => /walkie|radio/i.test(g.ref))) || state.character.inventory.some((i) => i.quantity > 0 && (i.ref === "z-walkie-talkie" || /walkie|radio/i.test(i.name))) || !!state.group?.base?.upgrades.includes("radio");

export interface SendArgs {
	members: string[];
	locationId: string;
	goal: ExpeditionGoal;
	note?: string;
}

export function sendExpedition(state: GameState, a: SendArgs, newId: () => string): Expedition {
	const g = state.group;
	if (!g) throw new Error("No group yet.");
	if (state.encounter?.status === "active") throw new Error("Not in the middle of a fight.");
	if (!EXPEDITION_GOALS.includes(a.goal)) throw new Error(`goal must be one of ${EXPEDITION_GOALS.join(", ")}.`);
	if (!a.members?.length || a.members.length > 3) throw new Error("Send one to three companions.");
	const members = a.members.map((key) => {
		const sv = g.survivors[key] ?? Object.values(g.survivors).find((s) => nameOf(state, s).toLowerCase() === key.toLowerCase() || nameOf(state, s).toLowerCase().startsWith(key.toLowerCase()));
		if (!sv) throw new Error(`Unknown companion ${key}.`);
		const name = nameOf(state, sv);
		if (sv.status !== "with_party" && sv.status !== "at_base") throw new Error(`${name} can't go (${sv.status}).`);
		if (sv.hp <= 0) throw new Error(`${name} is down (0 HP).`);
		return sv;
	});
	if (new Set(members.map((m) => m.npcId)).size !== members.length) throw new Error("Each companion once.");
	const from = members.every((m) => m.status === "at_base") ? "at_base" : "with_party";
	if (members.some((m) => m.status !== members[0].status)) throw new Error("Send them from the same place (all with the party, or all at the base).");
	const origin = from === "at_base" ? g.base!.locationId : state.world.currentLocationId;
	if (!origin) throw new Error("Nowhere to start from.");
	const target = state.world.locations.find((l) => l.id === a.locationId || l.name.toLowerCase() === a.locationId.toLowerCase());
	if (!target) throw new Error(`Unknown location ${a.locationId}.`);
	if (!target.discovered) throw new Error(`${target.name} isn't on the player's map yet.`);
	if (target.id === origin) throw new Error("They're already there.");
	const now = gameMinutes(state.time);
	const path = roadPath(state, origin, target.id);
	const eta = now + expeditionEta(state, origin, target.id, a.goal);
	const ex: Expedition = {
		id: newId(),
		members: members.map((m) => m.npcId),
		from,
		originId: origin,
		targetId: target.id,
		goal: a.goal,
		...(a.note?.trim() ? { note: a.note.trim().slice(0, 200) } : {}),
		startedAt: now,
		eta,
		path,
		nextAt: now + legMinutes(state, origin, path[0]),
		at: origin,
		stage: "outbound",
		comms: hasWalkie(state, members),
		events: [],
		lastKnownAt: origin,
		lastHeardAt: now,
		haul: [],
	};
	for (const m of members) {
		m.away = { until: eta, task: "expedition", startedAt: now, from };
		m.status = "away";
	}
	state.scene.npcIds = state.scene.npcIds.filter((id) => !ex.members.includes(id));
	(g.expeditions ??= []).push(ex);
	return ex;
}

const alive = (state: GameState, ex: Expedition) => ex.members.map((id) => state.group!.survivors[id]).filter((s): s is Survivor => !!s && s.status === "away" && s.away?.task === "expedition");

function note(ex: Expedition, at: number, text: string) {
	ex.events.push({ at, text });
	if (ex.events.length > 40) ex.events.splice(0, ex.events.length - 40);
}

/** Danger % at a stop: the town (hordes, who holds it, overrun), the day, the night, the team. */
export function stopDanger(state: GameState, ex: Expedition, loc: string, at: number): number {
	const t = state.town;
	const team = alive(state, ex);
	const horde = t?.hordes.filter((h) => h.at === loc).reduce((n, h) => n + h.size, 0) ?? 0;
	const p = t?.places[loc];
	const holder = p?.heldBy ? t?.factions[p.heldBy] : undefined;
	let d = 6 + Math.min(10, Math.floor(outbreakDay(state) / 2));
	d += Math.min(35, Math.round(horde * 0.8));
	if (p?.status === "overrun") d += 15;
	if (holder && holder.attitude <= -1) d += 10 * -holder.attitude;
	if (isNight({ day: 0, hour: Math.floor((at % 1440) / 60), minute: 0 })) d += 10;
	d -= 3 * (team.length - 1);
	if (team.some((m) => PROFESSIONS[m.profession]?.good.includes("scout"))) d -= 5;
	return Math.max(2, Math.min(80, d));
}

/** Something goes wrong at a stop. Returns the DM facts. */
function trouble(state: GameState, rng: Rng, ex: Expedition, loc: string, at: number): string {
	const team = alive(state, ex);
	const sv = rng.pick(team);
	const name = nameOf(state, sv);
	const where = locName(state, loc);
	const t = state.town;
	const holder = t?.places[loc]?.heldBy ? t.factions[t.places[loc].heldBy!] : undefined;
	const horde = t?.hordes.find((h) => h.at === loc);
	const r = rng.int(1, 100);
	if (r <= 45) {
		const cut = rng.int(1, 6) + sv.level;
		sv.hp = Math.max(1, sv.hp - cut);
		return `At ${where}: ${horde ? `they ran into the edge of a horde (~${horde.size})` : holder ? `a run-in with ${holder.name}` : "a close call with the dead"}; ${name} got hurt (−${cut} HP → ${sv.hp}/${sv.maxHp}).`;
	}
	if (r <= 68) {
		const save = rng.int(1, 20) + abilityMod(survivorAbilities(sv.profession).con);
		if (save < 12 && (!sv.infection || sv.infection.stage === "turned")) {
			const { bittenAt, turnsAt, part } = rollInfection(rng, at, "bite");
			sv.infection = { bittenAt, turnsAt, part, stage: "incubating" };
			return `At ${where}: ${name} was BITTEN on the ${part} and is INFECTED (secret: ≈${Math.round((turnsAt - at) / 60)} h to turn; they may hide it on the radio).`;
		}
		return `At ${where}: teeth closed on ${name}'s sleeve; it didn't break the skin.`;
	}
	if (r <= 82) {
		const lost = ex.haul.splice(0, Math.ceil(ex.haul.length / 2));
		ex.nextAt += 6 * 60;
		return `At ${where}: they had to run and hide for hours${lost.length ? `, dropping part of what they carried (${lost.map((h) => `${h.qty} ${h.ref}`).join(", ")})` : ""}; they're running late.`;
	}
	if (r <= 92 && holder && holder.attitude <= -1) {
		sv.away = { ...sv.away!, task: "captured", until: Number.MAX_SAFE_INTEGER };
		(ex.captured ??= []).push(sv.npcId);
		return `At ${where}: ${holder.name} took ${name} (CAPTURED: alive, held at ${where}; the others got away). A rescue is a story the DM can open.`;
	}
	return `At ${where}: ${name} DIED out there (${horde ? "pulled down by the horde" : "caught in the open"}).${killSurvivor(state, sv, `killed on an expedition at ${where}`)}`;
}

/** The job at the target. Returns DM facts. */
function doTheJob(state: GameState, rng: Rng, ex: Expedition): string {
	const team = alive(state, ex);
	const where = locName(state, ex.targetId);
	const best = Math.max(...team.map((m) => prof(m.level) + (PROFESSIONS[m.profession]?.good.includes(ex.goal === "contact" ? "scout" : ex.goal === "retrieve" ? "scavenge" : ex.goal) ? 2 : 0)));
	const check = rng.int(1, 20) + best + (team.length - 1);
	const p = state.town?.places[ex.targetId];
	const t = state.town;
	switch (ex.goal) {
		case "scavenge": {
			const factor = p?.status === "burned" ? 0.25 : p?.status === "looted" ? 0.5 : 1;
			const finds = Math.max(0, Math.round((2 + team.length + (check >= 15 ? 2 : check < 8 ? -1 : 0)) * factor));
			const { items } = errandFinds(state, rng, "scavenge", finds);
			for (const [ref, qty] of items) ex.haul.push({ ref, qty });
			return `At ${where}: they searched for ${DWELL.scavenge} h${p?.status && p.status !== "intact" ? ` (the place is ${p.status})` : ""}${ex.note ? `, looking for: ${ex.note}` : ""}: found ${[...items].map(([r, q]) => `${q} ${r}`).join(", ") || "nothing worth carrying"}.`;
		}
		case "scout": {
			const around = [ex.targetId, ...state.world.routes.flatMap((r) => (r.from === ex.targetId ? [r.to] : r.to === ex.targetId ? [r.from] : []))];
			const learnt = (t?.events ?? []).filter((e) => e.locId && around.includes(e.locId) && !e.known).map((e) => e.id);
			if (check >= 10) {
				for (const id of around) {
					const pl = t?.places[id];
					if (pl) {
						pl.knownStatus = pl.status;
						if (pl.heldBy) pl.knownHeldBy = pl.heldBy;
					}
					const l = state.world.locations.find((x) => x.id === id);
					if (l && check >= 14) l.discovered = true;
				}
				for (const h of t?.hordes ?? []) if (around.includes(h.at)) h.known = true;
				learnEvents(state, learnt);
			}
			return check >= 10
				? `At ${where}: they watched the area for ${DWELL.scout} h and saw it clearly: ${around.map((id) => `${locName(state, id)} ${t?.places[id]?.status ?? "?"}${t?.places[id]?.heldBy ? ` (held by ${t.factions[t.places[id].heldBy!]?.name})` : ""}`).join("; ")}; hordes: ${(t?.hordes ?? []).filter((h) => around.includes(h.at)).map((h) => `~${h.size} at ${locName(state, h.at)}`).join(", ") || "none nearby"}. The player's map now shows it.`
				: `At ${where}: they couldn't get a good look (bad angles, too many dead); little to report.`;
		}
		case "contact": {
			const holder = p?.heldBy ? t?.factions[p.heldBy] : undefined;
			if (!holder) return `At ${where}: nobody to talk to; whoever was here is gone.`;
			const ok = check + holder.attitude * 2 >= 12;
			if (ok) holder.attitude = Math.min(3, holder.attitude + 1);
			holder.known = true;
			return ok
				? `At ${where}: ${holder.name} let them talk${ex.note ? ` (message: ${ex.note})` : ""}; they listened (attitude now ${holder.attitude}). The DM decides what they answered.`
				: `At ${where}: ${holder.name} wouldn't talk${holder.attitude <= -1 ? " and ran them off with warning shots" : ", sent them away at the gate"}.`;
		}
		case "retrieve":
			return `At ${where}: the retrieval (${ex.note ?? "what the player asked for"}) ${check >= 15 ? "went well: they have it" : check >= 10 ? "half-worked: they found it but it cost them time or part of it is missing" : "failed: it wasn't there, or they couldn't reach it"}. DM: decide the specifics and give the item when they're back.`;
	}
}

function arriveHome(state: GameState, ex: Expedition, addItem: AddItem, at: number): string {
	const team = alive(state, ex);
	const back = ex.from === "at_base" && state.group?.base ? "at_base" : "with_party";
	for (const m of team) {
		m.status = back;
		delete m.away;
		if (back === "with_party" && !state.scene.npcIds.includes(m.npcId)) state.scene.npcIds.push(m.npcId);
	}
	const items = new Map<string, number>();
	for (const h of ex.haul) items.set(h.ref, (items.get(h.ref) ?? 0) + h.qty);
	const where = items.size ? deposit(state, items, addItem) : "";
	ex.stage = "back";
	ex.knownStage = "back";
	ex.lastKnownAt = ex.originId;
	ex.lastHeardAt = at;
	const names = team.map((m) => nameOf(state, m)).join(", ");
	return `EXPEDITION BACK (${clock(at)}): ${names || "nobody"} made it back from ${locName(state, ex.targetId)}${where ? `: ${where}` : " empty-handed"}${ex.captured?.length ? `; ${ex.captured.map((id) => state.npcs[id]?.name ?? id).join(", ")} was captured` : ""}. Play the return (who limps, what they saw).`;
}

/** Advances all expeditions to now. DM notes for what the player hears (or doesn't). */
export function expeditionTick(state: GameState, rng: Rng, addItem: AddItem): string | undefined {
	const list = state.group?.expeditions;
	if (!list?.length) return undefined;
	const now = gameMinutes(state.time);
	const out: string[] = [];
	for (const ex of list) {
		if (ex.stage === "back" || ex.stage === "lost") continue;
		const done = (e: Expedition) => e.stage === "back" || e.stage === "lost";
		for (let n = 0; n < MAX_STEPS && ex.nextAt <= now && !done(ex); n++) {
			const at = ex.nextAt;
			if (ex.stage === "at_target") {
				ex.stage = "returning";
				const home = roadPath(state, ex.targetId, ex.originId);
				ex.path = home;
				ex.nextAt = at + legMinutes(state, ex.targetId, home[0] ?? ex.originId);
				continue;
			}
			const loc = ex.path.shift()!;
			ex.at = loc;
			if (!alive(state, ex).length) {
				ex.stage = "lost";
				break;
			}
			// Home: no stop roll (they made it to the door).
			if (ex.stage === "returning" && loc === ex.originId) {
				out.push(arriveHome(state, ex, addItem, at));
				break;
			}
			const danger = stopDanger(state, ex, loc, at);
			if (rng.int(1, 100) <= danger) note(ex, at, trouble(state, rng, ex, loc, at));
			else note(ex, at, `At ${locName(state, loc)}: passed through without trouble.`);
			if (!alive(state, ex).length) {
				ex.stage = "lost";
				note(ex, at, "Nobody is left to answer the radio.");
				break;
			}
			if (ex.recalled && ex.stage === "outbound") {
				ex.stage = "returning";
				ex.path = roadPath(state, loc, ex.originId);
				ex.nextAt = at + legMinutes(state, loc, ex.path[0] ?? ex.originId);
				note(ex, at, `They turned back at ${locName(state, loc)} as the player asked.`);
				continue;
			}
			if (ex.stage === "outbound" && loc === ex.targetId) {
				note(ex, at, doTheJob(state, rng, ex));
				ex.stage = "at_target";
				ex.nextAt = at + DWELL[ex.goal] * 60;
				continue;
			}
			ex.nextAt = at + legMinutes(state, loc, ex.path[0] ?? ex.originId);
		}
		// What the player hears: check-ins when both ends have a radio; silence when nobody answers.
		const pending = ex.events.filter((e) => !e.delivered && e.at <= now);
		if (!pending.length) continue;
		if (ex.comms && radioAccess(state)) {
			for (const e of pending) e.delivered = true;
			ex.lastKnownAt = ex.at;
			ex.lastHeardAt = now;
			ex.knownStage = ex.stage;
			const team = alive(state, ex).map((m) => nameOf(state, m));
			out.push(
				ex.stage === "lost"
					? `EXPEDITION — SILENCE: the check-in from the team sent to ${locName(state, ex.targetId)} never comes. The player calls and calls; only static. (Truth, DM only: ${pending.map((e) => e.text).join(" ")}) Play the silence.`
					: `EXPEDITION CHECK-IN (walkie, ${team.join(", ")} → ${locName(state, ex.targetId)}, now at ${locName(state, ex.at)}): ${pending.map((e) => e.text).join(" ")} Call broadcast {station:"walkie", text, expeditionId:"${ex.id}"} with what the player hears (short, crackly, in character; an infected member may hide the bite), then a line of the player's reaction.`,
			);
		} else if (ex.stage === "lost") {
			for (const e of pending) e.delivered = true;
			out.push(`EXPEDITION (DM only): the team sent to ${locName(state, ex.targetId)} is gone (${pending.map((e) => e.text).join(" ")}). With no radio, the player only knows they're late; let the days stretch, and maybe they meet one of them again among the dead.`);
		}
	}
	return out.join("\n") || undefined;
}

export function recallExpedition(state: GameState, id: string): string {
	const ex = expeditionsOf(state).find((e) => e.id === id);
	if (!ex) throw new Error(`Unknown expedition ${id}.`);
	if (ex.stage !== "outbound") throw new Error("They're already on their way back (or done).");
	if (!ex.comms || !radioAccess(state)) throw new Error("No way to reach them: it takes a walkie-talkie with them and a radio here.");
	ex.recalled = true;
	return `Recall sent: they'll turn back at their next stop (${locName(state, ex.path[0])}).`;
}

export function expeditionDigest(state: GameState): string | undefined {
	const list = expeditionsOf(state).filter((e) => e.stage !== "back");
	if (!list.length) return undefined;
	return `Expeditions: ${list
		.map((ex) => `[${ex.id}] ${ex.members.map((id) => state.npcs[id]?.name ?? id).join(", ")} → ${locName(state, ex.targetId)} (${ex.goal}${ex.note ? `: ${ex.note}` : ""}), ${ex.stage}, at ${locName(state, ex.at)}, next stop ${clock(ex.nextAt)}${ex.comms ? ", has a walkie" : ", no radio"}${ex.captured?.length ? `, captured: ${ex.captured.map((id) => state.npcs[id]?.name ?? id).join(", ")}` : ""}`)
		.join("; ")}`;
}

/** The DM's words heard on the walkie from an expedition. */
export function recordCheckIn(state: GameState, id: string, text: string, at: number): void {
	const ex = expeditionsOf(state).find((e) => e.id === id);
	if (!ex) throw new Error(`Unknown expedition ${id}.`);
	(ex.heard ??= []).push({ at, text });
	if (ex.heard.length > 20) ex.heard.splice(0, ex.heard.length - 20);
}
