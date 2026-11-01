"use client";

import { use, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PlayScreen } from "@/components/play/PlayScreen";

function Inner({ id }: { id: string }) {
	const params = useSearchParams();
	const opening = useRef(params.get("opening") === "1");
	useEffect(() => {
		if (opening.current) window.history.replaceState(null, "", `/play/${id}`);
	}, [id]);
	return <PlayScreen id={id} opening={opening.current} />;
}

export default function PlayPage({ params }: PageProps<"/play/[id]">) {
	const { id } = use(params);
	return (
		<Suspense fallback={<div className="grid h-screen place-items-center text-dim">Loading…</div>}>
			<Inner id={id} />
		</Suspense>
	);
}
