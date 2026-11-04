import { rulesetOf } from "../rules/ruleset";
import { kesslerFalls } from "../maps/kessler";
import type { CampaignSettings, GameState, LocationKind, SceneKind, WorldMap } from "../game/types";
import { createCharacterDetailed, type CreateCharacterInput } from "../rules/character";
import { Rng, newSeed } from "../rules/dice";
import { generateWorld } from "../maps";
import { saveState, campaignExists } from "../store/campaigns";
import { randomPortrait } from "../art/portrait";
import { newId } from "./context";

/** Input from the setup wizard. */
export interface NewGameInput {
	title?: string;
	settings: CampaignSettings;
	character: Omit<CreateCharacterInput, "rng" | "level"> & { rollSeed?: number };
	seed?: number;
}

const BIOME: Record<CampaignSettings["world"]["preset"], WorldMap["terrain"]["biome"]> = {
	classic_high_fantasy: "temperate",
	grimdark: "mixed",
	gothic_horror: "temperate",
	sword_and_sorcery: "mixed",
	pirates: "tropical",
	arctic: "frozen",
	desert_kingdoms: "arid",
	fey_wilds: "temperate",
	zombie_outbreak: "temperate",
	custom: "mixed",
};

const START_SCENE: Record<string, { kind: SceneKind; title: string }> = {
	pirates: { kind: "coast", title: "A Harbor at Dawn" },
	arctic: { kind: "camp", title: "Camp in the Snow" },
	desert_kingdoms: { kind: "desert", title: "The Caravan Road" },
	zombie_outbreak: { kind: "town", title: "Kessler Falls, Monday Night" },
	gothic_horror: { kind: "road", title: "A Mist-Shrouded Road" },
	fey_wilds: { kind: "forest", title: "The Shimmering Wood" },
	default: { kind: "tavern", title: "A Roadside Inn" },
};

const START_SCENE_ES: Record<string, string> = {
	pirates: "Un puerto al amanecer",
	arctic: "Campamento en la nieve",
	desert_kingdoms: "La ruta de las caravanas",
	zombie_outbreak: "Kessler Falls, lunes por la noche",
	gothic_horror: "Un camino envuelto en niebla",
	fey_wilds: "El bosque resplandeciente",
	default: "Una posada junto al camino",
};

export function createGame(input: NewGameInput): GameState {
	const seed = (input.seed ?? newSeed()) >>> 0 || 1;
	const rng = new Rng(seed);
	const { character } = createCharacterDetailed({
		...input.character,
		ruleset: rulesetOf(input.settings),
		level: input.settings.structure.startingLevel,
		rng,
		portrait: input.character.portrait ?? randomPortrait(rng, input.character.speciesId),
	});
	const zombie = rulesetOf(input.settings) === "zombie";
	const world = zombie
		? kesslerFalls(rng.int(1, 2 ** 31 - 1), input.settings.language === "es" ? "es" : "en")
		: generateWorld({ seed: rng.int(1, 2 ** 31 - 1), biome: BIOME[input.settings.world.preset], lang: input.settings.language });
	// Start at a discovered settlement.
	const startKinds: LocationKind[] = input.settings.world.preset === "pirates" ? ["coast", "town", "village"] : ["village", "town", "city"];
	const start = zombie ? world.locations.find((l) => l.id === world.currentLocationId) : (world.locations.find((l) => startKinds.includes(l.kind)) ?? world.locations[0]);
	if (start) {
		start.discovered = true;
		start.visited = true;
		world.currentLocationId = start.id;
	}
	const es = input.settings.language === "es";
	const base = START_SCENE[input.settings.world.preset] ?? START_SCENE.default;
	const sc = es ? { ...base, title: START_SCENE_ES[input.settings.world.preset] ?? START_SCENE_ES.default } : base;
	let id = newId("c");
	while (campaignExists(id)) id = newId("c");
	const now = Date.now();
	const state: GameState = {
		version: 1,
		id,
		title: input.title?.trim() || (es ? `La historia de ${character.name}` : `${character.name}'s Tale`),
		createdAt: now,
		updatedAt: now,
		// New campaigns default to pixel scenes; older saves without `art` keep paintings.
		settings: input.settings.art ? input.settings : { ...input.settings, art: { scenes: "sprites" } },
		character,
		mode: "explore",
		scene: zombie
			? { title: sc.title, kind: sc.kind, timeOfDay: "night", weather: "rain", mood: "tense", npcIds: [], props: [] }
			: { title: sc.title, kind: sc.kind, timeOfDay: "dusk", weather: "clear", mood: "calm", npcIds: [], props: [] },
		// The Quiet opens on the outbreak night: sirens, helicopters, bells.
		ambience: zombie ? "q_outbreak" : "none",
		world,
		maps: {},
		view: "scene",
		npcs: {},
		quests: [],
		journal: [],
		// The Quiet starts on the outbreak night (Day 0 of the outbreak = game day 1).
		time: zombie ? { day: 1, hour: 21, minute: 0 } : { day: 1, hour: 18, minute: 0 },
		suggestions: [],
		rng: rng.state,
		dmNotes: [],
	};
	saveState(state);
	return state;
}
