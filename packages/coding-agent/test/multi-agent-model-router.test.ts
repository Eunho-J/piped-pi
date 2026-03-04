import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, test } from "vitest";
import { TaskDelegator } from "../examples/extensions/multi-agent/src/orchestration/TaskDelegator.js";
import { AgentKeyInjector } from "../examples/extensions/multi-agent/src/routing/AgentKeyInjector.js";
import { ModelRouter } from "../examples/extensions/multi-agent/src/routing/ModelRouter.js";
import type { ModelRouterConfig } from "../examples/extensions/multi-agent/src/routing/types.js";

function createModel(params: {
	provider: string;
	id: string;
	reasoning: boolean;
	contextWindow: number;
	input: ("text" | "image")[];
	inputCost: number;
	outputCost: number;
}): Model<Api> {
	return {
		id: params.id,
		name: `${params.provider}/${params.id}`,
		api: "anthropic-messages",
		provider: params.provider,
		baseUrl: `https://${params.provider}.example.com`,
		reasoning: params.reasoning,
		input: params.input,
		cost: {
			input: params.inputCost,
			output: params.outputCost,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: params.contextWindow,
		maxTokens: 8192,
	};
}

const models: Model<Api>[] = [
	createModel({
		provider: "anthropic",
		id: "claude-sonnet-4-5",
		reasoning: true,
		contextWindow: 200_000,
		input: ["text", "image"],
		inputCost: 3,
		outputCost: 15,
	}),
	createModel({
		provider: "anthropic",
		id: "claude-haiku-4-5",
		reasoning: false,
		contextWindow: 200_000,
		input: ["text", "image"],
		inputCost: 1,
		outputCost: 5,
	}),
	createModel({
		provider: "openai",
		id: "gpt-4o",
		reasoning: false,
		contextWindow: 128_000,
		input: ["text", "image"],
		inputCost: 5,
		outputCost: 15,
	}),
	createModel({
		provider: "openai",
		id: "gpt-4.1",
		reasoning: true,
		contextWindow: 512_000,
		input: ["text", "image"],
		inputCost: 10,
		outputCost: 30,
	}),
	createModel({
		provider: "openai",
		id: "gpt-4o-mini",
		reasoning: false,
		contextWindow: 128_000,
		input: ["text"],
		inputCost: 0.3,
		outputCost: 0.6,
	}),
	createModel({
		provider: "google",
		id: "gemini-2.5-pro",
		reasoning: true,
		contextWindow: 1_000_000,
		input: ["text", "image"],
		inputCost: 1.25,
		outputCost: 10,
	}),
];

function createRegistry(
	allModels: Model<Api>[],
	availableModels: Model<Api>[],
): Pick<ModelRegistry, "getAll" | "getAvailable"> {
	return {
		getAll: () => allModels,
		getAvailable: () => availableModels,
	};
}

const tempPaths: string[] = [];

afterEach(() => {
	for (const tempPath of tempPaths.splice(0)) {
		rmSync(tempPath, { recursive: true, force: true });
	}
});

describe("ModelRouter", () => {
	test("resolves explicit agent model reference", () => {
		const config: ModelRouterConfig = {
			agents: {
				worker: { model: "openai/gpt-4o" },
			},
		};
		const router = new ModelRouter(config);
		const route = router.resolveForAgent("worker", models);
		expect(route?.model.provider).toBe("openai");
		expect(route?.model.id).toBe("gpt-4o");
		expect(route?.source).toBe("agent-model");
	});

	test("applies constraints across modelChain fallback", () => {
		const config: ModelRouterConfig = {
			agents: {
				planner: {
					modelChain: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4-5"],
					constraints: { requiresReasoning: true, requiresCapabilities: ["image"] },
				},
			},
		};
		const router = new ModelRouter(config);
		const route = router.resolveForAgent("planner", models);
		expect(route?.model.provider).toBe("anthropic");
		expect(route?.model.id).toBe("claude-sonnet-4-5");
		expect(route?.source).toBe("agent-chain");
		expect(route?.tried).toContain("model:openai/gpt-4o-mini");
	});

	test("resolves via provider and constraints", () => {
		const config: ModelRouterConfig = {
			agents: {
				architect: {
					provider: "openai",
					constraints: { minContextWindow: 400_000, requiresReasoning: true },
				},
			},
		};
		const router = new ModelRouter(config);
		const route = router.resolveForAgent("architect", models);
		expect(route?.model.provider).toBe("openai");
		expect(route?.model.id).toBe("gpt-4.1");
		expect(route?.source).toBe("agent-provider");
	});

	test("uses category fallback and provider key override merge", () => {
		const config: ModelRouterConfig = {
			providerKeys: {
				anthropic: { envVar: "GLOBAL_ANTHROPIC_KEY" },
			},
			categories: {
				planning: {
					model: "anthropic/claude-sonnet-4-5",
					providerKeys: {
						anthropic: { baseUrl: "https://category.proxy" },
					},
				},
			},
			agents: {
				worker: {
					category: "planning",
					providerKeys: {
						anthropic: { envVar: "AGENT_ANTHROPIC_KEY" },
					},
				},
			},
		};

		const router = new ModelRouter(config);
		const route = router.resolveForAgent("worker", models);
		expect(route?.source).toBe("category-model");
		expect(route?.providerKeyOverrides.anthropic.envVar).toBe("AGENT_ANTHROPIC_KEY");
		expect(route?.providerKeyOverrides.anthropic.baseUrl).toBe("https://category.proxy");
	});

	test("falls back to lastResortModel", () => {
		const config: ModelRouterConfig = {
			agents: {
				worker: { model: "openai/does-not-exist" },
			},
			lastResortModel: "anthropic/claude-haiku-4-5",
		};
		const router = new ModelRouter(config);
		const route = router.resolveForAgent("worker", models);
		expect(route?.source).toBe("last-resort-model");
		expect(route?.model.provider).toBe("anthropic");
		expect(route?.model.id).toBe("claude-haiku-4-5");
	});
});

describe("TaskDelegator", () => {
	test("supports runtime set_model / set_provider / reset_model hooks", () => {
		const registry = createRegistry(models, models);
		const delegator = new TaskDelegator(registry, {
			agents: {
				worker: { provider: "anthropic" },
			},
		});

		const initial = delegator.resolveStrategy("worker");
		expect(initial?.source).toBe("agent-provider");
		expect(initial?.provider).toBe("anthropic");
		initial?.cleanup();

		delegator.setModel("worker", "openai/gpt-4o");
		const runtimeModel = delegator.resolveStrategy("worker");
		expect(runtimeModel?.source).toBe("runtime-model");
		expect(runtimeModel?.provider).toBe("openai");
		expect(runtimeModel?.modelId).toBe("gpt-4o");
		runtimeModel?.cleanup();

		delegator.setProvider("worker", "openai");
		const runtimeProvider = delegator.resolveStrategy("worker");
		expect(runtimeProvider?.source).toBe("runtime-provider");
		expect(runtimeProvider?.provider).toBe("openai");
		runtimeProvider?.cleanup();

		delegator.resetModel("worker");
		const reset = delegator.resolveStrategy("worker");
		expect(reset?.source).toBe("agent-provider");
		expect(reset?.provider).toBe("anthropic");
		reset?.cleanup();
	});

	test("allows unavailable model when provider key override envVar is present", () => {
		const available = models.filter((model) => model.provider === "anthropic");
		const registry = createRegistry(models, available);
		const delegator = new TaskDelegator(
			registry,
			{
				agents: {
					worker: { model: "openai/gpt-4o" },
				},
				providerKeys: {
					openai: { envVar: "TEAM_OPENAI_KEY" },
				},
			},
			{
				...process.env,
				TEAM_OPENAI_KEY: "secret-openai-key",
			},
		);

		const strategy = delegator.resolveStrategy("worker");
		expect(strategy?.provider).toBe("openai");
		expect(strategy?.modelId).toBe("gpt-4o");
		expect(strategy?.env.OPENAI_API_KEY).toBe("secret-openai-key");
		strategy?.cleanup();
	});
});

describe("AgentKeyInjector", () => {
	test("creates temporary agent dir for baseUrl overrides and copies auth.json", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-router-agent-"));
		tempPaths.push(agentDir);

		writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ providers: { anthropic: { type: "apiKey" } } }));
		writeFileSync(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					openai: {
						baseUrl: "https://api.openai.com",
					},
				},
			}),
		);

		const injector = new AgentKeyInjector({ agentDir, baseEnv: process.env });
		const injected = injector.inject({
			anthropic: {
				baseUrl: "https://proxy.anthropic.internal",
			},
		});

		const tempAgentDir = injected.env.PI_CODING_AGENT_DIR;
		expect(typeof tempAgentDir).toBe("string");
		expect(tempAgentDir).not.toBe(agentDir);
		expect(tempAgentDir).toBeTruthy();

		const tempModelsPath = join(tempAgentDir as string, "models.json");
		const parsed = JSON.parse(readFileSync(tempModelsPath, "utf-8")) as {
			providers: Record<string, { baseUrl?: string }>;
		};
		expect(parsed.providers.anthropic.baseUrl).toBe("https://proxy.anthropic.internal");
		expect(parsed.providers.openai.baseUrl).toBe("https://api.openai.com");
		expect(existsSync(join(tempAgentDir as string, "auth.json"))).toBe(true);

		injected.cleanup();
		expect(existsSync(tempAgentDir as string)).toBe(false);
	});
});
