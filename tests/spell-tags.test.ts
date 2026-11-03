import assert from "node:assert/strict";
import { test } from "node:test";
import { getSpell, SPELLS } from "../lib/srd";
import { CURATED_SPELL_TAGS, mentionTags, spellTags, tagEffects } from "../lib/srd/spell-tags";
import { makeMonster, makeWizard, openMap, ScriptedRng } from "../lib/rules/combat/fixtures";
import { startCombat } from "../lib/rules/combat/encounter";
import { applyConditionTo, previewSpell } from "../lib/rules/combat/dm";
import type { SpellInfo } from "../lib/game/types";
import { en, es } from "../lib/i18n/parts/play";

const spell = (i: string): SpellInfo => {
	const s = getSpell(i);
	assert.ok(s, `missing SRD spell ${i}`);
	return s;
};
const notes = (i: string) => spellTags(spell(i)).map((t) => `${t.effect}:${t.note}${t.condition ? `:${t.condition}` : ""}:${t.good}`);

test("spells that give advantage are tagged as helpful advantage", () => {
	assert.deepEqual(notes("faerie-fire"), ["adv:attacksVsTarget:true"]);
	assert.ok(notes("guiding-bolt").includes("adv:nextAttackVsTarget:true"));
	assert.deepEqual(notes("true-strike"), ["adv:yourNextAttack:true"]);
	assert.deepEqual(notes("shocking-grasp"), ["adv:vsMetalArmor:true"]);
	assert.deepEqual(notes("enhance-ability"), ["adv:targetChecks:true"]);
	assert.deepEqual(tagEffects(spellTags(spell("foresight"))), ["adv", "dis"]);
});

test("spells that impose disadvantage on enemies are tagged as helpful disadvantage", () => {
	assert.deepEqual(notes("vicious-mockery"), ["dis:targetNextAttackDis:true"]);
	assert.deepEqual(notes("blur"), ["dis:attacksVsProtectedDis:true"]);
	assert.ok(notes("protection-from-evil-and-good").includes("dis:typesVsProtectedDis:true"));
});

test("condition spells point at the condition the attack rules turn into advantage", () => {
	assert.deepEqual(notes("hold-person"), ["adv:condition:paralyzed:true"]);
	assert.deepEqual(notes("web"), ["adv:condition:restrained:true"]);
	assert.deepEqual(notes("sleep"), ["adv:condition:unconscious:true"]);
	assert.deepEqual(notes("fear"), ["dis:condition:frightened:true"]);
});

test("ranged spell attacks carry the 'hostile within 5 ft' rule; bless/bane/mirror image stay untagged", () => {
	assert.deepEqual(notes("fire-bolt"), ["dis:rangedInMelee:false"]);
	assert.ok(notes("guiding-bolt").includes("dis:rangedInMelee:false"));
	assert.deepEqual(tagEffects(spellTags(spell("fire-bolt"))), [], "the situational rule alone gets no list chip");
	for (const i of ["bless", "bane", "mirror-image", "magic-missile"]) assert.deepEqual(notes(i), [], i);
});

test("drawbacks (target saves with advantage) are never shown as helpful", () => {
	assert.deepEqual(notes("charm-person"), ["adv:saveAdvIfFighting:false"]);
	for (const i of ["dominate-person", "modify-memory"]) assert.ok(spellTags(spell(i)).every((t) => t.good === false), i);
});

test("every SRD spell mentioning (dis)advantage is curated; the text fallback stays neutral", () => {
	for (const s of SPELLS) {
		if (/advantage/i.test(`${s.description} ${s.higherLevel ?? ""}`)) assert.ok(s.index in CURATED_SPELL_TAGS, `${s.index} mentions advantage but isn't curated`);
	}
	const fake = { description: "The target has advantage on Wisdom saving throws. Enemies have disadvantage on attack rolls against it.", higherLevel: undefined };
	const tags = mentionTags(fake);
	assert.deepEqual(tags.map((t) => [t.effect, t.note, t.good]), [["mention", "mentionsAdv", null], ["mention", "mentionsDis", null]]);
	assert.match(tags[0].excerpt!, /^The target has advantage/);
	assert.match(tags[1].excerpt!, /^Enemies have disadvantage/);
	assert.deepEqual(mentionTags({ description: "A bolt of fire.", higherLevel: undefined }), []);
});

test("every tag note and condition has English and Spanish text", () => {
	const keys = new Set<string>();
	for (const s of SPELLS) for (const t of spellTags(s)) keys.add(t.note === "condition" ? `spell.cond.${t.condition}` : `spell.tag.${t.note}`);
	keys.add("spell.tag.mentionsAdv").add("spell.tag.mentionsDis");
	for (const k of keys) {
		assert.ok(k in en, `en ${k}`);
		assert.ok((es as Record<string, string>)[k], `es ${k}`);
	}
});

function fight(monsters: { id: string; at: { x: number; y: number } }[]) {
	const r = startCombat(
		{ encounterId: "e1", map: openMap(30, 12), character: makeWizard(), pcPosition: { x: 1, y: 1 }, monsters: monsters.map((m) => ({ stats: makeMonster(), id: m.id, position: m.at })) },
		new ScriptedRng([20, ...monsters.map(() => 1)]),
	);
	assert.ok(r.ok, r.error);
	return r;
}

test("live preview: ranged spell attack has disadvantage only with a hostile within 5 ft (engine rule)", () => {
	const far = fight([{ id: "g", at: { x: 7, y: 1 } }]);
	const p1 = previewSpell(far, "pc1", spell("fire-bolt"));
	assert.ok(typeof p1 !== "string", String(p1));
	assert.equal(p1.roll, "attack");
	assert.equal(p1.targetId, "g");
	assert.equal(p1.distance, 30);
	assert.deepEqual(p1.disadvantage, []);

	const near = fight([{ id: "g", at: { x: 2, y: 1 } }, { id: "h", at: { x: 8, y: 1 } }]);
	const p2 = previewSpell(near, "pc1", spell("fire-bolt"), "h");
	assert.ok(typeof p2 !== "string", String(p2));
	assert.deepEqual(p2.disadvantage, ["ranged attack in melee"]);
	// Without a target it picks the nearest visible hostile.
	const p3 = previewSpell(near, "pc1", spell("fire-bolt"));
	assert.ok(typeof p3 !== "string" && p3.targetId === "g");
	// A melee spell attack doesn't care.
	const p4 = previewSpell(near, "pc1", spell("shocking-grasp"), "g");
	assert.ok(typeof p4 !== "string" && p4.disadvantage.length === 0);
});

test("live preview: target conditions and save modifiers come from the engine", () => {
	const r = fight([{ id: "g", at: { x: 5, y: 1 } }]);
	const prone = applyConditionTo(r, new ScriptedRng([]), "g", { id: "prone" });
	assert.ok(prone.ok, prone.error);
	const p = previewSpell(prone, "pc1", spell("fire-bolt"), "g");
	assert.ok(typeof p !== "string" && p.disadvantage.includes("target prone"));

	const restrained = applyConditionTo(r, new ScriptedRng([]), "g", { id: "restrained" });
	const dexSave = { ...spell("fire-bolt"), attack: undefined, save: { ability: "dex" as const, halfOnSuccess: true } };
	const s = previewSpell(restrained, "pc1", dexSave, "g");
	assert.ok(typeof s !== "string", String(s));
	assert.equal(s.roll, "save");
	assert.deepEqual(s.disadvantage, ["target restrained"]);
	assert.ok(typeof s !== "string" && s.advantage.length === 0);

	const para = applyConditionTo(r, new ScriptedRng([]), "g", { id: "paralyzed" });
	const s2 = previewSpell(para, "pc1", dexSave, "g");
	assert.ok(typeof s2 !== "string" && s2.autoFail.includes("target paralyzed"));

	assert.equal(typeof previewSpell(r, "pc1", spell("mage-armor")), "string", "no attack or save → nothing to preview");
});
