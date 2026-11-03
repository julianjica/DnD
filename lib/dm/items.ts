import type { InventoryItem } from "../game/types";
import { itemFromEquipment } from "../rules/character";
import { getMagicItem } from "../srd";
import type { Ruleset } from "../rules/ruleset";
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
