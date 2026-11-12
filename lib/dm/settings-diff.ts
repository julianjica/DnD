import type { CampaignSettings } from "../game/types";

/** Human-readable diff of settings for the DM. Empty string if nothing relevant changed. */
export function describeSettingsChange(a: CampaignSettings, b: CampaignSettings): string {
	const out: string[] = [];
	const sections = ["world", "structure", "dm"] as const;
	for (const sec of sections) {
		const x = a[sec] as unknown as Record<string, unknown>;
		const y = b[sec] as unknown as Record<string, unknown>;
		for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
			if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(`${sec}.${k}: ${JSON.stringify(x[k])} → ${JSON.stringify(y[k])}`);
		}
	}
	if ((a.art?.scenes ?? "paintings") !== (b.art?.scenes ?? "paintings")) out.push(`art.scenes: ${a.art?.scenes ?? "paintings"} → ${b.art?.scenes ?? "paintings"}${b.art?.scenes === "sprites" ? " (the scene panel now shows the active map as pixel art: draw_map each place as you narrate it)" : ""}`);
	if ((a.dm.fights ?? "auto") !== (b.dm.fights ?? "auto"))
		out.push(
			b.dm.fights === "turns"
				? "FIGHTS are now TURN BY TURN: start_combat only sets the fight up; the player acts on their turns and you play the others with monster_turn, then end_combat (see # Combat)"
				: "FIGHTS are now AUTOMATIC: start_combat resolves the whole fight at once and returns a summary to narrate (see # Combat); a fight already in progress turn by turn can be resolved with start_combat monsters []",
		);
	if ((a.language ?? "en") !== (b.language ?? "en")) out.push(`language: ${a.language ?? "en"} → ${b.language ?? "en"} (switch the language you write in from now on)`);
	return out.join("; ");
}
