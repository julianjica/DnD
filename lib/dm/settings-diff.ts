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
	if ((a.language ?? "en") !== (b.language ?? "en")) out.push(`language: ${a.language ?? "en"} → ${b.language ?? "en"} (switch the language you write in from now on)`);
	return out.join("; ");
}
