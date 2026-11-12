import type { LocationKind, TerrainFeature, WorldLocation, WorldMap } from "../game/types";

/**
 * Marea, the fixed city of Root Access (docs/cyberpunk.md §1): a coastal Latin
 * American megacity in 2068, drawn as a town-style world map (like Kessler
 * Falls). The sea lies to the south-west and has drowned the old centre; the
 * corporations live up the hills to the north-east. Travel times are fractions
 * of a day (metro, moto-taxi, canal boat), so crossing a district takes an hour or so.
 */

type Place = {
	id: string;
	kind: LocationKind;
	x: number;
	y: number;
	/** Known to every local on Day 0. */
	known: boolean;
	en: { name: string; description: string };
	es: { name: string; description: string };
};

const PLACES: Place[] = [
	{ id: "den", kind: "landmark", x: 0.4, y: 0.66, known: true, en: { name: "The Capsule Room", description: "Your den: a rented capsule room above a noodle stall in Los Anegados. La Tía found it; you owe her the rent and the favour." }, es: { name: "La cápsula", description: "Tu guarida: una cápsula alquilada encima de un puesto de fideos en Los Anegados. La Tía te la consiguió; le debes la renta y el favor." } },
	{ id: "anegados", kind: "town", x: 0.36, y: 0.7, known: true, en: { name: "Los Anegados", description: "The Drowned, the old town: half-flooded colonial streets, canals, stilt houses and noodle stalls. Los Ahogados run it." }, es: { name: "Los Anegados", description: "El casco viejo: calles coloniales medio inundadas, canales, palafitos y puestos de fideos. Mandan Los Ahogados." } },
	{ id: "tianguis", kind: "town", x: 0.5, y: 0.6, known: true, en: { name: "Tianguis Cromo", description: "The Chrome Market: second-hand decks, chrome, ripperdoc chairs and stolen code under tarps and neon." }, es: { name: "Tianguis Cromo", description: "El mercado del cromo: decks de segunda mano, cromo, sillones de matasanos y código robado bajo lonas y neón." } },
	{ id: "cerro-antena", kind: "village", x: 0.24, y: 0.4, known: true, en: { name: "Cerro Antena", description: "Antenna Hill: a favela of antennas and a pirate mesh, the free net. La Red Libre lives here." }, es: { name: "Cerro Antena", description: "Una favela de antenas y una malla pirata: la red libre. Aquí vive La Red Libre." } },
	{ id: "bolsa", kind: "city", x: 0.6, y: 0.42, known: true, en: { name: "Distrito Bolsa", description: "The financial district: banks, the data vaults and the exchange behind Ferro checkpoints." }, es: { name: "Distrito Bolsa", description: "El distrito financiero: bancos, las bóvedas de datos y la bolsa tras los retenes de Ferro." } },
	{ id: "cuspide", kind: "castle", x: 0.72, y: 0.2, known: true, en: { name: "La Cúspide", description: "The Summit: corporate arcologies on the hills behind private security, with clean air by subscription." }, es: { name: "La Cúspide", description: "Las arcologías corporativas en las lomas, tras seguridad privada, con aire limpio por suscripción." } },
	{ id: "universitaria", kind: "landmark", x: 0.8, y: 0.46, known: true, en: { name: "Ciudad Universitaria", description: "The university campus and the glass block of the Vantis Neural AI lab, where the shard came from." }, es: { name: "Ciudad Universitaria", description: "El campus de la universidad y el bloque de cristal del laboratorio de IA de Vantis Neural, de donde salió el shard." } },
	{ id: "puerto", kind: "ruins", x: 0.18, y: 0.84, known: true, en: { name: "El Puerto", description: "The automated container port: cranes that never sleep, smugglers and drone yards." }, es: { name: "El Puerto", description: "El puerto de contenedores automatizado: grúas que nunca duermen, contrabandistas y patios de drones." } },
	{ id: "plantas", kind: "landmark", x: 0.08, y: 0.58, known: true, en: { name: "Las Plantas", description: "The Aguas Marea desalination and water plants on the shore. Whoever holds the valves decides which barrios drink." }, es: { name: "Las Plantas", description: "Las desalinizadoras y plantas de agua de Aguas Marea en la orilla. Quien tiene las válvulas decide qué barrios beben." } },
	{ id: "seawall", kind: "landmark", x: 0.42, y: 0.93, known: false, en: { name: "The Seawall", description: "The cracked seawall that holds the bay back from what is left of the old centre." }, es: { name: "El Malecón", description: "El malecón agrietado que contiene la bahía frente a lo que queda del centro viejo." } },
	{ id: "ground-station", kind: "tower", x: 0.9, y: 0.12, known: false, en: { name: "The Old Ground Station", description: "A dead satellite ground station on the ridge. Its dishes still turn some nights." }, es: { name: "La vieja estación terrena", description: "Una estación terrena de satélites muerta en la cresta. Algunas noches sus antenas todavía giran." } },
	{ id: "ferro-dc", kind: "castle", x: 0.9, y: 0.7, known: false, en: { name: "Ferro Detention Data Centre", description: "Grupo Ferro's detention block and data centre, where the people and the records they take end up." }, es: { name: "Centro de datos de detención de Ferro", description: "El bloque de detención y centro de datos de Grupo Ferro, donde acaban la gente y los registros que se llevan." } },
	{ id: "dry-barrios", kind: "village", x: 0.86, y: 0.88, known: false, en: { name: "The Dry Barrios", description: "Barrios at the edge of the water grid: tanker trucks, toxic dust and filter masks." }, es: { name: "Los barrios secos", description: "Barrios al borde de la red de agua: camiones cisterna, polvo tóxico y mascarillas con filtro." } },
];

/** [from, to, hours of travel (metro, moto-taxi, canal boat)] */
const ROADS: [string, string, number][] = [
	["den", "anegados", 0.1], ["anegados", "tianguis", 0.5], ["anegados", "puerto", 0.8], ["anegados", "seawall", 0.6],
	["tianguis", "bolsa", 0.6], ["tianguis", "cerro-antena", 1], ["cerro-antena", "plantas", 1], ["anegados", "plantas", 1.2],
	["bolsa", "cuspide", 0.8], ["bolsa", "universitaria", 0.7], ["cuspide", "ground-station", 1.5], ["universitaria", "ferro-dc", 1],
	["ferro-dc", "dry-barrios", 0.8], ["tianguis", "dry-barrios", 1.6], ["puerto", "plantas", 1],
];

const TERRAIN = (lang: "en" | "es"): TerrainFeature[] => [
	{ id: "t-canals", terrain: "marsh", x: 0.34, y: 0.76, r: 0.12, name: lang === "es" ? "Los Canales" : "The Canals" },
	{ id: "t-antena", terrain: "hills", x: 0.2, y: 0.34, r: 0.12 },
	{ id: "t-lomas", terrain: "mountains", x: 0.8, y: 0.12, r: 0.16, name: lang === "es" ? "Las Lomas" : "The Hills" },
	{ id: "t-shore", terrain: "marsh", x: 0.08, y: 0.86, r: 0.1, name: lang === "es" ? "La Bahía" : "The Bay" },
	{ id: "t-dust", terrain: "desert", x: 0.9, y: 0.9, r: 0.1 },
];

export const MAREA_START = "den";
export const MAREA_PREFIX = "loc-ma-";

export function marea(seed: number, lang: "en" | "es" = "en"): WorldMap {
	const locations: WorldLocation[] = PLACES.map((p) => ({
		id: `${MAREA_PREFIX}${p.id}`,
		name: p[lang].name,
		kind: p.kind,
		x: p.x,
		y: p.y,
		discovered: p.known,
		visited: p.id === MAREA_START,
		description: p[lang].description,
		mapIds: [],
	}));
	const known = new Set(PLACES.filter((p) => p.known).map((p) => p.id));
	return {
		seed,
		name: "Marea",
		// Coastal: the bay to the south-west (drawn as the canals and shore for now; no new map art in Phase 1).
		terrain: { seaLevel: 0.3, biome: "tropical", style: "town", features: TERRAIN(lang) },
		locations,
		routes: ROADS.map(([a, b, h], i) => ({ id: `r-ma-${i}`, from: `${MAREA_PREFIX}${a}`, to: `${MAREA_PREFIX}${b}`, kind: "road" as const, travelDays: Math.round((h / 24) * 1000) / 1000, discovered: known.has(a) && known.has(b) })),
		currentLocationId: `${MAREA_PREFIX}${MAREA_START}`,
	};
}
