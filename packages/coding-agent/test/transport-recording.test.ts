import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { resolvePerformanceDirectory } from "../src/core/transport-recording.ts";

it("uses private durable defaults with explicit opt-out and environment precedence", () => {
	expect(resolvePerformanceDirectory(undefined, { YOLO_DURABLE_DIR: "/private" })).toBe("/private/pi-api-performance");
	expect(resolvePerformanceDirectory("/api", { PI_API_PERFORMANCE_DIR: "/env" })).toBe("/env");
	expect(resolvePerformanceDirectory(null, { PI_API_PERFORMANCE_DIR: "/env" })).toBeUndefined();
	expect(resolvePerformanceDirectory("/api", { PI_API_PERFORMANCE: "0" })).toBeUndefined();
	expect(resolvePerformanceDirectory(undefined, { PI_API_PERFORMANCE_DIR: "" })).toBeUndefined();
	expect(resolvePerformanceDirectory("relative", {})).toBeUndefined();
});
it("reports actual capable runtime health instead of environment proof", async () => {
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath: null,
		refreshOnCreate: false,
		performanceDirectory: null,
	});
	expect(runtime.getTransportRecordingStatus()).toMatchObject({
		capabilityVersion: 1,
		enabled: false,
		observedHealth: null,
	});
	expect(runtime.configureTransportRecording({ directory: "/tmp/pi-fixture-unused" })).toMatchObject({
		enabled: true,
		observedHealth: { written: 0 },
	});
	expect(runtime.configureTransportRecording({ directory: null })).toMatchObject({
		enabled: false,
		observedHealth: null,
	});
});

it("activated capable runtime links final dispatch to fresh private actual attempt files", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-activation-"));
	const directory = join(root, "ledger");
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath: null,
		refreshOnCreate: false,
		performanceDirectory: null,
	});
	try {
		const model = runtime.getModels("openrouter").find((model) => model.api === "openai-completions")!;
		expect(model).toBeDefined();
		runtime.configureTransportRecording({ directory });
		let invocation: string | undefined;
		runtime.getProducerObservationCapability().subscribe((event) => {
			invocation = event.sdkInvocationId;
		});
		const chunk = {
			id: "gen-fixture",
			object: "chat.completion.chunk",
			model: model.id,
			choices: [{ index: 0, delta: { content: "fixture" }, finish_reason: "stop" }],
		};
		const response = await runtime.completeSimple(
			model,
			{ messages: [{ role: "user", content: "fixture", timestamp: 0 }] },
			{
				apiKey: "fixture",
				performanceCorrelation: { logicalRequestId: "authoritative", sessionId: "owning", purpose: "assistant" },
				onPayload: (payload) => ({
					...(payload as object),
					reasoning: { effort: "high" },
					max_completion_tokens: 123,
				}),
				fetch: async () =>
					new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
						headers: { "content-type": "text/event-stream" },
					}),
			},
		);
		expect(response.responseId).toBe("gen-fixture");
		await runtime.flushPerformanceRecords();
		expect(runtime.getTransportRecordingStatus().observedHealth).toMatchObject({ written: 1, writeFailures: 0 });
		const files = readdirSync(directory);
		expect(files).toHaveLength(1);
		const record = JSON.parse(readFileSync(join(directory, files[0]), "utf8"));
		expect(record).toMatchObject({
			recordKind: "api_attempt",
			sdkInvocationId: invocation,
			logicalRequestId: "authoritative",
			responseHandle: "gen-fixture",
			attemptKind: "generation",
			effectiveSettings: { reasoningEffort: "high", outputLimitTokens: 123 },
		});
		expect(record.attemptId).not.toBe(invocation);
		if (process.platform !== "win32") {
			expect(statSync(directory).mode & 0o777).toBe(0o700);
			expect(statSync(join(directory, files[0])).mode & 0o777).toBe(0o600);
		}
	} finally {
		runtime.configureTransportRecording({ directory: null });
		rmSync(root, { recursive: true, force: true });
	}
});
