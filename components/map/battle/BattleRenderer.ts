import type * as PIXI from "pixi.js";
import type { GridMap, MapEntity } from "@/lib/game/types";
import { aoeSquares, type AoeTemplate } from "@/lib/maps/aoe";
import { computeFov, computePlayerView, parseKey, sqKey, type Point } from "@/lib/maps/grid";
import { rand2 } from "@/lib/maps/noise";
import { paintMap, tileSizeFor } from "../art/tilePainter";
import { isStreetLamp, paintPixelMap, pixelProp, pixelToken, type Look } from "@/components/art/sprite/pixelScene";
import type { NetOpts } from "@/components/art/sprite/netPaint";
import { hasProp, lightStyle, paintProp, paintToken, ringFor } from "../art/tokens";

type Pixi = typeof PIXI;

export interface MapFxEvent {
	/** Stable id: each event animates exactly once. */
	id: string;
	entityId?: string;
	x?: number;
	y?: number;
	text: string;
	kind?: "damage" | "heal" | "miss" | "crit" | "info";
}

export interface TokenStatus {
	hp?: number;
	maxHp?: number;
	side?: "party" | "enemy" | "neutral";
	dead?: boolean;
	conditions?: string[];
}

export interface RendererCallbacks {
	onSquareClick?: (p: Point, e: PointerEvent) => void;
	onTokenClick?: (entity: MapEntity, e: PointerEvent) => void;
	onSquareHover?: (p: Point | null) => void;
}

export interface RenderInput {
	map: GridMap;
	entities: MapEntity[];
	status: Record<string, TokenStatus>;
	visible?: Set<string>;
	fog: boolean;
	showHidden: boolean;
	highlights?: Set<string>;
	highlightColor: number;
	path?: Point[];
	pathLabel?: string;
	aoe?: (AoeTemplate & { color?: number }) | null;
	selectedId?: string;
	showGrid: boolean;
	darkvision?: number;
	/** Pixel-sprite style (matches the scene panel): looks per entity id for PCs/NPCs. */
	pixel?: { looks: Record<string, Look> };
	/** The Quiet: false once the grid has failed; street lamps give no light. Default true. */
	powerOn?: boolean;
	/** Hover label for barricade squares (translated), e.g. "Barricade". */
	barricadeLabel?: string;
	/** Extra hover text per entity id, shown after the name outside combat (The Quiet: a survivor's HP and morale). */
	notes?: Record<string, string>;
	/** Exits to other maps, keyed "x,y": the destination's name (hover label). */
	exits?: Record<string, string>;
	/** The Quiet: siege posts, keyed "x,y": who holds them (hover label). */
	marks?: Record<string, string>;
	/** Root Access net maps (theme "net", always pixel-drawn): the run's node state and a style override. */
	net?: NetOpts;
}

/** What of the net options changes the painted map (node open state, style). */
function netSig(inp: RenderInput): string {
	if (inp.map.theme !== "net") return "";
	const run = inp.net?.run;
	return `${inp.net?.style ?? ""}|${run && run.netMapId === inp.map.id ? run.nodes.map((n) => `${n.roomId}:${n.kind}:${n.open ? 1 : 0}`).join(",") : ""}`;
}

/** Light radius an entity actually casts (street lamps are dark without power). */
function lightRadiusOf(e: MapEntity, inp: RenderInput): number {
	if (inp.powerOn === false && (e.lightRadius ?? 0) > 0 && isStreetLamp(e, inp.map.theme === "modern")) return 0;
	return e.lightRadius ?? 0;
}

interface TokenView {
	id: string;
	root: PIXI.Container;
	body: PIXI.Container;
	sprite: PIXI.Sprite;
	hp: PIXI.Graphics;
	glow?: PIXI.Sprite;
	key: string;
	cur: Point;
	from: Point;
	to: Point;
	t: number;
	dur: number;
	size: number;
	shake: number;
	flash: number;
	light?: { color: number; flicker: number; radius: number; phase: number };
	entity: MapEntity;
	creature: boolean;
}

interface Floater {
	text: PIXI.Text;
	age: number;
	life: number;
	vy: number;
}

const CREATURE = new Set(["pc", "monster", "npc"]);
/** Light-map pixels per tile. */
const LIGHT_RES = 8;

/**
 * Imperative PixiJS v8 scene for a GridMap. Owned by <BattleMap/>; all prop
 * changes are applied through `update()` without recreating the app.
 */
export class BattleRenderer {
	private world: PIXI.Container;
	private base: PIXI.Container;
	private fx: PIXI.Container;
	private lightSprite?: PIXI.Sprite;
	private glowLayer: PIXI.Container;
	private grid: PIXI.Graphics;
	private fogSprite?: PIXI.Sprite;
	private overlay: PIXI.Graphics;
	private hover: PIXI.Graphics;
	private pathLayer: PIXI.Container;
	private tokenLayer: PIXI.Container;
	private propLayer: PIXI.Container;
	private floatLayer: PIXI.Container;
	private label: PIXI.Text;
	private selRing: PIXI.Graphics;

	private T = 64;
	private map?: GridMap;
	private input?: RenderInput;
	private textures = new Map<string, PIXI.Texture>();
	private mapTextures: PIXI.Texture[] = [];
	private tokens = new Map<string, TokenView>();
	private floaters: Floater[] = [];
	private seenEvents = new Set<string>();
	private water: PIXI.TilingSprite[] = [];
	private lava?: PIXI.Sprite;
	private time = 0;
	private visibleNow = new Set<string>();
	private cam = { x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1, init: false };
	private drag: { id: number; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;
	private hoverSq: Point | null = null;
	private destroyed = false;
	private glowTex?: PIXI.Texture;
	private cleanup: (() => void)[] = [];

	constructor(private P: Pixi, private app: PIXI.Application, private host: HTMLElement, private cb: { current: RendererCallbacks }) {
		const { Container, Graphics, Text } = P;
		this.world = new Container();
		this.base = new Container();
		this.fx = new Container();
		this.glowLayer = new Container();
		this.glowLayer.blendMode = "add";
		this.grid = new Graphics();
		this.overlay = new Graphics();
		this.hover = new Graphics();
		this.pathLayer = new Container();
		this.propLayer = new Container();
		this.tokenLayer = new Container();
		this.tokenLayer.sortableChildren = true;
		this.floatLayer = new Container();
		this.selRing = new Graphics();
		this.label = new Text({
			text: "",
			style: { fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 15, fill: 0xfdf6e3, fontWeight: "600", stroke: { color: 0x120d08, width: 4 }, dropShadow: { color: 0x000000, alpha: 0.6, blur: 3, distance: 1, angle: Math.PI / 2 } },
		});
		this.label.anchor.set(0.5, 1);
		this.label.visible = false;
		app.stage.addChild(this.world);
		this.world.addChild(this.base, this.fx, this.propLayer, this.glowLayer, this.grid, this.overlay, this.hover, this.pathLayer, this.selRing, this.tokenLayer, this.floatLayer, this.label);
		this.glowTex = this.makeGlowTexture();
		app.ticker.add(this.tick);
		this.bindInput();
	}

	// ─── public API ──────────────────────────────────────────────────────

	update(next: RenderInput) {
		if (this.destroyed) return;
		const prev = this.input;
		this.input = next;
		if (!prev || !sameLayout(prev.map, next.map) || !!prev.pixel !== !!next.pixel || netSig(prev) !== netSig(next)) this.buildMap(next.map);
		else this.map = next.map;
		this.syncEntities(next);
		this.recomputeVisibility(next);
		this.drawGrid(next.showGrid);
		this.drawOverlay(next);
		this.drawPath(next);
		if (!this.cam.init) this.fitInitial();
	}

	/** Smoothly centre the camera on a square or entity. */
	focus(target: Point | string | undefined | null, zoom?: number) {
		if (!target || !this.map) return;
		let p: Point | undefined;
		if (typeof target === "string") {
			const e = this.input?.entities.find((x) => x.id === target);
			if (e) p = { x: e.x + (e.size - 1) / 2, y: e.y + (e.size - 1) / 2 };
		} else p = target;
		if (!p) return;
		if (zoom) this.cam.tz = zoom;
		const { width, height } = this.app.screen;
		this.cam.tx = width / 2 - (p.x + 0.5) * this.T * this.cam.tz;
		this.cam.ty = height / 2 - (p.y + 0.5) * this.T * this.cam.tz;
		this.clampCamera();
	}

	/** Keep the map covering the view (or centred when smaller). */
	private clampCamera() {
		if (!this.map) return;
		const { width, height } = this.app.screen;
		const mw = this.map.width * this.T * this.cam.tz, mh = this.map.height * this.T * this.cam.tz;
		const pad = this.T * this.cam.tz * 0.5;
		this.cam.tx = mw + pad * 2 <= width ? (width - mw) / 2 : Math.min(pad, Math.max(width - mw - pad, this.cam.tx));
		this.cam.ty = mh + pad * 2 <= height ? (height - mh) / 2 : Math.min(pad, Math.max(height - mh - pad, this.cam.ty));
	}

	pushEvents(events: MapFxEvent[] | undefined) {
		if (!events) return;
		for (const ev of events) {
			if (this.seenEvents.has(ev.id)) continue;
			this.seenEvents.add(ev.id);
			this.spawnFloater(ev);
		}
	}

	/** Host element resized: keep the camera valid (and fit if not yet initialised). */
	onResize() {
		if (this.destroyed) return;
		if (!this.cam.init) this.fitInitial();
		else this.clampCamera();
	}

	zoomBy(f: number) {
		const { width, height } = this.app.screen;
		this.zoomAt(width / 2, height / 2, f);
	}

	fitMap() {
		if (!this.map) return;
		const { width, height } = this.app.screen;
		const z = Math.min(width / (this.map.width * this.T), height / (this.map.height * this.T)) * 0.96;
		this.cam.tz = z;
		this.cam.tx = (width - this.map.width * this.T * z) / 2;
		this.cam.ty = (height - this.map.height * this.T * z) / 2;
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const c of this.cleanup) c();
		this.app.ticker.remove(this.tick);
		for (const t of this.textures.values()) t.destroy(true);
		for (const t of this.mapTextures) t.destroy(true);
		this.glowTex?.destroy(true);
		this.app.destroy(true, { children: true, texture: false });
	}

	// ─── map ─────────────────────────────────────────────────────────────

	private buildMap(map: GridMap) {
		const P = this.P;
		this.map = map;
		const pixel = !!this.input?.pixel || map.theme === "net";
		this.T = pixel ? Math.max(32, Math.floor(tileSizeFor(map) / 16) * 16) : tileSizeFor(map);
		for (const c of this.base.removeChildren()) c.destroy();
		for (const c of this.fx.removeChildren()) c.destroy();
		for (const t of this.mapTextures) t.destroy(true);
		this.mapTextures = [];
		this.water = [];
		this.lava = undefined;
		if (this.lightSprite) { this.lightSprite.destroy(); this.lightSprite = undefined; }
		if (this.fogSprite) { this.fogSprite.destroy(); this.fogSprite = undefined; }
		const T = this.T;
		for (const ch of pixel ? paintPixelMap(map, T, undefined, map.theme === "net" ? (this.input?.net ?? {}) : undefined) : paintMap(map, T)) {
			const tex = P.Texture.from(ch.canvas, true);
			if (pixel) tex.source.scaleMode = "nearest";
			this.mapTextures.push(tex);
			const s = new P.Sprite(tex);
			s.position.set(ch.x0 * T, ch.y0 * T);
			this.base.addChild(s);
		}
		// animated water caustics
		const waterMask = this.maskCanvas(map, (t) => t === "water" || t === "deep_water");
		if (waterMask) {
			const maskTex = this.canvasTexture(waterMask);
			const mask = new P.Sprite(maskTex);
			mask.width = map.width * T;
			mask.height = map.height * T;
			const ctex = this.canvasTexture(this.causticsCanvas(), true);
			const holder = new P.Container();
			for (let i = 0; i < 2; i++) {
				const ts = new P.TilingSprite({ texture: ctex, width: map.width * T, height: map.height * T });
				ts.tileScale.set(T / 64 * (i ? 1.35 : 1));
				ts.alpha = i ? 0.22 : 0.3;
				ts.blendMode = "add";
				holder.addChild(ts);
				this.water.push(ts);
			}
			holder.addChild(mask);
			holder.setMask({ mask, channel: "alpha" });
			this.fx.addChild(holder);
		}
		const lavaMask = this.maskCanvas(map, (t) => t === "lava");
		if (lavaMask) {
			const s = new P.Sprite(this.canvasTexture(lavaMask, false, "#ff7a1a"));
			s.width = map.width * T;
			s.height = map.height * T;
			s.blendMode = "add";
			this.lava = s;
			this.fx.addChild(s);
		}
		// lighting + fog sprites (textures refreshed on demand)
		// the net glows on its own: no darkness there
		if (map.lighting !== "bright" && map.theme !== "net") {
			const c = document.createElement("canvas");
			c.width = map.width * LIGHT_RES;
			c.height = map.height * LIGHT_RES;
			const tex = this.canvasTexture(c);
			this.lightSprite = new P.Sprite(tex);
			this.lightSprite.width = map.width * T;
			this.lightSprite.height = map.height * T;
			this.lightSprite.blendMode = "multiply";
			this.world.addChildAt(this.lightSprite, this.world.getChildIndex(this.glowLayer));
		}
		const fc = document.createElement("canvas");
		fc.width = map.width * 2 + 2;
		fc.height = map.height * 2 + 2;
		this.fogSprite = new P.Sprite(this.canvasTexture(fc));
		this.fogSprite.position.set(-T / 2, -T / 2);
		this.fogSprite.width = (map.width + 1) * T;
		this.fogSprite.height = (map.height + 1) * T;
		this.world.addChildAt(this.fogSprite, this.world.getChildIndex(this.overlay));
		this.cam.init = false;
		// clear tokens so they rebuild with new tile size
		for (const v of this.tokens.values()) {
			v.glow?.destroy();
			v.root.destroy({ children: true });
		}
		this.tokens.clear();
	}

	private canvasTexture(c: HTMLCanvasElement, repeat = false, tint?: string): PIXI.Texture {
		if (tint) {
			const ctx = c.getContext("2d")!;
			ctx.globalCompositeOperation = "source-in";
			ctx.fillStyle = tint;
			ctx.fillRect(0, 0, c.width, c.height);
		}
		const tex = this.P.Texture.from(c, true);
		if (repeat) tex.source.addressMode = "repeat";
		tex.source.scaleMode = "linear";
		this.mapTextures.push(tex);
		return tex;
	}

	private maskCanvas(map: GridMap, pred: (t: GridMap["tiles"][number]) => boolean): HTMLCanvasElement | null {
		let any = false;
		const c = document.createElement("canvas");
		c.width = map.width * 4;
		c.height = map.height * 4;
		const ctx = c.getContext("2d")!;
		ctx.fillStyle = "#fff";
		for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
			if (!pred(map.tiles[y * map.width + x])) continue;
			any = true;
			ctx.beginPath();
			ctx.arc(x * 4 + 2, y * 4 + 2, 2.6, 0, Math.PI * 2);
			ctx.fill();
		}
		return any ? c : null;
	}

	private causticsCanvas(): HTMLCanvasElement {
		const c = document.createElement("canvas");
		c.width = c.height = 128;
		const ctx = c.getContext("2d")!;
		ctx.strokeStyle = "rgba(200,240,255,0.55)";
		ctx.lineCap = "round";
		for (let i = 0; i < 26; i++) {
			const x = rand2(i, 1, 7) * 128, y = rand2(i, 2, 7) * 128;
			const r = 6 + rand2(i, 3, 7) * 14;
			const a = rand2(i, 4, 7) * Math.PI * 2;
			ctx.lineWidth = 1 + rand2(i, 5, 7) * 1.8;
			for (const ox of [-128, 0, 128]) for (const oy of [-128, 0, 128]) {
				ctx.beginPath();
				ctx.arc(x + ox, y + oy, r, a, a + 1.4 + rand2(i, 6, 7));
				ctx.stroke();
			}
		}
		return c;
	}

	private makeGlowTexture(): PIXI.Texture {
		const c = document.createElement("canvas");
		c.width = c.height = 128;
		const ctx = c.getContext("2d")!;
		const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
		g.addColorStop(0, "rgba(255,255,255,1)");
		g.addColorStop(0.25, "rgba(255,255,255,0.55)");
		g.addColorStop(0.6, "rgba(255,255,255,0.15)");
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 128, 128);
		return this.P.Texture.from(c, true);
	}

	// ─── visibility, light, fog ─────────────────────────────────────────

	private recomputeVisibility(inp: RenderInput) {
		const map = this.map!;
		const pc = inp.entities.find((e) => e.kind === "pc" && !e.hidden) ?? inp.entities.find((e) => e.kind === "pc");
		let vis = inp.visible;
		if (!vis && pc) vis = computePlayerView(map, { x: pc.x, y: pc.y }, { darkvision: inp.darkvision, entities: inp.entities });
		this.visibleNow = vis ?? new Set();
		this.drawLighting(inp, pc);
		this.drawFog(inp, vis);
		// token visibility
		for (const v of this.tokens.values()) v.root.visible = this.tokenVisible(v.entity, inp);
	}

	private tokenVisible(e: MapEntity, inp: RenderInput): boolean {
		if (e.hidden && !inp.showHidden) return false;
		if (!inp.fog || e.kind === "pc") return true;
		const map = this.map!;
		const sq = [];
		for (let dy = 0; dy < e.size; dy++) for (let dx = 0; dx < e.size; dx++) sq.push([e.x + dx, e.y + dy]);
		if (CREATURE.has(e.kind) || e.kind === "item" || e.kind === "trap") {
			// Combatants in the active fight are always shown (the player is fighting them).
			if (this.input?.status[e.id]) return true;
			return sq.some(([x, y]) => this.visibleNow.has(sqKey(x, y)));
		}
		return sq.some(([x, y]) => map.explored[y * map.width + x] || this.visibleNow.has(sqKey(x, y)));
	}

	private drawLighting(inp: RenderInput, pc?: MapEntity) {
		const map = this.map!;
		if (!this.lightSprite) return;
		const L = LIGHT_RES;
		const amb = map.lighting === "dark" ? [26, 28, 44] : [112, 112, 136];
		const sources: { x: number; y: number; r: number; c: number; k: number }[] = [];
		for (const e of inp.entities) {
			const r = lightRadiusOf(e, inp);
			if (r <= 0) continue;
			if (e.hidden && !inp.showHidden) continue;
			sources.push({ x: e.x + e.size / 2, y: e.y + e.size / 2, r, c: lightStyle(e.sprite).color, k: 1 });
		}
		if (pc && !(pc.lightRadius && pc.lightRadius > 0)) sources.push({ x: pc.x + 0.5, y: pc.y + 0.5, r: map.lighting === "dark" ? 3 : 2, c: 0xd8e0ff, k: 0.75 });
		const c = this.lightSprite.texture.source.resource as HTMLCanvasElement;
		const ctx = c.getContext("2d")!;
		ctx.globalCompositeOperation = "source-over";
		ctx.fillStyle = `rgb(${amb[0]},${amb[1]},${amb[2]})`;
		ctx.fillRect(0, 0, c.width, c.height);
		ctx.globalCompositeOperation = "lighter";
		for (const s of sources) {
			const fov = computeFov(map, Math.floor(s.x), Math.floor(s.y), Math.ceil(s.r * 2) + 1);
			const clip = new Path2D();
			for (const key of fov) {
				const p = parseKey(key);
				clip.rect(p.x * L - 1, p.y * L - 1, L + 2, L + 2);
			}
			const R = s.r * 2 * L;
			const cx = s.x * L, cy = s.y * L;
			const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
			const col = (a: number) => `rgba(${(s.c >> 16) & 255},${(s.c >> 8) & 255},${s.c & 255},${Math.max(0, Math.min(1, a * s.k))})`;
			g.addColorStop(0, col(1));
			g.addColorStop(0.35, col(0.9));
			g.addColorStop(0.5, col(0.62));
			g.addColorStop(0.75, col(0.25));
			g.addColorStop(1, col(0));
			ctx.save();
			ctx.clip(clip);
			ctx.fillStyle = g;
			ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
			ctx.restore();
		}
		ctx.globalCompositeOperation = "source-over";
		// soften hard tile-shaped edges into penumbrae (no-op where canvas filters are unsupported)
		if ("filter" in ctx) {
			const tmp = document.createElement("canvas");
			tmp.width = c.width;
			tmp.height = c.height;
			tmp.getContext("2d")!.drawImage(c, 0, 0);
			ctx.filter = `blur(${L * 0.45}px)`;
			ctx.drawImage(tmp, 0, 0);
			ctx.filter = "none";
		}
		this.lightSprite.texture.source.update();
	}

	private drawFog(inp: RenderInput, vis?: Set<string>) {
		const map = this.map!;
		if (!this.fogSprite) return;
		this.fogSprite.visible = inp.fog;
		if (!inp.fog) return;
		const c = this.fogSprite.texture.source.resource as HTMLCanvasElement;
		const ctx = c.getContext("2d")!;
		const W = c.width, H = c.height;
		const img = ctx.createImageData(W, H);
		// fog canvas has a 1-px (half tile) border so edges fade off the map
		for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
			const x = Math.floor((px - 1) / 2), y = Math.floor((py - 1) / 2);
			let a = 255;
			if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
				const k = sqKey(x, y);
				if (vis?.has(k)) a = 0;
				else if (map.explored[y * map.width + x]) a = 150;
				else if (!vis) a = 255;
			} else a = 255;
			const o = (py * W + px) * 4;
			img.data[o] = 6;
			img.data[o + 1] = 5;
			img.data[o + 2] = 9;
			img.data[o + 3] = a;
		}
		ctx.putImageData(img, 0, 0);
		this.fogSprite.texture.source.update();
	}

	// ─── grid & overlays ───────────────────────────────────────────────

	private drawGrid(show: boolean) {
		const g = this.grid;
		g.clear();
		if (!show || !this.map) return;
		const { width: W, height: H } = this.map;
		const T = this.T;
		for (let x = 0; x <= W; x++) g.moveTo(x * T, 0).lineTo(x * T, H * T);
		for (let y = 0; y <= H; y++) g.moveTo(0, y * T).lineTo(W * T, y * T);
		g.stroke({ width: 1, color: 0x000000, alpha: 0.22 });
		for (let x = 0; x <= W; x++) g.moveTo(x * T + 1, 0).lineTo(x * T + 1, H * T);
		for (let y = 0; y <= H; y++) g.moveTo(0, y * T + 1).lineTo(W * T, y * T + 1);
		g.stroke({ width: 1, color: 0xffffff, alpha: 0.06 });
	}

	private drawOverlay(inp: RenderInput) {
		const g = this.overlay;
		g.clear();
		const T = this.T;
		const region = (set: Set<string>, color: number, fillA: number, lineA: number) => {
			for (const k of set) {
				const p = parseKey(k);
				g.rect(p.x * T + 1, p.y * T + 1, T - 2, T - 2);
			}
			g.fill({ color, alpha: fillA });
			for (const k of set) {
				const p = parseKey(k);
				if (!set.has(sqKey(p.x, p.y - 1))) g.moveTo(p.x * T, p.y * T).lineTo((p.x + 1) * T, p.y * T);
				if (!set.has(sqKey(p.x, p.y + 1))) g.moveTo(p.x * T, (p.y + 1) * T).lineTo((p.x + 1) * T, (p.y + 1) * T);
				if (!set.has(sqKey(p.x - 1, p.y))) g.moveTo(p.x * T, p.y * T).lineTo(p.x * T, (p.y + 1) * T);
				if (!set.has(sqKey(p.x + 1, p.y))) g.moveTo((p.x + 1) * T, p.y * T).lineTo((p.x + 1) * T, (p.y + 1) * T);
			}
			g.stroke({ width: 2, color, alpha: lineA });
		};
		if (inp.highlights?.size) region(inp.highlights, inp.highlightColor, 0.2, 0.75);
		// Exits to connected maps: a gold frame with a chevron.
		for (const k of Object.keys(inp.exits ?? {})) {
			const p = parseKey(k);
			if (this.map && !this.map.explored[p.y * this.map.width + p.x]) continue;
			g.rect(p.x * T + 3, p.y * T + 3, T - 6, T - 6).stroke({ width: 2, color: 0xd4a64a, alpha: 0.95 });
			const cx = (p.x + 0.5) * T, cy = (p.y + 0.5) * T, r = T * 0.16;
			g.moveTo(cx - r, cy - r).lineTo(cx + r * 0.6, cy).lineTo(cx - r, cy + r).stroke({ width: 3, color: 0xfff3c4, alpha: 0.95 });
		}
		// Siege posts: a crimson frame with a dot.
		for (const k of Object.keys(inp.marks ?? {})) {
			const p = parseKey(k);
			g.rect(p.x * T + 2, p.y * T + 2, T - 4, T - 4).stroke({ width: 3, color: 0xd9503f, alpha: 0.95 });
			g.circle((p.x + 0.5) * T, (p.y + 0.18) * T, T * 0.09).fill({ color: 0xffd2c4, alpha: 0.95 });
		}
		if (inp.aoe) {
			const color = inp.aoe.color ?? 0xff7a2f;
			const sq = aoeSquares(inp.aoe, this.map);
			region(sq, color, 0.28, 0.5);
			// template outline
			const o = inp.aoe.origin;
			const ox = (o.x + 0.5) * T, oy = (o.y + 0.5) * T;
			const s = (inp.aoe.size / 5) * T;
			const to = inp.aoe.toward ?? { x: o.x + 1, y: o.y };
			const ang = Math.atan2(to.y - o.y, to.x - o.x);
			if (inp.aoe.shape === "sphere" || inp.aoe.shape === "cylinder") g.circle(ox, oy, s);
			else if (inp.aoe.shape === "cone") g.poly([ox, oy, ox + Math.cos(ang - 0.4636) * s / Math.cos(0.4636), oy + Math.sin(ang - 0.4636) * s / Math.cos(0.4636), ox + Math.cos(ang + 0.4636) * s / Math.cos(0.4636), oy + Math.sin(ang + 0.4636) * s / Math.cos(0.4636)]);
			else if (inp.aoe.shape === "line") {
				const w = ((inp.aoe.width ?? 5) / 10) * T;
				const nx = -Math.sin(ang) * w, ny = Math.cos(ang) * w;
				const ex = ox + Math.cos(ang) * s, ey = oy + Math.sin(ang) * s;
				g.poly([ox + nx, oy + ny, ex + nx, ey + ny, ex - nx, ey - ny, ox - nx, oy - ny]);
			} else {
				const ax = Math.abs(Math.cos(ang)) >= Math.abs(Math.sin(ang));
				const sx = ax ? Math.sign(Math.cos(ang)) || 1 : 0, sy = ax ? 0 : Math.sign(Math.sin(ang)) || 1;
				const x0 = ax ? (sx > 0 ? ox + T / 2 : ox - T / 2 - s) : ox - s / 2;
				const y0 = ax ? oy - s / 2 : sy > 0 ? oy + T / 2 : oy - T / 2 - s;
				g.rect(x0, y0, s, s);
			}
			g.fill({ color, alpha: 0.1 });
			g.stroke({ width: 3, color, alpha: 0.95 });
			g.circle(ox, oy, T * 0.12).fill({ color: 0xffffff, alpha: 0.9 });
		}
	}

	private drawPath(inp: RenderInput) {
		for (const c of this.pathLayer.removeChildren()) c.destroy();
		const pts = inp.path;
		if (!pts || pts.length < 1) return;
		const P = this.P, T = this.T;
		const g = new P.Graphics();
		const c = (p: Point) => [(p.x + 0.5) * T, (p.y + 0.5) * T] as const;
		g.moveTo(...c(pts[0]));
		for (const p of pts.slice(1)) g.lineTo(...c(p));
		g.stroke({ width: T * 0.16, color: 0x000000, alpha: 0.35, cap: "round", join: "round" });
		g.moveTo(...c(pts[0]));
		for (const p of pts.slice(1)) g.lineTo(...c(p));
		g.stroke({ width: T * 0.08, color: 0xfff3c4, alpha: 0.95, cap: "round", join: "round" });
		for (const p of pts.slice(1, -1)) g.circle(...c(p), T * 0.07).fill({ color: 0xfff3c4 });
		const end = pts[pts.length - 1];
		g.circle(...c(end), T * 0.36).stroke({ width: 3, color: 0xfff3c4, alpha: 0.95 });
		g.circle(...c(end), T * 0.36).fill({ color: 0xfff3c4, alpha: 0.15 });
		this.pathLayer.addChild(g);
		const label = inp.pathLabel ?? `${Math.max(0, pts.length - 1) * 5} ft`;
		const t = new P.Text({ text: label, style: { fontFamily: "Georgia, serif", fontSize: Math.round(T * 0.3), fill: 0xfff3c4, fontWeight: "700", stroke: { color: 0x1a120a, width: 4 } } });
		t.anchor.set(0.5, 1.2);
		t.position.set((end.x + 0.5) * T, end.y * T);
		this.pathLayer.addChild(t);
	}

	// ─── tokens ────────────────────────────────────────────────────────

	private textureFor(key: string, paint: () => HTMLCanvasElement): PIXI.Texture {
		let t = this.textures.get(key);
		if (!t) {
			t = this.P.Texture.from(paint(), true);
			t.source.scaleMode = key.startsWith("px|") ? "nearest" : "linear";
			this.textures.set(key, t);
		}
		return t;
	}

	private syncEntities(inp: RenderInput) {
		const P = this.P, T = this.T;
		const keep = new Set<string>();
		for (const e of inp.entities) {
			keep.add(e.id);
			const st = inp.status[e.id];
			const creature = CREATURE.has(e.kind);
			const ring = ringFor(e, st?.side);
			const netMap = inp.map.theme === "net";
			const pixel = inp.pixel ?? (netMap ? { looks: {} } : undefined);
			const look = pixel?.looks[e.id];
			const modern = inp.map.theme === "modern";
			const net = netMap ? (inp.net ?? {}) : undefined;
			const isDead = !!e.dead || !!st?.dead || (st?.hp !== undefined && st.hp <= 0 && e.kind !== "pc");
			const lightR = lightRadiusOf(e, inp);
			const unpowered = inp.powerOn === false && !creature && isStreetLamp(e, modern);
			const texKey = pixel
				? creature ? `px|tok|${e.sprite}|${e.kind}|${isDead ? "dead" : ring}|${modern ? "m" : net ? `net${net.style ?? ""}` : ""}|${look ? JSON.stringify(look) : ""}` : `px|prop|${e.sprite}|${e.name}|${modern ? "m" : ""}${unpowered ? "|off" : ""}`
				: creature ? `tok|${e.sprite}|${e.kind}|${ring}|${e.size > 1 ? 2 : 1}` : `prop|${e.sprite}|${e.kind}`;
			let v = this.tokens.get(e.id);
			if (v && (v.key !== texKey || !!v.light !== lightR > 0)) {
				v.glow?.destroy();
				v.root.destroy({ children: true });
				this.tokens.delete(e.id);
				v = undefined;
			}
			if (!v) {
				const root = new P.Container();
				const body = new P.Container();
				const px = creature ? (e.size > 1 ? 256 : 160) : 128;
				const tex = this.textureFor(texKey, () =>
					pixel
						? creature ? pixelToken(128, { kind: e.kind, sprite: e.sprite, look, ring, dead: isDead, modern, net }) : pixelProp(128, e, modern, !unpowered)
						: creature ? paintToken(px, e.sprite, e.kind, ring) : paintProp(px, hasProp(e.sprite) ? e.sprite : e.sprite || "crate", e.kind),
				);
				const sprite = new P.Sprite(tex);
				sprite.anchor.set(0.5);
				body.addChild(sprite);
				const hp = new P.Graphics();
				root.addChild(body, hp);
				let glow: PIXI.Sprite | undefined;
				let light: TokenView["light"];
				if (lightR > 0) {
					const ls = lightStyle(e.sprite);
					glow = new P.Sprite(this.glowTex!);
					glow.anchor.set(0.5);
					glow.tint = ls.color;
					this.glowLayer.addChild(glow);
					light = { ...ls, radius: lightR, phase: rand2(e.x, e.y, 3) * 10 };
				}
				this.tokenLayer.addChild(root);
				v = { id: e.id, root, body, sprite, hp, glow, light, key: texKey, cur: { x: e.x, y: e.y }, from: { x: e.x, y: e.y }, to: { x: e.x, y: e.y }, t: 1, dur: 0, size: e.size, shake: 0, flash: 0, entity: e, creature };
				this.tokens.set(e.id, v);
			}
			v.entity = e;
			v.size = e.size;
			if (v.to.x !== e.x || v.to.y !== e.y) {
				v.from = { ...v.cur };
				v.to = { x: e.x, y: e.y };
				v.t = 0;
				const d = Math.hypot(v.to.x - v.from.x, v.to.y - v.from.y);
				v.dur = Math.min(900, 140 + d * 90);
			}
			const scale = (e.size * T * (creature && !pixel ? 0.94 : 1)) / v.sprite.texture.width;
			v.sprite.scale.set(scale);
			v.root.zIndex = creature ? 10 + (e.kind === "pc" ? 2 : 0) : e.kind === "light" ? 2 : 1;
			const dead = isDead && creature;
			// Pixel corpses are drawn lying down already; the painted style greys and tips the token over.
			v.sprite.tint = dead && !pixel ? 0x6a6a6a : 0xffffff;
			v.body.rotation = dead && !pixel ? Math.PI / 2 : 0;
			v.root.alpha = e.hidden ? 0.5 : dead && !pixel ? 0.7 : 1;
			v.root.zIndex = dead ? 5 : v.root.zIndex;
			if (v.light) v.light.radius = lightR || v.light.radius;
			this.drawHp(v, st);
		}
		for (const [id, v] of this.tokens) {
			if (keep.has(id)) continue;
			v.glow?.destroy();
			v.root.destroy({ children: true });
			this.tokens.delete(id);
		}
	}

	private drawHp(v: TokenView, st?: TokenStatus) {
		const g = v.hp;
		g.clear();
		if (!st || st.hp === undefined || !st.maxHp) return;
		const T = this.T;
		const w = v.size * T * 0.8, h = Math.max(4, T * 0.08);
		const x = -w / 2, y = (v.size * T) / 2 - h * 0.6;
		const f = Math.max(0, Math.min(1, st.hp / st.maxHp));
		const col = f > 0.6 ? 0x4ade80 : f > 0.3 ? 0xfacc15 : 0xef4444;
		g.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, h).fill({ color: 0x0b0907, alpha: 0.85 });
		if (f > 0) g.roundRect(x, y, w * f, h, h / 2).fill({ color: col });
		g.rect(x, y, w * f, h * 0.35).fill({ color: 0xffffff, alpha: 0.25 });
	}

	private spawnFloater(ev: MapFxEvent) {
		const P = this.P, T = this.T;
		let pos: Point | undefined;
		const tv = ev.entityId ? this.tokens.get(ev.entityId) : undefined;
		if (tv) {
			pos = { x: tv.cur.x + (tv.size - 1) / 2, y: tv.cur.y + (tv.size - 1) / 2 };
			if (ev.kind === "damage" || ev.kind === "crit") { tv.shake = 1; tv.flash = 1; }
		} else if (ev.x !== undefined && ev.y !== undefined) pos = { x: ev.x, y: ev.y };
		if (!pos) return;
		const style = {
			damage: { fill: 0xff5a4a, size: 0.42 },
			crit: { fill: 0xffb020, size: 0.58 },
			heal: { fill: 0x5ef08a, size: 0.42 },
			miss: { fill: 0xd6d3cc, size: 0.34 },
			info: { fill: 0xfff3c4, size: 0.3 },
		}[ev.kind ?? "info"];
		const t = new P.Text({ text: ev.text, style: { fontFamily: "Georgia, 'Times New Roman', serif", fontSize: Math.round(T * style.size), fontWeight: "800", fill: style.fill, stroke: { color: 0x140c06, width: 5 }, dropShadow: { color: 0x000000, alpha: 0.7, blur: 4, distance: 2, angle: Math.PI / 2 } } });
		t.anchor.set(0.5);
		t.position.set((pos.x + 0.5 + (Math.random() - 0.5) * 0.3) * T, (pos.y + 0.2) * T);
		this.floatLayer.addChild(t);
		this.floaters.push({ text: t, age: 0, life: ev.kind === "crit" ? 1700 : 1300, vy: -T * 0.9 });
	}

	// ─── animation loop ───────────────────────────────────────────────

	private tick = (ticker: PIXI.Ticker) => {
		if (this.destroyed || !this.map) return;
		if (!this.cam.init && this.input) this.fitInitial();
		const dt = ticker.deltaMS;
		this.time += dt;
		const T = this.T;
		// camera easing
		const k = 1 - Math.pow(0.001, dt / 1000 * 2.2);
		this.cam.x += (this.cam.tx - this.cam.x) * k;
		this.cam.y += (this.cam.ty - this.cam.y) * k;
		this.cam.z += (this.cam.tz - this.cam.z) * k;
		this.world.position.set(this.cam.x, this.cam.y);
		this.world.scale.set(this.cam.z);
		// water & lava
		this.water.forEach((w, i) => {
			w.tilePosition.x = (this.time / 1000) * (i ? -9 : 7) * (T / 64);
			w.tilePosition.y = (this.time / 1000) * (i ? 5 : -4) * (T / 64);
			w.alpha = (i ? 0.2 : 0.28) + Math.sin(this.time / 900 + i * 2) * 0.06;
		});
		if (this.lava) this.lava.alpha = 0.25 + Math.sin(this.time / 600) * 0.12;
		// tokens
		const dark = this.map.lighting === "dark" ? 1 : this.map.lighting === "dim" ? 0.7 : 0.35;
		for (const v of this.tokens.values()) {
			if (v.t < 1) {
				v.t = Math.min(1, v.t + dt / Math.max(1, v.dur));
				const e = v.t < 0.5 ? 2 * v.t * v.t : 1 - Math.pow(-2 * v.t + 2, 2) / 2;
				v.cur = { x: v.from.x + (v.to.x - v.from.x) * e, y: v.from.y + (v.to.y - v.from.y) * e };
			}
			let sx = 0;
			if (v.shake > 0) {
				v.shake = Math.max(0, v.shake - dt / 380);
				sx = Math.sin(this.time / 22) * T * 0.07 * v.shake;
			}
			if (v.flash > 0) {
				v.flash = Math.max(0, v.flash - dt / 450);
				v.sprite.tint = v.flash > 0.05 ? 0xff8080 : 0xffffff;
			}
			const hop = v.t < 1 && v.creature ? Math.sin(v.t * Math.PI) * T * 0.08 : 0;
			const cx = (v.cur.x + v.size / 2) * T + sx, cy = (v.cur.y + v.size / 2) * T - hop;
			v.root.position.set(cx, cy);
			if (v.glow && v.light) {
				const f = 1 + (Math.sin(this.time / 90 + v.light.phase) * 0.5 + Math.sin(this.time / 37 + v.light.phase * 3) * 0.5) * v.light.flicker;
				const size = v.light.radius * T * 1.6 * f;
				v.glow.width = v.glow.height = size;
				v.glow.position.set(cx, cy);
				v.glow.alpha = 0.32 * dark;
				v.glow.visible = v.root.visible;
			}
		}
		// selection ring
		this.selRing.clear();
		const sel = this.input?.selectedId ? this.tokens.get(this.input.selectedId) : undefined;
		if (sel && sel.root.visible) {
			const r = (sel.size * T) / 2 * 1.02;
			const p = sel.root.position;
			const pulse = 0.6 + Math.sin(this.time / 260) * 0.25;
			this.selRing.circle(p.x, p.y, r + 4).stroke({ width: 4, color: 0xfff1b8, alpha: pulse });
			const a0 = this.time / 700;
			for (let i = 0; i < 4; i++) {
				const a = a0 + (i * Math.PI) / 2;
				this.selRing.moveTo(p.x + Math.cos(a) * (r + 10), p.y + Math.sin(a) * (r + 10)).arc(p.x, p.y, r + 10, a, a + 0.8).stroke({ width: 3, color: 0xffd36b, alpha: 0.9 });
			}
		}
		// floaters
		for (let i = this.floaters.length - 1; i >= 0; i--) {
			const f = this.floaters[i];
			f.age += dt;
			const p = f.age / f.life;
			f.text.y += (f.vy * dt) / 1000 * (1 - p);
			f.text.alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
			f.text.scale.set(p < 0.12 ? 0.6 + p * 4 : 1.08 - p * 0.08);
			if (f.age >= f.life) {
				f.text.destroy();
				this.floaters.splice(i, 1);
			}
		}
	};

	// ─── camera & input ───────────────────────────────────────────────

	/** "focus" (default): tactical zoom centred on the PC/entry; "fit": whole map. */
	initialView: "focus" | "fit" = "focus";

	private fitInitial() {
		const map = this.map;
		if (!map) return;
		const { width, height } = this.app.screen;
		if (width < 10 || height < 10) return;
		const T = this.T;
		const fit = Math.min(width / (map.width * T), height / (map.height * T));
		const z = Math.max(fit, Math.min(1.1, width / (T * 22)));
		const pc = this.input?.entities.find((e) => e.kind === "pc");
		const p = pc ? { x: pc.x, y: pc.y } : map.entry;
		this.cam.z = this.cam.tz = z;
		if (this.initialView === "fit") {
			this.cam.init = true;
			this.fitMap();
			this.cam.x = this.cam.tx;
			this.cam.y = this.cam.ty;
			this.cam.z = this.cam.tz;
			return;
		}
		if (fit >= z * 0.999) {
			this.cam.x = this.cam.tx = (width - map.width * T * z) / 2;
			this.cam.y = this.cam.ty = (height - map.height * T * z) / 2;
		} else {
			this.focus(p);
			this.cam.x = this.cam.tx;
			this.cam.y = this.cam.ty;
		}
		this.cam.init = true;
	}

	private zoomAt(sx: number, sy: number, f: number) {
		const z0 = this.cam.tz;
		const z1 = Math.max(0.15, Math.min(3.5, z0 * f));
		const wx = (sx - this.cam.tx) / z0, wy = (sy - this.cam.ty) / z0;
		this.cam.tz = z1;
		this.cam.tx = sx - wx * z1;
		this.cam.ty = sy - wy * z1;
	}

	private squareAt(clientX: number, clientY: number): Point | null {
		if (!this.map) return null;
		const rect = this.app.canvas.getBoundingClientRect();
		const sx = clientX - rect.left, sy = clientY - rect.top;
		const wx = (sx - this.cam.x) / this.cam.z, wy = (sy - this.cam.y) / this.cam.z;
		const x = Math.floor(wx / this.T), y = Math.floor(wy / this.T);
		if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return null;
		return { x, y };
	}

	private tokenAt(p: Point): MapEntity | undefined {
		let best: TokenView | undefined;
		for (const v of this.tokens.values()) {
			if (!v.root.visible) continue;
			const e = v.entity;
			if (p.x < e.x || p.y < e.y || p.x >= e.x + e.size || p.y >= e.y + e.size) continue;
			if (!best || v.root.zIndex > best.root.zIndex) best = v;
		}
		return best?.entity;
	}

	private bindInput() {
		const el = this.app.canvas;
		el.style.touchAction = "none";
		el.style.cursor = "grab";
		const onDown = (e: PointerEvent) => {
			el.setPointerCapture(e.pointerId);
			this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: this.cam.tx, cy: this.cam.ty, moved: false };
		};
		const onMove = (e: PointerEvent) => {
			if (this.drag && this.drag.id === e.pointerId) {
				const dx = e.clientX - this.drag.sx, dy = e.clientY - this.drag.sy;
				if (!this.drag.moved && Math.hypot(dx, dy) > 5) {
					this.drag.moved = true;
					el.style.cursor = "grabbing";
				}
				if (this.drag.moved) {
					this.cam.tx = this.drag.cx + dx;
					this.cam.ty = this.drag.cy + dy;
					this.cam.x = this.cam.tx;
					this.cam.y = this.cam.ty;
				}
				return;
			}
			this.updateHover(this.squareAt(e.clientX, e.clientY));
		};
		const onUp = (e: PointerEvent) => {
			const d = this.drag;
			this.drag = null;
			el.style.cursor = "grab";
			if (!d || d.moved) return;
			const sq = this.squareAt(e.clientX, e.clientY);
			if (!sq) return;
			const tok = this.tokenAt(sq);
			if (tok && this.cb.current.onTokenClick && (tok.kind !== "light")) this.cb.current.onTokenClick(tok, e);
			else this.cb.current.onSquareClick?.(sq, e);
		};
		const onLeave = () => this.updateHover(null);
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = el.getBoundingClientRect();
			const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
			this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, f);
		};
		const onCtx = (e: Event) => e.preventDefault();
		el.addEventListener("pointerdown", onDown);
		el.addEventListener("pointermove", onMove);
		el.addEventListener("pointerup", onUp);
		el.addEventListener("pointercancel", onUp);
		el.addEventListener("pointerleave", onLeave);
		el.addEventListener("wheel", onWheel, { passive: false });
		el.addEventListener("contextmenu", onCtx);
		this.cleanup.push(() => {
			el.removeEventListener("pointerdown", onDown);
			el.removeEventListener("pointermove", onMove);
			el.removeEventListener("pointerup", onUp);
			el.removeEventListener("pointercancel", onUp);
			el.removeEventListener("pointerleave", onLeave);
			el.removeEventListener("wheel", onWheel);
			el.removeEventListener("contextmenu", onCtx);
		});
	}

	private updateHover(sq: Point | null) {
		const same = sq && this.hoverSq && sq.x === this.hoverSq.x && sq.y === this.hoverSq.y;
		if (same || (!sq && !this.hoverSq)) return;
		this.hoverSq = sq;
		this.cb.current.onSquareHover?.(sq);
		const T = this.T;
		this.hover.clear();
		this.label.visible = false;
		if (!sq) return;
		this.hover.rect(sq.x * T + 1, sq.y * T + 1, T - 2, T - 2).stroke({ width: 2, color: 0xfff3c4, alpha: 0.6 });
		const tok = this.tokenAt(sq);
		if (tok && tok.kind !== "light") {
			const v = this.tokens.get(tok.id)!;
			const st = this.input?.status[tok.id];
			const note = this.input?.notes?.[tok.id];
			this.label.text = st?.hp !== undefined && st.maxHp ? `${tok.name}  ${Math.max(0, st.hp)}/${st.maxHp}` : note ? `${tok.name}  ${note}` : tok.name;
			this.label.style.fontSize = Math.round(T * 0.26);
			this.label.position.set(v.root.position.x, v.root.position.y - (tok.size * T) / 2 - 4);
			this.label.visible = true;
		} else if (!tok && this.input?.exits?.[sqKey(sq.x, sq.y)]) {
			this.label.text = `→ ${this.input.exits[sqKey(sq.x, sq.y)]}`;
			this.label.style.fontSize = Math.round(T * 0.26);
			this.label.position.set((sq.x + 0.5) * T, sq.y * T - 4);
			this.label.visible = true;
		} else if (!tok) {
			// The Quiet: a barricade's remaining strength (and who holds it in a siege)
			const b = this.map?.barricades?.[sqKey(sq.x, sq.y)];
			const mark = this.input?.marks?.[sqKey(sq.x, sq.y)];
			if (b && this.map?.tiles[sq.y * this.map.width + sq.x] === "barricade") {
				this.label.text = `${this.input?.barricadeLabel ?? "Barricade"}  ${Math.max(0, b.hp)}/${b.max}${mark ? `  ·  ${mark}` : ""}`;
				this.label.style.fontSize = Math.round(T * 0.26);
				this.label.position.set((sq.x + 0.5) * T, sq.y * T - 4);
				this.label.visible = true;
			} else if (mark) {
				this.label.text = mark;
				this.label.style.fontSize = Math.round(T * 0.26);
				this.label.position.set((sq.x + 0.5) * T, sq.y * T - 4);
				this.label.visible = true;
			}
		}
	}
}

function sameLayout(a: GridMap, b: GridMap): boolean {
	if (a === b) return true;
	if (a.id !== b.id || a.width !== b.width || a.height !== b.height || a.lighting !== b.lighting || a.kind !== b.kind) return false;
	// Barricades are painted damaged below half HP: repaint when that changes.
	const damaged = (m: GridMap) => Object.entries(m.barricades ?? {}).filter(([, v]) => v.hp * 2 < v.max).map(([k]) => k).sort().join(";");
	if (damaged(a) !== damaged(b)) return false;
	if (a.tiles === b.tiles) return true;
	for (let i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) return false;
	return true;
}
