import type { CampaignSettings, SceneState } from "@/lib/game/types";

export type WorldPreset = CampaignSettings["world"]["preset"];

export interface WorldPresetInfo {
	id: WorldPreset;
	name: string;
	blurb: string;
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
	{ id: "classic_high_fantasy", name: "Classic High Fantasy", blurb: "Castles and dragons, wizard towers, ancient ruins and roads between bustling kingdoms.", scene: sc("castle", "day", "clear", "triumphant"), tones: ["heroic", "epic"] },
	{ id: "grimdark", name: "Grimdark", blurb: "A broken world of mud, plague and desperate choices. Heroes are rare and rarely rewarded.", scene: sc("plains", "dusk", "storm", "somber"), tones: ["dark", "gritty"] },
	{ id: "gothic_horror", name: "Gothic Horror", blurb: "Fog-bound villages, cursed nobles and things that hunt by moonlight.", scene: sc("crypt", "night", "fog", "eerie"), tones: ["dark", "mysterious"] },
	{ id: "sword_and_sorcery", name: "Sword & Sorcery", blurb: "Lone adventurers, decadent cities, sinister sorcerers and gold worth bleeding for.", scene: sc("temple", "dusk", "clear", "tense"), tones: ["gritty", "epic"] },
	{ id: "pirates", name: "Pirates & High Seas", blurb: "Island ports, sea monsters, treasure maps and mutinous crews under a tropical sun.", scene: sc("coast", "dawn", "clear", "calm", ["ship"]), tones: ["heroic", "humorous"] },
	{ id: "arctic", name: "Frozen North", blurb: "Endless snow, longhouses, frost giants and ancient things beneath the ice.", scene: sc("mountain", "day", "snow", "somber"), tones: ["gritty", "mysterious"] },
	{ id: "desert_kingdoms", name: "Desert Kingdoms", blurb: "Caravans and sultanates, genie-haunted ruins and tombs beneath the dunes.", scene: sc("desert", "dusk", "clear", "mysterious"), tones: ["political", "mysterious"] },
	{ id: "fey_wilds", name: "The Feywild", blurb: "Glittering forests, capricious fey courts and bargains that always cost more than they seem.", scene: sc("forest", "night", "fog", "mysterious"), tones: ["whimsical", "mysterious"] },
	{ id: "custom", name: "Your Own World", blurb: "Describe your setting in a few lines and the DM will build on it.", scene: sc("tavern", "night", "clear", "festive"), tones: ["heroic"] },
];

export const presetInfo = (id: WorldPreset): WorldPresetInfo => WORLD_PRESETS.find((p) => p.id === id) ?? WORLD_PRESETS[0];

export const TONES = ["heroic", "humorous", "dark", "mysterious", "political", "whimsical", "romantic", "gritty", "epic"] as const;

export const LINE_SUGGESTIONS = ["Harm to children", "Sexual violence", "Torture", "Animal cruelty", "Self-harm", "Real-world bigotry", "Body horror", "Spiders"];
export const VEIL_SUGGESTIONS = ["Romance & intimacy", "Graphic gore", "Death of loved ones", "Drug use", "Disease & plague", "Slavery", "Insects", "Drowning"];

export const HOOKS: Record<WorldPreset | "any", string[]> = {
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
	custom: [],
};

export const PERSONAS: { label: string; text: string }[] = [
	{ label: "Grizzled storyteller", text: "A grizzled old storyteller by the fire: dry wit, vivid but economical prose, respects player agency, never pulls punches." },
	{ label: "Whimsical bard", text: "A whimsical bard who narrates with playful flourishes, puns, songs and colorful NPC voices, but keeps the stakes real." },
	{ label: "Ominous narrator", text: "An ominous, foreboding narrator: slow-burn dread, sensory detail, short sentences when tension rises." },
	{ label: "Epic chronicler", text: "A chronicler of legends: sweeping, cinematic narration with grand stakes and moments of quiet heroism." },
	{ label: "Noir investigator", text: "A hard-boiled noir voice: clipped sentences, secrets everywhere, every NPC wants something." },
];

export const DIFFICULTY_INFO: Record<CampaignSettings["structure"]["difficulty"], string> = {
	story: "Narrative first. Fights are rare and forgiving; failure leads to complications, not death.",
	easy: "Encounters lean below your level. Good for learning the rules.",
	normal: "Balanced 5e encounters with real risk.",
	hard: "Tougher foes and scarcer rest. Tactics matter.",
	deadly: "Brutal. Death is a real possibility at every turn.",
};

export const FORMAT_INFO: Record<CampaignSettings["structure"]["format"], { name: string; blurb: string }> = {
	one_shot: { name: "One-shot", blurb: "A complete adventure in one or two sittings." },
	short_campaign: { name: "Short campaign", blurb: "A handful of sessions with a clear arc." },
	long_campaign: { name: "Long campaign", blurb: "An open-ended saga that grows with your hero." },
};

export const TITLE_PARTS = {
	a: ["The", "A"],
	b: ["Ashen", "Hollow", "Crimson", "Drowned", "Silent", "Gilded", "Shattered", "Forgotten", "Whispering", "Iron", "Emerald", "Sunken"],
	c: ["Crown", "Road", "Vault", "Oath", "Lantern", "Throne", "Tide", "Gate", "Hymn", "Spire", "Covenant", "Mire"],
};
