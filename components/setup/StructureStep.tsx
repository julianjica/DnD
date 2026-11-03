"use client";

import { useMemo, useState } from "react";
import { BookOpen, Dices, Map as MapIcon, ScrollText, Shuffle, Swords } from "lucide-react";
import { Segmented } from "@/components/ui/Tabs";
import { Slider } from "@/components/ui/Slider";
import { cn } from "@/components/ui/cn";
import { getClass } from "@/lib/srd";
import { FieldLabel, Section } from "./Field";
import { srdNameIn } from "./i18n";
import { DIFFICULTIES, FORMATS, HOOKS, randomTitle } from "./presets";
import { useT } from "@/components/i18n/I18nProvider";
import { patchSettings, type StepProps } from "./types";

const FORMAT_ICON = { one_shot: ScrollText, short_campaign: BookOpen, long_campaign: MapIcon } as const;

export function StructureStep({ draft, update }: StepProps) {
	const s = draft.settings.structure;
	const { t, te, lang, ruleset } = useT();
	const set = (patch: Partial<typeof s>) => patchSettings(update, "structure", patch);
	const allHooks = useMemo(() => [...HOOKS[lang][draft.settings.world.preset], ...HOOKS[lang].any], [draft.settings.world.preset, lang]);
	const [hookOffset, setHookOffset] = useState(0);
	const shownHooks = Array.from({ length: Math.min(3, allHooks.length) }, (_, i) => allHooks[(hookOffset + i) % allHooks.length]);
	const cls = getClass(draft.character.classId);

	const rollTitle = () => update((d) => ({ ...d, title: randomTitle(lang) }));

	return (
		<div className="grid gap-8 lg:grid-cols-2">
			<div className="flex flex-col gap-7">
				<Section title={t("structure.format")} hint={t("structure.formatHint")}>
					<div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label={t("structure.formatAria")}>
						{FORMATS.map((f) => {
							const Icon = FORMAT_ICON[f];
							const active = s.format === f;
							return (
								<button
									key={f}
									type="button"
									role="radio"
									aria-checked={active}
									onClick={() => set({ format: f })}
									className={cn(
										"panel flex flex-col items-start gap-2 p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-gold",
										active ? "border-gold bg-gold/10" : "hover:border-gold/50",
									)}
								>
									<Icon className={cn("size-6", active ? "text-gold-2" : "text-dim")} />
									<span className="font-display text-sm tracking-wide text-text">{te("format", f)}</span>
									<span className="text-xs leading-snug text-dim">{te("formatBlurb", f)}</span>
								</button>
							);
						})}
					</div>
				</Section>

				<Section title={t("structure.level")} hint={t("structure.levelHint")}>
					<div className="panel p-5">
						<div className="flex items-center gap-5">
							<div className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-gold/70 bg-bg-2 font-display text-3xl text-gold-2 shadow-[inset_0_0_14px_rgb(212_166_74/0.25)]">{s.startingLevel}</div>
							<Slider className="flex-1" min={1} max={20} value={s.startingLevel} onChange={(v) => set({ startingLevel: v })} format={null} ticks={[1, 5, 10, 15, 20]} label={t("structure.levelLabel")} />
						</div>
						<p className="mt-3 text-xs text-dim">
							{t(s.startingLevel === 1 ? "structure.level.1" : s.startingLevel < 5 ? "structure.level.low" : s.startingLevel < 11 ? "structure.level.mid" : s.startingLevel < 17 ? "structure.level.high" : "structure.level.epic")}
							{cls &&
								s.startingLevel >= cls.subclassLevel &&
								cls.subclassLevel > 1 &&
								t("structure.subclassNote", { cls: srdNameIn(ruleset, lang, "class", cls.index, cls.name).toLowerCase(), flavor: srdNameIn(ruleset, lang, "subclassFlavor", cls.index, cls.subclassFlavor).toLowerCase() })}
						</p>
					</div>
				</Section>

				<Section title={t("structure.difficulty")}>
					<Segmented
						label={t("structure.difficulty")}
						value={s.difficulty}
						onChange={(difficulty) => set({ difficulty })}
						options={DIFFICULTIES.map((v) => ({ value: v, label: te("difficulty", v) }))}
					/>
					<p className="flex items-start gap-2 text-sm text-dim">
						<Swords className="mt-0.5 size-4 shrink-0 text-gold/70" />
						{te("difficultyInfo", s.difficulty)}
					</p>
				</Section>

				<Section title={t("structure.leveling")}>
					<Segmented
						label={t("structure.leveling")}
						value={s.leveling}
						onChange={(leveling) => set({ leveling })}
						options={[
							{ value: "milestone", label: te("leveling", "milestone"), hint: t("structure.leveling.milestoneHint") },
							{ value: "xp", label: te("leveling", "xp"), hint: t("structure.leveling.xpHint") },
						]}
					/>
					<p className="text-sm text-dim">{s.leveling === "milestone" ? t("structure.leveling.milestoneDesc") : t("structure.leveling.xpDesc")}</p>
				</Section>
			</div>

			<div className="flex flex-col gap-7">
				<Section
					title={t("structure.title")}
					hint={t("structure.titleHint")}
					actions={
						<button type="button" className="btn py-1 text-xs" onClick={rollTitle}>
							<Dices className="size-3.5" /> {t("structure.random")}
						</button>
					}
				>
					<input className="input font-display text-lg tracking-wide" value={draft.title} onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} placeholder={t("structure.titlePh")} aria-label={t("structure.title")} maxLength={80} />
				</Section>

				<Section
					title={t("structure.hook")}
					hint={t("structure.hookHint")}
					actions={
						<button type="button" className="btn py-1 text-xs" onClick={() => setHookOffset((o) => (o + 3) % Math.max(1, allHooks.length))}>
							<Shuffle className="size-3.5" /> {t("structure.moreIdeas")}
						</button>
					}
				>
					<FieldLabel htmlFor="hook" optional>
						{t("structure.premise")}
					</FieldLabel>
					<textarea id="hook" className="input min-h-32 resize-y font-serif text-base" value={s.hook ?? ""} onChange={(e) => set({ hook: e.target.value })} placeholder={t("structure.hookPh")} />
					<ul className="flex flex-col gap-2">
						{shownHooks.map((h) => (
							<li key={h}>
								<button
									type="button"
									onClick={() => set({ hook: h })}
									className={cn(
										"w-full rounded-lg border border-dashed px-3 py-2 text-left font-serif text-[15px] italic transition-colors",
										s.hook === h ? "border-gold bg-gold/10 text-gold-2" : "border-line text-text/80 hover:border-gold/60 hover:text-text",
									)}
								>
									“{h}”
								</button>
							</li>
						))}
					</ul>
				</Section>
			</div>
		</div>
	);
}
