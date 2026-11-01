"use client";

import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface SliderProps {
	value: number;
	onChange: (v: number) => void;
	min?: number;
	max?: number;
	step?: number;
	label?: ReactNode;
	/** Formats the value readout (default: the number). Pass null to hide it. */
	format?: ((v: number) => ReactNode) | null;
	disabled?: boolean;
	className?: string;
	/** Optional tick labels under the track (evenly spaced). */
	ticks?: ReactNode[];
}

/** Themed range input with a gold fill and a value readout. */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, format, disabled, className, ticks }: SliderProps) {
	const id = useId();
	const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
	return (
		<div className={cn("flex flex-col gap-1.5", disabled && "opacity-50", className)}>
			{(label || format !== null) && (
				<div className="flex items-baseline justify-between gap-2 text-sm">
					{label && (
						<label htmlFor={id} className="text-dim">
							{label}
						</label>
					)}
					{format !== null && <span className="font-display text-gold-2 tabular-nums">{format ? format(value) : value}</span>}
				</div>
			)}
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(Number(e.target.value))}
				className="dh-slider h-2 w-full cursor-pointer appearance-none rounded-full bg-transparent"
				style={{ ["--pct" as string]: `${pct}%` }}
			/>
			{ticks && (
				<div className="flex justify-between text-[11px] text-faint">
					{ticks.map((t, i) => (
						<span key={i}>{t}</span>
					))}
				</div>
			)}
			<style>{`
				.dh-slider::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: linear-gradient(90deg, var(--gold) var(--pct), var(--panel-3) var(--pct)); border: 1px solid var(--line); }
				.dh-slider::-moz-range-track { height: 6px; border-radius: 999px; background: var(--panel-3); border: 1px solid var(--line); }
				.dh-slider::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--gold); }
				.dh-slider::-webkit-slider-thumb { -webkit-appearance: none; margin-top: -6px; width: 16px; height: 16px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, var(--gold-2), var(--gold)); border: 1px solid #7a5a1c; box-shadow: 0 1px 4px rgb(0 0 0 / .5); }
				.dh-slider::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--gold-2); border: 1px solid #7a5a1c; }
				.dh-slider:focus-visible { outline: 2px solid var(--gold); outline-offset: 4px; }
			`}</style>
		</div>
	);
}

export default Slider;
