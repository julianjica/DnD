"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState, PortraitSpec } from "@/lib/game/types";
import { Portrait } from "@/components/art/Portrait";
import { creatureCanvas } from "@/components/art/sprite/pixelScene";
import { gearFor, personLook, type PersonLook } from "@/components/art/sprite/person";

function Sprite({ look, dead = false }: { look: PersonLook; dead?: boolean }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const c = ref.current;
		if (!c) return;
		const ctx = c.getContext("2d")!;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, c.width, c.height);
		ctx.drawImage(creatureCanvas({ kind: "npc", sprite: "npc" }, look, dead), 0, 0, c.width, c.height);
	}, [look, dead]);
	return <canvas ref={ref} width={96} height={96} style={{ imageRendering: "pixelated" }} className="rounded bg-[#dde5ec]" />;
}

interface Row { name: string; spec: PortraitSpec; species?: string; look: PersonLook; note: string }

export default function PeoplePreview() {
	const [rows, setRows] = useState<{ title: string; people: Row[] }[]>([]);
	useEffect(() => {
		const ids = (new URLSearchParams(window.location.search).get("c") ?? "").split(",").filter(Boolean);
		Promise.all(ids.map((id) => fetch(`/api/campaigns/${id}`).then((r) => r.json()))).then((all: { state: GameState }[]) =>
			setRows(
				all.map(({ state }) => {
					const ch = state.character;
					const pc: Row = { name: ch.name, spec: ch.portrait, species: ch.speciesId, look: personLook(ch.portrait, ch.speciesId, gearFor({ classes: ch.classes.map((c) => c.classId) })), note: ch.classes.map((c) => c.classId).join("/") };
					const npcs = Object.values(state.npcs).map((n) => ({ name: n.name, spec: n.portrait, species: n.speciesId, look: personLook(n.portrait, n.speciesId, gearFor({ text: `${n.role ?? ""} ${n.description ?? ""}` })), note: n.role ?? "" }));
					return { title: state.title, people: [pc, ...npcs] };
				}),
			),
		);
	}, []);
	return (
		<main className="min-h-screen space-y-8 bg-stone-950 p-6 text-stone-200">
			{rows.map((g) => (
				<section key={g.title}>
					<h2 className="mb-3 font-serif text-xl">{g.title}</h2>
					<div className="grid grid-cols-4 gap-4">
						{g.people.map((p) => (
							<div key={p.name} className="flex items-center gap-2 rounded border border-stone-800 p-2">
								<Portrait spec={p.spec} speciesId={p.species} size={96} />
								<Sprite look={p.look} />
								<div className="min-w-0 text-xs">
									<div className="font-semibold">{p.name}</div>
									<div className="text-stone-400">{p.note}</div>
									<div className="text-stone-500">{p.look.hairStyle} · {p.look.facialHair} · {p.look.clothingStyle} · {p.look.gear}</div>
								</div>
							</div>
						))}
					</div>
				</section>
			))}
		</main>
	);
}
