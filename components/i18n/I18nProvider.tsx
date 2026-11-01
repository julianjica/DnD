"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LANG_COOKIE, translate, translateEnum, type Lang, type MessageKey } from "@/lib/i18n";

interface I18n {
	lang: Lang;
	setLang: (l: Lang) => void;
	t: (key: MessageKey, vars?: Record<string, string | number>) => string;
	/** Game enum label: te("skill", "sleight-of-hand"). */
	te: (group: string, value: string) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
	const [lang, setLangState] = useState<Lang>(initial);
	const setLang = useCallback((l: Lang) => {
		setLangState(l);
		document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
	}, []);
	useEffect(() => {
		document.documentElement.lang = lang;
	}, [lang]);
	const value = useMemo<I18n>(
		() => ({
			lang,
			setLang,
			t: (key, vars) => translate(lang, key, vars),
			te: (group, v) => translateEnum(lang, group, v),
		}),
		[lang, setLang],
	);
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): I18n {
	const v = useContext(Ctx);
	if (!v) throw new Error("useT must be used inside <I18nProvider>");
	return v;
}
