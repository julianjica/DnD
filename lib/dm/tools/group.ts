import type { GameState } from "../../game/types";
import { markBeat } from "../../rules/threads";
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
import { FACETS, logBeat, reveal, shiftBond, type Facet } from "../../rules/companions";
import { outbreakDay } from "../../rules/ruleset";
import { gameMinutes, isZombie } from "../../rules/survival";
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

export const updateSurvivorTool = tool<{ npcId: string; morale?: number; status?: "with_party" | "at_base" | "dead"; hp?: number; note?: string; give?: { ref: string; qty: number }; take?: { ref: string; qty: number }; treat?: "antiviral" | "amputation"; forget?: boolean }>(
	"update_survivor",
	"The Quiet: change a companion survivor after something happens in the story. morale is a DELTA (0–10 scale): the player saves them or someone they love +2; a promise kept, a good meal shared, a win +1; ignoring their needs or their advice −1; being put in needless danger, a broken promise, the player hurting someone innocent −2; cruelty to them −3. (The engine already applies −1 per day without food/water and −2 to everyone when a member dies or turns: don't repeat those.) At morale 0 they leave (or, if volatile, steal supplies and leave) at the next 08:00, so play the tension first. status: with_party / at_base (needs a base) / dead (killed in the story). hp: a delta outside combat (a nurse's care +, a fall −). give / take: move an item between the player's inventory and the survivor's gear (e.g. give them rounds for their gun). treat: 'antiviral' uses the player's LAZARUS antiviral to cure their infection; 'amputation' cuts off a bitten limb (stops it only within an hour of the bite). note: a short DM note. forget=true ERASES the record entirely — only for a retcon (a duplicate or a record the story undid), never for a death.",
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
			forget: S.bool("Retcon only: erase this companion record (duplicates, undone story)"),
		},
		["npcId"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state, rng }) => {
			requireZombie(state);
			const sv = survivorOf(state, a.npcId);
			const name = nameOf(state, sv);
			if (a.forget) {
				delete state.group!.survivors[sv.npcId];
				for (const ex of state.group!.expeditions ?? []) ex.members = ex.members.filter((m) => m !== sv.npcId);
				return `${name}'s companion record [${sv.npcId}] is erased (retcon).${a.note ? ` (${a.note})` : ""}`;
			}
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

export const setCompanionProfileTool = tool<{ npcId: string; want?: string; fear?: string; secret?: string }>(
	"set_companion_profile",
	"The Quiet: define what a companion WANTS most, what they FEAR and a SECRET they keep (one short English line each, grounded in what the story has already shown about them: \"to find her brother in Millbrook\", \"being left behind\", \"he ran when his wife was bitten\"). Hidden from the player until revealed in a camp scene (companion_beat reveal). Pass only the parts you are setting; a part the player already knows can't be rewritten.",
	S.obj({ npcId: S.str(), want: S.str("What they want most"), fear: S.str("What they're afraid of"), secret: S.str("Something they hide") }, ["npcId"]),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			const sv = survivorOf(state, a.npcId);
			const name = nameOf(state, sv);
			const set = FACETS.filter((f) => typeof a[f] === "string" && a[f]!.trim());
			if (!set.length) throw new Error("Give at least one of want, fear, secret.");
			for (const f of set) {
				if (sv.revealed?.includes(f) && sv[f] && sv[f] !== a[f]!.trim()) throw new Error(`The player already knows ${name}'s ${f} ("${sv[f]}"); it can't be rewritten.`);
				sv[f] = a[f]!.trim();
			}
			const missing = FACETS.filter((f) => !sv[f]);
			// Don't echo the text: tool summaries show in the player's log (the digest has it for you).
			return `${name}: ${set.join(", ")} set (hidden from the player until revealed).${missing.length ? ` Still undefined: ${missing.join(", ")}.` : ""}`;
		}),
);

export const companionBeatTool = tool<{ npcIds: string[]; morale?: { npcId: string; delta: number }[]; bonds?: { a: string; b: string; delta: number }[]; reveal?: { npcId: string; what: Facet }; note?: string }>(
	"companion_beat",
	"The Quiet: the outcome of a CAMP SCENE (or any small moment between companions) once the player has responded. npcIds: who was in it. morale: per-companion deltas (±1 usually, ±2 at most) earned by how the player handled it. bonds: how two companions now feel about each other (delta ±1, at most ±2; symmetric; −3 … +3). reveal: the want / fear / secret the player just learnt. note: ONE short line for the player's log, in the campaign's language, from the player's side (\"Priya y Wade discutieron por el agua; tú le diste la razón a Priya\"). Not for the player's own choices or spotlight: this is about the companions.",
	S.obj(
		{
			npcIds: S.arr(S.str(), "The companions in the scene"),
			morale: S.arr(S.obj({ npcId: S.str(), delta: S.int("±1 usually, ±2 at most", -2, 2) }, ["npcId", "delta"])),
			bonds: S.arr(S.obj({ a: S.str("npcId"), b: S.str("npcId"), delta: S.int("±1 usually, ±2 at most", -2, 2) }, ["a", "b", "delta"])),
			reveal: S.obj({ npcId: S.str(), what: S.str(undefined, FACETS) }, ["npcId", "what"]),
			note: S.str("One short line for the player's log, in the campaign's language"),
		},
		["npcIds"],
	),
	async (a, ctx) =>
		withState(ctx, ({ state }) => {
			requireZombie(state);
			const ids = [...new Set(a.npcIds ?? [])];
			if (!ids.length) throw new Error("npcIds: who was in the scene?");
			markBeat(state, "human");
			const member = (id: string) => {
				const sv = survivorOf(state, id);
				if (!isActive(sv)) throw new Error(`${nameOf(state, sv)} is no longer in the group (${sv.status}).`);
				return sv;
			};
			const people = ids.map(member);
			// Validate everything before changing anything.
			for (const m of a.morale ?? []) member(m.npcId);
			for (const b of a.bonds ?? []) {
				if (b.a === b.b) throw new Error("A bond needs two different companions.");
				member(b.a);
				member(b.b);
			}
			if (a.reveal) {
				if (!FACETS.includes(a.reveal.what)) throw new Error(`reveal.what must be one of ${FACETS.join(", ")}.`);
				const sv = member(a.reveal.npcId);
				if (!sv[a.reveal.what]) throw new Error(`${nameOf(state, sv)} has no ${a.reveal.what} defined yet: set_companion_profile first.`);
			}
			const out: string[] = [];
			const clamp2 = (n: number) => Math.max(-2, Math.min(2, Math.round(n || 0)));
			for (const m of a.morale ?? []) {
				const sv = member(m.npcId);
				const before = sv.morale;
				adjustMorale(sv, clamp2(m.delta));
				out.push(`${nameOf(state, sv)} morale ${before} → ${sv.morale}/10${sv.morale <= 0 ? " (AT ZERO: they leave at the next 08:00 unless something changes)" : ""}`);
			}
			for (const b of a.bonds ?? []) {
				const x = member(b.a);
				const y = member(b.b);
				out.push(`${nameOf(state, x)} ↔ ${nameOf(state, y)} bond ${shiftBond(x, y, clamp2(b.delta))}`);
			}
			if (a.reveal) {
				const sv = member(a.reveal.npcId);
				reveal(sv, a.reveal.what);
				out.push(`the player now knows ${nameOf(state, sv)}'s ${a.reveal.what}: "${sv[a.reveal.what]}"`);
			}
			const now = gameMinutes(state.time);
			for (const sv of people) sv.lastBeatAt = now;
			const names = people.map((sv) => nameOf(state, sv)).join(", ");
			const note = (a.note ?? "").trim().slice(0, 200);
			logBeat(state, now, names, note);
			return `Camp scene (${names}): ${out.join("; ") || "no change"}.`;
		}),
);

export const GROUP_TOOLS: ToolFactory[] = [recruitSurvivorTool, updateSurvivorTool, sendSurvivorTool, dismissSurvivorTool, setCompanionProfileTool, companionBeatTool];
