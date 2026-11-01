import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config";
import type { GameState, LogEntry } from "../game/types";

/**
 * Campaign storage: plain files under data/campaigns/<id>/
 *   state.json   current GameState (autosaved after every change)
 *   log.jsonl    play log, one LogEntry per line
 *   saves/<slot>.json   named save slots: { state, logLength, savedAt, label }
 *
 * Writes are atomic (tmp + rename). A per-campaign promise chain serializes
 * mutations so concurrent tool calls cannot clobber each other.
 */

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function dirOf(id: string): string {
	if (!ID_RE.test(id)) throw new Error(`Invalid campaign id: ${id}`);
	return path.join(PATHS.campaigns, id);
}

function writeAtomic(file: string, data: string) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, data);
	fs.renameSync(tmp, file);
}

export interface CampaignSummary {
	id: string;
	title: string;
	characterName: string;
	characterLevel: number;
	classes: string;
	updatedAt: number;
	createdAt: number;
	sceneTitle: string;
}

export function listCampaigns(): CampaignSummary[] {
	if (!fs.existsSync(PATHS.campaigns)) return [];
	const out: CampaignSummary[] = [];
	for (const id of fs.readdirSync(PATHS.campaigns)) {
		try {
			const s = loadState(id);
			out.push({
				id,
				title: s.title,
				characterName: s.character.name,
				characterLevel: s.character.classes.reduce((n, c) => n + c.level, 0),
				classes: s.character.classes.map((c) => `${c.classId} ${c.level}`).join(" / "),
				updatedAt: s.updatedAt,
				createdAt: s.createdAt,
				sceneTitle: s.scene.title,
			});
		} catch {
			// skip unreadable campaign folders
		}
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function campaignExists(id: string): boolean {
	return fs.existsSync(path.join(dirOf(id), "state.json"));
}

export function loadState(id: string): GameState {
	return JSON.parse(fs.readFileSync(path.join(dirOf(id), "state.json"), "utf8")) as GameState;
}

export function saveState(state: GameState): void {
	state.updatedAt = Date.now();
	writeAtomic(path.join(dirOf(state.id), "state.json"), JSON.stringify(state));
}

export function deleteCampaign(id: string): void {
	fs.rmSync(dirOf(id), { recursive: true, force: true });
}

// ─── Log ───────────────────────────────────────────────────────────────────

export function appendLog(id: string, ...entries: LogEntry[]): void {
	if (entries.length === 0) return;
	const file = path.join(dirOf(id), "log.jsonl");
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

export function readLog(id: string, opts: { limit?: number } = {}): LogEntry[] {
	const file = path.join(dirOf(id), "log.jsonl");
	if (!fs.existsSync(file)) return [];
	const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
	const slice = opts.limit ? lines.slice(-opts.limit) : lines;
	const out: LogEntry[] = [];
	for (const line of slice) {
		try {
			out.push(JSON.parse(line) as LogEntry);
		} catch {
			// tolerate a torn last line
		}
	}
	return out;
}

function truncateLog(id: string, length: number) {
	const file = path.join(dirOf(id), "log.jsonl");
	if (!fs.existsSync(file)) return;
	const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).slice(0, length);
	writeAtomic(file, lines.length ? lines.join("\n") + "\n" : "");
}

// ─── Save slots ────────────────────────────────────────────────────────────

export interface SaveSlot {
	slot: string;
	label: string;
	savedAt: number;
	sceneTitle: string;
	day: number;
	auto: boolean;
}

interface SaveFile {
	state: GameState;
	logLength: number;
	savedAt: number;
	label: string;
	auto: boolean;
}

const SLOT_RE = /^[a-zA-Z0-9_-]{1,40}$/;

export function listSaves(id: string): SaveSlot[] {
	const dir = path.join(dirOf(id), "saves");
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.flatMap((f) => {
			try {
				const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as SaveFile;
				return [{ slot: f.slice(0, -5), label: s.label, savedAt: s.savedAt, sceneTitle: s.state.scene.title, day: s.state.time.day, auto: s.auto }];
			} catch {
				return [];
			}
		})
		.sort((a, b) => b.savedAt - a.savedAt);
}

export function writeSave(id: string, slot: string, label: string, auto = false): SaveSlot {
	if (!SLOT_RE.test(slot)) throw new Error(`Invalid save slot: ${slot}`);
	const state = loadState(id);
	const logLength = readLog(id).length;
	const file: SaveFile = { state, logLength, savedAt: Date.now(), label, auto };
	writeAtomic(path.join(dirOf(id), "saves", `${slot}.json`), JSON.stringify(file));
	return { slot, label, savedAt: file.savedAt, sceneTitle: state.scene.title, day: state.time.day, auto };
}

/** Restores a slot: state and log are rolled back to the save point. */
export function loadSave(id: string, slot: string): GameState {
	if (!SLOT_RE.test(slot)) throw new Error(`Invalid save slot: ${slot}`);
	const file = JSON.parse(fs.readFileSync(path.join(dirOf(id), "saves", `${slot}.json`), "utf8")) as SaveFile;
	saveState(file.state);
	truncateLog(id, file.logLength);
	return file.state;
}

export function deleteSave(id: string, slot: string): void {
	if (!SLOT_RE.test(slot)) throw new Error(`Invalid save slot: ${slot}`);
	fs.rmSync(path.join(dirOf(id), "saves", `${slot}.json`), { force: true });
}

// ─── Serialized mutation ───────────────────────────────────────────────────

const chains = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` with the latest state, saves what it returns (or the mutated
 * input), serialized per campaign.
 */
export function mutate<T>(id: string, fn: (state: GameState) => T | Promise<T>): Promise<T> {
	const prev = chains.get(id) ?? Promise.resolve();
	const next = prev.then(async () => {
		const state = loadState(id);
		const result = await fn(state);
		saveState(state);
		return result;
	});
	chains.set(id, next.catch(() => undefined));
	return next;
}
