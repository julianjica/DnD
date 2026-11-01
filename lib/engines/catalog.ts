import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelOption } from "../game/types";
import { claudeCodeAvailable, claudeCodeExecutable, cliVersion, codexAvailable, codexExecutable } from "./cli";
import { API_KEY_PROVIDERS, hasApiKey } from "./keys";
import { piModels } from "./pi-models";

/**
 * The model picker's catalog.
 *
 *   claude-code — current Claude ids Claude Code accepts by name; available
 *                 iff the CLI is found (sign-in is checked by the first turn).
 *   codex       — pi-ai's openai-codex catalog; available iff the CLI is found.
 *                 (The catalog comes from pi, not the installed CLI: a model
 *                 the CLI does not serve fails at turn time with Codex's error.)
 *   api         — pi-ai catalogs of the providers in keys.ts with a key (capped
 *                 at 40 each), plus a few `available: false` rows for the
 *                 flagship providers without a key (so the UI can ask for one).
 */

const CLAUDE_CODE_MODELS = [
	["claude-opus-5-5", "Claude Opus 5.5"],
	["claude-sonnet-5-5", "Claude Sonnet 5.5"],
	["claude-haiku-5-5", "Claude Haiku 5.5"],
	["claude-opus-5", "Claude Opus 5"],
	["claude-sonnet-5", "Claude Sonnet 5"],
] as const;

/** Per-provider cap for the API list (openrouter has ~400 models). */
const MAX_PER_PROVIDER = 40;
/** Providers shown (unavailable, a few models each) even without a key, so the UI can prompt for one. */
const FLAGSHIP_PROVIDERS = new Set(["anthropic", "openai", "openrouter", "google"]);
const MAX_WITHOUT_KEY = 5;

function claudeCodeOptions(): ModelOption[] {
	const available = claudeCodeAvailable();
	return CLAUDE_CODE_MODELS.map(([id, label]) => ({
		provider: "claude-code",
		id,
		label: `${label} (Claude Code)`,
		available,
		...(available ? {} : { reason: "Claude Code CLI not found (install it or set DH_CLAUDE_CODE_PATH)" }),
	}));
}

async function codexOptions(): Promise<ModelOption[]> {
	const available = codexAvailable();
	const models = (await piModels()).getModels("openai-codex");
	return models.map((m) => ({
		provider: "codex",
		id: m.id,
		label: `${m.name} (Codex)`,
		available,
		...(available ? {} : { reason: "Codex CLI not found (install it or set DH_CODEX_PATH)" }),
	}));
}

/** Chat-capable models, newest-looking first, capped. */
function pickApiModels(models: readonly Model<Api>[], max: number): Model<Api>[] {
	const usable = models.filter((m) => m.input.includes("text"));
	const sorted = [...usable].sort((a, b) => Number(b.reasoning) - Number(a.reasoning) || b.contextWindow - a.contextWindow || a.id.localeCompare(b.id));
	const chosen = sorted.slice(0, max);
	return chosen.sort((a, b) => a.name.localeCompare(b.name));
}

async function apiOptions(): Promise<ModelOption[]> {
	const models = await piModels();
	const out: ModelOption[] = [];
	for (const provider of API_KEY_PROVIDERS) {
		const available = hasApiKey(provider.id);
		if (!available && !FLAGSHIP_PROVIDERS.has(provider.id)) continue;
		for (const m of pickApiModels(models.getModels(provider.id), available ? MAX_PER_PROVIDER : MAX_WITHOUT_KEY)) {
			out.push({
				provider: "api",
				apiProvider: provider.id,
				id: m.id,
				label: `${m.name} (${provider.label})`,
				available,
				...(available ? {} : { reason: `No ${provider.label} API key` }),
			});
		}
	}
	return out;
}

/** Every model the picker can offer, grouped by engine then API provider. */
export async function listModels(): Promise<ModelOption[]> {
	const [codex, api] = await Promise.all([codexOptions(), apiOptions()]);
	return [...claudeCodeOptions(), ...codex, ...api];
}

export interface EngineStatus {
	claudeCode: { available: boolean; path?: string; version?: string };
	codex: { available: boolean; path?: string; version?: string };
	api: { providersWithKeys: string[] };
}

/** Which CLIs are found (+ versions) and which API providers have keys. */
export function engineStatus(): EngineStatus {
	const claudePath = claudeCodeExecutable();
	const codexPath = codexExecutable();
	return {
		claudeCode: { available: claudeCodeAvailable(), ...(claudePath ? { path: claudePath, version: cliVersion(claudePath) } : {}) },
		codex: { available: codexAvailable(), ...(codexPath ? { path: codexPath, version: cliVersion(codexPath) } : {}) },
		api: { providersWithKeys: API_KEY_PROVIDERS.filter((p) => hasApiKey(p.id)).map((p) => p.id) },
	};
}
