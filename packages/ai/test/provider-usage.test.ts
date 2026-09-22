import { describe, expect, it, vi } from "vitest";
import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Model, Usage } from "../src/types.ts";

const mockState = vi.hoisted(() => ({
	usage: undefined as Record<string, unknown> | undefined,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield { choices: [{ delta: {}, finish_reason: "stop" }], usage: mockState.usage };
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

function createModel(): Model<"openai-completions"> {
	const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
	return {
		...(baseModel as Omit<Model<"openai-completions">, "api">),
		api: "openai-completions",
	};
}

async function captureUsage(rawUsage: Record<string, unknown>): Promise<Usage> {
	mockState.usage = rawUsage;
	const result = await streamOpenAICompletions(
		createModel(),
		normalizeContext({
			systemPrompt: "sys",
			messages: [{ role: "user", content: "hi", timestamp: Date.now() }],
		}),
		{ apiKey: "test-key" },
	).result();
	return result.usage;
}

describe("Usage.provider capture", () => {
	it("carries the provider's cached split verbatim without changing the normalized fields", async () => {
		const usage = await captureUsage({
			prompt_tokens: 500,
			completion_tokens: 20,
			total_tokens: 570,
			prompt_tokens_details: { cached_tokens: 400, cache_write_tokens: 50 },
			completion_tokens_details: { reasoning_tokens: 3 },
		});

		expect(usage.input).toBe(50);
		expect(usage.output).toBe(20);
		expect(usage.cacheRead).toBe(400);
		expect(usage.cacheWrite).toBe(50);
		expect(usage.reasoning).toBe(3);
		expect(usage.totalTokens).toBe(520);

		expect(usage.provider?.cachedTokens).toBe(400);
		expect(usage.provider?.cacheWriteTokens).toBe(50);
		expect(usage.provider?.raw).toMatchObject({ prompt_tokens: 500, completion_tokens: 20, total_tokens: 570 });
	});

	it("omits a cached-split key the provider did not report rather than writing zero", async () => {
		const usage = await captureUsage({ prompt_tokens: 500, completion_tokens: 20, total_tokens: 520 });

		// The normalized view still reports zero, as before.
		expect(usage.cacheRead).toBe(0);
		expect(usage.cacheWrite).toBe(0);

		expect(usage.provider).toBeDefined();
		expect("cachedTokens" in (usage.provider ?? {})).toBe(false);
		expect("cacheWriteTokens" in (usage.provider ?? {})).toBe(false);
		expect(usage.provider?.cachedTokens).toBeUndefined();
	});

	it("keeps a provider-reported zero distinct from an absent key", async () => {
		const usage = await captureUsage({
			prompt_tokens: 500,
			completion_tokens: 20,
			total_tokens: 520,
			prompt_tokens_details: { cached_tokens: 0 },
		});

		expect(usage.cacheRead).toBe(0);
		expect(usage.provider?.cachedTokens).toBe(0);
		expect("cachedTokens" in (usage.provider ?? {})).toBe(true);
		expect("cacheWriteTokens" in (usage.provider ?? {})).toBe(false);
	});
});
