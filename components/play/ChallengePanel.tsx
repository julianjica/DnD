"use client";

/**
 * Timed challenges (chases, heists, escapes): a fast mini-game over the stage.
 * The clock counts down in ticks, the bar shows progress, and each stage offers
 * 2–4 approaches with the skill, the real odds (from the PC's bonus and the DC)
 * and what's at stake. The engine resolves every pick (lib/rules/challenge.ts);
 * this only shows the state and sends the choices. When it ends, the DM
 * narrates once and the player closes the result card.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronUp, DoorOpen, EyeOff, Flag, Footprints, Gem, Hourglass, Timer, Users, X, Zap } from "lucide-react";
import type { ChallengeKind, ChallengeLogEntry, GameState } from "@/lib/game/types";
import { approachOdds, type ApproachOdds } from "@/lib/rules/challenge";
import { useT } from "@/components/i18n/I18nProvider";
import { Tooltip } from "@/components/ui/Tooltip";
import type { ChallengeOp } from "./useGame";

const KIND_ICON: Record<ChallengeKind, typeof Timer> = { chase: Footprints, heist: Gem, escape: DoorOpen, infiltration: EyeOff, race: Flag, other: Timer };
const BAND_COLOR: Record<ApproachOdds["band"], string> = { easy: "text-emerald border-emerald/50", risky: "text-gold-2 border-gold/50", hard: "text-[#d99a2b] border-[#d99a2b]/50", desperate: "text-crimson-2 border-crimson/60" };
const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);

export function ChallengePanel(props: { state: GameState; busy: boolean; send: (op: ChallengeOp) => void }) {
	const { state, busy, send } = props;
	const { t, te } = useT();
	const [open, setOpen] = useState(true);
	const [confirm, setConfirm] = useState(false);
	const ch = state.challenge!;
	const active = ch.status === "active";
	const fighting = state.encounter?.status === "active";
	const stage = ch.stages[ch.stage];
	const odds = useMemo(() => (active && stage ? stage.approaches.map((ap) => approachOdds(state, ap)) : []), [active, stage, state]);
	const Icon = KIND_ICON[ch.kind] ?? Timer;
	const low = ch.clock <= 2;
	const skillName = (s?: string) => (!s ? "" : ABILITIES.has(s) ? te("ability", s) : te("skill", s));
	const last = [...ch.log].reverse().find((e) => e.kind === "attempt");
	const lastIsNew = !!last && ch.log[ch.log.length - 1] === last;
	const fired = ch.log.filter((e) => e.kind === "complication" && e.label && !/^The player broke off/.test(e.label));

	if (!open)
		return (
			<button className={`panel absolute left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-sm ${low && active ? "text-crimson-2" : "text-gold-2"}`} onClick={() => setOpen(true)} data-testid="challenge-collapsed">
				<Icon size={15} /> {ch.title} · <Hourglass size={13} /> {ch.clock} · {ch.progress}/{ch.target}
				<ChevronDown size={14} />
			</button>
		);

	if (fighting)
		return (
			<div className="panel absolute left-1/2 top-12 z-30 flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-xs text-dim">
				<Icon size={14} /> {ch.title}: {t("challenge.fightPaused")}
			</div>
		);

	return (
		<div className="panel absolute left-1/2 top-12 z-30 flex max-h-[calc(100%-4rem)] w-[30rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-col gap-2.5 overflow-y-auto p-3 text-sm shadow-2xl" data-testid="challenge-panel">
			<style>{`@keyframes chPop{0%{transform:scale(.85);opacity:0}60%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}@keyframes chTick{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
			{/* Title */}
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5 font-display text-[10px] uppercase tracking-widest text-faint">
						<Icon size={13} /> {t(`challenge.kind.${ch.kind}`)}
					</div>
					<div className="font-display text-base leading-tight text-gold-2">{ch.title}</div>
					<div className="text-xs italic text-dim">{ch.goal}</div>
				</div>
				<button className="text-faint hover:text-text" title={t("challenge.collapse")} aria-label={t("challenge.collapse")} onClick={() => setOpen(false)}>
					<ChevronUp size={15} />
				</button>
			</div>

			{/* Clock and progress */}
			<div className="flex items-center gap-3">
				<div className={`flex shrink-0 flex-col items-center rounded-md border px-2.5 py-1 ${low && active ? "border-crimson/70 bg-crimson/15 text-crimson-2" : "border-line text-text"}`} style={low && active ? { animation: "chTick 1s ease-in-out infinite" } : undefined} data-testid="challenge-clock">
					<span className="font-display text-2xl leading-none tabular-nums">{ch.clock}</span>
					<span className="text-[9px] uppercase tracking-wider text-faint">{ch.clock > 0 ? t("challenge.clock") : t("challenge.clockOut")}</span>
				</div>
				<div className="min-w-0 flex-1 space-y-1.5">
					<div className="flex gap-0.5" aria-hidden>
						{Array.from({ length: ch.clockMax }, (_, i) => (
							<span key={i} className={`h-2 flex-1 rounded-sm ${i < ch.clock ? (low ? "bg-crimson-2" : "bg-gold") : "bg-panel-3"}`} />
						))}
					</div>
					<div className="flex items-center gap-2">
						<div className="flex flex-1 gap-0.5" aria-hidden>
							{Array.from({ length: ch.target }, (_, i) => (
								<span key={i} className={`h-2 flex-1 rounded-sm ${i < ch.progress ? "bg-emerald" : "bg-panel-3"}`} />
							))}
						</div>
						<span className="shrink-0 text-[11px] text-dim">{t("challenge.progress", { n: Math.min(ch.progress, ch.target), total: ch.target })}</span>
					</div>
				</div>
			</div>

			{/* The last roll, big and quick */}
			{last && (active || lastIsNew) && (
				<div key={ch.log.length} className={`flex flex-wrap items-center gap-x-2 rounded border px-2 py-1 text-xs ${last.success ? "border-emerald/50 bg-emerald/10 text-emerald" : "border-crimson/60 bg-crimson/10 text-crimson-2"}`} style={{ animation: "chPop .35s ease-out" }} data-testid="challenge-last">
					{last.success ? <Check size={13} /> : <X size={13} />}
					<span className="font-semibold">{last.success ? t("challenge.made", { total: last.total ?? 0, dc: last.dc ?? 0 }) : t("challenge.missed", { total: last.total ?? 0, dc: last.dc ?? 0 })}</span>
					<span className="text-dim">· {last.label}</span>
					{!last.success && <PaidText p={last.paid} />}
				</div>
			)}

			{fired.map((c, i) => (
				<div key={i} className="flex items-start gap-1.5 rounded border border-[#d99a2b]/60 bg-[#d99a2b]/10 px-2 py-1 text-xs text-[#e8b25a]">
					<AlertTriangle size={13} className="mt-0.5 shrink-0" />
					<span>
						<b>{t("challenge.complication")}:</b> {c.label}
						{c.dc ? ` — ${t("challenge.dcUp", { n: c.dc })}` : ""}
						{c.paid && <PaidText p={c.paid} />}
					</span>
				</div>
			))}

			{active && stage ? (
				<>
					<div>
						<div className="text-[10px] uppercase tracking-wider text-faint">{t("challenge.stage", { n: ch.stage + 1, total: ch.stages.length })}</div>
						<div className="font-fell text-[15px] leading-snug text-parchment">{stage.prompt}</div>
					</div>
					<div className="grid gap-1.5" data-testid="challenge-approaches">
						{stage.approaches.map((ap, i) => {
							const o = odds[i];
							if (!o) return null;
							const pct = Math.round(o.chance * 100);
							const bonus = `${o.bonus >= 0 ? "+" : ""}${o.bonus}`;
							return (
								<button
									key={`${ch.stage}-${i}`}
									disabled={busy}
									className="group rounded-md border border-line bg-panel-2/60 px-2.5 py-1.5 text-left transition hover:border-gold hover:bg-panel-3 disabled:opacity-50"
									onClick={() => send({ op: "pick", stage: ch.stage, approach: i })}
									data-testid="challenge-approach"
								>
									<div className="flex items-center justify-between gap-2">
										<span className="font-semibold text-text group-hover:text-gold-2">{ap.label}</span>
										<Tooltip content={t("challenge.oddsInfo", { skill: skillName(ap.skill), bonus, dc: o.dc, pct })}>
											<span tabIndex={0} className={`shrink-0 rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${BAND_COLOR[o.band]}`}>
												{t(`challenge.odds.${o.band}`)} · {pct}%
											</span>
										</Tooltip>
									</div>
									<div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-dim">
										<span>
											{skillName(ap.skill)} {bonus}
										</span>
										<span className="flex items-center gap-0.5">
											<Hourglass size={11} /> {t("challenge.time", { n: ap.time })}
										</span>
										{ap.gain > 1 && (
											<span className="flex items-center gap-0.5 text-gold-2">
												<Zap size={11} /> {t("challenge.shortcut")}
											</span>
										)}
										{o.helper && (
											<span className="flex items-center gap-0.5 text-sky">
												<Users size={11} /> {t("challenge.helps", { name: o.helper })}
											</span>
										)}
									</div>
									<div className="mt-0.5 grid gap-px text-[11px] leading-snug">
										<span className="text-emerald/90">✔ {ap.success}</span>
										<span className="text-crimson-2/90">✖ {ap.failure}</span>
									</div>
								</button>
							);
						})}
					</div>
					<div className="flex items-start justify-between gap-2 border-t border-line pt-2 text-[11px] text-faint">
						<div className="min-w-0">
							<div>{t("challenge.stakesWin", { text: ch.stakes.success })}</div>
							<div>{t("challenge.stakesFail", { text: ch.stakes.failure })}</div>
						</div>
						{confirm ? (
							<div className="flex shrink-0 flex-col items-end gap-1">
								<span className="max-w-[12rem] text-right text-crimson-2">{t("challenge.giveUpConfirm")}</span>
								<div className="flex gap-1">
									<button className="btn px-2 py-0.5 text-xs" onClick={() => setConfirm(false)}>
										{t("challenge.cancel")}
									</button>
									<button
										className="btn px-2 py-0.5 text-xs text-crimson-2"
										disabled={busy}
										onClick={() => {
											setConfirm(false);
											send({ op: "abandon" });
										}}
									>
										{t("challenge.giveUpYes")}
									</button>
								</div>
							</div>
						) : (
							<button className="shrink-0 underline hover:text-text" disabled={busy} onClick={() => setConfirm(true)}>
								{t("challenge.giveUp")}
							</button>
						)}
					</div>
				</>
			) : (
				<div className="space-y-1.5 border-t border-line pt-2" data-testid="challenge-result">
					<div className={`font-display text-lg ${ch.status === "success" ? "text-gold-2" : ch.status === "partial" ? "text-[#e8b25a]" : "text-crimson-2"}`} style={{ animation: "chPop .45s ease-out" }}>
						{t(`challenge.outcome.${ch.status as "success" | "partial" | "failure"}`)}
					</div>
					<div className="font-fell text-sm text-parchment">{ch.status === "success" ? ch.stakes.success : ch.status === "partial" ? ch.stakes.partial : ch.stakes.failure}</div>
				</div>
			)}

			{ch.log.some((e) => e.kind === "attempt") && (
				<details className="text-[11px]" open={!active}>
					<summary className="cursor-pointer text-faint">{t("challenge.log")}</summary>
					<ol className="mt-1 space-y-0.5">
						{ch.log
							.filter((e) => e.kind === "attempt")
							.map((e, i) => (
								<li key={i} className="flex flex-wrap items-center gap-x-1.5 text-dim">
									{e.success ? <Check size={11} className="text-emerald" /> : <X size={11} className="text-crimson-2" />}
									<span className="text-text">{e.label}</span>
									<span>
										· {skillName(e.skill)} {e.total} / {e.dc}
									</span>
									{e.helper && <span className="text-sky">· {e.helper}</span>}
									{!e.success && <PaidText p={e.paid} />}
								</li>
							))}
					</ol>
				</details>
			)}

			{!active && (
				<div className="flex items-center justify-end gap-2">
					{busy && <span className="text-[11px] italic text-faint">{t("challenge.narrating")}</span>}
					<button className="btn px-3 py-1 text-xs" disabled={busy} onClick={() => send({ op: "dismiss" })} data-testid="challenge-close">
						{t("challenge.close")}
					</button>
				</div>
			)}
		</div>
	);
}

function PaidText({ p }: { p?: ChallengeLogEntry["paid"] }) {
	const { t } = useT();
	if (!p) return null;
	const parts = [
		p.clock ? t("challenge.paid.clock", { n: p.clock }) : "",
		p.hp ? t("challenge.paid.hp", { n: p.hp }) : "",
		p.heat ? t("challenge.paid.heat", { n: p.heat }) : "",
		p.noise ? t("challenge.paid.noise", { n: p.noise }) : "",
		p.item ? t("challenge.paid.item", { item: p.item }) : "",
		p.alarm ? t("challenge.paid.alarm", { text: p.alarm }) : "",
	].filter(Boolean);
	return parts.length ? <span className="text-crimson-2/90"> · {parts.join(" · ")}</span> : null;
}
