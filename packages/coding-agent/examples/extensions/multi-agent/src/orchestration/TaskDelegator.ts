import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { AgentKeyInjector } from "../routing/AgentKeyInjector.js";
import { ModelRouter } from "../routing/ModelRouter.js";
import type { ModelRouterConfig, ResolvedModelRoute, RuntimeModelOverride } from "../routing/types.js";

type ModelRegistryView = Pick<ModelRegistry, "getAll" | "getAvailable">;

export interface ResolvedDelegationStrategy extends ResolvedModelRoute {
	provider: string;
	modelId: string;
	env: NodeJS.ProcessEnv;
	cleanup: () => void;
}

export class TaskDelegator {
	private readonly router: ModelRouter;
	private readonly keyInjector: AgentKeyInjector;
	private readonly runtimeOverrides = new Map<string, RuntimeModelOverride>();

	constructor(
		private readonly modelRegistry: ModelRegistryView,
		config: ModelRouterConfig = {},
		environment: NodeJS.ProcessEnv = process.env,
		keyInjector?: AgentKeyInjector,
	) {
		this.router = new ModelRouter(config);
		this.keyInjector = keyInjector ?? new AgentKeyInjector({ baseEnv: environment });
	}

	listModels(): Model<Api>[] {
		return this.modelRegistry.getAll();
	}

	listAvailableModels(): Model<Api>[] {
		return this.modelRegistry.getAvailable();
	}

	getRuntimeOverride(agentName: string): RuntimeModelOverride | undefined {
		const override = this.runtimeOverrides.get(agentName);
		if (!override) return undefined;
		return { ...override };
	}

	setModel(agentName: string, modelReference: string): void {
		this.runtimeOverrides.set(agentName, { model: modelReference });
	}

	setProvider(agentName: string, provider: string): void {
		this.runtimeOverrides.set(agentName, { provider });
	}

	resetModel(agentName: string): void {
		this.runtimeOverrides.delete(agentName);
	}

	getModel(agentName: string, category?: string): ResolvedModelRoute | undefined {
		return this.router.resolveForAgent(agentName, this.modelRegistry.getAll(), {
			category,
			runtimeOverride: this.runtimeOverrides.get(agentName),
		});
	}

	resolveStrategy(agentName: string, category?: string): ResolvedDelegationStrategy | undefined {
		const route = this.getModel(agentName, category);
		if (!route) return undefined;

		const availableModelSet = new Set(
			this.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`),
		);
		const isAvailableWithoutOverrides = availableModelSet.has(`${route.model.provider}/${route.model.id}`);
		const providerKeyOverride = route.providerKeyOverrides[route.model.provider];
		const hasInjectedKey =
			providerKeyOverride?.envVar !== undefined && this.keyInjector.hasEnvValue(providerKeyOverride.envVar);

		const selectedRoute =
			isAvailableWithoutOverrides || hasInjectedKey
				? route
				: this.router.resolveForAgent(agentName, this.modelRegistry.getAvailable(), {
						category,
						runtimeOverride: this.runtimeOverrides.get(agentName),
					});

		if (!selectedRoute) return undefined;
		return this.toStrategy(selectedRoute);
	}

	private toStrategy(route: ResolvedModelRoute): ResolvedDelegationStrategy {
		const injection = this.keyInjector.inject(route.providerKeyOverrides);
		return {
			...route,
			provider: route.model.provider,
			modelId: route.model.id,
			env: injection.env,
			cleanup: injection.cleanup,
		};
	}
}
