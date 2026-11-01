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

export function DmStep({ draft, update, engines }: StepProps & { engines: ReturnType<typeof useEngines> }) {
	const dm = draft.settings.dm;
	const audio = draft.settings.audio;
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
					<Section title="Narration" hint="How much prose per turn.">
						<Segmented
							label="Verbosity"
							value={dm.verbosity}
							onChange={(verbosity) => setDm({ verbosity })}
							options={[
								{ value: "terse", label: "Terse" },
								{ value: "balanced", label: "Balanced" },
								{ value: "rich", label: "Rich & descriptive" },
							]}
						/>
					</Section>
					<Section title="Rules" hint="Loose favors the story; strict follows the book to the letter.">
						<Segmented
							label="Rules strictness"
							value={dm.rulesStrictness}
							onChange={(rulesStrictness) => setDm({ rulesStrictness })}
							options={[
								{ value: "loose", label: "Rule of cool" },
								{ value: "standard", label: "Standard" },
								{ value: "strict", label: "By the book" },
							]}
						/>
					</Section>
					<Section title="Combat frequency">
						<Segmented
							label="Combat frequency"
							value={dm.combatFrequency}
							onChange={(combatFrequency) => setDm({ combatFrequency })}
							options={[
								{ value: "low", label: "Rare" },
								{ value: "medium", label: "Balanced" },
								{ value: "high", label: "Frequent" },
							]}
						/>
					</Section>
					<Toggle checked={dm.autoRollPlayer} onChange={(autoRollPlayer) => setDm({ autoRollPlayer })} label="Roll my dice automatically" description="Off: the DM asks and you click to roll checks and saves yourself." />
				</div>

				<Section title="DM persona" hint="Optional. Who is telling this story?">
					<div className="flex flex-wrap gap-2">
						{PERSONAS.map((p) => (
							<ChipToggle key={p.label} active={dm.persona === p.text} onClick={() => setDm({ persona: dm.persona === p.text ? "" : p.text })}>
								{p.label}
							</ChipToggle>
						))}
					</div>
					<textarea className="input min-h-28 resize-y font-serif text-base" value={dm.persona ?? ""} onChange={(e) => setDm({ persona: e.target.value })} placeholder="Describe your DM's voice, or leave blank for the default." aria-label="DM persona" />

					<div className="mt-4 rounded-lg border border-line bg-bg-2/50 p-4">
						<Toggle
							checked={audio.enabled}
							onChange={(enabled) => setAudio({ enabled })}
							label={
								<span className="inline-flex items-center gap-1.5">
									<Volume2 className="size-4 text-gold/80" /> Ambience & sound effects
								</span>
							}
							description="Music and SFX chosen by the DM to match the scene."
						/>
						<div className="mt-4 grid gap-4 sm:grid-cols-2">
							<Slider label="Music" disabled={!audio.enabled} min={0} max={1} step={0.05} value={audio.musicVolume} onChange={(musicVolume) => setAudio({ musicVolume })} format={(v) => `${Math.round(v * 100)}%`} />
							<Slider label="Effects" disabled={!audio.enabled} min={0} max={1} step={0.05} value={audio.sfxVolume} onChange={(sfxVolume) => setAudio({ sfxVolume })} format={(v) => `${Math.round(v * 100)}%`} />
						</div>
					</div>
				</Section>
			</div>

			<Section title="Engine" hint="Which AI runs your Dungeon Master. You can switch any time mid-game.">
				<FieldLabel>Provider</FieldLabel>
				<EnginePicker value={draft.settings.engine} onChange={(engine) => update((d) => ({ ...d, settings: { ...d.settings, engine } }))} engines={engines} />
			</Section>
		</div>
	);
}
