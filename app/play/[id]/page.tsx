"use client";

import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PlayLoading, PlayScreen } from "@/components/play/PlayScreen";

function Inner({ id }: { id: string }) {
	const params = useSearchParams();
	// Captured once: the ?opening=1 flag is stripped from the URL right after.
	const [opening] = useState(() => params.get("opening") === "1");
	useEffect(() => {
		if (opening) window.history.replaceState(null, "", `/play/${id}`);
	}, [id, opening]);
	return <PlayScreen id={id} opening={opening} />;
}

export default function PlayPage({ params }: PageProps<"/play/[id]">) {
	const { id } = use(params);
	return (
		<Suspense fallback={<PlayLoading />}>
			<Inner id={id} />
		</Suspense>
	);
}
