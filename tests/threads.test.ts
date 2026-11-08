import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-threads-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	th: typeof import("../lib/rules/threads");
	client: typeof import("../lib/game/client");
	digest: typeof import("../lib/dm/digest");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		th: await import("../lib/rules/threads"),
		client: await import("../lib/game/client"),
		digest: await import("../lib/dm/digest"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };
const newGame = () => m.createGame({ settings: m.defaultSettings(), character: { name: "Thorin", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: STD } }).id;
async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

test("voice cards: set through add_npc/update_npc, shown for NPCs on stage, missing ones asked for, hidden from the client", async () => {
	const id = newGame();
	const r = await call(id, "add_npc", { name: "Okafor", role: "fire captain", description: "Big, grey, tired.", present: true, voice: "clipped radio-speak; calls everyone son", wants: "keep the station alive", opinion: "useful, reckless" });
	const okafor = /id (\S+?)\.(\s|$)/.exec(r.text)![1];
	await call(id, "add_npc", { name: "Earl", role: "raider boss", description: "Grins a lot.", present: true });
	const st = m.loadState(id);
	const d = m.digest.stateDigest(st);
	assert.match(d, /Voice cards.*Okafor: talks: clipped radio-speak.*thinks of the player: useful, reckless/);
	assert.match(d, /No voice card yet: Earl/);
	await call(id, "update_npc", { id: okafor, opinion: "owes him his life now" });
	const seen = m.client.clientState(m.loadState(id));
	const n = seen.npcs[okafor];
	assert.equal(n.voice, undefined);
	assert.equal(n.opinion, undefined);
	assert.equal(m.loadState(id).npcs[okafor].opinion, "owes him his life now");
});

test("story threads: plant, touch, resolve; capped; overdue flagged; hidden from the client", async () => {
	const id = newGame();
	const p = await call(id, "story_thread", { op: "plant", title: "The 3 a.m. names", planted: "A voice reads names on 101.7; one was Lupe." });
	assert.notEqual(p.isError, true, p.text);
	assert.equal((await call(id, "story_thread", { op: "plant", title: "x" })).isError, true, "needs planted");
	for (let i = 0; i < 7; i++) await call(id, "story_thread", { op: "plant", title: `T${i}`, planted: "something" });
	assert.equal((await call(id, "story_thread", { op: "plant", title: "One too many", planted: "x" })).isError, true);
	let st = m.loadState(id);
	const names = st.threads!.find((t) => t.title === "The 3 a.m. names")!;
	st.pacing!.turn = 20;
	m.saveState(st);
	assert.match(m.digest.stateDigest(m.loadState(id)), /The 3 a\.m\. names \[th\S+\] OVERDUE/);
	await call(id, "story_thread", { op: "touch", id: names.id, planted: "The coordinates match the water plant." });
	assert.equal((await call(id, "story_thread", { op: "resolve", id: names.id })).isError, true, "needs payoff");
	await call(id, "story_thread", { op: "resolve", id: names.id, payoff: "It was the Library's call sign." });
	st = m.loadState(id);
	assert.equal(st.threads!.find((t) => t.id === names.id)!.status, "resolved");
	assert.match(st.threads!.find((t) => t.id === names.id)!.planted, /water plant/);
	assert.equal(st.pacing!.last.twist, 20, "a payoff is a twist");
	assert.equal(m.client.clientState(st).threads, undefined);
	assert.equal(m.client.clientState(st).pacing, undefined);
});

test("pacing director: breathe after a fight, then threat, twist and human nudges", () => {
	const id = newGame();
	const st = m.loadState(id);
	const p = m.th.pacingOf(st);
	assert.equal(m.th.pacingNudge(st), undefined, "a fresh game is fine");
	p.turn = 30;
	p.last = { threat: 30, action: 29, human: 25, twist: 29 };
	assert.match(m.th.pacingNudge(st)!, /breathe/);
	p.last = { threat: 21, action: 21, human: 29, twist: 28 };
	assert.match(m.th.pacingNudge(st)!, /quiet too long/);
	p.last = { threat: 29, action: 20, human: 29, twist: 5 };
	assert.match(m.th.pacingNudge(st)!, /reveal or a complication/);
	p.last = { threat: 29, action: 20, human: 10, twist: 29 };
	assert.match(m.th.pacingNudge(st)!, /human moment/);
	m.th.markBeat(st, "action");
	assert.equal(p.last.threat, 30, "action counts as threat");
});

test("mark_beat validates; a new player turn advances the counter", async () => {
	const id = newGame();
	assert.equal((await call(id, "mark_beat", { beats: ["party"] })).isError, true);
	const r = await call(id, "mark_beat", { beats: ["human", "twist"] });
	assert.notEqual(r.isError, true, r.text);
	const st = m.loadState(id);
	m.th.nextTurn(st);
	assert.equal(st.pacing!.turn, 1);
	assert.equal(st.pacing!.last.human, 0);
});
