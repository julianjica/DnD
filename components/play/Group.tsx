"use client";

/**
 * The Quiet: the player's group and the base (docs/zombie.md §7). Read-only:
 * the engine owns state.group.
 *
 * A survivor's infection `turnsAt` is the DM's secret: nothing here reads it,
 * and no time since the bite is shown (that would let the player count it down).
 */
import { useEffect, useMemo, useRef } from "react";
import {
	BellRing, CloudRain, Crosshair, Droplet, Fuel, Hammer, Hospital, House, MapPin, Pill, Radio, ScrollText, Shield, Sprout, TowerControl, Users, Utensils, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import type { BaseState, BaseUpgrade, GameState, Survivor } from "@/lib/game/types";
import type { MessageKey } from "@/lib/i18n";
import { getEquipment } from "@/lib/srd";
import Portrait from "@/components/art/Portrait";
import { creatureCanvas } from "@/components/art/sprite/pixelScene";
import { gearFor, personLook, type PersonLook } from "@/components/art/sprite/person";
import { useT } from "@/components/i18n/I18nProvider";
import { useEngineText } from "@/components/i18n/useEngineText";
import { Tooltip } from "@/components/ui/Tooltip";
import { InfectionChip } from "./Survival";

// ─── pure helpers ───────────────────────────────────────────────────────────

type T = ReturnType<typeof useT>["t"];

const GONE = new Set<Survivor["status"]>(["dead", "left", "turned"]);
/** Order of the living on the tab: beside you first, then out on a task, then home. */
const STATUS_ORDER: Record<Survivor["status"], number> = { with_party: 0, away: 1, at_base: 2, dead: 3, turned: 4, left: 5 };

export function livingSurvivors(state: GameState): Survivor[] {
	return Object.values(state.group?.survivors ?? {})
		.filter((s) => !GONE.has(s.status))
		.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.joinedAt - b.joinedAt);
}

export type MoraleWord = "devoted" | "steady" | "shaken" | "breaking";

export function moraleWord(m: number): MoraleWord {
	return m >= 8 ? "devoted" : m >= 5 ? "steady" : m >= 3 ? "shaken" : "breaking";
}

const MORALE_COLOR: Record<MoraleWord, string> = { devoted: "#5fb07a", steady: "#c9b26a", shaken: "#d99a2b", breaking: "#e0574b" };

/** Morale as player-facing text for the map hover label ("Morale 6/10 · Steady"). */
export function moraleNote(s: Survivor, t: T): string {
	const m = clamp10(s.morale);
	return t("group.mapNote", { m, word: t(`group.morale.${moraleWord(m)}` as MessageKey) });
}

function clamp10(n: number): number {
	return Math.max(0, Math.min(10, Math.round(n)));
}

/** "14:00" today, otherwise "Day 4 · 18:00" (game day, like the header clock). */
function when(m: number, state: GameState, t: T): string {
	const day = Math.floor(m / 1440);
	const min = m - day * 1440;
	const time = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
	return day === state.time.day ? time : t("play.clock", { day, time });
}

/** The person-look of a survivor's pixel sprite: dressed by profession (modern). */
function survivorLook(state: GameState, s: Survivor): PersonLook | null {
	const n = state.npcs[s.npcId];
	if (!n) return null;
	const who = { ruleset: "zombie" as const, classes: [s.profession], text: `${n.role ?? ""} ${n.description ?? ""}` };
	return personLook(n.portrait, n.speciesId, gearFor(who), who);
}

// ─── pieces ─────────────────────────────────────────────────────────────────

/** The survivor's 16×16 map sprite, scaled up crisp. */
function Sprite({ look, dead = false, size = 40 }: { look: PersonLook; dead?: boolean; size?: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const c = ref.current;
		if (!c) return;
		const ctx = c.getContext("2d")!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, c.width, c.height);
		ctx.drawImage(creatureCanvas({ kind: "npc", sprite: "npc" }, look, dead, true), 0, 0, c.width, c.height);
	}, [look, dead]);
	return <canvas ref={ref} width={64} height={64} aria-hidden style={{ width: size, height: size, imageRendering: "pixelated" }} />;
}

/** Ten small segments (morale, fortification). */
function Segments({ value, color, label }: { value: number; color: (i: number) => string; label: string }) {
	return (
		<div className="flex flex-1 items-center gap-px" role="meter" aria-valuemin={0} aria-valuemax={10} aria-valuenow={value} aria-label={label}>
			{Array.from({ length: 10 }, (_, j) => {
				const on = j < value;
				return <span key={j} className="h-2 flex-1 rounded-[1px] border" style={{ background: on ? color(j + 1) : "transparent", borderColor: on ? color(j + 1) : "var(--line)", opacity: on ? 1 : 0.6 }} />;
			})}
		</div>
	);
}

function HpBar({ hp, max }: { hp: number; max: number }) {
	const pct = max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 0;
	return (
		<div className="h-2 flex-1 overflow-hidden rounded-full border border-line bg-bg">
			<div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#8e2a22,var(--hp))" }} />
		</div>
	);
}

const STATUS_STYLE: Record<Survivor["status"], string> = {
	with_party: "border-emerald/60 bg-emerald/10 text-[#7cc796]",
	at_base: "border-gold/50 bg-gold/10 text-gold-2",
	away: "border-sky/50 bg-sky/10 text-sky",
	dead: "border-line text-faint",
	left: "border-line text-faint",
	turned: "border-crimson/50 text-crimson-2",
};

function StatusChip({ s, state }: { s: Survivor; state: GameState }) {
	const { t } = useT();
	const cls = `inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[s.status]}`;
	if (s.status === "away" && s.away) {
		const w = when(s.away.until, state, t);
		return (
			<Tooltip content={t("group.awayTitle", { task: s.away.task, when: w })}>
				<span tabIndex={0} className={cls}>{t("group.awayUntil", { when: w })}</span>
			</Tooltip>
		);
	}
	return <span className={cls}>{t(`group.status.${s.status}` as MessageKey)}</span>;
}

function SurvivorCard({ s, state }: { s: Survivor; state: GameState }) {
	const { t, te, ts } = useT();
	const n = state.npcs[s.npcId];
	const look = useMemo(() => survivorLook(state, s), [state, s]);
	const morale = clamp10(s.morale);
	const word = moraleWord(morale);
	const inf = s.infection && s.infection.stage !== "turned" ? { part: s.infection.part, stage: s.infection.stage } : undefined;
	return (
		<article className="rounded-lg border border-line bg-bg-2/60 p-2.5" data-testid="survivor-card">
			<div className="flex gap-3">
				<div className="relative shrink-0 self-start">
					{n ? <Portrait spec={n.portrait} size={58} speciesId={n.speciesId} framed={false} className="rounded-md" /> : <div className="h-[70px] w-[58px] rounded-md bg-bg" />}
					{look && (
						<span className="absolute -bottom-2 -right-3 rounded-md border border-line bg-[#14110e]/95 p-0.5 shadow-md">
							<Sprite look={look} size={30} />
						</span>
					)}
				</div>
				<div className="min-w-0 flex-1 pl-1">
					<div className="font-display text-sm leading-tight text-gold-2">{n?.name ?? s.npcId}</div>
					<div className="mt-0.5 text-[11px] leading-snug text-dim">{te("class", s.profession)} · {t("group.level", { n: s.level })}</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-1">
						<StatusChip s={s} state={state} />
						{inf && <InfectionChip inf={inf} compact other />}
						{s.missedDays > 0 && (
							<Tooltip content={t("group.missedDaysTitle", { n: s.missedDays })}>
								<span tabIndex={0} className="inline-flex items-center gap-1 rounded border border-[#d99a2b]/60 px-1.5 py-0.5 text-[11px] text-[#e7b25a]">
									<Utensils size={11} /> {t("group.missedDays", { n: s.missedDays })}
								</span>
							</Tooltip>
						)}
					</div>
				</div>
			</div>
			<div className="mt-3 space-y-1">
				<div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-faint">
					<span className="w-14 shrink-0">{t("group.hp")}</span>
					<HpBar hp={s.hp} max={s.maxHp} />
					<span className="w-14 shrink-0 text-right tabular-nums normal-case tracking-normal text-dim">{s.hp}/{s.maxHp}</span>
				</div>
				<Tooltip content={t("group.moraleTitle", { n: morale })} className="flex w-full">
					<div className="flex w-full items-center gap-2 text-[10px] uppercase tracking-wider text-faint" tabIndex={0}>
						<span className="w-14 shrink-0">{t("group.morale")}</span>
						<Segments value={morale} color={() => MORALE_COLOR[word]} label={t("group.morale")} />
						<span className="w-14 shrink-0 truncate text-right text-[11px] normal-case tracking-normal" style={{ color: MORALE_COLOR[word] }}>{t(`group.morale.${word}` as MessageKey)}</span>
					</div>
				</Tooltip>
			</div>
			{s.specialty && (
				<p className="mt-2 text-xs text-text/85">
					<span className="text-[10px] uppercase tracking-wider text-faint">{t("group.specialty")} · </span>
					{s.specialty}
				</p>
			)}
			{s.traits.length > 0 && (
				<div className="mt-1.5 flex flex-wrap gap-1">
					{s.traits.map((tr) => (
						<span key={tr} className="rounded-sm border border-line bg-bg/60 px-1.5 py-px text-[10px] text-dim">{tr}</span>
					))}
				</div>
			)}
			<p className="mt-1.5 text-[11px] leading-snug text-dim">
				<span className="text-[10px] uppercase tracking-wider text-faint">{t("group.gear")} · </span>
				{s.gear.length ? s.gear.map((g) => `${ts(getEquipment(g.ref)?.name ?? g.ref)}${g.qty > 1 ? ` ×${g.qty}` : ""}`).join(", ") : <span className="italic">{t("group.noGear")}</span>}
			</p>
		</article>
	);
}

/** Dead, gone, turned: one quiet line each. */
function MemoryRow({ s, state }: { s: Survivor; state: GameState }) {
	const { te } = useT();
	const n = state.npcs[s.npcId];
	const look = useMemo(() => survivorLook(state, s), [state, s]);
	return (
		<div className="flex items-center gap-2 py-1">
			{n && <Portrait spec={n.portrait} size={30} speciesId={n.speciesId} framed={false} className="shrink-0 rounded opacity-60 grayscale" />}
			{look && <span className="shrink-0 opacity-70"><Sprite look={look} dead={s.status !== "left"} size={24} /></span>}
			<div className="min-w-0 flex-1">
				<div className="truncate text-xs text-dim">{n?.name ?? s.npcId}</div>
				<div className="truncate text-[10px] text-faint">{te("class", s.profession)}</div>
			</div>
			<StatusChip s={s} state={state} />
		</div>
	);
}

// ─── the base ───────────────────────────────────────────────────────────────

const STOCK: { kind: keyof BaseState["stock"]; icon: LucideIcon }[] = [
	{ kind: "food", icon: Utensils },
	{ kind: "water", icon: Droplet },
	{ kind: "meds", icon: Pill },
	{ kind: "ammo", icon: Crosshair },
	{ kind: "fuel", icon: Fuel },
	{ kind: "materials", icon: Hammer },
];

const UPGRADE_ICON: Record<BaseUpgrade, LucideIcon> = {
	rain_catcher: CloudRain,
	garden: Sprout,
	workshop: Wrench,
	infirmary: Hospital,
	radio: Radio,
	watchtower: TowerControl,
	generator: Zap,
	alarm_cans: BellRing,
};

function fortColor(i: number): string {
	return i <= 2 ? "#a0503f" : i <= 5 ? "#b08a4a" : i <= 8 ? "#8fa86a" : "#5fb07a";
}

function fortWord(f: number): MessageKey {
	return f <= 1 ? "group.fort.open" : f <= 4 ? "group.fort.weak" : f <= 7 ? "group.fort.solid" : "group.fort.fortress";
}

function BaseSection({ base, state, mouths }: { base: BaseState; state: GameState; mouths: number }) {
	const { t } = useT();
	const { le } = useEngineText();
	const place = state.world.locations.find((l) => l.id === base.locationId)?.name;
	const fort = clamp10(base.fortification);
	const log = [...base.log].sort((a, b) => b.at - a.at).slice(0, 8);
	const building = [...(base.building ?? [])].sort((a, b) => a.readyAt - b.readyAt);
	const foodDays = Math.floor(base.stock.food / Math.max(1, mouths));
	const waterDays = Math.floor(base.stock.water / Math.max(1, mouths));
	return (
		<section className="space-y-3 rounded-lg border border-line bg-bg-2/60 p-2.5" data-testid="base-section">
			<div className="flex items-start gap-2">
				<House size={18} className="mt-0.5 shrink-0 text-gold" />
				<div className="min-w-0">
					<div className="truncate font-display text-sm leading-tight text-gold-2">{base.name}</div>
					{place && place !== base.name && <div className="flex items-center gap-1 truncate text-[11px] text-dim"><MapPin size={11} /> {place}</div>}
				</div>
			</div>

			<Tooltip content={t("group.fortificationTitle", { n: fort })} className="block w-full">
				<div className="w-full" tabIndex={0}>
					<div className="mb-1 flex items-center justify-between text-xs text-dim">
						<span className="flex items-center gap-1"><Shield size={13} /> {t("group.fortification")}</span>
						<span className="tabular-nums"><span style={{ color: fortColor(fort) }}>{fort}/10</span> <span className="text-faint">· {t(fortWord(fort))}</span></span>
					</div>
					<Segments value={fort} color={fortColor} label={t("group.fortification")} />
				</div>
			</Tooltip>

			<div>
				<h5 className="mb-1 text-[10px] uppercase tracking-widest text-faint">{t("group.stock")}</h5>
				<div className="grid grid-cols-3 gap-1">
					{STOCK.map(({ kind, icon: Icon }) => {
						const v = Math.max(0, base.stock[kind]);
						const low = (kind === "food" || kind === "water") && v < mouths;
						return (
							<Tooltip key={kind} content={`${v} ${t(`group.stockUnit.${kind}` as MessageKey)}`} className="block">
								<div tabIndex={0} className={`w-full rounded-md border px-2 py-1 ${low ? "border-crimson/50 bg-crimson/5" : "border-line bg-bg/30"}`}>
									<div className="flex items-center justify-between">
										<Icon size={13} className={low ? "text-crimson-2" : "text-gold"} />
										<span className="text-base font-semibold leading-tight tabular-nums text-text">{v}</span>
									</div>
									<div className={`truncate text-[10px] ${low ? "text-crimson-2" : "text-dim"}`}>{t(`group.stock.${kind}` as MessageKey)}</div>
								</div>
							</Tooltip>
						);
					})}
				</div>
				<Tooltip content={t("group.foodDaysTitle", { n: mouths })} className="mt-1 block">
					<p tabIndex={0} className={`text-[11px] ${Math.min(foodDays, waterDays) < 2 ? "text-[#e7b25a]" : "text-dim"}`}>
						{t("group.lasts", { n: mouths, food: foodDays, water: waterDays })}
					</p>
				</Tooltip>
			</div>

			<div>
				<h5 className="mb-1 text-[10px] uppercase tracking-widest text-faint">{t("group.upgrades")}</h5>
				{base.upgrades.length === 0 ? (
					<p className="text-xs italic text-faint">{t("group.noUpgrades")}</p>
				) : (
					<ul className="space-y-1">
						{base.upgrades.map((u) => {
							const Icon = UPGRADE_ICON[u] ?? Wrench;
							return (
								<li key={u} className="flex items-start gap-2 text-xs">
									<Icon size={14} className="mt-px shrink-0 text-emerald" />
									<span className="min-w-0"><span className="text-text">{t(`group.upgrade.${u}` as MessageKey)}</span> <span className="text-dim">— {t(`group.upgradeInfo.${u}` as MessageKey)}</span></span>
								</li>
							);
						})}
					</ul>
				)}
				{building.length > 0 && (
					<>
						<h5 className="mb-1 mt-2 text-[10px] uppercase tracking-widest text-faint">{t("group.building")}</h5>
						<ul className="space-y-1">
							{building.map((b) => {
								const Icon = UPGRADE_ICON[b.upgrade] ?? Wrench;
								return (
									<li key={b.upgrade} className="flex items-start gap-2 rounded-md border border-dashed border-line px-1.5 py-1 text-xs">
										<Icon size={14} className="mt-px shrink-0 text-faint" />
										<span className="min-w-0 flex-1">
											<span className="text-text">{t(`group.upgrade.${b.upgrade}` as MessageKey)}</span>
											<span className="block text-[11px] text-dim">{t(`group.upgradeInfo.${b.upgrade}` as MessageKey)}</span>
										</span>
										<span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-gold"><Hammer size={11} /> {t("group.readyAt", { when: when(b.readyAt, state, t) })}</span>
									</li>
								);
							})}
						</ul>
					</>
				)}
			</div>

			<div>
				<h5 className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-widest text-faint"><ScrollText size={11} /> {t("group.log")}</h5>
				{log.length === 0 ? (
					<p className="text-xs italic text-faint">{t("group.noLog")}</p>
				) : (
					<ol className="space-y-1 border-l border-line pl-2">
						{log.map((e, i) => (
							<li key={`${e.at}-${i}`} className="text-xs leading-snug">
								<span className="mr-1 whitespace-nowrap text-[10px] tabular-nums text-faint">{when(e.at, state, t)}</span>
								<span className={i === 0 ? "text-text" : "text-dim"}>{le(e.text)}</span>
							</li>
						))}
					</ol>
				)}
			</div>
		</section>
	);
}

// ─── sidebar tab ────────────────────────────────────────────────────────────

/** Sidebar "Group" tab (zombie campaigns only): survivors, then the base. */
export function GroupTab({ state }: { state: GameState }) {
	const { t } = useT();
	const living = livingSurvivors(state);
	const gone = Object.values(state.group?.survivors ?? {}).filter((s) => GONE.has(s.status));
	const base = state.group?.base;
	return (
		<div className="space-y-4" data-testid="group-tab">
			<section className="space-y-2">
				<div className="flex items-center justify-between">
					<h4 className="heading flex items-center gap-1.5 text-sm"><Users size={14} /> {t("group.title")}</h4>
					{living.length > 0 && <span className="text-xs text-dim">{living.length}</span>}
				</div>
				{living.length === 0 ? (
					<div className="rounded-lg border border-dashed border-line px-3 py-5 text-center">
						<p className="font-display text-sm text-dim">{t("group.alone")}</p>
						<p className="mt-1 text-xs text-faint">{t("group.aloneHint")}</p>
					</div>
				) : (
					living.map((s) => <SurvivorCard key={s.npcId} s={s} state={state} />)
				)}
			</section>

			{gone.length > 0 && (
				<details className="rounded-lg border border-line/70 px-2.5 py-1.5">
					<summary className="flex cursor-pointer items-center justify-between text-xs text-faint">
						<span className="uppercase tracking-widest">{t("group.memory")}</span>
						<span className="tabular-nums">{gone.length}</span>
					</summary>
					<div className="mt-1 divide-y divide-line/60">
						{gone.map((s) => <MemoryRow key={s.npcId} s={s} state={state} />)}
					</div>
				</details>
			)}

			<section className="space-y-2">
				<h4 className="heading flex items-center gap-1.5 text-sm"><House size={14} /> {t("group.base")}</h4>
				{base ? <BaseSection base={base} state={state} mouths={living.length + 1} /> : <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-faint">{t("group.noBase")}</p>}
			</section>
		</div>
	);
}

// ─── header strip ───────────────────────────────────────────────────────────

/** "👥 3" for the survival strip, with names in the tooltip (only when someone is with the group). */
export function GroupCount({ state }: { state: GameState }) {
	const { t } = useT();
	const living = livingSurvivors(state);
	if (!living.length) return null;
	const tip = (
		<div className="space-y-0.5">
			<div className="font-semibold">{t("group.count", { n: living.length })}</div>
			{living.map((s) => (
				<div key={s.npcId} className="flex justify-between gap-3">
					<span>{state.npcs[s.npcId]?.name ?? s.npcId}</span>
					<span className="text-dim">{s.status === "away" && s.away ? t("group.awayUntil", { when: when(s.away.until, state, t) }) : t(`group.status.${s.status}` as MessageKey)}</span>
				</div>
			))}
		</div>
	);
	return (
		<Tooltip content={tip} side="bottom">
			<span tabIndex={0} className="inline-flex items-center gap-1 tabular-nums" data-testid="group-count" aria-label={t("group.countTitle", { names: living.map((s) => state.npcs[s.npcId]?.name ?? s.npcId).join(", ") })}>
				<Users size={13} /> {living.length}
			</span>
		</Tooltip>
	);
}

