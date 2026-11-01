import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DEFAULT_LANG, isLang, LANG_COOKIE, translate } from "@/lib/i18n";
import { SettingsScreen } from "./SettingsScreen";

export async function generateMetadata(): Promise<Metadata> {
	const saved = (await cookies()).get(LANG_COOKIE)?.value;
	return { title: translate(isLang(saved) ? saved : DEFAULT_LANG, "meta.settings") };
}

export default function SettingsPage() {
	return <SettingsScreen />;
}
