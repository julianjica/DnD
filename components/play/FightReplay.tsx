"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FastForward, Pause, Play, RotateCcw, Swords, X } from "lucide-react";
import type { FightBeat, FightReplay, GameState, GridMap, MapEntity } from "@/lib/game/types";
import type { MapFxEvent, TokenStatus } from "@/components/map/BattleMap";
import { useT } from "@/components/i18n/I18nProvider";

/**
 * Automatic fights: the battle map plays the recorded fight back (GameState.fight,
 * written by lib/dm/autofight.ts) at a quick pace with a short log, a speed
 * control and "skip to the end". Each fight plays once by itself (remembered
 * per browser); the "replay" button plays it again.
 */

/** Milliseconds each beat holds the stage at 1×. */
const DELAY: Record<FightBeat["k"], number> = {
	round: 260,
	turn: 70,
	move: 320,
	atk: 430,
	dmg: 140,
	heal: 320,
	spell: 560,
	item: 420,
	feat: 380,
	act: 200,
	save: 90,
	cond: 50,
	down: 520,
	die: 460,
	ds: 380,
	gone: 420,
	trace: 220,
	noise: 220,
	end: 0,
};
const SPEEDS = [1, 2, 4] as const;

interface Frame {
	pos: Record<string, { x: number; y: number }>;
	hp: Record<string, number>;
	dead: Set<string>;
	gone: Set<string>;
	conds: Record<string, string[]>;
	round: number;
	actor?: string;
}

function frameAt(f: FightReplay, upto: number): Frame {
	const fr: Frame = { pos: {}, hp: {}, dead: new Set(), gone: new Set(), conds: {}, round: 1 };
	for (const a of f.actors) {
		fr.pos[a.id] = { x: a.entity.x, y: a.entity.y };
		fr.hp[a.id] = a.hp;
		fr.conds[a.id] = [];
	}
	for (let i = 0; i < upto && i < f.beats.length; i++) {
		const b = f.beats[i];
		switch (b.k) {
			case "round":
				fr.round = b.n;
				break;
			case "turn":
				fr.actor = b.a;
				break;
			case "move":
				if (b.path.length) fr.pos[b.a] = b.path[b.path.length - 1];
				break;
			case "dmg":
			case "heal":
				fr.hp[b.d] = b.hp;
				break;
			case "die":
				fr.dead.add(b.d);
				fr.hp[b.d] = 0;
				break;
			case "gone":
				// A surrender keeps its token (out of the fight); fleeing and the like take it off the map.
				if (b.why !== "surrendered") fr.gone.add(b.a);
				break;
			case "cond":
				fr.conds[b.d] = b.on ? [...(fr.conds[b.d] ?? []).filter((c) => c !== b.c), b.c] : (fr.conds[b.d] ?? []).filter((c) => c !== b.c);
				break;
		}
	}
	return fr;
}

function seenKey(campaignId: string): string {
	return `dh.fightSeen.${campaignId}`;
}
function wasSeen(campaignId: string, fightId: string): boolean {
	try {
		return window.localStorage.getItem(seenKey(campaignId)) === fightId;
	} catch {
		return false;
	}
}
function markSeen(campaignId: string, fightId: string): void {
	try {
		window.localStorage.setItem(seenKey(campaignId), fightId);
	} catch {
		/* private mode: it plays again after a reload, that's all */
	}
}

export interface FightReplayView {
	/** The replay is on the map right now. */
	active: boolean;
	map?: GridMap;
	entities?: MapEntity[];
	status?: Record<string, TokenStatus>;
	events: MapFxEvent[];
	focus?: string | null;
	/** The overlay (log + controls), or the small "replay" button once it's over. */
	panel: React.ReactNode;
}

export function useFightReplay(state: GameState): FightReplayView {
	const { t, ts } = useT();
	const fight = state.fight;
	const map = fight ? state.maps[fight.mapId] : undefined;
	const [playing, setPlaying] = useState<{ id: string; idx: number; paused: boolean } | null>(null);
	const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
	const started = useRef<string | null>(null);

	// A new fight plays by itself, once.
	useEffect(() => {
		if (!fight || !map || started.current === fight.id) return;
		started.current = fight.id;
		if (wasSeen(state.id, fight.id)) return;
		markSeen(state.id, fight.id);
		// eslint-disable-next-line react-hooks/set-state-in-effect -- a new replay arrived in the game state
		setPlaying({ id: fight.id, idx: 0, paused: false });
	}, [fight, map, state.id]);

	const live = !!playing && !!fight && playing.id === fight.id && !!map;
	const idx = live ? playing!.idx : 0;
	const total = fight?.beats.length ?? 0;
	const done = live && idx >= total;

	useEffect(() => {
		if (!live || done || playing!.paused) return;
		const b = fight!.beats[idx];
		const ms = (DELAY[b.k] ?? 100) / speed;
		const timer = window.setTimeout(() => setPlaying((p) => (p ? { ...p, idx: p.idx + 1 } : p)), ms);
		return () => window.clearTimeout(timer);
	}, [live, done, idx, speed, fight, playing]);

	const frame = useMemo(() => (live ? frameAt(fight!, idx) : undefined), [live, fight, idx]);
	const name = useMemo(() => {
		const m = new Map(fight?.actors.map((a) => [a.id, ts(a.name)]) ?? []);
		return (id: string) => m.get(id) ?? id;
	}, [fight, ts]);

	const entities = useMemo(() => {
		if (!live || !frame || !map) return undefined;
		const mine = new Set(fight!.actors.map((a) => a.entity.id));
		const out = map.entities.filter((e) => !mine.has(e.id));
		for (const a of fight!.actors) {
			if (frame.gone.has(a.id)) continue;
			const p = frame.pos[a.id];
			out.push({ ...a.entity, x: p.x, y: p.y, dead: frame.dead.has(a.id) && a.kind !== "pc" ? true : undefined, hidden: false });
		}
		return out;
	}, [live, frame, map, fight]);

	const status = useMemo(() => {
		if (!live || !frame) return undefined;
		const s: Record<string, TokenStatus> = {};
		for (const a of fight!.actors) s[a.entity.id] = { hp: Math.max(0, frame.hp[a.id] ?? a.hp), maxHp: a.maxHp, side: a.side, dead: frame.dead.has(a.id), conditions: frame.conds[a.id] ?? [] };
		return s;
	}, [live, frame, fight]);

	const ent = useMemo(() => new Map(fight?.actors.map((a) => [a.id, a.entity.id]) ?? []), [fight]);
	// Floating numbers for the beats just shown (each id plays once).
	const events = useMemo(() => {
		if (!live) return [];
		const out: MapFxEvent[] = [];
		for (let i = Math.max(0, idx - 6); i < idx; i++) {
			const b = fight!.beats[i];
			const id = `${fight!.id}:${i}`;
			if (b.k === "dmg") {
				const crit = fight!.beats.slice(Math.max(0, i - 2), i).some((x) => x.k === "atk" && x.crit && x.d === b.d);
				out.push({ id, entityId: ent.get(b.d), text: `-${b.n}`, kind: crit ? "crit" : "damage" });
			} else if (b.k === "heal") out.push({ id, entityId: ent.get(b.d), text: `+${b.n}`, kind: "heal" });
			else if (b.k === "atk" && !b.hit) out.push({ id, entityId: ent.get(b.d), text: t("play.fx.miss"), kind: "miss" });
		}
		return out;
	}, [live, idx, fight, ent, t]);

	// The short log: what matters, newest last.
	const lines = useMemo(() => {
		if (!live) return [];
		const out: { key: string; text: string; tone?: "hit" | "bad" | "good" | "dim" }[] = [];
		const beats = fight!.beats;
		const pcId = fight!.actors.find((a) => a.kind === "pc")?.id;
		for (let i = 0; i < idx; i++) {
			const b = beats[i];
			const key = `${i}`;
			if (b.k === "atk") {
				// The damage that follows this attack (before anything else happens).
				let n: number | undefined;
				for (let j = i + 1; j < Math.min(beats.length, i + 4); j++) {
					const x = beats[j];
					if (x.k === "dmg" && x.d === b.d) {
						n = x.n;
						break;
					}
					if (x.k === "atk" || x.k === "turn" || x.k === "spell") break;
				}
				const v = { a: name(b.a), d: name(b.d), w: ts(b.w), n: n ?? "—" };
				out.push({ key, text: b.crit ? t("play.fight.crit", v) : b.hit ? t(n !== undefined ? "play.fight.hitFor" : "play.fight.hit", v) : t("play.fight.miss", v), tone: b.hit ? (b.d === pcId ? "bad" : "hit") : "dim" });
			} else if (b.k === "spell" || b.k === "item" || b.k === "feat") out.push({ key, text: t("play.fight.uses", { a: name(b.a), s: ts(b.s) }), tone: "good" });
			else if (b.k === "heal" && b.n > 0) out.push({ key, text: t("play.fight.heal", { d: name(b.d), n: b.n }), tone: "good" });
			else if (b.k === "down") out.push({ key, text: t("play.fight.down", { d: name(b.d) }), tone: "bad" });
			else if (b.k === "die") out.push({ key, text: t(b.d === pcId ? "play.fight.pcDies" : "play.fight.dies", { d: name(b.d) }), tone: b.d === pcId ? "bad" : "hit" });
			else if (b.k === "gone") out.push({ key, text: t(b.why === "surrendered" ? "play.fight.surrendered" : b.why === "fled" ? "play.fight.fled" : "play.fight.left", { a: name(b.a) }) });
			else if (b.k === "act" && (b.s === "dash" || b.s === "disengage" || b.s === "dodge") && b.a === pcId) out.push({ key, text: t(`play.fight.${b.s}`, { a: name(b.a) }), tone: "dim" });
			else if (b.k === "ds") out.push({ key, text: t("play.fight.deathSave", { d: name(b.d), nat: b.nat }), tone: "bad" });
			else if (b.k === "trace") out.push({ key, text: t("play.fight.trace", { n: b.n }), tone: "bad" });
			else if (b.k === "noise") out.push({ key, text: t("play.fight.noise", { n: b.n }), tone: "bad" });
		}
		return out.slice(-6);
	}, [live, idx, fight, name, t, ts]);

	if (!fight || !map) return { active: false, events: [], panel: null };

	const replayButton = (
		<button
			type="button"
			className="panel absolute left-3 top-3 z-20 flex items-center gap-1.5 px-2.5 py-1 text-xs text-dim hover:text-text"
			onClick={() => setPlaying({ id: fight.id, idx: 0, paused: false })}
			title={t("play.fight.replay")}
		>
			<RotateCcw size={13} /> {t("play.fight.replay")}
		</button>
	);
	if (!live) return { active: false, events: [], panel: state.encounter?.status === "active" ? null : replayButton };

	const outcome = fight.outcome;
	const good = outcome === "victory" || outcome === "escaped";
	const panel = (
		<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-3" data-testid="fight-replay">
			<div className="panel pointer-events-auto w-full max-w-xl space-y-2 px-3 py-2 shadow-2xl">
				<div className="flex flex-wrap items-center gap-2">
					<span className="flex items-center gap-1.5 font-display text-xs uppercase tracking-widest text-crimson-2">
						<Swords size={14} /> {t("play.fight.title")}
					</span>
					<span className="text-xs text-gold">{t("play.combat.round", { n: frame?.round ?? 1 })}</span>
					<div className="ml-auto flex items-center gap-1">
						{!done && (
							<button type="button" className="chip" onClick={() => setPlaying((p) => (p ? { ...p, paused: !p.paused } : p))} title={playing!.paused ? t("play.fight.play") : t("play.fight.pause")} aria-label={playing!.paused ? t("play.fight.play") : t("play.fight.pause")}>
								{playing!.paused ? <Play size={13} /> : <Pause size={13} />}
							</button>
						)}
						{!done &&
							SPEEDS.map((s) => (
								<button key={s} type="button" className="chip" data-active={speed === s} onClick={() => setSpeed(s)} title={t("play.fight.speed")}>
									{s}×
								</button>
							))}
						{!done ? (
							<button type="button" className="chip" onClick={() => setPlaying((p) => (p ? { ...p, idx: total } : p))} title={t("play.fight.skip")}>
								<FastForward size={13} /> {t("play.fight.skip")}
							</button>
						) : (
							<>
								<button type="button" className="chip" onClick={() => setPlaying({ id: fight.id, idx: 0, paused: false })} title={t("play.fight.replay")} aria-label={t("play.fight.replay")}>
									<RotateCcw size={13} />
								</button>
								<button type="button" className="chip" onClick={() => setPlaying(null)} title={t("common.close")} aria-label={t("common.close")}>
									<X size={13} />
								</button>
							</>
						)}
					</div>
				</div>
				<ul className="space-y-0.5 text-sm leading-snug" aria-live="polite">
					{lines.map((l) => (
						<li key={l.key} className={l.tone === "bad" ? "text-crimson-2" : l.tone === "good" ? "text-emerald-300" : l.tone === "dim" ? "text-faint" : "text-text"}>
							{l.text}
						</li>
					))}
				</ul>
				{done && <div className={`font-display text-sm uppercase tracking-widest ${good ? "text-gold-2" : "text-crimson-2"}`}>{t(`play.fight.outcome.${outcome}`)}</div>}
				<div className="h-1 overflow-hidden rounded bg-white/10">
					<div className="h-full bg-gold/70 transition-[width] duration-200" style={{ width: `${total ? Math.round((Math.min(idx, total) / total) * 100) : 100}%` }} />
				</div>
			</div>
		</div>
	);
	return {
		active: true,
		map,
		entities,
		status,
		events,
		focus: frame?.actor ? (ent.get(frame.actor) ?? null) : null,
		panel,
	};
}
