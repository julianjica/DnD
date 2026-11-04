import type { Character, Combatant, PlayerCombatAction, SpellInfo } from "../../game/types";
import { abilityMod, signed, type Rng } from "../dice";
import { performAttack } from "./attack";
import {
	applyHeal,
	checkEnd,
	type Ctx,
	doRoll,
	emit,
	fail,
	getC,
	killPc,
	natural,
	pcCombatant,
	pcProfile,
	removeCondition,
	run,
	say,
	setFlag,
} from "./core";
import { endTurnCtx } from "./encounter";
import { areHostile, canSee, coverBetween, distanceFeet, entityFor, footprintOf, isIncapacitated, livingCombatants } from "./grid";
import { effectiveSpeed, moveAlong } from "./movement";
import { characterLevel, isRangedWeapon, pcAttackProfile } from "./profile";
import { resolveSpell } from "./spells";
import { missingSupplies, suppliesText, spendSupplies } from "./supplies";
import type { CombatOptions, CombatResult, CombatState, FeatureUseOutcome, ItemUseOutcome } from "./types";

type Cost = "action" | "bonus" | "free" | "reaction";

function spend(c: Combatant, cost: Cost, what: string): void {
	if (cost === "action") {
		if (!c.turn.action) fail(`No action left for ${what}.`);
		c.turn.action = false;
	} else if (cost === "bonus") {
		if (!c.turn.bonusAction) fail(`No bonus action left for ${what}.`);
		c.turn.bonusAction = false;
	} else if (cost === "reaction") {
		if (!c.turn.reaction) fail(`No reaction left for ${what}.`);
		c.turn.reaction = false;
	}
}

/** Action, or bonus action with Cunning Action if the action is spent. */
function spendCunning(ctx: Ctx, c: Combatant, what: string): void {
	if (c.turn.action) spend(c, "action", what);
	else if (pcProfile(ctx)?.cunningAction && c.turn.bonusAction) spend(c, "bonus", what);
	else fail(`No action left for ${what}.`);
}

function lookupSpell(opts: CombatOptions, index: string): SpellInfo | undefined {
	if (!opts.spells) return undefined;
	return typeof opts.spells === "function" ? opts.spells(index) : opts.spells[index];
}

const POTIONS: [RegExp, string][] = [
	[/potion of supreme healing/i, "10d4+20"],
	[/potion of superior healing/i, "8d4+8"],
	[/potion of greater healing/i, "4d4+4"],
	[/potion of healing/i, "2d4+2"],
];

export function builtinItem(name: string): ItemUseOutcome | undefined {
	for (const [re, heal] of POTIONS) if (re.test(name)) return { heal, cost: "bonus", consume: true };
	return undefined;
}

function builtinFeature(ctx: Ctx, name: string): FeatureUseOutcome | undefined {
	return builtinFeatureFor(ctx.character, name);
}

export function builtinFeatureFor(character: Character | undefined, name: string): FeatureUseOutcome | undefined {
	const n = name.toLowerCase();
	if (n === "second wind") {
		const lvl = character?.classes.find((k) => k.classId === "fighter")?.level ?? 1;
		return { heal: `1d10+${lvl}`, cost: "bonus" };
	}
	if (n === "action surge") return { grantAction: true, cost: "free" };
	return undefined;
}

function stateOf(ctx: Ctx): CombatState {
	return { encounter: ctx.enc, map: ctx.map, character: ctx.character };
}

/** Death saving throw for the PC (SRD: 10+ success, nat 20 regain 1 HP, nat 1 = two failures). */
function deathSave(ctx: Ctx, c: Combatant): void {
	if (c.hp > 0) fail(`${c.name} is not dying.`);
	if (c.dead) fail(`${c.name} is dead.`);
	const ds = (c.deathSaves ??= { successes: 0, failures: 0 });
	if (ds.successes >= 3) fail(`${c.name} is stable.`);
	if (c.usage.__turn_deathSave) fail("Already rolled a death save this turn.");
	setFlag(c, "__turn_deathSave");
	const r = doRoll(ctx, "1d20", { label: `${c.name} death saving throw`, actor: c.id, target: 10 });
	const nat = natural(r);
	if (nat === 20) {
		say(ctx, `${c.name} rolls a natural 20 on a death save and regains 1 HP!`);
		emit(ctx, { type: "death_save", targetId: c.id, natural: nat, successes: ds.successes, failures: ds.failures });
		applyHeal(ctx, c.id, 1, "death save");
		return;
	}
	if (nat === 1) ds.failures += 2;
	else if (r.total >= 10) ds.successes += 1;
	else ds.failures += 1;
	ds.failures = Math.min(3, ds.failures);
	emit(ctx, { type: "death_save", targetId: c.id, natural: nat, successes: ds.successes, failures: ds.failures });
	say(ctx, `${c.name} death save: ${nat}${nat === 1 ? " (two failures)" : ""} — ${ds.successes} success(es), ${ds.failures} failure(s).`);
	if (ds.failures >= 3) killPc(ctx, c);
	else if (ds.successes >= 3) {
		emit(ctx, { type: "stable", targetId: c.id });
		say(ctx, `${c.name} is stable.`);
	}
}

function doAction(ctx: Ctx, action: PlayerCombatAction): void {
	if (ctx.enc.status !== "active") fail("Combat is not active.");
	const pc = pcCombatant(ctx.enc);
	if (!pc) fail("No player character in this encounter.");
	if (ctx.enc.order[ctx.enc.turnIndex] !== pc.id) fail("It is not your turn.");
	if (pc.dead) fail(`${pc.name} is dead.`);
	if (pc.hp <= 0 && action.type !== "death_save" && action.type !== "end_turn") fail(`${pc.name} is dying: roll a death save or end the turn.`);
	const ch = ctx.character;
	const profile = pcProfile(ctx);

	switch (action.type) {
		case "stand_up": {
			if (!pc.conditions.some((k) => k.id === "prone")) fail(`${pc.name} is not prone.`);
			const cost = Math.floor(pc.speed / 2);
			if (pc.turn.movementLeft < cost) fail(`Not enough movement to stand up (needs ${cost} ft).`);
			pc.turn.movementLeft -= cost;
			removeCondition(ctx, pc.id, "prone");
			emit(ctx, { type: "stand_up", combatantId: pc.id });
			say(ctx, `${pc.name} gets up (${cost} ft of movement).`);
			return;
		}
		case "end_turn":
			// A dying PC always makes its death save; it cannot be skipped.
			if (pc.hp <= 0 && !pc.dead && (pc.deathSaves?.successes ?? 0) < 3 && !pc.usage.__turn_deathSave) {
				deathSave(ctx, pc);
				checkEnd(ctx);
				if (ctx.enc.status !== "active") return;
			}
			endTurnCtx(ctx);
			return;
		case "death_save":
			deathSave(ctx, pc);
			checkEnd(ctx);
			return;
		case "move":
			moveAlong(ctx, pc.id, action.path);
			return;
		case "dash": {
			spendCunning(ctx, pc, "Dash");
			const add = effectiveSpeed(ctx, pc);
			pc.turn.movementLeft += add;
			pc.turn.dashed = true;
			say(ctx, `${pc.name} dashes (+${add} ft).`);
			emit(ctx, { type: "action_used", combatantId: pc.id, action: "dash" });
			return;
		}
		case "disengage":
			spendCunning(ctx, pc, "Disengage");
			pc.turn.disengaged = true;
			say(ctx, `${pc.name} disengages.`);
			emit(ctx, { type: "action_used", combatantId: pc.id, action: "disengage" });
			return;
		case "dodge":
			spend(pc, "action", "Dodge");
			pc.turn.dodging = true;
			say(ctx, `${pc.name} takes the Dodge action.`);
			emit(ctx, { type: "action_used", combatantId: pc.id, action: "dodge" });
			return;
		case "help": {
			const t = getC(ctx, action.targetId);
			if (t.dead) fail(`${t.name} is dead.`);
			const a = footprintOf(ctx.enc, ctx.map, pc.id)!;
			const b = footprintOf(ctx.enc, ctx.map, t.id)!;
			if (distanceFeet(a, b) > 5) fail(`${t.name} must be within 5 ft to help.`);
			spend(pc, "action", "Help");
			if (areHostile(pc, t)) {
				setFlag(t, "__helpAgainst");
				say(ctx, `${pc.name} distracts ${t.name}: the next attack against it has advantage.`);
			} else {
				setFlag(t, "__helped");
				say(ctx, `${pc.name} helps ${t.name}: its next attack has advantage.`);
			}
			emit(ctx, { type: "action_used", combatantId: pc.id, action: "help" });
			return;
		}
		case "hide": {
			const watchers = livingCombatants(ctx.enc).filter((o) => areHostile(pc, o) && !isIncapacitated(o));
			const seen = watchers.filter((o) => canSee(ctx.enc, ctx.map, o.id, pc.id) && !["three_quarters", "total"].includes(coverBetween(ctx.enc, ctx.map, o.id, pc.id)));
			if (seen.length && !pc.conditions.some((k) => k.id === "invisible")) fail(`You can't hide while ${seen.map((o) => o.name).join(", ")} can see you clearly (need ¾ cover or no line of sight).`);
			spendCunning(ctx, pc, "Hide");
			const stealthDis = !!ch?.inventory.some((i) => i.equipped && i.armor?.stealthDisadvantage);
			const bonus = profile?.stealthBonus ?? abilityMod(ch?.abilities.dex ?? 10);
			const r = doRoll(ctx, `1d20${bonus ? signed(bonus) : ""}`, { label: `${pc.name} Stealth (Hide)`, actor: pc.id, target: 15, ...(stealthDis ? { advantage: "disadvantage" as const } : {}) });
			if (r.success) {
				pc.usage.__hidden = { used: r.total };
				const e = entityFor(ctx.enc, ctx.map, pc.id);
				if (e) e.hidden = true;
				emit(ctx, { type: "hidden", combatantId: pc.id, stealth: r.total });
				say(ctx, `${pc.name} hides (Stealth ${r.total}).`);
			} else say(ctx, `${pc.name} fails to hide (Stealth ${r.total} < 15).`);
			return;
		}
		case "attack": {
			if (!ch || !profile) fail("Character data is required to attack.");
			const item = action.itemId ? ch.inventory.find((i) => i.id === action.itemId) : undefined;
			if (action.itemId && !item) fail("Unknown item.");
			if (item && !item.weapon) fail(`${item.name} is not a weapon.`);
			const t = getC(ctx, action.targetId);
			const dist = distanceFeet(footprintOf(ctx.enc, ctx.map, pc.id)!, footprintOf(ctx.enc, ctx.map, t.id)!);
			const props = item?.weapon?.properties.map((p) => p.toLowerCase()) ?? [];
			const thrown = !!item && !isRangedWeapon(item) && props.includes("thrown") && dist > (props.includes("reach") ? 10 : 5);
			const ap = pcAttackProfile(ch, profile, item, { thrown, offHand: action.offHand });
			if (action.offHand) {
				if (!pc.usage.__turn_attacked) fail("Off-hand attacks require taking the Attack action first.");
				if (!props.includes("light")) fail("Off-hand attacks require a Light weapon.");
				spend(pc, "bonus", "off-hand attack");
			} else if (pc.turn.attacksLeft > 0) {
				pc.turn.attacksLeft -= 1;
			} else {
				spend(pc, "action", "Attack");
				pc.turn.attacksLeft = Math.max(0, profile.attacksPerAction - 1);
			}
			// Weapons whose equipment entry names an `ammo` item use one up per attack (a miss too).
			const ammoRef = item?.ref ? ctx.opts.equipment?.(item.ref)?.ammo : undefined;
			const nameOf = (ref: string) => ctx.opts.equipment?.(ref)?.name;
			if (ammoRef) {
				const need = [{ ref: ammoRef, qty: 1 }];
				if (missingSupplies(ch, need, nameOf).length) fail(`Out of ${nameOf(ammoRef) ?? ammoRef}: ${item!.name} can't fire.`);
				spendSupplies(ch, need, nameOf);
			}
			setFlag(pc, "__turn_attacked");
			performAttack(ctx, pc.id, t.id, ap);
			if (ammoRef) say(ctx, `Used ${suppliesText(ch, [{ ref: ammoRef, qty: 1 }], nameOf)}.`);
			// The Quiet: "loud" weapons (firearms) make noise. Phase-2 hook: recorded in GameState.noiseLog by lib/dm/combat.ts.
			if (props.includes("loud")) {
				say(ctx, `Gunshot: loud (noise).`);
				emit(ctx, { type: "noise", combatantId: pc.id, source: item!.name, loudness: 3 });
			}
			return;
		}
		case "cast": {
			if (!ch || !profile) fail("Character data is required to cast.");
			const spell = lookupSpell(ctx.opts, action.spell);
			if (!spell) fail(`Unknown spell: ${action.spell}.`);
			const ct = spell.castingTime.toLowerCase();
			const cost: Cost = ct.includes("bonus") ? "bonus" : ct.includes("reaction") ? "reaction" : ct.includes("action") ? "action" : (fail(`${spell.name} takes ${spell.castingTime}; it cannot be cast in combat.`) as never);
			if (cost === "reaction") fail(`${spell.name} is a reaction spell; it is cast in response to a trigger.`);
			spend(pc, cost, spell.name);
			const sc = ch.spellcasting;
			const slotLevel = spell.level === 0 ? 0 : action.slotLevel;
			if (spell.level > 0) {
				if (!sc) fail("You have no spell slots.");
				if (slotLevel < spell.level || slotLevel > 9) fail(`${spell.name} needs a slot of level ${spell.level} or higher.`);
				const i = slotLevel - 1;
				if ((sc.slots[i] ?? 0) - (sc.slotsUsed[i] ?? 0) > 0) {
					while (sc.slotsUsed.length <= i) sc.slotsUsed.push(0);
					sc.slotsUsed[i] += 1;
					emit(ctx, { type: "slot_used", level: slotLevel, pact: false });
				} else if (sc.pact && sc.pact.level === slotLevel && sc.pact.used < sc.pact.max) {
					sc.pact.used += 1;
					emit(ctx, { type: "slot_used", level: slotLevel, pact: true });
				} else fail(`No level ${slotLevel} spell slots left.`);
			}
			// Techniques with components use them up from the inventory.
			if (spell.consumes?.length) {
				const nameOf = (ref: string) => ctx.opts.equipment?.(ref)?.name;
				const missing = missingSupplies(ch, spell.consumes, nameOf);
				if (missing.length) fail(`${spell.name} needs ${spell.consumes.map((n) => `${n.qty} × ${nameOf(n.ref) ?? n.ref}`).join(", ")}. Missing: ${missing.join(", ")}.`);
				spendSupplies(ch, spell.consumes, nameOf);
				say(ctx, `${spell.name} uses up ${suppliesText(ch, spell.consumes, nameOf)}.`);
			}
			const ability = profile.spellcastingAbility ?? "int";
			const mod = abilityMod(ch.abilities[ability]);
			resolveSpell(ctx, {
				casterId: pc.id,
				spell,
				slotLevel,
				targetIds: action.targetIds,
				point: action.point,
				attackBonus: profile.spellAttackBonus ?? profile.proficiencyBonus + mod,
				saveDc: profile.spellSaveDc ?? 8 + profile.proficiencyBonus + mod,
				abilityMod: mod,
				characterLevel: characterLevel(ch),
			});
			return;
		}
		case "use_item": {
			if (!ch) fail("Character data is required to use items.");
			const item = ch.inventory.find((i) => i.id === action.itemId);
			if (!item || item.quantity <= 0) fail("You don't have that item.");
			const outcome = ctx.opts.onUseItem?.(item, stateOf(ctx)) ?? builtinItem(item.name);
			if (!outcome) fail(`${item.name} has no defined combat effect; describe what you do instead.`);
			const targetId = action.targetId ?? pc.id;
			const t = getC(ctx, targetId);
			if (targetId !== pc.id && distanceFeet(footprintOf(ctx.enc, ctx.map, pc.id)!, footprintOf(ctx.enc, ctx.map, targetId)!) > 5) fail(`${t.name} must be within 5 ft.`);
			spend(pc, outcome.cost ?? "action", item.name);
			if (outcome.consume !== false) {
				item.quantity -= 1;
				if (item.quantity <= 0) ch.inventory = ch.inventory.filter((i) => i.id !== item.id);
			}
			emit(ctx, { type: "item_used", combatantId: pc.id, itemId: item.id });
			say(ctx, `${pc.name} uses ${item.name}${targetId !== pc.id ? ` on ${t.name}` : ""}.`);
			if (outcome.heal) {
				const r = doRoll(ctx, outcome.heal, { label: `${item.name} healing`, actor: pc.id });
				applyHeal(ctx, targetId, Math.max(0, r.total), item.name);
			}
			if (outcome.note) emit(ctx, { type: "needs_dm", text: outcome.note });
			return;
		}
		case "use_feature": {
			if (!ch) fail("Character data is required to use features.");
			const f = ch.features.find((k) => k.id === action.featureId);
			if (!f) fail("Unknown feature.");
			if (f.uses && f.uses.used >= f.uses.max) fail(`${f.name} has no uses left.`);
			const outcome = ctx.opts.onUseFeature?.(f, stateOf(ctx)) ?? builtinFeature(ctx, f.name) ?? { cost: "free" as const, note: `${pc.name} uses ${f.name}${action.targetId ? ` on ${ctx.enc.combatants[action.targetId]?.name ?? action.targetId}` : ""}; adjudicate: ${f.description.slice(0, 300)}` };
			spend(pc, outcome.cost ?? "action", f.name);
			if (f.uses) f.uses.used += 1;
			emit(ctx, { type: "feature_used", combatantId: pc.id, featureId: f.id });
			say(ctx, `${pc.name} uses ${f.name}.`);
			if (outcome.grantAction) {
				pc.turn.action = true;
				say(ctx, `${pc.name} gains an additional action.`);
			}
			if (outcome.heal) {
				const r = doRoll(ctx, outcome.heal, { label: `${f.name}`, actor: pc.id });
				applyHeal(ctx, action.targetId ?? pc.id, Math.max(0, r.total), f.name);
			}
			if (outcome.note) emit(ctx, { type: "needs_dm", text: outcome.note });
			return;
		}
	}
}

/**
 * Resolves one player combat action on the PC's turn. Validation failures
 * return ok=false with the original state. `move` paths are the squares
 * stepped into (a leading current square is ignored).
 */
export function applyPlayerAction(state: CombatState, rng: Rng, action: PlayerCombatAction, opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => doAction(ctx, action));
}

/** Stands a prone combatant up on its turn for half its speed (moving does this automatically). */
export function standUp(state: CombatState, rng: Rng, combatantId: string, opts: CombatOptions = {}): CombatResult {
	return run(state, rng, opts, (ctx) => {
		const c = getC(ctx, combatantId);
		if (ctx.enc.order[ctx.enc.turnIndex] !== c.id) fail(`It is not ${c.name}'s turn.`);
		if (!c.conditions.some((k) => k.id === "prone")) fail(`${c.name} is not prone.`);
		const cost = Math.floor(c.speed / 2);
		if (c.turn.movementLeft < cost) fail("Not enough movement to stand.");
		c.turn.movementLeft -= cost;
		removeCondition(ctx, c.id, "prone");
		emit(ctx, { type: "stand_up", combatantId: c.id });
	});
}
