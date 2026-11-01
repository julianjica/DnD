"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";
import { useT } from "@/components/i18n/I18nProvider";

export interface ModalProps {
	open: boolean;
	onClose: () => void;
	title?: ReactNode;
	/** Footer actions (buttons). */
	footer?: ReactNode;
	children?: ReactNode;
	/** Tailwind max-width class for the panel (default max-w-lg). */
	widthClass?: string;
	/** Close when the backdrop is clicked (default true). */
	dismissible?: boolean;
	className?: string;
}

/**
 * Accessible modal built on the native <dialog> element: focus trapping,
 * Escape to close and top-layer stacking come from the browser.
 */
export function Modal({ open, onClose, title, footer, children, widthClass = "max-w-lg", dismissible = true, className }: ModalProps) {
	const ref = useRef<HTMLDialogElement>(null);
	const { t } = useT();

	useEffect(() => {
		const d = ref.current;
		if (!d) return;
		if (open && !d.open) d.showModal();
		else if (!open && d.open) d.close();
	}, [open]);

	return (
		<dialog
			ref={ref}
			onCancel={(e) => {
				e.preventDefault();
				if (dismissible) onClose();
			}}
			onClick={(e) => {
				if (dismissible && e.target === e.currentTarget) onClose();
			}}
			className={cn(
				"dh-modal m-auto w-[calc(100%-2rem)] bg-transparent p-0 text-text backdrop:bg-black/70 backdrop:backdrop-blur-[2px]",
				widthClass,
			)}
		>
			<style>{`
				.dh-modal[open] { animation: dh-modal-in 180ms cubic-bezier(.2,.8,.2,1) both; }
				@keyframes dh-modal-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
				@media (prefers-reduced-motion: reduce) { .dh-modal[open] { animation: none; } }
			`}</style>
			{open && (
				<div className={cn("panel relative p-6", className)}>
					<button type="button" onClick={onClose} className="absolute top-3 right-3 rounded p-1 text-dim hover:text-gold-2 focus-visible:outline-2 focus-visible:outline-gold" aria-label={t("common.close")}>
						<X className="size-4" />
					</button>
					{title && <h2 className="heading mb-4 pr-6 text-lg">{title}</h2>}
					<div>{children}</div>
					{footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
				</div>
			)}
		</dialog>
	);
}

export default Modal;
