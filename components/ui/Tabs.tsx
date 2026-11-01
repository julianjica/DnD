"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

export interface TabItem<T extends string = string> {
	id: T;
	label: ReactNode;
	icon?: ReactNode;
	disabled?: boolean;
}

export interface TabsProps<T extends string> {
	tabs: TabItem<T>[];
	value: T;
	onChange: (id: T) => void;
	/** "underline" (default) for page sections, "pill" for compact segmented use. */
	variant?: "underline" | "pill";
	className?: string;
	/** Accessible label for the tab list. */
	label?: string;
	/** Panel content for the active tab (rendered with role=tabpanel). */
	children?: ReactNode;
	panelClassName?: string;
}

/** WAI-ARIA tabs with arrow-key / Home / End navigation (automatic activation). */
export function Tabs<T extends string>({ tabs, value, onChange, variant = "underline", className, label, children, panelClassName }: TabsProps<T>) {
	const base = useId();
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);

	const onKey = (e: KeyboardEvent) => {
		const cur = tabs.findIndex((t) => t.id === value);
		const pos = enabled.indexOf(cur);
		let next: number | undefined;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(pos + 1) % enabled.length];
		else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(pos - 1 + enabled.length) % enabled.length];
		else if (e.key === "Home") next = enabled[0];
		else if (e.key === "End") next = enabled[enabled.length - 1];
		if (next === undefined) return;
		e.preventDefault();
		onChange(tabs[next].id);
		refs.current[next]?.focus();
	};

	return (
		<div className={className}>
			<div
				role="tablist"
				aria-label={label}
				onKeyDown={onKey}
				className={cn(variant === "underline" ? "flex gap-1 border-b border-line" : "inline-flex gap-1 rounded-lg border border-line bg-bg-2 p-1")}
			>
				{tabs.map((t, i) => {
					const active = t.id === value;
					return (
						<button
							key={t.id}
							ref={(el) => {
								refs.current[i] = el;
							}}
							type="button"
							role="tab"
							id={`${base}-tab-${t.id}`}
							aria-selected={active}
							aria-controls={`${base}-panel-${t.id}`}
							tabIndex={active ? 0 : -1}
							disabled={t.disabled}
							onClick={() => onChange(t.id)}
							className={cn(
								"inline-flex items-center gap-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-40",
								variant === "underline"
									? cn("-mb-px border-b-2 px-4 py-2 font-display tracking-wide", active ? "border-gold text-gold-2" : "border-transparent text-dim hover:text-text")
									: cn("rounded-md px-3 py-1.5", active ? "bg-gold/15 text-gold-2 shadow-[inset_0_0_0_1px_var(--gold)]" : "text-dim hover:text-text"),
							)}
						>
							{t.icon}
							{t.label}
						</button>
					);
				})}
			</div>
			{children !== undefined && (
				<div role="tabpanel" id={`${base}-panel-${value}`} aria-labelledby={`${base}-tab-${value}`} className={panelClassName}>
					{children}
				</div>
			)}
		</div>
	);
}

export interface SegmentedProps<T extends string> {
	options: { value: T; label: ReactNode; hint?: string }[];
	value: T;
	onChange: (v: T) => void;
	label?: string;
	className?: string;
	size?: "sm" | "md";
}

/** Radio-group styled as a segmented control (arrow keys move the selection). */
export function Segmented<T extends string>({ options, value, onChange, label, className, size = "md" }: SegmentedProps<T>) {
	const refs = useRef<(HTMLButtonElement | null)[]>([]);
	const onKey = (e: KeyboardEvent) => {
		const cur = options.findIndex((o) => o.value === value);
		let next = -1;
		if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (cur + 1) % options.length;
		else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (cur - 1 + options.length) % options.length;
		if (next < 0) return;
		e.preventDefault();
		onChange(options[next].value);
		refs.current[next]?.focus();
	};
	return (
		<div role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("inline-flex flex-wrap gap-1 rounded-lg border border-line bg-bg-2 p-1", className)}>
			{options.map((o, i) => {
				const active = o.value === value;
				return (
					<button
						key={o.value}
						ref={(el) => {
							refs.current[i] = el;
						}}
						type="button"
						role="radio"
						aria-checked={active}
						tabIndex={active ? 0 : -1}
						title={o.hint}
						onClick={() => onChange(o.value)}
						className={cn(
							"rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold",
							size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
							active ? "bg-gold/15 text-gold-2 shadow-[inset_0_0_0_1px_var(--gold)]" : "text-dim hover:text-text",
						)}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}

export default Tabs;
