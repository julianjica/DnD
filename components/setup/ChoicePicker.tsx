"use client";

import { useState, type ReactNode } from "react";
import { Search, Sparkles, Wand2, X } from "lucide-react";
import type { OptionChoice } from "@/lib/srd";
import { getFeature, getLanguage, getSkill, getSpell, getEquipment } from "@/lib/srd";
import { autoPick } from "@/lib/rules/character";
import { Tooltip } from "@/components/ui/Tooltip";
import { cn } from "@/components/ui/cn";

const ORD = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

function clip(s: string, n = 420) {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Rich hover description for any SRD option (spell, feature, skill, language, item). */
export function describeOption(index: string): ReactNode {
	const sp = getSpell(index);
	if (sp)
		return (
			<div className="flex flex-col gap-1">
				<div className="font-display text-sm text-gold-2">{sp.name}</div>
				<div className="text-[11px] text-dim italic">
					{sp.level === 0 ? `${sp.school} cantrip` : `${ORD[sp.level]}-level ${sp.school}`}
					{sp.concentration ? " · concentration" : ""}
					{sp.ritual ? " · ritual" : ""}
				</div>
				<div className="text-[11px] text-dim">
					{sp.castingTime} · {sp.range} · {sp.duration}
				</div>
				<p>{clip(sp.description)}</p>
			</div>
		);
	const f = getFeature(index);
	if (f)
		return (
			<div>
				<div className="mb-1 font-display text-sm text-gold-2">{f.name}</div>
				<p>{clip(f.description)}</p>
			</div>
		);
	const sk = getSkill(index);
	if (sk)
		return (
			<div>
				<div className="mb-1 font-display text-sm text-gold-2">
					{sk.name} <span className="text-[11px] text-dim uppercase">({sk.ability})</span>
				</div>
				<p>{clip(sk.description)}</p>
			</div>
		);
	const lang = getLanguage(index);
	if (lang)
		return (
			<div>
				<div className="font-display text-sm text-gold-2">{lang.name}</div>
				<p className="text-dim">
					{lang.type} language{lang.script ? ` · ${lang.script} script` : ""}
					{lang.speakers.length ? ` · spoken by ${lang.speakers.join(", ")}` : ""}
				</p>
			</div>
		);
	const eq = getEquipment(index);
	if (eq?.description) return <p>{clip(eq.description)}</p>;
	return null;
}

const ABILITY_LABEL: Record<string, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export interface ChoicePickerProps {
	choice: OptionChoice;
	value: string[] | undefined;
	onChange: (picks: string[] | undefined) => void;
}

/** "Choose N of these" picker with descriptions on hover, search for long lists and an auto-pick button. */
export function ChoicePicker({ choice, value, onChange }: ChoicePickerProps) {
	const [q, setQ] = useState("");
	const picks = (value ?? []).filter((p) => choice.options.some((o) => o.index === p));
	const full = picks.length >= choice.choose;
	const isSpell = choice.options.length > 0 && !!getSpell(choice.options[0].index);
	const options = q ? choice.options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase())) : choice.options;
	const toggle = (idx: string) => {
		if (picks.includes(idx)) onChange(picks.filter((p) => p !== idx));
		else if (choice.choose === 1) onChange([idx]);
		else if (!full) onChange([...picks, idx]);
	};
	const complete = picks.length === choice.choose;

	return (
		<fieldset className="rounded-lg border border-line bg-bg-2/50 p-4">
			<legend className="sr-only">{choice.label}</legend>
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<span className="font-display text-sm tracking-wide text-text">{choice.label}</span>
				<span className={cn("rounded-full px-2 py-0.5 text-[11px] tabular-nums", complete ? "bg-emerald/20 text-emerald" : "bg-panel-3 text-dim")}>
					{picks.length}/{choice.choose}
				</span>
				{!complete && (
					<span className="inline-flex items-center gap-1 text-[11px] text-faint italic">
						<Sparkles className="size-3" /> the DM picks the rest
					</span>
				)}
				<span className="ml-auto flex gap-1">
					<button type="button" className="btn px-2 py-1 text-xs" onClick={() => onChange(autoPick(choice.options, choice.choose, isSpell ? "spell" : "plain"))} title="Pick recommended options">
						<Wand2 className="size-3.5" /> Suggest
					</button>
					{picks.length > 0 && (
						<button type="button" className="btn px-2 py-1 text-xs" onClick={() => onChange(undefined)} title="Clear">
							<X className="size-3.5" />
						</button>
					)}
				</span>
			</div>
			{choice.options.length > 18 && (
				<div className="relative mb-3">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
					<input className="input py-1.5 pl-8 text-sm" placeholder={`Search ${choice.options.length} options…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${choice.label}`} />
				</div>
			)}
			<div className={cn("flex flex-wrap gap-1.5", choice.options.length > 30 && "max-h-64 overflow-y-auto pr-1")}>
				{options.map((o) => {
					const on = picks.includes(o.index);
					const sp = isSpell ? getSpell(o.index) : undefined;
					return (
						<Tooltip key={o.index} content={describeOption(o.index)}>
							<button
								type="button"
								aria-pressed={on}
								disabled={!on && full && choice.choose !== 1}
								onClick={() => toggle(o.index)}
								className="chip transition-colors hover:border-gold/70 focus-visible:outline-2 focus-visible:outline-gold disabled:opacity-35"
								data-active={on}
							>
								{ABILITY_LABEL[o.index] ?? o.name}
								{sp && sp.level > 0 && <span className="text-[10px] text-faint">{ORD[sp.level]}</span>}
							</button>
						</Tooltip>
					);
				})}
				{options.length === 0 && <span className="text-sm text-faint">No matches.</span>}
			</div>
		</fieldset>
	);
}
