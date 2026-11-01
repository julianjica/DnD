import type { EntityKind, GameState, GridMap, LocationKind, MapKind, Tile } from "../../game/types";
import { generateMap, landNear, MAP_KINDS, placeEntity, revealAround } from "../../maps";
import { S, newId, tool, withState, type ToolFactory } from "../context";

const LOCATION_KINDS: LocationKind[] = ["town", "city", "village", "dungeon", "cave", "forest", "mountain", "ruins", "castle", "temple", "swamp", "coast", "camp", "tower", "landmark"];
const ENTITY_KINDS: EntityKind[] = ["monster", "npc", "item", "trap", "feature", "light"];
const TILES: Tile[] = ["floor", "wall", "door", "door_open", "door_locked", "secret_door", "water", "deep_water", "difficult", "pit", "stairs_up", "stairs_down", "grass", "tall_grass", "tree", "rock", "road", "sand", "mud", "lava", "bridge", "wood_floor", "rubble", "pillar", "table"];

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

function mapSummary(map: GridMap): string {
	const rooms = map.rooms.map((r) => `${r.id}${r.tag ? `(${r.tag})` : ""} x${r.x}-${r.x + r.w - 1} y${r.y}-${r.y + r.h - 1}${r.name ? ` "${r.name}"` : ""}`);
	return `Map ${map.name} [${map.id}] ${map.kind} ${map.width}x${map.height}, lighting ${map.lighting}, entry ${map.entry.x},${map.entry.y}.\nRooms/areas: ${rooms.join("; ") || "none"}.\nEntities: ${map.entities.map((e) => `${e.name}[${e.id}] ${e.kind}@${e.x},${e.y}`).join("; ")}`;
}

function activeMap(state: GameState): GridMap {
	const m = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	if (!m) throw new Error("No active map. Call generate_map first.");
	return m;
}

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
			ensurePc(map, state);
			state.maps[map.id] = map;
			state.activeMapId = map.id;
			const loc = state.world.locations.find((l) => l.id === state.world.currentLocationId);
			if (loc) loc.mapIds.push(map.id);
			// Keep only the 12 most recent maps to bound state size.
			const ids = Object.keys(state.maps);
			if (ids.length > 12) for (const old of ids.slice(0, ids.length - 12)) if (old !== map.id) delete state.maps[old];
			if (a.show !== false) state.view = "map";
			return mapSummary(map);
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
			return mapSummary(map);
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

export const updateEntityTool = tool<{ id: string; x?: number; y?: number; hidden?: boolean; remove?: boolean; name?: string; disposition?: "friendly" | "neutral" | "hostile" }>(
	"update_entity",
	"Move (outside combat), reveal/hide, rename or remove a map entity.",
	S.obj({ id: S.str(), x: S.int(), y: S.int(), hidden: S.bool(), remove: S.bool(), name: S.str(), disposition: S.str(undefined, ["friendly", "neutral", "hostile"]) }, ["id"]),
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
			if (a.x !== undefined && a.y !== undefined) {
				if (e.combatantId && state.encounter?.status === "active") throw new Error("Combatants move via monster_turn.");
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

export const revealLocation = tool<{ name: string; kind: LocationKind; description?: string; nearLocationId?: string; travelDays?: number; routeKind?: "road" | "trail" | "river" | "sea" }>(
	"reveal_location",
	"Add (or reveal) a location on the world map, connected by a route to an existing location (default: the current one).",
	S.obj(
		{
			name: S.str(),
			kind: S.str(undefined, LOCATION_KINDS),
			description: S.str(),
			nearLocationId: S.str(),
			travelDays: S.num(),
			routeKind: S.str(undefined, ["road", "trail", "river", "sea"]),
		},
		["name", "kind"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			const w = state.world;
			const existing = w.locations.find((l) => l.name.toLowerCase() === a.name.toLowerCase());
			if (existing) {
				existing.discovered = true;
				if (a.description) existing.description = a.description;
				for (const r of w.routes) if (r.from === existing.id || r.to === existing.id) r.discovered = true;
				return `Revealed ${existing.name} [${existing.id}].`;
			}
			// Prefer re-skinning an undiscovered generated location of the same kind.
			const spare = w.locations.find((l) => !l.discovered && l.kind === a.kind);
			const anchor = w.locations.find((l) => l.id === (a.nearLocationId ?? w.currentLocationId));
			let loc;
			if (spare) {
				spare.name = a.name;
				spare.description = a.description;
				spare.discovered = true;
				loc = spare;
			} else {
				// Terrain-aware: always on land, near the anchor, suited to the kind.
				const days = Math.max(0.25, Math.min(10, a.travelDays ?? 1));
				const p = landNear(w, anchor ?? { x: 0.5, y: 0.5 }, rng, {
					kind: a.kind,
					minDist: Math.min(0.3, 0.025 + days * 0.03),
					maxDist: Math.min(0.45, 0.06 + days * 0.05),
					avoid: w.locations,
				});
				loc = {
					id: newId("loc"),
					name: a.name,
					kind: a.kind,
					x: p.x,
					y: p.y,
					discovered: true,
					visited: false,
					description: a.description,
					mapIds: [],
				};
				w.locations.push(loc);
			}
			if (anchor && anchor.id !== loc.id) {
				const route = w.routes.find((r) => (r.from === anchor.id && r.to === loc.id) || (r.to === anchor.id && r.from === loc.id));
				if (route) route.discovered = true;
				else w.routes.push({ id: newId("rt"), from: anchor.id, to: loc.id, kind: a.routeKind ?? "trail", travelDays: a.travelDays ?? 1, discovered: true });
			}
			return `Location ${loc.name} [${loc.id}] is on the world map.`;
		}),
);

export const travelTool = tool<{ locationId: string; days?: number; show?: boolean }>(
	"travel",
	"Move the party to a world location (advances time by travel days; leaves the current tactical map). Shows the world map unless show=false.",
	S.obj({ locationId: S.str(), days: S.num(), show: S.bool() }, ["locationId"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (state.encounter?.status === "active") throw new Error("Cannot travel during combat.");
			const w = state.world;
			const loc = w.locations.find((l) => l.id === a.locationId || l.name.toLowerCase() === a.locationId.toLowerCase());
			if (!loc) throw new Error(`Unknown location ${a.locationId}`);
			const route = w.routes.find((r) => (r.from === w.currentLocationId && r.to === loc.id) || (r.to === w.currentLocationId && r.from === loc.id));
			const days = a.days ?? route?.travelDays ?? 1;
			const totalHours = state.time.hour + Math.round(days * 24);
			state.time.day += Math.floor(totalHours / 24);
			state.time.hour = totalHours % 24;
			w.currentLocationId = loc.id;
			loc.discovered = true;
			loc.visited = true;
			if (route) route.discovered = true;
			state.activeMapId = undefined;
			state.mode = "explore";
			if (a.show !== false) state.view = "world";
			return `Travelled to ${loc.name} in ${days} day(s). Now day ${state.time.day}. Set the new scene with set_scene.`;
		}),
);

export const MAP_TOOLS: ToolFactory[] = [generateMapTool, useMapTool, placeEntityTool, updateEntityTool, setTileTool, nameRoomTool, revealLocation, travelTool];
