import type { Character, CyberState, GameState, InstalledImplant } from "../game/types";
import type { EquipmentData } from "../srd/types";
import { getEquipment } from "../srd";
import { abilityMod } from "./dice";
import { profBonusOf } from "./character/derived";
import { rulesetOf } from "./ruleset";

/**
 * Root Access decks (docs/cyberpunk.md §2, §6). Everyone has a neural jack and
 * can hack with a deck: d20 + Intelligence + proficiency + the deck's tier.
 * The best deck carried counts; an equipped one wins ties.
 */
export interface CarriedDeck {
	itemId: string;
	ref: string;
	name: string;
	deck: NonNullable<EquipmentData["deck"]>;
}

export function deckOf(c: Character): CarriedDeck | undefined {
	let best: (CarriedDeck & { equipped: boolean }) | undefined;
	for (const it of c.inventory) {
		const eq = it.ref ? getEquipment(it.ref) : undefined;
		if (!eq?.deck || it.quantity <= 0) continue;
		const cand = { itemId: it.id, ref: eq.index, name: it.name || eq.name, deck: eq.deck, equipped: !!it.equipped };
		if (!best || cand.deck.tier > best.deck.tier || (cand.deck.tier === best.deck.tier && cand.equipped && !best.equipped)) best = cand;
	}
	if (!best) return undefined;
	const { equipped: _equipped, ...deck } = best;
	void _equipped;
	return deck;
}

/** The deck's tier, or undefined with no deck (hacking without a deck is only for the Wetwired, by their class text). */
export const deckTier = (c: Character): number | undefined => deckOf(c)?.deck.tier;

/** The bonus to a hack check (breach, access, take admin): Intelligence + proficiency + deck tier. */
export function hackBonus(c: Character): number {
	return abilityMod(c.abilities.int) + profBonusOf(c) + (deckTier(c) ?? 0);
}

// ─── built-in programs as charges ───────────────────────────────────────────

/** Charges of EACH built-in program per long rest: the deck's tier + 1. */
export const deckChargesMax = (c: Character): number => {
	const t = deckTier(c);
	return t === undefined ? 0 : t + 1;
};

/** A built-in program's attack bonus and save DC: Intelligence + proficiency + the deck's tier (whatever the class). */
export function deckProgramNumbers(c: Character, extra = 0): { attackBonus: number; saveDc: number } {
	const attackBonus = hackBonus(c) + extra;
	return { attackBonus, saveDc: 8 + attackBonus };
}

/** Charges spent of one built-in program since the last long rest. */
export const deckUsesOf = (cy: Pick<CyberState, "deckUses"> | undefined, program: string): number => cy?.deckUses?.[program] ?? 0;

/** Long rest: every built-in program's charges come back. */
export function resetDeckUses(state: Pick<GameState, "cyber">): void {
	if (state.cyber?.deckUses) delete state.cyber.deckUses;
}

// ─── RAM: extra level-1 program slots ───────────────────────────────────────

export const RAM_IMPLANT = "c-ram-expansion";
export const RAM_TRAIT = "c-experimental-jack";

/**
 * Extra level-1 slots a Root Access character gets: +1 each for the carried
 * deck's `ram`, an installed RAM expansion, and the experimental jack (origin
 * trait). Installed implants live in the cyber state, not on the character.
 */
export function ramBonus(c: Character, implants: readonly Pick<InstalledImplant, "ref">[] = []): number {
	const deck = deckOf(c)?.deck.ram ?? 0;
	const implant = implants.some((i) => i.ref === RAM_IMPLANT) ? 1 : 0;
	const jack = c.features.some((f) => f.id === RAM_TRAIT) ? 1 : 0;
	return deck + implant + jack;
}

/**
 * Keeps the RAM bonus folded into spellcasting.slots[0] (every reader of slots
 * sees it). Only characters that already have program slots get it; never
 * outside Root Access. Idempotent; runs after every state mutation.
 */
export function syncRamSlots(state: Pick<GameState, "character" | "cyber" | "settings">): void {
	const sc = state.character.spellcasting;
	if (!sc) return;
	const prev = sc.ramBonus ?? 0;
	const base = Math.max(0, (sc.slots[0] ?? 0) - prev);
	const caster = base > 0 || sc.slots.slice(1).some((n) => n > 0) || (sc.pact?.max ?? 0) > 0;
	const cyber = rulesetOf(state.settings) === "cyberpunk";
	// The den's RAM rack (+1 a level) and cooling while jacked in (lib/rules/den.ts).
	const next = cyber && caster ? ramBonus(state.character, state.cyber?.implants) + (state.cyber?.den?.upgrades.ram_rack ?? 0) : 0;
	const overclock = cyber && state.cyber?.run && state.cyber.den?.upgrades.cooling ? 1 : 0;
	if (overclock) sc.overclock = overclock;
	else delete sc.overclock;
	if (next === prev) return;
	while (sc.slots.length < 1) sc.slots.push(0);
	sc.slots[0] = base + next;
	if (next) sc.ramBonus = next;
	else delete sc.ramBonus;
	if ((sc.slotsUsed[0] ?? 0) > sc.slots[0]) sc.slotsUsed[0] = sc.slots[0];
}
