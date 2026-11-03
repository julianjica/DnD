"use client";

import type { ReactNode } from "react";
import type { Combatant, MonsterStats } from "@/lib/game/types";
import { useT } from "@/components/i18n/I18nProvider";

/** "1/2", "1/4", "1/8" or the integer CR. */
export function crText(cr: number): string {
	if (cr === 0.125) return "1/8";
	if (cr === 0.25) return "1/4";
	if (cr === 0.5) return "1/2";
	return String(cr);
}

/** Capitalized creature type, e.g. "Elemental", "Humanoid (goblinoid)". */
function useTypeText() {
	const { ts } = useT();
	return (s: MonsterStats) => {
		const t = ts(s.type);
		return t.charAt(0).toUpperCase() + t.slice(1);
	};
}

/** One short line under a combatant's name: "Small · Elemental". */
export function CreatureTypeLine({ c, className }: { c: Combatant; className?: string }) {
	const { te } = useT();
	const typeText = useTypeText();
	if (!c.stats || c.kind === "pc") return null;
	return (
		<div className={className}>
			{te("size", c.stats.size)} · {typeText(c.stats)}
		</div>
	);
}

const ft = (n: number, unit: string) => `${n} ${unit}`;

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex gap-1.5">
			<span className="shrink-0 font-semibold text-gold-2">{label}</span>
			<span className="text-dim">{children}</span>
		</div>
	);
}

/**
 * What a character would know about the creature: what it is, how it moves
 * and senses, what hurts it and what it can do. Exact AC and hit points stay
 * hidden (the tracker shows how hurt it looks instead), and so is the SRD
 * stat-block name when the DM gave the creature its own identity.
 */
export function CreatureCard({ c }: { c: Combatant }) {
	const { t, te, ts } = useT();
	const typeText = useTypeText();
	const s = c.stats;
	if (!s) return null;
	const unit = t("play.unit.ft");
	const speeds = [
		s.speed.walk ? ft(s.speed.walk, unit) : null,
		s.speed.fly ? `${t("play.creature.fly")} ${ft(s.speed.fly, unit)}${s.speed.hover ? ` (${t("play.creature.hover")})` : ""}` : null,
		s.speed.swim ? `${t("play.creature.swim")} ${ft(s.speed.swim, unit)}` : null,
		s.speed.climb ? `${t("play.creature.climb")} ${ft(s.speed.climb, unit)}` : null,
		s.speed.burrow ? `${t("play.creature.burrow")} ${ft(s.speed.burrow, unit)}` : null,
	].filter(Boolean);
	const dmg = (xs: string[]) => xs.map((d) => te("damage", d)).join(", ");
	const abilities = [
		...s.traits.map((x) => ({ ...x, kind: "trait" as const })),
		...s.actions.map((x) => ({ name: x.name, description: x.description, kind: "action" as const })),
		...s.bonusActions.map((x) => ({ name: x.name, description: x.description, kind: "bonus" as const })),
		...s.reactions.map((x) => ({ ...x, kind: "reaction" as const })),
		...s.legendaryActions.map((x) => ({ name: x.name, description: x.description, kind: "legendary" as const })),
	];
	return (
		<div className="space-y-2 text-left text-xs leading-snug">
			<div>
				<div className="font-display text-sm text-text">{ts(c.name)}</div>
				<div className="italic text-faint">
					{te("size", s.size)} {typeText(s).toLowerCase()}, {ts(s.alignment)}
				</div>
			</div>
			<div className="space-y-0.5">
				<Row label={t("play.creature.threat")}>{t("play.creature.cr", { cr: crText(s.cr) })}</Row>
				{speeds.length > 0 && <Row label={t("play.creature.speed")}>{speeds.join(", ")}</Row>}
				{s.senses && <Row label={t("play.creature.senses")}>{ts(s.senses)}</Row>}
				{s.languages && s.languages !== "—" && <Row label={t("play.creature.languages")}>{ts(s.languages)}</Row>}
				{s.vulnerabilities.length > 0 && <Row label={t("play.creature.vulnerable")}>{dmg(s.vulnerabilities)}</Row>}
				{s.resistances.length > 0 && <Row label={t("play.creature.resists")}>{dmg(s.resistances)}</Row>}
				{s.immunities.length > 0 && <Row label={t("play.creature.immune")}>{dmg(s.immunities)}</Row>}
				{s.conditionImmunities.length > 0 && <Row label={t("play.creature.neverCondition")}>{s.conditionImmunities.map((k) => te("condition", k)).join(", ")}</Row>}
			</div>
			{abilities.length > 0 && (
				<ul className="space-y-1 border-t border-line pt-1.5">
					{abilities.map((a, i) => (
						<li key={i} className="line-clamp-3">
							<span className="font-semibold text-text">{ts(a.name)}</span>
							{a.kind !== "trait" && a.kind !== "action" && <span className="ml-1 text-[10px] uppercase tracking-wide text-faint">{t(`play.creature.kind.${a.kind}`)}</span>}
							{a.description && <span className="text-dim">. {ts(a.description)}</span>}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
