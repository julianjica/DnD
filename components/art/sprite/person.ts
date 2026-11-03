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


/**
 * Body layout in a 16×16 tile. The head is 6 wide × 5 tall with rounded top
 * corners and a narrower jaw; hair sits on row hy-1 and above.
 */
interface Build {
	hx: number; hy: number; // head box (6×5)
	ty: number; th: number; tx: number; tw: number; // torso
	ly: number; lh: number; by: number; // legs, boots row
}

function buildFor(l: PersonLook): Build {
	if (l.species === "halfling" || l.species === "gnome" || l.age <= 0.12) return { hx: 5, hy: 4, ty: 9, th: 3, tx: 5, tw: 6, ly: 12, lh: 2, by: 14 };
	if (l.species === "dwarf") return { hx: 5, hy: 3, ty: 8, th: 4, tx: 4, tw: 8, ly: 12, lh: 2, by: 14 };
	if (l.species === "goliath" || l.species === "orc" || l.species === "half-orc") return { hx: 5, hy: 1, ty: 6, th: 5, tx: 3, tw: 10, ly: 11, lh: 3, by: 14 };
	if (l.female) return { hx: 5, hy: 2, ty: 7, th: 4, tx: 5, tw: 6, ly: 11, lh: 3, by: 14 };
	return { hx: 5, hy: 2, ty: 7, th: 4, tx: 4, tw: 8, ly: 11, lh: 3, by: 14 };
}

const STEEL = "#9aa0a8", STEEL_D = "#5d636b", STEEL_L = "#c9ced4";
const WOOD = "#7a5230", WOOD_D = "#4e321a";
const GOLD = "#d8b23a";
const EYE_DARK = "#1f1612";
const OUTLINE = "rgba(26,17,12,0.88)";

/** Paints the person into a 16×16 area at (0,0). */
export function paintPerson(px: Px, l: PersonLook) {
	const g: (string | null)[] = new Array(256).fill(null);
	const set = (x: number, y: number, c: string | null) => {
		if (x >= 0 && y >= 0 && x < 16 && y < 16) g[y * 16 + x] = c;
	};
	const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < 16 && y < 16 ? g[y * 16 + x] : null);
	const rect = (x: number, y: number, w: number, h: number, c: string | null) => {
		for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c);
	};
	const b = buildFor(l);
	const { hx, hy } = b;
	const hx1 = hx + 5, tx1 = b.tx + b.tw - 1;
	const feats = new Set(l.features);
	const skin = l.skin, skinD = shade(skin, 0.84), skinL = shade(skin, 1.08);
	const H = l.hair, HD = shade(H, 0.72), HL = shade(H, 1.15);
	const cloth = l.cloth, clothD = shade(cloth, 0.7), clothL = shade(cloth, 1.2);
	const style = l.clothingStyle;
	const draconic = feats.has("snout") || l.species === "dragonborn";
	const eyeRow = hy + 2, jaw = hy + 4;

	// ── body ────────────────────────────────────────────────────────────
	if (style === "cloak") {
		// cape hanging behind, visible past the shoulders and between the legs
		rect(b.tx - 1, b.ty, b.tw + 2, b.by - b.ty, clothD);
	}
	const pants = style === "armor" ? STEEL_D : style === "leather" ? "#4a3624" : shade(cloth, 0.5);
	const lw = Math.max(2, Math.floor(b.tw / 2) - 1);
	if (style === "robe") {
		rect(b.tx, b.ly, b.tw, b.by - b.ly, cloth);
		rect(tx1, b.ly, 1, b.by - b.ly, clothD);
		rect(b.tx, b.by - 1, b.tw, 1, clothD);
	} else {
		rect(b.tx + 1, b.ly, lw, b.lh, pants);
		rect(tx1 - lw, b.ly, lw, b.lh, shade(pants, 0.85));
	}
	const boot = style === "armor" ? STEEL_D : "#2b1d14";
	rect(b.tx + (style === "robe" ? 1 : 0), b.by, lw + 1, 1, boot);
	rect(tx1 - lw - (style === "robe" ? 1 : 0), b.by, lw + 1, 1, boot);
	if (style !== "robe") set(b.tx + lw, b.by, null);

	// torso
	if (style === "armor") {
		rect(b.tx, b.ty, b.tw, b.th, STEEL);
		rect(b.tx, b.ty, b.tw, 1, STEEL_L);
		rect(b.tx + 2, b.ty + 1, b.tw - 4, b.th - 1, cloth);
		set(b.tx + Math.floor(b.tw / 2), b.ty + 2, clothL);
	} else if (style === "leather") {
		rect(b.tx, b.ty, b.tw, b.th, "#6b4a2e");
		rect(b.tx + Math.floor(b.tw / 2) - 1, b.ty, 2, b.th, cloth); // shirt showing at the opening
		rect(b.tx, b.ty, b.tw, 1, "#a07a52"); // fur collar
	} else {
		rect(b.tx, b.ty, b.tw, b.th, cloth);
		rect(b.tx + 1, b.ty, b.tw - 2, 1, clothL);
		if (style === "robe") rect(b.tx + Math.floor(b.tw / 2), b.ty + 1, 1, b.th - 1, l.trim);
	}
	// shading: light from the upper left
	for (let y = b.ty; y < b.ty + b.th; y++) {
		const r = get(tx1, y);
		if (r) set(tx1, y, shade(r.startsWith("#") ? r : cloth, 0.8));
	}
	if (style !== "armor" && style !== "robe") {
		rect(b.tx, b.ty + b.th - 1, b.tw, 1, "#3a2414");
		set(b.tx + Math.floor(b.tw / 2), b.ty + b.th - 1, GOLD);
	}
	if (style === "cloak") set(b.tx + 1, b.ty, GOLD);

	// arms and hands
	const sleeve = style === "armor" ? STEEL_D : style === "leather" ? "#5a3e26" : style === "cloak" ? clothD : shade(cloth, 0.85);
	const armLen = Math.max(2, b.th - 1);
	rect(b.tx - 1, b.ty + 1, 1, armLen, sleeve);
	rect(tx1 + 1, b.ty + 1, 1, armLen, shade(sleeve, 0.85));
	if (style === "armor") { set(b.tx - 1, b.ty, STEEL_L); set(tx1 + 1, b.ty, STEEL); }
	const handY = b.ty + 1 + armLen;
	set(b.tx - 1, handY, skin);
	set(tx1 + 1, handY, skinD);

	// ── head ────────────────────────────────────────────────────────────
	set(hx + 2, hy + 5, skinD); // neck
	set(hx + 3, hy + 5, skinD);
	rect(hx + 1, hy, 4, 1, skin); // rounded crown
	rect(hx, hy + 1, 6, 3, skin);
	rect(hx + 1, jaw, 4, 1, skin); // narrower jaw
	set(hx1, hy + 1, skinD);
	set(hx1, hy + 2, skinD);
	set(hx1, hy + 3, skinD);
	set(hx + 4, jaw, skinD);
	set(hx + 1, hy + 1, skinL);
	if (draconic) {
		rect(hx, jaw, 6, 1, shade(skin, 0.9));
		set(hx + 2, hy + 3, shade(skin, 0.6));
		set(hx + 3, hy + 3, shade(skin, 0.6));
	}
	if (feats.has("scales")) for (const [x, y] of [[1, 1], [4, 1], [0, 3], [5, 3], [2, 4]]) set(hx + x, hy + y, shade(skin, 0.82));
	// eyes and brow
	const eyeC = feats.has("solid_eyes") ? l.eye : EYE_DARK;
	set(hx + 1, eyeRow, eyeC);
	set(hx + 4, eyeRow, eyeC);
	if (l.age >= 0.6) { set(hx + 1, eyeRow - 1, shade(skin, 0.9)); set(hx + 4, eyeRow - 1, shade(skin, 0.9)); }
	// mouth hint
	if (!draconic) set(hx + 2, jaw, shade(skin, 0.86));
	if (feats.has("freckles")) { set(hx, eyeRow + 1, shade(skin, 0.88)); set(hx1, eyeRow + 1, shade(skin, 0.78)); }
	if (feats.has("markings") || l.accessory === "warpaint") { set(hx, eyeRow + 1, "#9a2e26"); set(hx + 1, eyeRow + 1, "#b83a30"); set(hx + 4, eyeRow + 1, "#b83a30"); set(hx1, eyeRow + 1, "#9a2e26"); }
	if (l.accessory === "scar") { set(hx + 4, eyeRow - 1, shade(skin, 0.68)); set(hx + 5, eyeRow + 1, shade(skin, 0.68)); }
	if (feats.has("tusks")) { set(hx + 1, jaw, "#f2ead6"); set(hx + 4, jaw, "#f2ead6"); }

	// ears
	const elfish = feats.has("pointed_ears") || feats.has("long_ears") || l.species === "elf" || l.species === "half-elf";
	if (elfish) {
		set(hx - 1, eyeRow, skin);
		set(hx1 + 1, eyeRow, skinD);
		if (feats.has("long_ears") || l.species === "elf") { set(hx - 2, eyeRow - 1, skin); set(hx1 + 2, eyeRow - 1, skinD); }
	}

	// facial hair
	const fh = l.facialHair;
	const stubble = mix(skin, H, 0.35);
	if (fh === "stubble") { rect(hx + 1, jaw, 4, 1, stubble); set(hx, hy + 3, stubble); set(hx1, hy + 3, stubble); }
	if (fh === "sideburns") { rect(hx, hy + 1, 1, 3, H); rect(hx1, hy + 1, 1, 3, HD); }
	if (fh === "mustache") { set(hx + 2, hy + 3, H); set(hx + 3, hy + 3, HD); }
	if (fh === "goatee") { set(hx + 2, jaw, H); set(hx + 3, jaw, HD); set(hx + 2, jaw + 1, HD); }
	if (fh === "short_beard" || fh === "full_beard" || fh === "braided_beard") {
		set(hx, hy + 3, H);
		set(hx1, hy + 3, HD);
		rect(hx + 1, jaw, 4, 1, H);
		set(hx + 4, jaw, HD);
		set(hx + 2, hy + 3, HD); // moustache
		set(hx + 3, hy + 3, HD);
		if (fh === "full_beard") { rect(hx + 1, jaw + 1, 4, 1, H); rect(hx + 2, jaw + 2, 2, 1, HD); }
		if (fh === "braided_beard") { set(hx + 2, jaw + 1, H); set(hx + 3, jaw + 1, HD); set(hx + 2, jaw + 2, HD); set(hx + 3, jaw + 3, l.trim); }
	}

	// ── hair / headwear ─────────────────────────────────────────────────
	const hs = l.hairStyle;
	if (l.accessory === "hood") {
		rect(hx, hy - 1, 6, 1, clothD);
		rect(hx - 1, hy, 8, 1, clothD);
		rect(hx - 1, hy + 1, 1, 5, clothD);
		rect(hx1 + 1, hy + 1, 1, 5, shade(clothD, 0.85));
		rect(hx, hy + 1, 6, 1, shade(skin, 0.6)); // shadow under the hood
		set(hx, hy + 2, shade(skin, 0.75));
		set(hx1, hy + 2, shade(skin, 0.7));
	} else if (l.accessory === "helmet") {
		rect(hx + 1, hy - 1, 4, 1, STEEL_L);
		rect(hx, hy, 6, 2, STEEL);
		set(hx1, hy, STEEL_D);
		set(hx1, hy + 1, STEEL_D);
		set(hx + 2, hy + 2, STEEL_D); // nose guard
		if (l.species === "dwarf") { set(hx - 1, hy - 1, "#efe6cf"); set(hx1 + 1, hy - 1, "#efe6cf"); }
	} else if (hs !== "bald") {
		const crown = () => { rect(hx + 1, hy - 1, 4, 1, H); rect(hx, hy, 6, 1, H); set(hx1, hy, HD); set(hx + 4, hy - 1, HD); };
		switch (hs) {
			case "cropped":
				rect(hx + 1, hy, 4, 1, mix(H, skin, 0.35));
				break;
			case "shaved_sides":
				rect(hx + 2, hy - 1, 2, 2, H);
				set(hx + 3, hy - 1, HD);
				break;
			case "mohawk":
				rect(hx + 2, hy - 2, 2, 3, H);
				set(hx + 3, hy - 2, HD);
				break;
			case "topknot":
				crown();
				rect(hx + 2, hy - 2, 2, 1, HD);
				break;
			case "bun":
				crown();
				rect(hx + 2, hy - 2, 2, 1, HD);
				set(hx + 1, hy - 2, null);
				break;
			case "wild":
				crown();
				for (const x of [0, 2, 4, 5]) set(hx + x, hy - 2 + (x % 2), H);
				set(hx - 1, hy, H);
				set(hx - 1, hy + 1, H);
				set(hx1 + 1, hy, HD);
				set(hx1 + 1, hy + 1, HD);
				set(hx, hy + 1, H);
				break;
			case "curly":
				crown();
				set(hx - 1, hy, H);
				set(hx1 + 1, hy, HD);
				set(hx, hy + 1, H);
				set(hx1, hy + 1, HD);
				set(hx + 1, hy - 1, HL);
				set(hx + 3, hy - 1, HL);
				break;
			case "long":
				crown();
				rect(hx, hy + 1, 1, 4, H);
				rect(hx1, hy + 1, 1, 4, HD);
				set(hx - 1, hy + 2, H);
				set(hx1 + 1, hy + 2, HD);
				rect(hx - 1, hy + 3, 1, 3, H); // falls over the shoulders
				rect(hx1 + 1, hy + 3, 1, 3, HD);
				break;
			case "braids":
				crown();
				set(hx, hy + 1, H);
				set(hx1, hy + 1, HD);
				for (let j = 2; j <= 6; j++) { set(hx - 1, hy + j, j % 2 ? HD : H); set(hx1 + 1, hy + j, j % 2 ? H : HD); }
				break;
			case "ponytail":
				crown();
				set(hx1, hy + 1, HD);
				rect(hx1 + 1, hy, 1, 3, H);
				set(hx1 + 1, hy + 3, HD);
				break;
			case "sidepart":
				crown();
				rect(hx, hy + 1, 2, 1, H);
				set(hx1, hy + 1, HD);
				set(hx + 2, hy - 1, HL);
				break;
			default: // short
				crown();
				set(hx, hy + 1, H);
				set(hx1, hy + 1, HD);
		}
	} else {
		set(hx + 1, hy, skinL); // shine on a bald head
	}
	if (feats.has("horns")) { set(hx, hy - 1, "#4a3434"); set(hx - 1, hy - 2, "#6a5050"); set(hx1, hy - 1, "#3a2828"); set(hx1 + 1, hy - 2, "#5a4242"); }
	if (feats.has("ram_horns")) for (const [dx, dy] of [[-1, 0], [-1, 1], [0, 2]]) { set(hx + dx, hy + dy, "#7a6a58"); set(hx1 - dx, hy + dy, "#5e5040"); }
	if (l.accessory === "circlet" || l.accessory === "crown") {
		rect(hx, hy, 6, 1, GOLD);
		if (l.accessory === "crown") { set(hx, hy - 1, GOLD); set(hx + 2, hy - 1, GOLD); set(hx + 3, hy - 1, GOLD); set(hx1, hy - 1, GOLD); }
		else set(hx + 2, hy, "#7fd3ff");
	}
	if (l.accessory === "headband") rect(hx, hy + 1, 6, 1, l.trim);
	if (l.accessory === "earrings") { set(hx - 1, eyeRow + 1, GOLD); set(hx1 + 1, eyeRow + 1, GOLD); }
	if (l.accessory === "eyepatch") { set(hx + 4, eyeRow, "#111111"); rect(hx, eyeRow - 1, 6, 1, "#2a2a2a"); set(hx + 1, eyeRow - 1, skin); }

	// ── gear ────────────────────────────────────────────────────────────
	const gx = b.tx - 2, gy = handY;
	switch (l.gear) {
		case "staff":
			rect(gx, hy - 1, 1, 15 - hy + 1, WOOD);
			set(gx, hy - 2, "#9fe6ff");
			break;
		case "cane":
			rect(gx, gy - 1, 1, 15 - gy + 1, WOOD_D);
			set(gx + 1, gy - 1, WOOD_D);
			break;
		case "spear":
			rect(gx, Math.max(1, hy - 1), 1, 15 - Math.max(1, hy - 1), WOOD);
			set(gx, Math.max(0, hy - 2), STEEL_L);
			break;
		case "sword":
		case "sword_shield":
			rect(gx, gy - 4, 1, 4, STEEL_L);
			set(gx, gy, GOLD);
			if (l.gear === "sword_shield") { rect(tx1 + 1, b.ty + 1, 2, 3, shade(cloth, 1.15)); set(tx1 + 2, b.ty + 2, GOLD); set(tx1 + 2, b.ty + 4, shade(cloth, 0.9)); }
			break;
		case "axe":
			rect(gx, gy - 3, 1, 5, WOOD);
			rect(gx - 1, gy - 3, 1, 2, STEEL);
			break;
		case "mace":
			rect(gx, gy - 2, 1, 3, WOOD_D);
			rect(gx - 1, gy - 3, 3, 1, STEEL);
			set(gx, gy - 4, STEEL_L);
			break;
		case "hammer":
			rect(gx, gy - 2, 1, 3, WOOD);
			rect(gx - 1, gy - 3, 3, 1, STEEL_D);
			break;
		case "dagger":
			rect(gx + 1, gy + 1, 1, 1, STEEL_L);
			break;
		case "bow":
			for (const [dx, dy] of [[0, -5], [-1, -4], [-1, -3], [-1, -2], [-1, -1], [-1, 0], [0, 1]]) set(gx + 1 + dx, gy + dy, WOOD);
			rect(gx + 1, gy - 4, 1, 4, "#d8d2c0");
			break;
		case "book":
			rect(tx1, handY - 1, 2, 2, "#7a2f2f");
			set(tx1 + 1, handY - 1, "#efe6cf");
			break;
		case "lute":
			rect(b.tx + 1, b.ty + 1, 2, 2, "#b07a42");
			set(b.tx + 3, b.ty, WOOD_D);
			set(b.tx + 4, b.ty - 1, WOOD_D);
			break;
		case "lantern":
			set(gx + 1, gy + 1, "#2e2e32");
			set(gx + 1, gy + 2, "#ffe9a0");
			break;
	}

	// ── outline and shadow ──────────────────────────────────────────────
	const solid = g.map((c) => c !== null);
	for (let y = 0; y < 16; y++)
		for (let x = 0; x < 16; x++) {
			if (solid[y * 16 + x]) continue;
			const n = (dx: number, dy: number) => {
				const X = x + dx, Y = y + dy;
				return X >= 0 && Y >= 0 && X < 16 && Y < 16 && solid[Y * 16 + X];
			};
			if (n(1, 0) || n(-1, 0) || n(0, 1) || n(0, -1)) g[y * 16 + x] = OUTLINE;
		}
	for (let x = b.tx; x <= tx1; x++) if (!solid[15 * 16 + x]) g[15 * 16 + x] = "rgba(0,0,0,0.28)";
	for (let i = 0; i < 256; i++) {
		const c = g[i];
		if (c) px(i % 16, Math.floor(i / 16), c);
	}
}
