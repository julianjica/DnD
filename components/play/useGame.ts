"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CampaignSettings, GameState, LogEntry, PlayerCombatAction, RollRecord } from "@/lib/game/types";
import type { ClientEvent, FxEvent } from "@/lib/dm/context";

export interface LiveTool {
	id: string;
	name: string;
	status: "start" | "end";
	summary?: string;
	isError?: boolean;
}

export interface LiveTurn {
	text: string;
	thinking: string;
	tools: LiveTool[];
	rolls: RollRecord[];
	player?: string;
}

export interface FxItem extends Omit<FxEvent, "kind"> {
	id: string;
	kind: FxEvent["kind"];
	entityId?: string;
	amount?: number;
	sound?: string;
	level?: number;
}

let fxCounter = 0;

/** Parses an SSE body into ClientEvents. */
async function readSse(res: Response, onEvent: (e: ClientEvent) => void): Promise<void> {
	if (!res.body) return;
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let idx: number;
		while ((idx = buf.indexOf("\n\n")) >= 0) {
			const chunk = buf.slice(0, idx);
			buf = buf.slice(idx + 2);
			for (const line of chunk.split("\n")) {
				if (!line.startsWith("data: ")) continue;
				try {
					onEvent(JSON.parse(line.slice(6)) as ClientEvent);
				} catch {
					// ignore malformed line
				}
			}
		}
	}
}

export function useGame(id: string) {
	const [state, setState] = useState<GameState | null>(null);
	const [log, setLog] = useState<LogEntry[]>([]);
	const [live, setLive] = useState<LiveTurn | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [rollQueue, setRollQueue] = useState<RollRecord[]>([]);
	const [fx, setFx] = useState<FxItem[]>([]);
	const [loaded, setLoaded] = useState(false);
	const busyRef = useRef(false);

	const refresh = useCallback(async () => {
		const res = await fetch(`/api/campaigns/${id}`, { cache: "no-store" });
		if (!res.ok) {
			setError((await res.json().catch(() => ({}))).error ?? `Failed to load (${res.status})`);
			setLoaded(true);
			return null;
		}
		const data = (await res.json()) as { state: GameState; log: LogEntry[]; running: boolean };
		setState(data.state);
		setLog(data.log);
		setLoaded(true);
		return data;
	}, [id]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
		void refresh();
	}, [refresh]);

	/** Runs a streaming request (turn, action, roll). */
	const stream = useCallback(
		async (url: string, body: unknown, opts: { showPlayer?: string } = {}) => {
			if (busyRef.current) return;
			busyRef.current = true;
			setBusy(true);
			setError(null);
			setLive({ text: "", thinking: "", tools: [], rolls: [], player: opts.showPlayer });
			try {
				const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
				if (!res.ok || !res.headers.get("content-type")?.includes("event-stream")) {
					const msg = (await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`;
					setError(msg);
					return;
				}
				await readSse(res, (e) => {
					switch (e.type) {
						case "text":
							setLive((l) => (l ? { ...l, text: l.text + e.delta } : l));
							break;
						case "thinking":
							setLive((l) => (l ? { ...l, thinking: l.thinking + e.delta } : l));
							break;
						case "player":
							setLive((l) => (l ? { ...l, player: e.text } : l));
							break;
						case "tool":
							setLive((l) => {
								if (!l) return l;
								const tools = l.tools.filter((t) => t.id !== e.id);
								return { ...l, tools: [...tools, { id: e.id, name: e.name, status: e.status, summary: e.summary, isError: e.isError }] };
							});
							break;
						case "roll":
							setRollQueue((q) => [...q.slice(-20), e.roll]);
							setLive((l) => (l ? { ...l, rolls: [...l.rolls, e.roll] } : l));
							break;
						case "state":
							setState(e.state);
							break;
						case "fx":
							setFx((f) => [...f.slice(-30), { ...(e.fx as FxEvent), id: `fx${++fxCounter}` } as FxItem]);
							break;
						case "error":
							setError(e.message);
							break;
					}
				});
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				busyRef.current = false;
				setBusy(false);
				setLive(null);
				await refresh();
			}
		},
		[refresh],
	);

	const send = useCallback((text: string) => stream(`/api/campaigns/${id}/turn`, { text }, { showPlayer: text }), [id, stream]);
	const act = useCallback((action: PlayerCombatAction) => stream(`/api/campaigns/${id}/action`, { action }), [id, stream]);
	const rollPending = useCallback(() => stream(`/api/campaigns/${id}/roll`, {}), [id, stream]);
	const abort = useCallback(() => fetch(`/api/campaigns/${id}/turn`, { method: "DELETE" }), [id]);

	const patchSettings = useCallback(
		async (settings: Partial<CampaignSettings>, title?: string) => {
			const res = await fetch(`/api/campaigns/${id}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings, title }) });
			const data = await res.json();
			if (data.state) setState(data.state);
			else setError(data.error ?? "Failed to save settings");
		},
		[id],
	);

	return { state, setState, log, live, busy, error, setError, rollQueue, fx, loaded, refresh, send, act, rollPending, abort, patchSettings };
}

export type Game = ReturnType<typeof useGame>;
