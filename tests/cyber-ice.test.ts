import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import cMonsters from "../lib/srd/data/cyber/monsters.json";
import { getMonster } from "../lib/srd";
import type { MonsterStats } from "../lib/game/types";

/** ICE: the net's monsters (docs/cyberpunk.md §4). Black ICE is a fiend, the rest constructs, the sysadmin a human. */
type Ice = MonsterStats & { traceOnTurn?: number };
const ICE: Record<string, { type: RegExp; token: string; black?: boolean }> = {
	"c-ice-watchdog": { type: /^construct$/, token: "ice_white" },
	"c-ice-barrier": { type: /^construct$/, token: "ice_white" },
	"c-ice-sparky": { type: /^construct$/, token: "ice_grey" },
	"c-ice-tarpit": { type: /^construct$/, token: "ice_grey" },
	"c-ice-hellhound": { type: /^fiend$/, token: "ice_black", black: true },
	"c-ice-wraith": { type: /^fiend$/, token: "ice_black", black: true },
	"c-ice-sysadmin": { type: /^humanoid/, token: "sysadmin" },
};
const ice = (cMonsters as unknown as Ice[]).filter((m) => m.index.startsWith("c-ice-"));
const byId = (id: string) => ice.find((m) => m.index === id)!;
const damageOf = (m: Ice) => [...m.actions, ...m.bonusActions].flatMap((a) => [...(a.attack?.damage ?? []), ...(a.save?.damage ?? [])]);
const text = (m: Ice) => JSON.stringify([m.traits, m.actions, m.bonusActions]);

test("ICE: the seven exact ids, types and sprite keys, tagged cyberpunk", () => {
	assert.deepEqual(ice.map((m) => m.index).sort(), Object.keys(ICE).sort());
	for (const [id, want] of Object.entries(ICE)) {
		const m = byId(id);
		assert.match(m.type, want.type, id);
		assert.equal(m.tokenHint, want.token, id);
		assert.equal(getMonster(id)?.ruleset, "cyberpunk", id);
	}
});

test("ICE: every attack on a runner is psychic; black ICE says it hits the real body", () => {
	for (const m of ice) {
		const dmg = damageOf(m);
		assert.ok(dmg.length > 0 || m.index === "c-ice-barrier", `${m.index} deals damage`);
		for (const d of dmg) assert.equal(d.type, "psychic", `${m.index} ${d.dice}`);
		if (ICE[m.index].black) assert.match(text(m), /real (body|hit points)/, m.index);
	}
	assert.ok(damageOf(byId("c-ice-barrier")).every((d) => d.type === "psychic"));
});

test("ICE: CR 1/4 to 5, rising from white to black, and the special abilities", () => {
	const cr = (id: string) => byId(id).cr;
	assert.equal(Math.min(...ice.map((m) => m.cr)), 0.25);
	assert.ok(cr("c-ice-watchdog") < cr("c-ice-sparky") && cr("c-ice-sparky") < cr("c-ice-hellhound") && cr("c-ice-hellhound") < cr("c-ice-wraith"));
	// Watchdog raises the trace every turn; the sysadmin traces live too. Nothing else does by itself.
	assert.equal(byId("c-ice-watchdog").traceOnTurn, 1);
	assert.equal(byId("c-ice-sysadmin").traceOnTurn, 1);
	for (const m of ice) if (!["c-ice-watchdog", "c-ice-sysadmin"].includes(m.index)) assert.equal(m.traceOnTurn, undefined, m.index);
	// Barrier: a wall, high AC, can't move.
	const b = byId("c-ice-barrier");
	assert.ok(b.ac >= 17 && b.speed.walk === 0);
	// Sparky stuns and wipes the lowest RAM slot.
	const over = byId("c-ice-sparky").actions.find((a) => a.attack?.save)!;
	assert.match(over.attack!.save!.onFail!, /stunned/);
	assert.match(over.description, /loses its lowest RAM slot/);
	// Tar Pit grapples and stops a jack-out.
	const tp = byId("c-ice-tarpit").actions.find((a) => a.attack?.save)!;
	assert.match(tp.attack!.save!.onFail!, /grappled/);
	assert.match(text(byId("c-ice-tarpit")), /can't jack out/);
	// The wraith frightens; the sysadmin raises the trace and runs ICE.
	assert.match(text(byId("c-ice-wraith")), /frightened/);
	assert.match(text(byId("c-ice-sysadmin")), /trace rises by 2/);
});

test("ICE: Spanish for every name and text, in c1.json and dict.json", () => {
	const read = (f: string) => JSON.parse(fs.readFileSync(`${__dirname}/../lib/srd/es/${f}`, "utf8")) as Record<string, string>;
	const c1 = read("c1.json");
	const dict = read("dict.json");
	for (const m of ice) {
		const strings = [m.name, ...[...m.traits, ...m.actions, ...m.bonusActions, ...m.reactions].flatMap((x) => [x.name, x.description])];
		for (const a of m.actions) if (a.attack?.save?.onFail) strings.push(a.attack.save.onFail);
		for (const s of strings) {
			assert.ok(c1[s], `missing Spanish: ${s.slice(0, 60)}`);
			assert.equal(dict[s], c1[s], `dict.json not rebuilt for: ${s.slice(0, 60)}`);
		}
	}
	assert.equal(dict["Watchdog ICE"], "ICE perro guardián");
});
