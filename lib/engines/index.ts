import type { DmEngine, EngineProvider } from "../game/types";
import { ApiEngine } from "./api";
import { ClaudeCodeEngine } from "./claude-code";
import { CodexEngine } from "./codex";

/**
 * Engine singletons (anchored on globalThis so Next's HMR re-imports do not
 * create duplicates). Engines hold no per-turn state; the ledger / history
 * files are the persistent state.
 */
const KEY = Symbol.for("dh.engines");

type Registry = Partial<Record<EngineProvider, DmEngine>>;

function registry(): Registry {
	const g = globalThis as typeof globalThis & { [KEY]?: Registry };
	g[KEY] ??= {};
	return g[KEY];
}

export function getEngine(provider: EngineProvider): DmEngine {
	const r = registry();
	switch (provider) {
		case "claude-code":
			return (r["claude-code"] ??= new ClaudeCodeEngine());
		case "codex":
			return (r.codex ??= new CodexEngine());
		case "api":
			return (r.api ??= new ApiEngine());
		default:
			throw new Error(`Unknown engine provider: ${String(provider)}`);
	}
}

/** Test seam: replace or clear an engine singleton. */
export function setEngine(provider: EngineProvider, engine: DmEngine | undefined): void {
	const r = registry();
	if (engine) r[provider] = engine;
	else delete r[provider];
}

export { ApiEngine } from "./api";
export { ClaudeCodeEngine } from "./claude-code";
export { CodexEngine } from "./codex";
export { engineStatus, listModels, type EngineStatus } from "./catalog";
export { deleteApiKey, hasApiKey, listKeyStatuses, saveApiKey, API_KEY_PROVIDERS, type ApiKeyStatus } from "./keys";
export { planLimits, type PlanLimitsSnapshot } from "./plan-limits";
