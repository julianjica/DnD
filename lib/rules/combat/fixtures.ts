import type { Character, Combatant, Encounter, GridMap, MonsterStats, SpellInfo, Tile } from "../../game/types";
import { Rng } from "../dice";

/**
 * Test/dev fixtures for the combat engine (tiny maps, a sample fighter, SRD-like
 * monsters, and a scripted Rng). Not used by production code paths.
 */

/** Rng whose die() returns queued values (falls back to a seeded stream when empty). */
export class ScriptedRng extends Rng {
	queue: number[];
	constructor(values: number[] = [], seed = 1) {
		super(seed);
		this.queue = [...values];
	}
	push(...values: number[]): this {
		this.queue.push(...values);
		return this;
	}
	override die(sides: number): number {
		if (this.queue.length) {
			const v = this.queue.shift()!;
			if (v < 1 || v > sides) throw new Error(`Scripted value ${v} invalid for d${sides}`);
			return v;
		}
		return super.die(sides);
	}
}

const LEGEND: Record<string, Tile> = {
	".": "floor",
	"#": "wall",
	"~": "deep_water",
	w: "water",
	",": "rubble",
	g: "tall_grass",
	m: "mud",
	D: "door",
	d: "door_open",
	P: "pillar",
	" ": "void",
};

/** Builds a map from rows of characters (see LEGEND). */
export function makeMap(rows: string[], id = "map1"): GridMap {
	const height = rows.length;
	const width = Math.max(...rows.map((r) => r.length));
	const tiles: Tile[] = [];
	for (const r of rows) for (let x = 0; x < width; x++) tiles.push(LEGEND[r[x] ?? "#"] ?? "floor");
	return {
		id,
		name: "Test Map",
		kind: "dungeon",
		seed: 1,
		width,
		height,
		tiles,
		explored: tiles.map(() => true),
		rooms: [],
		entities: [],
		lighting: "bright",
		entry: { x: 0, y: 0 },
	};
}

export function openMap(width = 12, height = 12): GridMap {
	return makeMap(Array.from({ length: height }, () => ".".repeat(width)));
}

export function makeFighter(over: Partial<Character> = {}): Character {
	return {
		id: "pc1",
		name: "Thorin",
		speciesId: "dwarf",
		backgroundId: "soldier",
		classes: [{ classId: "fighter", level: 5 }],
		xp: 6500,
		abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
		maxHp: 44,
		hp: 44,
		tempHp: 0,
		hitDice: [{ die: 10, total: 5, used: 0 }],
		speed: 30,
		size: "medium",
		savingThrows: ["str", "con"],
		skills: ["athletics", "perception"],
		expertise: [],
		languages: ["common"],
		tools: [],
		armorProf: ["light", "medium", "heavy", "shield"],
		weaponProf: ["simple", "martial"],
		inventory: [
			{ id: "sword", name: "Longsword", quantity: 1, category: "weapon", equipped: true, weapon: { damage: "1d8", damageType: "slashing", properties: ["versatile"], versatile: "1d10" } },
			{ id: "bow", name: "Longbow", quantity: 1, category: "weapon", weapon: { damage: "1d8", damageType: "piercing", properties: ["ammunition", "heavy", "two-handed"], range: { normal: 150, long: 600 } } },
			{ id: "dagger", name: "Dagger", quantity: 2, category: "weapon", equipped: true, weapon: { damage: "1d4", damageType: "piercing", properties: ["finesse", "light", "thrown"], range: { normal: 20, long: 60 } } },
			{ id: "chain", name: "Chain Mail", quantity: 1, category: "armor", equipped: true, armor: { baseAc: 16, type: "heavy", stealthDisadvantage: true } },
			{ id: "shield", name: "Shield", quantity: 1, category: "shield", equipped: true, armor: { baseAc: 2, type: "shield" } },
			{ id: "potion", name: "Potion of Healing", quantity: 2, category: "potion" },
		],
		currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
		features: [
			{ id: "sw", name: "Second Wind", source: "class:fighter", description: "Regain 1d10 + level HP.", uses: { max: 1, used: 0, recharge: "short" } },
			{ id: "as", name: "Action Surge", source: "class:fighter", description: "Take one additional action.", uses: { max: 1, used: 0, recharge: "short" } },
		],
		conditions: [],
		exhaustion: 0,
		deathSaves: { successes: 0, failures: 0 },
		inspiration: false,
		portrait: { seed: 1, skinTone: "a", hairStyle: "b", hairColor: "c", eyeColor: "d", features: [], background: "e" },
		...over,
	};
}

export function makeWizard(over: Partial<Character> = {}): Character {
	return makeFighter({
		id: "pc1",
		name: "Elara",
		classes: [{ classId: "wizard", level: 5 }],
		abilities: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 },
		savingThrows: ["int", "wis"],
		maxHp: 32,
		hp: 32,
		inventory: [{ id: "dagger", name: "Dagger", quantity: 1, category: "weapon", equipped: true, weapon: { damage: "1d4", damageType: "piercing", properties: ["finesse", "light", "thrown"], range: { normal: 20, long: 60 } } }],
		features: [],
		spellcasting: { classes: [{ classId: "wizard", ability: "int", known: [], prepared: ["fireball", "fire-bolt", "cure-wounds", "hold-person"], cantrips: ["fire-bolt"] }], slots: [4, 3, 2], slotsUsed: [0, 0, 0] },
		...over,
	});
}

export function makeMonster(over: Partial<MonsterStats> = {}): MonsterStats {
	return {
		index: "goblin",
		name: "Goblin",
		size: "small",
		type: "humanoid (goblinoid)",
		alignment: "neutral evil",
		ac: 15,
		hp: 7,
		hitDice: "2d6",
		speed: { walk: 30 },
		abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
		saves: {},
		skills: { stealth: 6 },
		vulnerabilities: [],
		resistances: [],
		immunities: [],
		conditionImmunities: [],
		senses: "darkvision 60 ft., passive Perception 9",
		languages: "Common, Goblin",
		cr: 0.25,
		xp: 50,
		traits: [],
		actions: [
			{ name: "Scimitar", description: "Melee attack", attack: { name: "Scimitar", kind: "melee", toHit: 4, reach: 5, damage: [{ dice: "1d6+2", type: "slashing" }], description: "" } },
			{ name: "Shortbow", description: "Ranged attack", attack: { name: "Shortbow", kind: "ranged", toHit: 4, range: { normal: 80, long: 320 }, damage: [{ dice: "1d6+2", type: "piercing" }], description: "" } },
		],
		bonusActions: [],
		reactions: [],
		legendaryActions: [],
		tokenHint: "goblin",
		...over,
	};
}

export function makeBear(over: Partial<MonsterStats> = {}): MonsterStats {
	return makeMonster({
		index: "brown-bear",
		name: "Brown Bear",
		size: "large",
		ac: 11,
		hp: 34,
		hitDice: "4d10",
		speed: { walk: 40, climb: 30 },
		abilities: { str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7 },
		cr: 1,
		xp: 200,
		actions: [
			{ name: "Multiattack", description: "The bear makes one Bite attack and one Claw attack.", multiattack: [{ action: "Bite", count: 1 }, { action: "Claw", count: 1 }] },
			{ name: "Bite", description: "", attack: { name: "Bite", kind: "melee", toHit: 6, reach: 5, damage: [{ dice: "1d8+4", type: "piercing" }], description: "" } },
			{ name: "Claw", description: "", attack: { name: "Claw", kind: "melee", toHit: 6, reach: 5, damage: [{ dice: "2d6+4", type: "slashing" }], description: "" } },
		],
		tokenHint: "bear",
		...over,
	});
}

export const SPELLS: Record<string, SpellInfo> = {
	fireball: {
		index: "fireball", name: "Fireball", level: 3, school: "evocation", castingTime: "1 action", range: "150 feet", rangeFeet: 150,
		components: ["V", "S", "M"], duration: "Instantaneous", concentration: false, ritual: false, description: "Boom.", classes: ["wizard"],
		save: { ability: "dex", halfOnSuccess: true }, damage: { type: "fire", bySlotLevel: { 3: "8d6", 4: "9d6" } }, area: { shape: "sphere", size: 20 },
	},
	"fire-bolt": {
		index: "fire-bolt", name: "Fire Bolt", level: 0, school: "evocation", castingTime: "1 action", range: "120 feet", rangeFeet: 120,
		components: ["V", "S"], duration: "Instantaneous", concentration: false, ritual: false, description: "Zap.", classes: ["wizard"],
		attack: "ranged", damage: { type: "fire", byCharacterLevel: { 1: "1d10", 5: "2d10", 11: "3d10", 17: "4d10" } },
	},
	"cure-wounds": {
		index: "cure-wounds", name: "Cure Wounds", level: 1, school: "abjuration", castingTime: "1 action", range: "Touch",
		components: ["V", "S"], duration: "Instantaneous", concentration: false, ritual: false, description: "Heal.", classes: ["cleric"],
		heal: { bySlotLevel: { 1: "2d8", 2: "4d8" }, addModifier: true },
	},
	"hold-person": {
		index: "hold-person", name: "Hold Person", level: 2, school: "enchantment", castingTime: "1 action", range: "60 feet", rangeFeet: 60,
		components: ["V", "S", "M"], duration: "Concentration, up to 1 minute", concentration: true, ritual: false, description: "Paralyzed.", classes: ["wizard"],
		save: { ability: "wis", halfOnSuccess: false },
	},
	"burning-hands": {
		index: "burning-hands", name: "Burning Hands", level: 1, school: "evocation", castingTime: "1 action", range: "Self (15-foot cone)",
		components: ["V", "S"], duration: "Instantaneous", concentration: false, ritual: false, description: "Fire cone.", classes: ["wizard"],
		save: { ability: "dex", halfOnSuccess: true }, damage: { type: "fire", bySlotLevel: { 1: "3d6", 2: "4d6" } }, area: { shape: "cone", size: 15 },
	},
};

/** Sets the encounter so it is `id`'s turn with a fresh budget (test helper). */
export function giveTurn(enc: Encounter, id: string): Encounter {
	const e = structuredClone(enc);
	e.turnIndex = e.order.indexOf(id);
	const c: Combatant = e.combatants[id];
	c.turn = { movementLeft: c.speed, action: true, bonusAction: true, reaction: true, attacksLeft: 0 };
	return e;
}
