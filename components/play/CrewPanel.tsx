"use client";

/**
 * Root Access: the crew (docs/cyberpunk.md §7). Read-only: the engine owns
 * state.cyber.crew (lib/rules/crew.ts). Betrayal odds are the DM's secret:
 * nothing here shows them, only loyalty and where each hat sits.
 */
import { Car, HeartPulse, MessageSquare, Shield, Terminal, Users, Wrench, type LucideIcon } from "lucide-react";
import type { CrewMember, CrewRole, GameState } from "@/lib/game/types";
import type { MessageKey } from "@/lib/i18n";
import { HAT_MAX, HAT_MIN } from "@/lib/rules/cyber";
import { getEquipment } from "@/lib/srd";
import Portrait from "@/components/art/Portrait";
import { useT } from "@/components/i18n/I18nProvider";
import { Tooltip } from "@/components/ui/Tooltip";

const CAP = 4;
const ACTIVE = new Set<CrewMember["status"]>(["with_pc", "at_den", "away"]);
const ORDER: Record<CrewMember["status"], number> = { with_pc: 0, away: 1, at_den: 2, betrayed: 3, left: 4, dead: 5 };

const ROLE_ICON: Record<CrewRole, LucideIcon> = { driver: Car, face: MessageSquare, muscle: Shield, medic: HeartPulse, runner: Terminal, tech: Wrench };

const STATUS_STYLE: Record<CrewMember["status"], string> = {
	with_pc: "border-emerald/60 bg-emerald/10 text-[#7cc796]",
	at_den: "border-gold/50 bg-gold/10 text-gold-2",
	away: "border-sky/50 bg-sky/10 text-sky",
	left: "border-line text-faint",
	betrayed: "border-crimson/50 text-crimson-2",
	dead: "border-line text-faint",
};

export function crewList(state: GameState): CrewMember[] {
	return Object.values(state.cyber?.crew ?? {}).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.joinedAt - b.joinedAt);
}

export const activeCrewCount = (state: GameState) => crewList(state).filter((m) => ACTIVE.has(m.status)).length;

type LoyaltyWord = "solid" | "steady" | "doubtful" | "wavering";
const loyaltyWord = (n: number): LoyaltyWord => (n >= 8 ? "solid" : n >= 5 ? "steady" : n >= 3 ? "doubtful" : "wavering");
const LOYALTY_COLOR: Record<LoyaltyWord, string> = { solid: "#3fb8a8", steady: "#c9b26a", doubtful: "#d99a2b", wavering: "#e0574b" };

const hatPct = (n: number) => ((Math.max(HAT_MIN, Math.min(HAT_MAX, n)) - HAT_MIN) / (HAT_MAX - HAT_MIN)) * 100;
const hatText = (n: number) => (n > 0 ? `+${n}` : String(n));

function HpBar({ hp, max }: { hp: number; max: number }) {
	const pct = max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
	return (
		<div className="h-2 flex-1 overflow-hidden rounded-full border border-line bg-bg">
			<div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#8e2a22,var(--hp))" }} />
		</div>
	);
}

function Loyalty({ value }: { value: number }) {
	const { t } = useT();
	const v = Math.max(0, Math.min(10, Math.round(value)));
	const word = loyaltyWord(v);
	const color = LOYALTY_COLOR[word];
	return (
		<Tooltip content={t("play.crew.loyaltyHelp")} className="flex w-full">
			<div className="flex w-full items-center gap-2 text-[10px] uppercase tracking-wider text-faint" tabIndex={0}>
				<span className="w-14 shrink-0">{t("play.crew.loyalty")}</span>
				<div className="flex flex-1 items-center gap-px" role="meter" aria-valuemin={0} aria-valuemax={10} aria-valuenow={v} aria-label={t("play.crew.loyalty")}>
					{Array.from({ length: 10 }, (_, j) => {
						const on = j < v;
						return <span key={j} className="h-2 flex-1 rounded-[1px] border" style={{ background: on ? color : "transparent", borderColor: on ? color : "var(--line)", opacity: on ? 1 : 0.6 }} />;
					})}
				</div>
				<span className="w-14 shrink-0 truncate text-right text-[11px] normal-case tracking-normal" style={{ color }}>{t(`play.crew.word.${word}` as MessageKey)}</span>
			</div>
		</Tooltip>
	);
}

/** Their hat and the PC's on the black↔white scale. */
function HatPair({ theirs, yours }: { theirs: number; yours: number }) {
	const { t } = useT();
	return (
		<Tooltip content={t("play.crew.hatHelp", { theirs: hatText(theirs), yours: hatText(yours) })} className="flex w-full">
			<div className="flex w-full items-center gap-2 text-[10px] uppercase tracking-wider text-faint" tabIndex={0}>
				<span className="w-14 shrink-0">{t("play.crew.hat")}</span>
				<div className="relative h-2 flex-1 rounded-full border border-line" style={{ background: "linear-gradient(90deg,#0b0b0d 0%,#3a3d42 35%,#7d8187 50%,#b9bcc0 65%,#f2f2ee 100%)" }}>
					<span className="absolute top-1/2 h-1 -translate-y-1/2 bg-crimson/60" style={{ left: `${Math.min(hatPct(theirs), hatPct(yours))}%`, width: `${Math.abs(hatPct(theirs) - hatPct(yours))}%` }} />
					<span aria-label={t("play.crew.hatTheirs")} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-sky shadow" style={{ left: `${hatPct(theirs)}%` }} />
					<span aria-label={t("play.crew.hatYours")} className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-bg bg-gold shadow" style={{ left: `${hatPct(yours)}%` }} />
				</div>
				<span className="w-14 shrink-0 text-right text-[11px] normal-case tracking-normal tabular-nums text-dim">
					<span className="text-sky">{hatText(theirs)}</span> / <span className="text-gold-2">{hatText(yours)}</span>
				</span>
			</div>
		</Tooltip>
	);
}

function CrewCard({ m, state }: { m: CrewMember; state: GameState }) {
	const { t, te, ts } = useT();
	const n = state.npcs[m.npcId];
	const RoleIcon = ROLE_ICON[m.role] ?? Users;
	const gone = !ACTIVE.has(m.status);
	return (
		<article className={`rounded-lg border border-line bg-bg-2/60 p-2.5 ${gone ? "opacity-60" : ""}`} data-testid="crew-card">
			<div className="flex gap-3">
				<div className="shrink-0 self-start">
					{n ? (
						<Portrait spec={n.portrait} size={58} speciesId={n.speciesId} framed={false} className="rounded-md" modern={{ text: `${n.role ?? ""} ${n.description ?? ""}`, classes: [m.classId], city: "marea" }} />
					) : (
						<div className="h-[70px] w-[58px] rounded-md bg-bg" />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="font-display text-sm leading-tight text-gold-2">{n?.name ?? m.npcId}</div>
					<div className="mt-0.5 flex items-center gap-1 text-[11px] leading-snug text-dim">
						<RoleIcon size={12} aria-hidden /> {t(`play.crew.role.${m.role}` as MessageKey)} · {te("class", m.classId)} · {t("play.crew.level", { n: m.level })}
					</div>
					<div className="mt-1.5">
						<span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[m.status]}`}>
							{t(`play.crew.status.${m.status}` as MessageKey)}
						</span>
					</div>
				</div>
			</div>
			{!gone && (
				<div className="mt-3 space-y-1.5">
					<div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-faint">
						<span className="w-14 shrink-0">{t("play.crew.hp")}</span>
						<HpBar hp={m.hp} max={m.maxHp} />
						<span className="w-14 shrink-0 text-right tabular-nums normal-case tracking-normal text-dim">{m.hp}/{m.maxHp}</span>
					</div>
					<Loyalty value={m.loyalty} />
					<HatPair theirs={m.hatPref} yours={state.cyber?.hat ?? 0} />
				</div>
			)}
			{m.specialty && (
				<p className="mt-2 text-xs text-text/85">
					<span className="text-[10px] uppercase tracking-wider text-faint">{t("play.crew.brings")} · </span>
					{m.specialty}
				</p>
			)}
			{!gone && (
				<p className="mt-1 text-[11px] leading-snug text-dim">
					<span className="text-[10px] uppercase tracking-wider text-faint">{t("play.crew.gear")} · </span>
					{m.gear.length ? m.gear.map((g) => ts(getEquipment(g)?.name ?? g)).join(", ") : <span className="italic">{t("play.crew.noGear")}</span>}
				</p>
			)}
		</article>
	);
}

/** The crew tab of the sidebar in Root Access (where The Quiet shows its group). */
export function CrewPanel({ state }: { state: GameState }) {
	const { t } = useT();
	const list = crewList(state);
	const active = list.filter((m) => ACTIVE.has(m.status));
	const gone = list.filter((m) => !ACTIVE.has(m.status));
	return (
		<section className="space-y-3" data-testid="crew-panel">
			<div className="flex items-center justify-between">
				<h3 className="flex items-center gap-1.5 font-display text-sm text-gold-2">
					<Users size={14} /> {t("play.crew.title")}
				</h3>
				<span className="text-[11px] tabular-nums text-faint">{t("play.crew.count", { n: active.length, max: CAP })}</span>
			</div>
			{!list.length && <p className="text-xs italic text-dim">{t("play.crew.empty")}</p>}
			{state.cyber?.run && active.some((m) => m.status === "with_pc") && <p className="text-[11px] text-sky">{t("play.crew.van")}</p>}
			{active.map((m) => (
				<CrewCard key={m.npcId} m={m} state={state} />
			))}
			{gone.length > 0 && (
				<div className="space-y-2 pt-1">
					<div className="text-[10px] uppercase tracking-wider text-faint">{t("play.crew.gone")}</div>
					{gone.map((m) => (
						<CrewCard key={m.npcId} m={m} state={state} />
					))}
				</div>
			)}
		</section>
	);
}
