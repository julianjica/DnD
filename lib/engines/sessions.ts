import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config";
import type { DmTool, EngineProvider } from "../game/types";

/**
 * The CLI session ledger: one small JSON file (PATHS.sessions) mapping
 * `${provider}:${sessionKey}` → the Claude Code session id / Codex thread id
 * plus what it was started with. A turn resumes the stored session only when
 * the model AND the tools fingerprint still match: Codex fixes a thread's
 * dynamic tools at thread/start, and switching models mid-session is cleaner
 * as a new session (the DM's state digest carries continuity).
 *
 * Writes are atomic (write-then-rename). The ledger is a cache: losing it
 * only costs a fresh session.
 */

export interface SessionEntry {
	/** Claude Code session id or Codex thread id. */
	id: string;
	model: string;
	toolsFingerprint: string;
	updatedAt: number;
}

export interface SessionLedger {
	get(key: string): SessionEntry | undefined;
	set(key: string, entry: SessionEntry): void;
	delete(key: string): void;
}

export function ledgerKey(provider: EngineProvider, sessionKey: string): string {
	return `${provider}:${sessionKey}`;
}

function valid(entry: unknown): entry is SessionEntry {
	const e = entry as Partial<SessionEntry> | undefined;
	return !!e && typeof e.id === "string" && typeof e.model === "string" && typeof e.toolsFingerprint === "string";
}

export function fileLedger(file: string = PATHS.sessions): SessionLedger {
	const readAll = (): Record<string, SessionEntry> => {
		try {
			const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
			return parsed && typeof parsed === "object" ? (parsed as Record<string, SessionEntry>) : {};
		} catch {
			return {};
		}
	};
	const writeAll = (all: Record<string, SessionEntry>) => {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(all, null, "\t"));
		fs.renameSync(tmp, file);
	};
	return {
		get(key) {
			const entry = readAll()[key];
			return valid(entry) ? entry : undefined;
		},
		set(key, entry) {
			const all = readAll();
			all[key] = entry;
			writeAll(all);
		},
		delete(key) {
			const all = readAll();
			if (!(key in all)) return;
			delete all[key];
			writeAll(all);
		},
	};
}

/** In-memory ledger (tests). */
export function memoryLedger(): SessionLedger & { entries: Map<string, SessionEntry> } {
	const entries = new Map<string, SessionEntry>();
	return {
		entries,
		get: (key) => entries.get(key),
		set: (key, entry) => void entries.set(key, entry),
		delete: (key) => void entries.delete(key),
	};
}

/** Names + descriptions + schemas, order-independent. */
export function toolsFingerprintOf(tools: readonly DmTool[]): string {
	const shape = [...tools].map((t) => [t.name, t.description, t.parameters] as const).sort((a, b) => a[0].localeCompare(b[0]));
	return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 16);
}

/** The stored entry, or undefined when it no longer matches this turn's model/tools. */
export function resumableEntry(ledger: SessionLedger, key: string, model: string, toolsFingerprint: string): SessionEntry | undefined {
	const entry = ledger.get(key);
	if (!entry) return undefined;
	return entry.model === model && entry.toolsFingerprint === toolsFingerprint ? entry : undefined;
}
