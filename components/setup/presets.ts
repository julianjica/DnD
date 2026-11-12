import type { CampaignSettings, SceneState } from "@/lib/game/types";
import type { Lang } from "@/lib/i18n";

/** Display names/blurbs live in lib/i18n/parts/setup.ts: enum.preset.<id> and enum.presetBlurb.<id>. */

export type WorldPreset = CampaignSettings["world"]["preset"];

export interface WorldPresetInfo {
	id: WorldPreset;
	scene: SceneState;
	/** Tones that suit the preset (used by "surprise me"). */
	tones: string[];
}

const sc = (kind: SceneState["kind"], timeOfDay: SceneState["timeOfDay"], weather: SceneState["weather"], mood: SceneState["mood"], props: string[] = []): SceneState => ({
	title: "",
	kind,
	timeOfDay,
	weather,
	mood,
	npcIds: [],
	props,
});

export const WORLD_PRESETS: WorldPresetInfo[] = [
	{ id: "classic_high_fantasy", scene: sc("castle", "day", "clear", "triumphant"), tones: ["heroic", "epic"] },
	{ id: "grimdark", scene: sc("plains", "dusk", "storm", "somber"), tones: ["dark", "gritty"] },
	{ id: "gothic_horror", scene: sc("crypt", "night", "fog", "eerie"), tones: ["dark", "mysterious"] },
	{ id: "sword_and_sorcery", scene: sc("temple", "dusk", "clear", "tense"), tones: ["gritty", "epic"] },
	{ id: "pirates", scene: sc("coast", "dawn", "clear", "calm", ["ship"]), tones: ["heroic", "humorous"] },
	{ id: "arctic", scene: sc("mountain", "day", "snow", "somber"), tones: ["gritty", "mysterious"] },
	{ id: "desert_kingdoms", scene: sc("desert", "dusk", "clear", "mysterious"), tones: ["political", "mysterious"] },
	{ id: "fey_wilds", scene: sc("forest", "night", "fog", "mysterious"), tones: ["whimsical", "mysterious"] },
	{ id: "zombie_outbreak", scene: sc("town", "night", "rain", "tense"), tones: ["dark", "gritty"] },
	{ id: "marea_burned", scene: sc("town", "night", "rain", "tense"), tones: ["neon_noir"] },
	{ id: "custom", scene: sc("tavern", "night", "clear", "festive"), tones: ["heroic"] },
];

export const presetInfo = (id: WorldPreset): WorldPresetInfo => WORLD_PRESETS.find((p) => p.id === id) ?? WORLD_PRESETS[0];

export const TONES = ["heroic", "humorous", "dark", "mysterious", "political", "whimsical", "romantic", "gritty", "epic"] as const;

/** Root Access (marea_burned): one tone, chosen at setup; the DM's style follows it (lib/dm/prompt.ts). */
export const CYBER_TONES = ["neon_noir", "grim", "satire"] as const;
export const CYBER_DEFAULT_TONE = "neon_noir";

/** Tone choices offered for a preset, and whether only one may be picked. */
export function tonesFor(preset: WorldPreset): { tones: readonly string[]; single: boolean } {
	return preset === "marea_burned" ? { tones: CYBER_TONES, single: true } : { tones: TONES, single: false };
}

/**
 * The tones to keep when the preset changes: Root Access keeps one of its own
 * (default neon noir); leaving it drops its tones for the new preset's suggestions.
 */
export function tonesOnPresetChange(next: WorldPreset, current: string[]): string[] {
	const cyber = (t: string) => (CYBER_TONES as readonly string[]).includes(t);
	if (next === "marea_burned") {
		const keep = current.find(cyber);
		return [keep ?? CYBER_DEFAULT_TONE];
	}
	return current.some(cyber) ? [...presetInfo(next).tones] : current;
}

/** Labels: enum.format.<id> / enum.formatBlurb.<id>. */
export const FORMATS: CampaignSettings["structure"]["format"][] = ["one_shot", "short_campaign", "long_campaign"];
/** Labels: enum.difficulty.<id> / enum.difficultyInfo.<id>. */
export const DIFFICULTIES: CampaignSettings["structure"]["difficulty"][] = ["story", "easy", "normal", "hard", "deadly"];

type ByLang<T> = Record<Lang, T>;

export const LINE_SUGGESTIONS: ByLang<string[]> = {
	en: ["Harm to children", "Sexual violence", "Torture", "Animal cruelty", "Self-harm", "Real-world bigotry", "Body horror", "Spiders"],
	es: ["Daño a menores", "Violencia sexual", "Tortura", "Crueldad animal", "Autolesiones", "Intolerancia del mundo real", "Horror corporal", "Arañas"],
};
export const VEIL_SUGGESTIONS: ByLang<string[]> = {
	en: ["Romance & intimacy", "Graphic gore", "Death of loved ones", "Drug use", "Disease & plague", "Slavery", "Insects", "Drowning"],
	es: ["Romance e intimidad", "Violencia gráfica", "Muerte de seres queridos", "Consumo de drogas", "Enfermedad y peste", "Esclavitud", "Insectos", "Ahogamiento"],
};

/** Opening hook ideas per preset, in each UI language. */
export const HOOKS: ByLang<Record<WorldPreset | "any", string[]>> = {
	en: {
		any: [
			"A dying courier presses a sealed letter into your hands: \"Don't let them open it.\"",
			"The village well has started whispering at night, and the children are listening.",
			"You wake in a cell with no memory of the last three days and a stranger's ring on your finger.",
			"A noble's heir vanished on the old road. The reward is generous; the last party never returned.",
			"An old friend begs for help settling a debt owed to the wrong people.",
		],
		classic_high_fantasy: ["A dragon's egg has been stolen from the royal menagerie.", "The archmage's tower went silent a week ago; its lights now burn green."],
		grimdark: ["The plague cart left one survivor in your town: you.", "A mercenary company offers coin to burn a village that may not deserve it."],
		gothic_horror: ["Every night at midnight, the church bell rings once more than it should.", "A widow swears her husband came home last night, three weeks after his funeral."],
		sword_and_sorcery: ["A thief's map leads to the vault of a sorcerer-king who isn't quite dead.", "The pit-fighting master owes you a fortune, and he plans to pay with a knife."],
		pirates: ["A message in a bottle bears your own handwriting.", "The harbormaster's ledger lists a ship that sank fifty years ago as arriving tomorrow."],
		arctic: ["The thaw revealed a frozen giant with a living heartbeat.", "A longship returns with its crew alive but silent, eyes white as frost."],
		desert_kingdoms: ["A genie's lamp is up for auction, and three factions intend to win it.", "The oasis has dried overnight and the caravan masters blame a curse."],
		fey_wilds: ["You traded a memory to a fey merchant and now you need it back.", "A rival's wedding to a fey prince must be stopped before the moon sets."],
		zombie_outbreak: ["Your night shift is interrupted by sirens heading for St. Brigid's, and then the screaming starts.", "Your roommate came home from the Ventara trial with a fever. Now she's standing in the dark kitchen, very still."],
		marea_burned: ["Santi sold you to Ferro on the way out of the Vantis lab. Now the rain drums on the capsule roof, the shard is warm in your pocket, and La Tía is calling about the rent.", "At 3:00 a.m. your cracked deck lights up with a message from a node that shouldn't exist: \"I know what you're carrying. — ECO\""],
		custom: [],
	},
	es: {
		any: [
			"Un mensajero moribundo te pone en las manos una carta sellada: «No dejes que la abran».",
			"El pozo de la aldea ha empezado a susurrar por las noches, y los niños lo escuchan.",
			"Despiertas en una celda sin recuerdos de los últimos tres días y con el anillo de un desconocido en el dedo.",
			"El heredero de un noble desapareció en el camino viejo. La recompensa es generosa; el último grupo nunca volvió.",
			"Un viejo amigo te ruega que lo ayudes a saldar una deuda con la gente equivocada.",
		],
		classic_high_fantasy: ["Alguien robó un huevo de dragón de la colección de bestias reales.", "La torre del archimago lleva una semana en silencio; ahora sus luces arden en verde."],
		grimdark: ["La carreta de la peste dejó un solo superviviente en tu pueblo: tú.", "Una compañía de mercenarios ofrece monedas por quemar una aldea que quizá no lo merezca."],
		gothic_horror: ["Cada noche, a medianoche, la campana de la iglesia suena una vez más de lo debido.", "Una viuda jura que su marido volvió a casa anoche, tres semanas después de su funeral."],
		sword_and_sorcery: ["El mapa de un ladrón lleva a la cámara de un rey hechicero que no está del todo muerto.", "El amo del foso de lucha te debe una fortuna y piensa pagarte con un cuchillo."],
		pirates: ["Un mensaje en una botella está escrito con tu propia letra.", "El registro del capitán del puerto anuncia para mañana la llegada de un barco que se hundió hace cincuenta años."],
		arctic: ["El deshielo dejó al descubierto a un gigante congelado cuyo corazón aún late.", "Un barco vikingo regresa con su tripulación viva pero muda, con los ojos blancos como la escarcha."],
		desert_kingdoms: ["La lámpara de un genio sale a subasta, y tres facciones pretenden ganarla.", "El oasis se secó de la noche a la mañana y los jefes de caravana culpan a una maldición."],
		fey_wilds: ["Le cambiaste un recuerdo a un mercader feérico y ahora necesitas recuperarlo.", "Hay que impedir la boda de un rival con un príncipe feérico antes de que se ponga la luna."],
		zombie_outbreak: ["Tu turno de noche se interrumpe con sirenas camino de St. Brigid's, y luego empiezan los gritos.", "Tu compañera de piso volvió del ensayo de Ventara con fiebre. Ahora está de pie en la cocina a oscuras, muy quieta."],
		marea_burned: ["Santi te vendió a Ferro al salir del laboratorio de Vantis. Ahora la lluvia golpea el techo de la cápsula, el shard está tibio en tu bolsillo y La Tía te llama por la renta.", "A las 3:00 a. m. tu deck rajado se enciende con un mensaje desde un nodo que no debería existir: «Sé lo que llevas encima. — ECO»"],
		custom: [],
	},
};

export interface Persona {
	id: string;
	label: ByLang<string>;
	text: ByLang<string>;
}

export const PERSONAS: Persona[] = [
	{
		id: "grizzled",
		label: { en: "Grizzled storyteller", es: "Narrador curtido" },
		text: {
			en: "A grizzled old storyteller by the fire: dry wit, vivid but economical prose, respects player agency, never pulls punches.",
			es: "Un viejo narrador curtido junto al fuego: ingenio seco, prosa vívida pero económica, respeta las decisiones del jugador y no se guarda nada.",
		},
	},
	{
		id: "bard",
		label: { en: "Whimsical bard", es: "Bardo caprichoso" },
		text: {
			en: "A whimsical bard who narrates with playful flourishes, puns, songs and colorful NPC voices, but keeps the stakes real.",
			es: "Un bardo caprichoso que narra con florituras juguetonas, juegos de palabras, canciones y voces pintorescas para los PNJ, pero sin restarle peso a lo que está en juego.",
		},
	},
	{
		id: "ominous",
		label: { en: "Ominous narrator", es: "Narrador ominoso" },
		text: {
			en: "An ominous, foreboding narrator: slow-burn dread, sensory detail, short sentences when tension rises.",
			es: "Un narrador ominoso y sombrío: terror que crece poco a poco, detalle sensorial, frases cortas cuando sube la tensión.",
		},
	},
	{
		id: "epic",
		label: { en: "Epic chronicler", es: "Cronista épico" },
		text: {
			en: "A chronicler of legends: sweeping, cinematic narration with grand stakes and moments of quiet heroism.",
			es: "Un cronista de leyendas: narración amplia y cinematográfica, con grandes apuestas y momentos de heroísmo silencioso.",
		},
	},
	{
		id: "noir",
		label: { en: "Noir investigator", es: "Investigador noir" },
		text: {
			en: "A hard-boiled noir voice: clipped sentences, secrets everywhere, every NPC wants something.",
			es: "Una voz de novela negra: frases secas, secretos por todas partes, cada PNJ quiere algo.",
		},
	},
];

const EN_TITLE = {
	a: ["The", "A"],
	b: ["Ashen", "Hollow", "Crimson", "Drowned", "Silent", "Gilded", "Shattered", "Forgotten", "Whispering", "Iron", "Emerald", "Sunken"],
	c: ["Crown", "Road", "Vault", "Oath", "Lantern", "Throne", "Tide", "Gate", "Hymn", "Spire", "Covenant", "Mire"],
};
// Spanish needs gender agreement: [noun, feminine?] and [masculine, feminine] adjectives.
const ES_TITLE = {
	nouns: [["Corona", true], ["Senda", true], ["Bóveda", true], ["Juramento", false], ["Linterna", true], ["Trono", false], ["Marea", true], ["Puerta", true], ["Himno", false], ["Aguja", true], ["Pacto", false], ["Ciénaga", true]] as [string, boolean][],
	adjs: [["Ceniciento", "Cenicienta"], ["Vacío", "Vacía"], ["Carmesí", "Carmesí"], ["Ahogado", "Ahogada"], ["Silencioso", "Silenciosa"], ["Dorado", "Dorada"], ["Quebrado", "Quebrada"], ["Olvidado", "Olvidada"], ["Susurrante", "Susurrante"], ["Férreo", "Férrea"], ["Esmeralda", "Esmeralda"], ["Hundido", "Hundida"]] as [string, string][],
};

/** A random evocative campaign title in the given language. */
export function randomTitle(lang: Lang, rand: () => number = Math.random): string {
	const r = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
	if (lang === "es") {
		const [noun, fem] = r(ES_TITLE.nouns);
		const [m, f] = r(ES_TITLE.adjs);
		return `${fem ? "La" : "El"} ${noun} ${fem ? f : m}`;
	}
	return `${r(EN_TITLE.a)} ${r(EN_TITLE.b)} ${r(EN_TITLE.c)}`;
}
