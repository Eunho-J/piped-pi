import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getDefaultSocketDir } from "./server.js";
import type { AgentDiscoveryRecord } from "./types.js";

function toSessionId(socketPath: string): string {
	const base = basename(socketPath);
	return base.endsWith(".sock") ? base.slice(0, -".sock".length) : base;
}

function readMetadata(socketPath: string): Omit<AgentDiscoveryRecord, "sessionId" | "socketPath" | "updatedAt"> {
	const metaPath = `${socketPath}.json`;
	if (!existsSync(metaPath)) {
		return {};
	}

	try {
		const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as Partial<AgentDiscoveryRecord>;
		return {
			agentName: parsed.agentName,
			status: parsed.status,
			capabilities: parsed.capabilities,
			currentModel: parsed.currentModel,
			parentSessionId: parsed.parentSessionId,
		};
	} catch {
		return {};
	}
}

export interface AgentDiscoveryOptions {
	socketDir?: string;
}

export class AgentDiscovery {
	private readonly socketDir: string;

	constructor(options: AgentDiscoveryOptions = {}) {
		this.socketDir = options.socketDir ?? getDefaultSocketDir();
	}

	listAlive(): AgentDiscoveryRecord[] {
		if (!existsSync(this.socketDir)) {
			return [];
		}

		const files = readdirSync(this.socketDir)
			.filter((name) => name.endsWith(".sock"))
			.map((name) => join(this.socketDir, name));

		return files.map((socketPath) => {
			const stats = statSync(socketPath);
			return {
				sessionId: toSessionId(socketPath),
				socketPath,
				updatedAt: stats.mtime.toISOString(),
				...readMetadata(socketPath),
			};
		});
	}

	findBySessionId(sessionId: string): AgentDiscoveryRecord | undefined {
		return this.listAlive().find((record) => record.sessionId === sessionId);
	}

	getSocketPath(sessionId: string): string | undefined {
		return this.findBySessionId(sessionId)?.socketPath;
	}
}
