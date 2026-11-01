"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LANG_COOKIE, translate, translateEnum, type Lang, type MessageKey } from "@/lib/i18n";
import { loadSrdDict, translateSrd, type SrdDict } from "@/lib/i18n/srd";

interface I18n {
	lang: Lang;
	setLang: (l: Lang) => void;
	t: (key: MessageKey, vars?: Record<string, string | number>) => string;
	/** Game enum label: te("skill", "sleight-of-hand"). */
	te: (group: string, value: string) => string;
	/** SRD content (spell/item/feature/monster names, descriptions…) by its English text. */
	ts: (text: string | undefined) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
	const [lang, setLangState] = useState<Lang>(initial);
	const setLang = useCallback((l: Lang) => {
		setLangState(l);
		document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
	}, []);
	const [srd, setSrd] = useState<SrdDict | null>(null);
	useEffect(() => {
		document.documentElement.lang = lang;
		if (lang !== "en" && !srd) void loadSrdDict().then(setSrd);
	}, [lang, srd]);
	const value = useMemo<I18n>(
		() => ({
			lang,
			setLang,
			t: (key, vars) => translate(lang, key, vars),
			te: (group, v) => translateEnum(lang, group, v),
			ts: (text) => translateSrd(lang, srd, text),
		}),
		[lang, setLang, srd],
	);
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): I18n {
	const v = useContext(Ctx);
	if (!v) throw new Error("useT must be used inside <I18nProvider>");
	return v;
}
