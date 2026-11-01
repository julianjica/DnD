import type { Abilities, Ability, CampaignSettings, EngineConfig, PortraitSpec } from "@/lib/game/types";
import { ABILITIES } from "@/lib/game/types";
import type { NewGameInput } from "@/lib/dm/newgame";
import { assignByPriority, creationOptions, STANDARD_ARRAY, type AbilityInput, type Choices, type CreateCharacterInput, type CreationOptions } from "@/lib/rules/character";
import { getClass } from "@/lib/srd";

/** localStorage keys shared by the wizard and the settings page. */
export const DRAFT_KEY = "dh:wizard-draft:v1";
export const DEFAULT_ENGINE_KEY = "dh:default-engine:v1";

export type AbilityMethod = "standard_array" | "point_buy" | "roll";

export interface CharacterDraft {
	name: string;
	speciesId: string;
	subspeciesId?: string;
	classId: string;
	subclassId?: string;
	backgroundId: string;
	abilityMethod: AbilityMethod;
	/** Standard-array assignment (always a permutation of the array). */
	standard: Abilities;
	pointBuy: Abilities;
	/** The six 4d6-drop-lowest results, once rolled. */
	rolled: number[] | null;
	/** Assignment of the rolled values (a permutation of `rolled`). */
	rolledScores: Abilities | null;
	/** Choice id → picks (partial picks are allowed; the DM fills the rest). */
	choices: Choices;
	/** One entry per CreationOptions.equipment item. */
	equipment: { option: number; picks: string[] }[];
	alignment: string;
	personality: { traits: string; ideals: string; bonds: string; flaws: string; backstory: string; appearance: string };
	portrait: PortraitSpec | null;
}

export interface WizardDraft {
	version: 1;
	step: number;
	title: string;
	settings: CampaignSettings;
	character: CharacterDraft;
}

export const DEFAULT_ENGINE: EngineConfig = { provider: "claude-code", model: "claude-opus-5-5", effort: "medium" };

export function defaultSettings(engine: EngineConfig = DEFAULT_ENGINE): CampaignSettings {
	return {
		world: { preset: "classic_high_fantasy", tone: ["heroic", "mysterious"], lines: [], veils: [] },
		structure: { format: "short_campaign", startingLevel: 1, difficulty: "normal", leveling: "milestone" },
		dm: { verbosity: "balanced", rulesStrictness: "standard", combatFrequency: "medium", autoRollPlayer: false },
		engine,
		audio: { enabled: true, musicVolume: 0.5, sfxVolume: 0.7 },
	};
}

const pbDefault = (): Abilities => ({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });

export function defaultCharacter(): CharacterDraft {
	return {
		name: "",
		speciesId: "human",
		classId: "fighter",
		backgroundId: "soldier",
		abilityMethod: "standard_array",
		standard: assignByPriority(STANDARD_ARRAY, "fighter"),
		pointBuy: pbDefault(),
		rolled: null,
		rolledScores: null,
		choices: {},
		equipment: [],
		alignment: "",
		personality: { traits: "", ideals: "", bonds: "", flaws: "", backstory: "", appearance: "" },
		portrait: null,
	};
}

export function defaultDraft(engine?: EngineConfig): WizardDraft {
	return { version: 1, step: 0, title: "", settings: defaultSettings(engine), character: defaultCharacter() };
}

// ─── persistence ───────────────────────────────────────────────────────────

export function loadJson<T>(key: string): T | null {
	try {
		const raw = window.localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}
export function saveJson(key: string, value: unknown): void {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// storage full/blocked: the draft just won't survive a refresh
	}
}
export function removeKey(key: string): void {
	try {
		window.localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

/** Loads the saved draft, merged over defaults so older/partial drafts stay valid. */
export function loadDraft(): WizardDraft {
	const engine = loadJson<EngineConfig>(DEFAULT_ENGINE_KEY) ?? undefined;
	const base = defaultDraft(engine);
	const saved = loadJson<Partial<WizardDraft>>(DRAFT_KEY);
	if (!saved || saved.version !== 1) return base;
	const s = saved.settings;
	return {
		...base,
		...saved,
		version: 1,
		settings: s
			? {
					world: { ...base.settings.world, ...s.world },
					structure: { ...base.settings.structure, ...s.structure },
					dm: { ...base.settings.dm, ...s.dm },
					engine: { ...base.settings.engine, ...s.engine },
					audio: { ...base.settings.audio, ...s.audio },
					...(s.language ? { language: s.language } : {}),
				}
			: base.settings,
		character: { ...base.character, ...saved.character, personality: { ...base.character.personality, ...saved.character?.personality } },
	};
}

// ─── character helpers ─────────────────────────────────────────────────────

/** CreationOptions for the draft (pure, runs client-side), or an error message. */
export function optionsFor(c: CharacterDraft): { opts?: CreationOptions; error?: string } {
	try {
		return { opts: creationOptions(c.classId, c.speciesId, c.backgroundId, c.subspeciesId) };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

/** The base ability input for the chosen method (null if rolling hasn't happened). */
export function abilityInput(c: CharacterDraft): AbilityInput | null {
	switch (c.abilityMethod) {
		case "standard_array":
			return { method: "standard_array", scores: c.standard };
		case "point_buy":
			return { method: "point_buy", scores: c.pointBuy };
		case "roll":
			return c.rolled && c.rolledScores ? { method: "roll", scores: c.rolledScores, rolled: c.rolled } : null;
	}
}

/** Only choices with exactly the required count are sent; the rest are auto-picked by the rules. */
export function completeChoices(c: CharacterDraft, opts: CreationOptions | undefined): Choices {
	if (!opts) return {};
	const out: Choices = {};
	const speciesCantrips = speciesCantripPicks(c, opts);
	for (const ch of opts.choices) {
		const picked = c.choices[ch.id];
		if (!picked) continue;
		// A cantrip already learned from species can't be picked again as a class cantrip.
		const valid = picked.filter((p) => ch.options.some((o) => o.index === p) && !(ch.id === "cantrips" && speciesCantrips.includes(p)));
		if (valid.length === ch.choose && ch.choose > 0) out[ch.id] = valid;
	}
	return out;
}

/** Cantrips picked through species/subspecies choices (e.g. High Elf). */
export function speciesCantripPicks(c: CharacterDraft, opts: CreationOptions): string[] {
	return opts.choices.filter((ch) => ch.id.endsWith(":cantrip")).flatMap((ch) => c.choices[ch.id] ?? []);
}

/** Choice ids the player hasn't fully decided (the DM / auto-pick will). */
export function openChoices(c: CharacterDraft, opts: CreationOptions | undefined): CreationOptions["choices"] {
	if (!opts) return [];
	const done = completeChoices(c, opts);
	return opts.choices.filter((ch) => ch.choose > 0 && ch.id !== "subclass" && !done[ch.id]);
}

/** Whether the class gets its subclass at or below the starting level. */
export function subclassAvailable(classId: string, level: number): boolean {
	const cls = getClass(classId);
	return !!cls && cls.subclasses.length > 0 && cls.subclassLevel <= level;
}

export function characterInput(c: CharacterDraft, level: number, opts: CreationOptions | undefined, nameFallback = "Adventurer"): Omit<CreateCharacterInput, "rng"> | null {
	const abilities = abilityInput(c);
	if (!abilities) return null;
	const p = c.personality;
	const personality = Object.fromEntries(Object.entries(p).filter(([, v]) => v.trim())) as CreateCharacterInput["personality"];
	const subclass = subclassAvailable(c.classId, level) ? c.subclassId ?? getClass(c.classId)?.subclasses[0] : undefined;
	return {
		name: c.name.trim() || nameFallback,
		speciesId: c.speciesId,
		...(c.subspeciesId ? { subspeciesId: c.subspeciesId } : {}),
		classId: c.classId,
		...(subclass ? { subclassId: subclass } : {}),
		backgroundId: c.backgroundId,
		abilities,
		choices: completeChoices(c, opts),
		equipment: (opts?.equipment ?? []).map((ec, i) => equipmentSelection(ec, c.equipment[i])),
		...(c.alignment ? { alignment: c.alignment } : {}),
		...(personality && Object.keys(personality).length ? { personality } : {}),
		...(c.portrait ? { portrait: c.portrait } : {}),
	};
}

const PREFER = ["longsword", "rapier", "warhammer", "battleaxe", "mace", "shortsword", "spear", "lute", "holy-symbol", "amulet", "crystal", "wooden-staff"];

/**
 * Picks are consumed group by group (`splice(0, choose)`), so blank slots are
 * filled with a sensible default to keep later groups aligned.
 */
function equipmentSelection(ec: CreationOptions["equipment"][number], e: { option: number; picks: string[] } | undefined): { option: number; picks?: string[] } {
	if (!e) return { option: 0 };
	const opt = ec.options[e.option];
	if (!opt) return { option: 0 };
	if (!e.picks.some(Boolean)) return { option: e.option };
	const picks: string[] = [];
	let cursor = 0;
	for (const g of opt.picks) {
		for (let k = 0; k < g.choose; k++) {
			const v = e.picks[cursor + k];
			const valid = v && g.options.some((o) => o.index === v);
			picks.push(valid ? v : PREFER.find((x) => g.options.some((o) => o.index === x)) ?? g.options[0]?.index ?? "");
		}
		cursor += g.choose;
	}
	return { option: e.option, picks: picks.filter(Boolean) };
}

export function buildNewGameInput(d: WizardDraft, opts: CreationOptions | undefined): NewGameInput | null {
	const ci = characterInput(d.character, d.settings.structure.startingLevel, opts);
	if (!ci) return null;
	const settings: CampaignSettings = {
		...d.settings,
		world: {
			...d.settings.world,
			lines: d.settings.world.lines.filter(Boolean),
			veils: d.settings.world.veils.filter(Boolean),
			customText: d.settings.world.customText?.trim() || undefined,
		},
		structure: { ...d.settings.structure, hook: d.settings.structure.hook?.trim() || undefined },
		dm: { ...d.settings.dm, persona: d.settings.dm.persona?.trim() || undefined },
	};
	return { ...(d.title.trim() ? { title: d.title.trim() } : {}), settings, character: ci };
}

/** Swap two abilities' values (used for drag/keyboard assignment). */
export function swapAbilities(s: Abilities, a: Ability, b: Ability): Abilities {
	return { ...s, [a]: s[b], [b]: s[a] };
}

export { ABILITIES };
