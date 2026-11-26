import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GameState, InventoryItem, LogEntry } from "../lib/game/types";

/**
 * Downtime played directly from the sidebar (lib/dm/downtime.ts): the Den
 * route's gig / crew / workbench / lay-low ops (Root Access) and the base
 * route's stash / take / build / errand / place ops (The Quiet). No DM turn:
 * one system log line, with the engine's facts for the next digest.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-downtime-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	readLog: typeof import("../lib/store/campaigns").readLog;
	digest: typeof import("../lib/dm/digest");
	prompt: typeof import("../lib/dm/prompt");
	downtime: typeof import("../lib/dm/downtime");
	den: typeof import("../lib/rules/den");
	gigs: typeof import("../lib/rules/gigs");
	denRoute: typeof import("../app/api/campaigns/[id]/den/route");
	baseRoute: typeof import("../app/api/campaigns/[id]/base/route");
	en: typeof import("../lib/i18n/en").en;
	es: typeof import("../lib/i18n/es").es;
};
before(async () => {
	const store = await import("../lib/store/campaigns");
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: store.loadState,
		saveState: store.saveState,
		readLog: store.readLog,
		digest: await import("../lib/dm/digest"),
		prompt: await import("../lib/dm/prompt"),
		downtime: await import("../lib/dm/downtime"),
		den: await import("../lib/rules/den"),
		gigs: await import("../lib/rules/gigs"),
		denRoute: await import("../app/api/campaigns/[id]/den/route"),
		baseRoute: await import("../app/api/campaigns/[id]/base/route"),
		en: (await import("../lib/i18n/en")).en,
		es: (await import("../lib/i18n/es")).es,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 10, dex: 13, con: 14, int: 15, wis: 12, cha: 8 } };

function cyberGame(lang: "en" | "es" = "en"): string {
	const settings = m.defaultSettings();
	settings.world.preset = "marea_burned" as never;
	settings.language = lang;
	return m.createGame({ settings, seed: 11, character: { name: "Vale", speciesId: "c-origin-barrio-kid", classId: "wizard", backgroundId: "criminal", abilities: STD } }).id;
}
function zombieGame(lang: "en" | "es" = "en"): string {
	const settings = m.defaultSettings();
	settings.world.preset = "zombie_outbreak";
	settings.language = lang;
	return m.createGame({ settings, character: { name: "Dana", speciesId: "z-origin-streetwise", classId: "fighter", backgroundId: "criminal", abilities: STD } }).id;
}
function fantasyGame(): string {
	return m.createGame({ settings: m.defaultSettings(), character: { name: "Thorin", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: STD } }).id;
}

function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}
async function ok(id: string, name: string, args: Record<string, unknown>): Promise<string> {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	const r = await t!.execute(args);
	assert.notEqual(r.isError, true, `${name}: ${r.text}`);
	return r.text;
}
async function npc(id: string, name: string): Promise<string> {
	const text = await ok(id, "add_npc", { name, role: "runner", description: "Quick eyes, cheap jacket." });
	return /id (\S+)\.$/.exec(text)![1];
}

type Res = { status: number; body: { error?: string; text?: string; state?: GameState } };
async function post(route: "den" | "base", id: string, body: unknown): Promise<Res> {
	const r = route === "den" ? m.denRoute : m.baseRoute;
	const res = await r.POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) });
	return { status: res.status, body: (await res.json()) as Res["body"] };
}
const lastLog = (id: string): LogEntry => m.readLog(id, { limit: 1 })[0];
const logCount = (id: string) => m.readLog(id, { limit: 1000 }).length;

function offer(id: string, title = "Lift the Halcón payroll"): string {
	let gigId = "";
	edit(id, (s) => {
		gigId = m.gigs.offerGig(s, { title, client: "La Tía", kind: "heist", pay: 600, hat: -1, heat: 2, risk: 3, brief: "In and out.", days: 5 }, `gig_${Math.random().toString(36).slice(2, 8)}`).gig.id;
	});
	return gigId;
}

// ─── Root Access: gigs ─────────────────────────────────────────────────────

test("gig board: the player takes an offered gig; one system line, no DM turn", async () => {
	const id = cyberGame();
	const gig = offer(id);
	const before = logCount(id);
	const r = await post("den", id, { op: "take_gig", gig });
	assert.equal(r.status, 200, r.body.error);
	assert.equal(r.body.state!.cyber!.gigs!.find((g) => g.id === gig)!.status, "taken");
	assert.equal(logCount(id), before + 1, "exactly one log line (no DM narration)");
	const line = lastLog(id);
	assert.equal(line.role, "system");
	assert.equal(line.text, "Gig taken: Lift the Halcón payroll (La Tía).");
	assert.match(line.tools![0].summary, /Taken: gig_.*complete_gig/);
	// Taking it twice is refused.
	const again = await post("den", id, { op: "take_gig", gig });
	assert.equal(again.status, 400);
	assert.match(again.body.error!, /taken, not on offer/);
	// Fuzzy titles aren't accepted from the UI.
	assert.equal((await post("den", id, { op: "take_gig", gig: "Halcón" })).status, 400);
});

test("gig board: declining takes the offer off the board without Heat or Hat", async () => {
	const id = cyberGame();
	const gig = offer(id);
	const s0 = m.loadState(id);
	const r = await post("den", id, { op: "decline_gig", gig });
	assert.equal(r.status, 200, r.body.error);
	const s = m.loadState(id);
	assert.equal(s.cyber!.gigs!.find((g) => g.id === gig)!.status, "expired");
	assert.equal(m.gigs.openGigs(s.cyber!.gigs).length, 0);
	assert.equal(s.cyber!.heat, s0.cyber!.heat);
	assert.equal(s.cyber!.hat, s0.cyber!.hat);
	assert.equal(lastLog(id).text, "Gig turned down: Lift the Halcón payroll.");
	// A taken gig can't be declined (the DM closes it).
	const g2 = offer(id, "Second job");
	await post("den", id, { op: "take_gig", gig: g2 });
	assert.equal((await post("den", id, { op: "decline_gig", gig: g2 })).status, 400);
});

test("gig ops refuse mid-fight, while jacked in, and outside Root Access", async () => {
	const id = cyberGame();
	const gig = offer(id);
	edit(id, (s) => (s.encounter = { status: "active" } as never));
	let r = await post("den", id, { op: "take_gig", gig });
	assert.equal(r.status, 400);
	assert.match(r.body.error!, /fight/);
	edit(id, (s) => {
		delete s.encounter;
		s.cyber!.run = {} as never;
	});
	r = await post("den", id, { op: "take_gig", gig });
	assert.match(r.body.error!, /jacked in/);
	const f = fantasyGame();
	r = await post("den", f, { op: "lay_low", days: 2 });
	assert.equal(r.status, 400);
	assert.match(r.body.error!, /Root Access/);
	assert.equal(m.loadState(f).cyber, undefined);
	assert.equal((await post("den", id, { op: "dance" })).status, 400);
});

// ─── Root Access: crew ─────────────────────────────────────────────────────

test("crew tab: send a member to the den, bring them along, send them away", async () => {
	const id = cyberGame();
	const npcId = await npc(id, "Nico");
	await ok(id, "recruit_crew", { npcId, classId: "fighter", role: "muscle", hatPref: 0, specialty: "hits hard" });
	assert.equal(m.loadState(id).cyber!.crew![npcId].status, "with_pc");
	let r = await post("den", id, { op: "crew", npcId, status: "at_den" });
	assert.equal(r.status, 200, r.body.error);
	let s = m.loadState(id);
	assert.equal(s.cyber!.crew![npcId].status, "at_den");
	assert.ok(!s.scene.npcIds.includes(npcId));
	assert.equal(lastLog(id).text, "Nico goes to mind the den.");
	r = await post("den", id, { op: "crew", npcId, status: "with_pc" });
	s = m.loadState(id);
	assert.equal(s.cyber!.crew![npcId].status, "with_pc");
	assert.ok(s.scene.npcIds.includes(npcId));
	assert.equal(lastLog(id).text, "Nico comes with you.");
	r = await post("den", id, { op: "crew", npcId, status: "away" });
	assert.equal(m.loadState(id).cyber!.crew![npcId].status, "away");
	// No-ops and bad input are refused (no log line).
	const n = logCount(id);
	assert.equal((await post("den", id, { op: "crew", npcId, status: "away" })).status, 400);
	assert.equal((await post("den", id, { op: "crew", npcId, status: "dead" })).status, 400);
	assert.equal(logCount(id), n);
	// Not mid-fight.
	edit(id, (st) => (st.encounter = { status: "active" } as never));
	assert.equal((await post("den", id, { op: "crew", npcId, status: "with_pc" })).status, 400);
});

// ─── Root Access: workbench ─────────────────────────────────────────────────

test("workbench: eligible programs come from the engine; writing one charges cred and is refused without a workbench", async () => {
	const id = cyberGame();
	const s0 = m.loadState(id);
	const list = m.den.writablePrograms(s0.character);
	assert.ok(list.length > 0, "a level-1 Netrunner has programs to write");
	assert.ok(list.every((p) => p.level >= 1 && p.ruleset === "cyberpunk"));
	const known = s0.character.spellcasting!.classes.flatMap((c) => [...c.known, ...c.prepared]);
	assert.ok(list.every((p) => !known.includes(p.index)), "nothing they already have");
	const pick = list[0];
	// No workbench yet.
	let r = await post("den", id, { op: "write", program: pick.index });
	assert.equal(r.status, 400);
	assert.match(r.body.error!, /no workbench/);
	edit(id, (s) => {
		s.cyber!.den!.upgrades.workbench = 1;
		s.character.currency.gp = 1000;
	});
	r = await post("den", id, { op: "write", program: pick.index });
	assert.equal(r.status, 200, r.body.error);
	const s = m.loadState(id);
	assert.equal(s.cyber!.den!.writing!.program, pick.index);
	assert.equal(s.character.currency.gp, 1000 - m.den.programCost(pick.level));
	assert.match(lastLog(id).text, new RegExp(`^Workbench: writing ${pick.name}, ready on day \\d+\\.$`));
	// One at a time.
	assert.match((await post("den", id, { op: "write", program: list[1]?.index ?? pick.index })).body.error!, /one program at a time/);
});

// ─── Root Access: lay low ───────────────────────────────────────────────────

test("lay low: days pass, Heat drops, the workbench finishes, and the daily ticks reach the DM", async () => {
	const id = cyberGame();
	const pick = m.den.writablePrograms(m.loadState(id).character)[0];
	edit(id, (s) => {
		s.cyber!.heat = 6;
		s.cyber!.den!.upgrades.workbench = 1;
		s.character.currency.gp = 2000;
	});
	await post("den", id, { op: "write", program: pick.index });
	const s0 = m.loadState(id);
	const r = await post("den", id, { op: "lay_low", days: 3 });
	assert.equal(r.status, 200, r.body.error);
	const s = m.loadState(id);
	assert.equal(s.time.day, s0.time.day + 3);
	assert.ok(s.cyber!.heat < 6);
	assert.equal(s.cyber!.den!.writing, undefined, "the program finished during the days");
	const line = lastLog(id);
	assert.match(line.text, new RegExp(`^Lay low 3 days: now day ${s.time.day}\\. Heat 6 → ${s.cyber!.heat}\\..*${pick.name} is written\\.`));
	assert.match(line.tools![0].summary, /Lay low 3 days/);
	assert.match(line.tools![0].summary, /written and compiled/, "the den tick's line rides along for the DM");
	// The DM sees it in the digest's recent play.
	const dg = m.digest.stateDigest(s, { recentLog: m.readLog(id, { limit: 12 }) });
	assert.match(dg, /SYSTEM: Lay low 3 days.*\[engine, already applied: The player lay low/);
	// Refusals: out of range, and with a raid coming.
	assert.equal((await post("den", id, { op: "lay_low", days: 0 })).status, 400);
	assert.equal((await post("den", id, { op: "lay_low", days: 30 })).status, 400);
	edit(id, (st) => (st.cyber!.den!.raidDue = { reason: "heat", at: 0, by: "ferro" }));
	assert.match((await post("den", id, { op: "lay_low", days: 1 })).body.error!, /coming for the den/);
});

test("Spanish campaigns get Spanish log lines", async () => {
	const id = cyberGame("es");
	const gig = offer(id);
	await post("den", id, { op: "take_gig", gig });
	assert.equal(lastLog(id).text, "Trabajo aceptado: Lift the Halcón payroll (La Tía).");
	await post("den", id, { op: "lay_low", days: 1 });
	assert.match(lastLog(id).text, /^Perfil bajo 1 día: ahora es el día \d+\. Calor/);
});

// ─── The Quiet: the base ────────────────────────────────────────────────────

const ROWS = ["##########", "#........#", "#.@......#", "#........#", "####+#####", "----------"];
const item = (ref: string, name: string, quantity = 1): InventoryItem => ({ id: `it_${ref}_${Math.random().toString(36).slice(2, 7)}`, ref, name, quantity, category: "gear" });

async function zombieAtBase(lang: "en" | "es" = "en"): Promise<string> {
	const z = zombieGame(lang);
	edit(z, (s) => {
		s.time = { day: 3, hour: 12, minute: 0 };
		s.scene.timeOfDay = "day";
		s.scene.weather = "clear";
		// Known stacks (the starting kit has some food and water already).
		s.character.inventory = s.character.inventory.filter((i) => !["z-canned-food", "z-planks", "z-bottled-water"].includes(i.ref ?? ""));
		s.character.inventory.push(item("z-canned-food", "Canned Food", 6), item("z-planks", "Planks", 4), item("z-bottled-water", "Bottled Water", 4));
	});
	await ok(z, "draw_map", { name: "Hale's Pharmacy", kind: "town", rows: ROWS });
	await ok(z, "claim_base", { name: "the pharmacy" });
	return z;
}
const invId = (s: GameState, ref: string) => s.character.inventory.find((i) => i.ref === ref)!.id;

test("base: stash supplies, take them back, start an upgrade — each one system line", async () => {
	const z = await zombieAtBase();
	let s = m.loadState(z);
	const stock0 = { ...s.group!.base!.stock };
	let r = await post("base", z, { op: "stash", items: [{ itemId: invId(s, "z-canned-food") }, { itemId: invId(s, "z-planks") }] });
	assert.equal(r.status, 200, r.body.error);
	s = m.loadState(z);
	assert.equal(s.group!.base!.stock.food, stock0.food + 6);
	assert.equal(s.group!.base!.stock.materials, stock0.materials + 4);
	assert.ok(!s.character.inventory.some((i) => i.ref === "z-planks"));
	assert.equal(lastLog(z).text, "Base: stashed food +6, materials +4.");
	assert.match(lastLog(z).tools![0].summary, /Stashed at the pharmacy/);

	r = await post("base", z, { op: "take", kind: "food", qty: 2 });
	assert.equal(r.status, 200, r.body.error);
	s = m.loadState(z);
	assert.equal(s.group!.base!.stock.food, stock0.food + 4);
	assert.equal(s.character.inventory.filter((i) => i.ref === "z-canned-food").reduce((n, i) => n + i.quantity, 0), 2, "real items back in the pack");
	assert.equal(lastLog(z).text, "Base: took 2 food from the stash.");
	assert.match((await post("base", z, { op: "take", kind: "food", qty: 999 })).body.error!, /Only \d+ food/);

	r = await post("base", z, { op: "build", upgrade: "rain_catcher" });
	assert.equal(r.status, 200, r.body.error);
	s = m.loadState(z);
	assert.deepEqual(s.group!.base!.building!.map((b) => b.upgrade), ["rain_catcher"]);
	assert.equal(s.group!.base!.stock.materials, stock0.materials + 2);
	assert.match(lastLog(z).text, /^Base: building the Rain catcher, ready day 3 at 15:00 \(3 h\)\.$/i);
	assert.match((await post("base", z, { op: "build", upgrade: "watchtower" })).body.error!, /Not enough in the stock/);
	assert.match((await post("base", z, { op: "build", upgrade: "rain_catcher" })).body.error!, /already being built/);
});

test("base: refusals away from the base, mid-fight, during a siege, outside The Quiet", async () => {
	const z = await zombieAtBase();
	const s = m.loadState(z);
	const food = invId(s, "z-canned-food");
	edit(z, (st) => (st.world.currentLocationId = st.world.locations.find((l) => l.id !== st.group!.base!.locationId)!.id));
	let r = await post("base", z, { op: "stash", items: [{ itemId: food }] });
	assert.equal(r.status, 400);
	assert.match(r.body.error!, /only at the base/);
	edit(z, (st) => {
		st.world.currentLocationId = st.group!.base!.locationId;
		st.encounter = { status: "active" } as never;
	});
	assert.match((await post("base", z, { op: "take", kind: "food", qty: 1 })).body.error!, /fight/);
	edit(z, (st) => {
		delete st.encounter;
		st.siege = {} as never;
	});
	assert.match((await post("base", z, { op: "build", upgrade: "alarm_cans" })).body.error!, /siege/);
	// A non-stock item is refused.
	edit(z, (st) => {
		delete st.siege;
		st.character.inventory.push(item("z-kitchen-knife", "Kitchen Knife"));
	});
	assert.match((await post("base", z, { op: "stash", items: [{ itemId: invId(m.loadState(z), "z-kitchen-knife") }] })).body.error!, /doesn't go into the stock/);
	assert.equal((await post("base", z, { op: "loot" })).status, 400);
	// Fantasy: refused, nothing created.
	const f = fantasyGame();
	const fr = await post("base", f, { op: "take", kind: "food", qty: 1 });
	assert.equal(fr.status, 400);
	assert.match(fr.body.error!, /The Quiet/);
	assert.equal(m.loadState(f).group, undefined);
});

// ─── The Quiet: companions ──────────────────────────────────────────────────

test("companions: errands and staying at the base / coming along, from the Group tab", async () => {
	const z = await zombieAtBase();
	const npcId = await npc(z, "Priya");
	await ok(z, "recruit_survivor", { npcId, profession: "cleric", specialty: "stitches wounds", traits: ["calm"] });
	let r = await post("base", z, { op: "place", npcId, status: "at_base" });
	assert.equal(r.status, 200, r.body.error);
	assert.equal(m.loadState(z).group!.survivors[npcId].status, "at_base");
	assert.equal(lastLog(z).text, "Priya stays at the base.");
	r = await post("base", z, { op: "place", npcId, status: "with_party" });
	assert.equal(m.loadState(z).group!.survivors[npcId].status, "with_party");
	assert.equal(lastLog(z).text, "Priya comes with you.");
	// Picking someone up from the base means being there.
	await post("base", z, { op: "place", npcId, status: "at_base" });
	edit(z, (st) => (st.world.currentLocationId = st.world.locations.find((l) => l.id !== st.group!.base!.locationId)!.id));
	assert.match((await post("base", z, { op: "place", npcId, status: "with_party" })).body.error!, /go there/);

	r = await post("base", z, { op: "errand", npcId, task: "fetch_water", hours: 4 });
	assert.equal(r.status, 200, r.body.error);
	const sv = m.loadState(z).group!.survivors[npcId];
	assert.equal(sv.status, "away");
	assert.equal(sv.away!.task, "fetch_water");
	assert.equal(lastLog(z).text, "Priya heads out to fetch water for 4 h.");
	assert.match(lastLog(z).tools![0].summary, /sets out to fetch water for 4 h/);
	// Away: no second errand, no moving them.
	assert.match((await post("base", z, { op: "errand", npcId, task: "scout", hours: 2 })).body.error!, /can't go/);
	assert.match((await post("base", z, { op: "place", npcId, status: "at_base" })).body.error!, /away/);
	assert.equal((await post("base", z, { op: "errand", npcId, task: "party", hours: 2 })).status, 400);
	assert.equal((await post("base", z, { op: "errand", npcId, task: "scout", hours: 48 })).status, 400);
});

test("Spanish base lines", async () => {
	const z = await zombieAtBase("es");
	const s = m.loadState(z);
	await post("base", z, { op: "stash", items: [{ itemId: invId(s, "z-bottled-water") }] });
	assert.equal(lastLog(z).text, "Base: guardado agua +4.");
	await post("base", z, { op: "take", kind: "water", qty: 1 });
	assert.equal(lastLog(z).text, "Base: sacas 1 de agua del almacén.");
});

// ─── the DM contract ────────────────────────────────────────────────────────

test("the DM contract: the prompt says player management is already done; plain system lines are unchanged in the digest", () => {
	const z = zombieGame();
	assert.match(m.prompt.buildSystemPrompt(m.loadState(z).settings), /already applied: …\] are management the player did themselves/);
	const s = m.loadState(fantasyGame());
	const dg = m.digest.stateDigest(s, { recentLog: [{ id: "l1", role: "system", text: "→ The cellar", ts: 1 }] });
	assert.match(dg, /SYSTEM: → The cellar$/m);
	assert.doesNotMatch(dg, /engine, already applied/);
});

test("every downtime string has a Spanish version", () => {
	const keys = Object.keys(m.en).filter((k) => k.startsWith("downtime."));
	assert.ok(keys.length > 40);
	for (const k of keys) assert.ok((m.es as Record<string, string>)[k], k);
});

test("a long lay low: rent, an expired offer and a finished program all reach the DM's digest", async () => {
	const id = cyberGame();
	const pick = m.den.writablePrograms(m.loadState(id).character)[0];
	edit(id, (s) => {
		s.cyber!.den!.upgrades.workbench = 1;
		s.character.currency.gp = 150;
	});
	await post("den", id, { op: "write", program: pick.index });
	offer(id, "A job nobody takes");
	const r = await post("den", id, { op: "lay_low", days: 14 });
	assert.equal(r.status, 200, r.body.error);
	const s = m.loadState(id);
	assert.ok(s.cyber!.den!.debt > 0, "rent came due with no cred: debt");
	const line = lastLog(id);
	assert.match(line.text, /You owe La Tía \d+\./);
	const dg = m.digest.stateDigest(s, { recentLog: m.readLog(id, { limit: 12 }) });
	const sys = dg.split("\n").find((l) => l.startsWith("SYSTEM: Lay low 14 days"))!;
	assert.ok(sys, dg);
	assert.match(sys, /written and compiled/);
	assert.match(sys, /GIGS: expired.*A job nobody takes/, "the last tick line isn't cut off");
	assert.doesNotMatch(sys, /…\]$/);
});
