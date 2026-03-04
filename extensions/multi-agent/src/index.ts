import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
	createIpcMessage,
	type PubSubSubscribeMessage,
	type SessionFollowUpMessage,
	type SessionSteerMessage,
} from "@mariozechner/pi-ipc";
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

function splitFirstArg(raw: string): { first: string | undefined; rest: string } {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return { first: undefined, rest: "" };
	}
	const firstSpace = trimmed.indexOf(" ");
	if (firstSpace === -1) {
		return { first: trimmed, rest: "" };
	}
	return {
		first: trimmed.slice(0, firstSpace),
		rest: trimmed.slice(firstSpace + 1).trim(),
	};
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

async function renderAllResolvedAgents(ctx: ExtensionCommandContext): Promise<string> {
	const current = buildRuntime(ctx);
	const lines = await Promise.all(
		current.registry.list().map(async (agentName) => {
			try {
				return await renderResolvedAgent(ctx, agentName);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return `${agentName} -> unresolved (${message})`;
			}
		}),
	);
	return lines.join("\n");
}

function resolveTargetSocket(ctx: ExtensionCommandContext, sessionId: string): string {
	if (!ctx.agentDiscovery) {
		throw new Error("agentDiscovery is unavailable in this runtime.");
	}
	const socketPath = ctx.agentDiscovery.getSocketPath(sessionId);
	if (!socketPath) {
		throw new Error(`No alive agent session found for ${sessionId}.`);
	}
	return socketPath;
}

async function sendIpcCommand(
	ctx: ExtensionCommandContext,
	socketPath: string,
	message: SessionSteerMessage | SessionFollowUpMessage | PubSubSubscribeMessage,
): Promise<void> {
	if (!ctx.createIpcClient) {
		throw new Error("createIpcClient() is unavailable in this runtime.");
	}
	const client = ctx.createIpcClient(socketPath);
	try {
		const response = await client.send(message);
		if (!response.success) {
			throw new Error(response.error ?? "ipc_request_failed");
		}
	} finally {
		await client.disconnect();
	}
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

	pi.registerCommand("agent.list_models", {
		description: "Resolve effective model assignments for all registered agents",
		handler: async (_args, ctx) => {
			console.log(await renderAllResolvedAgents(ctx));
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

	pi.registerCommand("agent.list_available_models", {
		description: "List available models, optionally filtered by provider",
		handler: async (args, ctx) => {
			const [provider] = splitArgs(args);
			console.log(renderModelList(ctx, provider));
		},
	});

	pi.registerCommand("agent.discover", {
		description: "List alive IPC agent sessions discovered from socket metadata",
		handler: async (_args, ctx) => {
			if (!ctx.agentDiscovery) {
				throw new Error("agentDiscovery is unavailable in this runtime.");
			}
			const records = ctx.agentDiscovery.listAlive();
			if (records.length === 0) {
				console.log("No alive agent sessions discovered.");
				return;
			}
			console.log(
				records
					.map(
						(record) =>
							`${record.sessionId} socket=${record.socketPath} agent=${record.agentName ?? "unknown"} status=${record.status ?? "unknown"}`,
					)
					.join("\n"),
			);
		},
	});

	pi.registerCommand("session.mesh.status", {
		description: "Show local mesh connectivity summary",
		handler: async (_args, ctx) => {
			if (!ctx.agentDiscovery) {
				console.log("mesh=disabled (agentDiscovery unavailable)");
				return;
			}
			const records = ctx.agentDiscovery.listAlive();
			const withAgentName = records.filter((record) => record.agentName !== undefined).length;
			console.log(
				[
					`alive_sessions=${records.length}`,
					`named_agents=${withAgentName}`,
					`ipc_client_factory=${ctx.createIpcClient ? "available" : "unavailable"}`,
				].join(" "),
			);
		},
	});

	pi.registerCommand("agent.send", {
		description: "Send follow-up message to another alive session",
		handler: async (args, ctx) => {
			const { first: sessionId, rest: message } = splitFirstArg(args);
			if (!sessionId || !message) {
				throw new Error("Usage: /agent.send <targetSessionId> <message>");
			}
			const socketPath = resolveTargetSocket(ctx, sessionId);
			await sendIpcCommand(
				ctx,
				socketPath,
				createIpcMessage<SessionFollowUpMessage>({
					type: "session.follow_up",
					payload: {
						targetSessionId: sessionId,
						message,
						token: "local",
					},
					senderSessionId: ctx.sessionManager.getSessionId(),
				}),
			);
			console.log(`sent follow-up to ${sessionId}`);
		},
	});

	pi.registerCommand("agent.steer", {
		description: "Send steering message to another alive session",
		handler: async (args, ctx) => {
			const { first: sessionId, rest: message } = splitFirstArg(args);
			if (!sessionId || !message) {
				throw new Error("Usage: /agent.steer <targetSessionId> <message>");
			}
			const socketPath = resolveTargetSocket(ctx, sessionId);
			await sendIpcCommand(
				ctx,
				socketPath,
				createIpcMessage<SessionSteerMessage>({
					type: "session.steer",
					payload: {
						targetSessionId: sessionId,
						message,
						token: "local",
					},
					senderSessionId: ctx.sessionManager.getSessionId(),
				}),
			);
			console.log(`sent steer message to ${sessionId}`);
		},
	});

	pi.registerCommand("agent.subscribe", {
		description: "Send pub/sub subscription request to target session",
		handler: async (args, ctx) => {
			const [sessionId, topicsRaw] = splitArgs(args);
			if (!sessionId || !topicsRaw) {
				throw new Error("Usage: /agent.subscribe <targetSessionId> <topic[,topic2,...]>");
			}
			const topics = topicsRaw
				.split(",")
				.map((topic) => topic.trim())
				.filter((topic) => topic.length > 0);
			if (topics.length === 0) {
				throw new Error("At least one topic is required.");
			}

			const socketPath = resolveTargetSocket(ctx, sessionId);
			const callbackSocketPath = resolveTargetSocket(ctx, ctx.sessionManager.getSessionId());
			await sendIpcCommand(
				ctx,
				socketPath,
				createIpcMessage<PubSubSubscribeMessage>({
					type: "pubsub.subscribe",
					payload: {
						topics,
						subscriberSessionId: ctx.sessionManager.getSessionId(),
						callbackSocketPath,
					},
					senderSessionId: ctx.sessionManager.getSessionId(),
				}),
			);
			console.log(`subscription request sent to ${sessionId} for topics: ${topics.join(", ")}`);
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
