"use client";

import { useEffect, useState } from "react";
import type { CampaignSettings, Effort, GameState, ModelOption } from "@/lib/game/types";
import { Modal } from "./Modal";

function Seg<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
	return (
		<div className="flex flex-wrap gap-1">
			{options.map((o) => (
				<button key={o} type="button" className="chip capitalize" data-active={value === o} onClick={() => onChange(o)}>
					{o.replace(/_/g, " ")}
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

	const set = <K extends keyof CampaignSettings>(k: K, v: Partial<CampaignSettings[K]>) => setS((p) => ({ ...p, [k]: { ...p[k], ...v } }));
	const engineModels = models.filter((m) => m.provider === s.engine.provider && (s.engine.provider !== "api" || !s.engine.apiProvider || m.apiProvider === s.engine.apiProvider));

	return (
		<Modal title="Campaign Settings" onClose={onClose} side>
			<div className="space-y-5">
				<Field label="Title">
					<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
				</Field>
				<div className="divider-ornate" />
				<h3 className="heading text-sm">Dungeon Master</h3>
				<Field label="Engine" hint="Changing engine or model starts a fresh DM session; the state digest keeps continuity.">
					<Seg value={s.engine.provider} options={["claude-code", "codex", "api"] as const} onChange={(provider) => set("engine", { provider, model: models.find((m) => m.provider === provider && m.available)?.id ?? s.engine.model })} />
				</Field>
				<Field label="Model">
					<select className="input" value={`${s.engine.apiProvider ?? ""}|${s.engine.model}`} onChange={(e) => {
						const [apiProvider, model] = e.target.value.split("|");
						set("engine", { model, apiProvider: apiProvider || undefined });
					}}>
						{engineModels.length === 0 && <option value={`|${s.engine.model}`}>{s.engine.model}</option>}
						{engineModels.map((m) => (
							<option key={`${m.apiProvider}|${m.id}`} value={`${m.apiProvider ?? ""}|${m.id}`} disabled={!m.available}>
								{m.label}{m.available ? "" : ` — ${m.reason ?? "unavailable"}`}
							</option>
						))}
					</select>
				</Field>
				<Field label="Reasoning effort">
					<Seg value={s.engine.effort} options={EFFORTS} onChange={(effort) => set("engine", { effort })} />
				</Field>
				<Field label="Narration">
					<Seg value={s.dm.verbosity} options={["terse", "balanced", "rich"] as const} onChange={(verbosity) => set("dm", { verbosity })} />
				</Field>
				<Field label="Rules">
					<Seg value={s.dm.rulesStrictness} options={["loose", "standard", "strict"] as const} onChange={(rulesStrictness) => set("dm", { rulesStrictness })} />
				</Field>
				<Field label="Combat frequency">
					<Seg value={s.dm.combatFrequency} options={["low", "medium", "high"] as const} onChange={(combatFrequency) => set("dm", { combatFrequency })} />
				</Field>
				<Field label="Player rolls">
					<Seg value={s.dm.autoRollPlayer ? "automatic" : "I roll"} options={["automatic", "I roll"] as const} onChange={(v) => set("dm", { autoRollPlayer: v === "automatic" })} />
				</Field>
				<Field label="DM persona">
					<textarea className="input" rows={2} value={s.dm.persona ?? ""} onChange={(e) => set("dm", { persona: e.target.value })} placeholder="e.g. A wry, grizzled storyteller who loves foreshadowing" />
				</Field>
				<div className="divider-ornate" />
				<h3 className="heading text-sm">Campaign</h3>
				<Field label="Difficulty">
					<Seg value={s.structure.difficulty} options={["story", "easy", "normal", "hard", "deadly"] as const} onChange={(difficulty) => set("structure", { difficulty })} />
				</Field>
				<Field label="Format">
					<Seg value={s.structure.format} options={["one_shot", "short_campaign", "long_campaign"] as const} onChange={(format) => set("structure", { format })} />
				</Field>
				<Field label="Leveling">
					<Seg value={s.structure.leveling} options={["xp", "milestone"] as const} onChange={(leveling) => set("structure", { leveling })} />
				</Field>
				<Field label="Tone (comma separated)">
					<input className="input" value={s.world.tone.join(", ")} onChange={(e) => set("world", { tone: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
				</Field>
				<Field label="Lines — never include (one per line)">
					<textarea className="input" rows={2} value={s.world.lines.join("\n")} onChange={(e) => set("world", { lines: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
				</Field>
				<Field label="Veils — fade to black (one per line)">
					<textarea className="input" rows={2} value={s.world.veils.join("\n")} onChange={(e) => set("world", { veils: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} />
				</Field>
				<Field label="World notes">
					<textarea className="input" rows={3} value={s.world.customText ?? ""} onChange={(e) => set("world", { customText: e.target.value })} />
				</Field>
				<div className="divider-ornate" />
				<h3 className="heading text-sm">Audio</h3>
				<label className="flex items-center gap-2 text-sm">
					<input type="checkbox" checked={s.audio.enabled} onChange={(e) => set("audio", { enabled: e.target.checked })} /> Music &amp; sound effects
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
					Save changes
				</button>
			</div>
		</Modal>
	);
}
