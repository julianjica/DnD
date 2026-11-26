import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DmEngine, GameState, GridMap, TurnRequest } from "../lib/game/types";
import type { ClientEvent } from "../lib/dm/context";

/**
 * Exploring on foot: walking the token up to something with a `discover` text
 * shows it at once (caption fx + a "discovery" log line, no DM call); only
 * significant discoveries hand the turn to the DM.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-discover-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	readLog: typeof import("../lib/store/campaigns").readLog;
	withState: typeof import("../lib/dm/context").withState;
	explore: typeof import("../lib/dm/explore");
	discover: typeof import("../lib/dm/discover");
	setEngine: typeof import("../lib/engines").setEngine;
	clientState: typeof import("../lib/game/client").clientState;
	digest: typeof import("../lib/dm/digest").stateDigest;
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		readLog: (await import("../lib/store/campaigns")).readLog,
		withState: (await import("../lib/dm/context")).withState,
		explore: await import("../lib/dm/explore"),
		discover: await import("../lib/dm/discover"),
		setEngine: (await import("../lib/engines")).setEngine,
		clientState: (await import("../lib/game/client")).clientState,
		digest: (await import("../lib/dm/digest")).stateDigest,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

type Ruleset = "fantasy" | "zombie" | "cyberpunk";
const STD = { method: "standard_array" as const, scores: { str: 8, con: 14, dex: 13, wis: 12, int: 15, cha: 10 } };

function newGame(ruleset: Ruleset = "fantasy"): string {
	const settings = m.defaultSettings();
	settings.dm.fights = "turns";
	if (ruleset === "cyberpunk") settings.world.preset = "marea_burned" as never;
	if (ruleset === "zombie") settings.world.preset = "zombie_outbreak" as never;
	return m.createGame({ settings, seed: 7, character: { name: "Wren", speciesId: "human", classId: ruleset === "cyberpunk" ? "sorcerer" : "wizard", backgroundId: "criminal", abilities: STD } }).id;
}

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}
async function ok(id: string, name: string, args: Record<string, unknown>) {
	const r = await call(id, name, args);
	assert.ok(!r.isError, `${name}: ${r.text}`);
	return r.text;
}

/** A DM engine stub that counts turns and records their input. */
function stubEngine(id: string) {
	const calls: TurnRequest[] = [];
	const engine: DmEngine = {
		provider: m.loadState(id).settings.engine.provider,
		async runTurn(req) {
			calls.push(req);
			req.onEvent({ type: "text", delta: "The ledger is written in your uncle's hand." });
			// Ends the turn properly (otherwise runTurn asks again for suggestions).
			req.onEvent({ type: "tool_end", id: "t1", name: "suggest_actions", result: { text: "Suggestions set." } });
		},
		resetSession() {},
	};
	m.setEngine(engine.provider, engine);
	return { calls, restore: () => m.setEngine(engine.provider, undefined) };
}

/** Straight-line path (one square per step) from the PC to (x,y). */
function pathTo(map: GridMap, x: number, y: number) {
	const pc = map.entities.find((e) => e.kind === "pc")!;
	const out: { x: number; y: number }[] = [];
	let cx = pc.x, cy = pc.y;
	while (cx !== x || cy !== y) {
		cx += Math.sign(x - cx);
		cy += Math.sign(y - cy);
		out.push({ x: cx, y: cy });
	}
	return out;
}

const active = (id: string) => {
	const s = m.loadState(id);
	return s.maps[s.activeMapId!];
};

/** Walks like the action route does out of combat: engine move, log, DM only if significant. */
async function walk(id: string, x: number, y: number) {
	const events: ClientEvent[] = [];
	const emit = (e: ClientEvent) => events.push(e);
	const r = await m.withState({ campaignId: id, emit, rolls: [] }, (tx) => m.explore.exploreStep(tx, pathTo(tx.state.maps[tx.state.activeMapId!], x, y)));
	const dm = await m.explore.exploreFollowUp(id, emit, r);
	const captions = events.flatMap((e) => (e.type === "fx" && e.fx.kind === "discover" ? [e.fx] : []));
	return { ...r, dm, captions };
}

// A hall 20x8: @ at (2,3); a ledger (L… key "k") at (10,3); a hidden coin purse "c" at (15,5); an old woman "1" at (17,2).
const ROWS = [
	"####################",
	"#..................#",
	"#................1.#",
	"#.@.......k........#",
	"#..................#",
	"#..............c...#",
	"#..................#",
	"####################",
];

async function drawHall(id: string, opts: { significant?: boolean; rooms?: unknown[] } = {}) {
	return ok(id, "draw_map", {
		name: "Hall",
		kind: "dungeon",
		rows: ROWS,
		key: [
			{ char: "k", sprite: "chest", name: "Ledger desk", discover: "An open ledger: the last entry is a debt to your uncle.", significant: opts.significant ?? false },
			{ char: "c", sprite: "crate", name: "Loose flagstone", discover: "A flagstone rocks underfoot; a purse is tucked beneath.", findItem: "2 Silver coins", hidden: true },
			{ char: "1", sprite: "statue", name: "Old statue", discover: "The statue's eyes have been gouged out." },
		],
		...(opts.rooms ? { rooms: opts.rooms } : {}),
	});
}

test("draw_map stores discover texts on key entities (capped), and the summary tags them", async () => {
	const id = newGame();
	const out = await drawHall(id);
	assert.match(out, /Ledger desk\[[^\]]+\] feature@10,3 \(discover\)/);
	assert.match(out, /Loose flagstone\[[^\]]+\] feature@15,5 hidden \(discover, holds 2 Silver coins\)/);
	const map = active(id);
	const desk = map.entities.find((e) => e.name === "Ledger desk")!;
	assert.deepEqual(desk.discover, { text: "An open ledger: the last entry is a debt to your uncle." });
	assert.equal(map.entities.find((e) => e.name === "Loose flagstone")!.hidden, true);
	// Long texts are cut: the caption never becomes a wall of prose.
	const d = m.discover.makeDiscovery("word ".repeat(200), true, "Key");
	assert.ok(d!.text.length <= m.discover.DISCOVER_MAX);
	assert.equal(d!.significant, true);
	assert.equal(m.discover.makeDiscovery("   "), undefined);
	// The digest shows the DM what is still waiting.
	assert.match(m.digest(m.loadState(id), {}), /Ledger desk\[[^\]]+\]@10,3 \(discover\)/);
});

test("walking next to a feature shows its text at once, stops the walk there, and logs it — no DM call", async () => {
	const id = newGame();
	await drawHall(id);
	const dm = stubEngine(id);
	try {
		const r = await walk(id, 14, 3); // the path passes the desk at (10,3)
		assert.equal(r.dm, false);
		assert.equal(dm.calls.length, 0, "no DM turn for a non-significant discovery");
		assert.deepEqual(r.found.map((f) => f.name), ["Ledger desk"]);
		assert.equal(r.captions.length, 1);
		assert.equal(r.captions[0].text, "An open ledger: the last entry is a debt to your uncle.");
		const map = active(id);
		const pc = map.entities.find((e) => e.kind === "pc")!;
		assert.deepEqual({ x: pc.x, y: pc.y }, { x: 9, y: 3 }, "the walk stops beside the discovery");
		assert.equal(map.entities.find((e) => e.name === "Ledger desk")!.discover!.found, true);
		const log = m.readLog(id);
		const line = log.find((l) => l.role === "discovery");
		assert.ok(line);
		assert.equal(line!.text, "Ledger desk: An open ledger: the last entry is a debt to your uncle.");
		// The DM reads it in "Recent play" next turn.
		assert.match(m.digest(m.loadState(id), { recentLog: log }), /DISCOVERY: Ledger desk: An open ledger/);
	} finally {
		dm.restore();
	}
});

test("each discovery is shown once", async () => {
	const id = newGame();
	await drawHall(id);
	assert.equal((await walk(id, 9, 3)).found.length, 1);
	assert.equal((await walk(id, 5, 3)).found.length, 0);
	const again = await walk(id, 9, 4);
	assert.equal(again.found.length, 0);
	assert.equal(again.captions.length, 0);
	assert.equal(m.readLog(id).filter((l) => l.role === "discovery").length, 1);
});

test("a hidden thing is revealed and hands over its item; diagonal adjacency counts", async () => {
	const id = newGame();
	await drawHall(id);
	await walk(id, 9, 4); // the desk first (non-significant)
	const before = m.loadState(id).character.inventory.find((i) => i.name === "Silver coins");
	assert.equal(before, undefined);
	const r = await walk(id, 14, 6); // diagonal to (15,5)
	assert.deepEqual(r.found.map((f) => f.name), ["Loose flagstone"]);
	assert.equal(r.captions[0].item, "2 Silver coins");
	const s = m.loadState(id);
	const flag = s.maps[s.activeMapId!].entities.find((e) => e.name === "Loose flagstone")!;
	assert.equal(flag.hidden, false, "revealed");
	assert.equal(s.character.inventory.find((i) => i.name === "Silver coins")?.quantity, 2);
	assert.match(m.readLog(id).filter((l) => l.role === "discovery").pop()!.text, /\(\+ 2 Silver coins\)$/);
	// Large footprints: next to any of their squares.
	assert.equal(m.discover.isNextTo({ x: 4, y: 4, size: 2 }, { x: 6, y: 6 }), true);
	assert.equal(m.discover.isNextTo({ x: 4, y: 4, size: 2 }, { x: 7, y: 6 }), false);
});

test("entering a room with a discover text (draw_map rooms and name_room)", async () => {
	const id = newGame();
	await drawHall(id, { rooms: [{ name: "The cold corner", x: 12, y: 5, w: 3, h: 2, discover: "Your breath fogs: this corner is colder than the rest." }] });
	const map = active(id);
	assert.equal(map.rooms.length, 1);
	assert.equal(map.rooms[0].name, "The cold corner");
	const r = await walk(id, 12, 6);
	assert.deepEqual(r.found.map((f) => f.name), ["The cold corner"]);
	assert.equal(r.found[0].roomId, map.rooms[0].id);
	assert.equal((await walk(id, 13, 6)).found.length, 0, "once");

	// Generated maps: name_room can carry one.
	const g = newGame();
	await ok(g, "generate_map", { kind: "dungeon", show: true });
	const gm = active(g);
	const pc = gm.entities.find((e) => e.kind === "pc")!;
	const room = gm.rooms.find((r) => !(pc.x >= r.x && pc.x < r.x + r.w && pc.y >= r.y && pc.y < r.y + r.h))!;
	await ok(g, "name_room", { roomId: room.id, name: "Shrine", discover: "Candle stubs ring a dry font.", significant: true });
	assert.deepEqual(active(g).rooms.find((r) => r.id === room.id)!.discover, { text: "Candle stubs ring a dry font.", significant: true });
	const s = m.loadState(g);
	const found = m.discover.discoverAt(s, s.maps[s.activeMapId!], { x: room.x, y: room.y });
	assert.deepEqual(found.map((f) => [f.name, f.significant]), [["Shrine", true]]);
});

test("a significant discovery hands the DM one turn with an ENGINE NOTE", async () => {
	const id = newGame();
	await drawHall(id, { significant: true });
	const dm = stubEngine(id);
	try {
		const r = await walk(id, 14, 3);
		assert.equal(r.dm, true);
		assert.equal(dm.calls.length, 1);
		const input = dm.calls[0].input;
		assert.match(input, /# PLAYER ACTION\n\(I explore the place on my own\.\)/);
		assert.match(input, /reached Ledger desk on their own/);
		assert.match(input, /An open ledger: the last entry is a debt to your uncle\./);
		assert.match(input, /React in a few lines/);
		// Discovery logged before the DM line; no player bubble for the hand-off.
		const log = m.readLog(id);
		assert.deepEqual(log.map((l) => l.role), ["discovery", "dm"]);
		// Same tool list as a normal turn: the DM's session resumes.
		const normal = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).map((t) => t.name);
		assert.deepEqual(dm.calls[0].tools.map((t) => t.name), normal);
	} finally {
		dm.restore();
	}
});

for (const rs of ["fantasy", "zombie", "cyberpunk"] as const) {
	test(`discoveries work in ${rs}`, async () => {
		const id = newGame(rs);
		await drawHall(id);
		const dm = stubEngine(id);
		try {
			const a = await walk(id, 9, 3);
			assert.deepEqual(a.found.map((f) => f.name), ["Ledger desk"]);
			const b = await walk(id, 14, 6);
			assert.deepEqual(b.found.map((f) => f.name), ["Loose flagstone"]);
			assert.ok(m.loadState(id).character.inventory.some((i) => i.name === "Silver coins"));
			assert.equal(dm.calls.length, 0);
		} finally {
			dm.restore();
		}
	});
}

test("place_entity and update_entity carry discover texts; DM-moved tokens find things silently", async () => {
	const id = newGame();
	await drawHall(id);
	const placed = await ok(id, "place_entity", { kind: "item", name: "Torn letter", sprite: "bones", x: 4, y: 6, discover: "A letter, torn in half; the signature survives.", findItem: "Torn letter" });
	const entId = /\[([^\]]+)\]/.exec(placed)![1];
	assert.deepEqual(active(id).entities.find((e) => e.id === entId)!.discover, { text: "A letter, torn in half; the signature survives.", item: "Torn letter" });
	await ok(id, "update_entity", { id: entId, discover: "A letter, torn in half.", significant: true });
	assert.deepEqual(active(id).entities.find((e) => e.id === entId)!.discover, { text: "A letter, torn in half.", significant: true });
	// The DM walks the player there itself: marked seen (the DM narrates it), item left to the DM.
	const pcId = active(id).entities.find((e) => e.kind === "pc")!.id;
	const moved = await ok(id, "update_entity", { id: pcId, x: 4, y: 5 });
	assert.match(moved, /Now next to: .*Torn letter/);
	assert.equal(active(id).entities.find((e) => e.id === entId)!.discover!.found, true);
	assert.ok(!m.loadState(id).character.inventory.some((i) => i.name === "Torn letter"));
	assert.equal((await walk(id, 5, 6)).found.length, 0, "no caption for what the DM already narrated");
	// move_player out of combat too.
	const toStatue = await ok(id, "move_player", { towardId: active(id).entities.find((e) => e.name === "Old statue")!.id });
	assert.match(toStatue, /Old statue/);
	// Clearing it.
	await ok(id, "update_entity", { id: entId, discover: "" });
	assert.equal(active(id).entities.find((e) => e.id === entId)!.discover, undefined);
});

test("the browser never sees an unfound discovery's text or item", async () => {
	const id = newGame();
	await drawHall(id);
	const cs = m.clientState(m.loadState(id));
	const ents = cs.maps[cs.activeMapId!].entities;
	assert.deepEqual(ents.find((e) => e.name === "Loose flagstone")!.discover, { text: "" });
	await walk(id, 9, 3);
	const after = m.clientState(m.loadState(id));
	assert.equal(after.maps[after.activeMapId!].entities.find((e) => e.name === "Ledger desk")!.discover!.text, "An open ledger: the last entry is a debt to your uncle.");
	// The stored state keeps everything.
	assert.equal(active(id).entities.find((e) => e.name === "Loose flagstone")!.discover!.item, "2 Silver coins");
});

test("combat is unchanged: moving in a fight discovers nothing", async () => {
	const id = newGame();
	await drawHall(id);
	await ok(id, "update_entity", { id: active(id).entities.find((e) => e.kind === "pc")!.id, x: 5, y: 3 });
	await ok(id, "start_combat", { monsters: [{ monster: "goblin", x: 17, y: 6 }] });
	const s0 = m.loadState(id);
	assert.equal(s0.encounter?.status, "active");
	// Make it the player's turn and walk next to the desk with the combat engine.
	const pcIdx = s0.encounter!.order.indexOf(s0.character.id);
	const edit = (f: (s: GameState) => void) => {
		const s = m.loadState(id);
		f(s);
		m.saveState(s);
	};
	edit((s) => (s.encounter!.turnIndex = pcIdx));
	const res = await ok(id, "move_player", { x: 9, y: 3 });
	assert.doesNotMatch(res, /Now next to/);
	const s = m.loadState(id);
	const pc = s.maps[s.activeMapId!].entities.find((e) => e.kind === "pc")!;
	assert.deepEqual({ x: pc.x, y: pc.y }, { x: 9, y: 3 }, "next to the desk");
	assert.equal(s.maps[s.activeMapId!].entities.find((e) => e.name === "Ledger desk")!.discover!.found, undefined);
	assert.equal(m.readLog(id).filter((l) => l.role === "discovery").length, 0);
});
