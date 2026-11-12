/**
 * DungeonHarness combat engine — public API. See ./types.ts for the
 * CombatState → CombatResult contract and state conventions.
 */
export type { CombatEvent, CombatOptions, CombatResult, CombatState, FeatureUseOutcome, ItemUseOutcome, MonsterSpawn, PcCombatProfile, StartCombatInput } from "./types";
export { addMonsters, currentCombatant, endCombat, endTurn, removeCombatant, startCombat } from "./encounter";
export { applyPlayerAction, builtinFeatureFor, builtinItem, standUp } from "./player";
export { autoMonsterTurn, monsterAct, type MonsterActInput } from "./monster";
export { applyDamageTo, applyConditionTo, healTo, previewAttack, previewSpell, previewSpellArea, removeConditionFrom, type SpellPreview } from "./dm";
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
export { pickByKey, spellAttackProfile, spellDamageDice, spellRangeFeet } from "./spells";
export { actionKey, healOptions, hitChance, isMindless, isWayOut, pcNextAction, shouldFlee, slotFor, threatOf, type DeckProgram, type PcPolicyInput } from "./auto";
