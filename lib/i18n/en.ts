/** English UI strings (source of truth). Add keys here first, then to es.ts. */
export const en = {
	"lang.label": "Language",
	"common.back": "Back",
	"common.cancel": "Cancel",
	"common.save": "Save",
	"common.close": "Close",
	"common.loading": "Loading…",
} as const satisfies Record<string, string>;

export type Messages = { [K in keyof typeof en]: string };
