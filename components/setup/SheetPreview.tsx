"use client";

import { useMemo } from "react";
import { AlertTriangle, Footprints, Heart, Shield, Sparkles, Swords, Zap } from "lucide-react";
import type { Character } from "@/lib/game/types";
import { ABILITIES } from "@/lib/game/types";
import { createCharacterDetailed, deriveSheet, type CharacterSheet, type CreationOptions } from "@/lib/rules/character";
import { getBackground, getClass, getSkill, getSpecies, getSpell, getSubclass, getSubspecies } from "@/lib/srd";
import { signed } from "@/lib/rules/dice";
import { Portrait } from "@/components/art/Portrait";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/components/ui/cn";
import { describeOption } from "./ChoicePicker";
import { characterInput, type CharacterDraft } from "./wizardState";
import { useT } from "@/components/i18n/I18nProvider";
import type { Lang } from "@/lib/i18n";
import { srdName } from "./i18n";

export interface PreviewResult {
	character?: Character;
	sheet?: CharacterSheet;
	autoChoices?: Record<string, string[]>;
	error?: string;
}

/** Builds the character exactly as the server will (client-side), catching rule errors. */
export function usePreview(c: CharacterDraft, level: number, opts: CreationOptions | undefined): PreviewResult {
	const { t } = useT();
	return useMemo(() => {
		if (!opts) return { error: t("sheet.chooseOrigins") };
		const input = characterInput(c, level, opts);
		if (!input) return { error: t("sheet.rollToSee") };
		try {
			const { character, autoChoices } = createCharacterDetailed({ ...input, level, id: "preview" });
			return { character, sheet: deriveSheet(character), autoChoices };
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) };
		}
	}, [c, level, opts, t]);
}

export function speciesLabel(speciesId: string, subspeciesId?: string, lang: Lang = "en"): string {
	const sub = subspeciesId ? getSubspecies(subspeciesId) : undefined;
	if (sub) return srdName(lang, "subspecies", sub.index, sub.name);
	return srdName(lang, "species", speciesId, getSpecies(speciesId)?.name ?? speciesId);
}

export function SheetPreview({ preview, draft, compact }: { preview: PreviewResult; draft: CharacterDraft; compact?: boolean }) {
	const { character: ch, sheet, error } = preview;
	const cls = getClass(draft.classId);
	const { t, te, lang, ts } = useT();
	const bg = getBackground(draft.backgroundId);
	const subId = ch?.classes[0]?.subclassId;
	const sub = subId ? getSubclass(subId) : undefined;
	return (
		<div className="parchment relative overflow-hidden p-4 text-ink">
			<div className="flex items-center gap-3">
				{draft.portrait && <Portrait spec={draft.portrait} speciesId={draft.speciesId} size={compact ? 64 : 84} framed />}
				<div className="min-w-0">
					<div className="truncate font-display text-lg leading-tight text-[#3d2a12]">{draft.name || t("sheet.unnamed")}</div>
					<div className="font-serif text-sm text-ink/80 italic">
						{speciesLabel(draft.speciesId, draft.subspeciesId, lang)} · {cls ? srdName(lang, "class", cls.index, cls.name) : draft.classId}
						{ch ? ` ${ch.classes[0]?.level ?? 1}` : ""}
						{subId ? ` · ${sub ? srdName(lang, "subclass", sub.index, sub.name) : subId}` : ""}
					</div>
					<div className="font-serif text-xs text-ink/60">
							{bg ? srdName(lang, "background", bg.index, bg.name) : ""}
							{draft.alignment ? ` · ${te("alignment", draft.alignment)}` : ""}
						</div>
				</div>
			</div>

			{error || !ch || !sheet ? (
				<div className="mt-4 flex items-start gap-2 rounded border border-[#a0522d]/40 bg-[#a0522d]/10 p-3 text-sm text-[#7a2e14]">
					<AlertTriangle className="mt-0.5 size-4 shrink-0" />
					<span>{error ?? t("sheet.unavailable")}</span>
				</div>
			) : (
				<>
					<div className="mt-4 grid grid-cols-5 gap-1.5 text-center">
						<Stat icon={<Heart className="size-3.5" />} label={t("sheet.hp")} value={ch.maxHp} />
						<Stat icon={<Shield className="size-3.5" />} label={t("sheet.ac")} value={sheet.ac} title={sheet.acSource} />
						<Stat icon={<Zap className="size-3.5" />} label={t("sheet.init")} value={signed(sheet.initiative)} />
						<Stat icon={<Footprints className="size-3.5" />} label={t("sheet.speed")} value={sheet.speed} />
						<Stat icon={<Sparkles className="size-3.5" />} label={t("sheet.prof")} value={signed(sheet.profBonus)} />
					</div>

					<div className="mt-3 grid grid-cols-6 gap-1 text-center">
						{ABILITIES.map((a) => (
							<div key={a} className={cn("rounded border bg-white/30 py-1", sheet.saves[a].proficient ? "border-[#8a6a2a]" : "border-[#b89b68]/60")}>
								<div className="text-[9px] font-semibold tracking-widest text-ink/60 uppercase">{te("abilityShort", a)}</div>
								<div className="font-display text-base leading-none">{ch.abilities[a]}</div>
								<div className="text-[11px] text-ink/70">{signed(sheet.mods[a])}</div>
								<div className={cn("mt-0.5 text-[9px]", sheet.saves[a].proficient ? "font-bold text-[#6b4a12]" : "text-ink/50")} title={t("sheet.saveTitle")}>
									{t("sheet.save", { n: signed(sheet.saves[a].mod) })}
								</div>
							</div>
						))}
					</div>

					<Block title={t("sheet.attacks")}>
						<ul className="flex flex-col gap-0.5 text-sm">
							{sheet.attacks
								.filter((at) => at.equipped || at.name !== "Unarmed Strike")
								.slice(0, compact ? 3 : 6)
								.map((at, i) => (
									<li key={`${at.name}-${i}`} className="flex items-baseline justify-between gap-2">
										<span className="flex items-center gap-1 truncate">
											<Swords className="size-3 shrink-0 text-ink/50" />
											{ts(at.name)}
										</span>
										<span className="shrink-0 tabular-nums text-ink/80">
											{signed(at.toHit)} · {at.damage} {srdName(lang, "damage", at.damageType.toLowerCase(), at.damageType).toLowerCase()}
										</span>
									</li>
								))}
						</ul>
						{sheet.attacksPerAction > 1 && <div className="mt-1 text-xs text-ink/60 italic">{t("sheet.attacksPerAction", { n: sheet.attacksPerAction })}</div>}
					</Block>

					{sheet.spellcasting.length > 0 && ch.spellcasting && (
						<Block title={t("sheet.spellcasting")}>
							{sheet.spellcasting.map((s) => (
								<div key={s.classId} className="text-sm">
									<span>{srdName(lang, "class", s.classId, getClass(s.classId)?.name ?? s.classId)}</span> ({te("abilityShort", s.ability)}): {t("sheet.saveDc")} <b>{s.saveDc}</b>, {t("sheet.attack")} <b>{signed(s.attackBonus)}</b>
									{s.preparedLimit !== undefined && <span className="text-ink/60"> · {t("sheet.prepares", { n: s.preparedLimit })}</span>}
								</div>
							))}
							<SpellList label={t("sheet.cantrips")} ids={ch.spellcasting.classes.flatMap((x) => x.cantrips)} />
							<SpellList label={t("sheet.spells")} ids={[...new Set(ch.spellcasting.classes.flatMap((x) => [...x.known, ...x.prepared]))]} />
							{ch.spellcasting.slots.some(Boolean) && (
								<div className="mt-1 text-xs text-ink/70">
									{t("sheet.slots")}{" "}
									{ch.spellcasting.slots
										.map((n, i) => (n ? t("sheet.slot", { level: i + 1, n }) : ""))
										.filter(Boolean)
										.join(" · ")}
								</div>
							)}
							{ch.spellcasting.pact && <div className="text-xs text-ink/70">{t("sheet.pact", { n: ch.spellcasting.pact.max, level: ch.spellcasting.pact.level })}</div>}
						</Block>
					)}

					{!compact && (
						<>
							<Block title={t("sheet.skills")}>
								<div className="grid grid-cols-2 gap-x-3 text-[13px]">
									{Object.entries(sheet.skills).map(([id, s]) => (
										<div key={id} className={cn("flex justify-between", s.proficient ? "font-semibold text-[#5a3c0e]" : "text-ink/55")}>
											<span>
												{s.expertise ? "◆ " : s.proficient ? "● " : ""}
												{srdName(lang, "skill", id, getSkill(id)?.name ?? id)}
											</span>
											<span className="tabular-nums">{signed(s.mod)}</span>
										</div>
									))}
								</div>
								<div className="mt-1 text-xs text-ink/60">{t("sheet.passive", { n: sheet.passivePerception })}</div>
							</Block>
							<Block title={t("sheet.features")}>
								<div className="flex flex-wrap gap-1">
									{ch.features.map((f) => (
										<Tooltip key={f.id + f.source} content={<p>{ts(f.description).slice(0, 400)}</p>}>
											<span className="cursor-help rounded border border-[#b89b68]/70 bg-white/30 px-1.5 py-0.5 text-xs">{ts(f.name)}</span>
										</Tooltip>
									))}
								</div>
							</Block>
							<Block title={t("sheet.proficiencies")}>
								<p className="text-xs leading-relaxed text-ink/80">
									<b>{t("sheet.languages")}</b> {ch.languages.join(", ") || "—"}
									<br />
									<b>{t("sheet.tools")}</b> {ch.tools.join(", ").replace(/-/g, " ") || "—"}
									<br />
									<b>{t("sheet.armor")}</b> {ch.armorProf.map((x) => srdName(lang, "armorProf", x, x)).join(", ") || "—"} · <b>{t("sheet.weapons")}</b> {ch.weaponProf.join(", ").replace(/-/g, " ") || "—"}
								</p>
							</Block>
							<Block title={t("sheet.equipment")}>
								<p className="text-xs leading-relaxed text-ink/80">
									{ch.inventory.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${ts(i.name)}${i.equipped ? t("sheet.equipped") : ""}`).join(", ")}
									{ch.currency.gp ? ` · ${t("sheet.gp", { n: ch.currency.gp })}` : ""}
								</p>
							</Block>
						</>
					)}
				</>
			)}
		</div>
	);
}

function Stat({ icon, label, value, title }: { icon: React.ReactNode; label: string; value: React.ReactNode; title?: string }) {
	return (
		<div className="rounded-md border border-[#b89b68] bg-white/35 px-1 py-1.5" title={title}>
			<div className="flex items-center justify-center gap-1 text-[9px] font-semibold tracking-widest text-ink/60 uppercase">
				{icon}
				{label}
			</div>
			<div className="font-display text-lg leading-tight">{value}</div>
		</div>
	);
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="mt-3 border-t border-[#b89b68]/60 pt-2">
			<div className="mb-1 font-display text-[11px] tracking-[0.2em] text-[#7a5a22] uppercase">{title}</div>
			{children}
		</div>
	);
}

function SpellList({ label, ids }: { label: string; ids: string[] }) {
	const { lang } = useT();
	if (!ids.length) return null;
	return (
		<div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
			<span className="text-ink/60">{label}:</span>
			{ids.map((id) => (
				<Tooltip key={id} content={describeOption(id, lang)}>
					<span className="cursor-help rounded border border-[#b89b68]/70 bg-white/30 px-1.5 py-0.5">{getSpell(id)?.name ?? id}</span>
				</Tooltip>
			))}
		</div>
	);
}
