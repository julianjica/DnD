"use client";

import { rulesetOf } from "@/lib/rules/ruleset";
import { displayTitle } from "@/lib/i18n";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Home, Save, Settings2, Sun, Moon, Sunrise, Sunset, AlertTriangle, X } from "lucide-react";
import type { GameState } from "@/lib/game/types";
import DiceTray from "@/components/dice/DiceTray";
import AmbiencePlayer, { playSfx, type SfxName } from "@/components/audio/AmbiencePlayer";
import { useGame } from "./useGame";
import { Narration } from "./Narration";
import { Sidebar } from "./Sidebar";
import { Stage } from "./Stage";
import { SavesDialog } from "./SavesDialog";
import { SettingsDrawer } from "./SettingsDrawer";
import { LevelUpDialog } from "./LevelUpDialog";
import { PortraitDialog } from "./PortraitDialog";
import { useT } from "@/components/i18n/I18nProvider";
import { useEngineText } from "@/components/i18n/useEngineText";
import { LanguageSwitch } from "@/components/i18n/LanguageSwitch";
import { SurvivalStrip } from "./Survival";
import { GroupCount } from "./Group";

const TIME_ICON = { dawn: Sunrise, day: Sun, dusk: Sunset, night: Moon };

function clockTime(state: GameState) {
	const t = state.time;
	return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

/** Suspense fallback for the play route. */
export function PlayLoading() {
	const { t } = useT();
	return <div className="grid h-screen place-items-center text-dim">{t("common.loading")}</div>;
}

export function PlayScreen({ id, opening }: { id: string; opening: boolean }) {
	const game = useGame(id);
	const { t, te, lang, setRuleset } = useT();
	const { le } = useEngineText();
	const { state } = game;
	const rs = rulesetOf(state?.settings);
	useEffect(() => {
		setRuleset(rs);
		return () => setRuleset("fantasy");
	}, [rs, setRuleset]);
	const [dialog, setDialog] = useState<"saves" | "settings" | "levelup" | "portrait" | null>(null);
	const openedRef = useRef(false);
	const lastFx = useRef<string | null>(null);

	// Opening narration for a fresh campaign.
	useEffect(() => {
		if (!opening || openedRef.current || !game.loaded || !state) return;
		openedRef.current = true;
		if (game.log.length === 0) void game.send("");
	}, [opening, game, state]);

	// Sound effects from the engine.
	useEffect(() => {
		const latest = game.fx[game.fx.length - 1];
		if (!latest || latest.id === lastFx.current) return;
		const start = lastFx.current ? game.fx.findIndex((f) => f.id === lastFx.current) + 1 : game.fx.length - 1;
		lastFx.current = latest.id;
		if (!state?.settings.audio.enabled) return;
		for (const f of game.fx.slice(Math.max(0, start))) {
			if (f.kind === "sfx" && f.sound) playSfx(f.sound as SfxName);
			else if (f.kind === "damage") playSfx("hit");
			else if (f.kind === "level_up") playSfx("levelup");
		}
	}, [game.fx, state?.settings.audio.enabled]);

	if (!game.loaded) return <div className="grid h-screen place-items-center font-fell text-lg italic text-dim">{t("play.loading")}</div>;
	if (!state)
		return (
			<div className="grid h-screen place-items-center">
				<div className="panel p-6 text-center">
					<p className="mb-3 text-crimson-2">{game.error ? le(game.error) : t("play.notFound")}</p>
					<Link href="/" className="btn">{t("play.backHome")}</Link>
				</div>
			</div>
		);

	const TimeIcon = TIME_ICON[state.scene.timeOfDay] ?? Sun;
	const enc = state.encounter?.status === "active" ? state.encounter : undefined;
	const enemyTurnStalled = !!enc && !game.busy && enc.order[enc.turnIndex] !== state.character.id;

	return (
		<div className="flex h-screen flex-col overflow-hidden">
			{/* Top bar */}
			<header className="relative z-40 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg-2/80 px-3 backdrop-blur">
				<Link href="/" className="text-faint hover:text-gold" title={t("play.home")} aria-label={t("play.home")}>
					<Home size={18} />
				</Link>
				<div className="min-w-0">
					<h1 className="heading truncate text-sm leading-tight">{displayTitle(lang, state.title)}</h1>
					<div className="truncate text-[11px] text-dim">{state.scene.title}</div>
				</div>
				<div className="ml-4 hidden items-center gap-1.5 text-xs text-dim md:flex" title={te("time", state.scene.timeOfDay)}>
					<TimeIcon size={14} className="text-gold" /> {t("play.clock", { day: state.time.day, time: clockTime(state) })}
				</div>
				{rs === "zombie" && (
					<SurvivalStrip state={state}>
						<GroupCount state={state} />
					</SurvivalStrip>
				)}
				<div className="ml-auto flex items-center gap-2">
					<span className="hidden text-[11px] text-faint lg:inline">
						{state.settings.engine.provider} · {state.settings.engine.model} · {state.settings.engine.effort}
					</span>
					<LanguageSwitch />
					<AmbiencePlayer
						track={state.settings.audio.enabled ? state.ambience : "none"}
						musicVolume={state.settings.audio.musicVolume}
						sfxVolume={state.settings.audio.sfxVolume}
						onMusicVolumeChange={(v) => void game.patchSettings({ audio: { ...state.settings.audio, musicVolume: v } })}
						onSfxVolumeChange={(v) => void game.patchSettings({ audio: { ...state.settings.audio, sfxVolume: v } })}
						compact
					/>
					<button className="btn px-2 py-1.5" onClick={() => setDialog("saves")} title={t("play.saveLoad")} aria-label={t("play.saveLoad")}>
						<Save size={16} />
					</button>
					<button className="btn px-2 py-1.5" onClick={() => setDialog("settings")} title={t("play.settings")} aria-label={t("play.settings")}>
						<Settings2 size={16} />
					</button>
				</div>
			</header>

			{game.error && (
				<div className="flex items-center gap-2 border-b border-crimson/40 bg-crimson/10 px-4 py-1.5 text-sm text-crimson-2">
					<AlertTriangle size={15} /> <span className="min-w-0 flex-1 truncate" title={le(game.error)}>{le(game.error)}</span>
					<button onClick={() => game.setError(null)} title={t("play.dismiss")} aria-label={t("play.dismiss")}><X size={14} /></button>
				</div>
			)}

			{/* Main three-column layout */}
			<main className="grid min-h-0 flex-1 grid-cols-[minmax(340px,30%)_1fr_minmax(300px,24%)]">
				<section className="min-h-0 border-r border-line bg-panel/60">
					<Narration state={state} log={game.log} live={game.live} busy={game.busy} onSend={game.send} onAbort={() => void game.abort()} onRollPending={() => void game.rollPending()} />
				</section>
				<section className="relative min-h-0">
					<Stage state={state} busy={game.busy} fx={game.fx} act={(a) => void game.act(a)} siege={(op) => void game.siege(op)} setView={(v) => game.setState({ ...state, view: v })} />
					{enemyTurnStalled && (
						<button className="btn btn-gold absolute bottom-16 left-1/2 z-20 -translate-x-1/2" onClick={() => void game.send("(Continue the enemies' turns.)")}>
							{t("play.letEnemiesAct")}
						</button>
					)}
				</section>
				<aside className="min-h-0 border-l border-line bg-panel/60">
					<Sidebar state={state} onLevelUp={() => setDialog("levelup")} actions={{ act: (a) => void game.act(a), busy: game.busy, editPortrait: () => setDialog("portrait") }} />
				</aside>
			</main>

			<DiceTray queue={game.rollQueue.filter((r) => r.actor === state.character.id || r.label.startsWith(state.character.name))} compact autoDismissMs={1100} onSettled={() => state.settings.audio.enabled && playSfx("dice", { volume: 0.6 })} />

			{dialog === "saves" && <SavesDialog id={id} onClose={() => setDialog(null)} onLoaded={() => void game.refresh()} />}
			{dialog === "settings" && <SettingsDrawer state={state} onClose={() => setDialog(null)} onSave={game.patchSettings} />}
			{dialog === "portrait" && <PortraitDialog id={id} state={state} onClose={() => setDialog(null)} onSaved={(s) => game.setState(s)} />}
			{dialog === "levelup" && <LevelUpDialog id={id} state={state} onClose={() => setDialog(null)} onDone={() => void game.refresh()} />}
		</div>
	);
}
