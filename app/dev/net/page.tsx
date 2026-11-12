import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NetPreview from "./NetPreview";

export const metadata: Metadata = { title: "Net preview · DungeonHarness" };

/** PREVIEW ONLY (dev builds): the three net styles for Root Access net runs. */
export default function Page() {
	if (process.env.NODE_ENV === "production") notFound();
	return <NetPreview />;
}
