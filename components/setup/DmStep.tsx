"use client";

import { useEffect, useRef } from "react";
import { Volume2 } from "lucide-react";
import { Segmented } from "@/components/ui/Tabs";
import { Slider } from "@/components/ui/Slider";
import { Toggle } from "@/components/ui/Toggle";
import { ChipToggle, FieldLabel, Section } from "./Field";
import { EnginePicker, resolveEngine, type useEngines } from "./EnginePicker";
import { PERSONAS } from "./presets";
import { patchSettings, type StepProps } from "./types";
import { useT } from "@/components/i18n/I18nProvider";
import { LANGS, type Lang } from "@/lib/i18n";

export function DmStep({ draft, update, engines }: StepProps & { engines: ReturnType<typeof useEngines> }) {
	const dm = draft.settings.dm;
	const audio = draft.settings.audio;
	const { t, te, lang } = useT();
	const setLanguage = (language: Lang) => update((d) => ({ ...d, settings: { ...d.settings, language } }));
	const setDm = (p: Partial<typeof dm>) => patchSettings(update, "dm", p);
	const setAudio = (p: Partial<typeof audio>) => patchSettings(update, "audio", p);

	// Once the catalog loads, fall back to an available model if the saved one isn't.
	const resolved = useRef(false);
	useEffect(() => {
		if (!engines.data || resolved.current) return;
		resolved.current = true;
		update((d) => ({ ...d, settings: { ...d.settings, engine: resolveEngine(engines.data!.models, d.settings.engine) } }));
	}, [engines.data, update]);

	return (
		<div className="flex flex-col gap-10">
			<div className="grid gap-8 lg:grid-cols-2">
				<div className="flex flex-col gap-6">
					<Section title={t("dm.language")} hint={t("dm.languageHint")}>
							<Segmented<Lang> label={t("dm.language")} value={draft.settings.language ?? lang} onChange={setLanguage} options={LANGS.map((l) => ({ value: l.id, label: l.label }))} />
						</Section>
						<Section title={t("dm.narration")} hint={t("dm.narrationHint")}>
						<Segmented
							label={t("dm.verbosityAria")}
							value={dm.verbosity}
							onChange={(verbosity) => setDm({ verbosity })}
							options={[
								{ value: "terse", label: te("verbosity", "terse") },
								{ value: "balanced", label: te("verbosity", "balanced") },
								{ value: "rich", label: te("verbosity", "rich") },
							]}
						/>
					</Section>
					<Section title={t("dm.rules")} hint={t("dm.rulesHint")}>
						<Segmented
							label={t("dm.rulesAria")}
							value={dm.rulesStrictness}
							onChange={(rulesStrictness) => setDm({ rulesStrictness })}
							options={[
								{ value: "loose", label: te("strictness", "loose") },
								{ value: "standard", label: te("strictness", "standard") },
								{ value: "strict", label: te("strictness", "strict") },
							]}
						/>
					</Section>
					<Section title={t("dm.combat")}>
						<Segmented
							label={t("dm.combat")}
							value={dm.combatFrequency}
							onChange={(combatFrequency) => setDm({ combatFrequency })}
							options={[
								{ value: "low", label: te("frequency", "low") },
								{ value: "medium", label: te("frequency", "medium") },
								{ value: "high", label: te("frequency", "high") },
							]}
						/>
					</Section>
					<Toggle checked={dm.autoRollPlayer} onChange={(autoRollPlayer) => setDm({ autoRollPlayer })} label={t("dm.autoRoll")} description={t("dm.autoRollDesc")} />
				</div>

				<Section title={t("dm.persona")} hint={t("dm.personaHint")}>
					<div className="flex flex-wrap gap-2">
						{PERSONAS.map((p) => {
								// Match either language so a persona picked before switching stays highlighted.
								const active = !!dm.persona && Object.values(p.text).includes(dm.persona);
								return (
									<ChipToggle key={p.id} active={active} onClick={() => setDm({ persona: active ? "" : p.text[lang] })}>
										{p.label[lang]}
									</ChipToggle>
								);
							})}
					</div>
					<textarea className="input min-h-28 resize-y font-serif text-base" value={dm.persona ?? ""} onChange={(e) => setDm({ persona: e.target.value })} placeholder={t("dm.personaPh")} aria-label={t("dm.persona")} />

					<div className="mt-4 rounded-lg border border-line bg-bg-2/50 p-4">
						<Toggle
							checked={audio.enabled}
							onChange={(enabled) => setAudio({ enabled })}
							label={
								<span className="inline-flex items-center gap-1.5">
									<Volume2 className="size-4 text-gold/80" /> {t("dm.audio")}
								</span>
							}
							description={t("dm.audioDesc")}
						/>
						<div className="mt-4 grid gap-4 sm:grid-cols-2">
							<Slider label={t("dm.music")} disabled={!audio.enabled} min={0} max={1} step={0.05} value={audio.musicVolume} onChange={(musicVolume) => setAudio({ musicVolume })} format={(v) => `${Math.round(v * 100)}%`} />
							<Slider label={t("dm.effects")} disabled={!audio.enabled} min={0} max={1} step={0.05} value={audio.sfxVolume} onChange={(sfxVolume) => setAudio({ sfxVolume })} format={(v) => `${Math.round(v * 100)}%`} />
						</div>
					</div>
				</Section>
			</div>

			<Section title={t("dm.engine")} hint={t("dm.engineHint")}>
				<FieldLabel>{t("dm.provider")}</FieldLabel>
				<EnginePicker value={draft.settings.engine} onChange={(engine) => update((d) => ({ ...d, settings: { ...d.settings, engine } }))} engines={engines} />
			</Section>
		</div>
	);
}
