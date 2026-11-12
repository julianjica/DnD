import { test } from "node:test";
import assert from "node:assert/strict";
import type { NetNode } from "../lib/game/types";
import { buildNetMap } from "../lib/rules/netrun";
import {
	avatarizePixels,
	derezPixels,
	ICE_SPRITES,
	iceKindOf,
	isSysadmin,
	NET_NODE_KINDS,
	NET_PALETTES,
	NET_STYLE,
	netCells,
	netNodeStates,
	NODE_SPRITES,
	nodeKindOfTag,
	nodesOpen,
	nodeSpriteKey,
	traceBand,
} from "../components/art/sprite/net";

const nodes = (): NetNode[] => [
	{ id: "a", kind: "entry", name: "Router", roomId: "", open: true },
	{ id: "b", kind: "firewall", name: "Wall", roomId: "", open: false },
	{ id: "c", kind: "data", name: "DB", roomId: "", open: false },
	{ id: "d", kind: "honeypot", name: "Mail", roomId: "", open: false, disguise: "Mail" },
	{ id: "e", kind: "vault", name: "Vault", roomId: "", open: false },
];

test("net sprites are 16×16", () => {
	for (const [k, s] of Object.entries({ ...NODE_SPRITES, ...ICE_SPRITES })) {
		assert.equal(s.rows.length, 16, k);
		for (const r of s.rows) assert.equal(r.length, 16, `${k}: ${r}`);
	}
});

test("every style has every colour, as hex", () => {
	assert.ok(NET_PALETTES[NET_STYLE]);
	for (const p of Object.values(NET_PALETTES)) {
		for (const k of NET_NODE_KINDS) if (k !== "honeypot") assert.match(p.node[k][0], /^#[0-9a-f]{6}$/i);
		for (const c of [p.bg, p.grid, p.trace, p.mine[0], p.ice.black[0], p.eye]) assert.match(c, /^#[0-9a-f]{6}$/i);
	}
});

test("room tags name node kinds", () => {
	assert.equal(nodeKindOfTag("firewall"), "firewall");
	assert.equal(nodeKindOfTag("net:vault"), "vault");
	assert.equal(nodeKindOfTag("data-2"), "data");
	assert.equal(nodeKindOfTag("boss"), undefined);
	assert.equal(nodeKindOfTag("database"), undefined);
});

test("node state: the run wins, else the map (tag or breached gate)", () => {
	const ns = nodes();
	const map = buildNetMap(ns, "t", 1);
	map.id = "m";
	const fw = ns[1];
	// no run: a closed firewall (locked door), honeypot posing as data
	let st = netNodeStates(map);
	assert.equal(st[fw.roomId].open, false);
	assert.equal(st[ns[3].roomId].kind, "data");
	// the map says breached once the door opens
	const i = map.tiles.indexOf("door_locked");
	assert.ok(i >= 0);
	map.tiles[i] = "door_open";
	assert.equal(netNodeStates(map)[fw.roomId].open, true);
	map.tiles[i] = "door_locked";
	// the run (for this map) is the truth
	ns[1].open = true;
	st = netNodeStates(map, { netMapId: "m", nodes: ns });
	assert.equal(st[fw.roomId].open, true);
	assert.equal(st[ns[3].roomId].kind, "honeypot");
	// another map's run is ignored
	assert.equal(netNodeStates(map, { netMapId: "other", nodes: ns })[fw.roomId].open, false);
});

test("cells: nodes, lanes, empty net, and the firewall's gate follows its state", () => {
	const ns = nodes();
	const map = buildNetMap(ns, "t", 1);
	map.id = "m";
	const gate = map.tiles.indexOf("door_locked");
	let cells = netCells(map, netNodeStates(map, { netMapId: "m", nodes: ns }));
	const g = cells[gate];
	assert.equal(g.role, "gate");
	assert.ok(g.role === "gate" && g.firewall && !g.open && g.vertical);
	assert.ok(cells.some((c) => c.role === "lane"));
	assert.ok(cells.some((c) => c.role === "void"));
	const r = map.rooms[0];
	const corner = cells[r.y * map.width + r.x];
	assert.ok(corner.role === "node" && corner.kind === "entry" && corner.edge === (1 | 8));
	ns[1].open = true;
	cells = netCells(map, netNodeStates(map, { netMapId: "m", nodes: ns }));
	assert.ok(cells[gate].role === "gate" && cells[gate].open);
});

test("node sprites by state; honeypots look like data", () => {
	assert.equal(nodeSpriteKey("honeypot", false), nodeSpriteKey("data", false));
	assert.equal(nodeSpriteKey("firewall", true), "firewall_open");
	assert.equal(nodeSpriteKey("vault", true), "vault_open");
	assert.notDeepEqual(NODE_SPRITES.firewall.rows, NODE_SPRITES.firewall_open.rows);
});

test("ICE and sysadmin token hints", () => {
	assert.equal(iceKindOf("ice_white"), "ice_white");
	assert.equal(iceKindOf("ice_grey"), "ice_grey");
	assert.equal(iceKindOf("ice_black"), "ice_black");
	assert.equal(iceKindOf("Hellhound"), "ice_black");
	assert.equal(iceKindOf("watchdog"), "ice_white");
	assert.equal(iceKindOf("goblin"), undefined);
	assert.equal(iceKindOf("sysadmin"), undefined);
	assert.ok(isSysadmin("sysadmin"));
	assert.ok(!isSysadmin("ice_black"));
});

test("avatar: silhouette edges glow, the shadow is dropped; derez thins it out", () => {
	const src = new Uint8ClampedArray(16 * 16 * 4);
	const put = (x: number, y: number, a: number) => src.set([200, 100, 50, a], (y * 16 + x) * 4);
	for (let y = 4; y < 9; y++) for (let x = 4; x < 9; x++) put(x, y, 255);
	put(1, 15, 64); // soft shadow
	const out = avatarizePixels(src, "#62e6ff", "#0d4a5c");
	const px = (x: number, y: number) => [...out.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
	assert.deepEqual(px(4, 4), [0x62, 0xe6, 0xff, 255]);
	assert.ok(px(6, 7)[3] > 0 && px(6, 7)[3] < 255);
	assert.equal(px(1, 15)[3], 0);
	assert.equal(px(0, 0)[3], 0);
	const d = derezPixels(out);
	assert.equal(d[(4 * 16 + 4) * 4 + 3], Math.round(255 * 0.45));
	assert.equal(d[(4 * 16 + 5) * 4 + 3], 0);
});

test("trace bands and nodes open", () => {
	assert.equal(traceBand(0), "calm");
	assert.equal(traceBand(4), "calm");
	assert.equal(traceBand(5), "alerted");
	assert.equal(traceBand(8), "hunted");
	assert.equal(traceBand(10), "dumped");
	const ns = nodes();
	assert.deepEqual(nodesOpen({ nodes: ns }), { open: 1, total: 5 });
});
