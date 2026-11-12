import type { Metadata } from "next";
import { notFound } from "next/navigation";
import HairPreview from "./HairPreview";

export const metadata: Metadata = { title: "Hair preview · DungeonHarness" };

/** PREVIEW ONLY (dev builds): the new men's hair styles next to the existing ones. */
export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	if (process.env.NODE_ENV === "production") notFound();
	const q = await searchParams;
	const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
	return <HairPreview only={one("only")} size={Number(one("size")) || 104} cols={one("cols")?.split(",").map(Number) ?? null} />;
}
