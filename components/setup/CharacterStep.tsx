"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
	Axe, Backpack, BookOpen, ChevronRight, Dices, Drama, Eye, Feather, Flame, HandFist, Leaf, Music, ShieldHalf, Skull, Sparkles, Sun, Sword, Target, UserRound, WandSparkles,
} from "lucide-react";
import { ALIGNMENTS, assignByPriority, STANDARD_ARRAY, type CreationOptions } from "@/lib/rules/character";
import { BACKGROUNDS, CLASSES, SPECIES, getClass, getSubclass, getBackground, getSpecies, getSkill } from "@/lib/srd";
import { offeredIn, rulesetOf, type Ruleset } from "@/lib/rules/ruleset";
import { Tabs } from "@/components/ui/Tabs";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/components/ui/cn";
import { AbilityScores } from "./AbilityScores";
import { ChoicePicker } from "./ChoicePicker";
import { EquipmentPicker } from "./EquipmentPicker";
import { FieldLabel, Section } from "./Field";
import { PortraitCustomizer, newPortrait } from "./PortraitCustomizer";
import { SheetPreview, usePreview } from "./SheetPreview";
import { randomName } from "./names";
import { patchCharacter, type StepProps } from "./types";
import { optionsFor, speciesCantripPicks, subclassAvailable, type CharacterDraft } from "./wizardState";
import { useT } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";
import { rsKey, srdNameIn } from "./i18n";

type Sub = "origins" | "abilities" | "choices" | "equipment" | "persona";
const SUBS: { id: Sub; label: MessageKey; zLabel?: MessageKey; icon: ComponentType<{ className?: string }> }[] = [
	{ id: "origins", label: "char.tab.origins", icon: UserRound },
	{ id: "abilities", label: "char.tab.abilities", icon: Dices },
	{ id: "choices", label: "char.tab.choices", zLabel: "z.char.tab.choices", icon: Sparkles },
	{ id: "equipment", label: "char.tab.equipment", icon: Backpack },
	{ id: "persona", label: "char.tab.persona", icon: Drama },
];

const CLASS_ICON: Record<string, ComponentType<{ className?: string }>> = {
	barbarian: Axe, bard: Music, cleric: Sun, druid: Leaf, fighter: Sword, monk: HandFist, paladin: ShieldHalf, ranger: Target, rogue: Eye, sorcerer: Flame, warlock: Skull, wizard: WandSparkles,
};

type Te = (group: string, id: string) => string;
const bonusText = (b: Partial<Record<string, number>>, te: Te) =>
	Object.entries(b)
		.filter(([, v]) => v)
		.map(([k, v]) => `${te("abilityShort", k)} +${v}`)
		.join(", ");

/** Drops picks that are no longer valid after a species/class/background change. */
function pruneChoices(c: CharacterDraft, opts: CreationOptions | undefined): CharacterDraft["choices"] {
	if (!opts) return {};
	const out: CharacterDraft["choices"] = {};
	for (const ch of opts.choices) {
		const v = c.choices[ch.id]?.filter((p) => ch.options.some((o) => o.index === p));
		if (v?.length) out[ch.id] = v.slice(0, ch.choose);
	}
	return out;
}

function withOrigins(c: CharacterDraft, patch: Partial<CharacterDraft>, rs: Ruleset): CharacterDraft {
	const next = { ...c, ...patch };
	return { ...next, choices: pruneChoices(next, optionsFor(next, rs).opts) };
}

export function randomCharacter(c: CharacterDraft, rs: Ruleset = "fantasy"): CharacterDraft {
	const r = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
	const sp = r(offeredIn(SPECIES, rs));
	const cls = r(CLASSES);
	const bg = r(BACKGROUNDS);
	return {
		...c,
		speciesId: sp.index,
		subspeciesId: sp.subspecies.length > 1 ? sp.subspecies[0].index : undefined,
		classId: cls.index,
		subclassId: undefined,
		backgroundId: bg.index,
		abilityMethod: "standard_array",
		standard: assignByPriority(STANDARD_ARRAY, cls.index),
		choices: {},
		equipment: [],
		name: randomName(sp.index),
		alignment: r(ALIGNMENTS),
		personality: { ...c.personality, traits: r(bg.personalityTraits) ?? "", ideals: r(bg.ideals) ?? "", bonds: r(bg.bonds) ?? "", flaws: r(bg.flaws) ?? "" },
		portrait: newPortrait(sp.index),
	};
}

export function CharacterStep({ draft, update }: StepProps) {
	const c = draft.character;
	const level = draft.settings.structure.startingLevel;
	const [sub, setSub] = useState<Sub>("origins");
	const { t, te, lang, ts, ruleset } = useT();
	const abil = (a: string) => te("abilityShort", a);
	const bonus = (b: Partial<Record<string, number>>) => bonusText(b, te);
	const nm = (group: string, x: { index: string; name: string }) => srdNameIn(ruleset, lang, group, x.index, x.name);
	const speedText = (s: { speed: number; darkvision?: number }) => `${t("char.speed", { n: s.speed })}${s.darkvision ? ` · ${t("char.darkvision", { n: s.darkvision })}` : ""}`;	const rs = rulesetOf(draft.settings);

	const speciesList = useMemo(() => offeredIn(SPECIES, rs), [rs]);
	const { opts, error: optsError } = useMemo(() => optionsFor(c, rs), [c, rs]);
	const preview = usePreview(c, level, opts);
	const set = (patch: Partial<CharacterDraft>) => patchCharacter(update, patch);
	const setOrigins = (patch: Partial<CharacterDraft>) => update((d) => ({ ...d, character: withOrigins(d.character, patch, rulesetOf(d.settings)) }));

	// Switching to/from The Quiet: the species must be one the ruleset offers (origins vs SRD species).
	const speciesOk = speciesList.some((s) => s.index === c.speciesId);
	useEffect(() => {
		if (speciesOk || !speciesList[0]) return;
		const sp = speciesList[0];
		update((d) => ({ ...d, character: withOrigins(d.character, { speciesId: sp.index, subspeciesId: undefined, portrait: newPortrait(sp.index) }, rulesetOf(d.settings)) }));
	}, [speciesOk, speciesList, update]);

	// First visit: give the hero a face.
	useEffect(() => {
		if (!c.portrait) patchCharacter(update, { portrait: newPortrait(c.speciesId) });
	}, [c.portrait, c.speciesId, update]);

	const cls = getClass(c.classId);
	const species = getSpecies(c.speciesId);
	const bg = getBackground(c.backgroundId);
	const choiceList = (opts?.choices ?? []).filter((ch) => ch.id !== "subclass" && ch.choose > 0 && !ch.id.endsWith(":ability_bonus"));
	const bonusChoice = opts?.choices.find((ch) => ch.id.endsWith(":ability_bonus"));
	const knownSkills = new Set([...(opts?.grantedSkills ?? []), ...Object.entries(c.choices).filter(([k]) => k.endsWith("skills")).flatMap(([, v]) => v)]);
	const subIdx = SUBS.findIndex((s) => s.id === sub);
	const nextSub = SUBS[subIdx + 1];
	const names = { cls: cls ? nm("class", cls) : undefined, bg: bg ? nm("background", bg) : undefined };
	const flavor = cls ? srdNameIn(ruleset, lang, "subclassFlavor", cls.index, cls.subclassFlavor) : "";
	const preparedFormula =
		opts?.preparedFormula && cls?.spellcasting
			? t(cls.spellcasting.type === "half" ? "char.preparedFormulaHalf" : "char.preparedFormula", { abil: te("abilityShort", cls.spellcasting.ability), cls: names.cls ?? cls.name })
			: undefined;

	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
			<div className="min-w-0">
				<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
					<Tabs<Sub> label={t("char.sectionsAria")} tabs={SUBS.map((s) => ({ id: s.id, label: <span className="whitespace-nowrap">{t(rs !== "fantasy" && s.zLabel ? rsKey(rs, s.label) : s.label)}</span>, icon: <s.icon className="size-4" /> }))} value={sub} onChange={setSub} className="min-w-0 flex-1 overflow-x-auto" />
					<button type="button" className="btn text-sm" onClick={() => update((d) => ({ ...d, character: randomCharacter(d.character, rulesetOf(d.settings)) }))}title={t("char.surpriseTitle")}>
							<Dices className="size-4" /> {t("char.surprise")}
					</button>
				</div>

				{sub === "origins" && (
					<div className="flex flex-col gap-8">
						<Section title={t(rsKey(rs, "char.species"))} hint={species ? `${nm("species", species)}: ${bonus(opts?.abilityBonuses ?? species.abilityBonuses)} · ${speedText(species)}` : undefined}>
							<div className="grid grid-cols-3 gap-2 xl:grid-cols-5">
								{speciesList.map((s) => (
									<Tooltip key={s.index} content={<OriginTip title={nm("species", s)} lines={[bonus(s.abilityBonuses), speedText(s), s.traits.map((tr) => ts(tr.name)).join(", ")]} />}>
										<PickCard active={s.index === c.speciesId} onClick={() => setOrigins({ speciesId: s.index, subspeciesId: s.subspecies.length > 1 ? s.subspecies[0].index : undefined, portrait: newPortrait(s.index) })}>
											{nm("species", s)}
										</PickCard>
									</Tooltip>
								))}
							</div>
							{species && species.subspecies.length > 1 && (
								<div className="flex flex-wrap gap-2">
									{species.subspecies.map((ss) => (
										<button key={ss.index} type="button" className="chip" data-active={c.subspeciesId === ss.index} onClick={() => setOrigins({ subspeciesId: ss.index })}>
											{nm("subspecies", ss)}
										</button>
									))}
								</div>
							)}
							{species && <p className="font-serif text-[15px] leading-snug text-text/80">{species.subspecies[0] && species.subspecies.length === 1 ? `${nm("subspecies", species.subspecies[0])}. ` : ""}{species.traits.map((tr) => ts(tr.name)).join(" · ")}</p>}
						</Section>

						<Section
							title={t(rsKey(rs, "char.class"))}
							hint={
								cls
									? `${t("char.hitDieHint", { n: cls.hitDie })} · ${t("char.primaryHint", { list: cls.primaryAbility.map(abil).join("/") })} · ${t("char.savesHint", { list: cls.savingThrows.map(abil).join(", ") })}${cls.spellcasting ? ` · ${t(rsKey(rs, "char.castsWith"), { abil: abil(cls.spellcasting.ability) })}` : ""}`
									: undefined
							}
						>
							<div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
								{CLASSES.map((k) => {
									const Icon = CLASS_ICON[k.index] ?? Sword;
									return (
										<Tooltip key={k.index} content={<OriginTip
											title={nm("class", k)}
											lines={[
												t("char.tip.hitDie", { n: k.hitDie }),
												t("char.tip.primary", { list: k.primaryAbility.map(abil).join(", ") }),
												t("char.tip.armor", { list: k.armor.map((x) => srdNameIn(ruleset, lang, "armorProf", x, x)).join(", ") || t("char.tip.none") }),
												k.spellcasting ? t(rsKey(rs, "char.tip.spellcaster"), { abil: abil(k.spellcasting.ability) }) : t(rsKey(rs, "char.tip.martial")),
											]}
										/>}>
											<PickCard
												active={k.index === c.classId}
												onClick={() => setOrigins({ classId: k.index, subclassId: undefined, equipment: [], standard: assignByPriority(STANDARD_ARRAY, k.index), ...(c.rolled ? { rolledScores: assignByPriority(c.rolled, k.index) } : {}) })}
											>
												<Icon className="mx-auto mb-1 size-5 opacity-80" />
												{nm("class", k)}
											</PickCard>
										</Tooltip>
									);
								})}
							</div>
							{cls && subclassAvailable(c.classId, level) && (
								<div className="rounded-lg border border-line bg-bg-2/50 p-3">
									<FieldLabel>{flavor}</FieldLabel>
									<div className="flex flex-wrap gap-2">
										{cls.subclasses.map((s) => {
											const sc = getSubclass(s);
											const active = (c.subclassId ?? cls.subclasses[0]) === s;
											return (
												<Tooltip key={s} content={sc ? <OriginTip title={nm("subclass", sc)} lines={[ts(sc.description).slice(0, 300)]} /> : null}>
													<button type="button" className="chip" data-active={active} aria-pressed={active} onClick={() => set({ subclassId: s })}>
														{sc ? nm("subclass", sc) : s}
													</button>
												</Tooltip>
											);
										})}
									</div>
									{cls.subclasses.length === 1 && <p className="mt-2 text-xs text-faint">{t("char.srdOne", { flavor: flavor.toLowerCase() })}</p>}
								</div>
							)}
						</Section>

						<Section title={t("char.background")} hint={bg ? t("char.bgHint", { list: bg.skills.map((s) => srdNameIn(ruleset, lang, "skill", s, getSkill(s)?.name ?? s)).join(", "), feature: ts(bg.feature.name) }) : undefined}>
							<div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
								{BACKGROUNDS.map((b) => (
									<Tooltip key={b.index} content={<OriginTip title={ts(b.feature.name)} lines={[ts(b.feature.description).slice(0, 320)]} />}>
										<PickCard active={b.index === c.backgroundId} onClick={() => setOrigins({ backgroundId: b.index, equipment: [] })}>
											<BookOpen className="mx-auto mb-1 size-4 opacity-70" />
												{nm("background", b)}
											</PickCard>
									</Tooltip>
								))}
							</div>
						</Section>
						{optsError && <p className="text-sm text-crimson-2">{optsError}</p>}
					</div>
				)}

				{sub === "abilities" && (
					<div className="flex flex-col gap-6">
						<AbilityScores c={c} opts={opts} onChange={set} />
						{bonusChoice && <ChoicePicker names={names} choice={bonusChoice} value={c.choices[bonusChoice.id]} onChange={(v) => set({ choices: { ...c.choices, [bonusChoice.id]: v ?? [] } })} />}
						<p className="text-sm text-dim">
							{t("char.bonusNote", { bonus: opts && bonus(opts.abilityBonuses) ? ` (${bonus(opts.abilityBonuses)})` : "" })}
							{level > 3 ? t("char.asiNote") : ""}
						</p>
					</div>
				)}

				{sub === "choices" && (
					<div className="flex flex-col gap-4">
						{opts && opts.grantedSkills.length > 0 && (
							<p className="text-sm text-dim">
								{t("char.alreadyProf")} <span className="text-text">{opts.grantedSkills.map((s) => srdNameIn(ruleset, lang, "skill", s, getSkill(s)?.name ?? s)).join(", ")}</span>
							</p>
						)}
						{choiceList.length === 0 && <p className="text-dim">{t("char.noChoices")}</p>}
						{choiceList.map((ch) => {
							const taken = ch.id === "cantrips" && opts ? speciesCantripPicks(c, opts) : [];
							const choice = /expertise/.test(ch.id)
								? { ...ch, options: ch.options.filter((o) => knownSkills.has(o.index) || o.index === "thieves-tools") }
								: taken.length
									? { ...ch, options: ch.options.filter((o) => !taken.includes(o.index)) }
									: ch;
							return <ChoicePicker key={ch.id} names={names} choice={choice} value={c.choices[ch.id]} onChange={(v) => set({ choices: { ...c.choices, ...(v ? { [ch.id]: v } : { [ch.id]: [] }) } })} />;
						})}
						{level > 1 && <p className="text-xs text-faint italic">{t(rsKey(rs, "char.laterChoices"), { level })}</p>}
						{preparedFormula && <p className="text-xs text-faint italic">{t(rsKey(rs, "char.prepared"), { formula: preparedFormula })}</p>}
					</div>
				)}

				{sub === "equipment" && opts && <EquipmentPicker opts={opts} value={c.equipment} onChange={(equipment) => set({ equipment })} />}

				{sub === "persona" && <PersonaPanel c={c} set={set} />}

				{nextSub && (
					<div className="mt-6 flex justify-end">
						<button type="button" className="btn text-sm" onClick={() => setSub(nextSub.id)}>
							{t(rs !== "fantasy" && nextSub.zLabel ? rsKey(rs, nextSub.label) : nextSub.label)} <ChevronRight className="size-4" />
						</button>
					</div>
				)}
			</div>

			<aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
				<div className="mb-2 flex items-center gap-2 text-xs tracking-[0.2em] text-dim uppercase">
					<Feather className="size-3.5 text-gold/70" /> {t("char.liveSheet")}
				</div>
				<SheetPreview preview={preview} draft={c} />
			</aside>
		</div>
	);
}

function OriginTip({ title, lines }: { title: string; lines: string[] }) {
	return (
		<div>
			<div className="mb-1 font-display text-sm text-gold-2">{title}</div>
			{lines.filter(Boolean).map((l, i) => (
				<p key={i} className="text-dim">
					{l}
				</p>
			))}
		</div>
	);
}

function PickCard({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"w-full rounded-lg border px-2 py-2.5 text-center font-display text-[13px] tracking-wide transition-all focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold",
				active ? "border-gold bg-gradient-to-b from-gold/20 to-gold/5 text-gold-2 shadow-[0_0_18px_rgb(212_166_74/0.15)]" : "border-line bg-panel-2 text-text/85 hover:border-gold/50 hover:text-text",
			)}
		>
			{children}
		</button>
	);
}

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

// Labels: char.p.<key>, placeholders: char.ph.<key>
const PERSONALITY: { key: keyof CharacterDraft["personality"]; from?: "personalityTraits" | "ideals" | "bonds" | "flaws"; rows: number }[] = [
	{ key: "traits", from: "personalityTraits", rows: 2 },
	{ key: "ideals", from: "ideals", rows: 2 },
	{ key: "bonds", from: "bonds", rows: 2 },
	{ key: "flaws", from: "flaws", rows: 2 },
	{ key: "appearance", rows: 2 },
	{ key: "backstory", rows: 5 },
];

function PersonaPanel({ c, set }: { c: CharacterDraft; set: (p: Partial<CharacterDraft>) => void }) {
	const bg = getBackground(c.backgroundId);
	const { t, te, lang, ruleset } = useT();
	return (
		<div className="flex flex-col gap-8">
			<div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
				<div>
					<FieldLabel htmlFor="char-name">{t("char.name")}</FieldLabel>
					<div className="flex gap-2">
						<input id="char-name" className="input font-display text-lg tracking-wide placeholder:font-sans placeholder:text-sm placeholder:tracking-normal" value={c.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder={t("char.namePh")} />
						<button type="button" className="btn shrink-0" onClick={() => set({ name: randomName(c.speciesId) })} title={t("char.randomNameTitle")} aria-label={t("char.randomNameTitle")}>
							<Dices className="size-4" />
						</button>
					</div>
				</div>
				<div>
					<FieldLabel htmlFor="char-align" optional>
							{t("char.alignment")}
						</FieldLabel>
						<select id="char-align" className="input" value={c.alignment} onChange={(e) => set({ alignment: e.target.value })}>
							<option value="">{t("char.unaligned")}</option>
						{ALIGNMENTS.map((a) => (
							<option key={a} value={a}>
								{te("alignment", a)}
							</option>
						))}
					</select>
				</div>
			</div>

			<Section title={t("char.portrait")}>
				{c.portrait && <PortraitCustomizer spec={c.portrait} speciesId={c.speciesId} name={c.name} onChange={(portrait) => set({ portrait })} who={{ classes: [c.classId] }} />}
			</Section>

			<Section
				title={t("char.personality")}
				hint={t("char.personalityHint")}
				actions={
					bg && (
						<button
							type="button"
							className="btn py-1 text-xs"
							onClick={() => set({ personality: { ...c.personality, traits: pick(bg.personalityTraits) ?? "", ideals: pick(bg.ideals) ?? "", bonds: pick(bg.bonds) ?? "", flaws: pick(bg.flaws) ?? "" } })}
						>
							<Dices className="size-3.5" /> {t("char.rollFrom", { bg: srdNameIn(ruleset, lang, "background", bg.index, bg.name) })}
						</button>
					)
				}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					{PERSONALITY.map((p) => {
						const pool = p.from && bg ? bg[p.from] : [];
						const label = t(`char.p.${p.key}`);
						return (
							<div key={p.key} className={p.key === "backstory" || p.key === "appearance" ? "sm:col-span-2" : undefined}>
								<div className="flex items-end justify-between">
									<FieldLabel htmlFor={`p-${p.key}`}>{label}</FieldLabel>
									{pool.length > 0 && (
										<button type="button" className="mb-1 rounded p-0.5 text-faint hover:text-gold-2" onClick={() => set({ personality: { ...c.personality, [p.key]: pick(pool) } })} aria-label={t("char.suggestAria", { label })} title={t("char.suggestTitle")}>
											<Dices className="size-3.5" />
										</button>
									)}
								</div>
								<textarea
									id={`p-${p.key}`}
									rows={p.rows}
									className="input resize-y font-serif text-[15px]"
									value={c.personality[p.key]}
									placeholder={t(`char.ph.${p.key}`)}
									onChange={(e) => set({ personality: { ...c.personality, [p.key]: e.target.value } })}
								/>
							</div>
						);
					})}
				</div>
			</Section>
		</div>
	);
}
