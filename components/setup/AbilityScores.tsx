"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Dices, Minus, Plus, RotateCcw, Zap } from "lucide-react";
import type { Abilities, Ability } from "@/lib/game/types";
import { assignByPriority, pointBuyCost, rollAbilityScores, STANDARD_ARRAY, POINT_BUY_BUDGET, POINT_BUY_COST, type CreationOptions } from "@/lib/rules/character";
import { Rng, newSeed, abilityMod, signed } from "@/lib/rules/dice";
import { DiceTray, type DiceTrayHandle } from "@/components/dice/DiceTray";
import { Segmented } from "@/components/ui/Tabs";
import { cn } from "@/components/ui/cn";
import { ABILITIES, swapAbilities, type AbilityMethod, type CharacterDraft } from "./wizardState";
import { useT } from "@/components/i18n/I18nProvider";

export interface AbilityScoresProps {
	c: CharacterDraft;
	opts?: CreationOptions;
	onChange: (patch: Partial<CharacterDraft>) => void;
}

export function AbilityScores({ c, opts, onChange }: AbilityScoresProps) {
	const tray = useRef<DiceTrayHandle>(null);
	const { t, te } = useT();
	const [rolling, setRolling] = useState<number[] | null>(null);
	const skip = useRef(false);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const bonusChoice = opts?.choices.find((ch) => ch.id.endsWith(":ability_bonus"));
	const chosenBonus = bonusChoice ? c.choices[bonusChoice.id] ?? [] : [];
	const bonus = (a: Ability) => (opts?.abilityBonuses[a] ?? 0) + (chosenBonus.includes(a) ? 1 : 0);

	const doRoll = async (animate: boolean) => {
		const { scores, rolls } = rollAbilityScores(new Rng(newSeed()));
		const commit = () => onChange({ abilityMethod: "roll", rolled: scores, rolledScores: assignByPriority(scores, c.classId) });
		const t = tray.current;
		if (!animate || !t) return commit();
		skip.current = false;
		setRolling([]);
		try {
			for (let i = 0; i < rolls.length && !skip.current && alive.current; i++) {
				await t.roll(rolls[i]);
				if (alive.current) setRolling(scores.slice(0, i + 1));
			}
		} finally {
			if (alive.current) setRolling(null);
			commit();
		}
	};
	const skipRoll = () => {
		skip.current = true;
		tray.current?.clear();
	};

	const base: Abilities | null = c.abilityMethod === "standard_array" ? c.standard : c.abilityMethod === "point_buy" ? c.pointBuy : c.rolledScores;
	const spent = c.abilityMethod === "point_buy" ? safeCost(c.pointBuy) : 0;

	const setBase = (s: Abilities) => {
		if (c.abilityMethod === "standard_array") onChange({ standard: s });
		else if (c.abilityMethod === "roll") onChange({ rolledScores: s });
	};
	const pool = c.abilityMethod === "standard_array" ? [...STANDARD_ARRAY] : c.rolled ?? [];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Segmented<AbilityMethod>
					label={t("abil.methodAria")}
					value={c.abilityMethod}
					onChange={(m) => onChange({ abilityMethod: m })}
					options={[
						{ value: "standard_array", label: te("abilityMethod", "standard_array") },
						{ value: "point_buy", label: te("abilityMethod", "point_buy") },
						{ value: "roll", label: te("abilityMethod", "roll") },
					]}
				/>
				{c.abilityMethod !== "point_buy" && base && (
					<button type="button" className="btn py-1 text-xs" onClick={() => setBase(assignByPriority(Object.values(base), c.classId))} title={t("abil.optimizeTitle")}>
						<RotateCcw className="size-3.5" /> {t("abil.optimize")}
					</button>
				)}
				{c.abilityMethod === "point_buy" && (
					<div className="flex items-center gap-3">
						<span className={cn("font-display tabular-nums", spent > POINT_BUY_BUDGET ? "text-crimson-2" : "text-gold-2")}>
							{t("abil.pointsLeft", { left: POINT_BUY_BUDGET - spent, budget: POINT_BUY_BUDGET })}
						</span>
						<button type="button" className="btn py-1 text-xs" onClick={() => onChange({ pointBuy: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } })}>
							<RotateCcw className="size-3.5" /> {t("abil.reset")}
						</button>
					</div>
				)}
			</div>

			{c.abilityMethod === "roll" && (
				<div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-gold/40 bg-gold/5 p-3">
					<button type="button" className="btn btn-gold" onClick={() => void doRoll(true)} disabled={rolling !== null}>
						<Dices className="size-4" /> {c.rolled ? t("abil.reroll") : t("abil.roll")}
					</button>
					{rolling ? (
						<button type="button" className="btn" onClick={skipRoll}>
							<Zap className="size-4" /> {t("abil.skip")}
						</button>
					) : (
						<button type="button" className="btn" onClick={() => void doRoll(false)}>
							<Zap className="size-4" /> {t("abil.quick")}
						</button>
					)}
					<span className="text-sm text-dim">
						{rolling ? (
							<>{t("abil.rolling", { list: rolling.join(", ") })}</>
						) : c.rolled ? (
							<>
								{t("abil.rolled")} <span className="text-text tabular-nums">{c.rolled.join(", ")}</span> {t("abil.rolledTail", { n: c.rolled.reduce((a, b) => a + b, 0) })}
							</>
						) : (
							t("abil.rollIntro")
						)}
					</span>
				</div>
			)}

			{c.abilityMethod === "roll" && !c.rolled ? null : (
				<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
					{ABILITIES.map((a, i) => {
						const v = base?.[a] ?? 8;
						const b = bonus(a);
						const final = v + b;
						return (
							<AbilityTile
								key={a}
								ability={a}
								base={v}
								bonus={b}
								final={final}
								saveProf={opts?.savingThrows.includes(a) ?? false}
								mode={c.abilityMethod}
								pool={pool}
								onSwapWith={(other) => base && setBase(swapAbilities(base, a, other))}
								onAssign={(val) => {
									if (!base) return;
									const other = ABILITIES.find((x) => base[x] === val && x !== a);
									if (other) setBase(swapAbilities(base, a, other));
								}}
								onMove={(dir) => {
									const j = i + dir;
									if (base && j >= 0 && j < ABILITIES.length) setBase(swapAbilities(base, a, ABILITIES[j]));
								}}
								onPointBuy={(delta) => {
									const nv = c.pointBuy[a] + delta;
									if (nv < 8 || nv > 15) return;
									const next = { ...c.pointBuy, [a]: nv };
									if (safeCost(next) > POINT_BUY_BUDGET) return;
									onChange({ pointBuy: next });
								}}
								canInc={c.abilityMethod === "point_buy" && c.pointBuy[a] < 15 && safeCost({ ...c.pointBuy, [a]: c.pointBuy[a] + 1 }) <= POINT_BUY_BUDGET}
								canDec={c.abilityMethod === "point_buy" && c.pointBuy[a] > 8}
							/>
						);
					})}
				</div>
			)}
			<DiceTray ref={tray} autoDismissMs={650} />
		</div>
	);
}

function safeCost(s: Abilities): number {
	try {
		return pointBuyCost(s);
	} catch {
		return 99;
	}
}

interface TileProps {
	ability: Ability;
	base: number;
	bonus: number;
	final: number;
	saveProf: boolean;
	mode: AbilityMethod;
	pool: number[];
	onSwapWith: (other: Ability) => void;
	onAssign: (value: number) => void;
	onMove: (dir: -1 | 1) => void;
	onPointBuy: (delta: 1 | -1) => void;
	canInc: boolean;
	canDec: boolean;
}

function AbilityTile({ ability, base, bonus, final, saveProf, mode, pool, onSwapWith, onAssign, onMove, onPointBuy, canInc, canDec }: TileProps) {
	const [over, setOver] = useState(false);
	const { t, te } = useT();
	const name = te("ability", ability);
	const assignable = mode !== "point_buy";
	const mod = abilityMod(final);
	const uniqueValues = [...new Set(pool)].sort((x, y) => y - x);
	return (
		<div
			draggable={assignable}
			onDragStart={(e) => {
				e.dataTransfer.setData("text/x-ability", ability);
				e.dataTransfer.effectAllowed = "move";
			}}
			onDragOver={(e) => {
				if (!assignable) return;
				e.preventDefault();
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={(e) => {
				e.preventDefault();
				setOver(false);
				const from = e.dataTransfer.getData("text/x-ability") as Ability;
				if (from && from !== ability) onSwapWith(from);
			}}
			className={cn(
				"relative flex flex-col items-center gap-1 rounded-xl border bg-gradient-to-b from-panel-2 to-panel p-3 pt-2 text-center transition-all",
				assignable && "cursor-grab active:cursor-grabbing",
				over ? "scale-[1.03] border-gold shadow-[0_0_0_2px_rgb(212_166_74/0.4)]" : "border-line",
			)}
		>
			<div className="flex w-full items-center justify-between">
				<span className="font-display text-xs tracking-[0.2em] text-gold/90 uppercase">{te("abilityShort", ability)}</span>
				{saveProf && (
					<span className="rounded bg-gold/15 px-1 text-[9px] tracking-wider text-gold-2 uppercase" title={t("abil.saveProf")}>
						{t("abil.saveTag")}
					</span>
				)}
			</div>
			<div className="max-w-full truncate text-[11px] text-dim">{name}</div>
			<div className="relative my-1 grid size-16 place-items-center rounded-full border-2 border-gold/50 bg-bg-2 shadow-[inset_0_0_12px_rgb(0_0_0/0.6)]">
				<span className="font-display text-2xl text-text tabular-nums">{final}</span>
				<span className="absolute -bottom-2.5 rounded-full border border-gold/60 bg-panel-3 px-2 text-xs font-semibold text-gold-2 tabular-nums">{signed(mod)}</span>
			</div>
			<div className="mt-2 text-[11px] text-faint tabular-nums">
				{base}
				{bonus ? <span className="text-emerald"> {signed(bonus)}</span> : null}
			</div>
			{mode === "point_buy" ? (
				<div className="mt-1 flex items-center gap-1">
					<button type="button" className="btn p-1" onClick={() => onPointBuy(-1)} disabled={!canDec} aria-label={t("abil.decrease", { a: name })}>
						<Minus className="size-3.5" />
					</button>
					<span className="w-10 text-[10px] text-faint">{t("abil.pt", { n: POINT_BUY_COST[base] ?? "?" })}</span>
					<button type="button" className="btn p-1" onClick={() => onPointBuy(1)} disabled={!canInc} aria-label={t("abil.increase", { a: name })}>
						<Plus className="size-3.5" />
					</button>
				</div>
			) : (
				<div className="mt-1 flex items-center gap-1">
					<button type="button" className="rounded p-0.5 text-faint hover:text-gold-2" onClick={() => onMove(-1)} aria-label={t("abil.swapPrev", { a: name })}>
						<ArrowUp className="size-3.5 -rotate-90" />
					</button>
					<select className="input w-14 px-1 py-0.5 text-center text-xs" value={base} onChange={(e) => onAssign(Number(e.target.value))} aria-label={t("abil.baseScore", { a: name })}>
						{uniqueValues.map((v) => (
							<option key={v} value={v}>
								{v}
							</option>
						))}
					</select>
					<button type="button" className="rounded p-0.5 text-faint hover:text-gold-2" onClick={() => onMove(1)} aria-label={t("abil.swapNext", { a: name })}>
						<ArrowDown className="size-3.5 -rotate-90" />
					</button>
				</div>
			)}
		</div>
	);
}
