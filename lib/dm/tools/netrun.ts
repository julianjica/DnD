import type { NetNodeKind, NetRun } from "../../game/types";
import { isCyber } from "../../rules/cyber";
import { activeRun, jackIn, jackOut, MAX_NODES, MIN_NODES, NET_ACTIONS, netAction, NODE_KINDS, SYSADMIN_MONSTER, traceTick, type NetActionId, type NetNodeInput } from "../../rules/netrun";
import { S, tool, withState, type ToolFactory } from "../context";

/**
 * Root Access net runs for the DM (docs/cyberpunk.md §4; engine in
 * lib/rules/netrun.ts). Always in the tool list (a stable list keeps the DM's
 * session); they refuse outside cyberpunk campaigns.
 */

const notCyber = "This tool only exists in Root Access (cyberpunk-ruleset campaigns).";

export const jackInTool = tool<{ target: string; security: number; body: NetRun["body"]; nodes: NetNodeInput[] }>(
	"jack_in",
	`Root Access: the PC jacks into a system (needs a deck; the Wetwired hack by touch). The engine builds a NET MAP from your node list and makes it the active map; the body stays where it is (den = safe, public = a café or a port, onsite = inside the target's building: security can reach it). List ${MIN_NODES}–${MAX_NODES} nodes IN ORDER, exactly one entry. Order matters: the entry and each firewall are gates on the main line; the nodes listed after a firewall sit behind it (until the next firewall, itself behind the previous one), so put what the firewall protects after it. Kinds: entry (the way in), firewall (breach to pass), data (paydata, intel, keys: put what's there in holds), control (cameras, doors, turrets, lights, alarms, lifts: say what in controls; taking it changes the physical world), admin (root: −3 trace, ICE can be shut down), vault (the objective, in holds), honeypot (a trap posing as data: give it a believable disguise; touching it is +3 trace). Typical: a café router 3 nodes, security 1; an office 5–6, security 2–3; a lab or bank 7–10 with two firewalls, security 4–5. Node checks are d20 + hack bonus vs 10 + 2 × security. ICE guards are fought with start_combat on this map (c-ice-watchdog, c-ice-barrier, c-ice-sparky, c-ice-tarpit, c-ice-hellhound, c-ice-wraith); the sysadmin (${SYSADMIN_MONSTER}) comes when the trace reaches 5.`,
	S.obj(
		{
			target: S.str("The system: 'Vantis lab server 7', 'the Ferro precinct cameras'"),
			security: S.int("1 (a café's wifi) … 5 (a megacorp core)", 1, 5),
			body: S.str("Where the PC's body is while they run", ["den", "public", "onsite"]),
			nodes: S.arr(
					S.obj(
						{
							kind: S.str(undefined, NODE_KINDS as NetNodeKind[]),
							name: S.str("In-world label: 'Payroll DB', 'Lobby cameras', 'Research vault'"),
							controls: S.str("control nodes: what it changes physically ('the loading-bay doors')"),
							holds: S.str("data/vault: what's there (kept from the player until accessed)"),
							disguise: S.str("honeypot: the data it pretends to be ('Executive payroll')"),
						},
						["kind", "name"],
					),
					`${MIN_NODES}–${MAX_NODES} nodes in order, exactly one entry`,
				),
		},
		["target", "security", "body", "nodes"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return jackIn(state, { target: a.target, security: a.security, body: a.body, nodes: a.nodes }, rng);
		}),
);

export const netActionTool = tool<{ node: string; action: NetActionId }>(
	"net_action",
	"Root Access, during a run: the PC acts on a node (out of combat the engine walks the PC's token there if nothing blocks it; in a fight the PC must be at the node on their turn, and it takes their action). The engine rolls d20 + hack bonus vs 10 + 2 × security. Actions by node: breach (firewall; a failure is +2 trace; success opens the door past it), access (data: reveals what it holds), take_control (control: then NARRATE the physical effect, it really happens), take_admin (admin: −3 trace, ICE can be shut down), open_vault (vault: reveals the objective). Every node action is +1 trace on top. A honeypot looks like data: whatever the PC does to it springs it (+3 trace). Obey the trace lines it returns.",
	S.obj({ node: S.str("Node id ('n3') or name"), action: S.str(undefined, NET_ACTIONS as NetActionId[]) }, ["node", "action"]),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return netAction(state, a.node, a.action, rng, roll);
		}),
);

export const adjustTraceTool = tool<{ delta: number; why: string }>(
	"adjust_trace",
	"Root Access, during a run: move the trace for something the engine doesn't count: lingering, a sloppy move, a clever cover (−), a program's special effect. Node actions, programs and combat turns are counted automatically; don't double them. At 5 the sysadmin joins, at 8 security heads for an onsite body, at 10 the PC is dumped.",
	S.obj({ delta: S.int("−3…+3", -3, 3), why: S.str("Short reason: 'spent too long in the camera feed'") }, ["delta", "why"]),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			if (!activeRun(state)) throw new Error("The PC isn't jacked in.");
			return traceTick(state, a.delta, a.why, rng, roll).join("\n") || "No change.";
		}),
);

export const jackOutTool = tool<Record<string, never>>(
	"jack_out",
	"Root Access: the PC jacks out on purpose (an action in a fight; a fight on the net ends for them). The net map closes and the body's map comes back. Refused while the PC is grappled (Tar Pit ICE). A full trace dumps them automatically; don't call this for that.",
	S.obj({}),
	async (_a, ctx) =>
		withState(ctx, ({ state }) => {
			if (!isCyber(state)) throw new Error(notCyber);
			return jackOut(state);
		}),
);

export const NETRUN_TOOLS: ToolFactory[] = [jackInTool, netActionTool, adjustTraceTool, jackOutTool];
