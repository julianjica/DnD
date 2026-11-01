import type { Metadata } from "next";
import MapsPreview from "./MapsPreview";

export const metadata: Metadata = { title: "Map preview · DungeonHarness" };

export default function Page() {
	return <MapsPreview />;
}
