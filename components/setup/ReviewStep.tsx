"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, Sparkles, LoaderCircle, Swords } from "lucide-react";
import type { GameState } from "@/lib/game/types";
import { SceneArt } from "@/components/art/SceneArt";
import { Divider } from "@/components/ui/Divider";
import { DIFFICULTY_INFO, FORMAT_INFO, presetInfo } from "./presets";
import { SheetPreview, usePreview } from "./SheetPreview";
import { modelKey, type useEngines } from "./EnginePicker";
import { randomName } from "./names";
import type { StepProps } from "./types";
import { buildNewGameInput, DRAFT_KEY, openChoices, optionsFor, removeKey } from "./wizardState";

export function ReviewStep({ draft, update, goTo, engines }: StepProps & { goTo: (step: number) => void; engines: ReturnType<typeof useEngines> }) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const c = draft.character;
	const s = draft.settings;
	const level = s.structure.startingLevel;
	const { opts } = useMemo(() => optionsFor(c), [c]);
	const preview = usePreview(c, level, opts);
	const open = openChoices(c, opts);
	const model = engines.data?.models.find((m) => modelKey(m) === modelKey(s.engine));
	const preset = presetInfo(s.world.preset);

	const begin = async () => {
		setBusy(true);
		setError(null);
		try {
			let d = draft;
			if (!c.name.trim()) {
				d = { ...draft, character: { ...c, name: randomName(c.speciesId) } };
				update(() => d);
			}
			const body = buildNewGameInput(d, opts);
			if (!body) throw new Error("Roll your ability scores first (Character → Abilities).");
			const res = await fetch("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
			const json = (await res.json().catch(() => ({}))) as { state?: GameState; error?: string };
			if (!res.ok || !json.state) throw new Error(json.error ?? `HTTP ${res.status}`);
			removeKey(DRAFT_KEY);
			router.push(`/play/${json.state.id}?opening=1`);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setBusy(false);
		}
	};

	const canBegin = !preview.error && !busy;

	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
			<div className="flex flex-col gap-6">
				<div className="panel overflow-hidden">
					<SceneArt scene={{ ...preset.scene, title: draft.title.trim() || `${c.name.trim() || "Your hero"}'s Tale`, caption: s.structure.hook?.trim() || preset.blurb }} />
				</div>

				<div className="grid gap-4 md:grid-cols-2">
					<Card title="World & tone" onEdit={() => goTo(0)}>
						<Row k="Setting" v={preset.name} />
						{s.world.customText?.trim() && <p className="font-serif text-sm text-text/80 italic">“{s.world.customText.trim()}”</p>}
						<Row k="Tone" v={s.world.tone.length ? s.world.tone.join(", ") : "DM's call"} />
						<Row k="Lines" v={s.world.lines.length ? s.world.lines.join(", ") : "none"} />
						<Row k="Veils" v={s.world.veils.length ? s.world.veils.join(", ") : "none"} />
					</Card>
					<Card title="Campaign" onEdit={() => goTo(1)}>
						<Row k="Title" v={draft.title.trim() || "(named after your hero)"} />
						<Row k="Format" v={FORMAT_INFO[s.structure.format].name} />
						<Row k="Starting level" v={String(level)} />
						<Row k="Difficulty" v={<span title={DIFFICULTY_INFO[s.structure.difficulty]} className="capitalize">{s.structure.difficulty}</span>} />
						<Row k="Leveling" v={s.structure.leveling === "xp" ? "Experience points" : "Milestone"} />
						<Row k="Hook" v={s.structure.hook?.trim() ? "Set" : "DM improvises"} />
					</Card>
					<Card title="Dungeon Master" onEdit={() => goTo(3)}>
						<Row k="Narration" v={<span className="capitalize">{s.dm.verbosity}</span>} />
						<Row k="Rules" v={<span className="capitalize">{s.dm.rulesStrictness}</span>} />
						<Row k="Combat" v={<span className="capitalize">{s.dm.combatFrequency}</span>} />
						<Row k="Dice" v={s.dm.autoRollPlayer ? "Rolled for me" : "I roll"} />
						<Row k="Persona" v={s.dm.persona?.trim() ? `${s.dm.persona.trim().slice(0, 60)}${s.dm.persona.trim().length > 60 ? "…" : ""}` : "Default"} />
						<Row k="Audio" v={s.audio.enabled ? `On (music ${Math.round(s.audio.musicVolume * 100)}%)` : "Off"} />
					</Card>
					<Card title="Engine" onEdit={() => goTo(3)}>
						<Row k="Model" v={model?.label ?? s.engine.model} />
						<Row k="Effort" v={s.engine.effort} />
						{model && !model.available && (
							<p className="flex items-start gap-1.5 text-xs text-gold">
								<AlertTriangle className="mt-0.5 size-3 shrink-0" /> {model.reason ?? "This model is unavailable."} You can still begin and switch engines in-game.
							</p>
						)}
					</Card>
				</div>

				{open.length > 0 && (
					<div className="flex items-start gap-2 rounded-lg border border-dashed border-gold/40 bg-gold/5 p-3 text-sm text-dim">
						<Sparkles className="mt-0.5 size-4 shrink-0 text-gold" />
						<span>
							The DM will choose for you: <span className="text-text">{open.join(", ")}</span>.{" "}
							<button type="button" className="text-gold-2 underline underline-offset-2" onClick={() => goTo(2)}>
								Choose yourself
							</button>
						</span>
					</div>
				)}
			</div>

			<aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
				<SheetPreview preview={preview} draft={c} compact />
				<button type="button" className="text-left text-xs text-dim hover:text-gold-2" onClick={() => goTo(2)}>
					<Pencil className="mr-1 inline size-3" /> Edit character
				</button>
				<Divider />
				<button type="button" onClick={() => void begin()} disabled={!canBegin} className="btn btn-gold justify-center py-3 text-lg shadow-[0_0_30px_rgb(212_166_74/0.25)]">
					{busy ? <LoaderCircle className="size-5 animate-spin" /> : <Swords className="size-5" />}
					{busy ? "Forging your world…" : "Begin Adventure"}
				</button>
				{error && (
					<p className="flex items-start gap-1.5 text-sm text-crimson-2" role="alert">
						<AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
					</p>
				)}
				{preview.error && <p className="text-xs text-crimson-2">Fix the character first: {preview.error}</p>}
			</aside>
		</div>
	);
}

function Card({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
	return (
		<div className="panel flex flex-col gap-1.5 p-4">
			<div className="mb-1 flex items-center justify-between">
				<h3 className="heading text-sm">{title}</h3>
				<button type="button" className="rounded p-1 text-faint hover:text-gold-2" onClick={onEdit} aria-label={`Edit ${title}`}>
					<Pencil className="size-3.5" />
				</button>
			</div>
			{children}
		</div>
	);
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
	return (
		<div className="flex justify-between gap-3 text-sm">
			<span className="shrink-0 text-dim">{k}</span>
			<span className="truncate text-right text-text">{v}</span>
		</div>
	);
}
