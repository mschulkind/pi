import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
	subscribeTuiResponsiveness,
	TUI_RESPONSIVENESS_KINDS,
	type TuiResponsivenessObserver,
} from "@earendil-works/pi-tui";

/** Fixed producer bounds, not user-controlled telemetry dimensions. */
export const CORE_TELEMETRY_LIMITS = Object.freeze({
	cadenceMs: 5000,
	resolutionMs: 20,
	maxWindows: 120,
	maxRecordBytes: 8192,
	maxSessionBytes: 1024 * 1024,
	maxDurationMs: 600_000,
	maxCount: 1_000_000_000,
	shutdownMs: 100,
	retainedFiles: 2,
	queuedRecords: 2,
});
type Reason =
	| "disabled"
	| "invalid_directory"
	| "not_started"
	| "starting"
	| "active"
	| "storage_error"
	| "observer_error"
	| "limit"
	| "closed"
	| "shutdown_timeout";
interface Metric {
	count: number;
	totalMs: number;
	maxMs: number;
}
interface Health {
	recordsWritten: number;
	bytesWritten: number;
	droppedRecords: number;
	writeErrors: number;
	queuedRecords: number;
	windowsObserved: number;
	inputDispatches: number;
	frames: number;
}
export interface CoreTelemetryStatus {
	capabilityVersion: 1;
	configured: boolean;
	live: boolean;
	reason: Reason;
	coverage: "event_loop_windows_and_tui_callbacks";
	health: Health | null;
}
interface DelayHistogram {
	count: number;
	min: number;
	max: number;
	mean: number;
	percentile(percentile: number): number;
	enable(): unknown;
	disable(): unknown;
	reset(): void;
}
/** Internal deterministic test seams. Production uses Node built-ins and the real TUI subscription. */
export interface CoreTelemetryDependencies {
	io: Pick<typeof fs, "lstat" | "mkdir" | "open" | "rename" | "unlink">;
	monitor(): DelayHistogram;
	subscribe(observer: TuiResponsivenessObserver): () => void;
	now(): number;
}
const defaults: CoreTelemetryDependencies = {
	io: fs,
	monitor: () => monitorEventLoopDelay({ resolution: CORE_TELEMETRY_LIMITS.resolutionMs }),
	subscribe: subscribeTuiResponsiveness,
	now: () => performance.now(),
};
function configuration(env: NodeJS.ProcessEnv): { configured: boolean; reason: Reason; directory?: string } {
	if (env.PI_CORE_TELEMETRY !== "1") return { configured: false, reason: "disabled" };
	const directory = env.PI_CORE_TELEMETRY_DIR;
	if (!directory || !isAbsolute(directory) || directory.length > 4096)
		return { configured: false, reason: "invalid_directory" };
	return { configured: true, reason: "not_started", directory: resolve(directory) };
}
function status(configured: boolean, live: boolean, reason: Reason, health: Health | null): CoreTelemetryStatus {
	return { capabilityVersion: 1, configured, live, reason, coverage: "event_loop_windows_and_tui_callbacks", health };
}
function count(value: number): number {
	return Number.isFinite(value) && value >= 0 ? Math.min(CORE_TELEMETRY_LIMITS.maxCount, Math.floor(value)) : 0;
}
function milliseconds(value: number): number | null {
	return Number.isFinite(value) && value >= 0
		? Math.min(CORE_TELEMETRY_LIMITS.maxDurationMs, Math.round(value * 1000) / 1000)
		: null;
}
function emptyMetrics(): Record<string, Metric> {
	return Object.fromEntries(TUI_RESPONSIVENESS_KINDS.map((kind) => [kind, { count: 0, totalMs: 0, maxMs: 0 }]));
}

/** One capture per owner-private directory. Writes are serialized; a blocked writer retains at most two records. */
export class CoreTelemetry {
	readonly ready: Promise<void>;
	private readonly dependencies: CoreTelemetryDependencies;
	private readonly directory: string;
	private reason: Reason = "starting";
	private live = true;
	private readonly health: Health = {
		recordsWritten: 0,
		bytesWritten: 0,
		droppedRecords: 0,
		writeErrors: 0,
		queuedRecords: 0,
		windowsObserved: 0,
		inputDispatches: 0,
		frames: 0,
	};
	private metrics = emptyMetrics();
	private histogram: DelayHistogram | undefined;
	private unsubscribe: (() => void) | undefined;
	private timer: NodeJS.Timeout | undefined;
	private lock: fs.FileHandle | undefined;
	private directoryIdentity: { dev: number; ino: number } | undefined;
	private writing: Promise<void> | undefined;
	private pending: string | undefined;
	private closing: Promise<void> | undefined;
	private abandoned = false;
	private initialized = false;
	private windows = 0;
	private acceptedBytes = 0;
	private previousTime: number;
	private readonly deadline: number;
	private cleanupPromise: Promise<void> | undefined;

	constructor(directory: string, dependencies: CoreTelemetryDependencies) {
		this.directory = directory;
		this.dependencies = dependencies;
		this.previousTime = dependencies.now();
		this.deadline = this.previousTime + CORE_TELEMETRY_LIMITS.maxDurationMs;
		try {
			this.histogram = dependencies.monitor();
			this.histogram.enable();
			this.unsubscribe = dependencies.subscribe((kind, durationMs) => {
				if (!this.live || !Object.hasOwn(this.metrics, kind) || !Number.isFinite(durationMs) || durationMs < 0)
					return;
				const metric = this.metrics[kind];
				const duration = milliseconds(durationMs)!;
				metric.count = count(metric.count + 1);
				metric.totalMs = Math.min(Number.MAX_SAFE_INTEGER, metric.totalMs + duration);
				metric.maxMs = Math.max(metric.maxMs, duration);
				if (kind === "input_dispatch") this.health.inputDispatches = count(this.health.inputDispatches + 1);
				if (kind === "render") this.health.frames = count(this.health.frames + 1);
			});
			this.timer = setInterval(() => {
				void this.sample();
			}, CORE_TELEMETRY_LIMITS.cadenceMs);
			this.timer.unref();
		} catch {
			this.halt("observer_error");
		}
		this.ready = this.live
			? this.initialize()
					.catch(() => {
						this.health.writeErrors = count(this.health.writeErrors + 1);
						this.halt("storage_error");
					})
					.finally(() => {
						if (!this.live) void this.cleanup();
					})
			: Promise.resolve();
	}

	status(): CoreTelemetryStatus {
		return status(true, this.live, this.reason, { ...this.health });
	}
	/** Resolves after outstanding IO eventually finishes, independently of the bounded shutdown deadline. */
	get settled(): Promise<void> {
		return this.finish();
	}

	private halt(reason: Reason): void {
		this.live = false;
		this.reason = reason;
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		try {
			this.unsubscribe?.();
		} catch {}
		this.unsubscribe = undefined;
		try {
			this.histogram?.disable();
		} catch {}
	}

	private async initialize(): Promise<void> {
		const io = this.dependencies.io;
		const root = parse(this.directory).root;
		const parts = this.directory.slice(root.length).split(sep).filter(Boolean);
		if (parts.length === 0 || parts.length > 64 || process.getuid === undefined || process.platform === "win32")
			throw new Error("Unsupported private directory");
		let current = root;
		for (let i = 0; i < parts.length; i++) {
			current = join(current, parts[i]!);
			// Only the final directory may be created. Ancestors must already exist.
			if (i === parts.length - 1) {
				try {
					await io.mkdir(current, { mode: 0o700 });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
			}
			const entry = await io.lstat(current);
			if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Unsafe directory");
			// A sticky shared temporary ancestor is allowed; an untrusted writable ancestor is not.
			if (
				i < parts.length - 1 &&
				(((entry.mode & 0o022) !== 0 && (entry.mode & 0o1000) === 0) ||
					(entry.uid !== 0 && entry.uid !== process.getuid()))
			)
				throw new Error("Unsafe ancestor");
			if (i === parts.length - 1) {
				if (entry.uid !== process.getuid() || (entry.mode & 0o077) !== 0) throw new Error("Nonprivate directory");
				this.directoryIdentity = { dev: entry.dev, ino: entry.ino };
			}
		}
		if (!this.live) return;
		const lock = await io.open(
			join(this.directory, "core-telemetry.lock"),
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
			0o600,
		);
		this.lock = lock;
		const lockStat = await lock.stat();
		if (!lockStat.isFile() || lockStat.uid !== process.getuid() || (lockStat.mode & 0o077) !== 0)
			throw new Error("Unsafe lock");
		await this.verifyDirectory();
		// Only inspect fixed output slots, never scan unrelated directory contents.
		for (let slot = 0; slot < CORE_TELEMETRY_LIMITS.retainedFiles; slot++) {
			const target = join(this.directory, `core-telemetry-${slot}.json`);
			try {
				const entry = await io.lstat(target);
				if (
					!entry.isFile() ||
					entry.isSymbolicLink() ||
					entry.uid !== process.getuid() ||
					(entry.mode & 0o077) !== 0 ||
					entry.nlink !== 1
				)
					throw new Error("Unsafe output slot");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		if (!this.live) return;
		this.initialized = true;
		this.reason = "active";
	}

	private async verifyDirectory(): Promise<void> {
		const entry = await this.dependencies.io.lstat(this.directory);
		if (
			!entry.isDirectory() ||
			entry.isSymbolicLink() ||
			entry.uid !== process.getuid?.() ||
			(entry.mode & 0o077) !== 0 ||
			entry.dev !== this.directoryIdentity?.dev ||
			entry.ino !== this.directoryIdentity.ino
		)
			throw new Error("Directory changed");
	}

	/** Sample/reset exactly one window. No raw histogram, content, caller identities, or exception strings. */
	sample(): Promise<void> {
		if (!this.live) return this.writing ?? Promise.resolve();
		try {
			const now = this.dependencies.now();
			const histogram = this.histogram!;
			const samples = count(histogram.count);
			const record = {
				schema: "pi.core-responsiveness",
				schemaVersion: 1,
				window: ++this.windows,
				windowMs: milliseconds(now - this.previousTime),
				metrics: this.metrics,
				eventLoop: {
					samples,
					minMs: samples ? milliseconds(histogram.min / 1e6) : null,
					maxMs: samples ? milliseconds(histogram.max / 1e6) : null,
					meanMs: samples ? milliseconds(histogram.mean / 1e6) : null,
					p99Ms: samples ? milliseconds(histogram.percentile(99) / 1e6) : null,
				},
				losses: { droppedRecords: this.health.droppedRecords, writeErrors: this.health.writeErrors },
			};
			this.previousTime = now;
			this.metrics = emptyMetrics();
			histogram.reset();
			this.health.windowsObserved = count(this.health.windowsObserved + 1);
			const serialized = JSON.stringify(record);
			const bytes = Buffer.byteLength(serialized);
			if (
				!this.initialized ||
				bytes > CORE_TELEMETRY_LIMITS.maxRecordBytes ||
				this.acceptedBytes + bytes > CORE_TELEMETRY_LIMITS.maxSessionBytes
			)
				this.drop();
			else if (this.writing) {
				if (this.pending !== undefined) this.drop();
				else {
					this.pending = serialized;
					this.acceptedBytes += bytes;
					this.health.queuedRecords++;
				}
			} else {
				this.acceptedBytes += bytes;
				this.health.queuedRecords++;
				this.writing = this.drain(serialized)
					.catch(() => {
						this.health.writeErrors = count(this.health.writeErrors + 1);
						this.health.droppedRecords = count(this.health.droppedRecords + this.health.queuedRecords);
						this.health.queuedRecords = 0;
						this.pending = undefined;
						this.halt("storage_error");
					})
					.finally(() => {
						this.writing = undefined;
						if (!this.live) void this.cleanup();
					});
			}
			if (
				this.windows >= CORE_TELEMETRY_LIMITS.maxWindows ||
				now >= this.deadline ||
				this.acceptedBytes >= CORE_TELEMETRY_LIMITS.maxSessionBytes
			)
				this.halt("limit");
		} catch {
			this.drop();
			this.halt("observer_error");
		}
		if (!this.live && !this.writing) void this.finish();
		return this.writing ?? Promise.resolve();
	}

	private drop(): void {
		this.health.droppedRecords = count(this.health.droppedRecords + 1);
	}

	private async drain(serialized: string): Promise<void> {
		const io = this.dependencies.io;
		let next: string | undefined = serialized;
		while (next !== undefined) {
			const temporary = join(this.directory, "core-telemetry.tmp");
			let file: fs.FileHandle | undefined;
			let created = false;
			try {
				await this.verifyDirectory();
				if (this.abandoned) break;
				file = await io.open(
					temporary,
					constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
					0o600,
				);
				created = true;
				const entry = await file.stat();
				if (!entry.isFile() || entry.uid !== process.getuid?.() || (entry.mode & 0o077) !== 0 || entry.nlink !== 1)
					throw new Error("Unsafe temporary file");
				await file.writeFile(next, { encoding: "utf8" });
				await file.close();
				file = undefined;
				await this.verifyDirectory();
				if (this.abandoned) break;
				await io.rename(
					temporary,
					join(
						this.directory,
						`core-telemetry-${this.health.recordsWritten % CORE_TELEMETRY_LIMITS.retainedFiles}.json`,
					),
				);
				created = false;
				this.health.recordsWritten = count(this.health.recordsWritten + 1);
				this.health.bytesWritten = count(this.health.bytesWritten + Buffer.byteLength(next));
			} catch {
				if (!this.abandoned) {
					this.health.writeErrors = count(this.health.writeErrors + 1);
					this.drop();
					this.halt("storage_error");
				}
			} finally {
				await file?.close().catch(() => {});
				if (created) await io.unlink(temporary).catch(() => {});
				if (!this.abandoned) this.health.queuedRecords = Math.max(0, this.health.queuedRecords - 1);
			}
			next = this.pending;
			this.pending = undefined;
			if (this.abandoned || this.reason === "storage_error") {
				if (next !== undefined) {
					this.drop();
					this.health.queuedRecords = Math.max(0, this.health.queuedRecords - 1);
				}
				break;
			}
		}
	}

	private cleanup(): Promise<void> {
		if (this.cleanupPromise) return this.cleanupPromise;
		this.cleanupPromise = (async () => {
			const lock = this.lock;
			this.lock = undefined;
			if (!lock) return;
			try {
				await this.verifyDirectory();
				const held = await lock.stat();
				const current = await this.dependencies.io.lstat(join(this.directory, "core-telemetry.lock"));
				if (current.dev === held.dev && current.ino === held.ino && !current.isSymbolicLink())
					await this.dependencies.io.unlink(join(this.directory, "core-telemetry.lock"));
			} catch {
			} finally {
				await lock.close().catch(() => {});
			}
		})().catch(() => {});
		return this.cleanupPromise;
	}
	private async finish(): Promise<void> {
		await this.ready;
		await this.writing;
		if (!this.live) await this.cleanup();
	}

	close(): Promise<void> {
		if (this.closing) return this.closing;
		if (this.live) {
			void this.sample();
			this.halt("closed");
		}
		this.closing = new Promise<void>((resolveClose) => {
			const timeout = setTimeout(() => {
				this.abandoned = true;
				this.health.droppedRecords = count(this.health.droppedRecords + this.health.queuedRecords);
				this.health.queuedRecords = 0;
				this.pending = undefined;
				this.reason = "shutdown_timeout";
				resolveClose();
			}, CORE_TELEMETRY_LIMITS.shutdownMs);
			timeout.unref();
			void this.finish().then(
				() => {
					clearTimeout(timeout);
					resolveClose();
				},
				() => {
					clearTimeout(timeout);
					resolveClose();
				},
			);
		});
		return this.closing;
	}
}

/** Explicit environment activation only. The disabled branch constructs nothing and touches no IO/timers/clocks. */
export function createCoreTelemetry(
	env: NodeJS.ProcessEnv = process.env,
	dependencies: CoreTelemetryDependencies = defaults,
): CoreTelemetry | undefined {
	const selected = configuration(env);
	return selected.directory ? new CoreTelemetry(selected.directory, dependencies) : undefined;
}
let active: CoreTelemetry | undefined;
/** CLI process capture; repeated starts while live share one owner rather than installing duplicate observers. */
export function startCoreTelemetry(): CoreTelemetry | undefined {
	if (!active) active = createCoreTelemetry();
	return active;
}
/** Detaches observers synchronously, drains asynchronously for at most 100 ms; no forced process exit. */
export function stopCoreTelemetry(): Promise<void> | undefined {
	const current = active;
	if (!current) return undefined;
	const closing = current.close();
	void closing.then(() => {
		if (active === current) active = undefined;
	});
	return closing;
}
/** Snapshot-only; configured is not evidence of observation or successful persistence. No path is exposed. */
export function getCoreTelemetryStatus(): CoreTelemetryStatus {
	if (active) return active.status();
	const selected = configuration(process.env);
	return status(selected.configured, false, selected.reason, null);
}
