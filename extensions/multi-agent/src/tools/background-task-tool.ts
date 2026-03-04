import { Type } from "@sinclair/typebox";
import type { ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TaskDelegator } from "../orchestration/TaskDelegator.js";

const BackgroundOutputParams = Type.Object({
	task_id: Type.String({ minLength: 1 }),
});

const BackgroundCancelParams = Type.Object({
	task_id: Type.String({ minLength: 1 }),
});

export function createBackgroundOutputTool(
	getDelegator: (ctx: ExtensionContext) => TaskDelegator,
): ToolDefinition<typeof BackgroundOutputParams, { status: string }> {
	return {
		name: "background_output",
		label: "Background Output",
		description: "Read status of a background task started by task(run_in_background=true)",
		parameters: BackgroundOutputParams,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const status = getDelegator(ctx).getBackgroundTask(params.task_id);
			if (!status) {
				return {
					content: [{ type: "text", text: `No background task found for ${params.task_id}.` }],
					details: { status: "missing" },
				};
			}
			return {
				content: [{ type: "text", text: `Background task ${params.task_id}: ${status.status}` }],
				details: { status: status.status },
			};
		},
	};
}

export function createBackgroundCancelTool(
	getDelegator: (ctx: ExtensionContext) => TaskDelegator,
): ToolDefinition<typeof BackgroundCancelParams, { cancelled: boolean }> {
	return {
		name: "background_cancel",
		label: "Background Cancel",
		description: "Request cancellation for a running background task",
		parameters: BackgroundCancelParams,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const cancelled = getDelegator(ctx).cancelBackgroundTask(params.task_id);
			return {
				content: [
					{
						type: "text",
						text: cancelled
							? `Cancellation requested for ${params.task_id}.`
							: `Task ${params.task_id} is not running or does not exist.`,
					},
				],
				details: { cancelled },
			};
		},
	};
}
