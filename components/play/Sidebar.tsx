"use client";

import { useMemo, useState } from "react";
import { Backpack, BookOpen, Feather, Scroll, Shield, Sparkles, Users, Heart, Swords, ArrowUpCircle, Coins } from "lucide-react";
import type { Ability, GameState, InventoryItem, PlayerCombatAction } from "@/lib/game/types";
import { deriveSheet } from "@/lib/rules/character";
import { getSpell } from "@/lib/srd";
import { signed } from "@/lib/rules/dice";
import Portrait from "@/components/art/Portrait";

const ABIL: [Ability, string][] = [["str", "STR"], ["dex", "DEX"], ["con", "CON"], ["int", "INT"], ["wis", "WIS"], ["cha", "CHA"]];

/** Lets the sidebar spend resources through the engine (never locally). */
export interface SheetActions {
	act: (a: PlayerCombatAction) => void;
	busy: boolean;
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

type Tab = "sheet" | "inventory" | "spells" | "quests" | "journal" | "codex";

function titleCase(s: string) {
	return s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
	return (
		<div className="flex flex-col items-center rounded-lg border border-line bg-bg-2/70 px-2 py-1.5">
			<span className="text-[10px] uppercase tracking-widest text-faint">{label}</span>
			<span className="font-display text-lg text-gold-2">{value}</span>
			{sub && <span className="text-[10px] text-dim">{sub}</span>}
		</div>
	);
}

function SheetTab({ state, onLevelUp, actions }: { state: GameState; onLevelUp: () => void; actions: SheetActions }) {
	const c = state.character;
	const sheet = useMemo(() => {
		try {
			return deriveSheet(c);
		} catch {
			return null;
		}
	}, [c]);
	const lvl = c.classes.reduce((n, k) => n + k.level, 0);
	const canLevel = state.settings.structure.leveling === "xp" ? (sheet?.xpToNext !== undefined ? c.xp >= sheet.xpToNext : false) : (state.levelUpsGranted ?? 0) > 0;
	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<Portrait spec={c.portrait} size={84} speciesId={c.speciesId} />
				<div className="min-w-0">
					<div className="heading truncate text-lg">{c.name}</div>
					<div className="text-sm text-dim">
						{titleCase(c.subspeciesId ?? c.speciesId)} · {c.classes.map((k) => `${titleCase(k.classId)}${k.subclassId ? ` (${titleCase(k.subclassId)})` : ""} ${k.level}`).join(" / ")}
					</div>
					<div className="text-xs text-faint">Level {lvl} · {c.xp} XP{sheet?.xpToNext ? ` / ${sheet.xpToNext}` : ""}</div>
				</div>
			</div>
			{canLevel && (
				<button className="btn btn-gold w-full justify-center animate-pulse" onClick={onLevelUp}>
					<ArrowUpCircle size={16} /> Level up!
				</button>
			)}
			<Bar value={c.hp} max={c.maxHp} color="linear-gradient(90deg,#8e2a22,var(--hp))" label={`Hit points${c.tempHp ? ` (+${c.tempHp} temp)` : ""}`} />
			{c.hp === 0 && (
				<div className="rounded-md border border-crimson/50 bg-crimson/10 p-2 text-sm">
					Dying: {c.deathSaves.successes}✓ / {c.deathSaves.failures}✗
				</div>
			)}
			{sheet && (
				<div className="grid grid-cols-4 gap-1.5">
					<Stat label="AC" value={sheet.ac} />
					<Stat label="Init" value={signed(sheet.initiative)} />
					<Stat label="Speed" value={sheet.speed} sub="ft" />
					<Stat label="Prof" value={signed(sheet.profBonus)} />
				</div>
			)}
			<div className="grid grid-cols-6 gap-1">
				{ABIL.map(([a, l]) => (
					<div key={a} className="flex flex-col items-center rounded-md border border-line bg-bg-2/70 py-1">
						<span className="text-[10px] tracking-widest text-faint">{l}</span>
						<span className="font-display text-base text-text">{c.abilities[a]}</span>
						<span className="text-xs text-gold">{signed(Math.floor((c.abilities[a] - 10) / 2))}</span>
						{sheet && <span className="text-[10px] text-dim" title="Saving throw">{sheet.saves[a].proficient ? "●" : "○"} {signed(sheet.saves[a].mod)}</span>}
					</div>
				))}
			</div>
			{c.conditions.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{c.conditions.map((x) => (
						<span key={x.id} className="chip border-crimson/50 text-crimson-2">{titleCase(x.id)}</span>
					))}
					{c.exhaustion > 0 && <span className="chip border-crimson/50 text-crimson-2">Exhaustion {c.exhaustion}</span>}
				</div>
			)}
			{sheet && sheet.attacks.length > 0 && (
				<section>
					<h4 className="heading mb-1.5 flex items-center gap-1.5 text-sm"><Swords size={14} /> Attacks</h4>
					<div className="space-y-1">
						{sheet.attacks.map((a, i) => (
							<div key={i} className="flex items-center justify-between rounded-md bg-bg-2/60 px-2 py-1 text-sm">
								<span>{a.name}</span>
								<span className="tabular-nums text-dim">{signed(a.toHit)} · {a.damage}</span>
							</div>
						))}
					</div>
				</section>
			)}
			{sheet && (
				<section>
					<h4 className="heading mb-1.5 text-sm">Skills</h4>
					<div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
						{Object.entries(sheet.skills).map(([k, s]) => (
							<div key={k} className="flex justify-between">
								<span className={s.proficient ? "text-text" : "text-dim"}>
									{s.expertise ? "◆" : s.proficient ? "●" : "○"} {titleCase(k)}
								</span>
								<span className="tabular-nums text-dim">{signed(s.mod)}</span>
							</div>
						))}
					</div>
					<div className="mt-2 text-xs text-faint">Passive Perception {sheet.passivePerception} · Insight {sheet.passiveInsight} · Investigation {sheet.passiveInvestigation}</div>
				</section>
			)}
			{c.features.length > 0 && (
				<section>
					<h4 className="heading mb-1.5 text-sm">Features</h4>
					<div className="space-y-1">
						{c.features.map((f) => (
							<details key={f.id} className="rounded-md bg-bg-2/60 px-2 py-1 text-sm">
								<summary className="flex cursor-pointer justify-between">
									<span>{f.name}</span>
									{f.uses && (
										<span className="flex items-center gap-2">
											<span className="text-xs text-gold">{f.uses.max - f.uses.used}/{f.uses.max}</span>
											<UseBtn label="Use" onClick={() => actions.act({ type: "use_feature", featureId: f.id })} disabled={actions.busy || f.uses.used >= f.uses.max} title={`Recharges on a ${f.uses.recharge} rest`} />
										</span>
									)}
								</summary>
								<p className="mt-1 whitespace-pre-line text-xs text-dim">{f.description}</p>
							</details>
						))}
					</div>
				</section>
			)}
		</div>
	);
}

function InventoryTab({ state, actions }: { state: GameState; actions: SheetActions }) {
	const c = state.character;
	const cur = c.currency;
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-1.5 text-sm">
				<Coins size={16} className="text-gold" />
				{(["pp", "gp", "ep", "sp", "cp"] as const).map((k) => (cur[k] ? <span key={k} className="chip">{cur[k]} {k}</span> : null))}
			</div>
			<div className="space-y-1">
				{c.inventory.length === 0 && <p className="text-sm text-dim">Your pack is empty.</p>}
				{c.inventory.map((i) => (
					<details key={i.id} className="rounded-md bg-bg-2/60 px-2 py-1.5 text-sm">
						<summary className="flex cursor-pointer items-center justify-between gap-2">
							<span className="truncate">
								{i.equipped && <Shield size={12} className="mr-1 inline text-gold" />}
								{i.name}
								{i.quantity > 1 && <span className="text-dim"> ×{i.quantity}</span>}
							</span>
							<span className="flex shrink-0 items-center gap-2">
								<span className="text-xs text-faint">{i.weapon ? `${i.weapon.damage} ${i.weapon.damageType}` : i.armor ? `AC ${i.armor.baseAc}` : i.category}</span>
								{isConsumable(i) && <UseBtn label="Use" onClick={() => actions.act({ type: "use_item", itemId: i.id })} disabled={actions.busy} />}
							</span>
						</summary>
						{(i.description || i.weapon?.properties.length) && (
							<p className="mt-1 whitespace-pre-line text-xs text-dim">
								{i.weapon?.properties.length ? `${i.weapon.properties.join(", ")}\n` : ""}
								{i.description}
							</p>
						)}
					</details>
				))}
			</div>
		</div>
	);
}

function CastButton({ state, spell, actions }: { state: GameState; spell: { index: string; level: number }; actions: SheetActions }) {
	const sc = state.character.spellcasting!;
	const levels: number[] = [];
	if (spell.level > 0)
		for (let l = spell.level; l <= 9; l++) {
			const left = (sc.slots[l - 1] ?? 0) - (sc.slotsUsed[l - 1] ?? 0) + (sc.pact && sc.pact.level === l ? sc.pact.max - sc.pact.used : 0);
			if (left > 0) levels.push(l);
		}
	const [lvl, setLvl] = useState<number>(levels[0] ?? spell.level);
	if (state.encounter?.status === "active") return <span className="text-[10px] text-faint" title="In combat, cast from the action bar under the map.">action bar</span>;
	const none = spell.level > 0 && levels.length === 0;
	const slot = levels.includes(lvl) ? lvl : levels[0];
	return (
		<span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
			{levels.length > 1 && (
				<select className="rounded border border-line bg-bg px-0.5 text-[10px]" value={slot} onChange={(e) => setLvl(+e.target.value)}>
					{levels.map((l) => (
						<option key={l} value={l}>L{l}</option>
					))}
				</select>
			)}
			<UseBtn label="Cast" onClick={() => actions.act({ type: "cast", spell: spell.index, slotLevel: spell.level === 0 ? 0 : slot })} disabled={actions.busy || none} title={none ? "No spell slots left" : undefined} />
		</span>
	);
}

function SpellsTab({ state, actions }: { state: GameState; actions: SheetActions }) {
	const sc = state.character.spellcasting;
	if (!sc) return <p className="text-sm text-dim">You don&apos;t cast spells.</p>;
	const spells = [...new Set(sc.classes.flatMap((k) => [...k.cantrips, ...k.prepared]))].map((s) => getSpell(s)).filter(Boolean);
	const byLevel = new Map<number, typeof spells>();
	for (const s of spells) byLevel.set(s!.level, [...(byLevel.get(s!.level) ?? []), s]);
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-1.5">
				{sc.slots.map((max, i) =>
					max ? (
						<div key={i} className="flex items-center gap-1 rounded-md border border-line bg-bg-2/70 px-2 py-1 text-xs">
							<span className="text-faint">L{i + 1}</span>
							{Array.from({ length: max }, (_, j) => (
								<span key={j} className={`h-2.5 w-2.5 rotate-45 border ${j < max - (sc.slotsUsed[i] ?? 0) ? "border-mana bg-mana" : "border-line"}`} />
							))}
						</div>
					) : null,
				)}
				{sc.pact && <span className="chip">Pact L{sc.pact.level}: {sc.pact.max - sc.pact.used}/{sc.pact.max}</span>}
			</div>
			{[...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([lvl, list]) => (
				<section key={lvl}>
					<h4 className="heading mb-1 text-sm">{lvl === 0 ? "Cantrips" : `Level ${lvl}`}</h4>
					<div className="space-y-1">
						{list.map((s) => (
							<details key={s!.index} className="rounded-md bg-bg-2/60 px-2 py-1 text-sm">
								<summary className="flex cursor-pointer justify-between gap-2">
									<span>{s!.name}</span>
									<span className="flex items-center gap-2">
										<span className="text-xs text-faint">{s!.castingTime}{s!.concentration ? " · C" : ""}</span>
										<CastButton state={state} spell={s!} actions={actions} />
									</span>
								</summary>
								<p className="mt-1 text-xs text-faint">{s!.range} · {s!.duration}</p>
								<p className="mt-1 whitespace-pre-line text-xs text-dim">{s!.description}</p>
							</details>
						))}
					</div>
				</section>
			))}
		</div>
	);
}

function QuestsTab({ state }: { state: GameState }) {
	if (!state.quests.length) return <p className="text-sm text-dim">No quests yet.</p>;
	return (
		<div className="space-y-2">
			{[...state.quests].sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1)).map((q) => (
				<div key={q.id} className={`parchment p-3 ${q.status !== "active" ? "opacity-60" : ""}`}>
					<div className="flex items-start justify-between gap-2">
						<h4 className="font-display text-sm font-semibold">{q.title}</h4>
						<span className="text-[10px] uppercase tracking-widest">{q.status}</span>
					</div>
					<p className="mt-1 font-serif text-sm">{q.summary}</p>
					<ul className="mt-1.5 space-y-0.5 font-serif text-sm">
						{q.objectives.map((o) => (
							<li key={o.id} className={o.done ? "line-through opacity-60" : ""}>{o.done ? "☑" : "☐"} {o.text}</li>
						))}
					</ul>
					{q.reward && <p className="mt-1 text-xs italic">Reward: {q.reward}</p>}
				</div>
			))}
		</div>
	);
}

function JournalTab({ state }: { state: GameState }) {
	if (!state.journal.length) return <p className="text-sm text-dim">The journal is blank.</p>;
	return (
		<div className="parchment space-y-2 p-4">
			{[...state.journal].reverse().map((j) => (
				<div key={j.id} className="font-serif text-[0.95rem] leading-snug">
					<span className="font-fell text-xs uppercase tracking-wider opacity-70">Day {j.day} — </span>
					{j.text}
				</div>
			))}
		</div>
	);
}

function CodexTab({ state }: { state: GameState }) {
	const npcs = Object.values(state.npcs);
	if (!npcs.length) return <p className="text-sm text-dim">You haven&apos;t met anyone of note yet.</p>;
	return (
		<div className="space-y-2">
			{npcs.map((n) => (
				<div key={n.id} className={`flex gap-3 rounded-lg border border-line bg-bg-2/60 p-2 ${n.alive ? "" : "opacity-50 grayscale"}`}>
					<Portrait spec={n.portrait} size={56} speciesId={n.speciesId} framed={false} />
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="font-display text-sm text-gold-2">{n.name}</span>
							<span className={`text-[10px] uppercase tracking-widest ${n.disposition === "hostile" ? "text-crimson-2" : n.disposition === "friendly" ? "text-emerald" : "text-faint"}`}>{n.disposition}</span>
						</div>
						<div className="text-xs text-dim">{n.role}{n.alive ? "" : " · deceased"}</div>
						<p className="mt-0.5 text-xs text-text/80">{n.description}</p>
					</div>
				</div>
			))}
		</div>
	);
}

const TABS: { id: Tab; label: string; icon: typeof Heart }[] = [
	{ id: "sheet", label: "Character", icon: Heart },
	{ id: "inventory", label: "Inventory", icon: Backpack },
	{ id: "spells", label: "Spells", icon: Sparkles },
	{ id: "quests", label: "Quests", icon: Scroll },
	{ id: "journal", label: "Journal", icon: Feather },
	{ id: "codex", label: "Codex", icon: Users },
];

export function Sidebar({ state, onLevelUp, actions }: { state: GameState; onLevelUp: () => void; actions: SheetActions }) {
	const [tab, setTab] = useState<Tab>("sheet");
	const activeQuests = state.quests.filter((q) => q.status === "active").length;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="grid grid-cols-6 border-b border-line">
				{TABS.map((t) => (
					<button
						key={t.id}
						onClick={() => setTab(t.id)}
						title={t.label}
						className={`relative flex flex-col items-center gap-0.5 py-2 text-[10px] uppercase tracking-wider transition ${tab === t.id ? "text-gold-2" : "text-faint hover:text-dim"}`}
					>
						<t.icon size={16} />
						<span className="hidden xl:inline">{t.label}</span>
						{tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-gold" />}
						{t.id === "quests" && activeQuests > 0 && <span className="absolute right-2 top-1 rounded-full bg-gold px-1 text-[9px] text-ink">{activeQuests}</span>}
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
			</div>
		</div>
	);
}

export { BookOpen };
