import type { GameState, InventoryItem } from "../game/types";
import { itemFromEquipment } from "../rules/character";
import { getMagicItem } from "../srd";
import { rulesetOf, type Ruleset } from "../rules/ruleset";
import { equipmentForCampaign } from "./content";

/**
 * Fills weapon/armor stats and descriptions from the campaign's own content
 * when `ref` (or the name) matches: fantasy campaigns use the SRD, zombie
 * campaigns only modern gear (no magic items).
 */
export function enrichItem(item: InventoryItem, rs: Ruleset = "fantasy"): void {
	const eq = equipmentForCampaign(rs, item.ref, item.name);
	if (eq) {
		const base = itemFromEquipment(eq.index, item.quantity, item.id);
		Object.assign(item, { ...base, name: item.name || base.name, quantity: item.quantity, description: item.description ?? base.description });
		return;
	}
	if (rs === "zombie") return;
	const magic = getMagicItem(item.ref ?? item.name) as { index: string; name: string; description?: string; desc?: string; rarity?: string } | undefined;
	if (magic) {
		item.ref = magic.index;
		item.description ??= magic.description ?? magic.desc;
		if (item.category === "gear") item.category = /potion/i.test(magic.name) ? "potion" : /scroll/i.test(magic.name) ? "scroll" : "magic";
	}
}

/**
 * Adds `quantity` of an item to the PC's inventory the way give_item does:
 * stacks onto an existing non-weapon, non-armor item of the same name, else
 * creates a new entry with stats filled from the campaign's content.
 */
export function addInventoryItem(state: GameState, a: { name: string; quantity: number; ref?: string; description?: string; category?: string }, newItemId: () => string): InventoryItem {
	const rs = rulesetOf(state.settings);
	const existing = state.character.inventory.find((i) => i.name.toLowerCase() === a.name.toLowerCase() && !i.weapon && !i.armor);
	if (existing) {
		existing.quantity += a.quantity;
		return existing;
	}
	const item: InventoryItem = { id: newItemId(), ref: a.ref, name: a.name, quantity: a.quantity, description: a.description, category: a.category ?? "gear" };
	enrichItem(item, rs);
	state.character.inventory.push(item);
	return item;
}
