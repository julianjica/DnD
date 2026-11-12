import { rulesetOf } from "../rules/ruleset";
import { kesslerFalls } from "../maps/kessler";
import { marea } from "../maps/marea";
import { initCyberState } from "../rules/cyber";
import { initDen } from "../rules/den";
import { syncRamSlots } from "../rules/deck";
import { addInventoryItem } from "./items";
import { getEquipment } from "../srd";
import type { CampaignSettings, GameState, LocationKind, SceneKind, WorldMap } from "../game/types";
import { createCharacterDetailed, type CreateCharacterInput } from "../rules/character";
import { Rng, newSeed } from "../rules/dice";
import { generateWorld } from "../maps";
import { saveState, campaignExists } from "../store/campaigns";
import { initTown } from "../rules/town";
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
	marea_burned: "tropical",
	custom: "mixed",
};

const START_SCENE: Record<string, { kind: SceneKind; title: string }> = {
	pirates: { kind: "coast", title: "A Harbor at Dawn" },
	arctic: { kind: "camp", title: "Camp in the Snow" },
	desert_kingdoms: { kind: "desert", title: "The Caravan Road" },
	zombie_outbreak: { kind: "town", title: "Kessler Falls, Monday Night" },
	marea_burned: { kind: "town", title: "Burned: a Capsule Room in Los Anegados" },
	gothic_horror: { kind: "road", title: "A Mist-Shrouded Road" },
	fey_wilds: { kind: "forest", title: "The Shimmering Wood" },
	default: { kind: "tavern", title: "A Roadside Inn" },
};

const START_SCENE_ES: Record<string, string> = {
	pirates: "Un puerto al amanecer",
	arctic: "Campamento en la nieve",
	desert_kingdoms: "La ruta de las caravanas",
	zombie_outbreak: "Kessler Falls, lunes por la noche",
	marea_burned: "Quemado: una cápsula en Los Anegados",
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
	const rs = rulesetOf(input.settings);
	const zombie = rs === "zombie";
	const cyber = rs === "cyberpunk";
	const lang2 = input.settings.language === "es" ? "es" : "en";
	const world = zombie
		? kesslerFalls(rng.int(1, 2 ** 31 - 1), lang2)
		: cyber
			? marea(rng.int(1, 2 ** 31 - 1), lang2)
			: generateWorld({ seed: rng.int(1, 2 ** 31 - 1), biome: BIOME[input.settings.world.preset], lang: input.settings.language });
	// Start at a discovered settlement.
	const startKinds: LocationKind[] = input.settings.world.preset === "pirates" ? ["coast", "town", "village"] : ["village", "town", "city"];
	const start = zombie || cyber ? world.locations.find((l) => l.id === world.currentLocationId) : (world.locations.find((l) => startKinds.includes(l.kind)) ?? world.locations[0]);
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
		scene: zombie || cyber
			? { title: sc.title, kind: sc.kind, timeOfDay: "night", weather: "rain", mood: "tense", npcIds: [], props: [] }
			: { title: sc.title, kind: sc.kind, timeOfDay: "dusk", weather: "clear", mood: "calm", npcIds: [], props: [] },
		// The Quiet opens on the outbreak night: sirens, helicopters, bells.
		// Root Access opens on a wet night in Los Anegados ("Burned").
		ambience: zombie ? "q_outbreak" : cyber ? "rain" : "none",
		world,
		maps: {},
		view: "scene",
		npcs: {},
		quests: [],
		journal: [],
		// The Quiet starts on the outbreak night (Day 0 of the outbreak = game day 1).
		// Root Access: Day 0 of the story, late on the night of the betrayal (game day 1).
		time: zombie ? { day: 1, hour: 21, minute: 0 } : cyber ? { day: 1, hour: 23, minute: 40 } : { day: 1, hour: 18, minute: 0 },
		suggestions: [],
		rng: rng.state,
		dmNotes: [],
	};
	// The Quiet: the town is there from the first night (nothing to review yet).
	if (zombie) {
		const trng = new Rng(rng.int(1, 2 ** 31 - 1));
		initTown(state, trng);
		state.town!.reviewed = true;
	}
	if (cyber) burnedOpening(state, rng, lang2);
	saveState(state);
	return state;
}

/**
 * Root Access, Day 0 "Burned" (docs/cyberpunk.md §1): Santi Varela sold you to
 * Grupo Ferro on the way out of a Vantis job; you got away with the shard, a
 * burned identity and a cracked deck. La Tía hid you in a capsule room above a
 * noodle stall in Los Anegados, and now you owe her. The meters start here
 * (lib/rules/cyber.ts initCyberState; starting Heat comes from there).
 */
function burnedOpening(state: GameState, rng: Rng, lang: "en" | "es"): void {
	const es = lang === "es";
	const t = state.time;
	state.cyber = initCyberState(state.character, t.day * 1440 + t.hour * 60 + t.minute);
	state.cyber.den = initDen(state, t.day * 1440 + t.hour * 60 + t.minute); // the capsule room, 200 a week to La Tía (lib/rules/den.ts)
	syncRamSlots(state); // RAM from the starting deck and the experimental jack
	// The shard: the gear agent's item if it exists, else a plain named item (same ref, so it upgrades later).
	const shard = getEquipment("c-vantis-shard");
	if (!state.character.inventory.some((i) => i.ref === "c-vantis-shard"))
		addInventoryItem(state, { ref: "c-vantis-shard", name: shard?.name ?? (es ? "Shard de datos de Vantis" : "Vantis Data Shard"), quantity: 1, category: "quest", description: shard?.description ?? (es ? "El shard cifrado que sacaste del servidor de Vantis. Todo el mundo lo quiere." : "The encrypted shard you pulled off the Vantis server. Everyone wants it.") }, () => newId("it"));
	const tiaId = newId("npc");
	const den = state.world.currentLocationId;
	state.npcs[tiaId] = {
		id: tiaId,
		name: "La Tía",
		role: es ? "tu fixer (le debes)" : "your fixer (you owe her)",
		speciesId: "human",
		disposition: "neutral",
		description: es ? "Una fixer de Los Anegados, paciente hasta que deja de serlo. Te escondió en la cápsula; ahora le debes la renta y el favor." : "A fixer from Los Anegados, patient until she isn't. She hid you in the capsule room; now you owe her the rent and the favour.",
		secret: "She already knows more about the shard than she lets on, and she has buyers asking. She protects her investments, not people.",
		locationId: den,
		alive: true,
		portrait: randomPortrait(rng, "human"),
		firstMetDay: t.day,
		voice: "Warm, unhurried, never raises her voice; calls the PC 'mijo'/'mija'; every kindness ends with a reminder of the price.",
		wants: "Her rent every week, the favour repaid, and a cut of whatever the shard is worth.",
	};
	state.quests.push({
		id: newId("q"),
		title: es ? "Quemado" : "Burned",
		summary: es
			? "Tu crew, liderada por Santi Varela, golpeó un servidor de Vantis. Al salir, Santi te vendió a Grupo Ferro. Escapaste con un shard cifrado, una identidad quemada y un deck rajado. Ahora le debes a La Tía."
			: "Your crew, led by Santi Varela, hit a Vantis server. On the way out Santi sold you to Grupo Ferro. You got away with an encrypted shard, a burned identity and a cracked deck. Now you owe La Tía.",
		status: "active",
		objectives: [
			{ id: "rent", text: es ? "Pagarle a La Tía la renta y el favor" : "Pay La Tía the rent and the favour", done: false },
			{ id: "shard", text: es ? "Averiguar qué hay en el shard" : "Find out what's on the shard", done: false },
			{ id: "santi", text: es ? "Averiguar por qué Santi te vendió, y a quién" : "Find out why Santi sold you out, and to whom", done: false },
		],
		giverNpcId: tiaId,
	});
	state.scene.npcIds = [];
	state.dmNotes.push("Burned (Day 0): the PC is hiding in La Tía's capsule room above a noodle stall in Los Anegados, late at night, rain on the tin roof. Santi Varela sold them to Grupo Ferro; they hold the encrypted Vantis shard; Vantis, Ferro, Los Ahogados and someone signing as ECO all want it. La Tía is on the phone, not in the room.");
}
