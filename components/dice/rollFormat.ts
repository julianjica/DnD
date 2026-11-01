import type { RollRecord } from "@/lib/game/types";
import { critKind } from "./diceGeometry";
import type { MessageKey } from "@/lib/i18n";

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

/** Dictionary key for the roll's outcome (translate with t()), or null when there is none. */
export function outcomeText(rec: RollRecord): MessageKey | null {
	if (rec.critical === "hit") return "play.dice.critHit";
	if (rec.critical === "miss") return "play.dice.critMiss";
	if (rec.success === undefined) return null;
	return rec.success ? "play.dice.success" : "play.dice.failure";
}

export { critKind };
