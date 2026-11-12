import type { NatCtx, NatLayers } from "./hairNatural";
import { makeKit, type Cut } from "./hairNaturalKit";
import { SHORT_CUTS } from "./hairNaturalShort";
import { FLOW_CUTS } from "./hairNaturalFlow";
import { COIL_CUTS } from "./hairNaturalCoils";

/**
 * The everyday men's cuts (ids m_*), drawn with the natural-hair technique in
 * hairNatural.tsx. Each cut is a short description: its hairline, how far the
 * hair stands off the skull, how the sides are cut, and the guide curves its
 * locks grow along. Unknown styles return null (the portrait's own styles).
 */
const CUTS: Record<string, Cut> = { ...SHORT_CUTS, ...FLOW_CUTS, ...COIL_CUTS };

export function naturalCut(style: string, c: NatCtx): NatLayers | null {
	const cut = CUTS[style];
	return cut ? cut(makeKit(style, c)) : null;
}

export const NATURAL_CUT_IDS = Object.keys(CUTS);
