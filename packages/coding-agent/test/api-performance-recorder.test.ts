import { mkdtemp, readdir, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider, type Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPerformanceRequest } from "../../ai/src/api/performance.ts";
import type { StreamOptions } from "../../ai/src/types.ts";
import { AssistantMessageEventStream } from "../../ai/src/utils/event-stream.ts";
import { hasPerformanceTransportCoverage, LocalPerformanceRecorder } from "../src/core/api-performance-recorder.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const directories: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function directory(): Promise<string> {
	const value = await mkdtemp(join(tmpdir(), "pi-performance-test-"));
	directories.push(value);
	return value;
}
async function failedAttempt(recorder: LocalPerformanceRecorder): Promise<void> {
	const options = createPerformanceRequest<StreamOptions>(
		{
			id: "model",
			name: "Test",
			api: "openai-completions",
			provider: "openai",
			baseUrl: "https://example.test",
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		},
		{
			performance: { record: recorder.record },
			fetch: async () => {
				throw new Error("SECRET");
			},
		},
		new AssistantMessageEventStream(),
	);
	await options!.fetch!("https://user:SECRET@example.test/private?secret=SECRET", {
		headers: { authorization: "SECRET" },
	}).catch(() => {});
}

describe("local performance persistence", () => {
	it("recognizes instrumented Codex streaming while leaving deferred and other routes unsupported", () => {
		expect(hasPerformanceTransportCoverage("openai-codex-responses")).toBe(true);
		for (const api of ["bedrock-converse-stream", "anthropic-messages", "google-generative-ai", "deferred_operation"])
			expect(hasPerformanceTransportCoverage(api)).toBe(false);
	});
	it.each(["sse", "websocket"] as const)(
		"persists actual Codex %s records through ModelRuntime without a coverage gap",
		async (transport) => {
			const dir = await directory();
			let sends = 0;
			let connections = 0;
			class Socket extends EventTarget {
				constructor() {
					super();
					connections++;
					queueMicrotask(() => this.dispatchEvent(new Event("open")));
				}
				send() {
					sends++;
					queueMicrotask(() =>
						this.dispatchEvent(
							Object.assign(new Event("message"), {
								data: '{"type":"response.done","response":{"status":"completed","output":[]}}',
							}),
						),
					);
				}
				close() {}
			}
			vi.stubGlobal("WebSocket", Socket);
			try {
				const apiKey = `aaa.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "SECRET" } })).toString("base64")}.bbb`;
				const runtime = await ModelRuntime.create({
					credentials: AuthStorage.inMemory({
						"openai-codex": {
							type: "oauth",
							access: apiKey,
							refresh: "local-only",
							expires: Date.now() + 3600000,
						},
					}),
					modelsPath: null,
					refreshOnCreate: false,
					performanceDirectory: join(dir, "ledger"),
				});
				const catalogModel = runtime.getModel("openai-codex", "gpt-5.5")!;
				expect(catalogModel).toBeDefined();
				const model = { ...catalogModel, baseUrl: "https://codex.test" };
				let fetches = 0;
				const result = await runtime
					.streamSimple(
						model,
						{ messages: [{ role: "user", content: "SECRET PROMPT", timestamp: 0 }] },
						{
							apiKey,
							transport,
							performanceCorrelation: {
								sessionId: "owner",
								operationId: "parent",
								purpose: "assistant",
								logicalRequestId: `runtime-codex-${transport}`,
							},
							fetch: async () => {
								fetches++;
								return new Response(
									'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
									{ headers: { "content-type": "text/event-stream" } },
								);
							},
						},
					)
					.result();
				expect(result.stopReason, result.errorMessage).toBe("stop");
				expect(fetches).toBe(transport === "sse" ? 1 : 0);
				expect(sends).toBe(transport === "sse" ? 0 : 1);
				expect(connections).toBe(transport === "sse" ? 0 : 1);
				await runtime.flushPerformanceRecords();
				expect(runtime.getPerformanceRecordingHealth()).toMatchObject({
					written: transport === "sse" ? 1 : 2,
					unsupported: {},
					missingCorrelation: 0,
				});
				const files = await readdir(join(dir, "ledger"));
				const text = await readFile(join(dir, "ledger", files[0]), "utf8");
				const records = text
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line));
				expect(records.map((record) => record.attemptKind)).toEqual(
					transport === "sse" ? ["generation"] : ["connection", "generation"],
				);
				expect(records.every((record) => record.sessionId === "owner" && record.operationId === "parent")).toBe(
					true,
				);
				expect(text).not.toContain("SECRET");
			} finally {
				vi.unstubAllGlobals();
			}
		},
	);

	it("opts in at ModelRuntime without reading phone-home consent and exposes unsupported requests", async () => {
		const dir = await directory();
		vi.stubEnv("PI_API_PERFORMANCE_DIR", join(dir, "ledger"));
		vi.stubEnv("PI_TELEMETRY", "0");
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsPath: null,
			refreshOnCreate: false,
		});
		const model = runtime.getModel("openai", "gpt-4o")!;
		const result = await runtime
			.streamSimple(
				model,
				{ messages: [] },
				{ apiKey: "test", fetch: async () => new Response("secret", { status: 400 }) },
			)
			.result();
		expect(result.stopReason).toBe("error");
		await runtime.flushPerformanceRecords();
		expect(runtime.getPerformanceRecordingHealth()).toMatchObject({ written: 1, missingCorrelation: 1 });
		const unsupportedModel: Model<"bedrock-converse-stream"> = {
			...model,
			provider: "local-test",
			api: "bedrock-converse-stream",
			compat: undefined,
		};
		const localStream = () => {
			const events = new AssistantMessageEventStream();
			queueMicrotask(() => events.push({ type: "error", reason: "error", error: result }));
			return events;
		};
		runtime.registerNativeProvider(
			createProvider({
				id: "local-test",
				models: [unsupportedModel],
				auth: { apiKey: { name: "Local", resolve: async () => ({ auth: {} }) } },
				api: { stream: localStream, streamSimple: localStream },
			}),
		);
		await runtime.streamSimple(unsupportedModel, { messages: [] }, { apiKey: "test" }).result();
		expect(runtime.getPerformanceRecordingHealth()?.unsupported).toEqual({ "bedrock-converse-stream": 1 });
		const disabled = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsPath: null,
			refreshOnCreate: false,
			performanceDirectory: null,
		});
		expect(disabled.getPerformanceRecordingHealth()).toBeUndefined();
	});

	it("persists a deferred-operation gap instead of claiming the streaming API covers cancellation", async () => {
		const dir = await directory();
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsPath: null,
			refreshOnCreate: false,
			performanceDirectory: join(dir, "ledger"),
		});
		const model: Model<"openai-responses"> = {
			...runtime.getModel("openai", "gpt-4o")!,
			provider: "deferred-local",
			api: "openai-responses",
			compat: undefined,
		};
		let cancelled = false;
		const stream = () => new AssistantMessageEventStream();
		runtime.registerNativeProvider(
			createProvider({
				id: model.provider,
				models: [model],
				auth: { apiKey: { name: "Local", resolve: async () => ({ auth: {} }) } },
				api: {
					stream,
					streamSimple: stream,
					cancelDeferred: async () => {
						cancelled = true;
					},
				},
			}),
		);
		await runtime.cancelDeferred(
			model,
			{ provider: model.provider, modelId: model.id, api: model.api, id: "SECRET HANDLE" },
			{ apiKey: "test", performanceCorrelation: { sessionId: "owner", operationId: "parent" } },
		);
		expect(cancelled).toBe(true);
		await runtime.flushPerformanceRecords();
		const files = await readdir(join(dir, "ledger"));
		expect(files).toHaveLength(1);
		const text = await readFile(join(dir, "ledger", files[0]), "utf8");
		expect(JSON.parse(text)).toMatchObject({
			recordKind: "coverage_gap",
			api: "deferred_operation",
			reason: "operation_not_instrumented",
			purpose: "auxiliary",
			sessionId: "owner",
			operationId: "parent",
			actualApiHostname: null,
		});
		expect(text).not.toContain("SECRET");
	});
	it("writes private local records even when phone-home telemetry is disabled", async () => {
		const dir = await directory();
		const recorder = new LocalPerformanceRecorder(join(dir, "ledger"));
		await failedAttempt(recorder);
		await recorder.flush();
		const files = await readdir(join(dir, "ledger"));
		expect(files).toHaveLength(1);
		expect((await stat(join(dir, "ledger"))).mode & 0o777).toBe(0o700);
		expect((await stat(join(dir, "ledger", files[0]))).mode & 0o777).toBe(0o600);
		const text = await readFile(join(dir, "ledger", files[0]), "utf8");
		expect(text).not.toContain("SECRET");
		expect(JSON.parse(text).outcome).toBe("error");
		expect(recorder.health).toMatchObject({ written: 1, writeFailures: 0, missingCorrelation: 1 });
	});
	it("bounds the queue and rejects symlink directories without affecting model calls", async () => {
		const dir = await directory();
		await symlink(dir, join(dir, "link"));
		const recorder = new LocalPerformanceRecorder(join(dir, "link"), { maxQueued: 1 });
		await failedAttempt(recorder);
		await failedAttempt(recorder);
		await recorder.flush();
		expect(recorder.health.written).toBe(0);
		expect(recorder.health.writeFailures + recorder.health.dropped).toBe(2);
	});
	it("rotates bounded per-process files and reports unsupported routes", async () => {
		const dir = await directory();
		const recorder = new LocalPerformanceRecorder(join(dir, "ledger"), { maxFileBytes: 1, retainedFiles: 2 });
		for (let i = 0; i < 4; i++) {
			await failedAttempt(recorder);
			await recorder.flush();
		}
		expect(await readdir(join(dir, "ledger"))).toHaveLength(2);
		recorder.noteUnsupported("bedrock-converse-stream");
		expect(recorder.health.unsupported).toEqual({ "bedrock-converse-stream": 1 });
	});
});
