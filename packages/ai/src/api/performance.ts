import { createTypedSpanStarter, defineTelemetrySchema, InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import type { AssistantMessageEvent, BaseModel, StreamOptions } from "../types.ts";
import type { AssistantMessageEventStream } from "../utils/event-stream.ts";

/** This span describes recording a terminal observation, NOT the API attempt's duration. */
export const apiPerformanceTelemetrySchema = defineTelemetrySchema({
	version: 1,
	spans: {
		"ai.api_attempt_record": {
			description:
				"Local terminal attempt observation; actual duration is the client-observed durationMs attribute.",
			parents: { kind: "any" },
			startAttributes: {
				attemptId: { type: "string", required: true, description: "Local transport invocation identity." },
				logicalRequestId: {
					type: "string",
					required: true,
					description: "Intended operation identity, shared across retries.",
				},
				provider: { type: "string", required: true, description: "Selected provider." },
				api: { type: "string", required: true, description: "Selected API." },
				outcome: {
					type: "string",
					required: true,
					values: ["success", "error", "aborted", "unknown"],
					description: "Observed terminal outcome.",
				},
				recordJson: {
					type: "string",
					required: true,
					description: "Privacy-allowlisted local record JSON; never supplied to an external context.",
				},
				durationMs: {
					type: "number",
					required: false,
					description:
						"Client monotonic duration from transport invocation to terminal observation, milliseconds.",
				},
			},
			endAttributes: {},
			status: {
				default: "ok",
				errorWhen: "Local observation failed; provider failures are outcome attributes, not recorder errors.",
			},
		},
	},
});

/** One intended model operation; retries share this identity. Never sent to a provider. */
export interface PerformanceRecordingOptions {
	record: (record: PerformanceAttemptRecord) => void | Promise<void>;
	sessionId?: string;
	operationId?: string;
	logicalRequestId?: string;
	purpose?:
		| "assistant"
		| "compaction"
		| "branch_summary"
		| "bug_report_summary"
		| "cache_warm"
		| "auxiliary"
		| "unknown";
}

export type PerformanceCorrelation = Omit<PerformanceRecordingOptions, "record">;

export interface PerformanceAttemptRecord {
	schemaVersion: 1;
	recordKind: "api_attempt";
	processRunId: string;
	sessionId: string | null;
	operationId: string | null;
	logicalRequestId: string;
	attemptId: string;
	previousAttemptId: string | null;
	attemptOrdinal: number | null;
	purpose: NonNullable<PerformanceRecordingOptions["purpose"]>;
	provider: string;
	api: string;
	transport: "http" | "websocket";
	streamProtocol: "sse" | "ndjson" | "websocket_events" | "unknown";
	attemptKind: "generation" | "connection";
	/** Socket lifetime identity, not an auth/account/session identifier. Null for HTTP. */
	websocket: { connectionId: string; reused: boolean; sendAccepted: boolean | null } | null;
	transportTransition: "pre_start_sse_fallback" | "session_sse_fallback" | null;
	actualApiHostname: string | null;
	selectedModel: string | null;
	requestedModel: string | null;
	returnedModel: string | null;
	/** Readable provider reasoning, not encrypted replay data or synthetic placeholders. */
	reasoningContentKind: "full" | "summary" | "mixed" | "unknown";
	timing: {
		startedAtUtc: string;
		startedAtMonotonicMs: number;
		firstContentOffsetMs: number | null;
		lastContentOffsetMs: number | null;
		firstReasoningOffsetMs: number | null;
		firstVisibleTextOffsetMs: number | null;
		headersOffsetMs: number | null;
		providerTerminalOffsetMs: number | null;
		completedOffsetMs: number | null;
		observationClosedOffsetMs: number | null;
		completionBoundary:
			| "adapter_terminal"
			| "http_error_headers"
			| "transport_rejection"
			| "connection_open"
			| "connection_rejection"
			| "send_rejection"
			| "unknown";
		observationPoint: "adapter_parsed_event" | "socket_lifecycle";
	};
	effectiveSettings: {
		reasoningMode: string | null;
		reasoningEffort: string | null;
		reasoningBudgetTokens: number | null;
		reasoningDisplay: string | null;
		outputLimitTokens: number | null;
		streaming: boolean | null;
		/** Codex serialized settings only; absent on other APIs. */
		temperature?: number | null;
		serviceTier?: "auto" | "default" | "flex" | "priority" | "scale" | null;
		textVerbosity?: "low" | "medium" | "high" | null;
		toolChoice?: "auto" | "none" | "required" | null;
		parallelToolCalls?: boolean | null;
	};
	usage: {
		rawReports: Record<string, unknown>[];
		rawReportSources: ("direct_provider" | "gateway_preserved_provider" | "gateway_provider_cache_split")[];
		gatewayCounts: {
			input: number | null;
			output: number | null;
			cacheRead: number | null;
			cacheWrite: number | null;
			reasoning: number | null;
			total: number | null;
		} | null;
		providerInput: number | null;
		providerInputCountConvention: "includes_cache" | "excludes_cache" | "unknown";
		inputCountConvention: "includes_cache" | "excludes_cache" | "unknown";
		rawCoverage: "complete" | "partial" | "unavailable";
		input: number | null;
		output: number | null;
		cacheRead: number | null;
		cacheWrite: number | null;
		cacheWrite1h: number | null;
		reasoning: number | null;
		total: number | null;
		totalSource: "provider" | "unknown";
	};
	providerMetrics: Record<string, number>;
	outcome: "success" | "error" | "aborted" | "unknown";
	failureStage: "transport" | "http_status" | "generation" | "superseded" | "connection" | "send" | null;
	httpStatus: number | null;
	errorCategory: "transport_error" | "http_error" | "generation_error" | "abort" | "internal_cancellation" | null;
	retryCause: "previous_attempt_failed" | null;
	coverage: {
		attempts: "transport_invocations";
		correlation: "complete" | "partial" | "missing_session";
		limitations: string[];
	};
}

/** Detached local snapshot using the existing telemetry backend, never a supplied exporter. */
export function createLocalPerformanceSnapshot(record: PerformanceAttemptRecord): string | null {
	const context = new InMemoryTelemetryContext();
	const start = createTypedSpanStarter(context, [apiPerformanceTelemetrySchema]);
	void start(
		"ai.api_attempt_record",
		{
			attemptId: record.attemptId,
			logicalRequestId: record.logicalRequestId,
			provider: record.provider,
			api: record.api,
			outcome: record.outcome,
			...(record.timing.observationClosedOffsetMs !== null
				? { durationMs: record.timing.observationClosedOffsetMs }
				: {}),
			recordJson: JSON.stringify(record),
		},
		() => {},
	).catch(() => {});
	const json = context.getSpans()[0]?.attributes.recordJson;
	return typeof json === "string" ? json : null;
}

export const performanceProcessRunId = globalThis.crypto.randomUUID();
const counters = new Map<string, { ordinal: number | null; previous: string | null; failed: boolean }>();
let correlationHistoryTruncated = false;
const MAX_CORRELATIONS = 1024;
const MAX_USAGE_REPORTS = 64;

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function number(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function identifier(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= 256 && /^[a-zA-Z0-9_./:-]+$/.test(value)
		? value
		: null;
}
function knownSetting(value: unknown, values: readonly string[]): string | null {
	return typeof value === "string" && values.includes(value) ? value : null;
}
function nonempty(value: unknown): boolean {
	return typeof value === "string" && value.length > 0;
}

// Closed numeric usage vocabulary: no arbitrary strings, JSON, metadata or error bodies.
const numericUsageKeys = new Set([
	"prompt_tokens",
	"completion_tokens",
	"total_tokens",
	"input_tokens",
	"output_tokens",
	"cached_tokens",
	"cache_write_tokens",
	"prompt_cache_hit_tokens",
	"prompt_cache_miss_tokens",
	"reasoning_tokens",
	"cache_read_input_tokens",
	"cache_creation_input_tokens",
	"ephemeral_5m_input_tokens",
	"ephemeral_1h_input_tokens",
	"audio_tokens",
	"accepted_prediction_tokens",
	"rejected_prediction_tokens",
	"text_tokens",
	"image_tokens",
]);
const nestedUsageKeys = new Set([
	"prompt_tokens_details",
	"completion_tokens_details",
	"input_tokens_details",
	"output_tokens_details",
	"cache_creation",
]);
function safeUsage(value: unknown, depth = 0): { report: Record<string, unknown>; partial: boolean } {
	const report: Record<string, unknown> = {};
	if (depth > 2 || value === null || typeof value !== "object" || Array.isArray(value))
		return { report, partial: true };
	let partial = false;
	for (const [key, entry] of Object.entries(object(value))) {
		if (numericUsageKeys.has(key) && number(entry) !== null && Number.isInteger(entry)) report[key] = entry;
		else if (nestedUsageKeys.has(key)) {
			const nested = safeUsage(entry, depth + 1);
			report[key] = nested.report;
			partial ||= nested.partial;
		} else partial = true;
	}
	return { report, partial };
}

function settings(payload: unknown, codex = false): PerformanceAttemptRecord["effectiveSettings"] {
	const p = object(payload);
	const reasoning = object(p.reasoning);
	const thinking = object(p.thinking);
	const config = object(p.output_config);
	const template = object(p.chat_template_kwargs ?? p.chat_template_args);
	const pi = object(p.options);
	const mode =
		knownSetting(thinking.type ?? p.thinking, ["enabled", "disabled", "adaptive", "auto", "on", "off"]) ??
		(typeof (p.enable_thinking ?? template.enable_thinking ?? reasoning.enabled) === "boolean"
			? (p.enable_thinking ?? template.enable_thinking ?? reasoning.enabled)
				? "enabled"
				: "disabled"
			: null);
	return {
		reasoningMode: mode,
		reasoningEffort: knownSetting(p.reasoning_effort ?? reasoning.effort ?? config.effort ?? pi.reasoning, [
			"none",
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]),
		reasoningBudgetTokens: number(
			thinking.budget_tokens ?? p.thinking_token_budget ?? p.thinking_budget ?? p.thinking_budget_tokens,
		),
		reasoningDisplay: knownSetting(reasoning.summary ?? thinking.display, [
			"auto",
			"concise",
			"detailed",
			"none",
			"summarized",
			"omitted",
			...(codex ? ["off", "on"] : []),
		]),
		outputLimitTokens: number(p.max_completion_tokens ?? p.max_output_tokens ?? p.max_tokens ?? pi.maxTokens),
		streaming: typeof p.stream === "boolean" ? p.stream : null,
		...(codex
			? {
					temperature:
						typeof p.temperature === "number" &&
						Number.isFinite(p.temperature) &&
						p.temperature >= 0 &&
						p.temperature <= 2
							? p.temperature
							: null,
					serviceTier: knownSetting(p.service_tier, [
						"auto",
						"default",
						"flex",
						"priority",
						"scale",
					]) as PerformanceAttemptRecord["effectiveSettings"]["serviceTier"],
					toolChoice: knownSetting(p.tool_choice, [
						"auto",
						"none",
						"required",
					]) as PerformanceAttemptRecord["effectiveSettings"]["toolChoice"],
					parallelToolCalls: typeof p.parallel_tool_calls === "boolean" ? p.parallel_tool_calls : null,
					textVerbosity: knownSetting(object(p.text).verbosity, [
						"low",
						"medium",
						"high",
					]) as PerformanceAttemptRecord["effectiveSettings"]["textVerbosity"],
				}
			: {}),
	};
}

class Attempt {
	readonly record: PerformanceAttemptRecord;
	private finished = false;
	private readonly contentLengths = new Map<string, number>();
	constructor(
		model: BaseModel<string>,
		options: PerformanceRecordingOptions,
		hostname: string | null,
		payload: unknown,
		freshLogicalRequest: boolean,
		kind: PerformanceAttemptRecord["attemptKind"] = "generation",
	) {
		const logicalRequestId = identifier(options.logicalRequestId) ?? globalThis.crypto.randomUUID();
		const previous = counters.get(logicalRequestId) ?? {
			ordinal: correlationHistoryTruncated && !freshLogicalRequest ? null : 0,
			previous: null,
			failed: false,
		};
		const ordinal = kind === "connection" || previous.ordinal === null ? null : previous.ordinal + 1;
		const attemptId = globalThis.crypto.randomUUID();
		if (kind === "generation") {
			counters.delete(logicalRequestId);
			counters.set(logicalRequestId, { ordinal, previous: attemptId, failed: false });
			if (counters.size > MAX_CORRELATIONS) {
				counters.delete(counters.keys().next().value!);
				correlationHistoryTruncated = true;
			}
		}
		this.record = {
			schemaVersion: 1,
			recordKind: "api_attempt",
			processRunId: performanceProcessRunId,
			sessionId: identifier(options.sessionId),
			operationId: identifier(options.operationId),
			logicalRequestId,
			attemptId,
			previousAttemptId: kind === "connection" ? null : previous.previous,
			attemptOrdinal: ordinal,
			purpose: options.purpose ?? "unknown",
			provider: identifier(model.provider) ?? "unknown",
			api: identifier(model.api) ?? "unknown",
			transport: "http",
			streamProtocol: "unknown",
			attemptKind: kind,
			websocket: null,
			transportTransition: null,
			actualApiHostname: hostname,
			selectedModel: kind === "connection" ? null : identifier(model.id),
			requestedModel: identifier(object(payload).model),
			returnedModel: null,
			reasoningContentKind: "unknown",
			timing: {
				startedAtUtc: new Date().toISOString(),
				startedAtMonotonicMs: performance.now(),
				firstContentOffsetMs: null,
				lastContentOffsetMs: null,
				firstReasoningOffsetMs: null,
				firstVisibleTextOffsetMs: null,
				headersOffsetMs: null,
				providerTerminalOffsetMs: null,
				completedOffsetMs: null,
				observationClosedOffsetMs: null,
				completionBoundary: "unknown",
				observationPoint: "adapter_parsed_event",
			},
			effectiveSettings: settings(payload, kind === "generation" && model.api === "openai-codex-responses"),
			usage: {
				rawReports: [],
				rawReportSources: [],
				gatewayCounts: null,
				providerInput: null,
				providerInputCountConvention: "unknown",
				inputCountConvention: "excludes_cache",
				rawCoverage: "unavailable",
				input: null,
				output: null,
				cacheRead: null,
				cacheWrite: null,
				cacheWrite1h: null,
				reasoning: null,
				total: null,
				totalSource: "unknown",
			},
			providerMetrics: {},
			outcome: "unknown",
			failureStage: null,
			httpStatus: null,
			errorCategory: null,
			retryCause: kind === "generation" && previous.failed ? "previous_attempt_failed" : null,
			coverage: {
				attempts: "transport_invocations",
				correlation: !identifier(options.sessionId)
					? "missing_session"
					: identifier(options.operationId) && options.purpose && options.purpose !== "unknown"
						? "complete"
						: "partial",
				limitations: [
					"redirects_and_hidden_proxy_replays_not_observed",
					"injected_fetch_internal_routing_not_observed",
					"effective_settings_common_serialized_fields_only",
					model.api === "openai-codex-responses"
						? "parsed_events_after_sse_buffering"
						: "parsed_events_after_sdk_buffering",
					"agent_retry_correlation_requires_explicit_identity",
					"ordinal_history_bounded_to_1024_logical_requests",
					"same_length_final_content_replacements_not_detected",
					"provider_metrics_not_observed",
					"unfinished_attempt_recovery_not_implemented",
					...(model.api === "pi-messages"
						? ["gateway_upstream_attempts_not_observed", "gateway_content_is_normalized"]
						: []),
				],
			},
		};
	}
	observe(event: unknown): void {
		const eventOffset = performance.now() - this.record.timing.startedAtMonotonicMs;
		const e = object(event);
		const response = object(e.response ?? e.message);
		this.record.returnedModel = identifier(e.model ?? response.model) ?? this.record.returnedModel;
		const choices = Array.isArray(e.choices) ? e.choices : [];
		const choice = object(choices[0]);
		let reportSource: PerformanceAttemptRecord["usage"]["rawReportSources"][number] = "direct_provider";
		let usage = e.usage ?? response.usage ?? choice.usage;
		const u = this.record.usage;
		if (this.record.api === "pi-messages" && usage !== undefined) {
			const gateway = object(usage);
			u.gatewayCounts = {
				input: number(gateway.input),
				output: number(gateway.output),
				cacheRead: number(gateway.cacheRead),
				cacheWrite: number(gateway.cacheWrite),
				reasoning: number(gateway.reasoning),
				total: number(gateway.totalTokens),
			};
			const provider = object(gateway.provider);
			usage = provider.raw;
			reportSource = "gateway_preserved_provider";
			if (
				usage === undefined &&
				(number(provider.cachedTokens) !== null || number(provider.cacheWriteTokens) !== null)
			) {
				reportSource = "gateway_provider_cache_split";
				usage = {
					...(number(provider.cachedTokens) !== null ? { cached_tokens: provider.cachedTokens } : {}),
					...(number(provider.cacheWriteTokens) !== null ? { cache_write_tokens: provider.cacheWriteTokens } : {}),
				};
			}
		}
		if (usage !== undefined && usage !== null) {
			const { report, partial } = safeUsage(usage);
			if (u.rawReports.length < MAX_USAGE_REPORTS) {
				u.rawReports.push(report);
				u.rawReportSources.push(reportSource);
			} else u.rawCoverage = "partial";
			if (u.rawCoverage !== "partial") u.rawCoverage = partial ? "partial" : "complete";
			const inputDetails = object(report.prompt_tokens_details ?? report.input_tokens_details);
			const outputDetails = object(report.completion_tokens_details ?? report.output_tokens_details);
			u.providerInput = number(report.prompt_tokens ?? report.input_tokens) ?? u.providerInput;
			u.output = number(report.completion_tokens ?? report.output_tokens) ?? u.output;
			u.cacheRead =
				number(
					inputDetails.cached_tokens ??
						report.prompt_cache_hit_tokens ??
						report.cached_tokens ??
						report.cache_read_input_tokens,
				) ?? u.cacheRead;
			u.cacheWrite =
				number(
					inputDetails.cache_write_tokens ?? report.cache_creation_input_tokens ?? report.cache_write_tokens,
				) ?? u.cacheWrite;
			u.cacheWrite1h = number(object(report.cache_creation).ephemeral_1h_input_tokens) ?? u.cacheWrite1h;
			u.reasoning = number(outputDetails.reasoning_tokens ?? report.reasoning_tokens) ?? u.reasoning;
			u.total = number(report.total_tokens) ?? u.total;
			if (u.total !== null) u.totalSource = "provider";
			// Anthropic reports uncached input separately. OpenAI reports a total input including cache.
			if (number(report.prompt_tokens ?? report.input_tokens) !== null) {
				u.providerInputCountConvention =
					"cache_read_input_tokens" in report || "cache_creation_input_tokens" in report
						? "excludes_cache"
						: "prompt_tokens" in report || "input_tokens_details" in report || this.record.api !== "pi-messages"
							? "includes_cache"
							: "unknown";
			}
			if (u.providerInput === 0 || u.providerInputCountConvention === "excludes_cache") u.input = u.providerInput;
			else if (
				u.providerInputCountConvention === "includes_cache" &&
				u.providerInput !== null &&
				u.cacheRead !== null &&
				u.cacheWrite !== null
			) {
				const uncached = u.providerInput - u.cacheRead - u.cacheWrite;
				u.input = uncached >= 0 ? uncached : null;
			} else u.input = null;
		}
		if (
			choice.finish_reason ||
			["response.completed", "response.done", "response.incomplete", "response.failed", "done", "error"].includes(
				String(e.type),
			)
		) {
			this.record.timing.providerTerminalOffsetMs ??= eventOffset;
		}
		const delta = object(e.delta);
		const choiceDelta = object(choice.delta);
		const type = e.type;
		const text =
			nonempty(choiceDelta.content) ||
			((type === "response.output_text.delta" || type === "response.refusal.delta" || type === "text_delta") &&
				nonempty(e.delta)) ||
			(type === "content_block_delta" && delta.type === "text_delta" && nonempty(delta.text));
		const details = Array.isArray(choiceDelta.reasoning_details) ? choiceDelta.reasoning_details : [];
		const summary =
			(type === "response.reasoning_summary_text.delta" && nonempty(e.delta)) ||
			details.some((detail) => object(detail).type === "reasoning.summary" && nonempty(object(detail).summary));
		const full = details.some((detail) => object(detail).type === "reasoning.text" && nonempty(object(detail).text));
		const reasoning =
			summary ||
			full ||
			[choiceDelta.reasoning, choiceDelta.reasoning_content, choiceDelta.reasoning_text].some(nonempty) ||
			((type === "response.reasoning_summary_text.delta" ||
				type === "response.reasoning_text.delta" ||
				type === "thinking_delta") &&
				nonempty(e.delta)) ||
			(type === "content_block_delta" && delta.type === "thinking_delta" && nonempty(delta.thinking));
		const tool =
			(Array.isArray(choiceDelta.tool_calls) &&
				choiceDelta.tool_calls.some((call) => {
					const c = object(call);
					return nonempty(object(c.function).arguments) || nonempty(object(c.custom).input);
				})) ||
			((type === "response.function_call_arguments.delta" ||
				type === "response.custom_tool_call_input.delta" ||
				type === "toolcall_delta") &&
				nonempty(e.delta)) ||
			(type === "content_block_delta" && delta.type === "input_json_delta" && nonempty(delta.partial_json));
		const keyBase =
			identifier(e.item_id) ?? identifier(object(e.item).id) ?? String(e.output_index ?? e.contentIndex ?? 0);
		const kind = text
			? "text"
			: reasoning
				? typeof type === "string" && type.includes("reasoning_summary")
					? "reasoning_summary"
					: "reasoning"
				: "tool";
		if (text || reasoning || tool) {
			const contentKey = `${keyBase}:${e.content_index ?? e.summary_index ?? 0}:${kind}`;
			const fragment =
				typeof e.delta === "string"
					? e.delta
					: (choiceDelta.content ??
						choiceDelta.reasoning_content ??
						choiceDelta.reasoning ??
						delta.text ??
						delta.thinking);
			const length = typeof fragment === "string" ? fragment.length : 0;
			this.trackContentLength(contentKey, (this.contentLengths.get(contentKey) ?? 0) + length);
		}
		const snapshot = (key: string, content: unknown, snapshotKind: "text" | "reasoning" | "tool") => {
			if (typeof content !== "string" || content.length <= (this.contentLengths.get(key) ?? 0)) return;
			if (!this.trackContentLength(key, content.length)) return;
			const offset = eventOffset;
			this.record.timing.firstContentOffsetMs ??= offset;
			this.record.timing.lastContentOffsetMs = offset;
			if (snapshotKind === "text") this.record.timing.firstVisibleTextOffsetMs ??= offset;
			if (snapshotKind === "reasoning") {
				this.record.timing.firstReasoningOffsetMs ??= offset;
				if (this.record.api !== "pi-messages")
					this.markReasoningKind(key.endsWith(":reasoning_summary") ? "summary" : "full");
			}
		};
		const observeItem = (item: unknown, index: number) => {
			const i = object(item);
			const id = identifier(i.id) ?? String(index);
			if (i.type === "message" && Array.isArray(i.content))
				for (const [contentIndex, part] of i.content.entries()) {
					const p = object(part);
					if (p.type === "output_text" || p.type === "refusal")
						snapshot(`${id}:${contentIndex}:text`, p.text ?? p.refusal, "text");
				}
			if (i.type === "function_call" || i.type === "custom_tool_call")
				snapshot(`${id}:0:tool`, i.arguments ?? i.input, "tool");
			if (i.type === "reasoning" && Array.isArray(i.summary))
				for (const [contentIndex, part] of i.summary.entries())
					snapshot(`${id}:${contentIndex}:reasoning_summary`, object(part).text, "reasoning");
			if (i.type === "reasoning" && Array.isArray(i.content))
				for (const [contentIndex, part] of i.content.entries()) {
					const p = object(part);
					if (p.type === "reasoning_text") snapshot(`${id}:${contentIndex}:reasoning`, p.text, "reasoning");
				}
		};
		if (Array.isArray(response.output)) response.output.forEach(observeItem);
		if (e.item !== undefined) observeItem(e.item, typeof e.output_index === "number" ? e.output_index : 0);
		if (type === "response.output_text.done" || type === "response.refusal.done" || type === "text_end")
			snapshot(`${keyBase}:${e.content_index ?? 0}:text`, e.text ?? e.refusal ?? e.content, "text");
		if (type === "response.function_call_arguments.done" || type === "response.custom_tool_call_input.done")
			snapshot(`${keyBase}:0:tool`, e.arguments ?? e.input, "tool");
		if (type === "thinking_end" && e.redacted !== true) snapshot(`${keyBase}:0:reasoning`, e.content, "reasoning");
		if (type === "toolcall_end" && object(e.toolCall).arguments !== undefined)
			snapshot(`${keyBase}:0:tool`, JSON.stringify(object(e.toolCall).arguments), "tool");
		if (text || reasoning || tool) {
			const offset = eventOffset;
			this.record.timing.firstContentOffsetMs ??= offset;
			this.record.timing.lastContentOffsetMs = offset;
			if (text) this.record.timing.firstVisibleTextOffsetMs ??= offset;
			if (reasoning) {
				this.record.timing.firstReasoningOffsetMs ??= offset;
				const kind = summary && !full ? "summary" : "full";
				if (this.record.api !== "pi-messages") this.markReasoningKind(kind);
			}
		}
	}
	private trackContentLength(key: string, length: number): boolean {
		if (!this.contentLengths.has(key) && this.contentLengths.size >= 1024) {
			if (!this.record.coverage.limitations.includes("content_snapshot_history_truncated"))
				this.record.coverage.limitations.push("content_snapshot_history_truncated");
			return false;
		}
		this.contentLengths.set(key, length);
		return true;
	}
	private markReasoningKind(kind: "full" | "summary"): void {
		const previous = this.record.reasoningContentKind;
		this.record.reasoningContentKind = previous === "unknown" || previous === kind ? kind : "mixed";
	}
	finish(
		options: PerformanceRecordingOptions,
		outcome: PerformanceAttemptRecord["outcome"],
		stage: PerformanceAttemptRecord["failureStage"],
	): void {
		if (this.finished) return;
		this.finished = true;
		this.record.outcome = outcome;
		const current = counters.get(this.record.logicalRequestId);
		if (current?.previous === this.record.attemptId) current.failed = outcome === "error";
		this.record.failureStage = stage;
		this.record.errorCategory ??=
			outcome === "aborted"
				? "abort"
				: outcome === "error"
					? stage === "transport" || stage === "connection" || stage === "send"
						? "transport_error"
						: stage === "http_status"
							? "http_error"
							: "generation_error"
					: null;
		this.record.timing.completedOffsetMs =
			stage === "superseded" || stage === "http_status"
				? null
				: performance.now() - this.record.timing.startedAtMonotonicMs;
		this.record.timing.observationClosedOffsetMs = performance.now() - this.record.timing.startedAtMonotonicMs;
		this.record.timing.completionBoundary =
			stage === "superseded"
				? "unknown"
				: stage === "http_status"
					? "http_error_headers"
					: stage === "connection"
						? "connection_rejection"
						: stage === "send"
							? "send_rejection"
							: stage === "transport"
								? "transport_rejection"
								: this.record.attemptKind === "connection"
									? "connection_open"
									: "adapter_terminal";
		if (stage === "http_status") this.record.coverage.limitations.push("http_error_body_not_observed");
		if (stage === "superseded")
			this.record.coverage.limitations.push("overlapping_successful_fetches_not_correlated");
		try {
			void Promise.resolve(options.record(this.record)).catch(() => {});
		} catch {
			/* Recording never fails calls. */
		}
	}
}

export interface PerformanceTransportObserver {
	beginConnection(
		url: string,
	): { connectionId: string; finish(outcome: "success" | "error" | "aborted"): void } | undefined;
	beginSend(hostname: string, payload: unknown, connectionId: string, reused: boolean): void;
	sendAccepted(): void;
	fail(stage: "send" | "transport" | "generation"): void;
	fallback(sessionActive?: boolean): void;
}

/** Shared observer for actual fetch, socket construction, and generation sends. No transport is replaced. */
export function createPerformanceTransportRequest<T extends StreamOptions>(
	model: BaseModel<string>,
	options: T | undefined,
	stream: AssistantMessageEventStream,
	serializedHttpPayload?: () => unknown,
): { options: T | undefined; observer: PerformanceTransportObserver | undefined } {
	if (!options?.performance) return { options, observer: undefined };
	const recording = {
		...options.performance,
		logicalRequestId: identifier(options.performance.logicalRequestId) ?? globalThis.crypto.randomUUID(),
	};
	const fetch = options.fetch ?? globalThis.fetch;
	let active: Attempt | undefined;
	let transition: PerformanceAttemptRecord["transportTransition"] = null;
	const fresh = !identifier(options.performance.logicalRequestId);
	const observer: PerformanceTransportObserver = {
		beginConnection(url) {
			try {
				const attempt = new Attempt(model, recording, new URL(url).hostname, undefined, fresh, "connection");
				attempt.record.transport = "websocket";
				attempt.record.timing.observationPoint = "socket_lifecycle";
				const connectionId = globalThis.crypto.randomUUID();
				attempt.record.websocket = { connectionId, reused: false, sendAccepted: null };
				attempt.record.coverage.limitations = [
					"connection_is_not_generation",
					"unfinished_attempt_recovery_not_implemented",
				];
				return {
					connectionId,
					finish(outcome) {
						attempt.finish(recording, outcome, outcome === "success" ? null : "connection");
					},
				};
			} catch {
				return undefined;
			}
		},
		beginSend(hostname, payload, connectionId, reused) {
			try {
				active = new Attempt(model, recording, hostname, payload, fresh);
				active.record.transport = "websocket";
				active.record.streamProtocol = "websocket_events";
				active.record.websocket = { connectionId, reused, sendAccepted: false };
				active.record.coverage.limitations = active.record.coverage.limitations.filter(
					(value) =>
						value !== "injected_fetch_internal_routing_not_observed" &&
						value !== "parsed_events_after_sse_buffering" &&
						value !== "parsed_events_after_sdk_buffering",
				);
				active.record.coverage.limitations.push(
					"websocket_send_acceptance_is_not_provider_receipt",
					"parsed_events_after_socket_queueing",
				);
			} catch {
				/* Recording cannot prevent a send. */
			}
		},
		sendAccepted() {
			if (active?.record.websocket) active.record.websocket.sendAccepted = true;
		},
		fail(stage) {
			active?.finish(recording, options.signal?.aborted ? "aborted" : "error", stage);
			active = undefined;
		},
		fallback(sessionActive) {
			transition = sessionActive ? "session_sse_fallback" : "pre_start_sse_fallback";
		},
	};
	const originalPush = stream.push.bind(stream);
	stream.push = (event: AssistantMessageEvent) => {
		if (event.type === "done" || event.type === "error") {
			active?.finish(
				recording,
				event.type === "done" ? "success" : event.reason === "aborted" ? "aborted" : "error",
				event.type === "done" ? null : "generation",
			);
			active = undefined;
		}
		originalPush(event);
	};
	return {
		observer,
		options: {
			...options,
			fetch: async (input, init) => {
				let hostname: string | null = null;
				let payload: unknown;
				try {
					hostname = new URL(input instanceof Request ? input.url : String(input)).hostname;
					if (serializedHttpPayload) payload = serializedHttpPayload();
					else if (typeof init?.body === "string") payload = JSON.parse(init.body);
				} catch {
					/* Missing metadata remains unknown. */
				}
				let attempt: Attempt | undefined;
				try {
					if (active) active.finish(recording, "unknown", "superseded");
					active = undefined;
					attempt = new Attempt(model, recording, hostname, payload, fresh);
					attempt.record.transportTransition = transition;
					active = attempt;
				} catch {
					/* A failed observation must not prevent the actual fetch or fabricate an attempt. */
					active = undefined;
				}
				if (!attempt) return fetch(input, init);
				try {
					const response = await fetch(input, init);
					attempt.record.httpStatus = response.status;
					const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
					attempt.record.streamProtocol = contentType.includes("text/event-stream")
						? "sse"
						: contentType.includes("ndjson")
							? "ndjson"
							: "unknown";
					attempt.record.timing.headersOffsetMs = performance.now() - attempt.record.timing.startedAtMonotonicMs;
					if (!response.ok) {
						attempt.finish(recording, "error", "http_status");
						if (active === attempt) active = undefined;
					}
					return response;
				} catch (error) {
					if (!options.signal?.aborted && init?.signal?.aborted)
						attempt.record.errorCategory = "internal_cancellation";
					attempt.finish(recording, options.signal?.aborted ? "aborted" : "error", "transport");
					if (active === attempt) active = undefined;
					throw error;
				}
			},
			onProviderStreamEvent: async (event, eventModel) => {
				try {
					active?.observe(event);
				} catch {
					/* An observer cannot affect parsing. */
				}
				await options.onProviderStreamEvent?.(event, eventModel);
			},
		},
	};
}

/** Instruments actual injected fetch invocations, not outer SDK calls. Streaming completion comes from the adapter. */
export function createPerformanceRequest<T extends StreamOptions>(
	model: BaseModel<string>,
	options: T | undefined,
	stream: AssistantMessageEventStream,
): T | undefined {
	return createPerformanceTransportRequest(model, options, stream).options;
}
