import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import type {
	AgentModelConfig,
	MultiAgentConfig,
	MultiAgentInitStateRecommendation,
	MultiAgentPreset,
	ThinkingLevel,
} from "./routing/types.js";

export interface ProviderAuthStatus {
	provider: string;
	totalModels: number;
	availableModels: number;
	connected: boolean;
	isOAuthProvider: boolean;
}

type MappingScope = "agents" | "categories";
type RecommendationRole = "fast_execution" | "deep_reasoning" | "research";
type MetricKey = "speed" | "cost" | "reasoning" | "context" | "multimodal";
type MetricWeights = Record<MetricKey, number>;

interface RecommendationRoleProfile {
	role: RecommendationRole;
	thinkingLevel: Record<MultiAgentPreset, ThinkingLevel>;
	weightAdjustments: MetricWeights;
	requireReasoning?: boolean;
	requireMultimodal?: boolean;
	minContextWindow?: number;
}

interface MappingRoleEntry {
	scope: MappingScope;
	name: string;
	role: RecommendationRole;
}

interface ModelMetrics {
	model: Model<Api>;
	ref: string;
	speed: number;
	cost: number;
	reasoning: number;
	context: number;
	multimodal: number;
	totalCost: number;
}

interface RankedModel {
	metrics: ModelMetrics;
	score: number;
}

interface RecommendationTarget {
	model: string;
	thinkingLevel: ThinkingLevel;
	role: RecommendationRole;
	reason: string;
	candidateModels: string[];
}

export interface MultiAgentRecommendationPlan {
	preset: MultiAgentPreset;
	connectedProviders: string[];
	agents: Record<string, RecommendationTarget>;
	categories: Record<string, RecommendationTarget>;
}

export interface RecommendationDiffEntry {
	scope: MappingScope;
	name: string;
	key: string;
	currentModel?: string;
	currentThinkingLevel?: ThinkingLevel;
	recommendedModel: string;
	recommendedThinkingLevel: ThinkingLevel;
	role: RecommendationRole;
	reason: string;
	candidateModels: string[];
}

export interface RecommendationApplication {
	scope: MappingScope;
	name: string;
	model: string;
	thinkingLevel: ThinkingLevel;
}

interface JsonDocument {
	path: string;
	exists: boolean;
	raw: string;
	root: Record<string, unknown>;
	parseError?: string;
}

interface SaveSettingsResult {
	path: string;
	backupPath?: string;
	changed: boolean;
}

export interface InitFlowResult {
	preset: MultiAgentPreset;
	applied: boolean;
	appliedChanges: number;
	path: string;
	backupPath?: string;
	newlyConnectedProviders: string[];
	diffCount: number;
}

export interface PresetApplyResult {
	preset: MultiAgentPreset;
	appliedChanges: number;
	path: string;
	backupPath?: string;
}

interface DoctorCheck {
	level: "ok" | "warn" | "error";
	message: string;
	details?: string[];
}

export interface DoctorReport {
	checks: DoctorCheck[];
	okCount: number;
	warnCount: number;
	errorCount: number;
	text: string;
}

const PRESET_WEIGHTS: Record<MultiAgentPreset, MetricWeights> = {
	balanced: {
		speed: 0.2,
		cost: 0.25,
		reasoning: 0.2,
		context: 0.2,
		multimodal: 0.15,
	},
	quality: {
		speed: 0.1,
		cost: 0.1,
		reasoning: 0.35,
		context: 0.3,
		multimodal: 0.15,
	},
	budget: {
		speed: 0.3,
		cost: 0.4,
		reasoning: 0.1,
		context: 0.1,
		multimodal: 0.1,
	},
};

const ROLE_PROFILES: Record<RecommendationRole, RecommendationRoleProfile> = {
	fast_execution: {
		role: "fast_execution",
		thinkingLevel: {
			balanced: "low",
			quality: "medium",
			budget: "minimal",
		},
		weightAdjustments: {
			speed: 0.3,
			cost: 0.2,
			reasoning: -0.1,
			context: -0.05,
			multimodal: -0.05,
		},
	},
	deep_reasoning: {
		role: "deep_reasoning",
		thinkingLevel: {
			balanced: "medium",
			quality: "high",
			budget: "low",
		},
		weightAdjustments: {
			speed: -0.1,
			cost: -0.1,
			reasoning: 0.25,
			context: 0.2,
			multimodal: 0.05,
		},
		requireReasoning: true,
		minContextWindow: 128_000,
	},
	research: {
		role: "research",
		thinkingLevel: {
			balanced: "medium",
			quality: "high",
			budget: "low",
		},
		weightAdjustments: {
			speed: -0.05,
			cost: -0.1,
			reasoning: 0.15,
			context: 0.25,
			multimodal: 0.2,
		},
		requireReasoning: true,
		requireMultimodal: true,
		minContextWindow: 128_000,
	},
};

const MAPPING_ROLES: ReadonlyArray<MappingRoleEntry> = [
	{ scope: "agents", name: "sisyphus-junior", role: "fast_execution" },
	{ scope: "agents", name: "sisyphus", role: "deep_reasoning" },
	{ scope: "agents", name: "oracle", role: "research" },
	{ scope: "agents", name: "explore", role: "deep_reasoning" },
	{ scope: "categories", name: "quick", role: "fast_execution" },
	{ scope: "categories", name: "unspecified-low", role: "fast_execution" },
	{ scope: "categories", name: "visual-engineering", role: "research" },
	{ scope: "categories", name: "research", role: "research" },
	{ scope: "categories", name: "deep", role: "deep_reasoning" },
	{ scope: "categories", name: "ultrabrains", role: "deep_reasoning" },
	{ scope: "categories", name: "unspecified-high", role: "deep_reasoning" },
];

const PRESET_DESCRIPTIONS: Record<MultiAgentPreset, string> = {
	balanced: "Balanced quality/cost for day-to-day delegation.",
	quality: "Highest reasoning/context quality for complex tasks.",
	budget: "Lowest cost and fastest iteration.",
};

const PRESET_ORDER: MultiAgentPreset[] = ["balanced", "quality", "budget"];

function resolveAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (configured) {
		if (configured === "~") {
			return homedir();
		}
		if (configured.startsWith("~/")) {
			return `${homedir()}${configured.slice(1)}`;
		}
		return configured;
	}
	return join(homedir(), ".pi", "agent");
}

export function parsePreset(input: string | undefined): MultiAgentPreset | undefined {
	if (!input) {
		return undefined;
	}
	const normalized = input.trim().toLowerCase();
	if (normalized === "balanced" || normalized === "quality" || normalized === "budget") {
		return normalized;
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMultiAgentConfig(value: unknown): MultiAgentConfig {
	if (!isRecord(value)) {
		return {};
	}
	return value as MultiAgentConfig;
}

function mergeMultiAgentConfig(base: MultiAgentConfig, override: MultiAgentConfig | undefined): MultiAgentConfig {
	if (!override) {
		return base;
	}
	return {
		...base,
		...override,
		agents: { ...(base.agents ?? {}), ...(override.agents ?? {}) },
		categories: { ...(base.categories ?? {}), ...(override.categories ?? {}) },
		providerKeys: { ...(base.providerKeys ?? {}), ...(override.providerKeys ?? {}) },
	};
}

function cloneConfig(config: MultiAgentConfig | undefined): MultiAgentConfig {
	if (!config) {
		return {};
	}
	return JSON.parse(JSON.stringify(config)) as MultiAgentConfig;
}

function normalize(value: number, minValue: number, maxValue: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	if (maxValue <= minValue) {
		return 0.5;
	}
	const normalized = (value - minValue) / (maxValue - minValue);
	return Math.max(0, Math.min(1, normalized));
}

function speedHint(model: Model<Api>): number {
	const signature = `${model.id} ${model.name}`.toLowerCase();
	let score = 0;
	for (const token of ["flash", "haiku", "mini", "small", "lite", "nano", "instant", "fast"]) {
		if (signature.includes(token)) {
			score += 1;
		}
	}
	for (const token of ["opus", "pro", "max", "ultra", "reasoning"]) {
		if (signature.includes(token)) {
			score -= 0.5;
		}
	}
	return score;
}

function buildModelMetrics(models: Model<Api>[]): ModelMetrics[] {
	const totalCosts = models.map((model) => Math.max(model.cost.input + model.cost.output, 0.0001));
	const contextLogs = models.map((model) => Math.log10(Math.max(model.contextWindow, 1)));
	const speedRaw = models.map((model) => (1 / Math.max(model.cost.input + model.cost.output, 0.0001)) * 0.7 + speedHint(model) * 0.3);

	const minCost = Math.min(...totalCosts);
	const maxCost = Math.max(...totalCosts);
	const minContext = Math.min(...contextLogs);
	const maxContext = Math.max(...contextLogs);
	const minSpeed = Math.min(...speedRaw);
	const maxSpeed = Math.max(...speedRaw);

	return models.map((model, index) => {
		const totalCost = totalCosts[index];
		return {
			model,
			ref: `${model.provider}/${model.id}`,
			totalCost,
			speed: normalize(speedRaw[index], minSpeed, maxSpeed),
			cost: 1 - normalize(totalCost, minCost, maxCost),
			reasoning: model.reasoning ? 1 : 0,
			context: normalize(contextLogs[index], minContext, maxContext),
			multimodal: model.input.includes("image") ? 1 : 0,
		};
	});
}

function combineWeights(base: MetricWeights, adjustment: MetricWeights): MetricWeights {
	const combined: MetricWeights = {
		speed: Math.max(0, base.speed + adjustment.speed),
		cost: Math.max(0, base.cost + adjustment.cost),
		reasoning: Math.max(0, base.reasoning + adjustment.reasoning),
		context: Math.max(0, base.context + adjustment.context),
		multimodal: Math.max(0, base.multimodal + adjustment.multimodal),
	};
	const sum = combined.speed + combined.cost + combined.reasoning + combined.context + combined.multimodal;
	if (sum <= 0) {
		return { ...base };
	}
	return {
		speed: combined.speed / sum,
		cost: combined.cost / sum,
		reasoning: combined.reasoning / sum,
		context: combined.context / sum,
		multimodal: combined.multimodal / sum,
	};
}

function describeRecommendation(metrics: ModelMetrics): string {
	const features: string[] = [];
	if (metrics.reasoning > 0.9) {
		features.push("strong reasoning");
	}
	if (metrics.context > 0.75) {
		features.push("large context");
	}
	if (metrics.multimodal > 0.9) {
		features.push("multimodal");
	}
	if (metrics.cost > 0.75) {
		features.push("low cost");
	}
	if (metrics.speed > 0.75) {
		features.push("fast");
	}
	if (features.length === 0) {
		features.push("balanced profile");
	}
	return features.slice(0, 3).join(", ");
}

function rankModelsForRole(
	metrics: ModelMetrics[],
	preset: MultiAgentPreset,
	role: RecommendationRole,
): { ranked: RankedModel[]; thinkingLevel: ThinkingLevel } {
	const profile = ROLE_PROFILES[role];
	const combinedWeights = combineWeights(PRESET_WEIGHTS[preset], profile.weightAdjustments);

	let candidates = metrics.filter((candidate) => {
		if (profile.requireReasoning && !candidate.model.reasoning) {
			return false;
		}
		if (profile.requireMultimodal && !candidate.model.input.includes("image")) {
			return false;
		}
		if (profile.minContextWindow !== undefined && candidate.model.contextWindow < profile.minContextWindow) {
			return false;
		}
		return true;
	});

	if (candidates.length === 0) {
		candidates = metrics;
	}

	const ranked = candidates
		.map((candidate) => {
			const score =
				candidate.speed * combinedWeights.speed +
				candidate.cost * combinedWeights.cost +
				candidate.reasoning * combinedWeights.reasoning +
				candidate.context * combinedWeights.context +
				candidate.multimodal * combinedWeights.multimodal;
			return { metrics: candidate, score };
		})
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			if (right.metrics.context !== left.metrics.context) {
				return right.metrics.context - left.metrics.context;
			}
			if (right.metrics.reasoning !== left.metrics.reasoning) {
				return right.metrics.reasoning - left.metrics.reasoning;
			}
			if (right.metrics.cost !== left.metrics.cost) {
				return right.metrics.cost - left.metrics.cost;
			}
			return left.metrics.ref.localeCompare(right.metrics.ref);
		});

	return {
		ranked,
		thinkingLevel: profile.thinkingLevel[preset],
	};
}

export function buildRecommendationPlan(models: Model<Api>[], preset: MultiAgentPreset): MultiAgentRecommendationPlan {
	const metrics = buildModelMetrics(models);
	if (metrics.length === 0) {
		throw new Error("No connected models available. Configure provider credentials and retry /multi-agent init.");
	}

	const agents: Record<string, RecommendationTarget> = {};
	const categories: Record<string, RecommendationTarget> = {};
	for (const entry of MAPPING_ROLES) {
		const ranked = rankModelsForRole(metrics, preset, entry.role);
		const best = ranked.ranked[0];
		if (!best) {
			continue;
		}
		const recommendation: RecommendationTarget = {
			model: best.metrics.ref,
			thinkingLevel: ranked.thinkingLevel,
			role: entry.role,
			reason: describeRecommendation(best.metrics),
			candidateModels: ranked.ranked.slice(0, 8).map((candidate) => candidate.metrics.ref),
		};
		if (entry.scope === "agents") {
			agents[entry.name] = recommendation;
		} else {
			categories[entry.name] = recommendation;
		}
	}

	return {
		preset,
		connectedProviders: Array.from(new Set(models.map((model) => model.provider))).sort(),
		agents,
		categories,
	};
}

function getCurrentModelRef(config: AgentModelConfig | undefined): string | undefined {
	if (!config) {
		return undefined;
	}
	if (config.model) {
		return config.model;
	}
	if (config.provider) {
		return `${config.provider}/*`;
	}
	if (config.modelChain && config.modelChain.length > 0) {
		return `${config.modelChain[0]?.model ?? "unknown"} (chain)`;
	}
	return undefined;
}

function getRecommendationEntries(plan: MultiAgentRecommendationPlan): ReadonlyArray<[MappingScope, string, RecommendationTarget]> {
	const entries: Array<[MappingScope, string, RecommendationTarget]> = [];
	for (const [name, target] of Object.entries(plan.agents)) {
		entries.push(["agents", name, target]);
	}
	for (const [name, target] of Object.entries(plan.categories)) {
		entries.push(["categories", name, target]);
	}
	return entries;
}

export function buildRecommendationDiff(
	currentConfig: MultiAgentConfig | undefined,
	plan: MultiAgentRecommendationPlan,
): RecommendationDiffEntry[] {
	const config = currentConfig ?? {};
	const diff: RecommendationDiffEntry[] = [];
	for (const [scope, name, recommendation] of getRecommendationEntries(plan)) {
		const current = scope === "agents" ? config.agents?.[name] : config.categories?.[name];
		const currentModel = getCurrentModelRef(current);
		const currentThinkingLevel = current?.thinkingLevel;
		if (currentModel === recommendation.model && currentThinkingLevel === recommendation.thinkingLevel) {
			continue;
		}
		diff.push({
			scope,
			name,
			key: `${scope}:${name}`,
			currentModel,
			currentThinkingLevel,
			recommendedModel: recommendation.model,
			recommendedThinkingLevel: recommendation.thinkingLevel,
			role: recommendation.role,
			reason: recommendation.reason,
			candidateModels: recommendation.candidateModels,
		});
	}
	return diff.sort((left, right) => {
		if (left.scope !== right.scope) {
			return left.scope.localeCompare(right.scope);
		}
		return left.name.localeCompare(right.name);
	});
}

function toInitStateRecommendations(
	recommendations: Record<string, RecommendationTarget>,
): Record<string, MultiAgentInitStateRecommendation> {
	return Object.fromEntries(
		Object.entries(recommendations).map(([name, recommendation]) => [
			name,
			{
				model: recommendation.model,
				thinkingLevel: recommendation.thinkingLevel,
			},
		]),
	);
}

export function applyRecommendations(
	baseConfig: MultiAgentConfig | undefined,
	plan: MultiAgentRecommendationPlan,
	applications: RecommendationApplication[],
): MultiAgentConfig {
	const next = cloneConfig(baseConfig);
	next.enabled = true;
	next.agents = { ...(next.agents ?? {}) };
	next.categories = { ...(next.categories ?? {}) };

	for (const application of applications) {
		if (application.scope === "agents") {
			next.agents[application.name] = {
				...(next.agents[application.name] ?? {}),
				model: application.model,
				thinkingLevel: application.thinkingLevel,
			};
		} else {
			next.categories[application.name] = {
				...(next.categories[application.name] ?? {}),
				model: application.model,
				thinkingLevel: application.thinkingLevel,
			};
		}
	}

	next.initState = {
		version: 1,
		preset: plan.preset,
		connectedProviders: plan.connectedProviders,
		recommendedAt: new Date().toISOString(),
		agents: toInitStateRecommendations(plan.agents),
		categories: toInitStateRecommendations(plan.categories),
	};

	return next;
}

function getProjectSettingsPath(cwd: string): string {
	return join(cwd, ".pi", "settings.json");
}

function getGlobalSettingsPath(): string {
	return join(resolveAgentDir(), "settings.json");
}

function readJsonDocument(path: string): JsonDocument {
	if (!existsSync(path)) {
		return {
			path,
			exists: false,
			raw: "",
			root: {},
		};
	}

	const raw = readFileSync(path, "utf8");
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed)) {
			return {
				path,
				exists: true,
				raw,
				root: {},
				parseError: "Root JSON value must be an object.",
			};
		}
		return {
			path,
			exists: true,
			raw,
			root: parsed,
		};
	} catch (error) {
		return {
			path,
			exists: true,
			raw,
			root: {},
			parseError: error instanceof Error ? error.message : String(error),
		};
	}
}

function writeJsonDocument(doc: JsonDocument, nextRoot: Record<string, unknown>): SaveSettingsResult {
	const nextRaw = `${JSON.stringify(nextRoot, null, 2)}\n`;
	if (doc.exists && doc.raw === nextRaw) {
		return { path: doc.path, changed: false };
	}

	mkdirSync(dirname(doc.path), { recursive: true });

	let backupPath: string | undefined;
	if (doc.exists) {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		backupPath = `${doc.path}.multi-agent-backup-${stamp}`;
		writeFileSync(backupPath, doc.raw, "utf8");
	}

	writeFileSync(doc.path, nextRaw, "utf8");
	return {
		path: doc.path,
		backupPath,
		changed: true,
	};
}

export function discoverProviderAuthStatus(models: Model<Api>[], availableModels: Model<Api>[], ctx: ExtensionCommandContext): ProviderAuthStatus[] {
	const totalByProvider = new Map<string, number>();
	for (const model of models) {
		totalByProvider.set(model.provider, (totalByProvider.get(model.provider) ?? 0) + 1);
	}
	const availableByProvider = new Map<string, number>();
	for (const model of availableModels) {
		availableByProvider.set(model.provider, (availableByProvider.get(model.provider) ?? 0) + 1);
	}
	const oauthProviders = new Set(ctx.modelRegistry.authStorage.getOAuthProviders().map((provider) => provider.id));

	return Array.from(totalByProvider.entries())
		.map(([provider, totalModels]) => {
			const available = availableByProvider.get(provider) ?? 0;
			return {
				provider,
				totalModels,
				availableModels: available,
				connected: available > 0,
				isOAuthProvider: oauthProviders.has(provider),
			};
		})
		.sort((left, right) => left.provider.localeCompare(right.provider));
}

function findModelReference(input: string, models: Model<Api>[]): string | undefined {
	const normalized = input.trim();
	if (!normalized) {
		return undefined;
	}
	if (normalized.includes("/")) {
		const [provider, ...rest] = normalized.split("/");
		const modelId = rest.join("/");
		const found = models.find((model) => model.provider === provider && model.id === modelId);
		return found ? `${found.provider}/${found.id}` : undefined;
	}
	const found = models.find((model) => model.id === normalized);
	return found ? `${found.provider}/${found.id}` : undefined;
}

function formatProviderStatus(statuses: ProviderAuthStatus[]): string[] {
	return statuses.map((status) => {
		if (status.connected) {
			return `- ${status.provider}: connected (${status.availableModels}/${status.totalModels} models available)`;
		}
		if (status.isOAuthProvider) {
			return `- ${status.provider}: disconnected (${status.totalModels} models, OAuth provider)`;
		}
		return `- ${status.provider}: disconnected (${status.totalModels} models, API key needed)`;
	});
}

async function maybeOnboardProviders(ctx: ExtensionCommandContext, statuses: ProviderAuthStatus[]): Promise<ProviderAuthStatus[]> {
	if (!ctx.hasUI) {
		return statuses;
	}
	const disconnected = statuses.filter((status) => !status.connected);
	if (disconnected.length === 0) {
		return statuses;
	}

	const shouldOnboard = await ctx.ui.confirm(
		"Connect providers?",
		`${disconnected.length} provider(s) are disconnected. Do you want to onboard credentials now?`,
	);
	if (!shouldOnboard) {
		return statuses;
	}

	let snapshot = statuses;
	while (true) {
		const pending = snapshot.filter((status) => !status.connected);
		if (pending.length === 0) {
			break;
		}
		const doneOption = "Continue with current connections";
		const options = [
			...pending.map((status) => {
				if (status.isOAuthProvider) {
					return `${status.provider} (OAuth via /login)`;
				}
				return `${status.provider} (enter API key)`;
			}),
			doneOption,
		];
		const choice = await ctx.ui.select("Provider onboarding", options);
		if (!choice || choice === doneOption) {
			break;
		}
		const provider = choice.split(" ")[0];
		const target = pending.find((status) => status.provider === provider);
		if (!target) {
			continue;
		}
		if (target.isOAuthProvider) {
			ctx.ui.notify(`Provider ${provider} uses OAuth. Run /login and then rerun /multi-agent init.`, "warning");
			continue;
		}
		const key = await ctx.ui.input(`API key for ${provider}`, "Paste API key");
		if (!key || key.trim().length === 0) {
			ctx.ui.notify(`Skipped ${provider}: empty API key`, "warning");
			continue;
		}
		ctx.modelRegistry.authStorage.set(provider, {
			type: "api_key",
			key: key.trim(),
		});
		ctx.modelRegistry.refresh();
		snapshot = discoverProviderAuthStatus(ctx.modelRegistry.getAll(), ctx.modelRegistry.getAvailable(), ctx);
	}

	return snapshot;
}

function parseSettingsConfig(doc: JsonDocument): MultiAgentConfig | undefined {
	return asMultiAgentConfig(doc.root.multiAgent);
}

async function selectPreset(
	ctx: ExtensionCommandContext,
	requestedPreset: MultiAgentPreset | undefined,
	currentConfig: MultiAgentConfig | undefined,
): Promise<MultiAgentPreset> {
	if (requestedPreset) {
		return requestedPreset;
	}
	const fallbackPreset = currentConfig?.initState?.preset && parsePreset(currentConfig.initState.preset)
		? currentConfig.initState.preset
		: "balanced";
	if (!ctx.hasUI) {
		return fallbackPreset;
	}
	const options = PRESET_ORDER.map((preset) => `${preset}: ${PRESET_DESCRIPTIONS[preset]}`);
	const selection = await ctx.ui.select("Select preset", options);
	if (!selection) {
		return fallbackPreset;
	}
	const preset = parsePreset(selection.split(":")[0]);
	return preset ?? fallbackPreset;
}

function selectTargetConfigPath(cwd: string): string {
	return getProjectSettingsPath(cwd);
}

function summarizeDiff(diff: RecommendationDiffEntry[]): string[] {
	return diff.slice(0, 12).map((entry) => {
		const current = entry.currentModel ? `${entry.currentModel}` : "(not set)";
		const next = `${entry.recommendedModel}`;
		return `- ${entry.scope}.${entry.name}: ${current} -> ${next} (${entry.reason})`;
	});
}

async function choosePartialApplications(
	ctx: ExtensionCommandContext,
	diff: RecommendationDiffEntry[],
	availableModels: Model<Api>[],
): Promise<RecommendationApplication[]> {
	const applications: RecommendationApplication[] = [];
	for (const entry of diff) {
		const recommendedOption = `Use recommended (${entry.recommendedModel})`;
		const keepOption = entry.currentModel ? `Keep current (${entry.currentModel})` : "Skip this change";
		const customOption = "Choose another connected model";
		const selection = await ctx.ui.select(`Configure ${entry.scope}.${entry.name}`, [
			recommendedOption,
			keepOption,
			customOption,
		]);
		if (!selection || selection === keepOption) {
			continue;
		}
		if (selection === recommendedOption) {
			applications.push({
				scope: entry.scope,
				name: entry.name,
				model: entry.recommendedModel,
				thinkingLevel: entry.recommendedThinkingLevel,
			});
			continue;
		}

		const manualOption = "Enter provider/model manually";
		const modelSelection = await ctx.ui.select(`Pick model for ${entry.scope}.${entry.name}`, [
			...entry.candidateModels.slice(0, 8),
			manualOption,
			keepOption,
		]);
		if (!modelSelection || modelSelection === keepOption) {
			continue;
		}

		if (modelSelection === manualOption) {
			const manual = await ctx.ui.input(`Model for ${entry.scope}.${entry.name}`, "provider/model");
			if (!manual) {
				continue;
			}
			const resolved = findModelReference(manual, availableModels);
			if (!resolved) {
				ctx.ui.notify(`Model not found: ${manual}`, "error");
				continue;
			}
			applications.push({
				scope: entry.scope,
				name: entry.name,
				model: resolved,
				thinkingLevel: entry.recommendedThinkingLevel,
			});
			continue;
		}

		applications.push({
			scope: entry.scope,
			name: entry.name,
			model: modelSelection,
			thinkingLevel: entry.recommendedThinkingLevel,
		});
	}
	return applications;
}

function parseArgs(args: string): string[] {
	return args
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
}

function buildDoctorLine(check: DoctorCheck): string {
	const prefix = check.level === "ok" ? "[ok]" : check.level === "warn" ? "[warn]" : "[error]";
	const details = check.details?.map((detail) => `    - ${detail}`).join("\n");
	if (!details) {
		return `${prefix} ${check.message}`;
	}
	return `${prefix} ${check.message}\n${details}`;
}

function parseModelRef(modelRef: string): { provider?: string; modelId: string } {
	const splitIndex = modelRef.indexOf("/");
	if (splitIndex < 0) {
		return { modelId: modelRef };
	}
	return {
		provider: modelRef.slice(0, splitIndex),
		modelId: modelRef.slice(splitIndex + 1),
	};
}

function modelExists(modelRef: string, models: Model<Api>[]): boolean {
	const parsed = parseModelRef(modelRef);
	return models.some((candidate) => {
		if (parsed.provider && candidate.provider !== parsed.provider) {
			return false;
		}
		return candidate.id === parsed.modelId;
	});
}

function buildConfigWarnings(config: MultiAgentConfig, models: Model<Api>[], availableModels: Model<Api>[]): DoctorCheck[] {
	const checks: DoctorCheck[] = [];
	const warnings: string[] = [];

	const inspectConfig = (scope: MappingScope, values: Record<string, AgentModelConfig> | undefined): void => {
		if (!values) {
			return;
		}
		for (const [name, entry] of Object.entries(values)) {
			if (entry.model && !modelExists(entry.model, models)) {
				warnings.push(`${scope}.${name}: model not found (${entry.model})`);
			}
			if (entry.provider && !models.some((model) => model.provider === entry.provider)) {
				warnings.push(`${scope}.${name}: provider not found (${entry.provider})`);
			}
			if (entry.provider && !availableModels.some((model) => model.provider === entry.provider)) {
				warnings.push(`${scope}.${name}: provider has no connected credentials (${entry.provider})`);
			}
			for (const chainEntry of entry.modelChain ?? []) {
				if (!modelExists(chainEntry.model, models)) {
					warnings.push(`${scope}.${name}: modelChain entry not found (${chainEntry.model})`);
				}
			}
		}
	};

	inspectConfig("agents", config.agents);
	inspectConfig("categories", config.categories);

	for (const [agent, providers] of Object.entries(config.providerKeys ?? {})) {
		for (const [provider, override] of Object.entries(providers)) {
			if (!override.apiKey && override.envVar && !process.env[override.envVar]) {
				warnings.push(`providerKeys.${agent}.${provider}: env var ${override.envVar} is not set`);
			}
		}
	}

	const enabledAgents = Object.values(config.agents ?? {}).filter((entry) => !entry.disabled);
	if (enabledAgents.length === 0) {
		warnings.push("No enabled agents configured in multiAgent.agents");
	}

	if (warnings.length > 0) {
		checks.push({
			level: "warn",
			message: "Potential multi-agent config issues detected",
			details: warnings,
		});
	} else {
		checks.push({
			level: "ok",
			message: "Config model/provider references look valid",
		});
	}

	return checks;
}

export async function runMultiAgentInitFlow(args: string, ctx: ExtensionCommandContext): Promise<InitFlowResult> {
	ctx.modelRegistry.refresh();
	const tokens = parseArgs(args);
	const presetToken = tokens[0];
	const requestedPreset = parsePreset(presetToken);
	if (presetToken && !requestedPreset) {
		throw new Error("Usage: /multi-agent init [balanced|quality|budget]");
	}

	const allModels = ctx.modelRegistry.getAll();
	let availableModels = ctx.modelRegistry.getAvailable();
	let providerStatus = discoverProviderAuthStatus(allModels, availableModels, ctx);
	providerStatus = await maybeOnboardProviders(ctx, providerStatus);
	availableModels = ctx.modelRegistry.getAvailable();
	if (availableModels.length === 0) {
		const guidance = providerStatus.length > 0 ? formatProviderStatus(providerStatus).join("\n") : "No providers detected.";
		throw new Error(`No connected models found.\n${guidance}`);
	}

	const settingsPath = selectTargetConfigPath(ctx.cwd);
	const doc = readJsonDocument(settingsPath);
	if (doc.parseError) {
		if (!ctx.hasUI) {
			throw new Error(`Failed to parse ${settingsPath}: ${doc.parseError}`);
		}
		const shouldReset = await ctx.ui.confirm(
			"Invalid settings.json",
			`Failed to parse ${settingsPath}. Reset this file and continue multi-agent init?`,
		);
		if (!shouldReset) {
			throw new Error(`Cannot continue: ${settingsPath} is invalid JSON (${doc.parseError})`);
		}
		doc.root = {};
		doc.raw = "{}";
		doc.parseError = undefined;
	}

	const currentConfig = parseSettingsConfig(doc);
	const preset = await selectPreset(ctx, requestedPreset, currentConfig);
	const plan = buildRecommendationPlan(availableModels, preset);
	const diff = buildRecommendationDiff(currentConfig, plan);

	const previousProviders = currentConfig?.initState?.connectedProviders;
	const newlyConnectedProviders = previousProviders
		? plan.connectedProviders.filter((provider) => !previousProviders.includes(provider))
		: [];

	const summaryLines = [
		`Preset: ${preset} (${PRESET_DESCRIPTIONS[preset]})`,
		`Connected providers: ${plan.connectedProviders.join(", ") || "(none)"}`,
	];
	if (newlyConnectedProviders.length > 0) {
		summaryLines.push(`Newly connected providers since last init: ${newlyConnectedProviders.join(", ")}`);
	}
	if (diff.length > 0) {
		summaryLines.push("Recommendation diff:");
		summaryLines.push(...summarizeDiff(diff));
	} else {
		summaryLines.push("Current mapping already matches recommendations.");
	}

	console.log(summaryLines.join("\n"));

	if (diff.length === 0 && newlyConnectedProviders.length === 0) {
		return {
			preset,
			applied: false,
			appliedChanges: 0,
			path: settingsPath,
			diffCount: 0,
			newlyConnectedProviders,
		};
	}

	let applications: RecommendationApplication[] = diff.map((entry) => ({
		scope: entry.scope,
		name: entry.name,
		model: entry.recommendedModel,
		thinkingLevel: entry.recommendedThinkingLevel,
	}));

	if (ctx.hasUI && diff.length > 0) {
		const fullOption = `Apply all ${diff.length} recommended changes`;
		const partialOption = "Review changes one by one";
		const cancelOption = "Cancel";
		const selection = await ctx.ui.select("Apply recommendation diff?", [fullOption, partialOption, cancelOption]);
		if (!selection || selection === cancelOption) {
			return {
				preset,
				applied: false,
				appliedChanges: 0,
				path: settingsPath,
				diffCount: diff.length,
				newlyConnectedProviders,
			};
		}
		if (selection === partialOption) {
			applications = await choosePartialApplications(ctx, diff, availableModels);
		}
	}

	const shouldWriteProvidersOnly = applications.length === 0 && newlyConnectedProviders.length > 0;
	if (applications.length === 0 && !shouldWriteProvidersOnly) {
		return {
			preset,
			applied: false,
			appliedChanges: 0,
			path: settingsPath,
			diffCount: diff.length,
			newlyConnectedProviders,
		};
	}

	const nextConfig = applyRecommendations(currentConfig, plan, applications);
	const mergedRoot = { ...doc.root, multiAgent: nextConfig };
	const saveResult = writeJsonDocument(doc, mergedRoot);
	if (ctx.hasUI) {
		ctx.ui.notify(`Multi-agent init applied (${applications.length} change(s))`, "info");
	}

	return {
		preset,
		applied: true,
		appliedChanges: applications.length,
		path: saveResult.path,
		backupPath: saveResult.backupPath,
		newlyConnectedProviders,
		diffCount: diff.length,
	};
}

export async function runMultiAgentPresetFlow(args: string, ctx: ExtensionCommandContext): Promise<PresetApplyResult> {
	ctx.modelRegistry.refresh();
	const availableModels = ctx.modelRegistry.getAvailable();
	if (availableModels.length === 0) {
		throw new Error("No connected models found. Run /multi-agent init to onboard providers first.");
	}

	const requested = parsePreset(parseArgs(args)[0]);
	let preset = requested;
	if (!preset && ctx.hasUI) {
		const choice = await ctx.ui.select(
			"Select preset",
			PRESET_ORDER.map((candidate) => `${candidate}: ${PRESET_DESCRIPTIONS[candidate]}`),
		);
		if (!choice) {
			throw new Error("Preset selection cancelled.");
		}
		preset = parsePreset(choice.split(":")[0]);
	}
	if (!preset) {
		throw new Error("Usage: /multi-agent preset <balanced|quality|budget>");
	}

	const settingsPath = selectTargetConfigPath(ctx.cwd);
	const doc = readJsonDocument(settingsPath);
	if (doc.parseError) {
		throw new Error(`Failed to parse ${settingsPath}: ${doc.parseError}`);
	}
	const currentConfig = parseSettingsConfig(doc);
	const plan = buildRecommendationPlan(availableModels, preset);
	const diff = buildRecommendationDiff(currentConfig, plan);
	const applications: RecommendationApplication[] = diff.map((entry) => ({
		scope: entry.scope,
		name: entry.name,
		model: entry.recommendedModel,
		thinkingLevel: entry.recommendedThinkingLevel,
	}));

	const nextConfig = applyRecommendations(currentConfig, plan, applications);
	const mergedRoot = { ...doc.root, multiAgent: nextConfig };
	const saveResult = writeJsonDocument(doc, mergedRoot);

	const line = diff.length > 0 ? `Applied preset ${preset}: ${diff.length} mapping change(s)` : `Preset ${preset} already active`;
	console.log(line);
	if (ctx.hasUI) {
		ctx.ui.notify(line, "info");
	}

	return {
		preset,
		appliedChanges: diff.length,
		path: saveResult.path,
		backupPath: saveResult.backupPath,
	};
}

export function runMultiAgentDoctor(ctx: ExtensionCommandContext): DoctorReport {
	ctx.modelRegistry.refresh();

	const checks: DoctorCheck[] = [];
	const projectDoc = readJsonDocument(getProjectSettingsPath(ctx.cwd));
	const globalDoc = readJsonDocument(getGlobalSettingsPath());
	const allModels = ctx.modelRegistry.getAll();
	const availableModels = ctx.modelRegistry.getAvailable();
	const providerStatus = discoverProviderAuthStatus(allModels, availableModels, ctx);

	if (ctx.runSubAgent) {
		checks.push({ level: "ok", message: "Runtime supports runSubAgent()" });
	} else {
		checks.push({
			level: "error",
			message: "Runtime does not expose runSubAgent(); task() delegation will fail",
		});
	}

	if (globalDoc.parseError) {
		checks.push({
			level: "error",
			message: `Failed to parse global settings (${globalDoc.path})`,
			details: [globalDoc.parseError],
		});
	} else {
		checks.push({
			level: "ok",
			message: `Global settings readable (${globalDoc.path})`,
		});
	}

	if (projectDoc.parseError) {
		checks.push({
			level: "error",
			message: `Failed to parse project settings (${projectDoc.path})`,
			details: [projectDoc.parseError],
		});
	} else {
		checks.push({
			level: "ok",
			message: `Project settings readable (${projectDoc.path})`,
		});
	}

	if (availableModels.length === 0) {
		checks.push({
			level: "error",
			message: "No connected models available",
			details: formatProviderStatus(providerStatus),
		});
	} else {
		checks.push({
			level: "ok",
			message: `${availableModels.length}/${allModels.length} models available across ${providerStatus.filter((provider) => provider.connected).length} provider(s)`,
		});
	}

	const globalConfig = globalDoc.parseError ? {} : parseSettingsConfig(globalDoc);
	const projectConfig = projectDoc.parseError ? {} : parseSettingsConfig(projectDoc);
	const mergedConfig = mergeMultiAgentConfig(mergeMultiAgentConfig({}, globalConfig), projectConfig);
	if (mergedConfig.enabled === undefined) {
		mergedConfig.enabled = true;
	}
	if (mergedConfig.enabled === false) {
		checks.push({
			level: "warn",
			message: "multiAgent.enabled is false",
		});
	} else {
		checks.push({
			level: "ok",
			message: "multiAgent is enabled",
		});
	}

	checks.push(...buildConfigWarnings(mergedConfig, allModels, availableModels));

	if (mergedConfig.initState) {
		const currentProviders = providerStatus.filter((provider) => provider.connected).map((provider) => provider.provider);
		const missingFromSnapshot = currentProviders.filter((provider) => !mergedConfig.initState?.connectedProviders.includes(provider));
		if (missingFromSnapshot.length > 0) {
			checks.push({
				level: "warn",
				message: "Newly connected providers are not reflected in init snapshot",
				details: [
					`Connected now: ${currentProviders.join(", ") || "(none)"}`,
					`Snapshot: ${mergedConfig.initState.connectedProviders.join(", ") || "(none)"}`,
					"Run /multi-agent init to review recommendation diff and apply updates.",
				],
			});
		}
	}

	const okCount = checks.filter((check) => check.level === "ok").length;
	const warnCount = checks.filter((check) => check.level === "warn").length;
	const errorCount = checks.filter((check) => check.level === "error").length;

	const lines = [
		"multi-agent doctor report",
		`Summary: ${okCount} ok, ${warnCount} warning(s), ${errorCount} error(s)`,
		"",
		...checks.map(buildDoctorLine),
	];
	const text = lines.join("\n");

	return {
		checks,
		okCount,
		warnCount,
		errorCount,
		text,
	};
}

export function multiAgentUsage(): string {
	return [
		"Usage:",
		"  /multi-agent init [balanced|quality|budget]",
		"  /multi-agent preset <balanced|quality|budget>",
		"  /multi-agent doctor",
		"",
		"Presets:",
		...PRESET_ORDER.map((preset) => `  - ${preset}: ${PRESET_DESCRIPTIONS[preset]}`),
	].join("\n");
}
