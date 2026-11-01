"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import clsx from "clsx";
import { Music, Sparkles, Volume2, VolumeX } from "lucide-react";
import type { AmbienceTrack } from "@/lib/game/types";
import { useT } from "@/components/i18n/I18nProvider";
import { getAmbienceEngine, playSfx as enginePlaySfx, type AmbienceEngineState, type SfxName, type SfxOptions } from "@/lib/audio/ambience";

export type { SfxName } from "@/lib/audio/ambience";

export interface AmbiencePlayerProps {
	/** Ambience bed to play; changes crossfade (~2 s). */
	track: AmbienceTrack;
	/** 0..1 */
	musicVolume: number;
	/** 0..1 */
	sfxVolume: number;
	/** Controlled mute. If omitted the player keeps its own mute state. */
	muted?: boolean;
	onMutedChange?: (muted: boolean) => void;
	/** Called when the user drags a slider. If omitted, sliders are uncontrolled (seeded from props). */
	onMusicVolumeChange?: (v: number) => void;
	onSfxVolumeChange?: (v: number) => void;
	className?: string;
	/** Icon-only button; sliders appear in a popover on hover/focus. */
	compact?: boolean;
}

/** Plays a one-shot sound effect (no-op until the user has interacted with the page). */
export function playSfx(name: SfxName, opts?: SfxOptions): void {
	enginePlaySfx(name, opts);
}

/** Stable SFX callback for components. */
export function useSfx(): (name: SfxName, opts?: SfxOptions) => void {
	return useCallback((name: SfxName, opts?: SfxOptions) => enginePlaySfx(name, opts), []);
}

let lastPreview = 0;
function previewSfx() {
	const now = Date.now();
	if (now - lastPreview < 250) return;
	lastPreview = now;
	playSfx("coin", { volume: 0.6 });
}

const SERVER_STATE: AmbienceEngineState = { unlocked: false, muted: false, track: "none", volumes: { music: 0.6, sfx: 0.8 } };

/** Live engine state (unlocked, muted, track, volumes). */
export function useAmbienceState(): AmbienceEngineState {
	return useSyncExternalStore(
		(cb) => getAmbienceEngine()?.on("state", cb) ?? (() => {}),
		() => getAmbienceEngine()?.getState() ?? SERVER_STATE,
		() => SERVER_STATE,
	);
}

/** Calls `cb` on each thunder clap of the "storm" bed (for lightning flashes in scene art). */
export function useThunder(cb: () => void): void {
	useEffect(() => getAmbienceEngine()?.on("thunder", cb), [cb]);
}

export default function AmbiencePlayer(props: AmbiencePlayerProps) {
	const { track, className, compact } = props;
	const { t } = useT();
	const engineState = useAmbienceState();
	const [localMuted, setLocalMuted] = useState(props.muted ?? false);
	const [localMusic, setLocalMusic] = useState(props.musicVolume);
	const [localSfx, setLocalSfx] = useState(props.sfxVolume);
	const muted = props.muted ?? localMuted;
	// Sliders always render the local value (instant feedback while dragging);
	// the parent is told after a short pause so it can persist without lag.
	const music = localMusic;
	const sfx = localSfx;

	// Re-seed uncontrolled sliders when the parent changes the value (adjust state during render).
	const [seenMusic, setSeenMusic] = useState(props.musicVolume);
	const [seenSfx, setSeenSfx] = useState(props.sfxVolume);
	if (seenMusic !== props.musicVolume) {
		setSeenMusic(props.musicVolume);
		setLocalMusic(props.musicVolume);
	}
	if (seenSfx !== props.sfxVolume) {
		setSeenSfx(props.sfxVolume);
		setLocalSfx(props.sfxVolume);
	}

	useEffect(() => getAmbienceEngine()?.setTrack(track), [track]);
	useEffect(() => getAmbienceEngine()?.setVolumes({ music, sfx }), [music, sfx]);
	useEffect(() => getAmbienceEngine()?.setMuted(muted), [muted]);

	// Unlock on the first user gesture anywhere; pause while the tab is hidden.
	useEffect(() => {
		const engine = getAmbienceEngine();
		if (!engine) return;
		const unlock = () => {
			void engine.unlock().then(() => engine.preloadSfx());
		};
		const events = ["pointerdown", "keydown", "touchstart"] as const;
		events.forEach((e) => window.addEventListener(e, unlock, { passive: true }));
		const vis = () => engine.suspend(document.hidden);
		document.addEventListener("visibilitychange", vis);
		return () => {
			events.forEach((e) => window.removeEventListener(e, unlock));
			document.removeEventListener("visibilitychange", vis);
		};
	}, []);

	const toggleMute = () => {
		const next = !muted;
		setLocalMuted(next);
		props.onMutedChange?.(next);
		void getAmbienceEngine()?.unlock();
	};
	const timers = useRef<{ music?: ReturnType<typeof setTimeout>; sfx?: ReturnType<typeof setTimeout> }>({});
	const changeMusic = (v: number) => {
		setLocalMusic(v);
		clearTimeout(timers.current.music);
		if (props.onMusicVolumeChange) timers.current.music = setTimeout(() => props.onMusicVolumeChange?.(v), 400);
	};
	const changeSfx = (v: number) => {
		setLocalSfx(v);
		clearTimeout(timers.current.sfx);
		if (props.onSfxVolumeChange) timers.current.sfx = setTimeout(() => props.onSfxVolumeChange?.(v), 400);
	};

	// Compact popover: opens on hover or click, stays open while pointer is inside
	// or a slider is being dragged, closes shortly after leaving / on outside click.
	const [open, setOpen] = useState(false);
	const [pinned, setPinned] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const dragging = useRef(false);
	const show = () => {
		clearTimeout(closeTimer.current);
		setOpen(true);
	};
	const hideSoon = () => {
		clearTimeout(closeTimer.current);
		closeTimer.current = setTimeout(() => {
			if (!dragging.current) setOpen(false);
		}, 350);
	};
	useEffect(() => {
		if (!compact) return;
		const up = () => {
			dragging.current = false;
		};
		const outside = (e: PointerEvent) => {
			if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
				setPinned(false);
				setOpen(false);
			}
		};
		window.addEventListener("pointerup", up);
		window.addEventListener("pointerdown", outside);
		return () => {
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointerdown", outside);
		};
	}, [compact]);
	const panelOpen = open || pinned;

	const locked = !engineState.unlocked;
	const MuteIcon = muted ? VolumeX : Volume2;

	const sliders = (
		<div className="flex flex-col gap-1.5">
			<Slider icon={<Music className="size-3.5" />} label={t("play.audio.music")} value={music} onChange={changeMusic} disabled={muted} />
			<Slider icon={<Sparkles className="size-3.5" />} label={t("play.audio.sfx")} value={sfx} onChange={(v) => { changeSfx(v); previewSfx(); }} disabled={muted} />
		</div>
	);

	return (
		<div
			ref={rootRef}
			onPointerEnter={compact ? show : undefined}
			onPointerLeave={compact ? () => !pinned && hideSoon() : undefined}
			onClick={compact ? () => setPinned(true) : undefined}
			className={clsx(
				"group relative inline-flex items-center gap-2 rounded-lg border border-amber-200/15 bg-stone-950/70 px-2 py-1.5 text-stone-200 shadow-lg backdrop-blur-sm",
				className,
			)}
		>
			<button
				type="button"
				onClick={toggleMute}
				className={clsx(
					"inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-amber-200/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300/60",
					muted ? "text-stone-500" : "text-amber-200",
				)}
				aria-label={muted ? t("play.audio.unmute") : t("play.audio.mute")}
				aria-pressed={muted}
				title={locked ? t("play.audio.enable") : muted ? t("play.audio.unmuteShort") : t("play.audio.muteShort")}
			>
				<MuteIcon className="size-4" />
			</button>
			{compact ? (
				// pt-1.5 (not margin) so the pointer never leaves the hover area on its way down.
				<div
					className={clsx("absolute right-0 top-full z-50 w-56 pt-1.5 transition-opacity", panelOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")}
					onPointerDown={() => {
						dragging.current = true;
						setPinned(true);
					}}
				>
					<div className="rounded-lg border border-amber-200/15 bg-stone-950/95 p-3 shadow-xl">
						{sliders}
						<TrackLine track={track} locked={locked} />
					</div>
				</div>
			) : (
				<div className="flex min-w-44 flex-col gap-1">
					{sliders}
					<TrackLine track={track} locked={locked} />
				</div>
			)}
		</div>
	);
}

function TrackLine({ track, locked }: { track: AmbienceTrack; locked: boolean }) {
	const { t, te } = useT();
	return (
		<div className="mt-1 truncate text-[10px] uppercase tracking-wider text-stone-500">
			{locked ? t("play.audio.enable") : track === "none" ? te("ambience", "none") : t("play.audio.track", { track: te("ambience", track) })}
		</div>
	);
}

function Slider({ icon, label, value, onChange, disabled }: { icon: ReactNode; label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
	return (
		<label className={clsx("flex items-center gap-2", disabled && "opacity-50")} title={label}>
			<span className="text-amber-200/70">{icon}</span>
			<input
				type="range"
				min={0}
				max={1}
				step={0.01}
				value={value}
				aria-label={label}
				onChange={(e) => onChange(Number(e.currentTarget.value))}
				className="h-1 w-full cursor-pointer accent-amber-400"
			/>
		</label>
	);
}
