import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, test } from "vitest";
import { runMultiAgentDoctor, runMultiAgentInitFlow, runMultiAgentPresetFlow } from "../src/ux.js";

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

const MODELS: Model<Api>[] = [
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
	model({
		provider: "google",
		id: "gemini-2.5-flash",
		reasoning: false,
		contextWindow: 1_000_000,
		input: ["text", "image"],
		costInput: 0.1,
		costOutput: 0.4,
	}),
];

class StubModelRegistry {
	private availableRefs: Set<string>;
	readonly authStorage: {
		getOAuthProviders: () => Array<{ id: string }>;
		set: (_provider: string, _credential: { type: "api_key"; key: string }) => void;
	};

	constructor(private readonly models: Model<Api>[], availableRefs: string[]) {
		this.availableRefs = new Set(availableRefs);
		this.authStorage = {
			getOAuthProviders: () => [],
			set: () => {},
		};
	}

	setAvailable(refs: string[]): void {
		this.availableRefs = new Set(refs);
	}

	refresh(): void {}

	getAll(): Model<Api>[] {
		return this.models;
	}

	getAvailable(): Model<Api>[] {
		return this.models.filter((candidate) => this.availableRefs.has(`${candidate.provider}/${candidate.id}`));
	}
}

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

function createTempDir(): string {
	const dir = join(tmpdir(), `multi-agent-ux-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

function createContext(cwd: string, modelRegistry: StubModelRegistry): ExtensionCommandContext {
	return {
		ui: {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: () => {},
			onTerminalInput: () => () => {},
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined as never,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			setEditorComponent: () => {},
			theme: {} as ExtensionCommandContext["ui"]["theme"],
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		},
		hasUI: false,
		cwd,
		sessionManager: {
			getCwd: () => cwd,
			getSessionDir: () => "",
			getSessionId: () => "ses_root",
			getSessionFile: () => undefined,
			getLeafId: () => null,
			getLeafEntry: () => undefined,
			getEntry: () => undefined,
			getLabel: () => undefined,
			getBranch: () => [],
			getHeader: () => null,
			getEntries: () => [],
			getTree: () => [],
			getSessionName: () => undefined,
		},
		modelRegistry: modelRegistry as unknown as ExtensionCommandContext["modelRegistry"],
		model: undefined,
		isIdle: () => true,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getContextUsage: () => undefined,
		compact: () => {},
		getSystemPrompt: () => "",
		waitForIdle: async () => {},
		newSession: async () => ({ cancelled: false }),
		fork: async () => ({ cancelled: false }),
		navigateTree: async () => ({ cancelled: false }),
		switchSession: async () => ({ cancelled: false }),
		reload: async () => {},
		runSubAgent: async () => ({
			sessionId: "ses_sub",
			finalText: "ok",
			tokenUsage: { input: 1, output: 1 },
		}),
	};
}

describe("multi-agent UX command flows", () => {
	test("init flow writes starter config and handles newly connected provider diffs", async () => {
		const cwd = createTempDir();
		const registry = new StubModelRegistry(MODELS, ["anthropic/claude-opus-4-6", "anthropic/claude-haiku-4-5"]);
		const ctx = createContext(cwd, registry);

		const first = await runMultiAgentInitFlow("balanced", ctx);
		expect(first.applied).toBe(true);
		expect(first.appliedChanges).toBeGreaterThan(0);
		expect(first.backupPath).toBeUndefined();

		const settingsPath = join(cwd, ".pi", "settings.json");
		const firstSettings = JSON.parse(readFileSync(settingsPath, "utf8")) as { multiAgent?: { initState?: { connectedProviders?: string[] } } };
		expect(firstSettings.multiAgent?.initState?.connectedProviders).toContain("anthropic");
		expect(firstSettings.multiAgent?.initState?.connectedProviders).not.toContain("openai");

		registry.setAvailable([
			"anthropic/claude-opus-4-6",
			"anthropic/claude-haiku-4-5",
			"openai/o3",
			"google/gemini-2.5-flash",
		]);
		const second = await runMultiAgentInitFlow("balanced", ctx);
		expect(second.applied).toBe(true);
		expect(second.newlyConnectedProviders).toContain("openai");
		expect(second.backupPath).toBeTruthy();

		const secondSettings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
			multiAgent?: { agents?: Record<string, { model?: string }>; initState?: { connectedProviders?: string[] } };
		};
		expect(secondSettings.multiAgent?.agents?.["sisyphus-junior"]?.model).toBeTruthy();
		expect(secondSettings.multiAgent?.initState?.connectedProviders).toContain("openai");
	});

	test("preset command switches to requested preset and updates snapshot", async () => {
		const cwd = createTempDir();
		const registry = new StubModelRegistry(MODELS, [
			"anthropic/claude-opus-4-6",
			"anthropic/claude-haiku-4-5",
			"openai/o3",
			"google/gemini-2.5-pro",
			"google/gemini-2.5-flash",
		]);
		const ctx = createContext(cwd, registry);

		await runMultiAgentInitFlow("quality", ctx);
		const applied = await runMultiAgentPresetFlow("budget", ctx);
		expect(applied.preset).toBe("budget");
		expect(applied.appliedChanges).toBeGreaterThan(0);
		expect(applied.backupPath).toBeTruthy();

		const settings = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")) as {
			multiAgent?: { initState?: { preset?: string } };
		};
		expect(settings.multiAgent?.initState?.preset).toBe("budget");
	});

	test("doctor reports broken config diagnostics", () => {
		const cwd = createTempDir();
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify(
				{
					multiAgent: {
						enabled: true,
						agents: {
							oracle: { model: "openai/not-a-model" },
							sisyphus: { provider: "missing-provider" },
						},
						categories: {
							deep: {
								modelChain: [{ model: "anthropic/not-a-real-model" }],
							},
						},
						providerKeys: {
							oracle: {
								openai: { envVar: "MISSING_MULTI_AGENT_KEY" },
							},
						},
						initState: {
							version: 1,
							preset: "balanced",
							connectedProviders: ["anthropic"],
							recommendedAt: "2026-01-01T00:00:00.000Z",
							agents: {},
							categories: {},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const registry = new StubModelRegistry(MODELS, []);
		const ctx = createContext(cwd, registry);
		const report = runMultiAgentDoctor(ctx);

		expect(report.errorCount).toBeGreaterThan(0);
		expect(report.warnCount).toBeGreaterThan(0);
		expect(report.text).toContain("No connected models available");
		expect(report.text).toContain("model not found");
	});
});

