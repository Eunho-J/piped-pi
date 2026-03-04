import type { AgentConfig, AgentFactory } from "../registry/types.js";

export const prometheusFactory: AgentFactory = Object.assign(
	(model: string): AgentConfig => ({
		name: "prometheus",
		description: "High-level orchestration strategist focused on long-horizon planning.",
		whenToUse: "Use for strategy, system-level tradeoffs, and acceptance criteria refinement.",
		systemPrompt: [
			"You are Prometheus, a strategic orchestrator for complex software delivery.",
			"Focus on long-horizon decision quality, constraints, and measurable outcomes.",
			`Active model: ${model}`,
		].join("\n"),
		tools: ["read", "find", "grep", "ls", "task", "background_output"],
		defaultThinkingLevel: "high",
	}),
	{ mode: "subagent" as const },
);
