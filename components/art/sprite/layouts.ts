/**
 * PREVIEW ONLY. Hand-authored scene layouts, written the way the DM would
 * write them: rows of single-character cells plus who stands where.
 */

export const GRID_W = 40;
export const GRID_H = 22;

/**
 * Cell legend.
 * .  snow            ,  snow with tufts   ^  pine          o  boulder
 * #  rock (natural)  W  log wall          =  plank floor   +  door
 * F  fire            k  hearthstone       T  table         h  bench
 * R  runestone       t  wall torch        B  barrel        ~  open water
 * i  ice             I  cracked ice       :  cave floor    A  stalagmite
 * d  puddle          b  boat              _  shore gravel  f  footprints
 * @  the player      1-9 NPCs (see `people`)
 */
export interface Person {
	name: string;
	hair: string;
	cloth: string;
}

export interface Layout {
	id: string;
	title: string;
	time: "dawn" | "day" | "dusk" | "night";
	snow: boolean;
	/** Interior or underground: dark except near light. */
	dark: boolean;
	rows: string[];
	people: Record<string, Person>;
}

const PC: Person = { name: "Aelar", hair: "#c4502a", cloth: "#3f4f86" };

function pad(rows: string[], fill = "."): string[] {
	const out = rows.slice(0, GRID_H).map((r) => (r + fill.repeat(GRID_W)).slice(0, GRID_W));
	while (out.length < GRID_H) out.push(fill.repeat(GRID_W));
	return out;
}

export const LAYOUTS: Layout[] = [
	{
		id: "runehouse",
		title: "The Runehouse, Before Dawn",
		time: "dawn",
		snow: true,
		dark: false,
		people: {
			"@": PC,
			"1": { name: "Sigrun", hair: "#e2c37a", cloth: "#7a2f2f" },
			"2": { name: "Bjarki", hair: "#3b2a20", cloth: "#5b4a33" },
			"3": { name: "Tova", hair: "#b0602a", cloth: "#4f6b3a" },
		},
		rows: pad([
			"^^.......^.................,.......^^^..",
			"^..........,..........................^^",
			"...........................o...........^",
			"......WWWWWWtWWWWWWWWtWWWWWWWWtWWWW.....",
			"......W=R=============R=========BBW.....",
			"......W==========================BW.....",
			"......W=hhhhhh===kkkkkk===hhhhhh==W.....",
			"......W=TTTTTT===kFFFFk===TTTTTT==W.....",
			"......W=hhhhhh===kkkkkk===hhhhhh==W.....",
			"......W============@==============W.....",
			"......W=R=========================W.....",
			"......W===============2=1===3=====W.....",
			"......WWWWWWtWWWWWWW+WWWWWWtWWWWWWW.....",
			"....................f...................",
			"..^................f......,.........^...",
			".^^^..............f..................^^.",
			"..^..............f..............o.......",
			"................f.......................",
			".....,.........f...................^....",
			"...............f..................^^^...",
			"..o...........f....................^....",
			"..............f.........................",
		]),
	},
	{
		id: "weeping",
		title: "The Weeping Rocks",
		time: "dawn",
		snow: true,
		dark: false,
		people: {
			"@": PC,
			"1": { name: "Bjarki", hair: "#3b2a20", cloth: "#5b4a33" },
			"2": { name: "Tova", hair: "#b0602a", cloth: "#4f6b3a" },
		},
		rows: pad([
			"^^....^.......##########################",
			".^^..........###########################",
			"..^.........####:::A:::#################",
			"...........####::d:::::::A##############",
			"..o.......####:::dd:::::::::############",
			"..........###::A:::::d:::::::::#########",
			"....^.....##:::::::::::::A::::::::######",
			"...^^^....##::d::::###::::::dd:::::#####",
			"....^.....#:::::::#####:::::ddd:::A:####",
			"..........#@::::::######::A::::::::::###",
			"..........12:::::#######:::::::::d:::###",
			".........ff:::::########:::::A:::::::###",
			"........ff.##::::######::::::::::::::###",
			".._____ff..###:::::::::::d::::A:::::####",
			"__________..#####::::::::::::::::#######",
			"iiiiii_____...######:::::::::::#########",
			"iiiiiiiii____..##########:::############",
			"iiiiiiiiiiii____.#######################",
			"iiiiiiiiiiiiii____.....#################",
			"iiiiiiiiiiiiiiiii______......###########",
			"iiiiiiiiiiiiiiiiiiiiii______.....,......",
			"iiiiiiiiiiiiiiiiiiiiiiiiiii_______......",
		]),
	},
	{
		id: "lake",
		title: "Lake Vasshelm",
		time: "dawn",
		snow: true,
		dark: false,
		people: {
			"@": PC,
			"1": { name: "Sigrun", hair: "#e2c37a", cloth: "#7a2f2f" },
		},
		rows: pad([
			"^^^...^^....^......,.....^^.....WWWWW..^",
			"^^..........................,...W===W...",
			".^....o.........................W===+...",
			"............b.....,.............WWWWW...",
			"___________________....____________.....",
			"iiiiiiiiiiiiiiiiiii____iiiiiiiiiii______",
			"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiiffiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiffiiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiIfIIiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiIIf@1IIiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiIII~~~~~IIIiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiII~~~~~~~IIiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiIII~~~~~IIIiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiIIIIIIIiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
			"iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
		]),
	},
];
