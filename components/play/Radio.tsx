"use client";

import { useState } from "react";
import { Radio as RadioIcon } from "lucide-react";
import type { GameState, RadioStation } from "@/lib/game/types";
import { STATIONS, radioAccess } from "@/lib/rules/radio";
import { useT } from "@/components/i18n/I18nProvider";
import type { MessageKey } from "@/lib/i18n";

/** The Quiet: tune the radio and reread what you've heard. */
export function RadioTab({ state, busy, listen }: { state: GameState; busy: boolean; listen?: (station: RadioStation, label: string) => void }) {
	const { t } = useT();
	const access = radioAccess(state);
	const [station, setStation] = useState<RadioStation>("fm1017");
	const log = [...(state.radio?.log ?? [])].reverse();
	const name = (s: RadioStation) => t(`play.radio.station.${s}` as MessageKey);
	const clock = (at: number) => `${String(Math.floor((at % 1440) / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
	return (
		<div className="space-y-4" data-testid="radio-tab">
			<section className="rounded-lg border border-line bg-bg-2/60 p-3">
				<div className="mb-2 flex items-center gap-2">
					<RadioIcon size={16} className="text-gold" />
					<h3 className="heading text-base">{t("play.radio.title")}</h3>
					{access && <span className="ml-auto text-xs text-faint">{t(`play.radio.via.${access}` as MessageKey)}</span>}
				</div>
				{!access ? (
					<p className="text-sm text-dim">{t("play.radio.none")}</p>
				) : (
					<>
						<div className="grid grid-cols-3 gap-1.5" role="radiogroup">
							{STATIONS.map((s) => (
								<button
									key={s}
									role="radio"
									aria-checked={station === s}
									onClick={() => setStation(s)}
									className={`rounded-md border px-2 py-2 text-left text-xs transition ${station === s ? "border-gold/70 bg-gold/10 text-gold-2" : "border-line text-dim hover:border-gold/40"}`}
								>
									<div className="font-semibold">{name(s)}</div>
									<div className="mt-0.5 text-[10px] leading-tight text-faint">{t(`play.radio.hint.${s}` as MessageKey)}</div>
								</button>
							))}
						</div>
						<button className="btn btn-gold mt-3 w-full justify-center" disabled={busy || !listen} onClick={() => listen?.(station, t("play.radio.playerLine", { station: name(station) }))}>
							<RadioIcon size={15} /> {t("play.radio.listen")}
						</button>
					</>
				)}
			</section>
			<section>
				<h4 className="mb-2 text-xs uppercase tracking-widest text-faint">{t("play.radio.heard")}</h4>
				{log.length === 0 ? (
					<p className="text-sm italic text-faint">{t("play.radio.nothing")}</p>
				) : (
					<ul className="space-y-2.5">
						{log.map((b) => (
							<li key={b.id} className="rounded-md border border-line/70 bg-black/20 p-2.5">
								<div className="mb-1 flex justify-between text-[11px] text-faint">
									<span className="font-semibold text-dim">{name(b.station)}</span>
									<span>{t("play.radio.when", { d: Math.floor(b.at / 1440), time: clock(b.at) })}</span>
								</div>
								<p className="whitespace-pre-line font-mono text-[12.5px] leading-relaxed text-text/90">{b.text}</p>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
