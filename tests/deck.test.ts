import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Abilities, GameState, RollRecord } from "../lib/game/types";
import { deckChargesMax, deckProgramNumbers, ramBonus, resetDeckUses, syncRamSlots } from "../lib/rules/deck";
import { deriveSheet, profBonusOf } from "../lib/rules/character";
import { abilityMod } from "../lib/rules/dice";
import { getEquipment } from "../lib/srd";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-deck-"));
process.env.DH_DATA_DIR = dir;

let m: {
	createGame: typeof import("../lib/dm/newgame").createGame;
	defaultSettings: typeof import("../components/setup/wizardState").defaultSettings;
	allTools: typeof import("../lib/dm/tools").allTools;
	loadState: typeof import("../lib/store/campaigns").loadState;
	saveState: typeof import("../lib/store/campaigns").saveState;
};
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

const arr = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities => ({ str, dex, con, int, wis, cha });
const STD = { method: "standard_array" as const, scores: arr(10, 13, 14, 15, 12, 8) };
const KID = "c-origin-vantis-trial-kid";
const ROWS = ["##############", "#,,,,,,,,,,,,#", "#,@,,,,,,,,,,#", "#,,,,,,,,,,,,#", "#,,,,,,,,,,,,#", "##############"];

function newGame(preset: string, classId: string, speciesId: string, extra: Record<string, unknown> = {}): string {
	const settings = m.defaultSettings();
	settings.world.preset = preset as never;
	return m.createGame({ settings, seed: 7, character: { name: "Vale", speciesId, classId, backgroundId: "criminal", abilities: STD, ...extra } }).id;
}
const cyberGame = (classId: string, speciesId = "c-origin-barrio-kid") => newGame("marea_burned", classId, speciesId);

function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}
/** Swap whatever deck the PC carries for `ref` (or drop it). */
function setDeck(s: GameState, ref: string | undefined): void {
	s.character.inventory = s.character.inventory.filter((i) => !(i.ref && getEquipment(i.ref)?.deck));
	if (ref) s.character.inventory.push({ id: `it-${ref}`, ref, name: getEquipment(ref)!.name, quantity: 1 } as GameState["character"]["inventory"][number]);
}
async function call(id: string, name: string, args: Record<string, unknown>, rolls: RollRecord[] = []) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}

test("fixtures: the origins and decks these tests rely on exist", async () => {
	const { getSpecies } = await import("../lib/srd");
	assert.ok(getSpecies(KID)!.traits.some((t) => t.index === "c-experimental-jack"));
	assert.ok(getSpecies("c-origin-barrio-kid"), "a plain origin");
	assert.ok(!getSpecies("c-origin-barrio-kid")!.traits.some((t) => t.index === "c-experimental-jack"));
	assert.deepEqual(getEquipment("c-deck-tier2")!.deck, { tier: 2, ram: 1, programs: ["p-sledgehammer", "p-backdoor"] });
});

// ─── deck_program ────────────────────────────────────────────────────────────

test("deck_program: always in the tool list, refuses outside Root Access", async () => {
	const f = newGame("classic_high_fantasy", "fighter", "human");
	const r = await call(f, "deck_program", { program: "p-sledgehammer" });
	assert.ok(r.isError);
	assert.match(r.text, /only exists in Root Access/);
	assert.equal(m.loadState(f).cyber, undefined);
});

test("deck_program: a non-caster runs built-ins as charges, tier + 1 per long rest", async () => {
	const id = cyberGame("fighter");
	let s = m.loadState(id);
	assert.equal(s.character.spellcasting?.slots.some(Boolean) ?? false, false, "a Solo has no RAM of their own");
	const c = s.character;
	const base = abilityMod(c.abilities.int) + profBonusOf(c);
	// Second-hand deck: tier 0, one charge of each.
	edit(id, (st) => setDeck(st, "c-deck-secondhand"));
	const r1 = await call(id, "deck_program", { program: "Sledgehammer" });
	assert.ok(!r1.isError, r1.text);
	assert.match(r1.text, new RegExp(`program attack \\+${base}, save DC ${8 + base}`));
	assert.match(r1.text, /0\/1 charges left/);
	assert.equal(m.loadState(id).cyber!.deckUses!["p-sledgehammer"], 1);
	const r2 = await call(id, "deck_program", { program: "p-sledgehammer" });
	assert.ok(r2.isError);
	assert.match(r2.text, /no charges left/);
	// The other built-in has its own charges.
	assert.ok(!(await call(id, "deck_program", { program: "ghost" })).isError);
	assert.equal(m.loadState(id).character.concentration?.spell, "p-ghost");
	// Not a built-in of this deck.
	const r3 = await call(id, "deck_program", { program: "Worm" });
	assert.ok(r3.isError);
	assert.match(r3.text, /no built-in "Worm".*Sledgehammer.*Ghost/);
	// A long rest brings them back.
	const rest = await call(id, "long_rest", {});
	assert.ok(!rest.isError, rest.text);
	assert.equal(m.loadState(id).cyber!.deckUses, undefined);
	assert.ok(!(await call(id, "deck_program", { program: "p-sledgehammer" })).isError);
	// A tier-2 deck: three charges of each, +2 on the numbers.
	edit(id, (st) => {
		setDeck(st, "c-deck-tier2");
		resetDeckUses(st);
	});
	for (const left of [2, 1, 0]) {
		const r = await call(id, "deck_program", { program: "p-sledgehammer" });
		assert.ok(!r.isError, r.text);
		assert.match(r.text, new RegExp(`program attack \\+${base + 2}, save DC ${10 + base}`));
		assert.match(r.text, new RegExp(`${left}/3 charges left`));
	}
	assert.ok((await call(id, "deck_program", { program: "p-sledgehammer" })).isError);
	assert.ok(!(await call(id, "deck_program", { program: "Backdoor" })).isError);
	// No deck, no built-ins.
	edit(id, (st) => setDeck(st, undefined));
	const none = await call(id, "deck_program", { program: "p-sledgehammer" });
	assert.ok(none.isError);
	assert.match(none.text, /carries no deck/);
	// Never touches RAM.
	s = m.loadState(id);
	assert.ok((s.character.spellcasting?.slotsUsed ?? []).every((n) => n === 0));
});

test("deck_program: on the PC's combat turn the engine rolls it with the deck's numbers", async () => {
	const id = cyberGame("rogue");
	edit(id, (st) => setDeck(st, "c-deck-tier1"));
	assert.ok(!(await call(id, "draw_map", { name: "Server room", kind: "town", rows: ROWS })).isError);
	const start = await call(id, "start_combat", { monsters: [{ monster: "c-ice-watchdog", x: 5, y: 2 }] });
	assert.ok(!start.isError, start.text);
	const st = edit(id, (s) => {
		const e = s.encounter!;
		e.turnIndex = e.order.indexOf(s.character.id);
	});
	const ice = Object.values(st.encounter!.combatants).find((k) => k.kind !== "pc")!;
	const rolls: RollRecord[] = [];
	const r = await call(id, "deck_program", { program: "p-sledgehammer", targetIds: [ice.id] }, rolls);
	assert.ok(!r.isError, r.text);
	assert.match(r.text, /Sledgehammer/);
	assert.match(r.text, /0\/2 charges left|1\/2 charges left/);
	const atk = rolls.find((x) => /d20/.test(x.notation) && x.actor === m.loadState(id).character.id);
	assert.ok(atk, `attack roll among ${rolls.map((x) => `${x.label} ${x.notation}`).join(" | ")}`);
	assert.equal(atk!.modifier, deckProgramNumbers(m.loadState(id).character).attackBonus);
});

// ─── deck tier on program DCs and attacks ───────────────────────────────────

test("deck tier: adds to program save DC and attack in Root Access only", () => {
	const id = cyberGame("wizard");
	const s = m.loadState(id);
	const c = s.character;
	const pb = profBonusOf(c);
	const int = abilityMod(c.abilities.int);
	setDeck(s, "c-deck-tier3");
	let sc = deriveSheet(c).spellcasting[0];
	assert.equal(sc.saveDc, 8 + pb + int + 3);
	assert.equal(sc.attackBonus, pb + int + 3);
	setDeck(s, undefined);
	sc = deriveSheet(c).spellcasting[0];
	assert.equal(sc.saveDc, 8 + pb + int);
	// A fantasy wizard holding a deck item gets nothing from it.
	const f = m.loadState(newGame("classic_high_fantasy", "wizard", "human"));
	const before = deriveSheet(f.character).spellcasting[0];
	setDeck(f, "c-deck-tier3");
	assert.deepEqual(deriveSheet(f.character).spellcasting[0], before);
	assert.equal(deckChargesMax(f.character), 4, "the deck rules themselves are ruleset-blind; the tools gate them");
});

// ─── RAM → level-1 slots ────────────────────────────────────────────────────

test("RAM: +1 level-1 slot each for deck RAM, a RAM expansion and the experimental jack", async () => {
	const id = newGame("marea_burned", "wizard", KID);
	const s = m.loadState(id);
	const c = s.character;
	const base = 2; // a level-1 wizard
	// New game: tier-1 starting deck (no RAM) + the experimental jack.
	assert.equal(ramBonus(c, s.cyber!.implants), 1);
	assert.equal(c.spellcasting!.slots[0], base + 1);
	assert.equal(c.spellcasting!.ramBonus, 1);
	// Idempotent.
	syncRamSlots(s);
	syncRamSlots(s);
	assert.equal(c.spellcasting!.slots[0], base + 1);
	// A tier-2 deck (+1 RAM) and an installed RAM expansion.
	setDeck(s, "c-deck-tier2");
	s.cyber!.implants.push({ ref: "c-ram-expansion", slot: "neural", humanity: 4, installedAt: 0 });
	syncRamSlots(s);
	assert.equal(c.spellcasting!.slots[0], base + 3);
	// Spend them all, then lose the deck: the used count follows the max down.
	c.spellcasting!.slotsUsed[0] = base + 3;
	setDeck(s, undefined);
	syncRamSlots(s);
	assert.equal(c.spellcasting!.slots[0], base + 2);
	assert.equal(c.spellcasting!.slotsUsed[0], base + 2);
	// Slots recomputed by a level-up: the bonus is re-added on top, not lost or doubled.
	c.spellcasting!.slots[0] = 3;
	delete c.spellcasting!.ramBonus;
	syncRamSlots(s);
	assert.equal(c.spellcasting!.slots[0], 3 + 2);
	// Through the engine: every tool call keeps it in sync.
	m.saveState(s);
	edit(id, (st) => {
		setDeck(st, "c-deck-tier2");
	});
	await call(id, "deck_program", { program: "p-sledgehammer" });
	assert.equal(m.loadState(id).character.spellcasting!.slots[0], 3 + 3);
});

test("RAM: never for non-casters, fantasy or The Quiet", async () => {
	// A Root Access fighter with the jack and a tier-2 deck: no slots appear.
	const fi = m.loadState(newGame("marea_burned", "fighter", KID));
	setDeck(fi, "c-deck-tier2");
	syncRamSlots(fi);
	assert.ok(!fi.character.spellcasting || fi.character.spellcasting.slots.every((n) => n === 0));
	// A fantasy wizard holding a tier-2 deck and a stray jack feature.
	const f = m.loadState(newGame("classic_high_fantasy", "wizard", "human"));
	const slots = [...f.character.spellcasting!.slots];
	setDeck(f, "c-deck-tier2");
	f.character.features.push({ id: "c-experimental-jack", name: "Experimental Jack", source: "test", description: "" });
	syncRamSlots(f);
	assert.deepEqual(f.character.spellcasting!.slots, slots);
	assert.equal(f.character.spellcasting!.ramBonus, undefined);
	// The Quiet.
	const z = m.loadState(newGame("zombie_outbreak", "wizard", "z-origin-streetwise"));
	if (z.character.spellcasting) {
		const zs = [...z.character.spellcasting.slots];
		setDeck(z, "c-deck-tier2");
		syncRamSlots(z);
		assert.deepEqual(z.character.spellcasting.slots, zs);
	}
});
