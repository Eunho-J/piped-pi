import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionContext, ToolDefinition } from "@mariozechner/pi-coding-agent";
import type { TaskDelegator, TaskDelegateResult } from "../orchestration/TaskDelegator.js";

export const TaskToolParameters = Type.Object({
	prompt: Type.String({ minLength: 1, description: "Prompt sent to delegated sub-agent" }),
	category: Type.Optional(Type.String({ description: "Optional category for automatic routing" })),
	agent: Type.Optional(Type.String({ description: "Explicit sub-agent name" })),
	session_id: Type.Optional(Type.String({ description: "Existing sub-agent session id" })),
	run_in_background: Type.Optional(Type.Boolean({ description: "Run delegation asynchronously" })),
	load_skills: Type.Optional(Type.Array(Type.String(), { description: "Skill identifiers to load" })),
	max_prompt_tokens: Type.Optional(Type.Number({ minimum: 1, description: "Optional prompt token budget hint" })),
});

export type TaskToolInput = Static<typeof TaskToolParameters>;

interface TaskToolDetails {
	result: TaskDelegateResult;
}

function formatOutput(result: TaskDelegateResult): string {
	if (result.mode === "background") {
		return [
			`Delegated in background as ${result.task_id}.`,
			`session_id: ${result.session_id}`,
			`agent: ${result.agent_used}`,
			`model: ${result.model_used}`,
		].join("\n");
	}

	return [
		`Delegation completed by ${result.agent_used}.`,
		`session_id: ${result.session_id}`,
		`model: ${result.model_used}`,
		result.output ? "" : undefined,
		result.output,
	]
		.filter((line): line is string => typeof line === "string")
		.join("\n");
}

export function createTaskTool(
	getDelegator: (ctx: ExtensionContext) => TaskDelegator,
): ToolDefinition<typeof TaskToolParameters, TaskToolDetails> {
	return {
		name: "task",
		label: "Task",
		description: "Delegate a focused task to a specialized sub-agent",
		promptSnippet: "task(prompt, category?, agent?) delegates work to a sub-agent and returns its result.",
		promptGuidelines: [
			"Use task() for focused sub-work when decomposition improves reliability.",
			"Prefer category routing unless a specific agent is required.",
		],
		parameters: TaskToolParameters,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) => {
			const result = await getDelegator(ctx).execute(params, ctx);
			return {
				content: [{ type: "text", text: formatOutput(result) }],
				details: { result },
			};
		},
	};
}
