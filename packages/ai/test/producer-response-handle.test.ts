import { expect, it } from "vitest";
import { createPerformanceRequest, type PerformanceAttemptRecord } from "../src/api/performance.ts";
import type { Model, StreamOptions } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const model: Model<"openai-completions"> = {
	id: "fixture",
	name: "Fixture",
	api: "openai-completions",
	provider: "openrouter",
	baseUrl: "https://example.test",
	input: ["text"],
	reasoning: false,
	contextWindow: 1000,
	maxTokens: 100,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
it.each(["gen-123_safe", "https://secret.test/path", "tool|opaque", "", "x".repeat(257), { private: true }])(
	"allowlists known response handles, never URLs or malformed ids: %j",
	async (handle) => {
		const records: PerformanceAttemptRecord[] = [];
		const stream = new AssistantMessageEventStream();
		const options = createPerformanceRequest<StreamOptions>(
			model,
			{
				performance: {
					logicalRequestId: "logical",
					sdkInvocationId: "invocation",
					orchestrationRetry: 2,
					record: (record) => {
						records.push(record);
					},
				},
				fetch: async () => new Response("fixture"),
			},
			stream,
		)!;
		await options.fetch!("https://example.test", {
			body: JSON.stringify({ model: "fixture", reasoning: { effort: "high" }, max_tokens: 123 }),
		});
		await options.onProviderStreamEvent!(
			{ id: "tool-private", choices: [{ delta: { tool_calls: [{ id: "tool-private" }] } }] },
			model,
		);
		await options.onProviderStreamEvent!({ object: "chat.completion.chunk", id: handle, choices: [] }, model);
		stream.push({
			type: "done",
			reason: "stop",
			message: {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				timestamp: 0,
				stopReason: "stop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		});
		expect(records[0]).toMatchObject({
			responseHandle: handle === "gen-123_safe" ? handle : null,
			sdkInvocationId: "invocation",
			logicalRequestId: "logical",
			orchestrationRetry: 2,
			effectiveSettings: { reasoningEffort: "high", outputLimitTokens: 123 },
		});
	},
);
