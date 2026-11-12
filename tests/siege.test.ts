import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";
import type { GameState, Npc, RollRecord, Survivor } from "../lib/game/types";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-siege-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	siege: typeof import("../lib/rules/siege");
	base: typeof import("../lib/rules/base");
	town: typeof import("../lib/rules/town");
	digest: typeof import("../lib/dm/digest");
	prompt: typeof import("../lib/dm/prompt");
	client: typeof import("../lib/game/client");
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
		siege: await import("../lib/rules/siege"),
		base: await import("../lib/rules/base"),
		town: await import("../lib/rules/town"),
		digest: await import("../lib/dm/digest"),
		prompt: await import("../lib/dm/prompt"),
		client: await import("../lib/game/client"),
		en: (await import("../lib/i18n/en")).en,
		es: (await import("../lib/i18n/es")).es,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };

function newGame(zombie: boolean): string {
	const settings = m.defaultSettings();
	settings.dm.fights = "turns"; // these tests play fights turn by turn (the default is automatic)
	if (zombie) settings.world.preset = "zombie_outbreak";
	return m.createGame({
		settings,
		character: zombie
			? { name: "Dana", speciesId: "z-origin-streetwise", classId: "fighter", backgroundId: "criminal", abilities: STD }
			: { name: "Thorin", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: STD },
	}).id;
}

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}

/** Two ways in: an outer door on the top edge (4,0) and the front door (4,4), barricaded with furniture. */
const ROWS = ["####+#####", "#........#", "#.@......#", "#........#", "####+#####", "----------"];

const npc = (id: string, name: string): Npc => ({ id, name, role: "survivor", disposition: "friendly", description: "", alive: true, portrait: {} as Npc["portrait"] });
const companion = (id: string, status: Survivor["status"], joinedAt = 0, level = 1): Survivor => ({ npcId: id, profession: "fighter", level, hp: 10, maxHp: 10, morale: 5, status, skills: [], specialty: "", traits: [], joinedAt, gear: [{ ref: "z-crowbar", qty: 1 }], missedDays: 0 });

/** A zombie game at a claimed base with a map (door at (4,0), furniture barricade at (4,4)). */
async function atBase(opts: { day?: number; hour?: number } = {}): Promise<string> {
	const z = newGame(true);
	edit(z, (s) => {
		s.time = { day: opts.day ?? 3, hour: 12, minute: 0 };
		s.scene.weather = "clear";
	});
	const d = await call(z, "draw_map", { name: "Hale's Pharmacy", kind: "town", rows: ROWS });
	assert.notEqual(d.isError, true, d.text);
	const c = await call(z, "claim_base", { name: "the pharmacy" });
	assert.notEqual(c.isError, true, c.text);
	const b = await call(z, "build_barricade", { x: 4, y: 4, material: "furniture" });
	assert.notEqual(b.isError, true, b.text);
	edit(z, (s) => {
		s.time = { day: opts.day ?? 3, hour: opts.hour ?? 12, minute: 0 };
		s.survival!.lastTick = s.time.day * 1440 + s.time.hour * 60;
		// No stray town horde (the game's seed is random) wanders into these tests.
		s.siege = undefined;
		if (s.town) s.town.hordes = [];
	});
	return z;
}

const mins = (s: GameState) => s.time.day * 1440 + s.time.hour * 60 + s.time.minute;
const noRecord = () => undefined;

// ─── start ──────────────────────────────────────────────────────────────

test("start_siege: zombie only, needs a base map; warning by night, dusk by day; upgrades buy prep time; one at a time", async () => {
	const f = newGame(false);
	assert.equal((await call(f, "start_siege", { horde: 20 })).isError, true);
	const bare = newGame(true);
	assert.match((await call(bare, "start_siege", { horde: 20 })).text, /no base/);

	const z = await atBase({ hour: 23 });
	const r = await call(z, "start_siege", { horde: 30 });
	assert.notEqual(r.isError, true, r.text);
	assert.match(r.text, /SIEGE WARNING/);
	assert.match(r.text, /\(4,4\) barricade 15\/15/);
	assert.match(r.text, /\(4,0\) door 10\/10/);
	let s = m.loadState(z);
	assert.equal(s.siege!.phase, "warning");
	assert.equal(s.siege!.arrivesAt - mins(s), 10, "no upgrades: 10 minutes of warning");
	assert.equal(s.siege!.waves, 4);
	assert.equal((await call(z, "start_siege", { horde: 10 })).isError, true, "one siege at a time");

	// Watchtower + alarm cans: 70 minutes.
	const z2 = await atBase({ hour: 23 });
	edit(z2, (x) => x.group!.base!.upgrades.push("watchtower", "alarm_cans"));
	await call(z2, "start_siege", { horde: 30 });
	s = m.loadState(z2);
	assert.equal(s.siege!.arrivesAt - mins(s), 70);
	// The DM's lead time plus the upgrades.
	const z3 = await atBase({ hour: 23 });
	edit(z3, (x) => x.group!.base!.upgrades.push("alarm_cans"));
	await call(z3, "start_siege", { horde: 30, arrivesInMinutes: 15 });
	s = m.loadState(z3);
	assert.equal(s.siege!.arrivesAt - mins(s), 35);

	// By day they come at dusk (21:00-22:30).
	const z4 = await atBase({ hour: 12 });
	await call(z4, "start_siege", { horde: 30 });
	s = m.loadState(z4);
	const at = s.siege!.arrivesAt % 1440;
	assert.ok(at >= 21 * 60 && at <= 22 * 60 + 30, `dusk ${at}`);
	assert.equal(Math.floor(s.siege!.arrivesAt / 1440), s.time.day);
});

test("a big dawn probe turns into a siege that night; a town horde reaching the base starts one", async () => {
	const z = await atBase({ day: 24, hour: 8 });
	// (Catching the town up to day 24 may already have sent a horde to the base.)
	const s = edit(z, (x) => (x.siege = undefined));
	let found = false;
	for (let seed = 1; seed < 400 && !found; seed++) {
		const c = structuredClone(s);
		const ev = m.base.rollBaseEvent(c, new Rng(seed));
		if (ev.kind !== "horde_probe") continue;
		found = true;
		assert.ok(c.siege, "outbreak day 24: the probe is big enough");
		assert.equal(c.siege!.source, "probe");
		assert.match(ev.text, /vanguard/);
		assert.match(ev.text, /z-(shambler|fresh-turned|crawler|runner|bloater|screamer|riot-dead|brute)/);
		const at = c.siege!.arrivesAt % 1440;
		assert.ok(at >= 21 * 60 && at <= 22 * 60 + 30);
		assert.equal(c.group!.base!.log.at(-1)!.kind, "event.horde_probe");
	}
	assert.ok(found);

	// Town: a horde next door, heading for the base, finally arrives.
	const t = await atBase({ day: 4, hour: 12 });
	await call(t, "advance_time", { minutes: 1 }); // seeds the town
	const st = edit(t, (x) => (x.siege = undefined));
	const baseLoc = st.group!.base!.locationId;
	const next = st.world.routes.find((r) => r.from === baseLoc || r.to === baseLoc)!;
	const from = next.from === baseLoc ? next.to : next.from;
	let started: GameState | undefined;
	for (let seed = 1; seed < 200 && !started; seed++) {
		const c = structuredClone(st);
		c.town!.hordes = [{ id: "hx", size: 25, at: from, heading: baseLoc, nextMoveAt: mins(c) - 1, known: false }];
		c.town!.lastTick = mins(c) - 2;
		c.time.minute += 1;
		const note = m.town.townTick(c, new Rng(seed));
		if (c.siege) {
			started = c;
			assert.match(note ?? "", /A HORDE REACHED THE BASE[\s\S]*SIEGE WARNING/);
		}
	}
	assert.ok(started, "the horde reached the base");
	assert.equal(started!.siege!.source, "town");
	assert.equal(started!.siege!.hordeId, "hx");
	assert.equal(started!.siege!.horde, started!.town!.hordes.find((h) => h.id === "hx")!.size, "the horde as it arrived");
});

// ─── prep ───────────────────────────────────────────────────────────────

test("prep: posts only on ways in, two per post, companions who can defend; lights need the generator", async () => {
	const z = await atBase({ hour: 23 });
	edit(z, (s) => {
		s.npcs.ana = npc("ana", "Ana");
		s.npcs.bo = npc("bo", "Bo");
		s.npcs.cy = npc("cy", "Cy");
		s.npcs.dee = npc("dee", "Dee");
		s.group!.survivors.ana = companion("ana", "at_base", 1);
		s.group!.survivors.bo = companion("bo", "with_party", 2);
		s.group!.survivors.cy = companion("cy", "at_base", 3);
		s.group!.survivors.dee = { ...companion("dee", "away", 4), away: { until: 99999, task: "scout" } };
	});
	await call(z, "start_siege", { horde: 20 });
	assert.match((await call(z, "siege_defence", { posts: [{ who: "pc", x: 2, y: 2 }] })).text, /isn't a way in/);
	assert.match((await call(z, "siege_defence", { posts: [{ who: "Dee", x: 4, y: 4 }] })).text, /can't defend/);
	assert.match((await call(z, "siege_defence", { posts: [{ who: "nobody", x: 4, y: 4 }] })).text, /No companion/);
	const ok = await call(z, "siege_defence", { posts: [{ who: "pc", x: 4, y: 4 }, { who: "Ana", x: 4, y: 4 }, { who: "bo", x: 4, y: 0 }] });
	assert.notEqual(ok.isError, true, ok.text);
	assert.match((await call(z, "siege_defence", { posts: [{ who: "Cy", x: 4, y: 4 }] })).text, /two at most/);
	let s = m.loadState(z);
	assert.equal(s.siege!.phase, "prep");
	assert.deepEqual(s.siege!.posts, { pc: { x: 4, y: 4 }, ana: { x: 4, y: 4 }, bo: { x: 4, y: 0 } });
	// Off the post.
	await call(z, "siege_defence", { posts: [{ who: "Ana" }] });
	s = m.loadState(z);
	assert.equal(s.siege!.posts.ana, undefined);
	// Lights: no generator, then a generator with fuel.
	assert.match((await call(z, "siege_defence", { lights: true })).text, /no generator/);
	edit(z, (x) => {
		x.group!.base!.upgrades.push("generator");
		x.group!.base!.generatorOn = true;
		x.group!.base!.stock.fuel = 2;
	});
	assert.match((await call(z, "siege_defence", { lights: true })).text, /Lights ON/);
	assert.equal(m.loadState(z).siege!.lights, true);
});

// ─── waves ──────────────────────────────────────────────────────────────

test("waves are deterministic for a seed, spend stock, advance the clock and record rolls", async () => {
	const z = await atBase({ hour: 23 });
	edit(z, (s) => (s.group!.base!.stock.ammo = 20));
	await call(z, "start_siege", { horde: 30 });
	await call(z, "siege_defence", { posts: [{ who: "pc", x: 4, y: 4 }] });
	const s = m.loadState(z);
	const run = () => {
		const c = structuredClone(s);
		const rolls: RollRecord[] = [];
		const r = m.siege.resolveWave(c, new Rng(1234), (x) => rolls.push(x), { action: "shoot" });
		return { c, r, rolls };
	};
	const a = run(), b = run();
	assert.equal(a.r.text, b.r.text);
	assert.deepEqual(a.c.siege, b.c.siege);
	assert.deepEqual(a.c.maps, b.c.maps);
	assert.deepEqual(a.rolls.map((r) => [r.label, r.total]), b.rolls.map((r) => [r.label, r.total]));
	// The first wave starts the night at the arrival time and takes 45 minutes.
	assert.equal(a.r.first, true);
	assert.equal(a.c.siege!.phase === "active" || a.c.siege!.phase === "over", true);
	assert.equal(mins(a.c), s.siege!.arrivesAt + m.siege.SIEGE.waveMinutes);
	assert.equal(a.c.siege!.wave, 1);
	// The player's shots come out of the base's ammo and are in the dice log as theirs.
	const shots = a.rolls.filter((r) => r.actor === a.c.character.id && /Hunting Rifle/.test(r.label));
	assert.ok(shots.length >= 3, "a level-1 fighter gets 3 shots a wave");
	assert.equal(a.c.group!.base!.stock.ammo, 20 - shots.length);
	assert.equal(a.c.siege!.stats!.ammo, shots.length);
	// Those put down leave the horde, and so do any who poured through a breach.
	const poured = a.r.breach?.spawn.reduce((n, sp) => n + sp.count, 0) ?? 0;
	assert.equal(a.c.siege!.horde, 30 - a.c.siege!.last!.pcKills - a.c.siege!.last!.allyKills - poured);
});

test("a guarded way in takes less than an unguarded one", async () => {
	const z = await atBase({ hour: 23 });
	edit(z, (s) => {
		s.maps[s.group!.base!.mapId!].barricades!["4,4"] = { hp: 200, max: 200 };
	});
	await call(z, "start_siege", { horde: 40 });
	const s = m.loadState(z);
	let guarded = 0, open = 0;
	for (let seed = 1; seed <= 150; seed++) {
		const g = structuredClone(s);
		g.siege!.posts.pc = { x: 4, y: 4 };
		m.siege.resolveWave(g, new Rng(seed), noRecord, { action: "hold" });
		guarded += g.siege!.last!.damage["4,4"] ?? 0;
		const u = structuredClone(s);
		m.siege.resolveWave(u, new Rng(seed), noRecord, {});
		open += u.siege!.last!.damage["4,4"] ?? 0;
	}
	assert.ok(guarded * 2 < open, `guarded ${guarded} vs unguarded ${open}`);
});

test("the player stays the protagonist: companions roll within the ally cap and never lead the player's kills by more than 2", async () => {
	const z = await atBase({ hour: 23 });
	edit(z, (s) => {
		for (const [i, id] of ["ana", "bo", "cy", "dee"].entries()) {
			s.npcs[id] = npc(id, id.toUpperCase());
			// Level 3 companions are worth 25 XP each: a level-1 player's ally cap (50) fits two.
			s.group!.survivors[id] = companion(id, "at_base", i, 3);
		}
		s.maps[s.group!.base!.mapId!].barricades!["4,4"] = { hp: 500, max: 500 };
		s.group!.base!.stock.materials = 10;
		s.siege = undefined;
	});
	await call(z, "start_siege", { horde: 120 });
	await call(z, "siege_defence", { posts: [{ who: "pc", x: 4, y: 4 }, { who: "ana", x: 4, y: 4 }, { who: "bo", x: 4, y: 0 }, { who: "cy", x: 4, y: 0 }] });
	const s = m.loadState(z);
	let pc = 0, allies = 0;
	for (let seed = 1; seed <= 60; seed++) {
		const c = structuredClone(s);
		c.maps[c.group!.base!.mapId!].tiles[4] = "barricade";
		c.maps[c.group!.base!.mapId!].barricades!["4,0"] = { hp: 500, max: 500 };
		const rolls: RollRecord[] = [];
		for (let w = 0; w < 4 && c.siege!.phase !== "over"; w++) {
			// The player repairs on wave 2: they kill nothing, the companions still can't run away with the night.
			m.siege.resolveWave(c, new Rng(seed * 10 + w), (x) => rolls.push(x), { action: w === 1 ? "repair" : "hack" });
			assert.ok(c.siege!.stats!.allyKills <= c.siege!.stats!.pcKills + m.siege.SIEGE.allyEdge, "allies never far ahead");
		}
		// At most two companions attack in a wave (the first standing ones by joining order); the third braces the post.
		const attacks = rolls.filter((r) => /^Siege wave \d+: [A-Z]{2,3},/.test(r.label));
		for (let w = 1; w <= 4; w++) {
			const who = new Set(attacks.filter((r) => r.label.startsWith(`Siege wave ${w}:`)).map((r) => r.label.split(": ")[1].split(",")[0]));
			assert.ok(who.size <= 2, [...who].join());
			if (c.group!.survivors.ana.hp > 0 && c.group!.survivors.bo.hp > 0) assert.ok(!who.has("CY"));
		}
		assert.ok(attacks.some((r) => /: ANA,/.test(r.label)));
		pc += c.siege!.stats!.pcKills;
		allies += c.siege!.stats!.allyKills;
	}
	assert.ok(pc > allies, `player ${pc} vs companions ${allies}`);
	// Companions on posts stood with the party for the night.
	const c = structuredClone(s);
	m.siege.resolveWave(c, new Rng(1), noRecord, { action: "hack" });
	assert.equal(c.group!.survivors.ana.status, "with_party");
	assert.deepEqual(c.siege!.joined?.sort(), ["ana", "bo", "cy"]);
	assert.equal(c.group!.survivors.dee.status, "at_base");
});

// ─── breach ─────────────────────────────────────────────────────────────

test("a breach starts a real fight at the gap (within the budget); held, the gap is jammed and the night goes on", async () => {
	const z = await atBase({ hour: 23 });
	edit(z, (s) => {
		const map = s.maps[s.group!.base!.mapId!];
		map.barricades!["4,4"] = { hp: 1, max: 15 };
		map.tiles[4] = "barricade";
		map.barricades!["4,0"] = { hp: 1, max: 15 };
	});
	await call(z, "start_siege", { horde: 30 });
	const r = await call(z, "siege_wave", {});
	assert.notEqual(r.isError, true, r.text);
	assert.match(r.text, /BREACH/);
	assert.match(r.text, /BREACH FIGHT STARTED/);
	let s = m.loadState(z);
	assert.equal(s.encounter?.status, "active");
	const dead = Object.values(s.encounter!.combatants).filter((c) => c.side === "enemy");
	assert.ok(dead.length >= 1 && dead.length <= 2, `level 1, normal: ${dead.length}`);
	assert.ok(dead.every((c) => c.stats?.index === "z-shambler"));
	assert.ok(s.siege!.breach?.combat);
	assert.equal(s.maps[s.group!.base!.mapId!].tiles[s.siege!.breach!.y * 10 + s.siege!.breach!.x], "rubble");
	assert.equal((await call(z, "siege_wave", {})).isError, true, "no next wave mid-fight");
	// The player wins: the breach is contained and jammed.
	const br = { ...s.siege!.breach! };
	// The dead are cut down where they came through (on the gap itself, as tokens are placed there first).
	edit(z, (x) => {
		for (const c of Object.values(x.encounter!.combatants)) if (c.side === "enemy") {
			c.dead = true;
			c.hp = 0;
			const e = x.maps[x.encounter!.mapId].entities.find((y) => y.id === c.entityId);
			if (e) {
				e.x = br.x;
				e.y = br.y;
			}
		}
		x.encounter!.status = "victory";
	});
	assert.doesNotMatch((await call(z, "journal_note", { text: "They held." })).text, /CONTAINED/, "settles only once end_combat clears the fight");
	const end = await call(z, "end_combat", { status: "victory" });
	assert.match(end.text, /CONTAINED/);
	s = m.loadState(z);
	assert.equal(s.siege!.breach, undefined);
	assert.deepEqual(s.siege!.breaches?.[0], { x: br.x, y: br.y, contained: true });
	assert.equal(m.client.clientState(s).siege!.summary, undefined);
	assert.equal(s.maps[s.group!.base!.mapId!].tiles[br.y * 10 + br.x], "barricade");
	assert.deepEqual(s.maps[s.group!.base!.mapId!].barricades![`${br.x},${br.y}`], { hp: 8, max: 15 });
	assert.equal(s.siege!.phase, "active");
});

// ─── end ────────────────────────────────────────────────────────────────

test("the party away: the night plays out alone; a breach nobody holds costs residents and morale", async () => {
	const z = await atBase({ hour: 23 });
	edit(z, (s) => {
		s.npcs.ana = npc("ana", "Ana");
		s.group!.survivors.ana = { ...companion("ana", "at_base"), hp: 1 };
		s.group!.base!.residents = [{ id: "r1", name: "Teresa Holm and her kids", headcount: 3, since: 0 }, { id: "r2", name: "Old Walt", headcount: 1, since: 0 }];
		const map = s.maps[s.group!.base!.mapId!];
		map.barricades!["4,4"] = { hp: 2, max: 15 };
	});
	await call(z, "start_siege", { horde: 45 });
	// The party leaves for elsewhere.
	edit(z, (s) => (s.world.currentLocationId = s.world.locations.find((l) => l.id !== s.group!.base!.locationId)!.id));
	const r = await call(z, "advance_time", { hours: 1 });
	assert.match(r.text, /party is away/);
	assert.match(r.text, /SIEGE OVER/);
	const s = m.loadState(z);
	assert.equal(s.siege!.phase, "over");
	assert.equal(s.siege!.outcome, "breached");
	const left = s.group!.base!.residents!.reduce((n, x) => n + x.headcount, 0);
	assert.ok(left < 4, `residents left ${left}`);
	assert.equal(s.siege!.stats!.residentsLost, 4 - left);
	assert.ok(s.group!.survivors.ana.morale < 5);
	assert.match(m.digest.stateDigest(s), /SIEGE OVER \(breached\)/);
	// The DM closes it.
	const e = await call(z, "end_siege", {});
	assert.match(e.text, /Siege closed/);
	assert.equal(m.loadState(z).siege, undefined);
});

test("held to dawn: morale up, companions go home, the town horde shrinks; refuses to close early without a reason", async () => {
	const z = await atBase({ hour: 23 });
	edit(z, (s) => {
		s.npcs.ana = npc("ana", "Ana");
		s.group!.survivors.ana = companion("ana", "at_base");
		const map = s.maps[s.group!.base!.mapId!];
		map.barricades!["4,4"] = { hp: 400, max: 400 };
		map.tiles[4] = "barricade";
		map.barricades!["4,0"] = { hp: 400, max: 400 };
		s.town = { lastTick: 99999999, factions: {}, hordes: [{ id: "h9", size: 20, at: s.group!.base!.locationId, nextMoveAt: 99999999, known: true }], places: {}, events: [] };
	});
	await call(z, "start_siege", { horde: 20 });
	edit(z, (s) => (s.siege!.hordeId = "h9"));
	assert.equal((await call(z, "end_siege", {})).isError, true, "still on");
	await call(z, "siege_defence", { posts: [{ who: "pc", x: 4, y: 4 }, { who: "Ana", x: 4, y: 0 }] });
	let last = "";
	for (let i = 0; i < 6 && m.loadState(z).siege?.phase !== "over"; i++) last = (await call(z, "siege_wave", { action: "hack" })).text;
	assert.match(last, /SIEGE OVER/);
	assert.match(last, /THE BASE HELD/);
	const s = m.loadState(z);
	assert.equal(s.siege!.outcome, "held");
	assert.equal(s.group!.survivors.ana.morale, 6);
	assert.equal(s.group!.survivors.ana.status, "at_base", "back home after the night");
	assert.equal(s.town!.hordes.find((h) => h.id === "h9")?.size ?? 0, s.siege!.horde);
	assert.ok(s.siege!.stats!.pcKills > 0);
	// A day later it clears itself.
	await call(z, "advance_time", { hours: 25 });
	assert.equal(m.loadState(z).siege, undefined);
});

// ─── secrecy, DM side, i18n ──────────────────────────────────────────────

test("the client sees no schedule; the DM gets a digest line and a prompt line; EN/ES strings", async () => {
	const z = await atBase({ hour: 23 });
	await call(z, "start_siege", { horde: 30 });
	const s = m.loadState(z);
	const c = m.client.clientState(s).siege!;
	const allowed = new Set(["phase", "arrivesAt", "horde", "hordeStart", "hordeId", "wave", "waves", "posts", "lights", "log", "outcome", "startedAt", "source", "doors", "breach", "breaches", "joined", "lightsFueled", "stats", "last", "endedAt", "summary"]);
	assert.ok(Object.keys(c).every((k) => allowed.has(k)), Object.keys(c).join());
	assert.doesNotMatch(JSON.stringify(c), /schedule|nextWave|future/i);
	assert.match(m.digest.stateDigest(s), /SIEGE WARNING/);
	assert.match(m.prompt.buildSystemPrompt(s.settings), /NIGHT SIEGES/);
	const f = m.loadState(newGame(false));
	assert.doesNotMatch(m.prompt.buildSystemPrompt(f.settings), /NIGHT SIEGES/);
	for (const k of Object.keys(m.en).filter((k) => k.startsWith("siege."))) assert.ok((m.es as Record<string, string>)[k], k);
	assert.ok(Object.keys(m.en).some((k) => k.startsWith("siege.")));
});
