"use client";

/**
 * Root Access: the den tab (docs/cyberpunk.md §6). Where the den is, rent and
 * debt to La Tía, what's installed, the upgrade catalogue with a Buy button,
 * the program at the workbench and the gig board. Buying and paying go through
 * POST /api/campaigns/[id]/den (the engine validates and charges); the rest is
 * read-only.
 */
import { useState } from "react";
import { Briefcase, Coins, Cpu, Flame, Hammer, HomeIcon, MapPin, ShieldAlert, VenetianMask } from "lucide-react";
import type { DenState, DenUpgradeId, GameState, Gig } from "@/lib/game/types";
import { DAY, DEBT_CUT, DEN_UPGRADE_IDS, DEN_UPGRADES, levelOf, maxLevel, nextPrice, REPO_WEEKS, START_RENT } from "@/lib/rules/den";
import { openGigs } from "@/lib/rules/gigs";
import { getSpell } from "@/lib/srd";
import { useT } from "@/components/i18n/I18nProvider";
import { Tooltip } from "@/components/ui/Tooltip";
import type { MessageKey } from "@/lib/i18n";

const minuteOf = (t: GameState["time"]) => t.day * DAY + t.hour * 60 + (t.minute ?? 0);

function BuyBtn({ label, onClick, disabled, title }: { label: string; onClick: () => void; disabled: boolean; title?: string }) {
	return (
		<button
			type="button"
			className="shrink-0 rounded border border-gold/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold-2 transition hover:bg-gold/15 disabled:cursor-not-allowed disabled:opacity-40"
			disabled={disabled}
			title={title}
			onClick={onClick}
		>
			{label}
		</button>
	);
}

function GigCard({ gig, debt }: { gig: Gig; debt: number }) {
	const { t } = useT();
	const cut = debt > 0 ? Math.min(debt, Math.round(gig.pay * DEBT_CUT)) : 0;
	return (
		<li className={`rounded-lg border p-2 text-xs ${gig.status === "taken" ? "border-gold/50 bg-gold/5" : "border-line bg-bg-2/60"}`} data-testid="gig-card">
			<div className="flex items-start justify-between gap-2">
				<span className="min-w-0 font-medium text-text">{gig.title}</span>
				<span className={`chip shrink-0 ${gig.status === "taken" ? "border-gold/60 text-gold-2" : "text-dim"}`}>{t(`play.den.gig.${gig.status === "taken" ? "taken" : "offered"}`)}</span>
			</div>
			<div className="mt-0.5 text-faint">
				{t(`play.den.kind.${gig.kind}` as MessageKey)} · {gig.client}
				{gig.status === "offered" && <> · {t("play.den.gig.until", { day: Math.floor(gig.expiresAt / DAY) })}</>}
			</div>
			{gig.brief && <p className="mt-1 text-dim">{gig.brief}</p>}
			<div className="mt-1.5 flex flex-wrap gap-1">
				<span className="chip text-gold-2"><Coins size={11} /> {t("play.den.gig.pay", { n: gig.pay })}</span>
				{gig.hat !== 0 && <span className="chip text-text"><VenetianMask size={11} /> {t("play.den.gig.hat", { n: gig.hat > 0 ? `+${gig.hat}` : String(gig.hat) })}</span>}
				{gig.heat > 0 && <span className="chip text-[#e0702f]"><Flame size={11} /> {t("play.den.gig.heat", { n: gig.heat })}</span>}
				<span className={`chip ${gig.risk >= 4 ? "border-crimson/50 text-crimson-2" : "text-dim"}`}><ShieldAlert size={11} /> {t("play.den.gig.risk", { n: gig.risk })}</span>
				{cut > 0 && <span className="chip border-crimson/40 text-crimson-2">{t("play.den.gig.cut", { n: cut })}</span>}
			</div>
		</li>
	);
}

function Section({ icon: Icon, title, help, children }: { icon: typeof Cpu; title: string; help?: string; children: React.ReactNode }) {
	const head = (
		<h4 className="heading mb-1.5 flex items-center gap-1.5 text-sm">
			<Icon size={14} /> {title}
		</h4>
	);
	return (
		<section>
			{help ? <Tooltip content={help} className="block w-full"><div tabIndex={0}>{head}</div></Tooltip> : head}
			{children}
		</section>
	);
}

function rentDueKey(den: DenState, now: number): { key: MessageKey; n: number } {
	const days = Math.ceil((den.rentDueAt - now) / DAY);
	return days <= 0 ? { key: "play.den.dueNow", n: 0 } : days === 1 ? { key: "play.den.dueOne", n: 1 } : { key: "play.den.due", n: days };
}

export function DenPanel({ state, busy, onChanged }: { state: GameState; busy: boolean; onChanged: () => void }) {
	const { t, ts } = useT();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const den = state.cyber?.den;
	const c = state.character;
	const cred = c.currency.gp;
	if (!den) {
		return <p className="text-sm text-faint">{t("play.den.none")}</p>;
	}
	const now = minuteOf(state.time);
	const where = state.world.locations.find((l) => l.id === den.locationId);
	const here = state.world.currentLocationId === den.locationId;
	const due = rentDueKey(den, now);
	const installed = DEN_UPGRADE_IDS.filter((id) => levelOf(den, id) > 0);
	const forSale = DEN_UPGRADE_IDS.filter((id) => nextPrice(den, id) !== undefined);
	const gigs = openGigs(state.cyber?.gigs).sort((a, b) => (a.status === b.status ? a.expiresAt - b.expiresAt : a.status === "taken" ? -1 : 1));
	const locked = busy || pending;

	async function post(body: Record<string, unknown>) {
		setPending(true);
		setError(null);
		try {
			const res = await fetch(`/api/campaigns/${state.id}/den`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const data = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
			else onChanged();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setPending(false);
		}
	}

	const upName = (id: DenUpgradeId) => t(`play.den.up.${id}` as MessageKey);
	const upEffect = (id: DenUpgradeId) => t(`play.den.up.${id}.effect` as MessageKey);
	const payDebt = Math.min(cred, den.debt);

	return (
		<div className="space-y-4" data-testid="den-panel">
			<section className="space-y-2 rounded-lg border border-line bg-bg-2/60 p-2.5">
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<h3 className="heading truncate text-base">{den.name}</h3>
						{where && where.name !== den.name && (
							<div className="flex items-center gap-1 text-xs text-faint">
								<MapPin size={11} /> {where.name}
							</div>
						)}
					</div>
					{here && <span className="chip shrink-0 border-gold/60 text-gold-2">{t("play.den.here")}</span>}
				</div>
				<div className="grid grid-cols-2 gap-2 text-xs">
					<div>
						<div className="text-dim">{t("play.den.cred")}</div>
						<div className="tabular-nums text-text">{cred}</div>
					</div>
					<Tooltip content={t("play.den.rentHelp")} className="block">
						<div tabIndex={0}>
							<div className="text-dim">{t("play.den.rent")}</div>
							<div className="tabular-nums text-text">{t("play.den.rentValue", { n: den.rent })}</div>
							<div className={due.n <= 1 ? "text-[#e7b25a]" : "text-faint"}>{t(due.key, { n: due.n })}</div>
						</div>
					</Tooltip>
				</div>
				{den.debt > 0 && (
					<Tooltip content={t("play.den.debtHelp", { max: REPO_WEEKS * (den.rent || START_RENT) })} className="block w-full">
						<div tabIndex={0} className="flex items-center justify-between gap-2 rounded border border-crimson/50 bg-crimson/5 px-2 py-1 text-xs" data-testid="den-debt">
							<span className="text-crimson-2">{t("play.den.debt")}: <span className="tabular-nums">{den.debt}</span></span>
							<BuyBtn label={t("play.den.payDebt", { n: payDebt })} disabled={locked || payDebt <= 0} onClick={() => void post({ op: "pay", amount: payDebt })} />
						</div>
					</Tooltip>
				)}
				{den.debt === 0 && (
					<div className="flex justify-end">
						<BuyBtn label={t("play.den.payWeek", { n: den.rent })} disabled={locked || cred < den.rent} onClick={() => void post({ op: "pay", amount: den.rent })} />
					</div>
				)}
			</section>

			{error && <p className="rounded border border-crimson/50 bg-crimson/5 px-2 py-1 text-xs text-crimson-2">{error}</p>}

			<Section icon={HomeIcon} title={t("play.den.installed")}>
				{installed.length === 0 ? (
					<p className="text-xs text-faint">{t("play.den.none")}</p>
				) : (
					<ul className="space-y-1.5">
						{installed.map((id) => (
							<li key={id} className="text-xs">
								<span className="text-text">{upName(id)}</span>
								{maxLevel(id) > 1 && <span className="text-faint"> · {t("play.den.level", { n: levelOf(den, id) })}</span>}
								<div className="text-dim">{upEffect(id)}</div>
							</li>
						))}
					</ul>
				)}
			</Section>

			{den.writing && (
				<Section icon={Hammer} title={t("play.den.writing")}>
					<p className="text-xs text-text">{t("play.den.writingValue", { program: ts(getSpell(den.writing.program)?.name ?? den.writing.program), day: Math.floor(den.writing.readyAt / DAY) })}</p>
				</Section>
			)}

			<Section icon={Cpu} title={t("play.den.catalogue")} help={t("play.den.catalogueHelp")}>
				<ul className="space-y-2">
					{forSale.map((id) => {
						const def = DEN_UPGRADES[id];
						const price = nextPrice(den, id)!;
						const lvl = levelOf(den, id);
						const blocked = def.excludes && levelOf(den, def.excludes) > 0 ? t("play.den.excluded", { other: upName(def.excludes) }) : undefined;
						const short = cred < price ? t("play.den.short", { n: price }) : undefined;
						return (
							<li key={id} className="flex items-start justify-between gap-2 text-xs" data-testid={`den-upgrade-${id}`}>
								<div className="min-w-0">
									<span className="text-text">{upName(id)}</span>
									{maxLevel(id) > 1 && <span className="text-faint"> · {t("play.den.level", { n: lvl + 1 })}</span>}
									{def.fixed && <span className="text-faint"> · {t("play.den.fixed")}</span>}
									<div className="text-dim">{upEffect(id)}</div>
									{blocked && <div className="text-crimson-2">{blocked}</div>}
								</div>
								<div className="flex shrink-0 flex-col items-end gap-1">
									<span className="tabular-nums text-gold-2">{t("play.den.price", { n: price })}</span>
									<BuyBtn label={t("play.den.buy")} disabled={locked || !!blocked || !!short} title={blocked ?? short} onClick={() => void post({ op: "buy", upgrade: id })} />
								</div>
							</li>
						);
					})}
				</ul>
			</Section>

			<Section icon={Briefcase} title={t("play.den.gigs")} help={t("play.den.gigsHelp")}>
				{gigs.length === 0 ? <p className="text-xs text-faint">{t("play.den.gigsNone")}</p> : <ul className="space-y-1.5">{gigs.map((g) => <GigCard key={g.id} gig={g} debt={den.debt} />)}</ul>}
			</Section>
		</div>
	);
}
