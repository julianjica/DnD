import { claudeCodeAvailable, claudeCodeEnv, claudeCodeExecutable, codexAvailable, codexEnv } from "./cli";
import { CLIENT_INFO, CodexClient, spawnCodex } from "./codex-rpc";
import { loadClaudeSdk } from "./esm";

/**
 * Plan usage limits of the local-CLI engines (read-only; ported from
 * learnharness src/agent/plan-limits.ts).
 *
 * One in-memory snapshot per engine, fed two ways:
 *   - live, from what turns already receive: Codex pushes a full
 *     `account/rateLimits/updated` snapshot (parsed directly); Claude
 *     Code's `rate_limit_event` only says "limits changed", so it
 *     schedules a debounced fresh reading;
 *   - on demand: planLimits() re-reads any snapshot older than maxAgeMs.
 * A reading spends no tokens: Codex answers `account/rateLimits/read`,
 * Claude Code answers the SDK's (experimental) usage request without a prompt.
 */

export type PlanEngineId = "claude-code" | "codex";

export interface PlanLimitWindow {
	id: string;
	label: string;
	/** 0–100. */
	usedPercent: number;
	/** Epoch ms, or null when unknown. */
	resetsAt: number | null;
}

export interface PlanLimitsSnapshot {
	engine: PlanEngineId;
	label: string;
	available: boolean;
	planType: string | null;
	windows: PlanLimitWindow[];
	note?: string;
	error?: string;
	fetchedAt: number;
}

const LABELS: Record<PlanEngineId, string> = { "claude-code": "Claude plan", codex: "ChatGPT plan" };
const ENGINES: PlanEngineId[] = ["claude-code", "codex"];
const LIVE_REFRESH_DEBOUNCE_MS = 60_000;

type Fetcher = () => Promise<PlanLimitsSnapshot>;
interface State {
	snapshots: Map<PlanEngineId, PlanLimitsSnapshot>;
	inFlight: Map<PlanEngineId, Promise<PlanLimitsSnapshot>>;
	liveTimer?: ReturnType<typeof setTimeout>;
}
const key = Symbol.for("dh.plan-limits");
function state(): State {
	const g = globalThis as typeof globalThis & { [key]?: State };
	g[key] ??= { snapshots: new Map(), inFlight: new Map() };
	return g[key];
}

/** Test seams: scripted readers and availability. */
export const planLimitsRuntime: { fetchers: Partial<Record<PlanEngineId, Fetcher>>; available?: (engine: PlanEngineId) => boolean } = { fetchers: {} };

function unavailable(engine: PlanEngineId, error: string): PlanLimitsSnapshot {
	return { engine, label: LABELS[engine], available: false, planType: null, windows: [], error, fetchedAt: Date.now() };
}

// ─── Codex ──────────────────────────────────────────────────────────────

interface CodexWindow {
	usedPercent: number;
	windowDurationMins: number | null;
	resetsAt: number | null;
}
interface CodexSnapshot {
	limitName?: string | null;
	primary: CodexWindow | null;
	secondary: CodexWindow | null;
	credits?: { hasCredits: boolean; unlimited: boolean; balance: string | null } | null;
	planType?: string | null;
}

function durationLabel(mins: number | null, fallback: string): string {
	if (mins === null || !Number.isFinite(mins) || mins <= 0) return fallback;
	if (mins === 10_080) return "Weekly";
	if (mins % 1440 === 0) return `${mins / 1440}-day`;
	if (mins % 60 === 0) return `${mins / 60}-hour`;
	return `${mins}-minute`;
}

/** app-server RateLimitSnapshot → our snapshot. */
export function codexLimitsFrom(raw: unknown): PlanLimitsSnapshot {
	const snap = raw as CodexSnapshot | null | undefined;
	if (!snap || typeof snap !== "object") return unavailable("codex", "Codex reported no plan limits");
	const windows: PlanLimitWindow[] = [];
	for (const [id, w] of [["primary", snap.primary], ["secondary", snap.secondary]] as const) {
		if (!w || typeof w.usedPercent !== "number") continue;
		windows.push({ id, label: durationLabel(w.windowDurationMins, id === "primary" ? "Primary" : "Secondary"), usedPercent: w.usedPercent, resetsAt: typeof w.resetsAt === "number" ? w.resetsAt * 1000 : null });
	}
	const credits = snap.credits;
	const note = credits?.unlimited ? "Unlimited credits" : credits?.balance ? `Credits: ${credits.balance}` : undefined;
	return { engine: "codex", label: LABELS.codex, available: true, planType: snap.planType ?? null, windows, ...(note ? { note } : {}), fetchedAt: Date.now() };
}

async function readCodex(): Promise<PlanLimitsSnapshot> {
	let client: CodexClient | undefined;
	try {
		client = new CodexClient(spawnCodex({ cwd: process.cwd(), env: codexEnv() }), { notification: () => {}, request: () => Promise.reject(new Error("unsupported")), closed: () => {} });
		await client.request("initialize", CLIENT_INFO);
		client.notify("initialized");
		const result = await client.request<{ rateLimits?: unknown }>("account/rateLimits/read", {});
		return codexLimitsFrom(result.rateLimits);
	} finally {
		client?.close();
	}
}

/** Live feed from CodexEngine (`account/rateLimits/updated`). */
export function recordCodexRateLimits(raw: unknown): void {
	const snapshot = codexLimitsFrom(raw);
	if (snapshot.available) state().snapshots.set("codex", snapshot);
}

// ─── Claude Code ────────────────────────────────────────────────────────

interface ClaudeWindow {
	utilization: number | null;
	resets_at: string | null;
}
interface ClaudeUsage {
	subscription_type?: string | null;
	rate_limits_available?: boolean;
	rate_limits?: {
		five_hour?: ClaudeWindow | null;
		seven_day?: ClaudeWindow | null;
		seven_day_opus?: ClaudeWindow | null;
		seven_day_sonnet?: ClaudeWindow | null;
		model_scoped?: ({ display_name: string } & ClaudeWindow)[];
		extra_usage?: { is_enabled: boolean; monthly_limit: number | null; used_credits: number | null; currency?: string | null } | null;
	} | null;
}

const CLAUDE_WINDOWS = [
	["five_hour", "5-hour"],
	["seven_day", "Weekly"],
	["seven_day_opus", "Weekly · Opus"],
	["seven_day_sonnet", "Weekly · Sonnet"],
] as const;

function isoMs(value: string | null | undefined): number | null {
	const ms = value ? Date.parse(value) : NaN;
	return Number.isFinite(ms) ? ms : null;
}

/** SDK usage response → our snapshot. Parsed defensively: the SDK marks
 *  this API experimental, so an unknown shape reads as unavailable. */
export function claudeLimitsFrom(raw: unknown): PlanLimitsSnapshot {
	const usage = raw as ClaudeUsage | null | undefined;
	if (!usage || typeof usage !== "object" || usage.rate_limits_available !== true || !usage.rate_limits) {
		return { ...unavailable("claude-code", "Claude Code reports no plan limits for this sign-in (API key or no plan)"), planType: usage?.subscription_type ?? null };
	}
	const limits = usage.rate_limits;
	const windows: PlanLimitWindow[] = [];
	for (const [id, label] of CLAUDE_WINDOWS) {
		const w = limits[id];
		if (w && typeof w.utilization === "number") windows.push({ id, label, usedPercent: w.utilization, resetsAt: isoMs(w.resets_at) });
	}
	for (const w of limits.model_scoped ?? []) {
		if (w && typeof w.utilization === "number") windows.push({ id: `model:${w.display_name}`, label: `Weekly · ${w.display_name}`, usedPercent: w.utilization, resetsAt: isoMs(w.resets_at) });
	}
	const extra = limits.extra_usage;
	const note =
		extra?.is_enabled && extra.used_credits != null
			? `Extra usage: ${extra.used_credits}${extra.monthly_limit != null ? ` / ${extra.monthly_limit}` : ""}${extra.currency ? ` ${extra.currency}` : ""}`
			: undefined;
	return { engine: "claude-code", label: LABELS["claude-code"], available: true, planType: usage.subscription_type ?? null, windows, ...(note ? { note } : {}), fetchedAt: Date.now() };
}

type UsageQuery = { close?: () => void; usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts: { skipBehaviors: boolean }) => Promise<unknown> };

async function readClaude(): Promise<PlanLimitsSnapshot> {
	const { query } = await loadClaudeSdk();
	// A prompt stream that never yields: the session answers control
	// requests without ever starting a model turn.
	const silent: AsyncIterable<never> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>(() => {}) }) };
	const executable = claudeCodeExecutable();
	const q = query({
		prompt: silent,
		options: { tools: [], settingSources: [], persistSession: false, env: claudeCodeEnv(), ...(executable ? { pathToClaudeCodeExecutable: executable } : {}) },
	}) as unknown as UsageQuery;
	try {
		const read = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
		if (typeof read !== "function") return unavailable("claude-code", "This Claude Code SDK has no usage request");
		return claudeLimitsFrom(await read.call(q, { skipBehaviors: true }));
	} finally {
		q.close?.();
	}
}

/** Live feed from ClaudeCodeEngine (`rate_limit_event`): limits changed —
 *  read them again, at most once per debounce window. */
export function noteClaudeRateLimitEvent(): void {
	const s = state();
	if (s.liveTimer) return;
	s.liveTimer = setTimeout(() => {
		s.liveTimer = undefined;
		void refresh("claude-code").catch(() => undefined);
	}, LIVE_REFRESH_DEBOUNCE_MS);
	s.liveTimer.unref?.();
}

// ─── reads ──────────────────────────────────────────────────────────────

const READERS: Record<PlanEngineId, Fetcher> = { "claude-code": readClaude, codex: readCodex };

function isAvailable(engine: PlanEngineId): boolean {
	if (planLimitsRuntime.available) return planLimitsRuntime.available(engine);
	return engine === "claude-code" ? claudeCodeAvailable() : codexAvailable();
}

function refresh(engine: PlanEngineId): Promise<PlanLimitsSnapshot> {
	const s = state();
	const pending = s.inFlight.get(engine);
	if (pending) return pending;
	const reader = planLimitsRuntime.fetchers[engine] ?? READERS[engine];
	const run = reader()
		.catch((error: unknown) => unavailable(engine, error instanceof Error ? error.message : String(error)))
		.then((snapshot) => {
			s.snapshots.set(engine, snapshot);
			return snapshot;
		})
		.finally(() => s.inFlight.delete(engine));
	s.inFlight.set(engine, run);
	return run;
}

/** Every offered plan engine's snapshot, re-reading those older than
 *  maxAgeMs (0 forces a fresh reading). Engines whose CLI is not found
 *  are omitted. */
export async function planLimits(maxAgeMs = 60_000): Promise<PlanLimitsSnapshot[]> {
	const engines = ENGINES.filter(isAvailable);
	const now = Date.now();
	return Promise.all(
		engines.map((engine) => {
			const cached = state().snapshots.get(engine);
			return cached && now - cached.fetchedAt < maxAgeMs ? Promise.resolve(cached) : refresh(engine);
		}),
	);
}

/** Test seam: forget every snapshot. */
export function resetPlanLimits(): void {
	const s = state();
	s.snapshots.clear();
	s.inFlight.clear();
	if (s.liveTimer) clearTimeout(s.liveTimer);
	s.liveTimer = undefined;
}
