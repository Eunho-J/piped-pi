import type { Api, Model } from "@mariozechner/pi-ai";
import type {
	AgentModelConfig,
	ModelConstraints,
	ModelRouterConfig,
	ModelRouteSource,
	ProviderKeyOverrides,
	ResolvedModelRoute,
	ResolveModelOptions,
} from "./types.js";

interface ModelCandidate {
	type: "model";
	value: string;
	source: ModelRouteSource;
}

interface ProviderCandidate {
	type: "provider";
	value: string;
	source: ModelRouteSource;
}

type Candidate = ModelCandidate | ProviderCandidate;

interface ParsedModelReference {
	provider?: string;
	modelId: string;
}

function mergeConstraints(
	categoryConstraints: ModelConstraints | undefined,
	agentConstraints: ModelConstraints | undefined,
): ModelConstraints | undefined {
	if (!categoryConstraints && !agentConstraints) return undefined;
	return {
		...categoryConstraints,
		...agentConstraints,
		requiresCapabilities: agentConstraints?.requiresCapabilities ?? categoryConstraints?.requiresCapabilities,
	};
}

function mergeProviderKeyOverrides(
	globalOverrides: ProviderKeyOverrides | undefined,
	categoryOverrides: ProviderKeyOverrides | undefined,
	agentOverrides: ProviderKeyOverrides | undefined,
): ProviderKeyOverrides {
	const merged: ProviderKeyOverrides = {};
	for (const layer of [globalOverrides, categoryOverrides, agentOverrides]) {
		if (!layer) continue;
		for (const [provider, override] of Object.entries(layer)) {
			merged[provider] = { ...merged[provider], ...override };
		}
	}
	return merged;
}

function parseModelReference(reference: string): ParsedModelReference {
	const separator = reference.indexOf("/");
	if (separator === -1) {
		return { modelId: reference };
	}
	const provider = reference.slice(0, separator).trim();
	const modelId = reference.slice(separator + 1).trim();
	if (!provider || !modelId) {
		return { modelId: reference };
	}
	return { provider, modelId };
}

function matchesConstraints(model: Model<Api>, constraints: ModelConstraints | undefined): boolean {
	if (!constraints) return true;
	if (constraints.maxInputCost !== undefined && model.cost.input > constraints.maxInputCost) return false;
	if (constraints.maxOutputCost !== undefined && model.cost.output > constraints.maxOutputCost) return false;
	if (constraints.minContextWindow !== undefined && model.contextWindow < constraints.minContextWindow) return false;
	if (constraints.maxContextWindow !== undefined && model.contextWindow > constraints.maxContextWindow) return false;
	if (constraints.requiresReasoning && !model.reasoning) return false;

	if (constraints.requiresCapabilities && constraints.requiresCapabilities.length > 0) {
		for (const capability of constraints.requiresCapabilities) {
			if (!model.input.includes(capability)) return false;
		}
	}

	return true;
}

function compareModelPriority(left: Model<Api>, right: Model<Api>): number {
	const leftCost = left.cost.input + left.cost.output;
	const rightCost = right.cost.input + right.cost.output;
	if (leftCost !== rightCost) return leftCost - rightCost;
	if (left.contextWindow !== right.contextWindow) return right.contextWindow - left.contextWindow;
	return left.id.localeCompare(right.id);
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
	const seen = new Set<string>();
	const deduped: Candidate[] = [];
	for (const candidate of candidates) {
		const key = `${candidate.type}:${candidate.value}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(candidate);
	}
	return deduped;
}

export class ModelRouter {
	constructor(private readonly config: ModelRouterConfig = {}) {}

	resolveForAgent(
		agentName: string,
		models: Model<Api>[],
		options: ResolveModelOptions = {},
	): ResolvedModelRoute | undefined {
		const agentConfig = this.config.agents?.[agentName];
		const categoryName = options.category ?? agentConfig?.category;
		const categoryConfig = categoryName ? this.config.categories?.[categoryName] : undefined;

		const constraints = mergeConstraints(categoryConfig?.constraints, agentConfig?.constraints);
		const providerKeyOverrides = mergeProviderKeyOverrides(
			this.config.providerKeys,
			categoryConfig?.providerKeys,
			agentConfig?.providerKeys,
		);

		const candidates = dedupeCandidates(this.buildCandidates(options.runtimeOverride, agentConfig, categoryConfig));
		const tried: string[] = [];

		for (const candidate of candidates) {
			if (candidate.type === "model") {
				const match = this.findModelByReference(candidate.value, models, constraints);
				if (match) {
					return {
						agentName,
						category: categoryName,
						model: match,
						source: candidate.source,
						tried,
						providerKeyOverrides,
					};
				}
				tried.push(`model:${candidate.value}`);
				continue;
			}

			const providerMatch = this.findModelByProvider(candidate.value, models, constraints);
			if (providerMatch) {
				return {
					agentName,
					category: categoryName,
					model: providerMatch,
					source: candidate.source,
					tried,
					providerKeyOverrides,
				};
			}
			tried.push(`provider:${candidate.value}`);
		}

		if (this.config.lastResortModel) {
			const lastResort = this.findModelByReference(this.config.lastResortModel, models, undefined);
			if (lastResort) {
				return {
					agentName,
					category: categoryName,
					model: lastResort,
					source: "last-resort-model",
					tried,
					providerKeyOverrides,
				};
			}
			tried.push(`lastResort:${this.config.lastResortModel}`);
		}

		return undefined;
	}

	resolveForCategory(category: string, models: Model<Api>[]): ResolvedModelRoute | undefined {
		return this.resolveForAgent(category, models, { category });
	}

	private buildCandidates(
		runtimeOverride: ResolveModelOptions["runtimeOverride"],
		agentConfig: AgentModelConfig | undefined,
		categoryConfig: AgentModelConfig | undefined,
	): Candidate[] {
		const candidates: Candidate[] = [];

		if (runtimeOverride?.model) {
			candidates.push({ type: "model", value: runtimeOverride.model, source: "runtime-model" });
		}
		if (runtimeOverride?.provider) {
			candidates.push({ type: "provider", value: runtimeOverride.provider, source: "runtime-provider" });
		}

		if (agentConfig?.model) {
			candidates.push({ type: "model", value: agentConfig.model, source: "agent-model" });
		}
		for (const model of agentConfig?.modelChain ?? []) {
			candidates.push({ type: "model", value: model, source: "agent-chain" });
		}
		if (agentConfig?.provider) {
			candidates.push({ type: "provider", value: agentConfig.provider, source: "agent-provider" });
		}

		if (categoryConfig?.model) {
			candidates.push({ type: "model", value: categoryConfig.model, source: "category-model" });
		}
		for (const model of categoryConfig?.modelChain ?? []) {
			candidates.push({ type: "model", value: model, source: "category-chain" });
		}
		if (categoryConfig?.provider) {
			candidates.push({ type: "provider", value: categoryConfig.provider, source: "category-provider" });
		}

		return candidates;
	}

	private findModelByReference(
		reference: string,
		models: Model<Api>[],
		constraints: ModelConstraints | undefined,
	): Model<Api> | undefined {
		const parsed = parseModelReference(reference.trim());
		if (!parsed.modelId) return undefined;

		const byProviderAndId =
			parsed.provider !== undefined
				? models.filter((model) => model.provider === parsed.provider && model.id === parsed.modelId)
				: models.filter((model) => model.id === parsed.modelId);
		const exact = byProviderAndId
			.filter((model) => matchesConstraints(model, constraints))
			.sort(compareModelPriority);
		if (exact.length > 0) return exact[0];

		const byProviderAndPartial =
			parsed.provider !== undefined
				? models.filter((model) => model.provider === parsed.provider && model.id.includes(parsed.modelId))
				: models.filter((model) => model.id.includes(parsed.modelId));
		const partial = byProviderAndPartial
			.filter((model) => matchesConstraints(model, constraints))
			.sort(compareModelPriority);
		return partial[0];
	}

	private findModelByProvider(
		provider: string,
		models: Model<Api>[],
		constraints: ModelConstraints | undefined,
	): Model<Api> | undefined {
		const providerModels = models.filter(
			(model) => model.provider === provider && matchesConstraints(model, constraints),
		);
		const sorted = providerModels.sort(compareModelPriority);
		return sorted[0];
	}
}
