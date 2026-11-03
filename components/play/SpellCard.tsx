"use client";

import type { SpellInfo } from "@/lib/game/types";
import type { SpellPreview } from "@/lib/rules/combat";
import { spellTags, tagEffects, type SpellTag } from "@/lib/srd/spell-tags";
import { attackReasonText } from "@/lib/i18n/engine";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/components/i18n/I18nProvider";
import { srdName } from "@/components/setup/i18n";
import { cn } from "@/components/ui/cn";

const GOOD = "bg-emerald-900/60 text-emerald-300";
const BAD = "bg-rose-900/60 text-rose-300";
const NEUTRAL = "bg-amber-900/50 text-amber-200";

/** First sentences of an (already translated) description, up to ~n characters. */
function brief(text: string, n = 260): string {
	const flat = text.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
	if (flat.length <= n) return flat;
	const cut = flat.slice(0, n);
	const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(". "));
	return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, n - 1)}…`;
}

function Badge({ tag }: { tag: SpellTag }) {
	const { t } = useT();
	const cls = tag.good === null ? NEUTRAL : tag.good ? GOOD : BAD;
	const label = tag.effect === "adv" ? t("spell.adv") : tag.effect === "dis" ? t("spell.dis") : t("spell.mention");
	return <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", cls)}>{label}</span>;
}

/** Compact "Adv" / "Dis" chips for a spell in a list (green: helps you). */
export function SpellAdvChips({ spell, className }: { spell: SpellInfo; className?: string }) {
	const { t } = useT();
	const tags = spellTags(spell);
	const effects = tagEffects(tags);
	if (!effects.length) return null;
	return (
		<span className={cn("inline-flex gap-0.5", className)} title={t("spell.badgeTitle")}>
			{effects.map((e) => {
				const good = tags.some((x) => x.effect === e && x.good);
				return (
					<span key={e} className={cn("rounded px-1 text-[9px] font-bold uppercase leading-4 tracking-wider", good ? GOOD : BAD)}>
						{t(e === "adv" ? "spell.advShort" : "spell.disShort")}
					</span>
				);
			})}
		</span>
	);
}

/** Live engine verdict for casting the spell at one creature right now. */
export function SpellLive({ live, name }: { live: SpellPreview | string; name?: string }) {
	const { t, lang } = useT();
	if (typeof live === "string") return <div className="text-faint italic">{t("spell.live.noTarget")}</div>;
	const why = (xs: string[]) => xs.map((r) => (r === "ranged attack in melee" ? t("spell.live.threatened") : attackReasonText(lang, r))).join(", ");
	const line = (k: MessageKey, xs: string[], good: boolean) =>
		xs.length > 0 && (
			<div className="flex items-start gap-1.5">
				<span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", good ? "bg-emerald-400" : "bg-rose-400")} />
				<span className={good ? "text-emerald-200" : "text-rose-200"}>{t(k, { why: why(xs) })}</span>
			</div>
		);
	const attack = live.roll === "attack";
	const adv = attack ? live.advantage : live.disadvantage; // good for the caster
	const dis = attack ? live.disadvantage : live.advantage; // bad for the caster
	return (
		<div className="space-y-0.5">
			<div className="font-semibold text-gold-2">{t("spell.live.title", { name: name ?? "?", ft: live.distance })}</div>
			{line("spell.live.autoFail", live.autoFail, true)}
			{line(attack ? "spell.live.attackAdv" : "spell.live.saveDis", adv, true)}
			{line(attack ? "spell.live.attackDis" : "spell.live.saveAdv", dis, false)}
			{adv.length > 0 && dis.length > 0 && <div className="text-faint">{t("spell.live.cancel")}</div>}
			{!adv.length && !dis.length && !live.autoFail.length && <div className="text-dim">{t("spell.live.normal")}</div>}
		</div>
	);
}

/**
 * Spell tooltip: level/school, casting time · range · duration, components,
 * how it resolves (attack or save), a short description, then badges for
 * anything that grants or imposes advantage/disadvantage — and, in combat,
 * what the engine would apply right now against a creature.
 */
export function SpellCard({ spell, live, liveName }: { spell: SpellInfo; live?: SpellPreview | string | null; liveName?: string }) {
	const { t, te, ts, lang } = useT();
	const tags = spellTags(spell);
	const school = srdName(lang, "school", spell.school.toLowerCase(), spell.school);
	const comps = spell.components.join(", ") + (spell.material ? ` (${ts(spell.material)})` : "");
	return (
		<div className="flex flex-col gap-1.5 text-left text-xs leading-snug">
			<div>
				<div className="font-display text-sm text-gold-2">{ts(spell.name)}</div>
				<div className="text-[11px] italic text-dim">
					{spell.level === 0 ? t("pick.schoolCantrip", { school }) : t("pick.schoolLevel", { n: spell.level, school })}
					{spell.concentration ? t("pick.concentration") : ""}
					{spell.ritual ? t("pick.ritual") : ""}
				</div>
			</div>
			<div className="text-[11px] text-dim">
				{ts(spell.castingTime)} · {ts(spell.range)} · {ts(spell.duration)}
				<br />
				{t("spell.components", { list: comps })}
				{spell.attack ? ` · ${t(spell.attack === "ranged" ? "spell.attack.ranged" : "spell.attack.melee")}` : ""}
				{spell.save ? ` · ${t("spell.save", { ability: te("ability", spell.save.ability) })}` : ""}
			</div>
			<p className="text-text/90">{brief(ts(spell.description))}</p>
			{tags.length > 0 && (
				<ul className="space-y-1 border-t border-line/60 pt-1.5">
					{tags.map((tag, i) => (
						<li key={i} className="flex items-start gap-1.5">
							<Badge tag={tag} />
							<span className="text-dim">
								{tag.note === "condition" && tag.condition ? t(`spell.cond.${tag.condition}` as MessageKey) : t(`spell.tag.${tag.note}` as MessageKey)}
								{tag.excerpt ? <span className="italic"> “{tag.excerpt}”</span> : null}
							</span>
						</li>
					))}
				</ul>
			)}
			{live != null && (
				<div className="border-t border-line/60 pt-1.5">
					<SpellLive live={live} name={liveName} />
				</div>
			)}
		</div>
	);
}
