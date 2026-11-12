import type { GameState, Gig, GigKind } from "../game/types";
import { addHeat, cyberOf, hatText, isCyber, shiftHat } from "./cyber";
import { DAY, DEBT_CUT, denLog, denOf } from "./den";
import { gameMinutes } from "./survival";

/**
 * Root Access gigs (docs/cyberpunk.md §6): jobs from La Tía, factions and job
 * boards. Each shows its pay, risk, hat shift and heat. The DM offers them;
 * the PC takes one; the DM closes it done or failed. Done pays (minus La Tía's
 * cut while the PC owes her), shifts the Hat and adds the Heat; failed pays
 * nothing and still makes half the noise. Offers expire on the tick.
 */

export const GIG_KINDS: GigKind[] = ["heist", "sabotage", "leak", "ransom", "bounty", "defence", "extraction", "skiptrace"];
export const GIG_KIND_TEXT: Record<GigKind, string> = {
	heist: "data heist",
	sabotage: "sabotage",
	leak: "exposé / leak",
	ransom: "ransom",
	bounty: "bug bounty",
	defence: "defence (a reverse run: protect a client's system from another hacker)",
	extraction: "extraction (the physical world plus net support)",
	skiptrace: "skip trace (find a person)",
};
/** Closed gigs kept for the record. */
export const GIG_HISTORY = 12;
export const MAX_OPEN_GIGS = 8;

export interface GigOffer {
	title: string;
	client: string;
	kind: GigKind;
	pay: number;
	hat: number;
	heat: number;
	risk: number;
	brief: string;
	/** Days the offer stays open. */
	days: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

export const gigsOf = (state: GameState): Gig[] => {
	const cy = cyberOf(state);
	if (!cy.gigs) cy.gigs = [];
	return cy.gigs;
};

export const openGigs = (gigs: readonly Gig[] | undefined): Gig[] => (gigs ?? []).filter((g) => g.status === "offered" || g.status === "taken");

export function gigLine(g: Gig): string {
	return `${g.id} "${g.title}" for ${g.client} (${g.kind}, ${g.pay} cred, Hat ${hatText(g.hat)}, Heat +${g.heat}, risk ${g.risk}/5)`;
}

function prune(gigs: Gig[]): void {
	const closed = gigs.filter((g) => g.status !== "offered" && g.status !== "taken");
	if (closed.length <= GIG_HISTORY) return;
	const drop = new Set(closed.slice(0, closed.length - GIG_HISTORY));
	for (let i = gigs.length - 1; i >= 0; i--) if (drop.has(gigs[i])) gigs.splice(i, 1);
}

export function offerGig(state: GameState, o: GigOffer, id: string): { gig: Gig; text: string } {
	if (!GIG_KINDS.includes(o.kind)) throw new Error(`Unknown gig kind '${o.kind}' (use ${GIG_KINDS.join(", ")}).`);
	const title = String(o.title ?? "").trim().slice(0, 80);
	if (!title) throw new Error("A gig needs a title.");
	const gigs = gigsOf(state);
	if (openGigs(gigs).length >= MAX_OPEN_GIGS) throw new Error(`Already ${MAX_OPEN_GIGS} open gigs; let some expire or close them first.`);
	const now = gameMinutes(state.time);
	const gig: Gig = {
		id,
		title,
		client: String(o.client ?? "").trim().slice(0, 60) || "La Tía",
		kind: o.kind,
		pay: clamp(o.pay, 0, 1_000_000),
		hat: clamp(o.hat, -3, 3),
		heat: clamp(o.heat, 0, 4),
		risk: clamp(o.risk, 1, 5),
		brief: String(o.brief ?? "").trim().slice(0, 300),
		status: "offered",
		offeredAt: now,
		expiresAt: now + clamp(o.days, 1, 30) * DAY,
	};
	gigs.push(gig);
	return { gig, text: `Gig offered: ${gigLine(gig)}, open until Day ${Math.floor(gig.expiresAt / DAY)}. It's on the player's gig board.` };
}

export function findGig(state: GameState, ref: string): Gig | undefined {
	const gigs = state.cyber?.gigs ?? [];
	const r = ref.trim().toLowerCase();
	return gigs.find((g) => g.id === ref.trim()) ?? [...gigs].reverse().find((g) => g.title.toLowerCase() === r) ?? [...gigs].reverse().find((g) => g.title.toLowerCase().includes(r) && (g.status === "offered" || g.status === "taken"));
}

export function takeGig(state: GameState, ref: string): { gig: Gig; text: string } {
	const g = findGig(state, ref);
	if (!g) throw new Error(`No gig '${ref}'. Open: ${openGigs(state.cyber?.gigs).map(gigLine).join("; ") || "none"}.`);
	if (g.status !== "offered") throw new Error(`"${g.title}" is ${g.status}, not on offer.`);
	g.status = "taken";
	return { gig: g, text: `Taken: ${gigLine(g)}. Play the job; close it with complete_gig (done or failed).` };
}

/** Closes a taken (or offered) gig: done pays, shifts Hat, adds Heat, La Tía's cut while in debt; failed pays nothing and makes half the noise. */
export function completeGig(state: GameState, ref: string, outcome: "done" | "failed", why = ""): { gig: Gig; paid: number; cut: number; text: string } {
	const g = findGig(state, ref);
	if (!g) throw new Error(`No gig '${ref}'. Open: ${openGigs(state.cyber?.gigs).map(gigLine).join("; ") || "none"}.`);
	if (g.status !== "taken" && g.status !== "offered") throw new Error(`"${g.title}" is already ${g.status}.`);
	const cy = cyberOf(state);
	const den = denOf(state);
	const now = gameMinutes(state.time);
	const lines: string[] = [];
	const reason = why.trim() || g.title;
	let paid = 0;
	let cut = 0;
	if (outcome === "done") {
		g.status = "done";
		if (den.debt > 0 && g.pay > 0) {
			cut = Math.min(den.debt, Math.round(g.pay * DEBT_CUT));
			den.debt -= cut;
			denLog(den, now, `La Tía took ${cut} of "${g.title}" (debt ${den.debt})`);
		}
		paid = g.pay - cut;
		state.character.currency.gp += paid;
		lines.push(`Gig DONE: "${g.title}" for ${g.client}. Paid ${paid} cred${cut ? ` (La Tía took her ${Math.round(DEBT_CUT * 100)}%: ${cut} off the debt, ${den.debt} left)` : ""}; cred now ${state.character.currency.gp}.`);
		if (g.hat) lines.push(shiftHat(cy, g.hat, `${g.kind}: ${reason}`, now).text);
		if (g.heat) lines.push(addHeat(cy, g.heat, `${g.kind}: ${reason}`, now).text);
	} else {
		g.status = "failed";
		const heat = Math.ceil(g.heat / 2);
		lines.push(`Gig FAILED: "${g.title}" for ${g.client}. No pay; the client remembers.`);
		if (heat) lines.push(addHeat(cy, heat, `botched ${g.kind}: ${reason}`, now).text);
	}
	prune(gigsOf(state));
	return { gig: g, paid, cut, text: lines.join(" ") };
}

export function failGig(state: GameState, ref: string, why = ""): { gig: Gig; text: string } {
	const r = completeGig(state, ref, "failed", why);
	return { gig: r.gig, text: r.text };
}

/** Offers past their date expire (taken gigs stay until the DM closes them). */
export function gigTick(state: GameState): string | undefined {
	if (!isCyber(state) || !state.cyber?.gigs?.length) return undefined;
	const now = gameMinutes(state.time);
	const gone = state.cyber.gigs.filter((g) => g.status === "offered" && now >= g.expiresAt);
	if (!gone.length) return undefined;
	for (const g of gone) g.status = "expired";
	prune(state.cyber.gigs);
	return `GIGS: expired (the client went elsewhere): ${gone.map((g) => `"${g.title}"`).join(", ")}.`;
}

/** One digest line. */
export function gigDigest(state: GameState): string | undefined {
	const open = openGigs(state.cyber?.gigs);
	if (!open.length) return undefined;
	const taken = open.filter((g) => g.status === "taken");
	const offered = open.filter((g) => g.status === "offered");
	return [taken.length ? `Gigs taken: ${taken.map(gigLine).join("; ")}` : "", offered.length ? `Gigs on offer: ${offered.map((g) => `${gigLine(g)} until Day ${Math.floor(g.expiresAt / DAY)}`).join("; ")}` : ""].filter(Boolean).join(" · ");
}
