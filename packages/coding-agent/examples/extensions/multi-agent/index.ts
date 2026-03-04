import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { TaskDelegator } from "./src/orchestration/TaskDelegator.js";
import type { ModelRouterConfig } from "./src/routing/types.js";

interface DelegatorCache {
	configPath?: string;
	mtimeMs?: number;
	delegator?: TaskDelegator;
}

const cache: DelegatorCache = {};

function splitArgs(raw: string): string[] {
	return raw
		.trim()
		.split(/\s+/)
		.filter((value) => value.length > 0);
}

function findNearestConfigPath(cwd: string): string | undefined {
	let current = cwd;
	while (true) {
		const candidate = join(current, ".pi", "multi-agent.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfig(configPath: string | undefined): ModelRouterConfig {
	if (!configPath) return {};
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
		if (!isRecord(parsed)) return {};
		return parsed as ModelRouterConfig;
	} catch {
		return {};
	}
}

function formatModelLines(models: ReturnType<TaskDelegator["listModels"]>): string {
	if (models.length === 0) return "No models found.";
	return models.map((model) => `${model.provider}/${model.id}`).join("\n");
}

function printResolvedModel(
	ctx: ExtensionCommandContext,
	action: string,
	agentName: string,
	delegator: TaskDelegator,
	category?: string,
): void {
	const strategy = delegator.resolveStrategy(agentName, category);
	if (!strategy) {
		console.log(`[${action}] ${agentName}: no matching model`);
		return;
	}
	const tried = strategy.tried.length > 0 ? ` tried=${strategy.tried.join(",")}` : "";
	console.log(`[${action}] ${agentName}: ${strategy.provider}/${strategy.modelId} (${strategy.source})${tried}`);
	strategy.cleanup();
	if (ctx.hasUI) {
		ctx.ui.notify(`${agentName} -> ${strategy.provider}/${strategy.modelId}`, "info");
	}
}

function getDelegator(ctx: ExtensionCommandContext): TaskDelegator {
	const configPath = findNearestConfigPath(ctx.cwd);
	const mtimeMs = configPath ? statSync(configPath).mtimeMs : undefined;
	const needsRefresh = cache.delegator === undefined || cache.configPath !== configPath || cache.mtimeMs !== mtimeMs;

	if (needsRefresh) {
		cache.configPath = configPath;
		cache.mtimeMs = mtimeMs;
		cache.delegator = new TaskDelegator(ctx.modelRegistry, readConfig(configPath));
	}

	if (!cache.delegator) {
		cache.delegator = new TaskDelegator(ctx.modelRegistry, readConfig(configPath));
	}

	return cache.delegator;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("agent.list_models", {
		description: "List all models known to ModelRouter",
		handler: async (_args, ctx) => {
			const delegator = getDelegator(ctx);
			console.log(formatModelLines(delegator.listModels()));
		},
	});

	pi.registerCommand("agent.list_available_models", {
		description: "List currently available models (with credentials)",
		handler: async (_args, ctx) => {
			const delegator = getDelegator(ctx);
			console.log(formatModelLines(delegator.listAvailableModels()));
		},
	});

	pi.registerCommand("agent.get_model", {
		description: "Resolve current model for an agent: /agent.get_model <agent> [category]",
		handler: async (args, ctx) => {
			const [agentName, category] = splitArgs(args);
			if (!agentName) {
				throw new Error("Usage: /agent.get_model <agent> [category]");
			}
			const delegator = getDelegator(ctx);
			printResolvedModel(ctx, "get_model", agentName, delegator, category);
		},
	});

	pi.registerCommand("agent.set_model", {
		description: "Set runtime model override: /agent.set_model <agent> <provider/model>",
		handler: async (args, ctx) => {
			const [agentName, modelReference] = splitArgs(args);
			if (!agentName || !modelReference) {
				throw new Error("Usage: /agent.set_model <agent> <provider/model>");
			}
			const delegator = getDelegator(ctx);
			delegator.setModel(agentName, modelReference);
			printResolvedModel(ctx, "set_model", agentName, delegator);
		},
	});

	pi.registerCommand("agent.set_provider", {
		description: "Set runtime provider override: /agent.set_provider <agent> <provider>",
		handler: async (args, ctx) => {
			const [agentName, provider] = splitArgs(args);
			if (!agentName || !provider) {
				throw new Error("Usage: /agent.set_provider <agent> <provider>");
			}
			const delegator = getDelegator(ctx);
			delegator.setProvider(agentName, provider);
			printResolvedModel(ctx, "set_provider", agentName, delegator);
		},
	});

	pi.registerCommand("agent.reset_model", {
		description: "Clear runtime model/provider override: /agent.reset_model <agent>",
		handler: async (args, ctx) => {
			const [agentName] = splitArgs(args);
			if (!agentName) {
				throw new Error("Usage: /agent.reset_model <agent>");
			}
			const delegator = getDelegator(ctx);
			delegator.resetModel(agentName);
			printResolvedModel(ctx, "reset_model", agentName, delegator);
		},
	});
}
