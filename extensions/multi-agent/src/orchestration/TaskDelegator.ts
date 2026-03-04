import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentRegistry } from "../registry/AgentRegistry.js";
import type { CategoryRouter } from "../routing/CategoryRouter.js";
import { ModelRouter } from "../routing/ModelRouter.js";
import type {
	CategoryAgentMap,
	MultiAgentConfig,
	ResolvedModel,
	RuntimeModelOverride,
	ThinkingLevel,
} from "../routing/types.js";

export interface TaskDelegateParams {
	prompt: string;
	category?: string;
	agent?: string;
	session_id?: string;
	run_in_background?: boolean;
	load_skills?: string[];
	max_prompt_tokens?: number;
}

interface ExecutionStrategy {
	type: "agent" | "category";
	agentName: string;
	category?: string;
	resolved: ResolvedModel;
}

interface BackgroundTaskHandle {
	taskId: string;
	sessionId: string;
	status: "running" | "completed" | "failed" | "cancelled";
	promise: Promise<TaskDelegateResult>;
	cancelled: boolean;
}

export interface TaskDelegateResult {
	session_id: string;
	mode: "sync" | "background";
	output?: string;
	task_id?: string;
	model_used: string;
	agent_used: string;
	metadata: {
		started_at: string;
		completed_at?: string;
		token_usage?: { input: number; output: number };
		resolved_via: string;
	};
}

export class TaskDelegator {
	private readonly modelRouter: ModelRouter;
	private readonly categoryToAgent: CategoryAgentMap;
	private readonly backgroundTasks = new Map<string, BackgroundTaskHandle>();

	constructor(
		private readonly registry: AgentRegistry,
		private readonly categoryRouter: CategoryRouter,
		config: MultiAgentConfig,
		ctx: ExtensionContext,
	) {
		const categoryConfigs = {
			...categoryRouter.toCategoryModelConfig(),
			...(config.categories ?? {}),
		};
		this.modelRouter = ModelRouter.fromConfig(
			{
				...config,
				categories: categoryConfigs,
			},
			ctx.modelRegistry,
		);
		this.categoryToAgent = categoryRouter.toCategoryAgentMap();
	}

	setModel(agentName: string, model: string, thinkingLevel?: ThinkingLevel): void {
		this.modelRouter.setAgentModel(agentName, model, thinkingLevel);
	}

	setProvider(agentName: string, provider: string, thinkingLevel?: ThinkingLevel): void {
		this.modelRouter.setAgentProvider(agentName, provider, thinkingLevel);
	}

	resetModel(agentName: string): void {
		this.modelRouter.resetAgentModel(agentName);
	}

	getRuntimeOverride(agentName: string): RuntimeModelOverride | undefined {
		return this.modelRouter.getRuntimeOverride(agentName);
	}

	async resolve(agentName: string, category?: string): Promise<ResolvedModel> {
		return this.modelRouter.resolveForAgent(agentName, category);
	}

	async execute(params: TaskDelegateParams, ctx: ExtensionContext): Promise<TaskDelegateResult> {
		const strategy = await this.resolveStrategy(params);
		if (params.run_in_background) {
			return this.executeBackground(params, strategy, ctx);
		}
		return this.executeSync(params, strategy, ctx);
	}

	getBackgroundTask(taskId: string): { status: BackgroundTaskHandle["status"]; result?: TaskDelegateResult } | undefined {
		const handle = this.backgroundTasks.get(taskId);
		if (!handle) {
			return undefined;
		}
		if (handle.status === "completed" || handle.status === "failed") {
			return {
				status: handle.status,
			};
		}
		return { status: handle.status };
	}

	cancelBackgroundTask(taskId: string): boolean {
		const handle = this.backgroundTasks.get(taskId);
		if (!handle || handle.status !== "running") {
			return false;
		}
		handle.cancelled = true;
		handle.status = "cancelled";
		return true;
	}

	private async resolveStrategy(params: TaskDelegateParams): Promise<ExecutionStrategy> {
		if (params.agent) {
			const factory = this.registry.get(params.agent);
			if (!factory) {
				throw new Error(`Unknown agent: ${params.agent}`);
			}
			if (factory.mode === "primary") {
				throw new Error(`Agent ${params.agent} cannot be called via task(); mode=${factory.mode}`);
			}
			const resolved = await this.modelRouter.resolveForAgent(params.agent, params.category);
			return {
				type: "agent",
				agentName: params.agent,
				resolved,
			};
		}

		if (params.category) {
			const agentName = this.categoryToAgent[params.category] ?? "sisyphus-junior";
			const resolved =
				(await this.modelRouter.resolveForCategory(params.category, agentName)) ??
				(await this.modelRouter.resolveForAgent(agentName, params.category));
			return {
				type: "category",
				category: params.category,
				agentName: resolved.agentName,
				resolved,
			};
		}

		const resolved = await this.modelRouter.resolveForAgent("sisyphus-junior", "unspecified-low");
		return {
			type: "category",
			category: "unspecified-low",
			agentName: "sisyphus-junior",
			resolved,
		};
	}

	private async executeSync(
		params: TaskDelegateParams,
		strategy: ExecutionStrategy,
		ctx: ExtensionContext,
	): Promise<TaskDelegateResult> {
		if (!ctx.runSubAgent) {
			throw new Error("This runtime does not support runSubAgent(). Update to a compatible pi-coding-agent build.");
		}

		const sessionId = params.session_id ?? `ses_${randomUUID()}`;
		const startedAt = new Date().toISOString();
		const agentConfig = this.registry.instantiate(strategy.agentName, strategy.resolved.modelId);
		const prompt = this.applySkillPrelude(params.prompt, params.load_skills);

		const result = await ctx.runSubAgent({
			agentName: strategy.agentName,
			sessionId,
			systemPrompt: agentConfig.systemPrompt,
			model: strategy.resolved.modelId,
			tools: agentConfig.tools,
			prompt,
			thinkingLevel: strategy.resolved.thinkingLevel ?? agentConfig.defaultThinkingLevel,
			inheritMessages: false,
			ipcForward: true,
			keyOverride: strategy.resolved.keyOverride,
		});

		return {
			session_id: sessionId,
			mode: "sync",
			output: result.finalText,
			model_used: strategy.resolved.modelId,
			agent_used: strategy.agentName,
			metadata: {
				started_at: startedAt,
				completed_at: new Date().toISOString(),
				token_usage: result.tokenUsage,
				resolved_via: strategy.resolved.resolvedVia,
			},
		};
	}

	private async executeBackground(
		params: TaskDelegateParams,
		strategy: ExecutionStrategy,
		ctx: ExtensionContext,
	): Promise<TaskDelegateResult> {
		const taskId = `task_${randomUUID()}`;
		const sessionId = params.session_id ?? `ses_${randomUUID()}`;
		const startedAt = new Date().toISOString();

		const handle: BackgroundTaskHandle = {
			taskId,
			sessionId,
			status: "running",
			cancelled: false,
			promise: this.executeSync({ ...params, session_id: sessionId, run_in_background: false }, strategy, ctx)
				.then((result) => {
					handle.status = handle.cancelled ? "cancelled" : "completed";
					return result;
				})
				.catch((error) => {
					handle.status = handle.cancelled ? "cancelled" : "failed";
					throw error;
				}),
		};

		this.backgroundTasks.set(taskId, handle);
		void handle.promise.catch(() => {
			// status already updated in chain
		});

		return {
			session_id: sessionId,
			mode: "background",
			task_id: taskId,
			model_used: strategy.resolved.modelId,
			agent_used: strategy.agentName,
			metadata: {
				started_at: startedAt,
				resolved_via: strategy.resolved.resolvedVia,
			},
		};
	}

	private applySkillPrelude(prompt: string, skills: string[] | undefined): string {
		if (!skills || skills.length === 0) {
			return prompt;
		}
		return [`Requested skills: ${skills.join(", ")}`, "", prompt].join("\n");
	}
}
