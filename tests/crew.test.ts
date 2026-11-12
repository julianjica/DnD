import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { CrewMember, GameState, RollRecord } from "../lib/game/types";
import {
	betrayalChance,
	crewDigest,
	crewForCombat,
	crewHatReaction,
	crewMaxHp,
	crewStatBlock,
	crewTick,
	crewXp,
	CREW_CAP,
	syncCrewFromCombat,
	vanAssist,
	vanHoldsTheBody,
} from "../lib/rules/crew";
import { shiftHat } from "../lib/rules/cyber";
import { allyCap } from "../lib/rules/encounter-budget";
import { jackIn, netAction, traceTick, type NetNodeInput } from "../lib/rules/netrun";
import { denOf } from "../lib/rules/den";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-crew-"));
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
const ROWS = ["##############", "#,,,,,,,,,,,,#", "#,@,,,,,,,,,,#", "#,,,,,,,,,,,,#", "#,,,,,,,,,,,,#", "##############"];

function newGame(ruleset: "cyberpunk" | "fantasy" | "zombie" = "cyberpunk"): string {
	const settings = m.defaultSettings();
	settings.dm.fights = "turns"; // these tests play fights turn by turn (the default is automatic)
	if (ruleset === "cyberpunk") settings.world.preset = "marea_burned" as never;
	if (ruleset === "zombie") settings.world.preset = "zombie_outbreak" as never;
	return m.createGame({ settings, seed: 7, character: { name: "Vera", speciesId: "human", classId: "sorcerer", backgroundId: "criminal", abilities: STD } }).id;
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
async function ok(id: string, name: string, args: Record<string, unknown>) {
	const r = await call(id, name, args);
	assert.notEqual(r.isError, true, `${name}: ${r.text}`);
	return r.text;
}

async function npc(id: string, name: string): Promise<string> {
	const text = await ok(id, "add_npc", { name, role: "fixer's runner", description: "Quick eyes, cheap jacket." });
	return /id (\S+)\.$/.exec(text)![1];
}

/** A cyber game with one crew member recruited through the tool. */
async function withMember(args: Partial<{ classId: string; role: string; hatPref: number; level: number; gear: string[] }> = {}, name = "Nico") {
	const id = newGame();
	const npcId = await npc(id, name);
	const text = await ok(id, "recruit_crew", { npcId, classId: "fighter", role: "muscle", hatPref: 0, specialty: "hits hard, asks later", ...args });
	return { id, npcId, text };
}

const member = (s: GameState, npcId: string): CrewMember => s.cyber!.crew![npcId];
const rec = () => {
	const list: RollRecord[] = [];
	return { list, record: (r: RollRecord) => void list.push(r) };
};
const minute = (s: GameState) => s.time.day * 1440 + s.time.hour * 60 + s.time.minute;

// ─── recruiting ──────────────────────────────────────────────────────────────

test("recruit_crew: an existing NPC joins with a stat block from style and level, c- gear, with the PC", async () => {
	const { id, npcId, text } = await withMember({ classId: "Netrunner", role: "runner", hatPref: 2, gear: ["c-light-pistol", "c-armored-jacket"] });
	assert.match(text, /joins the crew: runner, Netrunner 1 \[wizard\]/);
	const s = m.loadState(id);
	const c = member(s, npcId);
	assert.equal(c.classId, "wizard");
	assert.equal(c.level, 1);
	assert.equal(c.maxHp, crewMaxHp("wizard", 1));
	assert.equal(c.hp, c.maxHp);
	assert.equal(c.status, "with_pc");
	assert.equal(c.loyalty, 6, "hat close to the PC's (0): starts at 6");
	assert.deepEqual(c.gear, ["c-light-pistol", "c-armored-jacket"]);
	assert.ok(s.scene.npcIds.includes(npcId));
	assert.equal(s.npcs[npcId].disposition, "friendly");
	const block = crewStatBlock(c, "Nico");
	assert.equal(block.ruleset, "cyberpunk");
	assert.equal(block.xp, crewXp(1));
	assert.ok(block.actions.some((a) => a.name === "Light Pistol" && a.attack?.kind === "ranged"));
	assert.equal(block.ac, 12 + 1, "armoured jacket + DEX");
});

test("recruit_crew: level capped at the PC's, unknown gear/style refused, already-in refused, cap of 4", async () => {
	const { id, npcId } = await withMember({ level: 9 });
	assert.equal(member(m.loadState(id), npcId).level, 1, "never above the PC's level");
	assert.match((await call(id, "recruit_crew", { npcId, classId: "fighter", role: "muscle", hatPref: 0, specialty: "x" })).text, /already in the crew/);
	const other = await npc(id, "Pilar");
	assert.match((await call(id, "recruit_crew", { npcId: other, classId: "fighter", role: "muscle", hatPref: 0, specialty: "x", gear: ["z-fire-axe"] })).text, /Unknown gear/);
	assert.match((await call(id, "recruit_crew", { npcId: other, classId: "wizardess", role: "muscle", hatPref: 0, specialty: "x" })).text, /Unknown hacking style/);
	assert.match((await call(id, "recruit_crew", { npcId: "npc_nobody", classId: "fighter", role: "muscle", hatPref: 0, specialty: "x" })).text, /Unknown NPC/);
	for (const n of ["Pilar", "Ramón", "Lu"]) await ok(id, "recruit_crew", { npcId: await npc(id, n), classId: "rogue", role: "face", hatPref: 0, specialty: "x" });
	const fifth = await npc(id, "Toño");
	assert.match((await call(id, "recruit_crew", { npcId: fifth, classId: "rogue", role: "face", hatPref: 0, specialty: "x" })).text, new RegExp(`crew is full \\(${CREW_CAP}`));
	// Dismissing one makes room.
	await ok(id, "crew_dismiss", { npcId, why: "parted ways" });
	assert.equal(member(m.loadState(id), npcId).status, "left");
	await ok(id, "recruit_crew", { npcId: fifth, classId: "rogue", role: "face", hatPref: 0, specialty: "x" });
});

test("crew_status: den / away / back with the PC moves them in and out of the scene", async () => {
	const { id, npcId } = await withMember();
	assert.match(await ok(id, "crew_status", { npcId, status: "at_den", why: "minding the rigs" }), /at the den/);
	let s = m.loadState(id);
	assert.equal(member(s, npcId).status, "at_den");
	assert.ok(!s.scene.npcIds.includes(npcId));
	await ok(id, "crew_status", { npcId, status: "with_pc", why: "the job" });
	s = m.loadState(id);
	assert.equal(member(s, npcId).status, "with_pc");
	assert.ok(s.scene.npcIds.includes(npcId));
});

// ─── loyalty and the Hat ─────────────────────────────────────────────────────

test("loyalty: the Hat moving far from theirs costs loyalty, close to it warms; at 0 they leave", async () => {
	const { id, npcId } = await withMember({ hatPref: 6 });
	const s = m.loadState(id);
	const c = member(s, npcId);
	assert.equal(c.loyalty, 5);
	const rng = new Rng(1);
	crewTick(s, rng); // first tick: baseline
	shiftHat(s.cyber!, -2, "sold the clinic's list", minute(s));
	const out = crewTick(s, rng) ?? "";
	assert.match(out, /loyalty 5 → 4/, "distance 8 after moving away: −1");
	shiftHat(s.cyber!, -3, "ransomware", minute(s));
	crewTick(s, rng);
	assert.equal(c.loyalty, 2, "a big move (3) away: −2");
	// Moving toward them while still far: nothing; back close: +1.
	assert.deepEqual(crewHatReaction(s, -5, -3), []);
	assert.equal(c.loyalty, 2);
	s.cyber!.hat = 5;
	crewTick(s, rng);
	assert.equal(c.loyalty, 3, "back within 2 of theirs: +1");
	// Each day far away costs one more; at 0 they walk.
	s.cyber!.hat = -5;
	s.cyber!.heat = 0; // no betrayal in this test
	crewTick(s, rng);
	s.time.day += 3;
	const days = crewTick(s, rng) ?? "";
	assert.equal(c.loyalty, 0);
	assert.equal(c.status, "left");
	assert.match(days, /LEAVES the crew \(loyalty ran out\)/);
	assert.ok(!s.scene.npcIds.includes(npcId));
});

test("loyalty: close hat warms slowly (every other day, up to 8); crew_loyalty for moments", async () => {
	const { id, npcId } = await withMember({ hatPref: 1 });
	const s = m.loadState(id);
	const c = member(s, npcId);
	assert.equal(c.loyalty, 6);
	crewTick(s, new Rng(1));
	s.time.day += 10;
	crewTick(s, new Rng(1));
	assert.equal(c.loyalty, 8, "passive warming stops at 8");
	m.saveState(s);
	assert.match(await ok(id, "crew_loyalty", { npcId, delta: 2, why: "pulled them out of the fire" }), /8 → 10/);
	assert.match(await ok(id, "crew_loyalty", { npcId, delta: -3, why: "lied about the take" }), /10 → 7/);
	edit(id, (st) => void (member(st, npcId).loyalty = 2));
	assert.match(await ok(id, "crew_loyalty", { npcId, delta: -2, why: "left them behind" }), /LEAVES the crew/);
	assert.equal(member(m.loadState(id), npcId).status, "left");
	assert.match((await call(id, "crew_loyalty", { npcId, delta: 1, why: "sorry" })).text, /no longer in the crew/);
});

test("betrayal: loyalty ≤ 2, far from the PC's hat, Heat ≥ 5 → a daily roll; Heat +2 and a Ferro raid", async () => {
	const { id, npcId } = await withMember({ hatPref: 8 }, "Santi's cousin");
	const base = m.loadState(id);
	denOf(base);
	base.cyber!.hat = -2;
	base.cyber!.heat = 5;
	member(base, npcId).loyalty = 2;
	base.cyber!.crewTick = { at: minute(base), hat: base.cyber!.hat };
	crewTick(base, new Rng(1));
	assert.equal(member(base, npcId).loyalty, 2, "no hat move since the baseline");
	assert.equal(betrayalChance(base, member(base, npcId)), 20);
	assert.match(crewDigest(base)!, /could SELL THE PC OUT \(20% a day/);
	assert.match(crewDigest(base)!, /WAVERING/);
	// The day passes: loyalty drops to 1 (far), then the roll (30% at loyalty 1, Heat 5).
	let betrayed: GameState | undefined;
	let held = 0;
	for (let seed = 1; seed < 80 && (!betrayed || !held); seed++) {
		const s = structuredClone(base);
		s.time.day += 1;
		const out = crewTick(s, new Rng(seed)) ?? "";
		if (member(s, npcId).status === "betrayed") {
			betrayed ??= s;
			assert.match(out, /BETRAYAL: Santi's cousin SOLD THE PC OUT/);
		} else {
			held++;
			assert.match(out, /thought about selling the PC out today \(30% chance\)/);
		}
	}
	assert.ok(betrayed, "some seed betrays");
	assert.ok(held, "some seed holds");
	const s = betrayed!;
	assert.equal(s.cyber!.heat, 7, "Heat +2");
	assert.equal(s.cyber!.den!.raidDue?.by, "ferro");
	assert.match(s.cyber!.den!.raidDue!.reason, /Santi's cousin sold you out/);
	assert.equal(s.cyber!.den!.raidDue!.at - minute(s), 6 * 60, "in 6 hours");
	assert.equal(s.npcs[npcId].disposition, "hostile");
	assert.match((await (async () => {
		m.saveState(s);
		return (await call(id, "recruit_crew", { npcId, classId: "fighter", role: "muscle", hatPref: 0, specialty: "x" })).text;
	})()), /sold the PC out/);
	// Heat below 5: no betrayal risk at all.
	const calm = structuredClone(base);
	calm.cyber!.heat = 4;
	assert.equal(betrayalChance(calm, member(calm, npcId)), 0);
});

test("the daily tick runs from the engine after tool calls (advance_time)", async () => {
	const { id, npcId } = await withMember({ hatPref: 9 });
	edit(id, (s) => {
		s.cyber!.hat = -1;
		s.cyber!.heat = 0;
	});
	// The Hat moved since they joined (0 → −1, far from their +9): they react on the next engine call.
	assert.match(await ok(id, "advance_time", { minutes: 1 }), /CREW: Nico's loyalty 4 → 3/);
	const text = await ok(id, "advance_time", { days: 2 });
	assert.match(text, /CREW: Nico's loyalty 3 → 2\/10: another day/);
	assert.equal(member(m.loadState(id), npcId).loyalty, 1);
});

// ─── fights ──────────────────────────────────────────────────────────────────

test("combat: crew with the PC join start_combat as capped allies; the rest hang back", async () => {
	const { id, npcId } = await withMember({ gear: ["c-machete"] });
	const den = await npc(id, "Pilar");
	await ok(id, "recruit_crew", { npcId: den, classId: "cleric", role: "medic", hatPref: 0, specialty: "stitches" });
	await ok(id, "crew_status", { npcId: den, status: "at_den", why: "home" });
	await ok(id, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	const text = await ok(id, "start_combat", { monsters: [{ monster: "c-ahogados-lookout", x: 10, y: 3 }] });
	assert.match(text, /Crew fighting beside the PC \(side party\): Nico/);
	assert.match(text, /never land the decisive blow/);
	const s = m.loadState(id);
	const allies = Object.values(s.encounter!.combatants).filter((c) => c.side === "party" && c.kind === "npc");
	assert.deepEqual(allies.map((c) => c.refId), [npcId], "only the one with the PC");
	assert.equal(allies[0].maxHp, member(s, npcId).maxHp);
	// The cap: with the allies' room used up, they hang back.
	const map = s.maps[s.activeMapId!];
	const capped = crewForCombat(s, map, allyCap(1) - crewXp(1) + 1, new Set());
	assert.equal(capped.spawns.length, 0);
	assert.match(capped.held[0], /hangs back: the ally cap/);
	assert.equal(crewForCombat(s, map, 0, new Set()).spawns.length, 1);
});

test("combat: HP persists, a member who drops rolls to live; end_combat brings the living up at 1 HP; long rest heals", async () => {
	const { id, npcId } = await withMember();
	await ok(id, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	await ok(id, "start_combat", { monsters: [{ monster: "c-ahogados-lookout", x: 10, y: 3 }] });
	const s = m.loadState(id);
	const c = Object.values(s.encounter!.combatants).find((k) => k.refId === npcId)!;
	c.hp = 3;
	syncCrewFromCombat(s, new Rng(1), () => undefined);
	assert.equal(member(s, npcId).hp, 3);
	// Drops: alive or dead by the d20.
	let lived: GameState | undefined;
	let died: GameState | undefined;
	for (let seed = 1; seed < 40 && (!lived || !died); seed++) {
		const t = structuredClone(s);
		const k = Object.values(t.encounter!.combatants).find((x) => x.refId === npcId)!;
		k.hp = 0;
		k.dead = true;
		const r = rec();
		const out = syncCrewFromCombat(t, new Rng(seed), r.record).join(" ");
		assert.equal(r.list.length, 1);
		if (member(t, npcId).status === "dead") {
			died ??= t;
			assert.match(out, /Nico is DEAD/);
			assert.equal(t.npcs[npcId].alive, false);
		} else {
			lived ??= t;
			assert.equal(member(t, npcId).hp, 0);
			assert.match(out, /down and out of the fight but ALIVE/);
		}
	}
	assert.ok(lived && died);
	m.saveState(lived!);
	const end = await ok(id, "end_combat", { status: "fled", awardXp: false });
	assert.match(end, /Nico comes round at 1 HP/);
	assert.equal(member(m.loadState(id), npcId).hp, 1);
	const rest = await ok(id, "long_rest", {});
	assert.match(rest, /The crew rested too: Nico HP/);
	const after = m.loadState(id);
	assert.equal(member(after, npcId).hp, member(after, npcId).maxHp);
});

test("den raid: crew at the den fight too, with their own stats (even when the DM lists them), and HP/deaths persist", async () => {
	const { id, npcId } = await withMember({ gear: ["c-machete"] });
	const home = await npc(id, "Pilar");
	await ok(id, "recruit_crew", { npcId: home, classId: "cleric", role: "medic", hatPref: 0, specialty: "stitches" });
	await ok(id, "crew_status", { npcId: home, status: "at_den", why: "minding the rigs" });
	await ok(id, "draw_map", { name: "The capsule room", kind: "town", rows: ROWS });
	// Not a raid: the one at the den stays out of an ordinary fight here.
	const plain = await ok(id, "start_combat", { monsters: [{ monster: "c-ahogados-lookout", x: 10, y: 3 }] });
	assert.doesNotMatch(plain, /Pilar \[/);
	await ok(id, "end_combat", { status: "fled", awardXp: false });
	// The raid is on, on this map (raid_begin marks it before the fight starts).
	edit(id, (s) => {
		const den = denOf(s);
		den.mapId = s.activeMapId!;
		den.raidDue = { reason: "test", at: minute(s), by: "ferro", started: { at: minute(s), force: [], mapId: s.activeMapId! } };
	});
	// The DM lists Pilar as an ally with some other stat block: she fights as herself.
	const text = await ok(id, "start_combat", { monsters: [{ monster: "c-ahogados-lookout", x: 10, y: 3 }, { monster: "c-ferro-guard", npcId: home, side: "party", name: "Pilar" }], override: "raid" });
	assert.match(text, /Crew fighting beside the PC/);
	const s = m.loadState(id);
	const allies = Object.values(s.encounter!.combatants).filter((c) => c.side === "party" && c.kind === "npc");
	assert.deepEqual(allies.map((c) => c.refId).sort(), [npcId, home].sort());
	const pilar = allies.find((c) => c.refId === home)!;
	assert.equal(pilar.stats?.index, `crew-${home}`, "her crew stat block, not the DM's");
	assert.equal(pilar.maxHp, member(s, home).maxHp);
	pilar.hp = 2;
	syncCrewFromCombat(s, new Rng(1), () => undefined);
	assert.equal(member(s, home).hp, 2, "HP persists for the one at the den");
	pilar.hp = 0;
	pilar.dead = true;
	let outcome = "";
	for (let seed = 1; seed < 40 && !/DEAD/.test(outcome); seed++) {
		const t = structuredClone(s);
		outcome = syncCrewFromCombat(t, new Rng(seed), () => undefined).join(" ");
		if (/DEAD/.test(outcome)) assert.equal(member(t, home).status, "dead");
		else assert.equal(member(t, home).hp, 0);
	}
	assert.match(outcome, /Pilar is DEAD/);
});

// ─── the van ─────────────────────────────────────────────────────────────────

const NODES: NetNodeInput[] = [
	{ kind: "entry", name: "Guest wifi" },
	{ kind: "data", name: "Visitor logs", holds: "badge codes" },
];

test("the van: a runner with the PC adds +2 to node checks; no crew fight in the net", async () => {
	const { id } = await withMember({ classId: "wizard", role: "runner" });
	await ok(id, "generate_map", { kind: "tavern", name: "The capsule room" });
	const s = m.loadState(id);
	assert.equal(vanAssist(s).bonus, 0, "no run, no assist");
	jackIn(s, { target: "Lab", security: 1, body: "den", nodes: NODES }, new Rng(3));
	assert.deepEqual(vanAssist(s), { bonus: 2, who: "Nico" });
	const r = rec();
	const out = netAction(s, "Visitor logs", "access", new Rng(3), r.record);
	assert.match(out, /Nico helping from the van, \+2/);
	assert.match(r.list[0].label, /\+2 Nico in the van/);
	// A muscle-only crew doesn't assist.
	const t = structuredClone(s);
	Object.values(t.cyber!.crew!)[0].role = "muscle";
	assert.equal(vanAssist(t).bonus, 0);
	// A fight on the net map: the crew stays with the body.
	m.saveState(s);
	const fight = await ok(id, "start_combat", { monsters: [{ monster: "c-ice-watchdog" }], override: "test" });
	assert.match(fight, /is with the PC's body, not in the net/);
	const st = m.loadState(id);
	assert.ok(!Object.values(st.encounter!.combatants).some((c) => c.side === "party" && c.kind === "npc"));
});

test("the van: at trace 8 with the body onsite, muscle rolls to hold security off", async () => {
	const { id, npcId } = await withMember({ role: "muscle" });
	await ok(id, "generate_map", { kind: "tavern", name: "Basement" });
	const base = m.loadState(id);
	jackIn(base, { target: "Lab", security: 1, body: "onsite", nodes: NODES }, new Rng(3));
	let held = false;
	let broke = false;
	for (let seed = 1; seed < 60 && (!held || !broke); seed++) {
		const s = structuredClone(base);
		const r = rec();
		const out = traceTick(s, 8, "test", new Rng(seed), r.record).join("\n");
		assert.match(out, /security is dispatched/);
		assert.match(out, /THE VAN/);
		assert.ok(r.list.some((x) => /hold the body \(DC 12\)/.test(x.label)));
		const c = member(s, npcId);
		assert.ok(c.hp < c.maxHp, "they get hurt either way");
		assert.ok(c.hp >= 0 && c.status === "with_pc", "down at worst, never killed off-screen");
		if (/HOLD security off/.test(out)) held = true;
		if (/couldn't hold them/.test(out)) broke = true;
	}
	assert.ok(held && broke);
	// Nobody with the PC who can fight: just a warning line or nothing.
	const s = structuredClone(base);
	member(s, npcId).role = "face";
	assert.match(vanHoldsTheBody(s, new Rng(1), () => undefined).join(" "), /nobody there is muscle or a driver/);
});

// ─── digest, refusals, other rulesets ────────────────────────────────────────

test("digest: a crew line per member with role, style, loyalty, hat vs PC, status, HP", async () => {
	const { id } = await withMember({ hatPref: 3 });
	const d = m.digest.stateDigest(m.loadState(id));
	assert.match(d, /Crew \(max 4/);
	assert.match(d, /- Nico \[npc_\S+\] muscle, Solo 1 \[fighter\], HP \d+\/\d+, loyalty 5\/10, hat \+3 vs PC 0 \(distance 3\), with_pc/);
});

test("refusals outside Root Access; fantasy and zombie unchanged", async () => {
	for (const rs of ["fantasy", "zombie"] as const) {
		const id = newGame(rs);
		const npcId = await npc(id, "Ana");
		for (const [name, args] of [
			["recruit_crew", { npcId, classId: "fighter", role: "muscle", hatPref: 0, specialty: "x" }],
			["crew_loyalty", { npcId, delta: 1, why: "x" }],
			["crew_status", { npcId, status: "at_den", why: "x" }],
			["crew_dismiss", { npcId, why: "x" }],
		] as const) {
			const r = await call(id, name, args);
			assert.equal(r.isError, true, `${rs} ${name}`);
			assert.match(r.text, /only exists in Root Access/);
		}
		const s = m.loadState(id);
		assert.equal(s.cyber?.crew, undefined);
		assert.doesNotMatch(m.digest.stateDigest(s), /Crew \(max/);
		assert.equal(crewTick(s, new Rng(1)), undefined);
	}
	// The tool list is the same in every ruleset.
	const names = (id: string) => m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).map((t) => t.name);
	assert.deepEqual(names(newGame("fantasy")), names(newGame("cyberpunk")));
});
