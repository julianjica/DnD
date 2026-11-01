"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, Play, Trash2 } from "lucide-react";
import type { CampaignSummary } from "@/lib/store/campaigns";
import type { GameState } from "@/lib/game/types";
import { Portrait } from "@/components/art/Portrait";
import { SceneArt } from "@/components/art/SceneArt";
import { cn } from "@/components/ui/cn";
import { useT } from "@/components/i18n/I18nProvider";
import { displayTitle, type Lang } from "@/lib/i18n";

type Detail = Pick<GameState, "scene"> & { character: Pick<GameState["character"], "portrait" | "speciesId"> };

/** Lazily loads the campaign's state for its portrait and scene thumbnail. */
function useDetail(id: string): Detail | null {
	const [d, setD] = useState<Detail | null>(null);
	useEffect(() => {
		let alive = true;
		fetch(`/api/campaigns/${encodeURIComponent(id)}`, { cache: "no-store" })
			.then((r) => (r.ok ? (r.json() as Promise<{ state: GameState }>) : null))
			.then((j) => {
				if (alive && j?.state) setD({ scene: j.state.scene, character: { portrait: j.state.character.portrait, speciesId: j.state.character.speciesId } });
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [id]);
	return d;
}

export function relativeTime(ts: number, now: number, lang: Lang = "en"): string {
	const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
	const s = Math.max(0, Math.round((now - ts) / 1000));
	if (s < 60) return rtf.format(0, "second");
	const m = Math.round(s / 60);
	if (m < 60) return rtf.format(-m, "minute");
	const h = Math.round(m / 60);
	if (h < 24) return rtf.format(-h, "hour");
	const d = Math.round(h / 24);
	if (d < 30) return rtf.format(-d, "day");
	return new Date(ts).toLocaleDateString(lang);
}

export function CampaignCard({ c, now, onDelete }: { c: CampaignSummary; now: number; onDelete: () => void }) {
	const detail = useDetail(c.id);
	const { lang, t, te } = useT();
	// "fighter 3 / wizard 2" → "Fighter / Wizard" in the UI language.
	const classes = c.classes.replace(/\s\d+/g, "").replace(/[a-z][a-z-]*/gi, (id) => te("class", id.toLowerCase()));
	const initials = c.characterName
		.split(/\s+/)
		.map((w) => w[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
	return (
		<article className="group panel relative flex overflow-hidden transition-all hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-[0_14px_40px_rgb(0_0_0/0.5),0_0_0_1px_rgb(212_166_74/0.2)]">
			<div className="relative w-44 shrink-0 overflow-hidden bg-black">
				{detail ? (
					<div className="absolute top-1/2 left-1/2 w-[340px] -translate-x-1/2 -translate-y-1/2 opacity-70">
						<SceneArt scene={detail.scene} animate={false} parallax={false} showCaption={false} />
					</div>
				) : (
					<div className="absolute inset-0 bg-gradient-to-br from-panel-3 to-bg" />
				)}
				<div className="absolute inset-0 bg-gradient-to-r from-transparent to-panel/90" />
				<div className="absolute inset-0 grid place-items-center">
					{detail ? (
						<Portrait spec={detail.character.portrait} speciesId={detail.character.speciesId} size={92} />
					) : (
						<span className="grid size-20 place-items-center rounded-full border-2 border-gold/50 bg-bg-2 font-display text-2xl text-gold-2">{initials || "?"}</span>
					)}
				</div>
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
				<h3 className="truncate font-display text-lg tracking-wide text-gold-2">{displayTitle(lang, c.title)}</h3>
				<div className="truncate font-serif text-[15px] text-text">
					{c.characterName} <span className="text-dim">· {t("home.card.level", { level: c.characterLevel, classes })}</span>
				</div>
				<div className="truncate font-fell text-sm text-dim italic">{c.sceneTitle}</div>
				<div className="mt-auto flex items-center justify-between gap-2 pt-2">
					<span className="inline-flex items-center gap-1 text-xs text-faint">
						<Clock className="size-3" /> {relativeTime(c.updatedAt, now, lang)}
					</span>
					<div className="flex items-center gap-1.5">
						<button type="button" onClick={onDelete} className={cn("btn btn-danger p-2 opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100")} aria-label={t("home.card.deleteAria", { title: c.title })} title={t("home.card.delete")}>
							<Trash2 className="size-4" />
						</button>
						<Link href={`/play/${encodeURIComponent(c.id)}`} className="btn btn-gold py-1.5">
							<Play className="size-4" /> {t("home.card.continue")}
						</Link>
					</div>
				</div>
			</div>
		</article>
	);
}
