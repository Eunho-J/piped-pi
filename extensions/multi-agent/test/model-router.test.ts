import type { Api, Model } from "@mariozechner/pi-ai";
import { describe, expect, test } from "vitest";
import { ModelRouter } from "../src/routing/ModelRouter.js";
import type { ModelRegistryView, MultiAgentConfig } from "../src/routing/types.js";

function model(input: {
	provider: string;
	id: string;
	reasoning: boolean;
	contextWindow: number;
	input: ("text" | "image")[];
	costInput: number;
	costOutput: number;
}): Model<Api> {
	return {
		id: input.id,
		name: `${input.provider}/${input.id}`,
		api: "openai-completions",
		provider: input.provider,
		baseUrl: `https://${input.provider}.example.com`,
		reasoning: input.reasoning,
		input: input.input,
		cost: {
			input: input.costInput,
			output: input.costOutput,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: input.contextWindow,
		maxTokens: 8192,
	};
}

const ALL_MODELS: Model<Api>[] = [
	model({
		provider: "anthropic",
		id: "claude-opus-4-6",
		reasoning: true,
		contextWindow: 200_000,
		input: ["text", "image"],
		costInput: 15,
		costOutput: 75,
	}),
	model({
		provider: "anthropic",
		id: "claude-haiku-4-5",
		reasoning: false,
		contextWindow: 200_000,
		input: ["text", "image"],
		costInput: 1,
		costOutput: 5,
	}),
	model({
		provider: "openai",
		id: "o3",
		reasoning: true,
		contextWindow: 200_000,
		input: ["text", "image"],
		costInput: 10,
		costOutput: 40,
	}),
	model({
		provider: "google",
		id: "gemini-2.5-pro",
		reasoning: true,
		contextWindow: 1_000_000,
		input: ["text", "image"],
		costInput: 1.25,
		costOutput: 10,
	}),
];

function registry(available: string[]): ModelRegistryView {
	const availableSet = new Set(available);
	return {
		getAll: () => ALL_MODELS,
		getAvailable: () => ALL_MODELS.filter((candidate) => availableSet.has(`${candidate.provider}/${candidate.id}`)),
	};
}

describe("ModelRouter", () => {
	test("resolves direct model and provider key override", async () => {
		const config: MultiAgentConfig = {
			agents: {
				oracle: {
					model: "anthropic/claude-opus-4-6",
					thinkingLevel: "high",
				},
			},
			providerKeys: {
				oracle: {
					anthropic: { envVar: "ANTHROPIC_API_KEY_PREMIUM" },
				},
			},
		};
		const router = ModelRouter.fromConfig(config, registry(["anthropic/claude-opus-4-6"]));

		const resolved = await router.resolveForAgent("oracle");
		expect(resolved.modelId).toBe("anthropic/claude-opus-4-6");
		expect(resolved.resolvedVia).toBe("agent_model_direct");
		expect(resolved.keyOverride?.envVar).toBe("ANTHROPIC_API_KEY_PREMIUM");
	});

	test("falls through model chain when provider unavailable", async () => {
		const config: MultiAgentConfig = {
			agents: {
				hephaestus: {
					modelChain: [
						{
							model: "openai/o3",
							condition: { type: "provider_available", provider: "openai" },
						},
						{
							model: "anthropic/claude-opus-4-6",
							condition: { type: "provider_available", provider: "anthropic" },
						},
					],
				},
			},
		};
		const router = ModelRouter.fromConfig(config, registry(["anthropic/claude-opus-4-6"]));

		const resolved = await router.resolveForAgent("hephaestus");
		expect(resolved.modelId).toBe("anthropic/claude-opus-4-6");
		expect(resolved.resolvedVia).toBe("agent_model_chain");
	});

	test("supports runtime overrides", async () => {
		const config: MultiAgentConfig = {
			agents: {
				worker: { provider: "anthropic" },
			},
		};
		const router = ModelRouter.fromConfig(config, registry(["anthropic/claude-opus-4-6", "google/gemini-2.5-pro"]));
		router.setAgentModel("worker", "google/gemini-2.5-pro", "medium");

		const resolved = await router.resolveForAgent("worker");
		expect(resolved.modelId).toBe("google/gemini-2.5-pro");
		expect(resolved.resolvedVia).toBe("runtime_model_direct");
		expect(resolved.thinkingLevel).toBe("medium");

		router.resetAgentModel("worker");
		const reset = await router.resolveForAgent("worker");
		expect(reset.resolvedVia).toBe("agent_provider_auto");
	});

	test("resolves category fallback and last resort", async () => {
		const config: MultiAgentConfig = {
			categories: {
				quick: { model: "anthropic/claude-haiku-4-5" },
			},
			lastResortModel: "google/gemini-2.5-pro",
		};
		const router = ModelRouter.fromConfig(config, registry(["google/gemini-2.5-pro"]));

		const categoryResolved = await router.resolveForCategory("quick", "sisyphus-junior");
		expect(categoryResolved?.modelId).toBe("anthropic/claude-haiku-4-5");
		expect(categoryResolved?.resolvedVia).toBe("category_override");

		const fallback = await router.resolveForAgent("missing-agent");
		expect(fallback.modelId).toBe("google/gemini-2.5-pro");
		expect(fallback.resolvedVia).toBe("last_resort");
	});
});
