import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentModelConfig, CategoryAgentMap } from "./types.js";

export interface CategoryDefinition {
	name: string;
	description: string;
	useCases: string[];
	defaultAgent: string;
	defaultModel?: string;
	thinkingLevel?: ThinkingLevel;
}

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
	{
		name: "visual-engineering",
		description: "UI and layout oriented implementation work",
		useCases: ["component styling", "layout fixes", "interactive UI"],
		defaultAgent: "sisyphus-junior",
		defaultModel: "google/gemini-2.5-pro",
		thinkingLevel: "high",
	},
	{
		name: "ultrabrains",
		description: "Complex reasoning and architecture tasks",
		useCases: ["algorithm design", "system architecture", "root cause analysis"],
		defaultAgent: "sisyphus-junior",
		defaultModel: "openai/o3",
		thinkingLevel: "xhigh",
	},
	{
		name: "deep",
		description: "Deep code analysis and refactoring",
		useCases: ["debugging", "performance tuning", "large refactors"],
		defaultAgent: "explore",
		defaultModel: "anthropic/claude-opus-4-6",
		thinkingLevel: "high",
	},
	{
		name: "quick",
		description: "Fast low-cost iteration",
		useCases: ["small fixes", "quick checks", "format updates"],
		defaultAgent: "sisyphus-junior",
		defaultModel: "anthropic/claude-haiku-4-5",
		thinkingLevel: "low",
	},
	{
		name: "research",
		description: "Investigation and documentation search",
		useCases: ["API docs", "dependency research", "external references"],
		defaultAgent: "oracle",
		defaultModel: "anthropic/claude-sonnet-4-6",
		thinkingLevel: "medium",
	},
	{
		name: "unspecified-low",
		description: "Default uncategorized tasks with low cost",
		useCases: ["general coding"],
		defaultAgent: "sisyphus-junior",
		defaultModel: "google/gemini-2.5-flash",
		thinkingLevel: "low",
	},
	{
		name: "unspecified-high",
		description: "Default uncategorized tasks with high quality",
		useCases: ["complex uncategorized work"],
		defaultAgent: "sisyphus-junior",
		defaultModel: "anthropic/claude-opus-4-6",
		thinkingLevel: "high",
	},
];

export class CategoryRouter {
	private readonly categories: Map<string, CategoryDefinition>;

	constructor(categories: CategoryDefinition[] = DEFAULT_CATEGORIES) {
		this.categories = new Map(categories.map((category) => [category.name, category]));
	}

	get(name: string): CategoryDefinition | undefined {
		return this.categories.get(name);
	}

	getDefaultAgent(name: string): string {
		return this.categories.get(name)?.defaultAgent ?? "sisyphus-junior";
	}

	list(): CategoryDefinition[] {
		return Array.from(this.categories.values());
	}

	toCategoryModelConfig(): Record<string, AgentModelConfig> {
		const result: Record<string, AgentModelConfig> = {};
		for (const category of this.categories.values()) {
			result[category.name] = {
				model: category.defaultModel,
				thinkingLevel: category.thinkingLevel,
			};
		}
		return result;
	}

	toCategoryAgentMap(): CategoryAgentMap {
		const result: CategoryAgentMap = {};
		for (const category of this.categories.values()) {
			result[category.name] = category.defaultAgent;
		}
		return result;
	}
}
