"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil, Sparkles, LoaderCircle, Swords } from "lucide-react";
import type { GameState } from "@/lib/game/types";
import { SceneArt } from "@/components/art/SceneArt";
import { Divider } from "@/components/ui/Divider";
import { presetInfo } from "./presets";
import { choiceLabel, srdName } from "./i18n";
import { getBackground, getClass } from "@/lib/srd";
import { LANGS } from "@/lib/i18n";
import { SheetPreview, usePreview } from "./SheetPreview";
import { modelKey, type useEngines } from "./EnginePicker";
import { randomName } from "./names";
import type { StepProps } from "./types";
import { useT } from "@/components/i18n/I18nProvider";
import { buildNewGameInput, DRAFT_KEY, openChoices, optionsFor, removeKey } from "./wizardState";

export function ReviewStep({ draft, update, goTo, engines }: StepProps & { goTo: (step: number) => void; engines: ReturnType<typeof useEngines> }) {
	const { lang, t, te } = useT();
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
	const cls = getClass(c.classId);
	const bg = getBackground(c.backgroundId);
	const names = { cls: cls ? srdName(lang, "class", cls.index, cls.name) : undefined, bg: bg ? srdName(lang, "background", bg.index, bg.name) : undefined };
	const openLabels = open.map((ch) => choiceLabel(ch, t, names)).join(", ");

	const begin = async () => {
		setBusy(true);
		setError(null);
		try {
			let d = draft;
			if (!c.name.trim()) {
				d = { ...draft, character: { ...c, name: randomName(c.speciesId) } };
				update(() => d);
			}
			// Name the campaign client-side so the default title is in the UI language.
			if (!d.title.trim()) d = { ...d, title: t("review.taleOf", { name: d.character.name.trim() }) };
			const built = buildNewGameInput(d, opts);
			if (!built) throw new Error(t("review.rollFirst"));
			// Narration language defaults to the UI language.
			const body = { ...built, settings: { ...built.settings, language: d.settings.language ?? lang } };
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
					<SceneArt scene={{ ...preset.scene, title: draft.title.trim() || t("review.taleOf", { name: c.name.trim() || t("review.yourHero") }), caption: s.structure.hook?.trim() || te("presetBlurb", preset.id) }} />
				</div>

				<div className="grid gap-4 md:grid-cols-2">
					<Card title={t("setup.step.world.title")} onEdit={() => goTo(0)}>
						<Row k={t("review.setting")} v={te("preset", preset.id)} />
						{s.world.customText?.trim() && <p className="font-serif text-sm text-text/80 italic">“{s.world.customText.trim()}”</p>}
						<Row k={t("review.tone")} v={s.world.tone.length ? s.world.tone.map((x) => te("tone", x)).join(", ") : t("review.dmCall")} />
						<Row k={t("review.lines")} v={s.world.lines.length ? s.world.lines.join(", ") : t("review.none")} />
						<Row k={t("review.veils")} v={s.world.veils.length ? s.world.veils.join(", ") : t("review.none")} />
					</Card>
					<Card title={t("setup.step.campaign.title")} onEdit={() => goTo(1)}>
						<Row k={t("review.title")} v={draft.title.trim() || t("review.namedAfter")} />
						<Row k={t("review.format")} v={te("format", s.structure.format)} />
						<Row k={t("structure.level")} v={String(level)} />
						<Row k={t("structure.difficulty")} v={<span title={te("difficultyInfo", s.structure.difficulty)}>{te("difficulty", s.structure.difficulty)}</span>} />
						<Row k={t("structure.leveling")} v={te("leveling", s.structure.leveling)} />
						<Row k={t("review.hook")} v={s.structure.hook?.trim() ? t("review.hookSet") : t("review.hookImprov")} />
					</Card>
					<Card title={t("setup.step.dm.title")} onEdit={() => goTo(3)}>
						<Row k={t("review.language")} v={LANGS.find((l) => l.id === (s.language ?? lang))?.label} />
						<Row k={t("dm.narration")} v={te("verbosity", s.dm.verbosity)} />
						<Row k={t("dm.rules")} v={te("strictness", s.dm.rulesStrictness)} />
						<Row k={t("review.combat")} v={te("frequency", s.dm.combatFrequency)} />
						<Row k={t("review.dice")} v={s.dm.autoRollPlayer ? t("review.diceAuto") : t("review.diceManual")} />
						<Row k={t("review.persona")} v={s.dm.persona?.trim() ? `${s.dm.persona.trim().slice(0, 60)}${s.dm.persona.trim().length > 60 ? "…" : ""}` : t("review.default")} />
						<Row k={t("review.audio")} v={s.audio.enabled ? t("review.audioOn", { n: Math.round(s.audio.musicVolume * 100) }) : t("review.off")} />
					</Card>
					<Card title={t("dm.engine")} onEdit={() => goTo(3)}>
						<Row k={t("review.model")} v={model?.label ?? s.engine.model} />
						<Row k={t("review.effort")} v={te("effort", s.engine.effort)} />
						{model && !model.available && (
							<p className="flex items-start gap-1.5 text-xs text-gold">
								<AlertTriangle className="mt-0.5 size-3 shrink-0" /> {model.reason ?? t("review.modelUnavailable")} {t("review.switchLater")}
							</p>
						)}
					</Card>
				</div>

				{open.length > 0 && (
					<div className="flex items-start gap-2 rounded-lg border border-dashed border-gold/40 bg-gold/5 p-3 text-sm text-dim">
						<Sparkles className="mt-0.5 size-4 shrink-0 text-gold" />
						<span>
							{t("review.dmWillChoose")} <span className="text-text">{openLabels}</span>.{" "}
							<button type="button" className="text-gold-2 underline underline-offset-2" onClick={() => goTo(2)}>
								{t("review.chooseYourself")}
							</button>
						</span>
					</div>
				)}
			</div>

			<aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
				<SheetPreview preview={preview} draft={c} compact />
				<button type="button" className="text-left text-xs text-dim hover:text-gold-2" onClick={() => goTo(2)}>
					<Pencil className="mr-1 inline size-3" /> {t("review.editCharacter")}
				</button>
				<Divider />
				<button type="button" onClick={() => void begin()} disabled={!canBegin} className="btn btn-gold justify-center py-3 text-lg shadow-[0_0_30px_rgb(212_166_74/0.25)]">
					{busy ? <LoaderCircle className="size-5 animate-spin" /> : <Swords className="size-5" />}
					{busy ? t("review.forging") : t("review.begin")}
				</button>
				{error && (
					<p className="flex items-start gap-1.5 text-sm text-crimson-2" role="alert">
						<AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
					</p>
				)}
				{preview.error && <p className="text-xs text-crimson-2">{t("review.fixFirst", { error: preview.error })}</p>}
			</aside>
		</div>
	);
}

function Card({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
	const { t } = useT();
	return (
		<div className="panel flex flex-col gap-1.5 p-4">
			<div className="mb-1 flex items-center justify-between">
				<h3 className="heading text-sm">{title}</h3>
				<button type="button" className="rounded p-1 text-faint hover:text-gold-2" onClick={onEdit} aria-label={t("review.editAria", { title })}>
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
