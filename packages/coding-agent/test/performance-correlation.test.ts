import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
	normalizeContext,
	type PerformanceCorrelation,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { generateBugReportSummary } from "../src/core/bug-report.ts";
import { generateBranchSummary } from "../src/core/compaction/branch-summarization.ts";
import { completeSummarization } from "../src/core/compaction/compaction.ts";
import { PerformanceCorrelationState } from "../src/core/performance-correlation.ts";

const model: Model<"openai-completions"> = {
	id: "test",
	name: "Test",
	provider: "openai",
	api: "openai-completions",
	baseUrl: "https://example.test",
	reasoning: false,
	input: ["text"],
	contextWindow: 100000,
	maxTokens: 4096,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const user = { role: "user" as const, content: "private", timestamp: 0 };
describe("local request correlation", () => {
	it("keeps agent retry and overflow recovery on the same request but gives later tool turns new ids", () => {
		const state = new PerformanceCorrelationState();
		expect(state.correlation.purpose).toBe("unknown");
		state.observe({ type: "turn_start" });
		state.observe({ type: "message_start", message: user });
		const first = state.correlation;
		state.observe({ type: "message_start", message: { role: "assistant" } });
		state.observe({ type: "auto_retry_start" });
		state.observe({ type: "turn_start" });
		expect(state.correlation).toMatchObject({ ...first, orchestrationRetry: expect.any(Number) });
		state.observe({ type: "auto_compaction_start", reason: "overflow" });
		state.observe({ type: "turn_start" });
		expect(state.correlation).toMatchObject({ ...first, orchestrationRetry: expect.any(Number) });
		state.observe({ type: "turn_start" });
		expect(state.correlation.logicalRequestId).not.toBe(first.logicalRequestId);
		expect(state.correlation.operationId).toBe(first.operationId);
		state.observe({ type: "message_start", message: user });
		expect(state.correlation.operationId).not.toBe(first.operationId);
	});
	it("keeps summary retries on one logical id and distinguishes compaction, branch, and bug-report purposes", async () => {
		const correlations: (PerformanceCorrelation | undefined)[] = [];
		let calls = 0;
		const streamFn: StreamFn = (_model, _context, options) => {
			correlations.push(options?.performanceCorrelation);
			const events = createAssistantMessageEventStream();
			const response = {
				...fauxAssistantMessage("summary"),
				api: model.api,
				provider: model.provider,
				model: model.id,
			};
			queueMicrotask(() => {
				if (++calls === 1)
					events.push({
						type: "error",
						reason: "error",
						error: { ...response, stopReason: "error", errorMessage: "503" },
					});
				else events.push({ type: "done", reason: "stop", message: response });
			});
			return events;
		};
		await completeSummarization(
			model,
			normalizeContext({ messages: [] }),
			{ performanceCorrelation: { operationId: "parent", sessionId: "owning-session" } },
			streamFn,
			{ enabled: true, maxRetries: 1, baseDelayMs: 0 },
		);
		expect(correlations).toHaveLength(2);
		expect(correlations[0]).toEqual(correlations[1]);
		expect(correlations[0]).toMatchObject({
			operationId: "parent",
			sessionId: "owning-session",
			purpose: "compaction",
			logicalRequestId: expect.any(String),
		});
		await generateBranchSummary(
			[{ type: "message", id: "user", parentId: null, timestamp: new Date(0).toISOString(), message: user }],
			{ model, signal: new AbortController().signal, streamFn },
		);
		expect(correlations.at(-1)?.purpose).toBe("branch_summary");
		await generateBugReportSummary({ model, messages: [user], signal: new AbortController().signal, streamFn });
		expect(correlations.at(-1)?.purpose).toBe("bug_report_summary");
		expect(new Set(correlations.map((correlation) => correlation?.logicalRequestId)).size).toBe(3);
	});
});
