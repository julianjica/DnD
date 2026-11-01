"use client";

import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { AmbienceTrack, Mood, PortraitSpec, RollRecord, SceneKind, SceneState, TimeOfDay, Weather } from "@/lib/game/types";
import { SceneArt, type SceneNpc } from "@/components/art/SceneArt";
import { Portrait } from "@/components/art/Portrait";
import { DiceTray, type DiceTrayHandle } from "@/components/dice/DiceTray";
import { DiceLog } from "@/components/dice/DiceLog";
import AmbiencePlayer, { playSfx } from "@/components/audio/AmbiencePlayer";
import { AMBIENCE_TRACKS, SFX_NAMES } from "@/lib/audio/ambience";
import { MOODS, SCENE_KINDS, SCENE_PROPS, TIMES, WEATHERS } from "@/lib/art/scene";
import { randomPortrait, SPECIES_IDS } from "@/lib/art/portrait";
import { Rng, newSeed, roll } from "@/lib/rules/dice";

const NPC_NAMES = ["Brannoc", "Ysolde", "Old Marn", "Kethra", "Thistle", "Grukk"];

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
	return (
		<label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-stone-400">
			{label}
			<select className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-sm normal-case tracking-normal text-stone-100" value={value} onChange={(e) => onChange(e.target.value as T)}>
				{options.map((o) => (
					<option key={o} value={o}>
						{o}
					</option>
				))}
			</select>
		</label>
	);
}

export default function ArtDevPage() {
	const [kind, setKind] = useState<SceneKind>("forest");
	const [time, setTime] = useState<TimeOfDay>("dusk");
	const [weather, setWeather] = useState<Weather>("clear");
	const [mood, setMood] = useState<Mood>("calm");
	const [title, setTitle] = useState("The Whispering Wood");
	const [props, setProps] = useState<string[]>([]);
	const [showNpcs, setShowNpcs] = useState(true);
	const [species, setSpecies] = useState<string>("any");
	const [portraitSeed, setPortraitSeed] = useState(1234);
	const [rolls, setRolls] = useState<RollRecord[]>([]);
	const [track, setTrack] = useState<AmbienceTrack>("forest");
	const [music, setMusic] = useState(0.6);
	const [sfx, setSfx] = useState(0.8);
	const [muted, setMuted] = useState(false);
	const tray = useRef<DiceTrayHandle>(null);
	const rng = useRef<Rng | null>(null);

	const portraits = useMemo(() => {
		const r = new Rng(portraitSeed);
		return Array.from({ length: 18 }, (_, i) => {
			const sp = species === "any" ? SPECIES_IDS[i % SPECIES_IDS.length] : species;
			return { sp, spec: randomPortrait(r, sp) as PortraitSpec };
		});
	}, [portraitSeed, species]);

	const npcs: SceneNpc[] = portraits.slice(0, 3).map((p, i) => ({ id: `npc${i}`, name: NPC_NAMES[i], portrait: p.spec, speciesId: p.sp, role: ["innkeeper", "ranger", "hermit"][i] }));

	const scene: SceneState = {
		title,
		kind,
		timeOfDay: time,
		weather,
		mood,
		caption: "A procedural scene preview — move the mouse for parallax.",
		npcIds: showNpcs ? npcs.map((n) => n.id) : [],
		props,
	};

	const doRoll = (notation: string, label: string, adv?: "advantage" | "disadvantage", target?: number) => {
		rng.current ??= new Rng(newSeed());
		const rec = roll(rng.current, notation, { label, advantage: adv, attack: notation.startsWith("1d20"), target });
		setRolls((rs) => [rec, ...rs].slice(0, 30));
		playSfx("dice");
		void tray.current?.roll(rec);
	};

	return (
		<main className="min-h-screen bg-stone-950 px-4 py-6 text-stone-100 sm:px-8">
			<h1 className="font-serif text-3xl text-amber-100">DungeonHarness · Art & Presentation</h1>
			<p className="mt-1 text-sm text-stone-400">Dev preview of procedural scenes, portraits, 3D dice and ambience.</p>

			{/* ── Scene ── */}
			<section className="mt-6 grid gap-4 lg:grid-cols-[1fr_280px]">
				<SceneArt scene={scene} npcs={npcs} className="rounded-lg shadow-2xl ring-1 ring-stone-800" />
				<div className="flex flex-col gap-3">
					<label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-stone-400">
						Title (seed)
						<input className="rounded border border-stone-700 bg-stone-900 px-2 py-1 text-sm normal-case tracking-normal" value={title} onChange={(e) => setTitle(e.target.value)} />
					</label>
					<Select label="Kind" value={kind} options={SCENE_KINDS} onChange={setKind} />
					<Select label="Time of day" value={time} options={TIMES} onChange={setTime} />
					<Select label="Weather" value={weather} options={WEATHERS} onChange={setWeather} />
					<Select label="Mood" value={mood} options={MOODS} onChange={setMood} />
					<label className="flex items-center gap-2 text-sm text-stone-300">
						<input type="checkbox" checked={showNpcs} onChange={(e) => setShowNpcs(e.target.checked)} /> NPC portraits
					</label>
					<div className="text-xs uppercase tracking-wider text-stone-400">Props</div>
					<div className="flex flex-wrap gap-1">
						{SCENE_PROPS.map((p) => (
							<button
								key={p}
								onClick={() => setProps((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p].slice(-5)))}
								className={clsx("rounded px-1.5 py-0.5 text-[11px]", props.includes(p) ? "bg-amber-700 text-amber-50" : "bg-stone-800 text-stone-300 hover:bg-stone-700")}
							>
								{p}
							</button>
						))}
					</div>
				</div>
			</section>

			<h2 className="mt-8 font-serif text-xl text-amber-100">All kinds · {time}</h2>
			<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
				{SCENE_KINDS.map((k) => (
					<button key={k} onClick={() => setKind(k)} className={clsx("overflow-hidden rounded text-left ring-1", k === kind ? "ring-amber-500" : "ring-stone-800 hover:ring-stone-600")}>
						<SceneArt scene={{ ...scene, kind: k, npcIds: [], props: [], title: `${k}` }} animate={false} parallax={false} showCaption={false} />
						<div className="bg-stone-900 px-2 py-1 text-xs text-stone-300">{k}</div>
					</button>
				))}
			</div>

			<h2 className="mt-8 font-serif text-xl text-amber-100">{kind} · all times</h2>
			<div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
				{TIMES.map((t) => (
					<button key={t} onClick={() => setTime(t)} className="overflow-hidden rounded text-left ring-1 ring-stone-800">
						<SceneArt scene={{ ...scene, timeOfDay: t, npcIds: [] }} animate={false} parallax={false} showCaption={false} />
						<div className="bg-stone-900 px-2 py-1 text-xs text-stone-300">{t}</div>
					</button>
				))}
			</div>

			{/* ── Portraits ── */}
			<section className="mt-10">
				<div className="flex flex-wrap items-end gap-3">
					<h2 className="font-serif text-xl text-amber-100">Portraits</h2>
					<Select label="Species" value={species} options={["any", ...SPECIES_IDS]} onChange={setSpecies} />
					<button className="rounded bg-amber-700 px-3 py-1.5 text-sm hover:bg-amber-600" onClick={() => setPortraitSeed(newSeed())}>
						Randomize
					</button>
				</div>
				<div className="mt-3 flex flex-wrap gap-3">
					{portraits.map((p, i) => (
						<div key={i} className="flex flex-col items-center gap-1">
							<Portrait spec={p.spec} speciesId={p.sp} size={128} />
							<div className="max-w-32 truncate text-[11px] text-stone-400" title={JSON.stringify(p.spec)}>
								{p.sp} · {p.spec.hairStyle} · {p.spec.accessory}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* ── Dice ── */}
			<section className="mt-10 grid gap-4 lg:grid-cols-[1fr_360px]">
				<div>
					<h2 className="font-serif text-xl text-amber-100">Dice</h2>
					<div className="mt-3 flex flex-wrap gap-2">
						<button className="rounded bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700" onClick={() => doRoll("1d20+5", "Attack with advantage vs AC 15", "advantage", 15)}>
							1d20+5 adv
						</button>
						<button className="rounded bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700" onClick={() => doRoll("1d20+2", "DEX save (disadvantage) vs DC 14", "disadvantage", 14)}>
							1d20+2 dis
						</button>
						<button className="rounded bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700" onClick={() => doRoll("8d6", "Fireball damage")}>
							8d6
						</button>
						<button className="rounded bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700" onClick={() => doRoll("4d6kh3", "Ability score")}>
							4d6kh3
						</button>
						<button className="rounded bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700" onClick={() => doRoll("1d100", "Wild magic surge")}>
							d100
						</button>
						<button className="rounded bg-stone-800 px-3 py-1.5 text-sm hover:bg-stone-700" onClick={() => doRoll("1d4+1d6+1d8+1d10+1d12+1d20", "Every die")}>
							d4–d20
						</button>
					</div>
				</div>
				<DiceLog rolls={rolls} max={8} />
			</section>

			{/* ── Audio ── */}
			<section className="mt-10 pb-16">
				<h2 className="font-serif text-xl text-amber-100">Audio</h2>
				<div className="mt-3 flex flex-wrap items-start gap-4">
					<AmbiencePlayer track={track} musicVolume={music} sfxVolume={sfx} muted={muted} onMutedChange={setMuted} onMusicVolumeChange={setMusic} onSfxVolumeChange={setSfx} />
					<div>
						<div className="text-xs uppercase tracking-wider text-stone-400">Ambience</div>
						<div className="mt-1 flex flex-wrap gap-1">
							{AMBIENCE_TRACKS.map((t) => (
								<button key={t} onClick={() => setTrack(t)} className={clsx("rounded px-2 py-1 text-xs", t === track ? "bg-amber-700" : "bg-stone-800 hover:bg-stone-700")}>
									{t}
								</button>
							))}
						</div>
						<div className="mt-3 text-xs uppercase tracking-wider text-stone-400">SFX</div>
						<div className="mt-1 flex flex-wrap gap-1">
							{SFX_NAMES.map((s) => (
								<button key={s} onClick={() => playSfx(s)} className="rounded bg-stone-800 px-2 py-1 text-xs hover:bg-stone-700">
									{s}
								</button>
							))}
						</div>
					</div>
				</div>
			</section>

			<DiceTray ref={tray} />
		</main>
	);
}
