import type { AgentConfig, AgentFactory } from "../registry/types.js";

export const exploreFactory: AgentFactory = Object.assign(
	(model: string): AgentConfig => ({
		name: "explore",
		description: "Codebase exploration specialist.",
		whenToUse: "Use for broad repository scans and dependency tracing.",
		systemPrompt: `You are Explore. Map relevant code quickly and accurately. Active model: ${model}.`,
		tools: ["find", "grep", "read", "ls"],
		defaultThinkingLevel: "low",
	}),
	{ mode: "subagent" as const },
);
