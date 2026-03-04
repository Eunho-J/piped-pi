import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentIpcClient } from "../src/client.js";
import { createIpcMessage } from "../src/messages.js";
import { AgentIpcServer } from "../src/server.js";
import type { SessionSteerMessage, TaskProgressMessage } from "../src/types.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
	for (const path of cleanupPaths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("AgentIpcServer/AgentIpcClient", () => {
	test("handles request/response messaging", async () => {
		const socketDir = mkdtempSync(join(tmpdir(), "pi-ipc-"));
		cleanupPaths.push(socketDir);

		const server = new AgentIpcServer({
			sessionId: "ses_server",
			socketDir,
			onMessage: async (message) => {
				if (message.type === "session.steer") {
					return {
						success: true,
						data: { accepted: true, message: message.payload.message },
					};
				}
				return { success: false, error: "unsupported" };
			},
		});
		await server.start();

		const client = new AgentIpcClient({ socketPath: server.socketPath, autoReconnect: false });
		await client.connect();

		const response = await client.send(
			createIpcMessage<SessionSteerMessage>({
				type: "session.steer",
				payload: {
					targetSessionId: "ses_server",
					message: "pause current branch",
					token: "token",
				},
			}),
		);

		expect(response.success).toBe(true);
		expect(response.data).toEqual({ accepted: true, message: "pause current branch" });

		await client.disconnect();
		await server.stop();
	});

	test("broadcasts events to connected clients", async () => {
		const socketDir = mkdtempSync(join(tmpdir(), "pi-ipc-"));
		cleanupPaths.push(socketDir);

		const server = new AgentIpcServer({
			sessionId: "ses_server",
			socketDir,
			onMessage: async () => ({ success: true }),
		});
		await server.start();

		let received: TaskProgressMessage | undefined;
		const client = new AgentIpcClient({
			socketPath: server.socketPath,
			autoReconnect: false,
			onMessage: (message) => {
				if (message.type === "task.progress") {
					received = message;
				}
			},
		});
		await client.connect();

		server.broadcast(
			createIpcMessage<TaskProgressMessage>({
				type: "task.progress",
				payload: {
					taskId: "task_1",
					progressType: "message",
					message: "still running",
				},
			}),
		);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(received?.payload.taskId).toBe("task_1");
		expect(received?.payload.message).toBe("still running");

		await client.disconnect();
		await server.stop();
	});
});
