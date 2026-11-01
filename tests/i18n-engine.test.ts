import { test } from "node:test";
import assert from "node:assert/strict";
import { localizeEngine, tryLocalizeEngine } from "../lib/i18n/engine";

const DICT: Record<string, string> = {
	Goblin: "Trasgo",
	Scimitar: "Cimitarra",
	"Potion of Healing": "Poción de curación",
	"Cure Wounds": "Curar heridas",
	"Fire Bolt": "Descarga de fuego",
	"Second Wind": "Tomar aliento",
	Fireball: "Bola de fuego",
	"Breath Weapon": "Arma de aliento",
	Shortsword: "Espada corta",
};
const srd = (s: string) => DICT[s] ?? s;
const es = (s: string) => localizeEngine("es", s, srd);

const CASES: [string, string][] = [
	// roll labels
	["Ida death saving throw", "Salvación contra muerte de Ida"],
	["Ida attacks Goblin 2 (Scimitar)", "Ida ataca a Trasgo 2 (Cimitarra)"],
	["Goblin opportunity attack Ida (Scimitar)", "Trasgo: ataque de oportunidad contra Ida (Cimitarra)"],
	["Scimitar damage (slashing) — critical", "Daño de Cimitarra (cortante) — crítico"],
	["Fireball damage (fire)", "Daño de Bola de fuego (fuego)"],
	["Fireball damage", "Daño de Bola de fuego"],
	["Goblin 3 initiative (surprised)", "Iniciativa de Trasgo 3 (sorprendido)"],
	["Ida initiative", "Iniciativa de Ida"],
	["Goblin 1 DEX save vs Fireball", "Trasgo 1: salvación de DES contra Bola de fuego"],
	["Cure Wounds healing", "Curación de Curar heridas"],
	["Ida Stealth (Hide)", "Ida: Sigilo (Esconderse)"],
	["Ida spends a hit die", "Ida gasta un dado de golpe"],
	["Ida rolls hit points", "Ida tira puntos de golpe"],
	["Ability score 3 (4d6 drop lowest)", "Característica 3 (4d6, descarta el menor)"],
	["Goblin 2 recharge Breath Weapon (5–6)", "Trasgo 2: recarga de Arma de aliento (5–6)"],
	["perception check", "Prueba de Percepción"],
	["sleight-of-hand check", "Prueba de Juego de manos"],
	["DEX check", "Prueba de DES"],
	["WIS save", "Salvación de SAB"],
	["Damage to Goblin 1", "Daño a Trasgo 1"],
	// combat errors
	["It is not your turn.", "No es tu turno."],
	["No action left for Dodge.", "No te queda acción para Esquivar."],
	["No bonus action left for off-hand attack.", "No te queda acción adicional para el ataque con la mano torpe."],
	["Goblin 2 is out of range (60 ft > 30 ft).", "Trasgo 2 está fuera de alcance (60 pies > 30 pies)."],
	["Not enough movement: path costs 35 ft (+15 ft to stand up), 30 ft left.", "Movimiento insuficiente: la ruta cuesta 35 pies (+15 pies para levantarse), quedan 30 pies."],
	["Fire Bolt needs a target.", "Descarga de fuego necesita un objetivo."],
	["No level 2 spell slots left.", "No te quedan espacios de conjuro de nivel 2."],
	["Potion of Healing has no defined combat effect; describe what you do instead.", "Poción de curación no tiene un efecto de combate definido; describe lo que haces."],
	["Goblin 1 is dead.", "Trasgo 1 ha muerto."],
	["Square (3,4) is blocked.", "La casilla (3,4) está bloqueada."],
	// rules / route errors
	["Only 2 hit dice left", "Solo quedan 2 dados de golpe"],
	["Second Wind: only 0 use(s) left", "Tomar aliento: solo quedan 0 usos"],
	["No level-3 spell slot left", "No queda ningún espacio de conjuro de nivel 3"],
	["Campaign not found", "Campaña no encontrada"],
	["The DM is still narrating.", "El DM sigue narrando."],
	["Path must be contiguous.", "La ruta debe ser continua."],
	["Can't multiclass into Wizard: Wizard requires INT 13", "No puedes multiclasear a Mago: Mago requiere INT 13"],
	['Missing choice "Wizard cantrips" (cantrips)', "Falta la elección «Trucos de Mago» (cantrips)"],
	["Ida needs more XP to reach level 4", "Ida necesita más PX para alcanzar el nivel 4"],
	// level-up / creation labels
	['Ability Score Improvement: two abilities (repeat one for +2), or a feat as "feat:<index>"', "Mejora de característica: dos características (repite una para +2) o una dote"],
	["Rogue skills", "Habilidades de Pícaro"],
	["Bard spells known", "Conjuros conocidos de Bardo"],
	["Spells added to your spellbook", "Conjuros añadidos a tu libro de conjuros"],
	["Mystic Arcanum (7th level)", "Arcano místico (nivel 7)"],
	["Fighter multiclass skill", "Habilidad de multiclase de Guerrero"],
	["STR", "FUE"],
	["Sleight Of Hand", "Juego de manos"],
	// sheet use lines
	["Used 1 × Potion of Healing (1 left).", "Usas 1 × Poción de curación (queda 1)."],
	["Ida casts Cure Wounds (level 1 slot).", "Ida lanza Curar heridas (espacio de nivel 1)."],
	["Second Wind used: 0/1 left (recharges on short rest).", "Tomar aliento usado: quedan 0/1 (se recarga con un descanso corto)."],
	["Used 1 × Potion of Healing (0 left). Potion of Healing healing: 7 → HP 12/20", "Usas 1 × Poción de curación (quedan 0). Curación de Poción de curación: 7 → PG 12/20"],
	// combat log / tool summaries
	["Goblin 1 attacks Ida with Scimitar: 15 vs AC 14 — hit (adv: target prone).", "Trasgo 1 ataca a Ida con Cimitarra: 15 contra CA 14 — impacta (ventaja: objetivo derribado)."],
	["Ida takes 5 slashing damage → 7/12 HP.", "Ida recibe 5 de daño cortante → 7/12 PG."],
	["Goblin 2 is prone.", "Trasgo 2 queda derribado."],
	["— Round 2: Goblin 1's turn.", "— Asalto 2: turno de Trasgo 1."],
	["perception check: 14 (d20 12 +2) vs DC 15: FAILURE", "Prueba de Percepción: 14 (d20 12 +2) contra CD 15: FALLO"],
	["Victory! 50 XP earned.", "¡Victoria! 50 PX obtenidos."],
	["Goblin 1 succeeds a DC 13 DEX save vs Fireball (15).", "Trasgo 1 supera una salvación de DES CD 13 contra Bola de fuego (15)."],
	["Goblin 1 automatically fails the DEX save vs Fireball (DC 13).", "Trasgo 1 falla automáticamente la salvación de DES contra Bola de fuego (CD 13)."],
	["Goblin 1 takes no damage (immune to fire).", "Trasgo 1 no recibe daño (inmune a fuego)."],
	["Short rest: spent 2 hit dice, regained 9 HP. HP 20/20.", "Descanso corto: gastas 2 dados de golpe y recuperas 9 PG. PG 20/20."],
];

for (const [en, want] of CASES) {
	test(`es: ${en}`, () => assert.equal(es(en), want));
}

test("English is returned unchanged", () => {
	for (const [en] of CASES) assert.equal(localizeEngine("en", en, srd), en);
});

test("unmatched text is returned unchanged; tryLocalizeEngine reports it", () => {
	const free = "The goblin snarls and lunges at you from the shadows";
	assert.equal(es(free), free);
	assert.equal(tryLocalizeEngine("es", free, srd), null);
	assert.equal(tryLocalizeEngine("es", "Campaign not found", srd), "Campaña no encontrada");
});

test("works without an SRD translator (names pass through)", () => {
	assert.equal(localizeEngine("es", "Goblin 2 is dead."), "Goblin 2 ha muerto.");
	assert.equal(localizeEngine("es", "Fireball damage (fire)"), "Daño de Fireball (fuego)");
});

test("partially matched multi-sentence text stays English", () => {
	const mixed = "It is not your turn. Something the engine never says.";
	assert.equal(es(mixed), mixed);
});
