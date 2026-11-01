import type { Messages } from "./en";
import * as common from "./parts/common";
import * as setup from "./parts/setup";
import * as play from "./parts/play";
import * as enums from "./parts/enums";

/** Spanish UI strings, merged from ./parts (each part is type-checked against its English twin). */
export const es: Messages = { ...common.es, ...setup.es, ...play.es, ...enums.es };
