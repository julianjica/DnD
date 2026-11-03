import type { GridMap, MapEntity, MapKind, Tile } from "../game/types";

/**
 * DM-drawn maps: the DM lays a place out as rows of characters (one per 5 ft
 * square) and the result is an ordinary GridMap, used both as the sprite scene
 * and as the battle map.
 */

export type Climate = NonNullable<GridMap["climate"]>;

/** Fixed legend. Ground cells change look with the climate (grass → snow → sand). */
export const DRAW_LEGEND: Record<string, Tile> = {
	",": "grass",
	";": "tall_grass",
	".": "floor",
	"=": "wood_floor",
	"-": "road",
	":": "sand",
	"%": "mud",
	i: "ice",
	"~": "water",
	w: "deep_water",
	"#": "wall",
	X: "rock",
	"+": "door",
	"/": "door_open",
	L: "door_locked",
	S: "secret_door",
	T: "tree",
	O: "pillar",
	t: "table",
	B: "bar_counter",
	r: "rubble",
	p: "pit",
	"<": "stairs_up",
	">": "stairs_down",
	b: "bridge",
	l: "lava",
	" ": "void",
};

export const LEGEND_TEXT =
	"`,` ground (grass; snow when climate=snow; sand when desert) · `;` brush/tall grass · `.` stone floor · `=` wooden floor · `-` road/path · `:` sand/gravel · `%` mud · `i` ice · `~` shallow water · `w` deep water · `#` built wall · `X` natural rock/cliff/boulder · `+` closed door · `/` open door · `L` locked door · `S` secret door · `T` tree · `O` pillar · `t` table · `B` counter · `r` rubble · `p` pit · `<` `>` stairs up/down · `b` bridge · `l` lava · space = nothing (outside the map) · `@` the player";

/** Things a key character can stand for. */
export interface DrawKey {
	/** Sprite name: a feature ("runestone", "hearth", "barrel", "chest", "boat"…) or, for creatures, a token hint. */
	sprite?: string;
	name?: string;
	kind?: "feature" | "light" | "item" | "npc";
	npcId?: string;
	/** Light radius in squares (torches ~4, hearth ~6). */
	lightRadius?: number;
	description?: string;
}

/** Present-day feature sprites (The Quiet: GridMap.theme "modern"). */
export const MODERN_FEATURE_SPRITES = [
	"car", "car_wreck", "police_car", "ambulance", "pickup_truck", "bus", "shopping_cart", "store_shelf", "fridge", "vending_machine",
	"desk", "office_chair", "couch", "tv", "hospital_bed", "gurney", "gas_pump", "dumpster", "trash_bags", "chainlink_fence",
	"barricade", "sandbags", "street_lamp", "traffic_cone", "road_sign", "mailbox", "fire_hydrant", "generator", "radio", "body_bag",
	"blood_pool", "filing_cabinet", "washing_machine", "toilet", "bathtub", "phone_booth", "bench",
] as const;

/** Feature sprites the sprite renderer draws by name (anything else gets a generic marker). */
export const FEATURE_SPRITES = [
	"hearth", "campfire", "brazier", "torch", "lantern", "candles", "runestone", "standing_stone", "statue", "altar", "throne",
	"barrel", "crate", "chest", "bed", "shelf", "well", "boat", "stalagmite", "bones", "footprints", "tent", "cart", "sign",
	"coffin", "sarcophagus", "banner", "anvil", "cauldron", "log", "mushrooms", "crystals", "fountain", "grave",
	...MODERN_FEATURE_SPRITES,
] as const;

export interface DrawInput {
	rows: string[];
	key?: Record<string, DrawKey>;
	kind: MapKind;
	name: string;
	climate?: Climate;
	lighting?: GridMap["lighting"];
	seed: number;
}

export interface DrawResult {
	map: GridMap;
	/** Entities to add (ids assigned by the caller). The PC is not included; `pc` is its square. */
	entities: Omit<MapEntity, "id">[];
	pc?: { x: number; y: number };
	warnings: string[];
}

const GROUNDISH = new Set<Tile>(["grass", "tall_grass", "floor", "wood_floor", "road", "sand", "mud", "ice", "water"]);

export function drawMap(input: DrawInput): DrawResult {
	const rows = input.rows.map((r) => r.replace(/\t/g, " ").replace(/\s+$/, ""));
	while (rows.length && !rows[rows.length - 1]) rows.pop();
	if (rows.length < 6) throw new Error("Draw at least 6 rows.");
	if (rows.length > 60) throw new Error("At most 60 rows.");
	const width = Math.max(...rows.map((r) => [...r].length));
	if (width < 8) throw new Error("Rows must be at least 8 squares wide.");
	if (width > 80) throw new Error("At most 80 squares wide.");
	const key = input.key ?? {};
	for (const k of Object.keys(key)) {
		if ([...k].length !== 1) throw new Error(`Key "${k}" must be a single character.`);
		if (k in DRAW_LEGEND || k === "@") throw new Error(`Key "${k}" clashes with the legend; pick another character (letters/digits not in the legend).`);
	}
	const height = rows.length;
	const grid = rows.map((r) => [...r.padEnd(width, " ")]);
	const tiles: Tile[] = new Array(width * height);
	const marks: { x: number; y: number; ch: string }[] = [];
	const unknown = new Set<string>();
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const ch = grid[y][x];
			const t = DRAW_LEGEND[ch];
			if (t) tiles[y * width + x] = t;
			else {
				tiles[y * width + x] = "void"; // filled below from neighbours
				if (ch === "@" || key[ch]) marks.push({ x, y, ch });
				else unknown.add(ch);
			}
		}
	if (unknown.size) throw new Error(`Unknown characters ${[...unknown].map((c) => `"${c}"`).join(", ")}: use the legend or define them in key.`);
	// Marked squares take the ground of the row or column they sit in (a lamp on a
	// sidewalk stays sidewalk next to a wide road), else the most common ground around.
	const groundAt = (x: number, y: number): Tile | undefined => {
		if (x < 0 || y < 0 || x >= width || y >= height || !DRAW_LEGEND[grid[y][x]]) return undefined;
		const t = tiles[y * width + x];
		return GROUNDISH.has(t) ? t : undefined;
	};
	for (const m of marks) {
		const l = groundAt(m.x - 1, m.y), r = groundAt(m.x + 1, m.y), u = groundAt(m.x, m.y - 1), d = groundAt(m.x, m.y + 1);
		if (l && l === r) { tiles[m.y * width + m.x] = l; continue; }
		if (u && u === d) { tiles[m.y * width + m.x] = u; continue; }
		const count = new Map<Tile, number>();
		for (let r = 1; r <= 3 && !count.size; r++)
			for (let dy = -r; dy <= r; dy++)
				for (let dx = -r; dx <= r; dx++) {
					const x = m.x + dx, y = m.y + dy;
					if (x < 0 || y < 0 || x >= width || y >= height) continue;
					const t = tiles[y * width + x];
					if (GROUNDISH.has(t) && DRAW_LEGEND[grid[y][x]]) count.set(t, (count.get(t) ?? 0) + 1);
				}
		tiles[m.y * width + m.x] = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "floor";
	}
	const pcs = marks.filter((m) => m.ch === "@");
	const warnings: string[] = [];
	if (pcs.length > 1) warnings.push("More than one @; the first one is the player.");
	const entities: Omit<MapEntity, "id">[] = [];
	for (const m of marks) {
		if (m.ch === "@") continue;
		const k = key[m.ch];
		const kind = k.kind ?? (k.npcId ? "npc" : k.lightRadius ? "light" : "feature");
		entities.push({
			kind,
			name: k.name ?? k.sprite ?? "feature",
			sprite: k.sprite ?? (kind === "npc" ? "npc" : "feature"),
			x: m.x,
			y: m.y,
			size: 1,
			...(k.npcId ? { npcId: k.npcId, disposition: "friendly" as const } : {}),
			...(k.lightRadius ? { lightRadius: k.lightRadius } : {}),
			...(k.description ? { description: k.description } : {}),
		});
	}
	const pc = pcs[0] ? { x: pcs[0].x, y: pcs[0].y } : undefined;
	const firstOpen = tiles.findIndex((t) => GROUNDISH.has(t));
	const entry = pc ?? (firstOpen >= 0 ? { x: firstOpen % width, y: Math.floor(firstOpen / width) } : { x: 0, y: 0 });
	const map: GridMap = {
		id: "",
		name: input.name,
		kind: input.kind,
		seed: input.seed,
		width,
		height,
		tiles,
		explored: new Array(width * height).fill(true),
		rooms: [],
		entities: [],
		lighting: input.lighting ?? "bright",
		entry,
		drawn: true,
		...(input.climate && input.climate !== "temperate" ? { climate: input.climate } : {}),
	};
	return { map, entities, pc, warnings };
}

/** Default climate from the campaign's world preset. */
export function climateForPreset(preset: string): Climate {
	return preset === "arctic" ? "snow" : preset === "desert_kingdoms" ? "desert" : "temperate";
}
