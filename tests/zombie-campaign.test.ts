import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Rng } from "../lib/rules/dice";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-zombie-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
	combat: typeof import("../lib/dm/combat");
	content: typeof import("../lib/dm/content");
	ruleset: typeof import("../lib/rules/ruleset");
};
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
		combat: await import("../lib/dm/combat"),
		content: await import("../lib/dm/content"),
		ruleset: await import("../lib/rules/ruleset"),
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { int: 15, con: 14, dex: 13, wis: 12, str: 10, cha: 8 } };

async function call(id: string, name: string, args: Record<string, unknown>) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

function newGame(zombie: boolean, classId = "wizard") {
	const settings = m.defaultSettings();
	if (zombie) settings.world.preset = "zombie_outbreak";
	return m.createGame({ settings, character: { name: "Dana", speciesId: "human", classId, backgroundId: "sage", abilities: STD } }).id;
}

const ROWS = ["##############", "#,,,,,,,,,,,,#", "#,@,,,,,,,,,,#", "#,,,,,,,,,,,,#", "#,,,,,,,,,,,,#", "##############"];
async function withMap(id: string) {
	const r = await call(id, "draw_map", { name: "Main Street", kind: "town", rows: ROWS });
	assert.notEqual(r.isError, true, r.text);
}

test("outbreak day: game day 1 is Day 0", () => {
	assert.equal(m.ruleset.outbreakDay({ time: { day: 1 } }), 0);
	assert.equal(m.ruleset.outbreakDay({ time: { day: 8 } }), 7);
	assert.equal(m.ruleset.outbreakDay({ time: { day: 0 } }), 0);
});

test("lookup_srd only offers the campaign's own ruleset", async () => {
	const z = newGame(true);
	const zMon = (await call(z, "lookup_srd", { query: "monster: zombie" })).text;
	assert.match(zMon, /z-shambler/);
	assert.doesNotMatch(zMon, /\[monster\] Zombie —/);
	assert.match(zMon, /Not yet: .*Runner from Day 21/);
	assert.match((await call(z, "lookup_srd", { query: "runner" })).text, /NOT YET: appears on Day 21 \(now Day 0\)/);
	assert.match((await call(z, "lookup_srd", { query: "z-brute", long: true })).text, /Actions detail: .*Ground Pound/);
	assert.doesNotMatch((await call(z, "lookup_srd", { query: "fireball" })).text, /Fireball —/);
	assert.match((await call(z, "lookup_srd", { query: "molotov" })).text, /^\[technique\] Molotov/);
	assert.doesNotMatch((await call(z, "lookup_srd", { query: "item: longsword" })).text, /Longsword \(/);
	assert.match((await call(z, "lookup_srd", { query: "item: pistol" })).text, /9mm Pistol/);
	assert.match((await call(z, "lookup_srd", { query: "grappled" })).text, /\[condition\] Grappled/);

	const f = newGame(false);
	assert.match((await call(f, "lookup_srd", { query: "fireball" })).text, /^\[spell\] Fireball/);
	assert.doesNotMatch((await call(f, "lookup_srd", { query: "shambler" })).text, /Shambler/);
	assert.doesNotMatch((await call(f, "lookup_srd", { query: "molotov" })).text, /Molotov/);
});

test("start_combat: fantasy monsters refused in The Quiet, the dead gated by outbreak day", async () => {
	const z = newGame(true, "fighter");
	await withMap(z);
	const gob = await call(z, "start_combat", { monsters: [{ monster: "goblin" }] });
	assert.equal(gob.isError, true);
	assert.match(gob.text, /fantasy content.*Available now: .*z-shambler/);
	const run = await call(z, "start_combat", { monsters: [{ monster: "z-runner" }] });
	assert.equal(run.isError, true);
	assert.match(run.text, /Runner doesn't exist yet: .*Day 21.*Outbreak Day 0/);
	// Plain names resolve to the z- index.
	const ok = await call(z, "start_combat", { monsters: [{ monster: "shambler" }] });
	assert.notEqual(ok.isError, true, ok.text);
	assert.ok(Object.values(m.loadState(z).encounter!.combatants).some((c) => c.stats?.index === "z-shambler"));
	// Three weeks in, runners exist.
	const st = m.loadState(z);
	st.time.day = 22;
	assert.equal(m.content.monsterForCampaign(st, "z-runner").name, "Runner");
	assert.throws(() => m.content.monsterForCampaign(st, "z-brute"), /Day 30/);

	const f = newGame(false, "fighter");
	await withMap(f);
	const zf = await call(f, "start_combat", { monsters: [{ monster: "z-shambler" }] });
	assert.equal(zf.isError, true);
	assert.match(zf.text, /zombie ruleset/);
});

test("give_item: modern gear only in The Quiet, stats filled from z- entries", async () => {
	const z = newGame(true);
	const sword = await call(z, "give_item", { name: "Longsword", ref: "longsword" });
	assert.equal(sword.isError, true);
	assert.match(sword.text, /doesn't exist in The Quiet/);
	assert.equal((await call(z, "give_item", { name: "Potion of Healing", ref: "potion-of-healing" })).isError, true);
	await call(z, "give_item", { name: "Machete" });
	await call(z, "give_item", { name: "Pistol rounds", ref: "z-ammo-9mm", quantity: 15 });
	await call(z, "give_item", { name: "Longsword" }); // narrated homebrew: allowed, but no SRD stats leak in
	const inv = m.loadState(z).character.inventory;
	assert.equal(inv.find((i) => i.name === "Machete")?.weapon?.damage, "1d8");
	assert.equal(inv.find((i) => i.name === "Machete")?.ref, "z-machete");
	assert.equal(inv.find((i) => i.ref === "z-ammo-9mm")?.quantity, 15);
	assert.equal(inv.find((i) => i.name === "Longsword")?.weapon, undefined);

	const f = newGame(false);
	assert.equal((await call(f, "give_item", { name: "Pistol", ref: "z-pistol-9mm" })).isError, true);
	await call(f, "give_item", { name: "Longsword" });
	assert.equal(m.loadState(f).character.inventory.find((i) => i.name === "Longsword")?.weapon?.damage, "1d8");
});

test("cast_spell: techniques use up their components; fantasy spells don't exist in The Quiet", async () => {
	const z = newGame(true);
	const st = m.loadState(z);
	const sc = st.character.spellcasting!;
	sc.classes[0].prepared = ["t-molotov"];
	sc.classes[0].cantrips = ["t-taser", "magic-missile"];
	st.character.inventory = st.character.inventory.filter((i) => i.ref !== "z-gasoline");
	m.saveState(st);
	const no = await call(z, "cast_spell", { spell: "Molotov" });
	assert.equal(no.isError, true);
	assert.match(no.text, /Missing: Gasoline Can \(have 0, need 1\)/);
	assert.equal(m.loadState(z).character.spellcasting!.slotsUsed[0], 0, "no slot spent");
	await call(z, "give_item", { name: "Gasoline Can", ref: "z-gasoline" });
	const bottles = m.loadState(z).character.inventory.find((i) => i.ref === "z-glass-bottle")!.quantity;
	const yes = await call(z, "cast_spell", { spell: "molotov" });
	assert.notEqual(yes.isError, true, yes.text);
	assert.match(yes.text, /uses Molotov/);
	const after = m.loadState(z).character;
	assert.equal(after.spellcasting!.slotsUsed[0], 1);
	assert.equal(after.inventory.find((i) => i.ref === "z-glass-bottle")!.quantity, bottles - 1);
	assert.equal(after.inventory.some((i) => i.ref === "z-gasoline"), false);
	const mm = await call(z, "cast_spell", { spell: "magic-missile" });
	assert.equal(mm.isError, true);
	assert.match(mm.text, /doesn't exist in this campaign/);
});

test("a gunshot in combat spends a round and lands in the noise log", async () => {
	const z = newGame(true, "paladin");
	await withMap(z);
	const r = await call(z, "start_combat", { monsters: [{ monster: "z-shambler", x: 10, y: 3 }] });
	assert.notEqual(r.isError, true, r.text);
	const st = m.loadState(z);
	const gun = st.character.inventory.find((i) => i.ref === "z-pistol-9mm");
	assert.ok(gun, "the cop starts with a service pistol");
	const ammo = st.character.inventory.find((i) => i.ref === "z-ammo-9mm")!.quantity;
	const enc = st.encounter!;
	enc.turnIndex = enc.order.indexOf(st.character.id);
	const pc = enc.combatants[st.character.id];
	Object.assign(pc.turn, { action: true, bonusAction: true, attacksLeft: 0 });
	const target = Object.values(enc.combatants).find((c) => c.kind !== "pc")!;
	const tx = { state: st, rng: new Rng(3), roll: () => undefined, fx: () => undefined };
	const log = m.combat.playerCombatAction(tx, { type: "attack", targetId: target.id, itemId: gun.id }, tx.rng);
	assert.match(log, /Gunshot: loud \(noise\)/);
	assert.equal(st.character.inventory.find((i) => i.ref === "z-ammo-9mm")!.quantity, ammo - 1);
	assert.deepEqual(m.combat.noiseLog(st).map((n) => [n.source, n.loudness, n.day]), [["9mm Pistol", 3, 1]]);
	m.saveState(st);
	assert.equal(m.combat.noiseLog(m.loadState(z)).length, 1, "the noise log persists");
});

test("audio: The Quiet offers only its own beds and sounds; fantasy never sees them", async () => {
	const enumOf = (id: string, tool: string, prop: string) => {
		const t = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] }).find((x) => x.name === tool)!;
		return (t.parameters as { properties: Record<string, { enum: string[] }> }).properties[prop].enum;
	};
	const z = newGame(true, "fighter");
	assert.equal(m.loadState(z).ambience, "q_outbreak", "a new zombie game opens on the outbreak night");
	const zt = enumOf(z, "set_ambience", "track");
	assert.ok(zt.includes("q_outbreak") && zt.includes("q_grief") && zt.includes("rain"));
	assert.ok(!zt.some((t) => ["tavern", "town", "temple", "combat", "victory"].includes(t)), zt.join());
	assert.equal((await call(z, "set_ambience", { track: "tavern" })).isError, true);
	assert.notEqual((await call(z, "set_ambience", { track: "q_hospital" })).isError, true);
	assert.equal(m.loadState(z).ambience, "q_hospital");
	assert.ok(enumOf(z, "play_sfx", "sound").includes("shotgun"));
	assert.ok(!enumOf(z, "play_sfx", "sound").includes("spell"));

	const f = newGame(false);
	assert.equal(m.loadState(f).ambience, "none");
	const ft = enumOf(f, "set_ambience", "track");
	assert.ok(ft.includes("tavern") && !ft.some((t) => t.startsWith("q_")), ft.join());
	assert.equal((await call(f, "set_ambience", { track: "q_dread" })).isError, true);
	assert.ok(!enumOf(f, "play_sfx", "sound").includes("groan"));
});

test("audio: zombie fights switch to q_combat and end in q_dread", async () => {
	const z = newGame(true, "fighter");
	await withMap(z);
	const r = await call(z, "start_combat", { monsters: [{ monster: "z-shambler" }] });
	assert.notEqual(r.isError, true, r.text);
	assert.equal(m.loadState(z).ambience, "q_combat");
	const end = await call(z, "end_combat", { status: "fled" });
	assert.notEqual(end.isError, true, end.text);
	assert.equal(m.loadState(z).ambience, "q_dread");
});
