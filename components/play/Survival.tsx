"use client";

/**
 * The Quiet: what the survivor knows about their own survival — outbreak day,
 * how loud it is here, food and water carried, hunger and thirst, how the bite
 * feels, lost limbs. Read-only: the engine owns state.survival.
 *
 * The infection's `turnsAt` is the DM's secret: nothing here reads it, and no
 * time since the bite is shown (that would let the player count it down).
 */
import { Biohazard, CalendarDays, Droplet, Scissors, Thermometer, Utensils, Volume2 } from "lucide-react";
import type { GameState, InventoryItem, SurvivalState } from "@/lib/game/types";
import { outbreakDay } from "@/lib/rules/ruleset";
import { useT } from "@/components/i18n/I18nProvider";
import { useEngineText } from "@/components/i18n/useEngineText";
import { Tooltip } from "@/components/ui/Tooltip";

// ─── pure helpers ───────────────────────────────────────────────────────────

const WATER = /water|canteen|soda|juice|drink/i;
const FOOD = /canned|jerky|preserves|\bmre\b|ration|food|snack|beans?\b|rice\b|peaches|soup/i;

/** "food" | "water" | null for an inventory item (water first: "bottled water" is never food). */
export function supplyKind(i: Pick<InventoryItem, "ref" | "name">): "food" | "water" | null {
	const key = `${i.ref ?? ""} ${i.name}`;
	if (WATER.test(key)) return "water";
	if (FOOD.test(key)) return "food";
	return null;
}

/** Days of food and water carried: one unit is one day's need. */
export function suppliesCarried(inv: InventoryItem[]): { food: number; water: number } {
	const out = { food: 0, water: 0 };
	for (const i of inv) {
		const k = supplyKind(i);
		if (k) out[k] += Math.max(0, i.quantity);
	}
	return out;
}

const EMPTY_NEEDS: SurvivalState["needs"] = { lastMeal: 0, lastDrink: 0, missedMeals: 0, missedDrinks: 0 };

/** Survival with safe defaults: zombie campaigns may not have ticked yet. */
function survivalOf(state: GameState) {
	const s = state.survival;
	return {
		noise: Math.max(0, Math.min(10, Math.round(s?.noise.level ?? 0))),
		lastEvent: s?.noise.lastEvent,
		infection: s?.infection && s.infection.stage !== "turned" ? { part: s.infection.part, stage: s.infection.stage } : undefined,
		amputations: s?.amputations ?? [],
		needs: s?.needs ?? EMPTY_NEEDS,
	};
}

/** Colour of noise segment i (1..10): calm grey → amber → red. */
function segColor(i: number): string {
	if (i <= 3) return "#8a8f94";
	if (i <= 6) return "#d99a2b";
	if (i <= 9) return "#d9503f";
	return "#ff2a1a";
}

/** Colour for the current noise level as a whole. */
function levelColor(n: number): string {
	return n === 0 ? "var(--text-faint)" : segColor(n);
}

// ─── pieces ─────────────────────────────────────────────────────────────────

function NoiseTip({ level, lastEvent }: { level: number; lastEvent?: string }) {
	const { t } = useT();
	const { le } = useEngineText();
	return (
		<div className="space-y-1">
			<div className="font-semibold" style={{ color: levelColor(level) }}>{t("play.surv.noiseLevel", { n: level })}</div>
			{lastEvent ? <div>{t("play.surv.noiseLast", { e: le(lastEvent) })}</div> : level === 0 ? <div>{t("play.surv.noiseQuiet")}</div> : null}
			<div className="text-dim">{t("play.surv.noiseHelp")}</div>
		</div>
	);
}

/** Ten segments with threshold ticks after 4, 7 and 10. */
function NoiseMeter({ level, compact }: { level: number; compact?: boolean }) {
	const { t } = useT();
	const h = compact ? "h-2.5" : "h-3";
	const w = compact ? "w-1.5" : "flex-1";
	return (
		<div className={compact ? "inline-flex items-center" : "w-full"} role="meter" aria-valuemin={0} aria-valuemax={10} aria-valuenow={level} aria-label={t("play.surv.noise")}>
			<div className={`flex items-end ${compact ? "gap-px" : "gap-0.5"}`}>
				{Array.from({ length: 10 }, (_, j) => {
					const i = j + 1;
					const on = i <= level;
					return (
						<span key={i} className={`relative ${w} ${h} rounded-[1px] border`} style={{ background: on ? segColor(i) : "transparent", borderColor: on ? segColor(i) : "var(--line)", opacity: on ? 1 : 0.7 }}>
							{(i === 4 || i === 7 || i === 10) && !compact && <span className="absolute -left-[2px] -top-0.5 h-[calc(100%+0.25rem)] w-[2px] bg-text/60" />}
						</span>
					);
				})}
			</div>
			{!compact && (
				<div className="relative mt-0.5 h-3 text-[9px] uppercase tracking-wider text-faint">
					<span className="absolute -translate-x-1/2" style={{ left: "30%" }}>{t("play.surv.tick.wanderers")}</span>
					<span className="absolute -translate-x-1/2" style={{ left: "60%" }}>{t("play.surv.tick.pack")}</span>
					<span className="absolute right-0">{t("play.surv.tick.horde")}</span>
				</div>
			)}
		</div>
	);
}

/** Hunger/thirst words from consecutive missed needs. */
function needWords(needs: SurvivalState["needs"], t: ReturnType<typeof useT>["t"]): string[] {
	const out: string[] = [];
	if (needs.missedMeals > 0) out.push(needs.missedMeals >= 3 ? t("play.surv.starving") : t("play.surv.hungry"));
	if (needs.missedDrinks > 0) out.push(needs.missedDrinks >= 2 ? t("play.surv.dehydrated") : t("play.surv.thirsty"));
	return out;
}

function InfectionChip({ inf, compact }: { inf: { part: string; stage: string }; compact?: boolean }) {
	const { t, te } = useT();
	const part = te("bodyPart", inf.part);
	const label = inf.stage === "fever" ? t("play.surv.feverish") : inf.stage === "delirium" ? t("play.surv.delirious") : t("play.surv.bitten", { part });
	const Icon = inf.stage === "incubating" ? Biohazard : Thermometer;
	const tip = inf.stage === "delirium" ? t("play.surv.infectionLate") : t("play.surv.infectionTitle", { part });
	return (
		<Tooltip content={tip}>
			<span tabIndex={0} className={`${compact ? "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]" : "chip gap-1"} ${inf.stage === "incubating" ? "border-[#5a2e2a] bg-[#1a0d0c] text-[#c9a9a3]" : "border-crimson/60 bg-crimson/15 text-crimson-2"}`}>
				<Icon size={compact ? 12 : 13} className={inf.stage === "incubating" ? "text-[#7a3a33]" : ""} />
				{label}
			</span>
		</Tooltip>
	);
}

// ─── sidebar block ──────────────────────────────────────────────────────────

/** Compact "Survival" block for the character sheet (zombie campaigns only). */
export function SurvivalBlock({ state }: { state: GameState }) {
	const { t, te } = useT();
	const s = survivalOf(state);
	const sup = suppliesCarried(state.character.inventory);
	const needs = needWords(s.needs, t);
	const exh = state.character.exhaustion ?? 0;
	return (
		<section className="space-y-2.5 rounded-lg border border-line bg-bg-2/60 p-2.5" data-testid="survival-block">
			<div className="flex items-center justify-between gap-2">
				<h4 className="heading text-sm">{t("play.surv.title")}</h4>
				<span className="flex items-center gap-1 text-xs text-dim"><CalendarDays size={13} className="text-gold" /> {t("play.surv.outbreakDay", { n: outbreakDay(state) })}</span>
			</div>
			<Tooltip content={<NoiseTip level={s.noise} lastEvent={s.lastEvent} />} className="block w-full">
				<div className="w-full" tabIndex={0}>
					<div className="mb-1 flex items-center justify-between text-xs text-dim">
						<span className="flex items-center gap-1"><Volume2 size={13} /> {t("play.surv.noise")}</span>
						<span className="tabular-nums" style={{ color: levelColor(s.noise) }}>{s.noise}/10</span>
					</div>
					<NoiseMeter level={s.noise} />
				</div>
			</Tooltip>
			<Tooltip content={t("play.surv.supplyTitle", { food: sup.food, water: sup.water })} className="block w-full">
				<div className="grid w-full grid-cols-2 gap-1.5" tabIndex={0}>
					<div className={`flex items-center justify-between rounded-md border px-2 py-1 text-xs ${sup.food === 0 ? "border-crimson/50 text-crimson-2" : "border-line text-dim"}`}>
						<span className="flex items-center gap-1"><Utensils size={13} /> {t("play.surv.food")}</span>
						<span className="text-sm font-semibold tabular-nums text-text">{t("play.surv.days", { n: sup.food })}</span>
					</div>
					<div className={`flex items-center justify-between rounded-md border px-2 py-1 text-xs ${sup.water === 0 ? "border-crimson/50 text-crimson-2" : "border-line text-dim"}`}>
						<span className="flex items-center gap-1"><Droplet size={13} /> {t("play.surv.water")}</span>
						<span className="text-sm font-semibold tabular-nums text-text">{t("play.surv.days", { n: sup.water })}</span>
					</div>
				</div>
			</Tooltip>
			{(needs.length > 0 || s.infection || s.amputations.length > 0 || exh > 0) && (
				<div className="flex flex-wrap gap-1">
					{s.infection && <InfectionChip inf={s.infection} />}
					{needs.length > 0 && (
						<Tooltip content={t("play.surv.needsTitle", { m: s.needs.missedMeals, d: s.needs.missedDrinks })}>
							<span tabIndex={0} className="chip border-[#d99a2b]/60 text-[#e7b25a]">{needs.join(" · ")}</span>
						</Tooltip>
					)}
					{exh > 0 && (
						<Tooltip content={t("play.surv.exhaustionTitle")}>
							<span tabIndex={0} className="chip border-crimson/50 text-crimson-2">{t("play.surv.exhaustion", { n: exh })}</span>
						</Tooltip>
					)}
					{s.amputations.map((p) => (
						<Tooltip key={p} content={t("play.surv.amputatedTitle", { part: te("bodyPart", p) })}>
							<span tabIndex={0} className="chip gap-1 border-line text-dim"><Scissors size={11} /> {t("play.surv.amputated", { part: te("bodyPart", p) })}</span>
						</Tooltip>
					))}
				</div>
			)}
		</section>
	);
}

// ─── header strip ───────────────────────────────────────────────────────────

/** Small status strip next to the clock in the header (zombie campaigns only). */
export function SurvivalStrip({ state }: { state: GameState }) {
	const { t } = useT();
	const s = survivalOf(state);
	const sup = suppliesCarried(state.character.inventory);
	const needs = needWords(s.needs, t);
	return (
		<div className="hidden items-center gap-3 border-l border-line pl-3 text-xs text-dim md:flex" data-testid="survival-strip">
			<span className="whitespace-nowrap">{t("play.surv.outbreakShort", { n: outbreakDay(state) })}</span>
			<Tooltip content={<NoiseTip level={s.noise} lastEvent={s.lastEvent} />} side="bottom">
				<span tabIndex={0} className="inline-flex items-center gap-1">
					<Volume2 size={13} style={{ color: levelColor(s.noise) }} />
					<NoiseMeter level={s.noise} compact />
				</span>
			</Tooltip>
			<Tooltip content={needs.length ? `${needs.join(" · ")} — ${t("play.surv.needsTitle", { m: s.needs.missedMeals, d: s.needs.missedDrinks })}` : t("play.surv.supplyTitle", { food: sup.food, water: sup.water })} side="bottom">
				<span tabIndex={0} className="inline-flex items-center gap-2 tabular-nums">
					<span className={`inline-flex items-center gap-0.5 ${sup.food === 0 || s.needs.missedMeals > 0 ? "text-[#e7b25a]" : ""}`}><Utensils size={12} />{sup.food}</span>
					<span className={`inline-flex items-center gap-0.5 ${sup.water === 0 || s.needs.missedDrinks > 0 ? "text-[#e7b25a]" : ""}`}><Droplet size={12} />{sup.water}</span>
				</span>
			</Tooltip>
			{s.infection && <span className="hidden lg:inline-flex"><InfectionChip inf={s.infection} compact /></span>}
		</div>
	);
}

/** Visual weight of the infection on the scene panel: none, fever or delirium. */
export function infectionVisual(state: GameState): "fever" | "delirium" | null {
	const st = state.survival?.infection?.stage;
	return st === "fever" || st === "delirium" ? st : null;
}

/**
 * Fever and delirium on the scene panel: the world loses colour at the edges.
 * Static for fever; delirium "breathes" slowly, only when motion is welcome.
 */
export function SickVignette({ stage }: { stage: "fever" | "delirium" }) {
	const strong = stage === "delirium";
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 z-10" style={{ backdropFilter: `saturate(${strong ? 0.55 : 0.75})`, WebkitBackdropFilter: `saturate(${strong ? 0.55 : 0.75})` }} data-testid="sick-vignette">
			<style>{"@keyframes dh-sick-breathe{0%,100%{opacity:.6}50%{opacity:1}}"}</style>
			<div
				className={`absolute inset-0 ${strong ? "motion-safe:animate-[dh-sick-breathe_7s_ease-in-out_infinite]" : ""}`}
				style={{ background: `radial-gradient(ellipse at center, transparent ${strong ? 38 : 50}%, rgba(58,8,4,${strong ? 0.5 : 0.32}) 85%, rgba(20,2,0,${strong ? 0.7 : 0.5}) 100%)` }}
			/>
		</div>
	);
}
