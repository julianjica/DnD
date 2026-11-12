import { mix } from "@/lib/art/color";

/**
 * The natural men's cuts (m_*) on the 16px sprite: simplified but each keeps its
 * silhouette (height on top, what covers the forehead, what falls on the sides).
 * Head box is 6×5 at (hx, hy); row hy is the crown, hy+1 the forehead, hy+2 the
 * eyes. Hair above the head goes on rows hy−1 and up.
 */

type SetPx = (x: number, y: number, c: string | null) => void;
type Rect = (x: number, y: number, w: number, h: number, c: string | null) => void;

export function paintNaturalHair(style: string, set: SetPx, rect: Rect, hx: number, hy: number, H: string, HD: string, HL: string, skin: string): boolean {
	const hx1 = hx + 5;
	const fz = (k: number) => mix(H, skin, k); // clipper-short hair over skin
	const crown = () => { rect(hx + 1, hy - 1, 4, 1, H); rect(hx, hy, 6, 1, H); set(hx1, hy, HD); set(hx + 4, hy - 1, HD); };
	const fadeSides = (k = 0.5) => { set(hx, hy, fz(k - 0.15)); set(hx1, hy, mix(HD, skin, k - 0.15)); set(hx, hy + 1, fz(k + 0.1)); set(hx1, hy + 1, mix(HD, skin, k + 0.1)); };
	const sides = (from: number, to: number, out = false) => {
		for (let y = from; y <= to; y++) {
			set(out ? hx - 1 : hx, hy + y, H);
			set(out ? hx1 + 1 : hx1, hy + y, HD);
		}
	};
	switch (style) {
		case "m_buzz":
			for (let i = 1; i <= 4; i++) set(hx + i, hy, i % 2 ? fz(0.42) : fz(0.52));
			set(hx, hy + 1, fz(0.6));
			set(hx1, hy + 1, mix(HD, skin, 0.6));
			return true;
		case "m_crew":
			crown();
			set(hx + 2, hy - 1, HL);
			fadeSides(0.45);
			return true;
		case "m_caesar":
			crown();
			fadeSides(0.45);
			set(hx + 2, hy + 1, HD);
			set(hx + 3, hy + 1, H);
			return true;
		case "m_french_crop":
			crown();
			fadeSides(0.7);
			set(hx + 1, hy + 1, H);
			set(hx + 2, hy + 1, HD);
			set(hx + 4, hy + 1, HD);
			set(hx + 2, hy - 1, HL);
			return true;
		case "m_ivy":
		case "m_side_part":
			crown();
			set(hx + 3, hy - 1, style === "m_side_part" ? fz(0.5) : HL); // the part
			set(hx + 1, hy - 1, HL);
			set(hx, hy + 1, H);
			set(hx1, hy + 1, mix(HD, skin, 0.45));
			return true;
		case "m_short_back_sides":
			crown();
			set(hx + 1, hy - 1, HL);
			set(hx + 1, hy + 1, HD); // the front falls a little over the forehead
			sides(1, 1);
			return true;
		case "m_slick_back":
			crown();
			set(hx + 1, hy - 1, HL);
			set(hx + 2, hy, HL);
			fadeSides(0.4);
			return true;
		case "m_brushed_back":
			crown();
			rect(hx + 2, hy - 2, 2, 1, H);
			set(hx + 2, hy - 2, HL);
			set(hx + 1, hy - 1, HL);
			fadeSides(0.35);
			return true;
		case "m_quiff":
			crown();
			set(hx + 1, hy - 2, H);
			set(hx + 2, hy - 2, HL);
			fadeSides(0.55);
			return true;
		case "m_pompadour":
			crown();
			rect(hx + 1, hy - 2, 4, 1, H);
			set(hx + 2, hy - 3, H);
			set(hx + 3, hy - 3, HD);
			set(hx + 2, hy - 2, HL);
			set(hx + 4, hy - 2, HD);
			fadeSides(0.55);
			return true;
		case "m_undercut":
			rect(hx + 1, hy - 1, 4, 1, H);
			set(hx + 2, hy - 2, H);
			set(hx + 3, hy - 2, HD);
			set(hx + 4, hy - 1, HD);
			set(hx + 2, hy - 1, HL);
			rect(hx + 1, hy, 4, 1, fz(0.55));
			set(hx, hy + 1, fz(0.65));
			set(hx1, hy + 1, mix(HD, skin, 0.65));
			return true;
		case "m_receding":
			crown();
			set(hx + 1, hy, mix(skin, H, 0.2)); // deep temples
			set(hx + 4, hy, mix(skin, H, 0.25));
			set(hx + 1, hy - 1, mix(H, skin, 0.4));
			set(hx + 4, hy - 1, mix(HD, skin, 0.4));
			fadeSides(0.4);
			return true;
		case "m_horseshoe":
			set(hx, hy, H);
			set(hx1, hy, HD);
			set(hx, hy + 1, H);
			set(hx1, hy + 1, HD);
			set(hx + 1, hy, mix(skin, "#ffffff", 0.25)); // shine on the bald top
			return true;
		case "m_mullet":
			crown();
			set(hx + 1, hy + 1, H);
			set(hx + 3, hy + 1, HD);
			fadeSides(0.5);
			rect(hx - 1, hy + 2, 1, 3, HD); // the long back, beside the neck
			rect(hx1 + 1, hy + 2, 1, 3, HD);
			return true;
		case "m_curtains":
			crown();
			set(hx + 2, hy - 1, mix(H, skin, 0.45)); // the middle part
			set(hx + 1, hy + 1, H);
			set(hx + 4, hy + 1, HD);
			sides(1, 2);
			return true;
		case "m_messy_fringe":
			crown();
			set(hx + 1, hy - 2, H);
			set(hx + 4, hy - 2, HD);
			set(hx + 1, hy + 1, H);
			set(hx + 3, hy + 1, HD);
			set(hx + 4, hy + 1, H);
			sides(1, 1);
			return true;
		case "m_bedhead":
			crown();
			set(hx, hy - 1, H);
			set(hx + 2, hy - 2, H);
			set(hx + 4, hy - 2, HD);
			set(hx1, hy - 1, HD);
			set(hx + 2, hy + 1, H);
			sides(1, 1);
			return true;
		case "m_mod":
			crown();
			rect(hx, hy + 1, 6, 1, H);
			set(hx1, hy + 1, HD);
			set(hx + 2, hy + 1, HL);
			set(hx - 1, hy + 1, H);
			set(hx1 + 1, hy + 1, HD);
			sides(2, 2);
			return true;
		case "m_shag":
			crown();
			set(hx + 1, hy + 1, H);
			set(hx + 4, hy + 1, HD);
			sides(1, 2);
			sides(1, 4, true);
			return true;
		case "m_tucked":
			crown();
			set(hx + 1, hy - 1, HL);
			sides(1, 1);
			rect(hx - 1, hy + 2, 1, 3, HD); // behind the ears
			rect(hx1 + 1, hy + 2, 1, 3, HD);
			return true;
		case "m_shoulder":
			crown();
			sides(1, 2);
			sides(1, 5, true);
			return true;
		case "m_long":
			crown();
			sides(1, 3);
			sides(1, 7, true);
			return true;
		case "m_man_bun":
			crown();
			set(hx + 1, hy - 1, HL);
			rect(hx + 2, hy - 2, 2, 1, HD);
			set(hx + 2, hy - 3, H);
			fadeSides(0.3);
			return true;
		case "m_wavy":
			crown();
			set(hx + 1, hy - 1, HL);
			set(hx + 3, hy - 1, HL);
			set(hx + 4, hy + 1, H);
			sides(1, 2);
			set(hx - 1, hy + 1, H);
			return true;
		case "m_curly_top":
			crown();
			for (const i of [1, 2, 3, 4]) set(hx + i, hy - 2, i % 2 ? H : HD);
			set(hx + 1, hy - 1, HL);
			set(hx + 3, hy - 1, HL);
			fadeSides(0.55);
			return true;
		case "m_afro_short":
			crown();
			rect(hx + 1, hy - 2, 4, 1, H);
			set(hx - 1, hy, H);
			set(hx1 + 1, hy, HD);
			set(hx, hy - 1, H);
			set(hx1, hy - 1, HD);
			set(hx + 2, hy - 2, HL);
			return true;
		case "m_afro":
			rect(hx + 1, hy - 3, 4, 1, H);
			rect(hx, hy - 2, 6, 1, H);
			rect(hx - 1, hy - 1, 8, 2, H);
			set(hx - 1, hy + 1, H);
			set(hx1 + 1, hy + 1, HD);
			rect(hx1, hy - 1, 2, 2, HD);
			set(hx1, hy - 2, HD);
			set(hx + 1, hy - 2, HL);
			set(hx + 3, hy - 3, HL);
			set(hx, hy - 1, HL);
			return true;
		case "m_twists":
			crown();
			for (const i of [1, 2, 3, 4]) set(hx + i, hy - 2, i % 2 ? H : HD);
			set(hx + 2, hy - 1, HD);
			fadeSides(0.55);
			return true;
		case "m_locs_short":
			crown();
			for (let j = 0; j <= 3; j++) { set(hx - 1, hy + j, j % 2 ? HD : H); set(hx1 + 1, hy + j, j % 2 ? H : HD); }
			set(hx + 1, hy + 1, H);
			set(hx + 4, hy + 1, HD);
			return true;
		case "m_locs_long":
			crown();
			sides(1, 1);
			for (let j = 0; j <= 6; j++) { set(hx - 1, hy + j, j % 2 ? HD : H); set(hx1 + 1, hy + j, j % 2 ? H : HD); }
			return true;
		case "m_cornrows": {
			const pt = mix(H, skin, 0.55);
			for (let i = 1; i <= 4; i++) { set(hx + i, hy - 1, i % 2 ? H : pt); set(hx + i, hy, i % 2 ? HD : pt); }
			set(hx, hy, H);
			set(hx1, hy, HD);
			return true;
		}
	}
	return false;
}
