import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, test } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.js";
import { FooterComponent } from "../src/modes/interactive/components/footer.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createSessionStub(modelId: string): AgentSession {
	return {
		state: {
			model: {
				id: modelId,
				provider: "openai",
				reasoning: true,
				contextWindow: 200_000,
			},
			thinkingLevel: "high",
		},
		sessionManager: {
			getEntries: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						usage: {
							input: 52_000,
							output: 17_000,
							cacheRead: 3_000,
							cacheWrite: 2_000,
							cost: { total: Math.PI },
						},
					},
				},
			],
			getSessionName: () => "세션-테스트",
		},
		getContextUsage: () => ({
			contextWindow: 200_000,
			percent: 91.7,
		}),
		modelRegistry: {
			isUsingOAuth: () => false,
		},
	} as unknown as AgentSession;
}

function createFooterDataStub(): ReadonlyFooterDataProvider {
	return {
		getGitBranch: () => "feature/한글-branch-name",
		getExtensionStatuses: () => new Map(),
		getAvailableProviderCount: () => 2,
		onBranchChange: () => () => {},
	};
}

describe("Footer width regressions", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("keeps mixed-width path and status lines within terminal width", () => {
		const originalCwd = process.cwd();
		const tempRoot = mkdtempSync(join(tmpdir(), "pi-footer-width-"));
		const nestedDir = join(tempRoot, "workspace-한글-경로-길이-테스트", "subdir");
		mkdirSync(nestedDir, { recursive: true });
		process.chdir(nestedDir);

		try {
			const footer = new FooterComponent(
				createSessionStub("gpt-5-한글-모델-super-long-name"),
				createFooterDataStub(),
			);
			const width = 44;
			const lines = footer.render(width);

			expect(lines.length).toBeGreaterThanOrEqual(2);
			expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(width);
			expect(visibleWidth(lines[1] ?? "")).toBeLessThanOrEqual(width);
		} finally {
			process.chdir(originalCwd);
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
