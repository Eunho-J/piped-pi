export type IpcMessageType =
	| "agent.handshake"
	| "agent.heartbeat"
	| "task.delegate"
	| "task.result"
	| "task.progress"
	| "state.sync"
	| "state.query"
	| "session.steer"
	| "session.follow_up"
	| "agent.capability_announce"
	| "broker.register"
	| "broker.discover"
	| "broker.broadcast"
	| "pubsub.subscribe"
	| "pubsub.publish"
	| "response";

export interface IpcMessageBase {
	id: string;
	timestamp: string;
	type: IpcMessageType;
	senderSessionId?: string;
	authToken?: string;
}

export interface AgentHandshakeMessage extends IpcMessageBase {
	type: "agent.handshake";
	payload: {
		sessionId: string;
		agentName: string;
		capabilities: string[];
		socketPath: string;
		currentModel: string;
		parentSessionId?: string;
		token: string;
	};
}

export interface AgentHeartbeatMessage extends IpcMessageBase {
	type: "agent.heartbeat";
	payload: {
		sessionId: string;
		status: "idle" | "running" | "busy";
		currentTaskId?: string;
		memoryMB?: number;
		contextUsage?: number;
	};
}

export interface TaskDelegateMessage extends IpcMessageBase {
	type: "task.delegate";
	payload: {
		taskId: string;
		sessionId: string;
		agentName?: string;
		category?: string;
		prompt: string;
		model?: string;
		skills?: string[];
		parentSessionId: string;
		timeoutMs?: number;
		priority?: "low" | "normal" | "high" | "critical";
	};
}

export interface TaskResultMessage extends IpcMessageBase {
	type: "task.result";
	payload: {
		taskId: string;
		sessionId: string;
		success: boolean;
		output: string;
		error?: string;
		changedFiles?: string[];
		tokenUsage: {
			input: number;
			output: number;
			cacheRead?: number;
			cacheWrite?: number;
		};
		durationMs: number;
		subTaskIds?: string[];
	};
}

export interface TaskProgressMessage extends IpcMessageBase {
	type: "task.progress";
	payload: {
		taskId: string;
		progressType: "tool_call" | "llm_thinking" | "file_modified" | "subtask_delegated" | "phase_change" | "message";
		message: string;
		data?: {
			toolName?: string;
			filePath?: string;
			subTaskId?: string;
			phase?: string;
			percentComplete?: number;
		};
		tokenCount?: number;
	};
}

export interface StateSyncMessage extends IpcMessageBase {
	type: "state.sync";
	payload: {
		namespace: string;
		key: string;
		operation: "create" | "update" | "delete";
		value?: unknown;
		modifiedBy: string;
	};
}

export interface StateQueryMessage extends IpcMessageBase {
	type: "state.query";
	payload: {
		namespace: string;
		key: string;
	};
}

export interface SessionSteerMessage extends IpcMessageBase {
	type: "session.steer";
	payload: {
		targetSessionId: string;
		message: string;
		mode?: "all" | "one-at-a-time";
		priority?: "normal" | "high" | "urgent";
		token: string;
	};
}

export interface SessionFollowUpMessage extends IpcMessageBase {
	type: "session.follow_up";
	payload: {
		targetSessionId: string;
		message: string;
		mode?: "all" | "one-at-a-time";
		token: string;
	};
}

export interface AgentCapabilityAnnounceMessage extends IpcMessageBase {
	type: "agent.capability_announce";
	payload: {
		sessionId: string;
		agentName: string;
		capabilities: string[];
		loadedSkills: string[];
		availableSlots: number;
		status: "idle" | "running" | "busy";
		currentModel: string;
		contextAvailability: number;
	};
}

export interface BrokerRegisterMessage extends IpcMessageBase {
	type: "broker.register";
	payload: {
		sessionId: string;
		agentName: string;
		socketPath: string;
		capabilities: string[];
	};
}

export interface BrokerDiscoverMessage extends IpcMessageBase {
	type: "broker.discover";
	payload: {
		agentName?: string;
		capability?: string;
		status?: "idle" | "running" | "busy";
	};
}

export interface BrokerBroadcastMessage extends IpcMessageBase {
	type: "broker.broadcast";
	payload: {
		message: string;
		topic?: string;
		data?: unknown;
		excludeSelf?: boolean;
	};
}

export interface PubSubSubscribeMessage extends IpcMessageBase {
	type: "pubsub.subscribe";
	payload: {
		topics: string[];
		subscriberSessionId: string;
		callbackSocketPath: string;
	};
}

export interface PubSubPublishMessage extends IpcMessageBase {
	type: "pubsub.publish";
	payload: {
		topic: string;
		data: unknown;
		publisherSessionId: string;
	};
}

export interface IpcResponse extends IpcMessageBase {
	type: "response";
	success: boolean;
	data?: unknown;
	error?: string;
}

export type IpcMessage =
	| AgentHandshakeMessage
	| AgentHeartbeatMessage
	| TaskDelegateMessage
	| TaskResultMessage
	| TaskProgressMessage
	| StateSyncMessage
	| StateQueryMessage
	| SessionSteerMessage
	| SessionFollowUpMessage
	| AgentCapabilityAnnounceMessage
	| BrokerRegisterMessage
	| BrokerDiscoverMessage
	| BrokerBroadcastMessage
	| PubSubSubscribeMessage
	| PubSubPublishMessage;

export type IpcInboundMessage = IpcMessage | IpcResponse;

export type IpcRequestHandler = (
	message: IpcMessage,
) => Promise<IpcResponse | Omit<IpcResponse, "id" | "timestamp" | "type">>;

export type IpcEventHandler = (message: IpcMessage) => void;

export interface IpcSocketInfo {
	sessionId: string;
	socketPath: string;
	updatedAt: string;
}

export interface AgentDiscoveryRecord extends IpcSocketInfo {
	agentName?: string;
	status?: "idle" | "running" | "busy";
	capabilities?: string[];
	currentModel?: string;
	parentSessionId?: string;
}
