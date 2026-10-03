import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import type { PerformanceAttemptRecord, PerformanceRecordingOptions } from "@earendil-works/pi-ai";
import { createLocalPerformanceSnapshot, performanceProcessRunId } from "@earendil-works/pi-ai/api/performance";

export interface PerformanceRecordingHealth {
	written: number;
	dropped: number;
	writeFailures: number;
	missingCorrelation: number;
	queued: number;
	unsupported: Record<string, number>;
}
export interface PerformanceCoverageGap {
	schemaVersion: 1;
	recordKind: "coverage_gap";
	processRunId: string;
	observedAtUtc: string;
	api: string;
	reason: "route_not_instrumented" | "operation_not_instrumented";
	sessionId: string | null;
	operationId: string | null;
	logicalRequestId: string | null;
	sdkInvocationId: string | null;
	orchestrationRetry: number | null;
	purpose: string;
	actualApiHostname: null;
}
const recorders = new Set<WeakRef<LocalPerformanceRecorder>>();
process.once("exit", () => {
	const deadline = performance.now() + 250;
	for (const reference of recorders) reference.deref()?.close(deadline);
});
const unsupportedApis = new Set([
	"bedrock-converse-stream",
	"google-generative-ai",
	"google-vertex",
	"anthropic-messages",
	"mistral-conversations",
	"openrouter-images",
	"llama-cpp-classify",
	"typesafe-system-one",
	"cloudflare-workers-ai-system-one",
	"deferred_operation",
]);
function safeId(value: string | undefined): string | null {
	return value && value.length <= 256 && /^[a-zA-Z0-9_./:-]+$/.test(value) ? value : null;
}

/** Local-only queued writer. Synchronous disk operations also permit bounded best-effort process.exit draining. */
export class LocalPerformanceRecorder {
	private readonly directory: string;
	private readonly runId = globalThis.crypto.randomUUID();
	private readonly maxQueued: number;
	private readonly maxFileBytes: number;
	private readonly retainedFiles: number;
	private readonly exitBudgetMs: number;
	private sequence = 0;
	private bytes = 0;
	private queue: string[] = [];
	private scheduled: Promise<void> | undefined;
	private closed = false;
	private warnedFailure = false;
	private readonly reference = new WeakRef(this);
	private readonly state: PerformanceRecordingHealth = {
		written: 0,
		dropped: 0,
		writeFailures: 0,
		missingCorrelation: 0,
		queued: 0,
		unsupported: {},
	};
	constructor(
		directory: string,
		limits: { maxQueued?: number; maxFileBytes?: number; retainedFiles?: number; exitBudgetMs?: number } = {},
	) {
		this.directory = directory;
		this.maxQueued = Math.max(1, limits.maxQueued ?? 128);
		this.maxFileBytes = Math.max(1, limits.maxFileBytes ?? 8 * 1024 * 1024);
		this.retainedFiles = Math.max(1, limits.retainedFiles ?? 4);
		this.exitBudgetMs = Math.max(0, limits.exitBudgetMs ?? 250);
		recorders.add(this.reference);
	}
	get health(): PerformanceRecordingHealth {
		return { ...this.state, queued: this.queue.length, unsupported: { ...this.state.unsupported } };
	}
	noteUnsupported(
		api: string,
		correlation?: PerformanceRecordingOptions,
		reason: PerformanceCoverageGap["reason"] = "route_not_instrumented",
	): void {
		const key = unsupportedApis.has(api) ? api : "custom_or_auxiliary";
		this.state.unsupported[key] = (this.state.unsupported[key] ?? 0) + 1;
		const gap: PerformanceCoverageGap = {
			schemaVersion: 1,
			recordKind: "coverage_gap",
			processRunId: performanceProcessRunId,
			observedAtUtc: new Date().toISOString(),
			api: key,
			reason,
			sessionId: safeId(correlation?.sessionId),
			operationId: safeId(correlation?.operationId),
			logicalRequestId: safeId(correlation?.logicalRequestId),
			sdkInvocationId: safeId(correlation?.sdkInvocationId),
			orchestrationRetry:
				typeof correlation?.orchestrationRetry === "number" &&
				Number.isSafeInteger(correlation.orchestrationRetry) &&
				correlation.orchestrationRetry >= 0
					? correlation.orchestrationRetry
					: null,
			purpose: correlation?.purpose ?? "unknown",
			actualApiHostname: null,
		};
		this.enqueue(`${JSON.stringify(gap)}\n`);
		if (this.state.unsupported[key] === 1)
			this.warn(`coverage gap for ${key}; no attempt coverage is claimed (see local coverage_gap records)`);
	}
	readonly record = (record: PerformanceAttemptRecord): void => {
		if (record.coverage.correlation !== "complete") this.state.missingCorrelation++;
		try {
			// AI owns the private telemetry backend; no caller-supplied exporter can receive these records.
			const json = createLocalPerformanceSnapshot(record);
			if (typeof json === "string") this.enqueue(`${json}\n`);
			else this.state.writeFailures++;
		} catch {
			this.state.writeFailures++;
			this.warnFailure();
		}
	};
	private enqueue(line: string): void {
		if (this.closed || this.queue.length >= this.maxQueued || Buffer.byteLength(line) > 256 * 1024) {
			this.state.dropped++;
			this.warnFailure();
			return;
		}
		this.queue.push(line);
		if (!this.scheduled)
			this.scheduled = Promise.resolve().then(() => {
				this.drain();
				this.scheduled = undefined;
			});
	}
	flush(): Promise<void> {
		return this.scheduled ?? Promise.resolve();
	}
	/** Called by the production exit hook, including explicit process.exit. No asynchronous work is launched here. */
	close(shutdownDeadline = Number.POSITIVE_INFINITY): void {
		if (this.closed) return;
		this.drain(Math.min(shutdownDeadline, performance.now() + this.exitBudgetMs));
		if (this.queue.length) {
			this.state.dropped += this.queue.length;
			this.queue = [];
		}
		this.closed = true;
		recorders.delete(this.reference);
		if (this.state.dropped || this.state.writeFailures)
			this.warn(`shutdown: dropped=${this.state.dropped} writeFailures=${this.state.writeFailures}`);
	}
	private drain(deadline = Number.POSITIVE_INFINITY): void {
		while (this.queue.length && performance.now() < deadline) {
			const line = this.queue.shift()!;
			try {
				this.append(line);
				this.state.written++;
			} catch {
				this.state.writeFailures++;
				this.warnFailure();
			}
		}
	}
	private warnFailure(): void {
		if (!this.warnedFailure) {
			this.warnedFailure = true;
			this.warn("recording loss or disk failure; inspect SDK recording health counters");
		}
	}
	private warn(message: string): void {
		try {
			process.stderr.write(`[pi API performance] ${message}\n`);
		} catch {
			/* Never fail model calls. */
		}
	}
	private append(line: string): void {
		if (!isAbsolute(this.directory)) throw new Error("Performance directory must be absolute");
		mkdirSync(this.directory, { recursive: true, mode: 0o700 });
		const directoryStat = lstatSync(this.directory);
		if (
			!directoryStat.isDirectory() ||
			directoryStat.isSymbolicLink() ||
			(process.platform !== "win32" &&
				((directoryStat.mode & 0o077) !== 0 || directoryStat.uid !== process.getuid?.()))
		)
			throw new Error("Performance directory must be owned and private");
		const size = Buffer.byteLength(line);
		if (this.bytes > 0 && this.bytes + size > this.maxFileBytes) {
			this.sequence++;
			this.bytes = 0;
		}
		const name = `attempts-${process.pid}-${this.runId}-${String(this.sequence).padStart(6, "0")}.jsonl`;
		const path = join(this.directory, name);
		const file = openSync(
			path,
			constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			const fileStat = fstatSync(file);
			if (
				!fileStat.isFile() ||
				(process.platform !== "win32" && ((fileStat.mode & 0o077) !== 0 || fileStat.uid !== process.getuid?.()))
			)
				throw new Error("Performance file must be owned and private");
			writeFileSync(file, line);
			this.bytes += size;
		} finally {
			closeSync(file);
		}
		const eligible: { name: string; modified: number }[] = [];
		for (const candidate of readdirSync(this.directory)) {
			if (candidate === name) continue;
			const match = /^attempts-(\d+)-([a-f0-9-]{36})-\d{6}\.jsonl$/.exec(candidate);
			if (!match) continue;
			const pid = Number(match[1]);
			if (pid !== process.pid) {
				try {
					process.kill(pid, 0);
					continue;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") continue;
				}
			} else if (
				match[2] !== this.runId &&
				[...recorders].some((reference) => reference.deref()?.runId === match[2])
			)
				continue;
			const entry = lstatSync(join(this.directory, candidate));
			if (entry.isFile() && (process.platform === "win32" || entry.uid === process.getuid?.()))
				eligible.push({ name: candidate, modified: entry.mtimeMs });
		}
		eligible.sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));
		for (const entry of eligible.slice(this.retainedFiles - 1)) unlinkSync(join(this.directory, entry.name));
	}
}
const enabledApis = new Set([
	"openai-completions",
	"openai-responses",
	"azure-openai-responses",
	"pi-messages",
	"openai-codex-responses",
]);
export function hasPerformanceTransportCoverage(api: string): boolean {
	return enabledApis.has(api);
}
