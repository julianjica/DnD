"use client";

import { useId, type ReactNode } from "react";
import { cn } from "./cn";

export interface ToggleProps {
	checked: boolean;
	onChange: (v: boolean) => void;
	label?: ReactNode;
	description?: ReactNode;
	disabled?: boolean;
	className?: string;
}

/** Accessible switch (role="switch") with optional label and description. */
export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
	const id = useId();
	return (
		<div className={cn("flex items-start gap-3", disabled && "opacity-50", className)}>
			<button
				id={id}
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className={cn(
					"relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
					checked ? "border-gold bg-gold/30" : "border-line bg-bg-2",
				)}
			>
				<span
					className={cn(
						"inline-block size-4 rounded-full shadow transition-transform",
						checked ? "translate-x-[22px] bg-gold-2" : "translate-x-[3px] bg-dim",
					)}
				/>
			</button>
			{(label || description) && (
				<label htmlFor={id} className="flex cursor-pointer flex-col">
					{label && <span className="text-sm text-text">{label}</span>}
					{description && <span className="text-xs text-dim">{description}</span>}
				</label>
			)}
		</div>
	);
}

export default Toggle;
