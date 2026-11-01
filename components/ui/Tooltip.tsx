"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

export interface TooltipProps {
	/** Tooltip body. Falsy → children render without a tooltip. */
	content: ReactNode;
	children: ReactNode;
	/** Preferred side (flips when there is no room). Default "top". */
	side?: "top" | "bottom";
	/** Hover delay in ms (default 250). */
	delay?: number;
	/** Max width class (default max-w-xs). */
	widthClass?: string;
	/** Classes for the inline wrapper. */
	className?: string;
}

/**
 * Hover/focus tooltip rendered in a portal with fixed positioning, so it is
 * never clipped by scrolling panels. The wrapper is an inline-flex span; the
 * focusable child (button, chip…) gets aria-describedby via the wrapper.
 */
export function Tooltip({ content, children, side = "top", delay = 250, widthClass = "max-w-xs", className }: TooltipProps) {
	const id = useId();
	const anchor = useRef<HTMLSpanElement>(null);
	const tip = useRef<HTMLDivElement>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ left: number; top: number; side: "top" | "bottom" } | null>(null);

	const show = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setOpen(true), delay);
	}, [delay]);
	const hide = useCallback(() => {
		clearTimeout(timer.current);
		setOpen(false);
		setPos(null);
	}, []);

	useEffect(() => () => clearTimeout(timer.current), []);

	useLayoutEffect(() => {
		if (!open || !anchor.current || !tip.current) return;
		const a = anchor.current.getBoundingClientRect();
		const t = tip.current.getBoundingClientRect();
		const gap = 8;
		let s = side;
		if (s === "top" && a.top - t.height - gap < 4) s = "bottom";
		else if (s === "bottom" && a.bottom + t.height + gap > window.innerHeight - 4) s = "top";
		const top = s === "top" ? a.top - t.height - gap : a.bottom + gap;
		const left = Math.min(Math.max(4, a.left + a.width / 2 - t.width / 2), window.innerWidth - t.width - 4);
		setPos({ left, top, side: s });
	}, [open, side]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
		window.addEventListener("keydown", onKey);
		window.addEventListener("scroll", hide, true);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("scroll", hide, true);
		};
	}, [open, hide]);

	if (!content) return <>{children}</>;

	return (
		<span
			ref={anchor}
			className={cn("inline-flex", className)}
			onPointerEnter={show}
			onPointerLeave={hide}
			onFocus={show}
			onBlur={hide}
			aria-describedby={open ? id : undefined}
		>
			{children}
			{open &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						ref={tip}
						id={id}
						role="tooltip"
						className={cn(
							"pointer-events-none fixed z-[100] rounded-md border border-gold/40 bg-[#14100c]/95 px-3 py-2 text-left text-xs leading-relaxed text-text shadow-[0_10px_30px_rgb(0_0_0/0.6)] backdrop-blur-sm transition-opacity duration-100",
							widthClass,
							pos ? "opacity-100" : "opacity-0",
						)}
						style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}
					>
						{content}
					</div>,
					document.body,
				)}
		</span>
	);
}

export default Tooltip;
