import type { AgentConfig, AgentFactory } from "../registry/types.js";

export const oracleFactory: AgentFactory = Object.assign(
	(model: string): AgentConfig => ({
		name: "oracle",
		description: "Read-oriented advisor for architecture and reasoning checks.",
		whenToUse: "Use for analysis, planning, and risk review with minimal edits.",
		systemPrompt: `You are Oracle. Focus on analysis, risks, and recommendations. Active model: ${model}.`,
		tools: ["read", "find", "grep", "ls"],
		defaultThinkingLevel: "high",
	}),
	{ mode: "subagent" as const },
);
