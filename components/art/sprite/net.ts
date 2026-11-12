/**
 * Root Access net runs (docs/cyberpunk.md §4, §8): the look of cyberspace for
 * maps with GridMap.theme === "net". Pure data and helpers only (no DOM), so
 * they are testable; the canvas painting lives in ./netPaint.
 *
 * Three style options were drawn for the user to pick from (/dev/net).
 * NET_STYLE is the one the game uses: switching is a one-line change.
 */
import type { GridMap, NetNodeKind, NetRun, Tile } from "@/lib/game/types";
import { SECURITY_AT, SYSADMIN_AT, TRACE_MAX } from "@/lib/rules/netrun";

export type NetStyleId = "A" | "B" | "C";

/** The net style the game draws with. A: green terminal, B: synthwave, C: blueprint. */
export const NET_STYLE: NetStyleId = "B";

export const NET_NODE_KINDS: readonly NetNodeKind[] = ["entry", "firewall", "data", "control", "admin", "vault", "honeypot"];

/** [main glow, dim] colours. */
export type Glow = [string, string];

export interface NetPalette {
	id: NetStyleId;
	label: string;
	/** Empty net: field, data dust, grid lines (every square / every 4th). */
	bg: string;
	dust: string;
	grid: string;
	gridMajor: string;
	/** Corridors: lane fill, the data line, its bright core, travelling packets. */
	lane: string;
	trace: string;
	traceHi: string;
	packet: string;
	/** Inside a node. */
	nodeFloor: string;
	/** Per node kind. A honeypot uses the data colours until it is sprung. */
	node: Record<Exclude<NetNodeKind, "honeypot">, Glow>;
	/** A closed gate / a sprung trap. */
	danger: Glow;
	/** What the runner owns (open nodes light up in it) and the runner's avatar [line, fill]. */
	mine: Glow;
	/** Other people in the net (rival deckers) [line, fill]. */
	other: Glow;
	/** The sysadmin [line, fill]. */
	sysadmin: Glow;
	/** ICE: [bright, body, halo] per colour. */
	ice: { white: [string, string, string]; grey: [string, string, string]; black: [string, string, string] };
	/** Black ICE eyes. */
	eye: string;
	/** Scanline darkness (0 = none). */
	scan: number;
}

export const NET_PALETTES: Record<NetStyleId, NetPalette> = {
	// A · green phosphor terminal: one-colour CRT with amber/red for danger.
	A: {
		id: "A",
		label: "Terminal",
		bg: "#020904",
		dust: "#0d3318",
		grid: "#08200f",
		gridMajor: "#0f3a1b",
		lane: "#04140a",
		trace: "#1f9c4a",
		traceHi: "#7dffad",
		packet: "#d8ffe6",
		nodeFloor: "#031208",
		node: {
			entry: ["#7dffad", "#1c6b38"],
			firewall: ["#ffb03a", "#7a4a12"],
			data: ["#3dff86", "#16602f"],
			control: ["#b6ff5c", "#4a7a1e"],
			admin: ["#e6fff0", "#4f8a63"],
			vault: ["#f2ff6b", "#6e7a1c"],
		},
		danger: ["#ff4a3a", "#7a1a14"],
		mine: ["#62e6ff", "#0d4a5c"],
		other: ["#c9d6cf", "#3a4a42"],
		sysadmin: ["#ffb03a", "#5c3a0c"],
		ice: { white: ["#f2fff6", "#b9e8c8", "#2f6b44"], grey: ["#9fb8a8", "#5c7266", "#26362d"], black: ["#ff3b30", "#0a0303", "#5c0c08"] },
		eye: "#ff6a3a",
		scan: 0.16,
	},
	// B · synthwave: deep violet field, magenta grid, cyan data, hot pink danger.
	B: {
		id: "B",
		label: "Synthwave",
		bg: "#0c0220",
		dust: "#3a1166",
		grid: "#24074a",
		gridMajor: "#4a0f7a",
		lane: "#14043a",
		trace: "#c13cff",
		traceHi: "#ff9cf7",
		packet: "#ffffff",
		nodeFloor: "#10032c",
		node: {
			entry: ["#2de2e6", "#0f5560"],
			firewall: ["#ff3864", "#6e1030"],
			data: ["#2de2e6", "#11506a"],
			control: ["#f9c80e", "#6a4f08"],
			admin: ["#b967ff", "#4a1c78"],
			vault: ["#ffd319", "#7a5a0a"],
		},
		danger: ["#ff2a6d", "#6e0c2c"],
		mine: ["#05ffa1", "#06573e"],
		other: ["#d6c8ff", "#3e2e6a"],
		sysadmin: ["#ff6c11", "#5e2406"],
		ice: { white: ["#ffffff", "#e3d6ff", "#5a3a9a"], grey: ["#b9a9d6", "#6e5c94", "#2e2050"], black: ["#ff2a6d", "#08010f", "#5a0a2a"] },
		eye: "#ffe600",
		scan: 0.06,
	},
	// C · cold blueprint: navy paper, pale-blue linework, white highlights.
	C: {
		id: "C",
		label: "Blueprint",
		bg: "#06152e",
		dust: "#16345e",
		grid: "#0d2548",
		gridMajor: "#1b4278",
		lane: "#0a1d3c",
		trace: "#5fb4ff",
		traceHi: "#e2f3ff",
		packet: "#ffffff",
		nodeFloor: "#081a36",
		node: {
			entry: ["#bfe6ff", "#2f5f8f"],
			firewall: ["#ff8a5b", "#6e3220"],
			data: ["#7cc8ff", "#244f7e"],
			control: ["#9ef0e6", "#2a6a66"],
			admin: ["#ffffff", "#5276a0"],
			vault: ["#ffd166", "#6e5520"],
		},
		danger: ["#ff5a4f", "#6a1c1c"],
		mine: ["#7dffcf", "#185c4a"],
		other: ["#cfd9e6", "#3a4a60"],
		sysadmin: ["#ffb347", "#5c3a12"],
		ice: { white: ["#ffffff", "#cfe6ff", "#3a6094"], grey: ["#9fb4cc", "#5a7090", "#24364e"], black: ["#ff4f6a", "#03060c", "#5a1020"] },
		eye: "#ff4f6a",
		scan: 0,
	},
};

export function netPalette(style: NetStyleId = NET_STYLE): NetPalette {
	return NET_PALETTES[style] ?? NET_PALETTES[NET_STYLE];
}

// ─── node state ─────────────────────────────────────────────────────────

/** The node kind a room tag names ("firewall", "net:vault", "data-2"…). */
export function nodeKindOfTag(tag: string | undefined): NetNodeKind | undefined {
	if (!tag) return undefined;
	const t = tag.toLowerCase();
	return NET_NODE_KINDS.find((k) => new RegExp(`(^|[^a-z])${k}([^a-z]|$)`).test(t));
}

export interface NetNodeState {
	kind: NetNodeKind;
	open: boolean;
}

/**
 * The kind and open state of each node room of a net map, keyed by room id.
 * The run (when it is this map's run) is the truth; without it, a tag like
 * "firewall:open" or a breached gate (door_open next to the room) says it.
 */
export function netNodeStates(map: Pick<GridMap, "id" | "rooms" | "tiles" | "width" | "height">, run?: Pick<NetRun, "netMapId" | "nodes">): Record<string, NetNodeState> {
	const out: Record<string, NetNodeState> = {};
	const fromRun = run && run.netMapId === map.id ? new Map(run.nodes.map((n) => [n.roomId, n])) : undefined;
	for (const r of map.rooms) {
		const node = fromRun?.get(r.id);
		const kind = node?.kind ?? nodeKindOfTag(r.tag);
		if (!kind) continue;
		let open = node ? node.open : /(^|[^a-z])(open|breached|owned|taken|sprung)([^a-z]|$)/i.test(r.tag ?? "");
		if (!node && !open && kind === "firewall") open = gatesAround(map, r).some((t) => t === "door_open");
		out[r.id] = { kind, open };
	}
	return out;
}

function gatesAround(map: Pick<GridMap, "tiles" | "width" | "height">, r: { x: number; y: number; w: number; h: number }): Tile[] {
	const out: Tile[] = [];
	const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < map.width && y < map.height ? map.tiles[y * map.width + x] : "void");
	for (let x = r.x; x < r.x + r.w; x++) out.push(at(x, r.y - 1), at(x, r.y + r.h));
	for (let y = r.y; y < r.y + r.h; y++) out.push(at(r.x - 1, y), at(r.x + r.w, y));
	return out.filter((t) => t === "door" || t === "door_open" || t === "door_locked");
}

/** Open nodes / all nodes of a run. */
export function nodesOpen(run: Pick<NetRun, "nodes">): { open: number; total: number } {
	return { open: run.nodes.filter((n) => n.open).length, total: run.nodes.length };
}

// ─── cells ──────────────────────────────────────────────────────────────

const DOORS = new Set<Tile>(["door", "door_open", "door_locked"]);
const SOLID = new Set<Tile>(["void", "wall", "building", "secret_door", "rock", "tree", "pillar", "deep_water", "lava", "pit"]);

export type NetCell =
	| { role: "void" }
	| { role: "lane" }
	| { role: "node"; roomId: string; kind: NetNodeKind; open: boolean; edge: number }
	| { role: "gate"; open: boolean; firewall: boolean; vertical: boolean };

/** Edge bits of a node square: which sides lie on the room's border. */
export const EDGE = { N: 1, E: 2, S: 4, W: 8 } as const;

/**
 * What each square of a net map is: empty net, a corridor (data line), part
 * of a node, or a gate (a door; a firewall's gate is closed until breached).
 * Secret doors stay hidden (drawn as empty net).
 */
export function netCells(map: Pick<GridMap, "id" | "rooms" | "tiles" | "width" | "height">, states: Record<string, NetNodeState>): NetCell[] {
	const W = map.width, H = map.height;
	const roomOf = new Array<string | undefined>(W * H);
	for (const r of map.rooms) {
		if (!states[r.id]) continue;
		for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) roomOf[y * W + x] = r.id;
	}
	const rooms = new Map(map.rooms.map((r) => [r.id, r]));
	const cells: NetCell[] = new Array(W * H);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const i = y * W + x;
			const t = map.tiles[i];
			const rid = roomOf[i];
			if (rid && !SOLID.has(t)) {
				const r = rooms.get(rid)!;
				const s = states[rid];
				const edge = (y === r.y ? EDGE.N : 0) | (x === r.x + r.w - 1 ? EDGE.E : 0) | (y === r.y + r.h - 1 ? EDGE.S : 0) | (x === r.x ? EDGE.W : 0);
				cells[i] = { role: "node", roomId: rid, kind: s.kind, open: s.open, edge };
			} else if (DOORS.has(t)) {
				const near = [roomOf[i - W], roomOf[i + W], x > 0 ? roomOf[i - 1] : undefined, x < W - 1 ? roomOf[i + 1] : undefined].filter((r): r is string => !!r);
				const fw = near.find((r) => states[r]?.kind === "firewall");
				const solidNS = y > 0 && y < H - 1 && SOLID.has(map.tiles[i - W]) && SOLID.has(map.tiles[i + W]);
				cells[i] = { role: "gate", firewall: !!fw, open: fw ? states[fw].open : t !== "door_locked", vertical: solidNS };
			} else if (SOLID.has(t)) cells[i] = { role: "void" };
			else cells[i] = { role: "lane" };
		}
	return cells;
}

/** The square at the middle of a room, where its node structure stands. */
export function nodeCenter(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
	return { x: r.x + Math.floor((r.w - 1) / 2), y: r.y + Math.floor((r.h - 1) / 2) };
}

// ─── sprites ────────────────────────────────────────────────────────────

/**
 * A 16×16 pixel sprite. Keys: M main, m dim, H highlight (open nodes light it
 * in the runner's colour), b dark fill, "." clear. ICE keys: W bright, w body,
 * h halo, E eye, T tooth, Y spark, n shadow.
 */
export interface NetSprite {
	rows: string[];
}

const s = (...rows: string[]): NetSprite => ({ rows });

/** Firewall: a glowing brick wall with flames on top; breached, a hole is torn through it. */
function firewallRows(breached: boolean): string[] {
	const rows: string[] = [];
	for (let y = 0; y < 16; y++) {
		let row = "";
		for (let x = 0; x < 16; x++) {
			let ch = ".";
			if (y <= 2) ch = (x + (y === 1 ? 1 : 0)) % 3 === 0 && y + ((x * 7) % 3) >= 2 ? "H" : ".";
			else if (y >= 3 && y <= 14) {
				const band = Math.floor((y - 3) / 3);
				ch = (y - 3) % 3 === 0 ? "M" : (x + (band % 2) * 3) % 6 === 0 ? "M" : "m";
			}
			if (breached) {
				const dx = x - 7.5, dy = y - 9;
				const d = (dx * dx) / 20 + (dy * dy) / 26;
				if (y <= 2) ch = ".";
				else if (d < 1) ch = ".";
				else if (d < 1.45 && ch !== ".") ch = "H";
			}
			row += ch;
		}
		rows.push(row);
	}
	return rows;
}

export const NODE_SPRITES: Record<"entry" | "firewall" | "firewall_open" | "data" | "data_open" | "control" | "admin" | "vault" | "vault_open", NetSprite> = {
	// a port: an arrow dropping into a socket
	entry: s(
		"................",
		"......HHHH......",
		"......HHHH......",
		"......HHHH......",
		"...HHHHHHHHHH...",
		"....HHHHHHHH....",
		".....HHHHHH.....",
		"......HHHH......",
		".......HH.......",
		"................",
		".MMM........MMM.",
		".Mbb........bbM.",
		".Mb.mmmmmmmm.bM.",
		".MbbbbbbbbbbbbM.",
		".MMMMMMMMMMMMMM.",
		"................",
	),
	firewall: { rows: firewallRows(false) },
	firewall_open: { rows: firewallRows(true) },
	// stacked storage disks with blinking lights
	data: s(
		"................",
		"....MMMMMMMM....",
		"...MHHHHHHHHM...",
		"...MMMMMMMMMM...",
		"...MbbbHbbbbM...",
		"...mMMMMMMMMm...",
		"...MbbbbbHbbM...",
		"...mMMMMMMMMm...",
		"...MbbHbbbbbM...",
		"...mMMMMMMMMm...",
		"...MbbbbbbHbM...",
		"....MMMMMMMM....",
		"................",
		"..m.m.m..m.m.m..",
		"................",
		"................",
	),
	// read: the disks are drained, lights out, the top cap hollow
	data_open: s(
		"................",
		"....MMMMMMMM....",
		"...Mb......bM...",
		"...MMMMMMMMMM...",
		"...MbbbbbbbbM...",
		"...mMMMMMMMMm...",
		"...MbbbbbbbbM...",
		"...mMMMMMMMMm...",
		"...MbbbbbbbbM...",
		"...mMMMMMMMMm...",
		"...MbbbbbbbbM...",
		"....MMMMMMMM....",
		"................",
		"......HHHH......",
		"................",
		"................",
	),
	// a console: screen with a trace, keys below
	control: s(
		"................",
		"..MMMMMMMMMMMM..",
		"..MbbbbbbbbbbM..",
		"..MbHHbbbHbbbM..",
		"..MbbbHbHbHbbM..",
		"..MbbbbHbbbHbM..",
		"..MbbbbbbbbbbM..",
		"..MMMMMMMMMMMM..",
		"......MMMM......",
		"...MMMMMMMMMM...",
		"..MbHbbHbbHbbM..",
		"..MbbmbbmbbmbM..",
		".MMMMMMMMMMMMMM.",
		"................",
		"................",
		"................",
	),
	// root: a chip with a crown
	admin: s(
		"................",
		"...m.m.mm.m.m...",
		"...m.m.mm.m.m...",
		"..MMMMMMMMMMMM..",
		"mmMbbbbbbbbbbMmm",
		"..MbHbbHHbbHbM..",
		"mmMbHHHHHHHHbMmm",
		"..MbHHHHHHHHbM..",
		"mmMbbbbbbbbbbMmm",
		"..MbbmmmmmmbbM..",
		"mmMbbbbbbbbbbMmm",
		"..MMMMMMMMMMMM..",
		"...m.m.mm.m.m...",
		"...m.m.mm.m.m...",
		"................",
		"................",
	),
	// the objective: a vault door with a dial
	vault: s(
		"................",
		".MMMMMMMMMMMMMM.",
		".MmmmmmmmmmmmmM.",
		".MmbbbbbbbbbbmM.",
		".MmbbbbHHbbbbmM.",
		".MmbbbHbbHbbbmM.",
		".MmMbHbHHbHbMmM.",
		".MmMbHbHHbHbMmM.",
		".MmbbbHbbHbbbmM.",
		".MmbbbbHHbbbbmM.",
		".MmbbbbbbbbbbmM.",
		".MmmmmmmmmmmmmM.",
		".MMMMMMMMMMMMMM.",
		"..mm........mm..",
		"................",
		"................",
	),
	// opened: the door swung aside, the prize glinting inside
	vault_open: s(
		"................",
		".MMMMMMMMMMMMMM.",
		".MmmmmmmmmmMMmM.",
		".MmbbbbbbbbMHmM.",
		".MmbbbbHbbbMHmM.",
		".MmbbbHHHbbMHmM.",
		".MmbbHHHHHbMHmM.",
		".MmbbbHHHbbMHmM.",
		".MmbbbbHbbbMHmM.",
		".MmbbbbbbbbMHmM.",
		".MmbbbbbbbbMHmM.",
		".MmmmmmmmmmMMmM.",
		".MMMMMMMMMMMMMM.",
		"..mm........mm..",
		"................",
		"................",
	),
};

/** The node sprite for a kind and state. A honeypot is drawn as data. */
export function nodeSpriteKey(kind: NetNodeKind, open: boolean): keyof typeof NODE_SPRITES {
	switch (kind) {
		case "entry": return "entry";
		case "firewall": return open ? "firewall_open" : "firewall";
		case "data": return open ? "data_open" : "data";
		case "honeypot": return "data";
		case "control": return "control";
		case "admin": return "admin";
		case "vault": return open ? "vault_open" : "vault";
	}
}

export type IceKind = "ice_white" | "ice_grey" | "ice_black";

export const ICE_SPRITES: Record<IceKind, NetSprite> = {
	// white ICE (watchdog, barrier): a floating sentinel diamond with a scanning eye
	ice_white: s(
		"................",
		".......hh.......",
		"......hWWh......",
		".....hWwwWh.....",
		"....hWwwwwWh....",
		"...hWwwKKwwWh...",
		"..hWwwKEEKwwWh..",
		".hWwwwKEEKwwwWh.",
		"..hWwwwKKwwwWh..",
		"...hWwwwwwwWh...",
		"....hWwwwwWh....",
		".....hWwwWh.....",
		"......hWWh......",
		".......hh.......",
		"................",
		".....nnnnnn.....",
	),
	// grey ICE (sparky, tar pit): a spiked core crackling with a bolt
	ice_grey: s(
		".......WW.......",
		"..W....WW....W..",
		"...W.hhhhhh.W...",
		"....hwwwwwwh....",
		"...hwwwwwYwwh...",
		"..hwwwwwYYwwwh..",
		"WWhwwwwYYwwwwhWW",
		"WWhwwwYYYYwwwhWW",
		"..hwwwwYYwwwwh..",
		"..hwwwYYwwwwwh..",
		"...hwwYwwwwwh...",
		"....hwwwwwwh....",
		"...W.hhhhhh.W...",
		"..W....WW....W..",
		".......WW.......",
		"....nnnnnnnn....",
	),
	// black ICE (hellhound, wraith): a horned black skull, red-rimmed, with burning eyes
	ice_black: s(
		"................",
		".W............W.",
		".WW..........WW.",
		".WwW........WwW.",
		".WwwWWWWWWWWwwW.",
		"WwwwwwwwwwwwwwwW",
		"WwwEEEwwwwEEEwwW",
		"WwwwEEwwwwEEwwwW",
		"WwwwwwwwwwwwwwwW",
		".WwwwwwWWwwwwwW.",
		".WwwwwW..WwwwwW.",
		"..WwwwwwwwwwwW..",
		"..WwTwTwwTwTwW..",
		"...WwwwwwwwwW...",
		"....WWWWWWWW....",
		"...nnnnnnnnnn...",
	),
};

/** Which ICE sprite a token hint means, if any ("ice_black", "hellhound", "Watchdog ICE"). */
export function iceKindOf(hint: string | undefined): IceKind | undefined {
	const h = (hint ?? "").toLowerCase();
	if (/ice_black|black[\s_-]?ice|hellhound|wraith/.test(h)) return "ice_black";
	if (/ice_gr[ae]y|gr[ae]y[\s_-]?ice|sparky|tar[\s_-]?pit/.test(h)) return "ice_grey";
	if (/ice_white|white[\s_-]?ice|watchdog|barrier/.test(h)) return "ice_white";
	if (/(^|[^a-z])ice([^a-z]|$)/.test(h)) return "ice_grey";
	return undefined;
}

/** Whether a token hint is the sysadmin (a human rival in the net). */
export function isSysadmin(hint: string | undefined): boolean {
	return /sysadmin|sys[\s_-]admin/.test((hint ?? "").toLowerCase());
}

// ─── avatars ────────────────────────────────────────────────────────────

export function rgbOf(c: string): [number, number, number] {
	const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
	if (!m) return [128, 128, 128];
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Turns a 16×16 RGBA person sprite into a net avatar: a wireframe of the same
 * silhouette (bright edge pixels), a translucent body that keeps a hint of the
 * original shading, and scanlines. Soft shadow pixels are dropped.
 */
export function avatarizePixels(src: Uint8ClampedArray, line: string, fill: string): Uint8ClampedArray {
	const out = new Uint8ClampedArray(16 * 16 * 4);
	const L = rgbOf(line), F = rgbOf(fill);
	const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && src[(y * 16 + x) * 4 + 3] >= 200;
	for (let y = 0; y < 16; y++)
		for (let x = 0; x < 16; x++) {
			if (!solid(x, y)) continue;
			const i = (y * 16 + x) * 4;
			const edge = !solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1);
			if (edge) {
				out.set([L[0], L[1], L[2], 255], i);
				continue;
			}
			// a dark translucent body crossed by wire rows, keeping a hint of the shading (face, belt, boots)
			const lum = (src[i] * 0.3 + src[i + 1] * 0.59 + src[i + 2] * 0.11) / 255;
			const k = y % 3 === 0 ? 0.6 : lum * 0.3;
			const mix = (a: number, b: number) => Math.round(a + (b - a) * k);
			out.set([mix(F[0], L[0]), mix(F[1], L[1]), mix(F[2], L[2]), y % 3 === 0 ? 235 : 200], i);
		}
	return out;
}

/** Derezzed (dead) in the net: every other pixel of a sprite, faded. */
export function derezPixels(src: Uint8ClampedArray): Uint8ClampedArray {
	const out = new Uint8ClampedArray(src.length);
	for (let y = 0; y < 16; y++)
		for (let x = 0; x < 16; x++) {
			const i = (y * 16 + x) * 4;
			if ((x + y) % 2 || src[i + 3] < 100) continue;
			out.set([src[i], src[i + 1], src[i + 2], Math.round(src[i + 3] * 0.45)], i);
		}
	return out;
}

// ─── trace ──────────────────────────────────────────────────────────────

/** Trace milestones (docs/cyberpunk.md §4): the sysadmin joins, security goes to the body, the runner is dumped. */
export const TRACE_MARKS = [
	{ at: SYSADMIN_AT, id: "sysadmin" },
	{ at: SECURITY_AT, id: "security" },
	{ at: TRACE_MAX, id: "dumped" },
] as const;

/** How hot the trace is: calm below 5, alerted from 5, hunted from 8, dumped at 10. */
export function traceBand(trace: number): "calm" | "alerted" | "hunted" | "dumped" {
	if (trace >= TRACE_MAX) return "dumped";
	if (trace >= SECURITY_AT) return "hunted";
	if (trace >= SYSADMIN_AT) return "alerted";
	return "calm";
}
