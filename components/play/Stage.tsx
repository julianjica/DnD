"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Footprints, Map as MapIcon, Globe2, Image as ImageIcon, Swords, Wand2, Wind, ShieldHalf, HandHelping, EyeOff, FlaskConical, Zap, Hourglass, Skull, X } from "lucide-react";
import type { Combatant, GameState, GridMap, MapEntity, PlayerCombatAction, SpellInfo } from "@/lib/game/types";
import { SceneArt } from "@/components/art/SceneArt";
import { SpriteScene } from "@/components/art/sprite/SpriteScene";
import type { Look } from "@/components/art/sprite/pixelScene";
import { portraitTraits } from "@/lib/art/portrait";
import { findPath, previewSpell, reachable, type SpellPreview } from "@/lib/rules/combat";
import { isPassable } from "@/lib/maps/grid";
import { deriveSheet } from "@/lib/rules/character";
import { getSpell } from "@/lib/srd";
import type { AoeTemplate } from "@/lib/maps/aoe";
import type { FxItem } from "./useGame";
import type { MapFxEvent, TokenStatus } from "@/components/map/BattleMap";
import { useT } from "@/components/i18n/I18nProvider";
import { Tooltip } from "@/components/ui/Tooltip";
import { CreatureCard, CreatureTypeLine } from "./CreatureCard";
import { SpellAdvChips, SpellCard, SpellLive } from "./SpellCard";
import type { MessageKey } from "@/lib/i18n";

function Loading({ k }: { k: MessageKey }) {
	const { t } = useT();
	return <div className="grid h-full place-items-center text-dim">{t(k)}</div>;
}

const BattleMap = dynamic(() => import("@/components/map/BattleMap"), { ssr: false, loading: () => <Loading k="play.stage.loadingMap" /> });
const WorldMap = dynamic(() => import("@/components/map/WorldMap"), { ssr: false, loading: () => <Loading k="play.stage.loadingWorld" /> });

type Point = { x: number; y: number };
type Mode = { kind: "move" } | { kind: "attack"; itemId?: string; label: string } | { kind: "cast"; spell: SpellInfo; slotLevel: number; targets: string[] };

/** BFS over passable tiles for free (out-of-combat) movement. */
function explorePath(map: GridMap, from: Point, to: Point): Point[] | null {
	const W = map.width;
	const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < map.height && map.explored[y * W + x] && isPassable(map.tiles[y * W + x]) && map.tiles[y * W + x] !== "deep_water";
	if (!ok(to.x, to.y)) return null;
	const prev = new Int32Array(W * map.height).fill(-1);
	const start = from.y * W + from.x;
	prev[start] = start;
	const q = [start];
	while (q.length) {
		const cur = q.shift()!;
		if (cur === to.y * W + to.x) break;
		const cx = cur % W;
		const cy = Math.floor(cur / W);
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				if (!dx && !dy) continue;
				const nx = cx + dx;
				const ny = cy + dy;
				if (!ok(nx, ny)) continue;
				if (dx && dy && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue;
				const n = ny * W + nx;
				if (prev[n] !== -1) continue;
				prev[n] = cur;
				q.push(n);
			}
	}
	const goal = to.y * W + to.x;
	if (prev[goal] === -1) return null;
	const path: Point[] = [];
	for (let c = goal; c !== start; c = prev[c]) path.unshift({ x: c % W, y: Math.floor(c / W) });
	return path;
}

function Initiative({ state }: { state: GameState }) {
	const { t, te, ts } = useT();
	const e = state.encounter!;
	return (
		<div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2">
			<span className="mr-1 shrink-0 font-display text-xs text-gold">{t("play.combat.round", { n: e.round })}</span>
			{e.order.map((id, i) => {
				const c = e.combatants[id];
				if (!c) return null;
				const active = i === e.turnIndex;
				const pct = c.maxHp ? (c.hp / c.maxHp) * 100 : 0;
				const color = c.side === "party" ? "border-emerald/70" : c.side === "enemy" ? "border-crimson/70" : "border-line";
				const card = (
					<div tabIndex={c.stats && c.kind !== "pc" ? 0 : undefined} className={`relative shrink-0 rounded-md border px-2 py-1 text-xs transition outline-none focus-visible:ring-1 focus-visible:ring-gold ${color} ${active ? "scale-105 bg-gold/15 shadow-[0_0_12px_rgba(212,166,74,0.4)]" : "bg-bg-2/80"} ${c.dead ? "opacity-40" : ""} ${c.stats && c.kind !== "pc" ? "cursor-help" : ""}`}>
						<div className={`flex items-center gap-1 ${c.dead ? "line-through" : ""}`}>
							<span className="tabular-nums text-faint">{c.initiative}</span>
							<span className={active ? "text-gold-2" : "text-text"}>{ts(c.name)}</span>
							{c.dead && <Skull size={11} />}
						</div>
						<CreatureTypeLine c={c} className="text-[10px] italic leading-tight text-dim" />
						{c.side === "party" || c.dead ? (
							<div className="mt-0.5 h-1 w-full overflow-hidden rounded bg-bg">
								<div className="h-full bg-hp" style={{ width: `${pct}%` }} />
							</div>
						) : (
							<div className="mt-0.5 text-[9px] uppercase tracking-wider text-faint">{te("health", pct >= 100 ? "unhurt" : pct > 50 ? "wounded" : pct > 0 ? "bloodied" : "down")}</div>
						)}
					</div>
				);
				return c.stats && c.kind !== "pc" ? (
					<Tooltip key={id} content={<CreatureCard c={c} />} side="bottom" widthClass="max-w-sm" className="shrink-0">
						{card}
					</Tooltip>
				) : (
					<span key={id} className="shrink-0">{card}</span>
				);
			})}
		</div>
	);
}

function Pip({ on, label }: { on: boolean; label: string }) {
	return (
		<span className={`inline-flex items-center gap-1 text-[11px] ${on ? "text-gold-2" : "text-faint line-through"}`}>
			<span className={`h-2 w-2 rounded-full ${on ? "bg-gold" : "bg-line"}`} />
			{label}
		</span>
	);
}

function ActionBar(props: { state: GameState; pc: Combatant; mode: Mode; setMode: (m: Mode) => void; act: (a: PlayerCombatAction) => void; busy: boolean }) {
	const { state, pc, mode, setMode, act, busy } = props;
	const { t: tr, te, ts } = useT();
	const sheet = useMemo(() => {
		try {
			return deriveSheet(state.character);
		} catch {
			return null;
		}
	}, [state.character]);
	const t = pc.turn;
	const sc = state.character.spellcasting;
	const spells = useMemo(() => {
		if (!sc) return [];
		return [...new Set(sc.classes.flatMap((k) => [...k.cantrips, ...k.prepared]))]
			.map((s) => getSpell(s))
			.filter((s): s is SpellInfo => !!s && /action|bonus/i.test(s.castingTime));
	}, [sc]);
	const potions = state.character.inventory.filter((i) => /potion/i.test(i.name));
	const features = state.character.features.filter((f) => /second-wind|action-surge|second wind|action surge/i.test(f.id + f.name));
	const dying = pc.hp <= 0 && !pc.dead;
	const [spellMenu, setSpellMenu] = useState(false);
	// While the spell menu is open: what the engine would apply right now against the nearest enemy, per spell.
	const live = useMemo(() => {
		const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
		const enc = state.encounter;
		if (!spellMenu || !map || !enc) return undefined;
		const out = new Map<string, SpellPreview | string>();
		for (const s of spells) if (s.attack || s.save) out.set(s.index, previewSpell({ encounter: enc, map, character: state.character }, pc.id, s));
		return out;
	}, [spellMenu, spells, state.activeMapId, state.maps, state.encounter, state.character, pc.id]);
	const liveName = (r: SpellPreview | string | undefined) => (r && typeof r !== "string" ? ts(state.encounter?.combatants[r.targetId]?.name ?? "") : undefined);

	const slotFor = (s: SpellInfo) => {
		if (s.level === 0) return 0;
		for (let l = s.level; l <= 9; l++) if ((sc?.slots[l - 1] ?? 0) - (sc?.slotsUsed[l - 1] ?? 0) > 0) return l;
		if (sc?.pact && sc.pact.used < sc.pact.max && sc.pact.level >= s.level) return sc.pact.level;
		return -1;
	};

	if (dying)
		return (
			<div className="flex items-center gap-3 px-3 py-2">
				<span className="text-sm text-crimson-2">{tr("play.combat.dying")}</span>
				<button className="btn btn-gold" disabled={busy} onClick={() => act({ type: "death_save" })}>
					<Skull size={15} /> {tr("play.combat.deathSave")}
				</button>
				<button className="btn" disabled={busy} onClick={() => act({ type: "end_turn" })}>{tr("play.combat.endTurn")}</button>
			</div>
		);

	return (
		<div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
			<div className="mr-2 flex flex-col gap-0.5">
				<span className="text-[11px] text-dim"><Footprints size={11} className="inline" /> {t.movementLeft} {tr("play.unit.ft")}</span>
				<div className="flex gap-2">
					<Pip on={t.action} label={tr("play.combat.action")} />
					<Pip on={t.bonusAction} label={tr("play.combat.bonus")} />
					<Pip on={t.reaction} label={tr("play.combat.reaction")} />
				</div>
			</div>
			<button className="btn" data-active={mode.kind === "move"} style={mode.kind === "move" ? { borderColor: "var(--gold)" } : undefined} onClick={() => setMode({ kind: "move" })} title={tr("play.combat.moveTitle")}>
				<Footprints size={15} /> {tr("play.combat.move")}
			</button>
			{(sheet?.attacks.length ? sheet.attacks : [{ name: tr("play.combat.unarmed"), itemId: undefined, toHit: 0, damage: "1" }]).slice(0, 3).map((a, i) => (
				<button
					key={i}
					className="btn"
					disabled={busy || (!t.action && t.attacksLeft <= 0)}
					style={mode.kind === "attack" && mode.itemId === a.itemId ? { borderColor: "var(--crimson-2)" } : undefined}
					onClick={() => setMode({ kind: "attack", itemId: a.itemId, label: a.name })}
					title={tr("play.combat.attackTitle", { name: ts(a.name), hit: `${a.toHit >= 0 ? "+" : ""}${a.toHit}`, dmg: a.damage })}
				>
					<Swords size={15} /> {ts(a.name)}
					{t.attacksLeft > 1 && <span className="text-xs text-gold">×{t.attacksLeft}</span>}
				</button>
			))}
			{spells.length > 0 && (
				<div className="relative">
					<button className="btn" disabled={busy} onClick={() => setSpellMenu((v) => !v)} style={mode.kind === "cast" ? { borderColor: "var(--violet)" } : undefined}>
						<Wand2 size={15} /> {mode.kind === "cast" ? ts(mode.spell.name) : tr("play.cast")}
					</button>
					{spellMenu && (
						<div className="panel absolute bottom-full left-0 z-30 mb-2 max-h-72 w-72 overflow-y-auto p-1.5">
							{spells.map((s) => {
								const slot = slotFor(s);
								const bonus = /bonus/i.test(s.castingTime);
								const can = slot >= 0 && (bonus ? t.bonusAction : t.action);
								const r = live?.get(s.index);
								return (
									<Tooltip key={s.index} className="flex w-full" widthClass="max-w-sm" content={<SpellCard spell={s} live={r} liveName={liveName(r)} />}>
										<button
											disabled={!can}
											className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-panel-3 disabled:opacity-40"
											onClick={() => {
												setSpellMenu(false);
												setMode({ kind: "cast", spell: s, slotLevel: Math.max(0, slot), targets: [] });
											}}
										>
											<span className="flex items-center gap-1.5">{ts(s.name)}<SpellAdvChips spell={s} /></span>
											<span className="text-xs text-faint">{s.level === 0 ? tr("play.combat.cantrip") : tr("play.spells.slot", { n: slot > 0 ? slot : s.level })}
												{bonus ? ` · ${tr("play.combat.bonusShort")}` : ""}
												{s.area ? ` · ${te("shape", s.area.shape)}` : ""}</span>
										</button>
									</Tooltip>
								);
							})}
						</div>
					)}
				</div>
			)}
			<span className="mx-1 h-6 w-px bg-line" />
			<button className="btn" disabled={busy || !t.action} onClick={() => act({ type: "dash" })} title={tr("play.combat.dash")}><Wind size={15} /></button>
			<button className="btn" disabled={busy || !t.action} onClick={() => act({ type: "disengage" })} title={tr("play.combat.disengage")}><ShieldHalf size={15} /></button>
			<button className="btn" disabled={busy || !t.action} onClick={() => act({ type: "dodge" })} title={tr("play.combat.dodge")}><Zap size={15} /></button>
			<button className="btn" disabled={busy || !t.action} onClick={() => act({ type: "hide" })} title={tr("play.combat.hide")}><EyeOff size={15} /></button>
			{potions.length > 0 && (
				<button className="btn" disabled={busy || !t.bonusAction} onClick={() => act({ type: "use_item", itemId: potions[0].id })} title={tr("play.combat.drink", { name: ts(potions[0].name) })}>
					<FlaskConical size={15} className="text-crimson-2" />
				</button>
			)}
			{features.map((f) => (
				<button key={f.id} className="btn" disabled={busy || (f.uses ? f.uses.used >= f.uses.max : false)} onClick={() => act({ type: "use_feature", featureId: f.id })} title={ts(f.name)}>
					<HandHelping size={15} /> {ts(f.name)}
				</button>
			))}
			<button className="btn btn-gold ml-auto" disabled={busy} onClick={() => act({ type: "end_turn" })}>
				<Hourglass size={15} /> {tr("play.combat.endTurn")}
			</button>
		</div>
	);
}

export function Stage(props: { state: GameState; busy: boolean; fx: FxItem[]; act: (a: PlayerCombatAction) => void; setView: (v: GameState["view"]) => void }) {
	const { state, busy, act } = props;
	const { t, te, ts } = useT();
	const view = state.view;
	const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	const enc = state.encounter?.status === "active" ? state.encounter : undefined;
	const pc = enc?.combatants[state.character.id];
	const myTurn = !!enc && enc.order[enc.turnIndex] === state.character.id;
	const [mode, setMode] = useState<Mode>({ kind: "move" });
	const [hover, setHover] = useState<Point | null>(null);

	const pcEntity = map?.entities.find((e) => e.kind === "pc");
	const artStyle = state.settings.art?.scenes ?? "paintings";
	// The sprite scene shows the active map only while the party is still at the place it belongs to.
	const here = state.world.locations.find((l) => l.id === state.world.currentLocationId);
	const spriteMap = artStyle === "sprites" && map && (!here || here.mapIds.includes(map.id)) ? map : undefined;
	const pixelMap = artStyle === "sprites" ? map : undefined;
	const looks = useMemo(() => {
		if (!pixelMap) return {};
		const out: Record<string, Look> = {};
		const lookOf = (spec: GameState["character"]["portrait"], species?: string): Look => ({ hair: spec.hairColor, skin: spec.skinTone, cloth: portraitTraits(spec, species).clothing });
		for (const e of pixelMap.entities) {
			if (e.kind === "pc") out[e.id] = lookOf(state.character.portrait, state.character.speciesId);
			else if (e.npcId && state.npcs[e.npcId]) out[e.id] = lookOf(state.npcs[e.npcId].portrait, state.npcs[e.npcId].speciesId);
		}
		return out;
	}, [pixelMap, state.character, state.npcs]);
	const pixel = useMemo(() => (pixelMap ? { looks } : undefined), [pixelMap, looks]);
	const deadIds = useMemo(() => new Set(Object.values(state.encounter?.combatants ?? {}).filter((c) => c.dead).map((c) => c.entityId)), [state.encounter]);

	const reach = useMemo(() => {
		if (!enc || !map || !myTurn || mode.kind !== "move" || busy) return undefined;
		try {
			return new Set(reachable(enc, map, state.character.id).map((p) => `${p.x},${p.y}`));
		} catch {
			return undefined;
		}
	}, [enc, map, myTurn, mode.kind, busy, state.character.id]);

	const preview = useMemo(() => {
		if (!map || !hover || busy) return undefined;
		if (enc) {
			if (!myTurn || mode.kind !== "move" || !reach?.has(`${hover.x},${hover.y}`)) return undefined;
			const r = findPath(enc, map, state.character.id, hover, pc?.turn.movementLeft);
			return r ? { path: [{ x: pcEntity!.x, y: pcEntity!.y }, ...r.path], cost: r.cost } : undefined;
		}
		if (!pcEntity) return undefined;
		const p = explorePath(map, pcEntity, hover);
		return p ? { path: [{ x: pcEntity.x, y: pcEntity.y }, ...p], cost: p.length * 5 } : undefined;
	}, [map, hover, busy, enc, myTurn, mode.kind, reach, state.character.id, pc, pcEntity]);

	const aoe: (AoeTemplate & { color?: number }) | null = useMemo(() => {
		if (mode.kind !== "cast" || !mode.spell.area || !hover || !pcEntity) return null;
		const a = mode.spell.area;
		const selfOrigin = /^self/i.test(mode.spell.range);
		const shape = a.shape === "cylinder" ? "cylinder" : a.shape;
		return selfOrigin
			? { shape, origin: { x: pcEntity.x, y: pcEntity.y }, size: a.size, toward: hover, color: 0x8f6cc4 }
			: { shape, origin: hover, size: a.size, color: 0x8f6cc4 };
	}, [mode, hover, pcEntity]);

	// Darkvision range in squares (60 ft = 12; Superior Darkvision 120 ft = 24).
	const darkvision = useMemo(() => {
		const ids = state.character.features.map((f) => f.id);
		return ids.includes("superior-darkvision") ? 24 : ids.some((id) => id === "darkvision" || id.endsWith("-darkvision")) ? 12 : 0;
	}, [state.character.features]);
	const status = useMemo(() => {
		const s: Record<string, TokenStatus> = {};
		if (!enc) return s;
		for (const c of Object.values(enc.combatants)) s[c.entityId] = { hp: c.hp, maxHp: c.maxHp, side: c.side, dead: c.dead, conditions: c.conditions.map((x) => x.id) };
		return s;
	}, [enc]);

	const mapFx: MapFxEvent[] = useMemo(
		() =>
			props.fx
				.filter((f) => f.kind === "damage" || f.kind === "heal" || f.kind === "miss")
				.map((f) => ({
					id: f.id,
					entityId: f.entityId ?? pcEntity?.id,
					text: f.kind === "miss" ? t("play.fx.miss") : `${f.kind === "heal" ? "+" : "-"}${f.amount}`,
					kind: f.kind as MapFxEvent["kind"],
				})),
		[props.fx, pcEntity?.id, t],
	);

	// Cast mode: the engine's adv/dis verdict against the hovered creature (else the nearest enemy).
	const castLive = useMemo(() => {
		if (mode.kind !== "cast" || !enc || !map || (!mode.spell.attack && !mode.spell.save)) return undefined;
		const ent = hover
			? map.entities.find((e) => e.combatantId && e.combatantId !== state.character.id && !e.hidden && hover.x >= e.x && hover.x < e.x + (e.size || 1) && hover.y >= e.y && hover.y < e.y + (e.size || 1))
			: undefined;
		const r = previewSpell({ encounter: enc, map, character: state.character }, state.character.id, mode.spell, ent?.combatantId);
		return { r, name: typeof r === "string" ? undefined : ts(enc.combatants[r.targetId]?.name ?? "") };
	}, [mode, enc, map, hover, state.character, ts]);

	const onSquareClick = (p: Point) => {
		if (busy || !map) return;
		if (!enc) {
			const path = explorePath(map, pcEntity!, p);
			if (path?.length) act({ type: "move", path });
			return;
		}
		if (!myTurn) return;
		if (mode.kind === "move" && preview?.path.length) act({ type: "move", path: preview.path.slice(1) });
		if (mode.kind === "cast" && mode.spell.area) {
			act({ type: "cast", spell: mode.spell.index, slotLevel: mode.slotLevel, point: p });
			setMode({ kind: "move" });
		}
	};

	const onTokenClick = (ent: MapEntity) => {
		if (busy || !enc || !myTurn || !ent.combatantId) return;
		if (mode.kind === "attack") {
			act({ type: "attack", targetId: ent.combatantId, itemId: mode.itemId });
			return;
		}
		if (mode.kind === "cast" && !mode.spell.area) {
			act({ type: "cast", spell: mode.spell.index, slotLevel: mode.slotLevel, targetIds: [ent.combatantId] });
			setMode({ kind: "move" });
		}
	};

	const tabs: { id: GameState["view"]; icon: typeof MapIcon; disabled?: boolean }[] = [
		{ id: "scene", icon: ImageIcon },
		{ id: "map", icon: MapIcon, disabled: !map },
		{ id: "world", icon: Globe2 },
	];

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div className="flex items-center justify-between border-b border-line px-2">
				<div className="flex">
					{tabs.map((tb) => (
						<button
							key={tb.id}
							disabled={tb.disabled}
							onClick={() => props.setView(tb.id)}
							className={`flex items-center gap-1.5 px-3 py-2 text-sm transition disabled:opacity-30 ${view === tb.id ? "text-gold-2" : "text-faint hover:text-dim"}`}
						>
							<tb.icon size={15} /> {te("view", tb.id)}
						</button>
					))}
				</div>
				{enc && <span className="flex items-center gap-1.5 pr-2 font-display text-xs uppercase tracking-widest text-crimson-2"><Swords size={14} /> {t("play.combat.banner")}{myTurn ? ` · ${t("play.combat.yourTurn")}` : ""}</span>}
			</div>
			{enc && <div className="border-b border-line bg-bg-2/50"><Initiative state={state} /></div>}

			<div className="relative min-h-0 flex-1 overflow-hidden">
				{view === "scene" && (
					<div className="flex h-full items-center justify-center bg-bg p-3">
						<SceneArt style={artStyle === "sprites" ? "paintings" : artStyle} backdrop={spriteMap ? <SpriteScene map={spriteMap} looks={looks} dead={deadIds} time={state.scene.timeOfDay} weather={state.scene.weather} /> : undefined} scene={state.scene} npcs={state.scene.npcIds.map((id) => state.npcs[id]).filter(Boolean).map((n) => ({ id: n.id, name: n.name, portrait: n.portrait, speciesId: n.speciesId, role: n.role }))} className="max-h-full w-full rounded-lg shadow-2xl" />
					</div>
				)}
				{view === "map" && map && (
					<BattleMap
						map={map}
						pixel={pixel}
						status={status}
						highlights={reach}
						highlightColor={0x5b8fb9}
						pathPreview={preview?.path}
						pathLabel={preview ? `${preview.cost} ${t("play.unit.ft")}` : undefined}
						aoe={aoe}
						darkvision={darkvision}
						focus={enc ? (enc.combatants[enc.order[enc.turnIndex]]?.entityId ?? null) : (pcEntity?.id ?? null)}
						events={mapFx}
						onSquareClick={(p) => onSquareClick(p)}
						onTokenClick={(e) => onTokenClick(e)}
						onSquareHover={setHover}
						className="h-full w-full"
					/>
				)}
				{view === "world" && (
					<div className="h-full w-full bg-bg">
						<WorldMap world={state.world} selectedLocationId={state.world.currentLocationId} className="h-full w-full" />
					</div>
				)}
				{mode.kind !== "move" && enc && myTurn && (
					<div className="panel absolute left-1/2 top-3 z-20 flex -translate-x-1/2 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm">
						{mode.kind === "attack" ? t("play.combat.chooseTarget", { name: ts(mode.label) }) : mode.kind === "cast" ? (mode.spell.area ? t("play.combat.chooseArea", { name: ts(mode.spell.name) }) : t("play.combat.chooseTarget", { name: ts(mode.spell.name) })) : ""}
						<button className="text-faint hover:text-text" title={t("common.cancel")} aria-label={t("common.cancel")} onClick={() => setMode({ kind: "move" })}><X size={14} /></button>
						{castLive && (
							<div className="basis-full text-xs" data-testid="cast-live">
								<SpellLive live={castLive.r} name={castLive.name} />
							</div>
						)}
					</div>
				)}
			</div>

			{enc && pc && view === "map" && (
				<div className="border-t border-line bg-bg-2/80">
					{myTurn ? <ActionBar state={state} pc={pc} mode={mode} setMode={setMode} act={act} busy={busy} /> : <div className="px-3 py-3 text-sm text-dim font-fell italic">{busy ? t("play.combat.enemiesAct") : t("play.combat.waiting", { name: ts(enc.combatants[enc.order[enc.turnIndex]]?.name ?? "…") })}</div>}
				</div>
			)}
		</div>
	);
}
