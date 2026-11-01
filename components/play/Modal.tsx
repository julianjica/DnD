"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "@/components/i18n/I18nProvider";

export function Modal({ title, onClose, children, wide = false, side = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; side?: boolean }) {
	const { t } = useT();
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return (
		<div className={`fixed inset-0 z-50 flex bg-black/60 backdrop-blur-sm ${side ? "justify-end" : "items-center justify-center p-6"}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div role="dialog" aria-modal="true" aria-label={title} className={`panel flex max-h-full flex-col ${side ? "h-full w-[440px] rounded-none" : wide ? "w-[760px]" : "w-[480px]"}`}>
				<div className="flex items-center justify-between border-b border-line px-5 py-3">
					<h2 className="heading text-lg">{title}</h2>
					<button className="text-faint hover:text-text" onClick={onClose} title={t("common.close")} aria-label={t("common.close")}><X size={18} /></button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
			</div>
		</div>
	);
}
