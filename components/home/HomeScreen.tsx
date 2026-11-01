"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Dices, LoaderCircle, Plus, Settings, Trash2 } from "lucide-react";
import type { CampaignSummary } from "@/lib/store/campaigns";
import type { SceneState } from "@/lib/game/types";
import { SceneArt } from "@/components/art/SceneArt";
import { Modal } from "@/components/ui/Modal";
import { Divider } from "@/components/ui/Divider";
import { cn } from "@/components/ui/cn";
import { CampaignCard } from "./CampaignCard";

const HERO_SCENES: SceneState[] = [
	{ title: "", kind: "tavern", timeOfDay: "night", weather: "clear", mood: "festive", npcIds: [], props: [] },
	{ title: "", kind: "castle", timeOfDay: "dusk", weather: "clear", mood: "mysterious", npcIds: [], props: [] },
	{ title: "", kind: "forest", timeOfDay: "night", weather: "fog", mood: "eerie", npcIds: [], props: [] },
	{ title: "", kind: "coast", timeOfDay: "dawn", weather: "clear", mood: "calm", npcIds: [], props: ["ship"] },
];
const ROTATE_MS = 14000;

export function HomeScreen() {
	const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [toDelete, setToDelete] = useState<CampaignSummary | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [now, setNow] = useState(0);
	const [heroIdx, setHeroIdx] = useState(0);
	const [prevIdx, setPrevIdx] = useState<number | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await fetch("/api/campaigns", { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const j = (await res.json()) as { campaigns: CampaignSummary[] };
			setCampaigns(j.campaigns);
			setNow(Date.now());
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setCampaigns([]);
		}
	}, []);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void load();
	}, [load]);

	useEffect(() => {
		if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
		let cur = 0;
		const t = setInterval(() => {
			setPrevIdx(cur);
			cur = (cur + 1) % HERO_SCENES.length;
			setHeroIdx(cur);
		}, ROTATE_MS);
		return () => clearInterval(t);
	}, []);

	const confirmDelete = async () => {
		if (!toDelete) return;
		setDeleting(true);
		try {
			const res = await fetch(`/api/campaigns/${encodeURIComponent(toDelete.id)}`, { method: "DELETE" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setCampaigns((cs) => cs?.filter((c) => c.id !== toDelete.id) ?? null);
			setToDelete(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className="flex min-h-screen flex-col">
			<section className="relative isolate h-[68vh] min-h-[460px] overflow-hidden border-b border-gold/30">
				<div className="absolute inset-0 -z-10 bg-black">
					{HERO_SCENES.map((s, i) =>
						i === heroIdx || i === prevIdx ? (
							<div key={i} className={cn("dh-hero-layer absolute top-1/2 left-1/2 w-[max(100%,calc(max(68vh,460px)*16/9))] -translate-x-1/2 -translate-y-1/2", i === heroIdx ? "dh-hero-in" : "dh-hero-out")}>
								<SceneArt scene={s} showCaption={false} />
							</div>
						) : null,
					)}
				</div>
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(0_0_0/0.15)_0%,rgb(0_0_0/0.55)_65%,rgb(0_0_0/0.85)_100%)]" />
				<div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />

				<nav className="absolute top-0 right-0 z-10 p-5">
					<Link href="/settings" className="btn bg-black/40 backdrop-blur-sm">
						<Settings className="size-4" /> Settings
					</Link>
				</nav>

				<div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
					<div className="mb-3 flex items-center gap-3 text-gold/80">
						<span className="h-px w-16 bg-gradient-to-r from-transparent to-gold/80" />
						<Dices className="size-5" />
						<span className="h-px w-16 bg-gradient-to-l from-transparent to-gold/80" />
					</div>
					<h1 className="font-display text-[clamp(2.6rem,7vw,5.5rem)] leading-none font-bold tracking-[0.08em] text-gold-2 drop-shadow-[0_4px_24px_rgb(0_0_0/0.9)]">DungeonHarness</h1>
					<p className="mt-4 max-w-2xl font-fell text-[clamp(1.05rem,2vw,1.4rem)] text-parchment/90 italic drop-shadow-[0_2px_8px_rgb(0_0_0/0.9)]">An AI Dungeon Master for solo adventures in the world of fifth edition.</p>
					<Link href="/new" className="btn btn-gold mt-8 px-7 py-3 text-lg shadow-[0_0_40px_rgb(212_166_74/0.35)]">
						<Plus className="size-5" /> New Adventure
					</Link>
				</div>
			</section>

			<main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
				<Divider label="Your Chronicles" className="mb-8" />
				{campaigns === null ? (
					<div className="flex items-center justify-center gap-2 py-12 text-dim">
						<LoaderCircle className="size-5 animate-spin text-gold" /> Gathering your tales…
					</div>
				) : campaigns.length === 0 ? (
					<div className="parchment mx-auto max-w-lg p-8 text-center">
						<p className="font-fell text-xl text-ink/80 italic">No tales have been written yet.</p>
						<p className="mt-2 font-serif text-ink/70">Every legend begins with a single step out of the tavern door.</p>
						<Link href="/new" className="btn btn-gold mt-5">
							<Plus className="size-4" /> Begin your first adventure
						</Link>
					</div>
				) : (
					<div className="grid gap-4 md:grid-cols-2">
						{campaigns.map((c) => (
							<CampaignCard key={c.id} c={c} now={now} onDelete={() => setToDelete(c)} />
						))}
					</div>
				)}
				{error && (
					<p className="mt-4 flex items-center justify-center gap-2 text-sm text-crimson-2" role="alert">
						<AlertTriangle className="size-4" /> {error}
					</p>
				)}
			</main>

			<footer className="py-6 text-center text-xs text-faint">
				Uses the D&amp;D 5e System Reference Document 5.1 under CC-BY-4.0. Art and maps are procedurally generated.
			</footer>

			<Modal
				open={!!toDelete}
				onClose={() => !deleting && setToDelete(null)}
				title="Delete this campaign?"
				footer={
					<>
						<button type="button" className="btn" onClick={() => setToDelete(null)} disabled={deleting}>
							Keep it
						</button>
						<button type="button" className="btn btn-danger" onClick={() => void confirmDelete()} disabled={deleting}>
							{deleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete forever
						</button>
					</>
				}
			>
				<p className="text-dim">
					<span className="font-display text-gold-2">{toDelete?.title}</span> and all of {toDelete?.characterName}&apos;s saves, journal and history will be permanently erased.
				</p>
			</Modal>

			<style>{`
				.dh-hero-in { animation: dh-hero-in 2.4s ease both; }
				.dh-hero-out { animation: dh-hero-out 2.4s ease both; }
				@keyframes dh-hero-in { from { opacity: 0; } to { opacity: 1; } }
				@keyframes dh-hero-out { from { opacity: 1; } to { opacity: 0; } }
				@media (prefers-reduced-motion: reduce) { .dh-hero-in, .dh-hero-out { animation: none; } }
			`}</style>
		</div>
	);
}
