import type { AgentConfig, AgentFactory } from "../registry/types.js";

export const hephaestusFactory: AgentFactory = Object.assign(
	(model: string): AgentConfig => ({
		name: "hephaestus",
		description: "Deep implementation worker for complex multi-step coding tasks.",
		whenToUse: "Use for high-effort implementation, large refactors, and debugging loops.",
		systemPrompt: [
			"You are Hephaestus, an autonomous deep-work engineering agent.",
			"Execute multi-step implementation plans with explicit validation checkpoints.",
			`Active model: ${model}`,
		].join("\n"),
		tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "task", "background_output"],
		defaultThinkingLevel: "xhigh",
	}),
	{ mode: "all" as const },
);
