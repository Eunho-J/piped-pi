import type { Model } from "@mariozechner/pi-ai";
import type { ThinkingLevel as AgentThinkingLevel } from "@mariozechner/pi-agent-core";

export type ThinkingLevel = AgentThinkingLevel;

export type ModelCapability = "image" | "reasoning" | "tool_calling";

export interface ModelConditionProviderAvailable {
	type: "provider_available";
	provider: string;
}

export interface ModelConditionModelAvailable {
	type: "model_available";
	modelId: string;
}

export interface ModelConditionApiKeySet {
	type: "api_key_set";
	envVar: string;
}

export interface ModelConditionAlways {
	type: "always";
}

export type ModelCondition =
	| ModelConditionProviderAvailable
	| ModelConditionModelAvailable
	| ModelConditionApiKeySet
	| ModelConditionAlways;

export interface ModelChainEntry {
	model: string;
	thinkingLevel?: ThinkingLevel;
	condition?: ModelCondition;
}

export interface AgentModelConfig {
	model?: string;
	provider?: string;
	modelChain?: ModelChainEntry[];
	useCategory?: boolean;
	thinkingLevel?: ThinkingLevel;
	disabled?: boolean;
	maxCostPerMToken?: number;
	minContextWindow?: number;
	requiredCapabilities?: ModelCapability[];
	requireReasoning?: boolean;
}

export interface ProviderKeyOverride {
	envVar?: string;
	apiKey?: string;
	baseUrl?: string;
}

export interface ProviderKeyOverrides {
	[agentName: string]: {
		[provider: string]: ProviderKeyOverride;
	};
}

export interface MultiAgentConfig {
	enabled?: boolean;
	agents?: Record<string, AgentModelConfig>;
	categories?: Record<string, AgentModelConfig>;
	providerKeys?: ProviderKeyOverrides;
	lastResortModel?: string;
}

export type ResolveMethod =
	| "runtime_model_direct"
	| "runtime_provider_auto"
	| "agent_model_direct"
	| "agent_provider_auto"
	| "agent_model_chain"
	| "category_override"
	| "category_chain"
	| "last_resort";

export interface ResolvedModel {
	modelId: string;
	modelInfo: Model<any>;
	thinkingLevel?: ThinkingLevel;
	agentName: string;
	resolvedVia: ResolveMethod;
	keyOverride?: { provider: string; envVar?: string; apiKey?: string; baseUrl?: string };
}

export interface RuntimeModelOverride {
	model?: string;
	provider?: string;
	thinkingLevel?: ThinkingLevel;
}

export interface ModelRouterRuntimeState {
	overrides: Map<string, RuntimeModelOverride>;
}

export interface ModelRegistryView {
	getAll(): Model<any>[];
	getAvailable(): Model<any>[];
}

export interface CategoryAgentMap {
	[category: string]: string;
}
