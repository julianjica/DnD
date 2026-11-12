import { test } from "node:test";
import assert from "node:assert/strict";
import { clientState } from "../lib/game/client";
import type { GameState, NetRun } from "../lib/game/types";

test("net run secrets stay on the server until a node is opened", () => {
	const run: NetRun = {
		id: "r1", target: "Vantis lab 7", security: 3, body: "den", netMapId: "m", trace: 2, proxy: 0, sysadminAlerted: false, securityDispatched: false, startedAt: 0, log: ["dm only"],
		nodes: [
			{ id: "n1", kind: "entry", name: "Port", roomId: "a", open: true },
			{ id: "n2", kind: "data", name: "Payroll", roomId: "b", open: false, holds: "the shard key" },
			{ id: "n3", kind: "honeypot", name: "Trap", roomId: "c", open: false, disguise: "Backups", holds: "nothing" },
			{ id: "n4", kind: "vault", name: "Vault", roomId: "d", open: true, holds: "LAZARUS files" },
		],
	};
	// Only the fields clientState touches matter here.
	const state = { npcs: {}, dmNotes: [], cyber: { hat: 0, heat: 0, humanity: 20, humanityMax: 20, implants: [], history: [], run } } as unknown as GameState;
	const out = clientState(state).cyber!.run!;
	assert.equal(out.nodes[1].holds, undefined);
	assert.deepEqual({ kind: out.nodes[2].kind, name: out.nodes[2].name, holds: out.nodes[2].holds }, { kind: "data", name: "Backups", holds: undefined });
	assert.equal(out.nodes[3].holds, "LAZARUS files", "opened nodes show what they held");
	assert.deepEqual(out.log, []);
	assert.equal(state.cyber!.run!.nodes[1].holds, "the shard key", "the server state is untouched");
});
