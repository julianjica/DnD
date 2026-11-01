"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Trash2, Save } from "lucide-react";
import { Modal } from "./Modal";
import { useT } from "@/components/i18n/I18nProvider";

interface Slot { slot: string; label: string; savedAt: number; sceneTitle: string; day: number; auto: boolean }

export function SavesDialog({ id, onClose, onLoaded }: { id: string; onClose: () => void; onLoaded: () => void }) {
	const { t, lang } = useT();
	const [saves, setSaves] = useState<Slot[]>([]);
	const [label, setLabel] = useState("");
	const [err, setErr] = useState<string | null>(null);
	const load = useCallback(async () => {
		const r = await fetch(`/api/campaigns/${id}/saves`, { cache: "no-store" });
		setSaves((await r.json()).saves ?? []);
	}, [id]);
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
		void load();
	}, [load]);
	const op = async (body: object) => {
		setErr(null);
		const r = await fetch(`/api/campaigns/${id}/saves`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
		const d = await r.json();
		if (!r.ok) setErr(d.error ?? t("play.saves.failed"));
		return r.ok;
	};
	return (
		<Modal title={t("play.saves.title")} onClose={onClose}>
			<form
				className="mb-4 flex gap-2"
				onSubmit={async (e) => {
					e.preventDefault();
					if (await op({ op: "save", slot: `s${Date.now()}`, label: label.trim() || t("play.saves.manual") })) {
						setLabel("");
						void load();
					}
				}}
			>
				<input className="input" placeholder={t("play.saves.placeholder")} value={label} onChange={(e) => setLabel(e.target.value)} />
				<button className="btn btn-gold"><Save size={15} /> {t("common.save")}</button>
			</form>
			{err && <p className="mb-3 text-sm text-crimson-2">{err}</p>}
			<div className="space-y-1.5">
				{saves.length === 0 && <p className="text-sm text-dim">{t("play.saves.empty")}</p>}
				{saves.map((s) => (
					<div key={s.slot} className="flex items-center gap-3 rounded-lg border border-line bg-bg-2/60 px-3 py-2">
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm">{s.label}</div>
							<div className="text-xs text-faint">{t("play.day", { n: s.day })} · {s.sceneTitle} · {new Date(s.savedAt).toLocaleString(lang)}</div>
						</div>
						<button
							className="btn px-2 py-1 text-sm"
							title={t("play.saves.loadTitle")}
							onClick={async () => {
								if (!confirm(t("play.saves.confirmLoad"))) return;
								if (await op({ op: "load", slot: s.slot })) {
									onLoaded();
									onClose();
								}
							}}
						>
							<Download size={14} /> {t("play.saves.load")}
						</button>
						<button className="text-faint hover:text-crimson-2" title={t("play.saves.delete")} aria-label={t("play.saves.delete")} onClick={async () => (await op({ op: "delete", slot: s.slot })) && load()}>
							<Trash2 size={15} />
						</button>
					</div>
				))}
			</div>
		</Modal>
	);
}
