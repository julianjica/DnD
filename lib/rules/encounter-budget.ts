/**
 * Encounter budgeting (SRD/DMG XP thresholds) for a SOLO player character.
 * The engine uses this to keep fights winnable at the chosen difficulty and to
 * keep NPC allies in a supporting role so the player stays the protagonist.
 */

/** [easy, medium, hard, deadly] XP thresholds per character level. */
export const XP_THRESHOLDS_BY_LEVEL: Record<number, [number, number, number, number]> = {
	1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400], 4: [125, 250, 375, 500],
	5: [250, 500, 750, 1100], 6: [300, 600, 900, 1400], 7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100],
	9: [550, 1100, 1600, 2400], 10: [600, 1200, 1900, 2800], 11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500],
	13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400], 16: [1600, 3200, 4800, 7200],
	17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500], 19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700],
};

export type Difficulty = "story" | "easy" | "normal" | "hard" | "deadly";
export type Band = "trivial" | "easy" | "medium" | "hard" | "deadly" | "beyond deadly";

/** Monster-count multiplier, shifted one step up because the party is a single character. */
export function soloMultiplier(count: number): number {
	if (count <= 0) return 0;
	if (count === 1) return 1.5;
	if (count === 2) return 2;
	if (count <= 6) return 2.5;
	if (count <= 10) return 3;
	if (count <= 14) return 4;
	return 5;
}

/** Highest adjusted XP allowed for each campaign difficulty. */
export function budgetCap(level: number, difficulty: Difficulty): number {
	const [easy, medium, hard, deadly] = XP_THRESHOLDS_BY_LEVEL[Math.max(1, Math.min(20, level))];
	switch (difficulty) {
		case "story": return easy;
		case "easy": return medium;
		case "normal": return hard;
		case "hard": return deadly;
		case "deadly": return Math.round(deadly * 1.5);
	}
}

export function band(level: number, adjustedXp: number): Band {
	const [easy, medium, hard, deadly] = XP_THRESHOLDS_BY_LEVEL[Math.max(1, Math.min(20, level))];
	if (adjustedXp > deadly) return "beyond deadly";
	if (adjustedXp >= deadly) return "deadly";
	if (adjustedXp >= hard) return "hard";
	if (adjustedXp >= medium) return "medium";
	if (adjustedXp >= easy) return "easy";
	return "trivial";
}

/**
 * Most XP the player's allies may add up to: the PC's medium threshold, so
 * NPCs can really help (a couple of guards, a veteran-ish captain at higher
 * levels) while the player stays the strongest on their side.
 */
export function allyCap(level: number): number {
	return XP_THRESHOLDS_BY_LEVEL[Math.max(1, Math.min(20, level))][1];
}

/** Allies let the fight be bigger: the enemy cap grows by 1.5× their XP. */
export function allyBonus(allyXp: number): number {
	return Math.round(allyXp * 1.5);
}

export interface BudgetCheck {
	ok: boolean;
	enemyXp: number;
	adjustedXp: number;
	cap: number;
	band: Band;
	allyXp: number;
	allyCap: number;
	allyOk: boolean;
	summary: string;
}

/** Evaluates enemies/allies (XP values of each creature) against the solo budget. */
export function checkBudget(level: number, difficulty: Difficulty, enemyXps: number[], allyXps: number[] = []): BudgetCheck {
	const enemyXp = enemyXps.reduce((a, b) => a + b, 0);
	const adjustedXp = Math.round(enemyXp * soloMultiplier(enemyXps.length));
	const allyXp = allyXps.reduce((a, b) => a + b, 0);
	const cap = budgetCap(level, difficulty) + allyBonus(Math.min(allyXp, allyCap(level)));
	const aCap = allyCap(level);
	const b = band(level, adjustedXp);
	const ok = adjustedXp <= cap;
	const allyOk = allyXp <= aCap;
	const summary = `Encounter budget (level ${level}, ${difficulty}): ${enemyXps.length} enemies, ${enemyXp} XP × ${soloMultiplier(enemyXps.length)} = ${adjustedXp} adjusted (${b}); cap ${cap}${allyXp ? ` (incl. +${allyBonus(Math.min(allyXp, aCap))} for allies)` : ""}.${allyXps.length ? ` Allies ${allyXp} XP (cap ${aCap}).` : ""}`;
	return { ok, enemyXp, adjustedXp, cap, band: b, allyXp, allyCap: aCap, allyOk, summary };
}
