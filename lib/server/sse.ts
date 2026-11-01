import type { ClientEvent } from "../dm/context";

/**
 * Server-sent events response. `run` keeps going even if the browser
 * disconnects (the turn must finish and persist); emits after close are dropped.
 */
export function sseResponse(run: (emit: (e: ClientEvent) => void) => Promise<void>): Response {
	const encoder = new TextEncoder();
	let closed = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const emit = (e: ClientEvent) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
				} catch {
					closed = true;
				}
			};
			const ping = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`: ping\n\n`));
				} catch {
					closed = true;
				}
			}, 15000);
			run(emit)
				.catch((error: unknown) => emit({ type: "error", message: error instanceof Error ? error.message : String(error) }))
				.finally(() => {
					clearInterval(ping);
					if (!closed) {
						closed = true;
						try {
							controller.close();
						} catch {
							// already closed
						}
					}
				});
		},
		cancel() {
			closed = true;
		},
	});
	return new Response(stream, {
		headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
	});
}

export function jsonError(message: string, status = 400): Response {
	return Response.json({ error: message }, { status });
}
