"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Cloud, Cpu, KeyRound, LoaderCircle, RefreshCw, Terminal } from "lucide-react";
import type { EngineConfig, EngineProvider, Effort, ModelOption } from "@/lib/game/types";
import type { EngineStatus } from "@/lib/engines/catalog";
import type { PlanLimitsSnapshot } from "@/lib/engines/plan-limits";
import { Segmented } from "@/components/ui/Tabs";
import { cn } from "@/components/ui/cn";
import { FieldLabel } from "./Field";
import { useT } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";

export interface EnginesResponse {
	models: ModelOption[];
	status: EngineStatus;
	limits: PlanLimitsSnapshot[];
}

/** GET /api/engines with loading/error state and a reload function. */
export function useEngines() {
	const [data, setData] = useState<EnginesResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const reload = useCallback(async () => {
		setLoading(true);
		try {
			const res = await fetch("/api/engines", { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setData((await res.json()) as EnginesResponse);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void reload();
	}, [reload]);
	return { data, error, loading, reload };
}

export const PROVIDERS: { id: EngineProvider; label: MessageKey; blurb: MessageKey; icon: typeof Terminal }[] = [
	{ id: "claude-code", label: "engine.provider.claude-code", blurb: "engine.blurb.claude-code", icon: Terminal },
	{ id: "codex", label: "engine.provider.codex", blurb: "engine.blurb.codex", icon: Cpu },
	{ id: "api", label: "engine.provider.api", blurb: "engine.blurb.api", icon: Cloud },
];

type T = ReturnType<typeof useT>["t"];

export const EFFORTS: Effort[] = ["off", "low", "medium", "high", "xhigh", "max"];

/** Picks the configured engine if available, else the first available model (CLI engines first). */
export function resolveEngine(models: ModelOption[], want: EngineConfig): EngineConfig {
	const exact = models.find((m) => m.provider === want.provider && m.id === want.model && (m.apiProvider ?? undefined) === (want.apiProvider ?? undefined));
	if (exact?.available) return want;
	const first = models.find((m) => m.available && m.provider === want.provider) ?? models.find((m) => m.available);
	if (!first) return want;
	return { provider: first.provider, model: first.id, ...(first.apiProvider ? { apiProvider: first.apiProvider } : {}), effort: want.effort };
}

export function modelKey(m: { provider: string; apiProvider?: string; id?: string; model?: string }) {
	return `${m.provider}|${m.apiProvider ?? ""}|${m.id ?? m.model}`;
}

function providerStatus(p: EngineProvider, data: EnginesResponse | null, t: T): { ok: boolean; text: string } {
	if (!data) return { ok: false, text: t("engine.checking") };
	if (p === "claude-code") return data.status.claudeCode.available ? { ok: true, text: data.status.claudeCode.version ? `v${data.status.claudeCode.version.replace(/^v/, "")}` : t("engine.ready") } : { ok: false, text: t("engine.cliNotFound") };
	if (p === "codex") return data.status.codex.available ? { ok: true, text: data.status.codex.version ? `v${data.status.codex.version.replace(/^v/, "")}` : t("engine.ready") } : { ok: false, text: t("engine.cliNotFound") };
	const n = data.status.api.providersWithKeys.length;
	return n ? { ok: true, text: n === 1 ? t("engine.providersOne") : t("engine.providersMany", { n }) } : { ok: false, text: t("engine.noKeys") };
}

export function PlanLimitBars({ snap }: { snap: PlanLimitsSnapshot }) {
	const { t, lang } = useT();
	if (!snap.available) return <div className="text-xs text-faint">{snap.error ?? snap.note ?? t("engine.usageUnavailable")}</div>;
	if (!snap.windows.length) return <div className="text-xs text-faint">{snap.note ?? t("engine.noWindows")}</div>;
	return (
		<div className="flex flex-col gap-1.5">
			{snap.planType && <div className="text-[11px] tracking-wider text-dim uppercase">{t("engine.plan", { plan: snap.planType })}</div>}
			{snap.windows.map((w) => (
				<div key={w.id}>
					<div className="flex justify-between text-[11px] text-dim">
						<span>{w.label}</span>
						<span className="tabular-nums">
							{Math.round(w.usedPercent)}%{w.resetsAt ? ` · ${t("engine.resets", { when: new Date(w.resetsAt).toLocaleString(lang, { weekday: "short", hour: "numeric", minute: "2-digit" }) })}` : ""}
						</span>
					</div>
					<div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-bg-2">
						<div className={cn("h-full rounded-full", w.usedPercent > 85 ? "bg-crimson" : w.usedPercent > 60 ? "bg-gold" : "bg-emerald")} style={{ width: `${Math.min(100, w.usedPercent)}%` }} />
					</div>
				</div>
			))}
		</div>
	);
}

export interface EnginePickerProps {
	value: EngineConfig;
	onChange: (v: EngineConfig) => void;
	engines: ReturnType<typeof useEngines>;
	/** Hide the effort control (e.g. a compact settings default). */
	hideEffort?: boolean;
}

export function EnginePicker({ value, onChange, engines, hideEffort }: EnginePickerProps) {
	const { data, error, loading, reload } = engines;
	const { t, te } = useT();
	const models = data?.models ?? [];
	const inProvider = models.filter((m) => m.provider === value.provider);
	const selected = models.find((m) => modelKey(m) === modelKey(value));
	const apiGroups = [...new Set(inProvider.map((m) => m.apiProvider ?? ""))];
	const limit = data?.limits.find((l) => l.engine === value.provider);

	const pickProvider = (p: EngineProvider) => {
		const first = models.find((m) => m.provider === p && m.available) ?? models.find((m) => m.provider === p);
		onChange({ provider: p, model: first?.id ?? "", ...(first?.apiProvider ? { apiProvider: first.apiProvider } : {}), effort: value.effort });
	};

	return (
		<div className="flex flex-col gap-5">
			<div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label={t("engine.aria")}>
				{PROVIDERS.map((p) => {
					const st = providerStatus(p.id, data, t);
					const active = value.provider === p.id;
					return (
						<button
							key={p.id}
							type="button"
							role="radio"
							aria-checked={active}
							onClick={() => pickProvider(p.id)}
							className={cn("panel flex flex-col gap-2 p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-gold", active ? "border-gold bg-gold/10" : "hover:border-gold/50")}
						>
							<div className="flex items-center gap-2">
								<p.icon className={cn("size-5", active ? "text-gold-2" : "text-dim")} />
								<span className="font-display text-sm tracking-wide">{t(p.label)}</span>
							</div>
							<span className="text-xs leading-snug text-dim">{t(p.blurb)}</span>
							<span className={cn("mt-auto inline-flex items-center gap-1 text-xs", st.ok ? "text-emerald" : "text-faint")}>
								{loading && !data ? <LoaderCircle className="size-3 animate-spin" /> : st.ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
								{st.text}
							</span>
						</button>
					);
				})}
			</div>

			{error && (
				<div className="flex items-center gap-2 text-sm text-crimson-2">
					<AlertTriangle className="size-4" /> {t("engine.loadError", { error })}
					<button type="button" className="btn py-1 text-xs" onClick={() => void reload()}>
						<RefreshCw className="size-3.5" /> {t("engine.retry")}
					</button>
				</div>
			)}

			<div className="grid gap-5 md:grid-cols-2">
				<div>
					<FieldLabel htmlFor="engine-model">{t("engine.model")}</FieldLabel>
					<select
						id="engine-model"
						className="input"
						value={modelKey(value)}
						disabled={!data}
						onChange={(e) => {
							const m = inProvider.find((x) => modelKey(x) === e.target.value);
							if (m) onChange({ provider: m.provider, model: m.id, ...(m.apiProvider ? { apiProvider: m.apiProvider } : {}), effort: value.effort });
						}}
					>
						{!selected && <option value={modelKey(value)}>{value.model || t("engine.selectModel")}</option>}
						{value.provider === "api"
							? apiGroups.map((g) => (
									<optgroup key={g} label={g || t("engine.otherGroup")}>
										{inProvider
											.filter((m) => (m.apiProvider ?? "") === g)
											.map((m) => (
												<option key={modelKey(m)} value={modelKey(m)}>
													{m.label}
													{m.available ? "" : t("engine.needsKey")}
												</option>
											))}
									</optgroup>
								))
							: inProvider.map((m) => (
									<option key={modelKey(m)} value={modelKey(m)}>
										{m.label}
										{m.available ? "" : t("engine.unavailableSuffix")}
									</option>
								))}
					</select>
					{selected && !selected.available && <p className="mt-1.5 flex items-start gap-1.5 text-xs text-gold"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> {selected.reason ?? t("settings.status.unavailable")}</p>}
					{value.provider === "api" && value.apiProvider && selected && !selected.available && <KeyEntry provider={value.apiProvider} onSaved={() => void reload()} />}
				</div>
				{!hideEffort && (
					<div>
						<FieldLabel>{t("engine.effort")}</FieldLabel>
						<Segmented<Effort> label={t("engine.effort")} size="sm" value={value.effort} onChange={(effort) => onChange({ ...value, effort })} options={EFFORTS.map((e) => ({ value: e, label: te("effort", e) }))} />
						<p className="mt-1.5 text-xs text-dim">{t("engine.effortHint")}</p>
					</div>
				)}
			</div>

			{limit && (value.provider === "claude-code" || value.provider === "codex") && (
				<div className="rounded-lg border border-line bg-bg-2/50 p-3">
					<div className="mb-2 text-xs tracking-wider text-dim uppercase">{t("settings.engines.usage", { label: limit.label })}</div>
					<PlanLimitBars snap={limit} />
				</div>
			)}
		</div>
	);
}

/** Inline API key entry: POST /api/keys { provider, key }. */
export function KeyEntry({ provider, onSaved, label }: { provider: string; onSaved: () => void; label?: string }) {
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const { t } = useT();
	const save = async () => {
		setBusy(true);
		setErr(null);
		try {
			const res = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, key }) });
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			setKey("");
			onSaved();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<form
			className="mt-3 rounded-lg border border-gold/40 bg-gold/5 p-3"
			onSubmit={(e) => {
				e.preventDefault();
				if (key.trim()) void save();
			}}
		>
			<FieldLabel htmlFor={`key-${provider}`}>
				<span className="inline-flex items-center gap-1.5">
					<KeyRound className="size-3.5 text-gold" /> {label ?? t("settings.keys.keyLabel", { label: provider })}
				</span>
			</FieldLabel>
			<div className="flex gap-2">
				<input id={`key-${provider}`} type="password" autoComplete="off" className="input font-mono text-sm" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" />
				<button type="submit" className="btn btn-gold shrink-0" disabled={busy || !key.trim()}>
					{busy ? <LoaderCircle className="size-4 animate-spin" /> : t("common.save")}
				</button>
			</div>
			<p className="mt-1.5 text-[11px] text-faint">{t("engine.keyNote")}</p>
			{err && <p className="mt-1 text-xs text-crimson-2">{err}</p>}
		</form>
	);
}
