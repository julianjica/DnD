"use client";

import { Backpack, Coins } from "lucide-react";
import type { CreationOptions } from "@/lib/rules/character";
import { getClass, getBackground, getEquipment } from "@/lib/srd";
import { cn } from "@/components/ui/cn";
import { describeOption } from "./ChoicePicker";
import { Tooltip } from "@/components/ui/Tooltip";
import { useT } from "@/components/i18n/I18nProvider";
import { srdName } from "./i18n";

export interface EquipmentPickerProps {
	opts: CreationOptions;
	value: { option: number; picks: string[] }[];
	onChange: (v: { option: number; picks: string[] }[]) => void;
}

const nameOf = (ref: string) => getEquipment(ref)?.name ?? ref;

/** Starting equipment: one option per choice, plus category picks ("any martial weapon"). */
export function EquipmentPicker({ opts, value, onChange }: EquipmentPickerProps) {
	const cls = getClass(opts.classId);
	const { t, lang, ts } = useT();
	const bg = getBackground(opts.backgroundId);
	const fixed = [...(cls?.startingEquipment ?? []), ...(bg?.equipment ?? [])];
	const get = (i: number) => value[i] ?? { option: 0, picks: [] };
	const setAt = (i: number, v: { option: number; picks: string[] }) => {
		const next = opts.equipment.map((_, j) => (j === i ? v : get(j)));
		onChange(next);
	};

	return (
		<div className="flex flex-col gap-4">
			{fixed.length > 0 && (
				<div className="rounded-lg border border-line bg-bg-2/50 p-4">
					<div className="mb-2 flex items-center gap-2 font-display text-sm tracking-wide">
						<Backpack className="size-4 text-gold/80" /> {t("equip.always")}
					</div>
					<div className="flex flex-wrap gap-1.5">
						{fixed.map((g, i) => (
							<Tooltip key={`${g.ref}-${i}`} content={describeOption(g.ref, lang)}>
								<span className="chip text-xs">
									{g.qty > 1 ? `${g.qty}× ` : ""}
									{nameOf(g.ref)}
								</span>
							</Tooltip>
						))}
						<span className="chip text-xs text-gold-2">
							<Coins className="size-3" /> {t("sheet.gp", { n: opts.startingGold })}
						</span>
					</div>
				</div>
			)}
			{opts.equipment.map((ec, i) => {
				const sel = get(i);
				const opt = ec.options[sel.option];
				let cursor = 0;
				return (
					<fieldset key={ec.index} className="rounded-lg border border-line bg-bg-2/50 p-4">
						<legend className="sr-only">{ts(ec.desc)}</legend>
						<div className="mb-2 flex items-center gap-2 text-xs tracking-wider text-dim uppercase">
							{t("equip.chooseOne", { from: (ec.from === "class" ? cls && srdName(lang, "class", cls.index, cls.name) : bg && srdName(lang, "background", bg.index, bg.name)) ?? "" })}
						</div>
						<div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={ts(ec.desc)}>
							{ec.options.map((o, oi) => {
								const on = oi === sel.option;
								return (
									<button
										key={oi}
										type="button"
										role="radio"
										aria-checked={on}
										onClick={() => setAt(i, { option: oi, picks: [] })}
										className={cn(
											"rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-gold",
											on ? "border-gold bg-gold/10 text-gold-2" : "border-line text-text/85 hover:border-gold/50",
										)}
									>
										<span className="mr-2 inline-grid size-4 place-items-center rounded-full border border-current align-[-2px]">{on && <span className="size-2 rounded-full bg-current" />}</span>
										{ts(o.label)}
									</button>
								);
							})}
						</div>
						{opt?.picks.map((p, pi) => {
							const start = cursor;
							cursor += p.choose;
							return (
								<div key={pi} className="mt-3 flex flex-wrap items-center gap-2">
									<span className="text-xs text-dim">{ts(p.label)}:</span>
									{Array.from({ length: p.choose }, (_, k) => {
										const slot = start + k;
										return (
											<select
												key={k}
												className="input w-auto max-w-56 py-1 text-sm"
												value={sel.picks[slot] ?? ""}
												aria-label={`${ts(p.label)} ${k + 1}`}
												onChange={(e) => {
													const picks = [...sel.picks];
													while (picks.length < slot) picks.push("");
													picks[slot] = e.target.value;
													setAt(i, { option: sel.option, picks });
												}}
											>
												<option value="">{t("equip.dmChoice")}</option>
												{p.options.map((x) => (
													<option key={x.index} value={x.index}>
														{ts(x.name)}
													</option>
												))}
											</select>
										);
									})}
								</div>
							);
						})}
					</fieldset>
				);
			})}
		</div>
	);
}
