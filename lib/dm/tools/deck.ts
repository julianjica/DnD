import type { SpellInfo } from "../../game/types";
import { isCyber, cyberOf } from "../../rules/cyber";
import { coolingBonus } from "../../rules/den";
import { deckChargesMax, deckOf, deckProgramNumbers, deckUsesOf } from "../../rules/deck";
import { programRan } from "../../rules/netrun";
import { getSpell } from "../../srd";
import { RulesError } from "../../rules/character";
import { isPcTurn, playerCombatAction } from "../combat";
import { S, tool, withState, type StateTxn, type ToolFactory } from "../context";

/**
 * Root Access: everyone can hack with a deck (docs/cyberpunk.md §2). Each deck
 * carries two built-in programs run as charges, without RAM: tier + 1 uses of
 * each per long rest, at Intelligence + proficiency + the deck's tier. Works
 * for every class (a Solo or a Chromed has no RAM of their own).
 */

const notCyber = "This tool only exists in Root Access (cyberpunk-ruleset campaigns).";

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export interface DeckProgramInput {
	program: string;
	/** Combat targets (combatant ids) when run on the player's combat turn. */
	targetIds?: string[];
}

export function runDeckProgram(tx: StateTxn, a: DeckProgramInput): string {
	const { state } = tx;
	if (!isCyber(state)) throw new RulesError(notCyber);
	const c = state.character;
	const deck = deckOf(c);
	if (!deck) throw new RulesError(`${c.name} carries no deck. Built-in programs need one (give_item a deck first).`);
	const built = deck.deck.programs.map((id) => getSpell(id)).filter((s): s is SpellInfo => !!s);
	const r = norm(a.program);
	const spell = built.find((s) => s.index === a.program || norm(s.index) === r || norm(s.name) === r || `p-${r}` === s.index);
	if (!spell) throw new RulesError(`${deck.name} has no built-in "${a.program}". Its built-in programs: ${built.map((s) => `${s.name} (${s.index})`).join(", ")}. Programs from RAM go through cast_spell.`);
	const max = deckChargesMax(c);
	const cy = cyberOf(state);
	const used = deckUsesOf(cy, spell.index);
	if (used >= max) throw new RulesError(`${spell.name} on ${deck.name} has no charges left (${max} per long rest). It is NOT run; the charges come back on a long rest.`);
	const nums = deckProgramNumbers(c, coolingBonus(cy)); // the den's cooling while jacked in
	const ct = spell.castingTime.toLowerCase();
	const lines: string[] = [];
	if (state.encounter?.status === "active" && isPcTurn(state) && ct.includes("action") && !ct.includes("reaction")) {
		// The combat engine resolves it (attack/save/damage) and its spell_cast event raises the trace in a run.
		lines.push(playerCombatAction(tx, { type: "cast", spell: spell.index, slotLevel: spell.level, targetIds: a.targetIds, deck: nums }, tx.rng));
	} else {
		lines.push(`${c.name} runs ${spell.name} from ${deck.name} (built-in, no RAM; program attack +${nums.attackBonus}, save DC ${nums.saveDc}).`);
		if (spell.concentration) {
			if (state.character.concentration) lines.push(`Concentration on ${getSpell(state.character.concentration.spell)?.name ?? state.character.concentration.spell} ends.`);
			state.character.concentration = { spell: spell.index };
			lines.push(`Concentrating on ${spell.name}.`);
		}
		lines.push(...programRan(state, spell, tx.rng, tx.roll));
		if (spell.damage || spell.save || spell.attack) lines.push("Resolve its effect on any non-combat target yourself with those numbers.");
	}
	cy.deckUses = { ...(cy.deckUses ?? {}), [spell.index]: used + 1 };
	lines.push(`${spell.name}: ${max - used - 1}/${max} charges left until a long rest.`);
	tx.fx({ kind: "sfx", sound: "spell" });
	return lines.join(" ");
}

export const deckProgramTool = tool<{ program: string; targetIds?: string[] }>(
	"deck_program",
	"Root Access: the PLAYER runs one of their deck's two BUILT-IN programs as a charge (no RAM slot), whatever their class: tier + 1 charges of each per long rest. Attack/DC = Intelligence + proficiency + deck tier. On the player's combat turn it resolves through the combat engine (targetIds = combatant ids). In a net run it raises the trace like any program. Programs loaded in RAM go through cast_spell instead. FAILS with no deck, an unknown built-in, or no charges left: then nothing runs.",
	S.obj({ program: S.str("Built-in program id ('p-sledgehammer') or name"), targetIds: S.arr(S.str()) }, ["program"]),
	async (a, ctx) => withState(ctx, (tx) => runDeckProgram(tx, a)),
);

export const DECK_TOOLS: ToolFactory[] = [deckProgramTool];
