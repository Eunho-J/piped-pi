import { createIpcResponse } from "./messages.js";
import type { IpcMessage, IpcResponse } from "./types.js";

export type BrokerHandler = (message: IpcMessage) => Promise<IpcResponse | undefined> | IpcResponse | undefined;

interface Subscription {
	topic: string;
	sessionId: string;
	send: (message: IpcMessage) => void;
}

export class AgentIpcBroker {
	private readonly handlers = new Map<IpcMessage["type"], BrokerHandler>();
	private readonly subscriptions = new Map<string, Subscription[]>();

	registerHandler(type: IpcMessage["type"], handler: BrokerHandler): void {
		this.handlers.set(type, handler);
	}

	unregisterHandler(type: IpcMessage["type"]): void {
		this.handlers.delete(type);
	}

	async route(message: IpcMessage): Promise<IpcResponse> {
		const handler = this.handlers.get(message.type);
		if (!handler) {
			return createIpcResponse({
				id: message.id,
				success: false,
				error: `unhandled_message_type:${message.type}`,
			});
		}

		const result = await handler(message);
		if (result) {
			return {
				...result,
				id: message.id,
				type: "response",
				timestamp: result.timestamp ?? new Date().toISOString(),
			};
		}

		return createIpcResponse({
			id: message.id,
			success: true,
		});
	}

	subscribe(topic: string, sessionId: string, send: (message: IpcMessage) => void): () => void {
		const list = this.subscriptions.get(topic) ?? [];
		const sub: Subscription = { topic, sessionId, send };
		list.push(sub);
		this.subscriptions.set(topic, list);

		return () => {
			const existing = this.subscriptions.get(topic);
			if (!existing) {
				return;
			}
			const next = existing.filter((candidate) => candidate !== sub);
			if (next.length === 0) {
				this.subscriptions.delete(topic);
				return;
			}
			this.subscriptions.set(topic, next);
		};
	}

	publish(topic: string, message: IpcMessage, options?: { excludeSessionId?: string }): number {
		const listeners = this.subscriptions.get(topic);
		if (!listeners || listeners.length === 0) {
			return 0;
		}

		let delivered = 0;
		for (const listener of listeners) {
			if (options?.excludeSessionId && listener.sessionId === options.excludeSessionId) {
				continue;
			}
			listener.send(message);
			delivered += 1;
		}
		return delivered;
	}

	unsubscribeSession(sessionId: string): void {
		for (const [topic, listeners] of this.subscriptions.entries()) {
			const next = listeners.filter((listener) => listener.sessionId !== sessionId);
			if (next.length === 0) {
				this.subscriptions.delete(topic);
			} else {
				this.subscriptions.set(topic, next);
			}
		}
	}

	getTopics(): string[] {
		return Array.from(this.subscriptions.keys());
	}
}
