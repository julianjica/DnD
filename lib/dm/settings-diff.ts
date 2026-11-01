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
	return out.join("; ");
}
