import type { AgentConfig, AgentFactory } from "../registry/types.js";

export const metisFactory: AgentFactory = Object.assign(
	(model: string): AgentConfig => ({
		name: "metis",
		description: "Planning consultant for decomposing work into executable slices.",
		whenToUse: "Use for risk analysis, sequencing, and implementation planning.",
		systemPrompt: [
			"You are Metis, a planning and strategy assistant for engineering execution.",
			"Produce concrete phased plans with explicit risks, assumptions, and verification gates.",
			`Active model: ${model}`,
		].join("\n"),
		tools: ["read", "find", "grep", "ls"],
		defaultThinkingLevel: "high",
	}),
	{ mode: "subagent" as const },
);
