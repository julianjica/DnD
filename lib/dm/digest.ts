import type { GameState, LogEntry } from "../game/types";

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
	lines.push(`Scene: ${s.scene.title} (${s.scene.kind}, ${s.scene.timeOfDay}, ${s.scene.weather}, ${s.scene.mood})`);
	const loc = s.world.locations.find((l) => l.id === s.world.currentLocationId);
	if (loc) lines.push(`World location: ${loc.name} (${loc.kind})`);

	lines.push(
		`PC: ${c.name}, ${c.speciesId}${c.subspeciesId ? `/${c.subspeciesId}` : ""} ${c.classes.map((k) => `${k.classId}${k.subclassId ? `(${k.subclassId})` : ""} ${k.level}`).join("/")} (level ${lvl}), HP ${c.hp}/${c.maxHp}${c.tempHp ? ` +${c.tempHp} temp` : ""}${opts.ac !== undefined ? `, AC ${opts.ac}` : ""}, XP ${c.xp}`,
	);
	const ab = c.abilities;
	lines.push(`Abilities: STR ${ab.str} DEX ${ab.dex} CON ${ab.con} INT ${ab.int} WIS ${ab.wis} CHA ${ab.cha}`);
	if (c.conditions.length || c.exhaustion) lines.push(`Conditions: ${[...c.conditions.map((x) => x.id), c.exhaustion ? `exhaustion ${c.exhaustion}` : ""].filter(Boolean).join(", ")}`);
	if (c.hp === 0) lines.push(`Death saves: ${c.deathSaves.successes} successes / ${c.deathSaves.failures} failures`);
	if (c.spellcasting) {
		const sl = c.spellcasting.slots
			.map((max, i) => (max ? `L${i + 1} ${max - (c.spellcasting!.slotsUsed[i] ?? 0)}/${max}` : ""))
			.filter(Boolean)
			.join(", ");
		if (sl) lines.push(`Spell slots: ${sl}${c.spellcasting.pact ? `; pact L${c.spellcasting.pact.level} ${c.spellcasting.pact.max - c.spellcasting.pact.used}/${c.spellcasting.pact.max}` : ""}`);
		const prepared = c.spellcasting.classes.flatMap((k) => [...k.cantrips, ...k.prepared]);
		if (prepared.length) lines.push(`Spells ready: ${prepared.join(", ")}`);
	}
	if (c.concentration) lines.push(`Concentrating on: ${c.concentration.spell}`);
	const limited = c.features.filter((f) => f.uses).map((f) => `${f.name} ${f.uses!.max - f.uses!.used}/${f.uses!.max}`);
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
	if (npcs.length > here.length) lines.push(`Other known NPCs: ${npcs.filter((n) => !here.includes(n)).map((n) => `${n.name} [${n.id}] (${n.role})`).join(", ")}`);

	if (s.activeMapId && s.maps[s.activeMapId]) {
		const m = s.maps[s.activeMapId];
		const ents = m.entities.map((e) => `${e.name}[${e.id}]@${e.x},${e.y}${e.hidden ? " hidden" : ""}`);
		lines.push(`Active map: ${m.name} [${m.id}] ${m.kind} ${m.width}x${m.height}, ${m.lighting}. Rooms: ${m.rooms.map((r) => `${r.id}${r.tag ? `(${r.tag})` : ""}${r.name ? ` "${r.name}"` : ""}`).join(", ")}`);
		lines.push(`Entities: ${ents.join(", ")}`);
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
	if (s.dmNotes.length) lines.push(`DM notes: ${s.dmNotes.slice(-15).join(" | ")}`);
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
	return lines.join("\n");
}
