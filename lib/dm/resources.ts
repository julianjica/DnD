import type { Character, Feature, InventoryItem, PlayerCombatAction, SpellInfo } from "../game/types";
import { abilityMod, roll } from "../rules/dice";
import { RulesError, slotsAvailable, spendSlot, useFeature as spendFeature, heal } from "../rules/character";
import { builtinFeatureFor, builtinItem, pickByKey } from "../rules/combat";
import { getSpell } from "../srd";
import type { StateTxn } from "./context";
import { isPcTurn, playerCombatAction } from "./combat";

/**
 * System-owned bookkeeping for the player's limited resources: spell slots,
 * limited-use features and consumable items. The DM (through tools) and the
 * player (through the sidebar) both go through here, so the numbers on the
 * sheet are always the real ones. Throws RulesError when a resource is gone.
 */

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function findItem(c: Character, ref: string): InventoryItem | undefined {
	const r = norm(ref);
	return (
		c.inventory.find((i) => i.id === ref) ??
		c.inventory.find((i) => norm(i.name) === r || (i.ref && norm(i.ref) === r)) ??
		c.inventory.find((i) => norm(i.name).includes(r) || r.includes(norm(i.name)))
	);
}

export function findFeatureRef(c: Character, ref: string): Feature | undefined {
	const r = norm(ref);
	return c.features.find((f) => f.id === ref) ?? c.features.find((f) => norm(f.name) === r || norm(f.id) === r) ?? c.features.find((f) => norm(f.name).includes(r));
}

/** Spells the character can cast right now (cantrips + prepared + known), as SRD indices. */
export function castableSpells(c: Character): string[] {
	const sc = c.spellcasting;
	if (!sc) return [];
	return [...new Set(sc.classes.flatMap((k) => [...k.cantrips, ...k.prepared]))];
}

/** Spellbook/known spells (wizards can ritual-cast unprepared ritual spells from their book). */
function knownSpells(c: Character): string[] {
	return [...new Set((c.spellcasting?.classes ?? []).flatMap((k) => k.known))];
}

export function findSpell(c: Character, ref: string): SpellInfo | undefined {
	const r = norm(ref);
	const own = [...castableSpells(c), ...knownSpells(c)].find((s) => s === r || norm(getSpell(s)?.name ?? "") === r);
	return getSpell(own ?? r);
}

function lowestSlot(c: Character, min: number): number | undefined {
	for (let l = Math.max(1, min); l <= 9; l++) {
		const av = slotsAvailable(c, l);
		if (av.regular + av.pact > 0) return l;
	}
	return undefined;
}

function slotsLeft(c: Character): string {
	const sc = c.spellcasting;
	if (!sc) return "no spell slots";
	const parts = sc.slots.map((max, i) => (max ? `L${i + 1} ${max - (sc.slotsUsed[i] ?? 0)}/${max}` : "")).filter(Boolean);
	if (sc.pact) parts.push(`pact L${sc.pact.level} ${sc.pact.max - sc.pact.used}/${sc.pact.max}`);
	return parts.join(", ") || "no spell slots";
}

function healSelf(tx: StateTxn, notation: string, label: string): string {
	const r = roll(tx.rng, notation, { label, actor: tx.state.character.id });
	tx.roll(r);
	const before = tx.state.character.hp;
	tx.state.character = heal(tx.state.character, Math.max(0, r.total));
	const gained = tx.state.character.hp - before;
	if (gained > 0) tx.fx({ kind: "heal", amount: gained });
	return `${label}: ${r.total} → HP ${tx.state.character.hp}/${tx.state.character.maxHp}`;
}

function inCombat(tx: StateTxn): boolean {
	return tx.state.encounter?.status === "active";
}

function viaCombat(tx: StateTxn, action: PlayerCombatAction): string {
	if (!isPcTurn(tx.state)) throw new RulesError("It is not the player's turn; this needs their action (reaction-only effects excepted).");
	return playerCombatAction(tx, action, tx.rng);
}

// ─── items ─────────────────────────────────────────────────────────────────

export interface ConsumeItemInput {
	item: string;
	/** How many to consume (default 1). */
	quantity?: number;
	/** Keep the item (e.g. reading a map, lighting a reusable lantern). */
	keep?: boolean;
	/** Self-healing dice when the item heals but isn't a known potion. */
	heal?: string;
}

export function consumeItem(tx: StateTxn, a: ConsumeItemInput): string {
	const c = tx.state.character;
	const item = findItem(c, a.item);
	if (!item || item.quantity <= 0) throw new RulesError(`${c.name} has no "${a.item}". Inventory: ${c.inventory.map((i) => `${i.name} x${i.quantity}`).join(", ") || "empty"}.`);
	if (inCombat(tx) && isPcTurn(tx.state) && !a.keep && (a.quantity ?? 1) === 1) return viaCombat(tx, { type: "use_item", itemId: item.id });
	const n = Math.max(1, a.quantity ?? 1);
	if (!a.keep && n > item.quantity) throw new RulesError(`Only ${item.quantity} ${item.name} left.`);
	const lines: string[] = [];
	const effect = builtinItem(item.name);
	const healDice = effect?.heal ?? a.heal;
	// Consume first: healing replaces the character object.
	if (!a.keep && (effect?.consume ?? true)) {
		item.quantity -= n;
		if (item.quantity <= 0) tx.state.character.inventory = tx.state.character.inventory.filter((i) => i.id !== item.id);
		lines.push(`Used ${n} × ${item.name} (${Math.max(0, item.quantity)} left).`);
	} else lines.push(`Used ${item.name} (kept).`);
	if (healDice) for (let k = 0; k < n; k++) lines.push(healSelf(tx, healDice, `${item.name} healing`));
	tx.fx({ kind: "sfx", sound: healDice ? "gem" : "draw" });
	return lines.join(" ");
}

// ─── features ──────────────────────────────────────────────────────────────

export interface SpendFeatureInput {
	feature: string;
	/** Points to spend for pools (ki, sorcery points, lay on hands HP). Default 1. */
	amount?: number;
}

export function spendFeatureUse(tx: StateTxn, a: SpendFeatureInput): string {
	const c = tx.state.character;
	const f = findFeatureRef(c, a.feature);
	if (!f) throw new RulesError(`${c.name} doesn't have "${a.feature}". Limited features: ${c.features.filter((x) => x.uses).map((x) => x.name).join(", ") || "none"}.`);
	if (inCombat(tx) && isPcTurn(tx.state) && (a.amount ?? 1) === 1 && builtinFeatureFor(c, f.name)) return viaCombat(tx, { type: "use_feature", featureId: f.id });
	const n = Math.max(1, a.amount ?? 1);
	tx.state.character = spendFeature(c, f.id, n);
	const nf = tx.state.character.features.find((x) => x.id === f.id)!;
	const lines = [`${f.name} used${n > 1 ? ` (${n})` : ""}${nf.uses ? `: ${nf.uses.max - nf.uses.used}/${nf.uses.max} left (recharges on ${nf.uses.recharge} rest)` : " (unlimited)"}.`];
	const out = builtinFeatureFor(tx.state.character, f.name);
	if (out?.heal) lines.push(healSelf(tx, out.heal, f.name));
	if (/lay on hands/i.test(f.name)) {
		const before = tx.state.character.hp;
		tx.state.character = heal(tx.state.character, n);
		lines.push(`Healed ${tx.state.character.hp - before} → HP ${tx.state.character.hp}/${tx.state.character.maxHp} (if used on self).`);
	}
	tx.fx({ kind: "sfx", sound: "spell" });
	return lines.join(" ");
}

// ─── spells ────────────────────────────────────────────────────────────────

export interface CastSpellInput {
	spell: string;
	/** Slot level; defaults to the lowest available at or above the spell's level. */
	slotLevel?: number;
	/** Cast as a ritual (no slot, +10 minutes) when the spell allows it. */
	ritual?: boolean;
	/** Combat targets (combatant ids) when cast on the player's combat turn. */
	targetIds?: string[];
	/** Apply the spell's healing to the player (default true for healing spells out of combat). */
	healSelf?: boolean;
}

export function castSpell(tx: StateTxn, a: CastSpellInput): string {
	const c = tx.state.character;
	if (!c.spellcasting) throw new RulesError(`${c.name} cannot cast spells.`);
	const spell = findSpell(c, a.spell);
	const own = castableSpells(c);
	if (!spell) throw new RulesError(`Unknown spell "${a.spell}". ${c.name} can cast: ${own.join(", ") || "nothing"}.`);
	const ritual = !!a.ritual && spell.ritual && spell.level > 0;
	if (!own.includes(spell.index) && !(ritual && knownSpells(c).includes(spell.index)))
		throw new RulesError(`${c.name} doesn't know/hasn't prepared ${spell.name}. Castable: ${own.join(", ")}.`);
	if (a.ritual && !spell.ritual) throw new RulesError(`${spell.name} is not a ritual.`);
	let slot = 0;
	if (spell.level > 0 && !ritual) {
		const want = a.slotLevel ?? lowestSlot(c, spell.level);
		if (!want) throw new RulesError(`No spell slot of level ${spell.level}+ left for ${spell.name}. Slots: ${slotsLeft(c)}.`);
		if (want < spell.level) throw new RulesError(`${spell.name} needs a level ${spell.level}+ slot.`);
		slot = want;
	}
	const ct = spell.castingTime.toLowerCase();
	if (inCombat(tx) && isPcTurn(tx.state) && !ritual && !ct.includes("reaction") && (ct.includes("action"))) {
		return viaCombat(tx, { type: "cast", spell: spell.index, slotLevel: slot, targetIds: a.targetIds });
	}
	if (slot) tx.state.character = spendSlot(tx.state.character, slot);
	const ch = tx.state.character;
	const lines = [`${ch.name} casts ${spell.name}${slot ? ` (level ${slot} slot)` : ritual ? " as a ritual (no slot, +10 min)" : " (cantrip)"}. Slots now: ${slotsLeft(ch)}.`];
	if (spell.concentration) {
		if (ch.concentration) lines.push(`Concentration on ${getSpell(ch.concentration.spell)?.name ?? ch.concentration.spell} ends.`);
		ch.concentration = { spell: spell.index };
		lines.push(`Concentrating on ${spell.name}.`);
	}
	if (spell.heal && a.healSelf !== false) {
		const base = pickByKey(spell.heal.bySlotLevel, slot || spell.level);
		const sc = ch.spellcasting!;
		const cls = sc.classes.find((k) => k.cantrips.includes(spell.index) || k.prepared.includes(spell.index) || k.known.includes(spell.index)) ?? sc.classes[0];
		const mod = spell.heal.addModifier ? abilityMod(ch.abilities[cls.ability]) : 0;
		if (base) lines.push(healSelf(tx, mod ? `${base}+${mod}` : base, `${spell.name} healing`));
	}
	if (ritual) {
		const t = tx.state.time;
		t.minute += 10;
		while (t.minute >= 60) {
			t.minute -= 60;
			t.hour += 1;
		}
		while (t.hour >= 24) {
			t.hour -= 24;
			t.day += 1;
		}
	}
	if (spell.damage || spell.save || spell.attack) lines.push("Resolve its effect on any non-combat target yourself (roll/apply as needed).");
	tx.fx({ kind: "sfx", sound: "spell" });
	return lines.join(" ");
}

export { RulesError };
