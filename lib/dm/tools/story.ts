import type { AmbienceTrack, GameState, InventoryItem, Mood, SceneKind, TimeOfDay, Weather } from "../../game/types";
import { roll, signed } from "../../rules/dice";
import { S, newId, tool, withState, type ToolFactory } from "../context";
import { loadState } from "../../store/campaigns";
import { randomPortrait } from "../../art/portrait";
import { SFX_NAMES } from "../../audio/ambience";

const SCENE_KINDS: SceneKind[] = ["tavern", "town", "forest", "dungeon", "cave", "mountain", "coast", "swamp", "desert", "castle", "temple", "camp", "road", "crypt", "plains", "ship", "underdark"];
const MOODS: Mood[] = ["calm", "mysterious", "tense", "combat", "triumphant", "somber", "festive", "eerie"];
const TIMES: TimeOfDay[] = ["dawn", "day", "dusk", "night"];
const WEATHER: Weather[] = ["clear", "cloudy", "rain", "storm", "fog", "snow"];
const TRACKS: AmbienceTrack[] = ["none", "tavern", "town", "forest", "dungeon", "cave", "combat", "boss", "rain", "storm", "night", "temple", "sea", "tension", "victory"];

function hourToTime(hour: number): TimeOfDay {
	if (hour >= 5 && hour < 8) return "dawn";
	if (hour >= 8 && hour < 18) return "day";
	if (hour >= 18 && hour < 21) return "dusk";
	return "night";
}

export const rollTool = tool<{ notation: string; label: string; advantage?: "advantage" | "disadvantage"; target?: number; secret?: boolean }>(
	"roll",
	"Roll dice (e.g. '1d20+3', '2d6', '4d6kh3'). Use for any roll without a more specific tool (random tables, damage of traps, NPC checks). secret=true hides it from the player (still logged for you).",
	S.obj(
		{
			notation: S.str("Dice notation"),
			label: S.str("What the roll is for"),
			advantage: S.str(undefined, ["advantage", "disadvantage"]),
			target: S.int("DC or AC to beat (optional)"),
			secret: S.bool("Hide from the player"),
		},
		["notation", "label"],
	),
	async (a, ctx) =>
		withState(ctx, ({ rng, roll: record }) => {
			const r = roll(rng, a.notation, { label: a.label, advantage: a.advantage, target: a.target, actor: "dm" });
			if (!a.secret) record(r);
			return `${a.label}: ${r.notation} → ${r.total} [${r.dice.map((d) => (d.dropped ? `(${d.value})` : d.value)).join(", ")}]${r.success !== undefined ? (r.success ? " SUCCESS" : " FAIL") : ""}`;
		}),
);

export const setScene = tool<{ title: string; kind: SceneKind; timeOfDay?: TimeOfDay; weather?: Weather; mood?: Mood; caption?: string; npcIds?: string[]; props?: string[]; view?: "scene" | "map" | "world" }>(
	"set_scene",
	"Change the illustrated scene shown to the player (location kind, time, weather, mood, props, NPCs present). Call whenever the situation or location changes noticeably.",
	S.obj(
		{
			title: S.str("Short scene title, e.g. 'The Gilded Stag Inn'"),
			kind: S.str(undefined, SCENE_KINDS),
			timeOfDay: S.str("Defaults to the in-game clock", TIMES),
			weather: S.str(undefined, WEATHER),
			mood: S.str(undefined, MOODS),
			caption: S.str("One evocative line shown under the art"),
			npcIds: S.arr(S.str(), "NPC ids present (portraits shown)"),
			props: S.arr(S.str(), "Props to draw: campfire, altar, statue, cart, tents, torches, barrels, throne, well, ship, bridge…"),
			view: S.str("Switch the center panel", ["scene", "map", "world"]),
		},
		["title", "kind"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			state.scene = {
				title: a.title,
				kind: a.kind,
				timeOfDay: a.timeOfDay ?? hourToTime(state.time.hour),
				weather: a.weather ?? state.scene.weather,
				mood: a.mood ?? "calm",
				caption: a.caption,
				npcIds: (a.npcIds ?? []).filter((id) => state.npcs[id]),
				props: a.props ?? [],
			};
			state.view = a.view ?? (state.mode === "combat" ? "map" : "scene");
			return `Scene set: ${a.title}`;
		}),
);

export const setAmbience = tool<{ track: AmbienceTrack }>(
	"set_ambience",
	"Set the looping background ambience/music.",
	S.obj({ track: S.str(undefined, TRACKS) }, ["track"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			state.ambience = a.track;
			return `Ambience: ${a.track}`;
		}),
);

export const playSfx = tool<{ sound: string }>(
	"play_sfx",
	"Play a one-shot sound effect.",
	S.obj({ sound: S.str(undefined, SFX_NAMES) }, ["sound"]),
	async (a, ctx) => {
		ctx.emit({ type: "fx", fx: { kind: "sfx", sound: a.sound } });
		return "ok";
	},
);

export const setView = tool<{ view: "scene" | "map" | "world" }>(
	"set_view",
	"Switch what the player's center panel shows: scene illustration, active battle map, or world map.",
	S.obj({ view: S.str(undefined, ["scene", "map", "world"]) }, ["view"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (a.view === "map" && !state.activeMapId) throw new Error("No active map; call generate_map first.");
			state.view = a.view;
			return `View: ${a.view}`;
		}),
);

export const suggestActions = tool<{ actions: string[] }>(
	"suggest_actions",
	"Offer 3–4 short suggested next actions as clickable chips (call at the end of every turn).",
	S.obj({ actions: S.arr(S.str(), "3–4 short imperative suggestions") }, ["actions"]),
	async (a, ctx) => {
		if (ctx.suggested) return { text: "Suggestions were already shown this turn. Your turn is over: stop now and write nothing more.", isError: true };
		ctx.suggested = true;
		return withState(ctx, ({ state }) => {
			state.suggestions = a.actions.slice(0, 5);
			return "Suggestions shown. Your turn is complete: stop now and write NOTHING more.";
		});
	},
);

export const advanceTime = tool<{ minutes?: number; hours?: number; days?: number }>(
	"advance_time",
	"Advance the in-game clock (travel, searching, waiting). Rests have their own tools.",
	S.obj({ minutes: S.int(), hours: S.int(), days: S.int() }),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			let total = state.time.minute + (a.minutes ?? 0) + 60 * (state.time.hour + (a.hours ?? 0));
			let day = state.time.day + (a.days ?? 0) + Math.floor(total / (24 * 60));
			total %= 24 * 60;
			state.time = { day, hour: Math.floor(total / 60), minute: total % 60 };
			day = state.time.day;
			return `Now day ${day}, ${String(state.time.hour).padStart(2, "0")}:${String(state.time.minute).padStart(2, "0")} (${hourToTime(state.time.hour)})`;
		}),
);

export const journalNote = tool<{ text: string }>(
	"journal_note",
	"Add a short story entry to the player's journal (visible to the player). Write one after each significant event.",
	S.obj({ text: S.str("1–3 sentence recap, past tense") }, ["text"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			state.journal.push({ id: newId("j"), day: state.time.day, text: a.text, kind: "story", ts: Date.now() });
			return "Journal updated.";
		}),
);

export const dmNote = tool<{ text: string }>(
	"dm_note",
	"Record a private DM note (secrets, planned twists, clocks, threads to pay off). Never shown to the player; included in your state digest.",
	S.obj({ text: S.str() }, ["text"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			state.dmNotes.push(a.text);
			if (state.dmNotes.length > 60) state.dmNotes = state.dmNotes.slice(-60);
			return "Noted.";
		}),
);

export const addNpc = tool<{ name: string; role: string; speciesId?: string; disposition?: "friendly" | "neutral" | "hostile" | "unknown"; description: string; secret?: string; statBlock?: string; present?: boolean }>(
	"add_npc",
	"Introduce a new NPC into the codex (portrait generated). present=true adds them to the current scene.",
	S.obj(
		{
			name: S.str(),
			role: S.str("innkeeper, guard captain, cultist…"),
			speciesId: S.str("human, elf, dwarf, halfling, gnome, half-orc, tiefling, dragonborn, half-elf…"),
			disposition: S.str(undefined, ["friendly", "neutral", "hostile", "unknown"]),
			description: S.str("Appearance and manner (player-visible)"),
			secret: S.str("DM-only motives/secrets"),
			statBlock: S.str("SRD monster index to use if they fight, e.g. 'bandit-captain'"),
			present: S.bool(),
		},
		["name", "role", "description"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			const id = newId("npc");
			state.npcs[id] = {
				id,
				name: a.name,
				role: a.role,
				speciesId: a.speciesId,
				disposition: a.disposition ?? "neutral",
				description: a.description,
				secret: a.secret,
				statBlock: a.statBlock,
				alive: true,
				locationId: state.world.currentLocationId,
				portrait: randomPortrait(rng, a.speciesId ?? "human"),
				firstMetDay: state.time.day,
			};
			if (a.present) state.scene.npcIds = [...state.scene.npcIds, id];
			return `NPC ${a.name} created with id ${id}.`;
		}),
);

export const updateNpc = tool<{ id: string; disposition?: "friendly" | "neutral" | "hostile" | "unknown"; description?: string; secret?: string; alive?: boolean; present?: boolean; role?: string }>(
	"update_npc",
	"Update an NPC (disposition, description, secret, alive, present in scene).",
	S.obj(
		{
			id: S.str(),
			disposition: S.str(undefined, ["friendly", "neutral", "hostile", "unknown"]),
			description: S.str(),
			secret: S.str(),
			role: S.str(),
			alive: S.bool(),
			present: S.bool(),
		},
		["id"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const npc = state.npcs[a.id];
			if (!npc) throw new Error(`Unknown NPC ${a.id}`);
			if (a.disposition) npc.disposition = a.disposition;
			if (a.description) npc.description = a.description;
			if (a.secret !== undefined) npc.secret = a.secret;
			if (a.role) npc.role = a.role;
			if (a.alive !== undefined) npc.alive = a.alive;
			if (a.present === true && !state.scene.npcIds.includes(a.id)) state.scene.npcIds.push(a.id);
			if (a.present === false) state.scene.npcIds = state.scene.npcIds.filter((x) => x !== a.id);
			return `Updated ${npc.name}.`;
		}),
);

export const addQuest = tool<{ title: string; summary: string; objectives: string[]; giverNpcId?: string; reward?: string }>(
	"add_quest",
	"Add a quest to the player's quest log.",
	S.obj({ title: S.str(), summary: S.str(), objectives: S.arr(S.str()), giverNpcId: S.str(), reward: S.str() }, ["title", "summary", "objectives"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const id = newId("q");
			state.quests.push({
				id,
				title: a.title,
				summary: a.summary,
				status: "active",
				objectives: a.objectives.map((text) => ({ id: newId("o"), text, done: false })),
				giverNpcId: a.giverNpcId,
				reward: a.reward,
			});
			ctx.emit({ type: "fx", fx: { kind: "sfx", sound: "book" } });
			return `Quest added: ${a.title} [${id}]`;
		}),
);

export const updateQuest = tool<{ id: string; status?: "active" | "completed" | "failed" | "abandoned"; completeObjectives?: string[]; addObjectives?: string[]; summary?: string }>(
	"update_quest",
	"Update a quest: status, mark objectives done (by objective text prefix or id), add objectives.",
	S.obj(
		{
			id: S.str(),
			status: S.str(undefined, ["active", "completed", "failed", "abandoned"]),
			completeObjectives: S.arr(S.str()),
			addObjectives: S.arr(S.str()),
			summary: S.str(),
		},
		["id"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const q = state.quests.find((x) => x.id === a.id || x.title === a.id);
			if (!q) throw new Error(`Unknown quest ${a.id}`);
			if (a.status) q.status = a.status;
			if (a.summary) q.summary = a.summary;
			for (const key of a.completeObjectives ?? []) {
				const o = q.objectives.find((x) => x.id === key || x.text.toLowerCase().startsWith(key.toLowerCase()));
				if (o) o.done = true;
			}
			for (const text of a.addObjectives ?? []) q.objectives.push({ id: newId("o"), text, done: false });
			return `Quest ${q.title}: ${q.status}`;
		}),
);

export const giveItem = tool<{ name: string; quantity?: number; ref?: string; description?: string; category?: string }>(
	"give_item",
	"Add an item to the player's inventory. Use the SRD index in `ref` for standard equipment/magic items (stats auto-filled) or describe homebrew items.",
	S.obj(
		{
			name: S.str(),
			quantity: S.int(undefined, 1),
			ref: S.str("SRD equipment or magic item index, e.g. 'potion-of-healing', 'longsword'"),
			description: S.str(),
			category: S.str("weapon, armor, shield, gear, potion, scroll, magic, treasure, key, quest"),
		},
		["name"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const qty = a.quantity ?? 1;
			const existing = state.character.inventory.find((i) => i.name.toLowerCase() === a.name.toLowerCase() && !i.weapon && !i.armor);
			if (existing) existing.quantity += qty;
			else {
				const item: InventoryItem = { id: newId("it"), ref: a.ref, name: a.name, quantity: qty, description: a.description, category: a.category ?? "gear" };
				enrichItem(item);
				state.character.inventory.push(item);
			}
			ctx.emit({ type: "fx", fx: { kind: "sfx", sound: "gem" } });
			return `Gave ${qty} × ${a.name}.`;
		}),
);

export const removeItem = tool<{ name: string; quantity?: number }>(
	"remove_item",
	"Remove (consume, lose, give away) items from the player's inventory, by name or item id.",
	S.obj({ name: S.str("Item name or id"), quantity: S.int(undefined, 1) }, ["name"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const inv = state.character.inventory;
			const item = inv.find((i) => i.id === a.name) ?? inv.find((i) => i.name.toLowerCase() === a.name.toLowerCase());
			if (!item) throw new Error(`Player has no ${a.name}`);
			const qty = Math.min(a.quantity ?? 1, item.quantity);
			item.quantity -= qty;
			if (item.quantity <= 0) state.character.inventory = inv.filter((i) => i !== item);
			return `Removed ${qty} × ${item.name}.`;
		}),
);

export const adjustCurrency = tool<{ gp?: number; sp?: number; cp?: number; pp?: number; ep?: number; reason: string }>(
	"adjust_currency",
	"Add (positive) or spend (negative) coins. Fails if the player can't afford it (auto-converts larger coins).",
	S.obj({ pp: S.int(), gp: S.int(), ep: S.int(), sp: S.int(), cp: S.int(), reason: S.str() }, ["reason"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			const cur = state.character.currency;
			const rate = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 } as const;
			const deltaCp = (Object.keys(rate) as (keyof typeof rate)[]).reduce((n, k) => n + (a[k] ?? 0) * rate[k], 0);
			const totalCp = (Object.keys(rate) as (keyof typeof rate)[]).reduce((n, k) => n + cur[k] * rate[k], 0);
			if (totalCp + deltaCp < 0) throw new Error(`Cannot afford: has ${totalCp / 100} gp worth.`);
			const allPositive = (Object.keys(rate) as (keyof typeof rate)[]).every((k) => (a[k] ?? 0) >= 0);
			if (allPositive) for (const k of Object.keys(rate) as (keyof typeof rate)[]) cur[k] += a[k] ?? 0;
			else {
				// Spending: recompute as gp/sp/cp change keeping pp/ep as is when possible.
				let left = totalCp + deltaCp;
				const out = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
				out.pp = Math.min(cur.pp, Math.floor(left / 1000));
				left -= out.pp * 1000;
				out.gp = Math.floor(left / 100);
				left -= out.gp * 100;
				out.sp = Math.floor(left / 10);
				out.cp = left - out.sp * 10;
				Object.assign(cur, out);
			}
			ctx.emit({ type: "fx", fx: { kind: "sfx", sound: "coin" } });
			return `Coins now: ${cur.pp} pp, ${cur.gp} gp, ${cur.ep} ep, ${cur.sp} sp, ${cur.cp} cp (${a.reason}).`;
		}),
);

export const requestPlayerRoll = tool<{ label: string; notation?: string; kind: "check" | "save" | "attack" | "other"; ability?: string; skill?: string; dc?: number; advantage?: "advantage" | "disadvantage" }>(
	"request_player_roll",
	"Ask the player to roll (shows a roll button). End your turn after calling this; the result arrives as the next player message. Only when autoRollPlayer is off.",
	S.obj(
		{
			label: S.str("e.g. 'Athletics check to climb the wall'"),
			notation: S.str("Defaults to the right d20 + modifier for the check/save"),
			kind: S.str(undefined, ["check", "save", "attack", "other"]),
			ability: S.str(undefined, ["str", "dex", "con", "int", "wis", "cha"]),
			skill: S.str("skill index, e.g. 'athletics'"),
			dc: S.int(),
			advantage: S.str(undefined, ["advantage", "disadvantage"]),
		},
		["label", "kind"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			state.pendingRoll = {
				id: newId("pr"),
				label: a.label,
				notation: a.notation ?? "1d20",
				kind: a.kind,
				ability: a.ability as never,
				skill: a.skill,
				dc: a.dc,
				advantage: a.advantage,
			};
			return "Roll requested; end your turn now.";
		}),
);

export const getState = tool<{ section?: string }>(
	"get_state",
	"Read part of the authoritative game state as JSON: character, inventory, spells, features, quests, npcs, map, encounter, world, journal.",
	S.obj({ section: S.str(undefined, ["character", "inventory", "spells", "features", "quests", "npcs", "map", "encounter", "world", "journal"]) }),
	async (a, ctx) => {
		const s: GameState = loadState(ctx.campaignId);
		const c = s.character;
		const pick: Record<string, unknown> = {
			character: { ...c, inventory: undefined, features: undefined, portrait: undefined },
			inventory: { items: c.inventory, currency: c.currency },
			spells: c.spellcasting ?? "not a spellcaster",
			features: c.features,
			quests: s.quests,
			npcs: s.npcs,
			map: s.activeMapId ? { ...s.maps[s.activeMapId], tiles: undefined, explored: undefined } : "no active map",
			encounter: s.encounter ?? "no encounter",
			world: s.world,
			journal: s.journal,
		};
		return JSON.stringify(pick[a.section ?? "character"] ?? null).slice(0, 20000);
	},
);

export function modText(n: number) {
	return signed(n);
}

/** Fills weapon/armor stats from the SRD when `ref` is known. Implemented in items.ts. */
let enrichItem: (item: InventoryItem) => void = () => undefined;
export function setItemEnricher(fn: (item: InventoryItem) => void) {
	enrichItem = fn;
}

export const STORY_TOOLS: ToolFactory[] = [
	rollTool,
	setScene,
	setAmbience,
	playSfx,
	setView,
	suggestActions,
	advanceTime,
	journalNote,
	dmNote,
	addNpc,
	updateNpc,
	addQuest,
	updateQuest,
	giveItem,
	removeItem,
	adjustCurrency,
	requestPlayerRoll,
	getState,
];

export type { GameState };
