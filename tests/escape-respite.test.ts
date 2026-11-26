import { test } from "node:test";
import assert from "node:assert/strict";
import { ESCAPE_WORDS } from "../lib/dm/tools/character";

test("escape checks are recognised in English and Spanish; sneaking in is not an escape", () => {
	for (const l of ["Hide in the brambles", "Escape through the window", "Lose the pursuers in the market", "Ocultarte entre las zarzas con la niebla", "Escabullirte entre la niebla", "Huir campo a través", "Despistar a los jinetes", "Esconderse en el establo"]) assert.ok(ESCAPE_WORDS.test(l), l);
	for (const l of ["Sneak into the vault", "Infiltrarse en la torre", "Pick the lock", "Escuchar tras la puerta"]) assert.ok(!ESCAPE_WORDS.test(l), l);
});
