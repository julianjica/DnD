import type { Metadata } from "next";
import { SetupWizard } from "@/components/setup/SetupWizard";

export const metadata: Metadata = { title: "New Adventure · DungeonHarness" };

export default function NewAdventurePage() {
	return <SetupWizard />;
}
