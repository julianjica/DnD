import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config";

/**
 * API keys for the API engine (simplified from learnharness server/keys.ts).
 *
 * Stored in PATHS.keys as `{ "<providerId>": "<key>" }` with 0600 perms and
 * REFLECTED into process.env, because pi-ai resolves provider auth from
 * process.env at every request. Real environment variables always win: a
 * var already set at first load is never overwritten or deleted; the
 * status reports `source: "env"`. The CLI engines strip these vars from
 * their child env (cli.ts), so a saved key never changes how a plan is billed.
 */

export interface ApiKeyProvider {
	/** pi-ai provider id. */
	id: string;
	label: string;
	envVar: string;
}

/** pi-ai provider id → its env var (pi-ai's own table is internal). */
export const API_KEY_PROVIDERS: readonly ApiKeyProvider[] = [
	{ id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
	{ id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
	{ id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
	{ id: "google", label: "Google Gemini", envVar: "GEMINI_API_KEY" },
	{ id: "xai", label: "xAI", envVar: "XAI_API_KEY" },
	{ id: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY" },
	{ id: "deepseek", label: "DeepSeek", envVar: "DEEPSEEK_API_KEY" },
	{ id: "groq", label: "Groq", envVar: "GROQ_API_KEY" },
	{ id: "cerebras", label: "Cerebras", envVar: "CEREBRAS_API_KEY" },
	{ id: "together", label: "Together AI", envVar: "TOGETHER_API_KEY" },
	{ id: "fireworks", label: "Fireworks", envVar: "FIREWORKS_API_KEY" },
	{ id: "vercel-ai-gateway", label: "Vercel AI Gateway", envVar: "AI_GATEWAY_API_KEY" },
	{ id: "zai", label: "Z.ai", envVar: "ZAI_API_KEY" },
	{ id: "moonshotai", label: "Moonshot AI", envVar: "MOONSHOT_API_KEY" },
];

export interface ApiKeyStatus extends ApiKeyProvider {
	present: boolean;
	source: "env" | "file" | "none";
	/** e.g. "sk-a…9xQz" */
	masked: string | null;
}

interface KeysBoot {
	file: string;
	/** Vars present in the real env at first load (never touched). */
	realEnv: Set<string>;
	/** Vars we set from the file (ours to delete). */
	fillGap: Set<string>;
}
const BOOT = Symbol.for("dh.keysBoot");

function boot(): KeysBoot {
	const g = globalThis as typeof globalThis & { [BOOT]?: KeysBoot };
	const file = keysFile();
	if (!g[BOOT] || g[BOOT].file !== file) {
		const realEnv = new Set<string>();
		for (const p of API_KEY_PROVIDERS) if (process.env[p.envVar] !== undefined) realEnv.add(p.envVar);
		g[BOOT] = { file, realEnv, fillGap: new Set() };
	}
	return g[BOOT];
}

/** Test seam: DH_KEYS_FILE overrides PATHS.keys. */
function keysFile(): string {
	return process.env.DH_KEYS_FILE || PATHS.keys;
}

function providerInfo(id: string): ApiKeyProvider | undefined {
	return API_KEY_PROVIDERS.find((p) => p.id === id);
}

export function readKeyFile(): Record<string, string> {
	try {
		const parsed = JSON.parse(fs.readFileSync(keysFile(), "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
		return out;
	} catch {
		return {};
	}
}

function writeKeyFile(keys: Record<string, string>): void {
	const file = keysFile();
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(keys, null, "\t"), { mode: 0o600 });
	fs.chmodSync(tmp, 0o600); // mode only applies on create
	fs.renameSync(tmp, file);
}

/** Reflect file keys into process.env (fill gaps only). Idempotent. */
export function loadKeys(): void {
	const record = boot();
	for (const [id, value] of Object.entries(readKeyFile())) {
		const info = providerInfo(id);
		if (!info || record.realEnv.has(info.envVar)) continue;
		if (process.env[info.envVar] === undefined || record.fillGap.has(info.envVar)) {
			process.env[info.envVar] = value;
			record.fillGap.add(info.envVar);
		}
	}
}

function mask(value: string): string {
	const v = value.trim();
	return v.length <= 8 ? "••••" : `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export function listKeyStatuses(): ApiKeyStatus[] {
	loadKeys();
	const record = boot();
	const file = readKeyFile();
	return API_KEY_PROVIDERS.map((p) => {
		const live = process.env[p.envVar] ?? file[p.id];
		const source: ApiKeyStatus["source"] = record.realEnv.has(p.envVar) && process.env[p.envVar] !== undefined ? "env" : live !== undefined ? "file" : "none";
		return { ...p, present: live !== undefined && live !== "", source, masked: live ? mask(live) : null };
	});
}

/** Would a request to this pi-ai provider find a key? */
export function hasApiKey(providerId: string): boolean {
	loadKeys();
	const info = providerInfo(providerId);
	if (!info) return false;
	return !!(process.env[info.envVar] || readKeyFile()[providerId]);
}

export function saveApiKey(providerId: string, value: string): ApiKeyStatus {
	const info = providerInfo(providerId);
	if (!info) throw new Error(`Unknown API provider "${providerId}"`);
	const trimmed = value.trim();
	if (!trimmed || /\s/.test(trimmed)) throw new Error("That does not look like an API key");
	const keys = readKeyFile();
	keys[providerId] = trimmed;
	writeKeyFile(keys);
	const record = boot();
	if (!record.realEnv.has(info.envVar)) {
		process.env[info.envVar] = trimmed;
		record.fillGap.add(info.envVar);
	}
	return listKeyStatuses().find((s) => s.id === providerId)!;
}

export function deleteApiKey(providerId: string): ApiKeyStatus {
	const info = providerInfo(providerId);
	if (!info) throw new Error(`Unknown API provider "${providerId}"`);
	const keys = readKeyFile();
	if (providerId in keys) {
		delete keys[providerId];
		writeKeyFile(keys);
	}
	const record = boot();
	if (record.fillGap.has(info.envVar) && !record.realEnv.has(info.envVar)) {
		delete process.env[info.envVar];
		record.fillGap.delete(info.envVar);
	}
	return listKeyStatuses().find((s) => s.id === providerId)!;
}

// Reflect the file into the env at first import.
loadKeys();
