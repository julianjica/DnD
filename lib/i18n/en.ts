import * as common from "./parts/common";
import * as setup from "./parts/setup";
import * as play from "./parts/play";
import * as enums from "./parts/enums";

/** English UI strings (source of truth), merged from ./parts. */
export const en = { ...common.en, ...setup.en, ...play.en, ...enums.en };

export type Messages = { [K in keyof typeof en]: string };
