"use client";

import { rulesetOf } from "@/lib/rules/ruleset";
import { rsKey } from "./i18n";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, ChevronLeft, ChevronRight, Globe2, Home, RotateCcw, Settings, Sparkles, UserRound, Wand2, ScrollText } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Divider } from "@/components/ui/Divider";
import { cn } from "@/components/ui/cn";
import { WorldStep } from "./WorldStep";
import { StructureStep } from "./StructureStep";
import { CharacterStep } from "./CharacterStep";
import { DmStep } from "./DmStep";
import { ReviewStep } from "./ReviewStep";
import { useEngines } from "./EnginePicker";
import type { DraftUpdater } from "./types";
import { DEFAULT_ENGINE_KEY, DRAFT_KEY, defaultDraft, loadDraft, loadJson, removeKey, saveJson, type WizardDraft } from "./wizardState";
import type { EngineConfig } from "@/lib/game/types";
import { useT } from "@/components/i18n/I18nProvider";
import { LanguageSwitch } from "@/components/i18n/LanguageSwitch";

// Labels: setup.step.<id>.title / .short / .blurb
const STEPS = [
	{ id: "world", icon: Globe2 },
	{ id: "campaign", icon: BookOpen },
	{ id: "character", icon: UserRound },
	{ id: "dm", icon: Wand2 },
	{ id: "review", icon: ScrollText },
] as const;
type StepId = (typeof STEPS)[number]["id"];
const stepKey = <F extends "title" | "short" | "blurb">(id: StepId, f: F) => `setup.step.${id}.${f}` as const;

export function SetupWizard() {
	const [draft, setDraft] = useState<WizardDraft | null>(null);
	const [confirmReset, setConfirmReset] = useState(false);
	const engines = useEngines();
	const { t, setRuleset } = useT();
	const rs = rulesetOf(draft?.settings);
	useEffect(() => {
		setRuleset(rs);
		return () => setRuleset("fantasy");
	}, [rs, setRuleset]);

	useEffect(() => {
		// localStorage is only readable after hydration.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setDraft(loadDraft());
	}, []);

	useEffect(() => {
		if (draft) saveJson(DRAFT_KEY, draft);
	}, [draft]);

	const update: DraftUpdater = useCallback((fn) => setDraft((d) => (d ? fn(d) : d)), []);
	const goTo = useCallback(
		(step: number) => {
			update((d) => ({ ...d, step: Math.max(0, Math.min(STEPS.length - 1, step)) }));
			window.scrollTo({ top: 0, behavior: "smooth" });
		},
		[update],
	);

	if (!draft) {
		return (
			<div className="grid min-h-[60vh] place-items-center">
				<div className="flex flex-col items-center gap-3 text-dim">
					<Sparkles className="size-6 animate-pulse text-gold" />
					<span className="font-fell italic">{t("setup.loading")}</span>
				</div>
			</div>
		);
	}

	const step = draft.step;
	const info = STEPS[step];
	const last = step === STEPS.length - 1;

	return (
		<div className="mx-auto flex w-full max-w-[1400px] flex-col px-6 pb-28">
			<header className="flex flex-wrap items-center justify-between gap-2 py-5">
				<Link href="/" className="group flex items-center gap-2 font-display text-lg tracking-wider text-gold-2">
					<Home className="size-4 text-gold/70 group-hover:text-gold-2" /> DungeonHarness
				</Link>
				<div className="flex items-center gap-2">
					<LanguageSwitch className="mr-1" />
					<button type="button" className="btn py-1.5 text-sm" onClick={() => setConfirmReset(true)}>
						<RotateCcw className="size-4" /> <span className="hidden sm:inline">{t("setup.startOver")}</span>
					</button>
					<Link href="/settings" className="btn py-1.5 text-sm">
						<Settings className="size-4" /> <span className="hidden sm:inline">{t("home.settings")}</span>
					</Link>
				</div>
			</header>

			<Stepper step={step} onPick={goTo} />

			<div className="mt-8 mb-6 flex flex-wrap items-end justify-between gap-4">
				<div>
					<div className="font-fell text-sm text-gold/80 italic">
						{t("setup.stepOf", { n: step + 1, total: STEPS.length })}
					</div>
					<h1 className="heading text-3xl">{t(stepKey(info.id, "title"))}</h1>
					<p className="mt-1 font-serif text-lg text-dim">{t(rs !== "fantasy" && info.id === "character" ? rsKey(rs, "char.blurb") : stepKey(info.id, "blurb"))}</p>
				</div>
				{step < 3 && (
					<button type="button" className="btn text-sm" onClick={() => goTo(STEPS.length - 1)} title={t("setup.skipTitle")}>
						<Sparkles className="size-4 text-gold" /> {t("setup.skip")}
					</button>
				)}
			</div>
			<Divider className="mb-8" />

			<main key={step} className="dh-step-in">
				{step === 0 && <WorldStep draft={draft} update={update} />}
				{step === 1 && <StructureStep draft={draft} update={update} />}
				{step === 2 && <CharacterStep draft={draft} update={update} />}
				{step === 3 && <DmStep draft={draft} update={update} engines={engines} />}
				{step === 4 && <ReviewStep draft={draft} update={update} goTo={goTo} engines={engines} />}
			</main>

			<nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-[#120f0c]/90 backdrop-blur-md" aria-label={t("setup.navAria")}>
				<div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-6 py-3">
					<button type="button" className="btn" onClick={() => goTo(step - 1)} disabled={step === 0}>
						<ChevronLeft className="size-4" /> {t("common.back")}
					</button>
					<div className="hidden text-xs text-faint sm:block">{t("setup.autosave")}</div>
					{!last ? (
						<button type="button" className="btn btn-gold" onClick={() => goTo(step + 1)}>
							{t(stepKey(STEPS[step + 1].id, "short"))} <ChevronRight className="size-4" />
						</button>
					) : (
						<span className="text-sm text-dim">{t("setup.ready")}</span>
					)}
				</div>
			</nav>

			<Modal
				open={confirmReset}
				onClose={() => setConfirmReset(false)}
				title={t("setup.reset.title")}
				footer={
					<>
						<button type="button" className="btn" onClick={() => setConfirmReset(false)}>
							{t("common.cancel")}
						</button>
						<button
							type="button"
							className="btn btn-danger"
							onClick={() => {
								removeKey(DRAFT_KEY);
								setDraft(defaultDraft(loadJson<EngineConfig>(DEFAULT_ENGINE_KEY) ?? undefined));
								setConfirmReset(false);
							}}
						>
							<RotateCcw className="size-4" /> {t("setup.reset.confirm")}
						</button>
					</>
				}
			>
				<p className="text-dim">{t("setup.reset.body")}</p>
			</Modal>

			<style>{`
				.dh-step-in { animation: dh-step-in 260ms ease-out both; }
				@keyframes dh-step-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
				@media (prefers-reduced-motion: reduce) { .dh-step-in { animation: none; } }
			`}</style>
		</div>
	);
}

function Stepper({ step, onPick }: { step: number; onPick: (i: number) => void }) {
	const { t } = useT();
	return (
		<ol className="flex items-center gap-1" aria-label={t("setup.progressAria")}>
			{STEPS.map((s, i) => {
				const done = i < step;
				const active = i === step;
				return (
					<li key={s.id} className="flex flex-1 items-center gap-1 last:flex-none">
						<button
							type="button"
							onClick={() => onPick(i)}
							title={t(stepKey(s.id, "title"))}
							aria-current={active ? "step" : undefined}
							className={cn("group flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 transition-colors focus-visible:outline-2 focus-visible:outline-gold", active ? "bg-gold/10" : "hover:bg-panel-2")}
						>
							<span
								className={cn(
									"grid size-9 place-items-center rounded-full border-2 transition-colors",
									active ? "border-gold bg-gold text-[#2a1d0b] shadow-[0_0_16px_rgb(212_166_74/0.45)]" : done ? "border-gold/70 bg-gold/15 text-gold-2" : "border-line bg-panel text-faint group-hover:border-gold/40",
								)}
							>
								{done ? <Check className="size-4" /> : <s.icon className="size-4" />}
							</span>
							<span className={cn("hidden truncate font-display text-sm tracking-wide md:inline", active ? "text-gold-2" : done ? "text-text" : "text-faint")}>{t(stepKey(s.id, "short"))}</span>
						</button>
						{i < STEPS.length - 1 && <span className={cn("mx-1 h-px flex-1", i < step ? "bg-gold/60" : "bg-line")} />}
					</li>
				);
			})}
		</ol>
	);
}
