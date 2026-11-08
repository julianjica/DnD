"use client";

import { useMemo, useState } from "react";
import { Footprints, Radio as RadioIcon, Send, Undo2 } from "lucide-react";
import type { Expedition, ExpeditionGoal, GameState } from "@/lib/game/types";
import { EXPEDITION_GOALS, expeditionEta } from "@/lib/rules/expeditions";
import { useT } from "@/components/i18n/I18nProvider";
import { displayPlace, type MessageKey } from "@/lib/i18n";

export interface ExpeditionActions {
	busy: boolean;
	send?: (body: { op: "send"; members: string[]; locationId: string; goal: ExpeditionGoal; note?: string; label: string }) => void;
	recall?: (body: { op: "recall"; expeditionId: string; label: string }) => void;
}

const clock = (at: number) => `${String(Math.floor((at % 1440) / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;

/** The Quiet: plan runs for companions and follow the ones out there (as far as the walkie tells). */
export function ExpeditionsSection({ state, actions }: { state: GameState; actions: ExpeditionActions }) {
	const { t, lang } = useT();
	const place = (id?: string) => {
		const n = state.world.locations.find((l) => l.id === id)?.name ?? id ?? "?";
		return lang === "en" ? n : displayPlace(lang, n);
	};
	const survivors = Object.values(state.group?.survivors ?? {});
	const ready = survivors.filter((s) => (s.status === "with_party" || s.status === "at_base") && s.hp > 0);
	const out = (state.group?.expeditions ?? []).filter((e) => e.stage !== "back");
	const recent = (state.group?.expeditions ?? []).filter((e) => e.stage === "back").slice(-2);
	const [open, setOpen] = useState(false);
	const [members, setMembers] = useState<string[]>([]);
	const [target, setTarget] = useState("");
	const [goal, setGoal] = useState<ExpeditionGoal>("scavenge");
	const [note, setNote] = useState("");
	const picked = ready.filter((s) => members.includes(s.npcId));
	const origin = picked.length && picked.every((s) => s.status === "at_base") ? state.group?.base?.locationId : state.world.currentLocationId;
	const mixed = picked.length > 1 && picked.some((s) => s.status !== picked[0].status);
	const places = state.world.locations.filter((l) => l.discovered && l.id !== origin);
	const eta = useMemo(() => (origin && target ? expeditionEta(state, origin, target, goal) : undefined), [state, origin, target, goal]);
	const name = (id: string) => state.npcs[id]?.name ?? id;
	const now = state.time.day * 1440 + state.time.hour * 60 + state.time.minute;
	const can = !!actions.send && !actions.busy && picked.length >= 1 && picked.length <= 3 && !mixed && !!target;

	if (!ready.length && !out.length) return null;
	return (
		<section className="space-y-2" data-testid="expeditions">
			<div className="flex items-center justify-between">
				<h4 className="heading flex items-center gap-1.5 text-sm"><Footprints size={14} /> {t("exp.title")}</h4>
				{ready.length > 0 && (
					<button className="text-xs text-gold hover:text-gold-2" onClick={() => setOpen((o) => !o)}>
						{open ? t("common.cancel") : t("exp.plan")}
					</button>
				)}
			</div>

			{out.map((ex) => (
				<ExpeditionCard key={ex.id} ex={ex} place={place} name={name} now={now} actions={actions} />
			))}
			{!out.length && !open && <p className="text-xs text-faint">{t("exp.none")}</p>}

			{open && (
				<div className="space-y-2.5 rounded-lg border border-gold/30 bg-bg-2/60 p-2.5">
					<div>
						<div className="mb-1 text-[10px] uppercase tracking-wider text-faint">{t("exp.who")}</div>
						<div className="flex flex-wrap gap-1.5">
							{ready.map((s) => {
								const on = members.includes(s.npcId);
								return (
									<button
										key={s.npcId}
										onClick={() => setMembers((m) => (on ? m.filter((x) => x !== s.npcId) : m.length >= 3 ? m : [...m, s.npcId]))}
										className={`rounded-md border px-2 py-1 text-xs ${on ? "border-gold/70 bg-gold/10 text-gold-2" : "border-line text-dim hover:border-gold/40"}`}
										aria-pressed={on}
									>
										{name(s.npcId)} <span className="text-faint">· {t(`group.status.${s.status}` as MessageKey)} · {s.hp}/{s.maxHp}</span>
									</button>
								);
							})}
						</div>
						{mixed && <p className="mt-1 text-[11px] text-crimson-2">{t("exp.mixed")}</p>}
					</div>
					<label className="block">
						<span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">{t("exp.where")}</span>
						<select className="input w-full text-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
							<option value="">—</option>
							{places.map((l) => (
								<option key={l.id} value={l.id}>
									{place(l.id)}
								</option>
							))}
						</select>
					</label>
					<div>
						<div className="mb-1 text-[10px] uppercase tracking-wider text-faint">{t("exp.goal")}</div>
						<div className="grid grid-cols-2 gap-1.5">
							{EXPEDITION_GOALS.map((g) => (
								<button key={g} onClick={() => setGoal(g)} className={`rounded-md border px-2 py-1.5 text-left text-xs ${goal === g ? "border-gold/70 bg-gold/10 text-gold-2" : "border-line text-dim hover:border-gold/40"}`}>
									<div className="font-semibold">{t(`exp.goal.${g}` as MessageKey)}</div>
									<div className="text-[10px] leading-tight text-faint">{t(`exp.goalHint.${g}` as MessageKey)}</div>
								</button>
							))}
						</div>
					</div>
					<input className="input w-full text-sm" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t("exp.notePlaceholder")} />
					{eta !== undefined && <p className="text-xs text-dim">{t("exp.eta", { h: Math.max(1, Math.round(eta / 60)) })}</p>}
					<button
						className="btn btn-gold w-full justify-center"
						disabled={!can}
						onClick={() => {
							actions.send?.({ op: "send", members, locationId: target, goal, ...(note.trim() ? { note: note.trim() } : {}), label: t("exp.playerLine", { who: picked.map((s) => name(s.npcId)).join(", "), where: place(target), goal: t(`exp.goal.${goal}` as MessageKey).toLowerCase() }) });
							setOpen(false);
							setMembers([]);
							setTarget("");
							setNote("");
						}}
					>
						<Send size={14} /> {t("exp.send")}
					</button>
				</div>
			)}

			{recent.length > 0 && !out.length && (
				<p className="text-[11px] text-faint">
					{recent.map((ex) => t("exp.lastBack", { where: place(ex.targetId) })).join(" · ")}
				</p>
			)}
		</section>
	);
}

function ExpeditionCard({ ex, place, name, now, actions }: { ex: Expedition; place: (id?: string) => string; name: (id: string) => string; now: number; actions: ExpeditionActions }) {
	const { t } = useT();
	const late = ex.stage !== "lost" && now > ex.eta;
	const lastWords = ex.heard?.at(-1);
	return (
		<div className={`rounded-lg border p-2.5 text-sm ${ex.stage === "lost" ? "border-crimson/50 bg-crimson/5" : "border-sky/40 bg-sky/5"}`} data-testid="expedition-card">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="font-semibold text-text">{ex.members.map(name).join(", ")}</div>
					<div className="text-xs text-dim">
						→ {place(ex.targetId)} · {t(`exp.goal.${ex.goal}` as MessageKey)}
						{ex.note ? ` · “${ex.note}”` : ""}
					</div>
				</div>
				<span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${ex.stage === "lost" ? "border-crimson/60 text-crimson-2" : late ? "border-[#d99a2b]/60 text-[#d99a2b]" : "border-sky/50 text-sky"}`}>
					{ex.stage === "lost" ? t("exp.stage.lost") : late ? t("exp.late") : t(`exp.stage.${ex.stage}` as MessageKey)}
				</span>
			</div>
			<div className="mt-1.5 text-[11px] text-faint">
				{ex.comms ? (
					ex.lastHeardAt !== undefined && ex.lastKnownAt && ex.lastHeardAt > ex.startedAt ? t("exp.lastHeard", { where: place(ex.lastKnownAt), d: Math.floor(ex.lastHeardAt / 1440), time: clock(ex.lastHeardAt) }) : t("exp.noWordYet")
				) : (
					t("exp.noRadio")
				)}
				{" · "}
				{t("exp.expected", { d: Math.floor(ex.eta / 1440), time: clock(ex.eta) })}
			</div>
			{lastWords && (
				<p className="mt-1.5 flex gap-1.5 rounded border border-line/60 bg-black/20 p-1.5 font-mono text-[11.5px] leading-snug text-text/90">
					<RadioIcon size={12} className="mt-0.5 shrink-0 text-gold" />
					<span className="whitespace-pre-line">{lastWords.text}</span>
				</p>
			)}
			{ex.comms && ex.stage === "outbound" && !ex.recalled && actions.recall && (
				<button className="mt-2 flex items-center gap-1 text-xs text-gold hover:text-gold-2 disabled:opacity-40" disabled={actions.busy} onClick={() => actions.recall?.({ op: "recall", expeditionId: ex.id, label: t("exp.recallLine", { who: ex.members.map(name).join(", ") }) })}>
					<Undo2 size={12} /> {t("exp.recall")}
				</button>
			)}
			{ex.recalled && ex.stage === "outbound" && <p className="mt-1 text-[11px] text-dim">{t("exp.recalled")}</p>}
		</div>
	);
}
