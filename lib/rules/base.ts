/**
 * The Quiet, Phase 3b: the base (docs/zombie.md §7). One building the player
 * secured and claimed: stockpiles (in units), upgrades built from materials
 * over game hours, a fortification level computed from the barricades on the
 * base map plus upgrades, a daily tick at 08:00 (production, generator fuel)
 * and a daily BASE EVENT roll. The engine picks the event and hands the DM an
 * explicit instruction; it never resolves a fight itself.
 *
 * Pure rules over GameState (mutated in place, like the DM tools inside
 * withState); the tools in lib/dm/tools/base.ts wrap them. Zombie campaigns
 * only: callers check isZombie(state) first.
 */
import type { BaseState, BaseUpgrade, GameState, GroupState, InventoryItem, MonsterStats } from "../game/types";
import { getEquipment, MONSTERS } from "../srd";
import type { Rng } from "./dice";
import { outbreakDay } from "./ruleset";
import { gameMinutes, isFood, isWater } from "./survival";
import { residentsDigest } from "./residents";

export const STOCK_KINDS = ["food", "water", "meds", "ammo", "fuel", "materials"] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export type Stock = BaseState["stock"];

export const BASE_UPGRADES: readonly BaseUpgrade[] = ["rain_catcher", "garden", "workshop", "infirmary", "radio", "watchtower", "generator", "alarm_cans"];

/** What each upgrade costs (from the stock), how long it takes to build and what it does (EN, for the DM). */
export const UPGRADES: Record<BaseUpgrade, { cost: Partial<Stock>; hours: number; effect: string }> = {
	rain_catcher: { cost: { materials: 2 }, hours: 3, effect: "water +2 a day (+4 on a day of rain or storm)" },
	garden: { cost: { materials: 2, water: 2 }, hours: 4, effect: "food +1 a day once it has grown for 7 days" },
	workshop: { cost: { materials: 4 }, hours: 8, effect: "materials stashed count ×1.5 (scrap reworked); repairs and crafting are easier (DM)" },
	infirmary: { cost: { materials: 3, meds: 2 }, hours: 6, effect: "a long rest at the base heals everyone fully and eases a fever (1 meds: one extra exhaustion level off)" },
	radio: { cost: { materials: 2, fuel: 2 }, hours: 6, effect: "listen to 101.7 FM and reach the factions (DM hooks)" },
	watchtower: { cost: { materials: 5 }, hours: 10, effect: "fortification +1; early warning: threats lose half their surprise" },
	generator: { cost: { materials: 3, fuel: 5 }, hours: 6, effect: "burns 1 fuel a day: lights, a fridge for meds (no spoiled meds), +1 fortification while fueled" },
	alarm_cans: { cost: { materials: 1 }, hours: 1, effect: "fortification +1; rattling cans warn of anyone approaching" },
};

// ─── stock ⇄ items ─────────────────────────────────────────────────────────

/** Stock units one item is worth, by equipment ref (ammo: any `ammunition` item, 1 per round). */
export const ITEM_UNITS: Record<string, { kind: StockKind; units: number }> = {
	"z-canned-food": { kind: "food", units: 1 },
	"z-preserves": { kind: "food", units: 1 },
	"z-bottled-water": { kind: "water", units: 1 },
	"z-medkit": { kind: "meds", units: 3 },
	"z-bandage": { kind: "meds", units: 1 },
	"z-painkillers": { kind: "meds", units: 1 },
	"z-antibiotics": { kind: "meds", units: 1 },
	"z-gasoline": { kind: "fuel", units: 5 },
	"z-planks": { kind: "materials", units: 1 },
	"z-nails": { kind: "materials", units: 1 },
	"z-pipe": { kind: "materials", units: 1 },
};

/** What an untracked unit comes back as when taken (stock produced by the base, not stashed). */
const DEFAULT_REF: Record<Exclude<StockKind, "ammo" | "materials">, string> = {
	food: "z-canned-food",
	water: "z-bottled-water",
	meds: "z-bandage",
	fuel: "z-gasoline",
};

const MATERIAL_NAME = /\b(planks?|lumber|timber|boards?|nails?|scrap|sheet metal)\b/i;
const MEDS_NAME = /\b(bandages?|medkit|first[- ]aid|painkillers?|antibiotics?|gauze)\b/i;
const JERKY_NAME = /\bjerky\b/i;

/** The stock kind and units of one item of `i`, or undefined if it can't go into the stock. */
export function stockValue(i: Pick<InventoryItem, "ref" | "name" | "category">): { kind: StockKind; units: number } | undefined {
	if (i.ref && ITEM_UNITS[i.ref]) return ITEM_UNITS[i.ref];
	if (i.ref && (getEquipment(i.ref)?.category === "ammunition" || i.category === "ammunition")) return { kind: "ammo", units: 1 };
	if (i.ref?.startsWith("z-")) return undefined;
	if (JERKY_NAME.test(i.name) || isFood(i)) return { kind: "food", units: 1 };
	if (isWater(i)) return { kind: "water", units: 1 };
	if (MEDS_NAME.test(i.name)) return { kind: "meds", units: 1 };
	if (MATERIAL_NAME.test(i.name)) return { kind: "materials", units: 1 };
	return undefined;
}

const nameOf = (ref: string) => getEquipment(ref)?.name ?? ref;
const unitsOf = (ref: string) => ITEM_UNITS[ref]?.units ?? 1;

// ─── the group and the base ────────────────────────────────────────────────

/** The group, created on first use (compatible with the survivors system's own lazy creation). */
export function ensureGroup(state: GameState): GroupState {
	state.group ??= { survivors: {} };
	state.group.survivors ??= {};
	return state.group;
}

export function baseOf(state: GameState): BaseState | undefined {
	return state.group?.base;
}

function requireBase(state: GameState): BaseState {
	const b = baseOf(state);
	if (!b) throw new Error("There is no base yet: once the player has secured a building, claim it with claim_base.");
	return b;
}

/** The party stands at the base's world location. */
export function atBase(state: GameState): boolean {
	const b = baseOf(state);
	return !!b && !!state.world.currentLocationId && state.world.currentLocationId === b.locationId;
}

function requireAtBase(state: GameState, b: BaseState, what: string): void {
	if (!atBase(state)) throw new Error(`${what} only at the base (${b.name}, ${locationName(state, b.locationId)}); the party is elsewhere.`);
}

const locationName = (state: GameState, id: string) => state.world.locations.find((l) => l.id === id)?.name ?? id;

const dayOf = (at: number) => Math.floor(at / 1440);

function log(b: BaseState, at: number, text: string, kind?: string, params?: Record<string, string | number>): void {
	b.log.push({ at, text: `Day ${dayOf(at)}: ${text}`, ...(kind ? { kind } : {}), ...(params ? { params } : {}) });
	if (b.log.length > 40) b.log.splice(0, b.log.length - 40);
}

const emptyStock = (): Stock => ({ food: 0, water: 0, meds: 0, ammo: 0, fuel: 0, materials: 0 });

export interface ClaimArgs {
	name: string;
	locationId?: string;
	mapId?: string;
	/** Sturdiness of the building itself (0..3). */
	structure?: number;
	/** Required when moving an existing base elsewhere. */
	reason?: string;
}

/**
 * Claims (or re-claims) the base. The DM decides the place was secured first.
 * Moving to another location needs a reason: the stock moves with the group
 * (the DM narrates the hauling), upgrades and builds in progress stay behind.
 */
export function claimBase(state: GameState, a: ClaimArgs): string {
	const name = a.name?.trim();
	if (!name) throw new Error("Give the base a name.");
	if (state.encounter?.status === "active") throw new Error("Not in the middle of a fight: secure the place first.");
	let locationId = state.world.currentLocationId;
	if (a.locationId) {
		const loc = state.world.locations.find((l) => l.id === a.locationId || l.name.toLowerCase() === a.locationId!.toLowerCase());
		if (!loc) throw new Error(`Unknown location ${a.locationId}.`);
		locationId = loc.id;
	}
	if (!locationId) throw new Error("No current world location: pass locationId.");
	const mapId = a.mapId ?? state.activeMapId;
	if (a.mapId && !state.maps[a.mapId]) throw new Error(`Unknown map ${a.mapId}.`);
	const structure = Math.max(0, Math.min(3, Math.round(a.structure ?? 0)));
	const now = gameMinutes(state.time);
	const group = ensureGroup(state);
	const old = group.base;
	if (old && old.locationId !== locationId) {
		if (!a.reason?.trim()) throw new Error(`There is already a base (${old.name}, ${locationName(state, old.locationId)}). To move it, call claim_base again with a reason (the old place was overrun, a better building…).`);
		const left = old.upgrades;
		group.base = {
			...old,
			name,
			locationId,
			mapId,
			structure,
			upgrades: [],
			building: [],
			completedAt: {},
			generatorOn: false,
			claimedAt: now,
		};
		log(group.base, now, `the group moved to ${name} (${a.reason.trim()}).`, "moved", { name, reason: a.reason.trim() });
		group.base.fortification = fortificationOf(state, group.base);
		return `Base MOVED to ${name} (${locationName(state, locationId)}${mapId ? `, map ${mapId}` : ""}) because ${a.reason.trim()}. The stock comes along (narrate hauling it; if they can't carry it all, take_from_stash first and leave the rest). Left behind: ${left.length ? left.join(", ") : "no upgrades"}. Fortification ${group.base.fortification}/10.`;
	}
	if (old) {
		old.name = name;
		// Renaming while another map is active keeps the base's own map.
		old.mapId = a.mapId ?? old.mapId ?? state.activeMapId;
		old.structure = a.structure !== undefined ? structure : old.structure;
		old.fortification = fortificationOf(state, old);
		return `Base updated: ${name} (${locationName(state, locationId)}${old.mapId ? `, map ${old.mapId}` : ""}). Fortification ${old.fortification}/10.`;
	}
	const b: BaseState = {
		name,
		locationId,
		...(mapId ? { mapId } : {}),
		fortification: 0,
		stock: emptyStock(),
		upgrades: [],
		building: [],
		lastTick: now,
		log: [],
		completedAt: {},
		structure,
		claimedAt: now,
	};
	b.fortification = fortificationOf(state, b);
	group.base = b;
	log(b, now, `claimed ${name} as the group's base.`, "claimed", { name });
	return `BASE CLAIMED: ${name} at ${locationName(state, locationId)}${mapId ? ` (map ${mapId}: its barricades count toward fortification)` : " (no map: draw_map the place so its barricades count)"}. Fortification ${b.fortification}/10. Stash supplies with stash, build upgrades with build_upgrade; at fortification 3+ a long rest here is secured. Each day at 08:00 the base produces and may face an event.`;
}

// ─── fortification ─────────────────────────────────────────────────────────

/** 0..10: barricade HP on the base map (every 25 HP ≈ one plank barricade = 1, max 6) + sturdiness + watchtower, alarm cans and a fueled generator. */
export function fortificationOf(state: GameState, b: BaseState): number {
	const map = b.mapId ? state.maps[b.mapId] : undefined;
	const hp = Object.values(map?.barricades ?? {}).reduce((n, x) => n + Math.max(0, x.hp), 0);
	const walls = Math.min(6, Math.floor(hp / 25));
	const has = (u: BaseUpgrade) => (b.upgrades.includes(u) ? 1 : 0);
	const total = (b.structure ?? 0) + walls + has("watchtower") + has("alarm_cans") + (b.upgrades.includes("generator") && b.generatorOn ? 1 : 0);
	return Math.max(0, Math.min(10, total));
}

// ─── stash / take ──────────────────────────────────────────────────────────

export interface StashArgs {
	items: { ref?: string; itemId?: string; qty?: number }[];
}

function findItem(state: GameState, a: { ref?: string; itemId?: string }): InventoryItem | undefined {
	const inv = state.character.inventory;
	if (a.itemId) return inv.find((i) => i.id === a.itemId);
	if (!a.ref) return undefined;
	const r = a.ref.toLowerCase();
	return inv.find((i) => i.ref === a.ref) ?? inv.find((i) => i.name.toLowerCase() === r);
}

/** Moves inventory items into the base stock. All-or-nothing: an item that can't be stocked fails the whole call. */
export function stash(state: GameState, a: StashArgs): string {
	const b = requireBase(state);
	requireAtBase(state, b, "Stashing works");
	if (!a.items?.length) throw new Error("Nothing to stash: list items as { ref or itemId, qty }.");
	const plan: { item: InventoryItem; qty: number; kind: StockKind; units: number }[] = [];
	for (const x of a.items) {
		const item = findItem(state, x);
		if (!item) throw new Error(`Not in the inventory: ${x.itemId ?? x.ref}.`);
		const v = stockValue(item);
		if (!v) throw new Error(`${item.name} doesn't go into the stock (food, water, meds, ammo, fuel, materials only). Keep it in the inventory.`);
		const already = plan.filter((p) => p.item === item).reduce((n, p) => n + p.qty, 0);
		const qty = Math.round(x.qty ?? item.quantity - already);
		if (qty <= 0 || qty + already > item.quantity) throw new Error(`Only ${item.quantity - already} × ${item.name} to stash.`);
		if (item.equipped && qty >= item.quantity) item.equipped = false;
		plan.push({ item, qty, kind: v.kind, units: v.units * qty });
	}
	const now = gameMinutes(state.time);
	const added: Partial<Record<StockKind, number>> = {};
	b.items ??= {};
	for (const p of plan) {
		p.item.quantity -= p.qty;
		// Known items are tracked so they come back as themselves; homebrew ones come back as the standard item.
		const ref = p.item.ref;
		if (ref && (ITEM_UNITS[ref] || p.kind === "ammo")) {
			const bucket = (b.items[p.kind] ??= {});
			bucket[ref] = (bucket[ref] ?? 0) + p.qty;
		}
		added[p.kind] = (added[p.kind] ?? 0) + p.units;
	}
	state.character.inventory = state.character.inventory.filter((i) => i.quantity > 0);
	if (added.materials && b.upgrades.includes("workshop")) added.materials = Math.floor(added.materials * 1.5);
	for (const k of STOCK_KINDS) if (added[k]) b.stock[k] += added[k]!;
	const what = STOCK_KINDS.filter((k) => added[k]).map((k) => `${k} +${added[k]}`).join(", ");
	log(b, now, `stashed ${what}.`, "stashed", Object.fromEntries(STOCK_KINDS.filter((k) => added[k]).map((k) => [k, added[k]!])));
	return `Stashed at ${b.name}: ${plan.map((p) => `${p.qty} × ${p.item.name}`).join(", ")} → ${what}${added.materials && b.upgrades.includes("workshop") ? " (workshop ×1.5 on materials)" : ""}. Stock now: ${stockText(b.stock)}.`;
}

/** Ammo refs the player's weapons fire (equipped first). */
export function ammoPreference(state: GameState): string[] {
	const weapons = [...state.character.inventory].filter((i) => i.weapon && i.ref).sort((x, y) => Number(!!y.equipped) - Number(!!x.equipped));
	const refs = weapons.map((w) => getEquipment(w.ref!)?.ammo).filter((r): r is string => !!r);
	return [...new Set(refs)];
}

export interface TakenItem {
	ref: string;
	name: string;
	qty: number;
}

/**
 * Takes `qty` units of one kind out of the stock as real items: stashed
 * items come back first (ammo: the types the player's weapons use first),
 * then produced/untracked units as the standard item (food → canned food,
 * meds → bandages, materials → planks and nails alternating, ammo → the
 * player's weapon's rounds). Fuel comes out in 5-liter cans only.
 */
export function takeFromStash(state: GameState, kind: StockKind, qty: number): { items: TakenItem[]; units: number; text: string } {
	const b = requireBase(state);
	requireAtBase(state, b, "Taking from the stash works");
	if (!STOCK_KINDS.includes(kind)) throw new Error(`kind must be one of ${STOCK_KINDS.join(", ")}.`);
	let want = Math.round(qty);
	if (want <= 0) throw new Error("qty must be at least 1.");
	if (want > b.stock[kind]) throw new Error(`Only ${b.stock[kind]} ${kind} in the stock.`);
	if (kind === "fuel") {
		want = Math.floor(want / 5) * 5;
		if (want <= 0) throw new Error("Fuel comes out in 5-liter gasoline cans: take at least 5.");
	}
	b.items ??= {};
	const bucket = (b.items[kind] ??= {});
	// Tracked items can't exceed the stock (spoilage and upkeep eat untracked units first, then these).
	trimBucket(b, kind);
	const prefer = kind === "ammo" ? ammoPreference(state) : [];
	const order = Object.keys(bucket).sort((x, y) => {
		const px = prefer.indexOf(x), py = prefer.indexOf(y);
		if ((px >= 0) !== (py >= 0)) return px >= 0 ? -1 : 1;
		if (px >= 0 && py >= 0) return px - py;
		// Whole medkits before loose bandages, then the biggest pile.
		return unitsOf(y) - unitsOf(x) || (bucket[y] ?? 0) - (bucket[x] ?? 0);
	});
	const out = new Map<string, number>();
	const give = (ref: string, n: number) => out.set(ref, (out.get(ref) ?? 0) + n);
	let left = want;
	if (kind === "materials") {
		// Planks and nails go together (a plank barricade needs one of each): take them in turn.
		for (let more = true; more && left > 0; ) {
			more = false;
			for (const ref of order) {
				if (left <= 0 || !bucket[ref]) continue;
				give(ref, 1);
				bucket[ref] -= 1;
				left -= 1;
				more = true;
			}
		}
	} else {
		for (const ref of order) {
			const per = unitsOf(ref);
			while (left >= per && (bucket[ref] ?? 0) > 0) {
				give(ref, 1);
				bucket[ref] -= 1;
				left -= per;
			}
		}
	}
	for (const ref of order) if (!bucket[ref]) delete bucket[ref];
	// Untracked units (production, workshop bonus): standard items.
	if (left > 0) {
		if (kind === "ammo") give(prefer[0] ?? order[0] ?? "z-ammo-9mm", left);
		else if (kind === "materials") {
			give("z-planks", Math.ceil(left / 2));
			if (left >= 2) give("z-nails", Math.floor(left / 2));
		} else if (kind === "fuel") give("z-gasoline", Math.floor(left / 5));
		else give(DEFAULT_REF[kind], left);
		left = 0;
	}
	b.stock[kind] -= want;
	trimBucket(b, kind);
	const items = [...out].map(([ref, n]) => ({ ref, name: nameOf(ref), qty: n }));
	log(b, gameMinutes(state.time), `took ${want} ${kind} from the stash.`, "took", { kind, qty: want });
	return { items, units: want, text: `Took ${want} ${kind} from the ${b.name} stash: ${items.map((i) => `${i.qty} × ${i.name}`).join(", ")} (added to the inventory). Stock now: ${stockText(b.stock)}.` };
}

/** Drops tracked items beyond what the stock still holds (largest buckets first). */
function trimBucket(b: BaseState, kind: StockKind): void {
	const bucket = b.items?.[kind];
	if (!bucket) return;
	let tracked = Object.entries(bucket).reduce((n, [ref, c]) => n + c * unitsOf(ref), 0);
	for (const ref of Object.keys(bucket).sort((x, y) => bucket[y] - bucket[x])) {
		while (tracked > b.stock[kind] && bucket[ref] > 0) {
			bucket[ref] -= 1;
			tracked -= unitsOf(ref);
		}
		if (!bucket[ref]) delete bucket[ref];
	}
}

export function stockText(s: Stock): string {
	return STOCK_KINDS.map((k) => `${k} ${s[k]}`).join(", ");
}

// ─── upgrades ──────────────────────────────────────────────────────────────

const costText = (c: Partial<Stock>) => STOCK_KINDS.filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(" + ");

/** Starts building an upgrade: pays its cost from the stock now; it is done `hours` of game time later (the clock is not advanced). */
export function buildUpgrade(state: GameState, upgrade: BaseUpgrade): string {
	const b = requireBase(state);
	const spec = UPGRADES[upgrade];
	if (!spec) throw new Error(`Unknown upgrade ${upgrade}. One of: ${BASE_UPGRADES.join(", ")}.`);
	requireAtBase(state, b, "Building upgrades works");
	if (b.upgrades.includes(upgrade)) throw new Error(`${b.name} already has a ${upgrade.replace("_", " ")}.`);
	if (b.building?.some((x) => x.upgrade === upgrade)) throw new Error(`The ${upgrade.replace("_", " ")} is already being built.`);
	const missing = STOCK_KINDS.filter((k) => (spec.cost[k] ?? 0) > b.stock[k]);
	if (missing.length) throw new Error(`Not enough in the stock for a ${upgrade.replace("_", " ")} (needs ${costText(spec.cost)}; have ${stockText(b.stock)}). Missing: ${missing.map((k) => `${(spec.cost[k] ?? 0) - b.stock[k]} ${k}`).join(", ")}.`);
	for (const k of STOCK_KINDS) if (spec.cost[k]) {
		b.stock[k] -= spec.cost[k]!;
		trimBucket(b, k);
	}
	const now = gameMinutes(state.time);
	const readyAt = now + spec.hours * 60;
	(b.building ??= []).push({ upgrade, readyAt });
	log(b, now, `started building a ${upgrade.replace("_", " ")}.`, "building", { upgrade });
	return `Building a ${upgrade.replace("_", " ")} at ${b.name}: used ${costText(spec.cost)}; ready in ${spec.hours} h of game time (day ${dayOf(readyAt)}, ${String(Math.floor((readyAt % 1440) / 60)).padStart(2, "0")}:${String(readyAt % 60).padStart(2, "0")}). Effect: ${spec.effect}. Building is work (hammering, hauling): narrate it; it finishes on its own as time passes.`;
}

// ─── ticks ─────────────────────────────────────────────────────────────────

/** Finishes builds due by `at` and refreshes the fortification. Runs after every tool (cheap). */
export function refreshBase(state: GameState, at: number): string[] {
	const b = baseOf(state);
	if (!b) return [];
	const out: string[] = [];
	const due = (b.building ?? []).filter((x) => x.readyAt <= at).sort((x, y) => x.readyAt - y.readyAt);
	if (due.length) {
		b.building = (b.building ?? []).filter((x) => x.readyAt > at);
		for (const d of due) {
			if (!b.upgrades.includes(d.upgrade)) b.upgrades.push(d.upgrade);
			(b.completedAt ??= {})[d.upgrade] = d.readyAt;
			if (d.upgrade === "generator") b.generatorOn = b.stock.fuel > 0;
			log(b, d.readyAt, `the ${d.upgrade.replace("_", " ")} is finished.`, "built", { upgrade: d.upgrade });
			out.push(`BASE: the ${d.upgrade.replace("_", " ")} at ${b.name} is finished (${UPGRADES[d.upgrade].effect}).`);
		}
	}
	b.fortification = fortificationOf(state, b);
	return out;
}

/**
 * The base's 08:00 (game minute `at`): finishes builds, production (rain
 * catcher, garden, generator fuel) and, for the latest 08:00 only, the daily
 * event roll (when an rng is given). Idempotent per 08:00.
 */
export function baseDailyTick(state: GameState, rng: Rng | undefined, at: number): string[] {
	const b = baseOf(state);
	if (!b || b.lastTick >= at) return [];
	const out = refreshBase(state, at);
	const made: string[] = [];
	const add = (k: StockKind, n: number) => {
		b.stock[k] += n;
		made.push(`${k} +${n}`);
	};
	if (b.upgrades.includes("rain_catcher")) add("water", /rain|storm/.test(state.scene.weather) ? 4 : 2);
	const garden = b.completedAt?.garden;
	if (b.upgrades.includes("garden") && garden !== undefined && at - garden >= 7 * 1440) add("food", 1);
	if (b.upgrades.includes("generator")) {
		if (b.stock.fuel >= 1) {
			b.stock.fuel -= 1;
			trimBucket(b, "fuel");
			b.generatorOn = true;
			made.push("fuel -1 (generator)");
		} else {
			if (b.generatorOn) out.push(`BASE: the generator at ${b.name} ran dry (no fuel): lights and the fridge are off, fortification -1.`);
			b.generatorOn = false;
		}
	}
	b.lastTick = at;
	b.fortification = fortificationOf(state, b);
	if (made.length) {
		log(b, at, `production: ${made.join(", ")}.`, "production", Object.fromEntries(made.map((m) => m.split(" ")).filter(([k]) => (STOCK_KINDS as readonly string[]).includes(k)).map(([k, n]) => [k, Number(n)])));
		out.push(`BASE ${b.name}, day ${dayOf(at)} 08:00: ${made.join(", ")}. Stock: ${stockText(b.stock)}.`);
	}
	// One event roll per tick, for the latest 08:00 passed (a long time jump doesn't pile events up).
	if (rng && gameMinutes(state.time) - at < 1440) {
		const ev = rollBaseEvent(state, rng, at);
		if (ev.kind) out.push(ev.text);
	}
	return out;
}

// ─── events ────────────────────────────────────────────────────────────────

export type BaseEventKind = "horde_probe" | "raiders" | "stranger" | "sickness" | "leaving" | "spoiled";
export const BASE_EVENTS: readonly BaseEventKind[] = ["horde_probe", "raiders", "stranger", "sickness", "leaving", "spoiled"];

export interface BaseEvent {
	chance: number;
	roll: number;
	kind?: BaseEventKind;
	/** The DM instruction (empty when nothing happens). */
	text: string;
}

const supplyWeight = (s: Stock) => s.food + s.water + s.meds + Math.floor(s.ammo / 10) + Math.floor(s.fuel / 5);

/** Noise at the base: the survival noise if the party is there, else nothing (no one shooting). */
function baseNoise(state: GameState): number {
	return atBase(state) ? (state.survival?.noise.level ?? 0) : 0;
}

/** Percent chance of a base event today. */
export function baseEventChance(state: GameState, b: BaseState): number {
	const day = outbreakDay(state);
	const sup = supplyWeight(b.stock);
	const smell = sup > 50 ? 10 : sup > 20 ? 5 : 0;
	return Math.max(3, Math.min(75, 10 + Math.min(20, 2 * day) + 4 * baseNoise(state) + smell - 3 * fortificationOf(state, b)));
}

function deadToday(state: GameState): MonsterStats[] {
	const day = outbreakDay(state);
	return MONSTERS.filter((m) => m.ruleset === "zombie" && /undead/.test(m.type) && !/swarm/.test(m.type) && (m.appearsDay ?? 0) <= day);
}

function survivorsAtBase(state: GameState) {
	return Object.values(state.group?.survivors ?? {}).filter((s) => s.status === "at_base");
}

function warning(b: BaseState): string {
	const w = [
		b.upgrades.includes("watchtower") ? "the watchtower spots it early (threats lose half their surprise; a few minutes to get ready)" : "",
		b.upgrades.includes("alarm_cans") ? "the alarm cans rattle (no one is caught asleep)" : "",
	].filter(Boolean);
	return w.length ? ` Warning: ${w.join("; ")}.` : " No warning: no watchtower or alarm cans.";
}

/**
 * Rolls the day's base event (secret roll: not in the dice log). Applies only
 * bookkeeping effects (spoiled stock, meds spent on sickness); fights and
 * scenes are DM instructions. Logs a short, player-safe line.
 */
export function rollBaseEvent(state: GameState, rng: Rng, at = gameMinutes(state.time)): BaseEvent {
	const b = requireBase(state);
	b.fortification = fortificationOf(state, b);
	const chance = baseEventChance(state, b);
	const roll = rng.int(1, 100);
	if (roll > chance) return { chance, roll, text: "" };
	const day = outbreakDay(state);
	const sup = supplyWeight(b.stock);
	const noise = baseNoise(state);
	const staying = survivorsAtBase(state);
	const weights: [BaseEventKind, number][] = [
		["horde_probe", 3 + noise + (day >= 7 ? 2 : 0)],
		["raiders", day >= 2 ? 1 + (sup > 20 ? 2 : 0) + (sup > 50 ? 2 : 0) : 0],
		["stranger", 2],
		["sickness", 1.5],
		["leaving", staying.length ? 1 + staying.filter((s) => s.morale <= 3).length * 2 : 0],
		["spoiled", b.stock.food + b.stock.meds > 0 ? 1 : 0],
	];
	let r = rng.next() * weights.reduce((n, [, w]) => n + w, 0);
	let kind: BaseEventKind = "horde_probe";
	for (const [k, w] of weights) {
		if (w <= 0) continue;
		r -= w;
		if (r < 0) {
			kind = k;
			break;
		}
	}
	const here = atBase(state);
	const where = here ? "The party is AT the base: play it out now." : `The party is away: ${staying.length ? `the survivors at the base (${staying.map((s) => state.npcs[s.npcId]?.name ?? s.npcId).join(", ")}) face it; tell it over the radio or when the player returns` : "nobody is home; the player finds the traces when they return"}.`;
	const map = b.mapId ? state.maps[b.mapId] : undefined;
	const walls = Object.keys(map?.barricades ?? {});
	const pre = `BASE EVENT at ${b.name} (day ${dayOf(at)}; ${chance}% chance, fortification ${b.fortification}/10):`;
	let text = "";
	let logText = "";
	const params: Record<string, string | number> = {};
	switch (kind) {
		case "horde_probe": {
			const pool = deadToday(state).filter((m) => !/horde/.test(m.index));
			const n = rng.int(2, 4) + Math.floor(day / 4) + Math.floor(noise / 3);
			const who = new Map<string, number>();
			for (let i = 0; i < n && pool.length; i++) {
				const m = rng.pick(pool).index;
				who.set(m, (who.get(m) ?? 0) + 1);
			}
			const list = [...who].map(([id, k]) => `${k} × ${id}`).join(", ");
			params.count = n;
			logText = "the dead pounded on the walls.";
			text = `${pre} THE DEAD PROBE THE WALLS: ${list} (the dead that exist on outbreak day ${day}) come at the base.${warning(b)} ${where} ${walls.length ? `Use damage_barricade on the base barricades (${walls.map((k) => `(${k})`).join(", ")}; use_map ${b.mapId} first if it isn't the active map): about 1d6 per round for a handful, more for a crowd. If one gives way, start_combat with them.` : "There are no barricades on the base map: they find a way in unless someone stops them (start_combat)."} Fortification ${b.fortification}+ means they may just give up after a while (DM's call).`;
			break;
		}
		case "raiders": {
			const thugs = rng.int(2, 3) + (day >= 10 ? 1 : 0);
			const gunmen = rng.int(0, 1) + (sup > 50 ? 1 : 0);
			const share = Math.max(1, Math.round(sup / 3));
			params.toll = share;
			logText = "raiders came to the gate.";
			text = `${pre} RAIDERS (they smelled the supplies: food ${b.stock.food}, water ${b.stock.water}, ammo ${b.stock.ammo}): ${thugs} × z-raider-thug${gunmen ? `, ${gunmen} × z-raider-gunman` : ""}${day >= 8 ? ", maybe z-raider-leader" : ""} demand a toll (about a third of the stock, ~${share} units of food/water/ammo) or they attack.${warning(b)} ${where} Play the standoff: paying means take the units off with take_from_stash (and narrate them hauled away); refusing means start_combat. A fortification ${b.fortification >= 5 ? "this high makes them think twice: they may haggle instead of attacking" : "this low emboldens them"}.`;
			break;
		}
		case "stranger": {
			logText = "a stranger came asking to join.";
			text = `${pre} A STRANGER at the gate asks to join (alone or with a kid; hungry; maybe bitten, maybe a raider scout: DM's call). ${where} Create them as an NPC (create_npc) with a profession and something they can do; if the player takes them in, add them to the group with the survivors tools. Turning them away has consequences too.`;
			break;
		}
		case "sickness": {
			if (b.stock.meds > 0) {
				b.stock.meds -= 1;
				trimBucket(b, "meds");
				logText = "a fever went round; 1 meds used.";
				params.meds = 1;
				text = `${pre} SICKNESS: a fever (bad water, a cut gone septic) goes round the base. 1 meds from the stock treats it (spent; meds now ${b.stock.meds}). Narrate it briefly${here ? "; the player was tired for a day (no mechanical cost)" : ""}.`;
			} else {
				logText = "a fever went round with no medicine.";
				params.meds = 0;
				text = `${pre} SICKNESS and NO MEDS in the stock: a fever goes round. ${staying.length ? "Each survivor at the base loses 1 morale (lower it with the survivors tools) and is weakened for a day. " : ""}${here ? "The player: saving_throw CON DC 11; on a failure +1 exhaustion (narrate the fever). " : ""}Medicine is now urgent (a pharmacy, the hospital).`;
			}
			break;
		}
		case "leaving": {
			const s = [...staying].sort((x, y) => x.morale - y.morale)[0];
			const who = s ? (state.npcs[s.npcId]?.name ?? s.npcId) : "a survivor";
			params.who = who;
			logText = `${who} talked about leaving.`;
			text = `${pre} SOMEONE WANTS TO LEAVE: ${who} (morale ${s?.morale ?? "?"}/10) wants out (fear, a grudge, family across the river). ${where} Play the conversation: the player can persuade them (a check), let them go (they may take some supplies) or worse. Update their status/morale with the survivors tools.`;
			break;
		}
		case "spoiled": {
			const fridge = b.upgrades.includes("generator") && b.generatorOn;
			const k: StockKind = b.stock.food > 0 && (fridge || b.stock.meds === 0 || rng.next() < 0.7) ? "food" : "meds";
			const lost = Math.min(b.stock[k], rng.int(1, 4));
			b.stock[k] -= lost;
			trimBucket(b, k);
			params.kind = k;
			params.qty = lost;
			logText = `${lost} ${k} spoiled.`;
			text = `${pre} SUPPLIES SPOILED: ${lost} ${k} lost (${k === "food" ? "rats, damp, a bad batch of cans" : "heat and damp ruined medicine"}${fridge ? "; the generator's fridge kept the meds safe" : ""}). Stock now: ${stockText(b.stock)}. Mention it when it fits.`;
			break;
		}
	}
	log(b, at, logText, `event.${kind}`, params);
	return { chance, roll, kind, text };
}

// ─── rest at the base ──────────────────────────────────────────────────────

/** At the base with fortification ≥ 3, a long rest is secured automatically. */
export function baseSecuresRest(state: GameState): { secured: boolean; fortification: number } | undefined {
	const b = baseOf(state);
	if (!b || !atBase(state)) return undefined;
	b.fortification = fortificationOf(state, b);
	return { secured: b.fortification >= 3, fortification: b.fortification };
}

/** After a completed long rest at the base: the infirmary heals the group and eases a fever (1 meds). */
export function infirmaryCare(state: GameState): string | undefined {
	const b = baseOf(state);
	if (!b || !atBase(state) || !b.upgrades.includes("infirmary")) return undefined;
	const notes: string[] = [];
	for (const s of Object.values(state.group?.survivors ?? {})) {
		if ((s.status === "at_base" || s.status === "with_party") && s.hp > 0 && s.hp < s.maxHp) s.hp = s.maxHp;
	}
	notes.push("The infirmary: everyone at the base is fully healed");
	const c = state.character;
	if (c.exhaustion > 0 && b.stock.meds > 0) {
		b.stock.meds -= 1;
		trimBucket(b, "meds");
		state.character = { ...c, exhaustion: c.exhaustion - 1 };
		notes.push(`1 meds eased the fever and fatigue: one more exhaustion level off (now ${state.character.exhaustion})`);
	}
	if (state.survival?.infection && state.survival.infection.stage !== "turned") notes.push("the bite infection is NOT slowed (nothing treats LAZARUS; DM only)");
	return `${notes.join("; ")}.`;
}

// ─── digest ────────────────────────────────────────────────────────────────

/** "Base:" line for the DM digest. */
export function baseDigest(state: GameState): string | undefined {
	const b = baseOf(state);
	if (!b) return undefined;
	const now = gameMinutes(state.time);
	const building = (b.building ?? []).map((x) => `${x.upgrade} (${Math.max(0, Math.ceil((x.readyAt - now) / 60))} h left)`);
	const events = b.log.slice(-3).map((l) => l.text);
	const parts = [
		`${b.name} at ${locationName(state, b.locationId)}${b.mapId ? ` [map ${b.mapId}]` : ""}${atBase(state) ? " (party HERE)" : " (party away)"}`,
		`fortification ${b.fortification}/10${b.fortification >= 3 ? " (long rest here is secured)" : " (below 3: rest here is not automatically secured)"}`,
		`stock: ${stockText(b.stock)}`,
		residentsDigest(state),
		`upgrades: ${b.upgrades.length ? b.upgrades.join(", ") : "none"}${b.upgrades.includes("generator") ? (b.generatorOn ? " (generator running)" : " (generator out of fuel)") : ""}${b.upgrades.includes("radio") ? " (radio: 101.7 FM and faction contact possible)" : ""}`,
		building.length ? `building: ${building.join(", ")}` : "",
		events.length ? `last: ${events.join(" | ")}` : "",
	];
	return `Base: ${parts.filter(Boolean).join("; ")}.`;
}
