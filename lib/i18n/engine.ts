/**
 * Display-time translation of the English text the game engine produces
 * (roll labels, rules errors, level-up choice labels, resource/combat log
 * lines). The engine keeps speaking English — the DM and the tests rely on
 * it — and the UI runs what it shows through `localizeEngine`.
 *
 * Each template is an anchored regex plus a builder. Captured names (spells,
 * items, weapons, monsters, features) go through the optional `srd`
 * translator; combatant names keep their numeric suffix ("Goblin 2").
 * Unmatched text comes back unchanged.
 *
 * Keep this module free of React and `@/` imports: tests run it directly.
 */
import type { Lang } from "./index";
import { es as ES } from "./es";

type Srd = (s: string) => string;

interface H {
	/** SRD text (spell/item/feature/monster name…). */
	s: (x: string) => string;
	/** Combatant/character name, keeping a "Goblin 2" suffix. */
	n: (x: string) => string;
	/** Comma-separated combatant names. */
	names: (x: string) => string;
	/** "DEX" → "DES". */
	ab: (x: string) => string;
	dmg: (x: string) => string;
	cond: (x: string) => string | null;
	skill: (x: string) => string | null;
	cls: (x: string) => string;
	bg: (x: string) => string;
	/** Recursively localize a nested engine string (e.g. a choice label inside an error). */
	loc: (x: string) => string;
	/** Translate a "what" phrase used in "No action left for …". */
	what: (x: string) => string;
}

const ESD = ES as Record<string, string>;
const slug = (x: string) => x.trim().toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function enumEs(group: string, id: string): string | null {
	return ESD[`enum.${group}.${id}`] ?? null;
}
const lower = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
const plural = (n: string | number, one: string, many: string) => (Number(n) === 1 ? one : many);

const ACTIONS: Record<string, string> = {
	attack: "Atacar",
	dash: "Correr",
	disengage: "Retirarse",
	dodge: "Esquivar",
	help: "Ayudar",
	hide: "Esconderse",
	ready: "Preparar",
	search: "Buscar",
	"use an object": "Usar un objeto",
	"off-hand attack": "el ataque con la mano torpe",
};

const ATTACK_WHY: Record<string, string> = {
	"attacker blinded": "atacante cegado",
	"attacker poisoned": "atacante envenenado",
	"attacker frightened": "atacante asustado",
	"attacker prone": "atacante derribado",
	"attacker restrained": "atacante apresado",
	"attacker invisible": "atacante invisible",
	"attacker hidden": "atacante escondido",
	helped: "ayudado",
	help: "ayuda",
	"target blinded": "objetivo cegado",
	"target invisible": "objetivo invisible",
	"target hidden": "objetivo escondido",
	"target unconscious": "objetivo inconsciente",
	"target dodging": "objetivo esquivando",
	"target paralyzed": "objetivo paralizado",
	"target stunned": "objetivo aturdido",
	"target petrified": "objetivo petrificado",
	"target restrained": "objetivo apresado",
	"target prone": "objetivo derribado",
	"long range": "largo alcance",
	"ranged attack in melee": "ataque a distancia en cuerpo a cuerpo",
	"half cover": "cobertura media",
	"three-quarters cover": "cobertura de tres cuartos",
};

const COMBAT_STATUS: Record<string, string> = { victory: "victoria", defeat: "derrota", fled: "huida", ended: "terminado", active: "activo" };

function whyEs(why: string): string {
	return why
		.split("; ")
		.map((part) => {
			const m = /^(adv|dis): (.+)$/.exec(part);
			if (m) return `${m[1] === "adv" ? "ventaja" : "desventaja"}: ${m[2].split(", ").map((w) => ATTACK_WHY[w] ?? w).join(", ")}`;
			return ATTACK_WHY[part] ?? part;
		})
		.join("; ");
}

function slotsEs(x: string): string {
	if (x === "no spell slots") return "sin espacios de conjuro";
	return x.replace(/\bpact L(\d)/g, "pacto N$1").replace(/\bL(\d)/g, "N$1");
}

function timeEs(x: string): string {
	return x
		.replace(/\bbonus action\b/g, "acción adicional")
		.replace(/\breaction\b/g, "reacción")
		.replace(/\baction\b/g, "acción")
		.replace(/\bminutes?\b/g, (w) => (w.endsWith("s") ? "minutos" : "minuto"))
		.replace(/\bhours?\b/g, (w) => (w.endsWith("s") ? "horas" : "hora"));
}

function damageNotes(x: string, h: H): string {
	return x
		.split(", ")
		.map((p) => {
			const m = /^(immune to|resists|vulnerable to) (\w+)$/.exec(p);
			if (!m) return p;
			const t = h.dmg(m[2]);
			return m[1] === "immune to" ? `inmune a ${t}` : m[1] === "resists" ? `resiste ${t}` : `vulnerable a ${t}`;
		})
		.join(", ");
}

const AB = "(STR|DEX|CON|INT|WIS|CHA)";

/** [pattern, builder]; a builder returning null means "not this one, keep looking". */
type Tpl = [RegExp, (m: RegExpMatchArray, h: H) => string | null];

const TEMPLATES: Tpl[] = [
	// ─── API / route errors ──────────────────────────────────────────────
	[/^Campaign not found$/, () => "Campaña no encontrada"],
	[/^The DM is still narrating the previous turn$/, () => "El DM sigue narrando el turno anterior"],
	[/^The DM is still narrating$/, () => "El DM sigue narrando"],
	[/^Wait for the DM to finish$/, () => "Espera a que el DM termine"],
	[/^action required$/, () => "Falta la acción"],
	[/^Unknown op$/, () => "Operación desconocida"],
	[/^settings and character required$/, () => "Faltan la configuración y el personaje"],
	[/^Not in combat$/, () => "No estás en combate"],
	[/^It is not your turn$/, () => "No es tu turno"],
	[/^No roll pending$/, () => "No hay ninguna tirada pendiente"],
	[/^No level-up available$/, () => "No hay ninguna subida de nivel disponible"],
	[/^No active map$/, () => "No hay ningún mapa activo"],
	[/^No player token on the map$/, () => "No hay ficha del jugador en el mapa"],
	[/^Invalid path$/, () => "Ruta no válida"],
	[/^Path must be contiguous$/, () => "La ruta debe ser continua"],
	[/^No active combat$/, () => "No hay ningún combate activo"],
	[/^Combat map missing$/, () => "Falta el mapa de combate"],
	[/^Combat action rejected$/, () => "Acción de combate rechazada"],
	[/^Cannot rest during combat$/, () => "No puedes descansar durante el combate"],
	[/^It is not the player's turn; this needs their action \(reaction-only effects excepted\)$/, () => "No es el turno del jugador; esto requiere su acción (salvo efectos de reacción)"],

	// ─── combat rules errors (lib/rules/combat) ──────────────────────────
	[/^Unknown combatant(?:: (.+))?$/, (m) => `Combatiente desconocido${m[1] ? `: ${m[1]}` : ""}`],
	[/^Duplicate combatant id (.+)$/, (m) => `Identificador de combatiente duplicado: ${m[1]}`],
	[/^No map entity (.+)$/, (m) => `No hay ninguna entidad ${m[1]} en el mapa`],
	[/^No free square for the player character$/, () => "No hay casilla libre para el personaje jugador"],
	[/^No free square for (.+)$/, (m, h) => `No hay casilla libre para ${h.n(m[1])}`],
	[/^Combat is not active$/, () => "El combate no está activo"],
	[/^Use endCombat to remove the player character$/, () => "Usa endCombat para retirar al personaje jugador"],
	[/^Use applyPlayerAction for the player character$/, () => "Usa applyPlayerAction para el personaje jugador"],
	[/^The player character is not AI-controlled$/, () => "El personaje jugador no está controlado por la IA"],
	[/^(.+) cannot reach any target with (.+)$/, (m, h) => `${h.n(m[1])} no alcanza a ningún objetivo con ${h.s(m[2])}`],
	[/^(.+) needs a target point$/, (m, h) => `${h.s(m[1])} necesita un punto objetivo`],
	[/^(.+) needs a target$/, (m, h) => `${h.s(m[1])} necesita un objetivo`],
	[/^(.+) needs targets$/, (m, h) => `${h.s(m[1])} necesita objetivos`],
	[/^(.+) cannot reach \((-?\d+),(-?\d+)\) this turn$/, (m, h) => `${h.n(m[1])} no puede llegar a (${m[2]},${m[3]}) este turno`],
	[/^(.+) has no action named "(.+)"$/, (m, h) => `${h.n(m[1])} no tiene ninguna acción llamada «${h.s(m[2])}»`],
	[/^It is not (.+)'s turn$/, (m, h) => `No es el turno de ${h.n(m[1])}`],
	[/^Only legendary actions can be taken outside the creature's turn, and they cannot include free movement$/, () => "Solo las acciones legendarias pueden realizarse fuera del turno de la criatura, y no pueden incluir movimiento libre"],
	[/^(.+) has already used its bonus action$/, (m, h) => `${h.n(m[1])} ya ha usado su acción adicional`],
	[/^(.+) has already used its action$/, (m, h) => `${h.n(m[1])} ya ha usado su acción`],
	[/^(.+) has no legendary actions left$/, (m, h) => `A ${h.n(m[1])} no le quedan acciones legendarias`],
	[/^(.+) has not recharged$/, (m, h) => `${h.s(m[1])} no se ha recargado`],
	[/^(.+) has no uses left today$/, (m, h) => `A ${h.s(m[1])} no le quedan usos hoy`],
	[/^(.+) has no uses left$/, (m, h) => `A ${h.s(m[1])} no le quedan usos`],
	[/^(.+) has no token on the map$/, (m, h) => `${h.n(m[1])} no tiene ficha en el mapa`],
	[/^Empty path$/, () => "Ruta vacía"],
	[/^(.+) cannot move while incapacitated$/, (m, h) => `${h.n(m[1])} no puede moverse mientras está incapacitado`],
	[/^Path is not contiguous at \((-?\d+),(-?\d+)\)$/, (m) => `La ruta no es continua en (${m[1]},${m[2]})`],
	[/^Square \((-?\d+),(-?\d+)\) is blocked$/, (m) => `La casilla (${m[1]},${m[2]}) está bloqueada`],
	[/^Cannot end movement on \((-?\d+),(-?\d+)\)$/, (m) => `No se puede terminar el movimiento en (${m[1]},${m[2]})`],
	[
		/^Not enough movement: path costs (\d+) ft(?: \(\+(\d+) ft to stand up\))?, (-?\d+) ft left$/,
		(m) => `Movimiento insuficiente: la ruta cuesta ${m[1]} pies${m[2] ? ` (+${m[2]} pies para levantarse)` : ""}, quedan ${m[3]} pies`,
	],
	[/^Not enough movement to stand$/, () => "No tienes movimiento suficiente para levantarte"],
	[/^Caster has no position$/, () => "El lanzador no tiene posición"],
	[/^That point is out of range \((\d+) ft\)$/, (m) => `Ese punto está fuera de alcance (${m[1]} pies)`],
	[/^No line of sight to that point$/, () => "No hay línea de visión hasta ese punto"],
	[/^Missing position$/, () => "Falta la posición"],
	[/^Combatant has no position on the map$/, () => "El combatiente no tiene posición en el mapa"],
	[/^Cannot attack yourself$/, () => "No puedes atacarte a ti mismo"],
	[/^(.+) is out of (range|reach) \((\d+) ft > (\d+) ft\)$/, (m, h) => `${h.n(m[1])} está fuera de alcance (${m[3]} pies > ${m[4]} pies)`],
	[/^(.+) has total cover$/, (m, h) => `${h.n(m[1])} tiene cobertura total`],
	[/^(.+) has no healing dice for level (\d+)$/, (m, h) => `${h.s(m[1])} no tiene dados de curación para el nivel ${m[2]}`],
	[/^No action left for (.+)$/, (m, h) => `No te queda acción para ${h.what(m[1])}`],
	[/^No bonus action left for (.+)$/, (m, h) => `No te queda acción adicional para ${h.what(m[1])}`],
	[/^No reaction left for (.+)$/, (m, h) => `No te queda reacción para ${h.what(m[1])}`],
	[/^(.+) is not dying$/, (m, h) => `${h.n(m[1])} no está moribundo`],
	[/^(.+) is dying: roll a death save or end the turn$/, (m, h) => `${h.n(m[1])} está moribundo: tira una salvación contra muerte o termina el turno`],
	[/^Already rolled a death save this turn$/, () => "Ya has tirado una salvación contra muerte este turno"],
	[/^No player character in this encounter$/, () => "No hay personaje jugador en este encuentro"],
	[/^(.+) must be within 5 ft to help$/, (m, h) => `${h.n(m[1])} debe estar a 5 pies o menos para ayudar`],
	[/^(.+) must be within 5 ft$/, (m, h) => `${h.n(m[1])} debe estar a 5 pies o menos`],
	[
		/^You can't hide while (.+) can see you clearly \(need ¾ cover or no line of sight\)$/,
		(m, h) => `No puedes esconderte mientras ${h.names(m[1])} ${m[1].includes(", ") ? "te vean" : "te vea"} con claridad (necesitas cobertura de ¾ o que no haya línea de visión)`,
	],
	[/^Character data is required to attack$/, () => "Se necesitan los datos del personaje para atacar"],
	[/^Character data is required to cast$/, () => "Se necesitan los datos del personaje para lanzar conjuros"],
	[/^Character data is required to use items$/, () => "Se necesitan los datos del personaje para usar objetos"],
	[/^Character data is required to use features$/, () => "Se necesitan los datos del personaje para usar rasgos"],
	[/^Unknown item$/, () => "Objeto desconocido"],
	[/^Unknown feature$/, () => "Rasgo desconocido"],
	[/^Unknown spell: (.+)$/, (m, h) => `Conjuro desconocido: ${h.s(m[1])}`],
	[/^(.+) is not a weapon$/, (m, h) => `${h.s(m[1])} no es un arma`],
	[/^Off-hand attacks require taking the Attack action first$/, () => "Los ataques con la mano torpe requieren realizar antes la acción de Atacar"],
	[/^Off-hand attacks require a Light weapon$/, () => "Los ataques con la mano torpe requieren un arma ligera"],
	[/^(.+) takes (.+); it cannot be cast in combat$/, (m, h) => `${h.s(m[1])} requiere ${timeEs(m[2])}; no se puede lanzar en combate`],
	[/^(.+) is a reaction spell; it is cast in response to a trigger$/, (m, h) => `${h.s(m[1])} es un conjuro de reacción; se lanza en respuesta a un desencadenante`],
	[/^You have no spell slots$/, () => "No tienes espacios de conjuro"],
	[/^(.+) needs a slot of level (\d) or higher$/, (m, h) => `${h.s(m[1])} necesita un espacio de nivel ${m[2]} o superior`],
	[/^(.+) needs a level (\d)\+ slot$/, (m, h) => `${h.s(m[1])} necesita un espacio de nivel ${m[2]} o superior`],
	[/^No level (\d) spell slots left$/, (m) => `No te quedan espacios de conjuro de nivel ${m[1]}`],
	[/^You don't have that item$/, () => "No tienes ese objeto"],
	[/^(.+) has no defined combat effect; describe what you do instead$/, (m, h) => `${h.s(m[1])} no tiene un efecto de combate definido; describe lo que haces`],
	[/^(.+) is not prone$/, (m, h) => `${h.n(m[1])} no está derribado`],
	[/^(.+) is already dead$/, (m, h) => `${h.n(m[1])} ya ha muerto`],
	[/^(.+) is dead; (.+) has no effect$/, (m, h) => `${h.n(m[1])} ha muerto; ${m[2] === "healing" ? "la curación" : h.s(m[2])} no tiene efecto`],
	[/^(.+) is dead$/, (m, h) => `${h.n(m[1])} ha muerto`],
	[/^(.+) is stable$/, (m, h) => `${h.n(m[1])} está estable`],
	[/^(.+) is incapacitated$/, (m, h) => `${h.n(m[1])} está incapacitado`],

	// ─── resource errors (lib/dm/resources.ts) ───────────────────────────
	[
		/^(.+?) has no "(.+)"\. Inventory: (.+)$/,
		(m, h) => `${h.n(m[1])} no tiene «${m[2]}». Inventario: ${m[3] === "empty" ? "vacío" : m[3].split(", ").map((i) => i.replace(/^(.+) x(\d+)$/, (_, nm: string, q: string) => `${h.s(nm)} x${q}`)).join(", ")}`,
	],
	[/^Only (\d+) (?!hit dice)(.+) left$/, (m, h) => `Solo ${plural(m[1], "queda", "quedan")} ${m[1]} × ${h.s(m[2])}`],
	[
		/^(.+?) doesn't have "(.+)"\. Limited features: (.+)$/,
		(m, h) => `${h.n(m[1])} no tiene «${m[2]}». Rasgos limitados: ${m[3] === "none" ? "ninguno" : m[3].split(", ").map(h.s).join(", ")}`,
	],
	[/^(.+) cannot cast spells$/, (m, h) => `${h.n(m[1])} no puede lanzar conjuros`],
	[/^Unknown spell "(.+)"\. (.+?) can cast: (.*)$/, (m, h) => `Conjuro desconocido «${m[1]}». ${h.n(m[2])} puede lanzar: ${m[3] === "nothing" ? "nada" : m[3]}`],
	[/^(.+?) doesn't know\/hasn't prepared (.+)\. Castable: (.*)$/, (m, h) => `${h.n(m[1])} no conoce o no ha preparado ${h.s(m[2])}. Lanzables: ${m[3]}`],
	[/^(.+) is not a ritual$/, (m, h) => `${h.s(m[1])} no es un ritual`],
	[/^No spell slot of level (\d)\+ left for (.+)\. Slots: (.+)$/, (m, h) => `No queda ningún espacio de conjuro de nivel ${m[1]} o superior para ${h.s(m[2])}. Espacios: ${slotsEs(m[3])}`],

	// ─── character rules errors (lib/rules/character) ────────────────────
	[/^Only (\d+) hit dice left$/, (m) => `Solo ${plural(m[1], "queda", "quedan")} ${m[1]} ${plural(m[1], "dado", "dados")} de golpe`],
	[/^Not enough d(\d+) hit dice$/, (m) => `No hay suficientes dados de golpe d${m[1]}`],
	[/^No slot recovery feature available$/, () => "No hay ningún rasgo de recuperación de espacios disponible"],
	[/^Can recover at most (\d+) slot levels$/, (m) => `Puedes recuperar como máximo ${m[1]} niveles de espacios`],
	[/^Can't recover slots of 6th level or higher$/, () => "No se pueden recuperar espacios de nivel 6 o superior"],
	[/^No expended level-(\d) slot to recover$/, (m) => `No hay ningún espacio de nivel ${m[1]} gastado que recuperar`],
	[/^(.+) doesn't have the feature "(.+)"$/, (m, h) => `${h.n(m[1])} no tiene el rasgo «${h.s(m[2])}»`],
	[/^(.+): only (\d+) use\(s\) left$/, (m, h) => `${h.s(m[1])}: solo ${plural(m[2], "queda", "quedan")} ${m[2]} ${plural(m[2], "uso", "usos")}`],
	[/^(.+) has no spell slots$/, (m, h) => `${h.n(m[1])} no tiene espacios de conjuro`],
	[/^No level-(\d) spell slot left$/, (m) => `No queda ningún espacio de conjuro de nivel ${m[1]}`],
	[new RegExp(`^Point buy: ${AB} (\\d+) must be between 8 and 15$`), (m, h) => `Compra de puntos: ${h.ab(m[1])} ${m[2]} debe estar entre 8 y 15`],
	[new RegExp(`^Missing ${AB} score$`), (m, h) => `Falta la puntuación de ${h.ab(m[1])}`],
	[/^Standard array must use exactly (.+)$/, (m) => `La matriz estándar debe usar exactamente ${m[1]}`],
	[/^Point buy costs (\d+) points \(budget (\d+)\)$/, (m) => `La compra de puntos cuesta ${m[1]} puntos (presupuesto ${m[2]})`],
	[/^Rolled scores must be assigned exactly once each$/, () => "Cada puntuación tirada debe asignarse exactamente una vez"],
	[/^Rolled scores must be 3–18$/, () => "Las puntuaciones tiradas deben estar entre 3 y 18"],
	[/^Manual scores must be 3–20$/, () => "Las puntuaciones manuales deben estar entre 3 y 20"],
	[/^Unknown class (.+)$/, (m) => `Clase desconocida: ${m[1]}`],
	[/^Unknown species (.+)$/, (m) => `Especie desconocida: ${m[1]}`],
	[/^Unknown background (.+)$/, (m) => `Trasfondo desconocido: ${m[1]}`],
	[/^Unknown feat (.+)$/, (m) => `Dote desconocida: ${m[1]}`],
	[/^(.+) is not a subspecies of (.+)$/, (m, h) => `${m[1]} no es una subespecie de ${h.s(m[2])}`],
	[/^Starting level must be 1–20$/, () => "El nivel inicial debe estar entre 1 y 20"],
	[/^Name is required$/, () => "El nombre es obligatorio"],
	[/^Choose a subspecies of (.+)$/, (m, h) => `Elige una subespecie de ${h.s(m[1])}`],
	[/^(.+) is not a (.+) subclass$/, (m, h) => `${m[1]} no es una subclase de ${h.cls(m[2])}`],
	[/^Missing choice "(.+)" \((.+)\)$/, (m, h) => `Falta la elección «${h.loc(m[1])}» (${m[2]})`],
	[/^Equipment "(.+)": option (\d+) doesn't exist$/, (m, h) => `Equipo «${h.s(m[1])}»: la opción ${m[2]} no existe`],
	[/^Equipment "(.+)": pick (\d+) from (.+)$/, (m, h) => `Equipo «${h.s(m[1])}»: elige ${m[2]} de ${h.s(m[3])}`],
	[/^Equipment: "(.+)" is not one of (.+)$/, (m, h) => `Equipo: «${m[1]}» no es una de las opciones de ${h.s(m[2])}`],
	[/^(.+): choose exactly (\d+) \(got (\d+)\)$/, (m, h) => `${h.loc(m[1])}: elige exactamente ${m[2]} (has elegido ${m[3]})`],
	[/^(.+): "(.+)" is not a valid option$/, (m, h) => `${h.loc(m[1])}: «${m[2]}» no es una opción válida`],
	[/^(.+): duplicate picks$/, (m, h) => `${h.loc(m[1])}: elecciones repetidas`],
	[/^(.+): "(.+)" was already chosen$/, (m, h) => `${h.loc(m[1])}: «${m[2]}» ya estaba elegido`],
	[/^Rolling HP needs an Rng$/, () => "Tirar los puntos de golpe requiere un generador aleatorio"],
	[new RegExp(`^ASI: "(.+)" is not an ability$`), (m) => `Mejora de característica: «${m[1]}» no es una característica`],
	[new RegExp(`^ASI would raise ${AB} above 20$`), (m, h) => `La mejora de característica subiría ${h.ab(m[1])} por encima de 20`],
	[/^Already level 20$/, () => "Ya eres de nivel 20"],
	[/^Can't multiclass into (.+?): (.+)$/, (m, h) => `No puedes multiclasear a ${h.cls(m[1])}: ${m[2].split("; ").map(h.loc).join("; ")}`],
	[
		new RegExp(`^(.+) requires (${AB} \\d+(?: (?:or|and) ${AB} \\d+)*)$`),
		(m, h) => `${h.cls(m[1])} requiere ${m[2].replace(/\b(STR|DEX|CON|INT|WIS|CHA)\b/g, (a) => h.ab(a)).replace(/ or /g, " o ").replace(/ and /g, " y ")}`,
	],
	[/^Can't replace (.+): not known$/, (m, h) => `No puedes reemplazar ${h.s(m[1])}: no lo conoces`],
	[/^Can't learn (.+) as a replacement$/, (m, h) => `No puedes aprender ${h.s(m[1])} como reemplazo`],
	[/^Can't prepare (.+)$/, (m, h) => `No puedes preparar ${h.s(m[1])}`],
	[/^Can prepare at most (\d+) spells$/, (m) => `Puedes preparar como máximo ${m[1]} conjuros`],
	[/^(.+) needs more XP to reach level (\d+)$/, (m, h) => `${h.n(m[1])} necesita más PX para alcanzar el nivel ${m[2]}`],

	// ─── level-up / creation choice labels ───────────────────────────────
	[/^Ability Score Improvement: two abilities \(repeat one for \+2\), or a feat as "feat:<index>"$/, () => "Mejora de característica: dos características (repite una para +2) o una dote"],
	[/^Eldritch Invocations$/, (_m, h) => (h.s("Eldritch Invocations") !== "Eldritch Invocations" ? h.s("Eldritch Invocations") : "Invocaciones sobrenaturales")],
	[/^Bonus Proficiencies \(3 skills\)$/, () => "Competencias adicionales (3 habilidades)"],
	[/^Optionally replace one known spell: \[old, new\]$/, () => "Opcional: sustituye un conjuro conocido [antiguo, nuevo]"],
	[/^Spells added to your spellbook$/, () => "Conjuros añadidos a tu libro de conjuros"],
	[/^Additional Magical Secrets \(any class\)$/, () => "Secretos mágicos adicionales (cualquier clase)"],
	[/^Mystic Arcanum \((\d)th level\)$/, (m) => `Arcano místico (nivel ${m[1]})`],
	[/^(\w+) multiclass skill$/, (m, h) => `Habilidad de multiclase de ${h.cls(m[1])}`],
	[/^(\w+) cantrips$/, (m, h) => `Trucos de ${h.cls(m[1])}`],
	[/^(\w+) spells known$/, (m, h) => `Conjuros conocidos de ${h.cls(m[1])}`],
	[/^(\w+) skills$/, (m, h) => (enumEs("class", slug(m[1])) ? `Habilidades de ${h.cls(m[1])}` : null)],
	[/^(.+) languages$/, (m, h) => `Idiomas de ${h.bg(m[1])}`],
	[/^Feat: (.+)$/, (m, h) => `Dote: ${h.s(m[1])}`],

	// ─── roll labels ─────────────────────────────────────────────────────
	[
		/^(.+?) (attacks|makes an opportunity attack on) (.+?) with (.+): (-?\d+) vs AC (\d+) — (CRITICAL HIT|hit|natural 1, miss|miss)(?: \((.+)\))?$/,
		(m, h) => {
			const res = m[7] === "CRITICAL HIT" ? "¡GOLPE CRÍTICO!" : m[7] === "hit" ? "impacta" : m[7] === "miss" ? "falla" : "1 natural, falla";
			const verb = m[2] === "attacks" ? "ataca a" : "realiza un ataque de oportunidad contra";
			return `${h.n(m[1])} ${verb} ${h.n(m[3])} con ${h.s(m[4])}: ${m[5]} contra CA ${m[6]} — ${res}${m[8] ? ` (${whyEs(m[8])})` : ""}`;
		},
	],
	[/^(.+) death saving throw$/, (m, h) => `Salvación contra muerte de ${h.n(m[1])}`],
	[/^(.+) Stealth \(Hide\)$/, (m, h) => `${h.n(m[1])}: Sigilo (Esconderse)`],
	[/^(.+) opportunity attack (.+) \((.+)\)$/, (m, h) => `${h.n(m[1])}: ataque de oportunidad contra ${h.n(m[2])} (${h.s(m[3])})`],
	[/^(.+?) attacks (.+) \(([^()]+)\)$/, (m, h) => `${h.n(m[1])} ataca a ${h.n(m[2])} (${h.s(m[3])})`],
	[/^(.+) damage \((\w+)\)( — critical)?$/, (m, h) => `Daño de ${h.s(m[1])} (${h.dmg(m[2])})${m[3] ? " — crítico" : ""}`],
	[/^Damage to (.+)$/, (m, h) => `Daño a ${h.n(m[1])}`],
	[/^Healing for (.+)$/, (m, h) => `Curación para ${h.n(m[1])}`],
	[/^Damage: (.+)$/, (m) => `Daño: ${m[1]}`],
	[/^Healing: (.+)$/, (m) => `Curación: ${m[1]}`],
	[/^(?!.* takes )(.+) damage$/, (m, h) => `Daño de ${h.s(m[1])}`],
	[/^(.+) healing$/, (m, h) => `Curación de ${h.s(m[1])}`],
	[/^(.+) initiative( \(surprised\))?$/, (m, h) => `Iniciativa de ${h.n(m[1])}${m[2] ? " (sorprendido)" : ""}`],
	[/^(.+) rolls hit points$/, (m, h) => `${h.n(m[1])} tira puntos de golpe`],
	[/^(.+) hit points$/, (m, h) => `Puntos de golpe de ${h.n(m[1])}`],
	[/^(.+) recharge (.+) \((\d)–6\)$/, (m, h) => `${h.n(m[1])}: recarga de ${h.s(m[2])} (${m[3]}–6)`],
	[new RegExp(`^(?!.* (?:succeeds|fails) )(.+) ${AB} save vs (.+)$`), (m, h) => `${h.n(m[1])}: salvación de ${h.ab(m[2])} contra ${h.s(m[3])}`],
	[/^(.+) spends a hit die$/, (m, h) => `${h.n(m[1])} gasta un dado de golpe`],
	[/^Song of Rest$/, (_m, h) => (h.s("Song of Rest") !== "Song of Rest" ? h.s("Song of Rest") : "Canción de descanso")],
	[/^Ability score (\d) \(4d6 drop lowest\)$/, (m) => `Característica ${m[1]} (4d6, descarta el menor)`],
	[new RegExp(`^${AB} check$`), (m, h) => `Prueba de ${h.ab(m[1])}`],
	[new RegExp(`^${AB} save$`), (m, h) => `Salvación de ${h.ab(m[1])}`],
	[/^([A-Za-z -]+) check$/, (m, h) => {
		const sk = h.skill(m[1]);
		return sk ? `Prueba de ${sk}` : null;
	}],

	// ─── tool results the player may see ─────────────────────────────────
	[/^Passive (.+): (-?\d+)$/, (m, h) => `${h.loc(m[1])} (pasiva): ${m[2]}`],
	[
		/^(.+): (-?\d+) \(d20 (\d+) ([+-]\d+)\)(?: vs DC (\d+): (SUCCESS|FAILURE))?$/,
		(m, h) => `${h.loc(m[1])}: ${m[2]} (d20 ${m[3]} ${m[4]})${m[5] ? ` contra CD ${m[5]}: ${m[6] === "SUCCESS" ? "ÉXITO" : "FALLO"}` : ""}`,
	],
	[/^(.+): (-?\d+) vs DC (\d+): (SUCCESS|FAILURE)$/, (m, h) => `${h.loc(m[1])}: ${m[2]} contra CD ${m[3]}: ${m[4] === "SUCCESS" ? "ÉXITO" : "FALLO"}`],
	[/^(.+): (-?\d+) → HP (-?\d+)\/(\d+)$/, (m, h) => `${h.loc(m[1])}: ${m[2]} → PG ${m[3]}/${m[4]}`],
	[/^Short rest: spent (\d+) hit dice, regained (\d+) HP$/, (m) => `Descanso corto: gastas ${m[1]} ${plural(m[1], "dado", "dados")} de golpe y recuperas ${m[2]} PG`],
	[/^HP (-?\d+)\/(\d+)$/, (m) => `PG ${m[1]}/${m[2]}`],
	[/^HP (-?\d+)\/(\d+); resources restored$/, (m) => `PG ${m[1]}/${m[2]}; recursos restaurados`],
	[/^Long rest complete$/, () => "Descanso largo completado"],
	[/^Long rest interrupted; no benefits$/, () => "Descanso largo interrumpido; sin beneficios"],
	[/^\+(\d+) XP \((.+)\)$/, (m) => `+${m[1]} PX (${m[2]})`],
	[/^Total (\d+)$/, (m) => `Total ${m[1]}`],
	[/^The player can LEVEL UP \(they will do it from the character sheet\)$/, () => "El jugador puede SUBIR DE NIVEL (lo hará desde la hoja de personaje)"],
	[/^Level-up granted \((.+)\)$/, (m) => `Subida de nivel concedida (${m[1]})`],
	[/^No match$/, () => "Sin resultados"],

	// ─── resource use lines (player line after using the sheet) ──────────
	[/^Used (\d+) × (.+) \((\d+) left\)$/, (m, h) => `Usas ${m[1]} × ${h.s(m[2])} (${plural(m[3], "queda", "quedan")} ${m[3]})`],
	[/^Used (.+) \(kept\)$/, (m, h) => `Usas ${h.s(m[1])} (se conserva)`],
	[
		/^(.+) used(?: \((\d+)\))?: (\d+)\/(\d+) left \(recharges on (\w+) rest\)$/,
		(m, h) => `${h.s(m[1])} usado${m[2] ? ` (${m[2]})` : ""}: ${plural(m[3], "queda", "quedan")} ${m[3]}/${m[4]} (se recarga con un descanso ${m[5] === "short" ? "corto" : m[5] === "long" ? "largo" : m[5]})`,
	],
	[/^(.+) used(?: \((\d+)\))? \(unlimited\)$/, (m, h) => `${h.s(m[1])} usado${m[2] ? ` (${m[2]})` : ""} (ilimitado)`],
	[/^Healed (\d+) → HP (-?\d+)\/(\d+) \(if used on self\)$/, (m) => `Curas ${m[1]} → PG ${m[2]}/${m[3]} (si se usa sobre ti)`],
	[
		/^(.+?) casts (.+?)( \(level (\d) slot\)| as a ritual \(no slot, \+10 min\)| \(cantrip\))?(?: targeting (.+))?$/,
		(m, h) =>
			`${h.n(m[1])} lanza ${h.s(m[2])}${m[4] ? ` (espacio de nivel ${m[4]})` : m[3]?.includes("ritual") ? " como ritual (sin espacio, +10 min)" : m[3] ? " (truco)" : ""}${m[5] ? ` contra ${h.names(m[5])}` : ""}`,
	],
	[/^Slots now: (.+)$/, (m) => `Espacios: ${slotsEs(m[1])}`],
	[/^Concentration on (.+) ends$/, (m, h) => `Termina la concentración en ${h.s(m[1])}`],
	[/^Concentrating on (.+)$/, (m, h) => `Concentración en ${h.s(m[1])}`],
	[/^Resolve its effect on any non-combat target yourself \(roll\/apply as needed\)$/, () => "Resuelve tú su efecto sobre objetivos fuera de combate (tira/aplica lo necesario)"],

	// ─── combat log lines (engine-action strip) ──────────────────────────
	[/^(.+) is immune to ([\w-]+)$/, (m, h) => `${h.n(m[1])} es inmune a ${lower(h.cond(m[2]) ?? m[2])}`],
	[/^(.+) is no longer ([\w-]+)$/, (m, h) => {
		const c = h.cond(m[2]);
		return c ? `${h.n(m[1])} ya no está ${lower(c)}` : null;
	}],
	[/^(.+) is ([\w-]+)(?: \((\d+) rounds\))?$/, (m, h) => {
		const c = h.cond(m[2]);
		return c ? `${h.n(m[1])} queda ${lower(c)}${m[3] ? ` (${m[3]} asaltos)` : ""}` : null;
	}],
	[/^(.+) loses concentration on (.+) \((.+)\)$/, (m, h) => `${h.n(m[1])} pierde la concentración en ${h.s(m[2])} (${m[3]})`],
	[new RegExp(`^(.+) automatically fails the ${AB} save vs (.+) \\(DC (\\d+)\\)$`), (m, h) => `${h.n(m[1])} falla automáticamente la salvación de ${h.ab(m[2])} contra ${h.s(m[3])} (CD ${m[4]})`],
	[
		new RegExp(`^(.+) (succeeds|fails) a DC (\\d+) ${AB} save vs (.+) \\((-?\\d+)\\)$`),
		(m, h) => `${h.n(m[1])} ${m[2] === "succeeds" ? "supera" : "falla"} una salvación de ${h.ab(m[4])} CD ${m[3]} contra ${h.s(m[5])} (${m[6]})`,
	],
	[/^(.+) takes no damage(?: \((.+)\))?$/, (m, h) => `${h.n(m[1])} no recibe daño${m[2] ? ` (${damageNotes(m[2], h)})` : ""}`],
	[/^(.+)'s temporary hit points absorb the blow$/, (m, h) => `Los puntos de golpe temporales de ${h.n(m[1])} absorben el golpe`],
	[/^(.+) takes (\d+) damage while dying — massive damage kills them outright$/, (m, h) => `${h.n(m[1])} recibe ${m[2]} de daño estando moribundo: el daño masivo lo mata en el acto`],
	[/^(.+) takes damage while dying: (\d+) death save failures?$/, (m, h) => `${h.n(m[1])} recibe daño estando moribundo: ${m[2]} ${plural(m[2], "fallo", "fallos")} de salvación contra muerte`],
	[
		/^(.+) takes (\d+)(?: (\w+))? damage(?: \((.+)\))? → (-?\d+)\/(\d+) HP$/,
		(m, h) => `${h.n(m[1])} recibe ${m[2]} de daño${m[3] ? ` ${h.dmg(m[3])}` : ""}${m[4] ? ` (${damageNotes(m[4], h)})` : ""} → ${m[5]}/${m[6]} PG`,
	],
	[/^Massive damage! (.+) dies instantly$/, (m, h) => `¡Daño masivo! ${h.n(m[1])} muere al instante`],
	[/^(.+) falls unconscious!$/, (m, h) => `¡${h.n(m[1])} cae inconsciente!`],
	[/^(.+) has died$/, (m, h) => `${h.n(m[1])} ha muerto`],
	[/^(.+) dies$/, (m, h) => `${h.n(m[1])} muere`],
	[/^(.+) regains (\d+) HP \((.+)\) → (-?\d+)\/(\d+)$/, (m, h) => `${h.n(m[1])} recupera ${m[2]} PG (${m[3] === "healing" ? "curación" : m[3] === "death save" ? "salvación contra muerte" : h.s(m[3])}) → ${m[4]}/${m[5]}`],
	[/^Victory! (\d+) XP earned$/, (m) => `¡Victoria! ${m[1]} PX obtenidos`],
	[/^Defeat$/, () => "Derrota"],
	[/^(.+) rolls initiative: (-?\d+)( \(surprised, disadvantage\))?$/, (m, h) => `${h.n(m[1])} tira iniciativa: ${m[2]}${m[3] ? " (sorprendido, desventaja)" : ""}`],
	[
		/^Combat begins! Order: (.+)$/,
		(m, h) => `¡Empieza el combate! Orden: ${m[1].split(", ").map((x) => x.replace(/^(.+) \((-?\d+)\)$/, (_, nm: string, i: string) => `${h.n(nm)} (${i})`)).join(", ")}`,
	],
	[/^(.+)'s (.+) (recharges|does not recharge) \((\d+)\)$/, (m, h) => `${h.s(m[2])} de ${h.n(m[1])} ${m[3] === "recharges" ? "se recarga" : "no se recarga"} (${m[4]})`],
	[/^— Round (\d+): (.+)'s turn$/, (m, h) => `— Asalto ${m[1]}: turno de ${h.n(m[2])}`],
	[/^(.+) is dying and must make a death saving throw$/, (m, h) => `${h.n(m[1])} está moribundo y debe hacer una tirada de salvación contra muerte`],
	[/^(.+) leaves the battle \((.+)\)$/, (m, h) => `${h.n(m[1])} abandona la batalla (${m[2]})`],
	[/^Combat ends \((\w+)\)\. XP pool: (\d+)$/, (m) => `Termina el combate (${COMBAT_STATUS[m[1]] ?? m[1]}). Reserva de PX: ${m[2]}`],
	[/^(.+?) uses (.+) on (.+)$/, (m, h) => `${h.n(m[1])} usa ${h.s(m[2])} sobre ${h.n(m[3])}`],
	[/^(.+?) uses (.+)$/, (m, h) => `${h.n(m[1])} usa ${h.s(m[2])}`],
	[/^(.+) has no valid target for (.+)$/, (m, h) => `${h.n(m[1])} no tiene un objetivo válido para ${h.s(m[2])}`],
	[/^(.+) takes the (\w+) action$/, (m, h) => `${h.n(m[1])} realiza la acción de ${ACTIONS[m[2].toLowerCase()] ?? m[2]}`],
	[/^(.+) cannot act$/, (m, h) => `${h.n(m[1])} no puede actuar`],
	[/^(.+) has no one to fight$/, (m, h) => `${h.n(m[1])} no tiene a nadie con quien luchar`],
	[/^(.+) dashes(?: \(\+(\d+) ft\))?$/, (m, h) => `${h.n(m[1])} corre${m[2] ? ` (+${m[2]} pies)` : ""}`],
	[/^(.+) cannot reach (.+)$/, (m, h) => `${h.n(m[1])} no puede llegar hasta ${h.n(m[2])}`],
	[/^(.+) disengages$/, (m, h) => `${h.n(m[1])} se retira`],
	[/^(.+) distracts (.+): the next attack against it has advantage$/, (m, h) => `${h.n(m[1])} distrae a ${h.n(m[2])}: el próximo ataque contra él tiene ventaja`],
	[/^(.+) helps (.+): its next attack has advantage$/, (m, h) => `${h.n(m[1])} ayuda a ${h.n(m[2])}: su próximo ataque tiene ventaja`],
	[/^(.+) hides \(Stealth (-?\d+)\)$/, (m, h) => `${h.n(m[1])} se esconde (Sigilo ${m[2]})`],
	[/^(.+) fails to hide \(Stealth (-?\d+) < 15\)$/, (m, h) => `${h.n(m[1])} no logra esconderse (Sigilo ${m[2]} < 15)`],
	[/^(.+) gains an additional action$/, (m, h) => `${h.n(m[1])} obtiene una acción extra`],
	[/^(.+) rolls a natural 20 on a death save and regains 1 HP!$/, (m, h) => `¡${h.n(m[1])} saca un 20 natural en la salvación contra muerte y recupera 1 PG!`],
	[
		/^(.+) death save: (\d+)( \(two failures\))? — (\d+) success\(es\), (\d+) failure\(s\)$/,
		(m, h) => `Salvación contra muerte de ${h.n(m[1])}: ${m[2]}${m[3] ? " (dos fallos)" : ""} — ${m[4]} ${plural(m[4], "éxito", "éxitos")}, ${m[5]} ${plural(m[5], "fallo", "fallos")}`,
	],
	[/^(.+) stands up \((\d+) ft\)$/, (m, h) => `${h.n(m[1])} se levanta (${m[2]} pies)`],
	[/^(.+)'s movement is stopped$/, (m, h) => `El movimiento de ${h.n(m[1])} se detiene`],
	[/^(.+) moves (\d+) ft to \((-?\d+),(-?\d+)\)$/, (m, h) => `${h.n(m[1])} se mueve ${m[2]} pies hasta (${m[3]},${m[4]})`],
];

function helpers(srd: Srd): H {
	const s = (x: string) => srd(x.trim());
	const n = (x: string) => {
		const t = x.trim();
		const full = srd(t);
		if (full !== t) return full;
		const m = /^(.*?)(\s+\d+)$/.exec(t);
		return m ? srd(m[1]) + m[2] : t;
	};
	const h: H = {
		s,
		n,
		names: (x) => x.split(", ").map(n).join(", "),
		ab: (x) => enumEs("abilityShort", x.toLowerCase()) ?? x,
		dmg: (x) => lower(enumEs("damage", x.toLowerCase()) ?? x),
		cond: (x) => enumEs("condition", x.toLowerCase()),
		skill: (x) => enumEs("skill", slug(x)),
		cls: (x) => enumEs("class", slug(x)) ?? s(x),
		bg: (x) => enumEs("background", slug(x)) ?? s(x),
		loc: (x) => localizeWith(x, srd) ?? srd(x),
		what: (x) => ACTIONS[x.toLowerCase()] ?? s(x),
	};
	return h;
}

function matchOne(text: string, h: H): string | null {
	for (const [re, fn] of TEMPLATES) {
		const m = text.match(re);
		if (!m) continue;
		const out = fn(m, h);
		if (out !== null) return out;
	}
	return null;
}

/** One sentence/line: exact, or without its final period (re-added). */
function matchSentence(text: string, h: H): string | null {
	// Strip the final period first so it never ends up inside a captured name.
	if (text.endsWith(".")) {
		const body = matchOne(text.slice(0, -1), h);
		if (body !== null) return /[!?]$/.test(body) ? body : `${body}.`;
	}
	return matchOne(text, h);
}

/** Bare words the engine passes through as labels/options. */
function matchWord(text: string, h: H, srd: Srd): string | null {
	if (/^(STR|DEX|CON|INT|WIS|CHA)$/.test(text)) return h.ab(text);
	if (/^[A-Z][A-Za-z -]+$/.test(text)) {
		const sk = h.skill(text);
		if (sk) return sk;
	}
	const viaSrd = srd(text);
	return viaSrd !== text ? viaSrd : null;
}

function localizeWith(text: string, srd: Srd): string | null {
	const h = helpers(srd);
	const t = text.trim();
	if (!t) return null;
	// Several sentences ("Used 1 × X (0 left). X healing: 7 → HP 12/20"): all must match.
	// Tried first so a greedy single template can't swallow a whole paragraph.
	const parts = t.split(/(?<=[.!?])\s+(?=[A-Z0-9+—¡(])/);
	if (parts.length > 1) {
		const out = parts.map((p) => matchSentence(p, h));
		if (out.every((x) => x !== null)) return out.join(" ");
	}
	return matchSentence(t, h) ?? matchWord(t, h, srd);
}

const identity: Srd = (s) => s;

/**
 * Localized version of an engine-produced English string, or null when no
 * template matched (callers that only want to show text they could translate
 * — e.g. the DM-facing tool summaries — use this).
 */
export function tryLocalizeEngine(lang: Lang, text: string, srd: Srd = identity): string | null {
	if (lang === "en") return text;
	if (!text) return text;
	return localizeWith(text, srd);
}

/** Engine English → the player's language; unmatched text comes back unchanged. */
export function localizeEngine(lang: Lang, text: string, srd: Srd = identity): string {
	if (lang === "en" || !text) return text;
	return localizeWith(text, srd) ?? text;
}

/**
 * Player log lines are mostly free text the player typed; only the line the
 * server writes after using something from the sheet is engine text.
 */
export function isSheetUseLine(text: string): boolean {
	return /^Used \d+ × .+ \(\d+ left\)\.?$|^Used .+ \(kept\)\.?$|^\S.* casts .+(?: \(level \d slot\)| as a ritual \(no slot, \+10 min\)| \(cantrip\))\.$|^.+ used(?: \(\d+\))?(?:: \d+\/\d+ left \(recharges on \w+ rest\)| \(unlimited\))\.?$/.test(text);
}
