import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { GameState, InventoryItem, Survivor } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-companions-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	companions: typeof import("../lib/rules/companions");
	group: typeof import("../lib/rules/group");
	digest: typeof import("../lib/dm/digest");
	client: typeof import("../lib/game/client");
	prompt: typeof import("../lib/dm/prompt");
	en: typeof import("../lib/i18n/en").en;
	es: typeof import("../lib/i18n/es").es;
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		companions: await import("../lib/rules/companions"),
		group: await import("../lib/rules/group"),
		digest: await import("../lib/dm/digest"),
		client: await import("../lib/game/client"),
		prompt: await import("../lib/dm/prompt"),
		en: (await import("../lib/i18n/en")).en,
		es: (await import("../lib/i18n/es")).es,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };
const ROWS = ["##############", "#,,,,,,,,,,,,#", "#,@,,,,,,,,,,#", "#,,,,,,,,,,,,#", "#,,,,,,,,,,,,#", "##############"];

function newGame(): string {
	const settings = m.defaultSettings();
	settings.world.preset = "zombie_outbreak";
	return m.createGame({ settings, seed: 11, character: { name: "Dana", speciesId: "z-origin-streetwise", classId: "fighter", backgroundId: "criminal", abilities: STD } }).id;
}

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
function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}
async function npc(id: string, name: string): Promise<string> {
	const text = await ok(id, "add_npc", { name, role: "survivor", description: "Tired, scared, still standing." });
	return /id (\S+?)\.(\s|$)/.exec(text)![1];
}
const item = (ref: string, name: string, quantity = 1): InventoryItem => ({ id: `it_${ref}_${Math.random().toString(36).slice(2, 7)}`, ref, name, quantity, category: "gear" });
const sv = (s: GameState, npcId: string): Survivor => s.group!.survivors[npcId];
const at = (day: number, hour: number, minute = 0) => day * 1440 + hour * 60 + minute;

/** Seeds whose first d100 does / doesn't land under the camp-scene chance. */
function seed(hit: boolean, from = 1): number {
	for (let s = from; ; s++) if ((new Rng(s).int(1, 100) <= m.companions.BEAT_CHANCE) === hit) return s;
}

/** A zombie game at day 3, 12:00 with Priya and Wade (fed, with the party), bookkeeping started. */
async function camp(): Promise<{ id: string; p: string; w: string }> {
	const id = newGame();
	edit(id, (s) => {
		s.time = { day: 3, hour: 12, minute: 0 };
		s.character.inventory.push(item("z-canned-food", "Canned food", 30), item("z-bottled-water", "Bottled water", 30));
	});
	const p = await npc(id, "Priya");
	const w = await npc(id, "Wade");
	await ok(id, "recruit_survivor", { npcId: p, profession: "nurse", specialty: "can stitch wounds", traits: ["calm"] });
	await ok(id, "recruit_survivor", { npcId: w, profession: "cop", specialty: "shoots straight", traits: ["proud"] });
	const s = m.loadState(id);
	assert.equal(s.group!.lastBeatDay, 2, "bookkeeping starts now (day 3 noon: the last evening begun is day 2's)");
	return { id, p, w };
}

// ─── when ───────────────────────────────────────────────────────────────

test("evening window and evening day", () => {
	const { eveningDay, inEvening } = m.companions;
	assert.equal(inEvening(at(3, 18, 59)), false);
	assert.equal(inEvening(at(3, 19)), true);
	assert.equal(inEvening(at(3, 23, 59)), true);
	assert.equal(inEvening(at(4, 1, 59)), true);
	assert.equal(inEvening(at(4, 2)), false);
	assert.equal(eveningDay(at(3, 19)), 3);
	assert.equal(eveningDay(at(4, 1)), 3, "after midnight it is still day 3's evening");
	assert.equal(eveningDay(at(4, 12)), 3);
});

test("camp scene: only in the evening, at most once per evening, one roll even on a miss", async () => {
	const { id } = await camp();
	const s = m.loadState(id);
	const hit = seed(true);
	assert.equal(m.companions.campBeat(s, new Rng(hit), at(3, 15)), undefined, "not in the afternoon");
	assert.equal(m.companions.campBeat(s, new Rng(hit), at(4, 3)), undefined, "not after 02:00");
	assert.equal(s.group!.lastBeatDay, 2, "nothing spent outside the window");
	const text = m.companions.campBeat(s, new Rng(hit), at(3, 20));
	assert.ok(text, "fires on a hit in the evening");
	assert.match(text!, /^CAMP SCENE \(play it when the moment allows, briefly/);
	assert.match(text!, /companion_beat with npcIds \[/);
	assert.match(text!, /(CONFESSION|CONFLICT|THEFT|FAVOR|BONDING|DOUBT):/);
	assert.equal(s.group!.lastBeatDay, 3);
	assert.equal(m.companions.campBeat(s, new Rng(hit), at(3, 23)), undefined, "once per evening");
	assert.equal(m.companions.campBeat(s, new Rng(hit), at(4, 1)), undefined, "still the same evening after midnight");

	// A miss spends the evening too.
	const s2 = m.loadState(id);
	assert.equal(m.companions.campBeat(s2, new Rng(seed(false)), at(3, 20)), undefined);
	assert.equal(s2.group!.lastBeatDay, 3);
	assert.equal(m.companions.campBeat(s2, new Rng(hit), at(3, 21)), undefined);
});

test("camp scene: the featured companions are marked; nobody carries two evenings in a row", async () => {
	const { id, p, w } = await camp();
	const s = m.loadState(id);
	// Only Priya is around tonight (Wade is out scouting).
	sv(s, w).status = "away";
	sv(s, w).away = { until: at(9, 8), task: "scout" };
	const text = m.companions.campBeat(s, new Rng(seed(true)), at(3, 20));
	assert.ok(text);
	assert.match(text!, new RegExp(`\\[${p}\\]`));
	assert.equal(sv(s, p).lastBeatAt, at(3, 20));
	// The next evening she's resting from the spotlight: with nobody else, no scene.
	for (let k = 1; k < 30; k++) {
		const c = structuredClone(s);
		assert.equal(m.companions.campBeat(c, new Rng(seed(true, k)), at(4, 20)), undefined);
	}
	// The evening after, she can be featured again.
	assert.ok(m.companions.campBeat(structuredClone(s), new Rng(seed(true)), at(5, 20)));
	// With Wade back, the scene goes to him (a pair would need both fresh).
	sv(s, w).status = "with_party";
	delete sv(s, w).away;
	for (let k = 1; k < 30; k++) {
		const c = structuredClone(s);
		const t = m.companions.campBeat(c, new Rng(seed(true, k)), at(4, 20));
		if (!t) continue;
		assert.match(t, new RegExp(`\\[${w}\\]`));
		assert.doesNotMatch(t, new RegExp(`\\[${p}\\]`));
	}
});

test("camp scene: never in combat, never with nobody around", async () => {
	const { id, w, p } = await camp();
	await ok(id, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	await ok(id, "start_combat", { monsters: [{ monster: "z-shambler", x: 10, y: 3 }] });
	const s = m.loadState(id);
	assert.equal(s.encounter?.status, "active");
	assert.equal(m.companions.campBeat(s, new Rng(seed(true)), at(3, 20)), undefined);
	assert.equal(s.group!.lastBeatDay, 2, "the evening isn't spent while fighting");
	// After the fight, the same evening can still bring one.
	s.encounter = undefined;
	s.mode = "explore";
	const solo = structuredClone(s);
	assert.ok(m.companions.campBeat(s, new Rng(seed(true)), at(3, 21)));
	// Everyone away: nothing, and the evening isn't spent.
	for (const n of [p, w]) sv(solo, n).status = "away";
	assert.equal(m.companions.campBeat(solo, new Rng(seed(true)), at(3, 21)), undefined);
	assert.equal(solo.group!.lastBeatDay, 2);
});

test("camp scene: no catch-up after a long jump; brand-new bookkeeping never fires retroactively", async () => {
	const { id } = await camp();
	// A week passes through the tools in one go, landing at 23:00: at most one scene, for that evening.
	let fired = 0;
	for (let k = 1; k <= 40; k++) {
		const s = m.loadState(id);
		const text = m.group.groupTick(Object.assign(s, { time: { day: 10, hour: 23, minute: 0 } }), new Rng(k), () => undefined) ?? "";
		const n = (text.match(/CAMP SCENE/g) ?? []).length;
		assert.ok(n <= 1, "never a backlog of scenes");
		fired += n;
		assert.equal(s.group!.lastBeatDay, 10);
	}
	assert.ok(fired > 0, "some seeds do fire for the latest evening");
	// Jumping past the evening into the morning: nothing.
	const s = m.loadState(id);
	s.time = { day: 11, hour: 9, minute: 0 };
	assert.doesNotMatch(m.group.groupTick(s, new Rng(seed(true)), () => undefined) ?? "", /CAMP SCENE/);

	// An old save (no lastBeatDay) loaded mid-evening: no scene for the evening under way.
	const old = m.loadState(id);
	delete old.group!.lastBeatDay;
	old.time = { day: 3, hour: 21, minute: 0 };
	assert.equal(m.companions.campBeat(old, new Rng(seed(true)), at(3, 21)), undefined);
	assert.equal(old.group!.lastBeatDay, 3);
	assert.ok(m.companions.campBeat(old, new Rng(seed(true)), at(4, 20)), "the next evening is fair game");
});

test("camp scene: the beat fits the state (theft only when short, doubt from the low, confession from the trusting)", async () => {
	const { id, p, w } = await camp();
	const kinds = (f: (s: GameState) => void) => {
		const out = new Set<string>();
		for (let k = 1; k <= 300; k++) {
			const s = m.loadState(id);
			f(s);
			const t = m.companions.campBeat(s, new Rng(k), at(3, 20));
			if (t) out.add(/(CONFESSION|CONFLICT|THEFT|FAVOR|BONDING|DOUBT):/.exec(t)![1]);
		}
		return out;
	};
	const fed = kinds((s) => {
		sv(s, p).morale = 5;
		sv(s, w).morale = 5;
	});
	assert.ok(!fed.has("THEFT") && !fed.has("DOUBT") && !fed.has("CONFESSION") && !fed.has("BONDING"), [...fed].join());
	assert.ok(fed.has("CONFLICT") && fed.has("FAVOR"));
	const hard = kinds((s) => {
		sv(s, w).missedDays = 2;
		sv(s, w).morale = 3;
		sv(s, p).morale = 8;
		sv(s, p).want = "to find her brother";
		sv(s, p).bonds = { [w]: 2 };
		sv(s, w).bonds = { [p]: 2 };
	});
	for (const k of ["THEFT", "DOUBT", "CONFESSION", "BONDING", "CONFLICT", "FAVOR"]) assert.ok(hard.has(k), `${k} possible`);
});

// ─── tools ──────────────────────────────────────────────────────────────

test("set_companion_profile: sets the parts given; revealed parts can't be rewritten", async () => {
	const { id, p } = await camp();
	assert.equal((await call(id, "set_companion_profile", { npcId: p })).isError, true, "needs something");
	assert.equal((await call(id, "set_companion_profile", { npcId: "npc_nobody", want: "x" })).isError, true);
	const text = await ok(id, "set_companion_profile", { npcId: p, want: "to find her brother in Millbrook", fear: "being left behind" });
	assert.match(text, /Still undefined: secret/);
	await ok(id, "set_companion_profile", { npcId: p, secret: "she left a patient to die" });
	let s = m.loadState(id);
	assert.equal(sv(s, p).want, "to find her brother in Millbrook");
	assert.equal(sv(s, p).secret, "she left a patient to die");
	edit(id, (st) => (sv(st, p).revealed = ["want"]));
	assert.equal((await call(id, "set_companion_profile", { npcId: p, want: "revenge" })).isError, true);
	await ok(id, "set_companion_profile", { npcId: p, fear: "the dark" });
	s = m.loadState(id);
	assert.equal(sv(s, p).fear, "the dark");
	assert.equal(sv(s, p).want, "to find her brother in Millbrook");
});

test("companion_beat: clamped, symmetric bonds; morale; reveal; logged; marks lastBeatAt", async () => {
	const { id, p, w } = await camp();
	await ok(id, "set_companion_profile", { npcId: p, want: "to find her brother", fear: "dogs", secret: "she was bitten once and it didn't take" });
	edit(id, (s) => {
		sv(s, p).morale = 9;
		sv(s, w).morale = 1;
		sv(s, p).bonds = { [w]: 2 };
		sv(s, w).bonds = { [p]: 2 };
	});
	assert.equal((await call(id, "companion_beat", { npcIds: [p], bonds: [{ a: p, b: p, delta: 1 }] })).isError, true, "no bond with oneself");
	assert.equal((await call(id, "companion_beat", { npcIds: [p], reveal: { npcId: w, what: "want" } })).isError, true, "Wade has no want yet");
	let s = m.loadState(id);
	assert.equal(sv(s, p).morale, 9, "a refused call changes nothing");

	const text = await ok(id, "companion_beat", {
		npcIds: [p, w],
		morale: [{ npcId: p, delta: 5 }, { npcId: w, delta: -5 }],
		bonds: [{ a: w, b: p, delta: 9 }],
		reveal: { npcId: p, what: "secret" },
		note: "Priya y Wade hablaron hasta tarde.",
	});
	assert.match(text, /Camp scene \(Priya, Wade\)/);
	s = m.loadState(id);
	assert.equal(sv(s, p).morale, 10, "+2 at most, capped at 10");
	assert.equal(sv(s, w).morale, 0, "−2 at most, floored at 0");
	assert.match(text, /AT ZERO/);
	assert.equal(sv(s, p).bonds![w], 3, "bonds cap at +3");
	assert.equal(sv(s, w).bonds![p], 3, "symmetric");
	assert.deepEqual(sv(s, p).revealed, ["secret"]);
	assert.equal(sv(s, p).lastBeatAt, at(3, 12));
	assert.equal(sv(s, w).lastBeatAt, at(3, 12));
	const log = s.group!.log!;
	assert.equal(log.at(-1)!.kind, "camp");
	assert.deepEqual(log.at(-1)!.params, { names: "Priya, Wade", note: "Priya y Wade hablaron hasta tarde." });

	for (let i = 0; i < 4; i++) await ok(id, "companion_beat", { npcIds: [p], bonds: [{ a: p, b: w, delta: -2 }] });
	s = m.loadState(id);
	assert.equal(sv(s, p).bonds![w], -3, "bonds floor at −3");
	assert.equal(sv(s, w).bonds![p], -3);

	// With a base, the line goes to the base log.
	edit(id, (st) => {
		st.group!.base = { name: "Pharmacy", locationId: st.world.currentLocationId ?? "x", fortification: 0, stock: { food: 0, water: 0, meds: 0, ammo: 0, fuel: 0, materials: 0 }, upgrades: [], lastTick: at(3, 12), log: [] };
	});
	await ok(id, "companion_beat", { npcIds: [p] });
	s = m.loadState(id);
	assert.equal(s.group!.base!.log.at(-1)!.kind, "camp");
});

test("fantasy campaigns: the companion tools refuse", async () => {
	const settings = m.defaultSettings();
	const f = m.createGame({ settings, character: { name: "Thorin", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: STD } }).id;
	assert.match((await call(f, "set_companion_profile", { npcId: "x", want: "y" })).text, /Only in The Quiet/);
	assert.match((await call(f, "companion_beat", { npcIds: ["x"] })).text, /Only in The Quiet/);
});

// ─── what the DM and the player see ─────────────────────────────────────

test("digest: asks for missing profiles, lists want/fear/secret (known or hidden) and bonds", async () => {
	const { id, p, w } = await camp();
	let d = m.digest.stateDigest(m.loadState(id));
	assert.match(d, new RegExp(`DEFINE \\(set_companion_profile[^\\n]*Priya \\[${p}\\] needs want/fear/secret; Wade \\[${w}\\] needs want/fear/secret`));
	await ok(id, "set_companion_profile", { npcId: p, want: "to find her brother", fear: "dogs", secret: "she stole the van" });
	edit(id, (s) => {
		sv(s, p).revealed = ["fear"];
		sv(s, p).bonds = { [w]: -2 };
		sv(s, w).bonds = { [p]: -2 };
	});
	d = m.digest.stateDigest(m.loadState(id));
	assert.match(d, /- Priya [^\n]*; want: to find her brother \(hidden\); fear: dogs \(known to the player\); secret: she stole the van \(hidden\); bonds: Wade -2/);
	assert.match(d, /- Wade [^\n]*; bonds: Priya -2/);
	assert.doesNotMatch(d, /Priya \[\S+\] needs/);
	assert.match(d, /Wade \[\S+\] needs want\/fear\/secret/);
});

test("prompt: the COMPANIONS line mentions camp scenes and both tools", async () => {
	const { id } = await camp();
	const line = m.prompt.buildSystemPrompt(m.loadState(id).settings).split("\n").find((l) => l.includes("- COMPANIONS"))!;
	assert.match(line, /CAMP SCENE/);
	assert.match(line, /set_companion_profile/);
	assert.match(line, /companion_beat/);
});

test("client: unrevealed want/fear/secret never reach the browser; revealed ones and bonds do", async () => {
	const { id, p, w } = await camp();
	await ok(id, "set_companion_profile", { npcId: p, want: "to find her brother", fear: "dogs", secret: "she stole the van" });
	const s = edit(id, (st) => {
		sv(st, p).revealed = ["want"];
		sv(st, p).bonds = { [w]: 1 };
	});
	const c = m.client.clientState(s);
	const cp = c.group!.survivors[p];
	assert.equal(cp.want, "to find her brother");
	assert.equal(cp.fear, undefined);
	assert.equal(cp.secret, undefined);
	assert.equal("secret" in cp, false);
	assert.deepEqual(cp.bonds, { [w]: 1 });
	assert.doesNotMatch(JSON.stringify(c), /stole the van|dogs/);
	assert.equal(sv(s, p).secret, "she stole the van", "server state untouched");
	// Combined with an infection, both secrets are hidden.
	sv(s, p).infection = { bittenAt: 100, turnsAt: 5000, part: "left arm", stage: "incubating" };
	const c2 = m.client.clientState(s);
	assert.equal(c2.group!.survivors[p].infection!.turnsAt, 0);
	assert.equal(c2.group!.survivors[p].secret, undefined);
});

test("i18n: the new Group strings exist in EN and ES", () => {
	for (const k of ["group.facet.want", "group.facet.fear", "group.facet.secret", "group.bonds", "group.bond.-3", "group.bond.3", "group.log.camp", "group.campLog"] as const) {
		assert.ok(m.en[k], k);
		assert.ok(m.es[k], k);
	}
});
