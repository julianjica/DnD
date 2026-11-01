/**
 * DungeonHarness combat engine — public API. See ./types.ts for the
 * CombatState → CombatResult contract and state conventions.
 */
export type { CombatEvent, CombatOptions, CombatResult, CombatState, FeatureUseOutcome, ItemUseOutcome, MonsterSpawn, PcCombatProfile, StartCombatInput } from "./types";
export { addMonsters, currentCombatant, endCombat, endTurn, removeCombatant, startCombat } from "./encounter";
export { applyPlayerAction, standUp } from "./player";
export { autoMonsterTurn, monsterAct, type MonsterActInput } from "./monster";
export { applyDamageTo, applyConditionTo, healTo, previewAttack, previewSpellArea, removeConditionFrom } from "./dm";
export {
	areaSquares,
	canSee,
	combatantsInSquares,
	COVER_AC,
	coverBetween,
	type Cover,
	distanceFeet,
	findPath,
	footprintOf,
	hasLineOfSight,
	isDifficultTile,
	isPassableTile,
	nearestFreeSquare,
	type PathResult,
	type Point,
	reachable,
	sizeSquares,
} from "./grid";
export { type AttackProfile, averageDamage, characterLevel, derivePcProfile, estimateAc, monsterAttackProfile, pcAttackProfile, proficiencyBonus } from "./profile";
export { spellDamageDice, spellRangeFeet } from "./spells";
