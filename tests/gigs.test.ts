import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Abilities, GameState, RollRecord } from "../lib/game/types";
import { completeGig, failGig, findGig, gigDigest, gigTick, GIG_HISTORY, MAX_OPEN_GIGS, offerGig, openGigs, takeGig, type GigOffer } from "../lib/rules/gigs";
import { DAY } from "../lib/rules/den";
import { gameMinutes } from "../lib/rules/survival";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dh-gigs-"));
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

const arr = (str: number, dex: number, con: number, int: number, wis: number, cha: number): Abilities => ({ str, dex, con, int, wis, cha });
const STD = { method: "standard_array" as const, scores: arr(10, 13, 14, 15, 12, 8) };

function newGame(preset: string, classId = "rogue", speciesId = "c-origin-barrio-kid"): string {
	const settings = m.defaultSettings();
	settings.world.preset = preset as never;
	return m.createGame({ settings, seed: 5, character: { name: "Nico", speciesId, classId, backgroundId: "criminal", abilities: STD } }).id;
}
const cyberState = () => m.loadState(newGame("marea_burned"));
function edit(id: string, f: (s: GameState) => void): GameState {
	const s = m.loadState(id);
	f(s);
	m.saveState(s);
	return s;
}
async function call(id: string, name: string, args: Record<string, unknown>, rolls: RollRecord[] = []) {
	const t = m.allTools({ campaignId: id, emit: () => undefined, rolls }).find((x) => x.name === name);
	assert.ok(t, `tool ${name}`);
	return t!.execute(args);
}
function pass(s: GameState, minutes: number): void {
	const t = gameMinutes(s.time) + minutes;
	s.time = { day: Math.floor(t / DAY), hour: Math.floor((t % DAY) / 60), minute: t % 60 };
}
const HEIST: GigOffer = { title: "Lift the Halcón payroll", client: "La Tía", kind: "heist", pay: 800, hat: -1, heat: 2, risk: 3, brief: "Payroll server, back office in Bolsa. In and out.", days: 3 };
const LEAK: GigOffer = { title: "Leak the water-cut memo", client: "La Red Libre", kind: "leak", pay: 300, hat: 2, heat: 1, risk: 2, brief: "Aguas Marea knew.", days: 5 };

test("offer, take and complete a gig: pays, shifts the Hat, adds the Heat", () => {
	const s = cyberState();
	const cy = s.cyber!;
	cy.heat = 0;
	s.character.currency.gp = 0;
	const { gig, text } = offerGig(s, HEIST, "gig_1");
	assert.equal(gig.status, "offered");
	assert.equal(gig.expiresAt, gameMinutes(s.time) + 3 * DAY);
	assert.match(text, /800 cred, Hat -1, Heat \+2, risk 3\/5/);
	assert.equal(takeGig(s, "gig_1").gig.status, "taken");
	assert.throws(() => takeGig(s, "gig_1"), /not on offer/);
	const done = completeGig(s, "gig_1", "done", "clean job");
	assert.equal(done.paid, 800);
	assert.equal(done.cut, 0);
	assert.equal(s.character.currency.gp, 800);
	assert.equal(cy.hat, -1);
	assert.equal(cy.heat, 2);
	assert.equal(gig.status, "done");
	assert.throws(() => completeGig(s, "gig_1", "done"), /already done/);
});

test("while in debt La Tía takes 25% of the pay toward the debt (never more than is owed)", () => {
	const s = cyberState();
	const den = s.cyber!.den!;
	den.debt = 400;
	s.character.currency.gp = 0;
	offerGig(s, HEIST, "g1");
	const r = completeGig(s, "g1", "done");
	assert.equal(r.cut, 200);
	assert.equal(r.paid, 600);
	assert.equal(den.debt, 200);
	assert.match(r.text, /La Tía took her 25%/);
	assert.match(den.log.join("\n"), /La Tía took 200/);
	offerGig(s, { ...HEIST, pay: 2000 }, "g2");
	const r2 = completeGig(s, "g2", "done");
	assert.equal(r2.cut, 200, "only what's owed");
	assert.equal(den.debt, 0);
	assert.equal(s.character.currency.gp, 600 + 1800);
});

test("a failed gig pays nothing, leaves the Hat and still makes half the noise", () => {
	const s = cyberState();
	const cy = s.cyber!;
	cy.heat = 0;
	s.character.currency.gp = 0;
	offerGig(s, { ...HEIST, heat: 3 }, "g1");
	takeGig(s, "Lift the Halcón payroll");
	const r = failGig(s, "g1", "the guard looked up");
	assert.equal(r.gig.status, "failed");
	assert.equal(s.character.currency.gp, 0);
	assert.equal(cy.hat, 0);
	assert.equal(cy.heat, 2);
	assert.match(r.text, /FAILED/);
});

test("offers expire on the tick; taken gigs wait for the DM", () => {
	const s = cyberState();
	offerGig(s, HEIST, "g1"); // 3 days
	offerGig(s, LEAK, "g2"); // 5 days
	offerGig(s, { ...LEAK, title: "Taken one", days: 1 }, "g3");
	takeGig(s, "g3");
	pass(s, 3 * DAY);
	const line = gigTick(s) ?? "";
	assert.match(line, /Lift the Halcón payroll/);
	assert.equal(findGig(s, "g1")!.status, "expired");
	assert.equal(findGig(s, "g2")!.status, "offered");
	assert.equal(findGig(s, "g3")!.status, "taken");
	assert.equal(gigTick(s), undefined, "nothing new");
	assert.deepEqual(openGigs(s.cyber!.gigs).map((g) => g.id).sort(), ["g2", "g3"]);
});

test("clamps, kinds, a cap on open offers and a short history", () => {
	const s = cyberState();
	const { gig } = offerGig(s, { ...HEIST, hat: -9, heat: 12, risk: 0, pay: -5, days: 99 }, "g0");
	assert.equal(gig.hat, -3);
	assert.equal(gig.heat, 4);
	assert.equal(gig.risk, 1);
	assert.equal(gig.pay, 0);
	assert.throws(() => offerGig(s, { ...HEIST, kind: "murder" as never }, "gx"), /Unknown gig kind/);
	assert.throws(() => offerGig(s, { ...HEIST, title: " " }, "gx"), /title/);
	for (let i = 1; i < MAX_OPEN_GIGS; i++) offerGig(s, HEIST, `g${i}`);
	assert.throws(() => offerGig(s, HEIST, "too-many"), /open gigs/);
	for (let i = 0; i < MAX_OPEN_GIGS; i++) completeGig(s, `g${i}`, "failed");
	for (let k = 0; k < 3; k++) {
		for (let i = 0; i < MAX_OPEN_GIGS; i++) offerGig(s, HEIST, `h${k}-${i}`);
		for (let i = 0; i < MAX_OPEN_GIGS; i++) completeGig(s, `h${k}-${i}`, "failed");
	}
	assert.ok(s.cyber!.gigs!.length <= GIG_HISTORY);
	assert.throws(() => completeGig(s, "nope", "done"), /No gig/);
});

test("gig tools: offer, take, complete; the digest and the gig board line", async () => {
	const id = newGame("marea_burned");
	edit(id, (s) => {
		s.character.currency.gp = 0;
		s.cyber!.heat = 0;
		s.cyber!.den!.debt = 100;
	});
	const o = await call(id, "offer_gig", { ...LEAK });
	assert.ok(!o.isError, o.text);
	const gid = /Gig offered: (gig_\S+)/.exec(o.text)![1];
	assert.match(m.digest.stateDigest(m.loadState(id)), /Gigs on offer: gig_\S+ "Leak the water-cut memo"/);
	assert.ok(!(await call(id, "take_gig", { gig: "water-cut" })).isError);
	assert.match(gigDigest(m.loadState(id))!, /Gigs taken/);
	const c = await call(id, "complete_gig", { gig: gid, outcome: "done", why: "posted on the free mesh" });
	assert.ok(!c.isError, c.text);
	const s = m.loadState(id);
	assert.equal(s.character.currency.gp, 300 - 75);
	assert.equal(s.cyber!.den!.debt, 25);
	assert.equal(s.cyber!.hat, 2);
	assert.equal(s.cyber!.heat, 1);
	assert.equal(gigDigest(s), undefined);
	assert.ok((await call(id, "take_gig", { gig: "nothing like this" })).isError);
});

test("fantasy and zombie: gig tools refuse, nothing is created, digests unchanged", async () => {
	for (const [preset, cls, sp] of [["classic_high_fantasy", "rogue", "human"], ["zombie_outbreak", "fighter", "z-origin-streetwise"]] as const) {
		const id = newGame(preset, cls, sp);
		for (const [name, args] of [["offer_gig", { ...HEIST }], ["take_gig", { gig: "x" }], ["complete_gig", { gig: "x", outcome: "failed", why: "" }]] as const) {
			const r = await call(id, name, args);
			assert.ok(r.isError, `${preset} ${name}`);
		}
		const s = m.loadState(id);
		assert.equal(s.cyber, undefined);
		assert.equal(gigTick(s), undefined);
		assert.doesNotMatch(m.digest.stateDigest(s), /Gigs|Den:/);
	}
});
