import type { InventoryItem } from "../game/types";
import { itemFromEquipment } from "../rules/character";
import { getEquipment, getMagicItem } from "../srd";

/** Fills weapon/armor stats and descriptions from the SRD when `ref` (or the name) matches. */
export function enrichItem(item: InventoryItem): void {
	const ref = item.ref ?? item.name;
	const eq = getEquipment(ref);
	if (eq) {
		const base = itemFromEquipment(eq.index, item.quantity, item.id);
		Object.assign(item, { ...base, name: item.name || base.name, quantity: item.quantity, description: item.description ?? base.description });
		return;
	}
	const magic = getMagicItem(ref) as { index: string; name: string; description?: string; desc?: string; rarity?: string } | undefined;
	if (magic) {
		item.ref = magic.index;
		item.description ??= magic.description ?? magic.desc;
		if (item.category === "gear") item.category = /potion/i.test(magic.name) ? "potion" : /scroll/i.test(magic.name) ? "scroll" : "magic";
	}
}
