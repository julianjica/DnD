/**
 * End-to-end DM smoke test (live, bills your plan):
 *   DH_DATA_DIR=$(mktemp -d) npx tsx scripts/dm/smoke.ts [claude-code|codex] [model] ["player action" ...]
 */
import { createGame } from "../../lib/dm/newgame";
import { runTurn } from "../../lib/dm/turn";
import { loadState } from "../../lib/store/campaigns";
import type { CampaignSettings, EngineProvider } from "../../lib/game/types";

const provider = (process.argv[2] ?? "claude-code") as EngineProvider;
const model = process.argv[3] ?? (provider === "codex" ? "gpt-6-luna" : "claude-haiku-5-5");
const actions = process.argv.slice(4);

const settings: CampaignSettings = {
	world: { preset: "classic_high_fantasy", tone: ["heroic"], lines: [], veils: [] },
	structure: { format: "one_shot", startingLevel: 3, difficulty: "normal", leveling: "xp", hook: "Goblins have been raiding the village" },
	dm: { verbosity: "terse", rulesStrictness: "standard", combatFrequency: "high", autoRollPlayer: true },
	engine: { provider, model, effort: "low" },
	audio: { enabled: true, musicVolume: 0.5, sfxVolume: 0.7 },
};

async function main() {
	const s = createGame({ settings, character: { name: "Brenna", speciesId: "dwarf", classId: "fighter", backgroundId: "soldier", abilities: { method: "standard_array", scores: { str: 15, con: 14, dex: 13, wis: 12, int: 10, cha: 8 } } } });
	console.log("created", s.id, s.character.name, "HP", s.character.hp, "world", s.world.locations.length, "locations");
	for (const text of ["", ...actions]) {
		console.log(`\n===== TURN: ${text || "(opening)"} =====`);
		const t0 = Date.now();
		await runTurn({
			campaignId: s.id,
			text,
			emit(e) {
				if (e.type === "text") process.stdout.write(e.delta);
				else if (e.type === "tool" && e.status === "end") console.log(`\n  [tool ${e.name}] ${e.isError ? "ERROR " : ""}${e.summary?.slice(0, 160)}`);
				else if (e.type === "roll") console.log(`\n  [roll] ${e.roll.label}: ${e.roll.total}`);
				else if (e.type === "error") console.log(`\n  [ERROR] ${e.message}`);
			},
		});
		const st = loadState(s.id);
		console.log(`\n--- ${((Date.now() - t0) / 1000).toFixed(1)}s | mode ${st.mode} view ${st.view} scene "${st.scene.title}" amb ${st.ambience} | maps ${Object.keys(st.maps).length} | enc ${st.encounter?.status ?? "-"} | HP ${st.character.hp} | suggestions: ${st.suggestions.join(" / ")}`);
	}
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
