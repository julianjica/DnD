import type { MutableModels } from "@earendil-works/pi-ai";
import { loadPiAi, loadPiProviders } from "./esm";

/**
 * The process-wide pi-ai Models collection with every builtin provider's
 * catalog (learnharness models.ts piModels()). Auth is resolved per request
 * by pi-ai from process.env — keys.ts reflects saved keys into it.
 */
let collection: Promise<MutableModels> | undefined;

export function piModels(): Promise<MutableModels> {
	collection ??= (async () => {
		const [{ createModels }, { builtinProviders }] = await Promise.all([loadPiAi(), loadPiProviders()]);
		const models = createModels({ identity: { userAgent: { custom: "dungeonharness/0.1.0" }, attribution: { name: "dungeonharness" } } as never });
		for (const provider of builtinProviders()) models.setProvider(provider);
		return models;
	})();
	return collection;
}
