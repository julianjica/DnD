"use client";

import clsx from "clsx";
import type { RollRecord } from "@/lib/game/types";
import { useT } from "@/components/i18n/I18nProvider";

/** "Perception check (WIS)" / "Dexterity save": what a d20 roll tested. */
export function useCheckText() {
	const { t, te } = useT();
	const title = (rec: RollRecord): string | null => {
		const c = rec.check;
		if (!c) return null;
		const ability = te("ability", c.ability);
		if (c.kind === "save") return t("play.dice.save", { ability });
		if (c.skill) return t("play.dice.checkSkill", { skill: te("skill", c.skill), ab: te("abilityShort", c.ability) });
		return t("play.dice.checkAbility", { ability });
	};
	const parts = (rec: RollRecord): { label: string; value: number }[] =>
		(rec.check?.parts ?? []).filter((p) => p.value !== 0 || p.k === "ability").map((p) => ({
			label: p.k === "ability" ? te("abilityShort", rec.check!.ability) : t(`play.dice.part.${p.k}`),
			value: p.value,
		}));
	return { title, parts };
}

const sgn = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** Small pill naming the skill/ability; `tone` matches the surface it sits on. */
export function CheckTag({ rec, className, tone = "dark" }: { rec: RollRecord; className?: string; tone?: "dark" | "theme" }) {
	const { title } = useCheckText();
	const text = title(rec);
	if (!text) return null;
	return (
		<span
			className={clsx(
				"inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
				rec.check!.kind === "save"
					? tone === "dark" ? "bg-sky-900/60 text-sky-200" : "bg-sky-500/15 text-sky-600 dark:text-sky-300"
					: tone === "dark" ? "bg-amber-900/50 text-amber-200" : "bg-amber-500/15 text-gold-2",
				className,
			)}
		>
			{text}
		</span>
	);
}

/** "+3 WIS +2 Prof" — where the modifier comes from. */
export function ModBreakdown({ rec, className }: { rec: RollRecord; className?: string }) {
	const { parts } = useCheckText();
	const ps = parts(rec);
	if (!ps.length) return null;
	return (
		<span className={clsx("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
			{ps.map((p, i) => (
				<span key={i} className="whitespace-nowrap">
					<span className="font-serif tabular-nums">{sgn(p.value)}</span> <span className="text-[0.8em] uppercase tracking-wide opacity-75">{p.label}</span>
				</span>
			))}
		</span>
	);
}
