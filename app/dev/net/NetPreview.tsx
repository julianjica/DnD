"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef } from "react";
import type { GridMap, MapEntity, NetNode, NetRun, PortraitSpec } from "@/lib/game/types";
import { buildNetMap } from "@/lib/rules/netrun";
import { creatureCanvas, frameAround, paintPixelScene, type Frame, type Look } from "@/components/art/sprite/pixelScene";
import { gearFor, personLook } from "@/components/art/sprite/person";
import { NET_PALETTES, NET_STYLE, NODE_SPRITES, nodesOpen, nodeSpriteKey, traceBand, type NetStyleId } from "@/components/art/sprite/net";
import { drawNetSprite, netCreatureCanvas, nodeColors } from "@/components/art/sprite/netPaint";
import { NetRunHud, type NetRunView } from "@/components/play/NetRunHud";
import { useT } from "@/components/i18n/I18nProvider";

const BattleMap = dynamic(() => import("@/components/map/BattleMap"), { ssr: false, loading: () => <div className="grid h-full place-items-center text-stone-500">Loading renderer…</div> });

/**
 * PREVIEW ONLY: Root Access net runs. One sample network (laid out by the
 * engine's own buildNetMap) painted in three style options, with ICE, the
 * sysadmin and the runner's avatar; the node and ICE sprites at 4×; the
 * run HUD at a few trace levels; and the live battle map in the default style.
 */

const NODES: NetNode[] = [
	{ id: "n1", kind: "entry", name: "Lobby router", roomId: "", open: true },
	{ id: "n2", kind: "firewall", name: "Perimeter wall", roomId: "", open: true },
	{ id: "n3", kind: "data", name: "Payroll DB", roomId: "", open: true },
	{ id: "n4", kind: "control", name: "Lobby cameras", roomId: "", open: false, controls: "the lobby cameras" },
	{ id: "n5", kind: "honeypot", name: "Exec mailbox", roomId: "", open: false, disguise: "Exec mailbox" },
	{ id: "n6", kind: "honeypot", name: "Old backups", roomId: "", open: true, disguise: "Old backups" },
	{ id: "n7", kind: "firewall", name: "Core firewall", roomId: "", open: false },
	{ id: "n8", kind: "admin", name: "Root console", roomId: "", open: false },
	{ id: "n9", kind: "vault", name: "Project Halcyon", roomId: "", open: false },
	{ id: "n10", kind: "control", name: "Server-room doors", roomId: "", open: true },
];

function sample(): { map: GridMap; run: NetRun; looks: Record<string, Look> } {
	const nodes = NODES.map((n) => ({ ...n }));
	const map = buildNetMap(nodes, "Vantis lab server 7", 7);
	map.id = "net-preview";
	const room = (id: string) => map.rooms.find((r) => r.id === nodes.find((n) => n.id === id)!.roomId)!;
	const at = (id: string, dx: number, dy: number) => {
		const r = room(id);
		return { x: r.x + Math.floor(r.w / 2) + dx, y: r.y + Math.floor(r.h / 2) + dy };
	};
	const fw = room("n7");
	let k = 0;
	const ent = (kind: MapEntity["kind"], sprite: string, name: string, p: { x: number; y: number }, extra: Partial<MapEntity> = {}): MapEntity => ({ id: `e${k++}`, kind, sprite, name, x: p.x, y: p.y, size: 1, ...extra });
	map.entities = [
		ent("pc", "pc", "Vex", { x: fw.x - 2, y: fw.y + Math.floor(fw.h / 2) }),
		ent("monster", "ice_white", "Watchdog", at("n4", 1, 0)),
		ent("monster", "ice_white", "Barrier", at("n3", 1, 1), { dead: true }),
		ent("monster", "ice_grey", "Sparky", { x: fw.x - 4, y: fw.y + Math.floor(fw.h / 2) }),
		ent("monster", "ice_black", "Hellhound", { x: fw.x + 1, y: fw.y + 1 }),
		ent("monster", "ice_black", "Wraith", at("n9", -1, 1)),
		ent("monster", "sysadmin", "Sysadmin", at("n8", 1, 1)),
	];
	const run: NetRun = {
		id: "run-preview",
		target: "Vantis lab server 7",
		security: 3,
		body: "public",
		netMapId: map.id,
		nodes,
		trace: 6,
		proxy: 0,
		sysadminAlerted: true,
		securityDispatched: false,
		startedAt: 0,
		log: [],
	};
	const spec: PortraitSpec = { seed: 3, skinTone: "#c68a5a", hairStyle: "wild", hairColor: "#2a1a3a", eyeColor: "#3a2a20", features: [], background: "plain", gender: "female", age: 0.3 };
	const looks = { e0: personLook(spec, "human", gearFor({ ruleset: "cyberpunk", text: "hacker" }), { ruleset: "cyberpunk", text: "hacker" }) };
	return { map, run, looks };
}

function SceneCanvas({ map, run, looks, frame, style, scale }: { map: GridMap; run: NetRun; looks: Record<string, Look>; frame: Frame; style: NetStyleId; scale: number }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		if (ref.current) paintPixelScene(ref.current, { map, looks, time: "night", weather: "clear", net: { run, style } }, frame);
	}, [map, run, looks, frame, style]);
	return <canvas ref={ref} style={{ width: frame.w * 16 * scale, height: frame.h * 16 * scale, imageRendering: "pixelated", maxWidth: "none" }} />;
}

const kinds = ["entry", "firewall", "data", "honeypot", "control", "admin", "vault"] as const;

/** The node sprites (closed and open) and the creatures of the net, at 4×. */
function Sheet({ style, looks }: { style: NetStyleId; looks: Record<string, Look> }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const c = ref.current;
		if (!c) return;
		const P = NET_PALETTES[style];
		c.width = 18 * 7 + 2;
		c.height = 18 * 3 + 2;
		const ctx = c.getContext("2d")!;
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = P.bg;
		ctx.fillRect(0, 0, c.width, c.height);
		kinds.forEach((k, i) => {
			for (const open of [false, true]) {
				const col = nodeColors(P, k, open);
				ctx.fillStyle = P.nodeFloor;
				ctx.fillRect(2 + i * 18, 2 + (open ? 18 : 0), 16, 16);
				drawNetSprite(ctx, NODE_SPRITES[nodeSpriteKey(k, open)], 2 + i * 18, 2 + (open ? 18 : 0), col);
			}
		});
		const people: { kind: MapEntity["kind"]; sprite: string; dead?: boolean }[] = [
			{ kind: "monster", sprite: "ice_white" },
			{ kind: "monster", sprite: "ice_grey" },
			{ kind: "monster", sprite: "ice_black" },
			{ kind: "monster", sprite: "sysadmin" },
			{ kind: "pc", sprite: "pc" },
			{ kind: "npc", sprite: "npc" },
			{ kind: "monster", sprite: "ice_black", dead: true },
		];
		people.forEach((e, i) => {
			const cv = netCreatureCanvas(e, !!e.dead, () => creatureCanvas({ kind: e.kind === "monster" ? "npc" : e.kind, sprite: e.sprite }, e.kind === "pc" ? looks.e0 : undefined, false), style);
			ctx.drawImage(cv, 2 + i * 18, 2 + 36);
		});
	}, [style, looks]);
	return (
		<div>
			<canvas ref={ref} style={{ width: (18 * 7 + 2) * 4, imageRendering: "pixelated", maxWidth: "100%" }} />
			<div className="mt-1 grid grid-cols-7 text-[10px] text-stone-400" style={{ width: (18 * 7 + 2) * 4, maxWidth: "100%" }}>
				{kinds.map((k) => <span key={k}>{k}</span>)}
			</div>
			<div className="text-[10px] text-stone-500">row 1 closed · row 2 open (breached / read / taken; a sprung honeypot) · row 3: white, grey, black ICE, sysadmin, the runner&apos;s avatar, another decker, derezzed ICE</div>
		</div>
	);
}

const HUD_SAMPLES: { trace: number; body: NetRun["body"]; security: number; target: string }[] = [
	{ trace: 2, body: "den", security: 1, target: "Café Lirio wifi" },
	{ trace: 6, body: "public", security: 3, target: "Vantis lab server 7" },
	{ trace: 9, body: "onsite", security: 5, target: "Ferro Security core" },
];

export default function NetPreview() {
	const { lang, setLang } = useT();
	const { map, run, looks } = useMemo(() => sample(), []);
	const full: Frame = useMemo(() => ({ x0: 0, y0: 0, w: map.width, h: map.height }), [map]);
	const close: Frame = useMemo(() => frameAround(map, 18, 22, 5), [map]);
	const pixel = useMemo(() => ({ looks }), [looks]);
	const net = useMemo(() => ({ run }), [run]);
	return (
		<main className="min-h-screen space-y-8 bg-[#0b0b0e] p-6 text-stone-200">
			<header>
				<h1 className="font-display text-2xl">Root Access · the net (preview)</h1>
				<p className="mt-1 max-w-3xl text-sm text-stone-400">
					One sample system laid out by the engine (entry → breached perimeter firewall → payroll data (read), cameras, a honeypot posing as data, a sprung honeypot → the closed core firewall → admin, the vault, server-room doors (taken)). ICE: white (watchdog; one derezzed), grey (sparky), black (hellhound, wraith), and the sysadmin. The runner stands at the core firewall. In the game: option <b>{NET_STYLE}</b> (NET_STYLE in components/art/sprite/net.ts).
				</p>
			</header>

			{(["A", "B", "C"] as const).map((s) => (
				<section key={s} className="space-y-3 rounded-lg border border-white/10 p-4" data-testid={`net-option-${s}`}>
					<h2 className="font-display text-xl">
						Option {s} · {NET_PALETTES[s].label} {s === NET_STYLE && <span className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-200">default</span>}
					</h2>
					<div className="overflow-x-auto">
						<div className="mb-1 text-xs text-stone-500">real size (16 px per square)</div>
						<SceneCanvas map={map} run={run} looks={looks} frame={full} style={s} scale={1} />
					</div>
					<div className="flex flex-wrap items-start gap-6">
						<div className="overflow-x-auto">
							<div className="mb-1 text-xs text-stone-500">scene panel close-up, 3×</div>
							<SceneCanvas map={map} run={run} looks={looks} frame={close} style={s} scale={3} />
						</div>
						<Sheet style={s} looks={looks} />
					</div>
				</section>
			))}

			<section className="space-y-3 rounded-lg border border-white/10 p-4" data-testid="net-hud">
				<div className="flex items-center gap-3">
					<h2 className="font-display text-xl">Run HUD</h2>
					<button className="rounded border border-white/20 px-2 py-0.5 text-xs" onClick={() => setLang(lang === "en" ? "es" : "en")}>{lang === "en" ? "Español" : "English"}</button>
				</div>
				<div className="max-w-4xl overflow-hidden rounded border border-white/10 bg-bg">
					{HUD_SAMPLES.map((h) => {
						const r: NetRun = { ...run, ...h };
						const view: NetRunView = { run: r, ...nodesOpen(r), band: traceBand(r.trace) };
						return <NetRunHud key={h.trace} state={{ cyber: undefined }} view={view} />;
					})}
				</div>
			</section>

			<section className="space-y-2 rounded-lg border border-white/10 p-4" data-testid="net-battle">
				<h2 className="font-display text-xl">Battle map (live renderer, option {NET_STYLE})</h2>
				<div className="h-[460px] max-w-5xl overflow-hidden rounded border border-white/10">
					<BattleMap map={map} pixel={pixel} net={net} fog={false} initialView="fit" className="h-full w-full" />
				</div>
			</section>
		</main>
	);
}
