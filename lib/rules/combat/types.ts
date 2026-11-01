import type {
	Ability,
	ActiveCondition,
	Character,
	ConditionId,
	DamageType,
	Encounter,
	Feature,
	GridMap,
	InventoryItem,
	RollRecord,
	SpellInfo,
} from "../../game/types";

/**
 * Combat engine contracts.
 *
 * Every public engine function takes a `CombatState` (plus an `Rng` and an
 * optional `CombatOptions`) and returns a `CombatResult`. Inputs are never
 * mutated (they are structuredClone'd). A rejected action returns
 * `ok: false` with `error`, the ORIGINAL state objects, and restores the Rng
 * to its entry state (no randomness consumed).
 *
 * During combat the PC `Combatant` is authoritative for hp/tempHp/conditions/
 * deathSaves/concentration; every result mirrors those back into `character`
 * (when a character was supplied).
 *
 * Conventions for state that has no dedicated field in lib/game/types.ts:
 * - Hidden: `MapEntity.hidden = true` and `usage["__hidden"].used = stealth total`.
 * - Help: `usage["__helped"]` on an ally (adv on its next attack) and
 *   `usage["__helpAgainst"]` on an enemy (next attack against it has adv).
 * - Turn-local flags: keys starting with `__turn_` in `usage` are cleared at the
 *   start of the owner's turn (e.g. `__turn_attacked`, `__turn_deathSave`).
 * - Stable PC: hp 0 and `deathSaves.successes >= 3`.
 * - Fled: the combatant is removed from `combatants` and `order` (event `removed`).
 * - Dead monsters keep their map entity (corpse) but never block movement,
 *   grant cover, threaten opportunity attacks, or take turns.
 * - Spell-caused conditions use `source = "conc:<casterId>:<spellIndex>"` so
 *   they end automatically when that concentration breaks.
 */

export interface CombatState {
	encounter: Encounter;
	map: GridMap;
	character?: Character;
}

export type CombatEvent =
	| { type: "combat_started"; order: string[] }
	| { type: "initiative"; combatantId: string; total: number }
	| { type: "round_start"; round: number }
	| { type: "turn_start"; combatantId: string; round: number }
	| { type: "turn_end"; combatantId: string }
	| { type: "move"; combatantId: string; path: { x: number; y: number }[]; cost: number }
	| { type: "stand_up"; combatantId: string }
	| { type: "opportunity_attack"; attackerId: string; targetId: string }
	| { type: "attack"; attackerId: string; targetId: string; name: string; hit: boolean; crit: boolean; rollId: string }
	| { type: "damage"; targetId: string; amount: number; damageType?: DamageType; sourceId?: string; hpAfter: number }
	| { type: "heal"; targetId: string; amount: number; hpAfter: number }
	| { type: "save"; targetId: string; ability: Ability; dc: number; success: boolean; source: string }
	| { type: "condition_added"; targetId: string; condition: ActiveCondition }
	| { type: "condition_removed"; targetId: string; condition: ConditionId }
	| { type: "down"; targetId: string }
	| { type: "death"; targetId: string }
	| { type: "stable"; targetId: string }
	| { type: "death_save"; targetId: string; natural: number; successes: number; failures: number }
	| { type: "concentration_started"; combatantId: string; spell: string }
	| { type: "concentration_broken"; combatantId: string; spell: string }
	| { type: "spell_cast"; casterId: string; spell: string; slotLevel: number; targetIds: string[]; squares?: { x: number; y: number }[] }
	| { type: "slot_used"; level: number; pact: boolean }
	| { type: "item_used"; combatantId: string; itemId: string }
	| { type: "feature_used"; combatantId: string; featureId: string }
	| { type: "recharge"; combatantId: string; action: string; charged: boolean }
	| { type: "action_used"; combatantId: string; action: string }
	| { type: "hidden"; combatantId: string; stealth: number }
	| { type: "revealed"; combatantId: string }
	| { type: "removed"; combatantId: string; reason: string }
	| { type: "added"; combatantId: string }
	| { type: "combat_ended"; status: Encounter["status"]; xp: number }
	/** Something the code cannot adjudicate; the DM should narrate/resolve it. */
	| { type: "needs_dm"; text: string };

export interface CombatResult extends CombatState {
	ok: boolean;
	error?: string;
	rolls: RollRecord[];
	/** Human-readable lines for the play log / DM digest. */
	log: string[];
	events: CombatEvent[];
}

/** PC numbers the engine needs. Build with `derivePcProfile` (every field overridable). */
export interface PcCombatProfile {
	ac: number;
	speed: number;
	proficiencyBonus: number;
	initiativeBonus: number;
	/** Attacks per Attack action (1 + Extra Attack). */
	attacksPerAction: number;
	/** Natural roll needed to crit (Champion: 19). */
	critOn: number;
	saveBonuses: Record<Ability, number>;
	stealthBonus: number;
	passivePerception: number;
	spellcastingAbility?: Ability;
	spellAttackBonus?: number;
	spellSaveDc?: number;
	/** Character level (cantrip scaling). */
	level: number;
	resistances: DamageType[];
	vulnerabilities: DamageType[];
	immunities: DamageType[];
	/** Rogue Cunning Action: Dash/Disengage/Hide as a bonus action. */
	cunningAction?: boolean;
	/** Override weapon proficiency check (default: proficient with everything). */
	weaponProficient?: (item: InventoryItem) => boolean;
	/** Override the unarmed strike. */
	unarmed?: { toHit: number; damage: string; damageType: DamageType };
}

export interface ItemUseOutcome {
	/** Dice to heal the target (e.g. "2d4+2"). */
	heal?: string;
	/** Consume one from the stack (default true). */
	consume?: boolean;
	/** "action" | "bonus" | "free" (default "bonus" for potions, else "action"). */
	cost?: "action" | "bonus" | "free";
	/** Text for the DM to adjudicate. */
	note?: string;
}

export interface FeatureUseOutcome {
	heal?: string;
	cost?: "action" | "bonus" | "free" | "reaction";
	/** Regain the action (Action Surge). */
	grantAction?: boolean;
	note?: string;
}

export interface CombatOptions {
	/** PC profile; defaults to derivePcProfile(character). */
	profile?: PcCombatProfile;
	/** Resolve spell index → SpellInfo for `cast` actions. */
	spells?: Record<string, SpellInfo> | ((index: string) => SpellInfo | undefined);
	/** Item hook; return undefined to fall back to the built-ins (healing potions). */
	onUseItem?: (item: InventoryItem, state: CombatState) => ItemUseOutcome | undefined;
	/** Feature hook; return undefined to fall back to built-ins (Second Wind, Action Surge). */
	onUseFeature?: (feature: Feature, state: CombatState) => FeatureUseOutcome | undefined;
	/** PC (and allied NPCs) automatically take opportunity attacks on fleeing monsters (default true). */
	autoReactions?: boolean;
}

export interface MonsterSpawn {
	stats: import("../../game/types").MonsterStats;
	/** Use this existing map entity (DM-placed token) instead of creating one. */
	entityId?: string;
	/** Combatant id (default generated). */
	id?: string;
	name?: string;
	side?: "enemy" | "neutral" | "party";
	kind?: "monster" | "npc";
	refId?: string;
	/** Exact top-left square; if occupied/blocked the nearest free square is used. */
	position?: { x: number; y: number };
	/** Place near this square (nearest free). */
	near?: { x: number; y: number };
	/** Roll hit dice instead of using average HP. */
	rollHp?: boolean;
	hp?: number;
	surprised?: boolean;
	hidden?: boolean;
}

export interface StartCombatInput {
	encounterId: string;
	map: GridMap;
	character: Character;
	monsters: MonsterSpawn[];
	/** PC position if no "pc" entity exists on the map (default map.entry). */
	pcPosition?: { x: number; y: number };
	pcSurprised?: boolean;
}
