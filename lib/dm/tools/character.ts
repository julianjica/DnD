import type { Ability } from "../../game/types";
import { roll, signed } from "../../rules/dice";
import { canLevelUp, longRest, saveMod, shortRest, skillMod } from "../../rules/character";
import { SKILL_ABILITY } from "../../rules/character/tables";
import { lookupText } from "../../srd";
import { abilityMod } from "../../rules/dice";
import { S, tool, withState, type ToolFactory } from "../context";

const ABILS = ["str", "dex", "con", "int", "wis", "cha"] as const;

export const abilityCheck = tool<{ skill?: string; ability?: Ability; dc?: number; advantage?: "advantage" | "disadvantage"; label?: string; passive?: boolean }>(
	"ability_check",
	"Roll an ability check for the PLAYER using their real modifiers (skill index like 'perception', 'stealth', 'athletics', or a raw ability). Set dc to get success/failure. passive=true returns the passive score instead of rolling.",
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
			const ability = (a.skill ? SKILL_ABILITY[a.skill] : a.ability) ?? "str";
			const mod = a.skill ? skillMod(c, a.skill) : abilityMod(c.abilities[ability]);
			const exhaustion = c.exhaustion ? -2 * c.exhaustion : 0;
			const label = a.label ?? `${a.skill ?? ability.toUpperCase()} check`;
			if (a.passive) return `Passive ${label}: ${10 + mod + (a.advantage === "advantage" ? 5 : a.advantage === "disadvantage" ? -5 : 0)}`;
			const r = roll(rng, `1d20${signed(mod + exhaustion)}`, { label, advantage: a.advantage, target: a.dc, actor: c.id });
			record(r);
			return `${label}: ${r.total} (d20 ${r.dice.filter((d) => !d.dropped).map((d) => d.value).join("")} ${signed(mod)})${a.dc !== undefined ? ` vs DC ${a.dc}: ${r.success ? "SUCCESS" : "FAILURE"}` : ""}`;
		}),
);

export const savingThrow = tool<{ ability: Ability; dc: number; advantage?: "advantage" | "disadvantage"; label?: string }>(
	"saving_throw",
	"Roll a saving throw for the PLAYER outside combat-engine effects (traps, poisons, spells you adjudicate).",
	S.obj({ ability: S.str(undefined, ABILS), dc: S.int(), advantage: S.str(undefined, ["advantage", "disadvantage"]), label: S.str() }, ["ability", "dc"]),
	async (a, ctx) =>
		withState(ctx, ({ state, rng, roll: record }) => {
			const c = state.character;
			const mod = saveMod(c, a.ability) + (c.exhaustion ? -2 * c.exhaustion : 0);
			const label = a.label ?? `${a.ability.toUpperCase()} save`;
			const r = roll(rng, `1d20${signed(mod)}`, { label, advantage: a.advantage, target: a.dc, actor: c.id });
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

export const longRestTool = tool<{ interrupted?: boolean }>(
	"long_rest",
	"The player takes an 8-hour long rest: full HP, half hit dice back, all slots and features, -1 exhaustion. Advances the clock 8 hours.",
	S.obj({ interrupted: S.bool() }),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			if (state.encounter?.status === "active") throw new Error("Cannot rest during combat.");
			if (a.interrupted) return "Long rest interrupted; no benefits.";
			state.character = longRest(state.character);
			const total = state.time.hour + 8;
			state.time.day += Math.floor(total / 24);
			state.time.hour = total % 24;
			return `Long rest complete. HP ${state.character.hp}/${state.character.maxHp}; resources restored.`;
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
			if (can && !before) fx({ kind: "sfx", sound: "level_up" });
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
			fx({ kind: "sfx", sound: "level_up" });
			return `Level-up granted (${a.reason}).`;
		}),
);

export const lookupSrd = tool<{ query: string; long?: boolean }>(
	"lookup_srd",
	"Search the 5e SRD (monsters, spells, items, classes, features, conditions, rules). Prefix with 'monster:', 'spell:', 'item:' to narrow. Use to find monster indices for start_combat.",
	S.obj({ query: S.str(), long: S.bool("Full text of the best match") }, ["query"]),
	async (a) => lookupText(a.query, a.long ? 1 : 5) || "No match.",
);

export const CHARACTER_TOOLS: ToolFactory[] = [abilityCheck, savingThrow, shortRestTool, longRestTool, awardXp, grantLevelUp, lookupSrd];
