"use client";

import { useEffect, useState } from "react";
import type { CampaignSettings, Effort, GameState, ModelOption } from "@/lib/game/types";
import { Modal } from "./Modal";
import { LANGS } from "@/lib/i18n";
import { useT } from "@/components/i18n/I18nProvider";

/** Segmented choice; labels come from the "enum.<group>.<id>" dictionary. */
function Seg<T extends string>({ group, value, options, onChange }: { group: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
	const { te } = useT();
	return (
		<div className="flex flex-wrap gap-1">
			{options.map((o) => (
				<button key={o} type="button" className="chip" data-active={value === o} onClick={() => onChange(o)}>
					{te(group, o)}
				</button>
			))}
		</div>
	);
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
	return (
		<div className="space-y-1.5">
			<div className="text-xs uppercase tracking-widest text-faint">{label}</div>
			{children}
			{hint && <p className="text-xs text-faint">{hint}</p>}
		</div>
	);
}

const EFFORTS: Effort[] = ["off", "low", "medium", "high", "xhigh", "max"];

export function SettingsDrawer({ state, onClose, onSave }: { state: GameState; onClose: () => void; onSave: (s: Partial<CampaignSettings>, title?: string) => Promise<void> }) {
	const { t } = useT();
	const [s, setS] = useState<CampaignSettings>(structuredClone(state.settings));
	const [title, setTitle] = useState(state.title);
	const [models, setModels] = useState<ModelOption[]>([]);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		fetch("/api/engines", { cache: "no-store" })
			.then((r) => r.json())
			.then((d) => setModels(d.models ?? []))
			.catch(() => undefined);
	}, []);

	const set = <K extends Exclude<keyof CampaignSettings, "language">>(k: K, v: Partial<CampaignSettings[K]>) => setS((p) => ({ ...p, [k]: { ...p[k], ...v } }));
	const engineModels = models.filter((m) => m.provider === s.engine.provider && (s.engine.provider !== "api" || !s.engine.apiProvider || m.apiProvider === s.engine.apiProvider));

	return (
		<Modal title={t("play.set.title")} onClose={onClose} side>
			<div className="space-y-5">
				<Field label={t("play.set.campaignTitle")}>
					<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
				</Field>
				<Field label={t("play.set.language")} hint={t("play.set.languageHint")}>
					<div className="flex flex-wrap gap-1">
						{LANGS.map((l) => (
							<button key={l.id} type="button" className="chip" data-active={(s.language ?? "en") === l.id} onClick={() => setS((p) => ({ ...p, language: l.id }))}>
								{l.label}
							</button>
						))}
					</div>
				</Field>
				<div className="divider-ornate" />
				<h3 className="heading text-sm">{t("play.set.dm")}</h3>
				<Field label={t("play.set.engine")} hint={t("play.set.engineHint")}>
					<Seg group="provider" value={s.engine.provider} options={["claude-code", "codex", "api"] as const} onChange={(provider) => set("engine", { provider, model: models.find((m) => m.provider === provider && m.available)?.id ?? s.engine.model })} />
				</Field>
				<Field label={t("play.set.model")}>
					<select className="input" value={`${s.engine.apiProvider ?? ""}|${s.engine.model}`} onChange={(e) => {
						const [apiProvider, model] = e.target.value.split("|");
						set("engine", { model, apiProvider: apiProvider || undefined });
					}}>
						{engineModels.length === 0 && <option value={`|${s.engine.model}`}>{s.engine.model}</option>}
						{engineModels.map((m) => (
							<option key={`${m.apiProvider}|${m.id}`} value={`${m.apiProvider ?? ""}|${m.id}`} disabled={!m.available}>
								{m.label}{m.available ? "" : ` — ${m.reason ?? t("play.set.unavailable")}`}
							</option>
						))}
					</select>
				</Field>
				<Field label={t("play.set.effort")}>
					<Seg group="effort" value={s.engine.effort} options={EFFORTS} onChange={(effort) => set("engine", { effort })} />
				</Field>
				<Field label={t("play.set.narration")}>
					<Seg group="verbosity" value={s.dm.verbosity} options={["terse", "balanced", "rich"] as const} onChange={(verbosity) => set("dm", { verbosity })} />
				</Field>
				<Field label={t("play.set.rules")}>
					<Seg group="strictness" value={s.dm.rulesStrictness} options={["loose", "standard", "strict"] as const} onChange={(rulesStrictness) => set("dm", { rulesStrictness })} />
				</Field>
				<Field label={t("play.set.combatFrequency")}>
					<Seg group="frequency" value={s.dm.combatFrequency} options={["low", "medium", "high"] as const} onChange={(combatFrequency) => set("dm", { combatFrequency })} />
				</Field>
				<Field label={t("play.set.playerRolls")}>
					<Seg group="autoRoll" value={s.dm.autoRollPlayer ? "auto" : "manual"} options={["auto", "manual"] as const} onChange={(v) => set("dm", { autoRollPlayer: v === "auto" })} />
				</Field>
				<Field label={t("play.set.persona")}>
					<textarea className="input" rows={2} value={s.dm.persona ?? ""} onChange={(e) => set("dm", { persona: e.target.value })} placeholder={t("play.set.personaPlaceholder")} />
				</Field>
				<div className="divider-ornate" />
				<h3 className="heading text-sm">{t("play.set.campaign")}</h3>
				<Field label={t("play.set.difficulty")}>
					<Seg group="difficulty" value={s.structure.difficulty} options={["story", "easy", "normal", "hard", "deadly"] as const} onChange={(difficulty) => set("structure", { difficulty })} />
				</Field>
				<Field label={t("play.set.format")}>
					<Seg group="format" value={s.structure.format} options={["one_shot", "short_campaign", "long_campaign"] as const} onChange={(format) => set("structure", { format })} />
				</Field>
				<Field label={t("play.set.leveling")}>
					<Seg group="leveling" value={s.structure.leveling} options={["xp", "milestone"] as const} onChange={(leveling) => set("structure", { leveling })} />
				</Field>
				<Field label={t("play.set.tone")}>
					<input className="input" value={s.world.tone.join(", ")} onChange={(e) => set("world", { tone: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
				</Field>
				<Field label={t("play.set.lines")}>
					<textarea className="input" rows={2} value={s.world.lines.join("\n")} onChange={(e) => set("world", { lines: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
				</Field>
				<Field label={t("play.set.veils")}>
					<textarea className="input" rows={2} value={s.world.veils.join("\n")} onChange={(e) => set("world", { veils: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
				</Field>
				<Field label={t("play.set.worldNotes")}>
					<textarea className="input" rows={3} value={s.world.customText ?? ""} onChange={(e) => set("world", { customText: e.target.value })} />
				</Field>
				<div className="divider-ornate" />
				<h3 className="heading text-sm">{t("play.set.audio")}</h3>
				<label className="flex items-center gap-2 text-sm">
					<input type="checkbox" checked={s.audio.enabled} onChange={(e) => set("audio", { enabled: e.target.checked })} /> {t("play.set.audioEnabled")}
				</label>
				<button
					className="btn btn-gold w-full justify-center"
					disabled={saving}
					onClick={async () => {
						setSaving(true);
						await onSave(s, title);
						setSaving(false);
						onClose();
					}}
				>
					{t("play.set.saveChanges")}
				</button>
			</div>
		</Modal>
	);
}
