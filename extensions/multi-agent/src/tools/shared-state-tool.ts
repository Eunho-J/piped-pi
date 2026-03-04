import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { SharedStateManager } from "@mariozechner/pi-ipc";

const SharedStateParams = Type.Object({
	namespace: Type.String({ minLength: 1 }),
	key: Type.String({ minLength: 1 }),
	operation: Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("delete")]),
	value: Type.Optional(Type.Unknown()),
});

function createManager(cwd: string): SharedStateManager {
	const baseDir = join(cwd, ".pi", "multiagent", "state");
	if (!existsSync(baseDir)) {
		mkdirSync(baseDir, { recursive: true });
	}
	return new SharedStateManager({ baseDir });
}

export function createSharedStateTool(): ToolDefinition<typeof SharedStateParams, { namespace: string; key: string }> {
	return {
		name: "shared_state",
		label: "Shared State",
		description: "Read/write/delete namespaced shared state records used by multi-agent flows",
		parameters: SharedStateParams,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const manager = createManager(ctx.cwd);
			if (params.operation === "read") {
				const record = manager.read(params.namespace, params.key);
				return {
					content: [{ type: "text", text: JSON.stringify(record ?? null, null, 2) }],
					details: { namespace: params.namespace, key: params.key },
				};
			}
			if (params.operation === "write") {
				const record = manager.write(params.namespace, params.key, params.value);
				return {
					content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
					details: { namespace: params.namespace, key: params.key },
				};
			}
			const removed = manager.delete(params.namespace, params.key);
			return {
				content: [{ type: "text", text: removed ? "deleted" : "not_found" }],
				details: { namespace: params.namespace, key: params.key },
			};
		},
	};
}
