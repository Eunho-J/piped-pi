import { createSisyphusFactory } from "./sisyphus.js";
import { sisyphusJuniorFactory } from "./sisyphus-junior.js";
import { oracleFactory } from "./oracle.js";
import { exploreFactory } from "./explore.js";
import { hephaestusFactory } from "./hephaestus.js";
import { librarianFactory } from "./librarian.js";
import { metisFactory } from "./metis.js";
import { prometheusFactory } from "./prometheus.js";
import type { DynamicPromptBuilder } from "../prompts/DynamicPromptBuilder.js";
import type { AgentRegistry } from "../registry/AgentRegistry.js";

export function registerBuiltInAgents(registry: AgentRegistry, promptBuilder: DynamicPromptBuilder): void {
	registry.register("sisyphus", createSisyphusFactory(promptBuilder), "multi-agent");
	registry.register("sisyphus-junior", sisyphusJuniorFactory, "multi-agent");
	registry.register("oracle", oracleFactory, "multi-agent");
	registry.register("explore", exploreFactory, "multi-agent");
	registry.register("hephaestus", hephaestusFactory, "multi-agent");
	registry.register("librarian", librarianFactory, "multi-agent");
	registry.register("metis", metisFactory, "multi-agent");
	registry.register("prometheus", prometheusFactory, "multi-agent");
}
