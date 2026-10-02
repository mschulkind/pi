import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { zstdDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	closeOpenAICodexWebSocketSessions,
	resetOpenAICodexWebSocketDebugStats,
	stream,
	streamSimple,
} from "../src/api/openai-codex-responses.ts";
import type { PerformanceAttemptRecord } from "../src/api/performance.ts";
import type { Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<"openai-codex-responses"> = {
	id: "selected",
	name: "Local",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://codex.test/private?secret=PRIVATE",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10000,
	maxTokens: 100,
};
const token = `aaa.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "PRIVATE_ACCOUNT" } })).toString("base64")}.bbb`;
const context = normalizeContext({ messages: [{ role: "user", content: "PRIVATE_PROMPT", timestamp: 0 }] });
const usage = {
	input_tokens: 8,
	output_tokens: 2,
	total_tokens: 10,
	input_tokens_details: { cached_tokens: 0 },
	output_tokens_details: { reasoning_tokens: 0 },
	malicious: "PRIVATE_USAGE",
};
function terminal(type = "response.done") {
	return { type, response: { id: "response", model: "returned", status: "completed", output: [], usage } };
}
function events() {
	return [
		{ type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "reason", summary: [] } },
		{
			type: "response.reasoning_summary_part.added",
			output_index: 0,
			summary_index: 0,
			part: { type: "summary_text", text: "" },
		},
		{
			type: "response.reasoning_summary_text.delta",
			item_id: "reason",
			output_index: 0,
			summary_index: 0,
			delta: "PRIVATE_REASONING",
		},
		{
			type: "response.output_item.added",
			output_index: 1,
			item: { type: "message", id: "message", role: "assistant", content: [] },
		},
		{
			type: "response.content_part.added",
			output_index: 1,
			content_index: 0,
			part: { type: "output_text", text: "" },
		},
		{
			type: "response.output_text.delta",
			item_id: "message",
			output_index: 1,
			content_index: 0,
			delta: "PRIVATE_ANSWER",
		},
		terminal(),
	];
}
function sse() {
	return new Response(
		events()
			.map((event) => `data: ${JSON.stringify(event)}\n\n`)
			.join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}
function recording(records: PerformanceAttemptRecord[]) {
	return {
		sessionId: "owner",
		operationId: "parent",
		purpose: "assistant" as const,
		record: (record: PerformanceAttemptRecord) => {
			records.push(record);
		},
	};
}
function fixture(
	plan: {
		connect?: "throw" | "close" | "idle";
		send?: "throw" | "close" | "idle";
		replies?: unknown[][];
		closeAfterReplies?: boolean;
	} = {},
) {
	const sends: Record<string, unknown>[] = [];
	const parseRequest = JSON.parse;
	let connections = 0;
	class Socket extends EventTarget {
		readyState = 1;
		constructor() {
			super();
			connections++;
			if (plan.connect === "throw") throw new Error("PRIVATE_CONNECT");
			if (plan.connect !== "idle")
				queueMicrotask(() =>
					this.dispatchEvent(
						plan.connect === "close"
							? Object.assign(new Event("close"), { code: 1009, reason: "PRIVATE_CLOSE" })
							: new Event("open"),
					),
				);
		}
		send(data: string) {
			sends.push(parseRequest(data));
			if (plan.send === "throw") throw new Error("PRIVATE_SEND");
			queueMicrotask(() => {
				if (plan.send === "close") {
					this.dispatchEvent(Object.assign(new Event("close"), { code: 1009, reason: "PRIVATE_CLOSE" }));
					return;
				}
				if (plan.send === "idle") return;
				for (const event of plan.replies?.[sends.length - 1] ?? events())
					this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(event) }));
				if (plan.closeAfterReplies)
					this.dispatchEvent(Object.assign(new Event("close"), { code: 1009, reason: "PRIVATE_CLOSE" }));
			});
		}
		close() {
			this.readyState = 3;
		}
	}
	vi.stubGlobal("WebSocket", Socket);
	return { sends, connections: () => connections };
}
afterEach(() => {
	closeOpenAICodexWebSocketSessions();
	resetOpenAICodexWebSocketDebugStats();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function generations(records: PerformanceAttemptRecord[]) {
	return records.filter((record) => record.attemptKind === "generation");
}
function safe(records: PerformanceAttemptRecord[]) {
	expect(JSON.stringify(records)).not.toContain("PRIVATE");
}

describe("Codex actual performance transports", () => {
	it.each(["sse", "websocket"] as const)(
		"observes %s tool argument done events before hooks and deduplicates later snapshots",
		async (transport) => {
			for (const toolType of ["function_call", "custom_tool_call"] as const) {
				for (const fragment of ["", '{"value":', '{"value":"PRIVATE_TOOL"}']) {
					const records: PerformanceAttemptRecord[] = [];
					let clock = 100;
					vi.spyOn(performance, "now").mockImplementation(() => clock);
					const argumentsValue = '{"value":"PRIVATE_TOOL"}';
					const id = toolType === "function_call" ? "fc_tool" : "ctc_tool";
					const doneType =
						toolType === "function_call"
							? "response.function_call_arguments.done"
							: "response.custom_tool_call_input.done";
					const deltaType =
						toolType === "function_call"
							? "response.function_call_arguments.delta"
							: "response.custom_tool_call_input.delta";
					const valueKey = toolType === "function_call" ? "arguments" : "input";
					const item = { type: toolType, id, call_id: "call", name: "tool", [valueKey]: "" };
					const replies = [
						{ type: "response.output_item.added", output_index: 0, item },
						...(fragment ? [{ type: deltaType, item_id: id, output_index: 0, delta: fragment }] : []),
						{ type: doneType, item_id: id, output_index: 0, [valueKey]: argumentsValue },
						{ type: "response.output_item.done", output_index: 0, item: { ...item, [valueKey]: argumentsValue } },
						terminal(),
					];
					const local = fixture({ replies: [replies] });
					const fetch = vi.fn(
						async () =>
							new Response(replies.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
								headers: { "content-type": "text/event-stream" },
							}),
					);
					let doneAt = 0;
					let deltaAt = 0;
					const result = await stream(model, context, {
						apiKey: token,
						transport,
						performance: recording(records),
						fetch,
						onProviderStreamEvent: async (event) => {
							const type = (event as { type: string }).type;
							if (type === deltaType) deltaAt = clock;
							if (type === doneType) {
								doneAt = clock;
								clock += 50;
								await Promise.resolve();
							} else clock += 10;
						},
					}).result();
					expect(result.stopReason).toBe("toolUse");
					expect(fetch).toHaveBeenCalledTimes(transport === "sse" ? 1 : 0);
					expect(local.sends).toHaveLength(transport === "sse" ? 0 : 1);
					const record = generations(records)[0];
					expect(record.timing.firstContentOffsetMs).toBe(
						(fragment ? deltaAt : doneAt) - record.timing.startedAtMonotonicMs,
					);
					expect(record.timing.lastContentOffsetMs).toBe(
						(fragment === argumentsValue ? deltaAt : doneAt) - record.timing.startedAtMonotonicMs,
					);
					expect(record.timing.firstVisibleTextOffsetMs).toBeNull();
					safe(records);
					vi.restoreAllMocks();
				}
			}
		},
	);

	it("lets actual HTTP fetches proceed when attempt-ID allocation fails without fabricating records or ordinals", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const fetch = vi.fn(async () => sse());
		vi.spyOn(globalThis.crypto, "randomUUID").mockImplementationOnce(() => {
			throw new Error("PRIVATE_OBSERVER_ALLOCATION");
		});
		const options = {
			apiKey: token,
			transport: "sse" as const,
			performance: { ...recording(records), logicalRequestId: "allocation-isolation" },
			fetch,
		};
		const first = await stream(model, context, options).result();
		const second = await stream(model, context, options).result();
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(first.stopReason).toBe("stop");
		expect(second.stopReason).toBe("stop");
		expect(records).toHaveLength(1);
		expect(records[0].attemptOrdinal).toBe(1);
		expect(records[0].previousAttemptId).toBeNull();
		safe(records);
	});
	it("observes a genuine local HTTP POST without inferring wire usage from initialized message zeros", async () => {
		const records: PerformanceAttemptRecord[] = [];
		let calls = 0;
		const server = createServer((request, response) => {
			calls++;
			expect(request.method).toBe("POST");
			request.resume();
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n');
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address() as AddressInfo;
			const result = await stream({ ...model, baseUrl: `http://127.0.0.1:${address.port}/private` }, context, {
				apiKey: token,
				transport: "sse",
				performance: recording(records),
			}).result();
			expect(result.stopReason).toBe("stop");
			expect(calls).toBe(1);
			expect(records).toHaveLength(1);
			expect(records[0].actualApiHostname).toBe("127.0.0.1");
			expect(records[0].usage.rawReports).toEqual([]);
			expect(records[0].usage.output).toBeNull();
			expect(records[0].returnedModel).toBeNull();
			expect(records[0].timing.firstContentOffsetMs).toBeNull();
			safe(records);
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});

	it("records real cached continuation retry sends, then pre-start fallback, under the second logical request", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const local = fixture({
			replies: [
				[terminal()],
				[{ type: "error", error: { code: "previous_response_not_found", message: "PRIVATE_PROVIDER" } }],
				[],
			],
			send: undefined,
		});
		// Fail the fresh retry before any provider event, using an idle timeout.
		const fetch = vi.fn(async () => sse());
		const options = {
			apiKey: token,
			transport: "websocket-cached" as const,
			sessionId: "cached",
			performance: recording(records),
			timeoutMs: 10,
			fetch,
		};
		const first = await stream(model, context, options).result();
		const second = await stream(
			model,
			normalizeContext({
				messages: [...context.messages, first, { role: "user", content: "PRIVATE_NEXT", timestamp: 1 }],
			}),
			options,
		).result();
		expect(second.stopReason).toBe("stop");
		expect(local.connections()).toBe(2);
		expect(local.sends).toHaveLength(3);
		expect(local.sends[1].previous_response_id).toBe("response");
		expect(local.sends[1].input).toHaveLength(1);
		expect(local.sends[2].previous_response_id).toBeUndefined();
		expect(local.sends[2].input).toHaveLength(2);
		expect(fetch).toHaveBeenCalledTimes(1);
		const requests = generations(records);
		expect(requests.map((record) => record.outcome)).toEqual(["success", "error", "error", "success"]);
		expect(requests[0].logicalRequestId).not.toBe(requests[1].logicalRequestId);
		expect(new Set(requests.slice(1).map((record) => record.logicalRequestId)).size).toBe(1);
		expect(requests.slice(1).map((record) => record.attemptOrdinal)).toEqual([1, 2, 3]);
		expect(requests[3].transportTransition).toBe("pre_start_sse_fallback");
		safe(records);
	});

	it("uses the actual cached socket hostname even when requested routing changes or recording starts late", async () => {
		const local = fixture();
		const records: PerformanceAttemptRecord[] = [];
		const options = { apiKey: token, transport: "websocket" as const, sessionId: "routing" };
		await stream(model, context, options).result();
		await stream({ ...model, baseUrl: "https://different.test/PRIVATE_PATH" }, context, {
			...options,
			performance: recording(records),
		}).result();
		expect(local.connections()).toBe(1);
		expect(local.sends).toHaveLength(2);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			actualApiHostname: "codex.test",
			websocket: { reused: true, sendAccepted: true },
		});
		safe(records);
	});

	it.each(["response.done", "response.completed", "response.incomplete", "response.failed"])(
		"observes original %s usage before normalization",
		async (type) => {
			const records: PerformanceAttemptRecord[] = [];
			fixture({
				replies: [
					[
						{
							...terminal(type),
							response: {
								...terminal().response,
								status:
									type === "response.failed"
										? "failed"
										: type === "response.incomplete"
											? "incomplete"
											: "completed",
								incomplete_details: { reason: "max_output_tokens" },
								error: { code: "failure", message: "PRIVATE_ERROR" },
							},
						},
					],
				],
			});
			const result = await stream(model, context, { apiKey: token, performance: recording(records) }).result();
			expect(result.stopReason).toBe(
				type === "response.failed" ? "error" : type === "response.incomplete" ? "length" : "stop",
			);
			const record = generations(records)[0];
			expect(record.timing.providerTerminalOffsetMs).not.toBeNull();
			expect(record.usage.rawReports).toEqual([
				{
					input_tokens: 8,
					output_tokens: 2,
					total_tokens: 10,
					input_tokens_details: { cached_tokens: 0 },
					output_tokens_details: { reasoning_tokens: 0 },
				},
			]);
			safe(records);
		},
	);

	it("observes final-only full reasoning without storing encrypted replay data or duplicate content", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const item = {
			type: "reasoning",
			id: "reason",
			summary: [],
			content: [{ type: "reasoning_text", text: "PRIVATE_REASONING" }],
			encrypted_content: "PRIVATE_ENCRYPTED",
		};
		fixture({
			replies: [
				[
					{ type: "response.output_item.done", output_index: 0, item },
					{ type: "response.completed", response: { ...terminal().response, output: [item] } },
				],
			],
		});
		const result = await stream(model, context, { apiKey: token, performance: recording(records) }).result();
		expect(result.content[0]).toMatchObject({ type: "thinking", thinking: "PRIVATE_REASONING" });
		const record = generations(records)[0];
		expect(record.reasoningContentKind).toBe("full");
		expect(record.timing.firstReasoningOffsetMs).not.toBeNull();
		expect(record.timing.lastContentOffsetMs).toBe(record.timing.firstContentOffsetMs);
		safe(records);
	});

	it("does not infer effective WebSocket settings from unrecognized strings or nonserialized caller limits", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const local = fixture();
		await stream(model, context, {
			apiKey: token,
			maxTokens: 100,
			performance: recording(records),
			onPayload: (payload) => ({
				...(payload as object),
				model: "wire",
				reasoning: { effort: "PRIVATE_MODE", summary: "PRIVATE_SUMMARY" },
				text: { verbosity: "PRIVATE_VERBOSITY" },
				service_tier: "PRIVATE_TIER",
				temperature: "PRIVATE_TEMP",
			}),
		}).result();
		expect(local.sends[0].model).toBe("wire");
		expect(generations(records)[0].effectiveSettings).toMatchObject({
			reasoningEffort: null,
			reasoningDisplay: null,
			outputLimitTokens: null,
			textVerbosity: null,
			serviceTier: null,
			temperature: null,
		});
		safe(records);
	});

	it("records HTTP internal cancellation distinctly from caller abort", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const result = await stream(model, context, {
			apiKey: token,
			transport: "sse",
			timeoutMs: 5,
			performance: recording(records),
			fetch: async (_input, init) =>
				new Promise<Response>((_resolve, reject) =>
					init?.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_TIMEOUT"))),
				),
		}).result();
		expect(result.stopReason).toBe("error");
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			outcome: "error",
			errorCategory: "internal_cancellation",
			failureStage: "transport",
		});
		safe(records);
	});

	it("does not turn provider hook errors into socket retries or SSE fallback", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const local = fixture();
		const fetch = vi.fn(async () => sse());
		const result = await stream(model, context, {
			apiKey: token,
			performance: recording(records),
			fetch,
			onProviderStreamEvent: () => {
				throw new Error("PRIVATE_HOOK");
			},
		}).result();
		expect(result.stopReason).toBe("error");
		expect(local.sends).toHaveLength(1);
		expect(fetch).not.toHaveBeenCalled();
		expect(generations(records)[0]).toMatchObject({ outcome: "error", failureStage: "generation" });
		safe(records);
	});

	it("does not invent attempts on authentication, payload-hook, or pre-fetch abort failures", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const fetch = vi.fn(async () => sse());
		await stream(model, context, { transport: "sse", performance: recording(records), fetch }).result();
		await stream(model, context, {
			apiKey: token,
			transport: "sse",
			performance: recording(records),
			fetch,
			onPayload: () => {
				throw new Error("PRIVATE_HOOK");
			},
		}).result();
		await stream(model, context, {
			apiKey: token,
			transport: "sse",
			performance: recording(records),
			fetch,
			signal: AbortSignal.abort(),
		}).result();
		expect(fetch).not.toHaveBeenCalled();
		expect(records).toHaveLength(0);
	});
	it("records every HTTP invocation including rejection and provider retry with post-hook compressed settings", async () => {
		vi.useFakeTimers();
		const records: PerformanceAttemptRecord[] = [];
		let calls = 0;
		const resultPromise = stream(model, context, {
			apiKey: token,
			transport: "sse",
			maxRetries: 2,
			performance: recording(records),
			onPayload: (payload) => ({
				...(payload as object),
				model: "wire",
				max_output_tokens: 42,
				reasoning: { effort: "high", summary: "detailed" },
				temperature: 0.3,
				service_tier: "priority",
				text: { verbosity: "medium" },
			}),
			fetch: async (_input, init) => {
				calls++;
				const body =
					typeof init?.body === "string"
						? JSON.parse(init.body)
						: JSON.parse(Buffer.from(zstdDecompressSync(init?.body as Uint8Array)).toString());
				expect(body.model).toBe("wire");
				if (calls === 1) throw new Error("PRIVATE_NETWORK");
				if (calls === 2) return new Response("PRIVATE_ERROR", { status: 503, headers: { "retry-after-ms": "1" } });
				return sse();
			},
		}).result();
		await vi.runAllTimersAsync();
		expect((await resultPromise).stopReason).toBe("stop");
		expect(calls).toBe(3);
		expect(records).toHaveLength(3);
		expect(records.map((record) => record.outcome)).toEqual(["error", "error", "success"]);
		expect(records.map((record) => record.attemptOrdinal)).toEqual([1, 2, 3]);
		expect(new Set(records.map((record) => record.logicalRequestId)).size).toBe(1);
		const last = records[2];
		expect(last).toMatchObject({
			transport: "http",
			streamProtocol: "sse",
			actualApiHostname: "codex.test",
			requestedModel: "wire",
			returnedModel: "returned",
			sessionId: "owner",
			operationId: "parent",
		});
		expect(last.effectiveSettings).toMatchObject({
			outputLimitTokens: 42,
			reasoningEffort: "high",
			reasoningDisplay: "detailed",
			temperature: 0.3,
			serviceTier: "priority",
			textVerbosity: "medium",
			toolChoice: "auto",
			parallelToolCalls: true,
		});
		expect(last.usage).toMatchObject({
			providerInput: 8,
			input: null,
			cacheRead: 0,
			cacheWrite: null,
			reasoning: 0,
			total: 10,
			rawCoverage: "partial",
		});
		expect(last.timing.firstReasoningOffsetMs).not.toBeNull();
		expect(last.timing.firstVisibleTextOffsetMs).not.toBeNull();
		expect(last.timing.providerTerminalOffsetMs).not.toBeNull();
		expect(last.timing.completedOffsetMs!).toBeGreaterThanOrEqual(last.timing.providerTerminalOffsetMs!);
		expect(records[1].timing.completionBoundary).toBe("http_error_headers");
		safe(records);
	});

	it.each(["websocket", "websocket-cached", "auto"] as const)(
		"records %s generation sends separately from new/reused socket connections",
		async (transport) => {
			const records: PerformanceAttemptRecord[] = [];
			const local = fixture();
			const fetch = vi.fn(async () => sse());
			const options = { apiKey: token, transport, sessionId: "routing", performance: recording(records), fetch };
			const first = await streamSimple(model, context, options).result();
			const secondContext = normalizeContext({
				messages: [...context.messages, first, { role: "user", content: "PRIVATE_SECOND", timestamp: 1 }],
			});
			await streamSimple(model, secondContext, options).result();
			expect(local.connections()).toBe(1);
			expect(local.sends).toHaveLength(2);
			expect(fetch).not.toHaveBeenCalled();
			expect(records.filter((record) => record.attemptKind === "connection")).toHaveLength(1);
			const requests = generations(records);
			expect(requests).toHaveLength(2);
			expect(requests.map((record) => record.websocket?.reused)).toEqual([false, true]);
			expect(requests.every((record) => record.websocket?.sendAccepted)).toBe(true);
			expect(requests[0].websocket?.connectionId).toBe(requests[1].websocket?.connectionId);
			expect(requests[0].logicalRequestId).not.toBe(requests[1].logicalRequestId);
			expect(requests[0].effectiveSettings.outputLimitTokens).toBeNull(); // maxTokens is not serialized by Codex.
			expect(requests[0].httpStatus).toBeNull();
			expect(requests[0].timing.headersOffsetMs).toBeNull();
			expect(requests[0].streamProtocol).toBe("websocket_events");
			expect(requests[0].coverage.limitations).toContain("parsed_events_after_socket_queueing");
			expect(requests[0].coverage.limitations).not.toContain("parsed_events_after_sdk_buffering");
			expect(requests[0].timing.providerTerminalOffsetMs).not.toBeNull();
			expect(first.usage.provider?.raw).toEqual(usage);
			safe(records);
		},
	);

	it.each(["websocket_connection_limit_reached", "previous_response_not_found"])(
		"records actual generation retry after %s",
		async (code) => {
			const records: PerformanceAttemptRecord[] = [];
			const local = fixture({
				replies: [[{ type: "error", error: { code, message: "PRIVATE_PROVIDER" } }], events()],
			});
			const fetch = vi.fn(async () => sse());
			const result = await stream(model, context, {
				apiKey: token,
				transport: "auto",
				performance: recording(records),
				fetch,
			}).result();
			expect(result.stopReason).toBe("stop");
			expect(local.sends).toHaveLength(2);
			expect(local.connections()).toBe(2);
			expect(fetch).not.toHaveBeenCalled();
			const requests = generations(records);
			expect(requests.map((record) => record.outcome)).toEqual(["error", "success"]);
			expect(requests.map((record) => record.attemptOrdinal)).toEqual([1, 2]);
			expect(requests[1].previousAttemptId).toBe(requests[0].attemptId);
			expect(requests[1].retryCause).toBe("previous_attempt_failed");
			expect(new Set(records.map((record) => record.logicalRequestId)).size).toBe(1);
			safe(records);
		},
	);

	it.each(["throw", "close", "idle"] as const)(
		"records actual connection %s failure and pre-start fallback without inventing a socket send",
		async (connect) => {
			vi.useFakeTimers();
			const records: PerformanceAttemptRecord[] = [];
			const local = fixture({ connect });
			let fetches = 0;
			const resultPromise = stream(model, context, {
				apiKey: token,
				transport: "auto",
				websocketConnectTimeoutMs: 10,
				performance: recording(records),
				fetch: async () => {
					fetches++;
					return sse();
				},
			}).result();
			await vi.runAllTimersAsync();
			expect((await resultPromise).stopReason).toBe("stop");
			expect(local.connections()).toBe(1);
			expect(local.sends).toHaveLength(0);
			expect(fetches).toBe(1);
			expect(records).toHaveLength(2);
			expect(records[0]).toMatchObject({
				attemptKind: "connection",
				transport: "websocket",
				outcome: "error",
				failureStage: "connection",
				requestedModel: null,
			});
			expect(records[0].timing.completionBoundary).toBe("connection_rejection");
			expect(records[1].transportTransition).toBe("pre_start_sse_fallback");
			expect(records[0].logicalRequestId).toBe(records[1].logicalRequestId);
			safe(records);
		},
	);

	it.each(["throw", "close", "idle"] as const)("records actual send %s failure before SSE fallback", async (send) => {
		vi.useFakeTimers();
		const records: PerformanceAttemptRecord[] = [];
		const local = fixture({ send });
		const fetch = vi.fn(async () => sse());
		const resultPromise = stream(model, context, {
			apiKey: token,
			transport: "auto",
			timeoutMs: 10,
			performance: recording(records),
			fetch,
		}).result();
		await vi.runAllTimersAsync();
		expect((await resultPromise).stopReason).toBe("stop");
		expect(local.sends).toHaveLength(1);
		expect(fetch).toHaveBeenCalledTimes(1);
		const requests = generations(records);
		expect(requests).toHaveLength(2);
		expect(requests[0]).toMatchObject({
			transport: "websocket",
			outcome: "error",
			failureStage: send === "throw" ? "send" : "transport",
		});
		expect(requests[0].websocket?.sendAccepted).toBe(send !== "throw");
		expect(requests[1]).toMatchObject({
			transport: "http",
			transportTransition: "pre_start_sse_fallback",
			attemptOrdinal: 2,
		});
		expect(requests[1].previousAttemptId).toBe(requests[0].attemptId);
		safe(records);
	});

	it("does not invent connection attempts when WebSocket is unavailable, and tracks session fallback skips", async () => {
		const records: PerformanceAttemptRecord[] = [];
		vi.stubGlobal("WebSocket", undefined);
		const fetch = vi.fn(async () => sse());
		const options = {
			apiKey: token,
			transport: "auto" as const,
			sessionId: "routing",
			performance: recording(records),
			fetch,
		};
		await stream(model, context, options).result();
		await stream(model, context, options).result();
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(records).toHaveLength(2);
		expect(records.map((record) => record.transportTransition)).toEqual([
			"pre_start_sse_fallback",
			"session_sse_fallback",
		]);
	});

	it.each(["close", "idle"] as const)(
		"records post-start %s failure with partial observations and no fallback",
		async (failure) => {
			vi.useFakeTimers();
			const records: PerformanceAttemptRecord[] = [];
			const local = fixture({ replies: [events().slice(0, -1)], closeAfterReplies: failure === "close" });
			const fetch = vi.fn(async () => sse());
			const resultPromise = stream(model, context, {
				apiKey: token,
				transport: "auto",
				timeoutMs: 10,
				performance: recording(records),
				fetch,
			}).result();
			await vi.runAllTimersAsync();
			expect((await resultPromise).stopReason).toBe("error");
			expect(local.sends).toHaveLength(1);
			expect(fetch).not.toHaveBeenCalled();
			const record = generations(records)[0];
			expect(record).toMatchObject({ outcome: "error", failureStage: "transport", transportTransition: null });
			expect(record.timing.firstReasoningOffsetMs).not.toBeNull();
			expect(record.timing.firstVisibleTextOffsetMs).not.toBeNull();
			expect(record.timing.providerTerminalOffsetMs).toBeNull();
			safe(records);
		},
	);

	it("records caller cancellation while connecting without inventing a send or fallback", async () => {
		vi.useFakeTimers();
		const records: PerformanceAttemptRecord[] = [];
		const local = fixture({ connect: "idle" });
		const controller = new AbortController();
		const fetch = vi.fn(async () => sse());
		const resultPromise = stream(model, context, {
			apiKey: token,
			signal: controller.signal,
			performance: recording(records),
			fetch,
		}).result();
		await vi.advanceTimersByTimeAsync(0);
		controller.abort();
		expect((await resultPromise).stopReason).toBe("aborted");
		expect(local.connections()).toBe(1);
		expect(local.sends).toHaveLength(0);
		expect(fetch).not.toHaveBeenCalled();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ attemptKind: "connection", outcome: "aborted", errorCategory: "abort" });
		safe(records);
	});

	it("records post-start caller cancellation without fallback and isolates throwing/rejecting observers", async () => {
		const records: PerformanceAttemptRecord[] = [];
		const local = fixture({ replies: [[events()[0]]] });
		const fetch = vi.fn(async () => sse());
		const controller = new AbortController();
		const result = await stream(model, context, {
			apiKey: token,
			signal: controller.signal,
			transport: "auto",
			performance: {
				...recording(records),
				record: (record) => {
					records.push(record);
					throw new Error("PRIVATE_RECORDER");
				},
			},
			fetch,
			onProviderStreamEvent: () => controller.abort(),
		}).result();
		expect(result.stopReason).toBe("aborted");
		expect(local.sends).toHaveLength(1);
		expect(fetch).not.toHaveBeenCalled();
		expect(generations(records)[0].outcome).toBe("aborted");
		safe(records);
		fixture();
		expect(
			(
				await stream(model, context, {
					apiKey: token,
					performance: {
						record: async () => {
							throw new Error("recorder");
						},
					},
				}).result()
			).stopReason,
		).toBe("stop");
	});

	it.each(["sse", "auto"] as const)(
		"isolates failed %s metadata observation from actual transport calls",
		async (transport) => {
			const records: PerformanceAttemptRecord[] = [];
			const local = fixture();
			const parse = JSON.parse;
			vi.spyOn(JSON, "parse").mockImplementation((value, reviver) => {
				if (typeof value === "string" && value.includes("PRIVATE_PROMPT"))
					throw new Error("metadata observation failed");
				return parse(value, reviver);
			});
			const fetch = vi.fn(async () => sse());
			const result = await stream(model, context, {
				apiKey: token,
				transport,
				performance: recording(records),
				fetch,
			}).result();
			expect(result.stopReason).toBe("stop");
			expect(fetch).toHaveBeenCalledTimes(transport === "sse" ? 1 : 0);
			expect(local.sends).toHaveLength(transport === "sse" ? 0 : 1);
			if (transport === "sse") expect(records[0].requestedModel).toBeNull();
			else expect(generations(records)).toHaveLength(0); // Failed observation never invents a generation record.
			safe(records);
		},
	);

	it("preserves provider hooks, first/last content boundaries and callback/terminal timing", async () => {
		const records: PerformanceAttemptRecord[] = [];
		fixture();
		let callbacks = 0;
		const result = await stream(model, context, {
			apiKey: token,
			performance: recording(records),
			onProviderStreamEvent: async () => {
				callbacks++;
				await new Promise((resolve) => setTimeout(resolve, 3));
			},
		}).result();
		expect(result.stopReason).toBe("stop");
		expect(callbacks).toBe(events().length);
		const record = generations(records)[0];
		expect(record.timing.firstContentOffsetMs).toBe(record.timing.firstReasoningOffsetMs);
		expect(record.timing.lastContentOffsetMs).toBe(record.timing.firstVisibleTextOffsetMs);
		expect(record.timing.completedOffsetMs! - record.timing.providerTerminalOffsetMs!).toBeGreaterThanOrEqual(2);
		expect(new Date(record.timing.startedAtUtc).toISOString()).toBe(record.timing.startedAtUtc);
		safe(records);
	});
});
