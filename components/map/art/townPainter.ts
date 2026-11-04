import type { LocationKind, TerrainFeature, WorldLocation, WorldMap } from "@/lib/game/types";
import { fbm, hashString, makeNoise2D, type Noise2D } from "@/lib/maps/noise";
import { WORLD_ASPECT } from "@/lib/maps/world";
import { exitPoint, inView, type MapView } from "@/lib/maps/region";
import type { OverlayOptions } from "./worldPainter";

/**
 * Modern town-map painter (Canvas 2D) for worlds with `terrain.style = "town"`
 * (Kessler Falls, docs/zombie.md §6): a folded, slightly worn paper street map
 * instead of the parchment atlas. Everything is generated in world units
 * (X = x·aspect, Y = y; one unit = the map's height) and drawn through the
 * view transform, so the Region view is a true zoom of the same town.
 * The base layer depends only on the world and view; the overlay (place
 * badges, labels, travel times) is redrawn on hover and discovery changes.
 */

const A = WORLD_ASPECT;
type P = [number, number];

/** Map scale: one map-height unit ≈ 22 km (fitted to the in-town walking times). */
export const KM_PER_UNIT = 22;
/** Walking pace used for the scale bar. */
const WALK_KMH = 5;

/** Travel time in whole minutes for a route length in days (rounded like a printed map). */
export function travelMinutes(days: number): number {
	const raw = days * 24 * 60;
	return raw < 20 ? Math.max(1, Math.round(raw)) : Math.round(raw / 5) * 5;
}

/** Region view of a town: a fixed zoom (about a third of the town) centred on the party. */
export function townRegionView(world: WorldMap): MapView {
	const here = world.locations.find((l) => l.id === world.currentLocationId);
	if (!here) return { x0: 0, y0: 0, s: 1 };
	const s = 0.4;
	return { x0: Math.max(0, Math.min(1 - s, here.x - s / 2)), y0: Math.max(0, Math.min(1 - s, here.y - s / 2)), s };
}

// ─── palette ────────────────────────────────────────────────────────────

const C = {
	paper: "#eeece5",
	paperDark: "#e4e1d8",
	ink: "#2b2d2f",
	inkSoft: "#5d6166",
	water: "#a9c9de",
	waterEdge: "#7ea8c4",
	waterLine: "#c4dbe9",
	park: "#d9e6c6",
	wood: "#c9dab3",
	woodEdge: "#a5bf8e",
	tree: "#b0c99a",
	treeDark: "#93b07d",
	marsh: "#d3e2d3",
	contour: "rgba(150,122,88,0.5)",
	contourIdx: "rgba(140,110,76,0.7)",
	core: "#c6bfb3",
	coreEdge: "#a39b8e",
	coreBldg: "#b3ab9e",
	resi: "#dcd6ca",
	resiEdge: "#c9c1b3",
	house: "#c5bcac",
	street: "#fbfaf6",
	streetEdge: "#aaa397",
	road: "#fdf3cf",
	roadEdge: "#958a76",
	hwy: "#f0c160",
	hwyEdge: "#8a6630",
	rail: "#646466",
	lot: "#d6d5d0",
	lotEdge: "#b6b3ab",
	bldg: "#b4ada2",
	bldgEdge: "#8c867c",
	fence: "#55585c",
};

// ─── geometry helpers ──────────────────────────────────────────────────

const W = (x: number, y: number): P => [x * A, y];

function rng(seed: number) {
	let a = seed >>> 0 || 1;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Centripetal-ish Catmull-Rom through the points. */
function spline(pts: P[], seg = 10): P[] {
	if (pts.length < 3) return pts.slice();
	const out: P[] = [];
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
		for (let s = 0; s < seg; s++) {
			const t = s / seg, t2 = t * t, t3 = t2 * t;
			out.push([
				0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
				0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
			]);
		}
	}
	out.push(pts[pts.length - 1]);
	return out;
}

function normals(poly: P[]): P[] {
	return poly.map((_, i) => {
		const a = poly[Math.max(0, i - 1)], b = poly[Math.min(poly.length - 1, i + 1)];
		const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
		return [-dy / l, dx / l];
	});
}

function offsetPoly(poly: P[], d: number | ((i: number) => number)): P[] {
	const n = normals(poly);
	return poly.map((p, i) => {
		const k = typeof d === "number" ? d : d(i);
		return [p[0] + n[i][0] * k, p[1] + n[i][1] * k];
	});
}

/** Distance from p to the polyline, and the index of the nearest vertex segment. */
function distPoly(p: P, poly: P[]): { d: number; i: number } {
	let best = Infinity, bi = 0;
	for (let i = 0; i < poly.length - 1; i++) {
		const a = poly[i], b = poly[i + 1];
		const dx = b[0] - a[0], dy = b[1] - a[1];
		const l2 = dx * dx + dy * dy || 1e-12;
		const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
		const d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
		if (d < best) { best = d; bi = i; }
	}
	return { d: best, i: bi };
}

function polyLength(poly: P[]): number {
	let s = 0;
	for (let i = 1; i < poly.length; i++) s += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
	return s;
}

function pointAlong(poly: P[], f: number): { p: P; ang: number } {
	const total = polyLength(poly) * f;
	let s = 0;
	for (let i = 1; i < poly.length; i++) {
		const l = Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
		if (s + l >= total) {
			const t = l ? (total - s) / l : 0;
			return { p: [poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * t, poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * t], ang: Math.atan2(poly[i][1] - poly[i - 1][1], poly[i][0] - poly[i - 1][0]) };
		}
		s += l;
	}
	const n = poly.length;
	return { p: poly[n - 1], ang: Math.atan2(poly[n - 1][1] - poly[n - 2][1], poly[n - 1][0] - poly[n - 2][0]) };
}

/** A gently bent road between two places (normalized coords in, normalized polyline out). */
export function townRoad(a: { x: number; y: number }, b: { x: number; y: number }, id: string, seed: number): { x: number; y: number }[] {
	const ax = a.x * A, ay = a.y, bx = b.x * A, by = b.y;
	const len = Math.hypot(bx - ax, by - ay) || 1;
	const r = rng(hashString(id) ^ seed);
	const bend = (r() - 0.5) * 0.22 * len;
	const nx = -(by - ay) / len, ny = (bx - ax) / len;
	const mx = (ax + bx) / 2 + nx * bend, my = (ay + by) / 2 + ny * bend;
	const out: { x: number; y: number }[] = [];
	for (let i = 0; i <= 24; i++) {
		const t = i / 24, u = 1 - t;
		out.push({ x: (u * u * ax + 2 * u * t * mx + t * t * bx) / A, y: u * u * ay + 2 * u * t * my + t * t * by });
	}
	return out;
}

// ─── town layout ───────────────────────────────────────────────────────

type Style = "core" | "residential" | "suburb" | "campus" | "mall" | "industrial" | "farm" | "compound" | "prison" | "hospital" | "plant" | "roadside";
interface Zone { id: string; style: Style; c: P; R: number; ang: number; g: number }

/** Kessler Falls districts by place id (ids are stable across languages). */
const ZONE_BY_ID: Record<string, [Style, number] | null> = {
	downtown: ["core", 0.085],
	precinct: null,
	"st-agnes": null,
	"st-brigids": ["hospital", 0.034],
	hollis: ["campus", 0.062],
	"old-mill": ["industrial", 0.034],
	mall: ["mall", 0.036],
	route9: ["roadside", 0.016],
	pinecrest: ["suburb", 0.068],
	granger: ["farm", 0.055],
	armory: ["compound", 0.022],
	prison: ["prison", 0.03],
	water: ["plant", 0.02],
	"bald-hill": null,
	"north-bridge": null,
	"south-bridge": null,
};
const ZONE_BY_KIND: Partial<Record<LocationKind, [Style, number]>> = {
	city: ["core", 0.1], town: ["core", 0.07], village: ["suburb", 0.05], castle: ["compound", 0.025], ruins: ["industrial", 0.03], camp: ["roadside", 0.015], temple: ["residential", 0.03], landmark: ["residential", 0.025],
};

const shortId = (id: string) => id.replace(/^loc-kf-/, "");

/** Kessler Falls geography that isn't in the world data: river, dam, highway, rail, roads off the map. */
const KESSLER = {
	river: [[0.455, -0.04], [0.47, 0.06], [0.5, 0.2], [0.522, 0.29], [0.54, 0.37], [0.537, 0.45], [0.546, 0.53], [0.562, 0.59], [0.58, 0.68], [0.598, 0.77], [0.62, 0.84], [0.628, 0.885], [0.605, 0.925], [0.565, 0.95], [0.545, 0.985], [0.55, 1.05]] as P[],
	damY: 0.578,
	pond: [0.5, 0.578] as P,
	highway: [[1.05, 0.81], [0.94, 0.765], [0.85, 0.722], [0.775, 0.703], [0.722, 0.718], [0.69, 0.79], [0.664, 0.85], [0.63, 0.873], [0.59, 0.885], [0.53, 0.912], [0.46, 0.96], [0.4, 1.05]] as P[],
	rail: [[0.39, -0.04], [0.445, 0.1], [0.477, 0.2], [0.503, 0.29], [0.519, 0.37], [0.517, 0.45], [0.52, 0.53], [0.533, 0.6], [0.553, 0.68], [0.571, 0.76], [0.59, 0.83], [0.615, 0.9], [0.66, 0.97], [0.69, 1.05]] as P[],
	exits: [
		["north-bridge", [[0.488, 0.1], [0.475, -0.05]]],
		["armory", [[0.12, 0.25], [-0.05, 0.22]]],
		["prison", [[0.92, 0.17], [1.05, 0.1]]],
		["granger", [[0.1, 0.82], [-0.05, 0.86]]],
		["st-brigids", [[0.3, 0.2], [0.27, -0.05]]],
	] as [string, P[]][],
};

interface Layout {
	zones: Zone[];
	river: P[] | null;
	riverHalf: number[];
	highway: P[] | null;
	rail: P[] | null;
	roads: { id: string; pts: P[]; discovered: boolean }[];
	features: TerrainFeature[];
	noise: Noise2D;
	seed: number;
	kessler: boolean;
	places: Map<string, P>;
}

/** Builds the town's geometry; undiscovered places (and the roads to them) stay off the map unless `showUndiscovered`. */
function buildLayout(world: WorldMap, showUndiscovered = false): Layout {
	const kessler = world.locations.some((l) => l.id.startsWith("loc-kf-"));
	const seed = world.seed >>> 0;
	const noise = makeNoise2D(seed ^ 0x70b1);
	const zones: Zone[] = [];
	const known = (l: WorldLocation | undefined) => !!l && (l.discovered || showUndiscovered);
	for (const l of world.locations) {
		if (!known(l)) continue;
		const z = kessler ? ZONE_BY_ID[shortId(l.id)] : ZONE_BY_KIND[l.kind];
		const spec = z === undefined ? ZONE_BY_KIND[l.kind] : z;
		if (!spec) continue;
		const r = rng(hashString(l.id) ^ seed);
		const [style, R] = spec;
		zones.push({ id: l.id, style, c: W(l.x, l.y), R, ang: (r() - 0.5) * 0.5, g: style === "core" ? 0.0105 : 0.013 });
	}
	// Ordinary residential streets around the busy districts.
	const grow: Partial<Record<Style, number>> = { core: 2.3, campus: 1.7, hospital: 2, mall: 1.6, industrial: 1.5 };
	for (const z of zones.slice()) {
		const k = grow[z.style];
		if (!k) continue;
		const r = rng(hashString(z.id + "res") ^ seed);
		zones.push({ id: `${z.id}-res`, style: "residential", c: z.c, R: z.R * k, ang: z.style === "core" ? z.ang : (r() - 0.5) * 0.9, g: 0.0125 });
	}
	let river: P[] | null = null;
	let riverHalf: number[] = [];
	if (kessler) {
		const base = spline(KESSLER.river.map(([x, y]) => W(x, y)), 14);
		const nn = makeNoise2D(seed ^ 0x51ce);
		// Small meanders on top of the fixed course.
		river = offsetPoly(base, (i) => nn(i * 0.045, 3.3) * 0.006);
		riverHalf = river.map(([, y]) => {
			const pond = Math.exp(-(((y - 0.545) / 0.03) ** 2)) * (y < KESSLER.damY ? 1 : 0);
			return 0.0098 * (1 + 0.75 * pond + (y > 0.8 ? 0.15 : 0));
		});
	}
	const roads: Layout["roads"] = [];
	const byId = new Map(world.locations.map((l) => [l.id, l]));
	for (const r of world.routes) {
		const a = byId.get(r.from), b = byId.get(r.to);
		if (!a || !b || !known(a) || !known(b) || !(r.discovered || showUndiscovered)) continue;
		roads.push({ id: r.id, pts: townRoad(a, b, r.id, seed).map((p) => W(p.x, p.y)), discovered: r.discovered });
	}
	if (kessler) for (const [from, pts] of KESSLER.exits) {
		const a = byId.get(`loc-kf-${from}`)!;
		if (known(a)) roads.push({ id: `exit-${from}`, pts: spline([W(a.x, a.y), ...pts.map(([x, y]) => W(x, y))], 10), discovered: true });
	}
	return {
		zones,
		river,
		riverHalf,
		highway: kessler ? spline(KESSLER.highway.map(([x, y]) => W(x, y)), 10) : null,
		rail: kessler ? spline(KESSLER.rail.map(([x, y]) => W(x, y)), 10) : null,
		roads,
		features: world.terrain.features ?? [],
		noise,
		seed,
		kessler,
		places: new Map(world.locations.map((l) => [l.id, W(l.x, l.y)])),
	};
}

/** Distance from p to the river bank (negative = in the water). */
function riverGap(L: Layout, p: P): number {
	if (!L.river) return Infinity;
	const { d, i } = distPoly(p, L.river);
	return d - L.riverHalf[i];
}

// ─── painting ──────────────────────────────────────────────────────────

export interface TownBaseOptions {
	fontFamily: string;
	pixelRatio?: number;
	/** Big title (the town) and the line under it. */
	title: string;
	subtitle: string;
	/** Name printed on a terrain feature (localized), or undefined for none. */
	featureName?: (f: TerrainFeature) => string | undefined;
	damLabel: string;
	/** "12 min on foot" for the scale bar. */
	walkLabel: (minutes: number) => string;
	/** DM view: draw undiscovered places' districts and roads too. */
	showUndiscovered?: boolean;
}

type Ctx = CanvasRenderingContext2D;

type Rect = [number, number, number, number];

/** Paints the base layer; returns the screen boxes of the map furniture (title, scale, north arrow) for label placement. */
export function paintTownBase(canvas: HTMLCanvasElement, world: WorldMap, view: MapView, opt: TownBaseOptions): Rect[] {
	const ctx = canvas.getContext("2d")!;
	const Wpx = canvas.width, Hpx = canvas.height;
	const u = Math.max(Wpx / 1000, 0.85 * (opt.pixelRatio ?? 1));
	const L = buildLayout(world, opt.showUndiscovered);
	const kx = Wpx / (view.s * A), ky = Hpx / view.s;
	const k = Math.min(kx, ky);
	/** Device pixels → world units. */
	const px = (n: number) => n / k;
	const lw = (world: number, minPx: number) => Math.max(world, px(minPx));

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = C.paper;
	ctx.fillRect(0, 0, Wpx, Hpx);
	ctx.setTransform(kx, 0, 0, ky, -view.x0 * A * kx, -view.y0 * ky);
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	const vis = { x0: view.x0 * A - 0.05, y0: view.y0 - 0.05, x1: (view.x0 + view.s) * A + 0.05, y1: view.y0 + view.s + 0.05 };
	const near = (p: P, r: number) => p[0] + r > vis.x0 && p[0] - r < vis.x1 && p[1] + r > vis.y0 && p[1] - r < vis.y1;

	// 1. paper tone
	const tone = makeNoise2D(L.seed ^ 0x99);
	for (let gy = 0; gy < 40; gy++) for (let gx = 0; gx < 60; gx++) {
		const x = (gx / 60) * A, y = gy / 40;
		const n = fbm(tone, x * 3, y * 3, 3);
		if (n > 0.05) { ctx.fillStyle = `rgba(214,208,192,${Math.min(0.35, (n - 0.05) * 0.9)})`; ctx.fillRect(x, y, A / 60 + 0.001, 1 / 40 + 0.001); }
	}

	// 2. terrain
	for (const f of L.features) if (f.terrain === "plains" && near(W(f.x, f.y), f.r)) paintFields(ctx, L, W(f.x, f.y), f.r, hashString(f.id), true, px);
	for (const f of L.features) if (f.terrain === "hills" || f.terrain === "mountains") paintContours(ctx, L, f, px, u, near);
	for (const f of L.features) if (f.terrain === "forest") paintWoods(ctx, L, W(f.x, f.y), f.r, hashString(f.id), px, near);
	for (const f of L.features) if (f.terrain === "marsh") paintMarsh(ctx, L, W(f.x, f.y), f.r, hashString(f.id), px, near);

	paintCountryside(ctx, L, px, near);

	// 3. riverside parks and the river
	if (L.river) {
		ctx.strokeStyle = C.park;
		ctx.lineWidth = 0.034;
		ctx.beginPath();
		const park = L.river.filter(([, y]) => y > 0.26 && y < 0.84);
		park.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
		ctx.stroke();
	}

	// 4. districts
	for (const z of L.zones) if (z.style === "farm") paintFields(ctx, L, z.c, z.R, hashString(z.id), false, px);
	paintGrids(ctx, L, px, near);
	for (const z of L.zones) {
		if (!near(z.c, z.R * 1.5)) continue;
		const r = rng(hashString(z.id) ^ L.seed ^ 0x2a);
		switch (z.style) {
			case "suburb": paintSuburb(ctx, L, z, r, px); break;
			case "campus": paintCampus(ctx, L, z, r, px); break;
			case "mall": paintMall(ctx, z, r, px); break;
			case "industrial": paintIndustrial(ctx, L, z, r, px); break;
			case "plant": paintPlant(ctx, z, r, px); break;
			case "compound": paintCompound(ctx, z, r, px, false); break;
			case "prison": paintCompound(ctx, z, r, px, true); break;
			case "hospital": paintHospital(ctx, z, r, px, opt.fontFamily); break;
			case "roadside": paintRoadside(ctx, z, r, px); break;
			case "farm": paintFarmstead(ctx, z, r, px); break;
			default: break;
		}
	}

	// 5. water on top of the ground
	if (L.river) paintRiver(ctx, L, px, opt, u);

	// 6. rail, roads, highway (with bridges where they cross the river)
	if (L.rail) paintRail(ctx, L, L.rail, px, u);
	const roadW = lw(0.0024, 2.6 * u);
	for (const r of L.roads) strokePoly(ctx, r.pts, C.roadEdge, roadW + px(1.6 * u));
	for (const r of L.roads) paintBridges(ctx, L, r.pts, roadW, px, u);
	for (const r of L.roads) strokePoly(ctx, r.pts, C.road, roadW);
	if (L.highway) {
		const hw = lw(0.0046, 5 * u);
		strokePoly(ctx, L.highway, C.hwyEdge, hw + px(2.2 * u));
		paintBridges(ctx, L, L.highway, hw, px, u);
		strokePoly(ctx, L.highway, C.hwy, hw);
		ctx.setLineDash([px(6 * u), px(6 * u)]);
		strokePoly(ctx, L.highway, "rgba(255,250,235,0.85)", px(0.9 * u));
		ctx.setLineDash([]);
	}

	// 7. names on the land
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	const toPx = (p: P): P => [(p[0] - view.x0 * A) * kx, (p[1] - view.y0) * ky];
	const landNames: Rect[] = [];
	for (const f of L.features) {
		const name = opt.featureName ? opt.featureName(f) : f.name;
		if (!name) continue;
		const hill = f.terrain === "hills" || f.terrain === "mountains";
		const c = toPx(W(f.x, f.y + f.r * (hill ? 0.32 : 0.15)));
		const size = Math.max(11 * u, Math.min(17 * u, f.r * ky * 0.16));
		const text = hill ? name.toUpperCase() : name;
		ctx.font = `${hill ? 600 : 500} ${hill ? "" : "italic "}${Math.round(size)}px ${opt.fontFamily}`.replace("  ", " ");
		const half = (ctx.measureText(text).width + (hill ? size * 0.28 : size * 0.04) * text.length) / 2;
		// Names whose land lies off this view are left out; ones near the edge are nudged in.
		if (c[0] < 0 || c[0] > Wpx || c[1] < 20 * u || c[1] > Hpx - 12 * u) continue;
		c[0] = Math.max(24 * u + half, Math.min(Wpx - 16 * u - half, c[0]));
		landNames.push([c[0] - half, c[1] - size * 0.6, half * 2, size * 1.2]);
		spacedText(ctx, text, c[0], c[1], `${hill ? 600 : 500} ${hill ? "" : "italic "}${Math.round(size)}px ${opt.fontFamily}`.replace("  ", " "), hill ? size * 0.28 : size * 0.04, hill ? "rgba(120,92,60,0.85)" : "rgba(70,100,55,0.9)", "rgba(240,238,230,0.8)", 3 * u);
	}
	if (L.highway) for (const f of [0.1, 0.52, 0.9]) {
		const { p } = pointAlong(L.highway, f);
		const q = toPx(p);
		if (q[0] > 0 && q[0] < Wpx && q[1] > 0 && q[1] < Hpx) drawShield(ctx, q[0], q[1], 11 * u * Math.min(1.6, Math.max(1, Math.sqrt(1 / view.s) / 2)), "9", opt.fontFamily);
	}
	if (L.river) {
		const i = L.river.findIndex(([, y]) => y >= KESSLER.damY);
		if (i > 0) {
			const q = toPx(L.river[i]);
			ctx.font = `italic 500 ${Math.round(11 * u * Math.min(1.5, Math.max(1, 0.35 / Math.sqrt(view.s))))}px ${opt.fontFamily}`;
			ctx.textAlign = "left";
			ctx.textBaseline = "middle";
			const tx = q[0] + L.riverHalf[i] * kx * 1.6 + 5 * u;
			ctx.lineWidth = 3 * u;
			ctx.strokeStyle = "rgba(240,238,230,0.9)";
			ctx.strokeText(opt.damLabel, tx, q[1]);
			ctx.fillStyle = "#3e6d8a";
			ctx.fillText(opt.damLabel, tx, q[1]);
		}
	}

	// 8. paper: folds, grain, wear; then the map furniture
	paintPaper(ctx, Wpx, Hpx, L.seed, u);
	paintGridRefs(ctx, Wpx, Hpx, view, u, opt.fontFamily);
	// Keep the title block off the places that will be drawn on the overlay.
	const spots = world.locations.filter((l) => l.discovered).map((l) => toPx(W(l.x, l.y)));
	const title = paintTitle(ctx, Wpx, Hpx, u, opt, spots);
	paintNorth(ctx, Wpx - 46 * u, Hpx - 58 * u, 20 * u, opt.fontFamily);
	const scale = paintScale(ctx, Wpx, Hpx, k, u, opt);
	return [title, scale, [Wpx - 72 * u, Hpx - 100 * u, 60 * u, 70 * u], ...landNames];
}

function strokePoly(ctx: Ctx, pts: P[], color: string, width: number) {
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.beginPath();
	pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
	ctx.stroke();
}

function fillPoly(ctx: Ctx, pts: P[], fill: string, stroke?: string, width?: number) {
	ctx.beginPath();
	pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
	ctx.closePath();
	ctx.fillStyle = fill;
	ctx.fill();
	if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width ?? 0.0005; ctx.stroke(); }
}

/** Rotated rectangle centred at c (w along the angle, h across). */
function rect(c: P, w: number, h: number, ang: number): P[] {
	const ca = Math.cos(ang), sa = Math.sin(ang);
	return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as P[]).map(([x, y]) => [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca]);
}

/** Point in a local frame (origin c, rotated by ang). */
function loc(c: P, ang: number, x: number, y: number): P {
	const ca = Math.cos(ang), sa = Math.sin(ang);
	return [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca];
}

/** An organic closed outline around c with mean radius r. */
function blob(c: P, r: number, seed: number, rough = 0.22, n = 72): P[] {
	const nz = makeNoise2D(seed);
	const out: P[] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		const k = 1 + rough * fbm(nz, Math.cos(a) * 1.4 + 5, Math.sin(a) * 1.4 + 5, 3);
		out.push([c[0] + Math.cos(a) * r * k, c[1] + Math.sin(a) * r * k]);
	}
	return out;
}

function inBlob(p: P, c: P, r: number, seed: number, rough = 0.22): boolean {
	const a = Math.atan2(p[1] - c[1], p[0] - c[0]);
	const nz = makeNoise2D(seed);
	const k = 1 + rough * fbm(nz, Math.cos(a) * 1.4 + 5, Math.sin(a) * 1.4 + 5, 3);
	return Math.hypot(p[0] - c[0], p[1] - c[1]) < r * k;
}

function stripes(ctx: Ctx, poly: P[], ang: number, step: number, color: string, width: number) {
	ctx.save();
	ctx.beginPath();
	poly.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
	ctx.closePath();
	ctx.clip();
	const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
	const R = Math.max(...poly.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.beginPath();
	for (let d = -R; d <= R; d += step) {
		const a = loc([cx, cy], ang, -R, d), b = loc([cx, cy], ang, R, d);
		ctx.moveTo(...a); ctx.lineTo(...b);
	}
	ctx.stroke();
	ctx.restore();
}

// terrain ───────────────────────────────────────────────────────────────

function paintContours(ctx: Ctx, L: Layout, f: TerrainFeature, px: (n: number) => number, u: number, near: (p: P, r: number) => boolean) {
	const c = W(f.x, f.y);
	if (!near(c, f.r * 1.3)) return;
	const mountain = f.terrain === "mountains";
	const step = mountain ? 0.0085 : 0.011;
	const n = Math.max(3, Math.round(f.r / step));
	const nz = makeNoise2D(hashString(f.id) ^ L.seed);
	const ring = (lvl: number) => {
		const out: P[] = [];
		const rr = f.r * (1 - lvl / (n + 0.6));
		for (let i = 0; i < 96; i++) {
			const a = (i / 96) * Math.PI * 2;
			const ca = Math.cos(a), sa = Math.sin(a);
			// shared low-frequency shape keeps rings nested; a little per-level wobble
			const k = 1 + 0.34 * fbm(nz, ca * 1.2 + 7, sa * 1.2 + 7, 3) + 0.05 * nz(ca * 3 + lvl * 0.31, sa * 3 - lvl * 0.27);
			out.push([c[0] + ca * rr * k * (mountain ? 1 : 1.12), c[1] + sa * rr * k * 0.92]);
		}
		return out;
	};
	// soft elevation tint
	for (let lvl = 0; lvl < n; lvl++) fillPoly(ctx, ring(lvl), mountain ? "rgba(170,140,100,0.045)" : "rgba(180,150,105,0.035)");
	for (let lvl = 0; lvl < n; lvl++) {
		const pts = ring(lvl);
		const index = lvl % 4 === 0;
		ctx.beginPath();
		pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
		ctx.closePath();
		ctx.strokeStyle = index ? C.contourIdx : C.contour;
		ctx.lineWidth = px((index ? 1.3 : 0.7) * u);
		ctx.stroke();
	}
	// summit mark
	ctx.fillStyle = "rgba(120,92,60,0.8)";
	const top = ring(n - 1);
	const sx = top.reduce((s, p) => s + p[0], 0) / top.length, sy = top.reduce((s, p) => s + p[1], 0) / top.length;
	ctx.beginPath(); ctx.moveTo(sx, sy - px(4 * u)); ctx.lineTo(sx + px(3.5 * u), sy + px(2.5 * u)); ctx.lineTo(sx - px(3.5 * u), sy + px(2.5 * u)); ctx.closePath(); ctx.fill();
}

function paintWoods(ctx: Ctx, L: Layout, c: P, r: number, seed: number, px: (n: number) => number, near: (p: P, r: number) => boolean) {
	if (!near(c, r * 1.4)) return;
	const outline = blob(c, r, seed ^ L.seed, 0.3);
	fillPoly(ctx, outline, C.wood, C.woodEdge, px(1));
	const rand = rng(seed ^ 0x77);
	const g = 0.0058;
	ctx.save();
	ctx.beginPath();
	outline.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
	ctx.closePath();
	ctx.clip();
	for (let y = c[1] - r * 1.4; y < c[1] + r * 1.4; y += g) for (let x = c[0] - r * 1.4; x < c[0] + r * 1.4; x += g) {
		const p: P = [x + (rand() - 0.5) * g * 0.9, y + (rand() - 0.5) * g * 0.9];
		if (!near(p, g) || riverGap(L, p) < 0.002) continue;
		const tr = g * (0.3 + rand() * 0.14);
		ctx.fillStyle = rand() < 0.5 ? C.tree : C.treeDark;
		ctx.beginPath(); ctx.arc(p[0], p[1], tr, 0, Math.PI * 2); ctx.fill();
	}
	ctx.restore();
}

function paintMarsh(ctx: Ctx, L: Layout, c: P, r: number, seed: number, px: (n: number) => number, near: (p: P, r: number) => boolean) {
	if (!near(c, r * 1.4)) return;
	const outline = blob(c, r * 1.1, seed ^ L.seed, 0.35);
	fillPoly(ctx, outline, C.marsh);
	const rand = rng(seed ^ 0x33);
	ctx.save();
	ctx.beginPath();
	outline.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
	ctx.closePath();
	ctx.clip();
	for (let i = 0; i < 9; i++) {
		const p: P = [c[0] + (rand() - 0.5) * r * 1.6, c[1] + (rand() - 0.5) * r * 1.6];
		ctx.fillStyle = "rgba(169,201,222,0.75)";
		ctx.beginPath(); ctx.ellipse(p[0], p[1], 0.003 + rand() * 0.004, 0.0015 + rand() * 0.002, rand(), 0, Math.PI * 2); ctx.fill();
	}
	ctx.strokeStyle = "#6f9a80";
	ctx.lineWidth = px(1);
	const g = 0.009;
	for (let y = c[1] - r * 1.3; y < c[1] + r * 1.3; y += g * 0.7) for (let x = c[0] - r * 1.3; x < c[0] + r * 1.3; x += g) {
		const p: P = [x + (rand() - 0.5) * g * 0.8 + ((y / g) % 2) * g * 0.5, y + (rand() - 0.5) * g * 0.4];
		if (riverGap(L, p) < 0.001) continue;
		const s = 0.0022;
		ctx.beginPath();
		ctx.moveTo(p[0] - s, p[1]); ctx.lineTo(p[0] + s, p[1]);
		for (const dx of [-0.6, 0, 0.6]) { ctx.moveTo(p[0] + dx * s, p[1]); ctx.lineTo(p[0] + dx * s * 1.4, p[1] - s * (dx === 0 ? 1.1 : 0.8)); }
		ctx.stroke();
	}
	ctx.restore();
}

/** Woodlots and field patches scattered over the open valley, away from the town. */
function paintCountryside(ctx: Ctx, L: Layout, px: (n: number) => number, near: (p: P, r: number) => boolean) {
	const rand = rng(L.seed ^ 0xc0a1);
	const step = 0.085;
	for (let y = step / 2; y < 1; y += step) for (let x = step / 2; x < A; x += step) {
		const p: P = [x + (rand() - 0.5) * step * 0.8, y + (rand() - 0.5) * step * 0.8];
		const roll = rand(), size = rand(), seed = Math.floor(rand() * 1e9);
		if (fbm(L.noise, p[0] * 4 + 20, p[1] * 4 - 20, 3) < 0.04) continue;
		if (L.zones.some((z) => Math.hypot(p[0] - z.c[0], p[1] - z.c[1]) < z.R * (z.style === "residential" ? 1.05 : 1.5) + 0.03)) continue;
		if (L.features.some((f) => Math.hypot(p[0] - f.x * A, p[1] - f.y) < f.r * (f.terrain === "hills" ? 0.55 : 1.1) + 0.02)) continue;
		if (riverGap(L, p) < 0.03 || (L.highway && distPoly(p, L.highway).d < 0.025)) continue;
		if (!near(p, 0.06)) continue;
		if (roll < 0.7) paintWoods(ctx, L, p, 0.014 + size * 0.02, seed, px, near);
		else paintFields(ctx, L, p, 0.02 + size * 0.02, seed, false, px);
	}
}

/** Patchwork farmland (orchards and crops). */
function paintFields(ctx: Ctx, L: Layout, c: P, r: number, seed: number, orchards: boolean, px: (n: number) => number) {
	const rand = rng(seed ^ L.seed ^ 0xf1e1d);
	const ang = (rand() - 0.5) * 0.6;
	const crops = ["#e7e3c2", "#dfe7c6", "#e9dfbd", "#d7e2bb", "#e3e6cf"];
	let y = -r * 1.2;
	while (y < r * 1.2) {
		const h = 0.011 + rand() * 0.012;
		let x = -r * 1.2;
		while (x < r * 1.2) {
			const w = 0.012 + rand() * 0.018;
			const mid = loc(c, ang, x + w / 2, y + h / 2);
			if (inBlob(mid, c, r, seed ^ 0x11, 0.3) && riverGap(L, mid) > 0.004) {
				const poly = rect(mid, w - 0.0012, h - 0.0012, ang);
				const orchard = orchards ? rand() < 0.65 : rand() < 0.2;
				fillPoly(ctx, poly, orchard ? "#dbe6c4" : crops[Math.floor(rand() * crops.length)], "#b9c49f", px(0.8));
				if (orchard) {
					ctx.fillStyle = "#a9c18e";
					const g = 0.0028;
					for (let yy = -h / 2 + g; yy < h / 2 - g * 0.5; yy += g) for (let xx = -w / 2 + g; xx < w / 2 - g * 0.5; xx += g) {
						const p = loc(mid, ang, xx, yy);
						ctx.beginPath(); ctx.arc(p[0], p[1], g * 0.33, 0, Math.PI * 2); ctx.fill();
					}
				} else stripes(ctx, poly, ang + (rand() < 0.5 ? 0 : Math.PI / 2), 0.0016, "rgba(150,140,100,0.35)", px(0.6));
			}
			x += w;
		}
		y += h;
	}
}

// districts ─────────────────────────────────────────────────────────────

/** Street grids: the dense downtown core and the residential blocks around everything busy. */
function paintGrids(ctx: Ctx, L: Layout, px: (n: number) => number, near: (p: P, r: number) => boolean) {
	const specials = L.zones.filter((z) => z.style !== "core" && z.style !== "residential");
	const grids = L.zones.filter((z) => z.style === "core" || z.style === "residential");
	const blocked = (p: P) => {
		if (specials.some((s) => Math.hypot(p[0] - s.c[0], p[1] - s.c[1]) < s.R * (s.style === "farm" || s.style === "suburb" ? 1.05 : 1.2))) return true;
		for (const f of L.features) {
			const d = Math.hypot(p[0] - f.x * A, p[1] - f.y);
			if ((f.terrain === "forest" || f.terrain === "marsh") && d < f.r * 1.15) return true;
			if (f.terrain === "plains" && d < f.r * 1.2) return true;
			if (f.terrain === "mountains" && d < f.r * 0.8) return true;
		}
		if (riverGap(L, p) < 0.006) return true;
		if (L.highway && distPoly(p, L.highway).d < 0.008) return true;
		if (L.rail && distPoly(p, L.rail).d < 0.0045) return true;
		return false;
	};
	// Which grid owns a point: the core beats everything, then the nearest (relative) residential zone.
	const owner = (p: P): Zone | null => {
		let best: Zone | null = null, bs = Infinity;
		for (const z of grids) {
			const d = Math.hypot(p[0] - z.c[0], p[1] - z.c[1]) / z.R;
			const n = 0.28 * fbm(L.noise, p[0] * 30, p[1] * 30, 3);
			if (d + n > 1) continue;
			const score = z.style === "core" ? d - 10 : d;
			if (score < bs) { bs = score; best = z; }
		}
		return best;
	};
	// The church square: the core block that holds St. Agnes (or any temple).
	const church = L.places.get("loc-kf-st-agnes");
	// Pass 1 decides which cells are built up and lays the street surface under them;
	// pass 2 draws the blocks, so the streets read as white lines between them.
	type Cell = { z: Zone; i: number; j: number; mid: P; ro: number; rv: number; rw: number };
	const cells: Cell[] = [];
	for (const z of grids) {
		if (!near(z.c, z.R * 1.3)) continue;
		const rand = rng(hashString(z.id) ^ L.seed ^ 0x6b);
		const n = Math.ceil((z.R * 1.35) / z.g);
		for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) {
			const mid = loc(z.c, z.ang, (i + 0.5) * z.g, (j + 0.5) * z.g);
			const ro = rand(), rv = rand(), rw = rand();
			if (!near(mid, z.g)) continue;
			if (owner(mid) !== z || blocked(mid)) continue;
			const dn = Math.hypot(mid[0] - z.c[0], mid[1] - z.c[1]) / z.R;
			if (z.style !== "core" && dn > 0.7 && ro < (dn - 0.7) * 1.3) continue;
			cells.push({ z, i, j, mid, ro, rv, rw });
		}
	}
	// Drop ragged one-block spurs so the built-up edge reads as streets, not confetti.
	for (let it = 0; it < 2; it++) {
		const key = (c: Cell) => `${c.z.id}:${c.i}:${c.j}`;
		const set = new Set(cells.map(key));
		const keep = cells.filter((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => set.has(`${c.z.id}:${c.i + di}:${c.j + dj}`)).length >= 2);
		cells.length = 0;
		cells.push(...keep);
	}
	for (const pass of [0, 1]) for (const c of cells) {
		const o = c.z.g * (pass ? 0.5 : 0.62);
		fillPoly(ctx, rect(c.mid, o * 2, o * 2, c.z.ang), pass ? C.street : C.streetEdge);
	}
	for (const z of grids) {
		if (!near(z.c, z.R * 1.3)) continue;
		const core = z.style === "core";
		let sq: [number, number] | null = null;
		if (core && church) {
			const dx = church[0] - z.c[0], dy = church[1] - z.c[1];
			const lx = dx * Math.cos(z.ang) + dy * Math.sin(z.ang), ly = -dx * Math.sin(z.ang) + dy * Math.cos(z.ang);
			sq = [Math.floor(lx / z.g), Math.floor(ly / z.g)];
		}
		for (const cell of cells) {
			if (cell.z !== z) continue;
			const { i, j, rv, rw } = cell;
			const g = z.g;
			const dn = Math.hypot(cell.mid[0] - z.c[0], cell.mid[1] - z.c[1]) / z.R;
			// avenues every fourth street
			const sx0 = i % 4 === 0 ? 0.17 : 0.11, sx1 = (i + 1) % 4 === 0 ? 0.17 : 0.11;
			const sy0 = j % 4 === 0 ? 0.17 : 0.11, sy1 = (j + 1) % 4 === 0 ? 0.17 : 0.11;
			const bx0 = (i + sx0) * g, bx1 = (i + 1 - sx1) * g, by0 = (j + sy0) * g, by1 = (j + 1 - sy1) * g;
			const quad = (x0: number, y0: number, x1: number, y1: number): P[] => [loc(z.c, z.ang, x0, y0), loc(z.c, z.ang, x1, y0), loc(z.c, z.ang, x1, y1), loc(z.c, z.ang, x0, y1)];
			const block = quad(bx0, by0, bx1, by1);
			if (core) {
				if (sq && i === sq[0] && j === sq[1]) {
					// the square in front of St. Agnes
					fillPoly(ctx, block, "#e8e4da", C.coreEdge, px(0.7));
					fillPoly(ctx, quad(bx0 + g * 0.12, by0 + g * 0.12, bx1 - g * 0.12, by1 - g * 0.12), C.park);
					ctx.strokeStyle = "#f6f4ee"; ctx.lineWidth = g * 0.05;
					ctx.beginPath(); ctx.moveTo(...loc(z.c, z.ang, bx0, by0)); ctx.lineTo(...loc(z.c, z.ang, bx1, by1)); ctx.moveTo(...loc(z.c, z.ang, bx1, by0)); ctx.lineTo(...loc(z.c, z.ang, bx0, by1)); ctx.stroke();
					continue;
				}
				if (rv < 0.035 && dn > 0.3) {
					fillPoly(ctx, block, C.park, "#bccfa6", px(0.7));
					ctx.fillStyle = C.treeDark;
					for (let t = 0; t < 4; t++) { const p = loc(z.c, z.ang, bx0 + (bx1 - bx0) * (0.25 + (t % 2) * 0.5), by0 + (by1 - by0) * (0.25 + Math.floor(t / 2) * 0.5)); ctx.beginPath(); ctx.arc(p[0], p[1], g * 0.09, 0, Math.PI * 2); ctx.fill(); }
					continue;
				}
				if (rv > 0.965) {
					fillPoly(ctx, block, C.lot, C.lotEdge, px(0.7));
					stripes(ctx, block, z.ang, g * 0.09, "rgba(255,255,255,0.7)", px(0.6));
					continue;
				}
				const outer = dn > 0.72;
				fillPoly(ctx, block, outer ? "#d3cdc1" : C.core, C.coreEdge, px(0.8));
				// building footprints
				const parts = 2 + Math.floor(rw * 3);
				const horiz = rw > 0.5;
				for (let q = 0; q < parts; q++) {
					const a0 = q / parts + 0.02, a1 = (q + 1) / parts - 0.02;
					const fx0 = horiz ? bx0 + (bx1 - bx0) * a0 : bx0 + g * 0.05, fx1 = horiz ? bx0 + (bx1 - bx0) * a1 : bx1 - g * 0.05;
					const fy0 = horiz ? by0 + g * 0.05 : by0 + (by1 - by0) * a0, fy1 = horiz ? by1 - g * 0.05 : by0 + (by1 - by0) * a1;
					const shade = (q * 37 + i * 11 + j * 7) % 3;
					fillPoly(ctx, quad(fx0, fy0, fx1, fy1), outer ? ["#c7bfb2", "#cdc6b9", "#c2baac"][shade] : ["#b5ac9f", "#bdb4a7", "#aea596"][shade]);
				}
			} else {
				fillPoly(ctx, block, C.resi, C.resiEdge, px(0.7));
				// houses round the edge of the block
				ctx.fillStyle = C.house;
				const m = 4;
				const hw = (bx1 - bx0) / m, hh = (by1 - by0) * 0.26;
				for (let q = 0; q < m; q++) {
					if ((q * 7 + i * 3 + j) % 5 === 0) continue;
					const x0 = bx0 + q * hw + hw * 0.18, x1 = bx0 + (q + 1) * hw - hw * 0.18;
					fillPoly(ctx, quad(x0, by0 + hh * 0.2, x1, by0 + hh), C.house);
					if ((q + i + j) % 4 !== 1) fillPoly(ctx, quad(x0, by1 - hh, x1, by1 - hh * 0.2), C.house);
				}
			}
		}
	}
}

function streetPath(ctx: Ctx, pts: P[], w: number, px: (n: number) => number) {
	strokePoly(ctx, pts, C.streetEdge, w + px(1.4));
	strokePoly(ctx, pts, C.street, w);
}

function paintSuburb(ctx: Ctx, L: Layout, z: Zone, rand: () => number, px: (n: number) => number) {
	const R = z.R;
	fillPoly(ctx, blob(z.c, R * 1.08, hashString(z.id) ^ 5, 0.18), "#e6ebdb");
	const streets: P[][] = [];
	const bulbs: P[] = [];
	const nz = makeNoise2D(hashString(z.id) ^ L.seed);
	// collector loop
	const loop: P[] = [];
	for (let i = 0; i <= 64; i++) {
		const a = (i / 64) * Math.PI * 2;
		const k = 0.5 * (1 + 0.2 * nz(Math.cos(a) + 3, Math.sin(a) + 3));
		loop.push([z.c[0] + Math.cos(a) * R * k * 1.15, z.c[1] + Math.sin(a) * R * k * 0.95]);
	}
	streets.push(loop);
	// branches ending in cul-de-sacs
	const nb = 12;
	for (let b = 0; b < nb; b++) {
		const a = (b / nb) * Math.PI * 2 + rand() * 0.35;
		const start = loop[Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 64) % 64];
		let h = a + (rand() - 0.5) * 0.6;
		const len = R * (0.3 + rand() * 0.25);
		const pts: P[] = [start];
		for (let s = 1; s <= 6; s++) {
			h += (rand() - 0.5) * 0.5;
			const p = pts[pts.length - 1];
			pts.push([p[0] + Math.cos(h) * len / 6, p[1] + Math.sin(h) * len / 6]);
		}
		if (pts.some((p) => riverGap(L, p) < 0.004)) continue;
		streets.push(spline(pts, 4));
		bulbs.push(pts[pts.length - 1]);
		if (rand() < 0.6) {
			const mid = pts[3];
			const side = rand() < 0.5 ? 1 : -1;
			const h2 = h + side * (1.2 + rand() * 0.4);
			const q: P[] = [mid];
			for (let s = 1; s <= 3; s++) { const p = q[q.length - 1]; q.push([p[0] + Math.cos(h2 + s * 0.15 * side) * R * 0.05, p[1] + Math.sin(h2 + s * 0.15 * side) * R * 0.05]); }
			streets.push(spline(q, 4));
			bulbs.push(q[q.length - 1]);
		}
	}
	// a cross street through the middle
	const ca = z.ang + 0.4;
	streets.push(spline([loc(z.c, ca, -R * 0.55, 0), loc(z.c, ca, -R * 0.1, R * 0.05), loc(z.c, ca, R * 0.55, -R * 0.02)], 8));
	// school, sports field and the public pool inside the loop
	const sc = loc(z.c, ca, R * 0.18, R * 0.22);
	const field = rect(loc(sc, ca, R * 0.02, R * 0.16), R * 0.28, R * 0.16, ca);
	fillPoly(ctx, field, "#cfe0b7", "#b0c796", px(0.8));
	ctx.strokeStyle = "#c79a7c"; ctx.lineWidth = R * 0.018;
	ctx.beginPath(); ctx.ellipse(...loc(sc, ca, R * 0.02, R * 0.16), R * 0.1, R * 0.05, ca, 0, Math.PI * 2); ctx.stroke();
	fillPoly(ctx, rect(sc, R * 0.24, R * 0.07, ca), C.bldg, C.bldgEdge, px(0.8));
	fillPoly(ctx, rect(loc(sc, ca, R * 0.05, -R * 0.07), R * 0.08, R * 0.08, ca), C.bldg, C.bldgEdge, px(0.8));
	const pool = loc(z.c, ca, -R * 0.25, -R * 0.2);
	fillPoly(ctx, rect(pool, R * 0.11, R * 0.07, ca), "#f4f2ec", C.lotEdge, px(0.8));
	fillPoly(ctx, rect(pool, R * 0.08, R * 0.045, ca), "#8fc3e0", "#5e9fc4", px(0.8));
	const w = 0.0024;
	for (const s of streets) strokePoly(ctx, s, C.streetEdge, w + px(1.4));
	ctx.fillStyle = C.streetEdge;
	for (const b of bulbs) { ctx.beginPath(); ctx.arc(b[0], b[1], w * 1.25 + px(0.7), 0, Math.PI * 2); ctx.fill(); }
	for (const s of streets) strokePoly(ctx, s, C.street, w);
	ctx.fillStyle = C.street;
	for (const b of bulbs) { ctx.beginPath(); ctx.arc(b[0], b[1], w * 1.25, 0, Math.PI * 2); ctx.fill(); }
	// houses along every street
	const step = 0.0042, off = 0.0043;
	for (const s of streets) {
		const len = polyLength(s);
		for (let d = step * 0.6; d < len - step * 0.3; d += step) {
			const { p, ang } = pointAlong(s, d / len);
			for (const side of [-1, 1]) {
				const hp: P = [p[0] - Math.sin(ang) * off * side, p[1] + Math.cos(ang) * off * side];
				if (Math.hypot(hp[0] - z.c[0], hp[1] - z.c[1]) > R * 1.02) continue;
				if (streets.some((o) => o !== s && distPoly(hp, o).d < off * 0.75)) continue;
				if (bulbs.some((b) => Math.hypot(hp[0] - b[0], hp[1] - b[1]) < off * 1.2)) continue;
				if (field.length && Math.hypot(hp[0] - sc[0], hp[1] - sc[1]) < R * 0.24) continue;
				if (riverGap(L, hp) < 0.002) continue;
				fillPoly(ctx, rect(hp, 0.0027, 0.0021, ang), C.house, "#b3ab9c", px(0.5));
			}
		}
	}
}

function lot(ctx: Ctx, c: P, w: number, h: number, ang: number, px: (n: number) => number) {
	const poly = rect(c, w, h, ang);
	fillPoly(ctx, poly, C.lot, C.lotEdge, px(0.8));
	stripes(ctx, poly, ang + Math.PI / 2, 0.0011, "rgba(255,255,255,0.55)", px(0.5));
	// aisles
	ctx.strokeStyle = C.lot;
	ctx.lineWidth = 0.0011;
	ctx.beginPath();
	for (let y = -h / 2 + h / 3; y < h / 2 - 0.001; y += h / 3) { ctx.moveTo(...loc(c, ang, -w / 2 + 0.0008, y)); ctx.lineTo(...loc(c, ang, w / 2 - 0.0008, y)); }
	ctx.stroke();
}

function paintCampus(ctx: Ctx, L: Layout, z: Zone, rand: () => number, px: (n: number) => number) {
	const R = z.R, a = z.ang;
	const lawn = blob(z.c, R, hashString(z.id) ^ 9, 0.16);
	fillPoly(ctx, lawn, "#d8e6c5", "#b8cfa0", px(0.8));
	// ring road
	const ring: P[] = [];
	for (let i = 0; i <= 60; i++) { const t = (i / 60) * Math.PI * 2; ring.push(loc(z.c, a, Math.cos(t) * R * 0.86, Math.sin(t) * R * 0.7)); }
	streetPath(ctx, ring, 0.0026, px);
	// footpaths
	ctx.setLineDash([px(3), px(2)]);
	for (let i = 0; i < 7; i++) {
		const t0 = rand() * Math.PI * 2, t1 = t0 + 1.5 + rand() * 2;
		const p0 = loc(z.c, a, Math.cos(t0) * R * 0.8, Math.sin(t0) * R * 0.65), p1 = loc(z.c, a, Math.cos(t1) * R * 0.8, Math.sin(t1) * R * 0.65);
		const m = loc(z.c, a, (rand() - 0.5) * R * 0.3, (rand() - 0.5) * R * 0.3);
		ctx.strokeStyle = "#f8f7f1"; ctx.lineWidth = 0.0012;
		ctx.beginPath(); ctx.moveTo(...p0); ctx.quadraticCurveTo(...m, ...p1); ctx.stroke();
	}
	ctx.setLineDash([]);
	// quad with diagonal paths
	const quad = rect(z.c, R * 0.55, R * 0.3, a);
	fillPoly(ctx, quad, "#e4eed8", "#f8f7f1", 0.0012);
	ctx.strokeStyle = "#f8f7f1"; ctx.lineWidth = 0.001;
	ctx.beginPath(); ctx.moveTo(...quad[0]); ctx.lineTo(...quad[2]); ctx.moveTo(...quad[1]); ctx.lineTo(...quad[3]); ctx.stroke();
	// halls along the quad
	for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
		const c = loc(z.c, a, (i - 1) * R * 0.2, side * R * 0.25);
		const w = R * (0.13 + rand() * 0.04), h = R * (0.08 + rand() * 0.04);
		fillPoly(ctx, rect(c, w, h, a), C.bldg, C.bldgEdge, px(0.8));
	}
	// library tower at the head of the quad, science building with its wing
	const lib = loc(z.c, a, R * 0.37, 0);
	fillPoly(ctx, rect(lib, R * 0.13, R * 0.13, a), "#9d958a", "#7c766d", px(0.8));
	fillPoly(ctx, rect(lib, R * 0.06, R * 0.06, a), "#857e74");
	const sci = loc(z.c, a, -R * 0.42, R * 0.05);
	fillPoly(ctx, rect(sci, R * 0.1, R * 0.32, a), C.bldg, C.bldgEdge, px(0.8));
	fillPoly(ctx, rect(loc(sci, a, -R * 0.1, R * 0.12), R * 0.14, R * 0.08, a), "#a69e93", C.bldgEdge, px(0.8));
	// dorms
	for (let i = 0; i < 4; i++) fillPoly(ctx, rect(loc(z.c, a, R * (0.05 + i * 0.12), -R * 0.5), R * 0.08, R * 0.05, a + 0.1), C.bldg, C.bldgEdge, px(0.8));
	// stadium and parking
	const fieldC = loc(z.c, a, R * 0.62, R * 0.4);
	fillPoly(ctx, rect(fieldC, R * 0.36, R * 0.22, a), "#cfe0b7", "#b0c796", px(0.8));
	ctx.strokeStyle = "#c79a7c"; ctx.lineWidth = R * 0.02;
	ctx.beginPath(); ctx.ellipse(fieldC[0], fieldC[1], R * 0.14, R * 0.075, a, 0, Math.PI * 2); ctx.stroke();
	lot(ctx, loc(z.c, a, -R * 0.15, R * 0.6), R * 0.34, R * 0.16, a, px);
	if (riverGap(L, z.c) < R) lot(ctx, loc(z.c, a, -R * 0.75, -R * 0.3), R * 0.16, R * 0.22, a, px);
}

function paintMall(ctx: Ctx, z: Zone, rand: () => number, px: (n: number) => number) {
	const R = z.R, a = z.ang;
	// the sea of parking
	const lotPoly = rect(z.c, R * 2.1, R * 1.45, a);
	fillPoly(ctx, lotPoly, C.lot, C.lotEdge, px(0.8));
	stripes(ctx, lotPoly, a + Math.PI / 2, 0.0012, "rgba(255,255,255,0.6)", px(0.5));
	ctx.strokeStyle = C.lot;
	ctx.lineWidth = 0.0016;
	ctx.beginPath();
	for (let y = -R * 0.6; y <= R * 0.6; y += R * 0.2) { ctx.moveTo(...loc(z.c, a, -R * 1.02, y)); ctx.lineTo(...loc(z.c, a, R * 1.02, y)); }
	ctx.stroke();
	ctx.fillStyle = "#a9c290";
	for (let y = -R * 0.6; y <= R * 0.6; y += R * 0.2) for (let x = -R * 0.9; x <= R * 0.9; x += R * 0.3) { const p = loc(z.c, a, x, y); ctx.beginPath(); ctx.arc(p[0], p[1], 0.0009, 0, Math.PI * 2); ctx.fill(); }
	// perimeter drive
	const ring = [...rect(z.c, R * 2.2, R * 1.55, a)];
	ring.push(ring[0]);
	streetPath(ctx, ring, 0.0024, px);
	// mall: concourse with anchor stores; a big-box store in the corner
	const mc = loc(z.c, a, -R * 0.15, -R * 0.05);
	fillPoly(ctx, rect(mc, R * 1.0, R * 0.26, a), "#aaa398", "#7f796f", px(0.9));
	fillPoly(ctx, rect(loc(mc, a, -R * 0.5, 0), R * 0.28, R * 0.46, a), "#9f988d", "#7f796f", px(0.9));
	fillPoly(ctx, rect(loc(mc, a, R * 0.5, 0), R * 0.24, R * 0.42, a), "#9f988d", "#7f796f", px(0.9));
	fillPoly(ctx, rect(loc(mc, a, 0, R * 0.2), R * 0.22, R * 0.2, a), "#a59e93", "#7f796f", px(0.9));
	fillPoly(ctx, rect(loc(z.c, a, R * 0.62, R * 0.45), R * 0.5 + rand() * R * 0.05, R * 0.3, a), "#a8a196", "#7f796f", px(0.9));
}

function paintIndustrial(ctx: Ctx, L: Layout, z: Zone, rand: () => number, px: (n: number) => number) {
	const R = z.R;
	// align the mills with the river
	let a = z.ang;
	if (L.river) { const { i } = distPoly(z.c, L.river); const p = L.river[i], q = L.river[Math.min(L.river.length - 1, i + 1)]; a = Math.atan2(q[1] - p[1], q[0] - p[0]); }
	fillPoly(ctx, blob(z.c, R * 1.1, hashString(z.id) ^ 3, 0.38), "#e0dbd0", "#cbc4b6", px(0.8));
	for (let i = 0; i < 8; i++) {
		const c = loc(z.c, a, ((i % 4) - 1.5) * R * 0.42 + (rand() - 0.5) * R * 0.08, (Math.floor(i / 4) - 0.5) * R * 0.5);
		if (riverGap(L, c) < 0.004) continue;
		const w = R * (0.3 + rand() * 0.12), h = R * (0.14 + rand() * 0.08);
		const poly = rect(c, w, h, a);
		fillPoly(ctx, poly, i % 2 ? "#ab9a8a" : "#a39f97", "#7b7268", px(0.9));
		stripes(ctx, poly, a + Math.PI / 2, R * 0.05, "rgba(90,80,70,0.35)", px(0.6));
	}
	// smokestack
	const s = loc(z.c, a, R * 0.1, R * 0.35);
	ctx.fillStyle = "#7b7268"; ctx.beginPath(); ctx.arc(s[0], s[1], R * 0.045, 0, Math.PI * 2); ctx.fill();
	ctx.fillStyle = "#4f4a44"; ctx.beginPath(); ctx.arc(s[0], s[1], R * 0.02, 0, Math.PI * 2); ctx.fill();
	// rail yard sidings beside the main line
	if (L.rail) {
		const near = L.rail.filter((p) => Math.hypot(p[0] - z.c[0], p[1] - z.c[1]) < R * 1.25);
		if (near.length > 2) for (const k of [-1, -2, -3]) {
			const sd = offsetPoly(near, (i) => k * 0.0022 * Math.sin((i / (near.length - 1)) * Math.PI) ** 0.5);
			strokePoly(ctx, sd, C.rail, px(0.9));
		}
	}
}

function paintPlant(ctx: Ctx, z: Zone, rand: () => number, px: (n: number) => number) {
	const R = z.R, a = z.ang;
	const yard = rect(z.c, R * 2, R * 1.4, a);
	fillPoly(ctx, yard, "#e1e0d8");
	ctx.setLineDash([px(3), px(2)]);
	fillPoly(ctx, yard, "rgba(0,0,0,0)", C.fence, px(1));
	ctx.setLineDash([]);
	for (let i = 0; i < 3; i++) {
		const c = loc(z.c, a, (i - 1) * R * 0.6, -R * 0.25);
		ctx.fillStyle = "#b9d4e5"; ctx.strokeStyle = "#6f9cbb"; ctx.lineWidth = px(1);
		ctx.beginPath(); ctx.arc(c[0], c[1], R * 0.24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
		ctx.beginPath(); ctx.arc(c[0], c[1], R * 0.05, 0, Math.PI * 2); ctx.stroke();
		ctx.beginPath(); ctx.moveTo(c[0] - R * 0.24, c[1]); ctx.lineTo(c[0] + R * 0.24, c[1]); ctx.stroke();
	}
	for (let i = 0; i < 2; i++) fillPoly(ctx, rect(loc(z.c, a, (i - 0.5) * R * 0.8, R * 0.35), R * 0.7, R * 0.3, a), "#b9d4e5", "#6f9cbb", px(1));
	fillPoly(ctx, rect(loc(z.c, a, R * 0.8, R * 0.35), R * 0.25, R * 0.2 + rand() * 0.0001, a), C.bldg, C.bldgEdge, px(0.8));
}

function paintCompound(ctx: Ctx, z: Zone, rand: () => number, px: (n: number) => number, prison: boolean) {
	const R = z.R, a = z.ang;
	const outer = rect(z.c, R * 2, R * 1.5, a);
	fillPoly(ctx, outer, prison ? "#dedcd4" : "#dfdfd3");
	for (const k of prison ? [1, 0.9] : [1]) {
		ctx.setLineDash([px(3), px(1.6)]);
		fillPoly(ctx, rect(z.c, R * 2 * k, R * 1.5 * k, a), "rgba(0,0,0,0)", C.fence, px(1.1));
	}
	ctx.setLineDash([]);
	if (prison) {
		// telephone-pole cell blocks, yard, guard towers
		fillPoly(ctx, rect(loc(z.c, a, -R * 0.15, 0), R * 1.1, R * 0.1, a), "#9c9890", "#6f6b64", px(0.9));
		for (let i = 0; i < 4; i++) fillPoly(ctx, rect(loc(z.c, a, -R * 0.55 + i * R * 0.27, 0), R * 0.1, R * 0.95, a), "#a5a19a", "#6f6b64", px(0.9));
		fillPoly(ctx, rect(loc(z.c, a, R * 0.68, R * 0.2), R * 0.42, R * 0.6, a), "#d9dfc8", "#b5bea0", px(0.8));
		for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) fillPoly(ctx, rect(loc(z.c, a, sx * R * 0.95, sy * R * 0.7), R * 0.1, R * 0.1, a), "#5f5c57");
	} else {
		fillPoly(ctx, rect(loc(z.c, a, -R * 0.4, -R * 0.25), R * 0.75, R * 0.4, a), "#a2a393", "#717263", px(0.9));
		fillPoly(ctx, rect(loc(z.c, a, -R * 0.5, R * 0.4), R * 0.5, R * 0.3, a), "#a2a393", "#717263", px(0.9));
		ctx.fillStyle = "#6f7a4f";
		for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) fillPoly(ctx, rect(loc(z.c, a, R * (0.25 + c * 0.17), R * (-0.35 + r * 0.3)), R * 0.11, R * 0.18 + rand() * 0.00001, a), "#77804f");
	}
}

function paintHospital(ctx: Ctx, z: Zone, rand: () => number, px: (n: number) => number, font: string) {
	const R = z.R, a = z.ang;
	fillPoly(ctx, blob(z.c, R * 1.15, hashString(z.id), 0.14), "#e1ead5", "#c4d3b0", px(0.8));
	const ring: P[] = [];
	for (let i = 0; i <= 48; i++) { const t = (i / 48) * Math.PI * 2; ring.push(loc(z.c, a, Math.cos(t) * R * 0.95, Math.sin(t) * R * 0.75)); }
	streetPath(ctx, ring, 0.0024, px);
	// H-plan main building with a tower block
	fillPoly(ctx, rect(loc(z.c, a, -R * 0.35, 0), R * 0.18, R * 0.85, a), "#b0a89c", "#857e74", px(0.9));
	fillPoly(ctx, rect(loc(z.c, a, R * 0.3, 0), R * 0.18, R * 0.85, a), "#b0a89c", "#857e74", px(0.9));
	fillPoly(ctx, rect(z.c, R * 0.6, R * 0.2, a), "#a69e92", "#857e74", px(0.9));
	// helipad
	const hp = loc(z.c, a, R * 0.62, -R * 0.42);
	ctx.fillStyle = "#f2f1ec"; ctx.strokeStyle = "#6c6f73"; ctx.lineWidth = px(1);
	ctx.beginPath(); ctx.arc(hp[0], hp[1], R * 0.14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
	ctx.save(); ctx.translate(hp[0], hp[1]); ctx.rotate(a);
	ctx.fillStyle = "#6c6f73"; ctx.font = `700 ${R * 0.18}px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("H", 0, 0);
	ctx.restore();
	lot(ctx, loc(z.c, a, 0, R * 0.6), R * 0.75, R * 0.25, a, px);
	lot(ctx, loc(z.c, a, -R * 0.5, -R * 0.62), R * 0.4 + rand() * 0.00001, R * 0.2, a, px);
}

function paintRoadside(ctx: Ctx, z: Zone, rand: () => number, px: (n: number) => number) {
	const R = z.R, a = z.ang;
	lot(ctx, z.c, R * 2.2, R * 1.2, a, px);
	// motel L and the gas canopy with its pumps
	fillPoly(ctx, rect(loc(z.c, a, -R * 0.6, -R * 0.3), R * 0.9, R * 0.3, a), "#b0a497", "#827669", px(0.9));
	fillPoly(ctx, rect(loc(z.c, a, -R * 0.95, R * 0.1), R * 0.3, R * 0.6, a), "#b0a497", "#827669", px(0.9));
	const g = loc(z.c, a, R * 0.55, R * 0.05);
	fillPoly(ctx, rect(g, R * 0.6, R * 0.45, a), "#e7e3da", "#8a857c", px(0.9));
	ctx.fillStyle = "#c2593b";
	for (let i = 0; i < 3; i++) { const p = loc(g, a, (i - 1) * R * 0.17, 0); ctx.beginPath(); ctx.arc(p[0], p[1], R * 0.045 + rand() * 0.00001, 0, Math.PI * 2); ctx.fill(); }
}

function paintFarmstead(ctx: Ctx, z: Zone, rand: () => number, px: (n: number) => number) {
	const R = z.R, a = z.ang;
	const yard = blob(z.c, R * 0.22, hashString(z.id) ^ 2, 0.15);
	fillPoly(ctx, yard, "#e9e4d6", "#c9c1ae", px(0.8));
	fillPoly(ctx, rect(loc(z.c, a, -R * 0.06, 0), R * 0.14, R * 0.09, a), "#a65a43", "#73392a", px(0.9));
	fillPoly(ctx, rect(loc(z.c, a, R * 0.09, R * 0.08), R * 0.07, R * 0.06, a), "#c5bcae", "#8a8174", px(0.9));
	const s = loc(z.c, a, -R * 0.02, -R * 0.11);
	ctx.fillStyle = "#b9bbbd"; ctx.strokeStyle = "#6e7174"; ctx.lineWidth = px(0.9);
	ctx.beginPath(); ctx.arc(s[0], s[1], R * 0.035 + rand() * 0.00001, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

// water, rail, bridges ─────────────────────────────────────────────────

function paintRiver(ctx: Ctx, L: Layout, px: (n: number) => number, opt: TownBaseOptions, u: number) {
	const river = L.river!;
	const left = offsetPoly(river, (i) => L.riverHalf[i]);
	const right = offsetPoly(river, (i) => -L.riverHalf[i]);
	const poly = [...left, ...right.reverse()];
	fillPoly(ctx, poly, C.water);
	// classic water lining near the banks
	for (const f of [0.62, 0.8]) {
		strokePoly(ctx, offsetPoly(river, (i) => L.riverHalf[i] * f), C.waterLine, px(0.8));
		strokePoly(ctx, offsetPoly(river, (i) => -L.riverHalf[i] * f), C.waterLine, px(0.8));
	}
	strokePoly(ctx, left, C.waterEdge, px(1.1));
	strokePoly(ctx, offsetPoly(river, (i) => -L.riverHalf[i]), C.waterEdge, px(1.1));
	// the dam: a concrete wall across the river, white water below it
	const i = river.findIndex(([, y]) => y >= KESSLER.damY);
	if (i > 0) {
		const p = river[i], q = river[i + 1];
		const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
		const hw = L.riverHalf[i] * 1.25;
		const nx = -Math.sin(ang), ny = Math.cos(ang);
		ctx.lineCap = "butt";
		strokePoly(ctx, [[p[0] - nx * hw, p[1] - ny * hw], [p[0] + nx * hw, p[1] + ny * hw]], "#5b6066", Math.max(0.0032, px(3 * u)));
		ctx.lineCap = "round";
		ctx.strokeStyle = "rgba(255,255,255,0.85)";
		ctx.lineWidth = px(1 * u);
		for (let k = 1; k <= 3; k++) {
			const d = 0.0025 * k;
			const c: P = [p[0] + Math.cos(ang) * d, p[1] + Math.sin(ang) * d];
			ctx.beginPath();
			ctx.moveTo(c[0] - nx * hw * 0.7, c[1] - ny * hw * 0.7);
			ctx.quadraticCurveTo(c[0] + Math.cos(ang) * 0.0015, c[1] + Math.sin(ang) * 0.0015, c[0] + nx * hw * 0.7, c[1] + ny * hw * 0.7);
			ctx.stroke();
		}
	}
	void opt;
}

function paintRail(ctx: Ctx, L: Layout, rail: P[], px: (n: number) => number, u: number) {
	paintBridges(ctx, L, rail, px(2 * u), px, u);
	strokePoly(ctx, rail, C.rail, px(1.4 * u));
	// cross ties
	const len = polyLength(rail);
	const step = Math.max(0.0028, px(7 * u));
	ctx.strokeStyle = C.rail;
	ctx.lineWidth = px(1 * u);
	ctx.beginPath();
	for (let d = 0; d < len; d += step) {
		const { p, ang } = pointAlong(rail, d / len);
		const h = Math.max(0.0012, px(3 * u));
		ctx.moveTo(p[0] - Math.sin(ang) * h, p[1] + Math.cos(ang) * h);
		ctx.lineTo(p[0] + Math.sin(ang) * h, p[1] - Math.cos(ang) * h);
	}
	ctx.stroke();
}

/** Bridge decks (dark parapets with flared ends) where a line crosses the river. */
function paintBridges(ctx: Ctx, L: Layout, pts: P[], width: number, px: (n: number) => number, u: number) {
	if (!L.river) return;
	const fine: P[] = [];
	for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < 6; s++) { const t = s / 6; fine.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]); }
	fine.push(pts[pts.length - 1]);
	const wet = fine.map((p) => riverGap(L, p) < 0.0016);
	for (let i = 0; i < fine.length; i++) {
		if (!wet[i] || (i > 0 && wet[i - 1])) continue;
		let j = i;
		while (j + 1 < fine.length && wet[j + 1]) j++;
		const run = fine.slice(Math.max(0, i - 1), Math.min(fine.length, j + 2));
		const deck = width + px(3.2 * u);
		ctx.lineCap = "butt";
		strokePoly(ctx, run, "#3f4347", deck + px(1.6 * u));
		strokePoly(ctx, run, "#e9e7e1", deck - px(0.6 * u));
		ctx.lineCap = "round";
		// flared parapet ends
		for (const [e, o] of [[run[0], run[1]], [run[run.length - 1], run[run.length - 2]]] as [P, P][]) {
			const ang = Math.atan2(o[1] - e[1], o[0] - e[0]);
			const nx = -Math.sin(ang), ny = Math.cos(ang), h = deck / 2 + px(0.8 * u);
			ctx.strokeStyle = "#3f4347";
			ctx.lineWidth = px(1.3 * u);
			ctx.beginPath();
			for (const s of [-1, 1]) {
				ctx.moveTo(e[0] + nx * h * s, e[1] + ny * h * s);
				ctx.lineTo(e[0] + nx * (h + px(3 * u)) * s - Math.cos(ang) * px(3 * u), e[1] + ny * (h + px(3 * u)) * s - Math.sin(ang) * px(3 * u));
			}
			ctx.stroke();
		}
		i = j;
	}
}

// map furniture (screen space) ─────────────────────────────────────────

function spacedText(ctx: Ctx, text: string, x: number, y: number, font: string, spacing: number, fill: string, halo: string, haloW: number) {
	ctx.font = font;
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	const ws = [...text].map((ch) => ctx.measureText(ch).width);
	const total = ws.reduce((s, w) => s + w, 0) + spacing * (text.length - 1);
	let cx = x - total / 2;
	ctx.lineJoin = "round";
	ctx.lineWidth = haloW;
	ctx.strokeStyle = halo;
	[...text].forEach((ch, i) => { ctx.strokeText(ch, cx, y); cx += ws[i] + spacing; });
	cx = x - total / 2;
	ctx.fillStyle = fill;
	[...text].forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += ws[i] + spacing; });
}

function drawShield(ctx: Ctx, x: number, y: number, s: number, label: string, font: string) {
	ctx.save();
	ctx.translate(x, y);
	const path = () => {
		ctx.beginPath();
		ctx.moveTo(-s * 0.85, -s * 0.85);
		ctx.quadraticCurveTo(-s * 0.42, -s * 1.02, 0, -s * 0.82);
		ctx.quadraticCurveTo(s * 0.42, -s * 1.02, s * 0.85, -s * 0.85);
		ctx.quadraticCurveTo(s * 1.0, s * 0.2, 0, s * 0.95);
		ctx.quadraticCurveTo(-s * 1.0, s * 0.2, -s * 0.85, -s * 0.85);
		ctx.closePath();
	};
	ctx.shadowColor = "rgba(0,0,0,0.25)";
	ctx.shadowBlur = s * 0.3;
	path();
	ctx.fillStyle = "#ffffff";
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.lineWidth = Math.max(1, s * 0.13);
	ctx.strokeStyle = "#1d1f22";
	ctx.stroke();
	ctx.fillStyle = "#1d1f22";
	ctx.font = `800 ${Math.round(s * 1.15)}px ${font}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(label, 0, s * 0.02);
	ctx.restore();
}

function paintPaper(ctx: Ctx, Wpx: number, Hpx: number, seed: number, u: number) {
	const r = rng(seed ^ 0xfade);
	// grain
	for (let i = 0; i < 2600; i++) {
		ctx.fillStyle = r() > 0.5 ? "rgba(60,55,45,0.045)" : "rgba(255,255,255,0.08)";
		ctx.fillRect(r() * Wpx, r() * Hpx, 1 + r() * 1.5 * u, 1 + r() * 1.5 * u);
	}
	// a few old stains
	for (let i = 0; i < 5; i++) {
		const x = r() * Wpx, y = r() * Hpx, rr = (0.04 + r() * 0.09) * Wpx;
		const g = ctx.createRadialGradient(x, y, rr * 0.5, x, y, rr);
		g.addColorStop(0, "rgba(140,120,80,0.05)");
		g.addColorStop(1, "rgba(140,115,70,0)");
		ctx.fillStyle = g;
		ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
	}
	// fold creases: three panels across, one fold down the middle
	const crease = (x0: number, y0: number, x1: number, y1: number) => {
		const vert = x0 === x1;
		const w = 10 * u;
		const g = vert ? ctx.createLinearGradient(x0 - w, 0, x0 + w, 0) : ctx.createLinearGradient(0, y0 - w, 0, y0 + w);
		g.addColorStop(0, "rgba(0,0,0,0)");
		g.addColorStop(0.45, "rgba(40,35,25,0.07)");
		g.addColorStop(0.5, "rgba(255,255,255,0.35)");
		g.addColorStop(0.56, "rgba(40,35,25,0.04)");
		g.addColorStop(1, "rgba(0,0,0,0)");
		ctx.fillStyle = g;
		if (vert) ctx.fillRect(x0 - w, y0, w * 2, y1 - y0); else ctx.fillRect(x0, y0 - w, x1 - x0, w * 2);
	};
	crease(Wpx / 3, 0, Wpx / 3, Hpx);
	crease((Wpx * 2) / 3, 0, (Wpx * 2) / 3, Hpx);
	crease(0, Hpx / 2, Wpx, Hpx / 2);
	// worn spots where the folds cross
	for (const fx of [Wpx / 3, (Wpx * 2) / 3]) {
		const g = ctx.createRadialGradient(fx, Hpx / 2, 0, fx, Hpx / 2, 18 * u);
		g.addColorStop(0, "rgba(255,255,255,0.35)");
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		ctx.fillRect(fx - 18 * u, Hpx / 2 - 18 * u, 36 * u, 36 * u);
	}
	const vg = ctx.createRadialGradient(Wpx / 2, Hpx / 2, Math.min(Wpx, Hpx) * 0.45, Wpx / 2, Hpx / 2, Math.max(Wpx, Hpx) * 0.75);
	vg.addColorStop(0, "rgba(60,55,45,0)");
	vg.addColorStop(1, "rgba(60,55,45,0.2)");
	ctx.fillStyle = vg;
	ctx.fillRect(0, 0, Wpx, Hpx);
}

/** Street-atlas grid references (A–F across, 1–4 down), fixed to the town so the Region view shows where it is. */
function paintGridRefs(ctx: Ctx, Wpx: number, Hpx: number, view: MapView, u: number, font: string) {
	const band = 15 * u;
	const cols = 6, rows = 4;
	const sx = (x: number) => ((x - view.x0) / view.s) * Wpx, sy = (y: number) => ((y - view.y0) / view.s) * Hpx;
	ctx.strokeStyle = "rgba(70,80,95,0.16)";
	ctx.lineWidth = Math.max(1, 0.8 * u);
	ctx.beginPath();
	for (let i = 1; i < cols; i++) { const x = sx(i / cols); if (x > 0 && x < Wpx) { ctx.moveTo(x, 0); ctx.lineTo(x, Hpx); } }
	for (let j = 1; j < rows; j++) { const y = sy(j / rows); if (y > 0 && y < Hpx) { ctx.moveTo(0, y); ctx.lineTo(Wpx, y); } }
	ctx.stroke();
	// margin bands
	ctx.fillStyle = "rgba(250,249,245,0.92)";
	ctx.fillRect(0, 0, Wpx, band);
	ctx.fillRect(0, 0, band, Hpx);
	ctx.fillRect(0, Hpx - band * 0.6, Wpx, band * 0.6);
	ctx.fillRect(Wpx - band * 0.6, 0, band * 0.6, Hpx);
	ctx.strokeStyle = "#3a3d41";
	ctx.lineWidth = Math.max(1, 1.2 * u);
	ctx.strokeRect(band, band, Wpx - band * 1.6, Hpx - band * 1.6);
	ctx.lineWidth = Math.max(1, 2 * u);
	ctx.strokeRect(1, 1, Wpx - 2, Hpx - 2);
	ctx.fillStyle = "#3a3d41";
	ctx.font = `700 ${Math.round(9.5 * u)}px ${font}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	for (let i = 0; i < cols; i++) {
		const a = Math.max(band, sx(i / cols)), b = Math.min(Wpx, sx((i + 1) / cols));
		if (b - a > 14 * u) ctx.fillText("ABCDEF"[i], (a + b) / 2, band / 2 + 0.5);
		const x = sx(i / cols);
		if (i > 0 && x > band && x < Wpx) ctx.fillRect(x - 0.5 * u, 0, Math.max(1, u), band);
	}
	for (let j = 0; j < rows; j++) {
		const a = Math.max(band, sy(j / rows)), b = Math.min(Hpx, sy((j + 1) / rows));
		if (b - a > 14 * u) ctx.fillText(String(j + 1), band / 2, (a + b) / 2);
		const y = sy(j / rows);
		if (j > 0 && y > band && y < Hpx) ctx.fillRect(0, y - 0.5 * u, band, Math.max(1, u));
	}
}

function paintTitle(ctx: Ctx, Wpx: number, Hpx: number, u: number, opt: TownBaseOptions, avoid: P[]): Rect {
	const tf = `800 ${Math.round(22 * u)}px ${opt.fontFamily}`;
	const sf = `600 ${Math.round(9.5 * u)}px ${opt.fontFamily}`;
	const title = opt.title.toUpperCase();
	const sub = opt.subtitle.toUpperCase();
	ctx.font = tf;
	const spacing = 2.2 * u;
	const tw = ctx.measureText(title).width + spacing * (title.length - 1);
	ctx.font = sf;
	const sw = ctx.measureText(sub).width + 1.4 * u * (sub.length - 1);
	const w = Math.min(Wpx * 0.6, Math.max(tw, sw) + 28 * u), h = 54 * u;
	const m = 16 * u;
	const cands: P[] = [[27 * u, 27 * u], [(Wpx - w) / 2, Hpx - h - 26 * u], [(Wpx - w) / 2, 27 * u]];
	const free = cands.find(([cx, cy]) => !avoid.some(([ax, ay]) => ax > cx - m && ax < cx + w + m && ay > cy - m && ay < cy + h + m));
	const [x, y] = free ?? cands[0];
	ctx.save();
	ctx.shadowColor = "rgba(0,0,0,0.18)";
	ctx.shadowBlur = 6 * u;
	ctx.shadowOffsetY = 2 * u;
	ctx.fillStyle = "#fbfaf6";
	ctx.fillRect(x, y, w, h);
	ctx.restore();
	ctx.strokeStyle = "#2b2d2f";
	ctx.lineWidth = Math.max(1, 1.5 * u);
	ctx.strokeRect(x, y, w, h);
	ctx.fillStyle = "#8f2a1f";
	ctx.fillRect(x, y, 5 * u, h);
	spacedText(ctx, title, x + 5 * u + (w - 5 * u) / 2, y + h * 0.4, tf, spacing, "#1f2124", "rgba(0,0,0,0)", 0);
	spacedText(ctx, sub, x + 5 * u + (w - 5 * u) / 2, y + h * 0.76, sf, 1.4 * u, "#5d6166", "rgba(0,0,0,0)", 0);
	void Hpx;
	return [x - 4 * u, y - 4 * u, w + 8 * u, h + 8 * u];
}

function paintNorth(ctx: Ctx, x: number, y: number, r: number, font: string) {
	ctx.save();
	ctx.fillStyle = "rgba(251,250,246,0.9)";
	ctx.strokeStyle = "#2b2d2f";
	ctx.lineWidth = Math.max(1, r * 0.07);
	ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
	ctx.beginPath(); ctx.moveTo(x, y - r * 0.78); ctx.lineTo(x + r * 0.36, y + r * 0.5); ctx.lineTo(x, y + r * 0.25); ctx.closePath();
	ctx.fillStyle = "#2b2d2f"; ctx.fill();
	ctx.beginPath(); ctx.moveTo(x, y - r * 0.78); ctx.lineTo(x - r * 0.36, y + r * 0.5); ctx.lineTo(x, y + r * 0.25); ctx.closePath();
	ctx.fillStyle = "#fbfaf6"; ctx.fill(); ctx.stroke();
	ctx.fillStyle = "#2b2d2f";
	ctx.font = `800 ${Math.round(r * 0.62)}px ${font}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";
	ctx.fillText("N", x, y - r - r * 0.12);
	ctx.restore();
}

function paintScale(ctx: Ctx, Wpx: number, Hpx: number, k: number, u: number, opt: TownBaseOptions): Rect {
	const pxPerKm = k / KM_PER_UNIT;
	let km = 0.1;
	for (const d of [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10]) if (pxPerKm * d <= Wpx * 0.17) km = d;
	const len = pxPerKm * km;
	const x = 15 * u + 16 * u, y = Hpx - 9 * u - 30 * u;
	const fmt = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d} km`);
	ctx.save();
	const walk = opt.walkLabel(Math.max(1, Math.round((km / WALK_KMH) * 60)));
	ctx.font = `500 ${Math.round(9.5 * u)}px ${opt.fontFamily}`;
	const box: Rect = [x - 8 * u, y - 16 * u, Math.max(len + 22 * u, ctx.measureText(walk).width + 16 * u), 40 * u];
	ctx.fillStyle = "rgba(251,250,246,0.88)";
	ctx.fillRect(...box);
	const segs = 4;
	ctx.lineWidth = Math.max(1, u);
	ctx.strokeStyle = "#2b2d2f";
	for (let i = 0; i < segs; i++) {
		ctx.fillStyle = i % 2 ? "#fbfaf6" : "#2b2d2f";
		ctx.fillRect(x + (len / segs) * i, y, len / segs, 5 * u);
	}
	ctx.strokeRect(x, y, len, 5 * u);
	ctx.fillStyle = "#2b2d2f";
	ctx.font = `600 ${Math.round(9.5 * u)}px ${opt.fontFamily}`;
	ctx.textBaseline = "bottom";
	ctx.textAlign = "left";
	ctx.fillText("0", x - 2 * u, y - 2 * u);
	ctx.textAlign = "center";
	ctx.fillText(fmt(km / 2), x + len / 2, y - 2 * u);
	ctx.textAlign = "left";
	ctx.fillText(fmt(km), x + len - 6 * u, y - 2 * u);
	ctx.font = `500 ${Math.round(9.5 * u)}px ${opt.fontFamily}`;
	ctx.textBaseline = "top";
	ctx.fillStyle = "#5d6166";
	ctx.fillText(walk, x, y + 8 * u);
	ctx.restore();
	return box;
}

// ─── overlay ───────────────────────────────────────────────────────────

type Icon = "hospital" | "police" | "church" | "college" | "mall" | "fuel" | "farm" | "tower" | "prison" | "armory" | "factory" | "water" | "bridge" | "town" | "house" | "tent" | "pin";
const ICON_BY_ID: Record<string, Icon> = {
	downtown: "town", precinct: "police", "st-agnes": "church", "st-brigids": "hospital", hollis: "college", "old-mill": "factory", mall: "mall", route9: "fuel",
	pinecrest: "house", granger: "farm", armory: "armory", prison: "prison", water: "water", "bald-hill": "tower", "north-bridge": "bridge", "south-bridge": "bridge",
};
const ICON_BY_KIND: Partial<Record<LocationKind, Icon>> = {
	city: "town", town: "town", village: "house", castle: "armory", tower: "tower", temple: "church", ruins: "factory", camp: "tent", landmark: "pin",
};
const ICON_COLOR: Record<Icon, string> = {
	hospital: "#c0392b", police: "#2c5aa0", church: "#6a4f86", college: "#9a6324", mall: "#d0782a", fuel: "#2f7d6d", farm: "#5f8a2e", tower: "#5b5f66",
	prison: "#3a3c40", armory: "#5a6b2f", factory: "#7a6c5d", water: "#2b84c0", bridge: "#5f6670", town: "#2b2d2f", house: "#8a6d4e", tent: "#8a6d4e", pin: "#5f6670",
};

export function townIcon(l: WorldLocation): Icon {
	return ICON_BY_ID[shortId(l.id)] ?? ICON_BY_KIND[l.kind] ?? "pin";
}

function drawGlyph(ctx: Ctx, icon: Icon, x: number, y: number, s: number) {
	ctx.save();
	ctx.translate(x, y);
	ctx.fillStyle = "#ffffff";
	ctx.strokeStyle = "#ffffff";
	ctx.lineWidth = s * 0.12;
	ctx.lineJoin = "round";
	ctx.lineCap = "round";
	const P2 = (pts: number[][], fill = true) => { ctx.beginPath(); pts.forEach(([a, b], i) => (i ? ctx.lineTo(a * s, b * s) : ctx.moveTo(a * s, b * s))); ctx.closePath(); if (fill) ctx.fill(); else ctx.stroke(); };
	switch (icon) {
		case "hospital":
			ctx.fillRect(-0.16 * s, -0.55 * s, 0.32 * s, 1.1 * s);
			ctx.fillRect(-0.55 * s, -0.16 * s, 1.1 * s, 0.32 * s);
			break;
		case "police": {
			// six-point badge star
			ctx.beginPath();
			for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 0.32 : 0.62) * s; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
			ctx.closePath(); ctx.fill();
			ctx.fillStyle = ICON_COLOR.police;
			ctx.beginPath(); ctx.arc(0, 0, 0.14 * s, 0, Math.PI * 2); ctx.fill();
			break;
		}
		case "church":
			ctx.fillRect(-0.1 * s, -0.62 * s, 0.2 * s, 1.24 * s);
			ctx.fillRect(-0.4 * s, -0.32 * s, 0.8 * s, 0.2 * s);
			break;
		case "college":
			P2([[-0.68, -0.12], [0, -0.45], [0.68, -0.12], [0, 0.2]]);
			P2([[-0.38, 0.02], [-0.38, 0.38], [0, 0.55], [0.38, 0.38], [0.38, 0.02], [0, 0.2]]);
			ctx.beginPath(); ctx.moveTo(0.55, -0.1); ctx.lineTo(0.55, 0.38); ctx.stroke();
			break;
		case "mall":
			ctx.beginPath(); ctx.moveTo(-0.65 * s, -0.45 * s); ctx.lineTo(-0.42 * s, -0.45 * s); ctx.lineTo(-0.25 * s, 0.22 * s); ctx.lineTo(0.48 * s, 0.22 * s); ctx.lineTo(0.62 * s, -0.25 * s); ctx.lineTo(-0.36 * s, -0.25 * s); ctx.stroke();
			P2([[-0.33, -0.2], [0.55, -0.2], [0.44, 0.15], [-0.22, 0.15]]);
			ctx.beginPath(); ctx.arc(-0.16 * s, 0.45 * s, 0.11 * s, 0, Math.PI * 2); ctx.arc(0.4 * s, 0.45 * s, 0.11 * s, 0, Math.PI * 2); ctx.fill();
			break;
		case "fuel":
			ctx.fillRect(-0.48 * s, -0.55 * s, 0.6 * s, 1.1 * s);
			ctx.fillStyle = ICON_COLOR.fuel;
			ctx.fillRect(-0.36 * s, -0.42 * s, 0.36 * s, 0.3 * s);
			ctx.beginPath(); ctx.moveTo(0.12 * s, -0.3 * s); ctx.lineTo(0.42 * s, -0.1 * s); ctx.lineTo(0.42 * s, 0.35 * s); ctx.quadraticCurveTo(0.42 * s, 0.5 * s, 0.3 * s, 0.45 * s); ctx.stroke();
			break;
		case "farm":
			P2([[-0.58, 0.52], [-0.58, -0.1], [-0.3, -0.45], [0.3, -0.45], [0.58, -0.1], [0.58, 0.52]]);
			ctx.strokeStyle = ICON_COLOR.farm;
			ctx.lineWidth = s * 0.1;
			ctx.strokeRect(-0.25 * s, 0.02 * s, 0.5 * s, 0.5 * s);
			ctx.beginPath(); ctx.moveTo(-0.25 * s, 0.02 * s); ctx.lineTo(0.25 * s, 0.52 * s); ctx.moveTo(0.25 * s, 0.02 * s); ctx.lineTo(-0.25 * s, 0.52 * s); ctx.stroke();
			break;
		case "tower":
			ctx.beginPath(); ctx.moveTo(-0.3 * s, 0.6 * s); ctx.lineTo(0, -0.35 * s); ctx.lineTo(0.3 * s, 0.6 * s); ctx.moveTo(-0.18 * s, 0.25 * s); ctx.lineTo(0.18 * s, 0.25 * s); ctx.stroke();
			ctx.lineWidth = s * 0.09;
			for (const r of [0.25, 0.45]) { ctx.beginPath(); ctx.arc(0, -0.35 * s, r * s, -Math.PI * 0.85, -Math.PI * 0.6); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -0.35 * s, r * s, -Math.PI * 0.4, -Math.PI * 0.15); ctx.stroke(); }
			break;
		case "prison":
			ctx.lineWidth = s * 0.11;
			ctx.strokeRect(-0.5 * s, -0.5 * s, 1 * s, 1 * s);
			ctx.beginPath(); for (const bx of [-0.17, 0.17]) { ctx.moveTo(bx * s, -0.5 * s); ctx.lineTo(bx * s, 0.5 * s); } ctx.stroke();
			break;
		case "armory": {
			ctx.beginPath();
			for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 0.26 : 0.64) * s; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r + 0.05 * s); }
			ctx.closePath(); ctx.fill();
			break;
		}
		case "factory":
			P2([[-0.62, 0.5], [-0.62, -0.05], [-0.3, -0.3], [-0.3, -0.05], [0.02, -0.3], [0.02, -0.05], [0.3, -0.3], [0.3, -0.62], [0.52, -0.62], [0.52, 0.5]]);
			break;
		case "water":
			ctx.beginPath(); ctx.moveTo(0, -0.62 * s); ctx.bezierCurveTo(0.2 * s, -0.25 * s, 0.48 * s, 0, 0.48 * s, 0.22 * s); ctx.arc(0, 0.22 * s, 0.48 * s, 0, Math.PI); ctx.bezierCurveTo(-0.48 * s, 0, -0.2 * s, -0.25 * s, 0, -0.62 * s); ctx.fill();
			break;
		case "bridge":
			ctx.fillRect(-0.68 * s, -0.12 * s, 1.36 * s, 0.16 * s);
			ctx.beginPath(); ctx.moveTo(-0.5 * s, 0.5 * s); ctx.lineTo(-0.5 * s, 0.04 * s); ctx.moveTo(0.5 * s, 0.5 * s); ctx.lineTo(0.5 * s, 0.04 * s); ctx.stroke();
			ctx.beginPath(); ctx.arc(0, 0.5 * s, 0.32 * s, Math.PI, 0); ctx.stroke();
			ctx.beginPath(); ctx.moveTo(-0.6 * s, -0.12 * s); ctx.quadraticCurveTo(0, -0.75 * s, 0.6 * s, -0.12 * s); ctx.stroke();
			break;
		case "town":
			ctx.fillRect(-0.6 * s, -0.1 * s, 0.38 * s, 0.62 * s);
			ctx.fillRect(-0.18 * s, -0.6 * s, 0.4 * s, 1.12 * s);
			ctx.fillRect(0.26 * s, -0.3 * s, 0.34 * s, 0.82 * s);
			ctx.fillStyle = ICON_COLOR.town;
			for (const [wx, wy] of [[-0.06, -0.42], [-0.06, -0.18], [-0.06, 0.06], [0.36, -0.12], [0.36, 0.12], [-0.48, 0.08]]) ctx.fillRect(wx * s, wy * s, 0.13 * s, 0.11 * s);
			break;
		case "house":
			P2([[-0.5, 0.5], [-0.5, -0.08], [0, -0.55], [0.5, -0.08], [0.5, 0.5]]);
			ctx.fillStyle = ICON_COLOR.house;
			ctx.fillRect(-0.12 * s, 0.12 * s, 0.24 * s, 0.38 * s);
			break;
		case "tent":
			P2([[-0.62, 0.48], [0, -0.55], [0.62, 0.48]]);
			break;
		default:
			ctx.beginPath(); ctx.arc(0, 0, 0.3 * s, 0, Math.PI * 2); ctx.fill();
	}
	ctx.restore();
}

/** A round POI badge: coloured disc, white ring, white pictogram. */
function drawBadge(ctx: Ctx, l: WorldLocation, x: number, y: number, s: number, ring: boolean) {
	const icon = townIcon(l);
	ctx.save();
	ctx.shadowColor = "rgba(0,0,0,0.35)";
	ctx.shadowBlur = s * 0.35;
	ctx.shadowOffsetY = s * 0.08;
	ctx.fillStyle = "#ffffff";
	ctx.beginPath(); ctx.arc(x, y, s * 1.08, 0, Math.PI * 2); ctx.fill();
	ctx.restore();
	ctx.fillStyle = ICON_COLOR[icon];
	ctx.beginPath(); ctx.arc(x, y, s * 0.9, 0, Math.PI * 2); ctx.fill();
	if (!l.visited) {
		// not been there yet: a thin inner ring
		ctx.strokeStyle = "rgba(255,255,255,0.55)";
		ctx.lineWidth = Math.max(1, s * 0.07);
		ctx.beginPath(); ctx.arc(x, y, s * 0.74, 0, Math.PI * 2); ctx.stroke();
	}
	if (ring) {
		ctx.strokeStyle = "#f2b630";
		ctx.lineWidth = Math.max(2, s * 0.18);
		ctx.beginPath(); ctx.arc(x, y, s * 1.4, 0, Math.PI * 2); ctx.stroke();
	}
	drawGlyph(ctx, icon, x, y, s * 0.62);
}

export interface TownOverlayOptions extends OverlayOptions {
	/** Screen boxes already used by the base layer's furniture (from paintTownBase). */
	reserved?: Rect[];
}

export function paintTownOverlay(ctx: CanvasRenderingContext2D, world: WorldMap, W: number, H: number, opt: TownOverlayOptions) {
	ctx.clearRect(0, 0, W, H);
	const u = Math.max(W / 1000, 0.85 * (opt.pixelRatio ?? 1));
	const show = (l: WorldLocation) => l.discovered || !!opt.showUndiscovered;
	const byId = new Map(world.locations.map((l) => [l.id, l]));
	const zoomed = !!opt.viewScale && opt.viewScale < 1;
	const fmt = (d: number) => (opt.daysLabel ? opt.daysLabel(d) : `${travelMinutes(d)} min`);
	const font = opt.fontFamily;
	const placed: Rect[] = [...(opt.reserved ?? [])];
	const locs = world.locations.filter((l) => show(l) && (!zoomed || inView(l, -0.02))).sort((a, b) => a.y - b.y);
	const sizeOf = (l: WorldLocation) => 11 * u * (l.kind === "city" || l.kind === "town" ? 1.25 : 1);
	for (const l of locs) { const s = sizeOf(l); placed.push([l.x * W - s * 1.2, l.y * H - s * 1.2, s * 2.4, s * 2.4]); }
	const here = locs.find((l) => l.id === world.currentLocationId);
	if (here && opt.pinHeight) placed.push([here.x * W - opt.pinHeight * 0.3, here.y * H - opt.pinHeight, opt.pinHeight * 0.6, opt.pinHeight]);
	const hits = (b: [number, number, number, number], skip?: [number, number, number, number]) => placed.some((p) => p !== skip && b[0] < p[0] + p[2] && b[0] + b[2] > p[0] && b[1] < p[1] + p[3] && b[1] + b[3] > p[1]);

	// travel times on the known roads
	const timeLabels: { x: number; y: number; text: string; alpha: number }[] = [];
	for (const r of world.routes) {
		const a = byId.get(r.from), b = byId.get(r.to);
		if (!a || !b) continue;
		if (!opt.showUndiscovered && !(r.discovered && a.discovered && b.discovered)) continue;
		const pts = townRoad(a, b, r.id, world.seed >>> 0);
		const m = pts[12];
		if (zoomed && !(inView(m, 0.04) && inView(a, 0) && inView(b, 0))) continue;
		if (Math.hypot((b.x - a.x) * W, (b.y - a.y) * H) < 90 * u) continue;
		timeLabels.push({ x: m.x * W, y: m.y * H, text: fmt(r.travelDays), alpha: r.discovered ? 1 : 0.5 });
	}
	ctx.font = `600 ${Math.round(10 * u)}px ${font}`;
	for (const t of timeLabels) {
		const tw = ctx.measureText(t.text).width + 10 * u, th = 15 * u;
		const box: [number, number, number, number] = [t.x - tw / 2, t.y - th / 2, tw, th];
		if (hits(box)) continue;
		placed.push(box);
		ctx.save();
		ctx.globalAlpha = t.alpha;
		ctx.fillStyle = "rgba(255,255,255,0.95)";
		ctx.strokeStyle = "#7b7f86";
		ctx.lineWidth = Math.max(1, 0.9 * u);
		roundRect(ctx, box[0], box[1], tw, th, th / 2);
		ctx.fill(); ctx.stroke();
		// little walking-figure dot
		ctx.fillStyle = "#3d4248";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(t.text, t.x, t.y + 0.5 * u);
		ctx.restore();
	}

	// badges
	for (const l of locs) {
		const x = l.x * W, y = l.y * H, s = sizeOf(l);
		ctx.save();
		ctx.globalAlpha = l.discovered ? 1 : 0.45;
		if (opt.hoverId === l.id || opt.selectedId === l.id) {
			ctx.fillStyle = "rgba(242,182,48,0.28)";
			ctx.beginPath(); ctx.arc(x, y, s * 2, 0, Math.PI * 2); ctx.fill();
		}
		drawBadge(ctx, l, x, y, s, opt.hoverId === l.id);
		ctx.restore();
	}

	// labels
	for (const l of locs) {
		const x = l.x * W, y = l.y * H, s = sizeOf(l);
		const big = l.kind === "city" || l.kind === "town";
		const fs = Math.round((big ? 13.5 : 11.5) * u);
		ctx.font = `${l.visited ? (big ? 800 : 700) : big ? "italic 700" : "italic 600"} ${fs}px ${font}`;
		const tw = ctx.measureText(l.name).width;
		const box = (cx: number, cy: number): [number, number, number, number] => [cx - tw / 2, cy - fs / 2, tw, fs];
		const own = placed.find((p) => Math.abs(p[0] + p[2] / 2 - x) < 0.5 && Math.abs(p[1] + p[3] / 2 - y) < 0.5);
		const outside = (b: [number, number, number, number]) => b[0] < W * 0.04 || b[0] + b[2] > W * 0.97 || b[1] < H * 0.05 || b[1] + b[3] > H * 0.95;
		const cands: [number, number][] = [
			[x, y + s * 1.35 + fs * 0.55], [x + s * 1.4 + tw / 2, y], [x - s * 1.4 - tw / 2, y], [x, y - s * 1.4 - fs * 0.5],
			[x + s * 1.2 + tw / 2, y + fs * 0.9], [x - s * 1.2 - tw / 2, y - fs * 0.9], [x, y + s * 1.35 + fs * 1.6], [x, y - s * 1.4 - fs * 1.5],
		];
		const free = cands.find(([cx, cy]) => !outside(box(cx, cy)) && !hits(box(cx, cy), own));
		if (!free && l.id !== world.currentLocationId && l.id !== opt.selectedId && l.id !== opt.hoverId) continue;
		const [lx, ly] = free ?? cands.find(([cx, cy]) => !outside(box(cx, cy))) ?? cands[0];
		placed.push(box(lx, ly));
		ctx.save();
		ctx.globalAlpha = l.discovered ? 1 : 0.5;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.lineJoin = "round";
		ctx.lineWidth = Math.max(3, 3.6 * u);
		ctx.strokeStyle = "rgba(251,250,246,0.95)";
		ctx.strokeText(l.name, lx, ly);
		ctx.fillStyle = l.visited ? "#1f2124" : "#3b3f45";
		ctx.fillText(l.name, lx, ly);
		ctx.restore();
	}

	if (zoomed) paintEdgeMarkers(ctx, world, W, H, u, fmt, font);
}

function paintEdgeMarkers(ctx: Ctx, world: WorldMap, W: number, H: number, u: number, fmt: (d: number) => string, font: string) {
	const byId = new Map(world.locations.map((l) => [l.id, l]));
	const done = new Set<string>();
	for (const r of world.routes) {
		if (!r.discovered) continue;
		for (const [a, b] of [[r.from, r.to], [r.to, r.from]] as const) {
			const Aa = byId.get(a), B = byId.get(b);
			if (!Aa || !B || !Aa.discovered || !B.discovered || done.has(B.id)) continue;
			if (!inView(Aa, 0.02) || inView(B, 0)) continue;
			done.add(B.id);
			const p = exitPoint(Aa, B, 0.06);
			const x = p.x * W, y = p.y * H;
			const ang = Math.atan2((B.y - Aa.y) * H, (B.x - Aa.x) * W);
			const label = `${B.name} · ${fmt(r.travelDays)}`;
			ctx.font = `600 ${Math.round(10.5 * u)}px ${font}`;
			const tw = ctx.measureText(label).width;
			const lx = Math.max(W * 0.05 + tw / 2 + 16 * u, Math.min(W * 0.95 - tw / 2 - 16 * u, x - Math.cos(ang) * (tw / 2 + 18 * u)));
			const ly = Math.max(H * 0.08, Math.min(H * 0.92, y - Math.sin(ang) * 16 * u));
			ctx.save();
			ctx.fillStyle = "rgba(43,45,47,0.88)";
			roundRect(ctx, lx - tw / 2 - 8 * u, ly - 9 * u, tw + 16 * u, 18 * u, 9 * u);
			ctx.fill();
			ctx.fillStyle = "#ffffff";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(label, lx, ly + 0.5 * u);
			ctx.translate(x, y);
			ctx.rotate(ang);
			ctx.fillStyle = "rgba(43,45,47,0.88)";
			ctx.beginPath(); ctx.moveTo(10 * u, 0); ctx.lineTo(-5 * u, -7 * u); ctx.lineTo(-5 * u, 7 * u); ctx.closePath(); ctx.fill();
			ctx.restore();
		}
	}
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

