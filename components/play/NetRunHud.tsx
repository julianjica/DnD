"use client";

/**
 * Root Access: the net run in progress (docs/cyberpunk.md §4), shown over the
 * stage while the PC is jacked in: the trace clock 0…10 with its 5/8/10
 * thresholds, the target and its security, where the body is, and how many
 * nodes are open. Read-only: the engine owns state.cyber.run.
 */
import { useMemo } from "react";
import { MapPin, Network, ShieldAlert, Unplug } from "lucide-react";
import type { GameState, NetRun } from "@/lib/game/types";
import { TRACE_MAX } from "@/lib/rules/netrun";
import { nodesOpen, TRACE_MARKS, traceBand } from "@/components/art/sprite/net";
import { useT } from "@/components/i18n/I18nProvider";
import { Tooltip } from "@/components/ui/Tooltip";
import type { MessageKey } from "@/lib/i18n";

export interface NetRunView {
	run: NetRun;
	open: number;
	total: number;
	band: ReturnType<typeof traceBand>;
}

/** The run in progress, if the PC is jacked in, with what the HUD shows. */
export function useNetRun(state: Pick<GameState, "cyber">): NetRunView | undefined {
	const run = state.cyber?.run;
	return useMemo(() => (run ? { run, ...nodesOpen(run), band: traceBand(run.trace) } : undefined), [run]);
}

/** Trace segment colours: cool → amber (sysadmin) → red (security) → white-hot (dumped). */
function traceColor(i: number): string {
	if (i < 5) return "#3fb8a8";
	if (i < 8) return "#d99a2b";
	if (i < 10) return "#d9503f";
	return "#ff2a1a";
}

const BAND_COLOR = { calm: "#3fb8a8", alerted: "#d99a2b", hunted: "#d9503f", dumped: "#ff2a1a" } as const;

function TraceBar({ trace, band }: { trace: number; band: NetRunView["band"] }) {
	const { t } = useT();
	return (
		<Tooltip
			content={
				<div className="space-y-1">
					<div>{t("play.net.traceHelp")}</div>
					{TRACE_MARKS.map((m) => (
						<div key={m.id} className={trace >= m.at ? "font-semibold" : "text-dim"} style={trace >= m.at ? { color: traceColor(m.at) } : undefined}>
							{t(`play.net.markHelp.${m.id}` as MessageKey)}
						</div>
					))}
				</div>
			}
			className="block min-w-[11rem] flex-1"
		>
			<div tabIndex={0} role="meter" aria-valuemin={0} aria-valuemax={TRACE_MAX} aria-valuenow={trace} aria-label={t("play.net.trace")} className="w-full">
				<div className="mb-0.5 flex items-center justify-between text-[11px]">
					<span className="uppercase tracking-wider text-dim">{t("play.net.trace")}</span>
					<span className="tabular-nums font-semibold" style={{ color: BAND_COLOR[band] }}>
						{trace}/{TRACE_MAX} · {t(`play.net.band.${band}` as MessageKey)}
					</span>
				</div>
				<div className="flex items-end gap-0.5">
					{Array.from({ length: TRACE_MAX }, (_, j) => {
						const i = j + 1;
						const on = i <= trace;
						const mark = TRACE_MARKS.some((m) => m.at === i);
						return (
							<span key={i} className="relative h-2.5 flex-1 rounded-[1px] border" style={{ background: on ? traceColor(i) : "transparent", borderColor: on ? traceColor(i) : "var(--line)", boxShadow: on && i === trace ? `0 0 6px ${traceColor(i)}` : undefined }}>
								{mark && <span className="absolute -right-[2px] -top-0.5 h-[calc(100%+0.25rem)] w-[2px] bg-text/60" />}
							</span>
						);
					})}
				</div>
				<div className="relative mt-0.5 h-3 text-[9px] uppercase tracking-wider text-faint">
					{TRACE_MARKS.map((m) => (
						<span key={m.id} className={`absolute ${m.at === TRACE_MAX ? "right-0" : "-translate-x-full pr-0.5"}`} style={m.at === TRACE_MAX ? undefined : { left: `${(m.at / TRACE_MAX) * 100}%` }}>
							<span style={trace >= m.at ? { color: traceColor(m.at) } : undefined}>{t(`play.net.mark.${m.id}` as MessageKey)}</span>
						</span>
					))}
				</div>
			</div>
		</Tooltip>
	);
}

/** The run HUD strip (renders nothing when not jacked in). */
export function NetRunHud({ state, view: given }: { state: Pick<GameState, "cyber">; view?: NetRunView }) {
	const { t, ts } = useT();
	const hooked = useNetRun(state);
	const v = given ?? hooked;
	if (!v) return null;
	const { run } = v;
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-bg-2/70 px-3 py-1.5 text-xs" data-testid="net-run-hud">
			<div className="flex min-w-0 items-center gap-2">
				<Network size={15} className="shrink-0" style={{ color: BAND_COLOR[v.band] }} />
				<div className="min-w-0">
					<div className="text-[10px] uppercase tracking-widest text-faint">{t("play.net.title")}</div>
					<div className="truncate font-semibold text-text" title={ts(run.target)}>{ts(run.target)}</div>
				</div>
				<Tooltip content={t("play.net.securityHelp")}>
					<span tabIndex={0} className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-dim" aria-label={t("play.net.security", { n: run.security })}>
						<ShieldAlert size={12} />
						<span className="flex gap-[2px]">
							{Array.from({ length: 5 }, (_, i) => (
								<span key={i} className="h-2 w-1.5 rounded-[1px]" style={{ background: i < run.security ? "#d9503f" : "var(--line)" }} />
							))}
						</span>
					</span>
				</Tooltip>
			</div>
			<TraceBar trace={run.trace} band={v.band} />
			<div className="flex items-center gap-2">
				<Tooltip content={t(`play.net.bodyHelp.${run.body}` as MessageKey)}>
					<span tabIndex={0} className={`chip flex items-center gap-1 ${run.body === "onsite" ? "border-crimson/50 text-crimson-2" : run.body === "public" ? "border-[#d99a2b]/60 text-[#e7b25a]" : ""}`}>
						<MapPin size={12} /> {t(`play.net.body.${run.body}` as MessageKey)}
					</span>
				</Tooltip>
				<Tooltip content={t("play.net.nodesHelp")}>
					<span tabIndex={0} className="chip flex items-center gap-1 tabular-nums">
						<Unplug size={12} /> {t("play.net.nodes", { open: v.open, total: v.total })}
					</span>
				</Tooltip>
			</div>
		</div>
	);
}
