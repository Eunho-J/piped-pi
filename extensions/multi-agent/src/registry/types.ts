import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export type AgentMode = "primary" | "subagent" | "all";

export interface AgentConfig {
	name: string;
	description: string;
	whenToUse: string;
	systemPrompt: string;
	tools: string[];
	defaultThinkingLevel?: ThinkingLevel;
	metadata?: Record<string, unknown>;
}

export interface AgentFactory {
	(model: string): AgentConfig;
	mode: AgentMode;
	supportedCategories?: string[];
}

export interface RegisteredAgent {
	factory: AgentFactory;
	sourceId: string;
	registeredAt: Date;
	disabled: boolean;
}
