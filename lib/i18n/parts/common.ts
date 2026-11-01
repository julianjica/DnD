/** Shared strings used across screens. */
export const en = {
	"lang.label": "Language",
	"common.back": "Back",
	"common.cancel": "Cancel",
	"common.save": "Save",
	"common.close": "Close",
	"common.loading": "Loading…",
} as const satisfies Record<string, string>;

export const es: { [K in keyof typeof en]: string } = {
	"lang.label": "Idioma",
	"common.back": "Volver",
	"common.cancel": "Cancelar",
	"common.save": "Guardar",
	"common.close": "Cerrar",
	"common.loading": "Cargando…",
};
