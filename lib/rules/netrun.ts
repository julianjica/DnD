import type { Character, GameState, GridMap, MapEntity, MapRoom, NetNode, NetNodeKind, NetRun, SpellInfo, Tile } from "../game/types";
import { findFreeSquares, placeEntity, reachableFrom } from "../maps/grid";
import { getSpell } from "../srd";
import { addCondition, applyDamage } from "./character";
import type { CombatEvent } from "./combat/types";
import { addHeat, cyberOf, isCyber, type RecordRoll } from "./cyber";
import { deckOf, hackBonus } from "./deck";
import { denFoundModifier, denProxy } from "./den";
import { roll, signed, Rng } from "./dice";
import { raidOnDump } from "./raid";
import { vanAssist, vanHoldsTheBody } from "./crew";
import { gameMinutes } from "./survival";

/**
 * Root Access net runs (docs/cyberpunk.md §4), engine-authoritative.
 *
 * Jacking in lays the target system out as a net map (GridMap theme "net"):
 * one room per node, the entry first and firewalls as gates (a closed
 * firewall's exit is a locked door, so token movement can't get past it).
 * The trace clock (0…10) climbs with every node action, program and PC turn;
 * at 5 the sysadmin joins, at 8 security goes to the body if it's onsite, at
 * 10 the runner is dumped (dumpshock, Heat +3, a den roll) and the body map
 * comes back.
 *
 * Everything here mutates GameState in place and returns EN lines for the DM.
 */

export const TRACE_MAX = 10;
export const SYSADMIN_AT = 5;
export const SECURITY_AT = 8;
export const SYSADMIN_MONSTER = "c-ice-sysadmin";
export const MIN_NODES = 2;
export const MAX_NODES = 12;
const LOG_CAP = 30;

export const NODE_KINDS: readonly NetNodeKind[] = ["entry", "firewall", "data", "control", "admin", "vault", "honeypot"];
export type NetActionId = "breach" | "access" | "take_control" | "take_admin" | "open_vault";
export const NET_ACTIONS: readonly NetActionId[] = ["breach", "access", "take_control", "take_admin", "open_vault"];
/** The action each node kind takes (honeypots answer to any of them: they look like data). */
const ACTION_FOR: Record<Exclude<NetNodeKind, "entry" | "honeypot">, NetActionId> = {
	firewall: "breach",
	data: "access",
	control: "take_control",
	admin: "take_admin",
	vault: "open_vault",
};

/** DC of every node check: 10 + 2 × security. */
export const nodeDc = (security: number) => 10 + 2 * security;

export function activeRun(state: Pick<GameState, "cyber">): NetRun | undefined {
	return state.cyber?.run;
}

const clampTrace = (n: number) => Math.max(0, Math.min(TRACE_MAX, Math.round(n)));
const pcEntityId = (c: Character) => `ent_${c.id}`;

function pushLog(run: NetRun, line: string): void {
	run.log.push(line.slice(0, 200));
	if (run.log.length > LOG_CAP) run.log.splice(0, run.log.length - LOG_CAP);
}

// ─── the trace clock ──────────────────────────────────────────────────────────

/**
 * Moves the trace of the run in progress by `amount` (proxy ticks absorb
 * rises first), clamps it to 0…10 and fires the thresholds it crosses.
 * Returns the engine lines for the DM ([] when no run is active).
 * `record` receives the dumpshock rolls (damage, the den roll).
 */
export function traceTick(state: GameState, amount: number, why: string, rng?: Rng, record?: RecordRoll): string[] {
	const run = activeRun(state);
	if (!run || !amount) return [];
	const r = rng ?? new Rng(state.rng);
	const out: string[] = [];
	let delta = Math.round(amount);
	if (delta > 0 && run.proxy > 0) {
		const absorbed = Math.min(run.proxy, delta);
		run.proxy -= absorbed;
		delta -= absorbed;
		out.push(`Proxy absorbs ${absorbed} trace (${run.proxy} proxy tick${run.proxy === 1 ? "" : "s"} left).`);
	}
	const from = run.trace;
	run.trace = clampTrace(from + delta);
	const to = run.trace;
	pushLog(run, `${why} (${signed(to - from)} trace → ${to})`);
	if (to !== from) out.push(`Trace ${from} → ${to}/${TRACE_MAX}: ${why}.`);
	else if (delta) out.push(`Trace stays ${to}/${TRACE_MAX}.`);
	if (from < SYSADMIN_AT && to >= SYSADMIN_AT && !run.sysadminAlerted) {
		run.sysadminAlerted = true;
		out.push(
			`TRACE ${SYSADMIN_AT}: the sysadmin of ${run.target} is alerted and logs in. Bring them in now: start_combat with monster "${SYSADMIN_MONSTER}" (add_monsters if a fight is already on), entering at the entry node. A rival hacker, not a script.`,
		);
	}
	if (from < SECURITY_AT && to >= SECURITY_AT) {
		if (run.body === "onsite" && !run.securityDispatched) {
			run.securityDispatched = true;
			out.push(
				`TRACE ${SECURITY_AT}: security is dispatched to the PC's body, jacked in onsite at ${run.target}. Guards reach it in a few rounds: narrate it (radio chatter, boots in the corridor) and put them in play; the body is helpless until the PC jacks out.`,
			);
			// The van: muscle and drivers of the crew try to hold them off (lib/rules/crew.ts).
			out.push(...vanHoldsTheBody(state, r, record ?? (() => undefined)));
			if (!rng) state.rng = r.state;
		} else out.push(`TRACE ${SECURITY_AT}: they have the PC's route; two more ticks and the PC is dumped.`);
	}
	if (to >= TRACE_MAX) {
		out.push(...dumpshock(state, r, record ?? (() => undefined)));
		if (!rng) state.rng = r.state;
	}
	return out;
}

/**
 * Full trace: the runner is thrown out of the system. Psychic damage =
 * security × 1d6, stunned until the end of its next turn, Heat +3, a den roll
 * if the body is in the den, and the body map comes back.
 */
function dumpshock(state: GameState, rng: Rng, record: RecordRoll): string[] {
	const run = activeRun(state)!;
	const out: string[] = [`DUMPED: the trace on ${run.target} completes and the system throws the PC out (dumpshock).`];
	const dmg = roll(rng, `${run.security}d6`, { label: "Dumpshock (psychic)", actor: "dm" });
	record(dmg);
	const ended = endNetCombat(state);
	const res = applyDamage(state.character, dmg.total, { type: "psychic" });
	state.character = addCondition(res.character, { id: "stunned", rounds: 1, source: "dumpshock", note: "until the end of its next turn" });
	const c = state.character;
	out.push(
		`${c.name} takes ${res.applied} psychic damage${res.modifier ? ` (${res.modifier})` : ""}: HP ${c.hp}/${c.maxHp}${res.instantDeath ? ". INSTANT DEATH (massive damage)" : res.droppedToZero ? ". Dropped to 0 HP: unconscious and dying" : ""}. Stunned until the end of its next turn (if no fight follows, remove it with set_condition once the moment passes).`,
	);
	out.push(addHeat(cyberOf(state), 3, `dumped from ${run.target}`, gameMinutes(state.time)).text);
	if (run.body === "den") {
		// The den's faraday mesh makes it harder to find (lib/rules/den.ts).
		const mod = 2 * run.security + denFoundModifier(state);
		const d = roll(rng, `1d20${mod ? signed(mod) : ""}`, { label: "Did they find the den? (20+)", actor: "dm", target: 20 });
		record(d);
		out.push(
			d.total >= 20
				? `DEN FOUND (${d.total} vs 20): the trace led back to the den. ${raidOnDump(state, run.target)}`
				: `The den holds (${d.total} vs 20): the trace died in the proxies before it reached the den.`,
		);
	}
	if (ended) out.push("The net fight is over: the ICE stays behind (end_combat status 'fled' clears the tracker).");
	out.push(closeRun(state, "dumped"));
	return out;
}

/** Stops a fight on the net map (jack-out or dump). True if there was one. */
function endNetCombat(state: GameState): boolean {
	const run = activeRun(state);
	const enc = state.encounter;
	if (!run || !enc || enc.status !== "active" || enc.mapId !== run.netMapId) return false;
	enc.status = "fled";
	state.mode = "explore";
	return true;
}

/** Ends the run and brings the body map back. */
function closeRun(state: GameState, how: "dumped" | "jacked out"): string {
	const run = activeRun(state)!;
	const body = run.bodyMapId ? state.maps[run.bodyMapId] : undefined;
	state.activeMapId = body?.id;
	if (state.view === "map" && !body) state.view = "scene";
	cyberOf(state).run = undefined;
	const open = run.nodes.filter((n) => n.open).length;
	return `Run on ${run.target} over (${how}; trace ${run.trace}/${TRACE_MAX}; ${open}/${run.nodes.length} nodes opened). The PC is back in their body${body ? ` on ${body.name}` : ""} (${run.body}).`;
}

// ─── the net map ────────────────────────────────────────────────────────────

export interface NetNodeInput {
	kind: NetNodeKind;
	name: string;
	controls?: string;
	holds?: string;
	disguise?: string;
}

/** Room interior (floor) size and the gap between room walls. */
const ROOM = 5;
const GAP = 2;
const CELL = ROOM + 2 + GAP;
const MARGIN = 1;

/** A node's room tag and label as the player sees it (honeypots pass for data until touched). */
export function nodeFace(n: Pick<NetNode, "kind" | "name" | "disguise" | "open">): { tag: string; name: string } {
	if (n.kind === "honeypot" && !n.open) return { tag: "data", name: n.disguise?.trim() || n.name };
	return { tag: n.kind, name: n.name };
}

/**
 * Lays the nodes out left to right. The entry and each firewall are gates on
 * the main line; the other nodes listed after a gate hang above and below
 * the line between it and the next gate, so a closed firewall (a locked door
 * on its far wall) seals everything listed after it.
 */
export function buildNetMap(nodes: NetNode[], name: string, seed: number): GridMap {
	const entry = nodes.find((n) => n.kind === "entry")!;
	const ordered = [entry, ...nodes.filter((n) => n !== entry)];
	type Seg = { gate: NetNode; followers: NetNode[] };
	const segs: Seg[] = [];
	for (const n of ordered) {
		if (n.kind === "entry" || n.kind === "firewall") segs.push({ gate: n, followers: [] });
		else segs[segs.length - 1].followers.push(n);
	}
	// Columns: each gate, then its followers two to a column (above, below).
	type Slot = { node: NetNode; col: number; row: -1 | 0 | 1 };
	const slots: Slot[] = [];
	const gateCol: number[] = [];
	let col = 0;
	for (const s of segs) {
		gateCol.push(col);
		slots.push({ node: s.gate, col, row: 0 });
		col++;
		s.followers.forEach((f, i) => slots.push({ node: f, col: col + Math.floor(i / 2), row: i % 2 === 0 ? -1 : 1 }));
		col += Math.ceil(s.followers.length / 2);
	}
	const cols = col;
	const hasUp = slots.some((s) => s.row === -1);
	const hasDown = slots.some((s) => s.row === 1);
	const rowIndex = (row: number) => row + (hasUp ? 1 : 0);
	const rows = 1 + (hasUp ? 1 : 0) + (hasDown ? 1 : 0);
	const width = MARGIN * 2 + cols * CELL - GAP;
	const height = MARGIN * 2 + rows * CELL - GAP;
	const tiles: Tile[] = new Array(width * height).fill("void");
	const set = (x: number, y: number, t: Tile) => {
		if (x >= 0 && y >= 0 && x < width && y < height) tiles[y * width + x] = t;
	};
	const get = (x: number, y: number): Tile => (x >= 0 && y >= 0 && x < width && y < height ? tiles[y * width + x] : "void");
	/** Outer (walled) rect of a slot and the centre of its floor. */
	const outer = (c: number, row: number) => ({ x: MARGIN + c * CELL, y: MARGIN + rowIndex(row) * CELL });
	const centre = (c: number, row: number) => {
		const o = outer(c, row);
		return { x: o.x + 1 + Math.floor(ROOM / 2), y: o.y + 1 + Math.floor(ROOM / 2) };
	};
	const rooms: MapRoom[] = [];
	for (const s of slots) {
		const o = outer(s.col, s.row);
		for (let y = o.y; y < o.y + ROOM + 2; y++) for (let x = o.x; x < o.x + ROOM + 2; x++) set(x, y, "wall");
		for (let y = o.y + 1; y <= o.y + ROOM; y++) for (let x = o.x + 1; x <= o.x + ROOM; x++) set(x, y, "floor");
		const face = nodeFace(s.node);
		const room: MapRoom = { id: `node-${s.node.id}`, x: o.x + 1, y: o.y + 1, w: ROOM, h: ROOM, tag: face.tag, name: face.name };
		rooms.push(room);
		s.node.roomId = room.id;
	}
	const carve = (x: number, y: number) => {
		if (get(x, y) === "void" || get(x, y) === "wall") set(x, y, "floor");
	};
	const hLine = (y: number, x0: number, x1: number) => {
		for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) carve(x, y);
	};
	const vLine = (x: number, y0: number, y1: number) => {
		for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) carve(x, y);
	};
	const spineY = centre(0, 0).y;
	const locks: { x: number; y: number; node: NetNode }[] = [];
	segs.forEach((s, k) => {
		const gc = gateCol[k];
		const exitX = outer(gc, 0).x + ROOM + 1; // the gate's far wall
		const mine = slots.filter((sl) => s.followers.includes(sl.node));
		const nextGate = k + 1 < segs.length ? gateCol[k + 1] : undefined;
		const lastX = nextGate !== undefined ? outer(nextGate, 0).x : mine.length ? Math.max(...mine.map((m) => centre(m.col, 0).x)) : undefined;
		if (lastX === undefined) return;
		hLine(spineY, exitX, lastX);
		if (s.gate.kind === "firewall") locks.push({ x: exitX, y: spineY, node: s.gate });
		for (const m of mine) {
			const c = centre(m.col, m.row);
			const o = outer(m.col, m.row);
			vLine(c.x, spineY, m.row === -1 ? o.y + ROOM + 1 : o.y);
		}
	});
	for (const l of locks) set(l.x, l.y, l.node.open ? "door_open" : "door_locked");
	// Wrap every corridor in walls.
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			if (get(x, y) !== "void") continue;
			let near = false;
			for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && get(x + dx, y + dy) === "floor") near = true;
			if (near) set(x, y, "wall");
		}
	const e = centre(0, 0);
	return {
		id: "",
		name,
		kind: "dungeon",
		seed,
		width,
		height,
		tiles,
		explored: new Array(width * height).fill(true),
		rooms,
		entities: [],
		lighting: "bright",
		entry: e,
		drawn: true,
		theme: "net",
	};
}

/** The door on a firewall's far wall (where the main line leaves its room). */
function firewallDoor(map: GridMap, node: NetNode): { x: number; y: number } | undefined {
	const room = map.rooms.find((r) => r.id === node.roomId);
	if (!room) return undefined;
	const x = room.x + room.w;
	const y = room.y + Math.floor(room.h / 2);
	const t = map.tiles[y * map.width + x];
	return t === "door_locked" || t === "door_open" ? { x, y } : undefined;
}

// ─── jack in / jack out ─────────────────────────────────────────────────────

export interface JackInInput {
	target: string;
	security: number;
	body: NetRun["body"];
	nodes: NetNodeInput[];
	/** Den proxies (Phase 3): trace ticks ignored this run. */
	proxy?: number;
}

export function validateNodes(nodes: NetNodeInput[]): string | undefined {
	if (!Array.isArray(nodes) || nodes.length < MIN_NODES || nodes.length > MAX_NODES) return `A network has ${MIN_NODES}–${MAX_NODES} nodes.`;
	const bad = nodes.find((n) => !NODE_KINDS.includes(n.kind));
	if (bad) return `Unknown node kind "${bad.kind}" (use ${NODE_KINDS.join(", ")}).`;
	if (nodes.some((n) => !n.name?.trim())) return "Every node needs a name.";
	const entries = nodes.filter((n) => n.kind === "entry").length;
	if (entries !== 1) return `Exactly one entry node (got ${entries}).`;
	return undefined;
}

/** Jacks the PC into `target`: builds the net map, makes it active, starts the trace. */
export function jackIn(state: GameState, input: JackInInput, rng: Rng): string {
	const cy = cyberOf(state);
	if (cy.run) throw new Error(`Already jacked into ${cy.run.target}. jack_out first.`);
	if (state.encounter?.status === "active") throw new Error("Can't jack in during a fight: end it (or get clear) first.");
	const c = state.character;
	const wetwired = c.classes?.some((k) => k.classId === "sorcerer");
	const deck = deckOf(c);
	if (!deck && !wetwired) throw new Error(`${c.name} has no deck (only the Wetwired hack by touch). Give them one first, or play it as a check without a run.`);
	const security = Math.max(1, Math.min(5, Math.round(input.security)));
	const problem = validateNodes(input.nodes);
	if (problem) throw new Error(problem);
	if (!["den", "public", "onsite"].includes(input.body)) throw new Error("body is den, public or onsite.");
	// Old net maps nothing points to any more.
	for (const m of Object.values(state.maps)) if (m.theme === "net" && state.encounter?.mapId !== m.id) delete state.maps[m.id];
	const nodes: NetNode[] = input.nodes.map((n, i) => ({
		id: `n${i + 1}`,
		kind: n.kind,
		name: n.name.trim().slice(0, 60),
		roomId: "",
		open: n.kind === "entry",
		...(n.controls?.trim() ? { controls: n.controls.trim() } : {}),
		...(n.holds?.trim() ? { holds: n.holds.trim() } : {}),
		...(n.disguise?.trim() ? { disguise: n.disguise.trim() } : {}),
	}));
	const map = buildNetMap(nodes, `${input.target.trim()} (net)`, rng.int(1, 2 ** 31 - 1));
	map.id = `map_net_${rng.int(1, 2 ** 31 - 1).toString(36)}`;
	placeEntity(map, { id: pcEntityId(c), kind: "pc", name: c.name, sprite: "pc", disposition: "friendly", x: map.entry.x, y: map.entry.y }, map.entry);
	const run: NetRun = {
		id: `run_${rng.int(1, 2 ** 31 - 1).toString(36)}`,
		target: input.target.trim().slice(0, 80),
		security,
		body: input.body,
		...(state.activeMapId && state.maps[state.activeMapId] ? { bodyMapId: state.activeMapId } : {}),
		netMapId: map.id,
		nodes,
		trace: 0,
		// The den's proxy chain covers runs started from the den (lib/rules/den.ts).
		proxy: Math.max(0, Math.round(input.proxy ?? 0), denProxy(cy, input.body)),
		sysadminAlerted: false,
		securityDispatched: false,
		startedAt: gameMinutes(state.time),
		log: [],
	};
	state.maps[map.id] = map;
	state.activeMapId = map.id;
	state.view = "map";
	cy.run = run;
	pushLog(run, `Jacked in (${run.body})`);
	return [
		`JACKED IN to ${run.target} (security ${security}: node DC ${nodeDc(security)}; hack bonus ${signed(hackBonus(c))}${deck ? ` with ${deck.name}` : ", by touch"}). Body: ${run.body}. Trace 0/${TRACE_MAX}${run.proxy ? ` (proxy absorbs the first ${run.proxy})` : ""}.`,
		`Net map [${map.id}] is active; the PC stands at the entry. Nodes: ${netNodeList(run, true)}.`,
		"Move the PC's token between nodes as usual; closed firewalls are locked doors. Act on a node with net_action; ICE fights with start_combat (c-ice-… monsters). Every node action, program and PC combat turn raises the trace.",
	].join("\n");
}

/** Jacks the PC out on purpose. Refused while grappled (Tar Pit ICE). */
export function jackOut(state: GameState): string {
	const run = activeRun(state);
	if (!run) throw new Error("The PC isn't jacked in.");
	const c = state.character;
	const enc = state.encounter;
	const pcCombatant = enc?.status === "active" ? enc.combatants[c.id] : undefined;
	if (c.conditions.some((k) => k.id === "grappled") || pcCombatant?.conditions.some((k) => k.id === "grappled"))
		throw new Error(`${c.name} is held (grappled, a Tar Pit) and can't jack out. Break free first (an escape check on their turn), or ride the trace.`);
	const ended = endNetCombat(state);
	const lines = [closeRun(state, "jacked out")];
	if (ended) lines.unshift("The PC jacks out mid-fight (their action): the ICE stays behind; end_combat status 'fled' clears the tracker.");
	return lines.join("\n");
}

// ─── node actions ───────────────────────────────────────────────────────────

/** Finds a node by id ("n3"), name or (honeypots) disguise. */
export function findNode(run: NetRun, ref: string): NetNode | undefined {
	const r = ref.trim().toLowerCase();
	return run.nodes.find((n) => n.id === r) ?? run.nodes.find((n) => n.name.toLowerCase() === r || n.disguise?.toLowerCase() === r || n.roomId === r);
}

/** Squares reachable on foot from `from` (locked doors, i.e. closed firewalls, block). */
export function netReach(map: GridMap, from: { x: number; y: number }): Uint8Array {
	return reachableFrom({ width: map.width, height: map.height, tiles: map.tiles.map((t) => (t === "door_locked" ? "wall" : t)) }, from);
}

const inRoom = (room: MapRoom, x: number, y: number, pad = 0) => x >= room.x - pad && y >= room.y - pad && x < room.x + room.w + pad && y < room.y + room.h + pad;

/** Gets the PC's token into the node's room: refused behind a closed firewall, or in combat when not there. */
function reachNode(state: GameState, run: NetRun, map: GridMap, node: NetNode): string | undefined {
	const room = map.rooms.find((r) => r.id === node.roomId);
	if (!room) throw new Error(`Node ${node.name} has no room on the net map.`);
	const c = state.character;
	let pc: MapEntity | undefined = map.entities.find((e) => e.id === pcEntityId(c)) ?? map.entities.find((e) => e.kind === "pc");
	if (!pc) pc = placeEntity(map, { id: pcEntityId(c), kind: "pc", name: c.name, sprite: "pc", disposition: "friendly", x: map.entry.x, y: map.entry.y }, map.entry);
	const fighting = state.encounter?.status === "active" && state.encounter.mapId === map.id;
	if (inRoom(room, pc.x, pc.y, fighting ? 1 : 0)) return undefined;
	const seen = netReach(map, pc);
	let reachable = false;
	for (let y = room.y; y < room.y + room.h && !reachable; y++) for (let x = room.x; x < room.x + room.w; x++) if (seen[y * map.width + x]) reachable = true;
	if (!reachable) {
		const gate = run.nodes.find((n) => {
			const r = n.kind === "firewall" && !n.open ? map.rooms.find((k) => k.id === n.roomId) : undefined;
			return !!r && !!seen[(r.y + Math.floor(r.h / 2)) * map.width + r.x + Math.floor(r.w / 2)];
		});
		throw new Error(`${nodeFace(node).name} is behind a closed firewall${gate ? ` (${gate.name})` : ""}: breach it first (net_action breach) and then move on.`);
	}
	if (fighting) throw new Error(`${c.name} isn't at ${nodeFace(node).name}: move there first on their turn (it's in reach).`);
	const [spot] = findFreeSquares(map, { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) }, 1);
	if (spot) {
		pc.x = spot.x;
		pc.y = spot.y;
	}
	return `${c.name} moves through the net to ${nodeFace(node).name}.`;
}

/** The PC acts on a node: the check, its effect and the trace. */
export function netAction(state: GameState, ref: string, action: NetActionId, rng: Rng, record: RecordRoll): string {
	const run = activeRun(state);
	if (!run) throw new Error("The PC isn't jacked in: jack_in first.");
	const map = state.maps[run.netMapId];
	if (!map) throw new Error("The net map is gone; jack_out and jack_in again.");
	if (!NET_ACTIONS.includes(action)) throw new Error(`Unknown action "${action}" (use ${NET_ACTIONS.join(", ")}).`);
	const node = findNode(run, ref);
	if (!node) throw new Error(`No node "${ref}" in ${run.target}. Nodes: ${netNodeList(run, true)}.`);
	if (node.kind === "entry") throw new Error("The entry is just the way in; nothing to do there (jack_out leaves from anywhere).");
	if (node.kind !== "honeypot") {
		const want = ACTION_FOR[node.kind];
		if (action !== want) throw new Error(`${node.name} is a ${node.kind} node: use ${want}.`);
	}
	const enc = state.encounter;
	const fighting = enc?.status === "active" && enc.mapId === map.id;
	const pcC = fighting ? enc!.combatants[state.character.id] : undefined;
	if (fighting) {
		if (enc!.order[enc!.turnIndex] !== state.character.id) throw new Error("It isn't the PC's turn: a node action takes their action.");
		if (pcC && !pcC.turn.action) throw new Error("The PC has already used their action this turn.");
	}
	const lines: string[] = [];
	const moved = reachNode(state, run, map, node);
	if (moved) lines.push(moved);
	if (pcC) pcC.turn.action = false;
	const c = state.character;
	const dc = nodeDc(run.security);
	// The van: a runner or tech of the crew rides along (+2, lib/rules/crew.ts).
	const van = vanAssist(state);
	const check = (label: string) => {
		const r = roll(rng, `1d20${signed(hackBonus(c) + van.bonus)}`, { label: `${label} (DC ${dc})${van.who ? ` +${van.bonus} ${van.who} in the van` : ""}`, actor: c.id, target: dc });
		record(r);
		return { ok: r.total >= dc, text: `${label}: ${r.total} vs DC ${dc}${van.who ? ` (${van.who} helping from the van, +${van.bonus})` : ""}` };
	};
	let extra = 0;
	let why = `${action.replace("_", " ")} at ${nodeFace(node).name}`;

	if (node.kind === "honeypot") {
		const wasOpen = node.open;
		node.open = true;
		const room = map.rooms.find((r) => r.id === node.roomId);
		if (room) {
			room.tag = "honeypot";
			room.name = node.name;
		}
		extra = 3;
		why = `honeypot ${node.name}`;
		lines.push(
			wasOpen
				? `${node.name} is a known honeypot; poking it again feeds the trace.`
				: `HONEYPOT: "${node.disguise || node.name}" was bait (${node.name}). Nothing real here, and the trap pings the trace (+3).`,
		);
	} else if (node.open && node.kind !== "control") {
		return [...lines, `${node.name} is already open${node.holds && (node.kind === "data" || node.kind === "vault") ? `: ${node.holds}` : ""}. No trace for looking again.`].join("\n");
	} else if (node.kind === "control" && node.open) {
		lines.push(`${c.name} already holds ${node.name}: working it again (no check). Narrate the physical effect${node.controls ? ` on ${node.controls}` : ""}.`);
	} else {
		const label = { firewall: "Breach", data: "Access", control: "Take control", admin: "Take admin", vault: "Open the vault" }[node.kind];
		const r = check(`${label} ${node.name}`);
		if (!r.ok) {
			if (node.kind === "firewall") {
				extra = 2;
				lines.push(`${r.text}: FAILED. The firewall holds and flags the attempt (+2 trace). Try again or find another way.`);
			} else lines.push(`${r.text}: failed. Nothing yet; try again.`);
		} else {
			node.open = true;
			if (node.kind === "firewall") {
				const door = firewallDoor(map, node);
				if (door) map.tiles[door.y * map.width + door.x] = "door_open";
				lines.push(`${r.text}: BREACHED. ${node.name} is open; the nodes behind it are in reach.`);
			} else if (node.kind === "data") lines.push(`${r.text}: in. ${node.name} holds: ${node.holds ?? "nothing worth much (decide it, small)"}.`);
			else if (node.kind === "vault") lines.push(`${r.text}: THE VAULT OPENS. ${node.name} holds: ${node.holds ?? "the objective (describe it)"}.`);
			else if (node.kind === "control")
				lines.push(`${r.text}: ${c.name} controls ${node.name}. Narrate the physical effect${node.controls ? ` on ${node.controls}` : ""}: it really happens in the world (doors, cameras, lights for the crew and the guards).`);
			else if (node.kind === "admin") {
				extra = -3;
				const ice = fighting ? Object.values(enc!.combatants).filter((k) => k.side === "enemy" && !k.dead && /^c-ice-/.test(k.refId) && k.refId !== SYSADMIN_MONSTER) : [];
				lines.push(
					`${r.text}: ROOT. ${c.name} owns ${run.target} (−3 trace). ICE in this system can be shut down: ${ice.length ? `remove_combatant ${ice.map((k) => `${k.name} [${k.id}]`).join(", ")} (reason 'shut down') if the PC does it` : "any ICE met from here on can be switched off instead of fought"}. The sysadmin is a person, not a program: root doesn't stop them.`,
				);
			}
		}
	}
	const trace = traceTick(state, 1 + extra, why, rng, record);
	return [...lines, ...trace].join("\n");
}

// ─── hooks: programs, combat turns ──────────────────────────────────────────

/**
 * A program the PC ran (cast_spell): +1 trace during a run (+2 if loud, heat ≥ 2);
 * outside a run its street-hack heat goes straight onto Heat.
 */
/** Programs the network doesn't log (their text says "no trace tick"). */
export const SILENT_PROGRAMS = new Set(["p-backdoor"]);
export const isSilentProgram = (spell: { index?: string; description?: string }) => (!!spell.index && SILENT_PROGRAMS.has(spell.index)) || /no trace tick/i.test(spell.description ?? "");

export function programRan(state: GameState, spell: Pick<SpellInfo, "name"> & { index?: string; description?: string; heat?: number }, rng?: Rng, record?: RecordRoll): string[] {
	if (!isCyber(state)) return [];
	if (activeRun(state) && isSilentProgram(spell)) return [`${spell.name} leaves no trace in the logs (trace unchanged).`];
	if (activeRun(state)) return traceTick(state, (spell.heat ?? 0) >= 2 ? 2 : 1, `ran ${spell.name}${(spell.heat ?? 0) >= 2 ? " (loud)" : ""}`, rng, record);
	if (spell.heat) return [addHeat(cyberOf(state), spell.heat, `street hack: ${spell.name}`, gameMinutes(state.time)).text];
	return [];
}

/**
 * Combat results during a run: each PC turn +1 trace, each ICE turn its
 * traceOnTurn, each program the PC ran (+1/+2). Outside a run, programs with
 * heat add Heat. The opening turn of a fight is free (it is the jack-in moment).
 */
export function cyberCombatHook(state: GameState, events: CombatEvent[], rng: Rng, record: RecordRoll): string[] {
	if (!isCyber(state)) return [];
	const out: string[] = [];
	const enc = state.encounter;
	const opening = events.some((e) => e.type === "combat_started");
	for (const ev of events) {
		const run = activeRun(state);
		const onNet = !!run && !!enc && enc.mapId === run.netMapId;
		if (ev.type === "spell_cast" && ev.casterId === state.character.id) {
			const sp = getSpell(ev.spell);
			if (sp) out.push(...programRan(state, sp, rng, record));
		} else if (ev.type === "turn_start" && onNet && !opening) {
			if (ev.combatantId === state.character.id) out.push(...traceTick(state, 1, "a turn in the net", rng, record));
			else {
				const k = enc!.combatants[ev.combatantId];
				const n = (k?.stats as { traceOnTurn?: number } | undefined)?.traceOnTurn;
				if (n && !k.dead) out.push(...traceTick(state, n, `${k.name} pings the trace`, rng, record));
			}
		}
	}
	return out;
}

// ─── digest ─────────────────────────────────────────────────────────────────

function netNodeList(run: NetRun, forDm: boolean): string {
	return run.nodes
		.map((n) => {
			const state = n.kind === "firewall" ? (n.open ? "breached" : "CLOSED") : n.kind === "entry" ? "" : n.open ? "open" : "closed";
			const what = n.kind === "honeypot" ? `honeypot${forDm && !n.open ? ` posing as data "${n.disguise || n.name}"` : ""}` : n.kind;
			const extra = [n.controls ? `controls ${n.controls}` : "", forDm && n.holds ? `holds ${n.holds}` : ""].filter(Boolean).join("; ");
			return `${n.name} [${n.id}] ${what}${state ? ` ${state}` : ""}${extra ? ` (${extra})` : ""}`;
		})
		.join(", ");
}

/** The run line for the DM digest. */
export function netrunDigest(state: GameState): string | undefined {
	const run = activeRun(state);
	if (!run) return undefined;
	const open = run.nodes.filter((n) => n.open && n.kind !== "entry").length;
	const flags = [run.sysadminAlerted ? "sysadmin alerted" : "", run.securityDispatched ? "security sent to the body" : "", run.proxy ? `proxy ${run.proxy}` : ""].filter(Boolean).join(", ");
	return `NET RUN: ${run.target} · security ${run.security} (DC ${nodeDc(run.security)}) · TRACE ${run.trace}/${TRACE_MAX}${flags ? ` (${flags})` : ""} · body ${run.body}${run.bodyMapId ? ` [${run.bodyMapId}]` : ""} · ${open}/${run.nodes.length - 1} nodes open: ${netNodeList(run, true)}`;
}
