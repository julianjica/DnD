/**
 * Pixel "paper doll" for people (the PC and NPCs), built from the same
 * PortraitSpec as their portraits: species and age set the build; hair style
 * and colour, beard, ears, horns, tusks, hood/helmet/circlet, clothing style
 * and colour, plus the gear their class or role suggests.
 */
import type { PortraitSpec } from "@/lib/game/types";
import { normalizeSpecies, portraitTraits } from "@/lib/art/portrait";

export type Gear = "staff" | "sword" | "sword_shield" | "spear" | "bow" | "dagger" | "axe" | "mace" | "hammer" | "book" | "lute" | "lantern" | "cane" | "none";

export interface PersonLook {
	skin: string;
	hair: string;
	eye: string;
	hairStyle: string;
	facialHair: string;
	accessory: string;
	features: string[];
	cloth: string;
	trim: string;
	clothingStyle: "tunic" | "armor" | "robe" | "leather" | "cloak";
	female: boolean;
	/** 0 child … 1 elder. */
	age: number;
	species: string;
	gear: Gear;
}

type Px = (x: number, y: number, c: string) => void;

function hex(c: string): [number, number, number] {
	const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
	if (!m) return [128, 128, 128];
	const n = parseInt(m[1], 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
export function shade(c: string, f: number): string {
	const [r, g, b] = hex(c);
	return f >= 1 ? toHex(r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1)) : toHex(r * f, g * f, b * f);
}
function mix(a: string, b: string, t: number): string {
	const [r1, g1, b1] = hex(a), [r2, g2, b2] = hex(b);
	return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Gear suggested by class ids (PC) or by role/description words (NPC, English or Spanish). */
export function gearFor(opts: { classes?: string[]; text?: string }): Gear {
	const cls = opts.classes ?? [];
	const has = (k: string) => cls.includes(k);
	if (has("wizard") || has("sorcerer") || has("warlock") || has("druid")) return "staff";
	if (has("paladin")) return "sword_shield";
	if (has("fighter")) return "sword";
	if (has("barbarian")) return "axe";
	if (has("ranger")) return "bow";
	if (has("rogue")) return "dagger";
	if (has("cleric")) return "mace";
	if (has("bard")) return "lute";
	if (has("monk")) return "none";
	const t = (opts.text ?? "").toLowerCase();
	const rules: [RegExp, Gear][] = [
		[/\bbows?\b|archer|arco|arquer/, "bow"],
		[/staff|bastón|baston|wizard|\bmag[oa]s?\b|\bmage\b|hechicer|witch|bruja|druid|astr[oó]log|astrolog|seer|vidente|oracle|or[aá]culo/, "staff"],
		[/spear|\blanzas?\b|\bpike\b|\bpica\b/, "spear"],
		[/\baxe|hacha|woodcutter|leñador/, "axe"],
		[/smith|herrer|hammer|martillo|forge|forja/, "hammer"],
		[/scholar|erudit|scribe|escriban|sage|sabio|librar|bibliotec|book|libro|runekeeper|archiv/, "book"],
		[/knight|caballer|paladin|captain|capitán|capitan|thane|jarl|chief|jef[ea]|lord|señor|warrior|guerrer/, "sword"],
		[/guard|guardia|soldier|soldad|watch|vigía|sentinel|centinela/, "spear"],
		[/priest|sacerdot|predicador|cleric|monk|monje|nun|monja|hermana|brother|hermano/, "mace"],
		[/thief|ladr|assassin|asesin|rogue|pícar|spy|espía|dagger|daga|cuchill/, "dagger"],
		[/bard|bardo|minstrel|juglar|lute|laúd/, "lute"],
		[/innkeeper|posader|tabern|lantern|farol|linterna|guide|guía/, "lantern"],
		[/elder|ancian|old man|viejo|vieja|crone/, "cane"],
		[/hunter|cazador|tracker|rastreador/, "bow"],
	];
	for (const [re, g] of rules) if (re.test(t)) return g;
	return "none";
}

export function personLook(spec: PortraitSpec, speciesId: string | undefined, gear: Gear): PersonLook {
	const tr = portraitTraits(spec, speciesId);
	const age = spec.age ?? tr.age ?? 0.3;
	let hair = spec.hairColor;
	if (age >= 0.85) hair = mix(hair, "#e8e8e4", 0.8);
	else if (age >= 0.6) hair = mix(hair, "#c8c8c4", 0.45);
	return {
		skin: spec.skinTone,
		hair,
		eye: spec.eyeColor,
		hairStyle: spec.hairStyle,
		facialHair: spec.facialHair ?? "none",
		accessory: spec.accessory ?? "none",
		features: spec.features ?? [],
		cloth: tr.clothing,
		trim: tr.clothingTrim,
		clothingStyle: tr.clothingStyle,
		female: tr.female,
		age,
		species: normalizeSpecies(speciesId),
		gear,
	};
}

interface Build {
	/** head top row, height, left column, width */
	hy: number; hh: number; hx: number; hw: number;
	/** torso top row, height, left column, width */
	ty: number; th: number; tx: number; tw: number;
	/** legs top row, height; boots row */
	ly: number; lh: number; by: number;
}

function buildFor(l: PersonLook): Build {
	const small = l.species === "halfling" || l.species === "gnome" || l.age <= 0.12;
	if (small) return { hy: 4, hh: 5, hx: 5, hw: 6, ty: 9, th: 3, tx: 5, tw: 6, ly: 12, lh: 2, by: 14 };
	if (l.species === "dwarf") return { hy: 3, hh: 5, hx: 5, hw: 6, ty: 8, th: 4, tx: 4, tw: 8, ly: 12, lh: 2, by: 14 };
	if (l.species === "goliath" || l.species === "orc" || l.species === "half-orc") return { hy: 0, hh: 5, hx: 5, hw: 6, ty: 5, th: 6, tx: 3, tw: 10, ly: 11, lh: 3, by: 14 };
	const narrow = l.female ? 1 : 0;
	return { hy: 1, hh: 5, hx: 5, hw: 6, ty: 6, th: 5, tx: 4 + narrow, tw: 8 - narrow * 2, ly: 11, lh: 3, by: 14 };
}

const STEEL = "#9aa0a8", STEEL_D = "#5d636b", STEEL_L = "#c9ced4";
const WOOD = "#7a5230", WOOD_D = "#4e321a";
const GOLD = "#d8b23a";
const EYE_DARK = "#1a1410";

/** Paints the person into a 16×16 area at (0,0). */
export function paintPerson(px: Px, l: PersonLook) {
	const b = buildFor(l);
	const skinD = shade(l.skin, 0.8);
	const hairD = shade(l.hair, 0.72);
	const cloth = l.cloth, clothD = shade(cloth, 0.68), clothL = shade(cloth, 1.18);
	const feats = new Set(l.features);
	const hx1 = b.hx + b.hw - 1; // right column of head
	const tx1 = b.tx + b.tw - 1;
	const draconic = feats.has("snout") || (feats.has("scales") && l.species === "dragonborn");
	const hooded = l.accessory === "hood";
	const rect = (x: number, y: number, w: number, h: number, c: string) => {
		for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c);
	};

	// shadow
	rect(b.tx, 15, b.tw, 1, "rgba(0,0,0,0.25)");

	// cloak behind everything
	if (l.clothingStyle === "cloak") {
		rect(b.tx - 1, b.ty, 1, b.by - b.ty, clothD);
		rect(tx1 + 1, b.ty, 1, b.by - b.ty, clothD);
	}

	// legs / robe skirt
	const pants = l.clothingStyle === "armor" ? STEEL_D : l.clothingStyle === "leather" ? "#4a3624" : shade(cloth, 0.5);
	if (l.clothingStyle === "robe") {
		rect(b.tx, b.ly, b.tw, b.by - b.ly, cloth);
		rect(b.tx, b.by - 1, b.tw, 1, clothD);
		rect(b.tx + Math.floor(b.tw / 2) - 1, b.ly, 1, b.by - b.ly, clothD);
	} else {
		const lw = Math.max(1, Math.floor((b.tw - 2) / 2));
		rect(b.tx + 1, b.ly, lw, b.lh, pants);
		rect(tx1 - lw, b.ly, lw, b.lh, pants);
	}
	// boots
	const boot = l.clothingStyle === "armor" ? STEEL_D : "#2b1d14";
	const bw = Math.max(2, Math.floor((b.tw - 2) / 2));
	rect(b.tx + (l.clothingStyle === "robe" ? 1 : 0), b.by, bw, 1, boot);
	rect(tx1 - bw + 1 - (l.clothingStyle === "robe" ? 1 : 0), b.by, bw, 1, boot);

	// torso
	if (l.clothingStyle === "armor") {
		rect(b.tx, b.ty, b.tw, b.th, STEEL);
		rect(b.tx, b.ty, b.tw, 1, STEEL_L);
		rect(b.tx + 2, b.ty + 1, b.tw - 4, b.th - 1, cloth); // tabard
		rect(b.tx + 2, b.ty + b.th - 1, b.tw - 4, 1, clothD);
	} else if (l.clothingStyle === "leather") {
		rect(b.tx, b.ty, b.tw, b.th, cloth);
		rect(b.tx + 1, b.ty, b.tw - 2, b.th, "#6b4a2e");
		rect(b.tx + Math.floor(b.tw / 2), b.ty + 1, 1, b.th - 2, "#4a3220");
		rect(b.tx + 1, b.ty, b.tw - 2, 1, "#8a6440"); // fur/collar
	} else {
		rect(b.tx, b.ty, b.tw, b.th, cloth);
		rect(b.tx, b.ty, b.tw, 1, clothL);
		if (l.clothingStyle === "robe") rect(b.tx + Math.floor(b.tw / 2) - 1, b.ty, 1, b.th, clothD);
	}
	// belt / sash
	if (l.clothingStyle !== "armor") {
		const beltY = b.ty + b.th - 1;
		rect(b.tx, beltY, b.tw, 1, l.clothingStyle === "robe" ? l.trim : "#3a2414");
		px(b.tx + Math.floor(b.tw / 2), beltY, l.clothingStyle === "robe" ? shade(l.trim, 0.7) : GOLD);
	}
	if (l.clothingStyle === "cloak") {
		px(b.tx, b.ty, clothD);
		px(tx1, b.ty, clothD);
		px(b.tx + 1, b.ty, GOLD);
	}

	// arms (sleeves + hands)
	const sleeve = l.clothingStyle === "armor" ? STEEL : l.clothingStyle === "cloak" ? clothD : cloth;
	const armH = Math.max(2, b.th - 1);
	rect(b.tx - 1, b.ty + 1, 1, armH, sleeve);
	rect(tx1 + 1, b.ty + 1, 1, armH, sleeve);
	if (l.clothingStyle === "armor") {
		rect(b.tx - 1, b.ty, 2, 1, STEEL_L);
		rect(tx1, b.ty, 2, 1, STEEL_L);
	}
	const handY = b.ty + 1 + armH;
	px(b.tx - 1, handY, l.skin);
	px(tx1 + 1, handY, l.skin);

	// beard falling onto the chest (drawn before the head so the chin overlaps cleanly)
	const fh = l.facialHair;
	const cx = b.hx + Math.floor(b.hw / 2) - 1;
	if (fh === "full_beard") rect(cx - 1, b.ty, 4, 2, l.hair);
	if (fh === "braided_beard") { rect(cx, b.ty, 2, 3, l.hair); px(cx, b.ty + 1, hairD); }
	if (fh === "goatee") rect(cx, b.ty, 2, 1, l.hair);

	// head
	rect(b.hx, b.hy, b.hw, b.hh, l.skin);
	px(b.hx, b.hy, "clear");
	px(hx1, b.hy, "clear");
	rect(b.hx, b.hy + b.hh - 1, 1, 1, skinD);
	rect(hx1, b.hy + b.hh - 1, 1, 1, skinD);
	if (draconic) {
		// muzzle and brow ridge
		rect(b.hx + 1, b.hy + 3, b.hw - 2, 2, shade(l.skin, 0.88));
		px(b.hx + 2, b.hy + 3, shade(l.skin, 0.6));
		px(hx1 - 2, b.hy + 3, shade(l.skin, 0.6));
		rect(b.hx, b.hy, b.hw, 1, shade(l.skin, 0.75));
	}
	if (feats.has("scales")) for (let j = 0; j < b.hh; j++) for (let i = (j % 2); i < b.hw; i += 2) if ((i + j) % 3 === 0) px(b.hx + i, b.hy + j, shade(l.skin, 0.85));
	// eyes
	const ey = b.hy + 2;
	const eyeC = feats.has("solid_eyes") ? l.eye : EYE_DARK;
	px(b.hx + 1, ey, eyeC);
	px(hx1 - 1, ey, eyeC);
	if (l.accessory === "eyepatch") { px(b.hx + 1, ey, "#111"); rect(b.hx, ey - 1, b.hw, 1, "#222"); }
	if (feats.has("freckles")) { px(b.hx + 1, ey + 1, skinD); px(hx1 - 1, ey + 1, skinD); }
	if (feats.has("markings") || l.accessory === "warpaint") { px(b.hx + 1, ey + 1, "#a8322a"); px(hx1 - 1, ey + 1, "#a8322a"); px(b.hx + 1, ey - 1, "#a8322a"); }
	if (l.accessory === "scar") { px(hx1 - 1, ey - 1, "#b85a5a"); px(hx1 - 2, ey + 1, "#b85a5a"); }
	// mouth area
	const my = b.hy + b.hh - 1;
	if (feats.has("tusks")) { px(b.hx + 1, my, "#f2ead6"); px(hx1 - 1, my, "#f2ead6"); }

	// facial hair on the face
	if (fh === "stubble") for (let i = 1; i < b.hw - 1; i++) if (i % 2) px(b.hx + i, my, skinD);
	if (fh === "mustache") rect(cx, my - 1, 2, 1, l.hair);
	if (fh === "goatee") rect(cx, my, 2, 1, l.hair);
	if (fh === "sideburns") { rect(b.hx, b.hy + 1, 1, 3, l.hair); rect(hx1, b.hy + 1, 1, 3, l.hair); }
	if (fh === "short_beard" || fh === "full_beard" || fh === "braided_beard") {
		rect(b.hx, b.hy + 2, 1, b.hh - 2, l.hair);
		rect(hx1, b.hy + 2, 1, b.hh - 2, l.hair);
		rect(b.hx + 1, my, b.hw - 2, 1, l.hair);
		rect(cx, my - 1, 2, 1, hairD);
	}

	// ears
	if (feats.has("pointed_ears") || feats.has("long_ears") || l.species === "elf" || l.species === "half-elf") {
		px(b.hx - 1, ey, l.skin);
		px(hx1 + 1, ey, l.skin);
		if (feats.has("long_ears") || l.species === "elf") { px(b.hx - 1, ey - 1, l.skin); px(hx1 + 1, ey - 1, l.skin); px(b.hx - 2, ey - 2, l.skin); px(hx1 + 2, ey - 2, l.skin); }
	}

	// hair (or hood / helmet)
	const hs = l.hairStyle;
	const top = b.hy;
	if (hooded) {
		rect(b.hx - 1, top - 1, b.hw + 2, 2, clothD);
		rect(b.hx - 1, top + 1, 1, b.hh, clothD);
		rect(hx1 + 1, top + 1, 1, b.hh, clothD);
		rect(b.hx, top + 1, b.hw, 1, shade(l.skin, 0.55));
	} else if (l.accessory === "helmet") {
		rect(b.hx - 1, top - 1, b.hw + 2, 2, STEEL);
		rect(b.hx - 1, top - 1, b.hw + 2, 1, STEEL_L);
		px(b.hx + Math.floor(b.hw / 2), top + 1, STEEL_D);
		if (l.species === "dwarf") { px(b.hx - 2, top - 2, "#efe6cf"); px(hx1 + 2, top - 2, "#efe6cf"); }
	} else if (hs !== "bald") {
		const H = l.hair;
		switch (hs) {
			case "cropped":
				rect(b.hx, top, b.hw, 1, hairD);
				break;
			case "shaved_sides":
				rect(b.hx + 2, top - 1, b.hw - 4, 2, H);
				break;
			case "mohawk":
				rect(b.hx + 2, top - 2, 2, 3, H);
				break;
			case "topknot":
				rect(b.hx, top, b.hw, 1, H);
				rect(b.hx + 2, top - 2, 2, 2, H);
				break;
			case "bun":
				rect(b.hx, top - 1, b.hw, 2, H);
				rect(b.hx + 2, top - 3, 2, 2, hairD);
				break;
			case "wild":
				rect(b.hx - 1, top - 1, b.hw + 2, 2, H);
				for (let i = -1; i <= b.hw; i += 2) px(b.hx + i, top - 2, H);
				rect(b.hx - 1, top + 1, 1, 3, H);
				rect(hx1 + 1, top + 1, 1, 3, H);
				break;
			case "curly":
				rect(b.hx - 1, top - 1, b.hw + 2, 2, H);
				for (let i = 0; i < b.hw + 2; i += 2) px(b.hx - 1 + i, top - 1, hairD);
				rect(b.hx - 1, top + 1, 1, 2, H);
				rect(hx1 + 1, top + 1, 1, 2, H);
				break;
			case "long":
				rect(b.hx - 1, top - 1, b.hw + 2, 2, H);
				rect(b.hx - 1, top + 1, 1, b.hh + 3, H);
				rect(hx1 + 1, top + 1, 1, b.hh + 3, H);
				rect(b.hx - 1, top + b.hh + 1, 1, 2, hairD);
				rect(hx1 + 1, top + b.hh + 1, 1, 2, hairD);
				break;
			case "braids":
				rect(b.hx - 1, top - 1, b.hw + 2, 2, H);
				for (let j = 1; j <= b.hh + 3; j++) {
					px(b.hx - 1, top + j, j % 2 ? H : hairD);
					px(hx1 + 1, top + j, j % 2 ? H : hairD);
				}
				break;
			case "ponytail":
				rect(b.hx, top - 1, b.hw, 2, H);
				rect(hx1 + 1, top, 1, 4, H);
				px(hx1 + 2, top + 3, hairD);
				break;
			case "sidepart":
				rect(b.hx, top - 1, b.hw, 2, H);
				rect(b.hx, top + 1, 2, 1, H);
				px(b.hx + 2, top - 1, hairD);
				rect(hx1, top + 1, 1, 1, H);
				break;
			default: // short
				rect(b.hx, top - 1, b.hw, 2, H);
				px(b.hx, top + 1, H);
				px(hx1, top + 1, H);
		}
	}
	// horns over the hair
	if (feats.has("horns")) { px(b.hx, top - 1, "#3a2a2a"); px(b.hx, top - 2, "#5a4444"); px(hx1, top - 1, "#3a2a2a"); px(hx1, top - 2, "#5a4444"); }
	if (feats.has("ram_horns")) {
		for (const [dx, dy] of [[-1, 0], [-2, 1], [-2, 2], [-1, 3]]) { px(b.hx + dx, top + dy, "#6b5a48"); px(hx1 - dx, top + dy, "#6b5a48"); }
	}
	if (l.accessory === "circlet" || l.accessory === "crown") {
		rect(b.hx, top, b.hw, 1, GOLD);
		if (l.accessory === "crown") for (let i = 0; i < b.hw; i += 2) px(b.hx + i, top - 1, GOLD);
		else px(b.hx + Math.floor(b.hw / 2), top, "#7fd3ff");
	}
	if (l.accessory === "headband") rect(b.hx, top + 1, b.hw, 1, l.trim);
	if (l.accessory === "earrings") { px(b.hx - 1, ey + 1, GOLD); px(hx1 + 1, ey + 1, GOLD); }

	// gear in the right hand (viewer's left) and shield on the other arm
	const gx = b.tx - 2, gy = handY;
	switch (l.gear) {
		case "staff":
			rect(gx, b.hy - 1, 1, 15 - b.hy, WOOD);
			px(gx, b.hy - 2, "#7fd3ff");
			px(gx, b.hy - 1, "#b8ecff");
			break;
		case "cane":
			rect(gx, gy - 2, 1, 15 - gy + 2, WOOD_D);
			px(gx + 1, gy - 2, WOOD_D);
			break;
		case "spear":
			rect(gx, Math.max(0, b.hy - 1), 1, 15 - Math.max(0, b.hy - 1), WOOD);
			px(gx, Math.max(0, b.hy - 2), STEEL_L);
			px(gx, Math.max(0, b.hy - 3), STEEL);
			break;
		case "sword":
		case "sword_shield":
			rect(gx, gy - 5, 1, 5, STEEL_L);
			px(gx - 1, gy, GOLD);
			px(gx + 1, gy, GOLD);
			px(gx, gy + 1, WOOD_D);
			if (l.gear === "sword_shield") { rect(tx1 + 1, b.ty + 1, 2, 4, shade(cloth, 1.1)); px(tx1 + 2, b.ty + 2, GOLD); rect(tx1 + 1, b.ty + 1, 2, 1, STEEL_L); }
			break;
		case "axe":
			rect(gx, gy - 4, 1, 6, WOOD);
			rect(gx - 1, gy - 4, 1, 3, STEEL);
			px(gx - 2, gy - 3, STEEL_L);
			break;
		case "mace":
			rect(gx, gy - 3, 1, 4, WOOD_D);
			rect(gx - 1, gy - 4, 3, 2, STEEL);
			break;
		case "hammer":
			rect(gx, gy - 3, 1, 4, WOOD);
			rect(gx - 1, gy - 4, 3, 2, STEEL_D);
			break;
		case "dagger":
			rect(gx + 1, gy - 2, 1, 2, STEEL_L);
			break;
		case "bow":
			for (const [dx, dy] of [[0, -4], [-1, -3], [-1, -2], [-1, -1], [-1, 0], [-1, 1], [-1, 2], [0, 3]]) px(gx + 1 + dx, gy + dy - 1, WOOD);
			rect(gx + 1, gy - 5, 1, 9, "rgba(230,230,220,0.7)");
			break;
		case "book":
			rect(tx1, handY - 2, 2, 2, "#7a2f2f");
			px(tx1 + 1, handY - 2, "#efe6cf");
			break;
		case "lute":
			rect(b.tx + 1, b.ty + 2, 3, 3, "#a8743e");
			px(b.tx + 2, b.ty + 3, WOOD_D);
			rect(b.tx + 4, b.ty + 1, 3, 1, WOOD_D);
			break;
		case "lantern":
			px(gx, gy, "#2e2e32");
			px(gx, gy + 1, "#ffe9a0");
			px(gx, gy + 2, "#2e2e32");
			break;
	}
}
