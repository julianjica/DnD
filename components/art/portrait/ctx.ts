import type { PortraitSpec } from "@/lib/game/types";
import type { PortraitTraits } from "@/lib/art/portrait";
import type { Palette, Rig } from "./rig";

/** Everything a portrait part needs to draw itself. */
export interface Ctx {
	spec: PortraitSpec;
	t: PortraitTraits;
	rig: Rig;
	pal: Palette;
	f: Set<string>;
	/** Scoped SVG id / url(#id) helpers (several portraits share a page). */
	id: (s: string) => string;
	url: (s: string) => string;
	/** 0 tiny (≤64px) · 1 medium · 2 full detail. */
	detail: 0 | 1 | 2;
	acc: string;
	/** The headwear actually shown (accessory headwear wins over a hat signature). */
	headwear: "none" | "hood" | "helmet" | "circlet" | "crown" | "headband" | "wizard_hat" | "feathered_hat";
}

export const r = (n: number) => Math.round(n * 10) / 10;
