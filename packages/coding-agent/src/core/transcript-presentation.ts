import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** Optional, producer-selected display data. Never an execution result or terminal component. */
export interface CompactTranscriptHints {
	label?: string;
	summary?: string;
	error?: string;
	status?: CompactTranscriptStatus;
	counts?: Array<{ label: string; value: number }>;
	progress?: { completed: number; total: number };
	costUsd?: number;
	outputPaths?: string[];
}

export type CompactTranscriptStatus = "info" | "warning" | "error" | "running" | "completed" | "cancelled";
export type TranscriptKind = "tool" | "message" | "entry" | "notice" | "shell";
export type TranscriptPresentationMode = "compact" | "legacy";
export interface TranscriptPolicy {
	mode: TranscriptPresentationMode;
	maxLines: number;
}
export interface TranscriptPresentationSettings {
	mode?: TranscriptPresentationMode;
	maxLines?: number;
	exceptions?: Array<{ kind: TranscriptKind; name: string; mode?: TranscriptPresentationMode; maxLines?: number }>;
}
export interface NormalizedTranscriptPresentation extends TranscriptPolicy {
	exceptions: Array<TranscriptPolicy & { kind: TranscriptKind; name: string }>;
}

const statuses: readonly string[] = ["info", "warning", "error", "running", "completed", "cancelled"];
const kinds: readonly string[] = ["tool", "message", "entry", "notice", "shell"];

function plain(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
	);
}

/** Read only own data properties. Accessors on known fields invalidate the supplied data. */
function field(record: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor) return undefined;
	if (!("value" in descriptor)) throw new Error("Accessor in compact display data");
	return descriptor.value;
}

/** Remove terminal commands, controls and bidirectional overrides; preserve ordinary Unicode text. */
export function sanitizeTranscriptText(value: string): string {
	const withoutCommands = value
		.replace(/(?:\x1b[\]P_X^]|[\x90\x98\x9d-\x9f])[\s\S]*?(?:\x07|\x1b\\|\x9c|$)/g, "")
		.replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\x1b[ -/]*[@-~]/g, "");
	return stripTerminalSequences(withoutCommands)
		.replace(/[\x00-\x20\x7f-\x9f\u2028\u2029]/g, " ")
		.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
		.replace(/ +/g, " ")
		.trim();
}

function text(value: unknown, limit: number): string {
	if (typeof value !== "string" || value.length > limit) throw new Error("Invalid compact text");
	return sanitizeTranscriptText(value);
}

function integer(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid compact count");
	return value;
}

function boundedArray(value: unknown, limit: number): unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit)
		throw new Error("Invalid compact list");
	const values: unknown[] = [];
	for (let i = 0; i < value.length; i++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
		if (!descriptor || !("value" in descriptor)) throw new Error("Invalid compact list entry");
		values.push(descriptor.value);
	}
	return values;
}

/** Validate without traversing unknown keys, calling getters, or retaining producer references. */
export function validateCompactHints(value: unknown): CompactTranscriptHints | undefined {
	if (value === undefined) return undefined;
	try {
		if (!plain(value)) return undefined;
		const result: CompactTranscriptHints = {};
		for (const key of ["label", "summary", "error"] as const) {
			const input = field(value, key);
			if (input !== undefined) result[key] = text(input, 160);
		}
		const status = field(value, "status");
		if (status !== undefined) {
			if (typeof status !== "string" || !statuses.includes(status)) return undefined;
			result.status = status as CompactTranscriptStatus;
		}
		const counts = field(value, "counts");
		if (counts !== undefined)
			result.counts = boundedArray(counts, 4).map((count) => {
				if (!plain(count)) throw new Error("Invalid compact count");
				return { label: text(field(count, "label"), 32), value: integer(field(count, "value")) };
			});
		const progress = field(value, "progress");
		if (progress !== undefined) {
			if (!plain(progress)) return undefined;
			const completed = integer(field(progress, "completed"));
			const total = integer(field(progress, "total"));
			if (completed > total) return undefined;
			result.progress = { completed, total };
		}
		const cost = field(value, "costUsd");
		if (cost !== undefined) {
			if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return undefined;
			result.costUsd = cost;
		}
		const paths = field(value, "outputPaths");
		if (paths !== undefined) result.outputPaths = boundedArray(paths, 2).map((path) => text(path, 256));
		return Buffer.byteLength(JSON.stringify(result), "utf8") <= 4096 ? result : undefined;
	} catch {
		return undefined;
	}
}

const diagnosedProducers = new WeakSet<object>();

/** Per-item cache refreshed by input events, never by terminal render frames. */
export class CompactHintsCache {
	private value?: CompactTranscriptHints;
	private diagnostic?: (message: string) => void;

	constructor(diagnostic?: (message: string) => void) {
		this.diagnostic = diagnostic;
	}

	get hints(): CompactTranscriptHints | undefined {
		return this.value;
	}

	update<T>(provider: ((input: T) => CompactTranscriptHints | undefined) | undefined, input: T): void {
		this.value = undefined;
		if (!provider) return;
		let failed = false;
		try {
			const raw = provider(input);
			this.value = validateCompactHints(raw);
			failed = raw !== undefined && this.value === undefined;
		} catch {
			failed = true;
		}
		if (failed && this.diagnostic && !diagnosedProducers.has(provider)) {
			diagnosedProducers.add(provider);
			this.diagnostic("Compact transcript hints unavailable: producer returned invalid data or threw.");
		}
	}
}

function mode(value: unknown, fallback: TranscriptPresentationMode): TranscriptPresentationMode {
	return value === "compact" || value === "legacy" ? value : fallback;
}
function lines(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4 ? value : fallback;
}

/** Normalize once at the settings boundary. Invalid values never make compact mode unlimited. */
export function normalizeTranscriptPresentation(
	value?: unknown,
	diagnostic?: (message: string) => void,
): NormalizedTranscriptPresentation {
	const result: NormalizedTranscriptPresentation = { mode: "compact", maxLines: 2, exceptions: [] };
	let invalid = false;
	try {
		if (value === undefined) return result;
		if (!plain(value)) throw new Error("Invalid presentation settings");
		const inputMode = field(value, "mode");
		const inputLines = field(value, "maxLines");
		result.mode = mode(inputMode, "compact");
		result.maxLines = lines(inputLines, 2);
		invalid =
			(inputMode !== undefined && inputMode !== result.mode) ||
			(inputLines !== undefined && inputLines !== result.maxLines);
		const exceptions = field(value, "exceptions");
		if (exceptions !== undefined) {
			if (!Array.isArray(exceptions)) throw new Error("Invalid presentation exceptions");
			const seen = new Set<string>();
			for (const entry of exceptions) {
				if (!plain(entry)) {
					invalid = true;
					continue;
				}
				const kind = field(entry, "kind");
				const name = field(entry, "name");
				if (typeof kind !== "string" || !kinds.includes(kind) || typeof name !== "string" || !name) {
					invalid = true;
					continue;
				}
				const entryMode = field(entry, "mode");
				const entryLines = field(entry, "maxLines");
				const normalizedMode = mode(entryMode, result.mode);
				const normalizedLines = lines(entryLines, result.maxLines);
				invalid ||=
					(entryMode !== undefined && entryMode !== normalizedMode) ||
					(entryLines !== undefined && entryLines !== normalizedLines);
				const key = JSON.stringify([kind, name]);
				if (seen.has(key)) continue;
				seen.add(key);
				result.exceptions.push({
					kind: kind as TranscriptKind,
					name,
					mode: normalizedMode,
					maxLines: normalizedLines,
				});
			}
		}
	} catch {
		invalid = true;
	}
	if (invalid) diagnostic?.("Invalid transcriptPresentation setting; unsafe values use compact defaults.");
	return result;
}

/** One exact-match policy resolver for every transcript adapter; no tool-name layout rules. */
export function resolveTranscriptPresentation(
	settings: NormalizedTranscriptPresentation,
	kind: TranscriptKind,
	name: string,
): TranscriptPolicy {
	const exception = settings.exceptions.find((entry) => entry.kind === kind && entry.name === name);
	return { mode: exception?.mode ?? settings.mode, maxLines: exception?.maxLines ?? settings.maxLines };
}
