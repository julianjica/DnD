"use client";

import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import clsx from "clsx";
import type { RollRecord } from "@/lib/game/types";
import { critKind, visualDice } from "./diceGeometry";
import type { DiceEngine, DiceTheme } from "./diceEngine";
import { DieGlyph } from "./DieGlyph";
import { outcomeText, rollChips, signedMod } from "./rollFormat";
import { useT } from "@/components/i18n/I18nProvider";
import { useEngineText } from "@/components/i18n/useEngineText";

export interface DiceTrayHandle {
	/** Animates a roll. Resolves when that roll is dismissed (click, Esc, auto-dismiss or clear()). */
	roll(rec: RollRecord): Promise<void>;
	/** Drops the queue and hides the tray immediately. */
	clear(): void;
}

export interface DiceTrayProps {
	ref?: Ref<DiceTrayHandle>;
	/** Rolls to play, in order; deduped by id. New ids are queued as they appear. */
	queue?: RollRecord[];
	/** Ignore rolls already in `queue` on first render (default true: don't replay history). */
	skipInitial?: boolean;
	onDismiss?: (rec: RollRecord) => void;
	onSettled?: (rec: RollRecord) => void;
	/** Dice hit the tray/each other (0..1). Hook for a dice-clatter SFX. */
	onImpact?: (strength: number) => void;
	/** Auto-dismiss after settling (ms). Without it the tray waits for a click, unless more rolls are queued. */
	autoDismissMs?: number;
	/** "auto": 3D unless reduced motion / no WebGL. "2d": always the flat result chip. */
	mode?: "auto" | "2d";
	theme?: DiceTheme;
	className?: string;
}

type Phase = "loading" | "rolling" | "settled";

interface Job {
	rec: RollRecord;
	resolve: () => void;
}

const QUEUED_ADVANCE_MS = 1600;

export function DiceTray({
	ref,
	queue,
	skipInitial = true,
	onDismiss,
	onSettled,
	onImpact,
	autoDismissMs,
	mode = "auto",
	theme = "mixed",
	className,
}: DiceTrayProps) {
	const [current, setCurrent] = useState<{ rec: RollRecord; phase: Phase; flat: boolean } | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const engineRef = useRef<DiceEngine | null>(null);
	const engineFailed = useRef(false);
	const jobs = useRef<Job[]>([]);
	const active = useRef<Job | null>(null);
	const dismissRef = useRef<(() => void) | null>(null);
	const seen = useRef<Set<string> | null>(null);
	const alive = useRef(true);
	const cb = useRef({ onDismiss, onSettled, onImpact, autoDismissMs, mode, theme });
	useEffect(() => {
		cb.current = { onDismiss, onSettled, onImpact, autoDismissMs, mode, theme };
	});

	if (seen.current === null) seen.current = new Set(skipInitial ? (queue ?? []).map((r) => r.id) : []);

	const want3d = useCallback(() => {
		if (cb.current.mode === "2d" || engineFailed.current) return false;
		if (typeof window === "undefined") return false;
		return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
	}, []);

	const getEngine = useCallback(async (): Promise<DiceEngine | null> => {
		if (engineRef.current) return engineRef.current;
		if (!containerRef.current) return null;
		try {
			const mod = await import("./diceEngine");
			if (!alive.current || !containerRef.current) return null;
			if (!mod.webglAvailable()) throw new Error("WebGL unavailable");
			engineRef.current = new mod.DiceEngine(containerRef.current, {
				theme: cb.current.theme,
				onImpact: (s) => cb.current.onImpact?.(s),
			});
			return engineRef.current;
		} catch (err) {
			console.warn("[DiceTray] 3D dice unavailable, using 2D fallback:", err);
			engineFailed.current = true;
			return null;
		}
	}, []);

	const pump = useCallback(async () => {
		for (;;) {
			if (active.current || !alive.current) return;
			const job = jobs.current.shift();
			if (!job) return;
			active.current = job;
			const { rec } = job;
			const specs = visualDice(rec.dice);
			let engine: DiceEngine | null = null;
			if (want3d() && specs.length) {
				setCurrent({ rec, phase: "loading", flat: false });
				engine = await getEngine();
			}
			if (active.current !== job) return; // cleared meanwhile
			if (!alive.current) {
				// unmounted mid-load (e.g. StrictMode remount): requeue and let the next mount resume
				active.current = null;
				jobs.current.unshift(job);
				return;
			}
			if (engine) {
				setCurrent({ rec, phase: "rolling", flat: false });
				const crit = critKind(rec);
				const critIndex = specs.findIndex((s) => s.shape === 20 && s.mode === "plain" && !s.dropped);
				await engine.throw(specs, { crit, critIndex });
				if (active.current !== job) return;
			}
			setCurrent({ rec, phase: "settled", flat: !engine });
			cb.current.onSettled?.(rec);

			await new Promise<void>((resolve) => {
				let timer: ReturnType<typeof setTimeout> | undefined;
				const done = () => {
					if (timer) clearTimeout(timer);
					dismissRef.current = null;
					resolve();
				};
				dismissRef.current = done;
				const ms = cb.current.autoDismissMs ?? (jobs.current.length ? QUEUED_ADVANCE_MS : undefined);
				if (ms !== undefined) timer = setTimeout(done, ms);
			});
			if (active.current !== job) return;
			engineRef.current?.clear();
			active.current = null;
			setCurrent(null);
			cb.current.onDismiss?.(rec);
			job.resolve();
		}
	}, [getEngine, want3d]);

	const roll = useCallback(
		(rec: RollRecord) =>
			new Promise<void>((resolve) => {
				seen.current!.add(rec.id);
				jobs.current.push({ rec, resolve });
				// a settled roll waiting for a click moves on when more rolls arrive
				const waiting = dismissRef.current;
				if (waiting && cb.current.autoDismissMs === undefined)
					setTimeout(() => {
						if (dismissRef.current === waiting) waiting();
					}, QUEUED_ADVANCE_MS);
				void pump();
			}),
		[pump],
	);

	const clear = useCallback(() => {
		const pending = jobs.current.splice(0);
		const cur = active.current;
		active.current = null;
		dismissRef.current = null;
		engineRef.current?.clear();
		setCurrent(null);
		cur?.resolve();
		pending.forEach((j) => j.resolve());
	}, []);

	useImperativeHandle(ref, () => ({ roll, clear }), [roll, clear]);

	// queue prop → jobs
	useEffect(() => {
		for (const rec of queue ?? []) {
			if (seen.current!.has(rec.id)) continue;
			void roll(rec);
		}
	}, [queue, roll]);

	// Esc dismisses
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") dismissRef.current?.();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		alive.current = true;
		void pump();
		return () => {
			alive.current = false;
			engineRef.current?.dispose();
			engineRef.current = null;
		};
	}, [pump]);

	const visible = !!current;
	const settled = current?.phase === "settled";
	const show3d = visible && !current.flat && current.phase !== "loading";

	return (
		<div
			className={clsx("fixed inset-0 z-[60] select-none", settled ? "pointer-events-auto cursor-pointer" : "pointer-events-none", className)}
			aria-hidden={!visible}
			onClick={() => settled && dismissRef.current?.()}
		>
			<style>{CSS}</style>
			<div
				className="absolute inset-0 transition-opacity duration-300"
				style={{
					opacity: visible ? 1 : 0,
					background: "radial-gradient(ellipse at 50% 42%, rgba(8,6,4,0.18) 0%, rgba(8,6,4,0.55) 70%, rgba(8,6,4,0.7) 100%)",
				}}
			/>
			<div ref={containerRef} className="absolute inset-0 transition-opacity duration-300" style={{ opacity: show3d ? 1 : 0 }} />
			{current && settled && <ResultCard rec={current.rec} flat={current.flat} />}
		</div>
	);
}

function ResultCard({ rec, flat }: { rec: RollRecord; flat: boolean }) {
	const { t } = useT();
	const { le } = useEngineText();
	const crit = critKind(rec);
	const chips = rollChips(rec);
	const outcomeKey = outcomeText(rec);
	const outcome = outcomeKey ? t(outcomeKey) : null;
	const glow =
		crit === "gold"
			? "0 0 22px rgba(255,194,61,0.85), 0 0 60px rgba(255,170,40,0.45)"
			: crit === "red"
				? "0 0 22px rgba(255,50,50,0.8), 0 0 60px rgba(200,20,20,0.4)"
				: "0 2px 12px rgba(0,0,0,0.6)";
	return (
		<div
			className={clsx(
				"absolute inset-x-0 flex justify-center px-4",
				flat ? "top-1/2 -translate-y-1/2" : "bottom-[5%]",
			)}
			role="status"
			aria-live="polite"
		>
			<div
				className={clsx(
					"dh-dice-pop relative w-full max-w-md overflow-hidden rounded-2xl border px-6 pb-4 pt-3 text-center shadow-2xl backdrop-blur-md",
					crit === "gold" ? "border-amber-400/70" : crit === "red" ? "border-red-500/70" : "border-amber-100/15",
				)}
				style={{
					background: "linear-gradient(180deg, rgba(36,28,20,0.92), rgba(16,12,9,0.94))",
					boxShadow: crit ? `0 0 0 1px rgba(0,0,0,0.4), ${crit === "gold" ? "0 0 40px rgba(255,190,60,0.35)" : "0 0 40px rgba(255,40,40,0.3)"}, 0 20px 50px rgba(0,0,0,0.6)` : undefined,
				}}
			>
				{crit && <div className={clsx("dh-dice-sheen pointer-events-none absolute inset-0", crit === "gold" ? "dh-gold" : "dh-red")} />}
				<div className="relative truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200/75">{le(rec.label)}</div>
				<div className="relative mt-1 flex items-center justify-center gap-3">
					<span
						className={clsx(
							"font-serif text-6xl font-bold tabular-nums leading-none",
							crit === "gold" ? "text-amber-300" : crit === "red" ? "text-red-400" : "text-stone-50",
						)}
						style={{ textShadow: glow }}
					>
						{rec.total}
					</span>
				</div>
				{crit && (
					<div className={clsx("relative mt-1 text-xs font-bold uppercase tracking-[0.3em]", crit === "gold" ? "text-amber-300" : "text-red-400")}>
						{t(crit === "gold" ? (rec.critical === "hit" ? "play.dice.critHitBang" : "play.dice.nat20") : rec.critical === "miss" ? "play.dice.critMiss" : "play.dice.nat1")}
					</div>
				)}
				<div className="relative mt-3 flex flex-wrap items-center justify-center gap-1.5">
					{chips.map((c, i) => (
						<DieGlyph key={i} sides={c.sides} value={c.value} dropped={c.dropped} nat={c.nat} size={chips.length > 10 ? 26 : 32} />
					))}
					{rec.modifier !== 0 && <span className="ml-1 font-serif text-lg text-stone-300">{signedMod(rec.modifier)}</span>}
				</div>
				<div className="relative mt-2 flex items-center justify-center gap-2 text-xs text-stone-400">
					<span className="font-mono">{rec.notation}</span>
					{rec.advantage && (
						<span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", rec.advantage === "advantage" ? "bg-emerald-900/60 text-emerald-300" : "bg-rose-900/60 text-rose-300")}>
							{t(rec.advantage === "advantage" ? "play.dice.adv" : "play.dice.dis")}
						</span>
					)}
					{rec.target !== undefined && <span>{t("play.dice.vs", { n: rec.target })}</span>}
					{outcome && !rec.critical && (
						<span className={clsx("font-semibold uppercase tracking-wider", rec.success ? "text-emerald-400" : "text-rose-400")}>{outcome}</span>
					)}
				</div>
				<div className="relative mt-2 text-[10px] uppercase tracking-widest text-stone-500">{t("play.dice.clickToContinue")}</div>
			</div>
		</div>
	);
}

const CSS = `
@keyframes dh-dice-pop { 0% { opacity: 0; transform: translateY(14px) scale(0.94); } 60% { opacity: 1; transform: translateY(-2px) scale(1.01); } 100% { opacity: 1; transform: none; } }
@keyframes dh-dice-sheen { 0% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
.dh-dice-pop { animation: dh-dice-pop 420ms cubic-bezier(.2,.8,.2,1) both; }
.dh-dice-sheen { animation: dh-dice-sheen 1.8s ease-in-out 0.2s infinite; }
.dh-gold { background: linear-gradient(100deg, transparent 30%, rgba(255,215,120,0.18) 50%, transparent 70%); }
.dh-red { background: linear-gradient(100deg, transparent 30%, rgba(255,80,80,0.16) 50%, transparent 70%); }
@media (prefers-reduced-motion: reduce) { .dh-dice-pop { animation: dh-fade 200ms linear both; } .dh-dice-sheen { animation: none; display: none; } }
@keyframes dh-fade { from { opacity: 0; } to { opacity: 1; } }
`;

export default DiceTray;
