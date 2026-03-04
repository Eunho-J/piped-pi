import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentDiscovery } from "../src/discovery.js";

const cleanupPaths: string[] = [];

afterEach(() => {
	for (const path of cleanupPaths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("AgentDiscovery", () => {
	test("discovers alive sessions from socket directory", () => {
		const socketDir = mkdtempSync(join(tmpdir(), "pi-discovery-"));
		cleanupPaths.push(socketDir);

		mkdirSync(socketDir, { recursive: true });
		writeFileSync(join(socketDir, "ses_alpha.sock"), "");
		writeFileSync(
			join(socketDir, "ses_alpha.sock.json"),
			JSON.stringify({ agentName: "oracle", status: "idle", currentModel: "anthropic/claude-sonnet-4-5" }),
		);

		const discovery = new AgentDiscovery({ socketDir });
		const records = discovery.listAlive();

		expect(records).toHaveLength(1);
		expect(records[0].sessionId).toBe("ses_alpha");
		expect(records[0].agentName).toBe("oracle");
		expect(discovery.getSocketPath("ses_alpha")).toContain("ses_alpha.sock");
	});
});
