/** Prints plan usage limits + engine status (spends no tokens): npx tsx scripts/engines/limits.ts */
async function main() {
	const { planLimits, engineStatus, listModels } = await import("../../lib/engines");
	console.log(JSON.stringify(engineStatus(), null, 2));
	const models = await listModels();
	const byGroup: Record<string, number> = {};
	for (const m of models) byGroup[`${m.provider}${m.apiProvider ? `/${m.apiProvider}` : ""}${m.available ? "" : " (unavailable)"}`] = (byGroup[`${m.provider}${m.apiProvider ? `/${m.apiProvider}` : ""}${m.available ? "" : " (unavailable)"}`] ?? 0) + 1;
	console.log(byGroup);
	console.log(JSON.stringify(await planLimits(0), null, 2));
	process.exit(0);
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
