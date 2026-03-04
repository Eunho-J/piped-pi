import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { MultiAgentConfig } from "./routing/types.js";

interface SettingsWithMultiAgent {
	multiAgent?: MultiAgentConfig;
}

function readSettings(path: string): SettingsWithMultiAgent {
	if (!existsSync(path)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(path, "utf8")) as SettingsWithMultiAgent;
	} catch {
		return {};
	}
}

function mergeConfig(base: MultiAgentConfig, override: MultiAgentConfig | undefined): MultiAgentConfig {
	if (!override) {
		return base;
	}
	return {
		...base,
		...override,
		agents: { ...(base.agents ?? {}), ...(override.agents ?? {}) },
		categories: { ...(base.categories ?? {}), ...(override.categories ?? {}) },
		providerKeys: { ...(base.providerKeys ?? {}), ...(override.providerKeys ?? {}) },
	};
}

export function loadMultiAgentConfig(cwd: string): MultiAgentConfig {
	const globalSettings = readSettings(join(getAgentDir(), "settings.json")).multiAgent;
	const projectSettings = readSettings(join(cwd, ".pi", "settings.json")).multiAgent;
	const merged = mergeConfig(mergeConfig({}, globalSettings), projectSettings);
	if (merged.enabled === undefined) {
		merged.enabled = true;
	}
	return merged;
}
