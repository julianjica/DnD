import type { PortraitSpec } from "@/lib/game/types";
import { normalizeSpecies, type PortraitTraits } from "@/lib/art/portrait";
import { mix, shade, luminance } from "@/lib/art/color";
import { ArtRng, mirrorLoop, smoothPath } from "@/lib/art/rand";

/**
 * Landmarks of the painted bust, computed once from the traits. Every part
 * draws against this rig, so species/build/age/expression are rig tweaks
 * rather than special cases scattered through the drawing code.
 * View box 200×240, key light from the upper left.
 */
export const CX = 100;
export type P = [number, number];

export interface Rig {
	sp: string;
	draconic: boolean;
	child: boolean;
	top: number;
	H: number;
	hairline: number;
	browY: number;
	eyeY: number;
	noseBottom: number;
	mouthY: number;
	chin: number;
	/** Cheek half-width. */
	w: number;
	jaw: number;
	jawY: number;
	chinW: number;
	headPts: P[];
	headD: string;
	eyeSpacing: number;
	ew: number;
	/** Upper lid arc height / lower lid depth. */
	up: number;
	lo: number;
	eyeTilt: number;
	noseW: number;
	mw: number;
	neckW: number;
	neckTop: number;
	collarY: number;
	shW: number;
	shY: number;
	/** Pivot for the head tilt. */
	pivot: P;
	tilt: number;
}

export interface Palette {
	skin: string;
	skinLight: string;
	skinShadow: string;
	skinDeep: string;
	skinLine: string;
	blush: string;
	lip: string;
	hair: string;
	hairLight: string;
	hairDark: string;
	hairSheen: string;
	brow: string;
	cloth: string;
	clothLight: string;
	clothDark: string;
	trim: string;
	accent: string;
	accentLight: string;
	bgA: string;
	bgB: string;
	eye: string;
}

export function buildRig(spec: PortraitSpec, t: PortraitTraits, speciesId?: string): Rig {
	const sp = normalizeSpecies(speciesId);
	const f = new Set(spec.features);
	const draconic = t.head === "draconic";
	const child = t.age < 0.05;
	const elf = sp === "elf" || sp === "half-elf";
	const top = 40;
	let w = t.width * 1.22 - (elf ? 2 : 0);
	let jaw = Math.min(t.jaw * 1.22, w - 3);
	let chin = Math.max(148, Math.min(166, 40 + (t.chin - 56) * 1.25));
	if (child) { chin -= 6; w += 1; jaw = Math.min(jaw, w - 8); }
	if (t.build === "heavy") { jaw = Math.min(w + 1, jaw + 4); w += 1.5; }
	if (t.build === "slim") jaw -= 1.5;
	if (elf) { jaw = Math.min(jaw, w - 10); chin += 2; }
	if (t.female && !child) jaw = Math.min(jaw * 0.9, w - 7);
	if (t.age > 0.7) jaw = Math.min(w, jaw + (t.age - 0.7) * 10);
	const H = chin - top;
	const eyeY = top + H * (child ? 0.57 : 0.53);
	const browY = eyeY - (child ? 8 : 8.5) - t.browRidge * 0.6 + (t.female ? -1 : 0);
	const hairline = top + H * 0.2;
	const noseBottom = top + H * (child ? 0.73 : 0.745);
	const mouthY = noseBottom + (chin - noseBottom) * 0.36;
	const jawY = mouthY + 4 + (t.head === "square" || t.head === "long" ? 3 : 0);
	const chinW = jaw * 0.44 + (t.female ? -1 : 1.5);
	const cb = t.cheekbones * 2.2;

	const headPts: P[] = draconic
		? mirrorLoop([
				[CX, top - 4], [CX + w * 0.72, top + 2], [CX + w + 3, top + 26], [CX + w + 4, eyeY + 4], [CX + w * 0.72, eyeY + 22],
				[CX + 22, noseBottom + 4], [CX + 19, chin + 2], [CX + 10, chin + 10], [CX, chin + 11],
			], CX)
		: mirrorLoop([
				[CX, top], [CX + w * 0.8, top + 4], [CX + w, top + H * 0.2], [CX + w + 0.5, browY - 2], [CX + w + cb * 0.5, eyeY + 7],
				[CX + w - 1.5 + cb * 0.3 - (w - jaw) * 0.25, noseBottom - 3], [CX + jaw, jawY], [CX + chinW + (jaw - chinW) * 0.3, chin - 5], [CX + chinW, chin - 1.2], [CX, chin],
			], CX);

	const eyeSpacing = draconic ? w * 0.52 : w * 0.4 + (t.eyeSpacing - 15.5) * 0.6;
	const ew = (draconic ? 8 : w * 0.2) * t.eyeSize * (child ? 1.12 : 1) * (t.female ? 1.04 : 1);
	const shape = { almond: [4.6, 3.0], round: [5.6, 3.6], narrow: [3.6, 2.4], hooded: [4.0, 2.8] }[t.eye] ?? [4.6, 3];
	let up = shape[0] * (ew / 8.3);
	let lo = shape[1] * (ew / 8.3);
	const e = t.expression;
	if (e === "angry") { up *= 0.72; lo *= 0.9; }
	else if (e === "stern") up *= 0.84;
	else if (e === "worried") up *= 1.14;
	else if (e === "smile") { lo *= 0.75; up *= 0.94; }
	else if (e === "sad") up *= 0.92;
	if (t.age > 0.6) up *= 1 - (t.age - 0.6) * 0.3;

	const noseScale = { straight: 1, broad: 1.22, hooked: 1.05, button: 0.86, long: 1, snub: 0.9, aquiline: 1, flat: 1.3 }[t.noseForm] ?? 1;
	const noseW = w * 0.17 * noseScale * (t.female ? 0.9 : 1) * (sp === "orc" || sp === "half-orc" ? 1.18 : 1) * (sp === "dwarf" ? 1.12 : 1);
	const mwBase = t.mouthWidth * 1.08 * (e === "smile" ? 1.08 : e === "worried" ? 0.94 : 1) * (t.female ? 0.96 : 1);
	const mw = draconic ? 26 : mwBase;

	const buildK = { slim: 0.9, average: 1, broad: 1.14, heavy: 1.2 }[t.build];
	const neckW = (draconic ? w * 0.62 : w * (t.female ? 0.5 : 0.57)) * buildK * (child ? 0.85 : 1) * (sp === "dwarf" || sp === "goliath" || sp === "orc" ? 1.08 : 1);
	const shW = ({ slim: 84, average: 94, broad: 104, heavy: 108 }[t.build]) * (t.female ? 0.92 : 1) * (child ? 0.82 : 1) * (sp === "halfling" || sp === "gnome" ? 0.94 : 1);
	const neckTop = chin - 14;
	const collarY = Math.min(204, chin + (t.build === "slim" ? 28 : 24));
	const shY = Math.min(214, chin + 34 + (t.build === "slim" ? 4 : 0) - (t.build === "broad" || t.build === "heavy" ? 4 : 0));

	return {
		sp, draconic, child, top, H, hairline, browY, eyeY, noseBottom, mouthY, chin, w, jaw, jawY, chinW,
		headPts, headD: smoothPath(headPts),
		eyeSpacing, ew, up, lo,
		eyeTilt: t.eyeTilt * 0.8 + (f.has("pointed_ears") && elf ? 1.5 : 0),
		noseW, mw, neckW, neckTop, collarY, shW, shY,
		pivot: [CX, chin + 12],
		tilt: t.tilt,
	};
}

export function buildPalette(spec: PortraitSpec, t: PortraitTraits, bg: [string, string]): Palette {
	const skin = spec.skinTone || "#e0ac83";
	const dark = luminance(skin) < 0.35;
	// salt and pepper with age
	const grey = Math.max(0, Math.min(0.55, (t.age - 0.68) * 1.8));
	const hair = mix(spec.hairColor || "#3a2a1e", "#a8a6a2", grey);
	const hairLum = luminance(hair);
	const lipBase = t.female ? 0.36 : 0.2;
	const accent = t.accent;
	return {
		skin,
		skinLight: dark ? mix(skin, "#f0c098", 0.32) : mix(skin, "#fff2de", 0.3),
		skinShadow: dark ? mix(shade(skin, -0.07), "#3a1a28", 0.12) : mix(shade(skin, -0.16), "#4a1a2a", 0.16),
		skinDeep: dark ? mix(shade(skin, -0.14), "#1a0a14", 0.2) : mix(shade(skin, -0.32), "#2a0e18", 0.22),
		skinLine: mix(shade(skin, -0.42), "#1a0a10", 0.25),
		blush: dark ? "#b0404a" : "#d8505a",
		lip: mix(skin, dark ? "#6a2a32" : "#a8434c", lipBase * (1 - t.age * 0.3)),
		hair,
		hairLight: mix(hair, hairLum < 0.15 ? "#8a8070" : "#fff0d0", hairLum < 0.15 ? 0.32 : 0.34),
		hairDark: mix(shade(hair, -0.14), "#0a0608", 0.35),
		hairSheen: mix(hair, hairLum < 0.15 ? "#b0c0d0" : "#fff8e8", hairLum < 0.15 ? 0.32 : 0.5),
		brow: mix(shade(hair, hairLum > 0.6 ? -0.28 : -0.14), "#1a1010", hairLum > 0.4 ? 0.2 : 0.3),
		cloth: t.clothing,
		clothLight: mix(t.clothing, "#f0e0c0", 0.18),
		clothDark: mix(shade(t.clothing, -0.14), "#05050a", 0.35),
		trim: mix(t.clothingTrim, accent, 0.35),
		accent,
		accentLight: mix(accent, "#fff6e0", 0.45),
		bgA: bg[0],
		bgB: bg[1],
		eye: spec.eyeColor || "#4a2e1a",
	};
}

/** Deterministic sub-rng for one subsystem (tweaking one does not reshuffle another). */
export function subRng(spec: PortraitSpec, salt: string): ArtRng {
	return new ArtRng(spec.seed >>> 0).fork(salt);
}
