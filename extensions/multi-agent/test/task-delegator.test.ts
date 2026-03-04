import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentDiscoveryRecord, IpcResponse, TaskDelegateMessage } from "@mariozechner/pi-ipc";
import { describe, expect, test } from "vitest";
import { registerBuiltInAgents } from "../src/agents/index.js";
import { TaskDelegator } from "../src/orchestration/TaskDelegator.js";
import { DynamicPromptBuilder } from "../src/prompts/DynamicPromptBuilder.js";
import { AgentRegistry } from "../src/registry/AgentRegistry.js";
import { CategoryRouter } from "../src/routing/CategoryRouter.js";
import type { MultiAgentConfig } from "../src/routing/types.js";

interface CreateContextOptions {
	remote?: {
		sessionId: string;
		socketPath: string;
		output?: string;
	};
}

function createContext(options: CreateContextOptions = {}): ExtensionContext {
	const remoteRecord: AgentDiscoveryRecord | undefined = options.remote
		? {
				sessionId: options.remote.sessionId,
				socketPath: options.remote.socketPath,
				agentName: "oracle",
				status: "idle",
				updatedAt: new Date().toISOString(),
			}
		: undefined;

	return {
		ui: {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: () => {},
			onTerminalInput: () => () => {},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined as never,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			setEditorComponent: () => {},
			theme: {} as ExtensionContext["ui"]["theme"],
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		},
		hasUI: false,
		cwd: process.cwd(),
		sessionManager: {
			getCwd: () => process.cwd(),
			getSessionDir: () => "",
			getSessionId: () => "ses_root",
			getSessionFile: () => undefined,
			getLeafId: () => null,
			getLeafEntry: () => undefined,
			getEntry: () => undefined,
			getLabel: () => undefined,
			getBranch: () => [],
			getHeader: () => null,
			getEntries: () => [],
			getTree: () => [],
			getSessionName: () => undefined,
		},
		modelRegistry: {
			getAll: () => [
				{
					id: "claude-opus-4-6",
					name: "claude",
					api: "anthropic-messages",
					provider: "anthropic",
					baseUrl: "https://api.anthropic.com",
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 15, output: 75, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200_000,
					maxTokens: 8192,
				},
			],
			getAvailable: () => [
				{
					id: "claude-opus-4-6",
					name: "claude",
					api: "anthropic-messages",
					provider: "anthropic",
					baseUrl: "https://api.anthropic.com",
					reasoning: true,
					input: ["text", "image"],
					cost: { input: 15, output: 75, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200_000,
					maxTokens: 8192,
				},
			],
		} as ExtensionContext["modelRegistry"],
		model: undefined,
		isIdle: () => true,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
		agentDiscovery: remoteRecord
			? (({
					socketDir: "",
					listAlive: () => [remoteRecord],
					findBySessionId: (sessionId: string) =>
						sessionId === remoteRecord.sessionId ? remoteRecord : undefined,
					getSocketPath: (sessionId: string) =>
						sessionId === remoteRecord.sessionId ? remoteRecord.socketPath : undefined,
				}) as unknown as ExtensionContext["agentDiscovery"])
			: undefined,
		createIpcClient: remoteRecord
			? ((() => {
					return {
						send: async (message: TaskDelegateMessage): Promise<IpcResponse> => {
							expect(message.type).toBe("task.delegate");
							return {
								id: message.id,
								type: "response",
								timestamp: new Date().toISOString(),
								success: true,
								data: {
									sessionId: message.payload.sessionId,
									output: options.remote?.output ?? "remote-output",
									tokenUsage: { input: 5, output: 7 },
								},
							};
						},
						disconnect: async () => {},
					};
				}) as unknown as ExtensionContext["createIpcClient"])
			: undefined,
		runSubAgent: async (options) => ({
			sessionId: options.sessionId ?? "ses_sub",
			finalText: `subagent:${options.agentName}:${options.prompt}`,
			tokenUsage: { input: 12, output: 34 },
		}),
	};
}

describe("TaskDelegator", () => {
	test("executes synchronous task delegation via runSubAgent hook", async () => {
		const ctx = createContext();
		const registry = new AgentRegistry();
		const categoryRouter = new CategoryRouter();
		registerBuiltInAgents(registry, new DynamicPromptBuilder(registry, categoryRouter));
		const config: MultiAgentConfig = {
			agents: {
				oracle: {
					model: "anthropic/claude-opus-4-6",
				},
			},
		};
		const delegator = new TaskDelegator(registry, categoryRouter, config, ctx);

		const result = await delegator.execute(
			{
				prompt: "Audit dependency graph",
				agent: "oracle",
				session_id: "ses_oracle",
			},
			ctx,
		);

		expect(result.mode).toBe("sync");
		expect(result.session_id).toBe("ses_oracle");
		expect(result.agent_used).toBe("oracle");
		expect(result.model_used).toBe("anthropic/claude-opus-4-6");
		expect(result.output).toContain("subagent:oracle");
		expect(result.metadata.token_usage).toEqual({ input: 12, output: 34 });
	});

	test("supports background delegation handles", async () => {
		const ctx = createContext();
		const registry = new AgentRegistry();
		const categoryRouter = new CategoryRouter();
		registerBuiltInAgents(registry, new DynamicPromptBuilder(registry, categoryRouter));
		const delegator = new TaskDelegator(registry, categoryRouter, {}, ctx);

		const result = await delegator.execute(
			{
				prompt: "Quick check",
				run_in_background: true,
			},
			ctx,
		);

		expect(result.mode).toBe("background");
		expect(result.task_id).toBeTruthy();
		expect(["running", "completed"]).toContain(delegator.getBackgroundTask(result.task_id as string)?.status);
	});

	test("delegates to remote discovered agent over IPC when available", async () => {
		const ctx = createContext({
			remote: {
				sessionId: "ses_remote",
				socketPath: "/tmp/ses_remote.sock",
				output: "remote-result",
			},
		});
		const registry = new AgentRegistry();
		const categoryRouter = new CategoryRouter();
		registerBuiltInAgents(registry, new DynamicPromptBuilder(registry, categoryRouter));
		const delegator = new TaskDelegator(registry, categoryRouter, {}, ctx);

		const result = await delegator.execute(
			{
				prompt: "Cross-session request",
				agent: "oracle",
			},
			ctx,
		);

		expect(result.output).toBe("remote-result");
		expect(result.metadata.resolved_via).toContain(":remote");
	});
});
