import { doorSummary, roomOf } from "./mapsync";
import { linkSummary } from "../maps/links";
import { fallenSummary } from "../rules/fallen";
import type { GameState, LogEntry } from "../game/types";
import { barricadeSummary } from "../rules/barricade";
import { outbreakDay, rulesetOf } from "../rules/ruleset";
import { survivalDigest } from "../rules/survival";
import { baseDigest } from "../rules/base";
import { groupDigest } from "../rules/group";
import { townDigest } from "../rules/town";
import { expeditionDigest } from "../rules/expeditions";
import { storyDigest, voiceDigest } from "../rules/threads";
import { radioDigest } from "../rules/radio";
import { siegeDigest } from "../rules/siege";
import { cyberDigest } from "../rules/cyber";
import { netrunDigest } from "../rules/netrun";
import { rulesetLabelEn } from "../i18n/ruleset-labels";
import { getClass, getSpecies, getSubclass } from "../srd/index";
import { compassOf, mapDistance, travelDaysIn, travelText } from "../maps/geography";

/**
 * A compact, authoritative summary of the game state injected into every DM
 * turn. Keeps CLI sessions consistent across resume, compaction and engine
 * switches. Hidden info (DM notes, NPC secrets, hidden entities) IS included
 * because only the DM reads it.
 */
export function stateDigest(s: GameState, opts: { recentLog?: LogEntry[]; ac?: number } = {}): string {
	const c = s.character;
	const lvl = c.classes.reduce((n, k) => n + k.level, 0);
	const lines: string[] = [];
	const t = s.time;
	lines.push(`Day ${t.day}, ${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")} · mode: ${s.mode} · view: ${s.view}`);
	if (rulesetOf(s.settings) === "zombie") lines.push(`Outbreak day ${outbreakDay(s)} (Day 0 = the outbreak night). Only dead variants that exist by now may appear.`);
	lines.push(`Scene: ${s.scene.title} (${s.scene.kind}, ${s.scene.timeOfDay}, ${s.scene.weather}, ${s.scene.mood})`);
	const loc = s.world.locations.find((l) => l.id === s.world.currentLocationId);
	if (loc) {
		lines.push(`World location: ${loc.name} (${loc.kind})`);
		// Geography as the player SEES it on the world map — narrate directions and distances consistently with this.
		const known = s.world.locations.filter((l) => l.discovered && l.id !== loc.id);
		if (known.length)
			lines.push(`Map geography from ${loc.name}: ${known.map((l) => `${l.name} [${l.id}] ${compassOf(loc, l)} ~${travelText(travelDaysIn(s.world, mapDistance(loc, l)))}`).join("; ")}`);
		const regions = (s.world.terrain.features ?? []).filter((f) => f.name);
		if (regions.length) lines.push(`Named regions: ${regions.map((f) => `${f.name} (${f.terrain}) ${compassOf(loc, f)} of here`).join("; ")}`);
	}

	const rs = rulesetOf(s.settings);
	// The Quiet: the DM reads professions and origins ("Chemistry Teacher · Engineer (Demolitions) 3 [wizard/evocation]").
	const label = (text: string) => rulesetLabelEn(rs, text);
	const classText = (k: (typeof c.classes)[number]) =>
		rs === "fantasy"
			? `${k.classId}${k.subclassId ? `(${k.subclassId})` : ""} ${k.level}`
			: `${label(getClass(k.classId)?.name ?? k.classId)}${k.subclassId ? ` (${label(getSubclass(k.subclassId)?.name ?? k.subclassId)})` : ""} ${k.level} [${k.classId}${k.subclassId ? `/${k.subclassId}` : ""}]`;
	const speciesText = rs === "fantasy" ? `${c.speciesId}${c.subspeciesId ? `/${c.subspeciesId}` : ""}` : `${getSpecies(c.speciesId)?.name ?? c.speciesId} origin`;
	lines.push(
		`PC: ${c.name}, ${speciesText} ${c.classes.map(classText).join("/")} (level ${lvl}), HP ${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp} temp` : ""}${opts.ac !== undefined ? `, AC ${opts.ac}` : ""}, XP ${c.xp}`,
	);
	const ab = c.abilities;
	lines.push(`Abilities: STR ${ab.str} DEX ${ab.dex} CON ${ab.con} INT ${ab.int} WIS ${ab.wis} CHA ${ab.cha}`);
	if (c.conditions.length || c.exhaustion) lines.push(`Conditions: ${[...c.conditions.map((x) => x.id), c.exhaustion ? `exhaustion ${c.exhaustion}` : ""].filter(Boolean).join(", ")}`);
	const survival = survivalDigest(s);
	if (survival) lines.push(survival);
	const base = rulesetOf(s.settings) === "zombie" ? baseDigest(s) : undefined;
	if (base) lines.push(base);
	const group = rs === "zombie" ? groupDigest(s) : undefined;
	if (group) lines.push(group);
	const town = rs === "zombie" ? townDigest(s) : undefined;
	if (town) lines.push(town);
	const expeditions = rs === "zombie" ? expeditionDigest(s) : undefined;
	if (expeditions) lines.push(expeditions);
	const radio = rs === "zombie" ? radioDigest(s) : undefined;
	if (radio) lines.push(radio);
	const siege = rs === "zombie" ? siegeDigest(s) : undefined;
	if (siege) lines.push(siege);
	const cyber = rs === "cyberpunk" ? cyberDigest(s) : undefined;
	if (cyber) lines.push(cyber);
	const netrun = rs === "cyberpunk" ? netrunDigest(s) : undefined;
	if (netrun) lines.push(netrun);
	if (c.hp === 0) lines.push(`Death saves: ${c.deathSaves.successes} successes / ${c.deathSaves.failures} failures`);
	if (c.spellcasting) {
		const sl = c.spellcasting.slots
			.map((max, i) => (max ? `L${i + 1} ${max - (c.spellcasting!.slotsUsed[i] ?? 0)}/${max}` : ""))
			.filter(Boolean)
			.join(", ");
		if (sl) lines.push(`${rs === "zombie" ? "Technique slots" : rs === "cyberpunk" ? "Program slots (RAM)" : "Spell slots"}: ${sl}${c.spellcasting.pact ? `; pact L${c.spellcasting.pact.level} ${c.spellcasting.pact.max - c.spellcasting.pact.used}/${c.spellcasting.pact.max}` : ""}`);
		const prepared = c.spellcasting.classes.flatMap((k) => [...k.cantrips, ...k.prepared]);
		if (prepared.length) lines.push(`${rs === "zombie" ? "Techniques ready" : rs === "cyberpunk" ? "Programs loaded" : "Spells ready"}: ${prepared.join(", ")}`);
	}
	if (c.concentration) lines.push(`Concentrating on: ${c.concentration.spell}`);
	const limited = c.features.filter((f) => f.uses).map((f) => `${label(f.name)} ${f.uses!.max - f.uses!.used}/${f.uses!.max}`);
	if (limited.length) lines.push(`Limited features: ${limited.join(", ")}`);
	const gear = c.inventory.map((i) => `${i.name}${i.quantity > 1 ? ` x${i.quantity}` : ""}${i.equipped ? " (eq)" : ""}`);
	lines.push(`Inventory: ${gear.join(", ") || "nothing"}; coins ${c.currency.gp} gp, ${c.currency.sp} sp, ${c.currency.cp} cp${c.currency.pp ? `, ${c.currency.pp} pp` : ""}`);

	const quests = s.quests.filter((q) => q.status === "active");
	if (quests.length) {
		lines.push("Active quests:");
		for (const q of quests) lines.push(`- [${q.id}] ${q.title}: ${q.objectives.map((o) => `${o.done ? "✓" : "○"} ${o.text}`).join("; ")}`);
	}

	const npcs = Object.values(s.npcs);
	const here = npcs.filter((n) => s.scene.npcIds.includes(n.id));
	if (here.length) lines.push(`NPCs present: ${here.map((n) => `${n.name} [${n.id}] (${n.role}, ${n.disposition}${n.alive ? "" : ", dead"})${n.secret ? ` secret: ${n.secret}` : ""}`).join("; ")}`);
	const voices = voiceDigest(s);
	if (voices) lines.push(voices);
	if (npcs.length > here.length) {
		const away = npcs.filter((n) => !here.includes(n) && !/retcon/i.test(n.role ?? ""));
		const short = (r?: string) => (!r ? "?" : r.length > 40 ? `${r.slice(0, 38)}…` : r);
		const living = away.filter((n) => n.alive).map((n) => `${n.name} [${n.id}] (${short(n.role)})`);
		const dead = away.filter((n) => !n.alive).map((n) => n.name);
		if (living.length) lines.push(`Other known NPCs: ${living.join(", ")}`);
		if (dead.length) lines.push(`Dead NPCs: ${dead.join(", ")}`);
	}

	const fallen = fallenSummary(s);
	if (fallen) lines.push(fallen);

	if (s.activeMapId && s.maps[s.activeMapId]) {
		const m = s.maps[s.activeMapId];
		const ents = m.entities.map((e) => {
			const room = e.kind === "pc" || e.kind === "monster" || e.kind === "npc" ? roomOf(m, e) : undefined;
			return `${e.name}[${e.id}]@${e.x},${e.y}${room ? ` in ${room}` : ""}${e.hidden ? " hidden" : ""}${e.dead ? " DEAD" : ""}`;
		});
		lines.push(`Active map: ${m.name} [${m.id}] ${m.kind} ${m.width}x${m.height}, ${m.lighting}. Rooms: ${m.rooms.map((r) => `${r.id}${r.tag ? `(${r.tag})` : ""}${r.name ? ` "${r.name}"` : ""}`).join(", ")}`);
		lines.push(`Entities: ${ents.join(", ")}`);
		const doors = doorSummary(m);
		if (doors) lines.push(`Doors (closed ones open when walked through; locked ones need set_tile): ${doors}`);
		const links = linkSummary(s, m);
		if (links) lines.push(`Exits to other maps of this place (walking onto them takes the party there): ${links}`);
		const barricades = barricadeSummary(m);
		if (barricades) lines.push(`Barricades (block movement and sight; damage_barricade when the dead pound on them, build_barricade repairs): ${barricades}`);
	}

	if (s.encounter && s.encounter.status === "active") {
		const e = s.encounter;
		const cur = e.combatants[e.order[e.turnIndex]];
		lines.push(`COMBAT round ${e.round}; current turn: ${cur?.name ?? "?"} [${cur?.id}]`);
		for (const id of e.order) {
			const k = e.combatants[id];
			lines.push(`- ${k.name} [${k.id}] ${k.side} init ${k.initiative} HP ${k.hp}/${k.maxHp} AC ${k.ac}${k.dead ? " DEAD" : ""}${k.conditions.length ? ` (${k.conditions.map((x) => x.id).join(",")})` : ""}`);
		}
	}

	if (s.pendingRoll) lines.push(`Waiting for player roll: ${s.pendingRoll.label} (${s.pendingRoll.notation}${s.pendingRoll.dc ? ` vs DC ${s.pendingRoll.dc}` : ""})`);
	// Standing facts always; besides them only the last few notes (old ones fold into the facts).
	if (s.canon?.length) lines.push(`Standing facts (never contradict; set_canon rewrites the list): ${s.canon.join(" | ")}`);
	const fresh = s.dmNotes.slice(s.canonMark ?? 0);
	if (s.dmNotes.length) lines.push(`Recent DM notes: ${s.dmNotes.slice(-6).join(" | ")}`);
	if (fresh.length >= 10 || (!s.canon?.length && s.dmNotes.length >= 8))
		lines.push(`NOTES PILING UP (${fresh.length} since the last set_canon): fold what still matters into set_canon now (≤25 short facts); older notes are dropping out of your view.${s.canon?.length ? "" : ` Your older notes, to fold in: ${s.dmNotes.slice(-30, -6).join(" | ")}`}`);
	const recentJournal = s.journal.slice(-5);
	if (recentJournal.length) lines.push(`Recent journal: ${recentJournal.map((j) => `(day ${j.day}) ${j.text}`).join(" | ")}`);

	if (opts.recentLog?.length) {
		lines.push("Recent play (oldest first):");
		for (const e of opts.recentLog) {
			if (e.role === "roll") continue;
			const text = e.text.length > 400 ? `${e.text.slice(0, 400)}…` : e.text;
			lines.push(`${e.role.toUpperCase()}: ${text}`);
		}
	}
	const story = storyDigest(s);
	if (story) lines.push(story);
	return lines.join("\n");
}
