export { IpcAuthManager, type IpcAuthManagerOptions, type IpcTokenPayload } from "./auth.js";
export { AgentIpcBroker, type BrokerHandler } from "./broker.js";
export { AgentIpcClient, type AgentIpcClientOptions } from "./client.js";
export { AgentDiscovery, type AgentDiscoveryOptions } from "./discovery.js";
export { createIpcEnvelope, createIpcMessage, createIpcResponse, generateIpcMessageId } from "./messages.js";
export { AgentIpcServer, type AgentIpcServerOptions, getDefaultSocketDir } from "./server.js";
export { SharedStateManager, type SharedStateManagerOptions, type SharedStateRecord } from "./shared-state.js";
export type {
	AgentCapabilityAnnounceMessage,
	AgentDiscoveryRecord,
	AgentHandshakeMessage,
	AgentHeartbeatMessage,
	BrokerBroadcastMessage,
	BrokerDiscoverMessage,
	BrokerRegisterMessage,
	IpcEventHandler,
	IpcInboundMessage,
	IpcMessage,
	IpcMessageBase,
	IpcMessageType,
	IpcRequestHandler,
	IpcResponse,
	IpcSocketInfo,
	PubSubPublishMessage,
	PubSubSubscribeMessage,
	SessionFollowUpMessage,
	SessionSteerMessage,
	StateQueryMessage,
	StateSyncMessage,
	TaskDelegateMessage,
	TaskProgressMessage,
	TaskResultMessage,
} from "./types.js";
