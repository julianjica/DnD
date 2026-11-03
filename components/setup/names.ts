/** Random fantasy names per species (first + optional surname/epithet). */

const NAMES: Record<string, { first: string[]; last: string[] }> = {
	human: {
		first: ["Aldric", "Bryn", "Cassia", "Darian", "Elena", "Fenwick", "Gwen", "Halden", "Isolde", "Jorah", "Kestrel", "Liora", "Marek", "Nessa", "Orrin", "Perrin", "Rowan", "Seren", "Tamsin", "Wyll"],
		last: ["Ashford", "Blackwood", "Brightwater", "Crane", "Dunmore", "Fairfax", "Holloway", "Marsh", "Stormrider", "Thorne", "Vale", "Whitlock"],
	},
	elf: {
		first: ["Aelar", "Arannis", "Caelynn", "Erevan", "Faelwen", "Galinndan", "Ielenia", "Lia", "Mialee", "Naivara", "Quarion", "Sariel", "Thamior", "Valanthe", "Varis"],
		last: ["Amakiir", "Galanodel", "Holimion", "Ilphelkiir", "Liadon", "Meliamne", "Nailo", "Siannodel", "Xiloscient"],
	},
	dwarf: {
		first: ["Adrik", "Amber", "Bardryn", "Brottor", "Dagnal", "Eberk", "Gunnloda", "Helja", "Kildrak", "Mardred", "Orsik", "Riswynn", "Thorin", "Torbera", "Vistra"],
		last: ["Balderk", "Battlehammer", "Dankil", "Fireforge", "Gorunn", "Holderhek", "Ironfist", "Loderr", "Rumnaheim", "Strakeln", "Ungart"],
	},
	halfling: {
		first: ["Alton", "Andry", "Bree", "Callie", "Cora", "Eldon", "Garret", "Kithri", "Lidda", "Merric", "Nedda", "Osborn", "Perrin", "Roscoe", "Seraphina", "Wellby"],
		last: ["Brushgather", "Goodbarrel", "Greenbottle", "High-hill", "Hilltopple", "Leagallow", "Tealeaf", "Thorngage", "Tosscobble", "Underbough"],
	},
	gnome: {
		first: ["Alston", "Bimpnottin", "Boddynock", "Carlin", "Dimble", "Ellyjobell", "Fonkin", "Lilli", "Nissa", "Orryn", "Roywyn", "Tana", "Waywocket", "Zook"],
		last: ["Beren", "Daergel", "Folkor", "Garrick", "Nackle", "Murnig", "Ningel", "Raulnor", "Scheppen", "Timbers", "Turen"],
	},
	"half-elf": {
		first: ["Arlen", "Briala", "Corin", "Delphine", "Elric", "Faye", "Kael", "Lyra", "Maelis", "Soren", "Talia", "Vaelen"],
		last: ["Duskmantle", "Evenwood", "Greycloak", "Moonbrook", "Silverfrond", "Starling", "Windwhisper"],
	},
	"half-orc": {
		first: ["Dench", "Feng", "Gell", "Henk", "Holg", "Imsh", "Keth", "Krusk", "Mhurren", "Ront", "Shump", "Thokk", "Baggi", "Emen", "Engong", "Ovak", "Sutha", "Volen", "Yevelda"],
		last: ["the Unbroken", "Skullsplitter", "Ironhide", "of the Red Hand", "Bonecrusher", "Ashborn"],
	},
	tiefling: {
		first: ["Akmenos", "Amnon", "Barakas", "Damakos", "Ekemon", "Kallista", "Lerissa", "Makaria", "Nemeia", "Orianna", "Skamos", "Hope", "Torment", "Ember", "Riot", "Sorrow", "Temerity"],
		last: ["", "", "Ashveil", "Nightbloom", "Vex", "Cinderhart"],
	},
	dragonborn: {
		first: ["Arjhan", "Balasar", "Bharash", "Donaar", "Ghesh", "Heskan", "Kava", "Kriv", "Medrash", "Mishann", "Nala", "Perra", "Raiann", "Sora", "Surina", "Thava", "Torinn"],
		last: ["Clethtinthiallor", "Daardendrian", "Delmirev", "Drachedandion", "Fenkenkabradon", "Kepeshkmolik", "Kerrhylon", "Kimbatuul", "Linxakasendalor", "Myastan", "Nemmonis", "Yarjerit"],
	},
};

/** The Quiet: ordinary modern names for a small river town (origins are all human). */
const MODERN = {
	first: ["Alex", "Maya", "Jordan", "Sam", "Rosa", "Danny", "Priya", "Marcus", "Lena", "Tyler", "Ana", "Omar", "Kelly", "Luis", "Grace", "Nate", "Tasha", "Wes", "Mei", "Hector", "Erin", "Kofi", "Jess", "Pete"],
	last: ["Miller", "Novak", "Garcia", "Reyes", "Okafor", "Brennan", "Kowalski", "Nguyen", "Price", "Delgado", "Harper", "Chen", "Walsh", "Moreno", "Lindqvist", "Dawson", "Patel", "Hale", "Ruiz", "Sorensen"],
};

export function randomName(speciesId: string, rand: () => number = Math.random): string {
	const n = speciesId.startsWith("z-origin-") ? MODERN : NAMES[speciesId] ?? NAMES.human;
	const pick = (xs: string[]) => xs[Math.floor(rand() * xs.length)];
	const last = pick(n.last);
	return last ? `${pick(n.first)} ${last}` : pick(n.first);
}
