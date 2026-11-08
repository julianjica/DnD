import { rulesetOf } from "../../rules/ruleset";
import type { EntityKind, GameState, GridMap, LocationKind, MapKind, TerrainKind, Tile, WorldLocation } from "../../game/types";
import { MODERN_FEATURE_SPRITES, mapToRows } from "../../maps/draw";
import { autoLink, linkBoth, linkSummary } from "../../maps/links";
import { assertNotFallen } from "../../rules/fallen";
import { climateForPreset, drawMap, FEATURE_SPRITES, generateMap, LEGEND_TEXT, MAP_KINDS, placeEntity, revealAround, WORLD_ASPECT, type Climate, type DrawKey } from "../../maps";
import { distanceInDays, isTownWorld, travelDaysIn, travelText } from "../../maps/geography";
import { addTerrainFeature, BEARING, betweenFromText, compassOf, daysForDistance, directionFromText, distanceForDays, fits, mapDistance, placeFor, REGION_SIZE, retimeRoutes, terrainFor, type Compass, type PlaceSpec } from "../../maps/geography";
import { S, newId, tool, withState, type ToolFactory } from "../context";

const LOCATION_KINDS: LocationKind[] = ["town", "city", "village", "dungeon", "cave", "forest", "mountain", "ruins", "castle", "temple", "swamp", "coast", "camp", "tower", "landmark"];
const ENTITY_KINDS: EntityKind[] = ["monster", "npc", "item", "trap", "feature", "light"];
const TILES: Tile[] = ["floor", "wall", "door", "door_open", "door_locked", "secret_door", "water", "deep_water", "difficult", "pit", "stairs_up", "stairs_down", "grass", "tall_grass", "tree", "rock", "road", "sand", "mud", "lava", "bridge", "wood_floor", "rubble", "pillar", "table", "ice"];

export const SIGHT_RADIUS = 12;

export function pcEntity(map: GridMap, _state?: GameState) {
	return map.entities.find((e) => e.kind === "pc");
}

/** Ensures the PC token exists on the map and reveals around it. */
export function ensurePc(map: GridMap, state: GameState): void {
	let pc = pcEntity(map, state);
	if (!pc) pc = placeEntity(map, { id: `ent_${state.character.id}`, kind: "pc", name: state.character.name, sprite: "pc", disposition: "friendly" }, map.entry);
	revealAround(map, pc.x, pc.y, SIGHT_RADIUS);
}

function mapSummary(map: GridMap, state?: GameState): string {
	const rooms = map.rooms.map((r) => `${r.id}${r.tag ? `(${r.tag})` : ""} x${r.x}-${r.x + r.w - 1} y${r.y}-${r.y + r.h - 1}${r.name ? ` "${r.name}"` : ""}`);
	const links = state ? linkSummary(state, map) : "";
	return `Map ${map.name} [${map.id}] ${map.kind} ${map.width}x${map.height}, lighting ${map.lighting}, entry ${map.entry.x},${map.entry.y}.\nRooms/areas: ${rooms.join("; ") || "none"}.\nEntities: ${map.entities.map((e) => `${e.name}[${e.id}] ${e.kind}@${e.x},${e.y}${e.dead ? " DEAD (a corpse; it stays dead)" : ""}`).join("; ")}${links ? `\nExits to other maps (the player walks through them): ${links}` : ""}`;
}

function activeMap(state: GameState): GridMap {
	const m = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	if (!m) throw new Error("No active map. Call generate_map first.");
	return m;
}

/** Makes `map` the active map of the current location, keeping only the 12 most recent maps. */
function addMap(state: GameState, map: GridMap) {
	if (rulesetOf(state.settings) === "zombie") map.theme = "modern";
	state.maps[map.id] = map;
	state.activeMapId = map.id;
	const loc = state.world.locations.find((l) => l.id === state.world.currentLocationId);
	if (loc) loc.mapIds.push(map.id);
	const ids = Object.keys(state.maps);
	if (ids.length > 12) for (const old of ids.slice(0, ids.length - 12)) if (old !== map.id) delete state.maps[old];
}

type DrawKeyArg = DrawKey & { char: string };

export const drawMapTool = tool<{ name: string; kind: MapKind; rows: string[]; key?: DrawKeyArg[]; climate?: Climate; lighting?: GridMap["lighting"]; show?: boolean }>(
	"draw_map",
	`Draw the place the player is in, square by square (5 ft each), as rows of characters. It becomes the picture in the scene panel AND the battle map, so draw what you narrate: walls, doors, furniture, terrain, who stands where. Typical size 24-40 wide x 14-22 tall; all rows the same length.
Legend: ${LEGEND_TEXT}.
Anything else (features, NPCs) goes in key: one character each (letters/digits not in the legend, e.g. R, 1, 2). Feature sprites: ${FEATURE_SPRITES.filter((f) => !(MODERN_FEATURE_SPRITES as readonly string[]).includes(f)).join(", ")}. Modern props (The Quiet only): ${MODERN_FEATURE_SPRITES.join(", ")}. NPCs: {char, npcId}. Light sources: add lightRadius.
Example (a hall): rows ["########+########", "#.....=====.....#", "#.R.==hhhh==..1.#", "#....==@===.....#", "#################"] with key [{char:"R", sprite:"runestone"}, {char:"h", sprite:"hearth", lightRadius:6}, {char:"1", npcId:"npc_…"}].
Draw each place once; return later with use_map. Another part of a place already drawn (the back yard of the same building) must match the maps there: same building outline, walls, doors and features where they overlap; the first draw_map there shows you those maps and draws nothing; draw again after. Monsters for a fight are added by start_combat as usual.`,
	S.obj(
		{
			name: S.str("The place's name"),
			kind: S.str("Closest map kind (sets wall style and palette)", MAP_KINDS),
			rows: S.arr(S.str(), "One string per row, top (north) first"),
			key: S.arr(
				S.obj(
					{
						char: S.str("Single character used in rows"),
						sprite: S.str("Feature sprite name"),
						name: S.str(),
						kind: S.str(undefined, ["feature", "light", "item", "npc"]),
						npcId: S.str(),
						lightRadius: S.int(undefined, 1, 12),
						description: S.str(),
					},
					["char"],
				),
			),
			climate: S.str("Default from the campaign setting", ["temperate", "snow", "desert"]),
			lighting: S.str(undefined, ["bright", "dim", "dark"]),
			show: S.bool("Switch to the Map tab (default false: the scene panel shows it)"),
		},
		["name", "kind", "rows"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			if (state.encounter?.status === "active") throw new Error("Cannot change maps during combat.");
			if (!MAP_KINDS.includes(a.kind)) throw new Error(`Unknown kind "${a.kind}". Use one of: ${MAP_KINDS.join(", ")}.`);
			const here = state.world.locations.find((l) => l.id === state.world.currentLocationId);
			const existing = (here?.mapIds ?? []).map((id) => state.maps[id]).filter(Boolean);
			// Another part of a place already drawn: the first call only shows the existing
			// maps (nothing is drawn); the next call draws, now consistent with them.
			if (here && existing.length && here.drawShown !== existing.length) {
				here.drawShown = existing.length;
				return (
					`NOTHING WAS DRAWN. ${here.name} already has ${existing.length} map(s). Going back to one of them? use_map. Drawing another part of the same place? Make it consistent with these (same building outline and size, walls, doors and features where they overlap: a door in one map's wall is a door in the other's) and call draw_map again. Doors drawn in the same places on touching edge walls (same length) link the two maps automatically, so the player can walk between them; other connections (stairs, a gap) need link_maps.\n` +
					existing
						.map((mp) => {
							const dead = mp.entities.filter((e) => e.dead).map((e) => e.name);
							return `${mp.name} [${mp.id}] ${mp.width}x${mp.height} (@ you, * tokens):\n${mapToRows(mp).join("\n")}\nTokens: ${mp.entities.filter((e) => e.kind !== "pc").map((e) => `${e.name}@${e.x},${e.y}${e.dead ? " (dead)" : ""}`).join("; ") || "none"}${dead.length ? `\nDead here (don't bring them back): ${dead.join(", ")}` : ""}`;
						})
						.join("\n\n")
				);
			}
			const key: Record<string, DrawKey> = {};
			for (const k of a.key ?? []) {
				if (k.npcId && !state.npcs[k.npcId]) throw new Error(`Unknown npcId ${k.npcId} for key "${k.char}".`);
				const { char, ...rest } = k;
				key[char] = rest;
			}
			const res = drawMap({ rows: a.rows, key, kind: a.kind, name: a.name, climate: a.climate ?? climateForPreset(state.settings.world.preset), lighting: a.lighting, seed: rng.int(1, 2 ** 31 - 1) });
			const map = res.map;
			map.id = newId("map");
			for (const e of res.entities) {
				const npc = e.npcId ? state.npcs[e.npcId] : undefined;
				map.entities.push({ ...e, id: newId("ent"), ...(npc ? { name: npc.name } : {}) });
			}
			if (res.pc) placeEntity(map, { id: `ent_${state.character.id}`, kind: "pc", name: state.character.name, sprite: "pc", disposition: "friendly", x: res.pc.x, y: res.pc.y }, res.pc);
			ensurePc(map, state);
			addMap(state, map);
			const linked = autoLink(map, existing);
			state.view = a.show ? "map" : "scene";
			return [mapSummary(map, state), ...linked, ...res.warnings].join("\n");
		}),
);

export const generateMapTool = tool<{ kind: MapKind; name?: string; features?: string[]; width?: number; height?: number; lighting?: GridMap["lighting"]; show?: boolean }>(
	"generate_map",
	"Procedurally generate a tactical grid map (5 ft squares) for the current location and make it active; the player token is placed at the entry. Then populate with place_entity / start_combat. Returns rooms with coordinates.",
	S.obj(
		{
			kind: S.str(undefined, MAP_KINDS),
			name: S.str(),
			features: S.arr(S.str(), "Hints: 'river', 'bridge', 'altar', 'throne', 'well', 'pool', 'ruins', 'campfire', 'chasm', 'stairs_down'…"),
			width: S.int(undefined, 16, 80),
			height: S.int(undefined, 12, 60),
			lighting: S.str(undefined, ["bright", "dim", "dark"]),
			show: S.bool("Switch the view to the map (default true)"),
		},
		["kind"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			if (state.encounter?.status === "active") throw new Error("Cannot change maps during combat.");
			const map = generateMap({ kind: a.kind, seed: rng.int(1, 2 ** 31 - 1), width: a.width, height: a.height, features: a.features, name: a.name });
			map.id = newId("map");
			if (a.lighting) map.lighting = a.lighting;
			const climate = climateForPreset(state.settings.world.preset);
			if (climate !== "temperate") map.climate = climate;
			ensurePc(map, state);
			addMap(state, map);
			if (a.show !== false) state.view = "map";
			return mapSummary(map, state);
		}),
);

export const useMapTool = tool<{ mapId: string; show?: boolean }>(
	"use_map",
	"Re-activate a previously generated map (returning to a known place).",
	S.obj({ mapId: S.str(), show: S.bool() }, ["mapId"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const map = state.maps[a.mapId];
			if (!map) throw new Error(`Unknown map ${a.mapId}. Known: ${Object.values(state.maps).map((m) => `${m.name}[${m.id}]`).join(", ")}`);
			state.activeMapId = map.id;
			ensurePc(map, state);
			if (a.show !== false) state.view = "map";
			return mapSummary(map, state);
		}),
);

export const linkMapsTool = tool<{ mapId: string; x: number; y: number; toMapId: string; toX: number; toY: number }>(
	"link_maps",
	"Connect two maps of the same place both ways: walking onto (x,y) on mapId takes the party to (toX,toY) on toMapId and back (stairs, a doorway, a gap in a fence). Use the door/stairs square on each side. Doors drawn in matching places on touching edge walls are linked automatically by draw_map.",
	S.obj({ mapId: S.str(), x: S.int(undefined, 0), y: S.int(undefined, 0), toMapId: S.str(), toX: S.int(undefined, 0), toY: S.int(undefined, 0) }, ["mapId", "x", "y", "toMapId", "toX", "toY"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const m = state.maps[a.mapId], t = state.maps[a.toMapId];
			if (!m || !t) throw new Error(`Unknown map ${!m ? a.mapId : a.toMapId}. Known: ${Object.values(state.maps).map((x) => `${x.name}[${x.id}]`).join(", ")}`);
			if (m === t) throw new Error("Link two different maps.");
			for (const [mp, x, y] of [[m, a.x, a.y], [t, a.toX, a.toY]] as const) {
				if (x >= mp.width || y >= mp.height) throw new Error(`(${x},${y}) is outside ${mp.name} (${mp.width}x${mp.height}).`);
				const tile = mp.tiles[y * mp.width + x];
				if (["wall", "void", "rock", "building"].includes(tile)) throw new Error(`(${x},${y}) on ${mp.name} is ${tile}: put the link on a door, stairs or open square.`);
			}
			linkBoth(m, { x: a.x, y: a.y }, t, { x: a.toX, y: a.toY });
			return `Linked ${m.name} (${a.x},${a.y}) ↔ ${t.name} (${a.toX},${a.toY}).`;
		}),
);

export const placeEntityTool = tool<{ kind: EntityKind; name: string; sprite?: string; x?: number; y?: number; room?: string; size?: number; hidden?: boolean; disposition?: "friendly" | "neutral" | "hostile"; npcId?: string; description?: string; lightRadius?: number }>(
	"place_entity",
	"Place a token/object on the active map: NPCs, monsters (not yet in combat), items, chests, traps (hidden=true until found), features (altar, statue, campfire, well, barrels), lights (torches, braziers). Give x,y or a room id (placed near its center).",
	S.obj(
		{
			kind: S.str(undefined, ENTITY_KINDS),
			name: S.str(),
			sprite: S.str("Art hint: monster index/type (goblin, wolf, skeleton, dragon…), 'chest', 'altar', 'statue', 'campfire', 'torch', 'barrel', 'door', 'lever', 'bones', 'pc'"),
			x: S.int(),
			y: S.int(),
			room: S.str("Room id from the map summary"),
			size: S.int("Squares per side (large=2, huge=3)", 1, 4),
			hidden: S.bool(),
			disposition: S.str(undefined, ["friendly", "neutral", "hostile"]),
			npcId: S.str(),
			description: S.str(),
			lightRadius: S.int("Light radius in squares (lights)"),
		},
		["kind", "name"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (a.kind === "monster" || a.disposition === "hostile") assertNotFallen(state, a.name);
			const map = activeMap(state);
			let near: { x: number; y: number } | undefined;
			if (a.room) {
				const r = map.rooms.find((x) => x.id === a.room);
				if (!r) throw new Error(`Unknown room ${a.room}`);
				near = { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
			}
			const e = placeEntity(
				map,
				{
					id: newId("ent"),
					kind: a.kind,
					name: a.name,
					sprite: a.sprite ?? (a.kind === "light" ? "torch" : a.kind === "item" ? "chest" : a.name.toLowerCase()),
					...(a.x !== undefined && a.y !== undefined && !a.room ? { x: a.x, y: a.y } : {}),
					size: a.size,
					hidden: a.hidden,
					disposition: a.disposition ?? (a.kind === "monster" ? "hostile" : a.kind === "npc" ? "neutral" : undefined),
					npcId: a.npcId,
					description: a.description,
					lightRadius: a.lightRadius ?? (a.kind === "light" ? 4 : undefined),
				},
				near,
			);
			return `Placed ${e.name} [${e.id}] at ${e.x},${e.y}.`;
		}),
);

export const updateEntityTool = tool<{ id: string; x?: number; y?: number; hidden?: boolean; remove?: boolean; name?: string; disposition?: "friendly" | "neutral" | "hostile"; dead?: boolean }>(
	"update_entity",
	"Move (outside combat), reveal/hide, rename, mark dead (a corpse lying on the map) or remove a map entity.",
	S.obj({ id: S.str(), x: S.int(), y: S.int(), hidden: S.bool(), remove: S.bool(), name: S.str(), disposition: S.str(undefined, ["friendly", "neutral", "hostile"]), dead: S.bool("Creature is dead (shown as a corpse)") }, ["id"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const map = activeMap(state);
			const e = map.entities.find((x) => x.id === a.id);
			if (!e) throw new Error(`Unknown entity ${a.id}`);
			if (a.remove) {
				if (e.combatantId && state.encounter?.status === "active") throw new Error("Use remove_combatant for combatants.");
				map.entities = map.entities.filter((x) => x !== e);
				return `Removed ${e.name}.`;
			}
			if (a.hidden !== undefined) e.hidden = a.hidden;
			if (a.name) e.name = a.name;
			if (a.disposition) e.disposition = a.disposition;
			if (a.dead !== undefined) {
				if (a.dead && e.combatantId && state.encounter?.status === "active") throw new Error("In combat, creatures die through damage (apply_damage / the engine).");
				if (a.dead) e.dead = true;
				else delete e.dead;
			}
			if (a.x !== undefined && a.y !== undefined) {
				if (e.combatantId && state.encounter?.status === "active") throw new Error(e.kind === "pc" ? "In combat the player's token moves with move_player (on their turn)." : "Combatants move via monster_turn.");
				placeEntity(map, { ...e, x: a.x, y: a.y });
				if (e.kind === "pc") revealAround(map, e.x, e.y, SIGHT_RADIUS);
			}
			return `Updated ${e.name} at ${e.x},${e.y}${e.hidden ? " (hidden)" : ""}.`;
		}),
);

export const setTileTool = tool<{ x: number; y: number; tile: Tile; width?: number; height?: number }>(
	"set_tile",
	"Change terrain on the active map (open/unlock a door, reveal a secret door, collapse a passage, flood a room). Optional width/height to fill a rectangle.",
	S.obj({ x: S.int(), y: S.int(), tile: S.str(undefined, TILES), width: S.int(undefined, 1, 40), height: S.int(undefined, 1, 40) }, ["x", "y", "tile"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const map = activeMap(state);
			let n = 0;
			for (let y = a.y; y < a.y + (a.height ?? 1); y++)
				for (let x = a.x; x < a.x + (a.width ?? 1); x++) {
					if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
					// Overwriting a barricade drops its hit points (build them with build_barricade).
					if (map.barricades?.[`${x},${y}`]) delete map.barricades[`${x},${y}`];
					map.tiles[y * map.width + x] = a.tile;
					n++;
				}
			const pc = pcEntity(map, state);
			if (pc) revealAround(map, pc.x, pc.y, SIGHT_RADIUS);
			return `Set ${n} square(s) to ${a.tile}.`;
		}),
);

export const nameRoomTool = tool<{ roomId: string; name: string }>(
	"name_room",
	"Name a room/area on the active map (shown on hover).",
	S.obj({ roomId: S.str(), name: S.str() }, ["roomId", "name"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const r = activeMap(state).rooms.find((x) => x.id === a.roomId);
			if (!r) throw new Error(`Unknown room ${a.roomId}`);
			r.name = a.name;
			return `Room ${a.roomId} named ${a.name}.`;
		}),
);

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;
const TERRAINS = ["marsh", "forest", "hills", "mountains", "plains", "desert"] as const;

type RevealArgs = {
	name: string;
	kind: LocationKind;
	description?: string;
	nearLocationId?: string;
	travelDays?: number;
	routeKind?: "road" | "trail" | "river" | "sea";
	direction?: Compass;
	betweenLocationIds?: string[];
	terrain?: TerrainKind;
};

export const revealLocation = tool<RevealArgs>(
	"reveal_location",
	"Add (or reveal) a location on the world map, connected by a route to an existing location (default: the current one). The map must match your narration: ALWAYS give `direction` (compass bearing FROM nearLocationId) and `travelDays` when you've said or implied them, `betweenLocationIds` for places 'halfway between' two others, and `terrain` if it sits in a marsh/forest/hills… (that terrain is painted on the map around it).",
	S.obj(
		{
			name: S.str(),
			kind: S.str(undefined, LOCATION_KINDS),
			description: S.str(),
			nearLocationId: S.str("Location it is measured from (default: current location)"),
			travelDays: S.num("Travel time from nearLocationId (0.05 ≈ a few minutes' walk, 0.5 = half a day)"),
			routeKind: S.str(undefined, ["road", "trail", "river", "sea"]),
			direction: S.str("Compass direction from nearLocationId", COMPASS),
			betweenLocationIds: S.arr(S.str(), "Two location ids it lies halfway between"),
			terrain: S.str("Terrain it sits in (painted on the map)", TERRAINS),
		},
		["name", "kind"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			const w = state.world;
			const byId = (id?: string) => (id ? w.locations.find((l) => l.id === id || l.name.toLowerCase() === id.toLowerCase()) : undefined);
			const anchor = byId(a.nearLocationId ?? w.currentLocationId);
			const description = a.description;
			const direction = a.direction ?? directionFromText(description);
			const betweenLocs = (a.betweenLocationIds ?? []).map(byId).filter(Boolean) as WorldLocation[];
			const textBetween = betweenFromText(w, `${a.name}: ${description ?? ""}`);
			const between = betweenLocs.length === 2 ? ([betweenLocs[0], betweenLocs[1]] as [WorldLocation, WorldLocation]) : textBetween;
			const routeKind = a.routeKind ?? "trail";
			const spec: PlaceSpec = between ? { between, kind: a.kind } : { anchor, days: a.travelDays, routeKind, direction, kind: a.kind };
			const avoid = (self?: WorldLocation) => w.locations.filter((l) => l !== self);
			const notes: string[] = [];

			const existing = w.locations.find((l) => l.name.toLowerCase() === a.name.toLowerCase());
			let loc: WorldLocation;
			if (existing) {
				// A known-but-unvisited generated place may still be moved to match what was just said.
				if (!existing.discovered && !existing.visited && !fits(existing, spec, w)) {
					Object.assign(existing, placeFor(w, rng, spec, avoid(existing)));
					retimeRoutes(w, existing.id);
				} else if (existing.discovered && !fits(existing, spec, w)) {
					notes.push(`Note: ${existing.name} is already on the map ${anchor ? `${compassOf(anchor, existing)} of ${anchor.name}, ~${travelText(travelDaysIn(w, mapDistance(anchor, existing), routeKind))} away` : ""} — narrate consistently with that.`);
				}
				existing.discovered = true;
				if (description) existing.description = description;
				for (const r of w.routes) if (r.from === existing.id || r.to === existing.id) r.discovered = true;
				loc = existing;
			} else {
				// Re-skin an undiscovered generated location only if it already sits where the story puts it.
				const spare = w.locations.find((l) => !l.discovered && l.kind === a.kind && fits(l, { ...spec, days: spec.days ?? (between ? undefined : isTownWorld(w) ? 1 / 24 : 2) }, w));
				if (spare) {
					Object.assign(spare, { name: a.name, description, discovered: true });
					loc = spare;
				} else {
					const p = placeFor(w, rng, { ...spec, days: spec.days ?? (isTownWorld(w) ? 1 / 24 : 1) }, avoid());
					loc = { id: newId("loc"), name: a.name, kind: a.kind, x: p.x, y: p.y, discovered: true, visited: false, description, mapIds: [] };
					w.locations.push(loc);
				}
			}
			const terrain = a.terrain ?? terrainFor(a.kind, description);
			if (terrain) addTerrainFeature(w, { terrain, x: loc.x, y: loc.y, r: terrain === "mountains" ? 0.07 : 0.05 });
			const links = between ? between : anchor ? [anchor] : [];
			for (const from of links) {
				if (from.id === loc.id) continue;
				const route = w.routes.find((r) => (r.from === from.id && r.to === loc.id) || (r.to === from.id && r.from === loc.id));
				const days = !between && a.travelDays !== undefined ? a.travelDays : travelDaysIn(w, mapDistance(from, loc), routeKind);
				if (route) route.discovered = true;
				else w.routes.push({ id: newId("rt"), from: from.id, to: loc.id, kind: routeKind, travelDays: days, discovered: true });
			}
			const where = anchor && anchor.id !== loc.id ? ` — ${compassOf(anchor, loc)} of ${anchor.name}, ~${travelText(travelDaysIn(w, mapDistance(anchor, loc), routeKind))} by ${routeKind}` : "";
			return [`Location ${loc.name} [${loc.id}] is on the world map${where}.`, ...notes].join(" ");
		}),
);

export const markRegionTool = tool<{ terrain: TerrainKind; name?: string; nearLocationId?: string; direction?: Compass; travelDays?: number; size?: "small" | "medium" | "large" }>(
	"mark_region",
	"Paint a narrated region onto the world map (a marsh, forest, range of hills, mountains, plains, desert), optionally named (e.g. 'The Grey Fen'). Place it relative to a location with direction/travelDays (default: centered on the current location). Use it whenever you describe the land so the map shows it.",
	S.obj(
		{
			terrain: S.str(undefined, TERRAINS),
			name: S.str("Region name shown on the map"),
			nearLocationId: S.str(),
			direction: S.str(undefined, COMPASS),
			travelDays: S.num(),
			size: S.str(undefined, ["small", "medium", "large"]),
		},
		["terrain"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const w = state.world;
			const anchor = w.locations.find((l) => l.id === (a.nearLocationId ?? w.currentLocationId) || l.name.toLowerCase() === (a.nearLocationId ?? "").toLowerCase());
			if (!anchor) throw new Error("Unknown nearLocationId.");
			const r = REGION_SIZE[a.size ?? "medium"];
			let x = anchor.x, y = anchor.y;
			if (a.direction) {
				const d = a.travelDays !== undefined ? distanceInDays(w, a.travelDays) : r * 1.1;
				const ang = BEARING[a.direction];
				x = Math.min(0.97, Math.max(0.03, anchor.x + (Math.cos(ang) * d) / WORLD_ASPECT));
				y = Math.min(0.97, Math.max(0.03, anchor.y + Math.sin(ang) * d));
			}
			const f = addTerrainFeature(w, { terrain: a.terrain, x, y, r, ...(a.name ? { name: a.name } : {}) });
			return `Region ${f.name ?? a.terrain} painted ${a.direction ? `${a.direction} of` : "around"} ${anchor.name}.`;
		}),
);

export const travelTool = tool<{ locationId: string; days?: number; hours?: number; show?: boolean }>(
	"travel",
	"Move the party to a world location (advances the clock by the travel time; leaves the current tactical map). Pass hours for short trips (a walk to a nearby place = 1-4 hours); otherwise the time comes from the route or the map distance. Shows the world map unless show=false.",
	S.obj({ locationId: S.str(), days: S.num("Travel time in days (fractions allowed)"), hours: S.num("Travel time in hours; overrides days"), show: S.bool() }, ["locationId"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (state.encounter?.status === "active") throw new Error("Cannot travel during combat.");
			const w = state.world;
			const loc = w.locations.find((l) => l.id === a.locationId || l.name.toLowerCase() === a.locationId.toLowerCase());
			if (!loc) throw new Error(`Unknown location ${a.locationId}`);
			const route = w.routes.find((r) => (r.from === w.currentLocationId && r.to === loc.id) || (r.to === w.currentLocationId && r.from === loc.id));
			const here = w.locations.find((l) => l.id === w.currentLocationId);
			const hours = Math.max(0, a.hours ?? (a.days ?? route?.travelDays ?? (here ? travelDaysIn(w, mapDistance(here, loc)) : 1)) * 24);
			const days = Math.round((hours / 24) * 100) / 100;
			const totalHours = state.time.hour + Math.round(hours);
			state.time.day += Math.floor(totalHours / 24);
			state.time.hour = totalHours % 24;
			w.currentLocationId = loc.id;
			loc.discovered = true;
			loc.visited = true;
			if (route) route.discovered = true;
			// Returning to a place already drawn reopens its latest map, so the scene panel shows it.
			loc.mapIds = loc.mapIds.filter((id) => state.maps[id]);
			const known = loc.mapIds.length ? state.maps[loc.mapIds[loc.mapIds.length - 1]] : undefined;
			state.activeMapId = known?.id;
			if (known) ensurePc(known, state);
			state.mode = "explore";
			if (a.show !== false) state.view = "world";
			const others = loc.mapIds.filter((id) => id !== known?.id).map((id) => `${state.maps[id].name}[${id}]`);
			const mapNote = known
				? ` Reopened its map ${known.name} [${known.id}]${others.length ? `; other maps here: ${others.join(", ")} (use_map to switch)` : ""}. Draw a new map only for a part of the place not drawn yet.`
				: " No map of this place yet: draw_map it so the scene panel shows it.";
			return `Travelled to ${loc.name} in ${hours < 24 ? `${Math.round(hours)} hour(s)` : `${days} day(s)`}. Now day ${state.time.day}, ${String(state.time.hour).padStart(2, "0")}:00.${mapNote} Set the new scene with set_scene.`;
		}),
);

export const MAP_TOOLS: ToolFactory[] = [drawMapTool, generateMapTool, useMapTool, linkMapsTool, placeEntityTool, updateEntityTool, setTileTool, nameRoomTool, revealLocation, markRegionTool, travelTool];
