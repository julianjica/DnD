import type { Messages } from "./en";
import * as common from "./parts/common";
import * as setup from "./parts/setup";
import * as play from "./parts/play";
import * as enums from "./parts/enums";
import * as survival from "./parts/survival";
import * as base from "./parts/base";
import * as group from "./parts/group";
import * as siege from "./parts/siege";
import * as cyber from "./parts/cyber";

/** Spanish UI strings, merged from ./parts (each part is type-checked against its English twin). */
export const es: Messages = { ...common.es, ...setup.es, ...play.es, ...enums.es, ...survival.es, ...base.es, ...group.es, ...siege.es, ...cyber.es };
