import { createConnection, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createIpcResponse } from "./messages.js";
import type { IpcInboundMessage, IpcMessage, IpcResponse } from "./types.js";

interface PendingRequest {
	resolve: (response: IpcResponse) => void;
	reject: (error: Error) => void;
	timeoutId: NodeJS.Timeout;
}

export interface AgentIpcClientOptions {
	socketPath: string;
	autoReconnect?: boolean;
	reconnectDelayMs?: number;
	requestTimeoutMs?: number;
	onMessage?: (message: IpcMessage) => void;
}

export class AgentIpcClient {
	private readonly socketPath: string;
	private readonly autoReconnect: boolean;
	private readonly reconnectDelayMs: number;
	private readonly requestTimeoutMs: number;
	private readonly onMessage?: (message: IpcMessage) => void;

	private socket?: Socket;
	private connecting?: Promise<void>;
	private buffer = "";
	private reconnecting = false;
	private readonly pendingRequests = new Map<string, PendingRequest>();

	constructor(options: AgentIpcClientOptions | string) {
		if (typeof options === "string") {
			this.socketPath = options;
			this.autoReconnect = true;
			this.reconnectDelayMs = 250;
			this.requestTimeoutMs = 30_000;
			return;
		}

		this.socketPath = options.socketPath;
		this.autoReconnect = options.autoReconnect ?? true;
		this.reconnectDelayMs = options.reconnectDelayMs ?? 250;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.onMessage = options.onMessage;
	}

	async connect(): Promise<void> {
		if (this.socket && !this.socket.destroyed) {
			return;
		}
		if (this.connecting) {
			return this.connecting;
		}

		this.connecting = new Promise<void>((resolve, reject) => {
			const socket = createConnection(this.socketPath);
			socket.setEncoding("utf8");

			socket.once("connect", () => {
				this.socket = socket;
				this.connecting = undefined;
				this.attachSocketListeners(socket);
				resolve();
			});

			socket.once("error", (error) => {
				if (this.socket !== socket) {
					socket.destroy();
				}
				this.connecting = undefined;
				reject(error);
			});
		});

		return this.connecting;
	}

	private attachSocketListeners(socket: Socket): void {
		socket.on("data", (chunk) => {
			this.buffer += chunk;
			let lineEnd = this.buffer.indexOf("\n");
			while (lineEnd !== -1) {
				const line = this.buffer.slice(0, lineEnd).trim();
				this.buffer = this.buffer.slice(lineEnd + 1);
				if (line.length > 0) {
					this.handleLine(line);
				}
				lineEnd = this.buffer.indexOf("\n");
			}
		});

		socket.on("close", () => {
			this.socket = undefined;
			this.rejectPendingRequests(new Error("IPC connection closed"));
			if (this.autoReconnect) {
				void this.reconnect();
			}
		});

		socket.on("error", () => {
			// no-op; close event handles cleanup
		});
	}

	private handleLine(line: string): void {
		let inbound: IpcInboundMessage;
		try {
			inbound = JSON.parse(line) as IpcInboundMessage;
		} catch {
			return;
		}

		if (inbound.type === "response") {
			const pending = this.pendingRequests.get(inbound.id);
			if (!pending) {
				return;
			}
			clearTimeout(pending.timeoutId);
			this.pendingRequests.delete(inbound.id);
			pending.resolve(inbound);
			return;
		}

		this.onMessage?.(inbound);
	}

	private async reconnect(): Promise<void> {
		if (this.reconnecting) {
			return;
		}
		this.reconnecting = true;
		while (this.autoReconnect && !this.isConnected()) {
			try {
				await delay(this.reconnectDelayMs);
				await this.connect();
				break;
			} catch {
				// retry until success or disconnect() disables autoReconnect
			}
		}
		this.reconnecting = false;
	}

	private rejectPendingRequests(error: Error): void {
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timeoutId);
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}

	async send(message: IpcMessage): Promise<IpcResponse> {
		await this.connect();
		if (!this.socket || this.socket.destroyed) {
			return createIpcResponse({
				id: message.id,
				success: false,
				error: "ipc_not_connected",
			});
		}

		return new Promise<IpcResponse>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pendingRequests.delete(message.id);
				reject(new Error(`IPC request timed out: ${message.type}`));
			}, this.requestTimeoutMs);

			this.pendingRequests.set(message.id, { resolve, reject, timeoutId });
			this.socket?.write(`${JSON.stringify(message)}\n`);
		});
	}

	async disconnect(): Promise<void> {
		this.rejectPendingRequests(new Error("IPC client disconnected"));
		if (this.socket && !this.socket.destroyed) {
			await new Promise<void>((resolve) => {
				this.socket?.once("close", () => resolve());
				this.socket?.end();
			});
		}
		this.socket = undefined;
	}

	isConnected(): boolean {
		return !!this.socket && !this.socket.destroyed;
	}
}
