import type { Ability, Character, DamageType } from "../game/types";
import { roll, type Rng } from "../rules/dice";
import { applyDamage, deriveSheet, heal } from "../rules/character";
import { derivePcProfile, type PcCombatProfile } from "../rules/combat";
import { getEquipment } from "../srd";
import type { StateTxn } from "./context";

/** Glue between the character rules (sheet) and the combat engine (profile). */

export function derivedAc(c: Character): number {
	try {
		return deriveSheet(c).ac;
	} catch {
		return 10;
	}
}

export function pcCombatProfile(c: Character): PcCombatProfile {
	const sheet = deriveSheet(c);
	const saveBonuses = Object.fromEntries(Object.entries(sheet.saves).map(([a, s]) => [a, s.mod])) as Record<Ability, number>;
	const caster = sheet.spellcasting[0];
	return derivePcProfile(c, {
		ac: sheet.ac,
		speed: sheet.speed,
		proficiencyBonus: sheet.profBonus,
		initiativeBonus: sheet.initiative,
		attacksPerAction: sheet.attacksPerAction,
		critOn: sheet.critRange,
		saveBonuses,
		stealthBonus: sheet.skills.stealth?.mod ?? 0,
		passivePerception: sheet.passivePerception,
		resistances: sheet.defenses.resistances,
		immunities: sheet.defenses.immunities,
		vulnerabilities: sheet.defenses.vulnerabilities,
		...(caster ? { spellcastingAbility: caster.ability, spellAttackBonus: caster.attackBonus, spellSaveDc: caster.saveDc } : {}),
		cunningAction: c.features.some((f) => /cunning-action|cunning action/i.test(f.id + f.name)),
		weaponProficient: (item) => {
			if (!item.ref) return true;
			const eq = getEquipment(item.ref) as { weaponCategory?: string; index: string } | undefined;
			const cat = eq?.weaponCategory?.toLowerCase();
			return c.weaponProf.some((p) => {
				const q = p.toLowerCase();
				return q === item.ref || q === eq?.index || (cat && q.startsWith(cat));
			});
		},
	});
}

function amountOf(rng: Rng, tx: StateTxn, amount: number | string, label: string): number {
	if (typeof amount === "number") return amount;
	const r = roll(rng, amount, { label, actor: "dm" });
	tx.roll(r);
	return r.total;
}

export function applyDamageToCharacter(tx: StateTxn, rng: Rng, amount: number | string, type: DamageType | undefined, reason: string): string {
	const n = amountOf(rng, tx, amount, `Damage: ${reason}`);
	const res = applyDamage(tx.state.character, n, { type });
	tx.state.character = res.character;
	tx.fx({ kind: "damage", entityId: undefined, amount: res.hpLost });
	const c = res.character;
	return `${c.name} takes ${res.applied}${type ? ` ${type}` : ""} damage${res.modifier ? ` (${res.modifier})` : ""} (${reason}). HP ${c.hp}/${c.maxHp}.${res.instantDeath ? " INSTANT DEATH (massive damage)." : res.droppedToZero ? " Dropped to 0 HP — unconscious and dying." : ""}`;
}

export function healCharacter(tx: StateTxn, rng: Rng, amount: number | string, reason: string): string {
	const n = amountOf(rng, tx, amount, `Healing: ${reason}`);
	const before = tx.state.character.hp;
	tx.state.character = heal(tx.state.character, n);
	const c = tx.state.character;
	tx.fx({ kind: "heal", amount: c.hp - before });
	return `${c.name} regains ${c.hp - before} HP (${reason}). HP ${c.hp}/${c.maxHp}.`;
}
