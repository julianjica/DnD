import type { GameState } from "../../game/types";
import { getEquipment } from "../../srd";
import {
	adjustMorale,
	ERRAND_TASKS,
	isActive,
	killSurvivor,
	nameOf,
	professionLabel,
	PROFESSIONS,
	recruitSurvivor,
	sendSurvivor,
	survivorOf,
	treatSurvivor,
	type ErrandTask,
} from "../../rules/group";
import { outbreakDay } from "../../rules/ruleset";
import { isZombie } from "../../rules/survival";
import { S, newId, tool, withState, type ToolFactory } from "../context";
import { addInventoryItem } from "../items";

/** The Quiet only: survivors who join the player (docs/zombie.md §7, lib/rules/group.ts). */
function requireZombie(state: GameState) {
	if (!isZombie(state)) throw new Error("Only in The Quiet (zombie campaigns).");
}

const gearSchema = S.arr(S.obj({ ref: S.str("Equipment id of The Quiet, e.g. z-kitchen-knife, z-pistol-9mm, z-ammo-9mm, z-leather-jacket"), qty: S.int(undefined, 1) }, ["ref", "qty"]));

export const recruitSurvivorTool = tool<{ npcId: string; profession: string; level?: number; specialty: string; traits: string[]; skills?: string[]; gear?: { ref: string; qty: number }[] }>(
	"recruit_survivor",
	"The Quiet: an NPC the player has met (add_npc first) JOINS the player's group as a companion survivor. Only through the story: the player starts alone, trust is earned (a rescue, a shared danger, a trade honoured); don't hand out companions cheaply, at most 1–2 in the first week. profession = their pre-apocalypse job as a class id (barbarian=Firefighter, bard=Radio Host, cleric=Nurse, druid=Farmer/Vet, fighter=Soldier, monk=Martial-Arts Coach, paladin=Police Officer, ranger=Hunter, rogue=Locksmith/Thief, sorcerer=Athlete, warlock=Ex-Con, wizard=Teacher/Engineer). level defaults to 1 and never exceeds the player's. gear = what they actually carry (equipment ids; guns only with the rounds they really have); without it they get one ordinary melee weapon. Morale starts at 5–7. They follow the player (status with_party), fight beside them automatically in start_combat, eat from the party's food and water at 08:00, and can be bitten and turn.",
	S.obj(
		{
			npcId: S.str("An existing NPC id (state.npcs)"),
			profession: S.str("Class id (or a profession word: nurse, cop, soldier, firefighter, hunter…)"),
			level: S.int("Default 1; capped at the player's level", 1, 20),
			specialty: S.str("One line: what they bring (\"can stitch wounds\", \"knows the sewers\")"),
			traits: S.arr(S.str(), "2–3 short personality traits you will play (e.g. 'loyal', 'hothead', 'hides things')"),
			skills: S.arr(S.str(), "Skill ids they're good at, e.g. medicine, stealth"),
			gear: gearSchema,
		},
		["npcId", "profession", "specialty", "traits"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			requireZombie(state);
			const sv = recruitSurvivor(state, rng, a);
			const n = Object.values(state.group!.survivors).filter(isActive).length;
			const warn = outbreakDay(state) < 7 && n > 2 ? ` NOTE: ${n} companions before the first week is out is a lot; the player should mostly be alone early on.` : "";
			const gear = sv.gear.map((g) => `${getEquipment(g.ref)?.name ?? g.ref}${g.qty > 1 ? ` x${g.qty}` : ""}`).join(", ");
			return `${nameOf(state, sv)} joins the group: ${professionLabel(sv.profession)} ${sv.level}, HP ${sv.hp}/${sv.maxHp}, morale ${sv.morale}/10, with the party. Perk: ${PROFESSIONS[sv.profession].perk.name}. Gear: ${gear || "nothing"}.${warn}`;
		}),
);

export const updateSurvivorTool = tool<{ npcId: string; morale?: number; status?: "with_party" | "at_base" | "dead"; hp?: number; note?: string; give?: { ref: string; qty: number }; take?: { ref: string; qty: number }; treat?: "antiviral" | "amputation" }>(
	"update_survivor",
	"The Quiet: change a companion survivor after something happens in the story. morale is a DELTA (0–10 scale): the player saves them or someone they love +2; a promise kept, a good meal shared, a win +1; ignoring their needs or their advice −1; being put in needless danger, a broken promise, the player hurting someone innocent −2; cruelty to them −3. (The engine already applies −1 per day without food/water and −2 to everyone when a member dies or turns: don't repeat those.) At morale 0 they leave (or, if volatile, steal supplies and leave) at the next 08:00, so play the tension first. status: with_party / at_base (needs a base) / dead (killed in the story). hp: a delta outside combat (a nurse's care +, a fall −). give / take: move an item between the player's inventory and the survivor's gear (e.g. give them rounds for their gun). treat: 'antiviral' uses the player's LAZARUS antiviral to cure their infection; 'amputation' cuts off a bitten limb (stops it only within an hour of the bite). note: a short DM note.",
	S.obj(
		{
			npcId: S.str(),
			morale: S.int("Delta, e.g. 2 or -1", -10, 10),
			status: S.str(undefined, ["with_party", "at_base", "dead"]),
			hp: S.int("Delta outside combat", -100, 100),
			note: S.str("Why (kept as a DM note)"),
			give: S.obj({ ref: S.str(), qty: S.int(undefined, 1) }, ["ref", "qty"]),
			take: S.obj({ ref: S.str(), qty: S.int(undefined, 1) }, ["ref", "qty"]),
			treat: S.str(undefined, ["antiviral", "amputation"]),
		},
		["npcId"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			requireZombie(state);
			const sv = survivorOf(state, a.npcId);
			const name = nameOf(state, sv);
			if (!isActive(sv)) throw new Error(`${name} is no longer in the group (${sv.status}).`);
			const out: string[] = [];
			if (a.treat) out.push(treatSurvivor(state, sv, a.treat, rng));
			if (a.hp) {
				if (state.encounter?.status === "active" && Object.values(state.encounter.combatants).some((c) => c.refId === sv.npcId && !c.dead))
					throw new Error(`${name} is in the fight: use heal / apply_damage on their combatant instead.`);
				sv.hp = Math.max(0, Math.min(sv.maxHp, sv.hp + a.hp));
				out.push(`${name} HP ${sv.hp}/${sv.maxHp}.`);
			}
			if (a.give) {
				const item = state.character.inventory.find((i) => i.ref === a.give!.ref && i.quantity > 0);
				if (!item) throw new Error(`The player has no ${a.give.ref} to give.`);
				const qty = Math.min(item.quantity, a.give.qty);
				item.quantity -= qty;
				if (item.quantity <= 0) state.character.inventory = state.character.inventory.filter((i) => i !== item);
				const g = sv.gear.find((x) => x.ref === a.give!.ref);
				if (g) g.qty += qty;
				else sv.gear.push({ ref: a.give.ref, qty });
				out.push(`Gave ${name} ${qty} × ${item.name}.`);
			}
			if (a.take) {
				const g = sv.gear.find((x) => x.ref === a.take!.ref && x.qty > 0);
				if (!g) throw new Error(`${name} doesn't carry ${a.take.ref}.`);
				const qty = Math.min(g.qty, a.take.qty);
				g.qty -= qty;
				sv.gear = sv.gear.filter((x) => x.qty > 0);
				addInventoryItem(state, { name: getEquipment(a.take.ref)?.name ?? a.take.ref, ref: a.take.ref, quantity: qty }, () => newId("it"));
				out.push(`Took ${qty} × ${getEquipment(a.take.ref)?.name ?? a.take.ref} from ${name}.`);
			}
			if (a.morale) {
				const before = sv.morale;
				adjustMorale(sv, a.morale);
				out.push(`${name}'s morale ${before} → ${sv.morale}/10.${sv.morale <= 0 ? " AT ZERO: unless something changes, they leave (or steal and leave) at the next 08:00." : sv.morale <= 2 ? " Close to breaking." : ""}`);
			}
			if (a.status && a.status !== sv.status) {
				if (a.status === "dead") out.push(killSurvivor(state, sv, a.note ?? "in the story"));
				else {
					if (sv.status === "away") throw new Error(`${name} is away until their errand is done.`);
					if (a.status === "at_base" && !state.group?.base) throw new Error("There is no base yet.");
					sv.status = a.status;
					if (a.status === "at_base") state.scene.npcIds = state.scene.npcIds.filter((id) => id !== sv.npcId);
					out.push(`${name} is now ${a.status.replace("_", " ")}.`);
				}
			}
			if (a.note) state.dmNotes.push(`${name}: ${a.note}`);
			return out.join(" ") || `Nothing changed for ${name}.`;
		}),
);

export const sendSurvivorTool = tool<{ npcId: string; task: ErrandTask; hours: number }>(
	"send_survivor",
	"The Quiet: send a companion on an errand without the player: scavenge (supplies), scout (information), fetch_water, hunt (food), guard (watch the base). They are away for `hours` (1–24); when the clock reaches their return the engine secretly rolls the outcome (longer trips, later outbreak days, night and the wrong profession make trouble likelier: injury, a bite, or they never come back) and reports it to you; finds go to the base stock if there is a base, else the player's inventory. Narrate it when they return.",
	S.obj({ npcId: S.str(), task: S.str(undefined, ERRAND_TASKS), hours: S.int(undefined, 1, 24) }, ["npcId", "task", "hours"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			return sendSurvivor(state, survivorOf(state, a.npcId), a.task, a.hours);
		}),
);

export const dismissSurvivorTool = tool<{ npcId: string; reason: string }>(
	"dismiss_survivor",
	"The Quiet: a companion leaves the group (the player sends them away, they part ways, they stay behind somewhere). They keep their own gear and stay in the codex as an NPC where they are now.",
	S.obj({ npcId: S.str(), reason: S.str() }, ["npcId", "reason"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			const sv = survivorOf(state, a.npcId);
			const name = nameOf(state, sv);
			if (!isActive(sv)) throw new Error(`${name} is not in the group (${sv.status}).`);
			if (sv.status === "away") throw new Error(`${name} is away on an errand.`);
			sv.status = "left";
			const npc = state.npcs[sv.npcId];
			if (npc) npc.locationId = state.world.currentLocationId;
			state.dmNotes.push(`${name} left the group: ${a.reason}`);
			return `${name} leaves the group (${a.reason}).`;
		}),
);

export const GROUP_TOOLS: ToolFactory[] = [recruitSurvivorTool, updateSurvivorTool, sendSurvivorTool, dismissSurvivorTool];
