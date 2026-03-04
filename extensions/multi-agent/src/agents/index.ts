import { createSisyphusFactory } from "./sisyphus.js";
import { sisyphusJuniorFactory } from "./sisyphus-junior.js";
import { oracleFactory } from "./oracle.js";
import { exploreFactory } from "./explore.js";
import type { DynamicPromptBuilder } from "../prompts/DynamicPromptBuilder.js";
import type { AgentRegistry } from "../registry/AgentRegistry.js";

export function registerBuiltInAgents(registry: AgentRegistry, promptBuilder: DynamicPromptBuilder): void {
	registry.register("sisyphus", createSisyphusFactory(promptBuilder), "multi-agent");
	registry.register("sisyphus-junior", sisyphusJuniorFactory, "multi-agent");
	registry.register("oracle", oracleFactory, "multi-agent");
	registry.register("explore", exploreFactory, "multi-agent");
}
