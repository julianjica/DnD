"use client";

/**
 * Root Access: Hat, Heat and Humanity in the sidebar, plus the chrome the PC
 * carries in their body. Read-only: the engine owns state.cyber
 * (lib/rules/cyber.ts).
 */
import { Cpu, Flame, HeartPulse, Siren, VenetianMask } from "lucide-react";
import type { CyberState, GameState, ImplantSlot } from "@/lib/game/types";
import { EPISODE_AT, episodeDc, HAT_MAX, HAT_MIN, HEAT_MAX, HEAT_THRESHOLDS, hatBand, UNSETTLING_AT } from "@/lib/rules/cyber";
import { getEquipment } from "@/lib/srd";
import { gameMinutes } from "@/lib/rules/survival";
import { useT } from "@/components/i18n/I18nProvider";
import { Tooltip } from "@/components/ui/Tooltip";
import type { MessageKey } from "@/lib/i18n";

const HAT_SPAN = HAT_MAX - HAT_MIN;
/** Position (0–100%) of a hat value on the black↔white scale. */
const hatPct = (n: number) => ((Math.max(HAT_MIN, Math.min(HAT_MAX, n)) - HAT_MIN) / HAT_SPAN) * 100;

/** Heat segment colours: cool grey → amber → red → white-hot. */
function heatColor(i: number): string {
	if (i <= 2) return "#8a8f94";
	if (i <= 5) return "#d99a2b";
	if (i <= 7) return "#e0702f";
	if (i <= 9) return "#d9503f";
	return "#ff2a1a";
}

function humanityColor(h: number): string {
	if (h <= UNSETTLING_AT) return "#d9503f";
	if (h <= EPISODE_AT) return "#d99a2b";
	return "#3fb8a8";
}

function HatScale({ hat }: { hat: number }) {
	const { t } = useT();
	const band = hatBand(hat);
	return (
		<Tooltip content={t("play.cyber.hatHelp")} className="block w-full">
			<div className="w-full" tabIndex={0} role="meter" aria-valuemin={HAT_MIN} aria-valuemax={HAT_MAX} aria-valuenow={hat} aria-label={t("play.cyber.hat")}>
				<div className="mb-1 flex items-center justify-between text-xs text-dim">
					<span className="flex items-center gap-1"><VenetianMask size={13} /> {t("play.cyber.hat")}</span>
					<span className="tabular-nums text-text">{t("play.cyber.hatValue", { n: hat > 0 ? `+${hat}` : String(hat), band: t(`play.cyber.band.${band}` as MessageKey) })}</span>
				</div>
				<div className="relative h-2.5 rounded-full border border-line" style={{ background: "linear-gradient(90deg,#0b0b0d 0%,#3a3d42 35%,#7d8187 50%,#b9bcc0 65%,#f2f2ee 100%)" }}>
					{/* the grey band, −3…+3 */}
					<span className="absolute inset-y-[-3px] rounded-sm border border-dashed border-text/40" style={{ left: `${hatPct(-3.5)}%`, width: `${hatPct(3.5) - hatPct(-3.5)}%` }} />
					<span className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-bg bg-gold shadow transition-[left] duration-500" style={{ left: `${hatPct(hat)}%` }} />
				</div>
				<div className="mt-0.5 flex justify-between text-[9px] uppercase tracking-wider text-faint">
					<span>{t("play.cyber.hatBlack")}</span>
					<span>{t("play.cyber.band.grey")}</span>
					<span>{t("play.cyber.hatWhite")}</span>
				</div>
			</div>
		</Tooltip>
	);
}

function HeatMeter({ heat }: { heat: number }) {
	const { t } = useT();
	const marks = new Set<number>(HEAT_THRESHOLDS.map((x) => x.at));
	return (
		<Tooltip
			content={
				<div className="space-y-1">
					<div>{t("play.cyber.heatHelp")}</div>
					{HEAT_THRESHOLDS.map((x) => (
						<div key={x.id} className={heat >= x.at ? "font-semibold" : "text-dim"} style={heat >= x.at ? { color: heatColor(x.at) } : undefined}>{t(`play.cyber.heat.${x.id}` as MessageKey)}</div>
					))}
				</div>
			}
			className="block w-full"
		>
			<div className="w-full" tabIndex={0} role="meter" aria-valuemin={0} aria-valuemax={HEAT_MAX} aria-valuenow={heat} aria-label={t("play.cyber.heat")}>
				<div className="mb-1 flex items-center justify-between text-xs text-dim">
					<span className="flex items-center gap-1"><Flame size={13} /> {t("play.cyber.heat")}</span>
					<span className="tabular-nums" style={{ color: heat ? heatColor(heat) : "var(--text-faint)" }}>{heat}/{HEAT_MAX}</span>
				</div>
				<div className="flex items-end gap-0.5">
					{Array.from({ length: HEAT_MAX }, (_, j) => {
						const i = j + 1;
						const on = i <= heat;
						return (
							<span key={i} className="relative h-3 flex-1 rounded-[1px] border" style={{ background: on ? heatColor(i) : "transparent", borderColor: on ? heatColor(i) : "var(--line)", opacity: on ? 1 : 0.7 }}>
								{marks.has(i) && <span className="absolute -left-[2px] -top-0.5 h-[calc(100%+0.25rem)] w-[2px] bg-text/60" />}
							</span>
						);
					})}
				</div>
				<div className="relative mt-0.5 h-3 text-[9px] uppercase tracking-wider text-faint">
					{HEAT_THRESHOLDS.map((x) => (
						<span key={x.id} className={`absolute ${x.at === HEAT_MAX ? "right-0" : "-translate-x-1/2"}`} style={x.at === HEAT_MAX ? undefined : { left: `${((x.at - 1) / HEAT_MAX) * 100}%` }}>
							{t(`play.cyber.tick.${x.id}` as MessageKey)}
						</span>
					))}
				</div>
			</div>
		</Tooltip>
	);
}

function HumanityBar({ cy }: { cy: CyberState }) {
	const { t } = useT();
	const max = Math.max(1, cy.humanityMax);
	const pct = (n: number) => Math.max(0, Math.min(100, (n / max) * 100));
	return (
		<Tooltip content={t("play.cyber.humanityHelp")} className="block w-full">
			<div className="w-full" tabIndex={0} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={cy.humanity} aria-label={t("play.cyber.humanity")}>
				<div className="mb-1 flex items-center justify-between text-xs text-dim">
					<span className="flex items-center gap-1"><HeartPulse size={13} /> {t("play.cyber.humanity")}</span>
					<span className="tabular-nums" style={{ color: humanityColor(cy.humanity) }}>{cy.humanity} / {cy.humanityMax}</span>
				</div>
				<div className="relative h-2.5 overflow-hidden rounded-full border border-line bg-bg">
					{/* zones: episodes (≤10) and unsettling (≤5) */}
					<span className="absolute inset-y-0 left-0 bg-[#d99a2b]/15" style={{ width: `${pct(EPISODE_AT)}%` }} />
					<span className="absolute inset-y-0 left-0 bg-[#d9503f]/20" style={{ width: `${pct(UNSETTLING_AT)}%` }} />
					<div className="relative h-full rounded-full transition-[width] duration-500" style={{ width: `${pct(cy.humanity)}%`, background: humanityColor(cy.humanity) }} />
					<span className="absolute inset-y-0 w-px bg-text/50" style={{ left: `${pct(EPISODE_AT)}%` }} />
					<span className="absolute inset-y-0 w-px bg-text/50" style={{ left: `${pct(UNSETTLING_AT)}%` }} />
				</div>
				<div className="relative mt-0.5 h-3 text-[9px] uppercase tracking-wider text-faint">
					<span className="absolute -translate-x-full pr-0.5" style={{ left: `${pct(UNSETTLING_AT)}%` }}>{t("play.cyber.zone.unsettling")}</span>
					<span className="absolute -translate-x-full pr-0.5" style={{ left: `${pct(EPISODE_AT)}%` }}>{t("play.cyber.zone.episode")}</span>
				</div>
			</div>
		</Tooltip>
	);
}

/** A raid on the den is coming (or on): who, and how long until it lands (lib/rules/raid.ts). */
function RaidChip({ state }: { state: GameState }) {
	const { t } = useT();
	const due = state.cyber?.den?.raidDue;
	if (!due) return null;
	const left = due.at - gameMinutes(state.time);
	const phase = due.started ? "on" : left <= 0 ? "now" : "due";
	const who = t(`play.cyber.raid.by.${due.by}` as MessageKey);
	return (
		<Tooltip content={t(`play.cyber.raid.help.${phase}` as MessageKey, { who, h: Math.max(1, Math.ceil(left / 60)) })}>
			<span tabIndex={0} className="chip animate-pulse border-crimson/60 text-crimson-2" data-testid="raid-chip">
				<Siren size={12} /> {t(`play.cyber.raid.${phase}` as MessageKey, { h: Math.max(1, Math.ceil(left / 60)) })}
			</span>
		</Tooltip>
	);
}

/** Compact Root Access block for the character sheet (cyberpunk campaigns only). */
export function CyberMeters({ state }: { state: GameState }) {
	const { t, ts } = useT();
	const cy = state.cyber;
	if (!cy) return null;
	return (
		<section className="space-y-2.5 rounded-lg border border-line bg-bg-2/60 p-2.5" data-testid="cyber-meters">
			<h4 className="heading text-sm">{t("play.cyber.title")}</h4>
			<HatScale hat={cy.hat} />
			<HeatMeter heat={cy.heat} />
			<RaidChip state={state} />
			<HumanityBar cy={cy} />
			{cy.humanity <= EPISODE_AT && (
				<div className="flex flex-wrap gap-1">
					<Tooltip content={t("play.cyber.episodeRiskTitle", { dc: episodeDc(cy.humanity) })}>
						<span tabIndex={0} className="chip border-[#d99a2b]/60 text-[#e7b25a]">{t("play.cyber.episodeRisk")}</span>
					</Tooltip>
					{cy.humanity <= UNSETTLING_AT && (
						<Tooltip content={t("play.cyber.unsettlingTitle")}>
							<span tabIndex={0} className="chip border-crimson/50 text-crimson-2">{t("play.cyber.unsettling")}</span>
						</Tooltip>
					)}
				</div>
			)}
			<div>
				<div className="mb-1 flex items-center gap-1 text-xs text-dim"><Cpu size={13} /> {t("play.cyber.implants")}</div>
				{cy.implants.length === 0 ? (
					<p className="text-xs text-faint">{t("play.cyber.noImplants")}</p>
				) : (
					<ul className="space-y-1">
						{cy.implants.map((imp, k) => {
							const eq = getEquipment(imp.ref);
							return (
								<li key={`${imp.ref}-${k}`}>
									<Tooltip content={eq?.implant?.effect ? ts(eq.implant.effect) : ts(eq?.name ?? imp.ref)} className="block w-full">
										<div tabIndex={0} className="flex w-full items-center justify-between gap-2 rounded-md border border-line px-2 py-1 text-xs">
											<span className="min-w-0 truncate text-text">{ts(eq?.name ?? imp.ref)}</span>
											<span className="shrink-0 text-faint">{t(`play.cyber.slot.${imp.slot as ImplantSlot}` as MessageKey)} · {t("play.cyber.implantCost", { n: imp.humanity })}</span>
										</div>
									</Tooltip>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</section>
	);
}
