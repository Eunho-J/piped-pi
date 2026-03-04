import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentDiscovery } from "../src/discovery.js";
import { AgentIpcServer } from "../src/server.js";

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

	test("reads metadata written by AgentIpcServer", async () => {
		const socketDir = mkdtempSync(join(tmpdir(), "pi-discovery-server-"));
		cleanupPaths.push(socketDir);

		const server = new AgentIpcServer({
			sessionId: "ses_server",
			socketDir,
			agentName: "oracle",
			status: "idle",
			currentModel: "anthropic/claude-opus-4-6",
			onMessage: async () => ({ success: true }),
		});
		await server.start();

		const discovery = new AgentDiscovery({ socketDir });
		const record = discovery.findBySessionId("ses_server");
		expect(record?.agentName).toBe("oracle");
		expect(record?.status).toBe("idle");
		expect(record?.currentModel).toBe("anthropic/claude-opus-4-6");

		server.updateMetadata({ status: "running" });
		const updated = discovery.findBySessionId("ses_server");
		expect(updated?.status).toBe("running");

		await server.stop();
		expect(discovery.findBySessionId("ses_server")).toBeUndefined();
	});
});
