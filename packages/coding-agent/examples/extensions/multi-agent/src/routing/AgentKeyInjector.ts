import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderKeyOverrides } from "./types.js";

const DEFAULT_PROVIDER_ENV_VARS: Record<string, string[]> = {
	anthropic: ["ANTHROPIC_API_KEY"],
	openai: ["OPENAI_API_KEY"],
	google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
	gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
	openrouter: ["OPENROUTER_API_KEY"],
	xai: ["XAI_API_KEY"],
	mistral: ["MISTRAL_API_KEY"],
	deepseek: ["DEEPSEEK_API_KEY"],
	cerebras: ["CEREBRAS_API_KEY"],
	groq: ["GROQ_API_KEY"],
	together: ["TOGETHER_API_KEY"],
	perplexity: ["PERPLEXITY_API_KEY"],
	fireworks: ["FIREWORKS_API_KEY"],
};

interface ModelsProviderConfig {
	baseUrl?: string;
	apiKey?: string;
	api?: string;
	headers?: Record<string, string>;
	models?: unknown[];
	modelOverrides?: Record<string, unknown>;
}

interface ModelsConfig {
	providers: Record<string, ModelsProviderConfig>;
}

export interface AgentKeyInjectionResult {
	env: NodeJS.ProcessEnv;
	cleanup: () => void;
}

export interface AgentKeyInjectorOptions {
	baseEnv?: NodeJS.ProcessEnv;
	agentDir?: string;
}

function getDefaultAgentDir(baseEnv: NodeJS.ProcessEnv): string {
	const configured = baseEnv.PI_CODING_AGENT_DIR;
	if (configured && configured.trim().length > 0) {
		return configured;
	}
	return join(homedir(), ".pi", "agent");
}

function getProviderKeyTargets(provider: string): string[] {
	const mapped = DEFAULT_PROVIDER_ENV_VARS[provider];
	if (mapped && mapped.length > 0) return mapped;
	const normalized = provider.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
	return [`${normalized}_API_KEY`];
}

function readModelsConfig(path: string): ModelsConfig {
	if (!existsSync(path)) {
		return { providers: {} };
	}

	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (typeof raw !== "object" || raw === null) return { providers: {} };
		const providers = (raw as { providers?: unknown }).providers;
		if (typeof providers !== "object" || providers === null) return { providers: {} };
		return { providers: providers as Record<string, ModelsProviderConfig> };
	} catch {
		return { providers: {} };
	}
}

export class AgentKeyInjector {
	private readonly baseEnv: NodeJS.ProcessEnv;
	private readonly agentDir: string;

	constructor(options: AgentKeyInjectorOptions = {}) {
		this.baseEnv = { ...(options.baseEnv ?? process.env) };
		this.agentDir = options.agentDir ?? getDefaultAgentDir(this.baseEnv);
	}

	hasEnvValue(envVar: string): boolean {
		const value = this.baseEnv[envVar];
		return typeof value === "string" && value.length > 0;
	}

	inject(overrides: ProviderKeyOverrides | undefined): AgentKeyInjectionResult {
		const env: NodeJS.ProcessEnv = { ...this.baseEnv };
		if (!overrides || Object.keys(overrides).length === 0) {
			return { env, cleanup: () => {} };
		}

		const baseUrlOverrides: Record<string, string> = {};

		for (const [provider, override] of Object.entries(overrides)) {
			if (override.envVar && this.hasEnvValue(override.envVar)) {
				const value = this.baseEnv[override.envVar] as string;
				for (const targetEnvVar of getProviderKeyTargets(provider)) {
					env[targetEnvVar] = value;
				}
			}

			if (override.baseUrl) {
				baseUrlOverrides[provider] = override.baseUrl;
			}
		}

		if (Object.keys(baseUrlOverrides).length === 0) {
			return { env, cleanup: () => {} };
		}

		const tempAgentDir = mkdtempSync(join(tmpdir(), "pi-model-router-"));
		const modelsConfig = readModelsConfig(join(this.agentDir, "models.json"));
		const mergedProviders: Record<string, ModelsProviderConfig> = { ...modelsConfig.providers };

		for (const [provider, baseUrl] of Object.entries(baseUrlOverrides)) {
			mergedProviders[provider] = { ...(mergedProviders[provider] ?? {}), baseUrl };
		}

		const tempModelsPath = join(tempAgentDir, "models.json");
		writeFileSync(tempModelsPath, JSON.stringify({ providers: mergedProviders }, null, "\t"));

		for (const filename of ["auth.json", "settings.json"] as const) {
			const source = join(this.agentDir, filename);
			if (!existsSync(source)) continue;
			copyFileSync(source, join(tempAgentDir, filename));
		}

		env.PI_CODING_AGENT_DIR = tempAgentDir;

		return {
			env,
			cleanup: () => {
				rmSync(tempAgentDir, { recursive: true, force: true });
			},
		};
	}
}
