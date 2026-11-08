"use client";

/**
 * The Quiet: the night siege panel, over the Map tab while a siege exists.
 * The player sets the defence (click a defender, then a highlighted barricade
 * or door on the map), turns the lights on or off, picks what they do in the
 * next wave and holds the line. The engine resolves everything
 * (lib/rules/siege.ts); this only shows the state and sends the choices.
 */
import { useMemo, useState } from "react";
import { Axe, ChevronDown, ChevronUp, Crosshair, Hammer, Lightbulb, LightbulbOff, Shield, ShieldAlert, X } from "lucide-react";
import type { GameState, Survivor } from "@/lib/game/types";
import { entryPoints, lightsAvailable, partyAtBase, pcOptions, type PcSiegeAction } from "@/lib/rules/siege";
import { gameMinutes } from "@/lib/rules/survival";
import { useT } from "@/components/i18n/I18nProvider";
import { Tooltip } from "@/components/ui/Tooltip";
import type { SiegeOp } from "./useGame";

const ACTIONS: { id: PcSiegeAction; icon: typeof Axe }[] = [
	{ id: "shoot", icon: Crosshair },
	{ id: "hack", icon: Axe },
	{ id: "repair", icon: Hammer },
	{ id: "hold", icon: Shield },
];

/** Companions who can stand a post tonight (the engine checks again). */
export function siegeDefenders(state: GameState): Survivor[] {
	const here = partyAtBase(state);
	return Object.values(state.group?.survivors ?? {})
		.filter((sv) => sv.hp > 0 && (sv.status === "at_base" || (sv.status === "with_party" && here)))
		.sort((a, b) => a.joinedAt - b.joinedAt);
}

/** "x,y" → who holds it, for the map marks. */
export function siegeMarks(state: GameState, you: string): Record<string, string> {
	const s = state.siege;
	if (!s || s.phase === "over") return {};
	const out: Record<string, string[]> = {};
	for (const [id, p] of Object.entries(s.posts)) (out[`${p.x},${p.y}`] ??= []).push(id === "pc" ? you : (state.npcs[id]?.name ?? id));
	return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join(", ")]));
}

/** Squares a defender can be posted on ("x,y"), when the base map is the one shown. */
export function siegePostSquares(state: GameState): Set<string> {
	const b = state.group?.base;
	const map = b?.mapId ? state.maps[b.mapId] : undefined;
	if (!map || !state.siege) return new Set();
	return new Set(entryPoints(map, state.siege).map((e) => e.key));
}

export function SiegePanel(props: {
	state: GameState;
	busy: boolean;
	send: (op: SiegeOp) => void;
	/** Defender being placed: "pc" or a companion's npcId. */
	picking: string | null;
	setPicking: (id: string | null) => void;
	/** The player's pending move to another post (sent with the next wave). */
	move: { x: number; y: number } | null;
	setMove: (p: { x: number; y: number } | null) => void;
}) {
	const { state, busy, send, picking, setPicking, move, setMove } = props;
	const { t } = useT();
	const [open, setOpen] = useState(true);
	const s = state.siege!;
	const here = partyAtBase(state);
	const b = state.group?.base;
	const map = b?.mapId ? state.maps[b.mapId] : undefined;
	const entries = useMemo(() => (map ? entryPoints(map, s) : []), [map, s]);
	const opts = useMemo(() => pcOptions(state), [state]);
	const lights = lightsAvailable(state);
	const defenders = siegeDefenders(state);
	const [choice, setChoice] = useState<PcSiegeAction | null>(null);
	const action: PcSiegeAction = choice && opts[choice].ok ? choice : opts.shoot.ok ? "shoot" : "hack";
	const now = gameMinutes(state.time);
	const left = Math.max(0, s.arrivesAt - now);
	const fighting = state.encounter?.status === "active";
	// A breach whose fight never started (the map wasn't ready): the button retries it.
	const canWave = here && s.phase !== "over" && (!s.breach || !s.breach.combat) && !fighting && !!s.posts.pc;
	const name = (id: string) => (id === "pc" ? t("siege.you") : (state.npcs[id]?.name ?? id));
	const postText = (id: string) => {
		const p = s.posts[id];
		return p ? t("siege.post", { x: p.x, y: p.y }) : t("siege.noPost");
	};

	if (!open)
		return (
			<button className="panel absolute right-3 top-3 z-20 flex items-center gap-1.5 px-3 py-1.5 text-sm text-crimson-2" onClick={() => setOpen(true)}>
				<ShieldAlert size={15} /> {t("siege.expand")} · {s.phase === "active" ? t("siege.wave", { n: s.wave, total: s.waves }) : t(`siege.phase.${s.phase}`)}
				<ChevronDown size={14} />
			</button>
		);

	return (
		<div className="panel absolute right-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2 overflow-y-auto p-3 text-sm" data-testid="siege-panel">
			<div className="flex items-center justify-between">
				<span className="flex items-center gap-1.5 font-display text-xs uppercase tracking-widest text-crimson-2">
					<ShieldAlert size={15} /> {t("siege.title")} · {t(`siege.phase.${s.phase}`)}
				</span>
				<button className="text-faint hover:text-text" title={t("siege.collapse")} aria-label={t("siege.collapse")} onClick={() => setOpen(false)}>
					<ChevronUp size={15} />
				</button>
			</div>

			<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-dim">
				{s.phase !== "over" && <span className="text-text">{s.phase === "active" ? t("siege.atWalls") : t("siege.arrivesIn", { t: left >= 120 ? t("siege.hours", { n: Math.round(left / 60) }) : t("siege.minutes", { n: left }) })}</span>}
				<span>{t("siege.horde", { n: s.horde })}</span>
				{s.wave > 0 && <span>{t("siege.wave", { n: s.wave, total: s.waves })}</span>}
			</div>

			{!here && s.phase !== "over" && <div className="text-xs italic text-crimson-2">{t("siege.away")}</div>}
			{s.breach && <div className="rounded border border-crimson/60 bg-crimson/15 px-2 py-1 text-xs text-crimson-2">{t("siege.breach", { x: s.breach.x, y: s.breach.y })}</div>}
			{s.last && s.phase !== "over" && <div className="text-xs text-dim">{t("siege.last", { n: s.last.wave, pc: s.last.pcKills, allies: s.last.allyKills })}</div>}

			{s.phase === "over" ? (
				<div className="space-y-1 text-xs">
					<div className={s.outcome === "held" ? "text-gold-2" : "text-crimson-2"}>{t(`siege.outcome.${s.outcome ?? "held"}`)}</div>
					<div className="text-dim">{t("siege.tally", { pc: s.stats?.pcKills ?? 0, allies: s.stats?.allyKills ?? 0, lost: s.stats?.residentsLost ?? 0 })}</div>
				</div>
			) : (
				<>
					<div>
						<div className="mb-1 text-[10px] uppercase tracking-wider text-faint">{t("siege.defenders")}</div>
						<div className="flex flex-col gap-1">
							{(here ? ["pc"] : []).concat(defenders.map((d) => d.npcId)).map((id) => {
								const sv = id === "pc" ? undefined : state.group?.survivors[id];
								const active = picking === id;
								return (
									<div key={id} className="flex items-center gap-1">
										<button
											disabled={busy || (!!sv && sv.hp <= 0)}
											className={`flex flex-1 items-center justify-between rounded border px-2 py-1 text-left text-xs transition ${active ? "border-gold bg-gold/15" : "border-line hover:bg-panel-3"}`}
											onClick={() => setPicking(active ? null : id)}
										>
											<span className={id === "pc" ? "text-gold-2" : "text-text"}>{name(id)}</span>
											<span className="text-faint">
												{postText(id)}
												{id === "pc" && move ? ` → ${t("siege.post", { x: move.x, y: move.y })}` : ""}
											</span>
										</button>
										{s.posts[id] && (
											<button className="text-faint hover:text-text" disabled={busy} title={t("siege.unassign")} aria-label={t("siege.unassign")} onClick={() => send({ op: "assign", who: id })}>
												<X size={13} />
											</button>
										)}
									</div>
								);
							})}
						</div>
						<div className="mt-1 text-[11px] italic text-faint">{picking ? t("siege.pickPost", { name: name(picking) }) : here && !s.posts.pc ? t("siege.noPostYou") : t("siege.pickHint")}</div>
						{picking && (
							<button className="mt-1 text-[11px] text-dim underline" onClick={() => setPicking(null)}>
								{t("siege.cancel")}
							</button>
						)}
					</div>

					<div className="flex items-center justify-between gap-2">
						<Tooltip content={lights.ok || s.lights ? t("siege.lightsInfo") : t("siege.lightsNo", { why: lights.why ?? "" })}>
							<span tabIndex={0} className="flex items-center gap-1 text-xs text-dim">
								{s.lights ? <Lightbulb size={14} className="text-gold" /> : <LightbulbOff size={14} />} {t("siege.lights")}
							</span>
						</Tooltip>
						<div className="flex gap-1">
							<button className="btn px-2 py-0.5 text-xs" data-active={s.lights} style={s.lights ? { borderColor: "var(--gold)" } : undefined} disabled={busy || s.lights || !lights.ok} onClick={() => send({ op: "lights", on: true })}>
								{t("siege.lightsOn")}
							</button>
							<button className="btn px-2 py-0.5 text-xs" style={!s.lights ? { borderColor: "var(--gold)" } : undefined} disabled={busy || !s.lights} onClick={() => send({ op: "lights", on: false })}>
								{t("siege.lightsOff")}
							</button>
						</div>
					</div>

					<div>
						<div className="mb-1 text-[10px] uppercase tracking-wider text-faint">{t("siege.walls")}</div>
						<div className="flex flex-wrap gap-1">
							{entries.map((e) => {
								const pct = e.max ? e.hp / e.max : 0;
								return (
									<span key={e.key} className={`rounded border px-1.5 py-0.5 text-[11px] ${pct < 0.34 ? "border-crimson/60 text-crimson-2" : pct < 0.67 ? "border-[#d99a2b]/60 text-[#d99a2b]" : "border-line text-dim"}`}>
										{t(e.kind === "door" ? "siege.door" : "siege.barricade")} {e.key} · {e.hp}/{e.max}
									</span>
								);
							})}
						</div>
						{b && <div className="mt-1 text-[11px] text-faint">{t("siege.stock", { ammo: b.stock.ammo, materials: b.stock.materials })}</div>}
					</div>

					{here && (
						<div className="flex flex-col gap-1.5 border-t border-line pt-2">
							<div className="flex flex-wrap gap-1">
								{ACTIONS.map(({ id, icon: Icon }) => (
									<Tooltip key={id} content={opts[id].ok ? t(`siege.actionInfo.${id}`) : (opts[id].why ?? "")}>
										<button className="btn px-2 py-1 text-xs" disabled={busy || !opts[id].ok} style={action === id ? { borderColor: "var(--crimson-2)" } : undefined} onClick={() => setChoice(id)}>
											<Icon size={13} /> {t(`siege.action.${id}`)}
										</button>
									</Tooltip>
								))}
							</div>
							{move && <div className="text-[11px] italic text-faint">{t("siege.moveHint")}</div>}
							<button
								className="btn btn-gold justify-center"
								disabled={busy || !canWave}
								onClick={() => {
									send({ op: "wave", action, ...(move ? { moveTo: move } : {}) });
									setMove(null);
									setPicking(null);
								}}
							>
								<Shield size={15} /> {s.phase === "active" ? t("siege.holdLine") : t("siege.waitFor")}
							</button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
