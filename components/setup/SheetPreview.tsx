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

export interface PreviewResult {
	character?: Character;
	sheet?: CharacterSheet;
	autoChoices?: Record<string, string[]>;
	error?: string;
}

/** Builds the character exactly as the server will (client-side), catching rule errors. */
export function usePreview(c: CharacterDraft, level: number, opts: CreationOptions | undefined): PreviewResult {
	return useMemo(() => {
		if (!opts) return { error: "Choose a species, class and background." };
		const input = characterInput(c, level, opts);
		if (!input) return { error: "Roll your ability scores to see your character." };
		try {
			const { character, autoChoices } = createCharacterDetailed({ ...input, level, id: "preview" });
			return { character, sheet: deriveSheet(character), autoChoices };
		} catch (e) {
			return { error: e instanceof Error ? e.message : String(e) };
		}
	}, [c, level, opts]);
}

export function speciesLabel(speciesId: string, subspeciesId?: string): string {
	return (subspeciesId && getSubspecies(subspeciesId)?.name) || getSpecies(speciesId)?.name || speciesId;
}

export function SheetPreview({ preview, draft, compact }: { preview: PreviewResult; draft: CharacterDraft; compact?: boolean }) {
	const { character: ch, sheet, error } = preview;
	const cls = getClass(draft.classId);
	return (
		<div className="parchment relative overflow-hidden p-4 text-ink">
			<div className="flex items-center gap-3">
				{draft.portrait && <Portrait spec={draft.portrait} speciesId={draft.speciesId} size={compact ? 64 : 84} framed />}
				<div className="min-w-0">
					<div className="truncate font-display text-lg leading-tight text-[#3d2a12]">{draft.name || "Unnamed hero"}</div>
					<div className="font-serif text-sm text-ink/80 italic">
						{speciesLabel(draft.speciesId, draft.subspeciesId)} {cls?.name ?? draft.classId}
						{ch ? ` ${ch.classes[0]?.level ?? 1}` : ""}
						{ch?.classes[0]?.subclassId ? ` · ${getSubclass(ch.classes[0].subclassId)?.name ?? ""}` : ""}
					</div>
					<div className="font-serif text-xs text-ink/60">{getBackground(draft.backgroundId)?.name}{draft.alignment ? ` · ${draft.alignment}` : ""}</div>
				</div>
			</div>

			{error || !ch || !sheet ? (
				<div className="mt-4 flex items-start gap-2 rounded border border-[#a0522d]/40 bg-[#a0522d]/10 p-3 text-sm text-[#7a2e14]">
					<AlertTriangle className="mt-0.5 size-4 shrink-0" />
					<span>{error ?? "Preview unavailable."}</span>
				</div>
			) : (
				<>
					<div className="mt-4 grid grid-cols-5 gap-1.5 text-center">
						<Stat icon={<Heart className="size-3.5" />} label="HP" value={ch.maxHp} />
						<Stat icon={<Shield className="size-3.5" />} label="AC" value={sheet.ac} title={sheet.acSource} />
						<Stat icon={<Zap className="size-3.5" />} label="Init" value={signed(sheet.initiative)} />
						<Stat icon={<Footprints className="size-3.5" />} label="Speed" value={sheet.speed} />
						<Stat icon={<Sparkles className="size-3.5" />} label="Prof" value={signed(sheet.profBonus)} />
					</div>

					<div className="mt-3 grid grid-cols-6 gap-1 text-center">
						{ABILITIES.map((a) => (
							<div key={a} className={cn("rounded border bg-white/30 py-1", sheet.saves[a].proficient ? "border-[#8a6a2a]" : "border-[#b89b68]/60")}>
								<div className="text-[9px] font-semibold tracking-widest text-ink/60 uppercase">{a}</div>
								<div className="font-display text-base leading-none">{ch.abilities[a]}</div>
								<div className="text-[11px] text-ink/70">{signed(sheet.mods[a])}</div>
								<div className={cn("mt-0.5 text-[9px]", sheet.saves[a].proficient ? "font-bold text-[#6b4a12]" : "text-ink/50")} title="Saving throw">
									save {signed(sheet.saves[a].mod)}
								</div>
							</div>
						))}
					</div>

					<Block title="Attacks">
						<ul className="flex flex-col gap-0.5 text-sm">
							{sheet.attacks
								.filter((at) => at.equipped || at.name !== "Unarmed Strike")
								.slice(0, compact ? 3 : 6)
								.map((at, i) => (
									<li key={`${at.name}-${i}`} className="flex items-baseline justify-between gap-2">
										<span className="flex items-center gap-1 truncate">
											<Swords className="size-3 shrink-0 text-ink/50" />
											{at.name}
										</span>
										<span className="shrink-0 tabular-nums text-ink/80">
											{signed(at.toHit)} · {at.damage} {at.damageType}
										</span>
									</li>
								))}
						</ul>
						{sheet.attacksPerAction > 1 && <div className="mt-1 text-xs text-ink/60 italic">{sheet.attacksPerAction} attacks per Attack action</div>}
					</Block>

					{sheet.spellcasting.length > 0 && ch.spellcasting && (
						<Block title="Spellcasting">
							{sheet.spellcasting.map((s) => (
								<div key={s.classId} className="text-sm">
									<span className="capitalize">{getClass(s.classId)?.name ?? s.classId}</span> ({s.ability.toUpperCase()}): save DC <b>{s.saveDc}</b>, attack <b>{signed(s.attackBonus)}</b>
									{s.preparedLimit !== undefined && <span className="text-ink/60"> · prepares {s.preparedLimit}</span>}
								</div>
							))}
							<SpellList label="Cantrips" ids={ch.spellcasting.classes.flatMap((x) => x.cantrips)} />
							<SpellList label="Spells" ids={[...new Set(ch.spellcasting.classes.flatMap((x) => [...x.known, ...x.prepared]))]} />
							{ch.spellcasting.slots.some(Boolean) && (
								<div className="mt-1 text-xs text-ink/70">
									Slots:{" "}
									{ch.spellcasting.slots
										.map((n, i) => (n ? `L${i + 1}×${n}` : ""))
										.filter(Boolean)
										.join(" · ")}
								</div>
							)}
							{ch.spellcasting.pact && <div className="text-xs text-ink/70">Pact slots: {ch.spellcasting.pact.max} × level {ch.spellcasting.pact.level}</div>}
						</Block>
					)}

					{!compact && (
						<>
							<Block title="Skills">
								<div className="grid grid-cols-2 gap-x-3 text-[13px]">
									{Object.entries(sheet.skills).map(([id, s]) => (
										<div key={id} className={cn("flex justify-between", s.proficient ? "font-semibold text-[#5a3c0e]" : "text-ink/55")}>
											<span>
												{s.expertise ? "◆ " : s.proficient ? "● " : ""}
												{getSkill(id)?.name ?? id}
											</span>
											<span className="tabular-nums">{signed(s.mod)}</span>
										</div>
									))}
								</div>
								<div className="mt-1 text-xs text-ink/60">Passive Perception {sheet.passivePerception}</div>
							</Block>
							<Block title="Features">
								<div className="flex flex-wrap gap-1">
									{ch.features.map((f) => (
										<Tooltip key={f.id + f.source} content={<p>{f.description.slice(0, 400)}</p>}>
											<span className="cursor-help rounded border border-[#b89b68]/70 bg-white/30 px-1.5 py-0.5 text-xs">{f.name}</span>
										</Tooltip>
									))}
								</div>
							</Block>
							<Block title="Proficiencies">
								<p className="text-xs leading-relaxed text-ink/80">
									<b>Languages:</b> {ch.languages.join(", ") || "—"}
									<br />
									<b>Tools:</b> {ch.tools.join(", ").replace(/-/g, " ") || "—"}
									<br />
									<b>Armor:</b> {ch.armorProf.join(", ") || "—"} · <b>Weapons:</b> {ch.weaponProf.join(", ").replace(/-/g, " ") || "—"}
								</p>
							</Block>
							<Block title="Equipment">
								<p className="text-xs leading-relaxed text-ink/80">
									{ch.inventory.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name}${i.equipped ? " (equipped)" : ""}`).join(", ")}
									{ch.currency.gp ? ` · ${ch.currency.gp} gp` : ""}
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
	if (!ids.length) return null;
	return (
		<div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
			<span className="text-ink/60">{label}:</span>
			{ids.map((id) => (
				<Tooltip key={id} content={describeOption(id)}>
					<span className="cursor-help rounded border border-[#b89b68]/70 bg-white/30 px-1.5 py-0.5">{getSpell(id)?.name ?? id}</span>
				</Tooltip>
			))}
		</div>
	);
}
