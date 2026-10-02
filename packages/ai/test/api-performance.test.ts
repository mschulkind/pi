import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { stream as streamAzure } from "../src/api/azure-openai-responses.ts";
import { stream } from "../src/api/openai-completions.ts";
import { stream as streamResponses } from "../src/api/openai-responses.ts";
import { createPerformanceRequest, type PerformanceAttemptRecord } from "../src/api/performance.ts";
import { stream as streamPi } from "../src/api/pi-messages.ts";
import type { Model, StreamOptions } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<"openai-completions"> = {
	id: "selected",
	name: "Test",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://example.test/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10000,
	maxTokens: 100,
};
const context = normalizeContext({ messages: [{ role: "user", content: "SECRET PROMPT", timestamp: 0 }] });
function sse(events: unknown[]): Response {
	return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`, {
		headers: { "content-type": "text/event-stream" },
	});
}

describe("local API performance attempts", () => {
	it("counts local HTTP requests for Pi retries with SDK retries disabled", async () => {
		let calls = 0;
		const records: PerformanceAttemptRecord[] = [];
		const server = createServer((_request, response) => {
			calls++;
			if (calls === 1) {
				response.writeHead(503, { "retry-after-ms": "1" });
				response.end("secret error body");
			} else {
				response.writeHead(200, { "content-type": "text/event-stream" });
				response.end(
					'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
				);
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address() as AddressInfo;
			const result = await stream({ ...model, baseUrl: `http://127.0.0.1:${address.port}/v1` }, context, {
				apiKey: "local-test",
				maxRetries: 1,
				performance: {
					record: (record) => {
						records.push(record);
					},
				},
			}).result();
			expect(result.stopReason).toBe("stop");
			expect(calls).toBe(2);
			expect(records).toHaveLength(2);
			expect(records.map((record) => record.httpStatus)).toEqual([503, 200]);
			expect(records[1].actualApiHostname).toBe("127.0.0.1");
			expect(records[1].returnedModel).toBeNull();
			expect(records[1].usage.total).toBeNull();
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});

	it.each(["openai-responses", "azure-openai-responses"] as const)(
		"records actual %s fetches and terminal provider usage",
		async (api) => {
			const records: PerformanceAttemptRecord[] = [];
			const options: StreamOptions = {
				apiKey: "local-test",
				performance: {
					record: (record) => {
						records.push(record);
					},
				},
				fetch: async () =>
					sse([
						{
							type: "response.completed",
							response: {
								id: "response",
								status: "completed",
								model: "returned-model",
								output: [],
								usage: {
									input_tokens: 4,
									output_tokens: 1,
									total_tokens: 5,
									input_tokens_details: { cached_tokens: 0 },
									output_tokens_details: { reasoning_tokens: 0 },
								},
							},
						},
					]),
			};
			const events =
				api === "openai-responses"
					? streamResponses({ ...model, api, compat: undefined }, context, options)
					: streamAzure({ ...model, api, compat: undefined }, context, options);
			const result = await events.result();
			expect(result.stopReason).toBe("stop");
			expect(records).toHaveLength(1);
			expect(records[0].returnedModel).toBe("returned-model");
			expect(records[0].usage).toMatchObject({ input: null, providerInput: 4, output: 1, total: 5, reasoning: 0 });
			expect(records[0].timing.firstContentOffsetMs).toBeNull();
		},
	);

	it("records only the Pi Messages gateway and preserves extension callbacks", async () => {
		const records: PerformanceAttemptRecord[] = [];
		let callbacks = 0;
		const result = await streamPi({ ...model, api: "pi-messages", provider: "radius", compat: undefined }, context, {
			apiKey: "local-test",
			performance: {
				record: (record) => {
					records.push(record);
				},
				purpose: "auxiliary",
			},
			onProviderStreamEvent: () => {
				callbacks++;
			},
			fetch: async () =>
				sse([
					{ type: "start" },
					{ type: "text_start", contentIndex: 0 },
					{ type: "text_delta", contentIndex: 0, delta: "ok" },
					{
						type: "done",
						reason: "stop",
						usage: {
							input: 2,
							output: 1,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 3,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						},
					},
				]),
		}).result();
		expect(result.stopReason).toBe("stop");
		expect(callbacks).toBe(4);
		expect(records).toHaveLength(1);
		expect(records[0].purpose).toBe("auxiliary");
		expect(records[0].timing.firstVisibleTextOffsetMs).not.toBeNull();
		expect(records[0].coverage.limitations).toContain("gateway_upstream_attempts_not_observed");
	});

	it("records SDK transport retries, post-hook settings and missing versus zero usage without bodies", async () => {
		const records: PerformanceAttemptRecord[] = [];
		let calls = 0;
		const result = await stream(model, context, {
			apiKey: "SECRET KEY",
			maxRetries: 2,
			performance: {
				record: (record) => {
					records.push(record);
				},
				sessionId: "session",
				logicalRequestId: "logical",
				purpose: "compaction",
			},
			onPayload: (payload) => ({
				...(payload as object),
				model: "wire-model",
				max_completion_tokens: 42,
				reasoning_effort: "high",
			}),
			fetch: async () => {
				calls++;
				if (calls === 1) throw new Error("SECRET NETWORK ERROR");
				if (calls === 2)
					return new Response("SECRET ERROR BODY", { status: 429, headers: { "retry-after-ms": "1" } });
				return sse([
					{ model: "returned", choices: [{ delta: { reasoning_content: "SECRET REASONING" } }] },
					{ choices: [{ delta: { content: "SECRET ANSWER" } }] },
					{
						choices: [{ delta: {}, finish_reason: "stop" }],
						usage: {
							prompt_tokens: 3,
							completion_tokens: 2,
							total_tokens: 5,
							prompt_tokens_details: { cached_tokens: 0 },
							completion_tokens_details: { reasoning_tokens: 1 },
							malicious: "SECRET USAGE",
						},
					},
				]);
			},
		}).result();
		expect(result.stopReason).toBe("stop");
		expect(calls).toBe(3);
		expect(records).toHaveLength(3);
		expect(records.map((record) => record.outcome)).toEqual(["error", "error", "success"]);
		expect(records.map((record) => record.attemptOrdinal)).toEqual([1, 2, 3]);
		expect(new Set(records.map((record) => record.logicalRequestId))).toEqual(new Set(["logical"]));
		expect(records[2].previousAttemptId).toBe(records[1].attemptId);
		expect(records[0].usage.input).toBeNull();
		expect(records[2].usage.cacheRead).toBe(0);
		expect(records[2].usage.cacheWrite).toBeNull();
		expect(records[2].usage.reasoning).toBe(1);
		expect(records[2].requestedModel).toBe("wire-model");
		expect(records[2].returnedModel).toBe("returned");
		expect(records[2].effectiveSettings.outputLimitTokens).toBe(42);
		expect(records[2].effectiveSettings.reasoningEffort).toBe("high");
		expect(records[2].timing.firstReasoningOffsetMs).not.toBeNull();
		expect(records[2].timing.firstVisibleTextOffsetMs).not.toBeNull();
		expect(records[0].actualApiHostname).toBe("example.test");
		expect(JSON.stringify(records)).not.toContain("SECRET");
		expect(records[2].usage.rawCoverage).toBe("partial");
	});

	it("does not mistake successful headers for a completed generation; preserves partial failure usage", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const eventStream = new AssistantMessageEventStream();
		const observed = createPerformanceRequest<StreamOptions>(
			model,
			{
				performance: {
					record: (record) => {
						records.push(record);
					},
				},
				fetch: async () => sse([]),
			},
			eventStream,
		);
		await observed!.fetch!("https://u:p@example.test/path?token=SECRET", { body: JSON.stringify({ stream: true }) });
		expect(records).toHaveLength(0);
		await observed!.onProviderStreamEvent!(
			{ usage: { prompt_tokens: 0 }, choices: [{ delta: { content: "x" } }] },
			model,
		);
		eventStream.push({
			type: "error",
			reason: "error",
			error: {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "error",
				timestamp: 0,
				errorMessage: "SECRET",
			},
		});
		expect(records).toHaveLength(1);
		expect(records[0].usage.input).toBe(0);
		expect(records[0].usage.output).toBeNull();
		expect(records[0].outcome).toBe("error");
		expect(records[0].coverage.correlation).toBe("missing_session");
		expect(records[0].actualApiHostname).toBe("example.test");
	});

	it("isolates recorder failures and aborts rejected transports without invented content times", async () => {
		const controller = new AbortController();
		const records: PerformanceAttemptRecord[] = [];
		const options = createPerformanceRequest<StreamOptions>(
			model,
			{
				signal: controller.signal,
				performance: {
					record: (record) => {
						records.push(record);
						throw new Error("disk failed");
					},
				},
				fetch: async () => {
					controller.abort();
					throw new Error("secret");
				},
			},
			new AssistantMessageEventStream(),
		);
		await expect(options!.fetch!("https://example.test", {})).rejects.toThrow("secret");
		expect(records).toHaveLength(1);
		expect(records[0].outcome).toBe("aborted");
		expect(records[0].timing.firstContentOffsetMs).toBeNull();
		expect(records[0].usage.total).toBeNull();
	});

	it("rejects malformed nested usage and fractional token counts rather than claiming complete raw coverage", async () => {
		const records: PerformanceAttemptRecord[] = [];
		await stream(model, context, {
			apiKey: "test",
			performance: {
				record: (record) => {
					records.push(record);
				},
			},
			fetch: async () =>
				sse([
					{
						choices: [{ delta: {}, finish_reason: "stop" }],
						usage: {
							prompt_tokens: 1.5,
							prompt_tokens_details: "SECRET",
							completion_tokens_details: { reasoning_tokens: -1 },
						},
					},
				]),
		}).result();
		expect(records[0].usage.input).toBeNull();
		expect(records[0].usage.cacheRead).toBeNull();
		expect(records[0].usage.reasoning).toBeNull();
		expect(records[0].usage.rawCoverage).toBe("partial");
		expect(JSON.stringify(records)).not.toContain("SECRET");
	});

	it("does not fabricate an ordinal when an explicit correlation falls outside the bounded history", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const invoke = async (logicalRequestId?: string) => {
			const observed = createPerformanceRequest<StreamOptions>(
				model,
				{
					performance: {
						logicalRequestId,
						record: (record) => {
							records.push(record);
						},
					},
					fetch: async () => {
						throw new Error("local failure");
					},
				},
				new AssistantMessageEventStream(),
			);
			await observed!.fetch!("https://example.test", {}).catch(() => {});
		};
		await invoke("evicted-logical-request");
		for (let i = 0; i < 1024; i++) await invoke();
		await invoke("evicted-logical-request");
		expect(records.at(-1)?.attemptOrdinal).toBeNull();
		expect(records.at(-1)?.previousAttemptId).toBeNull();
		expect(records.at(-1)?.retryCause).toBeNull();
	});
});
