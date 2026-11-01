"use client";

import clsx from "clsx";
import type { RollRecord } from "@/lib/game/types";
import { DieGlyph } from "./DieGlyph";
import { critKind, outcomeText, rollChips, signedMod } from "./rollFormat";

export interface DiceLogProps {
	rolls: RollRecord[];
	/** How many of the most recent rolls to show (default 8). Newest first. */
	max?: number;
	className?: string;
	/** Optional click handler (e.g. replay a roll in the DiceTray). */
	onSelect?: (rec: RollRecord) => void;
}

/** Compact list of recent rolls with per-die breakdown. */
export function DiceLog({ rolls, max = 8, className, onSelect }: DiceLogProps) {
	const recent = [...rolls].sort((a, b) => b.ts - a.ts).slice(0, max);
	if (!recent.length) return <div className={clsx("px-2 py-3 text-xs italic text-stone-500", className)}>No rolls yet.</div>;
	return (
		<ul className={clsx("flex flex-col divide-y divide-stone-700/40", className)}>
			{recent.map((rec) => {
				const crit = critKind(rec);
				const outcome = outcomeText(rec);
				const chips = rollChips(rec);
				const Row = onSelect ? "button" : "div";
				return (
					<li key={rec.id}>
						<Row
							{...(onSelect ? { type: "button" as const, onClick: () => onSelect(rec) } : {})}
							className={clsx("flex w-full items-center gap-2 px-2 py-1.5 text-left", onSelect && "hover:bg-white/5")}
						>
							<span
								className={clsx(
									"w-9 shrink-0 text-right font-serif text-xl font-bold tabular-nums",
									crit === "gold" ? "text-amber-300" : crit === "red" ? "text-red-400" : "text-stone-100",
								)}
								style={crit ? { textShadow: crit === "gold" ? "0 0 10px rgba(255,190,60,0.6)" : "0 0 10px rgba(255,50,50,0.55)" } : undefined}
							>
								{rec.total}
							</span>
							<span className="min-w-0 flex-1">
								<span className="flex items-baseline gap-1.5">
									<span className="truncate text-xs font-medium text-stone-200">{rec.label}</span>
									{outcome && (
										<span
											className={clsx(
												"shrink-0 text-[10px] font-semibold uppercase tracking-wide",
												rec.success || rec.critical === "hit" ? "text-emerald-400" : "text-rose-400",
											)}
										>
											{outcome}
										</span>
									)}
								</span>
								<span className="mt-0.5 flex flex-wrap items-center gap-0.5 text-[10px] text-stone-400">
									{chips.slice(0, 12).map((c, i) => (
										<DieGlyph key={i} sides={c.sides} value={c.value} dropped={c.dropped} nat={c.nat} size={18} />
									))}
									{chips.length > 12 && <span>+{chips.length - 12}</span>}
									{rec.modifier !== 0 && <span className="ml-0.5 font-serif text-xs text-stone-300">{signedMod(rec.modifier)}</span>}
									<span className="ml-1 font-mono text-stone-500">{rec.notation}</span>
									{rec.advantage && <span className="text-stone-500">{rec.advantage === "advantage" ? "adv" : "dis"}</span>}
									{rec.target !== undefined && <span className="text-stone-500">vs {rec.target}</span>}
								</span>
							</span>
						</Row>
					</li>
				);
			})}
		</ul>
	);
}

export default DiceLog;
