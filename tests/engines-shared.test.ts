import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeCodeEnv, codexEnv } from "../lib/engines/cli";
import { claudeLimitsFrom, codexLimitsFrom } from "../lib/engines/plan-limits";
import { fileLedger, ledgerKey, resumableEntry, toolsFingerprintOf } from "../lib/engines/sessions";
import { eventSink, runDmTool } from "../lib/engines/tools";
import type { DmTool, EngineEvent } from "../lib/game/types";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dh-shared-test-"));

const tool = (name: string, execute: DmTool["execute"] = async () => ({ text: "ok" })): DmTool => ({
	name,
	description: `${name} tool`,
	parameters: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] },
	execute,
});

test("file ledger: keyed by provider:sessionKey, atomic JSON, model/tools gate resume", () => {
	const file = path.join(tmp, "sessions.json");
	const ledger = fileLedger(file);
	const fp = toolsFingerprintOf([tool("a"), tool("b")]);
	assert.equal(fp, toolsFingerprintOf([tool("b"), tool("a")]), "order-independent");
	assert.notEqual(fp, toolsFingerprintOf([tool("a")]));
	const key = ledgerKey("codex", "camp");
	assert.equal(key, "codex:camp");
	ledger.set(key, { id: "t1", model: "m", toolsFingerprint: fp, updatedAt: 1 });
	assert.equal(JSON.parse(fs.readFileSync(file, "utf8"))[key].id, "t1");
	assert.equal(resumableEntry(ledger, key, "m", fp)?.id, "t1");
	assert.equal(resumableEntry(ledger, key, "other", fp), undefined);
	assert.equal(resumableEntry(ledger, key, "m", "zzz"), undefined);
	ledger.delete(key);
	assert.equal(ledger.get(key), undefined);
	assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.endsWith(".tmp")), []);
});

test("runDmTool: unknown tool, validation + coercion, throwing tool", async () => {
	const seen: unknown[] = [];
	const tools = [tool("count", async (args) => (seen.push(args), { text: `n=${args.n}` })), tool("boom", async () => { throw new Error("kaboom"); })];
	assert.deepEqual(await runDmTool(tools, "count", { n: "3" }), { text: "n=3" });
	assert.deepEqual(seen, [{ n: 3 }]);
	const missing = await runDmTool(tools, "count", {});
	assert.equal(missing.isError, true);
	assert.match(missing.text, /Validation failed/);
	assert.equal((await runDmTool(tools, "nope", {})).isError, true);
	assert.deepEqual(await runDmTool(tools, "boom", { n: 1 }), { text: "kaboom", isError: true });
});

test("eventSink: one done, swallowed listener errors, paragraph breaks between segments", () => {
	const events: EngineEvent[] = [];
	const sink = eventSink((e) => {
		events.push(e);
		if (e.type === "thinking") throw new Error("ui bug");
	});
	sink.thinking("x");
	sink.text("A", "s1");
	sink.text("B", "s1");
	sink.text("C\n", "s2");
	sink.text("D", "s3");
	sink.emit({ type: "done" });
	sink.emit({ type: "done" });
	sink.text("late", "s4");
	assert.equal(events.map((e) => (e.type === "text" ? e.delta : `<${e.type}>`)).join(""), "<thinking>AB\n\nC\n\nD<done>");
});

test("CLI child envs strip API keys unless opted in", () => {
	const saved = { ...process.env };
	try {
		process.env.ANTHROPIC_API_KEY = "sk-ant";
		process.env.OPENAI_API_KEY = "sk-oai";
		process.env.CODEX_API_KEY = "sk-cx";
		assert.equal(claudeCodeEnv().ANTHROPIC_API_KEY, undefined);
		assert.equal(codexEnv().OPENAI_API_KEY, undefined);
		assert.equal(codexEnv().CODEX_API_KEY, undefined);
		assert.equal(claudeCodeEnv().OPENAI_API_KEY, "sk-oai");
		process.env.DH_CLAUDE_CODE_USE_API_KEY = "1";
		process.env.DH_CODEX_USE_API_KEY = "1";
		assert.equal(claudeCodeEnv().ANTHROPIC_API_KEY, "sk-ant");
		assert.equal(codexEnv().OPENAI_API_KEY, "sk-oai");
	} finally {
		for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "DH_CLAUDE_CODE_USE_API_KEY", "DH_CODEX_USE_API_KEY"]) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	}
});

test("keys: 0600 file, reflected into env, real env wins, delete unsets only ours", async () => {
	const saved = { ...process.env };
	process.env.DH_KEYS_FILE = path.join(tmp, "keys.json");
	delete process.env.OPENROUTER_API_KEY;
	process.env.GEMINI_API_KEY = "real-env-gemini";
	try {
		const keys = await import("../lib/engines/keys");
		const or = keys.saveApiKey("openrouter", "  sk-or-123456789  ");
		assert.equal(or.present, true);
		assert.equal(or.source, "file");
		assert.equal(process.env.OPENROUTER_API_KEY, "sk-or-123456789");
		assert.equal(fs.statSync(process.env.DH_KEYS_FILE).mode & 0o777, 0o600);
		assert.ok(keys.hasApiKey("openrouter"));

		const g = keys.saveApiKey("google", "file-gemini-key");
		assert.equal(g.source, "env");
		assert.equal(process.env.GEMINI_API_KEY, "real-env-gemini");

		keys.deleteApiKey("openrouter");
		assert.equal(process.env.OPENROUTER_API_KEY, undefined);
		keys.deleteApiKey("google");
		assert.equal(process.env.GEMINI_API_KEY, "real-env-gemini");
		assert.throws(() => keys.saveApiKey("nope", "x"));
		assert.equal(keys.listKeyStatuses().length, keys.API_KEY_PROVIDERS.length);
	} finally {
		for (const k of ["DH_KEYS_FILE", "OPENROUTER_API_KEY", "GEMINI_API_KEY"]) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	}
});

test("plan limits parsing", () => {
	const codex = codexLimitsFrom({ primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 100 }, secondary: null, planType: "plus", credits: { hasCredits: true, unlimited: false, balance: "5" } });
	assert.deepEqual(codex.windows, [{ id: "primary", label: "Weekly", usedPercent: 9, resetsAt: 100_000 }]);
	assert.equal(codex.note, "Credits: 5");
	const claude = claudeLimitsFrom({ subscription_type: "max", rate_limits_available: true, rate_limits: { five_hour: { utilization: 13, resets_at: "2026-10-31T00:00:00Z" }, model_scoped: [{ display_name: "Opus", utilization: 2, resets_at: null }] } });
	assert.deepEqual(claude.windows.map((w) => w.id), ["five_hour", "model:Opus"]);
	assert.equal(claudeLimitsFrom({ rate_limits_available: false }).available, false);
});
