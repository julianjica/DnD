import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SetupWizard } from "@/components/setup/SetupWizard";
import { DEFAULT_LANG, isLang, LANG_COOKIE, translate } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
	const saved = (await cookies()).get(LANG_COOKIE)?.value;
	return { title: translate(isLang(saved) ? saved : DEFAULT_LANG, "meta.new") };
}

export default function NewAdventurePage() {
	return <SetupWizard />;
}
