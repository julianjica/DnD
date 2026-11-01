"use client";

import { useState } from "react";
import type { GameState, PortraitSpec } from "@/lib/game/types";
import { PortraitCustomizer } from "@/components/setup/PortraitCustomizer";
import { useT } from "@/components/i18n/I18nProvider";
import { Modal } from "./Modal";

/** Lets the player fix how their character looks, mid-campaign (cosmetic only). */
export function PortraitDialog({ id, state, onClose, onSaved }: { id: string; state: GameState; onClose: () => void; onSaved: (s: GameState) => void }) {
	const { t } = useT();
	const [spec, setSpec] = useState<PortraitSpec>(state.character.portrait);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<Modal title={t("play.portrait.title")} onClose={onClose} wide>
			<PortraitCustomizer spec={spec} speciesId={state.character.speciesId} name={state.character.name} onChange={setSpec} />
			{error && <p className="mt-3 text-sm text-crimson-2">{error}</p>}
			<div className="mt-5 flex justify-end gap-2">
				<button className="btn" onClick={onClose}>{t("common.cancel")}</button>
				<button
					className="btn btn-gold"
					disabled={saving}
					onClick={async () => {
						setSaving(true);
						const res = await fetch(`/api/campaigns/${id}/portrait`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ portrait: spec }) });
						const data = (await res.json().catch(() => ({}))) as { state?: GameState; error?: string };
						setSaving(false);
						if (data.state) {
							onSaved(data.state);
							onClose();
						} else setError(data.error ?? `HTTP ${res.status}`);
					}}
				>
					{t("common.save")}
				</button>
			</div>
		</Modal>
	);
}
