import type { LocationKind, TerrainFeature, WorldLocation, WorldMap } from "../game/types";

/**
 * Kessler Falls, the fixed town of The Quiet (docs/zombie.md §1). A river
 * valley seen as a "world" map: the river runs north–south through the middle,
 * hills close the valley west and north-east. Travel times are in days (fractions
 * of a day), so a walk across town is an hour or two.
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
	{ id: "downtown", kind: "town", x: 0.46, y: 0.5, known: true, en: { name: "Downtown Kessler Falls", description: "Main Street: Rosie's Diner, Hale's Pharmacy, the Bijou cinema, City Hall and the bus depot." }, es: { name: "Centro de Kessler Falls", description: "Main Street: el Rosie's Diner, la farmacia Hale's, el cine Bijou, el ayuntamiento y la estación de autobuses." } },
	{ id: "precinct", kind: "landmark", x: 0.42, y: 0.46, known: true, en: { name: "Kessler Falls Police Station", description: "Brick precinct house with a walled motor pool and holding cells." }, es: { name: "Comisaría de Kessler Falls", description: "Comisaría de ladrillo con un patio de vehículos tapiado y calabozos." } },
	{ id: "st-agnes", kind: "temple", x: 0.5, y: 0.45, known: true, en: { name: "St. Agnes Church", description: "Stone church on the square, bell tower over the rooftops." }, es: { name: "Iglesia de St. Agnes", description: "Iglesia de piedra en la plaza, con un campanario sobre los tejados." } },
	{ id: "st-brigids", kind: "landmark", x: 0.35, y: 0.35, known: true, en: { name: "St. Brigid's Regional Hospital", description: "The hospital on the hill, with its own generator. Where it started." }, es: { name: "Hospital Regional St. Brigid's", description: "El hospital de la colina, con generador propio. Donde empezó todo." } },
	{ id: "hollis", kind: "landmark", x: 0.61, y: 0.39, known: true, en: { name: "Hollis State College", description: "Campus across the river: the library tower and the science building with the Ventara Biologics wing." }, es: { name: "Universidad Estatal Hollis", description: "El campus al otro lado del río: la torre de la biblioteca y el edificio de ciencias con el ala de Ventara Biologics." } },
	{ id: "old-mill", kind: "ruins", x: 0.53, y: 0.61, known: true, en: { name: "Old Mill District", description: "Empty textile mills, the dam and the rail yard along the river." }, es: { name: "Distrito del Viejo Molino", description: "Fábricas textiles vacías, la presa y el patio ferroviario junto al río." } },
	{ id: "mall", kind: "landmark", x: 0.7, y: 0.62, known: true, en: { name: "Riverside Mall", description: "The mall, a big-box store and a sea of parking by the Route 9 interchange." }, es: { name: "Centro comercial Riverside", description: "El centro comercial, un hipermercado y un mar de aparcamiento junto al enlace de la Ruta 9." } },
	{ id: "route9", kind: "camp", x: 0.77, y: 0.69, known: true, en: { name: "Route 9 Motel & Gas", description: "A roadside motel and gas station on the highway out of the valley." }, es: { name: "Motel y gasolinera de la Ruta 9", description: "Un motel de carretera y una gasolinera en la autopista que sale del valle." } },
	{ id: "pinecrest", kind: "village", x: 0.32, y: 0.6, known: true, en: { name: "Pinecrest", description: "Suburbs: cul-de-sacs, the elementary school, the public pool." }, es: { name: "Pinecrest", description: "Las afueras: calles sin salida, la escuela primaria, la piscina municipal." } },
	{ id: "granger", kind: "village", x: 0.2, y: 0.76, known: false, en: { name: "Granger Farm", description: "Orchards, a grain silo and a family that keeps to itself." }, es: { name: "Granja Granger", description: "Huertos, un silo de grano y una familia que no se mete con nadie." } },
	{ id: "armory", kind: "castle", x: 0.24, y: 0.29, known: false, en: { name: "National Guard Armory", description: "Fenced compound off the hill road." }, es: { name: "Arsenal de la Guardia", description: "Un recinto vallado junto a la carretera de la colina." } },
	{ id: "prison", kind: "castle", x: 0.81, y: 0.25, known: false, en: { name: "Kessler County Correctional", description: "The county prison up the north-east road." }, es: { name: "Penitenciaría del condado de Kessler", description: "La prisión del condado, carretera arriba hacia el noreste." } },
	{ id: "water", kind: "landmark", x: 0.56, y: 0.79, known: false, en: { name: "Water Treatment Plant", description: "Settling tanks and pump houses downstream of town." }, es: { name: "Planta de tratamiento de agua", description: "Tanques de decantación y casetas de bombeo río abajo." } },
	{ id: "bald-hill", kind: "tower", x: 0.15, y: 0.18, known: false, en: { name: "Bald Hill Radio Tower", description: "The 101.7 FM transmitter on the bare hilltop." }, es: { name: "Torre de radio de Bald Hill", description: "El transmisor de la 101.7 FM en la cima pelada de la colina." } },
	{ id: "north-bridge", kind: "landmark", x: 0.5, y: 0.2, known: true, en: { name: "North Bridge", description: "The old steel bridge on the road north out of the valley." }, es: { name: "Puente Norte", description: "El viejo puente de acero en la carretera que sale del valle hacia el norte." } },
	{ id: "south-bridge", kind: "landmark", x: 0.63, y: 0.87, known: true, en: { name: "Route 9 Bridge", description: "The highway bridge south, the main way out." }, es: { name: "Puente de la Ruta 9", description: "El puente de la autopista hacia el sur, la salida principal." } },
];

/** [from, to, hours on foot] */
const ROADS: [string, string, number][] = [
	["downtown", "precinct", 0.2], ["downtown", "st-agnes", 0.2], ["downtown", "st-brigids", 1], ["downtown", "hollis", 1],
	["downtown", "old-mill", 0.7], ["old-mill", "mall", 1.2], ["mall", "route9", 0.5], ["downtown", "pinecrest", 1.2],
	["pinecrest", "granger", 3], ["st-brigids", "armory", 2], ["hollis", "prison", 3.5], ["old-mill", "water", 1.5],
	["granger", "bald-hill", 5], ["downtown", "north-bridge", 2.5], ["mall", "south-bridge", 2], ["hollis", "north-bridge", 2.5],
];

const TERRAIN: TerrainFeature[] = [
	{ id: "t-west-ridge", terrain: "hills", x: 0.12, y: 0.4, r: 0.22, name: "West Ridge" },
	{ id: "t-ne-heights", terrain: "mountains", x: 0.88, y: 0.12, r: 0.16 },
	{ id: "t-bald-hill", terrain: "hills", x: 0.15, y: 0.17, r: 0.08 },
	{ id: "t-pine-woods", terrain: "forest", x: 0.26, y: 0.88, r: 0.12, name: "Pine Woods" },
	{ id: "t-east-woods", terrain: "forest", x: 0.88, y: 0.46, r: 0.12 },
	{ id: "t-orchards", terrain: "plains", x: 0.16, y: 0.68, r: 0.08 },
	{ id: "t-riverbend", terrain: "marsh", x: 0.55, y: 0.93, r: 0.06, name: "River Bend" },
];

export const KESSLER_START = "downtown";

export function kesslerFalls(seed: number, lang: "en" | "es" = "en"): WorldMap {
	const locations: WorldLocation[] = PLACES.map((p) => ({
		id: `loc-kf-${p.id}`,
		name: p[lang].name,
		kind: p.kind,
		x: p.x,
		y: p.y,
		discovered: p.known,
		visited: p.id === KESSLER_START,
		description: p[lang].description,
		mapIds: [],
	}));
	const known = new Set(PLACES.filter((p) => p.known).map((p) => p.id));
	return {
		seed,
		name: "Kessler Falls",
		// Inland valley: no sea at all.
		terrain: { seaLevel: 0.2, biome: "temperate", style: "town", features: TERRAIN },
		locations,
		routes: ROADS.map(([a, b, h], i) => ({ id: `r-kf-${i}`, from: `loc-kf-${a}`, to: `loc-kf-${b}`, kind: "road" as const, travelDays: Math.round((h / 24) * 1000) / 1000, discovered: known.has(a) && known.has(b) })),
		currentLocationId: `loc-kf-${KESSLER_START}`,
	};
}
