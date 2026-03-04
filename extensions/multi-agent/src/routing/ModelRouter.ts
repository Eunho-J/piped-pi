import type { Model } from "@mariozechner/pi-ai";
import type {
	AgentModelConfig,
	ModelChainEntry,
	ModelRegistryView,
	MultiAgentConfig,
	ResolvedModel,
	RuntimeModelOverride,
	ThinkingLevel,
	ProviderKeyOverrides,
	ModelRouterRuntimeState,
} from "./types.js";

const DEFAULT_LAST_RESORT_MODEL = "google/gemini-2.5-flash-lite-preview-06-17";

interface ParsedModelRef {
	provider?: string;
	modelId: string;
}

function parseModelRef(modelRef: string): ParsedModelRef {
	const separatorIndex = modelRef.indexOf("/");
	if (separatorIndex === -1) {
		return { modelId: modelRef };
	}
	return {
		provider: modelRef.slice(0, separatorIndex),
		modelId: modelRef.slice(separatorIndex + 1),
	};
}

function modelKey(model: Model<any>): string {
	return `${model.provider}/${model.id}`;
}

function modelMatchesReference(model: Model<any>, parsed: ParsedModelRef): boolean {
	if (parsed.provider && model.provider !== parsed.provider) {
		return false;
	}
	return model.id === parsed.modelId;
}

function modelSatisfiesConstraints(model: Model<any>, config: AgentModelConfig): boolean {
	if (config.maxCostPerMToken !== undefined && model.cost.input > config.maxCostPerMToken) {
		return false;
	}
	if (config.minContextWindow !== undefined && model.contextWindow < config.minContextWindow) {
		return false;
	}
	if (config.requiredCapabilities?.includes("image") && !model.input.includes("image")) {
		return false;
	}
	if (config.requireReasoning && !model.reasoning) {
		return false;
	}
	return true;
}

function modelPreference(left: Model<any>, right: Model<any>): number {
	if (left.reasoning !== right.reasoning) {
		return left.reasoning ? -1 : 1;
	}
	if (left.contextWindow !== right.contextWindow) {
		return right.contextWindow - left.contextWindow;
	}
	const leftCost = left.cost.input + left.cost.output;
	const rightCost = right.cost.input + right.cost.output;
	if (leftCost !== rightCost) {
		return leftCost - rightCost;
	}
	return left.id.localeCompare(right.id);
}

export class ModelRouter {
	private readonly agentConfigs: Map<string, AgentModelConfig>;
	private readonly categoryConfigs: Map<string, AgentModelConfig>;
	private readonly providerKeys: ProviderKeyOverrides;
	private readonly modelRegistry: ModelRegistryView;
	private readonly lastResortModel: string;
	private readonly runtimeState: ModelRouterRuntimeState;

	constructor(options: {
		agentConfigs?: Map<string, AgentModelConfig>;
		categoryConfigs?: Map<string, AgentModelConfig>;
		providerKeys?: ProviderKeyOverrides;
		modelRegistry: ModelRegistryView;
		lastResortModel?: string;
		runtimeState?: ModelRouterRuntimeState;
	}) {
		this.agentConfigs = options.agentConfigs ?? new Map();
		this.categoryConfigs = options.categoryConfigs ?? new Map();
		this.providerKeys = options.providerKeys ?? {};
		this.modelRegistry = options.modelRegistry;
		this.lastResortModel = options.lastResortModel ?? DEFAULT_LAST_RESORT_MODEL;
		this.runtimeState = options.runtimeState ?? { overrides: new Map() };
	}

	static fromConfig(config: MultiAgentConfig, modelRegistry: ModelRegistryView): ModelRouter {
		return new ModelRouter({
			agentConfigs: new Map(Object.entries(config.agents ?? {})),
			categoryConfigs: new Map(Object.entries(config.categories ?? {})),
			providerKeys: config.providerKeys,
			modelRegistry,
			lastResortModel: config.lastResortModel,
		});
	}

	setAgentModel(agentName: string, model: string, thinkingLevel?: ThinkingLevel): void {
		this.runtimeState.overrides.set(agentName, {
			model,
			thinkingLevel,
		});
	}

	setAgentProvider(agentName: string, provider: string, thinkingLevel?: ThinkingLevel): void {
		this.runtimeState.overrides.set(agentName, {
			provider,
			thinkingLevel,
		});
	}

	resetAgentModel(agentName: string): void {
		this.runtimeState.overrides.delete(agentName);
	}

	getRuntimeOverride(agentName: string): RuntimeModelOverride | undefined {
		const override = this.runtimeState.overrides.get(agentName);
		if (!override) {
			return undefined;
		}
		return { ...override };
	}

	async resolveForAgent(agentName: string, category?: string): Promise<ResolvedModel> {
		const runtimeOverride = this.runtimeState.overrides.get(agentName);
		if (runtimeOverride?.model) {
			const runtimeResolved = this.resolveModelDirect(
				runtimeOverride.model,
				agentName,
				{ thinkingLevel: runtimeOverride.thinkingLevel },
				"runtime_model_direct",
			);
			if (runtimeResolved) {
				return runtimeResolved;
			}
		}
		if (runtimeOverride?.provider) {
			const runtimeResolved = this.resolveProviderAuto(
				runtimeOverride.provider,
				agentName,
				{ thinkingLevel: runtimeOverride.thinkingLevel },
				"runtime_provider_auto",
			);
			if (runtimeResolved) {
				return runtimeResolved;
			}
		}

		const config = this.agentConfigs.get(agentName);
		if (config?.disabled) {
			throw new Error(`Agent is disabled: ${agentName}`);
		}

		if (config?.model) {
			const resolved = this.resolveModelDirect(config.model, agentName, config, "agent_model_direct");
			if (resolved) {
				return resolved;
			}
		}

		if (config?.provider) {
			const resolved = this.resolveProviderAuto(config.provider, agentName, config, "agent_provider_auto");
			if (resolved) {
				return resolved;
			}
		}

		if (config?.modelChain?.length) {
			const resolved = await this.resolveModelChain(config.modelChain, agentName, config, "agent_model_chain");
			if (resolved) {
				return resolved;
			}
		}

		if (category || config?.useCategory) {
			const categoryName = category ?? "unspecified-low";
			const categoryResolved = await this.resolveForCategory(categoryName, agentName);
			if (categoryResolved) {
				return categoryResolved;
			}
		}

		return this.resolveLastResort(agentName);
	}

	async resolveForCategory(categoryName: string, agentName: string): Promise<ResolvedModel | null> {
		const config = this.categoryConfigs.get(categoryName);
		if (!config || config.disabled) {
			return null;
		}

		if (config.model) {
			const resolved = this.resolveModelDirect(config.model, agentName, config, "category_override");
			if (resolved) {
				return resolved;
			}
		}

		if (config.provider) {
			const resolved = this.resolveProviderAuto(config.provider, agentName, config, "category_override");
			if (resolved) {
				return resolved;
			}
		}

		if (config.modelChain?.length) {
			const resolved = await this.resolveModelChain(config.modelChain, agentName, config, "category_chain");
			if (resolved) {
				return resolved;
			}
		}

		return null;
	}

	private resolveLastResort(agentName: string): ResolvedModel {
		const direct = this.resolveModelDirect(this.lastResortModel, agentName, {}, "last_resort");
		if (direct) {
			return direct;
		}

		const fallback = this.modelRegistry.getAvailable()[0] ?? this.modelRegistry.getAll()[0];
		if (!fallback) {
			throw new Error("No models available for multi-agent routing");
		}
		return {
			modelId: modelKey(fallback),
			modelInfo: fallback,
			agentName,
			resolvedVia: "last_resort",
			keyOverride: this.getKeyOverride(agentName, fallback.provider),
		};
	}

	private resolveModelDirect(
		modelRef: string,
		agentName: string,
		config: AgentModelConfig,
		resolvedVia: ResolvedModel["resolvedVia"],
	): ResolvedModel | null {
		const parsed = parseModelRef(modelRef);
		const candidates = this.modelRegistry
			.getAll()
			.filter((candidate) => modelMatchesReference(candidate, parsed))
			.filter((candidate) => modelSatisfiesConstraints(candidate, config))
			.sort(modelPreference);

		const chosen = candidates[0];
		if (!chosen) {
			return null;
		}
		return {
			modelId: modelKey(chosen),
			modelInfo: chosen,
			thinkingLevel: config.thinkingLevel,
			agentName,
			resolvedVia,
			keyOverride: this.getKeyOverride(agentName, chosen.provider),
		};
	}

	private resolveProviderAuto(
		provider: string,
		agentName: string,
		config: AgentModelConfig,
		resolvedVia: ResolvedModel["resolvedVia"],
	): ResolvedModel | null {
		const availableByProvider = this.modelRegistry
			.getAvailable()
			.filter((candidate) => candidate.provider === provider)
			.filter((candidate) => modelSatisfiesConstraints(candidate, config))
			.sort(modelPreference);

		const allByProvider = this.modelRegistry
			.getAll()
			.filter((candidate) => candidate.provider === provider)
			.filter((candidate) => modelSatisfiesConstraints(candidate, config))
			.sort(modelPreference);

		const chosen = availableByProvider[0] ?? allByProvider[0];
		if (!chosen) {
			return null;
		}

		return {
			modelId: modelKey(chosen),
			modelInfo: chosen,
			thinkingLevel: config.thinkingLevel,
			agentName,
			resolvedVia,
			keyOverride: this.getKeyOverride(agentName, provider),
		};
	}

	private async resolveModelChain(
		chain: ModelChainEntry[],
		agentName: string,
		config: AgentModelConfig,
		resolvedVia: ResolvedModel["resolvedVia"],
	): Promise<ResolvedModel | null> {
		for (const entry of chain) {
			if (!(await this.isChainEntryAvailable(entry))) {
				continue;
			}

			const resolved = this.resolveModelDirect(entry.model, agentName, config, resolvedVia);
			if (!resolved) {
				continue;
			}
			return {
				...resolved,
				thinkingLevel: entry.thinkingLevel ?? config.thinkingLevel,
			};
		}
		return null;
	}

	private async isChainEntryAvailable(entry: ModelChainEntry): Promise<boolean> {
		const condition = entry.condition;
		if (!condition || condition.type === "always") {
			return true;
		}

		if (condition.type === "provider_available") {
			return this.modelRegistry.getAvailable().some((model) => model.provider === condition.provider);
		}
		if (condition.type === "model_available") {
			const parsed = parseModelRef(condition.modelId);
			return this.modelRegistry.getAvailable().some((model) => modelMatchesReference(model, parsed));
		}
		if (condition.type === "api_key_set") {
			return typeof process.env[condition.envVar] === "string" && process.env[condition.envVar]!.length > 0;
		}

		return false;
	}

	private getKeyOverride(agentName: string, provider: string): ResolvedModel["keyOverride"] | undefined {
		const byAgent = this.providerKeys[agentName];
		if (!byAgent) {
			return undefined;
		}
		const override = byAgent[provider];
		if (!override) {
			return undefined;
		}
		return {
			provider,
			envVar: override.envVar,
			apiKey: override.apiKey,
			baseUrl: override.baseUrl,
		};
	}
}
