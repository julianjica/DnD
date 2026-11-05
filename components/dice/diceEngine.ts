/**
 * Client-only 3D dice engine (three.js + cannon-es). Loaded lazily by
 * DiceTray via dynamic import so three/cannon stay out of the main bundle.
 *
 * Strategy for authoritative results: each throw is pre-simulated with a
 * fixed timestep and recorded. We read which face ended on top, relabel the
 * faces (redraw the texture) so that face shows the RollRecord value, then
 * replay the recording. Dice that come to rest cocked are eased flat.
 */
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
	type DieDef,
	type DieShape,
	type LabelMode,
	type Quat,
	type Vec3,
	type VisualDieSpec,
	cross,
	defaultLabels,
	dot,
	flatness,
	flattenQuat,
	getDieDef,
	labelText,
	minY,
	norm,
	relabelForTarget,
	scale as vscale,
	sub,
} from "./diceGeometry";

export type DiceTheme = "mixed" | "bone" | "obsidian" | "crimson" | "emerald";

interface ThemeColors {
	base: string;
	light: string;
	edge: string;
	ink: string;
	inkShadow: string;
	inkLight: string;
	roughness: number;
	clearcoat: number;
	sheen?: number;
}

const THEMES: Record<Exclude<DiceTheme, "mixed">, ThemeColors> = {
	bone: { base: "#e9dcc0", light: "#fbf3e2", edge: "#a88f66", ink: "#3a2616", inkShadow: "rgba(30,18,8,0.55)", inkLight: "rgba(255,250,235,0.85)", roughness: 0.48, clearcoat: 0.35 },
	obsidian: { base: "#26222e", light: "#3b3546", edge: "#09080c", ink: "#e9c56b", inkShadow: "rgba(0,0,0,0.8)", inkLight: "rgba(255,230,160,0.25)", roughness: 0.22, clearcoat: 0.9 },
	crimson: { base: "#9a1427", light: "#cf3448", edge: "#3e0410", ink: "#f8e6c2", inkShadow: "rgba(40,0,6,0.8)", inkLight: "rgba(255,200,200,0.25)", roughness: 0.18, clearcoat: 1 },
	emerald: { base: "#0f5a45", light: "#2a8f6f", edge: "#03251b", ink: "#f3e3b5", inkShadow: "rgba(0,20,10,0.8)", inkLight: "rgba(200,255,220,0.2)", roughness: 0.2, clearcoat: 1 },
};

function themeFor(theme: DiceTheme, spec: VisualDieSpec): ThemeColors {
	if (theme !== "mixed") return THEMES[theme];
	if (spec.shape === 20) return THEMES.crimson;
	if (spec.mode === "tens" || spec.mode === "ones") return THEMES.obsidian;
	return THEMES.bone;
}

// ─── Face layout (UV atlas) ──────────────────────────────────────────────

const CELL = 128;

interface FaceLayout {
	/** Canvas-space polygon. */
	pts: [number, number][];
	/** UV per face vertex (same order as DieFace.verts). */
	uvs: [number, number][];
	center: [number, number];
	inradius: number;
}

interface AtlasLayout {
	width: number;
	height: number;
	faces: FaceLayout[];
}

const layoutCache = new Map<DieShape, AtlasLayout>();

function atlasLayout(def: DieDef): AtlasLayout {
	const hit = layoutCache.get(def.shape);
	if (hit) return hit;
	const n = def.faces.length;
	const cols = Math.ceil(Math.sqrt(n));
	const rows = Math.ceil(n / cols);
	const width = cols * CELL;
	const height = rows * CELL;
	const faces = def.faces.map((f, fi): FaceLayout => {
		const vs = f.verts.map((i) => def.vertices[i]);
		const c = vscale(vs.reduce<Vec3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]), 1 / vs.length);
		let upDir: Vec3;
		if (def.shape === 6) upDir = sub(vscale([vs[0][0] + vs[1][0], vs[0][1] + vs[1][1], vs[0][2] + vs[1][2]], 0.5), c);
		else if (def.shape === 10) {
			const pole = vs.reduce((b, v) => (Math.abs(v[1]) > Math.abs(b[1]) ? v : b), vs[0]);
			upDir = sub(pole, c);
		} else upDir = sub(vs[0], c);
		const w = norm(sub(upDir, vscale(f.normal, dot(upDir, f.normal))));
		const r = cross(w, f.normal);
		const p2 = vs.map((v) => {
			const d = sub(v, c);
			return [dot(d, r), dot(d, w)] as [number, number];
		});
		const R = Math.max(...p2.map(([x, y]) => Math.hypot(x, y)));
		const k = (CELL / 2) * 0.9 / R;
		const ox = (fi % cols) * CELL + CELL / 2;
		const oy = Math.floor(fi / cols) * CELL + CELL / 2;
		const pts = p2.map(([x, y]) => [ox + x * k, oy - y * k] as [number, number]);
		const uvs = pts.map(([x, y]) => [x / width, 1 - y / height] as [number, number]);
		// area centroid
		let A = 0;
		let cx = 0;
		let cy = 0;
		for (let i = 0; i < pts.length; i++) {
			const [x0, y0] = pts[i];
			const [x1, y1] = pts[(i + 1) % pts.length];
			const cr = x0 * y1 - x1 * y0;
			A += cr;
			cx += (x0 + x1) * cr;
			cy += (y0 + y1) * cr;
		}
		const center: [number, number] = [cx / (3 * A), cy / (3 * A)];
		let inradius = Infinity;
		for (let i = 0; i < pts.length; i++) {
			const [x0, y0] = pts[i];
			const [x1, y1] = pts[(i + 1) % pts.length];
			const dx = x1 - x0;
			const dy = y1 - y0;
			const d = Math.abs(dx * (y0 - center[1]) - dy * (x0 - center[0])) / Math.hypot(dx, dy);
			inradius = Math.min(inradius, d);
		}
		return { pts, uvs, center, inradius };
	});
	const out = { width, height, faces };
	layoutCache.set(def.shape, out);
	return out;
}

function polyPath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
	ctx.beginPath();
	pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
	ctx.closePath();
}

const FONT = `700 SIZEpx "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`;

function drawAtlas(
	color: HTMLCanvasElement,
	bump: HTMLCanvasElement,
	def: DieDef,
	labels: number[],
	mode: LabelMode,
	t: ThemeColors,
) {
	const L = atlasLayout(def);
	const c = color.getContext("2d")!;
	const b = bump.getContext("2d")!;
	c.fillStyle = t.base;
	c.fillRect(0, 0, L.width, L.height);
	b.fillStyle = "#cfcfcf";
	b.fillRect(0, 0, L.width, L.height);

	L.faces.forEach((f, fi) => {
		const [cx, cy] = f.center;
		const R = Math.max(...f.pts.map(([x, y]) => Math.hypot(x - cx, y - cy)));
		// colour: curved-surface gradient + darkened bevel edges
		c.save();
		polyPath(c, f.pts);
		c.clip();
		const g = c.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.05, cx, cy, R * 1.05);
		g.addColorStop(0, t.light);
		g.addColorStop(0.55, t.base);
		g.addColorStop(1, t.edge);
		c.fillStyle = g;
		c.fillRect(cx - R - 2, cy - R - 2, 2 * R + 4, 2 * R + 4);
		// fine grain
		for (let i = 0; i < 90; i++) {
			const a = Math.random() * Math.PI * 2;
			const d = Math.random() * R;
			c.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${0.025 + Math.random() * 0.03})`;
			c.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.5, 1.5);
		}
		c.strokeStyle = t.edge;
		for (let w = 16; w > 0; w -= 2) {
			c.globalAlpha = 0.07;
			c.lineWidth = w;
			polyPath(c, f.pts);
			c.stroke();
		}
		c.globalAlpha = 1;
		c.restore();

		// bump: rounded edges (lower near edges)
		b.save();
		polyPath(b, f.pts);
		b.clip();
		b.strokeStyle = "#000";
		for (let w = 18; w > 0; w -= 2) {
			b.globalAlpha = 0.08;
			b.lineWidth = w;
			polyPath(b, f.pts);
			b.stroke();
		}
		b.globalAlpha = 1;
		b.restore();

		// numbers
		const anchors: { text: string; x: number; y: number; angle: number; size: number }[] = [];
		if (def.labelOn === "vertex") {
			def.faces[fi].verts.forEach((vi, k) => {
				const [vx, vy] = f.pts[k];
				const x = cx + (vx - cx) * 0.55;
				const y = cy + (vy - cy) * 0.55;
				anchors.push({ text: labelText(labels[vi], mode), x, y, angle: Math.atan2(vx - cx, -(vy - cy)), size: f.inradius * 0.78 });
			});
		} else if (def.shape === 6 && mode === "plain") {
			// classic pips
			const PIPS: Record<number, [number, number][]> = {
				1: [[0, 0]],
				2: [[-1, -1], [1, 1]],
				3: [[-1, -1], [0, 0], [1, 1]],
				4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
				5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
				6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
			};
			const sp = f.inradius * 0.52;
			const pr = f.inradius * (labels[fi] === 1 ? 0.24 : 0.15);
			for (const [px, py] of PIPS[labels[fi]] ?? []) {
				const x = cx + px * sp;
				const y = cy + py * sp;
				c.beginPath();
				c.arc(x, y + 1.2, pr, 0, Math.PI * 2);
				c.fillStyle = t.inkLight;
				c.fill();
				const pg = c.createRadialGradient(x, y - pr * 0.4, pr * 0.1, x, y, pr);
				pg.addColorStop(0, t.inkShadow);
				pg.addColorStop(0.5, t.ink);
				pg.addColorStop(1, t.ink);
				c.beginPath();
				c.arc(x, y, pr, 0, Math.PI * 2);
				c.fillStyle = labels[fi] === 1 && t === THEMES.bone ? "#8c1424" : pg;
				c.fill();
				b.beginPath();
				b.arc(x, y, pr, 0, Math.PI * 2);
				b.fillStyle = "#2a2a2a";
				b.filter = "blur(0.8px)";
				b.fill();
				b.filter = "none";
			}
		} else {
			const text = labelText(labels[fi], mode);
			const k = def.shape === 6 ? 1.05 : def.shape === 10 ? 1.0 : def.shape === 12 ? 1.0 : 1.22;
			const size = f.inradius * k * (text.length > 1 ? 0.8 : 1);
			anchors.push({ text, x: cx, y: cy + (def.shape === 20 || def.shape === 8 ? f.inradius * 0.08 : 0), angle: 0, size });
		}
		for (const a of anchors) {
			const underline = (a.text === "6" || a.text === "9") && def.shape !== 4;
			const draw = (ctx: CanvasRenderingContext2D, fill: string, dx: number, dy: number) => {
				ctx.save();
				ctx.translate(a.x, a.y);
				ctx.rotate(a.angle);
				ctx.font = FONT.replace("SIZE", a.size.toFixed(1));
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillStyle = fill;
				ctx.fillText(a.text, dx, dy + a.size * 0.04);
				if (underline) ctx.fillRect(-a.size * 0.28 + dx, a.size * 0.42 + dy, a.size * 0.56, Math.max(1.5, a.size * 0.07));
				ctx.restore();
			};
			// engraved: light lip below, dark shadow above, ink in the groove
			draw(c, t.inkLight, 0, 1.6);
			draw(c, t.inkShadow, 0, -1.2);
			draw(c, t.ink, 0, 0);
			b.filter = "blur(0.8px)";
			draw(b, "#3a3a3a", 0, 0);
			b.filter = "none";
		}
	});
}

// ─── Procedural textures for the tray ────────────────────────────────────

function canvas(w: number, h: number) {
	const cv = document.createElement("canvas");
	cv.width = w;
	cv.height = h;
	return cv;
}

function feltTexture(): THREE.CanvasTexture {
	const cv = canvas(256, 256);
	const c = cv.getContext("2d")!;
	c.fillStyle = "#1d4a3b";
	c.fillRect(0, 0, 256, 256);
	const img = c.getImageData(0, 0, 256, 256);
	for (let i = 0; i < img.data.length; i += 4) {
		const n = (Math.random() - 0.5) * 22;
		img.data[i] += n * 0.6;
		img.data[i + 1] += n;
		img.data[i + 2] += n * 0.8;
	}
	c.putImageData(img, 0, 0);
	c.globalAlpha = 0.05;
	for (let i = 0; i < 600; i++) {
		c.strokeStyle = Math.random() < 0.5 ? "#000" : "#9fd";
		c.beginPath();
		const x = Math.random() * 256;
		const y = Math.random() * 256;
		c.moveTo(x, y);
		c.lineTo(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6);
		c.stroke();
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function feltShade(): THREE.CanvasTexture {
	// soft vignette so the felt reads as lit from above
	const cv = canvas(256, 256);
	const c = cv.getContext("2d")!;
	const g = c.createRadialGradient(128, 118, 20, 128, 128, 180);
	g.addColorStop(0, "rgba(0,0,0,0)");
	g.addColorStop(1, "rgba(0,0,0,0.55)");
	c.fillStyle = g;
	c.fillRect(0, 0, 256, 256);
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function woodTexture(): THREE.CanvasTexture {
	const cv = canvas(512, 64);
	const c = cv.getContext("2d")!;
	const g = c.createLinearGradient(0, 0, 0, 64);
	g.addColorStop(0, "#7a4a26");
	g.addColorStop(0.5, "#5c3519");
	g.addColorStop(1, "#43240f");
	c.fillStyle = g;
	c.fillRect(0, 0, 512, 64);
	for (let i = 0; i < 46; i++) {
		const y0 = Math.random() * 64;
		const amp = 1 + Math.random() * 3;
		const fr = 0.005 + Math.random() * 0.02;
		const ph = Math.random() * 10;
		c.strokeStyle = Math.random() < 0.7 ? `rgba(30,12,2,${0.15 + Math.random() * 0.25})` : `rgba(180,120,70,${0.1 + Math.random() * 0.15})`;
		c.lineWidth = 0.6 + Math.random() * 1.4;
		c.beginPath();
		for (let x = 0; x <= 512; x += 8) {
			const y = y0 + Math.sin(x * fr + ph) * amp + Math.sin(x * fr * 3.7) * amp * 0.3;
			if (x) c.lineTo(x, y);
			else c.moveTo(x, y);
		}
		c.stroke();
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

function haloTexture(): THREE.CanvasTexture {
	const cv = canvas(128, 128);
	const c = cv.getContext("2d")!;
	const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
	g.addColorStop(0, "rgba(255,255,255,1)");
	g.addColorStop(0.25, "rgba(255,255,255,0.55)");
	g.addColorStop(0.6, "rgba(255,255,255,0.12)");
	g.addColorStop(1, "rgba(255,255,255,0)");
	c.fillStyle = g;
	c.fillRect(0, 0, 128, 128);
	return new THREE.CanvasTexture(cv);
}

function shadowTexture(): THREE.CanvasTexture {
	const cv = canvas(128, 128);
	const c = cv.getContext("2d")!;
	const g = c.createRadialGradient(64, 64, 20, 64, 64, 64);
	g.addColorStop(0, "rgba(0,0,0,0.75)");
	g.addColorStop(1, "rgba(0,0,0,0)");
	c.fillStyle = g;
	c.fillRect(0, 0, 128, 128);
	return new THREE.CanvasTexture(cv);
}

// ─── Engine ─────────────────────────────────────────────────────────────

const STEP = 1 / 60;
const MAX_STEPS = 60 * 7;

interface LiveDie {
	spec: VisualDieSpec;
	def: DieDef;
	mesh: THREE.Mesh;
	material: THREE.MeshPhysicalMaterial;
	colorTex: THREE.CanvasTexture;
	bumpTex: THREE.CanvasTexture;
	colorCanvas: HTMLCanvasElement;
	bumpCanvas: HTMLCanvasElement;
	/** Recorded frames: [px,py,pz,qx,qy,qz,qw] * n */
	frames: Float32Array;
	frameCount: number;
}

export interface ThrowOptions {
	crit?: "gold" | "red" | null;
	/** Index into specs of the die that glows. */
	critIndex?: number;
}

export interface DiceEngineOptions {
	theme?: DiceTheme;
	/** Called during playback when dice hit something (0..1 strength). */
	onImpact?: (strength: number) => void;
	/** Playback speed of the pre-simulated throw (1 = real time). */
	speed?: number;
}

export class DiceEngine {
	private renderer: THREE.WebGLRenderer;
	private scene = new THREE.Scene();
	private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
	private tray = new THREE.Group();
	private dice: LiveDie[] = [];
	private glow: { sprite: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; light: THREE.PointLight; die: LiveDie; color: THREE.Color } | null = null;
	private raf = 0;
	private running = false;
	private ro: ResizeObserver;
	private bounds = { halfW: 8, halfD: 5, cz: 0 };
	private playback: { start: number; length: number; impacts: { frame: number; strength: number }[]; nextImpact: number; resolve: () => void } | null = null;
	private dimStart = 0;
	private settledAt = 0;
	private disposables: { dispose(): void }[] = [];
	private haloTex: THREE.CanvasTexture;
	private theme: DiceTheme;
	private onImpact?: (s: number) => void;
	private speed = 1;

	constructor(private container: HTMLElement, opts: DiceEngineOptions = {}) {
		this.theme = opts.theme ?? "mixed";
		this.onImpact = opts.onImpact;
		this.speed = opts.speed ?? 1;
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
		const r = this.renderer;
		r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		r.setClearColor(0x000000, 0);
		r.outputColorSpace = THREE.SRGBColorSpace;
		r.toneMapping = THREE.ACESFilmicToneMapping;
		r.toneMappingExposure = 1.05;
		r.shadowMap.enabled = true;
		r.shadowMap.type = THREE.PCFShadowMap;
		r.domElement.style.width = "100%";
		r.domElement.style.height = "100%";
		r.domElement.style.display = "block";
		container.appendChild(r.domElement);

		const pmrem = new THREE.PMREMGenerator(r);
		const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
		this.scene.environment = env;
		this.scene.environmentIntensity = 0.45;
		this.disposables.push(env, pmrem);

		const hemi = new THREE.HemisphereLight(0xfff1dc, 0x20160e, 0.7);
		const key = new THREE.DirectionalLight(0xffecd2, 2.6);
		key.position.set(-7, 16, 6);
		key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048);
		key.shadow.radius = 5;
		key.shadow.bias = -0.0004;
		key.shadow.normalBias = 0.02;
		const sc = key.shadow.camera;
		sc.left = -16;
		sc.right = 16;
		sc.top = 16;
		sc.bottom = -16;
		sc.near = 1;
		sc.far = 50;
		const warm = new THREE.PointLight(0xffa860, 60, 40, 2);
		warm.position.set(9, 7, -6);
		const rim = new THREE.DirectionalLight(0x9fb8ff, 0.5);
		rim.position.set(6, 6, -10);
		this.scene.add(hemi, key, warm, rim, this.tray);

		this.haloTex = haloTexture();
		this.disposables.push(this.haloTex);

		this.ro = new ResizeObserver(() => this.resize());
		this.ro.observe(container);
		this.resize();
	}

	/** Viewport → camera placement + tray bounds (tray sits above the result card area). */
	private resize() {
		const w = Math.max(1, this.container.clientWidth);
		const h = Math.max(1, this.container.clientHeight);
		this.renderer.setSize(w, h, false);
		const aspect = w / h;
		this.camera.aspect = aspect;
		const dist = 26 * Math.min(2.4, Math.max(1, 1.25 / aspect));
		this.camera.position.set(0, dist * 0.96, dist * 0.27);
		this.camera.lookAt(0, 0, 0);
		this.camera.updateProjectionMatrix();
		this.camera.updateMatrixWorld();
		const hit = (nx: number, ny: number) => {
			const v = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera);
			const dir = v.sub(this.camera.position).normalize();
			const t = -this.camera.position.y / dir.y;
			return this.camera.position.clone().add(dir.multiplyScalar(t));
		};
		const bottom = hit(0.78, -0.42);
		const top = hit(0.78, 0.82);
		const halfD = Math.max(3.2, (bottom.z - top.z) / 2);
		const halfW = Math.max(3.4, Math.min(bottom.x, halfD * 1.9, 13));
		this.bounds = { halfW, halfD, cz: (bottom.z + top.z) / 2 };
		this.buildTray();
		if (!this.running) this.render();
	}

	private buildTray() {
		this.buildTrayDispose();
		const { halfW, halfD, cz } = this.bounds;
		this.tray.position.set(0, 0, cz);

		const felt = feltTexture();
		felt.repeat.set(halfW / 2.5, halfD / 2.5);
		const floor = new THREE.Mesh(
			new THREE.PlaneGeometry(halfW * 2, halfD * 2),
			new THREE.MeshStandardMaterial({ map: felt, roughness: 0.95, metalness: 0, color: 0xffffff }),
		);
		floor.rotation.x = -Math.PI / 2;
		floor.receiveShadow = true;
		const shade = new THREE.Mesh(
			new THREE.PlaneGeometry(halfW * 2, halfD * 2),
			new THREE.MeshBasicMaterial({ map: feltShade(), transparent: true, depthWrite: false }),
		);
		shade.rotation.x = -Math.PI / 2;
		shade.position.y = 0.005;

		const drop = new THREE.Mesh(
			new THREE.PlaneGeometry(halfW * 2 + 5, halfD * 2 + 5),
			new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
		);
		drop.rotation.x = -Math.PI / 2;
		drop.position.set(0.6, -0.75, 0.6);

		const woodMat = new THREE.MeshPhysicalMaterial({ map: woodTexture(), roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.4 });
		const rail = 0.7;
		const height = 0.9;
		const mk = (w: number, d: number, x: number, z: number, rotate: boolean) => {
			const geo = new THREE.BoxGeometry(w, height, d);
			const m = new THREE.Mesh(geo, woodMat.clone());
			if (rotate) {
				const mat = m.material as THREE.MeshPhysicalMaterial;
				mat.map = mat.map!.clone();
				mat.map.rotation = Math.PI / 2;
			}
			m.position.set(x, height / 2 - 0.15, z);
			m.castShadow = true;
			m.receiveShadow = true;
			return m;
		};
		const walls = [
			mk(halfW * 2 + rail * 2, rail, 0, -halfD - rail / 2, false),
			mk(halfW * 2 + rail * 2, rail, 0, halfD + rail / 2, false),
			mk(rail, halfD * 2, -halfW - rail / 2, 0, true),
			mk(rail, halfD * 2, halfW + rail / 2, 0, true),
		];
		// base under the felt so the frame reads as one piece
		const base = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + rail * 2, 0.6, halfD * 2 + rail * 2), woodMat);
		base.position.y = -0.31;
		base.receiveShadow = true;
		this.tray.add(drop, base, floor, shade, ...walls);
	}

	private buildDie(spec: VisualDieSpec): LiveDie {
		const def = getDieDef(spec.shape);
		const L = atlasLayout(def);
		const positions: number[] = [];
		const normals: number[] = [];
		const uvs: number[] = [];
		def.faces.forEach((f, fi) => {
			for (let k = 1; k < f.verts.length - 1; k++) {
				for (const idx of [0, k, k + 1]) {
					positions.push(...def.vertices[f.verts[idx]]);
					normals.push(...f.normal);
					uvs.push(...L.faces[fi].uvs[idx]);
				}
			}
		});
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
		geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
		const colorCanvas = canvas(L.width, L.height);
		const bumpCanvas = canvas(L.width, L.height);
		const colorTex = new THREE.CanvasTexture(colorCanvas);
		colorTex.colorSpace = THREE.SRGBColorSpace;
		colorTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
		const bumpTex = new THREE.CanvasTexture(bumpCanvas);
		const t = themeFor(this.theme, spec);
		const material = new THREE.MeshPhysicalMaterial({
			map: colorTex,
			bumpMap: bumpTex,
			bumpScale: 0.05,
			roughness: t.roughness,
			metalness: 0,
			clearcoat: t.clearcoat,
			clearcoatRoughness: 0.18,
			envMapIntensity: 1,
		});
		const mesh = new THREE.Mesh(geo, material);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		return { spec, def, mesh, material, colorTex, bumpTex, colorCanvas, bumpCanvas, frames: new Float32Array(0), frameCount: 0 };
	}

	private paint(d: LiveDie, labels: number[]) {
		drawAtlas(d.colorCanvas, d.bumpCanvas, d.def, labels, d.spec.mode, themeFor(this.theme, d.spec));
		d.colorTex.needsUpdate = true;
		d.bumpTex.needsUpdate = true;
	}

	/** Pre-simulates, relabels and replays. Resolves once every die has settled on screen. */
	throw(specs: VisualDieSpec[], opts: ThrowOptions = {}): Promise<void> {
		this.clear();
		const { halfW, halfD, cz } = this.bounds;
		const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82 * 3.2, 0), allowSleep: true });
		const diceMat = new CANNON.Material("dice");
		const floorMat = new CANNON.Material("floor");
		const wallMat = new CANNON.Material("wall");
		world.addContactMaterial(new CANNON.ContactMaterial(diceMat, floorMat, { friction: 0.32, restitution: 0.42 }));
		world.addContactMaterial(new CANNON.ContactMaterial(diceMat, wallMat, { friction: 0.05, restitution: 0.65 }));
		world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.12, restitution: 0.5 }));
		const plane = (pos: CANNON.Vec3, axis: CANNON.Vec3, angle: number, mat: CANNON.Material) => {
			const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
			b.position.copy(pos);
			b.quaternion.setFromAxisAngle(axis, angle);
			world.addBody(b);
		};
		plane(new CANNON.Vec3(0, 0, 0), new CANNON.Vec3(1, 0, 0), -Math.PI / 2, floorMat);
		plane(new CANNON.Vec3(-halfW, 0, 0), new CANNON.Vec3(0, 1, 0), Math.PI / 2, wallMat);
		plane(new CANNON.Vec3(halfW, 0, 0), new CANNON.Vec3(0, 1, 0), -Math.PI / 2, wallMat);
		plane(new CANNON.Vec3(0, 0, cz - halfD), new CANNON.Vec3(0, 1, 0), 0, wallMat);
		plane(new CANNON.Vec3(0, 0, cz + halfD), new CANNON.Vec3(0, 1, 0), Math.PI, wallMat);
		plane(new CANNON.Vec3(0, 12, 0), new CANNON.Vec3(1, 0, 0), Math.PI / 2, wallMat);

		const side = Math.random() < 0.5 ? -1 : 1;
		const live = specs.map((s) => this.buildDie(s));
		const bodies = live.map((d, i) => {
			const shape = new CANNON.ConvexPolyhedron({
				vertices: d.def.vertices.map((v) => new CANNON.Vec3(v[0], v[1], v[2])),
				faces: d.def.faces.map((f) => [...f.verts]),
			});
			const body = new CANNON.Body({ mass: 1, material: diceMat, shape, linearDamping: 0.08, angularDamping: 0.08, allowSleep: true, sleepSpeedLimit: 0.18, sleepTimeLimit: 0.3 });
			const col = i % 2;
			const row = Math.floor(i / 2) % 4;
			const layer = Math.floor(i / 8);
			const zSpan = Math.min(halfD * 0.7, 3.3);
			body.position.set(
				side * (halfW - 1.4 - col * 2.3 - Math.random() * 0.3),
				2.2 + layer * 2.4 + Math.random(),
				cz + (row - 1.5) * (zSpan / 1.5) * 0.9 + (Math.random() - 0.5) * 0.6,
			);
			body.quaternion.setFromEuler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
			body.velocity.set(-side * (15 + Math.random() * 9), -1 + Math.random() * 4, (Math.random() - 0.5) * 8);
			body.angularVelocity.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
			world.addBody(body);
			return body;
		});

		const impacts: { frame: number; strength: number }[] = [];
		let step = 0;
		let lastImpact = -10;
		bodies.forEach((b) =>
			b.addEventListener("collide", (e: { contact: CANNON.ContactEquation }) => {
				const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
				if (v > 2.5 && step - lastImpact > 3) {
					lastImpact = step;
					impacts.push({ frame: step, strength: Math.min(1, v / 18) });
				}
			}),
		);

		const rec: number[][] = live.map(() => []);
		let quiet = 0;
		for (step = 0; step < MAX_STEPS; step++) {
			if (step === 150) bodies.forEach((b) => ((b.linearDamping = 0.5), (b.angularDamping = 0.5)));
			world.step(STEP);
			bodies.forEach((b, i) => rec[i].push(b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
			const asleep = bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING || (b.velocity.length() < 0.05 && b.angularVelocity.length() < 0.08));
			quiet = asleep ? quiet + 1 : 0;
			if (quiet > 8) break;
		}

		// settle: ease cocked dice flat, relabel so the top reads the target value
		const SNAP = 14;
		live.forEach((d, i) => {
			const r = rec[i];
			const n = r.length / 7;
			const o = (n - 1) * 7;
			const q: Quat = [r[o + 3], r[o + 4], r[o + 5], r[o + 6]];
			const pos: Vec3 = [r[o], r[o + 1], r[o + 2]];
			const flatEnough = flatness(d.def, q) > 0.995;
			const fq = flatEnough ? q : flattenQuat(d.def, q);
			const fy = -minY(d.def, fq);
			const qa = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
			const qb = new THREE.Quaternion(fq[0], fq[1], fq[2], fq[3]);
			const tmp = new THREE.Quaternion();
			for (let s = 1; s <= SNAP; s++) {
				const t = flatEnough ? 1 : 1 - Math.pow(1 - s / SNAP, 3);
				tmp.slerpQuaternions(qa, qb, t);
				r.push(pos[0], pos[1] + (fy - pos[1]) * t, pos[2], tmp.x, tmp.y, tmp.z, tmp.w);
			}
			d.frames = new Float32Array(r);
			d.frameCount = r.length / 7;
			const labels = relabelForTarget(d.def, defaultLabels(d.def, d.spec.mode, d.spec.sides), fq, d.spec.target, d.spec.mode);
			this.paint(d, labels);
			this.scene.add(d.mesh);
		});
		this.dice = live;
		this.applyFrame(0);

		const length = Math.max(...live.map((d) => d.frameCount), 1);
		return new Promise<void>((resolve) => {
			this.playback = { start: performance.now(), length, impacts, nextImpact: 0, resolve };
			this.pendingCrit = opts.crit ? { color: opts.crit, index: opts.critIndex ?? -1 } : null;
			this.start();
		});
	}

	private pendingCrit: { color: "gold" | "red"; index: number } | null = null;

	private applyFrame(f: number) {
		const q1 = new THREE.Quaternion();
		const q2 = new THREE.Quaternion();
		for (const d of this.dice) {
			const last = d.frameCount - 1;
			const fi = Math.min(Math.floor(f), last);
			const fj = Math.min(fi + 1, last);
			const t = Math.min(1, f - fi);
			const a = fi * 7;
			const b = fj * 7;
			const F = d.frames;
			d.mesh.position.set(F[a] + (F[b] - F[a]) * t, F[a + 1] + (F[b + 1] - F[a + 1]) * t, F[a + 2] + (F[b + 2] - F[a + 2]) * t);
			q1.set(F[a + 3], F[a + 4], F[a + 5], F[a + 6]);
			q2.set(F[b + 3], F[b + 4], F[b + 5], F[b + 6]);
			d.mesh.quaternion.slerpQuaternions(q1, q2, t);
		}
	}

	private start() {
		if (this.running) return;
		this.running = true;
		const loop = () => {
			if (!this.running) return;
			this.tick(performance.now());
			this.raf = requestAnimationFrame(loop);
		};
		this.raf = requestAnimationFrame(loop);
	}

	private stop() {
		this.running = false;
		cancelAnimationFrame(this.raf);
	}

	private tick(now: number) {
		const pb = this.playback;
		if (pb) {
			const f = (((now - pb.start) / 1000) * this.speed) / STEP;
			this.applyFrame(f);
			while (pb.nextImpact < pb.impacts.length && pb.impacts[pb.nextImpact].frame <= f) {
				this.onImpact?.(pb.impacts[pb.nextImpact].strength);
				pb.nextImpact++;
			}
			if (f >= pb.length - 1) {
				this.applyFrame(pb.length - 1);
				this.playback = null;
				this.settledAt = now;
				this.dimStart = now;
				if (this.pendingCrit) this.addGlow(this.pendingCrit.color, this.pendingCrit.index);
				pb.resolve();
			}
		}
		// dim dropped dice after settle
		if (!pb && this.dimStart) {
			const k = Math.min(1, (now - this.dimStart) / 450);
			for (const d of this.dice) {
				if (!d.spec.dropped) continue;
				d.material.transparent = true;
				d.material.opacity = 1 - 0.5 * k;
				d.material.color.setScalar(1 - 0.68 * k);
				d.material.envMapIntensity = 1 - 0.8 * k;
				d.material.clearcoat = d.material.clearcoat * (1 - k);
				d.material.specularIntensity = 1 - 0.8 * k;
				d.mesh.castShadow = k < 0.5;
			}
			if (k >= 1) this.dimStart = 0;
		}
		if (this.glow) {
			const t = (now - this.settledAt) / 1000;
			const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
			const intro = Math.min(1, t / 0.35);
			const p = this.glow.die.mesh.position;
			// glow pool on the felt around the die + a soft coloured light + faint emissive rim
			this.glow.sprite.position.set(p.x, 0.02, p.z);
			this.glow.sprite.scale.setScalar((5.5 + pulse * 1.0) * (0.6 + 0.4 * intro) * (1 + Math.max(0, 0.6 - t) * 1.5));
			this.glow.sprite.material.opacity = (0.75 + 0.25 * pulse) * intro;
			this.glow.light.position.set(p.x, p.y + 2.4, p.z + 0.6);
			this.glow.light.intensity = (5 + 4 * pulse) * intro;
			this.glow.die.material.emissive.copy(this.glow.color);
			this.glow.die.material.emissiveIntensity = (0.05 + 0.06 * pulse) * intro;
		}
		this.render();
		if (!this.playback && !this.glow && !this.dimStart) this.stop();
	}

	private addGlow(color: "gold" | "red", index: number) {
		const die = this.dice[index] ?? this.dice.find((d) => d.spec.shape === 20 && !d.spec.dropped);
		if (!die) return;
		const c = new THREE.Color(color === "gold" ? 0xffc23d : 0xff2a2a);
		const sprite = new THREE.Mesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({ map: this.haloTex, color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }),
		);
		sprite.rotation.x = -Math.PI / 2;
		sprite.renderOrder = 2;
		const light = new THREE.PointLight(c, 0, 9, 2);
		this.scene.add(sprite, light);
		this.glow = { sprite, light, die, color: c };
	}

	private render() {
		this.renderer.render(this.scene, this.camera);
	}

	/** Removes dice (keeps the tray). */
	clear() {
		if (this.playback) {
			const r = this.playback.resolve;
			this.playback = null;
			r();
		}
		this.pendingCrit = null;
		if (this.glow) {
			this.scene.remove(this.glow.sprite, this.glow.light);
			this.glow.sprite.material.dispose();
			this.glow.sprite.geometry.dispose();
			this.glow.light.dispose();
			this.glow = null;
		}
		for (const d of this.dice) {
			this.scene.remove(d.mesh);
			d.mesh.geometry.dispose();
			d.material.dispose();
			d.colorTex.dispose();
			d.bumpTex.dispose();
		}
		this.dice = [];
		this.dimStart = 0;
		this.stop();
		this.render();
	}

	dispose() {
		this.clear();
		this.ro.disconnect();
		this.buildTrayDispose();
		for (const d of this.disposables) d.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		this.renderer.domElement.remove();
	}

	private buildTrayDispose() {
		for (const child of [...this.tray.children]) {
			this.tray.remove(child);
			child.traverse((o) => {
				const m = o as THREE.Mesh;
				m.geometry?.dispose();
				const mat = m.material as THREE.MeshStandardMaterial | undefined;
				mat?.map?.dispose();
				mat?.dispose();
			});
		}
	}
}

/** True if a WebGL context can be created. */
export function webglAvailable(): boolean {
	try {
		const c = document.createElement("canvas");
		return !!(c.getContext("webgl2") || c.getContext("webgl"));
	} catch {
		return false;
	}
}
