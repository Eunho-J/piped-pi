# @mariozechner/pi-ipc

IPC transport primitives for pi multi-agent orchestration.

## Included modules

- `AgentIpcServer`: Unix domain socket JSON-RPC server.
- `AgentIpcClient`: reconnecting client with request/response correlation.
- `AgentIpcBroker`: in-process message router and pub/sub registry.
- `AgentDiscovery`: socket directory discovery helpers (+ optional `.sock.json` metadata).
- `SharedStateManager`: namespaced file-backed shared state.
- `IpcAuthManager`: HMAC token generation/verification for session messages.

## Usage

```ts
import { AgentIpcServer, createIpcMessage } from "@mariozechner/pi-ipc";

const server = new AgentIpcServer({
	sessionId: "ses_demo",
	agentName: "sisyphus",
	currentModel: "anthropic/claude-opus-4-6",
	onMessage: async (message) => {
		if (message.type === "session.steer") {
			return { success: true, data: { accepted: true } };
		}
		return { success: false, error: "unsupported" };
	},
});

await server.start();
```
