import type { MapEntity } from "@/lib/game/types";
import { TOKEN_ICON_PATHS } from "../tokenIcons";
import { shade } from "./color";
import { poly, roundRect } from "./tilePainter";

/**
 * Token & prop art painted on Canvas 2D: round "portrait" tokens built from a
 * game-icons.net silhouette (CC BY 3.0) on a tinted disc with a metallic ring,
 * and top-down props (chests, barrels, campfires, altars…) for map features.
 */

const ALIASES: [RegExp, string][] = [
	[/pc[:_ -]?(fighter|paladin|barbarian|knight)/, "pc_fighter"],
	[/pc[:_ -]?(rogue|ranger|monk)/, "pc_rogue"],
	[/pc[:_ -]?(wizard|sorcerer|warlock|mage)/, "pc_wizard"],
	[/pc[:_ -]?(cleric|druid|priest)/, "priest"],
	[/pc[:_ -]?(bard)/, "elf"],
	[/^pc|hero|player/, "pc"],
	[/skelet/, "skeleton"], [/zombie|ghoul|ghast/, "zombie"], [/ghost|wraith|specter|spectre|banshee|shadow|wight/, "ghost"],
	[/mummy/, "mummy"], [/vampire/, "vampire"], [/lich|undead|revenant|death/, "undead"],
	[/wyvern/, "wyvern"], [/dragon|drake|wyrm|dragonborn/, "dragon"],
	[/werewolf|lycan/, "werewolf"], [/wolf|worg|dog|hound|jackal|coyote/, "wolf"],
	[/boar/, "boar"], [/bear|owlbear|ape|lion|tiger|panther|beast|cat|elk|deer/, "beast"],
	[/spider|ettercap/, "spider"], [/ooze|slime|pudding|jelly|cube/, "ooze"],
	[/elemental|fire|flame|magma|salamander|mephit/, "elemental"],
	[/imp|quasit/, "imp"], [/demon|devil|fiend|hell|balor|rakshasa/, "fiend"],
	[/ogre|troll/, "ogre"], [/giant|ettin|cyclops/, "giant"],
	[/golem|construct|animated|armor|homunculus|shield guardian/, "construct"],
	[/myconid|fung|shrieker|mushroom|violet/, "fungus"], [/plant|blight|treant|shambling|vine|tree/, "plant"],
	[/fey|pixie|sprite|dryad|satyr|fairy|hag/, "fey"],
	[/tentacle|otyugh|kraken|squid|grick/, "tentacle"], [/beholder|aberration|mind|eye|aboleth|gibbering|spectator|nothic/, "aberration"],
	[/angel|celestial|deva|planetar|unicorn|pegasus/, "celestial"],
	[/minotaur/, "minotaur"], [/hydra|chimera|manticore|monstros|basilisk|griffon|gorgon|harpy|wyrm/, "monstrosity"],
	[/crab|scorpion/, "crab"], [/rat/, "rat"], [/bat/, "bat"], [/snake|serpent|naga|viper|python/, "snake"],
	[/horse|pony|mule|camel|mount/, "horse"], [/bird|eagle|hawk|owl|raven|crow|vulture|roc/, "bird"],
	[/kobold/, "kobold"], [/goblin|hobgoblin|bugbear|goblinoid/, "goblin"], [/orc|half-orc|orog/, "orc"],
	[/bandit|thug|brigand|cutthroat|thief|spy|assassin|raider/, "bandit"], [/survivor/, "humanoid"], [/guard|soldier|veteran|watch|militia|gladiator/, "guard"],
	[/knight|captain|noble|lord|king|queen/, "knight"], [/cult|acolyte|fanatic/, "cultist"], [/mage|wizard|sorcer|warlock|apprentice|archmage/, "mage"],
	[/priest|cleric|druid|monk/, "priest"], [/archer|scout|ranger|hunter/, "archer"], [/pirate|sailor|buccaneer/, "pirate"],
	[/dwarf|duergar/, "dwarf"], [/elf|drow|eladrin/, "elf"], [/commoner|villager|merchant|innkeeper|peasant|humanoid|human|npc/, "humanoid"],
];

export function iconKeyFor(hint: string | undefined, kind?: MapEntity["kind"]): string {
	const h = (hint ?? "").toLowerCase().trim();
	if (h && TOKEN_ICON_PATHS[h]) return h;
	for (const [re, key] of ALIASES) if (h && re.test(h)) return key;
	if (kind === "pc") return "pc";
	if (kind === "npc") return "humanoid";
	return "monstrosity";
}

const CATEGORY_BG: Record<string, string> = {
	pc: "#2d4a7a", pc_fighter: "#2d4a7a", pc_rogue: "#2d4a7a", pc_wizard: "#3a3a7a",
	humanoid: "#6b4f3a", bandit: "#5a4636", guard: "#4d5560", knight: "#3e4652", cultist: "#4a1f2a", mage: "#3a3170", priest: "#7a6a3a",
	archer: "#3f5a33", pirate: "#3b4a5c", dwarf: "#6b4a2a", elf: "#35624f", monk: "#7a5a2a",
	goblin: "#4f5d2f", orc: "#55602e", kobold: "#6a4a2a",
	wolf: "#5a5048", werewolf: "#4a3f36", beast: "#6b5232", boar: "#5f4630", bat: "#3a3240", rat: "#4f463c", snake: "#44522a", horse: "#6b5238", bird: "#5b5a48", crab: "#7a3a2a",
	undead: "#39443d", skeleton: "#4a4a40", zombie: "#3d4a30", ghost: "#3d4f5f", mummy: "#5f553d", vampire: "#4a1a22",
	dragon: "#6e1f1f", wyvern: "#4f2a2a", spider: "#2f2a33", ooze: "#3f5f2a", elemental: "#7a3b12",
	fiend: "#5a1a22", imp: "#6a2020", giant: "#5b4636", ogre: "#5a5a2e", construct: "#4f5560", plant: "#2f4f2a", fungus: "#5a3f5f",
	fey: "#2f5f5a", aberration: "#4a2f5e", tentacle: "#3f2f5e", celestial: "#8a7a3a", monstrosity: "#5e3a2a", minotaur: "#5a3a26",
};

export const RING: Record<string, string> = {
	party: "#e3b448",
	friendly: "#3fae6a",
	neutral: "#d8a326",
	hostile: "#c8372d",
};

export function ringFor(e: Pick<MapEntity, "kind" | "disposition">, side?: "party" | "enemy" | "neutral"): string {
	if (e.kind === "pc" || side === "party") return RING.party;
	if (side === "enemy") return RING.hostile;
	if (e.disposition) return RING[e.disposition];
	return e.kind === "monster" ? RING.hostile : RING.neutral;
}

const pathCache = new Map<string, Path2D>();
function iconPath(key: string): Path2D | undefined {
	const d = TOKEN_ICON_PATHS[key];
	if (!d || typeof Path2D === "undefined") return undefined;
	let p = pathCache.get(key);
	if (!p) {
		p = new Path2D(d);
		pathCache.set(key, p);
	}
	return p;
}

/** Paints a round token into a square canvas of `px` pixels. */
export function paintToken(px: number, hint: string, kind: MapEntity["kind"], ring: string): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = c.height = px;
	const ctx = c.getContext("2d")!;
	const cx = px / 2, cy = px / 2;
	const R = px * 0.44;
	const key = iconKeyFor(hint, kind);
	const bg = CATEGORY_BG[key] ?? "#5e4a3a";
	// drop shadow
	ctx.save();
	ctx.shadowColor = "rgba(0,0,0,0.65)";
	ctx.shadowBlur = px * 0.06;
	ctx.shadowOffsetY = px * 0.025;
	ctx.fillStyle = "#000";
	ctx.beginPath();
	ctx.arc(cx, cy, R, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
	// metallic ring
	const rg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
	rg.addColorStop(0, shade(ring, 0.45));
	rg.addColorStop(0.45, ring);
	rg.addColorStop(1, shade(ring, -0.5));
	ctx.fillStyle = rg;
	ctx.beginPath();
	ctx.arc(cx, cy, R, 0, Math.PI * 2);
	ctx.fill();
	// inner disc
	const ir = R * 0.84;
	const bgG = ctx.createRadialGradient(cx - ir * 0.3, cy - ir * 0.35, ir * 0.1, cx, cy, ir);
	bgG.addColorStop(0, shade(bg, 0.28));
	bgG.addColorStop(1, shade(bg, -0.45));
	ctx.fillStyle = "#0b0907";
	ctx.beginPath();
	ctx.arc(cx, cy, ir + px * 0.012, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = bgG;
	ctx.beginPath();
	ctx.arc(cx, cy, ir, 0, Math.PI * 2);
	ctx.fill();
	// icon
	const path = iconPath(key);
	ctx.save();
	ctx.beginPath();
	ctx.arc(cx, cy, ir, 0, Math.PI * 2);
	ctx.clip();
	if (path) {
		const s = (ir * 1.5) / 512;
		ctx.translate(cx - 256 * s, cy - 256 * s + ir * 0.02);
		ctx.scale(s, s);
		ctx.shadowColor = "rgba(0,0,0,0.7)";
		ctx.shadowBlur = 6 / s / 10;
		ctx.shadowOffsetY = 8;
		ctx.fillStyle = key === "undead" || key === "skeleton" || key === "ghost" ? "#e4ecd9" : key.startsWith("pc") ? "#f5ead0" : "#f1e4c6";
		ctx.fill(path);
	}
	ctx.restore();
	// gloss
	const gl = ctx.createLinearGradient(cx, cy - ir, cx, cy);
	gl.addColorStop(0, "rgba(255,255,255,0.28)");
	gl.addColorStop(1, "rgba(255,255,255,0)");
	ctx.fillStyle = gl;
	ctx.beginPath();
	ctx.ellipse(cx, cy - ir * 0.45, ir * 0.78, ir * 0.48, 0, Math.PI, Math.PI * 2);
	ctx.fill();
	// ring rim lines
	ctx.strokeStyle = "rgba(0,0,0,0.55)";
	ctx.lineWidth = Math.max(1, px * 0.012);
	ctx.beginPath();
	ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, Math.PI * 2);
	ctx.stroke();
	ctx.strokeStyle = "rgba(255,255,255,0.35)";
	ctx.beginPath();
	ctx.arc(cx, cy, R * 0.93, Math.PI * 1.05, Math.PI * 1.7);
	ctx.stroke();
	return c;
}

// ─── Props (top-down features) ───────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

const PROP_PAINTERS: Record<string, (ctx: Ctx, s: number) => void> = {
	chest(ctx, s) {
		shadowed(ctx, s, () => { roundRect(ctx, s * 0.18, s * 0.28, s * 0.64, s * 0.44, s * 0.05); });
		const g = ctx.createLinearGradient(0, s * 0.28, 0, s * 0.72);
		g.addColorStop(0, "#9a6a35");
		g.addColorStop(1, "#5a3a1a");
		ctx.fillStyle = g;
		roundRect(ctx, s * 0.18, s * 0.28, s * 0.64, s * 0.44, s * 0.05);
		ctx.fill();
		ctx.fillStyle = "#3b3b40";
		for (const x of [0.26, 0.68]) ctx.fillRect(s * x, s * 0.28, s * 0.06, s * 0.44);
		ctx.fillRect(s * 0.18, s * 0.46, s * 0.64, s * 0.05);
		ctx.fillStyle = "#e0b43a";
		ctx.fillRect(s * 0.46, s * 0.44, s * 0.08, s * 0.1);
		outline(ctx, s, () => roundRect(ctx, s * 0.18, s * 0.28, s * 0.64, s * 0.44, s * 0.05));
	},
	barrel(ctx, s) {
		shadowed(ctx, s, () => circle(ctx, s / 2, s / 2, s * 0.32));
		const g = ctx.createRadialGradient(s * 0.42, s * 0.42, 1, s / 2, s / 2, s * 0.32);
		g.addColorStop(0, "#a8784a");
		g.addColorStop(1, "#5c3b1e");
		ctx.fillStyle = g;
		circle(ctx, s / 2, s / 2, s * 0.32);
		ctx.fill();
		ctx.strokeStyle = "#3a3a3e";
		ctx.lineWidth = s * 0.04;
		circle(ctx, s / 2, s / 2, s * 0.3);
		ctx.stroke();
		circle(ctx, s / 2, s / 2, s * 0.18);
		ctx.stroke();
		ctx.strokeStyle = "rgba(40,25,10,0.5)";
		ctx.lineWidth = 1;
		for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(i) * s * 0.18, s / 2 + Math.sin(i) * s * 0.18); ctx.stroke(); }
	},
	crate(ctx, s) {
		shadowed(ctx, s, () => ctx.rect(s * 0.18, s * 0.18, s * 0.64, s * 0.64));
		ctx.fillStyle = "#9b7444";
		ctx.fillRect(s * 0.18, s * 0.18, s * 0.64, s * 0.64);
		ctx.strokeStyle = "#5a3c1c";
		ctx.lineWidth = s * 0.06;
		ctx.strokeRect(s * 0.21, s * 0.21, s * 0.58, s * 0.58);
		ctx.beginPath(); ctx.moveTo(s * 0.21, s * 0.21); ctx.lineTo(s * 0.79, s * 0.79); ctx.stroke();
		ctx.strokeStyle = "rgba(255,230,180,0.2)";
		ctx.lineWidth = 1;
		ctx.strokeRect(s * 0.18, s * 0.18, s * 0.64, s * 0.64);
	},
	campfire(ctx, s) {
		for (let i = 0; i < 9; i++) {
			const a = (i / 9) * Math.PI * 2;
			ctx.fillStyle = i % 2 ? "#6f6a62" : "#8a847a";
			poly(ctx, s / 2 + Math.cos(a) * s * 0.33, s / 2 + Math.sin(a) * s * 0.33, s * 0.08, 6, i * 0.37);
			ctx.fill();
		}
		ctx.fillStyle = "#1c1410";
		circle(ctx, s / 2, s / 2, s * 0.26);
		ctx.fill();
		ctx.strokeStyle = "#5b3a1e";
		ctx.lineWidth = s * 0.08;
		ctx.lineCap = "round";
		for (const a of [0.4, 1.6, 2.7]) { ctx.beginPath(); ctx.moveTo(s / 2 - Math.cos(a) * s * 0.22, s / 2 - Math.sin(a) * s * 0.22); ctx.lineTo(s / 2 + Math.cos(a) * s * 0.22, s / 2 + Math.sin(a) * s * 0.22); ctx.stroke(); }
		flame(ctx, s / 2, s / 2, s * 0.2);
	},
	hearth(ctx, s) {
		ctx.fillStyle = "#4d4741";
		roundRect(ctx, s * 0.08, s * 0.2, s * 0.84, s * 0.6, s * 0.06);
		ctx.fill();
		ctx.fillStyle = "#1a1210";
		roundRect(ctx, s * 0.2, s * 0.3, s * 0.6, s * 0.4, s * 0.05);
		ctx.fill();
		flame(ctx, s / 2, s / 2, s * 0.17);
	},
	altar(ctx, s) {
		shadowed(ctx, s, () => ctx.rect(s * 0.12, s * 0.25, s * 0.76, s * 0.5));
		const g = ctx.createLinearGradient(0, s * 0.25, 0, s * 0.75);
		g.addColorStop(0, "#d8d0c0");
		g.addColorStop(1, "#8f877a");
		ctx.fillStyle = g;
		ctx.fillRect(s * 0.12, s * 0.25, s * 0.76, s * 0.5);
		ctx.fillStyle = "#7a1f2b";
		ctx.fillRect(s * 0.4, s * 0.25, s * 0.2, s * 0.5);
		ctx.fillStyle = "#e5c04a";
		circle(ctx, s / 2, s / 2, s * 0.06);
		ctx.fill();
		outline(ctx, s, () => ctx.rect(s * 0.12, s * 0.25, s * 0.76, s * 0.5));
	},
	throne(ctx, s) {
		shadowed(ctx, s, () => ctx.rect(s * 0.18, s * 0.12, s * 0.64, s * 0.72));
		ctx.fillStyle = "#4a3b2a";
		ctx.fillRect(s * 0.18, s * 0.12, s * 0.64, s * 0.72);
		ctx.fillStyle = "#7a1f2b";
		ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.45);
		ctx.fillStyle = "#c9a23a";
		ctx.fillRect(s * 0.18, s * 0.12, s * 0.64, s * 0.12);
		for (const x of [0.2, 0.46, 0.72]) { ctx.beginPath(); ctx.moveTo(s * x, s * 0.12); ctx.lineTo(s * (x + 0.04), s * 0.04); ctx.lineTo(s * (x + 0.08), s * 0.12); ctx.fill(); }
	},
	statue(ctx, s) {
		shadowed(ctx, s, () => circle(ctx, s / 2, s / 2, s * 0.36));
		ctx.fillStyle = "#8d877d";
		ctx.fillRect(s * 0.14, s * 0.14, s * 0.72, s * 0.72);
		icon(ctx, s, "celestial", "#d9d3c7", 0.8);
	},
	sarcophagus(ctx, s) {
		shadowed(ctx, s, () => ctx.rect(s * 0.28, s * 0.06, s * 0.44, s * 0.88));
		const g = ctx.createLinearGradient(s * 0.28, 0, s * 0.72, 0);
		g.addColorStop(0, "#a49d8e");
		g.addColorStop(1, "#6a6458");
		ctx.fillStyle = g;
		roundRect(ctx, s * 0.28, s * 0.06, s * 0.44, s * 0.88, s * 0.08);
		ctx.fill();
		ctx.strokeStyle = "rgba(0,0,0,0.4)";
		ctx.lineWidth = s * 0.02;
		roundRect(ctx, s * 0.33, s * 0.12, s * 0.34, s * 0.76, s * 0.06);
		ctx.stroke();
		ctx.fillStyle = "rgba(0,0,0,0.3)";
		ctx.fillRect(s * 0.47, s * 0.25, s * 0.06, s * 0.4);
		ctx.fillRect(s * 0.4, s * 0.33, s * 0.2, s * 0.05);
	},
	coffin(ctx, s) {
		shadowed(ctx, s, () => coffinPath(ctx, s));
		ctx.fillStyle = "#5a3a22";
		coffinPath(ctx, s);
		ctx.fill();
		ctx.strokeStyle = "#2a1a0c";
		ctx.lineWidth = s * 0.03;
		ctx.stroke();
		ctx.fillStyle = "#9a8a6a";
		ctx.fillRect(s * 0.47, s * 0.3, s * 0.06, s * 0.3);
		ctx.fillRect(s * 0.41, s * 0.38, s * 0.18, s * 0.05);
	},
	bookshelf(ctx, s) {
		shadowed(ctx, s, () => ctx.rect(s * 0.06, s * 0.3, s * 0.88, s * 0.4));
		ctx.fillStyle = "#4a2f1a";
		ctx.fillRect(s * 0.06, s * 0.3, s * 0.88, s * 0.4);
		const colors = ["#7a2e2e", "#2e4a7a", "#2e6a3a", "#7a6a2e", "#5a2e6a"];
		for (let i = 0; i < 9; i++) {
			ctx.fillStyle = colors[(i * 7) % colors.length];
			ctx.fillRect(s * (0.09 + i * 0.094), s * 0.34, s * 0.08, s * 0.3);
		}
	},
	tent(ctx, s) {
		shadowed(ctx, s, () => ctx.rect(s * 0.08, s * 0.12, s * 0.84, s * 0.76));
		ctx.fillStyle = "#b9a27a";
		ctx.fillRect(s * 0.08, s * 0.12, s * 0.84, s * 0.38);
		ctx.fillStyle = "#8f7a55";
		ctx.fillRect(s * 0.08, s * 0.5, s * 0.84, s * 0.38);
		ctx.strokeStyle = "#5a4a30";
		ctx.lineWidth = s * 0.02;
		ctx.strokeRect(s * 0.08, s * 0.12, s * 0.84, s * 0.76);
		ctx.beginPath(); ctx.moveTo(s * 0.08, s * 0.5); ctx.lineTo(s * 0.92, s * 0.5); ctx.stroke();
		ctx.fillStyle = "#2a2016";
		ctx.beginPath(); ctx.moveTo(s * 0.92, s * 0.5); ctx.lineTo(s * 0.8, s * 0.38); ctx.lineTo(s * 0.8, s * 0.62); ctx.fill();
	},
	log(ctx, s) {
		shadowed(ctx, s, () => roundRect(ctx, s * 0.1, s * 0.36, s * 0.8, s * 0.28, s * 0.14));
		ctx.fillStyle = "#6a4626";
		roundRect(ctx, s * 0.1, s * 0.36, s * 0.8, s * 0.28, s * 0.14);
		ctx.fill();
		ctx.fillStyle = "#b48a5a";
		circle(ctx, s * 0.84, s * 0.5, s * 0.11);
		ctx.fill();
		ctx.strokeStyle = "rgba(60,35,15,0.6)";
		ctx.lineWidth = 1;
		circle(ctx, s * 0.84, s * 0.5, s * 0.06);
		ctx.stroke();
	},
	well(ctx, s) {
		shadowed(ctx, s, () => circle(ctx, s / 2, s / 2, s * 0.4));
		ctx.fillStyle = "#8a847a";
		circle(ctx, s / 2, s / 2, s * 0.4);
		ctx.fill();
		ctx.fillStyle = "#1d3a4a";
		circle(ctx, s / 2, s / 2, s * 0.26);
		ctx.fill();
		ctx.strokeStyle = "#4a3320";
		ctx.lineWidth = s * 0.07;
		ctx.beginPath(); ctx.moveTo(s * 0.1, s / 2); ctx.lineTo(s * 0.9, s / 2); ctx.stroke();
	},
	stall(ctx, s) {
		shadowed(ctx, s, () => ctx.rect(s * 0.08, s * 0.15, s * 0.84, s * 0.7));
		for (let i = 0; i < 6; i++) {
			ctx.fillStyle = i % 2 ? "#c8b8a0" : "#8f2f2f";
			ctx.fillRect(s * (0.08 + i * 0.14), s * 0.15, s * 0.14, s * 0.7);
		}
		ctx.strokeStyle = "rgba(0,0,0,0.4)";
		ctx.lineWidth = 1;
		ctx.strokeRect(s * 0.08, s * 0.15, s * 0.84, s * 0.7);
	},
	cart(ctx, s) {
		shadowed(ctx, s, () => ctx.rect(s * 0.15, s * 0.22, s * 0.7, s * 0.5));
		ctx.save();
		ctx.translate(s / 2, s / 2);
		ctx.rotate(0.35);
		ctx.translate(-s / 2, -s / 2);
		ctx.fillStyle = "#7a5530";
		ctx.fillRect(s * 0.15, s * 0.25, s * 0.7, s * 0.45);
		ctx.strokeStyle = "#4a3018";
		ctx.lineWidth = s * 0.02;
		for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(s * 0.15, s * (0.25 + i * 0.09)); ctx.lineTo(s * 0.85, s * (0.25 + i * 0.09)); ctx.stroke(); }
		ctx.fillStyle = "#2a1f14";
		for (const [x, y] of [[0.22, 0.2], [0.7, 0.2], [0.22, 0.7], [0.7, 0.7]]) ctx.fillRect(s * x, s * y, s * 0.1, s * 0.07);
		ctx.strokeStyle = "#5a3a1e";
		ctx.lineWidth = s * 0.03;
		ctx.beginPath(); ctx.moveTo(s * 0.85, s * 0.4); ctx.lineTo(s, s * 0.35); ctx.moveTo(s * 0.85, s * 0.55); ctx.lineTo(s, s * 0.6); ctx.stroke();
		ctx.restore();
		// spilled sacks
		ctx.fillStyle = "#b8a27a";
		for (const [x, y] of [[0.15, 0.8], [0.3, 0.86]]) { circle(ctx, s * x, s * y, s * 0.07); ctx.fill(); }
	},
	banner(ctx, s) {
		ctx.fillStyle = "#3a2a1a";
		ctx.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.06);
		ctx.fillStyle = "#7a1f2b";
		ctx.beginPath(); ctx.moveTo(s * 0.26, s * 0.26); ctx.lineTo(s * 0.74, s * 0.26); ctx.lineTo(s * 0.74, s * 0.8); ctx.lineTo(s / 2, s * 0.68); ctx.lineTo(s * 0.26, s * 0.8); ctx.closePath(); ctx.fill();
		ctx.fillStyle = "#d8b24a";
		circle(ctx, s / 2, s * 0.45, s * 0.08);
		ctx.fill();
	},
	weapon_rack(ctx, s) {
		ctx.fillStyle = "#5a3a1e";
		ctx.fillRect(s * 0.1, s * 0.42, s * 0.8, s * 0.12);
		ctx.strokeStyle = "#b8bcc4";
		ctx.lineWidth = s * 0.04;
		for (const x of [0.22, 0.42, 0.62, 0.8]) { ctx.beginPath(); ctx.moveTo(s * x, s * 0.15); ctx.lineTo(s * x, s * 0.85); ctx.stroke(); }
	},
	bedroll(ctx, s) {
		ctx.fillStyle = "#5a6a4a";
		roundRect(ctx, s * 0.3, s * 0.08, s * 0.4, s * 0.84, s * 0.12);
		ctx.fill();
		ctx.fillStyle = "#c8bba0";
		roundRect(ctx, s * 0.34, s * 0.1, s * 0.32, s * 0.16, s * 0.06);
		ctx.fill();
	},
	chains(ctx, s) {
		ctx.strokeStyle = "#8a8d94";
		ctx.lineWidth = s * 0.03;
		for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(s * (0.25 + i * 0.1), s * (0.3 + (i % 2) * 0.05), s * 0.05, s * 0.03, i % 2 ? 0 : Math.PI / 2, 0, Math.PI * 2); ctx.stroke(); }
		ctx.beginPath(); ctx.arc(s * 0.78, s * 0.5, s * 0.1, 0, Math.PI * 2); ctx.stroke();
	},
	table_small(ctx, s) {
		shadowed(ctx, s, () => circle(ctx, s / 2, s / 2, s * 0.32));
		ctx.fillStyle = "#8a6038";
		circle(ctx, s / 2, s / 2, s * 0.32);
		ctx.fill();
		ctx.fillStyle = "#e8dcc0";
		ctx.fillRect(s * 0.38, s * 0.36, s * 0.26, s * 0.2);
	},
	wheel(ctx, s) {
		ctx.strokeStyle = "#5a3a1e";
		ctx.lineWidth = s * 0.06;
		circle(ctx, s / 2, s / 2, s * 0.26);
		ctx.stroke();
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2;
			ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(s / 2 + Math.cos(a) * s * 0.38, s / 2 + Math.sin(a) * s * 0.38); ctx.stroke();
		}
	},
	bollard(ctx, s) {
		ctx.fillStyle = "#3a3a3e";
		circle(ctx, s / 2, s / 2, s * 0.14);
		ctx.fill();
	},
	standing_stone(ctx, s) {
		shadowed(ctx, s, () => poly(ctx, s / 2, s / 2, s * 0.32, 7, 0.4));
		ctx.fillStyle = "#8a877e";
		poly(ctx, s / 2, s / 2, s * 0.32, 7, 0.4);
		ctx.fill();
		ctx.strokeStyle = "#6ec6d6";
		ctx.lineWidth = s * 0.025;
		ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.12, 0.3, 4.5); ctx.stroke();
	},
	coins(ctx, s) {
		ctx.fillStyle = "#e3b448";
		for (let i = 0; i < 7; i++) { circle(ctx, s * (0.3 + ((i * 37) % 40) / 100), s * (0.3 + ((i * 53) % 40) / 100), s * 0.05); ctx.fill(); }
	},
	bones(ctx, s) {
		ctx.strokeStyle = "#e6dcc4";
		ctx.lineWidth = s * 0.05;
		ctx.lineCap = "round";
		for (const [a, b, c, d] of [[0.25, 0.3, 0.7, 0.6], [0.3, 0.7, 0.65, 0.35], [0.5, 0.2, 0.55, 0.5]]) { ctx.beginPath(); ctx.moveTo(s * a, s * b); ctx.lineTo(s * c, s * d); ctx.stroke(); }
		ctx.fillStyle = "#e6dcc4";
		circle(ctx, s * 0.72, s * 0.72, s * 0.1);
		ctx.fill();
	},
	trap(ctx, s) {
		ctx.strokeStyle = "rgba(200,40,40,0.9)";
		ctx.lineWidth = s * 0.05;
		ctx.setLineDash([s * 0.08, s * 0.05]);
		ctx.strokeRect(s * 0.15, s * 0.15, s * 0.7, s * 0.7);
		ctx.setLineDash([]);
		icon(ctx, s, "trap", "#e05a4a", 0.6);
	},
	torch(ctx, s) {
		ctx.fillStyle = "#4a3320";
		ctx.fillRect(s * 0.46, s * 0.45, s * 0.08, s * 0.3);
		flame(ctx, s / 2, s * 0.42, s * 0.1);
	},
	brazier(ctx, s) {
		ctx.fillStyle = "#2b2b2e";
		circle(ctx, s / 2, s / 2, s * 0.26);
		ctx.fill();
		ctx.fillStyle = "#5a2a14";
		circle(ctx, s / 2, s / 2, s * 0.2);
		ctx.fill();
		flame(ctx, s / 2, s / 2, s * 0.16);
	},
	candles(ctx, s) {
		for (const [x, y] of [[0.4, 0.42], [0.58, 0.48], [0.47, 0.6]]) {
			ctx.fillStyle = "#efe6cf";
			circle(ctx, s * x, s * y, s * 0.045);
			ctx.fill();
			flame(ctx, s * x, s * y, s * 0.03);
		}
	},
	lamp(ctx, s) {
		ctx.fillStyle = "#2b2b2e";
		circle(ctx, s / 2, s / 2, s * 0.1);
		ctx.fill();
		flame(ctx, s / 2, s / 2, s * 0.06);
	},
	lantern(ctx, s) {
		ctx.fillStyle = "#3a3a3e";
		roundRect(ctx, s * 0.42, s * 0.42, s * 0.16, s * 0.16, s * 0.03);
		ctx.fill();
		flame(ctx, s / 2, s / 2, s * 0.06);
	},
	glowshroom(ctx, s) {
		for (const [x, y, r] of [[0.4, 0.45, 0.09], [0.56, 0.4, 0.07], [0.52, 0.58, 0.1], [0.36, 0.6, 0.05]]) {
			const g = ctx.createRadialGradient(s * x, s * y, 0, s * x, s * y, s * r * 2.2);
			g.addColorStop(0, "rgba(120,240,255,0.7)");
			g.addColorStop(1, "rgba(120,240,255,0)");
			ctx.fillStyle = g;
			circle(ctx, s * x, s * y, s * r * 2.2);
			ctx.fill();
			ctx.fillStyle = "#4fd1e8";
			circle(ctx, s * x, s * y, s * r);
			ctx.fill();
			ctx.fillStyle = "#c9f6ff";
			circle(ctx, s * x - s * r * 0.3, s * y - s * r * 0.3, s * r * 0.35);
			ctx.fill();
		}
	},
	wisp(ctx, s) {
		const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.25);
		g.addColorStop(0, "rgba(220,255,240,0.95)");
		g.addColorStop(0.4, "rgba(120,230,200,0.6)");
		g.addColorStop(1, "rgba(120,230,200,0)");
		ctx.fillStyle = g;
		circle(ctx, s / 2, s / 2, s * 0.25);
		ctx.fill();
	},
};

/** Light sources: glow colour (hex number) and flicker amount. */
export function lightStyle(sprite: string): { color: number; flicker: number } {
	switch (sprite) {
		case "glowshroom": return { color: 0x6fe3ff, flicker: 0.04 };
		case "wisp": return { color: 0x9ff5d5, flicker: 0.25 };
		case "candles": return { color: 0xffd9a0, flicker: 0.12 };
		case "lamp": case "lantern": return { color: 0xffd08a, flicker: 0.06 };
		default: return { color: 0xffa64d, flicker: 0.16 };
	}
}

export function hasProp(sprite: string): boolean {
	return !!PROP_PAINTERS[sprite];
}

/** Paints a top-down prop for a feature/item/light entity. */
export function paintProp(px: number, sprite: string, kind: MapEntity["kind"]): HTMLCanvasElement {
	const c = document.createElement("canvas");
	c.width = c.height = px;
	const ctx = c.getContext("2d")!;
	const p = PROP_PAINTERS[sprite];
	if (p) p(ctx, px);
	else {
		// fallback: a plaque with an icon
		const key = iconKeyFor(sprite, kind === "item" ? undefined : kind);
		shadowed(ctx, px, () => roundRect(ctx, px * 0.18, px * 0.18, px * 0.64, px * 0.64, px * 0.12));
		ctx.fillStyle = kind === "item" ? "#5a4a2a" : "#3a352e";
		roundRect(ctx, px * 0.18, px * 0.18, px * 0.64, px * 0.64, px * 0.12);
		ctx.fill();
		ctx.strokeStyle = kind === "item" ? "#e3b448" : "#8a8070";
		ctx.lineWidth = px * 0.03;
		ctx.stroke();
		icon(ctx, px, TOKEN_ICON_PATHS[sprite] ? sprite : key, "#efe3c6", 0.5);
	}
	return c;
}

// ─── helpers ───────────────────────────────────────────────────────────

function circle(ctx: Ctx, x: number, y: number, r: number) {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
}

function shadowed(ctx: Ctx, s: number, shape: () => void) {
	ctx.save();
	ctx.shadowColor = "rgba(0,0,0,0.6)";
	ctx.shadowBlur = s * 0.08;
	ctx.shadowOffsetX = s * 0.04;
	ctx.shadowOffsetY = s * 0.06;
	ctx.fillStyle = "rgba(0,0,0,0.6)";
	ctx.beginPath();
	shape();
	ctx.fill();
	ctx.restore();
}

function outline(ctx: Ctx, s: number, shape: () => void) {
	ctx.strokeStyle = "rgba(0,0,0,0.6)";
	ctx.lineWidth = Math.max(1, s * 0.025);
	ctx.beginPath();
	shape();
	ctx.stroke();
}

function coffinPath(ctx: Ctx, s: number) {
	ctx.beginPath();
	ctx.moveTo(s * 0.42, s * 0.06);
	ctx.lineTo(s * 0.58, s * 0.06);
	ctx.lineTo(s * 0.7, s * 0.28);
	ctx.lineTo(s * 0.6, s * 0.94);
	ctx.lineTo(s * 0.4, s * 0.94);
	ctx.lineTo(s * 0.3, s * 0.28);
	ctx.closePath();
}

function flame(ctx: Ctx, x: number, y: number, r: number) {
	const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
	g.addColorStop(0, "rgba(255,200,90,0.55)");
	g.addColorStop(1, "rgba(255,120,30,0)");
	ctx.fillStyle = g;
	circle(ctx, x, y, r * 2.4);
	ctx.fill();
	ctx.fillStyle = "#f97316";
	circle(ctx, x, y, r);
	ctx.fill();
	ctx.fillStyle = "#fde047";
	circle(ctx, x - r * 0.1, y - r * 0.15, r * 0.6);
	ctx.fill();
	ctx.fillStyle = "#fffbeb";
	circle(ctx, x - r * 0.15, y - r * 0.2, r * 0.28);
	ctx.fill();
}

function icon(ctx: Ctx, s: number, key: string, color: string, scale: number) {
	const d = TOKEN_ICON_PATHS[key];
	if (!d) return;
	const p = new Path2D(d);
	ctx.save();
	const k = (s * scale) / 512;
	ctx.translate(s / 2 - 256 * k, s / 2 - 256 * k);
	ctx.scale(k, k);
	ctx.fillStyle = color;
	ctx.fill(p);
	ctx.restore();
}

export { shade };
