"use client";

/**
 * Posts one downtime action (lib/dm/downtime.ts) to a campaign route and
 * refreshes the game on success; the server's refusal comes back as `error`.
 */
import { useState } from "react";

export function useDowntime(campaignId: string, route: "den" | "base", onChanged: () => void) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function post(body: Record<string, unknown>): Promise<boolean> {
		setPending(true);
		setError(null);
		try {
			const res = await fetch(`/api/campaigns/${campaignId}/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setError(data.error ?? `HTTP ${res.status}`);
				return false;
			}
			onChanged();
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			return false;
		} finally {
			setPending(false);
		}
	}
	return { post, pending, error };
}
