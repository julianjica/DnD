"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { FxItem } from "./useGame";
import { useT } from "@/components/i18n/I18nProvider";

/** How long a caption stays (significant ones a little longer: the DM is about to speak). */
const LIFE = 7000;
const LIFE_SIGNIFICANT = 9500;

/**
 * Captions for things the player walked up to on the map (engine "discover"
 * fx): short, readable, fading. Each discovery shows once; the log keeps it.
 */
export function DiscoveryToasts({ fx }: { fx: FxItem[] }) {
	const { t } = useT();
	const [shown, setShown] = useState<FxItem[]>([]);
	const seen = useRef<Set<string> | null>(null);
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

	useEffect(() => {
		// Fx from before this panel mounted are old news.
		if (!seen.current) {
			seen.current = new Set(fx.map((f) => f.id));
			return;
		}
		const fresh = fx.filter((f) => f.kind === "discover" && !seen.current!.has(f.id));
		for (const f of fx) seen.current.add(f.id);
		if (!fresh.length) return;
		setShown((s) => [...s, ...fresh].slice(-3));
		for (const f of fresh) timers.current.push(setTimeout(() => setShown((s) => s.filter((x) => x.id !== f.id)), f.significant ? LIFE_SIGNIFICANT : LIFE));
	}, [fx]);

	useEffect(() => () => timers.current.forEach(clearTimeout), []);

	if (!shown.length) return null;
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex flex-col items-center gap-2 px-4" aria-live="polite" data-testid="discoveries">
			<style>{`@keyframes dh-discover{0%{opacity:0;transform:translateY(10px) scale(.98)}7%{opacity:1;transform:none}82%{opacity:1}100%{opacity:0;transform:translateY(-4px)}}`}</style>
			{shown.map((f) => (
				<div
					key={f.id}
					className={`w-full max-w-md rounded-lg border bg-bg/90 px-4 py-2.5 shadow-2xl backdrop-blur ${f.significant ? "border-gold/70" : "border-gold/30"}`}
					style={{ animation: `dh-discover ${f.significant ? LIFE_SIGNIFICANT : LIFE}ms ease forwards`, boxShadow: f.significant ? "0 0 24px rgba(212,166,74,.25)" : undefined }}
					data-testid="discovery-caption"
				>
					<div className="flex items-center gap-1.5 font-display text-[11px] uppercase tracking-widest text-gold-2">
						<Sparkles size={12} /> {f.name}
					</div>
					<div className="mt-0.5 font-serif text-[1.02rem] italic leading-snug text-parchment">{f.text}</div>
					{f.item && <div className="mt-1 text-xs text-gold-2">{t("play.discover.got", { item: f.item })}</div>}
				</div>
			))}
		</div>
	);
}
