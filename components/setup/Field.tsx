import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/** Labeled section block used across wizard steps. */
export function Section({ title, hint, actions, children, className }: { title: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
	return (
		<section className={cn("flex flex-col gap-3", className)}>
			<div className="flex flex-wrap items-end justify-between gap-2">
				<div>
					<h3 className="heading text-base">{title}</h3>
					{hint && <p className="mt-0.5 text-sm text-dim">{hint}</p>}
				</div>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</div>
			{children}
		</section>
	);
}

export function FieldLabel({ children, htmlFor, optional }: { children: ReactNode; htmlFor?: string; optional?: boolean }) {
	return (
		<label htmlFor={htmlFor} className="mb-1 flex items-baseline gap-2 text-xs font-medium tracking-wider text-dim uppercase">
			{children}
			{optional && <span className="text-[10px] tracking-normal text-faint normal-case">optional</span>}
		</label>
	);
}

/** Toggleable chip (aria-pressed). */
export function ChipToggle({ active, onClick, children, title, disabled }: { active: boolean; onClick: () => void; children: ReactNode; title?: string; disabled?: boolean }) {
	return (
		<button
			type="button"
			className="chip transition-colors hover:border-gold/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40"
			data-active={active}
			aria-pressed={active}
			onClick={onClick}
			title={title}
			disabled={disabled}
		>
			{children}
		</button>
	);
}
