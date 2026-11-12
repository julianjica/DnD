import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { FightBeat, GameState } from "../lib/game/types";
import { jackIn, type NetNodeInput } from "../lib/rules/netrun";
import { pcNextAction, startCombat, type CombatState } from "../lib/rules/combat";
import { makeFighter, makeMap, makeMonster, makeWizard, openMap, SPELLS } from "../lib/rules/combat/fixtures";

/**
 * Automatic fights (lib/dm/autofight.ts, lib/rules/combat/auto.ts): the
 * engine resolves the whole fight from start_combat, records a replay and
 * hands the DM a summary; turn-by-turn mode is the old flow, untouched.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-autofight-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	beginCombat: typeof import("../lib/dm/tools/combat").beginCombat;
	prompt: typeof import("../lib/dm/prompt");
	settingsDiff: typeof import("../lib/dm/settings-diff");
	autofight: typeof import("../lib/dm/autofight");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		beginCombat: (await import("../lib/dm/tools/combat")).beginCombat,
		prompt: await import("../lib/dm/prompt"),
		settingsDiff: await import("../lib/dm/settings-diff"),
		autofight: await import("../lib/dm/autofight"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// ─── fixtures ────────────────────────────────────────────────────────────────

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };
const SMART = { method: "standard_array" as const, scores: { str: 8, con: 14, dex: 13, wis: 12, int: 15, cha: 10 } };
/** A walled hall: no way out but the fight. */
const HALL = ["####################", "#,,,,,,,,,,,,,,,,,,#", "#,,@,,,,,,,,,,,,,,,#", "#,,,,,,,,,,,,,,,,,,#", "#,,,,,,,,,,,,,,,,,,#", "#,,,,,,,,,,,,,,,,,,#", "####################"];
/** An open street: every edge leads away. */
const STREET = [",,,,,,,,,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,", ",,@,,,,,,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,", ",,,,,,,,,,,,,,,,,,,,"];

interface GameOpts {
	ruleset?: "fantasy" | "zombie" | "cyberpunk";
	classId?: string;
	level?: number;
	fights?: "auto" | "turns";
	seed?: number;
}

function newGame(o: GameOpts = {}): string {
	const settings = m.defaultSettings();
	settings.structure.leveling = "xp";
	settings.structure.startingLevel = o.level ?? 3;
	if (o.fights) settings.dm.fights = o.fights;
	if (o.ruleset === "zombie") settings.world.preset = "zombie_outbreak";
	if (o.ruleset === "cyberpunk") settings.world.preset = "marea_burned" as never;
	const classId = o.classId ?? "fighter";
	const caster = ["wizard", "sorcerer"].includes(classId);
	const species = o.ruleset === "zombie" ? "z-origin-streetwise" : "human";
	return m.createGame({ settings, seed: o.seed ?? 7, character: { name: "Thorin", speciesId: species, classId, backgroundId: o.ruleset === "zombie" ? "criminal" : "soldier", abilities: caster ? SMART : STD } }).id;
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
const beats = <K extends FightBeat["k"]>(s: GameState, k: K) => (s.fight?.beats ?? []).filter((b): b is Extract<FightBeat, { k: K }> => b.k === k);

// ─── the policy (pure) ───────────────────────────────────────────────────────

test("policy: a wizard opens with Fireball on a cluster; a cantrip finishes a lone foe", () => {
	const ch = makeWizard();
	const map = openMap(16, 10);
	const gob = (n: number, x: number, y: number) => ({ stats: makeMonster({ name: `Goblin ${n}` }), position: { x, y } });
	const res = startCombat({ encounterId: "e", map, character: ch, monsters: [gob(1, 10, 4), gob(2, 11, 4), gob(3, 10, 5)], pcPosition: { x: 1, y: 4 } }, new Rng(1), { spells: SPELLS });
	assert.ok(res.ok, res.error);
	const enc = structuredClone(res.encounter);
	enc.turnIndex = enc.order.indexOf(ch.id);
	const state: CombatState = { encounter: enc, map: res.map, character: res.character };
	const opts = { spells: SPELLS };
	const a = pcNextAction({ state, opts, flee: false, rejected: new Set() });
	assert.equal(a.type, "cast");
	assert.equal((a as { spell: string }).spell, "fireball");
	// One goblin left at 2 HP: not worth a 3rd-level slot.
	for (const id of enc.order) if (enc.combatants[id].kind !== "pc" && id !== enc.order.find((x) => enc.combatants[x].kind !== "pc")) enc.combatants[id].dead = true;
	const last = Object.values(enc.combatants).find((c) => c.kind !== "pc" && !c.dead)!;
	last.hp = 2;
	const b = pcNextAction({ state, opts, flee: false, rejected: new Set() });
	assert.equal(b.type, "cast");
	assert.equal((b as { spell: string }).spell, "fire-bolt");
});

test("policy: hurt, the PC drinks a potion (bonus action) before swinging; a refused action falls through", () => {
	const ch = makeFighter({ hp: 10 });
	const map = makeMap(["........", "........", "........"]);
	const res = startCombat({ encounterId: "e", map, character: ch, monsters: [{ stats: makeMonster(), position: { x: 1, y: 1 } }], pcPosition: { x: 0, y: 1 } }, new Rng(2));
	const enc = structuredClone(res.encounter);
	enc.turnIndex = enc.order.indexOf(ch.id);
	const state: CombatState = { encounter: enc, map: res.map, character: res.character };
	const a = pcNextAction({ state, opts: {}, flee: false, rejected: new Set() });
	assert.deepEqual(a, { type: "use_item", itemId: "potion" });
	const rejected = new Set([JSON.stringify(a)]);
	const b = pcNextAction({ state, opts: {}, flee: false, rejected });
	assert.notEqual(b.type, "use_item");
	assert.ok(["use_feature", "attack"].includes(b.type), JSON.stringify(b));
});

// ─── whole fights ────────────────────────────────────────────────────────────

test("a won fight: start_combat resolves it all, awards XP, leaves no encounter, records a replay and a summary", async () => {
	const id = newGame({ level: 5 });
	await ok(id, "draw_map", { name: "Hall", kind: "dungeon", rows: HALL });
	const xp0 = m.loadState(id).character.xp;
	const text = await ok(id, "start_combat", { monsters: [{ monster: "goblin", x: 14, y: 3 }] });
	assert.match(text, /AUTOMATIC FIGHT/);
	assert.match(text, /Outcome: VICTORY/);
	assert.match(text, /narrate the fight as ONE short, vivid scene/);
	const s = m.loadState(id);
	assert.equal(s.encounter, undefined);
	assert.equal(s.mode, "explore");
	assert.equal(s.view, "map");
	assert.equal(s.character.xp, xp0 + 50);
	assert.equal(s.fight?.outcome, "victory");
	assert.ok(s.fight!.actors.some((a) => a.kind === "pc"));
	assert.ok(beats(s, "atk").some((b) => b.a === s.character.id), "the PC attacked");
	assert.ok(beats(s, "die").length >= 1);
	assert.equal(beats(s, "end")[0]?.outcome, "victory");
	// The goblin's corpse stays on the map.
	assert.ok(s.maps[s.activeMapId!].entities.some((e) => e.kind === "monster" && e.dead));
	// Nothing left to play: end_combat says so.
	const end = await call(id, "end_combat", {});
	assert.equal(end.isError, true);
	assert.match(end.text, /automatic fight already ended/);
});

test("a lost fight: the PC is knocked out, not killed (AUTO_FIGHT_PC_DOWN), and comes round at 1 HP", async () => {
	assert.equal(m.autofight.AUTO_FIGHT_PC_DOWN, "knocked_out");
	const id = newGame({ level: 1, classId: "wizard" });
	await ok(id, "draw_map", { name: "Hall", kind: "dungeon", rows: HALL });
	edit(id, (s) => (s.character.hp = 1));
	const text = await ok(id, "start_combat", { monsters: [{ monster: "wolf", x: 4, y: 3 }], override: "test" });
	const s = m.loadState(id);
	assert.equal(s.fight?.outcome, "knocked_out", text);
	assert.match(text, /KNOCKED OUT \(not dead\)/);
	assert.match(text, /THE PC IS NOT DEAD/);
	assert.equal(s.character.hp, 1);
	assert.ok(!s.character.conditions.some((c) => c.id === "unconscious"));
	assert.equal(s.encounter, undefined);
	assert.ok(beats(s, "down").some((b) => b.d === s.character.id));
});

test("a lethal fight: a downed PC makes death saves instead (and may die)", async () => {
	const id = newGame({ level: 1, classId: "wizard" });
	await ok(id, "draw_map", { name: "Hall", kind: "dungeon", rows: HALL });
	edit(id, (s) => (s.character.hp = 1));
	const text = await ok(id, "start_combat", { monsters: [{ monster: "wolf", x: 4, y: 3 }], override: "duel", lethal: true });
	const s = m.loadState(id);
	assert.match(text, /marked LETHAL/);
	assert.ok(["dead", "defeat", "victory", "escaped"].includes(s.fight!.outcome), s.fight!.outcome);
	if (s.fight!.outcome !== "victory" && s.fight!.outcome !== "escaped") assert.ok(beats(s, "ds").length >= 1, "death saves were rolled");
	if (s.fight!.outcome === "dead") assert.match(text, /DEAD/);
});

test("run: an escape attempt gets the PC off the map; nobody dies, no XP", async () => {
	const id = newGame({ level: 3 });
	await ok(id, "draw_map", { name: "Street", kind: "town", rows: STREET });
	const xp0 = m.loadState(id).character.xp;
	const text = await ok(id, "start_combat", { monsters: [{ monster: "goblin", x: 12, y: 3 }], choice: "run" });
	assert.match(text, /RUN \(an escape attempt\)/);
	const s = m.loadState(id);
	assert.equal(s.fight?.outcome, "escaped", text);
	assert.equal(s.fight?.choice, "run");
	assert.equal(s.encounter, undefined);
	assert.ok(s.character.hp > 0);
	assert.equal(s.character.xp, xp0);
	assert.ok(beats(s, "move").some((b) => b.a === s.character.id));
	assert.equal(beats(s, "atk").filter((b) => b.a === s.character.id).length, 0, "running, not fighting");
});

test("spells: a wizard spends a slot on a big spell, and cantrips after", async () => {
	const id = newGame({ level: 5, classId: "wizard" });
	await ok(id, "draw_map", { name: "Hall", kind: "dungeon", rows: HALL });
	const text = await ok(id, "start_combat", { monsters: [{ monster: "goblin", count: 3, x: 13, y: 3 }, { monster: "hobgoblin", x: 15, y: 4 }] });
	const s = m.loadState(id);
	assert.ok(beats(s, "spell").some((b) => b.a === s.character.id), text);
	assert.ok(s.character.spellcasting!.slotsUsed.some((n) => n > 0), "a slot was spent");
	assert.match(text, /level-\d slot/);
});

test("consumables: a hurt fighter drinks a potion", async () => {
	const id = newGame({ level: 3 });
	await ok(id, "draw_map", { name: "Hall", kind: "dungeon", rows: HALL });
	await ok(id, "give_item", { name: "Potion of Healing", quantity: 1 });
	edit(id, (s) => (s.character.hp = Math.floor(s.character.maxHp * 0.3)));
	const text = await ok(id, "start_combat", { monsters: [{ monster: "goblin", x: 16, y: 4 }], override: "test" });
	const s = m.loadState(id);
	assert.ok(beats(s, "item").some((b) => /Potion of Healing/.test(b.s)), text);
	assert.ok(!s.character.inventory.some((i) => i.name === "Potion of Healing"));
	assert.match(text, /Spent: .*Potion of Healing/);
});

test("allies: the crew joins within the ally cap, fights, and their HP persists", async () => {
	const id = newGame({ ruleset: "cyberpunk", classId: "fighter", level: 3 });
	const npc = await ok(id, "add_npc", { name: "Nico", role: "fixer", description: "Quiet." });
	const npcId = /id (\S+)\.$/.exec(npc)![1];
	await ok(id, "recruit_crew", { npcId, classId: "fighter", role: "muscle", hatPref: 0, specialty: "hits hard" });
	await ok(id, "draw_map", { name: "Alley", kind: "town", rows: HALL });
	const text = await ok(id, "start_combat", { monsters: [{ monster: "c-ahogados-ganger", count: 2, x: 14, y: 3 }] });
	const s = m.loadState(id);
	const ally = s.fight!.actors.find((a) => a.side === "party" && a.kind === "npc");
	assert.ok(ally, text);
	// The start went through the solo budget and the ally cap (no override needed).
	assert.match(text, /Encounter budget/);
	assert.doesNotMatch(text, /OVERRIDE/);
	assert.ok(beats(s, "turn").some((t) => t.a === ally!.id), "the ally took turns");
	assert.match(text, /Allies: Nico/);
	// Their HP carries over to the crew member (unless they went down: then the crew rules decide).
	const crew = s.cyber!.crew![npcId];
	if (!beats(s, "die").some((d) => d.d === ally!.id)) {
		const last = [...s.fight!.beats].reverse().find((b): b is Extract<FightBeat, { k: "dmg" | "heal" }> => (b.k === "dmg" || b.k === "heal") && b.d === ally!.id);
		assert.equal(crew.hp, last ? last.hp : ally!.hp);
	}
});

const NODES: NetNodeInput[] = [
	{ kind: "entry", name: "Guest wifi" },
	{ kind: "data", name: "Visitor logs", holds: "badge codes" },
	{ kind: "control", name: "Lobby cameras", controls: "the lobby cameras" },
];

test("a net-run fight: every PC turn ticks the trace, and the replay shows it", async () => {
	const id = newGame({ ruleset: "cyberpunk", classId: "wizard", level: 3 });
	await ok(id, "generate_map", { kind: "tavern", name: "The capsule room" });
	const s0 = m.loadState(id);
	jackIn(s0, { target: "Vantis lab", security: 1, body: "den", nodes: NODES }, new Rng(7));
	m.saveState(s0);
	const trace0 = s0.cyber!.run!.trace;
	const text = await ok(id, "start_combat", { monsters: [{ monster: "c-ice-watchdog" }], override: "test" });
	const s = m.loadState(id);
	assert.ok(s.fight, text);
	const after = s.cyber!.run?.trace ?? 10;
	assert.ok(after > trace0, `trace ${trace0} → ${after}`);
	assert.ok(beats(s, "trace").length >= 1);
	assert.match(text, /Trace \d+ → \d+\/10/);
});

test("a zombie fight: the gun is loud and spends rounds, the noise rises, and the replay shows it", async () => {
	const id = newGame({ ruleset: "zombie", classId: "paladin", level: 3 });
	await ok(id, "draw_map", { name: "Main Street", kind: "town", rows: HALL });
	const st = m.loadState(id);
	assert.ok(st.character.inventory.some((i) => i.ref === "z-pistol-9mm"), "the officer carries a pistol");
	const rounds0 = st.character.inventory.find((i) => i.ref === "z-ammo-9mm")?.quantity ?? 0;
	assert.ok(rounds0 > 0);
	const text = await ok(id, "start_combat", { monsters: [{ monster: "z-shambler", x: 15, y: 4 }] });
	const s = m.loadState(id);
	assert.ok(beats(s, "atk").some((b) => b.a === s.character.id && /Pistol/.test(b.w)), text);
	assert.ok((s.survival?.noise.level ?? 0) > 0);
	assert.ok(beats(s, "noise").length >= 1);
	assert.match(text, /Noise \+3/);
	const rounds = s.character.inventory.find((i) => i.ref === "z-ammo-9mm")?.quantity ?? 0;
	assert.ok(rounds < rounds0, `9mm ${rounds0} → ${rounds}`);
	assert.match(text, /Spent: .*9mm/);
	assert.equal(s.ambience, "q_dread");
});

test("determinism: the same state and seed play the same fight", async () => {
	const id = newGame({ level: 3 });
	await ok(id, "draw_map", { name: "Hall", kind: "dungeon", rows: HALL });
	const base = m.loadState(id);
	const play = (seed: number) => {
		const state = structuredClone(base);
		const tx = { state, rng: new Rng(seed), roll: () => undefined, fx: () => undefined };
		const text = m.beginCombat(tx, { monsters: [{ monster: "goblin", x: 12, y: 3 }, { monster: "wolf", x: 14, y: 4 }] });
		return { text, beats: JSON.stringify(state.fight!.beats), outcome: state.fight!.outcome, hp: state.character.hp };
	};
	const a = play(42);
	const b = play(42);
	assert.equal(a.text, b.text);
	assert.equal(a.beats, b.beats);
	assert.deepEqual([a.outcome, a.hp], [b.outcome, b.hp]);
	const others = [1, 2, 3, 4, 5].map(play);
	assert.ok(others.some((o) => o.beats !== a.beats), "other seeds play differently");
});

test("turn-by-turn mode is unchanged: start_combat only sets up, the old flow plays it", async () => {
	const id = newGame({ level: 3, fights: "turns" });
	await ok(id, "draw_map", { name: "Hall", kind: "dungeon", rows: HALL });
	const text = await ok(id, "start_combat", { monsters: [{ monster: "goblin", x: 14, y: 3 }], choice: "fight" });
	assert.doesNotMatch(text, /AUTOMATIC FIGHT/);
	assert.match(text, /Combat begins!/);
	assert.match(text, /PLAYER's turn|Resolve it with monster_turn/);
	const s = m.loadState(id);
	assert.equal(s.encounter?.status, "active");
	assert.equal(s.fight, undefined);
	if (s.encounter!.order[s.encounter!.turnIndex] !== s.character.id) {
		const gob = Object.values(s.encounter!.combatants).find((c) => c.kind !== "pc")!;
		await ok(id, "monster_turn", { combatantId: gob.id, auto: true });
	}
	const end = await ok(id, "end_combat", { status: "ended", reason: "test" });
	assert.match(end, /Combat ended/);
});

test("automatic mode resolves a fight left half-played turn by turn (start_combat monsters [])", async () => {
	const id = newGame({ level: 5, fights: "turns" });
	await ok(id, "draw_map", { name: "Hall", kind: "dungeon", rows: HALL });
	await ok(id, "start_combat", { monsters: [{ monster: "goblin", x: 14, y: 3 }] });
	edit(id, (s) => (s.settings.dm.fights = "auto"));
	const text = await ok(id, "start_combat", { monsters: [] });
	assert.match(text, /AUTOMATIC FIGHT/);
	assert.equal(m.loadState(id).encounter, undefined);
});

test("the setting: automatic by default (old campaigns too); the prompt and the settings notice follow it", () => {
	const s = m.defaultSettings();
	assert.equal(s.dm.fights, undefined, "missing = automatic");
	assert.equal(m.autofight.fightsAuto({ settings: s }), true);
	const auto = m.prompt.buildSystemPrompt(s);
	assert.match(auto, /FIGHTS ARE AUTOMATIC/);
	assert.match(auto, /KNOCKED OUT, NOT DEAD/);
	assert.doesNotMatch(auto, /On monsters' turns, decide tactics/);
	const turns = m.prompt.buildSystemPrompt({ ...s, dm: { ...s.dm, fights: "turns" } });
	assert.match(turns, /On monsters' turns, decide tactics in character and resolve them with monster_turn/);
	assert.doesNotMatch(turns, /FIGHTS ARE AUTOMATIC/);
	assert.match(m.settingsDiff.describeSettingsChange(s, { ...s, dm: { ...s.dm, fights: "turns" } }), /FIGHTS are now TURN BY TURN/);
	assert.match(m.settingsDiff.describeSettingsChange({ ...s, dm: { ...s.dm, fights: "turns" } }, s), /FIGHTS are now AUTOMATIC/);
});

test("the tool list stays the same in both modes (engine sessions resume)", () => {
	const names = (fights: "auto" | "turns") => {
		const id = newGame({ fights });
		return m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).map((t) => `${t.name}:${t.description.length}`).join(",");
	};
	assert.equal(names("auto"), names("turns"));
});
