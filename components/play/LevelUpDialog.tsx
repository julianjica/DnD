"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle } from "lucide-react";
import type { GameState } from "@/lib/game/types";
import { Modal } from "./Modal";
import { useT } from "@/components/i18n/I18nProvider";
import { useEngineText } from "@/components/i18n/useEngineText";
import { Tooltip } from "@/components/ui/Tooltip";
import { describeOption } from "@/components/setup/ChoicePicker";
import { choiceLabel } from "@/components/setup/i18n";
import { SPIRIT_ASPECTS } from "@/lib/rules/character/spiritAspects";
import { getFeature, getSubclass } from "@/lib/srd";

/** Hover details for a level-up option: a subclass shows its flavor and every feature by level; spells/features/skills use the wizard's descriptions. */
function OptionTip({ index }: { index: string }) {
	const { lang, ts, t, ruleset } = useT();
	const aspect = SPIRIT_ASPECTS.find((a) => a.id === index);
	if (aspect) return <span>{ts(aspect.description)}</span>;
	const sub = getSubclass(index);
	if (!sub) return <>{describeOption(index, lang, ruleset) ?? null}</>;
	return (
		<div className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto text-left">
			<div className="font-display text-sm text-gold-2">
				{ts(sub.name)} {sub.homebrew && <span className="ml-1 rounded border border-line px-1 text-[9px] tracking-wider text-faint uppercase">{t("play.lvl.homebrew")}</span>}
			</div>
			<p className="text-[12px] text-dim italic">{ts(sub.description)}</p>
			{sub.features.map((g) => (
				<div key={g.level}>
					<div className="text-[10px] tracking-widest text-faint uppercase">{t("play.lvl.atLevel", { n: g.level })}</div>
					{g.features.map((fi) => {
						const f = getFeature(fi);
						if (!f) return null;
						const d = ts(f.description);
						return (
							<p key={fi} className="text-[12px] leading-snug">
								<strong>{ts(f.name)}.</strong> {d.length > 260 ? `${d.slice(0, 260)}…` : d}
							</p>
						);
					})}
				</div>
			))}
		</div>
	);
}

interface Ref { index: string; name: string }
interface Opt { id: string; label: string; choose: number; options: Ref[] }
interface Options { classId: string; newClassLevel: number; newTotalLevel: number; averageHp: number; hitDie: number; features: { index: string; name: string; description?: string }[]; choices: Opt[]; multiclass: { ok: boolean; reasons: string[] } }

export function LevelUpDialog({ id, state, onClose, onDone }: { id: string; state: GameState; onClose: () => void; onDone: () => void }) {
	const { t, te, ts, lang, ruleset } = useT();
	const { le } = useEngineText();
	const [classId, setClassId] = useState(state.character.classes[0].classId);
	const [data, setData] = useState<{ options: Options; classes: Ref[] } | null>(null);
	const [picks, setPicks] = useState<Record<string, string[]>>({});
	const [hp, setHp] = useState<"average" | "roll">("average");
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		fetch(`/api/campaigns/${id}/levelup?classId=${classId}`, { cache: "no-store" })
			.then((r) => r.json())
			.then((d) => {
				if (!live) return;
				if (d.error) setErr(d.error);
				else {
					setErr(null);
					setData(d);
					setPicks({});
				}
			});
		return () => {
			live = false;
		};
	}, [id, classId]);

	const toggle = (c: Opt, idx: string) =>
		setPicks((p) => {
			const cur = p[c.id] ?? [];
			if (cur.includes(idx)) return { ...p, [c.id]: cur.filter((x) => x !== idx) };
			if (c.choose === 1) return { ...p, [c.id]: [idx] };
			if (cur.length >= c.choose) return p;
			return { ...p, [c.id]: [...cur, idx] };
		});

	const submit = async () => {
		setBusy(true);
		setErr(null);
		const r = await fetch(`/api/campaigns/${id}/levelup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classId, choices: picks, hp }) });
		const d = await r.json();
		setBusy(false);
		if (!r.ok) return setErr(d.error ?? t("play.lvl.failed"));
		onDone();
		onClose();
	};

	const o = data?.options;
	return (
		<Modal title={t("play.lvl.title")} onClose={onClose} wide>
			{data && (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm text-dim">{t("play.lvl.class")}</span>
						{data.classes.map((c) => (
							<button key={c.index} className="chip" data-active={classId === c.index} onClick={() => setClassId(c.index)}>
								{te("class", c.index)}
							</button>
						))}
					</div>
					{o && (
						<>
							<div className="parchment p-4">
								<div className="font-display text-lg">
									{t("play.lvl.heading", { cls: te("class", o.classId), n: o.newClassLevel })} <span className="text-sm opacity-70">{t("play.lvl.charLevel", { n: o.newTotalLevel })}</span>
								</div>
								<div className="mt-2 flex items-center gap-3 text-sm">
									{t("play.lvl.hp")}
									<label className="flex items-center gap-1"><input type="radio" checked={hp === "average"} onChange={() => setHp("average")} /> {t("play.lvl.average", { n: o.averageHp })}</label>
									<label className="flex items-center gap-1"><input type="radio" checked={hp === "roll"} onChange={() => setHp("roll")} /> {t("play.lvl.roll", { n: o.hitDie })}</label>
								</div>
								{o.features.length > 0 && (
									<ul className="mt-3 space-y-1 font-serif text-sm">
										{o.features.map((f) => (
											<li key={f.index}><strong>{ts(f.name)}</strong>{f.description ? ` — ${ts(f.description).slice(0, 220)}${ts(f.description).length > 220 ? "…" : ""}` : ""}</li>
										))}
									</ul>
								)}
							</div>
							{o.choices.map((c) => (
								<div key={c.id}>
									<div className="mb-1.5 text-sm">
										{choiceLabel(c, t, { cls: te("class", o.classId) }, lang, ruleset)} <span className="text-faint">{t("play.lvl.choose", { n: c.choose, k: (picks[c.id] ?? []).length })}</span>
									</div>
									<div className="flex flex-wrap gap-1.5">
										{c.options.map((op) => (
											<Tooltip key={op.index} content={<OptionTip index={op.index} />} widthClass="max-w-md" side="bottom">
												<button className="chip" data-active={(picks[c.id] ?? []).includes(op.index)} onClick={() => toggle(c, op.index)}>
													{c.id === "spirit-aspect" ? ts(op.name) : le(op.name)}
												</button>
											</Tooltip>
										))}
									</div>
								</div>
							))}
							<p className="text-xs text-faint">{t("play.lvl.defaults")}</p>
						</>
					)}
					{err && <p className="text-sm text-crimson-2">{le(err)}</p>}
					<button className="btn btn-gold w-full justify-center" disabled={busy || !o} onClick={submit}>
						<ArrowUpCircle size={16} /> {t("play.lvl.submit")}
					</button>
				</div>
			)}
			{!data && !err && <p className="text-dim">{t("play.lvl.loading")}</p>}
			{!data && err && <p className="text-crimson-2">{le(err)}</p>}
		</Modal>
	);
}
