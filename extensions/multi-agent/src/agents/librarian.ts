import type { AgentConfig, AgentFactory } from "../registry/types.js";

export const librarianFactory: AgentFactory = Object.assign(
	(model: string): AgentConfig => ({
		name: "librarian",
		description: "Research and reference retrieval specialist.",
		whenToUse: "Use for documentation lookup, dependency research, and source-backed recommendations.",
		systemPrompt: [
			"You are Librarian, a documentation and research specialist.",
			"Prioritize source-backed findings and concise citations from available materials.",
			`Active model: ${model}`,
		].join("\n"),
		tools: ["read", "find", "grep", "ls"],
		defaultThinkingLevel: "medium",
	}),
	{ mode: "subagent" as const },
);
