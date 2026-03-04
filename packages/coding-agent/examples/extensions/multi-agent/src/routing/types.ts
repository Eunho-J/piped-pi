import type { Api, Model } from "@mariozechner/pi-ai";

export type ModelCapability = "text" | "image";

export interface ModelConstraints {
	maxInputCost?: number;
	maxOutputCost?: number;
	minContextWindow?: number;
	maxContextWindow?: number;
	requiresReasoning?: boolean;
	requiresCapabilities?: ModelCapability[];
}

export interface ProviderKeyOverride {
	/** Environment variable that contains the provider API key for this route. */
	envVar?: string;
	/** Per-provider base URL override for this route. */
	baseUrl?: string;
}

export type ProviderKeyOverrides = Record<string, ProviderKeyOverride>;

export interface AgentModelConfig {
	/** Explicit model reference (`provider/modelId` recommended). */
	model?: string;
	/** Preferred provider when no explicit model is selected. */
	provider?: string;
	/** Ordered fallback chain of model references. */
	modelChain?: string[];
	/** Constraint filters applied during model selection. */
	constraints?: ModelConstraints;
	/** Optional category key used to merge category-level defaults. */
	category?: string;
	/** Agent-specific provider key/baseUrl overrides. */
	providerKeys?: ProviderKeyOverrides;
}

export interface ModelRouterConfig {
	agents?: Record<string, AgentModelConfig>;
	categories?: Record<string, AgentModelConfig>;
	providerKeys?: ProviderKeyOverrides;
	lastResortModel?: string;
}

export interface RuntimeModelOverride {
	model?: string;
	provider?: string;
}

export type ModelRouteSource =
	| "runtime-model"
	| "runtime-provider"
	| "agent-model"
	| "agent-chain"
	| "agent-provider"
	| "category-model"
	| "category-chain"
	| "category-provider"
	| "last-resort-model";

export interface ResolveModelOptions {
	category?: string;
	runtimeOverride?: RuntimeModelOverride;
}

export interface ResolvedModelRoute {
	agentName: string;
	category?: string;
	model: Model<Api>;
	source: ModelRouteSource;
	tried: string[];
	providerKeyOverrides: ProviderKeyOverrides;
}
