import { test } from "node:test";
import assert from "node:assert/strict";
import {
	type DieShape,
	type LabelMode,
	type Quat,
	critKind,
	defaultLabels,
	flatness,
	flattenQuat,
	getDieDef,
	labelText,
	quatNormalize,
	readValue,
	relabelForTarget,
	slotCount,
	visualDice,
} from "../components/dice/diceGeometry";

// deterministic RNG for orientations
let s = 12345;
const rnd = () => {
	s = (s * 1664525 + 1013904223) >>> 0;
	return s / 4294967296;
};
function randomQuat(): Quat {
	const g = () => {
		const u = Math.max(rnd(), 1e-9);
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
	};
	return quatNormalize([g(), g(), g(), g()]);
}

const EXPECTED_FACES: Record<DieShape, number> = { 4: 4, 6: 6, 8: 8, 10: 10, 12: 12, 20: 20 };

test("polyhedra have the right number of faces with opposite pairs", () => {
	for (const shape of [4, 6, 8, 10, 12, 20] as DieShape[]) {
		const def = getDieDef(shape);
		assert.equal(def.faces.length, EXPECTED_FACES[shape], `d${shape} faces`);
		assert.equal(slotCount(def), shape, `d${shape} slots`);
		if (shape !== 4) assert.ok(def.faces.every((f) => f.opposite >= 0), `d${shape} opposites`);
		if (shape === 10) assert.ok(def.faces.every((f) => f.verts.length === 4), "d10 kites are planar quads");
	}
});

test("default labels: each value once, opposite faces sum constant", () => {
	for (const shape of [6, 8, 10, 12, 20] as DieShape[]) {
		const def = getDieDef(shape);
		const labels = defaultLabels(def, "plain");
		assert.deepEqual([...labels].sort((a, b) => a - b), Array.from({ length: shape }, (_, i) => i + 1));
		def.faces.forEach((f, i) => assert.equal(labels[i] + labels[f.opposite], shape + 1));
	}
});

const cases: { shape: DieShape; mode: LabelMode; targets: number[]; sides?: number }[] = [
	{ shape: 4, mode: "plain", targets: [1, 2, 3, 4] },
	{ shape: 6, mode: "plain", targets: [1, 2, 3, 4, 5, 6] },
	{ shape: 8, mode: "plain", targets: [1, 2, 3, 4, 5, 6, 7, 8] },
	{ shape: 10, mode: "plain", targets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
	{ shape: 10, mode: "tens", targets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
	{ shape: 10, mode: "ones", targets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
	{ shape: 12, mode: "plain", targets: Array.from({ length: 12 }, (_, i) => i + 1) },
	{ shape: 20, mode: "plain", targets: Array.from({ length: 20 }, (_, i) => i + 1) },
	{ shape: 6, mode: "mod", targets: [1, 2, 3], sides: 3 },
	{ shape: 6, mode: "mod", targets: [1, 2], sides: 2 },
];

test("relabeling makes the up face read the requested value for random orientations", () => {
	for (const c of cases) {
		const def = getDieDef(c.shape);
		const base = defaultLabels(def, c.mode, c.sides ?? c.shape);
		for (let trial = 0; trial < 40; trial++) {
			const q = randomQuat();
			for (const t of c.targets) {
				const labels = relabelForTarget(def, base, q, t, c.mode);
				assert.equal(readValue(def, labels, q), t, `d${c.shape}/${c.mode} target ${t}`);
				assert.deepEqual([...labels].sort((a, b) => a - b), [...base].sort((a, b) => a - b), "labels stay a permutation");
				if (c.mode !== "mod" && c.shape !== 4) {
					const sum = labels[0] + labels[def.faces[0].opposite];
					def.faces.forEach((f, i) => assert.equal(labels[i] + labels[f.opposite], sum, "opposite sums preserved"));
				}
				// still correct after flattening a cocked orientation
				const flat = flattenQuat(def, q);
				assert.ok(flatness(def, flat) > 0.9999);
			}
		}
	}
});

test("flattening keeps the same up slot", () => {
	for (const shape of [4, 6, 8, 10, 12, 20] as DieShape[]) {
		const def = getDieDef(shape);
		const labels = defaultLabels(def, "plain");
		for (let i = 0; i < 50; i++) {
			const q = randomQuat();
			const v = readValue(def, labels, q);
			if (flatness(def, q) > 0.75) assert.equal(readValue(def, labels, flattenQuat(def, q)), v, `d${shape}`);
		}
	}
});

test("visualDice maps d100 to tens+ones and keeps dropped flags", () => {
	const v = visualDice([
		{ sides: 100, value: 37 },
		{ sides: 100, value: 100 },
		{ sides: 20, value: 4, dropped: true },
		{ sides: 3, value: 2 },
		{ sides: 7, value: 5 },
	]);
	assert.deepEqual(
		v.map((d) => [d.shape, d.mode, d.target, d.dropped]),
		[
			[10, "tens", 3, false],
			[10, "ones", 7, false],
			[10, "tens", 0, false],
			[10, "ones", 0, false],
			[20, "plain", 4, true],
			[6, "mod", 2, false],
		],
	);
	assert.equal(labelText(0, "tens"), "00");
	assert.equal(labelText(4, "tens"), "40");
});

test("critKind", () => {
	assert.equal(critKind({ dice: [{ sides: 20, value: 20 }, { sides: 20, value: 3, dropped: true }] }), "gold");
	assert.equal(critKind({ dice: [{ sides: 20, value: 1 }] }), "red");
	assert.equal(critKind({ dice: [{ sides: 20, value: 19 }], critical: "hit" }), "gold");
	assert.equal(critKind({ dice: [{ sides: 6, value: 1 }] }), null);
});
