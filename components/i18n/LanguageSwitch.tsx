"use client";

import { Languages } from "lucide-react";
import { LANGS } from "@/lib/i18n";
import { useT } from "./I18nProvider";

/** Compact EN/ES toggle for headers. */
export function LanguageSwitch({ className = "" }: { className?: string }) {
	const { lang, setLang, t } = useT();
	return (
		<div className={`flex items-center gap-1 ${className}`} title={t("lang.label")}>
			<Languages size={15} className="text-faint" />
			{LANGS.map((l) => (
				<button
					key={l.id}
					type="button"
					onClick={() => setLang(l.id)}
					className={`rounded px-1.5 py-0.5 text-[11px] uppercase tracking-wider transition ${lang === l.id ? "bg-gold/20 text-gold-2" : "text-faint hover:text-dim"}`}
					aria-pressed={lang === l.id}
				>
					{l.id}
				</button>
			))}
		</div>
	);
}
