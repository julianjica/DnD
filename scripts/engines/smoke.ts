/**
 * Live smoke test for one engine (bills the CLI plan / API key — keep it short).
 *
 *   npx tsx scripts/engines/smoke.ts claude-code [model] [effort]
 *   npx tsx scripts/engines/smoke.ts codex [model] [effort]
 *   npx tsx scripts/engines/smoke.ts api <model> [effort] --api-provider=<id>
 *
 * Flags:
 *   --bogus-resume   seed the ledger with a session id that does not exist
 *                    (checks the resume → fresh fallback)
 *   --one-turn       skip the resume turn
 *
 * Data goes to DH_DATA_DIR (default: a temp dir), never the project's data/.
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

async function main() {
	const args = process.argv.slice(2);
	const flags = new Set(args.filter((a) => a.startsWith("--")));
	const positional = args.filter((a) => !a.startsWith("--"));
	const provider = positional[0] as "claude-code" | "codex" | "api" | undefined;
	if (!provider || !["claude-code", "codex", "api"].includes(provider)) {
		console.error("usage: npx tsx scripts/engines/smoke.ts claude-code|codex|api [model] [effort] [--api-provider=id] [--bogus-resume] [--one-turn]");
		process.exit(2);
	}
	const defaults = { "claude-code": "claude-haiku-5-5", codex: "gpt-6-luna", api: "claude-haiku-5-5" } as const;
	const model = positional[1] ?? defaults[provider];
	const effort = (positional[2] ?? "low") as "off" | "low" | "medium" | "high";
	const apiProvider = args.find((a) => a.startsWith("--api-provider="))?.split("=")[1] ?? (provider === "api" ? "anthropic" : undefined);

	process.env.DH_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "dh-smoke-"));
	console.log(`data dir: ${process.env.DH_DATA_DIR}`);

	// Imported after DH_DATA_DIR is set (config.ts reads it at import time).
	const { getEngine } = await import("../../lib/engines");
	const { PATHS } = await import("../../lib/config");
	type EngineEvent = import("../../lib/game/types").EngineEvent;
	type DmTool = import("../../lib/game/types").DmTool;

	let rolls = 0;
	const rollDie: DmTool = {
		name: "roll_die",
		description: "Roll one die for the player and return the result. Always use this instead of inventing numbers.",
		parameters: { type: "object", properties: { sides: { type: "integer", description: "Number of sides, e.g. 20" } }, required: ["sides"] },
		async execute(input) {
			rolls++;
			return { text: `Rolled a d${input.sides}: 17` };
		},
	};

	const engine = getEngine(provider);
	const sessionKey = `smoke-${Date.now()}`;
	if (flags.has("--bogus-resume") && provider !== "api") {
		const { fileLedger, ledgerKey, toolsFingerprintOf } = await import("../../lib/engines/sessions");
		const bogus = provider === "claude-code" ? "00000000-0000-4000-8000-000000000000" : "00000000-0000-0000-0000-000000000000";
		fileLedger().set(ledgerKey(provider, sessionKey), { id: bogus, model, toolsFingerprint: toolsFingerprintOf([rollDie]), updatedAt: Date.now() });
		console.log(`seeded bogus session ${bogus}`);
	}

	const systemPrompt = "You are a terse Dungeon Master for a solo D&D game. Use the roll_die tool for every roll. Keep narration to one or two sentences.";

	async function turn(label: string, input: string) {
		console.log(`\n=== ${label}: ${input}`);
		const started = Date.now();
		let text = "";
		let thinkingChars = 0;
		const events: EngineEvent[] = [];
		await engine.runTurn({
			sessionKey,
			systemPrompt,
			input,
			tools: [rollDie],
			config: { provider: provider!, model, effort, ...(apiProvider ? { apiProvider } : {}) },
			onEvent: (e) => {
				events.push(e);
				if (e.type === "text") {
					text += e.delta;
					process.stdout.write(e.delta);
				} else if (e.type === "thinking") thinkingChars += e.delta.length;
				else console.log(`\n[${e.type}] ${JSON.stringify({ ...e, type: undefined })}`);
			},
		});
		const counts: Record<string, number> = {};
		for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
		console.log(`\n--- ${((Date.now() - started) / 1000).toFixed(1)}s, events ${JSON.stringify(counts)}, thinking chars ${thinkingChars}`);
		if (provider !== "api") {
			const ledger = fs.existsSync(PATHS.sessions) ? JSON.parse(fs.readFileSync(PATHS.sessions, "utf8")) : {};
			console.log(`ledger: ${JSON.stringify(ledger[`${provider}:${sessionKey}`] ?? null)}`);
		}
		return text;
	}

	await turn("turn 1", "I try to sneak past the sleeping goblin. Roll a d20 for my Stealth check with the roll_die tool, then narrate the outcome.");
	if (!flags.has("--one-turn")) {
		const answer = await turn("turn 2 (resume)", "Do not roll again and do not call any tool. What exact number did the die show on my Stealth roll? Answer with just the number.");
		console.log(`\nresume check: ${/\b17\b/.test(answer) ? "PASS (remembered 17)" : "FAIL"}; roll_die calls total: ${rolls}`);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
