/**
 * Path of the Spirit Beast (homebrew barbarian): the beast chosen at 3rd level.
 * The Quiet shows them as Wildland Crew roles (Ram, Siren, Anchor, Hook) through
 * the label overlay. Kept apart from leveling.ts so the client can import it.
 */
import barbarian from "../../srd/data/homebrew/barbarian.json";

export const SPIRIT_BEAST = "hb-path-of-the-spirit-beast";
export const SPIRIT_ASPECT_FEATURE = `${SPIRIT_BEAST}-spirit-aspect`;
/** The four spirit beasts: Stag, Raven, Tortoise, Serpent (EN text; translated by the SRD/ruleset dictionaries). */
export const SPIRIT_ASPECTS: { id: string; name: string; description: string }[] = barbarian.spiritAspects;
