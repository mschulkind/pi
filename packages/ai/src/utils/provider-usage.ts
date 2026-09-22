import type { JsonValue, ProviderUsage } from "../types.ts";

/**
 * Builds a `Usage.provider` object, copying a field only when the provider
 * actually reported it. An absent key and a reported zero are different facts,
 * so nothing is defaulted here: `undefined` and `null` both mean "not
 * reported" and are dropped.
 */
export function providerUsage(reported: {
	cachedTokens?: number | null;
	cacheWriteTokens?: number | null;
	raw?: unknown;
}): ProviderUsage {
	const provider: ProviderUsage = {};
	if (reported.cachedTokens !== undefined && reported.cachedTokens !== null) {
		provider.cachedTokens = reported.cachedTokens;
	}
	if (reported.cacheWriteTokens !== undefined && reported.cacheWriteTokens !== null) {
		provider.cacheWriteTokens = reported.cacheWriteTokens;
	}
	if (reported.raw !== undefined) {
		provider.raw = reported.raw as JsonValue;
	}
	return provider;
}
