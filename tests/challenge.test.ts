import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { GameState, Npc, RollRecord, Survivor } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-challenge-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	ch: typeof import("../lib/rules/challenge");
	tools: typeof import("../lib/dm/tools/challenge");
	derived: typeof import("../lib/rules/character/derived");
	digest: typeof import("../lib/dm/digest");
	prompt: typeof import("../lib/dm/prompt");
	client: typeof import("../lib/game/client");
	en: typeof import("../lib/i18n/parts/challenge").en;
	es: typeof import("../lib/i18n/parts/challenge").es;
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		ch: await import("../lib/rules/challenge"),
		tools: await import("../lib/dm/tools/challenge"),
		derived: await import("../lib/rules/character/derived"),
		digest: await import("../lib/dm/digest"),
		prompt: await import("../lib/dm/prompt"),
		client: await import("../lib/game/client"),
		en: (await import("../lib/i18n/parts/challenge")).en,
		es: (await import("../lib/i18n/parts/challenge")).es,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// STR 15+ fighter: athletics proficient (at least +4), so DC 5 always passes and DC 30 always fails.
const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };

function newGame(ruleset: "fantasy" | "zombie" | "cyberpunk" = "fantasy"): string {
	const settings = m.defaultSettings();
	if (ruleset === "zombie") settings.world.preset = "zombie_outbreak" as never;
	if (ruleset === "cyberpunk") settings.world.preset = "marea_burned" as never;
	const speciesId = ruleset === "zombie" ? "z-origin-streetwise" : "human";
	return m.createGame({ settings, seed: 11, character: { name: "Rook", speciesId, classId: "fighter", backgroundId: "soldier", abilities: STD } }).id;
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

const SURE = { skill: "athletics", dc: 5 };
const NEVER = { skill: "athletics", dc: 30 };
const ap = (label: string, o: Record<string, unknown> = {}) => ({ label, ...SURE, success: `${label} works`, failure: `${label} fails`, ...o });

/** A three-stage chase; every approach 0 always succeeds, approach 1 always fails. */
function setup(o: Record<string, unknown> = {}) {
	const stage = (n: number) => ({ prompt: `Obstacle ${n}`, approaches: [ap(`Sure ${n}`), ap(`Doomed ${n}`, NEVER)] });
	return { title: "Through the market", kind: "chase", goal: "Lose the guards", clock: 6, stages: [stage(1), stage(2), stage(3)], stakes: { success: "You lose them", partial: "They saw where you went", failure: "They catch you" }, ...o };
}

function tx(state: GameState) {
	const rolls: RollRecord[] = [];
	return { t: { state, rng: new Rng(state.rng), roll: (r: RollRecord) => rolls.push(r), fx: () => undefined }, rolls };
}

// ─── setup ───────────────────────────────────────────────────────────────

test("start_challenge validates the setup and says what to fix", async () => {
	const id = newGame();
	const bad = async (args: Record<string, unknown>, re: RegExp) => {
		const r = await call(id, "start_challenge", args);
		assert.equal(r.isError, true, `expected an error for ${re}`);
		assert.match(r.text, re);
	};
	await bad(setup({ stages: [{ prompt: "x", approaches: [ap("only one")] }] }), /2–4 approaches/);
	await bad(setup({ stages: [{ prompt: "x", approaches: [ap("a", { skill: "juggling" }), ap("b")] }] }), /Unknown skill "juggling".*athletics/);
	await bad(setup({ clock: 2 }), /clock \(2\) is shorter than the quickest way through \(3 ticks\)/);
	await bad(setup({ stages: [{ prompt: "x", approaches: [ap("a", { cost: { heat: 2 } }), ap("b")] }] }), /heat exists only in Root Access/);
	await bad(setup({ stakes: { success: "ok" } }), /stakes.failure is required/);
	assert.equal(m.loadState(id).challenge, undefined, "nothing started");

	const text = await ok(id, "start_challenge", setup({ stages: [{ prompt: "Fence", approaches: [ap("Vault", { skill: "Sleight of Hand" }), ap("Climb", { skill: "Dexterity", dc: 99, time: 9 })] }] }));
	assert.match(text, /CHALLENGE STARTED/);
	const ch = m.loadState(id).challenge!;
	assert.equal(ch.stages[0].approaches[0].skill, "sleight-of-hand", "skill names normalised");
	assert.equal(ch.stages[0].approaches[1].skill, "dex", "abilities accepted");
	assert.equal(ch.stages[0].approaches[1].dc, 30, "DC clamped");
	assert.equal(ch.stages[0].approaches[1].time, 3, "time clamped");
	assert.equal(ch.target, 1, "target defaults to the stages");
	assert.equal((await call(id, "start_challenge", setup())).isError, true, "one at a time");
});

test("tools refuse while a fight is active", async () => {
	const id = newGame();
	edit(id, (s) => (s.encounter = { status: "active" } as never));
	const r = await call(id, "start_challenge", setup());
	assert.equal(r.isError, true);
	assert.match(r.text, /fight is on/);
	edit(id, (s) => delete s.encounter);
	await ok(id, "start_challenge", setup());
	edit(id, (s) => (s.encounter = { status: "active" } as never));
	const act = await call(id, "challenge_act", { approach: 0 });
	assert.equal(act.isError, true);
	assert.match(act.text, /fight is on/);
	const s = m.loadState(id);
	assert.throws(() => m.tools.challengeStep(tx(s).t, { stage: 0, approach: 0 }), /fight is on/);
});

// ─── play ────────────────────────────────────────────────────────────────

test("an approach rolls with the PC's real bonus and burns the clock", async () => {
	const id = newGame();
	await ok(id, "start_challenge", setup({ stages: [{ prompt: "Wall", approaches: [ap("Slow climb", { time: 2 }), ap("Jump", NEVER)] }, { prompt: "Gate", approaches: [ap("a"), ap("b")] }] }));
	const s = m.loadState(id);
	const want = m.derived.checkBreakdown(s.character, { kind: "check", skill: "athletics" }).mod;
	assert.ok(want >= 4, "STR 15 + proficiency");
	const { t, rolls } = tx(s);
	const r = m.tools.challengeStep(t, { stage: 0, approach: 0 });
	assert.equal(r.narrate, false);
	const roll = rolls[0];
	assert.equal(roll.actor, s.character.id, "the player's own die (the dice tray shows it)");
	assert.equal(roll.check?.skill, "athletics");
	assert.equal(roll.total - roll.dice.find((d) => !d.dropped)!.value, want, "real modifier");
	const ch = s.challenge!;
	assert.equal(ch.clock, 4, "time 2 off the clock");
	assert.equal(ch.progress, 1);
	assert.equal(ch.stage, 1, "on to the next stage");
	assert.throws(() => m.tools.challengeStep(t, { stage: 0, approach: 0 }), /already behind you/, "a stale click can't resolve another stage");

	// A failure with no cost given loses an extra tick and stays on the obstacle.
	s.challenge!.stages[1].approaches[1] = { ...s.challenge!.stages[1].approaches[1], dc: 30 };
	m.tools.challengeStep(t, { stage: 1, approach: 1 });
	assert.equal(ch.clock, 2, "1 for the attempt + 1 for failing");
	assert.equal(ch.stage, 1);
	assert.deepEqual(ch.log[1].paid, { clock: 1 });
});

test("success, partial and failure, with exactly one hand-off to the DM", async () => {
	// Success: three sure stages.
	const a = newGame();
	await ok(a, "start_challenge", setup());
	const sa = m.loadState(a);
	const { t: ta } = tx(sa);
	const narrated = [0, 1, 2].map((i) => m.tools.challengeStep(ta, { stage: i, approach: 0 }).narrate);
	assert.deepEqual(narrated, [false, false, true], "the DM is called once, at the end");
	assert.equal(sa.challenge!.status, "success");
	assert.match(sa.challenge!.summary!, /CHALLENGE OVER — SUCCESS: "Through the market"/);
	assert.match(sa.challenge!.summary!, /Outcome you set: You lose them/);
	assert.throws(() => m.tools.challengeStep(ta, { stage: 2, approach: 0 }), /over/, "no picks after the end");
	assert.equal(sa.time.minute + sa.time.hour * 60 > 0, true);

	// Partial: the clock runs out at 2 of 3.
	const b = newGame();
	await ok(b, "start_challenge", setup({ clock: 4 }));
	const sb = m.loadState(b);
	const { t: tb } = tx(sb);
	m.tools.challengeStep(tb, { stage: 0, approach: 0 });
	m.tools.challengeStep(tb, { stage: 1, approach: 0 });
	const last = m.tools.challengeStep(tb, { stage: 2, approach: 1 });
	assert.equal(last.narrate, true);
	assert.equal(sb.challenge!.status, "partial");
	assert.match(last.text, /PARTIAL SUCCESS[\s\S]*They saw where you went/);

	// Failure: nothing but failures; the stakes' cost applies.
	const c = newGame();
	await ok(c, "start_challenge", setup({ clock: 3, stakes: { success: "s", failure: "Caught", cost: { hp: "3" } } }));
	const sc = m.loadState(c);
	const hp = sc.character.hp;
	const { t: tc } = tx(sc);
	m.tools.challengeStep(tc, { stage: 0, approach: 1 });
	const end = m.tools.challengeStep(tc, { stage: 0, approach: 1 });
	assert.equal(end.narrate, true);
	assert.equal(sc.challenge!.status, "failure");
	assert.equal(sc.character.hp, hp - 3);
	assert.match(end.text, /FAILURE[\s\S]*Caught[\s\S]*Failure cost applied: −3 HP/);
});

test("HP costs hurt but never knock the PC out", async () => {
	const id = newGame();
	await ok(id, "start_challenge", setup({ stages: [{ prompt: "Glass", approaches: [ap("Crash through", { ...NEVER, cost: { hp: "50" } }), ap("b")] }] }));
	const s = m.loadState(id);
	m.tools.challengeStep(tx(s).t, { stage: 0, approach: 0 });
	assert.equal(s.character.hp, 1);
	assert.equal(s.challenge!.log[0].paid!.hp! > 0, true);
});

test("complications fire when the clock runs low and raise the DCs", async () => {
	const id = newGame();
	await ok(id, "start_challenge", setup({ clock: 8, complications: [{ text: "The bridge is up", atClock: 6, dcPlus: 3, cost: { item: "lucky charm" } }] }));
	const s = m.loadState(id);
	s.character.inventory.push({ id: "it_r", name: "Lucky Charm", quantity: 2, category: "gear" });
	assert.equal(m.client.clientState(s).challenge!.complications.length, 0, "hidden until it hits");
	const { t } = tx(s);
	m.tools.challengeStep(t, { stage: 0, approach: 1 }); // fail: 2 ticks → clock 6
	const ch = s.challenge!;
	assert.equal(ch.dcPlus, 3);
	assert.equal(ch.log[1].kind, "complication");
	assert.equal(ch.log[1].paid?.item, "Lucky Charm");
	assert.equal(s.character.inventory.find((i) => i.id === "it_r")!.quantity, 1);
	assert.equal(m.ch.approachOdds(s, ch.stages[0].approaches[0]).dc, 8, "DC 5 + 3");
});

// ─── rulesets ────────────────────────────────────────────────────────────

test("Root Access: failures add Heat, crew with the right role help (+2)", async () => {
	const id = newGame("cyberpunk");
	const add = await ok(id, "add_npc", { name: "Nico", role: "runner", description: "Fast." });
	const npcId = /id (\S+)\.$/.exec(add)![1];
	await ok(id, "recruit_crew", { npcId, classId: "rogue", role: "runner", hatPref: 0, specialty: "knows the roofs" });
	edit(id, (s) => (s.cyber!.crew![npcId].status = "with_pc"));
	await ok(id, "start_challenge", setup({ stages: [{ prompt: "Checkpoint", approaches: [ap("Bluff", { ...NEVER, skill: "deception", cost: { heat: 2 } }), ap("Run", { skill: "acrobatics" })] }] }));
	const s = m.loadState(id);
	const heat = s.cyber!.heat;
	const odds = m.ch.approachOdds(s, s.challenge!.stages[0].approaches[1]);
	assert.equal(odds.helper, "Nico");
	assert.equal(odds.bonus, m.derived.checkBreakdown(s.character, { kind: "check", skill: "acrobatics" }).mod + 2);
	assert.equal(m.ch.approachOdds(s, s.challenge!.stages[0].approaches[0]).helper, undefined, "a runner doesn't help a bluff");
	m.tools.challengeStep(tx(s).t, { stage: 0, approach: 0 });
	assert.equal(s.cyber!.heat, heat + 2);
	assert.equal(s.challenge!.log[0].paid!.heat, 2);
	const r = await call(newGame("cyberpunk"), "start_challenge", setup({ stages: [{ prompt: "x", approaches: [ap("a", { cost: { noise: 2 } }), ap("b")] }] }));
	assert.match(r.text, /noise exists only in The Quiet/);
});

test("The Quiet: failures make noise, and a crossed threshold reaches the DM's summary", async () => {
	const id = newGame("zombie");
	const npc: Npc = { id: "npc_mo", name: "Mo", role: "survivor", disposition: "friendly", description: "", alive: true, portrait: {} as Npc["portrait"] };
	const sv: Survivor = { npcId: "npc_mo", profession: "rogue", level: 1, hp: 8, maxHp: 8, morale: 5, status: "with_party", skills: ["stealth"], specialty: "", traits: [], joinedAt: 0, gear: [], missedDays: 0 };
	edit(id, (s) => {
		s.npcs.npc_mo = npc;
		s.group = { ...(s.group ?? ({} as never)), survivors: { npc_mo: sv } } as never;
	});
	await ok(id, "start_challenge", setup({ clock: 2, target: 1, stages: [{ prompt: "Car lot", approaches: [ap("Smash the window", { ...NEVER, cost: { noise: 5, clock: 1 } }), ap("Creep", { skill: "stealth" })] }], stakes: { success: "out", failure: "trapped" } }));
	const s = m.loadState(id);
	assert.equal(m.ch.approachOdds(s, s.challenge!.stages[0].approaches[1]).helper, "Mo", "a companion proficient in stealth helps");
	const before = s.survival!.noise.level;
	const { t } = tx(s);
	const end = m.tools.challengeStep(t, { stage: 0, approach: 0 });
	assert.equal(s.survival!.noise.level, Math.min(10, before + 5));
	assert.equal(end.narrate, true, "the 2-tick clock is spent");
	if (before < 4) assert.match(end.text, /NOISE THRESHOLD/, "the threshold instruction isn't lost");
});

// ─── DM side ─────────────────────────────────────────────────────────────

test("challenge_act resolves a stage from the player's words, custom approaches included", async () => {
	const id = newGame();
	await ok(id, "start_challenge", setup());
	const text = await ok(id, "challenge_act", { custom: { label: "Swing on the awning", skill: "Athletics", dc: 5, success: "over", failure: "down" } });
	assert.match(text, /Swing on the awning \(athletics \d+ vs DC 5\): SUCCESS/);
	assert.equal(m.loadState(id).challenge!.stage, 1);
	const gave = await ok(id, "challenge_act", { abandon: true });
	assert.match(gave, /CHALLENGE OVER — FAILURE[\s\S]*The player broke off/);
	const s = m.loadState(id);
	assert.equal(s.challenge!.narrated, true, "narrated in this very turn");
	assert.equal(m.ch.challengeDigest(s), undefined);
	assert.match(await ok(id, "challenge_status", { clear: true }), /narrated/);
	assert.equal(m.loadState(id).challenge?.status, "failure", "the result card stays for the player to close");
});

test("challenge_status cancel calls it off without consequences", async () => {
	const id = newGame();
	await ok(id, "start_challenge", setup());
	assert.match(await ok(id, "challenge_status", {}), /Clock 6\/6, progress 0\/3, stage 1\/3[\s\S]*0: Sure 1 — athletics \+\d vs DC 5 \(100%\)/);
	assert.match(await ok(id, "challenge_status", { cancel: "they turn to fight" }), /called off/);
	assert.equal(m.loadState(id).challenge, undefined);
});

test("digest, prompt and the client view", async () => {
	const id = newGame();
	await ok(id, "start_challenge", setup());
	const s = m.loadState(id);
	assert.match(m.digest.stateDigest(s), /CHALLENGE ACTIVE: "Through the market"[\s\S]*challenge_act/);
	assert.match(m.prompt.buildSystemPrompt(s.settings), /TIMED CHALLENGES: when the player's OWN action/);
	const view = m.client.clientState(s).challenge!;
	assert.equal(view.stages[0].prompt, "Obstacle 1");
	assert.equal(view.stages[1].prompt, "", "stages ahead stay blank");
	assert.equal(view.stages.length, 3, "but their number shows");
	const { t } = tx(s);
	for (const i of [0, 1, 2]) m.tools.challengeStep(t, { stage: i, approach: 0 });
	assert.match(m.digest.stateDigest(s), /CHALLENGE OVER, NOT YET NARRATED/, "a failed end turn leaves it for the next one");
	assert.equal(m.client.clientState(s).challenge!.summary, undefined, "the DM's summary stays server-side");
	assert.equal(m.client.clientState(s).challenge!.stages[2].prompt, "Obstacle 3", "all shown once over");
});

test("es defines every challenge string", () => {
	for (const k of Object.keys(m.en)) assert.ok((m.es as Record<string, string>)[k], `es: ${k}`);
});

test("downtime (Den, Crew, base) refuses while a challenge runs, in the campaign language", async () => {
	const dt = await import("../lib/dm/downtime");
	const cy = newGame("cyberpunk");
	await ok(cy, "start_challenge", setup());
	const s = m.loadState(cy);
	assert.throws(() => dt.cyberDowntime(s, { op: "lay_low", days: 1 } as never), /finish the challenge first/);
	s.settings.language = "es";
	assert.throws(() => dt.cyberDowntime(s, { op: "lay_low", days: 1 } as never), /termina el desafío primero/);
	const z = newGame("zombie");
	await ok(z, "start_challenge", setup());
	assert.throws(() => dt.baseDowntime(m.loadState(z), { op: "take", kind: "food", qty: 1 } as never, () => "it_x"), /finish the challenge first/);
	// Once it's over, downtime is open again (the refusal is only for a running challenge).
	const done = m.loadState(cy);
	done.challenge!.status = "success";
	assert.doesNotThrow(() => {
		try {
			dt.cyberDowntime(done, { op: "lay_low", days: 1 } as never);
		} catch (e) {
			if (/challenge/.test(String(e))) throw e;
		}
	});
});

test("a complication that burns the last ticks ends the challenge", async () => {
	const id = newGame();
	await ok(id, "start_challenge", setup({ clock: 4, complications: [{ text: "The gate slams", atClock: 2, cost: { clock: 2 } }] }));
	const s = m.loadState(id);
	const { t } = tx(s);
	m.tools.challengeStep(t, { stage: 0, approach: 0 }); // clock 3
	const r = m.tools.challengeStep(t, { stage: 1, approach: 0 }); // clock 2 → complication −2 → 0
	assert.equal(s.challenge!.clock, 0);
	assert.equal(r.narrate, true, "the DM still gets its one turn");
	assert.equal(s.challenge!.status, "partial", "2 of 3: past halfway");
});

test("closing the result card: narrated ends are cleared, un-narrated ones come back for narration", async () => {
	const id = newGame();
	await ok(id, "start_challenge", setup());
	const s = m.loadState(id);
	assert.throws(() => m.ch.dismissChallenge(s), /still running/);
	const { t } = tx(s);
	for (const i of [0, 1, 2]) m.tools.challengeStep(t, { stage: i, approach: 0 });
	assert.match(m.ch.dismissChallenge(s) ?? "", /CHALLENGE OVER — SUCCESS/, "the failed end turn is retried, nothing dropped");
	assert.ok(s.challenge);
	s.challenge!.narrated = true;
	assert.equal(m.ch.dismissChallenge(s), undefined);
	assert.equal(s.challenge, undefined);
});
