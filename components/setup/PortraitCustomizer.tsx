"use client";

import { Dices } from "lucide-react";
import type { PortraitSpec } from "@/lib/game/types";
import { BACKGROUND_COLORS, portraitOptions, randomPortrait, skinTonesFor } from "@/lib/art/portrait";
import { Rng, newSeed } from "@/lib/rules/dice";
import { Portrait } from "@/components/art/Portrait";
import { cn } from "@/components/ui/cn";
import { FieldLabel } from "./Field";
import { useT } from "@/components/i18n/I18nProvider";


export function newPortrait(speciesId: string): PortraitSpec {
	return randomPortrait(new Rng(newSeed()), speciesId);
}

export function PortraitCustomizer({ spec, speciesId, name, onChange }: { spec: PortraitSpec; speciesId: string; name?: string; onChange: (p: PortraitSpec) => void }) {
	const set = (patch: Partial<PortraitSpec>) => onChange({ ...spec, ...patch });
	const { t, te } = useT();
	const pretty = (id: string) => te("portrait", id);
	const skins = skinTonesFor(speciesId);
	const toggleFeature = (f: string) => set({ features: spec.features.includes(f) ? spec.features.filter((x) => x !== f) : [...spec.features, f] });

	return (
		<div className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
			<div className="flex flex-col items-center gap-3">
				<Portrait spec={spec} speciesId={speciesId} size={180} name={name || undefined} />
				<div className="flex gap-2">
					<button type="button" className="btn btn-gold py-1.5 text-sm" onClick={() => onChange(newPortrait(speciesId))}>
						<Dices className="size-4" /> {t("portrait.randomize")}
					</button>
					<button type="button" className="btn py-1.5 text-sm" onClick={() => set({ seed: newSeed() })} title={t("portrait.newFaceTitle")}>
						{t("portrait.newFace")}
					</button>
				</div>
			</div>
			<div className="grid content-start gap-4 sm:grid-cols-2">
				<Swatches label={t("portrait.skin")} values={skins} value={spec.skinTone} onPick={(v) => set({ skinTone: v })} />
				<Swatches label={t("portrait.hairColor")} values={portraitOptions.hairColor} value={spec.hairColor} onPick={(v) => set({ hairColor: v })} />
				<Swatches label={t("portrait.eyes")} values={portraitOptions.eyeColor} value={spec.eyeColor} onPick={(v) => set({ eyeColor: v })} />
				<div>
					<FieldLabel>{t("portrait.backdrop")}</FieldLabel>
					<div className="flex flex-wrap gap-1.5">
						{portraitOptions.background.map((b) => (
							<button
								key={b}
								type="button"
								title={pretty(b)}
								aria-label={`${t("portrait.backdrop")}: ${pretty(b)}`}
								aria-pressed={spec.background === b}
								onClick={() => set({ background: b })}
								className={cn("size-6 rounded-full border-2 transition-transform hover:scale-110", spec.background === b ? "border-gold-2 ring-2 ring-gold/40" : "border-black/40")}
								style={{ background: `linear-gradient(135deg, ${BACKGROUND_COLORS[b]?.[0] ?? "#555"}, ${BACKGROUND_COLORS[b]?.[1] ?? "#111"})` }}
							/>
						))}
					</div>
				</div>
				<SelectField label={t("portrait.hairStyle")} pretty={pretty} value={spec.hairStyle} values={portraitOptions.hairStyle} onPick={(v) => set({ hairStyle: v })} />
				<SelectField label={t("portrait.facialHair")} pretty={pretty} value={spec.facialHair ?? "none"} values={portraitOptions.facialHair} onPick={(v) => set({ facialHair: v })} />
				<SelectField label={t("portrait.accessory")} pretty={pretty} value={spec.accessory ?? "none"} values={portraitOptions.accessory} onPick={(v) => set({ accessory: v })} />
				<div className="sm:col-span-2">
					<FieldLabel>{t("portrait.features")}</FieldLabel>
					<div className="flex flex-wrap gap-1.5">
						{portraitOptions.features
							.filter((f) => f !== "whiskers_none")
							.map((f) => (
								<button key={f} type="button" className="chip py-0.5 text-xs" data-active={spec.features.includes(f)} aria-pressed={spec.features.includes(f)} onClick={() => toggleFeature(f)}>
									{pretty(f)}
								</button>
							))}
					</div>
				</div>
			</div>
		</div>
	);
}

function Swatches({ label, values, value, onPick }: { label: string; values: readonly string[]; value: string; onPick: (v: string) => void }) {
	return (
		<div>
			<FieldLabel>{label}</FieldLabel>
			<div className="flex flex-wrap gap-1.5">
				{values.map((c) => (
					<button
						key={c}
						type="button"
						aria-label={`${label} ${c}`}
						aria-pressed={value === c}
						onClick={() => onPick(c)}
						className={cn("size-6 rounded-full border-2 transition-transform hover:scale-110", value === c ? "border-gold-2 ring-2 ring-gold/40" : "border-black/40")}
						style={{ background: c }}
					/>
				))}
			</div>
		</div>
	);
}

function SelectField({ label, value, values, onPick, pretty }: { label: string; value: string; values: readonly string[]; onPick: (v: string) => void; pretty: (id: string) => string }) {
	return (
		<div>
			<FieldLabel>{label}</FieldLabel>
			<select className="input py-1.5 text-sm" value={value} onChange={(e) => onPick(e.target.value)} aria-label={label}>
				{values.map((v) => (
					<option key={v} value={v}>
						{pretty(v)}
					</option>
				))}
			</select>
		</div>
	);
}
