"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
	Axe, Backpack, BookOpen, ChevronRight, Dices, Drama, Eye, Feather, Flame, HandFist, Leaf, Music, ShieldHalf, Skull, Sparkles, Sun, Sword, Target, UserRound, WandSparkles,
} from "lucide-react";
import { ALIGNMENTS, assignByPriority, STANDARD_ARRAY, type CreationOptions } from "@/lib/rules/character";
import { BACKGROUNDS, CLASSES, SPECIES, getClass, getSubclass, getBackground, getSpecies, getSkill } from "@/lib/srd";
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

type Sub = "origins" | "abilities" | "choices" | "equipment" | "persona";
const SUBS: { id: Sub; label: string; icon: ComponentType<{ className?: string }> }[] = [
	{ id: "origins", label: "Origins", icon: UserRound },
	{ id: "abilities", label: "Abilities", icon: Dices },
	{ id: "choices", label: "Skills & Spells", icon: Sparkles },
	{ id: "equipment", label: "Equipment", icon: Backpack },
	{ id: "persona", label: "Persona & Portrait", icon: Drama },
];

const CLASS_ICON: Record<string, ComponentType<{ className?: string }>> = {
	barbarian: Axe, bard: Music, cleric: Sun, druid: Leaf, fighter: Sword, monk: HandFist, paladin: ShieldHalf, ranger: Target, rogue: Eye, sorcerer: Flame, warlock: Skull, wizard: WandSparkles,
};

const abil = (a: string) => a.toUpperCase();
const bonusText = (b: Partial<Record<string, number>>) =>
	Object.entries(b)
		.filter(([, v]) => v)
		.map(([k, v]) => `${abil(k)} +${v}`)
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

function withOrigins(c: CharacterDraft, patch: Partial<CharacterDraft>): CharacterDraft {
	const next = { ...c, ...patch };
	return { ...next, choices: pruneChoices(next, optionsFor(next).opts) };
}

export function randomCharacter(c: CharacterDraft): CharacterDraft {
	const r = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
	const sp = r(SPECIES);
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
	const { opts, error: optsError } = useMemo(() => optionsFor(c), [c]);
	const preview = usePreview(c, level, opts);
	const set = (patch: Partial<CharacterDraft>) => patchCharacter(update, patch);
	const setOrigins = (patch: Partial<CharacterDraft>) => update((d) => ({ ...d, character: withOrigins(d.character, patch) }));

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

	return (
		<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
			<div className="min-w-0">
				<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
					<Tabs<Sub> label="Character sections" tabs={SUBS.map((s) => ({ id: s.id, label: s.label, icon: <s.icon className="size-4" /> }))} value={sub} onChange={setSub} className="min-w-0 flex-1 overflow-x-auto" />
					<button type="button" className="btn text-sm" onClick={() => update((d) => ({ ...d, character: randomCharacter(d.character) }))} title="Random species, class, background, name and portrait">
						<Dices className="size-4" /> Surprise me
					</button>
				</div>

				{sub === "origins" && (
					<div className="flex flex-col gap-8">
						<Section title="Species" hint={species ? `${species.name}: ${bonusText(opts?.abilityBonuses ?? species.abilityBonuses)} · speed ${species.speed} ft${species.darkvision ? ` · darkvision ${species.darkvision} ft` : ""}` : undefined}>
							<div className="grid grid-cols-3 gap-2 xl:grid-cols-5">
								{SPECIES.map((s) => (
									<Tooltip key={s.index} content={<OriginTip title={s.name} lines={[bonusText(s.abilityBonuses), `Speed ${s.speed} ft${s.darkvision ? `, darkvision ${s.darkvision} ft` : ""}`, s.traits.map((t) => t.name).join(", ")]} />}>
										<PickCard active={s.index === c.speciesId} onClick={() => setOrigins({ speciesId: s.index, subspeciesId: s.subspecies.length > 1 ? s.subspecies[0].index : undefined, portrait: newPortrait(s.index) })}>
											{s.name}
										</PickCard>
									</Tooltip>
								))}
							</div>
							{species && species.subspecies.length > 1 && (
								<div className="flex flex-wrap gap-2">
									{species.subspecies.map((ss) => (
										<button key={ss.index} type="button" className="chip" data-active={c.subspeciesId === ss.index} onClick={() => setOrigins({ subspeciesId: ss.index })}>
											{ss.name}
										</button>
									))}
								</div>
							)}
							{species && <p className="font-serif text-[15px] leading-snug text-text/80">{species.subspecies[0] && species.subspecies.length === 1 ? `${species.subspecies[0].name}. ` : ""}{species.traits.map((t) => t.name).join(" · ")}</p>}
						</Section>

						<Section title="Class" hint={cls ? `d${cls.hitDie} hit die · primary ${cls.primaryAbility.map(abil).join("/")} · saves ${cls.savingThrows.map(abil).join(", ")}${cls.spellcasting ? ` · casts with ${abil(cls.spellcasting.ability)}` : ""}` : undefined}>
							<div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
								{CLASSES.map((k) => {
									const Icon = CLASS_ICON[k.index] ?? Sword;
									return (
										<Tooltip key={k.index} content={<OriginTip title={k.name} lines={[`Hit die d${k.hitDie}`, `Primary: ${k.primaryAbility.map(abil).join(", ")}`, `Armor: ${k.armor.join(", ") || "none"}`, k.spellcasting ? `Spellcaster (${abil(k.spellcasting.ability)})` : "Martial"]} />}>
											<PickCard
												active={k.index === c.classId}
												onClick={() => setOrigins({ classId: k.index, subclassId: undefined, equipment: [], standard: assignByPriority(STANDARD_ARRAY, k.index), ...(c.rolled ? { rolledScores: assignByPriority(c.rolled, k.index) } : {}) })}
											>
												<Icon className="mx-auto mb-1 size-5 opacity-80" />
												{k.name}
											</PickCard>
										</Tooltip>
									);
								})}
							</div>
							{cls && subclassAvailable(c.classId, level) && (
								<div className="rounded-lg border border-line bg-bg-2/50 p-3">
									<FieldLabel>{cls.subclassFlavor}</FieldLabel>
									<div className="flex flex-wrap gap-2">
										{cls.subclasses.map((s) => {
											const sc = getSubclass(s);
											const active = (c.subclassId ?? cls.subclasses[0]) === s;
											return (
												<Tooltip key={s} content={sc ? <OriginTip title={sc.name} lines={[sc.description.slice(0, 300)]} /> : null}>
													<button type="button" className="chip" data-active={active} aria-pressed={active} onClick={() => set({ subclassId: s })}>
														{sc?.name ?? s}
													</button>
												</Tooltip>
											);
										})}
									</div>
									{cls.subclasses.length === 1 && <p className="mt-2 text-xs text-faint">The SRD includes one {cls.subclassFlavor.toLowerCase()} for this class.</p>}
								</div>
							)}
						</Section>

						<Section title="Background" hint={bg ? `Skills: ${bg.skills.map((s) => getSkill(s)?.name ?? s).join(", ")} · feature: ${bg.feature.name}` : undefined}>
							<div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
								{BACKGROUNDS.map((b) => (
									<Tooltip key={b.index} content={<OriginTip title={b.feature.name} lines={[b.feature.description.slice(0, 320)]} />}>
										<PickCard active={b.index === c.backgroundId} onClick={() => setOrigins({ backgroundId: b.index, equipment: [] })}>
											<BookOpen className="mx-auto mb-1 size-4 opacity-70" />
											{b.name}
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
						{bonusChoice && <ChoicePicker choice={bonusChoice} value={c.choices[bonusChoice.id]} onChange={(v) => set({ choices: { ...c.choices, [bonusChoice.id]: v ?? [] } })} />}
						<p className="text-sm text-dim">
							Species bonuses are added automatically
							{opts && bonusText(opts.abilityBonuses) ? ` (${bonusText(opts.abilityBonuses)})` : ""}.{level > 3 ? " Ability Score Improvements from later levels are applied for you (see the preview)." : ""}
						</p>
					</div>
				)}

				{sub === "choices" && (
					<div className="flex flex-col gap-4">
						{opts && opts.grantedSkills.length > 0 && (
							<p className="text-sm text-dim">
								Already proficient: <span className="text-text">{opts.grantedSkills.map((s) => getSkill(s)?.name ?? s).join(", ")}</span>
							</p>
						)}
						{choiceList.length === 0 && <p className="text-dim">No choices to make here.</p>}
						{choiceList.map((ch) => {
							const taken = ch.id === "cantrips" && opts ? speciesCantripPicks(c, opts) : [];
							const choice = /expertise/.test(ch.id)
								? { ...ch, options: ch.options.filter((o) => knownSkills.has(o.index) || o.index === "thieves-tools") }
								: taken.length
									? { ...ch, options: ch.options.filter((o) => !taken.includes(o.index)) }
									: ch;
							return <ChoicePicker key={ch.id} choice={choice} value={c.choices[ch.id]} onChange={(v) => set({ choices: { ...c.choices, ...(v ? { [ch.id]: v } : { [ch.id]: [] }) } })} />;
						})}
						{level > 1 && <p className="text-xs text-faint italic">Choices from levels 2–{level} (new spells, features, ASIs) are picked automatically. The preview shows the result.</p>}
						{opts?.preparedFormula && <p className="text-xs text-faint italic">Prepared spells: {opts.preparedFormula}. You can change them after each long rest.</p>}
					</div>
				)}

				{sub === "equipment" && opts && <EquipmentPicker opts={opts} value={c.equipment} onChange={(equipment) => set({ equipment })} />}

				{sub === "persona" && <PersonaPanel c={c} set={set} />}

				{nextSub && (
					<div className="mt-6 flex justify-end">
						<button type="button" className="btn text-sm" onClick={() => setSub(nextSub.id)}>
							{nextSub.label} <ChevronRight className="size-4" />
						</button>
					</div>
				)}
			</div>

			<aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
				<div className="mb-2 flex items-center gap-2 text-xs tracking-[0.2em] text-dim uppercase">
					<Feather className="size-3.5 text-gold/70" /> Live character sheet
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

const PERSONALITY: { key: keyof CharacterDraft["personality"]; label: string; from?: "personalityTraits" | "ideals" | "bonds" | "flaws"; rows: number; placeholder: string }[] = [
	{ key: "traits", label: "Personality traits", from: "personalityTraits", rows: 2, placeholder: "I quote ancient proverbs for every occasion." },
	{ key: "ideals", label: "Ideals", from: "ideals", rows: 2, placeholder: "Charity. I always try to help those in need." },
	{ key: "bonds", label: "Bonds", from: "bonds", rows: 2, placeholder: "I owe my life to the priest who took me in." },
	{ key: "flaws", label: "Flaws", from: "flaws", rows: 2, placeholder: "I trust too easily." },
	{ key: "appearance", label: "Appearance", rows: 2, placeholder: "Tall, scarred knuckles, a cloak the color of old wine." },
	{ key: "backstory", label: "Backstory", rows: 5, placeholder: "Where do you come from, and why did you take up the adventuring life?" },
];

function PersonaPanel({ c, set }: { c: CharacterDraft; set: (p: Partial<CharacterDraft>) => void }) {
	const bg = getBackground(c.backgroundId);
	const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
	return (
		<div className="flex flex-col gap-8">
			<div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
				<div>
					<FieldLabel htmlFor="char-name">Name</FieldLabel>
					<div className="flex gap-2">
						<input id="char-name" className="input font-display text-lg tracking-wide placeholder:font-sans placeholder:text-sm placeholder:tracking-normal" value={c.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="Leave blank for a random name" />
						<button type="button" className="btn shrink-0" onClick={() => set({ name: randomName(c.speciesId) })} title="Random name for your species">
							<Dices className="size-4" />
						</button>
					</div>
				</div>
				<div>
					<FieldLabel htmlFor="char-align" optional>
						Alignment
					</FieldLabel>
					<select id="char-align" className="input capitalize" value={c.alignment} onChange={(e) => set({ alignment: e.target.value })}>
						<option value="">Unaligned / let it emerge</option>
						{ALIGNMENTS.map((a) => (
							<option key={a} value={a}>
								{a}
							</option>
						))}
					</select>
				</div>
			</div>

			<Section title="Portrait">
				{c.portrait && <PortraitCustomizer spec={c.portrait} speciesId={c.speciesId} name={c.name} onChange={(portrait) => set({ portrait })} />}
			</Section>

			<Section
				title="Personality"
				hint="All optional. The DM weaves these into the story."
				actions={
					bg && (
						<button
							type="button"
							className="btn py-1 text-xs"
							onClick={() => set({ personality: { ...c.personality, traits: pick(bg.personalityTraits) ?? "", ideals: pick(bg.ideals) ?? "", bonds: pick(bg.bonds) ?? "", flaws: pick(bg.flaws) ?? "" } })}
						>
							<Dices className="size-3.5" /> Roll from {bg.name}
						</button>
					)
				}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					{PERSONALITY.map((p) => {
						const pool = p.from && bg ? bg[p.from] : [];
						return (
							<div key={p.key} className={p.key === "backstory" || p.key === "appearance" ? "sm:col-span-2" : undefined}>
								<div className="flex items-end justify-between">
									<FieldLabel htmlFor={`p-${p.key}`}>{p.label}</FieldLabel>
									{pool.length > 0 && (
										<button type="button" className="mb-1 rounded p-0.5 text-faint hover:text-gold-2" onClick={() => set({ personality: { ...c.personality, [p.key]: pick(pool) } })} aria-label={`Suggest ${p.label}`} title="Suggest from background">
											<Dices className="size-3.5" />
										</button>
									)}
								</div>
								<textarea
									id={`p-${p.key}`}
									rows={p.rows}
									className="input resize-y font-serif text-[15px]"
									value={c.personality[p.key]}
									placeholder={p.placeholder}
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
