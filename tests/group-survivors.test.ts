import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { GameState, InventoryItem, Survivor } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-group-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	combat: typeof import("../lib/dm/combat");
	group: typeof import("../lib/rules/group");
	budget: typeof import("../lib/rules/encounter-budget");
	digest: typeof import("../lib/dm/digest");
	client: typeof import("../lib/game/client");
	prompt: typeof import("../lib/dm/prompt");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		combat: await import("../lib/dm/combat"),
		group: await import("../lib/rules/group"),
		budget: await import("../lib/rules/encounter-budget"),
		digest: await import("../lib/dm/digest"),
		client: await import("../lib/game/client"),
		prompt: await import("../lib/dm/prompt"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };
const ROWS = ["##############", "#,,,,,,,,,,,,#", "#,@,,,,,,,,,,#", "#,,,,,,,,,,,,#", "#,,,,,,,,,,,,#", "##############"];

function newGame(zombie: boolean, classId = "fighter"): string {
	const settings = m.defaultSettings();
	if (zombie) settings.world.preset = "zombie_outbreak";
	return m.createGame({
		settings,
		seed: 7,
		character: zombie
			? { name: "Dana", speciesId: "z-origin-streetwise", classId, backgroundId: "criminal", abilities: STD }
			: { name: "Thorin", speciesId: "human", classId, backgroundId: "soldier", abilities: STD },
	}).id;
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
	return /id (\S+)\.$/.exec(text)![1];
}

const item = (ref: string, name: string, quantity = 1): InventoryItem => ({ id: `it_${ref}_${Math.random().toString(36).slice(2, 7)}`, ref, name, quantity, category: "gear" });
const count = (s: GameState, ref: string) => s.character.inventory.filter((i) => i.ref === ref).reduce((n, i) => n + i.quantity, 0);
const sv = (s: GameState, npcId: string): Survivor => s.group!.survivors[npcId];
const tx = (state: GameState, seed = 1, rolls: unknown[] = []) => ({ state, rng: new Rng(seed), roll: (r: unknown) => void rolls.push(r), fx: () => undefined });

// ─── fantasy untouched ──────────────────────────────────────────────────

test("fantasy campaigns: no companions, no extra combatants, no Group digest", async () => {
	const f = newGame(false);
	const n = await npc(f, "Bram");
	const r = await call(f, "recruit_survivor", { npcId: n, profession: "fighter", specialty: "x", traits: [] });
	assert.equal(r.isError, true);
	assert.match(r.text, /Only in The Quiet/);
	await ok(f, "draw_map", { name: "Hall", kind: "dungeon", rows: ROWS });
	const start = await ok(f, "start_combat", { monsters: [{ monster: "goblin", x: 10, y: 3 }] });
	assert.doesNotMatch(start, /Companions/);
	const s = m.loadState(f);
	assert.equal(Object.keys(s.encounter!.combatants).length, 2);
	assert.equal(s.group, undefined);
	assert.doesNotMatch(m.digest.stateDigest(s), /Group/);
});

// ─── recruiting ─────────────────────────────────────────────────────────

test("recruit_survivor: only existing NPCs; level capped at the player's; morale 5–7; digest and client secrecy", async () => {
	const z = newGame(true);
	assert.equal((await call(z, "recruit_survivor", { npcId: "npc_nobody", profession: "nurse", specialty: "x", traits: [] })).isError, true);
	const n = await npc(z, "Maria Lopez");
	const text = await ok(z, "recruit_survivor", { npcId: n, profession: "nurse", level: 5, specialty: "can stitch wounds", traits: ["calm", "hides things"] });
	assert.match(text, /Maria Lopez joins the group: Nurse 1/);
	const s = m.loadState(z);
	const v = sv(s, n);
	assert.equal(v.profession, "cleric");
	assert.equal(v.level, 1, "never above the player's level");
	assert.equal(v.status, "with_party");
	assert.ok(v.morale >= 5 && v.morale <= 7);
	assert.equal(v.hp, v.maxHp);
	assert.deepEqual(v.gear, [{ ref: "z-kitchen-knife", qty: 1 }]);
	assert.equal(s.npcs[n].disposition, "friendly");
	assert.equal((await call(z, "recruit_survivor", { npcId: n, profession: "nurse", specialty: "x", traits: [] })).isError, true, "no double recruit");
	assert.equal((await call(z, "recruit_survivor", { npcId: n, profession: "astronaut", specialty: "x", traits: [] })).isError, true);

	const d = m.digest.stateDigest(s);
	assert.match(d, /Group \(companions/);
	assert.match(d, /- Maria Lopez \[npc_\S+\] Nurse 1 \[cleric\], HP \d+\/\d+, morale \d\/10, with_party/);

	// The hour a bitten companion turns is never sent to the browser.
	v.infection = { bittenAt: 100, turnsAt: 5000, part: "left arm", stage: "incubating" };
	const c = m.client.clientState(s);
	assert.equal(c.group!.survivors[n].infection!.turnsAt, 0);
	assert.equal(s.group!.survivors[n].infection!.turnsAt, 5000, "server state untouched");
	assert.match(m.digest.stateDigest(s), /INFECTED \(incubating, left arm, ≈\d+ h left, DM only\)/);
	assert.match(m.prompt.buildSystemPrompt(s.settings), /COMPANIONS.*starts ALONE.*recruit_survivor.*at most 1–2 in the first week.*send_survivor.*TURNED/s);
	assert.doesNotMatch(m.prompt.buildSystemPrompt(m.loadState(newGame(false)).settings), /recruit_survivor/);
});

// ─── stat blocks ────────────────────────────────────────────────────────

const mk = (over: Partial<Survivor> = {}): Survivor => ({
	npcId: "npc_x", profession: "fighter", level: 1, hp: 8, maxHp: 8, morale: 6, status: "with_party", skills: [], specialty: "", traits: [], joinedAt: 0, gear: [], missedDays: 0, ...over,
});

test("survivor stat blocks: weaker than the player, under the ally cap, guns only with rounds", () => {
	const g = m.group;
	for (let lvl = 1; lvl <= 20; lvl++) assert.ok(g.survivorXp(lvl) <= m.budget.allyCap(lvl), `level ${lvl}`);
	// Two level-1 companions fit beside a level-1 player.
	assert.ok(m.budget.checkBudget(1, "normal", [50], [g.survivorXp(1), g.survivorXp(1)]).allyOk);

	for (const p of Object.keys(g.PROFESSIONS)) {
		const hp = g.survivorMaxHp(p, 1);
		assert.ok(hp >= 4 && hp <= 10, `${p} level 1 HP ${hp}`);
		const sb = g.survivorStatBlock(mk({ profession: p, maxHp: hp, hp }));
		assert.ok(sb.ac >= 10 && sb.ac <= 14);
		assert.ok(sb.actions[0].attack!.toHit <= 4, `${p} to hit ${sb.actions[0].attack!.toHit}`);
		assert.equal(sb.ruleset, "zombie");
	}
	assert.equal(g.survivorMaxHp("barbarian", 3), 3 * (7 + 1 + 2));

	const cop = mk({ profession: "paladin", gear: [{ ref: "z-police-baton", qty: 1 }, { ref: "z-pistol-9mm", qty: 1 }, { ref: "z-kevlar-vest", qty: 1 }] });
	assert.deepEqual(g.survivorStatBlock(cop).actions.map((a) => a.name), ["Police Baton"], "no rounds, no shooting");
	cop.gear.push({ ref: "z-ammo-9mm", qty: 6 });
	const sb = g.survivorStatBlock(cop);
	const gun = sb.actions.find((a) => a.name === "9mm Pistol")!;
	assert.equal(gun.usage?.times, 6);
	assert.equal(gun.attack!.toHit, 2 + 0 + 1, "prof + DEX + cop perk");
	assert.equal(sb.ac, 14, "kevlar, capped at 14");
	assert.equal(g.survivorStatBlock(mk({ profession: "cleric" })).actions.at(-1)!.name, "Patch Up");
	assert.equal(g.survivorStatBlock(mk({ profession: "monk" })).actions[0].name, "Unarmed Strike");
});

// ─── combat ─────────────────────────────────────────────────────────────

test("start_combat: companions join on side party (cap respected), sync HP and ammo, end_combat brings the downed back", async () => {
	const z = newGame(true);
	await ok(z, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	const a = await npc(z, "Ana");
	const b = await npc(z, "Ben");
	const c = await npc(z, "Cy");
	await ok(z, "recruit_survivor", { npcId: a, profession: "cop", specialty: "shoots straight", traits: ["steady"], gear: [{ ref: "z-pistol-9mm", qty: 1 }, { ref: "z-ammo-9mm", qty: 3 }] });
	await ok(z, "recruit_survivor", { npcId: b, profession: "firefighter", specialty: "strong", traits: ["loud"] });
	await ok(z, "recruit_survivor", { npcId: c, profession: "athlete", specialty: "fast", traits: ["young"] });
	const start = await ok(z, "start_combat", { monsters: [{ monster: "z-shambler", x: 10, y: 3 }] });
	assert.match(start, /Companions fighting beside the player \(side party\): Ana \[sv-ana-\w+\], Ben \[sv-ben-\w+\]/);
	assert.match(start, /Not fighting: Cy \(hangs back/);
	let s = m.loadState(z);
	const enc = s.encounter!;
	const ana = Object.values(enc.combatants).find((x) => x.refId === a)!;
	assert.equal(ana.side, "party");
	assert.equal(ana.kind, "npc");
	assert.equal(ana.maxHp, sv(s, a).maxHp);
	const ent = s.maps[enc.mapId].entities.find((e) => e.id === ana.entityId)!;
	assert.equal(ent.npcId, a, "token linked to the NPC");
	const pc = s.maps[enc.mapId].entities.find((e) => e.kind === "pc")!;
	assert.ok(Math.max(Math.abs(ent.x - pc.x), Math.abs(ent.y - pc.y)) <= 2, "placed next to the player");

	// Ana shoots the shambler on her turn (DM plays her): a round is spent, the gun is loud.
	const zombie = Object.values(enc.combatants).find((x) => x.stats?.index === "z-shambler")!;
	edit(z, (st) => {
		const e = st.encounter!;
		e.turnIndex = e.order.indexOf(ana.id);
		Object.assign(e.combatants[ana.id].turn, { action: true, movementLeft: 30 });
	});
	const shot = await ok(z, "monster_turn", { combatantId: ana.id, actionName: "9mm Pistol", targetIds: [zombie.id] });
	assert.match(shot, /Noise \+3/);
	s = m.loadState(z);
	assert.equal(s.group!.survivors[a].gear.find((g) => g.ref === "z-ammo-9mm")?.qty, 2);

	// Damage syncs back to the Survivor.
	await ok(z, "apply_damage", { targetId: ana.id, amount: "2", reason: "test" });
	s = m.loadState(z);
	assert.equal(sv(s, a).hp, sv(s, a).maxHp - 2);

	// Ben goes down (a non-bite blow): the engine rolls whether he lives.
	const ben = Object.values(s.encounter!.combatants).find((x) => x.refId === b)!;
	const out = await ok(z, "apply_damage", { targetId: ben.id, amount: "99", reason: "a car falls" });
	assert.match(out, /Ben (drops \(d20 \d+\): down .* ALIVE|is DEAD)/);
	s = m.loadState(z);
	const benAlive = sv(s, b).status === "with_party";
	const end = await ok(z, "end_combat", { status: "ended", reason: "they slip away" });
	s = m.loadState(z);
	if (benAlive) {
		assert.match(end, /Ben comes round at 1 HP/);
		assert.equal(sv(s, b).hp, 1);
		assert.notEqual(s.maps[enc.mapId].entities.find((e) => e.npcId === b)!.dead, true);
	} else {
		assert.equal(sv(s, b).status, "dead");
		assert.equal(s.npcs[b].alive, false);
		assert.ok(sv(s, a).morale <= 5, "the others are shaken");
	}
});

function biteOn(st: GameState, targetId: string, damage = 3) {
	const enc = st.encounter!;
	const attacker = Object.values(enc.combatants).find((c) => c.stats?.index === "z-shambler")!;
	const t = enc.combatants[targetId];
	t.hp = Math.max(0, t.hp - damage);
	if (t.hp === 0) t.dead = true;
	return {
		ok: true, encounter: enc, map: st.maps[enc.mapId], character: st.character, rolls: [], log: [`${attacker.name} bites.`],
		events: [
			{ type: "attack" as const, attackerId: attacker.id, targetId, name: "Bite", hit: true, crit: false, rollId: "r" },
			{ type: "damage" as const, targetId, amount: damage, sourceId: attacker.id, hpAfter: t.hp },
			...(t.dead ? [{ type: "death" as const, targetId }] : []),
		],
	};
}

test("a zombie bite on a companion: CON save, secret clock, fever, and they TURN (DM told to bring them back as the dead)", async () => {
	const z = newGame(true);
	await ok(z, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	const n = await npc(z, "Tomas");
	await ok(z, "recruit_survivor", { npcId: n, profession: "farmer", specialty: "knows the woods", traits: ["quiet"] });
	await ok(z, "start_combat", { monsters: [{ monster: "z-shambler", x: 10, y: 3 }] });
	let infected: GameState | undefined;
	for (let seed = 1; seed < 80 && !infected; seed++) {
		const st = m.loadState(z);
		const tomas = Object.values(st.encounter!.combatants).find((x) => x.refId === n)!;
		const rolls: { label: string; target?: number }[] = [];
		const out = m.combat.applyCombatResult(tx(st, seed, rolls) as never, biteOn(st, tomas.id));
		assert.equal(rolls.length, 1);
		assert.match(rolls[0].label, /Tomas: CON save vs infection \(Shambler\)/);
		assert.equal(rolls[0].target, 12);
		if (sv(st, n).infection) {
			infected = st;
			assert.match(out, /Tomas is INFECTED with LAZARUS/);
		} else assert.match(out, /SUCCESS\. Not infected/);
	}
	assert.ok(infected, "some seed fails the save");
	const v = sv(infected!, n);
	const hours = (v.infection!.turnsAt - v.infection!.bittenAt) / 60;
	assert.ok(hours >= 24 && hours <= 72);
	infected!.encounter = undefined;
	m.saveState(infected!);
	// Half-way: fever or delirium; at the end: turned.
	await ok(z, "advance_time", { minutes: Math.ceil(hours * 30) });
	assert.match(sv(m.loadState(z), n).infection!.stage, /fever|delirium/);
	const turned = await ok(z, "advance_time", { hours: Math.ceil(hours) });
	assert.match(turned, /Tomas died of the LAZARUS infection and TURNED, right there.*z-fresh-turned/);
	const s = m.loadState(z);
	assert.equal(sv(s, n).status, "turned");
	assert.equal(s.npcs[n].alive, false);
	assert.ok(s.dmNotes.some((d) => /TURNED/.test(d)));
});

test("a companion killed by a bite skips the save and turns within minutes", async () => {
	const z = newGame(true);
	await ok(z, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	const n = await npc(z, "Lena");
	await ok(z, "recruit_survivor", { npcId: n, profession: "teacher", specialty: "chemistry", traits: ["brave"] });
	await ok(z, "start_combat", { monsters: [{ monster: "z-shambler", x: 10, y: 3 }] });
	const st = m.loadState(z);
	const lena = Object.values(st.encounter!.combatants).find((x) => x.refId === n)!;
	const rolls: unknown[] = [];
	const out = m.combat.applyCombatResult(tx(st, 1, rolls) as never, biteOn(st, lena.id, 99));
	assert.equal(rolls.length, 0, "no save for the dead");
	assert.match(out, /Lena was bitten .* as they fell/);
	assert.match(out, /TURNED.*z-fresh-turned/);
	assert.equal(sv(st, n).status, "turned");
});

// ─── errands ────────────────────────────────────────────────────────────

test("errands: risk scales with hours, day and night; resolution is deterministic and lands loot", async () => {
	const g = m.group;
	const z = newGame(true);
	const n = await npc(z, "Rook");
	await ok(z, "recruit_survivor", { npcId: n, profession: "rogue", specialty: "locks", traits: ["greedy"] });
	const s = m.loadState(z);
	const v = sv(s, n);
	const noon = 3 * 1440 + 12 * 60;
	const r1 = g.errandRisk({ ...s, time: { day: 0, hour: 12, minute: 0 } } as GameState, v, "scavenge", noon, noon + 60);
	const r2 = g.errandRisk({ ...s, time: { day: 20, hour: 12, minute: 0 } } as GameState, v, "scavenge", noon, noon + 8 * 60);
	const r3 = g.errandRisk({ ...s, time: { day: 20, hour: 12, minute: 0 } } as GameState, v, "scavenge", noon + 9 * 60, noon + 17 * 60);
	assert.ok(r1 < r2 && r2 < r3, `${r1} < ${r2} < ${r3}`);
	assert.equal(g.errandRisk(s, { ...v, profession: "fighter" }, "guard", noon, noon + 60), 0);

	// Away, then back when the clock passes `until`.
	edit(z, (st) => (st.time = { day: 1, hour: 10, minute: 0 }));
	assert.match(await ok(z, "send_survivor", { npcId: n, task: "scavenge", hours: 3 }), /Rook sets out to scavenge for 3 h/);
	assert.equal(sv(m.loadState(z), n).status, "away");
	assert.match(m.digest.stateDigest(m.loadState(z)), /away \(scavenge until day 1 13:00\)/);
	assert.equal((await call(z, "send_survivor", { npcId: n, task: "scout", hours: 2 })).isError, true, "already away");
	const back = await ok(z, "advance_time", { hours: 4 });
	assert.match(back, /ERRAND \(Rook, scavenge, 3 h, risk \d+%\)/);

	// Same seed, same story: resolution is deterministic.
	const add = () => (s2: GameState, it: { name: string; ref: string; quantity: number }) => void s2.character.inventory.push(item(it.ref, it.name, it.quantity));
	const runs = [1, 2].map(() => {
		const st = m.loadState(z);
		const x = sv(st, n);
		x.status = "away";
		x.away = { until: 2000, task: "scavenge", startedAt: 1700, from: "with_party" };
		return { text: g.resolveErrand(st, new Rng(42), x, add()), inv: st.character.inventory.map((i) => `${i.ref}:${i.quantity}`).join(",") };
	});
	assert.deepEqual(runs[0], runs[1]);

	// Over many seeds every outcome happens: loot, a bite, never coming back.
	const seen = new Set<string>();
	for (let seed = 1; seed < 400; seed++) {
		const st = m.loadState(z);
		st.time = { day: 25, hour: 23, minute: 0 };
		const x = sv(st, n);
		x.status = "away";
		x.away = { until: 25 * 1440 + 23 * 60, task: "scavenge", startedAt: 25 * 1440 + 11 * 60, from: "with_party" };
		const before = st.character.inventory.length;
		const text = g.resolveErrand(st, new Rng(seed), x, add());
		if (/NEVER CAME BACK/.test(text)) {
			seen.add("gone");
			assert.equal(x.status, "dead");
		} else if (/BITTEN.*INFECTED/.test(text)) {
			seen.add("bitten");
			assert.ok(x.infection);
		} else if (st.character.inventory.length > before) seen.add("loot");
	}
	assert.deepEqual([...seen].sort(), ["bitten", "gone", "loot"]);
});

test("errand finds go into the base stock when there is a base", async () => {
	const z = newGame(true);
	const n = await npc(z, "Wade");
	await ok(z, "recruit_survivor", { npcId: n, profession: "hunter", specialty: "rifle", traits: ["patient"] });
	const st = m.loadState(z);
	st.group!.base = { name: "The Mill", locationId: "here", fortification: 2, stock: { food: 0, water: 0, meds: 0, ammo: 0, fuel: 0, materials: 0 }, upgrades: [], lastTick: 0, log: [] };
	let found = false;
	for (let seed = 1; seed < 50 && !found; seed++) {
		const s = structuredClone(st);
		const x = sv(s, n);
		x.status = "away";
		x.away = { until: 2 * 1440 + 14 * 60, task: "fetch_water", startedAt: 2 * 1440 + 10 * 60, from: "with_party" };
		const text = m.group.resolveErrand(s, new Rng(seed), x, () => assert.fail("water goes to the stock"));
		if (s.group!.base!.stock.water > 0) {
			found = true;
			assert.match(text, /into the base stock: \d+ water/);
			assert.equal(s.group!.base!.log.length, 1);
		}
	}
	assert.ok(found);
});

// ─── daily needs and morale ─────────────────────────────────────────────

test("08:00: companions eat after the player; short days cost morale; at 0 they leave, the volatile steal", async () => {
	const z = newGame(true);
	const a = await npc(z, "Ivy");
	const b = await npc(z, "Gus");
	await ok(z, "recruit_survivor", { npcId: a, profession: "nurse", specialty: "x", traits: ["kind"] });
	await ok(z, "recruit_survivor", { npcId: b, profession: "ex-con", specialty: "x", traits: ["desperate", "hothead"] });
	edit(z, (s) => {
		s.time = { day: 2, hour: 7, minute: 0 };
		s.character.inventory = s.character.inventory.filter((i) => !["z-canned-food", "z-bottled-water", "z-preserves", "z-bandage"].includes(i.ref ?? ""));
		s.character.inventory.push(item("z-canned-food", "Canned Food", 2), item("z-bottled-water", "Bottled Water", 2), item("z-bandage", "Bandage", 1));
		s.survival!.lastTick = 2 * 1440 + 7 * 60;
		s.group!.lastTick = 2 * 1440 + 7 * 60;
		sv(s, a).morale = 3;
		sv(s, b).morale = 1;
	});
	const out = await ok(z, "advance_time", { hours: 2 });
	let s = m.loadState(z);
	// The player ate one of each, Ivy (joined first) the other: Gus went without.
	assert.equal(count(s, "z-canned-food"), 0);
	assert.equal(count(s, "z-bottled-water"), 0);
	assert.equal(sv(s, a).missedDays, 0);
	assert.equal(sv(s, a).morale, 3);
	assert.match(out, /Gus went without food and water/);
	assert.match(out, /MORALE BROKEN: Gus .* STEALS supplies: Bandage/);
	assert.equal(sv(s, b).status, "left");
	assert.equal(s.npcs[b].disposition, "hostile");
	assert.equal(count(s, "z-bandage"), 0);

	// Ivy: a day without, morale 3 → 2; then two more → 0 and she leaves, quietly.
	await ok(z, "advance_time", { days: 1 });
	s = m.loadState(z);
	assert.equal(sv(s, a).missedDays, 1);
	assert.equal(sv(s, a).morale, 2);
	const gone = await ok(z, "advance_time", { days: 2 });
	assert.match(gone, /MORALE BROKEN: Ivy has had enough and LEAVES/);
	assert.equal(m.loadState(z).group!.survivors[a].status, "left");
});

test("at the base companions eat from the stock; long rest heals companions with the party", async () => {
	const z = newGame(true);
	const n = await npc(z, "Pia");
	await ok(z, "recruit_survivor", { npcId: n, profession: "athlete", specialty: "x", traits: ["cheerful"] });
	edit(z, (s) => {
		s.group!.base = { name: "Church", locationId: "here", fortification: 3, stock: { food: 2, water: 1, meds: 0, ammo: 0, fuel: 0, materials: 0 }, upgrades: [], lastTick: 0, log: [] };
		sv(s, n).status = "at_base";
		s.time = { day: 2, hour: 7, minute: 0 };
		s.survival!.lastTick = s.group!.lastTick = 2 * 1440 + 7 * 60;
	});
	await ok(z, "advance_time", { days: 1, hours: 2 });
	const s = m.loadState(z);
	assert.equal(s.group!.base!.stock.food, 0);
	assert.equal(s.group!.base!.stock.water, 0);
	assert.equal(sv(s, n).missedDays, 1, "the second day there was no water left");

	edit(z, (st) => {
		sv(st, n).status = "with_party";
		sv(st, n).hp = 1;
	});
	// Interruptions are rolled; some seed lets the rest complete.
	let done = false;
	for (let seed = 1; seed < 20 && !done; seed++) {
		edit(z, (st) => (st.rng = seed));
		const rest = await ok(z, "long_rest", { secured: true });
		if (!/Long rest complete/.test(rest)) continue;
		done = true;
		assert.match(rest, /Companions rested too: Pia HP (\d+)\/\1/);
	}
	assert.ok(done);
});

test("on a companion's turn the engine's tactics attack the dead, not the player", async () => {
	const z = newGame(true);
	await ok(z, "draw_map", { name: "Alley", kind: "town", rows: ROWS });
	const n = await npc(z, "Kit");
	await ok(z, "recruit_survivor", { npcId: n, profession: "firefighter", specialty: "x", traits: ["brave"] });
	await ok(z, "start_combat", { monsters: [{ monster: "z-shambler", x: 5, y: 3 }] });
	edit(z, (st) => {
		const e = st.encounter!;
		const kit = Object.values(e.combatants).find((x) => x.refId === n)!;
		e.turnIndex = e.order.indexOf(kit.id);
		Object.assign(kit.turn, { action: true, movementLeft: 30 });
	});
	const kit = Object.values(m.loadState(z).encounter!.combatants).find((x) => x.refId === n)!;
	const out = await ok(z, "monster_turn", { combatantId: kit.id, auto: true });
	assert.match(out, /Kit .*(Fire Axe|dashes)/);
	assert.doesNotMatch(out, /Fire Axe.*Dana/);
	assert.equal(m.loadState(z).character.hp, m.loadState(z).character.maxHp);
});

test("update_survivor: morale deltas, gear hand-offs, death; dismiss_survivor", async () => {
	const z = newGame(true, "paladin");
	const n = await npc(z, "Ray");
	await ok(z, "recruit_survivor", { npcId: n, profession: "soldier", specialty: "x", traits: ["loyal"], gear: [{ ref: "z-pistol-9mm", qty: 1 }] });
	const before = sv(m.loadState(z), n).morale;
	assert.match(await ok(z, "update_survivor", { npcId: n, morale: 2, note: "saved from the bus" }), new RegExp(`morale ${before} → ${Math.min(10, before + 2)}/10`));
	edit(z, (s) => s.character.inventory.push(item("z-ammo-9mm", "9mm Rounds", 10)));
	assert.match(await ok(z, "update_survivor", { npcId: n, give: { ref: "z-ammo-9mm", qty: 4 } }), /Gave Ray 4 × 9mm Rounds/);
	let s = m.loadState(z);
	assert.equal(sv(s, n).gear.find((g) => g.ref === "z-ammo-9mm")?.qty, 4);
	assert.ok(m.group.survivorStatBlock(sv(s, n)).actions.some((x) => x.name === "9mm Pistol"));
	await ok(z, "update_survivor", { npcId: n, take: { ref: "z-ammo-9mm", qty: 4 } });
	s = m.loadState(z);
	assert.equal(sv(s, n).gear.some((g) => g.ref === "z-ammo-9mm"), false);
	assert.match(await ok(z, "update_survivor", { npcId: n, hp: -3 }), /Ray HP/);
	assert.match(await ok(z, "dismiss_survivor", { npcId: n, reason: "parted at the bridge" }), /Ray leaves the group/);
	assert.equal(sv(m.loadState(z), n).status, "left");
	assert.equal((await call(z, "update_survivor", { npcId: n, morale: 1 })).isError, true);
});
