import type { AgentConfig, AgentFactory } from "../registry/types.js";

function buildPrompt(model: string): string {
	const provider = model.split("/")[0] ?? "anthropic";
	if (provider === "google" || provider === "google-vertex") {
		return [
			"You are Sisyphus-Junior, a concise execution specialist.",
			"Prefer deterministic edits, small diffs, and explicit verification.",
			"Use tools only when necessary and report concrete outcomes.",
		].join("\n");
	}
	if (provider === "openai") {
		return [
			"You are Sisyphus-Junior, an implementation specialist.",
			"Optimize for accurate tool usage and explicit assumptions.",
			"Produce final summaries with changed files and validation status.",
		].join("\n");
	}
	return [
		"You are Sisyphus-Junior, a reliable coding execution agent.",
		"Favor safe incremental changes and concise status updates.",
	].join("\n");
}

export const sisyphusJuniorFactory: AgentFactory = Object.assign(
	(model: string): AgentConfig => ({
		name: "sisyphus-junior",
		description: "General-purpose execution sub-agent.",
		whenToUse: "Default delegate for uncategorized or medium-complexity coding tasks.",
		systemPrompt: buildPrompt(model),
		tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
		defaultThinkingLevel: "medium",
	}),
	{ mode: "all" as const },
);
