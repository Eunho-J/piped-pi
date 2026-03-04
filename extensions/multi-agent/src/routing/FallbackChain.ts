import type { ModelChainEntry } from "./types.js";

export function normalizeModelChain(entries: Array<string | ModelChainEntry> | undefined): ModelChainEntry[] {
	if (!entries || entries.length === 0) {
		return [];
	}
	return entries.map((entry) => {
		if (typeof entry === "string") {
			return { model: entry };
		}
		return entry;
	});
}
