/**
 * Rulesets: the classic fantasy game, "Root Access" (a cyberpunk hacker story,
 * docs/cyberpunk.md; content ids c-/p- prefixed, marker "cyberpunk") and "The Quiet", a modern zombie
 * apocalypse (docs/zombie.md). The ruleset is fixed when a campaign is created
 * (by its world preset) and decides which content is OFFERED: species vs
 * origins, spells vs techniques, fantasy vs modern gear and monsters. The
 * engine itself is shared; content ids never collide (zombie content uses
 * z-/t- prefixed indices and a `ruleset: "zombie"` marker).
 */
export type Ruleset = "fantasy" | "zombie" | "cyberpunk";

export const ZOMBIE_PRESET = "zombie_outbreak" as const;
/** Root Access (docs/cyberpunk.md): a hacker story in Marea, opening on "Burned". */
export const CYBER_PRESET = "marea_burned" as const;

export function rulesetOf(s: { world: { preset: string } } | undefined | null): Ruleset {
	return s?.world.preset === ZOMBIE_PRESET ? "zombie" : s?.world.preset === CYBER_PRESET ? "cyberpunk" : "fantasy";
}

/**
 * Modern rulesets share the modern world: no magic, firearms with ammo, modern
 * gear and portraits, the modern map theme, "techniques"/"programs" instead of
 * spells. Zombie-only systems (infection, noise and hordes, needs, scavenging,
 * the base and group) still check for "zombie" itself.
 */
export const isModern = (rs: Ruleset): boolean => rs !== "fantasy";

/** Entries that belong to a ruleset carry this marker; unmarked entries are fantasy (SRD). */
export interface RulesetTagged {
	ruleset?: Ruleset;
}

/** Content offered in a ruleset: fantasy shows unmarked entries, zombie shows only zombie-marked ones. */
export function offeredIn<T extends RulesetTagged>(list: readonly T[], rs: Ruleset): T[] {
	return list.filter((x) => (x.ruleset ?? "fantasy") === rs);
}

/**
 * The Quiet: days since the outbreak. Zombie campaigns start on game day 1 at
 * night, the outbreak night, which is Day 0; so outbreak day = time.day - 1.
 * Used to decide which variants of the dead exist yet (MonsterStats.appearsDay).
 */
export function outbreakDay(state: { time: { day: number } }): number {
	return Math.max(0, state.time.day - 1);
}

/** The word for a spell in a ruleset: "spell" (fantasy), "technique" (The Quiet), "program" (Root Access). */
export function spellNoun(rs: Ruleset, plural = false): string {
	const w = rs === "zombie" ? "technique" : rs === "cyberpunk" ? "program" : "spell";
	return plural ? `${w}s` : w;
}

/** Index prefix of a modern ruleset's own gear and monsters ("z-" The Quiet, "c-" Root Access; "" fantasy). */
export function contentPrefix(rs: Ruleset): string {
	return rs === "zombie" ? "z-" : rs === "cyberpunk" ? "c-" : "";
}

/** Short display name of a ruleset for messages ("The Quiet", "Root Access", "a fantasy campaign"). */
export function rulesetName(rs: Ruleset): string {
	return rs === "zombie" ? "The Quiet" : rs === "cyberpunk" ? "Root Access" : "a fantasy campaign";
}
