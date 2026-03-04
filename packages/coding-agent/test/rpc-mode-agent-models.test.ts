import { describe, expect, test } from "vitest";
import { parseAvailableModelLines, parseResolvedAgentModelLine } from "../src/modes/rpc/rpc-mode.js";

describe("rpc-mode multi-agent model parsing", () => {
	test("parses resolved agent model lines", () => {
		const parsed = parseResolvedAgentModelLine(
			"oracle -> anthropic/claude-opus-4-6 via agent_model_direct thinking=high",
		);
		expect(parsed).toEqual({
			agentName: "oracle",
			modelId: "anthropic/claude-opus-4-6",
			provider: "anthropic",
			resolvedVia: "agent_model_direct",
			thinkingLevel: "high",
		});
	});

	test("parses unresolved agent model lines", () => {
		const parsed = parseResolvedAgentModelLine("explore -> unresolved (Agent is disabled: explore)");
		expect(parsed).toEqual({
			agentName: "explore",
			error: "Agent is disabled: explore",
		});
	});

	test("parses available model list output", () => {
		const parsed = parseAvailableModelLines([
			"anthropic/claude-opus-4-6",
			"google/gemini-2.5-pro",
			"No models available for provider custom.",
		]);
		expect(parsed).toEqual([
			{ provider: "anthropic", modelId: "claude-opus-4-6" },
			{ provider: "google", modelId: "gemini-2.5-pro" },
		]);
	});
});
