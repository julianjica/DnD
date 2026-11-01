import type { CampaignSettings } from "@/lib/game/types";
import type { CharacterDraft, WizardDraft } from "./wizardState";

export type DraftUpdater = (fn: (d: WizardDraft) => WizardDraft) => void;

export interface StepProps {
	draft: WizardDraft;
	update: DraftUpdater;
}

/** Patch one section of the campaign settings. */
export function patchSettings<K extends keyof CampaignSettings>(update: DraftUpdater, key: K, patch: Partial<CampaignSettings[K]>) {
	update((d) => ({ ...d, settings: { ...d.settings, [key]: { ...d.settings[key], ...patch } } }));
}

export function patchCharacter(update: DraftUpdater, patch: Partial<CharacterDraft>) {
	update((d) => ({ ...d, character: { ...d.character, ...patch } }));
}
