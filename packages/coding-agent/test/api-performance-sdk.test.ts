import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAssistantMessageEventStream,
	createProvider,
	fauxAssistantMessage,
	type Model,
	type PerformanceRecordingOptions,
	type ProviderStreams,
} from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

it("propagates stable retry identity and new user-operation identity through actual SDK session events", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-performance-sdk-"));
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath: null,
		refreshOnCreate: false,
		performanceDirectory: join(dir, "ledger"),
	});
	const model: Model<"openai-completions"> = {
		id: "local",
		name: "Local",
		provider: "performance-local",
		api: "openai-completions",
		baseUrl: "https://example.test",
		input: ["text"],
		reasoning: false,
		contextWindow: 100000,
		maxTokens: 4096,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	const captured: PerformanceRecordingOptions[] = [];
	const stream: ProviderStreams["streamSimple"] = (_model, _context, options) => {
		if (options?.performance) captured.push(options.performance);
		const events = createAssistantMessageEventStream();
		const response = {
			...fauxAssistantMessage("response"),
			api: model.api,
			provider: model.provider,
			model: model.id,
		};
		queueMicrotask(() => {
			if (captured.length === 1)
				events.push({
					type: "error",
					reason: "error",
					error: { ...response, stopReason: "error", errorMessage: "503" },
				});
			else events.push({ type: "done", reason: "stop", message: response });
		});
		return events;
	};
	runtime.registerNativeProvider(
		createProvider({
			id: model.provider,
			models: [model],
			auth: { apiKey: { name: "Local", resolve: async () => ({ auth: { apiKey: "test" } }) } },
			api: { stream, streamSimple: stream },
		}),
	);
	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: join(dir, "agent"),
		model,
		modelRuntime: runtime,
		sessionManager: SessionManager.inMemory(dir),
		settingsManager: SettingsManager.inMemory({
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
			compaction: { enabled: false },
			cacheWarming: "off",
		}),
	});
	try {
		const retried = new Promise<void>((resolve) =>
			session.subscribe((event) => {
				if (event.type === "auto_retry_end") resolve();
			}),
		);
		await session.prompt("private first request");
		await retried;
		expect(captured).toHaveLength(2);
		expect(captured[0].logicalRequestId).toBe(captured[1].logicalRequestId);
		expect(captured[0].operationId).toBe(captured[1].operationId);
		expect(captured[0].purpose).toBe("assistant");
		await session.prompt("private second request");
		expect(captured).toHaveLength(3);
		expect(captured[2].logicalRequestId).not.toBe(captured[0].logicalRequestId);
		expect(captured[2].operationId).not.toBe(captured[0].operationId);
		await runtime.flushPerformanceRecords();
		const files = await readdir(join(dir, "ledger"));
		const records = (await readFile(join(dir, "ledger", files[0]), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(records).toHaveLength(3);
		expect(
			records.every(
				(record) =>
					record.recordKind === "coverage_gap" &&
					record.sessionId === session.sessionId &&
					record.purpose === "assistant",
			),
		).toBe(true);
	} finally {
		session.dispose();
		await runtime.flushPerformanceRecords();
		await rm(dir, { recursive: true, force: true });
	}
});
