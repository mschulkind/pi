import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAssistantMessageEventStream,
	createProvider,
	fauxAssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { type GenerationObservation, getProducerObservationCapability } from "../src/core/producer-observation.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const model: Model<"openai-completions"> = {
	id: "fixture",
	name: "Fixture",
	provider: "fixture",
	api: "openai-completions",
	baseUrl: "https://example.test",
	input: ["text"],
	reasoning: false,
	contextWindow: 10000,
	maxTokens: 100,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
it("detects old SDK without inventing support", () => {
	expect(getProducerObservationCapability({})).toBeNull();
	expect(getProducerObservationCapability(null)).toBeNull();
	expect(
		getProducerObservationCapability({
			get getProducerObservationCapability() {
				throw new Error("unsupported accessor");
			},
		}),
	).toBeNull();
	expect(getProducerObservationCapability({ getProducerObservationCapability: () => ({ version: 2 }) })).toBeNull();
	expect(
		getProducerObservationCapability({
			getProducerObservationCapability: () => {
				throw new Error("old SDK");
			},
		}),
	).toBeNull();
});
it("observes final selected correlation with recorder off and isolates passive callbacks", async () => {
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath: null,
		refreshOnCreate: false,
		performanceDirectory: null,
	});
	const dispatched: unknown[] = [];
	const stream = (_model: Model<string>, _context: unknown, options?: { performanceCorrelation?: unknown }) => {
		dispatched.push(options?.performanceCorrelation);
		const events = createAssistantMessageEventStream();
		queueMicrotask(() => events.push({ type: "done", reason: "stop", message: fauxAssistantMessage("fixture") }));
		return events;
	};
	runtime.registerNativeProvider(
		createProvider({
			id: model.provider,
			models: [model],
			auth: { apiKey: { name: "fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
			api: { stream, streamSimple: stream },
		}),
	);
	const observations: GenerationObservation[] = [];
	const capability = getProducerObservationCapability(runtime)!;
	expect(capability.version).toBe(1);
	capability.subscribe((event) => {
		observations.push(event);
		throw new Error("observer");
	});
	capability.subscribe(async () => {
		throw new Error("async observer");
	});
	const correlation = {
		logicalRequestId: "selected",
		operationId: "parent",
		sessionId: "owning",
		purpose: "assistant" as const,
	};
	await runtime.completeSimple(model, { messages: [] }, { performanceCorrelation: correlation });
	await runtime.completeSimple(model, { messages: [] }, { performanceCorrelation: correlation });
	expect(observations).toHaveLength(2);
	expect(observations[0]).toMatchObject({
		logicalRequestId: "selected",
		sessionId: "owning",
		wireAttemptId: null,
		boundary: "provider_dispatch",
		purpose: "assistant",
	});
	expect(Object.isFrozen(observations[0])).toBe(true);
	expect(observations[0].sdkInvocationId).not.toBe(observations[1].sdkInvocationId);
	expect(dispatched[0]).toMatchObject({
		logicalRequestId: "selected",
		sdkInvocationId: observations[0].sdkInvocationId,
	});
	const auxiliary = capability.createAuxiliaryCorrelation("branch_summary", {
		sessionId: "owning",
		operationId: "parent",
	});
	await runtime.completeSimple(model, { messages: [] }, { performanceCorrelation: auxiliary });
	expect(observations[2].purpose).toBe("branch_summary");
	expect(observations[2].logicalRequestId).not.toBe("selected");
	await runtime.completeSimple(
		model,
		{ messages: [] },
		{ performanceCorrelation: { sessionId: "https://private.test?secret", logicalRequestId: "bad id" } },
	);
	expect(observations[3].sessionId).toBeNull();
	expect(observations[3].logicalRequestId).not.toBe("bad id");
});

it("uses authoritative final IDs across actual SDK retry and later tool generations with recording off", async () => {
	const dir = mkdtempSync(join(tmpdir(), "producer-sdk-"));
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath: null,
		refreshOnCreate: false,
		performanceDirectory: null,
	});
	const observations: GenerationObservation[] = [];
	runtime.getProducerObservationCapability().subscribe((event) => {
		observations.push(event);
	});
	let calls = 0;
	const stream = () => {
		const events = createAssistantMessageEventStream();
		const call = ++calls;
		const response = {
			...fauxAssistantMessage("fixture"),
			api: model.api,
			provider: model.provider,
			model: model.id,
		};
		queueMicrotask(() => {
			if (call === 1)
				events.push({
					type: "error",
					reason: "error",
					error: { ...response, stopReason: "error", errorMessage: "503" },
				});
			else if (call === 2)
				events.push({
					type: "done",
					reason: "toolUse",
					message: {
						...response,
						stopReason: "toolUse",
						content: [{ type: "toolCall", id: "fixture-call", name: "fixture_tool", arguments: {} }],
					},
				});
			else events.push({ type: "done", reason: "stop", message: response });
		});
		return events;
	};
	runtime.registerNativeProvider(
		createProvider({
			id: model.provider,
			models: [model],
			auth: { apiKey: { name: "fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
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
	session.agent.state.tools = [
		{
			name: "fixture_tool",
			label: "Fixture",
			description: "Fixture",
			parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text", text: "fixture" }], details: undefined }),
		},
	];
	try {
		await session.prompt("fixture");
		await session.waitForIdle();
		expect(observations).toHaveLength(3);
		expect(observations[0].logicalRequestId).toBe(observations[1].logicalRequestId);
		expect(observations[1].orchestrationRetry).toBe(1);
		expect(observations[2].logicalRequestId).not.toBe(observations[1].logicalRequestId);
		expect(observations[2].operationId).toBe(observations[0].operationId);
		expect(new Set(observations.map((event) => event.sdkInvocationId)).size).toBe(3);
		expect(observations.every((event) => event.wireAttemptId === null && event.sessionId === session.sessionId)).toBe(
			true,
		);
		await session.prompt("next fixture");
		expect(observations[3].operationId).not.toBe(observations[0].operationId);
	} finally {
		session.dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});
