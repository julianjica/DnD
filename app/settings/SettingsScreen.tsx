"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Cpu, Home, KeyRound, LoaderCircle, RefreshCw, SlidersHorizontal, Terminal, Trash2, XCircle } from "lucide-react";
import type { EngineConfig } from "@/lib/game/types";
import type { ApiKeyStatus } from "@/lib/engines/keys";
import { Tabs } from "@/components/ui/Tabs";
import { Divider } from "@/components/ui/Divider";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/components/ui/cn";
import { EnginePicker, KeyEntry, PlanLimitBars, resolveEngine, useEngines } from "@/components/setup/EnginePicker";
import { DEFAULT_ENGINE, DEFAULT_ENGINE_KEY, DRAFT_KEY, loadJson, removeKey, saveJson } from "@/components/setup/wizardState";

type Tab = "engines" | "keys" | "defaults";

export function SettingsScreen() {
	const [tab, setTab] = useState<Tab>("engines");
	const engines = useEngines();
	return (
		<div className="mx-auto w-full max-w-5xl px-6 pb-16">
			<header className="flex items-center justify-between py-5">
				<Link href="/" className="group flex items-center gap-2 font-display text-lg tracking-wider text-gold-2">
					<Home className="size-4 text-gold/70 group-hover:text-gold-2" /> DungeonHarness
				</Link>
				<Link href="/new" className="btn btn-gold py-1.5 text-sm">
					New Adventure
				</Link>
			</header>
			<h1 className="heading mt-4 text-3xl">Settings</h1>
			<p className="mt-1 font-serif text-lg text-dim">Engines, API keys and defaults for new games. Per-campaign settings live in each game.</p>
			<Divider className="my-6" />
			<Tabs<Tab>
				label="Settings sections"
				value={tab}
				onChange={setTab}
				tabs={[
					{ id: "engines", label: "Engines", icon: <Terminal className="size-4" /> },
					{ id: "keys", label: "API keys", icon: <KeyRound className="size-4" /> },
					{ id: "defaults", label: "Defaults", icon: <SlidersHorizontal className="size-4" /> },
				]}
				panelClassName="pt-6"
			>
				{tab === "engines" && <EnginesPanel engines={engines} />}
				{tab === "keys" && <KeysPanel onChanged={() => void engines.reload()} />}
				{tab === "defaults" && <DefaultsPanel engines={engines} />}
			</Tabs>
		</div>
	);
}

function EnginesPanel({ engines }: { engines: ReturnType<typeof useEngines> }) {
	const { data, loading, error, reload } = engines;
	const rows = data
		? [
				{ id: "claude-code" as const, label: "Claude Code", icon: Terminal, st: data.status.claudeCode, hint: "Install the Claude Code CLI and sign in, or set DH_CLAUDE_CODE_PATH." },
				{ id: "codex" as const, label: "Codex", icon: Cpu, st: data.status.codex, hint: "Install the Codex CLI and sign in, or set DH_CODEX_PATH." },
			]
		: [];
	return (
		<div className="flex flex-col gap-4">
			<div className="flex justify-end">
				<button type="button" className="btn py-1.5 text-sm" onClick={() => void reload()} disabled={loading}>
					<RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh
				</button>
			</div>
			{error && <p className="text-sm text-crimson-2">Couldn&apos;t load engine status: {error}</p>}
			{!data && loading && (
				<div className="flex items-center gap-2 text-dim">
					<LoaderCircle className="size-4 animate-spin" /> Checking engines…
				</div>
			)}
			{rows.map((r) => {
				const limit = data?.limits.find((l) => l.engine === r.id);
				return (
					<div key={r.id} className="panel grid gap-4 p-5 md:grid-cols-[1fr_1fr]">
						<div>
							<div className="flex items-center gap-2">
								<r.icon className="size-5 text-gold/80" />
								<span className="font-display tracking-wide">{r.label}</span>
								<StatusPill ok={r.st.available} />
							</div>
							<dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
								<dt className="text-dim">Path</dt>
								<dd className="truncate font-mono text-xs leading-5" title={r.st.path}>
									{r.st.path ?? "not found"}
								</dd>
								<dt className="text-dim">Version</dt>
								<dd className="font-mono text-xs leading-5">{r.st.version ?? "—"}</dd>
							</dl>
							{!r.st.available && <p className="mt-2 text-xs text-faint">{r.hint}</p>}
						</div>
						<div className="rounded-lg border border-line bg-bg-2/50 p-3">
							<div className="mb-2 text-xs tracking-wider text-dim uppercase">{limit?.label ?? "Plan"} usage</div>
							{limit ? <PlanLimitBars snap={limit} /> : <div className="text-xs text-faint">No usage data.</div>}
						</div>
					</div>
				);
			})}
			{data && (
				<div className="panel p-5">
					<div className="flex items-center gap-2">
						<KeyRound className="size-5 text-gold/80" />
						<span className="font-display tracking-wide">API engines</span>
						<StatusPill ok={data.status.api.providersWithKeys.length > 0} okText={`${data.status.api.providersWithKeys.length} configured`} badText="No keys" />
					</div>
					<p className="mt-2 text-sm text-dim">{data.status.api.providersWithKeys.length ? `Keys for: ${data.status.api.providersWithKeys.join(", ")}.` : "Add an API key to use a provider directly."}</p>
				</div>
			)}
		</div>
	);
}

function StatusPill({ ok, okText = "Available", badText = "Unavailable" }: { ok: boolean; okText?: string; badText?: string }) {
	return (
		<span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs", ok ? "bg-emerald/15 text-emerald" : "bg-crimson/15 text-crimson-2")}>
			{ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
			{ok ? okText : badText}
		</span>
	);
}

function KeysPanel({ onChanged }: { onChanged: () => void }) {
	const [keys, setKeys] = useState<ApiKeyStatus[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const [removing, setRemoving] = useState<ApiKeyStatus | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await fetch("/api/keys", { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setKeys(((await res.json()) as { keys: ApiKeyStatus[] }).keys);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void load();
	}, [load]);

	const remove = async (p: ApiKeyStatus) => {
		try {
			const res = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: p.id, key: "" }) });
			if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
			await load();
			onChanged();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setRemoving(null);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<p className="text-sm text-dim">Keys are stored locally on this machine. Keys set as environment variables always take precedence and can&apos;t be edited here.</p>
			{error && <p className="text-sm text-crimson-2">{error}</p>}
			{!keys && !error && (
				<div className="flex items-center gap-2 text-dim">
					<LoaderCircle className="size-4 animate-spin" /> Loading…
				</div>
			)}
			<ul className="flex flex-col gap-2">
				{keys?.map((k) => (
					<li key={k.id} className="panel p-4">
						<div className="flex flex-wrap items-center gap-3">
							<span className={cn("size-2 rounded-full", k.present ? "bg-emerald" : "bg-line")} aria-hidden />
							<span className="font-display text-sm tracking-wide">{k.label}</span>
							<code className="text-[11px] text-faint">{k.envVar}</code>
							<span className="ml-auto flex items-center gap-2">
								{k.present && <code className="rounded bg-bg-2 px-2 py-0.5 text-xs text-dim">{k.masked}</code>}
								{k.source === "env" ? (
									<span className="rounded-full bg-sky/15 px-2 py-0.5 text-xs text-sky">from environment</span>
								) : (
									<>
										<button type="button" className="btn py-1 text-xs" onClick={() => setEditing(editing === k.id ? null : k.id)} aria-expanded={editing === k.id}>
											<KeyRound className="size-3.5" /> {k.present ? "Replace" : "Add key"}
										</button>
										{k.present && (
											<button type="button" className="btn btn-danger p-1.5" onClick={() => setRemoving(k)} aria-label={`Delete ${k.label} key`}>
												<Trash2 className="size-3.5" />
											</button>
										)}
									</>
								)}
							</span>
						</div>
						{editing === k.id && (
							<KeyEntry
								provider={k.id}
								label={`${k.label} API key`}
								onSaved={() => {
									setEditing(null);
									void load();
									onChanged();
								}}
							/>
						)}
					</li>
				))}
			</ul>
			<Modal
				open={!!removing}
				onClose={() => setRemoving(null)}
				title="Remove API key?"
				footer={
					<>
						<button type="button" className="btn" onClick={() => setRemoving(null)}>
							Cancel
						</button>
						<button type="button" className="btn btn-danger" onClick={() => removing && void remove(removing)}>
							<Trash2 className="size-4" /> Remove
						</button>
					</>
				}
			>
				<p className="text-dim">Campaigns using {removing?.label} models will need another engine until a key is added again.</p>
			</Modal>
		</div>
	);
}

function DefaultsPanel({ engines }: { engines: ReturnType<typeof useEngines> }) {
	const [engine, setEngine] = useState<EngineConfig | null>(null);
	const [saved, setSaved] = useState(false);
	const [draftCleared, setDraftCleared] = useState(false);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setEngine(loadJson<EngineConfig>(DEFAULT_ENGINE_KEY) ?? DEFAULT_ENGINE);
	}, []);

	useEffect(() => {
		if (!saved) return;
		const t = setTimeout(() => setSaved(false), 1800);
		return () => clearTimeout(t);
	}, [saved]);

	if (!engine) return null;
	return (
		<div className="flex flex-col gap-6">
			<section>
				<h2 className="heading text-lg">Default engine for new games</h2>
				<p className="mb-4 text-sm text-dim">The setup wizard starts with this engine. If it isn&apos;t available, the first available model is used.</p>
				<EnginePicker
					value={engine}
					engines={engines}
					onChange={(e) => {
						setEngine(e);
						saveJson(DEFAULT_ENGINE_KEY, e);
						setSaved(true);
					}}
				/>
				<div className="mt-4 flex items-center gap-3">
					<button
						type="button"
						className="btn py-1.5 text-sm"
						disabled={!engines.data}
						onClick={() => {
							const e = resolveEngine(engines.data!.models, engine);
							setEngine(e);
							saveJson(DEFAULT_ENGINE_KEY, e);
							setSaved(true);
						}}
					>
						Use best available
					</button>
					<span className={cn("inline-flex items-center gap-1 text-sm text-emerald transition-opacity", saved ? "opacity-100" : "opacity-0")} aria-live="polite">
						<CheckCircle2 className="size-4" /> Saved
					</span>
				</div>
			</section>
			<Divider />
			<section>
				<h2 className="heading text-lg">Setup wizard</h2>
				<p className="mb-3 text-sm text-dim">An unfinished adventure setup is kept in this browser so a refresh doesn&apos;t lose it.</p>
				<button
					type="button"
					className="btn btn-danger py-1.5 text-sm"
					onClick={() => {
						removeKey(DRAFT_KEY);
						setDraftCleared(true);
					}}
				>
					<Trash2 className="size-4" /> {draftCleared ? "Draft cleared" : "Clear saved draft"}
				</button>
			</section>
		</div>
	);
}
