/** Spell slot tables: single-class, multiclass caster level and Pact Magic. */
import type { ClassLevel } from "../../game/types";
import { getClass } from "../../srd/index";
import type { CasterType } from "../../srd/types";
import { FULL_CASTER_SLOTS, PACT_SLOTS } from "./tables";

export function casterType(classId: string): CasterType {
	return getClass(classId)?.spellcasting?.type ?? "none";
}

/**
 * Multiclass spellcaster level (PHB/SRD "Multiclassing"): full levels +
 * half of paladin/ranger levels (rounded down) + a third of third-caster
 * levels (rounded down). Warlock levels don't count.
 */
export function multiclassCasterLevel(classes: ClassLevel[]): number {
	let lvl = 0;
	for (const c of classes) {
		const t = casterType(c.classId);
		if (t === "full") lvl += c.level;
		else if (t === "half") lvl += Math.floor(c.level / 2);
		else if (t === "third") lvl += Math.floor(c.level / 3);
	}
	return lvl;
}

/** Slots for one class at a class level, as if single-classed (index 0 = 1st level). */
export function classSlots(classId: string, level: number): number[] {
	const cls = getClass(classId);
	if (!cls?.spellcasting || cls.spellcasting.type === "pact") return Array(9).fill(0);
	const row = cls.levels.find((l) => l.level === level);
	return row?.slots ? [...row.slots] : Array(9).fill(0);
}

export function pactSlots(warlockLevel: number): { level: number; max: number } | undefined {
	if (warlockLevel < 1) return undefined;
	const [max, level] = PACT_SLOTS[Math.min(20, warlockLevel)];
	return { level, max };
}

/** Highest spell level a class can learn/prepare at a class level (single-class rule). */
export function maxSpellLevelFor(classId: string, level: number): number {
	const t = casterType(classId);
	if (t === "pact") return pactSlots(level)?.level ?? 0;
	const slots = classSlots(classId, level);
	let max = 0;
	slots.forEach((n, i) => {
		if (n > 0) max = i + 1;
	});
	return max;
}

export interface SlotSummary {
	slots: number[];
	pact?: { level: number; max: number };
	casterLevel: number;
}

/** Spell slots for a (possibly multiclassed) character. */
export function computeSlots(classes: ClassLevel[]): SlotSummary {
	const casters = classes.filter((c) => {
		const t = casterType(c.classId);
		return t === "full" || t === "half" || t === "third";
	});
	const warlock = classes.find((c) => casterType(c.classId) === "pact");
	let slots: number[] = Array(9).fill(0);
	let casterLevel = 0;
	if (casters.length === 1) {
		slots = classSlots(casters[0].classId, casters[0].level);
		casterLevel = multiclassCasterLevel(casters);
	} else if (casters.length > 1) {
		casterLevel = multiclassCasterLevel(casters);
		slots = [...FULL_CASTER_SLOTS[Math.min(20, casterLevel)]];
	}
	const pact = warlock ? pactSlots(warlock.level) : undefined;
	return { slots, casterLevel, ...(pact ? { pact } : {}) };
}
