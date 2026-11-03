import type { GameState, MonsterStats } from "../game/types";
import { outbreakDay, rulesetOf, type Ruleset } from "../rules/ruleset";
import {
	EQUIPMENT, MONSTERS, SPECIES, getEquipment, getMagicItem, getMonster, getSpecies, getSpell, lookup, toIndex,
	type EquipmentData, type LookupHit,
} from "../srd";

/**
 * Ruleset-aware access to content for the DM tools. A campaign only sees its
 * own ruleset's monsters, spells/techniques, equipment and species/origins
 * (shared categories such as conditions, skills and classes are always
 * offered). In The Quiet the dead also evolve: a variant whose `appearsDay`
 * is later than the current outbreak day (lib/rules/ruleset.ts outbreakDay)
 * doesn't exist yet.
 */

const rsOf = (x: { ruleset?: Ruleset } | undefined): Ruleset | undefined => (x ? (x.ruleset ?? "fantasy") : undefined);

/** Ruleset of a lookup hit; undefined = shared by every ruleset. */
export function hitRuleset(h: Pick<LookupHit, "category" | "index">): Ruleset | undefined {
	switch (h.category) {
		case "monster": return rsOf(getMonster(h.index));
		case "spell": return rsOf(getSpell(h.index));
		case "equipment": return rsOf(getEquipment(h.index));
		case "species": return rsOf(getSpecies(h.index));
		case "subspecies": return rsOf(SPECIES.find((s) => s.subspecies.some((x) => x.index === h.index)));
		case "magic-item": return "fantasy";
		default: return undefined;
	}
}

const crText = (cr: number) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));

/** Monsters the DM may use right now in this campaign. */
export function availableMonsters(state: Pick<GameState, "settings" | "time">): MonsterStats[] {
	const rs = rulesetOf(state.settings);
	const day = outbreakDay(state);
	return MONSTERS.filter((m) => rsOf(m) === rs && (rs !== "zombie" || (m.appearsDay ?? 0) <= day));
}

function bestiaryText(state: Pick<GameState, "settings" | "time">): string {
	const day = outbreakDay(state);
	const now = availableMonsters(state).map((m) => `${m.index} (${m.name}, CR ${crText(m.cr)})`);
	const later = MONSTERS.filter((m) => m.ruleset === "zombie" && (m.appearsDay ?? 0) > day).map((m) => `${m.name} from Day ${m.appearsDay}`);
	return `Outbreak Day ${day}. Available now: ${now.join(", ")}.${later.length ? ` Not yet: ${later.join(", ")}.` : ""}`;
}

/** Resolves a monster for start_combat/add_monsters, refusing other rulesets and variants that don't exist yet. */
export function monsterForCampaign(state: Pick<GameState, "settings" | "time">, ref: string): MonsterStats {
	const rs = rulesetOf(state.settings);
	const m = rs === "zombie" ? (getMonster(ref.startsWith("z-") ? ref : `z-${toIndex(ref)}`) ?? getMonster(ref)) : getMonster(ref);
	if (!m) throw new Error(`Unknown monster '${ref}'. ${rs === "zombie" ? bestiaryText(state) : "Use lookup_srd."}`);
	if (rsOf(m) !== rs) {
		throw new Error(rs === "zombie"
			? `'${m.name}' is fantasy content; The Quiet only has the dead, animals and the living. ${bestiaryText(state)}`
			: `'${m.name}' belongs to the zombie ruleset, not this campaign. Use lookup_srd for SRD monsters.`);
	}
	if (rs === "zombie" && (m.appearsDay ?? 0) > outbreakDay(state)) {
		throw new Error(`${m.name} doesn't exist yet: this variant first appears on Day ${m.appearsDay} of the outbreak. ${bestiaryText(state)}`);
	}
	return m;
}

/** Equipment matching a give_item ref/name in this campaign's ruleset (undefined = none). */
export function equipmentForCampaign(rs: Ruleset, ref: string | undefined, name: string): EquipmentData | undefined {
	if (ref) {
		const eq = getEquipment(rs === "zombie" && !ref.startsWith("z-") ? `z-${toIndex(ref)}` : ref) ?? getEquipment(ref);
		return eq && rsOf(eq) === rs ? eq : undefined;
	}
	const n = name.trim().toLowerCase();
	const own = EQUIPMENT.filter((e) => rsOf(e) === rs);
	const hit = own.find((e) => e.name.toLowerCase() === n) ?? (rs === "zombie" ? getEquipment(`z-${toIndex(name)}`) : getEquipment(name));
	return hit && rsOf(hit) === rs ? hit : undefined;
}

/** Throws when an explicit ref names content from the other ruleset (or a magic item in The Quiet). */
export function assertItemRef(rs: Ruleset, ref: string | undefined): void {
	if (!ref) return;
	if (equipmentForCampaign(rs, ref, "")) return;
	const other = getEquipment(ref) ?? getMagicItem(ref);
	if (other && rs === "zombie") {
		const near = lookup(ref, { category: "equipment", limit: 40 }).filter((h) => hitRuleset(h) === "zombie").slice(0, 5).map((h) => `${h.index} (${h.name})`);
		throw new Error(`'${other.name}' doesn't exist in The Quiet (no fantasy gear or magic items).${near.length ? ` Closest modern items: ${near.join(", ")}.` : " Use lookup_srd 'item: …' for modern gear (z- indices)."}`);
	}
	if (other && rs === "fantasy" && "ruleset" in other && other.ruleset === "zombie") throw new Error(`'${other.name}' is modern gear from the zombie ruleset, not this campaign.`);
}

/** lookup_srd for a campaign: only its ruleset's content, the dead tagged by when they appear. */
export function lookupForCampaign(state: Pick<GameState, "settings" | "time">, query: string, limit: number): string {
	const rs = rulesetOf(state.settings);
	const hits = lookup(query, { limit: 400, long: false }).filter((h) => (hitRuleset(h) ?? rs) === rs).slice(0, limit);
	const day = outbreakDay(state);
	const lines = hits.map((h, i) => {
		// The best hit gets the long summary (an exact index lookup scores highest).
		let summary = i === 0 ? (lookup(h.index, { category: h.category, limit: 1, long: true })[0]?.summary ?? h.summary) : h.summary;
		if (rs === "zombie" && h.category === "monster") {
			const ad = getMonster(h.index)?.appearsDay;
			if (ad !== undefined) summary += ad > day ? ` NOT YET: appears on Day ${ad} (now Day ${day}).` : ` Appears from Day ${ad}.`;
		}
		return `[${h.category === "spell" && rs === "zombie" ? "technique" : h.category}] ${summary}`;
	});
	const wantsMonsters = /^(monster|creature)\s*:/i.test(query.trim()) || /\b(zombie|dead|undead|horde|bestiary)\b/i.test(query);
	if (rs === "zombie" && (wantsMonsters || !lines.length)) lines.push(`[bestiary] ${bestiaryText(state)}`);
	return lines.length ? lines.join("\n\n") : `No ${rs === "zombie" ? "Quiet" : "SRD"} entry matches "${query}".`;
}
