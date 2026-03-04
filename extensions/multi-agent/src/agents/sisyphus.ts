import { DynamicPromptBuilder } from "../prompts/DynamicPromptBuilder.js";
import type { AgentConfig, AgentFactory } from "../registry/types.js";

const basePrompt = `You are Sisyphus, the primary orchestrator.
Use task() for focused sub-work when delegation improves quality, safety, or speed.
Always keep the user informed about delegated intent and returned results.`;

export function createSisyphusFactory(promptBuilder: DynamicPromptBuilder): AgentFactory {
	return Object.assign(
		(model: string): AgentConfig => ({
			name: "sisyphus",
			description: "Primary orchestrator coordinating specialist sub-agents.",
			whenToUse: "Use for user-facing planning, decomposition, and synthesis.",
			systemPrompt: promptBuilder.buildOrchestratorPrompt(`${basePrompt}\nModel: ${model}`),
			tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "task"],
			defaultThinkingLevel: "high",
		}),
		{ mode: "primary" as const },
	);
}
