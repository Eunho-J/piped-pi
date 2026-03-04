import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { basename, dirname, join } from "node:path";
import { createIpcResponse } from "./messages.js";
import type { AgentDiscoveryRecord, IpcInboundMessage, IpcMessage, IpcRequestHandler, IpcResponse } from "./types.js";

export interface AgentIpcServerOptions {
	sessionId: string;
	onMessage: IpcRequestHandler;
	socketDir?: string;
	socketPath?: string;
	onClientMessage?: (message: IpcMessage) => void;
	agentName?: string;
	status?: "idle" | "running" | "busy";
	capabilities?: string[];
	currentModel?: string;
	parentSessionId?: string;
}

function defaultSocketDir(): string {
	return join(process.env.HOME ?? process.cwd(), ".pi", "agent", "sockets");
}

function deriveSocketPath(sessionId: string, socketDir?: string): string {
	return join(socketDir ?? defaultSocketDir(), `${sessionId}.sock`);
}

function parseMessage(raw: string): IpcInboundMessage | null {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) {
			return null;
		}
		return parsed as IpcInboundMessage;
	} catch {
		return null;
	}
}

function writeLine(socket: Socket, payload: unknown): void {
	socket.write(`${JSON.stringify(payload)}\n`);
}

export class AgentIpcServer {
	readonly sessionId: string;
	readonly socketPath: string;

	private readonly onMessage: IpcRequestHandler;
	private readonly onClientMessage?: (message: IpcMessage) => void;
	private readonly metadata: Omit<AgentDiscoveryRecord, "sessionId" | "socketPath" | "updatedAt">;
	private readonly sockets = new Set<Socket>();
	private server?: Server;

	constructor(options: AgentIpcServerOptions) {
		this.sessionId = options.sessionId;
		this.socketPath = options.socketPath ?? deriveSocketPath(options.sessionId, options.socketDir);
		this.onMessage = options.onMessage;
		this.onClientMessage = options.onClientMessage;
		this.metadata = {
			agentName: options.agentName,
			status: options.status,
			capabilities: options.capabilities,
			currentModel: options.currentModel,
			parentSessionId: options.parentSessionId,
		};
	}

	async start(): Promise<void> {
		if (this.server) {
			return;
		}

		const socketDir = dirname(this.socketPath);
		if (!existsSync(socketDir)) {
			mkdirSync(socketDir, { recursive: true, mode: 0o700 });
		}

		if (existsSync(this.socketPath)) {
			rmSync(this.socketPath, { force: true });
		}

		this.server = createServer((socket) => this.handleConnection(socket));
		await new Promise<void>((resolve, reject) => {
			this.server?.once("error", reject);
			this.server?.listen(this.socketPath, () => resolve());
		});
		chmodSync(this.socketPath, 0o600);
		this.writeMetadata();
	}

	private handleConnection(socket: Socket): void {
		this.sockets.add(socket);
		socket.setEncoding("utf8");

		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk;
			let lineEnd = buffer.indexOf("\n");
			while (lineEnd !== -1) {
				const line = buffer.slice(0, lineEnd).trim();
				buffer = buffer.slice(lineEnd + 1);
				if (line.length > 0) {
					void this.handleMessageLine(line, socket);
				}
				lineEnd = buffer.indexOf("\n");
			}
		});

		socket.on("close", () => {
			this.sockets.delete(socket);
		});
		socket.on("error", () => {
			this.sockets.delete(socket);
		});
	}

	private async handleMessageLine(line: string, socket: Socket): Promise<void> {
		const inbound = parseMessage(line);
		if (!inbound) {
			writeLine(
				socket,
				createIpcResponse({
					success: false,
					error: "invalid_json",
				}),
			);
			return;
		}

		if (inbound.type === "response") {
			return;
		}

		this.onClientMessage?.(inbound);
		let response: IpcResponse;
		try {
			const result = await this.onMessage(inbound);
			response = {
				...createIpcResponse({
					id: inbound.id,
					success: result.success,
					data: result.data,
					error: result.error,
				}),
			};
		} catch (error) {
			response = createIpcResponse({
				id: inbound.id,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}

		writeLine(socket, response);
	}

	async stop(): Promise<void> {
		for (const socket of this.sockets) {
			socket.destroy();
		}
		this.sockets.clear();

		if (this.server) {
			await new Promise<void>((resolve) => {
				this.server?.close(() => resolve());
			});
			this.server = undefined;
		}

		if (existsSync(this.socketPath)) {
			rmSync(this.socketPath, { force: true });
		}
		const metadataPath = this.getMetadataPath();
		if (existsSync(metadataPath)) {
			rmSync(metadataPath, { force: true });
		}
	}

	broadcast(message: IpcMessage): void {
		for (const socket of this.sockets) {
			if (socket.destroyed) {
				continue;
			}
			writeLine(socket, message);
		}
	}

	isRunning(): boolean {
		return this.server?.listening ?? false;
	}

	toJSON(): { sessionId: string; socketPath: string; socketName: string; clientCount: number } {
		return {
			sessionId: this.sessionId,
			socketPath: this.socketPath,
			socketName: basename(this.socketPath),
			clientCount: this.sockets.size,
		};
	}

	updateMetadata(metadata: Partial<Omit<AgentDiscoveryRecord, "sessionId" | "socketPath" | "updatedAt">>): void {
		Object.assign(this.metadata, metadata);
		if (this.isRunning()) {
			this.writeMetadata();
		}
	}

	private getMetadataPath(): string {
		return `${this.socketPath}.json`;
	}

	private writeMetadata(): void {
		const payload = {
			...this.metadata,
			sessionId: this.sessionId,
			socketPath: this.socketPath,
		};
		writeFileSync(this.getMetadataPath(), JSON.stringify(payload, null, "\t"));
	}
}

export function getDefaultSocketDir(): string {
	return defaultSocketDir();
}
