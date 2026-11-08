/**
 * The Quiet: barricades (docs/zombie.md §5). A barricade is a map tile that
 * blocks movement and sight like a closed door you can't open, with its own
 * hit points (GridMap.barricades, keyed "x,y"). Built from furniture, planks
 * and nails or a pushed car; the dead pound on it; at 0 HP it falls to rubble.
 *
 * Pure rules over the active map and inventory; the DM tools wrap them.
 */
import type { GameState, GridMap, Tile } from "../game/types";
import { canStand } from "../maps/grid";
import type { Rng } from "./dice";
import { clockText, spendTimeAndNoise } from "./scavenge";

export type BarricadeMaterial = "furniture" | "planks" | "car";

export const BARRICADE = {
	furniture: { hp: 15, minutes: 20, noise: 1, label: "furniture" },
	planks: { hp: 25, minutes: 10, noise: 2, label: "planks and nails" },
	car: { hp: 40, minutes: 30, noise: 1, label: "a pushed car" },
} as const satisfies Record<BarricadeMaterial, { hp: number; minutes: number; noise: number; label: string }>;

/** Inventory refs a plank barricade (or repair) uses up. */
export const PLANK_MATERIALS = [
	{ ref: "z-planks", name: "Planks", qty: 1 },
	{ ref: "z-nails", name: "Box of Nails", qty: 1 },
] as const;

/** Squares a barricade can go on: open ground and doorways. */
const BUILDABLE = new Set<Tile>(["floor", "wood_floor", "road", "grass", "tall_grass", "sand", "mud", "ice", "difficult", "rubble", "door", "door_open", "door_locked"]);

export const barricadeKey = (x: number, y: number) => `${x},${y}`;

function activeMap(state: GameState): GridMap {
	const m = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	if (!m) throw new Error("No active map: draw the place first (draw_map).");
	return m;
}

function findStack(state: GameState, ref: string, name: string) {
	return state.character.inventory.find((i) => i.ref === ref) ?? state.character.inventory.find((i) => i.name.toLowerCase() === name.toLowerCase());
}

export interface BarricadeResult {
	x: number;
	y: number;
	hp: number;
	max: number;
	repaired: boolean;
	used: string[];
	text: string;
}

export function buildBarricade(state: GameState, rng: Rng, a: { x: number; y: number; material: BarricadeMaterial }): BarricadeResult {
	const spec = BARRICADE[a.material];
	if (!spec) throw new Error("material must be furniture, planks or car.");
	if (state.encounter?.status === "active") throw new Error("No time to build a barricade in the middle of a fight.");
	const map = activeMap(state);
	const { x, y } = a;
	if (x < 0 || y < 0 || x >= map.width || y >= map.height) throw new Error(`(${x},${y}) is off the map (${map.width}x${map.height}).`);
	const i = y * map.width + x;
	const key = barricadeKey(x, y);
	const tile = map.tiles[i];
	const existing = tile === "barricade" ? map.barricades?.[key] : undefined;
	if (tile !== "barricade") {
		if (!BUILDABLE.has(tile)) throw new Error(`Can't barricade (${x},${y}): it is ${tile.replace("_", " ")}. Pick open floor or a doorway.`);
		if (!canStand(map, x, y, 1, undefined, { allowDoors: true })) throw new Error(`(${x},${y}) is occupied: someone or something stands there.`);
	}

	// Materials: planks need planks and nails from the inventory; furniture and cars are found on the spot.
	const used: string[] = [];
	if (a.material === "planks") {
		const missing = PLANK_MATERIALS.filter((m) => (findStack(state, m.ref, m.name)?.quantity ?? 0) < m.qty);
		if (missing.length) throw new Error(`Not enough materials: needs ${PLANK_MATERIALS.map((m) => `${m.qty} × ${m.name}`).join(" and ")}; missing ${missing.map((m) => m.name).join(", ")}. Furniture or a car need nothing.`);
		for (const m of PLANK_MATERIALS) {
			const it = findStack(state, m.ref, m.name)!;
			it.quantity -= m.qty;
			if (it.quantity <= 0) state.character.inventory = state.character.inventory.filter((x) => x !== it);
			used.push(`${m.qty} × ${it.name}`);
		}
	}

	const max = Math.max(existing?.max ?? 0, spec.hp);
	map.tiles[i] = "barricade";
	map.barricades = { ...(map.barricades ?? {}), [key]: { hp: max, max } };
	const notes = spendTimeAndNoise(state, rng, spec.minutes, spec.noise, a.material === "planks" ? "hammering a barricade" : "building a barricade");
	const what = existing ? `Repaired the barricade at (${x},${y}) with ${spec.label}: ${existing.hp} → ${max}/${max} HP.` : `Barricaded (${x},${y}) with ${spec.label}: ${max}/${max} HP. It blocks movement and sight.`;
	const text = `${what}${used.length ? ` Used ${used.join(" and ")}.` : ""} Took ${spec.minutes} min (now ${clockText(state.time)}).${notes.length ? `\n${notes.join("\n")}` : ""}`;
	return { x, y, hp: max, max, repaired: !!existing, used, text };
}

export interface DamageResult {
	x: number;
	y: number;
	hp: number;
	max: number;
	destroyed: boolean;
	text: string;
}

export function damageBarricade(state: GameState, a: { x: number; y: number; amount: number }): DamageResult {
	return damageBarricadeOn(activeMap(state), a);
}

/** damage_barricade on a given map (the siege batters the base map even when another map is active). */
export function damageBarricadeOn(map: GridMap, a: { x: number; y: number; amount: number }): DamageResult {
	const { x, y } = a;
	const key = barricadeKey(x, y);
	const i = y * map.width + x;
	if (x < 0 || y < 0 || x >= map.width || y >= map.height || map.tiles[i] !== "barricade") throw new Error(`There is no barricade at (${x},${y}).${map.barricades && Object.keys(map.barricades).length ? ` Barricades: ${Object.entries(map.barricades).map(([k, b]) => `(${k}) ${b.hp}/${b.max}`).join(", ")}.` : ""}`);
	// A barricade drawn or set without hit points counts as fresh planks.
	const b = map.barricades?.[key] ?? { hp: BARRICADE.planks.hp, max: BARRICADE.planks.hp };
	const hp = Math.max(0, b.hp - Math.max(0, Math.round(a.amount)));
	if (hp <= 0) {
		map.tiles[i] = "rubble";
		if (map.barricades) {
			const rest = { ...map.barricades };
			delete rest[key];
			map.barricades = rest;
		}
		return { x, y, hp: 0, max: b.max, destroyed: true, text: `The barricade at (${x},${y}) gives way (${a.amount} damage): it is now rubble and the way is open.` };
	}
	map.barricades = { ...(map.barricades ?? {}), [key]: { hp, max: b.max } };
	return { x, y, hp, max: b.max, destroyed: false, text: `Barricade at (${x},${y}) takes ${a.amount} damage: ${hp}/${b.max} HP left${hp < b.max / 2 ? " (badly damaged: planks splintering)" : ""}.` };
}

/** "x,y hp/max" for each barricade of a map (digest). */
export function barricadeSummary(map: GridMap): string {
	return Object.entries(map.barricades ?? {})
		.map(([k, b]) => `(${k}) ${b.hp}/${b.max}`)
		.join(", ");
}
