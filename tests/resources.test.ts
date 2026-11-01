import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-res-"));
process.env.DH_DATA_DIR = dir;

type Mods = {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
};
let m: Mods;
before(async () => {
	m = {
		createGame: (await import("../lib/dm/newgame")).createGame,
		defaultSettings: (await import("../components/setup/wizardState")).defaultSettings,
		allTools: (await import("../lib/dm/tools")).allTools,
		loadState: (await import("../lib/store/campaigns")).loadState,
		saveState: (await import("../lib/store/campaigns")).saveState,
	};
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const STD = { method: "standard_array" as const, scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } };

async function call(id: string, name: string, args: Record<string, unknown>) {
	const tools = m.allTools({ campaignId: id, emit: () => undefined, rolls: [] });
	const t = tools.find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

test("cast_spell spends slots and refuses when empty", async () => {
	const s = m.createGame({ settings: m.defaultSettings(), character: { name: "Ida", speciesId: "human", classId: "cleric", backgroundId: "acolyte", abilities: { ...STD, scores: { wis: 15, con: 14, str: 13, dex: 12, int: 10, cha: 8 } } } });
	const c = s.character;
	const prepared = c.spellcasting!.classes.flatMap((k) => k.prepared);
	assert.ok(prepared.length > 0);
	const slots = c.spellcasting!.slots[0];
	const spell = prepared.includes("cure-wounds") ? "cure-wounds" : prepared[0];
	for (let i = 0; i < slots; i++) {
		const r = await call(s.id, "cast_spell", { spell, healSelf: true });
		assert.ok(!r.isError, r.text);
	}
	assert.equal(m.loadState(s.id).character.spellcasting!.slotsUsed[0], slots);
	const fail = await call(s.id, "cast_spell", { spell });
	assert.equal(fail.isError, true);
	assert.match(fail.text, /No spell slot/);
	const bogus = await call(s.id, "cast_spell", { spell: "wish" });
	assert.equal(bogus.isError, true);
});

test("use_item consumes potions and heals; refuses missing items", async () => {
	const s = m.createGame({ settings: m.defaultSettings(), character: { name: "Bo", speciesId: "dwarf", classId: "fighter", backgroundId: "soldier", abilities: STD } });
	const st = m.loadState(s.id);
	st.character.inventory.push({ id: "pot1", name: "Potion of Greater Healing", quantity: 2, category: "potion" });
	st.character.hp = 1;
	m.saveState(st);
	const r = await call(s.id, "use_item", { item: "potion of greater healing" });
	assert.ok(!r.isError, r.text);
	const after1 = m.loadState(s.id).character;
	assert.equal(after1.inventory.find((i) => i.id === "pot1")!.quantity, 1);
	assert.ok(after1.hp > 1);
	await call(s.id, "use_item", { item: "Potion of Greater Healing" });
	assert.equal(m.loadState(s.id).character.inventory.find((i) => i.id === "pot1"), undefined);
	const none = await call(s.id, "use_item", { item: "Potion of Greater Healing" });
	assert.equal(none.isError, true);
	const rm = await call(s.id, "remove_item", { name: "Potion of Greater Healing", quantity: 3 });
	assert.equal(rm.isError, true);
});

test("use_feature spends limited uses and stops at zero", async () => {
	const s = m.createGame({ settings: m.defaultSettings(), character: { name: "Cy", speciesId: "human", classId: "fighter", backgroundId: "soldier", abilities: STD } });
	const r = await call(s.id, "use_feature", { feature: "Second Wind" });
	assert.ok(!r.isError, r.text);
	const f = m.loadState(s.id).character.features.find((x) => /second wind/i.test(x.name))!;
	assert.equal(f.uses!.used, 1);
	const again = await call(s.id, "use_feature", { feature: "second-wind" });
	assert.equal(again.isError, true);
	const back = await call(s.id, "restore_resource", { feature: "Second Wind", reason: "test" });
	assert.ok(!back.isError);
	assert.equal(m.loadState(s.id).character.features.find((x) => x.id === f.id)!.uses!.used, 0);
});
