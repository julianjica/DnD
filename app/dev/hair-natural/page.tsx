import type { Metadata } from "next";
import { notFound } from "next/navigation";
import HairNaturalPreview from "./HairNaturalPreview";

export const metadata: Metadata = { title: "Natural hair preview · DungeonHarness" };

/**
 * PREVIEW ONLY (dev builds): the natural everyday men's cuts, not yet live.
 * `?only=m_crew,m_buzz` picks cuts, `?cols=0,3` picks columns, `?size=` sets the
 * portrait width, `?old=0` hides the old men's styles at the bottom, `?skipnew=1` shows only them.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
	if (process.env.NODE_ENV === "production") notFound();
	const q = await searchParams;
	const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : null);
	return (
		<HairNaturalPreview
			only={one("only")?.split(",") ?? null}
			size={Number(one("size")) || 120}
			cols={one("cols")?.split(",").map(Number) ?? null}
			old={one("old") !== "0"}
			sprites={one("sprites") !== "0"}
			small={one("small") !== "0"}
			skipNew={one("skipnew") === "1"}
		/>
	);
}
