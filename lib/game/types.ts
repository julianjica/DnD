/**
 * Shared contracts for DungeonHarness. Every module (rules, maps, engines,
 * DM tools, UI) builds against these types. Change them deliberately.
 *
 * All game state is plain JSON (serializable, no classes, no Dates).
 * The server owns the state; the AI changes it only through DM tools.
 */

// ─── Basics ────────────────────────────────────────────────────────────────

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
export type Abilities = Record<Ability, number>;

export type Size = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";

export type DamageType =
	| "acid" | "bludgeoning" | "cold" | "fire" | "force" | "lightning" | "necrotic"
	| "piercing" | "poison" | "psychic" | "radiant" | "slashing" | "thunder";

export type ConditionId =
	| "blinded" | "charmed" | "deafened" | "frightened" | "grappled" | "incapacitated"
	| "invisible" | "paralyzed" | "petrified" | "poisoned" | "prone" | "restrained"
	| "stunned" | "unconscious";

export interface ActiveCondition {
	id: ConditionId;
	/** Who/what caused it (combatant id, spell index, free text). */
	source?: string;
	/** Rounds remaining; undefined = until removed. */
	rounds?: number;
	/** e.g. "DC 13 WIS save at end of each turn". */
	note?: string;
}

/** A logged dice roll. Every roll the engine makes is recorded and shown. */
export interface RollRecord {
	id: string;
	/** Dice notation actually rolled, e.g. "1d20+5", "8d6". */
	notation: string;
	/** Individual die results (kept and dropped). */
	dice: { sides: number; value: number; dropped?: boolean }[];
	modifier: number;
	total: number;
	/** Human label: "Thorin attacks Goblin 1", "DEX save vs Fireball". */
	label: string;
	advantage?: "advantage" | "disadvantage";
	/** Outcome vs a target (AC/DC), if any. */
	target?: number;
	success?: boolean;
	critical?: "hit" | "miss";
	/** Who rolled (character/combatant id or "dm"). */
	actor?: string;
	/** What was tested, for checks and saves (shown as "Perception · WIS"). */
	check?: RollCheck;
	ts: number;
}

export interface RollCheck {
	kind: "check" | "save";
	ability: Ability;
	/** Skill index ("perception") or tool name, when a skill/tool applied. */
	skill?: string;
	/** Where the modifier comes from (ability score, proficiency, exhaustion…). */
	parts: { k: "ability" | "prof" | "expertise" | "half" | "exhaustion" | "bonus"; value: number }[];
}

// ─── SRD data shapes (produced by lib/srd, consumed by rules/combat) ───────

export interface SrdRef {
	/** Stable kebab-case key from the SRD dataset, e.g. "fireball", "goblin". */
	index: string;
	name: string;
}

export interface AttackAction {
	name: string;
	kind: "melee" | "ranged" | "melee_or_ranged";
	toHit: number;
	reach?: number; // feet
	range?: { normal: number; long?: number }; // feet
	damage: { dice: string; type: DamageType }[];
	/** Optional rider, e.g. save DC + effect text. */
	save?: { ability: Ability; dc: number; onFail?: string; halfOnSuccess?: boolean };
	description: string;
}

export interface MonsterAction {
	name: string;
	description: string;
	attack?: AttackAction;
	/** Area/save actions such as breath weapons. */
	save?: { ability: Ability; dc: number; damage?: { dice: string; type: DamageType }[]; halfOnSuccess?: boolean };
	usage?: { type: "per_day" | "recharge" | "at_will"; times?: number; minRoll?: number };
	multiattack?: { action: string; count: number }[];
}

export interface MonsterStats extends SrdRef {
	/** Content set ("zombie" = The Quiet); absent = SRD fantasy. */
	ruleset?: "fantasy" | "zombie";
	/** The Quiet: first day after the outbreak on which this variant exists. */
	appearsDay?: number;
	size: Size;
	type: string; // "humanoid (goblinoid)"
	alignment: string;
	ac: number;
	hp: number;
	hitDice: string; // "2d6"
	speed: { walk?: number; fly?: number; swim?: number; climb?: number; burrow?: number; hover?: boolean };
	abilities: Abilities;
	saves: Partial<Record<Ability, number>>;
	skills: Record<string, number>;
	vulnerabilities: DamageType[];
	resistances: DamageType[];
	immunities: DamageType[];
	conditionImmunities: ConditionId[];
	senses: string;
	languages: string;
	cr: number; // 0.125, 0.25, 0.5, 1..30
	xp: number;
	traits: { name: string; description: string }[];
	actions: MonsterAction[];
	bonusActions: MonsterAction[];
	reactions: { name: string; description: string }[];
	legendaryActions: MonsterAction[];
	/** Art hint for token generation: "goblin", "wolf", "dragon", "undead"… */
	tokenHint: string;
}

export interface SpellInfo extends SrdRef {
	/** Content set this belongs to ("zombie" = a technique of The Quiet); absent = SRD fantasy. */
	ruleset?: "fantasy" | "zombie";
	/** Items used up from the caster's inventory on every use (techniques with components), by equipment index. */
	consumes?: { ref: string; qty: number }[];
	/** The Quiet: the technique is loud and raises the noise level (a number = how much, true = like a gunshot, +3). */
	loud?: number | true;
	level: number; // 0 = cantrip
	school: string;
	castingTime: string; // "1 action", "1 bonus action", "1 reaction", "1 minute"
	range: string; // "120 feet", "Self (15-foot cone)", "Touch"
	rangeFeet?: number;
	components: string[];
	material?: string;
	duration: string;
	concentration: boolean;
	ritual: boolean;
	description: string;
	higherLevel?: string;
	classes: string[];
	/** Structured mechanics when derivable (else the DM adjudicates from text). */
	attack?: "melee" | "ranged";
	save?: { ability: Ability; halfOnSuccess: boolean };
	damage?: { type: DamageType; byCharacterLevel?: Record<number, string>; bySlotLevel?: Record<number, string> };
	heal?: { bySlotLevel: Record<number, string>; addModifier: boolean };
	area?: { shape: "sphere" | "cone" | "line" | "cube" | "cylinder"; size: number };
}

// ─── Character ─────────────────────────────────────────────────────────────

export interface ClassLevel {
	classId: string; // "fighter"
	subclassId?: string; // "champion"
	level: number;
}

export interface InventoryItem {
	id: string;
	/** SRD equipment/magic-item index if known, else undefined (homebrew). */
	ref?: string;
	name: string;
	quantity: number;
	weight?: number;
	description?: string;
	equipped?: boolean;
	attuned?: boolean;
	/** "weapon" | "armor" | "shield" | "gear" | "potion" | "scroll" | "magic" | "treasure" … */
	category: string;
	/** For weapons: damage dice/type/properties; for armor: base AC etc. */
	weapon?: { damage: string; damageType: DamageType; properties: string[]; range?: { normal: number; long?: number }; versatile?: string; magicBonus?: number };
	armor?: { baseAc: number; dexCap?: number; type: "light" | "medium" | "heavy" | "shield"; stealthDisadvantage?: boolean; strMin?: number; magicBonus?: number };
}

export interface Feature {
	id: string;
	name: string;
	/** "class:fighter", "species:elf", "background:acolyte", "feat:grappler". */
	source: string;
	description: string;
	uses?: { max: number; used: number; recharge: "short" | "long" | "dawn" };
}

export interface SpellcastingState {
	/** One entry per spellcasting class. */
	classes: { classId: string; ability: Ability; known: string[]; prepared: string[]; cantrips: string[] }[];
	/** Max slots per level, index 0 = 1st level … 8 = 9th. */
	slots: number[];
	slotsUsed: number[];
	pact?: { level: number; max: number; used: number };
}

export interface PortraitSpec {
	/** Layered procedural portrait parameters (see components/art). */
	seed: number;
	skinTone: string;
	hairStyle: string;
	hairColor: string;
	eyeColor: string;
	facialHair?: string;
	accessory?: string;
	/** Species-driven features: "pointed_ears", "horns", "tusks", "scales" … */
	features: string[];
	background: string; // color/pattern key
	/** Explicit look; when absent these are derived from the seed (older saves). */
	gender?: "female" | "male";
	/** 0 young … 1 old. */
	age?: number;
	clothingStyle?: "tunic" | "armor" | "robe" | "leather" | "cloak";
	/** Clothing color (hex). */
	clothing?: string;
	/** The Quiet: chosen modern outfit ("hoodie", "scrubs", "police"…). Absent = everyday clothes for the player, role-based for NPCs. */
	outfit?: string;
}

export interface Character {
	/** Content set the character was made in ("zombie" = The Quiet); absent = from the species (fantasy for SRD species). */
	ruleset?: "fantasy" | "zombie";
	id: string;
	name: string;
	speciesId: string; // "elf"
	subspeciesId?: string; // "high-elf"
	backgroundId: string;
	alignment?: string;
	classes: ClassLevel[];
	xp: number;
	abilities: Abilities; // final scores incl. bonuses
	maxHp: number;
	hp: number;
	tempHp: number;
	hitDice: { die: number; total: number; used: number }[];
	speed: number;
	size: Size;
	/** Proficiencies (SRD indices or plain names). */
	savingThrows: Ability[];
	skills: string[]; // "perception"
	expertise: string[];
	languages: string[];
	tools: string[];
	armorProf: string[];
	weaponProf: string[];
	inventory: InventoryItem[];
	currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
	features: Feature[];
	spellcasting?: SpellcastingState;
	conditions: ActiveCondition[];
	exhaustion: number;
	deathSaves: { successes: number; failures: number };
	concentration?: { spell: string; startedRound?: number; /** Game minute it started (day*1440 + hour*60 + minute), for expiry outside combat. */ since?: number };
	inspiration: boolean;
	portrait: PortraitSpec;
	personality?: { traits?: string; ideals?: string; bonds?: string; flaws?: string; backstory?: string; appearance?: string };
}

// ─── Maps ──────────────────────────────────────────────────────────────────

/** One grid square = 5 ft. */
export type Tile =
	| "void" | "floor" | "wall" | "door" | "door_open" | "door_locked" | "secret_door"
	| "water" | "deep_water" | "difficult" | "pit" | "stairs_up" | "stairs_down"
	| "grass" | "tall_grass" | "tree" | "rock" | "road" | "sand" | "mud" | "lava"
	| "bridge" | "building" | "wood_floor" | "rubble" | "pillar" | "table" | "bar_counter" | "ice" | "barricade";

export type MapKind = "dungeon" | "cave" | "forest" | "town" | "tavern" | "road" | "camp" | "crypt" | "castle" | "swamp" | "mountain_pass" | "temple" | "ship" | "arena";

export type EntityKind = "pc" | "monster" | "npc" | "item" | "trap" | "feature" | "light";

export interface MapEntity {
	id: string;
	kind: EntityKind;
	name: string;
	x: number;
	y: number;
	/** Squares per side (medium = 1, large = 2, huge = 3, gargantuan = 4). */
	size: number;
	/** Token art hint (monster tokenHint, "chest", "campfire", "altar"…). */
	sprite: string;
	/** Hidden from the player (unseen trap, invisible creature). */
	hidden?: boolean;
	/** Linked combatant id when in an encounter. */
	combatantId?: string;
	/** NPC id when kind = npc. */
	npcId?: string;
	/** Disposition for coloring tokens. */
	disposition?: "friendly" | "neutral" | "hostile";
	/** Light radius in squares for lights/torches. */
	lightRadius?: number;
	description?: string;
	/** A corpse: drawn lying down, never blocks movement. */
	dead?: boolean;
}

export interface MapRoom {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Generator tag ("entrance", "throne", "storage", "boss", "bar"…). */
	tag?: string;
	/** DM-given name/description once placed. */
	name?: string;
}

export interface GridMap {
	id: string;
	name: string;
	kind: MapKind;
	seed: number;
	width: number;
	height: number;
	/** Row-major, length = width * height. */
	tiles: Tile[];
	/** Row-major fog of war: true = the player has seen this square. */
	explored: boolean[];
	rooms: MapRoom[];
	entities: MapEntity[];
	/** Ambient light: "bright" | "dim" | "dark" (dark needs light sources/darkvision). */
	lighting: "bright" | "dim" | "dark";
	/** Square where the party enters. */
	entry: { x: number; y: number };
	/** Ground look: snow turns grass to snow, desert turns it to sand. Missing = temperate. */
	climate?: "temperate" | "snow" | "desert";
	/** Laid out by the DM with draw_map (not procedurally generated). */
	drawn?: boolean;
	/** Art theme: "modern" repaints the same tiles as a present-day town (asphalt, brick, linoleum). Missing = fantasy. */
	theme?: "modern";
	/** The Quiet: hit points of each barricade square, keyed "x,y". At 0 the square becomes rubble. */
	barricades?: Record<string, { hp: number; max: number }>;
	/** Squares (doors, stairs) that lead to another map of the same place. */
	links?: MapLink[];
}

/** Walking onto (x,y) out of combat takes the party to (toX,toY) on map toMapId. */
export interface MapLink {
	x: number;
	y: number;
	toMapId: string;
	toX: number;
	toY: number;
}

export type LocationKind = "town" | "city" | "village" | "dungeon" | "cave" | "forest" | "mountain" | "ruins" | "castle" | "temple" | "swamp" | "coast" | "camp" | "tower" | "landmark";

export interface WorldLocation {
	id: string;
	name: string;
	kind: LocationKind;
	/** Normalized position on the world map, 0..1. */
	x: number;
	y: number;
	discovered: boolean;
	visited: boolean;
	description?: string;
	/** Grid map ids generated for this location. */
	mapIds: string[];
	/** draw_map showed this many existing maps of the place (the next draw goes through). */
	drawShown?: number;
}

export type TerrainKind = "marsh" | "forest" | "hills" | "mountains" | "plains" | "desert";
export interface TerrainFeature {
	id: string;
	terrain: TerrainKind;
	/** Center (normalized map coords) and radius (map-height units). */
	x: number;
	y: number;
	r: number;
	/** Optional region name drawn on the map ("The Grey Fen"). */
	name?: string;
}
export interface WorldMap {
	seed: number;
	name: string;
	/** Procedural terrain parameters for the overworld renderer. */
	terrain: {
		seaLevel: number;
		biome: "temperate" | "arid" | "frozen" | "tropical" | "volcanic" | "mixed";
		/** "town": a modern town map (The Quiet) drawn as streets, river and districts instead of a fantasy overworld. */
		style?: "town";
		/** Narrated terrain painted onto the procedural map (marshes, forests, hills…). */
		features?: TerrainFeature[];
	};
	/** Set once older saves have had their geography reconciled with the narration. */
	reconciled?: number;
	locations: WorldLocation[];
	routes: { id: string; from: string; to: string; kind: "road" | "trail" | "river" | "sea"; travelDays: number; discovered: boolean }[];
	currentLocationId?: string;
}

// ─── Scene presentation ───────────────────────────────────────────────────

export type SceneKind = "tavern" | "town" | "forest" | "dungeon" | "cave" | "mountain" | "coast" | "swamp" | "desert" | "castle" | "temple" | "camp" | "road" | "crypt" | "plains" | "ship" | "underdark";
export type Mood = "calm" | "mysterious" | "tense" | "combat" | "triumphant" | "somber" | "festive" | "eerie";
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export type Weather = "clear" | "cloudy" | "rain" | "storm" | "fog" | "snow";

export interface SceneState {
	title: string;
	kind: SceneKind;
	timeOfDay: TimeOfDay;
	weather: Weather;
	mood: Mood;
	/** Short evocative caption shown under the art. */
	caption?: string;
	/** NPC ids present (their portraits appear in the scene). */
	npcIds: string[];
	/** Optional props to draw: "campfire", "altar", "statue", "cart", "ship"… */
	props: string[];
}

export type AmbienceTrack =
	| "none" | "tavern" | "town" | "forest" | "dungeon" | "cave" | "combat" | "boss" | "rain" | "storm" | "night" | "temple" | "sea" | "tension" | "victory"
	// The Quiet (zombie ruleset) only; fantasy campaigns never see these.
	| "q_quiet_town" | "q_outbreak" | "q_night" | "q_hospital" | "q_safehouse" | "q_dread" | "q_horde" | "q_chase" | "q_combat" | "q_radio" | "q_grief";

// ─── NPCs, quests, journal ────────────────────────────────────────────────

export interface Npc {
	id: string;
	name: string;
	/** Short role: "innkeeper", "cult leader". */
	role: string;
	speciesId?: string;
	disposition: "friendly" | "neutral" | "hostile" | "unknown";
	description: string;
	/** DM-only notes (secrets, motives). Never shown to the player. */
	secret?: string;
	locationId?: string;
	alive: boolean;
	portrait: PortraitSpec;
	/** Monster stat block used if they fight. */
	statBlock?: string;
	firstMetDay?: number;
}

export interface Quest {
	id: string;
	title: string;
	summary: string;
	status: "active" | "completed" | "failed" | "abandoned";
	objectives: { id: string; text: string; done: boolean }[];
	giverNpcId?: string;
	reward?: string;
}

export interface JournalEntry {
	id: string;
	day: number;
	text: string;
	/** "story" (DM-written recap) | "player" (player's own note) | "event" */
	kind: "story" | "player" | "event";
	ts: number;
}

// ─── Combat ────────────────────────────────────────────────────────────────

export interface TurnBudget {
	movementLeft: number; // feet
	action: boolean; // available?
	bonusAction: boolean;
	reaction: boolean;
	/** Extra attacks remaining in the current Attack action. */
	attacksLeft: number;
	dashed?: boolean;
	disengaged?: boolean;
	dodging?: boolean;
}

export interface Combatant {
	id: string;
	kind: "pc" | "monster" | "npc";
	name: string;
	/** PC: character id. Monster: SRD monster index. NPC: npc id. */
	refId: string;
	/** Snapshot of the stat block for monsters / statted NPCs. */
	stats?: MonsterStats;
	initiative: number;
	hp: number;
	maxHp: number;
	tempHp: number;
	ac: number;
	speed: number;
	side: "party" | "enemy" | "neutral";
	conditions: ActiveCondition[];
	turn: TurnBudget;
	/** Map entity representing this combatant. */
	entityId: string;
	dead: boolean;
	concentration?: string;
	/** Recharge/limited-use tracking for monster actions, keyed by action name. */
	usage: Record<string, { used: number; charged?: boolean }>;
	legendaryActionsLeft?: number;
	deathSaves?: { successes: number; failures: number };
}

export interface Encounter {
	id: string;
	mapId: string;
	round: number;
	/** Index into `order` of the combatant whose turn it is. */
	turnIndex: number;
	/** Combatant ids sorted by initiative (desc). */
	order: string[];
	combatants: Record<string, Combatant>;
	status: "active" | "victory" | "defeat" | "fled" | "ended";
	xpPool: number;
}

/** Player combat actions issued from the UI and resolved by the engine. */
export type PlayerCombatAction =
	| { type: "move"; path: { x: number; y: number }[] }
	| { type: "attack"; targetId: string; itemId?: string; /** unarmed if no item */ offHand?: boolean }
	| { type: "cast"; spell: string; slotLevel: number; targetIds?: string[]; point?: { x: number; y: number } }
	| { type: "dash" } | { type: "disengage" } | { type: "dodge" } | { type: "help"; targetId: string } | { type: "hide" }
	| { type: "use_item"; itemId: string; targetId?: string }
	| { type: "use_feature"; featureId: string; targetId?: string }
	| { type: "end_turn" }
	| { type: "death_save" }
	/** Get up from prone: costs half your speed. */
	| { type: "stand_up" };

// ─── Settings / engines ────────────────────────────────────────────────────

export type EngineProvider = "claude-code" | "codex" | "api";
export type Effort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

export interface EngineConfig {
	provider: EngineProvider;
	/** Model id: "claude-opus-5-5", "gpt-5.6-codex", or a pi-ai model id for api. */
	model: string;
	/** pi-ai provider id when provider = "api" ("anthropic", "openai", "openrouter"…). */
	apiProvider?: string;
	effort: Effort;
}

export interface CampaignSettings {
	world: {
		preset: "classic_high_fantasy" | "grimdark" | "gothic_horror" | "sword_and_sorcery" | "pirates" | "arctic" | "desert_kingdoms" | "fey_wilds" | "zombie_outbreak" | "custom";
		customText?: string;
		tone: string[]; // ["heroic", "humorous", "dark", "mysterious", "political", "whimsical"]
		lines: string[]; // hard limits
		veils: string[]; // fade to black
	};
	structure: {
		format: "one_shot" | "short_campaign" | "long_campaign";
		startingLevel: number;
		difficulty: "story" | "easy" | "normal" | "hard" | "deadly";
		hook?: string;
		leveling: "xp" | "milestone";
	};
	dm: {
		verbosity: "minimal" | "terse" | "balanced" | "rich";
		rulesStrictness: "loose" | "standard" | "strict";
		combatFrequency: "low" | "medium" | "high";
		persona?: string;
		/** Roll for the player automatically or let them click dice. */
		autoRollPlayer: boolean;
	};
	engine: EngineConfig;
	audio: { enabled: boolean; musicVolume: number; sfxVolume: number };
	/** Scene art: pixel sprites of the DM-drawn place, public-domain paintings, or procedural illustrations. */
	art?: { scenes: "sprites" | "paintings" | "illustrated" };
	/** Narration language (UI language is per-browser). Missing = English. */
	language?: "en" | "es";
}

// ─── Campaign state ────────────────────────────────────────────────────────

export type GameMode = "explore" | "combat" | "travel" | "rest" | "dialogue";

// ─── The Quiet: survival (docs/zombie.md §5) ──────────────────────────────

export type BodyPart = "left arm" | "right arm" | "left leg" | "right leg" | "torso" | "neck";

/** Survival state of a zombie-ruleset campaign. Times are game minutes: day*1440 + hour*60 + minute. */
export interface SurvivalState {
	/** Game minute of the last survival tick (noise decay, infection, hunger/thirst). */
	lastTick: number;
	/** Noise where the party is, 0..10; decays 1 per 10 quiet minutes; resets when the party moves to another place. */
	noise: { level: number; locationId?: string; mapId?: string; lastEvent?: string };
	/** The LAZARUS infection from a bite. `turnsAt` is secret: never show it to the player. */
	infection?: {
		bittenAt: number;
		turnsAt: number;
		part: BodyPart;
		stage: "incubating" | "fever" | "delirium" | "turned";
		source?: string;
	};
	/** Limbs lost (amputation stops an infection if done within an hour of the bite). */
	amputations: BodyPart[];
	/** Food and water: when the character last ate/drank and how many daily needs went unmet in a row. */
	needs: { lastMeal: number; lastDrink: number; missedMeals: number; missedDrinks: number };
	/** Times each place was scavenged, by "<locationId>|<placeType>" (yields shrink). */
	looted: Record<string, number>;
}

// ─── The Quiet: survivors and the base (docs/zombie.md §7) ───────────────

/** Someone who joined the player. Their identity (name, portrait, role, description) stays in state.npcs[npcId]. */
export interface Survivor {
	npcId: string;
	/** Pre-apocalypse profession = class id ("cleric" = Nurse…), drives their skills and stat block. */
	profession: string;
	level: number;
	hp: number;
	maxHp: number;
	/** 0 (about to leave or snap) … 10 (devoted). */
	morale: number;
	status: "with_party" | "at_base" | "away" | "dead" | "left" | "turned";
	/** What they bring: skill ids they're proficient in, plus a one-line specialty ("can stitch wounds"). */
	skills: string[];
	specialty: string;
	/** Short personality traits the DM plays (EN; the DM narrates in the campaign language). */
	traits: string[];
	/** Game minute they joined; for "away": when they're due back and why. */
	joinedAt: number;
	away?: { until: number; task: string; /** When they left, and where they return to. */ startedAt?: number; from?: "with_party" | "at_base" };
	/** Their own small inventory (weapon, a few rounds…), as equipment refs. */
	gear: { ref: string; qty: number }[];
	/** Same LAZARUS rules as the player; turnsAt is secret. */
	infection?: { bittenAt: number; turnsAt: number; part: BodyPart; stage: "incubating" | "fever" | "delirium" | "turned" };
	/** Daily needs met from the party's inventory or the base stock; missed days lower morale. */
	missedDays: number;
	/** What they want most (EN, for the DM). */
	want?: string;
	/** What they're afraid of. */
	fear?: string;
	/** Something they hide. */
	secret?: string;
	/** Which of want/fear/secret the player has learnt. */
	revealed?: ("want" | "fear" | "secret")[];
	/** How they feel about other companions: npcId → -3 … +3. */
	bonds?: Record<string, number>;
	/** Game minute of their last camp scene. */
	lastBeatAt?: number;
}

export type BaseUpgrade = "rain_catcher" | "garden" | "workshop" | "infirmary" | "radio" | "watchtower" | "generator" | "alarm_cans";

/** Someone living at the base who isn't a companion (The Quiet). */
export interface Resident {
	id: string;
	name: string;
	/** Linked NPC, when they have one. */
	npcId?: string;
	/** People this entry stands for ("Teresa and her two kids" = 3). */
	headcount: number;
	/** Who they are / what they do around the base. */
	note?: string;
	/** Game minute they moved in. */
	since: number;
}

export interface BaseState {
	name: string;
	locationId: string;
	/** Tactical map of the base (draw_map), if drawn. */
	mapId?: string;
	/** 0..10: how hard the dead/raiders find it to break in (from barricades + upgrades). */
	fortification: number;
	/** Stockpiles in units (1 food/water = one person-day; meds = treatments; ammo = rounds of any kind; fuel = liters; materials = loads of planks/nails/scrap). */
	stock: { food: number; water: number; meds: number; ammo: number; fuel: number; materials: number };
	upgrades: BaseUpgrade[];
	/** Upgrades being built: done at game minute `readyAt`. */
	building?: { upgrade: BaseUpgrade; readyAt: number }[];
	/** Game minute of the last daily base tick. */
	lastTick: number;
	/** Recent base events for the log ("Day 6: the rain catcher filled 4 water"). `kind`/`params` let the UI translate (i18n key base.log.<kind>). */
	log: { at: number; text: string; kind?: string; params?: Record<string, string | number> }[];
	/** Game minute each upgrade was finished (the garden bears after 7 days). */
	completedAt?: Partial<Record<BaseUpgrade, number>>;
	/** The generator had fuel at the last daily tick (lights, fridge, +1 fortification). */
	generatorOn?: boolean;
	/** How sturdy the building is on its own (steel doors, a fence), 0..3; adds to fortification. */
	structure?: number;
	/** What the stock is made of, by equipment ref and item count (e.g. ammo: { "z-ammo-9mm": 12 }), so taking returns real items. */
	items?: Partial<Record<"food" | "water" | "meds" | "ammo" | "fuel" | "materials", Record<string, number>>>;
	/** Game minute the base was claimed. */
	claimedAt?: number;
	/**
	 * People sheltering at the base who aren't companions (no stat block of their own,
	 * no errands; the DM adds them as allies when they fight): they eat from the stock at 08:00.
	 */
	residents?: Resident[];
	/** Mornings in a row the residents were short of food or water. */
	residentsShortDays?: number;
}

/** The player's group in The Quiet (absent until someone joins or a base is claimed). */
export interface GroupState {
	survivors: Record<string, Survivor>;
	base?: BaseState;
	/** Game minute of the last group tick (errands, survivors' daily needs and infections). */
	lastTick?: number;
}

export interface GameState {
	version: 1;
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	settings: CampaignSettings;
	character: Character;
	mode: GameMode;
	scene: SceneState;
	ambience: AmbienceTrack;
	world: WorldMap;
	maps: Record<string, GridMap>;
	activeMapId?: string;
	/** What the center panel shows. */
	view: "scene" | "map" | "world";
	encounter?: Encounter;
	npcs: Record<string, Npc>;
	quests: Quest[];
	journal: JournalEntry[];
	/** In-game clock. */
	time: { day: number; hour: number; minute: number };
	/** Named enemies killed so far (they stay dead). */
	fallen?: { name: string; day: number; where?: string }[];
	/** Clickable suggestions offered by the DM for the next player action. */
	suggestions: string[];
	/** Pending roll the DM asked the player to make (when autoRollPlayer = false). */
	pendingRoll?: { id: string; label: string; notation: string; kind: "check" | "save" | "attack" | "other"; ability?: Ability; skill?: string; dc?: number; advantage?: "advantage" | "disadvantage" };
	/** Seeded RNG state (mulberry32). */
	rng: number;
	/** DM-private campaign notes (improvised threads to remember). Not shown. */
	dmNotes: string[];
	/** Milestone level-ups granted by the DM and not yet taken by the player. */
	levelUpsGranted?: number;
	/** What the player did on their combat turn, waiting to be narrated at end of turn. */
	combatNotes?: string[];
	/** The Quiet only: survival systems. */
	survival?: SurvivalState;
	/** The Quiet only: survivors who joined and the base. */
	group?: GroupState;
	/** The Quiet: the town that moves without the player (factions, hordes, places). */
	town?: TownState;
	/** The Quiet: transmissions the player has heard. */
	radio?: RadioState;
	/** The Quiet: a night siege at the base, from warning to dawn. */
	siege?: SiegeState;
}

// ─── The Quiet: the living town ────────────────────────────────────────────

export type PlaceStatus = "intact" | "looted" | "overrun" | "burned" | "held";

export interface TownFaction {
	id: string;
	name: string;
	/** World location id of their stronghold (may be lost). */
	homeId?: string;
	/** 0 (wiped out) … 10 (strongest in town). */
	strength: number;
	/** Toward the player: -3 hostile … 0 wary … +3 allied. */
	attitude: number;
	/** What they're after right now (EN, for the DM). */
	goal: string;
	/** 0 keeps to itself … 3 raids and grabs. */
	aggression: number;
	/** The player knows they exist. */
	known: boolean;
	status: "active" | "broken" | "gone";
	/** Their people in the codex. */
	npcIds?: string[];
}

export interface Horde {
	id: string;
	/** Rough number of the dead. */
	size: number;
	/** World location id it is at. */
	at: string;
	/** Where it is drifting to. */
	heading?: string;
	/** Game minute of its next move. */
	nextMoveAt: number;
	/** Seen by or reported to the player (only known hordes reach the client). */
	known: boolean;
}

export interface PlaceState {
	status: PlaceStatus;
	heldBy?: string;
	/** Game minute of the last change. */
	since: number;
	/** What the player last saw or heard of it (the world map shows this, not the truth). */
	knownStatus?: PlaceStatus;
	knownHeldBy?: string;
	/** Game minute the player was last here. */
	lastVisit?: number;
}

export interface TownEvent {
	id: string;
	at: number;
	kind: string;
	locId?: string;
	factionId?: string;
	hordeId?: string;
	/** What happened, for the DM (EN). */
	text: string;
	/** Loud enough to reach the radio or rumours. */
	public: boolean;
	/** The player has learnt of it (seen, heard on the radio, told). */
	known?: boolean;
}

export interface TownState {
	lastTick: number;
	factions: Record<string, TownFaction>;
	hordes: Horde[];
	places: Record<string, PlaceState>;
	/** Newest last; capped. */
	events: TownEvent[];
	/** The DM has reviewed the seeded factions (set once). */
	reviewed?: boolean;
	/** Game minute of the last raid on the player's base (they come every few days at most). */
	lastBaseRaid?: number;
	/** Game minute a horde last reached the base (the next one waits a few days). */
	lastBaseHorde?: number;
}

// ─── The Quiet: radio ──────────────────────────────────────────────────────

export type RadioStation = "fm1017" | "emergency" | "cb";

export interface Broadcast {
	id: string;
	at: number;
	station: RadioStation;
	/** The words heard, as the DM wrote them (campaign language). */
	text: string;
	/** Town events it reported. */
	eventIds?: string[];
}

export interface RadioState {
	log: Broadcast[];
}

// ─── The Quiet: sieges ─────────────────────────────────────────────────────

export interface SiegeState {
	phase: "warning" | "prep" | "active" | "over";
	/** Game minute the dead reach the walls. */
	arrivesAt: number;
	/** Rough number of the dead outside. */
	horde: number;
	hordeStart: number;
	/** Town horde this came from, if any. */
	hordeId?: string;
	wave: number;
	waves: number;
	/** Defender (survivor npcId, or "pc") → square on the base map. */
	posts: Record<string, { x: number; y: number }>;
	lights: boolean;
	/** Short engine log lines (EN), newest last. */
	log: string[];
	outcome?: "held" | "breached" | "fled";
}

/** One line in the play log (data/campaigns/<id>/log.jsonl). */
export interface LogEntry {
	id: string;
	role: "player" | "dm" | "system" | "roll";
	text: string;
	roll?: RollRecord;
	/** Tool activity summary for the DM entry (collapsed in the UI). */
	tools?: { name: string; summary: string; isError?: boolean }[];
	ts: number;
}

// ─── Engine interface ─────────────────────────────────────────────────────

export type JsonSchema = Record<string, unknown>;

export interface ToolResult {
	text: string;
	isError?: boolean;
}

export interface DmTool {
	name: string;
	description: string;
	/** JSON Schema (type: "object"). */
	parameters: JsonSchema;
	execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
}

export type EngineEvent =
	| { type: "text"; delta: string }
	| { type: "thinking"; delta: string }
	| { type: "tool_start"; id: string; name: string; args: unknown }
	| { type: "tool_end"; id: string; name: string; result: ToolResult }
	| { type: "usage"; input: number; output: number; cacheRead?: number; costUsd?: number }
	| { type: "error"; message: string }
	| { type: "done" };

export interface TurnRequest {
	/** Stable key for session resume (campaign id). */
	sessionKey: string;
	systemPrompt: string;
	/** The user-turn text (player action + injected state digest). */
	input: string;
	tools: DmTool[];
	config: EngineConfig;
	signal?: AbortSignal;
	onEvent: (event: EngineEvent) => void;
}

export interface DmEngine {
	readonly provider: EngineProvider;
	/** Runs one DM turn: model + tool loop until the model stops. */
	runTurn(req: TurnRequest): Promise<void>;
	/** Forget the resumable session for a key (engine/model switch, corruption). */
	resetSession(sessionKey: string): void;
}

export interface ModelOption {
	provider: EngineProvider;
	apiProvider?: string;
	id: string;
	label: string;
	available: boolean;
	/** Why unavailable (CLI missing, no API key). */
	reason?: string;
}
