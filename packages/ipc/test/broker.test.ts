import { describe, expect, test } from "vitest";
import { AgentIpcBroker } from "../src/broker.js";
import { createIpcMessage } from "../src/messages.js";
import type { PubSubPublishMessage, SessionFollowUpMessage } from "../src/types.js";

describe("AgentIpcBroker", () => {
	test("routes messages to registered handlers", async () => {
		const broker = new AgentIpcBroker();
		broker.registerHandler("session.follow_up", async (message) => {
			if (message.type !== "session.follow_up") {
				return;
			}
			return {
				id: message.id,
				type: "response",
				timestamp: new Date().toISOString(),
				success: true,
				data: { queued: message.payload.message },
			};
		});

		const response = await broker.route(
			createIpcMessage<SessionFollowUpMessage>({
				type: "session.follow_up",
				payload: {
					targetSessionId: "ses_123",
					message: "next step",
					token: "token",
				},
			}),
		);

		expect(response.success).toBe(true);
		expect(response.data).toEqual({ queued: "next step" });
	});

	test("supports pub/sub fanout", () => {
		const broker = new AgentIpcBroker();
		const delivered: string[] = [];
		const unsubscribe = broker.subscribe("state_change", "ses_a", () => {
			delivered.push("a");
		});
		broker.subscribe("state_change", "ses_b", () => {
			delivered.push("b");
		});

		const count = broker.publish(
			"state_change",
			createIpcMessage<PubSubPublishMessage>({
				type: "pubsub.publish",
				payload: {
					topic: "state_change",
					data: { key: "tasks" },
					publisherSessionId: "ses_orchestrator",
				},
			}),
			{ excludeSessionId: "ses_b" },
		);

		expect(count).toBe(1);
		expect(delivered).toEqual(["a"]);

		unsubscribe();
		expect(broker.getTopics()).toEqual(["state_change"]);
	});
});
