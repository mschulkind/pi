import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { stream } from "../src/api/openai-completions.ts";
import { createPerformanceRequest, type PerformanceAttemptRecord } from "../src/api/performance.ts";
import type { Model, StreamOptions } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<"openai-completions"> = {
	id: "local",
	name: "Local",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://example.test/v1",
	input: ["text"],
	reasoning: false,
	contextWindow: 10000,
	maxTokens: 100,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
function observer(api = "openai-responses") {
	const records: PerformanceAttemptRecord[] = [];
	const events = new AssistantMessageEventStream();
	const options = createPerformanceRequest<StreamOptions>(
		{ ...model, api },
		{
			performance: {
				record: (record) => {
					records.push(record);
				},
			},
			fetch: async () => new Response(""),
		},
		events,
	)!;
	const finish = () =>
		events.push({
			type: "done",
			reason: "stop",
			message: {
				role: "assistant",
				content: [],
				api,
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
	return { records, options, finish };
}
const gatewayUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } };

describe("performance review regressions", () => {
	it("observes genuine SDK-internal retries independently of the production Pi retry loop", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const events = new AssistantMessageEventStream();
		let calls = 0;
		const options = createPerformanceRequest<StreamOptions>(
			model,
			{
				performance: {
					record: (record) => {
						records.push(record);
					},
				},
				fetch: async () =>
					++calls === 1
						? new Response("PRIVATE ERROR", { status: 503, headers: { "retry-after-ms": "1" } })
						: new Response(
								JSON.stringify({
									id: "chat",
									choices: [
										{ index: 0, message: { role: "assistant", content: "private" }, finish_reason: "stop" },
									],
								}),
								{ headers: { "content-type": "application/json" } },
							),
			},
			events,
		)!;
		const client = new OpenAI({ apiKey: "test", baseURL: model.baseUrl, maxRetries: 1, fetch: options.fetch });
		const result = await client.chat.completions.create({ model: model.id, messages: [] });
		await options.onProviderStreamEvent!(result, model);
		events.push({
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
		expect(calls).toBe(2);
		expect(records.map((record) => record.httpStatus)).toEqual([503, 200]);
		expect(records[0].logicalRequestId).toBe(records[1].logicalRequestId);
		expect(records[1].previousAttemptId).toBe(records[0].attemptId);
		expect(JSON.stringify(records)).not.toContain("PRIVATE ERROR");
	});
	it("does not persist arbitrary setting strings as recognized reasoning modes", async () => {
		const observed = observer();
		await observed.options.fetch!("https://example.test/responses", {
			body: JSON.stringify({ reasoning: { effort: "SECRET", summary: "SECRET" }, thinking: { type: "SECRET" } }),
		});
		observed.finish();
		expect(observed.records[0].effectiveSettings).toMatchObject({
			reasoningEffort: null,
			reasoningDisplay: null,
			reasoningMode: null,
		});
		expect(JSON.stringify(observed.records)).not.toContain("SECRET");
	});
	it("does not treat gateway default zeros as reported provider usage", async () => {
		const observed = observer("pi-messages");
		await observed.options.fetch!("https://gateway.test/messages", {});
		await observed.options.onProviderStreamEvent!({ type: "done", usage: gatewayUsage }, model);
		observed.finish();
		expect(observed.records[0].usage.input).toBeNull();
		expect(observed.records[0].usage.output).toBeNull();
		expect(observed.records[0].usage.rawReports).toEqual([]);
		expect(observed.records[0].usage.rawReportSources).toEqual([]);
		expect(observed.records[0].usage.gatewayCounts).toMatchObject({ input: 0, total: 0 });
	});
	it("preserves validated gateway provider reports and consistently excludes caches from normalized input", async () => {
		const observed = observer("pi-messages");
		await observed.options.fetch!("https://gateway.test/messages", {});
		await observed.options.onProviderStreamEvent!(
			{
				type: "done",
				usage: {
					...gatewayUsage,
					provider: {
						raw: {
							prompt_tokens: 8,
							completion_tokens: 0,
							total_tokens: 8,
							prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 1 },
							malicious: "SECRET",
						},
					},
				},
			},
			model,
		);
		observed.finish();
		expect(observed.records[0].usage).toMatchObject({
			input: 4,
			output: 0,
			cacheRead: 3,
			cacheWrite: 1,
			total: 8,
			inputCountConvention: "excludes_cache",
		});
		expect(observed.records[0].usage.rawReports[0]).toMatchObject({ prompt_tokens: 8, completion_tokens: 0 });
		expect(observed.records[0].usage.rawReportSources).toEqual(["gateway_preserved_provider"]);
		expect(observed.records[0].usage.providerInputCountConvention).toBe("includes_cache");
		expect(JSON.stringify(observed.records)).not.toContain("SECRET");
	});
	it("observes refusal deltas and new final-only content without re-counting duplicate snapshots", async () => {
		const observed = observer();
		await observed.options.fetch!("https://example.test/responses", {});
		await observed.options.onProviderStreamEvent!(
			{ type: "response.refusal.delta", item_id: "item", content_index: 0, delta: "No" },
			model,
		);
		await observed.options.onProviderStreamEvent!(
			{
				type: "response.completed",
				response: { output: [{ id: "item", type: "message", content: [{ type: "refusal", refusal: "No" }] }] },
			},
			model,
		);
		observed.finish();
		const timing = observed.records[0].timing;
		expect(timing.firstVisibleTextOffsetMs).not.toBeNull();
		expect(timing.lastContentOffsetMs).toBe(timing.firstContentOffsetMs);
		const finalOnly = observer();
		await finalOnly.options.fetch!("https://example.test/responses", {});
		await finalOnly.options.onProviderStreamEvent!(
			{
				type: "response.completed",
				response: {
					output: [{ id: "item", type: "message", content: [{ type: "output_text", text: "Only final text" }] }],
				},
			},
			model,
		);
		finalOnly.finish();
		expect(finalOnly.records[0].timing.firstVisibleTextOffsetMs).not.toBeNull();
	});
	it("does not count gateway redacted final thinking placeholders as readable content", async () => {
		const observed = observer("pi-messages");
		await observed.options.fetch!("https://gateway.test/messages", {});
		await observed.options.onProviderStreamEvent!({ type: "thinking_start", contentIndex: 0 }, model);
		await observed.options.onProviderStreamEvent!(
			{
				type: "thinking_end",
				contentIndex: 0,
				content: "[Reasoning redacted]",
				contentSignature: "SECRET",
				redacted: true,
			},
			model,
		);
		observed.finish();
		expect(observed.records[0].timing.firstContentOffsetMs).toBeNull();
		expect(observed.records[0].timing.firstReasoningOffsetMs).toBeNull();
		expect(observed.records[0].reasoningContentKind).toBe("unknown");
		expect(JSON.stringify(observed.records)).not.toContain("SECRET");
	});
	it("observes gateway final-only tool arguments without persisting them", async () => {
		const observed = observer("pi-messages");
		await observed.options.fetch!("https://gateway.test/messages", {});
		await observed.options.onProviderStreamEvent!(
			{
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: { id: "tool", name: "read", arguments: { path: "SECRET" } },
			},
			model,
		);
		observed.finish();
		expect(observed.records[0].timing.firstContentOffsetMs).not.toBeNull();
		expect(observed.records[0].timing.firstVisibleTextOffsetMs).toBeNull();
		expect(JSON.stringify(observed.records)).not.toContain("SECRET");
	});
	it("separates provider terminal arrival from slow extension/adapter completion", async () => {
		const records: PerformanceAttemptRecord[] = [];
		await stream(model, normalizeContext({ messages: [] }), {
			apiKey: "test",
			performance: {
				record: (record) => {
					records.push(record);
				},
			},
			fetch: async () =>
				new Response(
					'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
					{ headers: { "content-type": "text/event-stream" } },
				),
			onProviderStreamEvent: async () => {
				await new Promise((resolve) => setTimeout(resolve, 20));
			},
		}).result();
		const timing = records[0].timing;
		expect(timing.headersOffsetMs).not.toBeNull();
		expect(timing.providerTerminalOffsetMs).not.toBeNull();
		expect(timing.completedOffsetMs! - timing.providerTerminalOffsetMs!).toBeGreaterThanOrEqual(15);
		expect(timing.completionBoundary).toBe("adapter_terminal");
	});
	it("labels rejected HTTP header observations without inventing error-body completion", async () => {
		const records: PerformanceAttemptRecord[] = [];
		await stream(model, normalizeContext({ messages: [] }), {
			apiKey: "test",
			performance: {
				record: (record) => {
					records.push(record);
				},
			},
			fetch: async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							setTimeout(() => controller.error(new Error("SECRET BODY")), 20);
						},
					}),
					{ status: 503 },
				),
		}).result();
		expect(records).toHaveLength(1);
		expect(records[0].timing.completedOffsetMs).toBeNull();
		expect(records[0].timing.completionBoundary).toBe("http_error_headers");
		expect(records[0].coverage.limitations).toContain("http_error_body_not_observed");
	});
	it("does not mislabel SDK timeout cancellation as caller abort, and correlates the following Pi retry", async () => {
		const records: PerformanceAttemptRecord[] = [];
		let calls = 0;
		await stream(model, normalizeContext({ messages: [] }), {
			apiKey: "test",
			timeoutMs: 10,
			maxRetries: 1,
			performance: {
				record: (record) => {
					records.push(record);
				},
			},
			fetch: async (_input, init) => {
				if (++calls === 1)
					return new Promise<Response>((_resolve, reject) =>
						init?.signal?.addEventListener("abort", () => reject(new Error("internal cancellation")), {
							once: true,
						}),
					);
				return new Response('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
					headers: { "content-type": "text/event-stream" },
				});
			},
		}).result();
		expect(records.map((record) => record.outcome)).toEqual(["error", "success"]);
		expect(records[0].errorCategory).toBe("internal_cancellation");
		expect(records[1].retryCause).toBe("previous_attempt_failed");
	});
});
