import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { registerBuiltInAgents } from "./agents/index.js";
import { loadMultiAgentConfig } from "./config.js";
import { TaskDelegator } from "./orchestration/TaskDelegator.js";
import { DynamicPromptBuilder } from "./prompts/DynamicPromptBuilder.js";
import { AgentRegistry } from "./registry/AgentRegistry.js";
import { CategoryRouter } from "./routing/CategoryRouter.js";
import { createBackgroundCancelTool, createBackgroundOutputTool } from "./tools/background-task-tool.js";
import { createSharedStateTool } from "./tools/shared-state-tool.js";
import { createTaskTool } from "./tools/task-tool.js";

interface MultiAgentRuntime {
	signature: string;
	registry: AgentRegistry;
	categoryRouter: CategoryRouter;
	delegator: TaskDelegator;
}

const VALID_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

let runtime: MultiAgentRuntime | undefined;

function parseThinkingLevel(input: string | undefined): ThinkingLevel | undefined {
	if (!input) {
		return undefined;
	}
	if (VALID_THINKING_LEVELS.includes(input as ThinkingLevel)) {
		return input as ThinkingLevel;
	}
	throw new Error(`Invalid thinking level: ${input}`);
}

function buildRuntime(ctx: ExtensionContext): MultiAgentRuntime {
	const config = loadMultiAgentConfig(ctx.cwd);
	const signature = JSON.stringify(config);
	if (runtime && runtime.signature === signature) {
		return runtime;
	}

	const registry = new AgentRegistry();
	const categoryRouter = new CategoryRouter();
	const promptBuilder = new DynamicPromptBuilder(registry, categoryRouter);
	registerBuiltInAgents(registry, promptBuilder);

	for (const [name, agentConfig] of Object.entries(config.agents ?? {})) {
		if (agentConfig.disabled) {
			registry.setDisabled(name, true);
		}
	}

	const delegator = new TaskDelegator(registry, categoryRouter, config, ctx);
	const nextRuntime: MultiAgentRuntime = {
		signature,
		registry,
		categoryRouter,
		delegator,
	};
	runtime = nextRuntime;
	return nextRuntime;
}

function splitArgs(raw: string): string[] {
	return raw
		.trim()
		.split(/\s+/)
		.filter((value) => value.length > 0);
}

function renderAgentList(ctx: ExtensionCommandContext): string {
	const current = buildRuntime(ctx);
	return current.registry
		.list()
		.map((agentName) => {
			const metadata = current.registry.getMetadata(agentName);
			if (!metadata) {
				return `${agentName}`;
			}
			const defaultCategory = current.categoryRouter
				.list()
				.find((category) => category.defaultAgent === agentName)?.name;
			return `${agentName} [${metadata.mode}]${defaultCategory ? ` category=${defaultCategory}` : ""} - ${metadata.description}`;
		})
		.join("\n");
}

function renderModelList(ctx: ExtensionCommandContext, provider?: string): string {
	const models = ctx.modelRegistry
		.getAvailable()
		.filter((model) => (provider ? model.provider === provider : true))
		.map((model) => `${model.provider}/${model.id}`)
		.sort();
	if (models.length === 0) {
		return provider ? `No models available for provider ${provider}.` : "No models available.";
	}
	return models.join("\n");
}

async function renderResolvedAgent(ctx: ExtensionCommandContext, agentName: string, category?: string): Promise<string> {
	const current = buildRuntime(ctx);
	const resolved = await current.delegator.resolve(agentName, category);
	const thinking = resolved.thinkingLevel ? ` thinking=${resolved.thinkingLevel}` : "";
	return `${agentName} -> ${resolved.modelId} via ${resolved.resolvedVia}${thinking}`;
}

export default function multiAgentExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		buildRuntime(ctx);
	});

	pi.registerTool(createTaskTool((ctx) => buildRuntime(ctx).delegator));
	pi.registerTool(createBackgroundOutputTool((ctx) => buildRuntime(ctx).delegator));
	pi.registerTool(createBackgroundCancelTool((ctx) => buildRuntime(ctx).delegator));
	pi.registerTool(createSharedStateTool());

	pi.registerCommand("agents", {
		description: "List registered multi-agent workers and defaults",
		handler: async (_args, ctx) => {
			const output = renderAgentList(ctx);
			console.log(output);
			if (ctx.hasUI) {
				ctx.ui.notify("Printed multi-agent registry", "info");
			}
		},
	});

	pi.registerCommand("agent.get_model", {
		description: "Resolve configured model for an agent",
		handler: async (args, ctx) => {
			const [agentName, category] = splitArgs(args);
			if (!agentName) {
				throw new Error("Usage: /agent.get_model <agentName> [category]");
			}
			console.log(await renderResolvedAgent(ctx, agentName, category));
		},
	});

	pi.registerCommand("agent.set_model", {
		description: "Set runtime model override for an agent",
		handler: async (args, ctx) => {
			const [agentName, model, thinkingLevelRaw] = splitArgs(args);
			if (!agentName || !model) {
				throw new Error("Usage: /agent.set_model <agentName> <provider/model> [thinkingLevel]");
			}
			const current = buildRuntime(ctx);
			current.delegator.setModel(agentName, model, parseThinkingLevel(thinkingLevelRaw));
			console.log(await renderResolvedAgent(ctx, agentName));
		},
	});

	pi.registerCommand("agent.set_provider", {
		description: "Set runtime provider override for an agent",
		handler: async (args, ctx) => {
			const [agentName, provider, thinkingLevelRaw] = splitArgs(args);
			if (!agentName || !provider) {
				throw new Error("Usage: /agent.set_provider <agentName> <provider> [thinkingLevel]");
			}
			const current = buildRuntime(ctx);
			current.delegator.setProvider(agentName, provider, parseThinkingLevel(thinkingLevelRaw));
			console.log(await renderResolvedAgent(ctx, agentName));
		},
	});

	pi.registerCommand("agent.reset_model", {
		description: "Reset runtime model override for an agent",
		handler: async (args, ctx) => {
			const [agentName] = splitArgs(args);
			if (!agentName) {
				throw new Error("Usage: /agent.reset_model <agentName>");
			}
			const current = buildRuntime(ctx);
			current.delegator.resetModel(agentName);
			console.log(await renderResolvedAgent(ctx, agentName));
		},
	});

	pi.registerCommand("models", {
		description: "List available models (optionally for one provider)",
		handler: async (args, ctx) => {
			const [provider] = splitArgs(args);
			console.log(renderModelList(ctx, provider));
		},
	});
}

export { AgentRegistry } from "./registry/AgentRegistry.js";
export type { AgentConfig, AgentFactory, AgentMode } from "./registry/types.js";
export { CategoryRouter, DEFAULT_CATEGORIES } from "./routing/CategoryRouter.js";
export { ModelRouter } from "./routing/ModelRouter.js";
export type {
	AgentModelConfig,
	ModelCapability,
	ModelChainEntry,
	MultiAgentConfig,
	ProviderKeyOverrides,
	ResolvedModel,
} from "./routing/types.js";
export { TaskDelegator } from "./orchestration/TaskDelegator.js";
export type { TaskDelegateParams, TaskDelegateResult } from "./orchestration/TaskDelegator.js";
