import path from "node:path";

/** Root for all local data (campaigns, engine session ledgers, keys). */
export const DATA_DIR = process.env.DH_DATA_DIR ? path.resolve(process.env.DH_DATA_DIR) : path.join(process.cwd(), "data");

export const PATHS = {
	campaigns: path.join(DATA_DIR, "campaigns"),
	claudeCodeWorkdir: path.join(DATA_DIR, "claude-code"),
	codexWorkdir: path.join(DATA_DIR, "codex"),
	sessions: path.join(DATA_DIR, "sessions.json"),
	keys: path.join(DATA_DIR, "keys.json"),
	settings: path.join(DATA_DIR, "settings.json"),
} as const;
