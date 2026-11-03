import type { GameState, MapEntity } from "../game/types";
import { placeEntity } from "../maps";
import { getSpell } from "../srd";

/**
 * Concentration spells that create something you can see on the battlefield.
 * While the player concentrates on one, its token stands on the active map;
 * when concentration ends the token goes away. The DM moves it with
 * update_entity (e.g. "I roll the sphere into him").
 */
export const SPELL_TOKENS: Record<string, { sprite: string; name: string; light?: number }> = {
	"flaming-sphere": { sprite: "flaming_sphere", name: "Flaming Sphere", light: 4 },
	moonbeam: { sprite: "moonbeam", name: "Moonbeam", light: 2 },
	"cloud-of-daggers": { sprite: "daggers", name: "Cloud of Daggers" },
	"dancing-lights": { sprite: "wisp", name: "Dancing Lights", light: 2 },
	"arcane-hand": { sprite: "arcane_hand", name: "Arcane Hand" },
	"bigbys-hand": { sprite: "arcane_hand", name: "Arcane Hand" },
	"call-lightning": { sprite: "storm_cloud", name: "Storm Cloud" },
};

const tokenId = (casterId: string, spell: string) => `spell_${casterId}_${spell}`;

/** The spell the player is concentrating on right now (combat state wins while a fight is on). */
function pcConcentration(state: GameState): string | undefined {
	const enc = state.encounter;
	if (enc?.status === "active") {
		const c = enc.combatants[state.character.id];
		if (c) return c.concentration;
	}
	return state.character.concentration?.spell;
}

/**
 * Adds the token for the player's active concentration spell and removes
 * tokens whose concentration has ended. Returns a note for the DM when a token
 * is created, so it knows the id to move.
 */
export function syncSpellTokens(state: GameState): string | undefined {
	const expired = expireConcentration(state);
	const placed = syncTokens(state);
	return [expired, placed].filter(Boolean).join("\n") || undefined;
}

const nowMinutes = (s: GameState) => s.time.day * 1440 + s.time.hour * 60 + (s.time.minute ?? 0);

/** "Up to 10 minutes" → 10. Rounds count as a minute. */
export function durationMinutes(duration: string): number | undefined {
	const m = /(\d+)\s*(round|minute|hour|day)/i.exec(duration);
	if (!m) return undefined;
	const n = Number(m[1]);
	return { round: 1, minute: n, hour: n * 60, day: n * 1440 }[m[2].toLowerCase() as "round"] ?? undefined;
}

/** Outside combat, concentration ends when the spell's duration has passed on the game clock. */
function expireConcentration(state: GameState): string | undefined {
	const c = state.character.concentration;
	if (!c || state.encounter?.status === "active") return;
	const now = nowMinutes(state);
	if (c.since === undefined) {
		c.since = now;
		return;
	}
	const spell = getSpell(c.spell);
	const max = spell ? durationMinutes(spell.duration) : undefined;
	if (max === undefined || now - c.since < Math.max(1, max)) return;
	delete state.character.concentration;
	return `${spell?.name ?? c.spell} has run its course (${spell?.duration}); concentration ended.`;
}

function syncTokens(state: GameState): string | undefined {
	const map = state.activeMapId ? state.maps[state.activeMapId] : undefined;
	if (!map) return;
	const casterId = state.character.id;
	const active = pcConcentration(state);
	const keepId = active && SPELL_TOKENS[active] ? tokenId(casterId, active) : undefined;
	map.entities = map.entities.filter((e) => !e.id.startsWith("spell_") || e.id === keepId);
	if (!keepId || !active || map.entities.some((e) => e.id === keepId)) return;
	const def = SPELL_TOKENS[active];
	const pc = map.entities.find((e) => e.kind === "pc");
	if (!pc) return;
	// Next to the nearest enemy in reach, else beside the caster.
	const foes = map.entities.filter((e) => e.kind === "monster" && !e.hidden && e.disposition !== "friendly");
	const near = foes.map((f) => ({ f, d: Math.max(Math.abs(f.x - pc.x), Math.abs(f.y - pc.y)) })).filter((x) => x.d <= 12).sort((a, b) => a.d - b.d)[0]?.f;
	const at = near ? { x: near.x + Math.sign(pc.x - near.x), y: near.y + Math.sign(pc.y - near.y) } : { x: pc.x + 1, y: pc.y };
	const e: MapEntity = placeEntity(
		map,
		{ id: keepId, kind: "light", name: def.name, sprite: def.sprite, disposition: "friendly", ...(def.light ? { lightRadius: def.light } : {}), description: `${state.character.name}'s ${def.name}` },
		at,
	);
	return `${def.name} appears on the map as [${e.id}] at ${e.x},${e.y}; move it with update_entity when ${state.character.name} moves it. It disappears when concentration ends.`;
}
