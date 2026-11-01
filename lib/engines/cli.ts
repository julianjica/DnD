import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Local CLI detection + child environments for the Claude Code and Codex
 * engines (ported from learnharness claude-code/catalog.ts, codex/catalog.ts,
 * codex/rpc.ts, with the LH_ prefix renamed DH_).
 *
 * | Env var                          | Effect                                              |
 * |----------------------------------|-----------------------------------------------------|
 * | DH_CLAUDE_CODE_PATH / DH_CODEX_PATH | Explicit path to the executable.                 |
 * | DH_CLAUDE_CODE / DH_CODEX = 0|1  | Hide / force-show the engine (default: shown when found). |
 * | DH_CLAUDE_CODE_USE_API_KEY=1     | Let Claude Code see ANTHROPIC_API_KEY / AUTH_TOKEN. |
 * | DH_CODEX_USE_API_KEY=1           | Let Codex see OPENAI_API_KEY / CODEX_API_KEY.       |
 *
 * By default API keys are stripped from the child env so the CLI's OWN login
 * (usually a Claude / ChatGPT plan) decides billing — keys.ts reflects saved
 * API keys into process.env, which would otherwise silently switch the CLI to
 * pay-per-token. Sign-in is never checked here: a signed-out CLI fails the
 * first turn with its own error text, surfaced as an `error` event.
 */

export type CliName = "claude" | "codex";

const resolved = new Map<CliName, string | null>();

function lookup(name: CliName, explicitVar: string): string | undefined {
	if (resolved.has(name)) return resolved.get(name) ?? undefined;
	const explicit = process.env[explicitVar];
	if (explicit) {
		resolved.set(name, explicit);
		return explicit;
	}
	let found: string | null = null;
	try {
		const cmd = process.platform === "win32" ? "where" : "which";
		const line = execFileSync(cmd, [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0]?.trim();
		found = line && existsSync(line) ? line : null;
	} catch {
		found = null;
	}
	// A process launched from a GUI gets a minimal PATH, so also look where
	// the official installers put the CLIs.
	if (!found) {
		const home = os.homedir();
		const candidates =
			process.platform === "win32"
				? [path.join(home, ".local", "bin", `${name}.exe`), path.join(home, "AppData", "Roaming", "npm", `${name}.cmd`)]
				: [
						path.join(home, ".local", "bin", name),
						...(name === "claude" ? [path.join(home, ".claude", "local", "claude")] : []),
						`/opt/homebrew/bin/${name}`,
						`/usr/local/bin/${name}`,
					];
		found = candidates.find((c) => existsSync(c)) ?? null;
	}
	resolved.set(name, found);
	return found ?? undefined;
}

/** The `claude` executable the Agent SDK spawns (undefined → the SDK's bundled binary, if any). */
export function claudeCodeExecutable(): string | undefined {
	return lookup("claude", "DH_CLAUDE_CODE_PATH");
}

/** The `codex` executable each Codex run spawns as `codex app-server`. */
export function codexExecutable(): string | undefined {
	return lookup("codex", "DH_CODEX_PATH");
}

/** The SDK's optional bundled platform binary (no `import.meta.url`: this
 *  module is compiled as CJS under tsx and bundled under Next). */
function bundledClaudePresent(): boolean {
	return existsSync(path.join(process.cwd(), "node_modules", "@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`));
}

export function claudeCodeAvailable(): boolean {
	if (process.env.DH_CLAUDE_CODE === "0") return false;
	if (process.env.DH_CLAUDE_CODE === "1") return true;
	return !!claudeCodeExecutable() || bundledClaudePresent();
}

export function codexAvailable(): boolean {
	if (process.env.DH_CODEX === "0") return false;
	if (process.env.DH_CODEX === "1") return true;
	return !!codexExecutable();
}

function baseEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
	return env;
}

/** Env for every Claude Code process: the parent's, minus API credentials. */
export function claudeCodeEnv(extra?: Record<string, string>): Record<string, string> {
	const env = baseEnv();
	if (process.env.DH_CLAUDE_CODE_USE_API_KEY !== "1") {
		delete env.ANTHROPIC_API_KEY;
		delete env.ANTHROPIC_AUTH_TOKEN;
	}
	return { ...env, ...extra };
}

/** Env for every Codex process: the parent's, minus API credentials. */
export function codexEnv(extra?: Record<string, string>): Record<string, string> {
	const env = baseEnv();
	if (process.env.DH_CODEX_USE_API_KEY !== "1") {
		delete env.OPENAI_API_KEY;
		delete env.CODEX_API_KEY;
	}
	return { ...env, ...extra };
}

const versions = new Map<string, string | null>();

/** `<exe> --version`, first line, cached per path. */
export function cliVersion(executable: string | undefined): string | undefined {
	if (!executable) return undefined;
	if (versions.has(executable)) return versions.get(executable) ?? undefined;
	let version: string | null = null;
	try {
		version = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/)[0]?.trim() || null;
	} catch {
		version = null;
	}
	versions.set(executable, version);
	return version ?? undefined;
}

/** Test seam: forget cached detection. */
export function resetCliDetection(): void {
	resolved.clear();
	versions.clear();
}
