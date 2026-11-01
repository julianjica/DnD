"use client";

import { localizeEngine, tryLocalizeEngine, isSheetUseLine } from "@/lib/i18n/engine";
import { useT } from "./I18nProvider";

/**
 * Display-time translation of engine-produced English (roll labels, rules
 * errors, level-up labels, resource/combat log lines).
 *
 * `srdOverride`: SRD name translator for captured spell/item/monster/feature
 * names. Defaults to `useT().ts` (the SRD dictionary lookup); pass one only
 * to override it.
 */
export function useEngineText(srdOverride?: (s: string) => string) {
	const { lang, ts } = useT();
	const srd = srdOverride ?? ((s: string) => ts(s));
	return {
		lang,
		/** Translated text, or the original when no template matches. */
		le: (text: string | null | undefined): string => (text ? localizeEngine(lang, text, srd) : ""),
		/** Translated text, or null when no template matches (English: unchanged). */
		tryLe: (text: string): string | null => tryLocalizeEngine(lang, text, srd),
		/** A player log line: only the engine's "used from the sheet" lines are translated, free-typed text never. */
		playerLine: (text: string): string => (isSheetUseLine(text) ? localizeEngine(lang, text, srd) : text),
	};
}
