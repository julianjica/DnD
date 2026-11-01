/**
 * Pure dice math (no DOM, no three.js): polyhedron tables, face-up detection
 * and value → face labeling. The 3D tray pre-simulates physics, reads which
 * face ended up on top, then relabels the faces with these helpers so the
 * die shows the server-authoritative value from the RollRecord.
 */

export type Vec3 = [number, number, number];
/** Quaternion as [x, y, z, w]. */
export type Quat = [number, number, number, number];

export type DieShape = 4 | 6 | 8 | 10 | 12 | 20;

/**
 * How labels are printed:
 * - plain: 1..n ("10" on a d10)
 * - tens:  d100 tens die, labels 0..9 printed "00".."90"
 * - ones:  d100 ones die, labels 0..9 printed "0".."9"
 * - mod:   a cube standing in for a d2/d3/d5 (labels repeat 1..sides)
 */
export type LabelMode = "plain" | "tens" | "ones" | "mod";

export interface DieFace {
	/** Vertex indices, counter-clockwise seen from outside. */
	verts: number[];
	/** Outward unit normal (local space). */
	normal: Vec3;
	/** Index of the face with opposite normal, or -1 (d4). */
	opposite: number;
}

export interface DieDef {
	shape: DieShape;
	/** Local vertices (already scaled to the die's render size). */
	vertices: Vec3[];
	faces: DieFace[];
	/** d4 labels its vertices (the top vertex is the result); others label faces. */
	labelOn: "face" | "vertex";
}

// ─── Vector helpers ──────────────────────────────────────────────────────

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => {
	const l = len(a) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};

/** Rotates v by unit quaternion q. */
export function rotate(q: Quat, v: Vec3): Vec3 {
	const [x, y, z, w] = q;
	// t = 2 * cross(q.xyz, v)
	const tx = 2 * (y * v[2] - z * v[1]);
	const ty = 2 * (z * v[0] - x * v[2]);
	const tz = 2 * (x * v[1] - y * v[0]);
	return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

export function quatMul(a: Quat, b: Quat): Quat {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

export function quatNormalize(q: Quat): Quat {
	const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
	return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Shortest rotation taking unit vector a onto unit vector b. */
export function quatFromUnitVectors(a: Vec3, b: Vec3): Quat {
	const r = dot(a, b) + 1;
	if (r < 1e-8) {
		// opposite: rotate 180° around any perpendicular axis
		const axis = Math.abs(a[0]) > Math.abs(a[2]) ? norm([-a[1], a[0], 0]) : norm([0, -a[2], a[1]]);
		return [axis[0], axis[1], axis[2], 0];
	}
	const c = cross(a, b);
	return quatNormalize([c[0], c[1], c[2], r]);
}

// ─── Convex hull face extraction ───────────────────────────────────────────

/** Finds the planar faces of a convex polyhedron given its vertices (small n). */
export function hullFaces(vertices: Vec3[]): { verts: number[]; normal: Vec3 }[] {
	const n = vertices.length;
	const eps = 1e-6;
	const seen = new Set<string>();
	const out: { verts: number[]; normal: Vec3 }[] = [];
	for (let i = 0; i < n; i++)
		for (let j = i + 1; j < n; j++)
			for (let k = j + 1; k < n; k++) {
				const a = vertices[i];
				let nrm = cross(sub(vertices[j], a), sub(vertices[k], a));
				if (len(nrm) < eps) continue;
				nrm = norm(nrm);
				let pos = 0;
				let neg = 0;
				const on: number[] = [];
				for (let m = 0; m < n; m++) {
					const d = dot(sub(vertices[m], a), nrm);
					if (d > eps) pos++;
					else if (d < -eps) neg++;
					else on.push(m);
				}
				if (pos && neg) continue;
				if (pos) nrm = scale(nrm, -1);
				const key = on.join(",");
				if (seen.has(key)) continue;
				seen.add(key);
				// order CCW seen from outside
				const c = scale(on.reduce<Vec3>((s, m) => add(s, vertices[m]), [0, 0, 0]), 1 / on.length);
				const e1 = norm(sub(vertices[on[0]], c));
				const e2 = cross(nrm, e1);
				const sorted = [...on].sort((p, q) => {
					const dp = sub(vertices[p], c);
					const dq = sub(vertices[q], c);
					return Math.atan2(dot(dp, e2), dot(dp, e1)) - Math.atan2(dot(dq, e2), dot(dq, e1));
				});
				out.push({ verts: sorted, normal: nrm });
			}
	return out;
}

// ─── Die tables ──────────────────────────────────────────────────────────

const PHI = (1 + Math.sqrt(5)) / 2;

function rawVertices(shape: DieShape): Vec3[] {
	switch (shape) {
		case 4:
			return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
		case 6: {
			const v: Vec3[] = [];
			for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
			return v;
		}
		case 8:
			return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
		case 10: {
			// Pentagonal trapezohedron: poles at ±1, ring height chosen so kites are planar.
			const c36 = Math.cos(Math.PI / 5);
			const a = (1 - c36) / (1 + c36);
			const v: Vec3[] = [[0, 1, 0], [0, -1, 0]];
			for (let k = 0; k < 10; k++) {
				const ang = (k * Math.PI) / 5;
				v.push([Math.cos(ang), k % 2 === 0 ? a : -a, Math.sin(ang)]);
			}
			return v;
		}
		case 12: {
			const v: Vec3[] = [];
			for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
			const ip = 1 / PHI;
			for (const s1 of [-1, 1])
				for (const s2 of [-1, 1]) {
					v.push([0, s1 * ip, s2 * PHI]);
					v.push([s1 * ip, s2 * PHI, 0]);
					v.push([s1 * PHI, 0, s2 * ip]);
				}
			return v;
		}
		case 20: {
			const v: Vec3[] = [];
			for (const s1 of [-1, 1])
				for (const s2 of [-1, 1]) {
					v.push([0, s1, s2 * PHI]);
					v.push([s1, s2 * PHI, 0]);
					v.push([s2 * PHI, 0, s1]);
				}
			return v;
		}
	}
}

/** Circumradius used for rendering/physics (world units). */
export const DIE_RADIUS: Record<DieShape, number> = { 4: 1.2, 6: 0.98, 8: 1.05, 10: 1.02, 12: 1.06, 20: 1.12 };

const cache = new Map<DieShape, DieDef>();

export function getDieDef(shape: DieShape): DieDef {
	const hit = cache.get(shape);
	if (hit) return hit;
	const raw = rawVertices(shape);
	const maxR = Math.max(...raw.map(len));
	const vertices = raw.map((v) => scale(v, DIE_RADIUS[shape] / maxR));
	const hf = hullFaces(vertices);
	const faces: DieFace[] = hf.map((f) => ({ verts: f.verts, normal: f.normal, opposite: -1 }));
	faces.forEach((f, i) => {
		f.opposite = faces.findIndex((g, j) => j !== i && dot(f.normal, g.normal) < -0.9999);
	});
	const def: DieDef = { shape, vertices, faces, labelOn: shape === 4 ? "vertex" : "face" };
	cache.set(shape, def);
	return def;
}

/** Number of labeled slots (faces, or vertices for the d4). */
export function slotCount(def: DieDef): number {
	return def.labelOn === "vertex" ? def.vertices.length : def.faces.length;
}

/** Default printed labels per slot. Opposite faces sum to a constant (like real dice). */
export function defaultLabels(def: DieDef, mode: LabelMode, sides: number = def.shape): number[] {
	const n = slotCount(def);
	if (mode === "mod") return Array.from({ length: n }, (_, i) => (i % sides) + 1);
	const lo = mode === "plain" ? 1 : 0;
	const hi = lo + n - 1;
	if (def.labelOn === "vertex") return Array.from({ length: n }, (_, i) => lo + i);
	const labels = new Array<number>(n).fill(NaN);
	let next = lo;
	for (let i = 0; i < n; i++) {
		if (!Number.isNaN(labels[i])) continue;
		labels[i] = next;
		const o = def.faces[i].opposite;
		if (o >= 0) labels[o] = lo + hi - next;
		next++;
	}
	return labels;
}

/** Slot that reads as the result for orientation q (top face, or top vertex for d4). */
export function upSlot(def: DieDef, q: Quat): number {
	let best = -1;
	let bestY = -Infinity;
	if (def.labelOn === "vertex") {
		def.vertices.forEach((v, i) => {
			const y = rotate(q, v)[1];
			if (y > bestY) {
				bestY = y;
				best = i;
			}
		});
	} else {
		def.faces.forEach((f, i) => {
			const y = rotate(q, f.normal)[1];
			if (y > bestY) {
				bestY = y;
				best = i;
			}
		});
	}
	return best;
}

export function readValue(def: DieDef, labels: number[], q: Quat): number {
	return labels[upSlot(def, q)];
}

/**
 * Returns new labels so that orientation q reads `target`. Uses a value
 * permutation that keeps opposite-face sums intact when the labels have them.
 */
export function relabelForTarget(def: DieDef, labels: number[], q: Quat, target: number, mode: LabelMode): number[] {
	const up = upSlot(def, q);
	const cur = labels[up];
	if (cur === target) return [...labels];
	if (!labels.includes(target)) {
		const out = [...labels];
		out[up] = target;
		return out;
	}
	if (mode !== "mod" && def.labelOn === "face") {
		const lo = Math.min(...labels);
		const hi = Math.max(...labels);
		const c = (x: number) => lo + hi - x;
		const sigma = (x: number) => {
			if (x === cur) return target;
			if (x === target) return cur;
			if (c(target) !== cur) {
				if (x === c(cur)) return c(target);
				if (x === c(target)) return c(cur);
			}
			return x;
		};
		return labels.map(sigma);
	}
	// plain slot swap (d4 vertices, mod cubes)
	const out = [...labels];
	const j = out.indexOf(target);
	out[j] = cur;
	out[up] = target;
	return out;
}

/** Text printed for a label. */
export function labelText(value: number, mode: LabelMode): string {
	if (mode === "tens") return value === 0 ? "00" : String(value * 10);
	return String(value);
}

/** Final quaternion that lays the up slot flat (fixes dice cocked against walls/other dice). */
export function flattenQuat(def: DieDef, q: Quat): Quat {
	const up: Vec3 = [0, 1, 0];
	if (def.labelOn === "vertex") {
		// d4 rests on the face opposite the top vertex: bring that face's normal to -Y.
		const top = upSlot(def, q);
		const face = def.faces.find((f) => !f.verts.includes(top))!;
		const n = rotate(q, face.normal);
		return quatNormalize(quatMul(quatFromUnitVectors(n, [0, -1, 0]), q));
	}
	const f = def.faces[upSlot(def, q)];
	const n = rotate(q, f.normal);
	return quatNormalize(quatMul(quatFromUnitVectors(n, up), q));
}

/** How "flat" the die rests: 1 = perfectly on a face. */
export function flatness(def: DieDef, q: Quat): number {
	if (def.labelOn === "vertex") {
		return Math.max(...def.faces.map((f) => -rotate(q, f.normal)[1]));
	}
	return rotate(q, def.faces[upSlot(def, q)].normal)[1];
}

/** Lowest vertex y for orientation q (to rest the die on the floor). */
export function minY(def: DieDef, q: Quat): number {
	return Math.min(...def.vertices.map((v) => rotate(q, v)[1]));
}

// ─── Mapping RollRecord dice → visual dice ───────────────────────────────

export interface VisualDieSpec {
	shape: DieShape;
	mode: LabelMode;
	/** Label value the die must show. */
	target: number;
	/** For "mod" cubes: real number of sides. */
	sides: number;
	/** Index into RollRecord.dice. */
	recordIndex: number;
	dropped: boolean;
}

const SHAPES: DieShape[] = [4, 6, 8, 10, 12, 20];

/** Expands RollRecord dice into the visual dice to throw (d100 → two d10s). Unsupported sizes are skipped. */
export function visualDice(dice: { sides: number; value: number; dropped?: boolean }[], max = 20): VisualDieSpec[] {
	const out: VisualDieSpec[] = [];
	dice.forEach((d, i) => {
		const dropped = !!d.dropped;
		if (d.sides === 100) {
			const v = ((d.value % 100) + 100) % 100;
			out.push({ shape: 10, mode: "tens", target: Math.floor(v / 10), sides: 10, recordIndex: i, dropped });
			out.push({ shape: 10, mode: "ones", target: v % 10, sides: 10, recordIndex: i, dropped });
		} else if ((SHAPES as number[]).includes(d.sides)) {
			out.push({ shape: d.sides as DieShape, mode: "plain", target: d.value, sides: d.sides, recordIndex: i, dropped });
		} else if (d.sides >= 1 && d.sides < 6) {
			out.push({ shape: 6, mode: "mod", target: d.value, sides: d.sides, recordIndex: i, dropped });
		}
	});
	return out.slice(0, max);
}

/** Crit styling for a record: kept natural d20 of 20 → gold, 1 → red; RollRecord.critical wins. */
export function critKind(rec: { dice: { sides: number; value: number; dropped?: boolean }[]; critical?: "hit" | "miss" }): "gold" | "red" | null {
	if (rec.critical === "hit") return "gold";
	if (rec.critical === "miss") return "red";
	const kept = rec.dice.filter((d) => d.sides === 20 && !d.dropped);
	if (kept.length !== 1) return null;
	if (kept[0].value === 20) return "gold";
	if (kept[0].value === 1) return "red";
	return null;
}
