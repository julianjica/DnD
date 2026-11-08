"use client";

import { CheckTag } from "@/components/dice/CheckTag";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dices, Send, Square, ScrollText, Sparkles, Wrench, ChevronDown } from "lucide-react";
import type { GameState, LogEntry, RollRecord } from "@/lib/game/types";
import type { LiveTurn, LiveTool } from "./useGame";
import { useT } from "@/components/i18n/I18nProvider";
import { useEngineText } from "@/components/i18n/useEngineText";

/** Minimal inline markdown: **bold**, *italic*, "quotes" styled. */
function inline(text: string): ReactNode[] {
	const out: ReactNode[] = [];
	const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|"[^"\n]{2,}")/g;
	let last = 0;
	let i = 0;
	for (const m of text.matchAll(re)) {
		if (m.index! > last) out.push(text.slice(last, m.index));
		const tok = m[0];
		if (tok.startsWith("**")) out.push(<strong key={i++} className="text-gold-2 font-semibold">{tok.slice(2, -2)}</strong>);
		else if (tok.startsWith("*") || tok.startsWith("_")) out.push(<em key={i++}>{tok.slice(1, -1)}</em>);
		else out.push(<span key={i++} className="text-parchment-2 italic">{tok}</span>);
		last = m.index! + tok.length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

export function Prose({ text, dropCap = false }: { text: string; dropCap?: boolean }) {
	const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
	return (
		<div className="narration space-y-3 text-text">
			{paras.map((p, i) =>
				/^#{1,3}\s/.test(p) ? (
					<h3 key={i} className="heading text-base">{p.replace(/^#+\s*/, "")}</h3>
				) : /^[-*]\s/m.test(p) ? (
					<ul key={i} className="list-disc pl-6 space-y-1">{p.split("\n").map((l, j) => <li key={j}>{inline(l.replace(/^[-*]\s*/, ""))}</li>)}</ul>
				) : (
					<p key={i} className={dropCap && i === 0 ? "first-letter:float-left first-letter:font-display first-letter:text-5xl first-letter:leading-[0.85] first-letter:mr-2 first-letter:mt-1 first-letter:text-gold" : ""}>
						{p.split("\n").map((line, j, arr) => (
							<span key={j}>
								{inline(line)}
								{j < arr.length - 1 && <br />}
							</span>
						))}
					</p>
				),
			)}
		</div>
	);
}

function RollChip({ roll }: { roll: RollRecord }) {
	const { le } = useEngineText();
	const nat = roll.dice.find((d) => d.sides === 20 && !d.dropped)?.value;
	const tone = roll.critical === "hit" || nat === 20 ? "border-gold text-gold-2" : roll.critical === "miss" || nat === 1 ? "border-crimson text-crimson-2" : roll.success === false ? "text-dim" : "text-text";
	return (
		<div className={`inline-flex items-center gap-2 rounded-md border border-line bg-bg-2/70 px-2.5 py-1 text-xs ${tone}`} title={roll.dice.map((d) => `d${d.sides}:${d.value}${d.dropped ? "✗" : ""}`).join(" ")}>
			<Dices size={13} className="shrink-0 opacity-80" />
			<CheckTag rec={roll} tone="theme" />
			<span className="text-dim">{le(roll.label)}</span>
			<span className="font-semibold tabular-nums">{roll.total}</span>
			{roll.target !== undefined && <span className={roll.success ? "text-emerald" : "text-crimson-2"}>{roll.success ? "✓" : "✗"} {roll.target}</span>}
		</div>
	);
}

function ToolStrip({ tools }: { tools: { name: string; summary?: string; isError?: boolean; status?: string }[] }) {
	const { t, te } = useT();
	const { tryLe } = useEngineText();
	const [open, setOpen] = useState(false);
	const shown = tools.filter((t) => !["suggest_actions", "set_ambience", "journal_note", "dm_note", "get_state"].includes(t.name));
	if (!shown.length) return null;
	return (
		<div className="mt-2 text-xs text-faint">
			<button className="inline-flex items-center gap-1 hover:text-dim" onClick={() => setOpen((o) => !o)}>
				<Wrench size={12} /> {t(shown.length === 1 ? "play.narr.engineActions1" : "play.narr.engineActions", { n: shown.length })}
				<ChevronDown size={12} className={open ? "rotate-180 transition" : "transition"} />
			</button>
			{open && (
				<ul className="mt-1 space-y-0.5 border-l border-line pl-3">
					{shown.map((tool, i) => {
						// The summary is DM-facing English: show it inline only when it translates, else as a hover title.
						const raw = tool.summary?.split("\n")[0] ?? "";
						const summary = raw ? tryLe(raw) : null;
						return (
							<li key={i} className={tool.isError ? "text-crimson-2" : ""} title={raw && summary === null ? tool.summary : undefined}>
								<span className="text-dim">{te("tool", tool.name)}</span>
								{summary ? ` — ${summary.slice(0, 140)}` : ""}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function Entry({ e }: { e: LogEntry }) {
	const { playerLine } = useEngineText();
	if (e.role === "player")
		return (
			<div className="flex justify-end">
				<div className="max-w-[85%] rounded-xl rounded-br-sm border border-gold/30 bg-gold/10 px-4 py-2 font-serif text-[1.05rem] italic text-parchment">{playerLine(e.text)}</div>
			</div>
		);
	if (e.role === "roll") return e.roll ? <RollChip roll={e.roll} /> : null;
	if (e.role === "system") return <div className="text-center text-xs uppercase tracking-widest text-faint">{e.text}</div>;
	return (
		<div>
			{e.text && <Prose text={e.text} />}
			{e.tools && <ToolStrip tools={e.tools} />}
		</div>
	);
}

function LiveView({ live }: { live: LiveTurn }) {
	const { t, te } = useT();
	const { playerLine } = useEngineText();
	const running = live.tools.filter((tool: LiveTool) => tool.status === "start");
	return (
		<div className="space-y-3">
			{live.player && (
				<div className="flex justify-end">
					<div className="max-w-[85%] rounded-xl rounded-br-sm border border-gold/30 bg-gold/10 px-4 py-2 font-serif text-[1.05rem] italic text-parchment">{playerLine(live.player)}</div>
				</div>
			)}
			{live.rolls.length > 0 && <div className="flex flex-wrap gap-1.5">{live.rolls.map((r) => <RollChip key={r.id} roll={r} />)}</div>}
			{live.text ? <Prose text={live.text} /> : null}
			<div className="flex items-center gap-2 text-sm text-dim">
				<span className="inline-flex gap-1">
					<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold [animation-delay:-0.3s]" />
					<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold [animation-delay:-0.15s]" />
					<span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold" />
				</span>
				<span className="font-fell italic">{running.length ? `${te("tool", running[running.length - 1].name)}…` : live.text ? t("play.narr.dmNarrates") : t("play.narr.dmConsiders")}</span>
			</div>
		</div>
	);
}

export function Narration(props: {
	state: GameState;
	log: LogEntry[];
	live: LiveTurn | null;
	busy: boolean;
	onSend: (text: string) => void;
	onAbort: () => void;
	onRollPending: () => void;
}) {
	const { state, log, live, busy } = props;
	const { t } = useT();
	const { le } = useEngineText();
	const [text, setText] = useState("");
	const scroller = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const userScroll = useRef(0);

	const content = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = scroller.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	}, [log, live]);
	// Stay anchored to the bottom when anything resizes after a render: the input
	// area growing (suggestions, roll button), fonts or late layout in the log.
	useEffect(() => {
		const el = scroller.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => {
			if (stick.current) el.scrollTop = el.scrollHeight;
		});
		ro.observe(el);
		if (content.current) ro.observe(content.current);
		return () => ro.disconnect();
	}, []);

	const submit = (t: string) => {
		const v = t.trim();
		if (!v || busy) return;
		props.onSend(v);
		setText("");
		stick.current = true;
	};

	const inCombat = state.encounter?.status === "active";
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				ref={scroller}
				className="min-h-0 flex-1 overflow-y-auto px-5 py-5 [overflow-anchor:none]"
				// Only the reader's own scrolling unsticks the view; scrolls caused by the
				// content shrinking (the live turn swapped for the saved log) must not.
				onWheel={() => (userScroll.current = Date.now())}
				onTouchMove={() => (userScroll.current = Date.now())}
				onPointerDown={() => (userScroll.current = Date.now())}
				onKeyDown={() => (userScroll.current = Date.now())}
				onScroll={(e) => {
					const el = e.currentTarget;
					const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
					if (atBottom) stick.current = true;
					else if (Date.now() - userScroll.current < 1000) stick.current = false;
				}}
			>
				<div ref={content} className="flex min-h-full flex-col gap-5">
				{log.length === 0 && !live && (
					<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-dim">
						<ScrollText className="text-gold" />
						<p className="font-fell text-lg italic">{t("play.narr.empty")}</p>
					</div>
				)}
				{log.map((e, i) => (
					<Entry key={e.id ?? i} e={e} />
				))}
				{live && <LiveView live={live} />}
				</div>
			</div>

			<div className="border-t border-line bg-bg-2/60 px-4 py-3">
				{state.pendingRoll && !busy && (
					<button className="btn btn-gold mb-3 w-full justify-center py-2.5" onClick={props.onRollPending}>
						<Dices size={18} /> {t("play.narr.roll", { label: le(state.pendingRoll.label) })}
						{state.pendingRoll.dc ? <span className="opacity-70">{t("play.narr.dc", { n: state.pendingRoll.dc })}</span> : null}
					</button>
				)}
				{!busy && state.suggestions.length > 0 && !inCombat && (
					<div className="mb-2.5 flex flex-wrap gap-1.5">
						{state.suggestions.map((s) => (
							<button key={s} className="chip hover:border-gold hover:text-gold-2" onClick={() => submit(s)}>
								<Sparkles size={12} className="text-gold" /> {s}
							</button>
						))}
					</div>
				)}
				{inCombat && !busy && (
					<p className="mb-2 text-xs text-dim">{t("play.narr.inCombat")}</p>
				)}
				<form
					className="flex items-end gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						submit(text);
					}}
				>
					<textarea
						className="input min-h-[46px] resize-none font-serif text-[1.02rem]"
						rows={text.split("\n").length > 2 ? 4 : 2}
						placeholder={busy ? t("play.narr.placeholderBusy") : t("play.narr.placeholder")}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submit(text);
							}
						}}
					/>
					{busy ? (
						<button type="button" className="btn btn-danger h-[46px]" onClick={props.onAbort} title={t("play.narr.stop")}>
							<Square size={16} />
						</button>
					) : (
						<button type="submit" className="btn btn-gold h-[46px]" disabled={!text.trim()} title={t("play.narr.send")}>
							<Send size={16} />
						</button>
					)}
				</form>
			</div>
		</div>
	);
}
