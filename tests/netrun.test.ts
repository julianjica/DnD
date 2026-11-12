import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { GameState, NetNode, RollRecord } from "../lib/game/types";
import type { CombatEvent } from "../lib/rules/combat/types";
import {
	activeRun,
	buildNetMap,
	cyberCombatHook,
	jackIn,
	jackOut,
	netReach,
	netAction,
	netrunDigest,
	nodeDc,
	programRan,
	traceTick,
	validateNodes,
	type NetNodeInput,
} from "../lib/rules/netrun";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-netrun-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	digest: typeof import("../lib/dm/digest");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		digest: await import("../lib/dm/digest"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// ─── fixtures ────────────────────────────────────────────────────────────────

const STD = { method: "standard_array" as const, scores: { str: 8, con: 14, dex: 13, wis: 12, int: 15, cha: 10 } };

/** A Wetwired (sorcerer) with the second-hand deck, in Root Access / fantasy / The Quiet. */
function newGame(ruleset: "cyberpunk" | "fantasy" | "zombie" = "cyberpunk"): string {
	const settings = m.defaultSettings();
	settings.dm.fights = "turns"; // these tests play fights turn by turn (the default is automatic)
	if (ruleset === "cyberpunk") settings.world.preset = "marea_burned" as never;
	if (ruleset === "zombie") settings.world.preset = "zombie_outbreak" as never;
	return m.createGame({ settings, character: { name: "Vera", speciesId: "human", classId: "sorcerer", backgroundId: "criminal", abilities: STD } }).id;
}

function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

/** A cyber game with a body map, ready to jack in. */
async function readyGame(): Promise<string> {
	const id = newGame();
	const r = await call(id, "generate_map", { kind: "tavern", name: "The capsule room" });
	assert.ok(!r.isError, r.text);
	return id;
}

const NODES: NetNodeInput[] = [
	{ kind: "entry", name: "Guest wifi" },
	{ kind: "data", name: "Visitor logs", holds: "badge codes for floor 3" },
	{ kind: "firewall", name: "Perimeter wall" },
	{ kind: "control", name: "Lobby cameras", controls: "the lobby cameras" },
	{ kind: "honeypot", name: "Honeypot", disguise: "Executive payroll" },
	{ kind: "admin", name: "Root console" },
	{ kind: "vault", name: "Research vault", holds: "the Trial 0 file" },
];

/** Hack bonus that can't miss DC 12 (security 1) or can't reach DC 20 (security 5). */
const sure = (s: GameState) => void (s.character.abilities.int = 30);
const hopeless = (s: GameState) => void (s.character.abilities.int = 1);

function rolls(): { list: RollRecord[]; record: (r: RollRecord) => void } {
	const list: RollRecord[] = [];
	return { list, record: (r) => list.push(r) };
}

const node = (s: GameState, name: string): NetNode => activeRun(s)!.nodes.find((n) => n.name === name)!;
const pcOn = (s: GameState) => s.maps[s.activeMapId!].entities.find((e) => e.kind === "pc")!;
const inRoomOf = (s: GameState, n: NetNode) => {
	const room = s.maps[activeRun(s)!.netMapId].rooms.find((r) => r.id === n.roomId)!;
	const pc = pcOn(s);
	return pc.x >= room.x && pc.y >= room.y && pc.x < room.x + room.w && pc.y < room.y + room.h;
};

/** State with a run in progress (in memory). */
async function running(opts: { security?: number; body?: "den" | "public" | "onsite"; nodes?: NetNodeInput[]; proxy?: number; tweak?: (s: GameState) => void } = {}): Promise<GameState> {
	const id = await readyGame();
	const s = m.loadState(id);
	opts.tweak?.(s);
	jackIn(s, { target: "Vantis lab server 7", security: opts.security ?? 1, body: opts.body ?? "den", nodes: opts.nodes ?? NODES, proxy: opts.proxy }, new Rng(7));
	return s;
}

// ─── layout ──────────────────────────────────────────────────────────────────

function mkNodes(inputs: NetNodeInput[]): NetNode[] {
	return inputs.map((n, i) => ({ id: `n${i + 1}`, kind: n.kind, name: n.name, roomId: "", open: n.kind === "entry", ...(n.disguise ? { disguise: n.disguise } : {}) }));
}

test("net map: one room per node tagged with its kind, entry first, revealed, theme net", () => {
	const nodes = mkNodes(NODES);
	const map = buildNetMap(nodes, "Lab (net)", 1);
	assert.equal(map.theme, "net");
	assert.equal(map.rooms.length, NODES.length);
	assert.ok(map.explored.every(Boolean));
	assert.equal(map.tiles.length, map.width * map.height);
	for (const n of nodes) assert.ok(map.rooms.some((r) => r.id === n.roomId), n.name);
	const entryRoom = map.rooms.find((r) => r.id === nodes[0].roomId)!;
	assert.equal(entryRoom.tag, "entry");
	assert.ok(map.entry.x >= entryRoom.x && map.entry.x < entryRoom.x + entryRoom.w && map.entry.y >= entryRoom.y && map.entry.y < entryRoom.y + entryRoom.h);
	// Leftmost room is the entry.
	assert.equal(Math.min(...map.rooms.map((r) => r.x)), entryRoom.x);
	// A honeypot passes for data with its disguise.
	const hp = map.rooms.find((r) => r.id === nodes[4].roomId)!;
	assert.deepEqual([hp.tag, hp.name], ["data", "Executive payroll"]);
	assert.equal(map.rooms.find((r) => r.id === nodes[3].roomId)!.tag, "control");
});

test("net map: a closed firewall seals what's listed after it; opening it connects everything", () => {
	const nodes = mkNodes(NODES);
	const map = buildNetMap(nodes, "Lab (net)", 1);
	const centreOf = (n: NetNode) => {
		const r = map.rooms.find((k) => k.id === n.roomId)!;
		return (r.y + 2) * map.width + r.x + 2;
	};
	let seen = netReach(map, map.entry);
	assert.ok(seen[centreOf(nodes[1])], "data before the firewall");
	assert.ok(seen[centreOf(nodes[2])], "the firewall itself");
	for (const n of nodes.slice(3)) assert.ok(!seen[centreOf(n)], `${n.name} sealed`);
	const i = map.tiles.indexOf("door_locked");
	assert.ok(i >= 0);
	map.tiles[i] = "door_open";
	seen = netReach(map, map.entry);
	for (const n of nodes) assert.ok(seen[centreOf(n)], `${n.name} reachable`);
});

test("net map: 12 nodes, all gates or all branches, still lay out", () => {
	const gates = mkNodes([{ kind: "entry", name: "E" }, ...Array.from({ length: 11 }, (_, i) => ({ kind: "firewall" as const, name: `F${i}` }))]);
	const a = buildNetMap(gates, "Gates", 1);
	assert.equal(a.rooms.length, 12);
	assert.equal(a.tiles.filter((t) => t === "door_locked").length, 10, "the last firewall guards nothing");
	const fan = mkNodes([{ kind: "entry", name: "E" }, ...Array.from({ length: 11 }, (_, i) => ({ kind: "data" as const, name: `D${i}` }))]);
	const b = buildNetMap(fan, "Fan", 1);
	const seen = netReach(b, b.entry);
	for (const r of b.rooms) assert.ok(seen[(r.y + 2) * b.width + r.x + 2], r.id);
	assert.ok(b.width <= 80 && b.height <= 30);
});

test("node lists: 2–12 nodes, exactly one entry, known kinds", () => {
	assert.match(validateNodes([{ kind: "entry", name: "E" }])!, /2–12/);
	assert.match(validateNodes(Array.from({ length: 13 }, (_, i) => ({ kind: i ? "data" : "entry", name: "x" }) as NetNodeInput))!, /2–12/);
	assert.match(validateNodes([{ kind: "data", name: "A" }, { kind: "data", name: "B" }])!, /Exactly one entry/);
	assert.match(validateNodes([{ kind: "entry", name: "A" }, { kind: "entry", name: "B" }])!, /Exactly one entry/);
	assert.match(validateNodes([{ kind: "entry", name: "A" }, { kind: "mainframe" as never, name: "B" }])!, /Unknown node kind/);
	assert.equal(validateNodes(NODES), undefined);
});

// ─── jack in / out ───────────────────────────────────────────────────────────

test("jack_in builds and activates the net map; jack_out restores the body map", async () => {
	const id = await readyGame();
	const bodyMap = m.loadState(id).activeMapId!;
	const r = await call(id, "jack_in", { target: "Vantis lab server 7", security: 3, body: "onsite", nodes: NODES });
	assert.ok(!r.isError, r.text);
	assert.match(r.text, /JACKED IN.*DC 16/);
	let s = m.loadState(id);
	const run = activeRun(s)!;
	assert.equal(run.bodyMapId, bodyMap);
	assert.equal(s.activeMapId, run.netMapId);
	assert.equal(s.maps[run.netMapId].theme, "net");
	assert.ok(inRoomOf(s, run.nodes[0]), "PC at the entry");
	assert.equal(run.trace, 0);
	assert.ok(run.nodes.every((n) => n.roomId));
	assert.match(netrunDigest(s)!, /NET RUN: Vantis lab server 7 · security 3 \(DC 16\) · TRACE 0\/10 · body onsite/);
	assert.match(m.digest.stateDigest(s), /NET RUN:/);
	assert.ok((await call(id, "jack_in", { target: "x", security: 1, body: "den", nodes: NODES })).isError, "one run at a time");
	const out = await call(id, "jack_out", {});
	assert.ok(!out.isError, out.text);
	s = m.loadState(id);
	assert.equal(activeRun(s), undefined);
	assert.equal(s.activeMapId, bodyMap);
	assert.ok((await call(id, "jack_out", {})).isError);
});

test("jack_in validates nodes and needs a deck (the Wetwired excepted)", async () => {
	const id = await readyGame();
	assert.match((await call(id, "jack_in", { target: "x", security: 1, body: "den", nodes: [{ kind: "data", name: "A" }, { kind: "data", name: "B" }] })).text, /Exactly one entry/);
	edit(id, (s) => {
		s.character.inventory = s.character.inventory.filter((i) => i.ref !== "c-deck-secondhand");
		s.character.classes = [{ ...s.character.classes[0], classId: "rogue" }];
	});
	const r = await call(id, "jack_in", { target: "x", security: 1, body: "den", nodes: NODES });
	assert.ok(r.isError);
	assert.match(r.text, /no deck/);
});

test("jack_out is refused while grappled (Tar Pit)", async () => {
	const s = await running();
	s.character.conditions.push({ id: "grappled", source: "c-ice-tarpit" });
	assert.throws(() => jackOut(s), /grappled/);
	s.character.conditions = [];
	assert.match(jackOut(s), /back in their body/);
});

// ─── node actions ────────────────────────────────────────────────────────────

test("breach: success opens the firewall door (+1 trace); failure is +2 more", async () => {
	const s = await running({ tweak: sure });
	const { list, record } = rolls();
	const out = netAction(s, "Perimeter wall", "breach", new Rng(1), record);
	assert.match(out, /vs DC 12: BREACHED/);
	assert.equal(list.length, 1);
	assert.equal(list[0].target, 12);
	assert.ok(node(s, "Perimeter wall").open);
	assert.equal(s.maps[activeRun(s)!.netMapId].tiles.filter((t) => t === "door_locked").length, 0);
	assert.equal(activeRun(s)!.trace, 1);
	assert.ok(inRoomOf(s, node(s, "Perimeter wall")), "token walked to the node");

	const f = await running({ security: 5, tweak: hopeless });
	assert.match(netAction(f, "n3", "breach", new Rng(1), () => undefined), /vs DC 20: FAILED/);
	assert.equal(activeRun(f)!.trace, 3);
	assert.ok(!node(f, "Perimeter wall").open);
});

test("nodes behind a closed firewall are out of reach; actions must fit the node", async () => {
	const s = await running({ tweak: sure });
	assert.throws(() => netAction(s, "Research vault", "open_vault", new Rng(1), () => undefined), /behind a closed firewall \(Perimeter wall\)/);
	assert.throws(() => netAction(s, "Visitor logs", "breach", new Rng(1), () => undefined), /data node: use access/);
	assert.throws(() => netAction(s, "Guest wifi", "access", new Rng(1), () => undefined), /entry/);
	assert.throws(() => netAction(s, "Nope", "access", new Rng(1), () => undefined), /No node/);
	assert.equal(activeRun(s)!.trace, 0);
});

test("access reveals what data holds; control asks for the physical effect; vault opens", async () => {
	const s = await running({ tweak: sure });
	const rng = new Rng(3);
	assert.match(netAction(s, "Visitor logs", "access", rng, () => undefined), /holds: badge codes for floor 3/);
	assert.match(netAction(s, "Visitor logs", "access", rng, () => undefined), /already open: badge codes/);
	assert.equal(activeRun(s)!.trace, 1, "looking again is free");
	netAction(s, "Perimeter wall", "breach", rng, () => undefined);
	assert.match(netAction(s, "Lobby cameras", "take_control", rng, () => undefined), /Narrate the physical effect on the lobby cameras/);
	assert.match(netAction(s, "Lobby cameras", "take_control", rng, () => undefined), /already holds/);
	assert.match(netAction(s, "Research vault", "open_vault", rng, () => undefined), /THE VAULT OPENS.*Trial 0 file/);
	assert.equal(activeRun(s)!.trace, 5);
});

test("take admin: −3 trace (net −2 with the action) and ICE can be shut down", async () => {
	const s = await running({ tweak: sure });
	netAction(s, "Perimeter wall", "breach", new Rng(1), () => undefined);
	activeRun(s)!.trace = 4;
	const out = netAction(s, "Root console", "take_admin", new Rng(1), () => undefined);
	assert.match(out, /ROOT.*ICE in this system can be shut down/);
	assert.equal(activeRun(s)!.trace, 2);
});

test("a honeypot springs on any touch: +3 (+1) trace and it is revealed", async () => {
	const s = await running({ tweak: sure });
	netAction(s, "Perimeter wall", "breach", new Rng(1), () => undefined);
	const { list, record } = rolls();
	const out = netAction(s, "Executive payroll", "access", new Rng(1), record);
	assert.match(out, /HONEYPOT/);
	assert.equal(list.length, 0, "no check");
	assert.equal(activeRun(s)!.trace, 5);
	const room = s.maps[activeRun(s)!.netMapId].rooms.find((r) => r.id === node(s, "Honeypot").roomId)!;
	assert.deepEqual([room.tag, room.name], ["honeypot", "Honeypot"]);
});

test("DC is 10 + 2 × security", () => {
	assert.deepEqual([1, 2, 3, 4, 5].map(nodeDc), [12, 14, 16, 18, 20]);
});

// ─── the trace clock ─────────────────────────────────────────────────────────

test("trace 5 alerts the sysadmin once; 8 sends security to an onsite body", async () => {
	const s = await running({ body: "onsite" });
	let out = traceTick(s, 5, "noise", new Rng(1));
	assert.ok(out.some((l) => /TRACE 5.*c-ice-sysadmin/.test(l)));
	assert.ok(activeRun(s)!.sysadminAlerted);
	traceTick(s, -2, "cover");
	out = traceTick(s, 3, "noise", new Rng(1));
	assert.ok(!out.some((l) => /TRACE 5/.test(l)), "only once");
	out = traceTick(s, 2, "noise", new Rng(1));
	assert.ok(out.some((l) => /TRACE 8: security is dispatched to the PC's body/.test(l)));
	assert.ok(activeRun(s)!.securityDispatched);

	const den = await running({ body: "den" });
	out = traceTick(den, 8, "noise", new Rng(1));
	assert.ok(!activeRun(den)!.securityDispatched);
	assert.ok(out.some((l) => /TRACE 8: they have the PC's route/.test(l)));
	assert.equal(traceTick(den, -20, "scrub").length, 1);
	assert.equal(activeRun(den)!.trace, 0, "clamped at 0");
	assert.deepEqual(traceTick({ ...den, cyber: { ...den.cyber!, run: undefined } } as GameState, 3, "x"), [], "no run, nothing");
});

test("proxy ticks absorb rises first", async () => {
	const s = await running({ proxy: 2 });
	const out = traceTick(s, 3, "noise", new Rng(1));
	assert.match(out[0], /Proxy absorbs 2/);
	assert.equal(activeRun(s)!.trace, 1);
	assert.equal(activeRun(s)!.proxy, 0);
	traceTick(s, 1, "noise", new Rng(1));
	assert.equal(activeRun(s)!.trace, 2);
});

test("trace 10 dumps the runner: security × d6 psychic, stunned, Heat +3, den roll, body map back", async () => {
	const s = await running({ security: 4, body: "den" });
	s.character.hp = s.character.maxHp = 60;
	const run = activeRun(s)!;
	const heat = s.cyber!.heat;
	const { list, record } = rolls();
	const out = traceTick(s, 10, "full trace", new Rng(5), record);
	const dmg = list.find((r) => r.notation === "4d6")!;
	assert.ok(dmg, "4d6 dumpshock");
	assert.equal(s.character.hp, 60 - dmg.total);
	assert.ok(s.character.conditions.some((c) => c.id === "stunned" && c.rounds === 1));
	assert.equal(s.cyber!.heat, Math.min(10, heat + 3));
	const den = list.find((r) => r.notation === "1d20+8")!;
	assert.ok(den, "den roll d20 + 2×security");
	assert.ok(out.some((l) => (den.total >= 20 ? /DEN FOUND/ : /The den holds/).test(l)));
	assert.ok(out.some((l) => /DUMPED/.test(l)));
	assert.equal(activeRun(s), undefined);
	assert.equal(s.activeMapId, run.bodyMapId);

	const pub = await running({ body: "public" });
	const r2 = rolls();
	traceTick(pub, 12, "full trace", new Rng(5), r2.record);
	assert.ok(!r2.list.some((r) => r.notation.startsWith("1d20")), "no den roll away from the den");
});

test("a dump mid-fight on the net ends the fight", async () => {
	const s = await running();
	s.encounter = { id: "enc", mapId: activeRun(s)!.netMapId, round: 1, turnIndex: 0, order: [], combatants: {}, status: "active", xpPool: 0 };
	s.mode = "combat";
	traceTick(s, 10, "full", new Rng(1));
	assert.equal(s.encounter.status, "fled");
	assert.equal(s.mode, "explore");
});

// ─── hooks ───────────────────────────────────────────────────────────────────

test("cast_spell: +1 trace in a run (+2 loud); outside a run a program's heat lands on Heat", async () => {
	const id = await readyGame();
	edit(id, (s) => void (s.cyber!.heat = 0));
	let r = await call(id, "cast_spell", { spell: "p-sledgehammer" });
	assert.ok(!r.isError, r.text);
	assert.match(r.text, /Heat 0 → 1\/10: street hack: Sledgehammer/);
	assert.equal(m.loadState(id).cyber!.heat, 1);
	await call(id, "jack_in", { target: "Café router", security: 1, body: "public", nodes: NODES.slice(0, 2) });
	r = await call(id, "cast_spell", { spell: "p-sledgehammer" });
	assert.match(r.text, /Trace 0 → 1\/10: ran Sledgehammer/);
	r = await call(id, "cast_spell", { spell: "p-power-surge" });
	assert.match(r.text, /Trace 1 → 3\/10: ran Power Surge \(loud\)/);
	const s = m.loadState(id);
	assert.equal(activeRun(s)!.trace, 3);
	assert.equal(s.cyber!.heat, 1, "no Heat inside the net");
});

test("combat hook: each PC turn +1, ICE turns add traceOnTurn, the opening is free", async () => {
	const s = await running();
	const pcId = s.character.id;
	const netMapId = activeRun(s)!.netMapId;
	const ice = { id: "m1", kind: "monster", name: "Watchdog", refId: "c-ice-watchdog", stats: { traceOnTurn: 1 }, side: "enemy", dead: false, conditions: [] };
	s.encounter = { id: "enc", mapId: netMapId, round: 1, turnIndex: 0, order: [pcId, "m1"], combatants: { m1: ice } as never, status: "active", xpPool: 0 };
	const start: CombatEvent[] = [{ type: "combat_started", order: [pcId, "m1"] }, { type: "turn_start", combatantId: pcId, round: 1 }];
	assert.deepEqual(cyberCombatHook(s, start, new Rng(1), () => undefined), []);
	const turns: CombatEvent[] = [
		{ type: "turn_start", combatantId: "m1", round: 1 },
		{ type: "turn_start", combatantId: pcId, round: 2 },
	];
	cyberCombatHook(s, turns, new Rng(1), () => undefined);
	assert.equal(activeRun(s)!.trace, 2);
	const cast: CombatEvent[] = [{ type: "spell_cast", casterId: pcId, spell: "p-power-surge", slotLevel: 1, targetIds: [] }];
	cyberCombatHook(s, cast, new Rng(1), () => undefined);
	assert.equal(activeRun(s)!.trace, 4);
	// A fight on another map during the run doesn't tick turns.
	s.encounter.mapId = "elsewhere";
	cyberCombatHook(s, turns, new Rng(1), () => undefined);
	assert.equal(activeRun(s)!.trace, 4);
});

test("programRan does nothing outside Root Access", async () => {
	const s = m.loadState(newGame("fantasy"));
	assert.deepEqual(programRan(s, { name: "Sledgehammer", heat: 2 }), []);
	assert.equal(s.cyber, undefined);
});

// ─── refusal outside Root Access; stable tool list ───────────────────────────

test("net-run tools are always listed but refuse outside Root Access", async () => {
	for (const rs of ["fantasy", "zombie"] as const) {
		const id = newGame(rs);
		const names = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).map((t) => t.name);
		for (const n of ["jack_in", "net_action", "adjust_trace", "jack_out"]) assert.ok(names.includes(n), `${rs}: ${n} listed`);
		for (const [name, args] of [["jack_in", { target: "x", security: 1, body: "den", nodes: NODES }], ["net_action", { node: "n2", action: "access" }], ["adjust_trace", { delta: 1, why: "x" }], ["jack_out", {}]] as const) {
			const r = await call(id, name, args);
			assert.ok(r.isError, `${rs}: ${name}`);
			assert.match(r.text, /only exists in Root Access/);
		}
		const s = m.loadState(id);
		assert.equal(s.cyber?.run, undefined);
		assert.doesNotMatch(m.digest.stateDigest(s), /NET RUN/);
	}
});

test("adjust_trace and net_action tools work in a run", async () => {
	const id = await readyGame();
	edit(id, sure);
	await call(id, "jack_in", { target: "Office", security: 1, body: "den", nodes: NODES });
	assert.match((await call(id, "net_action", { node: "Visitor logs", action: "access" })).text, /badge codes/);
	assert.match((await call(id, "adjust_trace", { delta: 2, why: "lingered" })).text, /Trace 1 → 3\/10: lingered/);
	assert.equal(activeRun(m.loadState(id))!.trace, 3);
});

test("real ICE fight on the net map: PC turns and the Watchdog's turns raise the trace", async () => {
	const id = await readyGame();
	await call(id, "jack_in", { target: "Office", security: 1, body: "den", nodes: NODES });
	const s0 = m.loadState(id);
	const room = s0.maps[s0.activeMapId!].rooms.find((r) => r.tag === "entry")!;
	const r = await call(id, "start_combat", { monsters: [{ monster: "c-ice-watchdog", x: room.x + 4, y: room.y + 4 }], override: "test" });
	assert.ok(!r.isError, r.text);
	assert.equal(activeRun(m.loadState(id))!.trace, 0, "the opening turn is free");
	const { withState } = await import("../lib/dm/context");
	const { playerCombatAction, isPcTurn } = await import("../lib/dm/combat");
	const ctx = { campaignId: id, emit: () => undefined, rolls: [] };
	for (let i = 0; i < 2; i++) {
		if (!isPcTurn(m.loadState(id))) await call(id, "auto_monster_turns", {});
		await withState(ctx, (tx) => playerCombatAction(tx, { type: "end_turn" }, tx.rng));
	}
	await call(id, "auto_monster_turns", {});
	const s = m.loadState(id);
	// Two Watchdog turns (+1 each) and at least one fresh PC turn (+1).
	assert.ok(activeRun(s)!.trace >= 3, `trace ${activeRun(s)!.trace}`);
	assert.ok(activeRun(s)!.log.some((l) => /pings the trace/.test(l)));
	assert.ok(activeRun(s)!.log.some((l) => /a turn in the net/.test(l)));
});

test("silent programs (p-backdoor, or text saying 'no trace tick') don't raise the trace", async () => {
	const s = await running();
	const out = programRan(s, { index: "p-backdoor", name: "Backdoor", heat: 0 });
	assert.match(out[0], /no trace/);
	assert.deepEqual(programRan(s, { name: "Custom", description: "Opens it (no trace tick)." }).length, 1);
	assert.equal(activeRun(s)!.trace, 0);
	programRan(s, { index: "p-sledgehammer", name: "Sledgehammer", heat: 1 });
	assert.equal(activeRun(s)!.trace, 1);
});

test("a program cast on the PC's combat turn during a run raises the trace (combat hook wired)", async () => {
	const id = await readyGame();
	await call(id, "jack_in", { target: "Office", security: 1, body: "den", nodes: NODES });
	const s0 = m.loadState(id);
	const room = s0.maps[s0.activeMapId!].rooms.find((r) => r.tag === "entry")!;
	const sc = await call(id, "start_combat", { monsters: [{ monster: "c-ice-watchdog", x: room.x + 4, y: room.y + 4 }], override: "test" });
	assert.ok(!sc.isError, sc.text);
	const { isPcTurn } = await import("../lib/dm/combat");
	if (!isPcTurn(m.loadState(id))) await call(id, "auto_monster_turns", {});
	const before = activeRun(m.loadState(id))!.trace;
	const enemy = Object.values(m.loadState(id).encounter!.combatants).find((c) => c.side === "enemy")!;
	const r = await call(id, "cast_spell", { spell: "p-sledgehammer", targetIds: [enemy.id] });
	assert.ok(!r.isError, r.text);
	assert.match(r.text, /ran Sledgehammer/);
	const after = activeRun(m.loadState(id));
	if (after) assert.equal(after.trace, before + 1);
});
