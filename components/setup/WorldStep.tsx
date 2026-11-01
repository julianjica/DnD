"use client";

import { useState } from "react";
import { Ban, Check, EyeOff, Plus, X } from "lucide-react";
import { SceneArt } from "@/components/art/SceneArt";
import { cn } from "@/components/ui/cn";
import { ChipToggle, FieldLabel, Section } from "./Field";
import { LINE_SUGGESTIONS, TONES, VEIL_SUGGESTIONS, WORLD_PRESETS, presetInfo } from "./presets";
import { patchSettings, type StepProps } from "./types";
import { useT } from "@/components/i18n/I18nProvider";

export function WorldStep({ draft, update }: StepProps) {
	const w = draft.settings.world;
	const set = (patch: Partial<typeof w>) => patchSettings(update, "world", patch);
	const toggleTone = (tone: string) => set({ tone: w.tone.includes(tone) ? w.tone.filter((x) => x !== tone) : [...w.tone, tone] });
	const info = presetInfo(w.preset);
	const { t, te, lang } = useT();
	const infoName = te("preset", info.id);

	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
			<div className="flex flex-col gap-6">
				<Section title={t("world.choose")} hint={t("world.chooseHint")}>
					<div className="grid grid-cols-2 gap-3 xl:grid-cols-3" role="radiogroup" aria-label={t("world.presetAria")}>
						{WORLD_PRESETS.map((p) => {
							const active = p.id === w.preset;
							return (
								<button
									key={p.id}
									type="button"
									role="radio"
									aria-checked={active}
									onClick={() => set({ preset: p.id })}
									className={cn(
										"group relative overflow-hidden rounded-lg border text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
										active ? "border-gold shadow-[0_0_0_1px_var(--gold),0_8px_30px_rgb(212_166_74/0.18)]" : "border-line hover:border-gold/60",
									)}
								>
									<SceneArt scene={p.scene} animate={false} parallax={false} showCaption={false} className="transition-transform duration-500 group-hover:scale-[1.03]" />
									<div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
									<div className="absolute inset-x-0 bottom-0 p-3">
										<div className="font-display text-sm tracking-wide text-gold-2">{te("preset", p.id)}</div>
									</div>
									{active && (
										<span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-gold text-[#2a1d0b] shadow">
											<Check className="size-3.5" />
										</span>
									)}
								</button>
							);
						})}
					</div>
				</Section>

				<Section title={w.preset === "custom" ? t("world.describe") : t("world.notes")} hint={w.preset === "custom" ? t("world.describeHint") : t("world.notesHint")}>
					<textarea
						className="input min-h-28 resize-y font-serif text-base"
						value={w.customText ?? ""}
						onChange={(e) => set({ customText: e.target.value })}
						placeholder={w.preset === "custom" ? t("world.customPh") : t("world.notesPh")}
						aria-label={t("world.descAria")}
					/>
				</Section>
			</div>

			<aside className="flex flex-col gap-6 lg:sticky lg:top-4 lg:self-start">
				<div className="panel overflow-hidden">
					<SceneArt scene={{ ...info.scene, title: infoName }} showCaption={false} />
					<div className="p-4">
						<div className="heading text-lg">{infoName}</div>
						<p className="mt-1 font-serif text-[15px] leading-snug text-text/90">{te("presetBlurb", info.id)}</p>
					</div>
				</div>

				<Section title={t("world.tone")} hint={t("world.toneHint")}>
					<div className="flex flex-wrap gap-2">
						{TONES.map((tone) => (
							<ChipToggle key={tone} active={w.tone.includes(tone)} onClick={() => toggleTone(tone)}>
								{te("tone", tone)}
							</ChipToggle>
						))}
					</div>
				</Section>

				<Section title={t("world.safety")} hint={t("world.safetyHint")}>
					<ListEditor
						icon={<Ban className="size-3.5 text-crimson-2" />}
						label={t("world.lines")}
						values={w.lines}
						suggestions={LINE_SUGGESTIONS[lang]}
						onChange={(lines) => set({ lines })}
					/>
					<ListEditor icon={<EyeOff className="size-3.5 text-sky" />} label={t("world.veils")} values={w.veils} suggestions={VEIL_SUGGESTIONS[lang]} onChange={(veils) => set({ veils })} />
				</Section>
			</aside>
		</div>
	);
}

function ListEditor({ label, icon, values, suggestions, onChange }: { label: string; icon: React.ReactNode; values: string[]; suggestions: string[]; onChange: (v: string[]) => void }) {
	const [text, setText] = useState("");
	const { t } = useT();
	const add = (v: string) => {
		const t = v.trim();
		if (t && !values.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...values, t]);
	};
	const remaining = suggestions.filter((s) => !values.includes(s));
	return (
		<div className="rounded-lg border border-line bg-bg-2/60 p-3">
			<FieldLabel>
				<span className="inline-flex items-center gap-1.5">
					{icon}
					{label}
				</span>
			</FieldLabel>
			{values.length > 0 && (
				<ul className="mb-2 flex flex-wrap gap-1.5">
					{values.map((v) => (
						<li key={v} className="chip border-gold/40 py-0.5 pr-1 text-xs">
							{v}
							<button type="button" className="rounded p-0.5 text-dim hover:text-crimson-2" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={t("world.remove", { v })}>
								<X className="size-3" />
							</button>
						</li>
					))}
				</ul>
			)}
			<form
				className="flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					add(text);
					setText("");
				}}
			>
				<input className="input py-1.5 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("world.addOwn")} aria-label={t("world.addTo", { label })} />
				<button type="submit" className="btn px-2.5 py-1.5" aria-label={t("world.add")} disabled={!text.trim()}>
					<Plus className="size-4" />
				</button>
			</form>
			{remaining.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1">
					{remaining.map((s) => (
						<button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-dim transition-colors hover:border-gold/60 hover:text-text">
							+ {s}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
