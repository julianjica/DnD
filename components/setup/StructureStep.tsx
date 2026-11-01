"use client";

import { useMemo, useState } from "react";
import { BookOpen, Dices, Map as MapIcon, ScrollText, Shuffle, Swords } from "lucide-react";
import { Segmented } from "@/components/ui/Tabs";
import { Slider } from "@/components/ui/Slider";
import { cn } from "@/components/ui/cn";
import { getClass } from "@/lib/srd";
import { FieldLabel, Section } from "./Field";
import { DIFFICULTY_INFO, FORMAT_INFO, HOOKS, TITLE_PARTS } from "./presets";
import { patchSettings, type StepProps } from "./types";
import type { CampaignSettings } from "@/lib/game/types";

const FORMAT_ICON = { one_shot: ScrollText, short_campaign: BookOpen, long_campaign: MapIcon } as const;

export function StructureStep({ draft, update }: StepProps) {
	const s = draft.settings.structure;
	const set = (patch: Partial<typeof s>) => patchSettings(update, "structure", patch);
	const allHooks = useMemo(() => [...HOOKS[draft.settings.world.preset], ...HOOKS.any], [draft.settings.world.preset]);
	const [hookOffset, setHookOffset] = useState(0);
	const shownHooks = Array.from({ length: Math.min(3, allHooks.length) }, (_, i) => allHooks[(hookOffset + i) % allHooks.length]);
	const cls = getClass(draft.character.classId);

	const randomTitle = () => {
		const r = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
		update((d) => ({ ...d, title: `${r(TITLE_PARTS.a)} ${r(TITLE_PARTS.b)} ${r(TITLE_PARTS.c)}` }));
	};

	return (
		<div className="grid gap-8 lg:grid-cols-2">
			<div className="flex flex-col gap-7">
				<Section title="Format" hint="How long do you want this tale to run?">
					<div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Campaign format">
						{(Object.keys(FORMAT_INFO) as CampaignSettings["structure"]["format"][]).map((f) => {
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
									<span className="font-display text-sm tracking-wide text-text">{FORMAT_INFO[f].name}</span>
									<span className="text-xs leading-snug text-dim">{FORMAT_INFO[f].blurb}</span>
								</button>
							);
						})}
					</div>
				</Section>

				<Section title="Starting level" hint="Your character is built at this level: hit points, spells and features scale with it.">
					<div className="panel p-5">
						<div className="flex items-center gap-5">
							<div className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-gold/70 bg-bg-2 font-display text-3xl text-gold-2 shadow-[inset_0_0_14px_rgb(212_166_74/0.25)]">{s.startingLevel}</div>
							<Slider className="flex-1" min={1} max={20} value={s.startingLevel} onChange={(v) => set({ startingLevel: v })} format={null} ticks={[1, 5, 10, 15, 20]} label="Level" />
						</div>
						<p className="mt-3 text-xs text-dim">
							{s.startingLevel === 1 ? "A humble beginning: the classic way to start." : s.startingLevel < 5 ? "Seasoned but still mortal." : s.startingLevel < 11 ? "A proven hero with real power." : s.startingLevel < 17 ? "A legend in the making, able to reshape kingdoms." : "Near-mythic power. The gods take notice."}
							{cls && s.startingLevel >= cls.subclassLevel && cls.subclassLevel > 1 && ` Your ${cls.name.toLowerCase()} will choose a ${cls.subclassFlavor.toLowerCase()}.`}
						</p>
					</div>
				</Section>

				<Section title="Difficulty">
					<Segmented
						label="Difficulty"
						value={s.difficulty}
						onChange={(difficulty) => set({ difficulty })}
						options={(["story", "easy", "normal", "hard", "deadly"] as const).map((v) => ({ value: v, label: <span className="capitalize">{v}</span> }))}
					/>
					<p className="flex items-start gap-2 text-sm text-dim">
						<Swords className="mt-0.5 size-4 shrink-0 text-gold/70" />
						{DIFFICULTY_INFO[s.difficulty]}
					</p>
				</Section>

				<Section title="Leveling">
					<Segmented
						label="Leveling"
						value={s.leveling}
						onChange={(leveling) => set({ leveling })}
						options={[
							{ value: "milestone", label: "Milestone", hint: "Level up at story beats" },
							{ value: "xp", label: "Experience points", hint: "Earn XP from foes and deeds" },
						]}
					/>
					<p className="text-sm text-dim">{s.leveling === "milestone" ? "The DM grants levels when the story reaches a turning point." : "You earn XP for defeating foes and overcoming challenges, by the book."}</p>
				</Section>
			</div>

			<div className="flex flex-col gap-7">
				<Section
					title="Campaign title"
					hint="Leave blank and it becomes “<your hero>'s Tale”."
					actions={
						<button type="button" className="btn py-1 text-xs" onClick={randomTitle}>
							<Dices className="size-3.5" /> Random
						</button>
					}
				>
					<input className="input font-display text-lg tracking-wide" value={draft.title} onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} placeholder="The Ashen Crown" aria-label="Campaign title" maxLength={80} />
				</Section>

				<Section
					title="Opening hook"
					hint="Optional. Give the DM a premise, or leave it to them."
					actions={
						<button type="button" className="btn py-1 text-xs" onClick={() => setHookOffset((o) => (o + 3) % Math.max(1, allHooks.length))}>
							<Shuffle className="size-3.5" /> More ideas
						</button>
					}
				>
					<FieldLabel htmlFor="hook" optional>
						Premise
					</FieldLabel>
					<textarea id="hook" className="input min-h-32 resize-y font-serif text-base" value={s.hook ?? ""} onChange={(e) => set({ hook: e.target.value })} placeholder="Let the DM surprise you…" />
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
