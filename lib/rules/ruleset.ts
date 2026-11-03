/**
 * Rulesets: the classic fantasy game and "The Quiet", a modern zombie
 * apocalypse (docs/zombie.md). The ruleset is fixed when a campaign is created
 * (by its world preset) and decides which content is OFFERED: species vs
 * origins, spells vs techniques, fantasy vs modern gear and monsters. The
 * engine itself is shared; content ids never collide (zombie content uses
 * z-/t- prefixed indices and a `ruleset: "zombie"` marker).
 */
export type Ruleset = "fantasy" | "zombie";

export const ZOMBIE_PRESET = "zombie_outbreak" as const;

export function rulesetOf(s: { world: { preset: string } } | undefined | null): Ruleset {
	return s?.world.preset === ZOMBIE_PRESET ? "zombie" : "fantasy";
}

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
