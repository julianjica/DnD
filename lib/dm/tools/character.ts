import type { Ability } from "../../game/types";
import { roll, signed } from "../../rules/dice";
import { canLevelUp, checkBreakdown, longRest, shortRest } from "../../rules/character";
import { SKILL_ABILITY } from "../../rules/character/tables";
import { loadState } from "../../store/campaigns";
import { lookupForCampaign } from "../content";
import { abilityMod } from "../../rules/dice";
import { S, tool, withState, type ToolFactory } from "../context";
import { advanceClock, fed, isZombie, restInterruption } from "../../rules/survival";
import { baseSecuresRest, infirmaryCare } from "../../rules/base";
import { restSurvivors } from "../../rules/group";
import { restCrew } from "../../rules/crew";
import { resetDeckUses } from "../../rules/deck";

const ABILS = ["str", "dex", "con", "int", "wis", "cha"] as const;

export const abilityCheck = tool<{ skill?: string; ability?: Ability; dc?: number; advantage?: "advantage" | "disadvantage"; label?: string; passive?: boolean }>(
	"ability_check",
	"Roll an ability check for the PLAYER using their real modifiers. Always pass the skill index ('perception', 'stealth', 'athletics'…) when one applies, or the raw ability otherwise; the player sees which one was tested. Set dc to get success/failure. passive=true returns the passive score instead of rolling.",
	S.obj(
		{
			skill: S.str("Skill index", Object.keys(SKILL_ABILITY)),
			ability: S.str(undefined, ABILS),
			dc: S.int(),
			advantage: S.str(undefined, ["advantage", "disadvantage"]),
			label: S.str(),
			passive: S.bool(),
		},
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll: record }) => {
			const c = state.character;
			const { mod, check } = checkBreakdown(c, { kind: "check", ability: a.ability, skill: a.skill });
			const label = a.label ?? `${a.skill ?? check.ability.toUpperCase()} check`;
			if (a.passive) return `Passive ${label}: ${10 + mod + (a.advantage === "advantage" ? 5 : a.advantage === "disadvantage" ? -5 : 0)}`;
			const r = roll(rng, `1d20${signed(mod)}`, { label, advantage: a.advantage, target: a.dc, actor: c.id });
			r.check = check;
			record(r);
			return `${label} (${a.skill ? `${a.skill}, ` : ""}${check.ability.toUpperCase()}): ${r.total} (d20 ${r.dice.filter((d) => !d.dropped).map((d) => d.value).join("")} ${signed(mod)})${a.dc !== undefined ? ` vs DC ${a.dc}: ${r.success ? "SUCCESS" : "FAILURE"}` : ""}`;
		}),
);

export const savingThrow = tool<{ ability: Ability; dc: number; advantage?: "advantage" | "disadvantage"; label?: string }>(
	"saving_throw",
	"Roll a saving throw for the PLAYER outside combat-engine effects (traps, poisons, spells you adjudicate).",
	S.obj({ ability: S.str(undefined, ABILS), dc: S.int(), advantage: S.str(undefined, ["advantage", "disadvantage"]), label: S.str() }, ["ability", "dc"]),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll: record }) => {
			const c = state.character;
			const { mod, check } = checkBreakdown(c, { kind: "save", ability: a.ability });
			const label = a.label ?? `${a.ability.toUpperCase()} save`;
			const r = roll(rng, `1d20${signed(mod)}`, { label, advantage: a.advantage, target: a.dc, actor: c.id });
			r.check = check;
			record(r);
			return `${label}: ${r.total} vs DC ${a.dc}: ${r.success ? "SUCCESS" : "FAILURE"}`;
		}),
);

export const shortRestTool = tool<{ hitDice?: number }>(
	"short_rest",
	"The player takes a 1-hour short rest: spends hit dice (number; default: enough to heal up, as available), recharges short-rest features and pact slots. Advances the clock 1 hour.",
	S.obj({ hitDice: S.int(undefined, 0) }),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll: record }) => {
			const c = state.character;
			if (state.encounter?.status === "active") throw new Error("Cannot rest during combat.");
			let dice = a.hitDice;
			if (dice === undefined) {
				const missing = c.maxHp - c.hp;
				const avgPer = Math.max(1, Math.floor((c.hitDice[0]?.die ?? 8) / 2) + 1 + abilityMod(c.abilities.con));
				const left = c.hitDice.reduce((n, h) => n + h.total - h.used, 0);
				dice = Math.min(left, Math.ceil(missing / avgPer));
			}
			const res = shortRest(c, rng, { hitDice: dice });
			for (const r of res.rolls) record(r);
			state.character = res.character;
			state.time.hour += 1;
			if (state.time.hour >= 24) {
				state.time.hour -= 24;
				state.time.day += 1;
			}
			return `Short rest: spent ${dice} hit dice, regained ${res.hpRegained} HP. HP ${res.character.hp}/${res.character.maxHp}.`;
		}),
);

export const longRestTool = tool<{ interrupted?: boolean; secured?: boolean }>(
	"long_rest",
	"The player takes an 8-hour long rest: full HP, half hit dice back, all slots and features, -1 exhaustion. Advances the clock 8 hours. The Quiet: pass secured (true only if barricaded/locked, dark and quiet; at the base with fortification 3+ it is secured automatically); the engine rolls whether something interrupts the rest (noise, night and an unsecured spot make it likelier), and exhaustion only drops if the character ate and drank in the last 24 h.",
	S.obj({ interrupted: S.bool(), secured: S.bool("The Quiet (required there): the spot is barricaded or locked, dark and quiet") }),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			if (state.encounter?.status === "active") throw new Error("Cannot rest during combat.");
			if (a.interrupted) return "Long rest interrupted; no benefits.";
			const zombie = isZombie(state);
			// At a base with fortification 3+ the rest is secured whatever was passed.
			const base = zombie ? baseSecuresRest(state) : undefined;
			const secured = base?.secured ? true : a.secured;
			if (zombie && typeof secured !== "boolean") throw new Error(`In The Quiet a long rest needs secured: true (barricaded or locked, dark and quiet) or false (anywhere else).${base ? ` The base's fortification is only ${base.fortification}/10 (3+ secures it automatically).` : ""} Decide honestly from the scene and call again.`);
			if (zombie) {
				const chance = restInterruption(state, rng, secured!);
				if (chance.interrupted) {
					advanceClock(state, chance.afterMinutes ?? 60);
					return `Long rest INTERRUPTED (${chance.chance}% chance): ${chance.text} No long-rest benefits. DM: make it real now: describe it, place them on the map and start_combat (or let the player flee/hide).`;
				}
			}
			const fedWell = zombie ? fed(state) : true;
			const exhaustion = state.character.exhaustion;
			state.character = longRest(state.character, { fed: fedWell });
			resetDeckUses(state); // Root Access: built-in deck programs recharge
			const total = state.time.hour + 8;
			state.time.day += Math.floor(total / 24);
			state.time.hour = total % 24;
			const companions = zombie ? restSurvivors(state) : restCrew(state);
			const care = zombie ? infirmaryCare(state) : undefined;
			return `Long rest complete${base?.secured ? ` (at the base, fortification ${base.fortification}/10: secured)` : ""}. HP ${state.character.hp}/${state.character.maxHp}; resources restored.${!fedWell && exhaustion ? " Exhaustion NOT reduced: no food and water in the last 24 hours." : ""}${care ? ` ${care}` : ""}${companions ? ` ${companions}` : ""}`;
		}),
);

export const awardXp = tool<{ xp: number; reason: string }>(
	"award_xp",
	"Award XP (XP leveling). The player chooses level-up options in the UI when they qualify.",
	S.obj({ xp: S.int(undefined, 0), reason: S.str() }, ["xp", "reason"]),
	async (a, ctx) =>
		withState(ctx, ({ state, fx }) => {
			const before = canLevelUp(state.character);
			state.character.xp += a.xp;
			const can = canLevelUp(state.character);
			if (can && !before) fx({ kind: "sfx", sound: "levelup" });
			return `+${a.xp} XP (${a.reason}). Total ${state.character.xp}.${can ? " The player can LEVEL UP (they will do it from the character sheet)." : ""}`;
		}),
);

export const grantLevelUp = tool<{ reason: string }>(
	"grant_level_up",
	"Milestone leveling: grant the player one level-up (they pick options in the UI).",
	S.obj({ reason: S.str() }, ["reason"]),
	async (a, ctx) =>
		withState(ctx, ({ state, fx }) => {
			state.levelUpsGranted = (state.levelUpsGranted ?? 0) + 1;
			fx({ kind: "sfx", sound: "levelup" });
			return `Level-up granted (${a.reason}).`;
		}),
);

export const lookupSrd = tool<{ query: string; long?: boolean }>(
	"lookup_srd",
	"Search this campaign's rules content (monsters, spells or techniques, items, classes, features, conditions, rules); only content of the campaign's ruleset is returned. Prefix with 'monster:', 'spell:', 'item:' to narrow. Use to find monster indices for start_combat.",
	S.obj({ query: S.str(), long: S.bool("Full text of the best match") }, ["query"]),
	async (a, ctx) => lookupForCampaign(loadState(ctx.campaignId), a.query, a.long ? 1 : 5) || "No match.",
);

export const CHARACTER_TOOLS: ToolFactory[] = [abilityCheck, savingThrow, shortRestTool, longRestTool, awardXp, grantLevelUp, lookupSrd];
