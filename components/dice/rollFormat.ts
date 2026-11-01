import type { RollRecord } from "@/lib/game/types";
import { critKind } from "./diceGeometry";

export interface RollChip {
	sides: number;
	value: number;
	dropped: boolean;
	nat: "gold" | "red" | null;
}

/** Per-die chips for display (d20 naturals flagged). */
export function rollChips(rec: RollRecord): RollChip[] {
	return rec.dice.map((d) => ({
		sides: d.sides,
		value: d.value,
		dropped: !!d.dropped,
		nat: d.sides === 20 && !d.dropped ? (d.value === 20 ? "gold" : d.value === 1 ? "red" : null) : null,
	}));
}

export function signedMod(n: number): string {
	return n >= 0 ? `+ ${n}` : `− ${Math.abs(n)}`;
}

/** "17 (4 dropped) + 5" style plain-text breakdown. */
export function breakdownText(rec: RollRecord): string {
	const parts = rec.dice.map((d) => (d.dropped ? `~${d.value}~` : String(d.value)));
	const mod = rec.modifier ? ` ${signedMod(rec.modifier)}` : "";
	return `[${parts.join(", ")}]${mod}`;
}

export function outcomeText(rec: RollRecord): string | null {
	if (rec.critical === "hit") return "Critical hit";
	if (rec.critical === "miss") return "Critical miss";
	if (rec.success === undefined) return null;
	return rec.success ? "Success" : "Failure";
}

export { critKind };
