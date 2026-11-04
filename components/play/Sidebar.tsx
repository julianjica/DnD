"use client";

import { useMemo, useState } from "react";
import { Backpack, BookOpen, BookUser, Feather, Scroll, Shield, Sparkles, Users, Heart, Swords, ArrowUpCircle, Coins } from "lucide-react";
import type { Ability, GameState, InventoryItem, PlayerCombatAction } from "@/lib/game/types";
import { canLevelUp, deriveSheet, XP_THRESHOLDS } from "@/lib/rules/character";
import { getSpell } from "@/lib/srd";
import { signed } from "@/lib/rules/dice";
import Portrait from "@/components/art/Portrait";
import { useT } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { SpellAdvChips, SpellCard } from "./SpellCard";
import { SurvivalBlock } from "./Survival";
import { GroupTab, livingSurvivors } from "./Group";
import { rulesetOf } from "@/lib/rules/ruleset";

const ABIL: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Lets the sidebar spend resources through the engine (never locally). */
export interface SheetActions {
	act: (a: PlayerCombatAction) => void;
	busy: boolean;
	/** Opens the appearance editor for the player's portrait. */
	editPortrait?: () => void;
}

const CONSUMABLE = /potion|elixir|ration|torch|oil|scroll|antitoxin|candle|holy water|acid|alchemist|healer|caltrop|ball bearing|chalk|food|wine|ale\b/i;
export function isConsumable(i: InventoryItem): boolean {
	return ["potion", "scroll", "consumable", "food"].includes(i.category) || CONSUMABLE.test(i.name);
}

function UseBtn({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled: boolean; title?: string }) {
	return (
		<button
			type="button"
			className="rounded border border-gold/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold-2 transition hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-40"
			disabled={disabled}
			title={title}
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onClick();
			}}
		>
			{label}
		</button>
	);
}

type Tab = "sheet" | "inventory" | "spells" | "quests" | "journal" | "codex" | "group";

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
	const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
	return (
		<div>
			<div className="mb-1 flex justify-between text-xs text-dim">
				<span>{label}</span>
				<span className="tabular-nums text-text">{value} / {max}</span>
			</div>
			<div className="h-2.5 overflow-hidden rounded-full border border-line bg-bg">
				<div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
			</div>
		</div>
	);
}

function Stat({ label, value, sub, title }: { label: string; value: string | number; sub?: string; title?: string }) {
	return (
		<div className="flex min-w-0 flex-col items-center rounded-lg border border-line bg-bg-2/70 px-2 py-1.5" title={title}>
			<span className="max-w-full truncate text-[10px] uppercase tracking-widest text-faint">{label}</span>
			<span className="font-display text-lg text-gold-2">{value}</span>
			{sub && <span className="text-[10px] text-dim">{sub}</span>}
		</div>
	);
}

function SheetTab({ state, onLevelUp, actions }: { state: GameState; onLevelUp: () => void; actions: SheetActions }) {
	const { t, te, ts } = useT();
	const c = state.character;
	const sheet = useMemo(() => {
		try {
			const lvlNow = c.classes.reduce((n, k) => n + k.level, 0);
			return deriveSheet(c, lvlNow < 20 ? XP_THRESHOLDS[lvlNow + 1] : undefined);
		} catch {
			return null;
		}
	}, [c]);
	const lvl = c.classes.reduce((n, k) => n + k.level, 0);
	const canLevel = state.settings.structure.leveling === "xp" ? canLevelUp(c) : (state.levelUpsGranted ?? 0) > 0;
	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<button type="button" className="shrink-0 rounded-lg transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-gold" onClick={actions.editPortrait} title={t("play.portrait.edit")} aria-label={t("play.portrait.edit")}>
					<Portrait spec={c.portrait} size={84} speciesId={c.speciesId} />
				</button>
				<div className="min-w-0">
					<div className="heading truncate text-lg">{c.name}</div>
					<div className="text-sm text-dim">
						{c.subspeciesId ? te("subspecies", c.subspeciesId) : te("species", c.speciesId)} · {c.classes.map((k) => `${te("class", k.classId)}${k.subclassId ? ` (${te("subclass", k.subclassId)})` : ""} ${k.level}`).join(" / ")}
					</div>
					<div className="text-xs text-faint">{t("play.sheet.levelXp", { n: lvl, xp: sheet?.xpToNext ? `${c.xp} / ${sheet.xpToNext}` : c.xp })}</div>
				</div>
			</div>
			{canLevel && (
				<button className="btn btn-gold w-full justify-center animate-pulse" onClick={onLevelUp}>
					<ArrowUpCircle size={16} /> {t("play.sheet.levelUp")}
				</button>
			)}
			<Bar value={c.hp} max={c.maxHp} color="linear-gradient(90deg,#8e2a22,var(--hp))" label={`${t("play.sheet.hp")}${c.tempHp ? ` ${t("play.sheet.tempHp", { n: c.tempHp })}` : ""}`} />
			{c.hp === 0 && (
				<div className="rounded-md border border-crimson/50 bg-crimson/10 p-2 text-sm">
					{t("play.sheet.dying", { s: c.deathSaves.successes, f: c.deathSaves.failures })}
				</div>
			)}
			{rulesetOf(state.settings) === "zombie" && <SurvivalBlock state={state} />}
			{sheet && (
				<div className="grid grid-cols-4 gap-1.5">
					<Stat label={t("play.stat.ac")} title={t("play.stat.acTitle")} value={sheet.ac} />
					<Stat label={t("play.stat.init")} title={t("play.stat.initTitle")} value={signed(sheet.initiative)} />
					<Stat label={t("play.stat.speed")} value={sheet.speed} sub={t("play.unit.ft")} />
					<Stat label={t("play.stat.prof")} title={t("play.stat.profTitle")} value={signed(sheet.profBonus)} />
				</div>
			)}
			<div className="grid grid-cols-6 gap-1">
				{ABIL.map((a) => (
					<div key={a} className="flex flex-col items-center rounded-md border border-line bg-bg-2/70 py-1" title={te("ability", a)}>
						<span className="text-[10px] tracking-widest text-faint">{te("abilityShort", a)}</span>
						<span className="font-display text-base text-text">{c.abilities[a]}</span>
						<span className="text-xs text-gold">{signed(Math.floor((c.abilities[a] - 10) / 2))}</span>
						{sheet && <span className="text-[10px] text-dim" title={t("play.sheet.savingThrow")}>{sheet.saves[a].proficient ? "●" : "○"} {signed(sheet.saves[a].mod)}</span>}
					</div>
				))}
			</div>
			{c.conditions.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{c.conditions.map((x) => (
						<span key={x.id} className="chip border-crimson/50 text-crimson-2">{te("condition", x.id)}</span>
					))}
					{c.exhaustion > 0 && <span className="chip border-crimson/50 text-crimson-2">{t("play.sheet.exhaustion", { n: c.exhaustion })}</span>}
				</div>
			)}
			{sheet && sheet.attacks.length > 0 && (
				<section>
					<h4 className="heading mb-1.5 flex items-center gap-1.5 text-sm"><Swords size={14} /> {t("play.sheet.attacks")}</h4>
					<div className="space-y-1">
						{sheet.attacks.map((a, i) => (
							<div key={i} className="flex items-center justify-between rounded-md bg-bg-2/60 px-2 py-1 text-sm">
								<span>{ts(a.name)}</span>
								<span className="tabular-nums text-dim">{signed(a.toHit)} · {a.damage}</span>
							</div>
						))}
					</div>
				</section>
			)}
			{sheet && (
				<section>
					<h4 className="heading mb-1.5 text-sm">{t("play.sheet.skills")}</h4>
					<div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
						{Object.entries(sheet.skills).map(([k, s]) => (
							<div key={k} className="flex min-w-0 justify-between gap-1">
								<span className={`truncate ${s.proficient ? "text-text" : "text-dim"}`} title={te("skill", k)}>
									{s.expertise ? "◆" : s.proficient ? "●" : "○"} {te("skill", k)}
								</span>
								<span className="tabular-nums text-dim">{signed(s.mod)}</span>
							</div>
						))}
					</div>
					<div className="mt-2 text-xs text-faint">{t("play.sheet.passives", { p: sheet.passivePerception, i: sheet.passiveInsight, v: sheet.passiveInvestigation })}</div>
				</section>
			)}
			{c.features.length > 0 && (
				<section>
					<h4 className="heading mb-1.5 text-sm">{t("play.sheet.features")}</h4>
					<div className="space-y-1">
						{c.features.map((f) => (
							<details key={f.id} className="rounded-md bg-bg-2/60 px-2 py-1 text-sm">
								<summary className="flex cursor-pointer justify-between">
									<span>{ts(f.name)}</span>
									{f.uses && (
										<span className="flex items-center gap-2">
											<span className="text-xs text-gold">{f.uses.max - f.uses.used}/{f.uses.max}</span>
											<UseBtn label={t("play.use")} onClick={() => actions.act({ type: "use_feature", featureId: f.id })} disabled={actions.busy || f.uses.used >= f.uses.max} title={t("play.sheet.recharges", { when: te("recharge", f.uses.recharge) })} />
										</span>
									)}
								</summary>
								<p className="mt-1 whitespace-pre-line text-xs text-dim">{ts(f.description)}</p>
							</details>
						))}
					</div>
				</section>
			)}
		</div>
	);
}

function InventoryTab({ state, actions }: { state: GameState; actions: SheetActions }) {
	const { t, te, ts } = useT();
	const c = state.character;
	const cur = c.currency;
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-1.5 text-sm">
				<Coins size={16} className="text-gold" />
				{(["pp", "gp", "ep", "sp", "cp"] as const).map((k) => (cur[k] ? <span key={k} className="chip">{cur[k]} {te("currency", k)}</span> : null))}
			</div>
			<div className="space-y-1">
				{c.inventory.length === 0 && <p className="text-sm text-dim">{t("play.inv.empty")}</p>}
				{c.inventory.map((i) => (
					<details key={i.id} className="rounded-md bg-bg-2/60 px-2 py-1.5 text-sm">
						<summary className="flex cursor-pointer items-center justify-between gap-2">
							<span className="truncate">
								{i.equipped && <Shield size={12} className="mr-1 inline text-gold" />}
								{ts(i.name)}
								{i.quantity > 1 && <span className="text-dim"> ×{i.quantity}</span>}
							</span>
							<span className="flex shrink-0 items-center gap-2">
								<span className="text-xs text-faint">{i.weapon ? `${i.weapon.damage} ${te("damage", i.weapon.damageType).toLowerCase()}` : i.armor ? t("play.inv.ac", { n: i.armor.baseAc }) : te("category", i.category)}</span>
								{isConsumable(i) && <UseBtn label={t("play.use")} onClick={() => actions.act({ type: "use_item", itemId: i.id })} disabled={actions.busy} />}
							</span>
						</summary>
						{(i.description || i.weapon?.properties.length) && (
							<p className="mt-1 whitespace-pre-line text-xs text-dim">
								{i.weapon?.properties.length ? `${i.weapon.properties.map((p) => ts(p.replace(/(^|-|\s)\w/g, (m) => m.toUpperCase()))).join(", ")}\n` : ""}
								{ts(i.description)}
							</p>
						)}
					</details>
				))}
			</div>
		</div>
	);
}

function CastButton({ state, spell, actions }: { state: GameState; spell: { index: string; level: number }; actions: SheetActions }) {
	const { t } = useT();
	const sc = state.character.spellcasting!;
	const levels: number[] = [];
	if (spell.level > 0)
		for (let l = spell.level; l <= 9; l++) {
			const left = (sc.slots[l - 1] ?? 0) - (sc.slotsUsed[l - 1] ?? 0) + (sc.pact && sc.pact.level === l ? sc.pact.max - sc.pact.used : 0);
			if (left > 0) levels.push(l);
		}
	const [lvl, setLvl] = useState<number>(levels[0] ?? spell.level);
	if (state.encounter?.status === "active") return <span className="text-[10px] text-faint" title={t("play.spells.actionBarTitle")}>{t("play.spells.actionBar")}</span>;
	const none = spell.level > 0 && levels.length === 0;
	const slot = levels.includes(lvl) ? lvl : levels[0];
	return (
		<span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
			{levels.length > 1 && (
				<select className="rounded border border-line bg-bg px-0.5 text-[10px]" value={slot} onChange={(e) => setLvl(+e.target.value)}>
					{levels.map((l) => (
						<option key={l} value={l}>{t("play.spells.slot", { n: l })}</option>
					))}
				</select>
			)}
			<UseBtn label={t("play.cast")} onClick={() => actions.act({ type: "cast", spell: spell.index, slotLevel: spell.level === 0 ? 0 : slot })} disabled={actions.busy || none} title={none ? t("play.spells.noSlots") : undefined} />
		</span>
	);
}

function SpellsTab({ state, actions }: { state: GameState; actions: SheetActions }) {
	const { t, ts } = useT();
	const sc = state.character.spellcasting;
	if (!sc) return <p className="text-sm text-dim">{t("play.spells.none")}</p>;
	const spells = [...new Set(sc.classes.flatMap((k) => [...k.cantrips, ...k.prepared]))].map((s) => getSpell(s)).filter(Boolean);
	const byLevel = new Map<number, typeof spells>();
	for (const s of spells) byLevel.set(s!.level, [...(byLevel.get(s!.level) ?? []), s]);
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-1.5">
				{sc.slots.map((max, i) =>
					max ? (
						<div key={i} className="flex items-center gap-1 rounded-md border border-line bg-bg-2/70 px-2 py-1 text-xs">
							<span className="text-faint">{t("play.spells.slot", { n: i + 1 })}</span>
							{Array.from({ length: max }, (_, j) => (
								<span key={j} className={`h-2.5 w-2.5 rotate-45 border ${j < max - (sc.slotsUsed[i] ?? 0) ? "border-mana bg-mana" : "border-line"}`} />
							))}
						</div>
					) : null,
				)}
				{sc.pact && <span className="chip">{t("play.spells.pact", { level: sc.pact.level, left: sc.pact.max - sc.pact.used, max: sc.pact.max })}</span>}
			</div>
			{[...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([lvl, list]) => (
				<section key={lvl}>
					<h4 className="heading mb-1 text-sm">{lvl === 0 ? t("play.spells.cantrips") : t("play.spells.level", { n: lvl })}</h4>
					<div className="space-y-1">
						{list.map((s) => (
							<details key={s!.index} className="rounded-md bg-bg-2/60 px-2 py-1 text-sm">
								<summary className="flex cursor-pointer justify-between gap-2">
									<Tooltip content={<SpellCard spell={s!} />} side="bottom" widthClass="max-w-sm">
										<span className="flex items-center gap-1.5">
											{ts(s!.name)}
											<SpellAdvChips spell={s!} />
										</span>
									</Tooltip>
									<span className="flex items-center gap-2">
										<span className="text-xs text-faint">
											{ts(s!.castingTime)}
											{s!.concentration ? <span title={t("play.spells.concentration")}> · C</span> : ""}
										</span>
										<CastButton state={state} spell={s!} actions={actions} />
									</span>
								</summary>
								<p className="mt-1 text-xs text-faint">{ts(s!.range)} · {ts(s!.duration)}</p>
								<p className="mt-1 whitespace-pre-line text-xs text-dim">{ts(s!.description)}{s!.higherLevel ? `\n\n${ts(s!.higherLevel)}` : ""}</p>
							</details>
						))}
					</div>
				</section>
			))}
		</div>
	);
}

function QuestsTab({ state }: { state: GameState }) {
	const { t, te } = useT();
	if (!state.quests.length) return <p className="text-sm text-dim">{t("play.quests.none")}</p>;
	return (
		<div className="space-y-2">
			{[...state.quests].sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1)).map((q) => (
				<div key={q.id} className={`parchment p-3 ${q.status !== "active" ? "opacity-60" : ""}`}>
					<div className="flex items-start justify-between gap-2">
						<h4 className="font-display text-sm font-semibold">{q.title}</h4>
						<span className="shrink-0 text-[10px] uppercase tracking-widest">{te("questStatus", q.status)}</span>
					</div>
					<p className="mt-1 font-serif text-sm">{q.summary}</p>
					<ul className="mt-1.5 space-y-0.5 font-serif text-sm">
						{q.objectives.map((o) => (
							<li key={o.id} className={o.done ? "line-through opacity-60" : ""}>{o.done ? "☑" : "☐"} {o.text}</li>
						))}
					</ul>
					{q.reward && <p className="mt-1 text-xs italic">{t("play.quests.reward", { r: q.reward })}</p>}
				</div>
			))}
		</div>
	);
}

function JournalTab({ state }: { state: GameState }) {
	const { t } = useT();
	if (!state.journal.length) return <p className="text-sm text-dim">{t("play.journal.empty")}</p>;
	return (
		<div className="parchment space-y-2 p-4">
			{[...state.journal].reverse().map((j) => (
				<div key={j.id} className="font-serif text-[0.95rem] leading-snug">
					<span className="font-fell text-xs uppercase tracking-wider opacity-70">{t("play.day", { n: j.day })} — </span>
					{j.text}
				</div>
			))}
		</div>
	);
}

function CodexTab({ state }: { state: GameState }) {
	const { t, te } = useT();
	const npcs = Object.values(state.npcs);
	if (!npcs.length) return <p className="text-sm text-dim">{t("play.codex.empty")}</p>;
	return (
		<div className="space-y-2">
			{npcs.map((n) => (
				<div key={n.id} className={`flex gap-3 rounded-lg border border-line bg-bg-2/60 p-2 ${n.alive ? "" : "opacity-50 grayscale"}`}>
					<Portrait spec={n.portrait} size={56} speciesId={n.speciesId} framed={false} />
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="font-display text-sm text-gold-2">{n.name}</span>
							<span className={`text-[10px] uppercase tracking-widest ${n.disposition === "hostile" ? "text-crimson-2" : n.disposition === "friendly" ? "text-emerald" : "text-faint"}`}>{te("disposition", n.disposition)}</span>
						</div>
						<div className="text-xs text-dim">{n.role}{n.alive ? "" : ` · ${t("play.codex.deceased")}`}</div>
						<p className="mt-0.5 text-xs text-text/80">{n.description}</p>
					</div>
				</div>
			))}
		</div>
	);
}

const TABS: { id: Tab; label: MessageKey; icon: typeof Heart }[] = [
	{ id: "sheet", label: "play.tab.sheet", icon: Heart },
	{ id: "inventory", label: "play.tab.inventory", icon: Backpack },
	{ id: "spells", label: "play.tab.spells", icon: Sparkles },
	{ id: "quests", label: "play.tab.quests", icon: Scroll },
	{ id: "journal", label: "play.tab.journal", icon: Feather },
	{ id: "codex", label: "play.tab.codex", icon: Users },
];

/** The Quiet: the group gets its own tab (and the codex a different icon, so the two don't look alike). */
const ZOMBIE_TABS: typeof TABS = [
	...TABS.filter((tb) => tb.id !== "codex"),
	{ id: "group", label: "play.tab.group", icon: Users },
	{ id: "codex", label: "play.tab.codex", icon: BookUser },
];

export function Sidebar({ state, onLevelUp, actions }: { state: GameState; onLevelUp: () => void; actions: SheetActions }) {
	const { t } = useT();
	const [tab, setTab] = useState<Tab>("sheet");
	const activeQuests = state.quests.filter((q) => q.status === "active").length;
	const zombie = rulesetOf(state.settings) === "zombie";
	const tabs = zombie ? ZOMBIE_TABS : TABS;
	const groupSize = zombie ? livingSurvivors(state).length : 0;
	return (
		<div className="@container flex h-full min-h-0 flex-col">
			<div className={`grid border-b border-line ${zombie ? "grid-cols-7" : "grid-cols-6"}`}>
				{tabs.map((tb) => (
					<button
						key={tb.id}
						onClick={() => setTab(tb.id)}
						title={t(tb.label)}
						aria-label={t(tb.label)}
						className={`relative flex min-w-0 flex-col items-center gap-0.5 px-0.5 py-2 text-[9px] uppercase tracking-wide transition ${tab === tb.id ? "text-gold-2" : "text-faint hover:text-dim"}`}
					>
						<tb.icon size={16} />
						<span className="hidden max-w-full truncate @[420px]:block">{t(tb.label)}</span>
						{tab === tb.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-gold" />}
						{tb.id === "quests" && activeQuests > 0 && <span className="absolute right-2 top-1 rounded-full bg-gold px-1 text-[9px] text-ink">{activeQuests}</span>}
						{tb.id === "group" && groupSize > 0 && <span className="absolute right-1.5 top-1 rounded-full bg-gold px-1 text-[9px] text-ink">{groupSize}</span>}
					</button>
				))}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				{tab === "sheet" && <SheetTab state={state} onLevelUp={onLevelUp} actions={actions} />}
				{tab === "inventory" && <InventoryTab state={state} actions={actions} />}
				{tab === "spells" && <SpellsTab state={state} actions={actions} />}
				{tab === "quests" && <QuestsTab state={state} />}
				{tab === "journal" && <JournalTab state={state} />}
				{tab === "codex" && <CodexTab state={state} />}
				{tab === "group" && zombie && <GroupTab state={state} />}
			</div>
		</div>
	);
}

export { BookOpen };
