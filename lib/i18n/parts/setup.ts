/**
 * setup strings. `en` is the source; `es` must define every key.
 * Keys are flat ("setup.section.thing"); enum keys are "enum.<group>.<id>".
 */
export const en = {
} as const satisfies Record<string, string>;

export const es: { [K in keyof typeof en]: string } = {
};
