import type { AgentRegistry } from "../registry/AgentRegistry.js";
import type { CategoryRouter } from "../routing/CategoryRouter.js";

export class DynamicPromptBuilder {
	constructor(
		private readonly registry: AgentRegistry,
		private readonly categoryRouter: CategoryRouter,
	) {}

	buildOrchestratorPrompt(basePrompt: string): string {
		const agents = this.registry
			.list()
			.map((name) => {
				const metadata = this.registry.getMetadata(name);
				if (!metadata) {
					return undefined;
				}
				return `- ${name} [${metadata.mode}] — ${metadata.description} (when: ${metadata.whenToUse})`;
			})
			.filter((value): value is string => !!value);

		const categories = this.categoryRouter
			.list()
			.map((category) => `- ${category.name}: ${category.description} -> default ${category.defaultAgent}`);

		return [
			basePrompt,
			"",
			"## Phase workflow",
			"1) Classify intent",
			"2) Assess relevant files and risks",
			"3) Delegate focused work with task()",
			"4) Validate and summarize results",
			"",
			"## Registered agents",
			...agents,
			"",
			"## Categories",
			...categories,
		].join("\n");
	}
}
