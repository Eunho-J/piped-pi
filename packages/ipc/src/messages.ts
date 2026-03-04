import { randomUUID } from "node:crypto";
import type { IpcMessage, IpcMessageBase, IpcResponse } from "./types.js";

export function generateIpcMessageId(): string {
	return randomUUID();
}

export function createIpcEnvelope<TType extends IpcMessageBase["type"]>(
	type: TType,
	options?: Pick<IpcMessageBase, "senderSessionId" | "authToken">,
): Pick<IpcMessageBase, "id" | "timestamp" | "type" | "senderSessionId" | "authToken"> {
	return {
		id: generateIpcMessageId(),
		timestamp: new Date().toISOString(),
		type,
		senderSessionId: options?.senderSessionId,
		authToken: options?.authToken,
	};
}

export function createIpcMessage<TMessage extends IpcMessage>(message: Omit<TMessage, "id" | "timestamp">): TMessage {
	return {
		...message,
		id: generateIpcMessageId(),
		timestamp: new Date().toISOString(),
	} as TMessage;
}

export function createIpcResponse(options: {
	id?: string;
	success: boolean;
	data?: unknown;
	error?: string;
	senderSessionId?: string;
}): IpcResponse {
	return {
		id: options.id ?? generateIpcMessageId(),
		type: "response",
		timestamp: new Date().toISOString(),
		success: options.success,
		data: options.data,
		error: options.error,
		senderSessionId: options.senderSessionId,
	};
}
