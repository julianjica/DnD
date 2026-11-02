"use client";

import { useEffect, useMemo, useState } from "react";
import type { Character, Npc, PortraitSpec } from "@/lib/game/types";
import { Portrait } from "@/components/art/Portrait";
import { PortraitLegacy } from "@/components/art/PortraitLegacy";
import { randomPortrait, SPECIES_IDS } from "@/lib/art/portrait";
import { Rng } from "@/lib/rules/dice";

/** Dev preview of the procedural portraits (read-only; only GETs campaign data). */

type Row = { key: string; name: string; role: string; speciesId?: string; spec: PortraitSpec };

const AGES = [0.08, 0.3, 0.55, 0.85];

function section(only: string | null, s: string) {
	return !only || only === s;
}

export default function PortraitsDevPage() {
	const [seed, setSeed] = useState(1);
	const [only, setOnly] = useState<string | null>(null);
	const [pick, setPick] = useState<number[]>([]);
	const [rows, setRows] = useState<{ title: string; rows: Row[] }[]>([]);

	useEffect(() => {
		const q = new URLSearchParams(window.location.search);
		/* eslint-disable react-hooks/set-state-in-effect -- read the URL once on mount */
		if (q.get("seed")) setSeed(Number(q.get("seed")));
		setOnly(q.get("only"));
		if (q.get("pick")) setPick(q.get("pick")!.split(",").map(Number));
		/* eslint-enable react-hooks/set-state-in-effect */
		let live = true;
		if (q.get("only") && q.get("only") !== "campaigns") return;
		(async () => {
			const list = (await (await fetch("/api/campaigns")).json()) as { campaigns: { id: string; title: string }[] };
			const out: { title: string; rows: Row[] }[] = [];
			for (const c of list.campaigns) {
				const res = await fetch(`/api/campaigns/${c.id}`);
				if (!res.ok) continue;
				const { state } = (await res.json()) as { state: { character: Character; npcs: Record<string, Npc> } };
				const pc = state.character;
				out.push({
					title: c.title,
					rows: [
						{ key: `${c.id}-pc`, name: pc.name, role: `PC · ${pc.speciesId}`, speciesId: pc.speciesId, spec: pc.portrait },
						...Object.values(state.npcs ?? {}).map((n) => ({ key: n.id, name: n.name, role: `${n.role} · ${n.speciesId ?? "human"}`, speciesId: n.speciesId, spec: n.portrait })),
					],
				});
			}
			if (live) setRows(out);
		})().catch(() => {});
		return () => {
			live = false;
		};
	}, []);

	const grid = useMemo(() => {
		const r = new Rng(seed);
		return Array.from({ length: 40 }, (_, i) => {
			const sp = SPECIES_IDS[i % SPECIES_IDS.length];
			const p = randomPortrait(r, sp);
			const gender: "female" | "male" = i % 2 ? "female" : "male";
			return { sp, spec: { ...p, gender, facialHair: gender === "female" ? "none" : p.facialHair, age: AGES[Math.floor(i / 2) % 4] } as PortraitSpec };
		});
	}, [seed]);

	const faces = useMemo(() => {
		const r = new Rng(seed * 7 + 3);
		const ex = ["neutral", "smile", "stern", "worried", "smirk", "angry", "sad", "neutral"] as const;
		const cl = ["tunic", "armor", "robe", "leather", "cloak", "noble", "armor", "tunic"] as const;
		return Array.from({ length: 8 }, (_, i) => {
			const p = randomPortrait(r, "human");
			const gender: "female" | "male" = i % 2 ? "female" : "male";
			return {
				sp: "human",
				spec: { ...p, gender, facialHair: gender === "female" ? "none" : p.facialHair, age: [0.15, 0.15, 0.35, 0.35, 0.6, 0.6, 0.9, 0.9][i], expression: ex[i], clothingStyle: cl[i], accessory: "none" } as PortraitSpec,
			};
		});
	}, [seed]);

	const variants = useMemo(() => {
		const r = new Rng(seed * 13 + 5);
		const sigs = ["mug", "holy_symbol", "staff", "book", "pipe", "lantern", "dagger", "quill", "feathered_hat", "wizard_hat", "flower", "bird", "amulet"] as const;
		const accs = ["hood", "helmet", "circlet", "crown", "headband", "eyepatch", "scar", "warpaint", "earrings"];
		const out: { sp: string; label: string; spec: PortraitSpec }[] = [];
		sigs.forEach((sg, i) => {
			const sp = SPECIES_IDS[i % SPECIES_IDS.length];
			out.push({ sp, label: `${sp} · ${sg}`, spec: { ...randomPortrait(r, sp), accessory: "none", signature: sg } });
		});
		accs.forEach((a, i) => {
			const sp = SPECIES_IDS[(i + 3) % SPECIES_IDS.length];
			out.push({ sp, label: `${sp} · ${a}`, spec: { ...randomPortrait(r, sp), accessory: a } });
		});
		return out;
	}, [seed]);

	return (
		<main className="min-h-screen bg-stone-950 p-6 text-stone-200">
			<div className="mb-4 flex items-center gap-3">
				<h1 className="font-serif text-2xl text-amber-200">Portraits</h1>
				<button type="button" className="rounded border border-stone-600 px-2 py-1 text-sm" onClick={() => setSeed((s) => s + 1)}>
					Reroll (seed {seed})
				</button>
			</div>

			{only === "zoom" && (
				<div className="flex flex-wrap gap-3">
					{(pick.length ? pick : [0, 1]).map((i) => (
						<Portrait key={i} spec={faces[i % 8].spec} speciesId="human" size={440} />
					))}
				</div>
			)}

			{section(only, "faces") && (
				<section className="mb-10">
					<h2 className="mb-2 text-lg text-amber-100">Humans · ages and expressions</h2>
					<div className="flex flex-wrap gap-3">
						{faces.map((g, i) => (
							<div key={i} className="flex flex-col items-center text-[10px] text-stone-400">
								<Portrait spec={g.spec} speciesId={g.sp} size={240} />
								<span>
									{g.sp} · {g.spec.expression} · {g.spec.build} · {g.spec.clothingStyle} · {g.spec.hairStyle}
								</span>
							</div>
						))}
					</div>
				</section>
			)}

			{section(only, "variants") && (
				<section className="mb-10">
					<h2 className="mb-2 text-lg text-amber-100">Signatures · headwear · marks</h2>
					<div className="flex flex-wrap gap-3">
						{variants.map((g, i) => (
							<div key={i} className="flex flex-col items-center text-[10px] text-stone-400">
								<Portrait spec={g.spec} speciesId={g.sp} size={150} />
								<span>{g.label}</span>
							</div>
						))}
					</div>
				</section>
			)}

			{section(only, "grid") && (
				<section className="mb-10">
					<h2 className="mb-2 text-lg text-amber-100">Random · all species, genders, ages</h2>
					<div className="flex flex-wrap gap-3">
						{grid.map((g, i) => (
							<div key={i} className="flex flex-col items-center text-[10px] text-stone-400">
								<Portrait spec={g.spec} speciesId={g.sp} size={140} />
								<span>
									{g.sp} · {g.spec.gender?.[0]} · {g.spec.age}
								</span>
							</div>
						))}
					</div>
				</section>
			)}

			{section(only, "sizes") && (
				<section className="mb-10">
					<h2 className="mb-2 text-lg text-amber-100">Sizes 48 / 56 / 80 / 160 / 240</h2>
					{grid.slice(0, 4).map((g, i) => (
						<div key={i} className="mb-3 flex items-end gap-3">
							{[48, 56, 80, 160, 240].map((s) => (
								<Portrait key={s} spec={g.spec} speciesId={g.sp} size={s} framed={s > 56} name={s >= 160 ? "Brannoc Vell" : undefined} />
							))}
						</div>
					))}
				</section>
			)}

			{section(only, "campaigns") &&
				rows.map((c) => (
					<section key={c.title} className="mb-10">
						<h2 className="mb-2 text-lg text-amber-100">{c.title}</h2>
						<div className="flex flex-wrap gap-5">
							{c.rows.map((r) => (
								<div key={r.key} className="flex w-[330px] flex-col items-center gap-1">
									<div className="flex gap-2">
										<PortraitLegacy spec={r.spec} speciesId={r.speciesId} size={160} />
										<Portrait spec={r.spec} speciesId={r.speciesId} size={160} />
									</div>
									<div className="text-sm text-amber-100">{r.name}</div>
									<div className="text-center text-xs text-stone-400">{r.role}</div>
								</div>
							))}
						</div>
					</section>
				))}
		</main>
	);
}
