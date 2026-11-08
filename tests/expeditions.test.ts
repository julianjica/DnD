import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { GameState, InventoryItem } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-exp-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	ex: typeof import("../lib/rules/expeditions");
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
		ex: await import("../lib/rules/expeditions"),
		client: await import("../lib/game/client"),
		digest: await import("../lib/dm/digest"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}
async function ok(id: string, name: string, args: Record<string, unknown>) {
	const r = await call(id, name, args);
	assert.notEqual(r.isError, true, `${name}: ${r.text}`);
	return r.text;
}
async function npc(id: string, name: string): Promise<string> {
	const text = await ok(id, "add_npc", { name, role: "survivor", description: "Tired, scared, still standing." });
	return /id (\S+?)\.(\s|$)/.exec(text)![1];
}
const radio = (): InventoryItem => ({ id: "it_w", ref: "z-walkie-talkie", name: "Walkie-talkie", quantity: 1, category: "gear" });

/** A zombie game downtown at noon with two companions. */
async function team(withRadio = true): Promise<{ id: string; a: string; b: string }> {
	const settings = m.defaultSettings();
	settings.world.preset = "zombie_outbreak";
	const id = m.createGame({ settings, seed: 5, character: { name: "Dana", speciesId: "z-origin-streetwise", classId: "fighter", backgroundId: "criminal", abilities: STD } }).id;
	const a = await npc(id, "Ana");
	const b = await npc(id, "Ben");
	await ok(id, "recruit_survivor", { npcId: a, profession: "rogue", specialty: "quiet", traits: ["calm"] });
	await ok(id, "recruit_survivor", { npcId: b, profession: "fighter", specialty: "strong", traits: ["proud"] });
	const s = m.loadState(id);
	s.time = { day: 4, hour: 12, minute: 0 };
	if (withRadio) s.character.inventory.push(radio());
	s.town!.hordes = [];
	m.saveState(s);
	return { id, a, b };
}

test("road paths follow the town's roads", () => {
	const settings = m.defaultSettings();
	settings.world.preset = "zombie_outbreak";
	const s = m.loadState(m.createGame({ settings, character: { name: "D", speciesId: "z-origin-streetwise", classId: "fighter", backgroundId: "criminal", abilities: STD } }).id);
	assert.deepEqual(m.ex.roadPath(s, "loc-kf-downtown", "loc-kf-mall"), ["loc-kf-old-mill", "loc-kf-mall"]);
	assert.ok(m.ex.expeditionEta(s, "loc-kf-downtown", "loc-kf-mall", "scavenge") > 4 * 60);
});

test("send_expedition validates the team and the destination", async () => {
	const { id, a, b } = await team();
	assert.equal((await call(id, "send_expedition", { members: [], locationId: "loc-kf-mall", goal: "scavenge" })).isError, true);
	assert.equal((await call(id, "send_expedition", { members: [a], locationId: "loc-kf-granger", goal: "scavenge" })).isError, true, "not on the map yet");
	assert.equal((await call(id, "send_expedition", { members: [a], locationId: "loc-kf-mall", goal: "dance" })).isError, true);
	const r = await ok(id, "send_expedition", { members: ["Ana", b], locationId: "loc-kf-mall", goal: "scavenge", note: "baby formula" });
	assert.match(r, /walkie/);
	const s = m.loadState(id);
	assert.equal(s.group!.survivors[a].status, "away");
	assert.equal(s.group!.survivors[a].away!.task, "expedition");
	assert.equal(s.group!.expeditions!.length, 1);
	assert.equal((await call(id, "send_expedition", { members: [a], locationId: "loc-kf-mall", goal: "scout" })).isError, true, "already out");
});

test("an expedition walks out, does the job, walks back; errands don't swallow it", async () => {
	const { id, a, b } = await team();
	await ok(id, "send_expedition", { members: [a, b], locationId: "loc-kf-mall", goal: "scavenge" });
	const s = m.loadState(id);
	const ex = s.group!.expeditions![0];
	s.time.day += 2; // long enough for the whole run
	const added: string[] = [];
	const out = m.ex.expeditionTick(s, new Rng(3), (_s, it) => void added.push(it.ref)) ?? "";
	const st = s.group!.expeditions![0];
	assert.ok(st.stage === "back" || st.stage === "lost", `finished (${st.stage})`);
	assert.ok(st.events.some((e) => /At Riverside Mall/i.test(e.text) || /Centro comercial/i.test(e.text)), "did the job at the mall");
	if (st.stage === "back") {
		assert.match(out, /EXPEDITION BACK/);
		for (const id2 of ex.members) if (s.group!.survivors[id2].status !== "dead" && s.group!.survivors[id2].away?.task !== "captured") assert.equal(s.group!.survivors[id2].status, "with_party");
	}
	assert.match(out, /CHECK-IN|BACK|SILENCE/);
});

test("check-ins need radios at both ends; without them news waits", async () => {
	const { id, a } = await team(false);
	await ok(id, "send_expedition", { members: [a], locationId: "loc-kf-old-mill", goal: "scout" });
	const s = m.loadState(id);
	assert.equal(s.group!.expeditions![0].comms, false);
	s.time.hour += 2;
	const out = m.ex.expeditionTick(s, new Rng(1), () => undefined) ?? "";
	assert.ok(!/CHECK-IN/.test(out), "no walkie, no check-in");
	const ex = s.group!.expeditions![0];
	assert.ok(ex.events.length >= 1);
	assert.ok(ex.events.every((e) => !e.delivered));
});

test("the client sees what was heard, not what happened", async () => {
	const { id, a } = await team();
	await ok(id, "send_expedition", { members: [a], locationId: "loc-kf-mall", goal: "scavenge" });
	const s = m.loadState(id);
	// Out there, the worst happened, unheard.
	s.group!.survivors[a].status = "dead";
	s.group!.expeditions![0].events.push({ at: 0, text: "Ana DIED out there." });
	const seen = m.client.clientState(s);
	assert.equal(seen.group!.survivors[a].status, "away", "still just away to the player");
	assert.deepEqual(seen.group!.expeditions![0].events, []);
	assert.deepEqual(seen.group!.expeditions![0].path, []);
	assert.match(m.digest.stateDigest(s), /Expeditions: \[ex/);
});

test("broadcast walkie check-ins are kept on the expedition; recall turns them back", async () => {
	const { id, a } = await team();
	await ok(id, "send_expedition", { members: [a], locationId: "loc-kf-mall", goal: "scavenge" });
	const exId = m.loadState(id).group!.expeditions![0].id;
	assert.equal((await call(id, "broadcast", { station: "walkie", text: "x" })).isError, true, "needs expeditionId");
	await ok(id, "broadcast", { station: "walkie", text: "—Old Mill, all clear. Moving on.", expeditionId: exId });
	await ok(id, "recall_expedition", { expeditionId: exId });
	const s = m.loadState(id);
	assert.equal(s.group!.expeditions![0].heard!.at(-1)!.text, "—Old Mill, all clear. Moving on.");
	assert.equal(s.radio!.log.at(-1)!.station, "walkie");
	assert.equal(s.group!.expeditions![0].recalled, true);
	s.time.day += 2;
	m.ex.expeditionTick(s, new Rng(9), () => undefined);
	const ex = s.group!.expeditions![0];
	assert.ok(!ex.events.some((e) => /searched/.test(e.text)), "turned back before the job");
});

test("danger reads the town: hordes, hostile holders and night raise it", async () => {
	const { id, a } = await team();
	await ok(id, "send_expedition", { members: [a], locationId: "loc-kf-mall", goal: "scavenge" });
	const s: GameState = m.loadState(id);
	const ex = s.group!.expeditions![0];
	const noon = s.time.day * 1440 + 12 * 60;
	const calm = m.ex.stopDanger(s, ex, "loc-kf-old-mill", noon);
	s.town!.hordes.push({ id: "hz", size: 30, at: "loc-kf-old-mill", nextMoveAt: 1e9, known: false });
	const horde = m.ex.stopDanger(s, ex, "loc-kf-old-mill", noon);
	const night = m.ex.stopDanger(s, ex, "loc-kf-old-mill", s.time.day * 1440 + 23 * 60);
	assert.ok(horde > calm + 15, `${calm} → ${horde}`);
	assert.ok(night > horde);
});
