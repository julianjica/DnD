import { clientState } from "../game/client";
import { syncSpellTokens } from "./spellTokens";
import { isZombie, survivalOf, tick as survivalTick } from "../rules/survival";
import type { DmTool, GameState, JsonSchema, RollRecord, ToolResult } from "../game/types";
import { mutate } from "../store/campaigns";
import { Rng } from "../rules/dice";
import { groupTick } from "../rules/group";
import { townTick } from "../rules/town";
import { addInventoryItem } from "./items";

/** Events streamed to the browser during a turn (SSE). */
export type ClientEvent =
	| { type: "text"; delta: string }
	| { type: "thinking"; delta: string }
	| { type: "roll"; roll: RollRecord }
	| { type: "tool"; id: string; name: string; status: "start" | "end"; summary?: string; isError?: boolean }
	| { type: "state"; state: GameState }
	| { type: "fx"; fx: FxEvent }
	| { type: "player"; text: string }
	| { type: "error"; message: string }
	| { type: "done" };

/** Transient visual/audio effects for the UI (floating damage, sfx). */
export type FxEvent =
	| { kind: "damage"; entityId?: string; amount: number; crit?: boolean }
	| { kind: "heal"; entityId?: string; amount: number }
	| { kind: "miss"; entityId?: string }
	| { kind: "sfx"; sound: string }
	| { kind: "level_up"; level: number };

export interface ToolContext {
	campaignId: string;
	emit: (event: ClientEvent) => void;
	/** Rolls recorded during this turn (also logged). */
	rolls: RollRecord[];
	/** suggest_actions already called this turn. */
	suggested?: boolean;
}

export interface StateTxn {
	state: GameState;
	rng: Rng;
	roll: (r: RollRecord) => void;
	fx: (fx: FxEvent) => void;
}

/**
 * Runs a state mutation with an Rng bound to state.rng, then pushes the
 * new state and any rolls to the client.
 */
export async function withState<T>(ctx: ToolContext, fn: (tx: StateTxn) => T | Promise<T>): Promise<T> {
	const rolls: RollRecord[] = [];
	const fxs: FxEvent[] = [];
	let snapshot: GameState | undefined;
	const result = await mutate(ctx.campaignId, async (state) => {
		const rng = new Rng(state.rng);
		// The Quiet: the survival clock starts before the mutation, so time it advances counts.
		if (isZombie(state)) survivalOf(state);
		let out = await fn({ state, rng, roll: (r) => rolls.push(r), fx: (f) => fxs.push(f) });
		const zombie = isZombie(state);
		const note = [
			syncSpellTokens(state),
			zombie ? survivalTick(state, rng) : undefined,
			// After the player's tick: companions eat after the player; errands come back.
			zombie ? groupTick(state, rng, (s, item) => void addInventoryItem(s, item, () => newId("it"))) : undefined,
			// The town moves on: factions at night, hordes drifting between places.
			zombie ? townTick(state, rng) : undefined,
		]
			.filter(Boolean)
			.join("\n");
		if (note && typeof out === "string") out = `${out}\n${note}` as typeof out;
		state.rng = rng.state;
		snapshot = state;
		return out;
	});
	for (const r of rolls) {
		ctx.rolls.push(r);
		ctx.emit({ type: "roll", roll: r });
	}
	for (const f of fxs) ctx.emit({ type: "fx", fx: f });
	if (snapshot) ctx.emit({ type: "state", state: clientState(snapshot) });
	return result;
}

export type ToolFactory = (ctx: ToolContext) => DmTool;

export function tool<A extends Record<string, unknown>>(
	name: string,
	description: string,
	parameters: JsonSchema,
	run: (args: A, ctx: ToolContext) => Promise<string | ToolResult>,
): ToolFactory {
	return (ctx) => ({
		name,
		description,
		parameters,
		async execute(args) {
			try {
				const out = await run(args as A, ctx);
				return typeof out === "string" ? { text: out } : out;
			} catch (error) {
				return { text: error instanceof Error ? error.message : String(error), isError: true };
			}
		},
	});
}

// Tiny JSON-schema helpers to keep tool definitions readable.
export const S = {
	obj(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
		return { type: "object", properties, required, additionalProperties: false };
	},
	str(description?: string, enumValues?: readonly string[]): JsonSchema {
		return { type: "string", ...(description ? { description } : {}), ...(enumValues ? { enum: [...enumValues] } : {}) };
	},
	int(description?: string, min?: number, max?: number): JsonSchema {
		return { type: "integer", ...(description ? { description } : {}), ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) };
	},
	num(description?: string): JsonSchema {
		return { type: "number", ...(description ? { description } : {}) };
	},
	bool(description?: string): JsonSchema {
		return { type: "boolean", ...(description ? { description } : {}) };
	},
	arr(items: JsonSchema, description?: string): JsonSchema {
		return { type: "array", items, ...(description ? { description } : {}) };
	},
};

let idCounter = 0;
export function newId(prefix: string): string {
	idCounter = (idCounter + 1) % 1e6;
	return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
