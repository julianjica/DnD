"use client";

import { useEffect, useState } from "react";
import { ArrowUpCircle } from "lucide-react";
import type { GameState } from "@/lib/game/types";
import { Modal } from "./Modal";

interface Ref { index: string; name: string }
interface Opt { id: string; label: string; choose: number; options: Ref[] }
interface Options { classId: string; newClassLevel: number; newTotalLevel: number; averageHp: number; hitDie: number; features: { index: string; name: string; description?: string }[]; choices: Opt[]; multiclass: { ok: boolean; reasons: string[] } }

export function LevelUpDialog({ id, state, onClose, onDone }: { id: string; state: GameState; onClose: () => void; onDone: () => void }) {
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
		if (!r.ok) return setErr(d.error ?? "Level up failed");
		onDone();
		onClose();
	};

	const o = data?.options;
	return (
		<Modal title="Level Up" onClose={onClose} wide>
			{data && (
				<div className="space-y-4">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm text-dim">Class:</span>
						{data.classes.map((c) => (
							<button key={c.index} className="chip" data-active={classId === c.index} onClick={() => setClassId(c.index)}>
								{c.name}
							</button>
						))}
					</div>
					{o && (
						<>
							<div className="parchment p-4">
								<div className="font-display text-lg">
									{o.classId} level {o.newClassLevel} <span className="text-sm opacity-70">(character level {o.newTotalLevel})</span>
								</div>
								<div className="mt-2 flex items-center gap-3 text-sm">
									Hit points:
									<label className="flex items-center gap-1"><input type="radio" checked={hp === "average"} onChange={() => setHp("average")} /> +{o.averageHp} (average)</label>
									<label className="flex items-center gap-1"><input type="radio" checked={hp === "roll"} onChange={() => setHp("roll")} /> roll d{o.hitDie}</label>
								</div>
								{o.features.length > 0 && (
									<ul className="mt-3 space-y-1 font-serif text-sm">
										{o.features.map((f) => (
											<li key={f.index}><strong>{f.name}</strong>{f.description ? ` — ${f.description.slice(0, 220)}${f.description.length > 220 ? "…" : ""}` : ""}</li>
										))}
									</ul>
								)}
							</div>
							{o.choices.map((c) => (
								<div key={c.id}>
									<div className="mb-1.5 text-sm">
										{c.label} <span className="text-faint">(choose {c.choose}; {(picks[c.id] ?? []).length} picked)</span>
									</div>
									<div className="flex flex-wrap gap-1.5">
										{c.options.map((op) => (
											<button key={op.index} className="chip" data-active={(picks[c.id] ?? []).includes(op.index)} onClick={() => toggle(c, op.index)}>
												{op.name}
											</button>
										))}
									</div>
								</div>
							))}
							<p className="text-xs text-faint">Unpicked choices are filled with sensible defaults.</p>
						</>
					)}
					{err && <p className="text-sm text-crimson-2">{err}</p>}
					<button className="btn btn-gold w-full justify-center" disabled={busy || !o} onClick={submit}>
						<ArrowUpCircle size={16} /> Level up
					</button>
				</div>
			)}
			{!data && !err && <p className="text-dim">Consulting the tomes…</p>}
			{!data && err && <p className="text-crimson-2">{err}</p>}
		</Modal>
	);
}
