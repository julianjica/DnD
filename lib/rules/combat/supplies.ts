import type { Character, InventoryItem } from "../../game/types";

/**
 * Inventory supplies that actions use up: ammunition for weapons whose
 * equipment entry names an `ammo` item, and the components a technique
 * `consumes` (The Quiet). Items match by equipment index (`ref`), or by the
 * item's display name when given `nameOf` (hand-added items without a ref).
 */
export interface SupplyNeed {
	ref: string;
	qty: number;
}

type NameOf = (ref: string) => string | undefined;

const lc = (s: string) => s.trim().toLowerCase();

function matching(inv: InventoryItem[], ref: string, nameOf?: NameOf): InventoryItem[] {
	const name = nameOf?.(ref);
	return inv.filter((i) => i.quantity > 0 && (i.ref === ref || (!i.ref && !!name && lc(i.name) === lc(name))));
}

/** How many of `ref` the character carries. */
export function supplyCount(c: Pick<Character, "inventory">, ref: string, nameOf?: NameOf): number {
	return matching(c.inventory, ref, nameOf).reduce((n, i) => n + i.quantity, 0);
}

/** Human-readable shortfalls ("Gasoline Can (have 0, need 1)"); empty when everything is there. */
export function missingSupplies(c: Pick<Character, "inventory">, needs: readonly SupplyNeed[], nameOf?: NameOf): string[] {
	const out: string[] = [];
	for (const n of needs) {
		const have = supplyCount(c, n.ref, nameOf);
		if (have < n.qty) out.push(`${nameOf?.(n.ref) ?? n.ref} (have ${have}, need ${n.qty})`);
	}
	return out;
}

/** Removes the needed quantities (across stacks); emptied stacks leave the inventory. Check with missingSupplies first. */
export function spendSupplies(c: Pick<Character, "inventory">, needs: readonly SupplyNeed[], nameOf?: NameOf): void {
	const emptied = new Set<InventoryItem>();
	for (const n of needs) {
		let left = n.qty;
		for (const item of matching(c.inventory, n.ref, nameOf)) {
			const take = Math.min(left, item.quantity);
			item.quantity -= take;
			left -= take;
			if (item.quantity <= 0) emptied.add(item);
			if (!left) break;
		}
	}
	if (emptied.size) c.inventory = c.inventory.filter((i) => !emptied.has(i));
}

/** "Used 1 × 9mm Rounds (14 left)" style summary. */
export function suppliesText(c: Pick<Character, "inventory">, needs: readonly SupplyNeed[], nameOf?: NameOf): string {
	return needs.map((n) => `${n.qty} × ${nameOf?.(n.ref) ?? n.ref} (${supplyCount(c, n.ref, nameOf)} left)`).join(", ");
}
