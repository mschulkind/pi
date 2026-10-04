import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import {
	subscribeTuiResponsiveness,
	TUI_RESPONSIVENESS_KINDS,
	type TuiResponsivenessObserver,
} from "@earendil-works/pi-tui";
import type { SessionManager } from "./session-manager.ts";

export const CORE_TELEMETRY_LIMITS = Object.freeze({
	cadenceMs: 5000,
	idleMs: 60000,
	resolutionMs: 20,
	maxRecordBytes: 8192,
	queuedRecords: 2,
	maxDurationMs: 600000,
	maxCount: 1000000000,
});
type Reason =
	| "disabled"
	| "no_active_session"
	| "active"
	| "memory_only"
	| "observer_error"
	| "closed"
	| "session_changed";
interface Metric {
	count: number;
	totalMs: number;
	maxMs: number;
}
interface Health {
	recordsPersisted: number;
	recordsInMemory: number;
	bufferedRecords: number;
	droppedRecords: number;
	writeErrors: number;
	windowsObserved: number;
	inputDispatches: number;
	frames: number;
}
export interface CoreTelemetryStatus {
	capabilityVersion: 2;
	configured: boolean;
	live: boolean;
	reason: Reason;
	coverage: "process_event_loop_and_owned_tui_callbacks";
	persistence: "history" | "memory" | "none";
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
export interface CoreTelemetryDependencies {
	monitor(): DelayHistogram;
	now(): number;
}
const defaults: CoreTelemetryDependencies = {
	monitor: () => monitorEventLoopDelay({ resolution: CORE_TELEMETRY_LIMITS.resolutionMs }),
	now: () => performance.now(),
};
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

/** Actual-session owner. Timers only buffer windows; disk IO belongs to normal history commits. */
export class CoreTelemetry {
	private readonly manager: SessionManager;
	private readonly dependencies: CoreTelemetryDependencies;
	private readonly sessionId: string;
	private generation: number;
	private live = true;
	private reason: Reason;
	private metrics = emptyMetrics();
	private histogram: DelayHistogram | undefined;
	private timer: NodeJS.Timeout | undefined;
	private unsubscribe: (() => void) | undefined;
	private tui: object | undefined;
	private previousTime: number;
	private windows = 0;
	private activity = false;
	private readonly health: Health = {
		recordsPersisted: 0,
		recordsInMemory: 0,
		bufferedRecords: 0,
		droppedRecords: 0,
		writeErrors: 0,
		windowsObserved: 0,
		inputDispatches: 0,
		frames: 0,
	};
	private readonly observe: TuiResponsivenessObserver = (kind, durationMs) => {
		if (!this.live || !Object.hasOwn(this.metrics, kind) || !Number.isFinite(durationMs) || durationMs < 0) return;
		const metric = this.metrics[kind];
		const duration = milliseconds(durationMs)!;
		metric.count = count(metric.count + 1);
		metric.totalMs = Math.min(Number.MAX_SAFE_INTEGER, metric.totalMs + duration);
		metric.maxMs = Math.max(metric.maxMs, duration);
		this.activity = true;
		if (kind === "input_dispatch") this.health.inputDispatches = count(this.health.inputDispatches + 1);
		if (kind === "render") this.health.frames = count(this.health.frames + 1);
	};
	constructor(manager: SessionManager, dependencies: CoreTelemetryDependencies) {
		this.manager = manager;
		this.dependencies = dependencies;
		this.sessionId = manager.getSessionId();
		this.generation = manager.getCoreTelemetryGeneration();
		this.reason = manager.isPersisted() ? "active" : "memory_only";
		this.previousTime = 0;
		try {
			this.previousTime = dependencies.now();
			this.histogram = dependencies.monitor();
			this.histogram.enable();
			this.timer = setInterval(() => this.sample(), CORE_TELEMETRY_LIMITS.cadenceMs);
			this.timer.unref();
		} catch {
			this.detach("observer_error");
		}
	}
	status(): CoreTelemetryStatus {
		if (this.manager.getSessionId() !== this.sessionId && this.live) this.detach("session_changed");
		return {
			capabilityVersion: 2,
			configured: true,
			live: this.live,
			reason: this.reason,
			coverage: "process_event_loop_and_owned_tui_callbacks",
			persistence: this.manager.isPersisted() ? "history" : "memory",
			health: { ...this.health },
		};
	}
	/** Scoped to this UI only. No global subscription that can mix concurrent SDK sessions. */
	attachTui(tui?: object): void {
		if (this.tui === tui) return;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.tui = tui;
		if (tui && this.live) {
			try {
				this.unsubscribe = subscribeTuiResponsiveness(this.observe, tui);
			} catch {
				this.detach("observer_error");
			}
		}
	}
	private detach(reason: Reason): void {
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
	/** Aggregate only: no disk, per-event objects, caller data or public render events. */
	sample(final = false): void {
		if (!this.live) return;
		try {
			if (this.manager.getSessionId() !== this.sessionId) {
				this.detach("session_changed");
				return;
			}
			const now = this.dependencies.now();
			const histogram = this.histogram!;
			if (this.generation !== this.manager.getCoreTelemetryGeneration()) {
				this.generation = this.manager.getCoreTelemetryGeneration();
				this.metrics = emptyMetrics();
				this.previousTime = now;
				this.activity = false;
				histogram.reset();
				return;
			}
			const elapsed = now - this.previousTime;
			if (!this.activity && elapsed < CORE_TELEMETRY_LIMITS.idleMs && (!final || histogram.count === 0)) return;
			const samples = count(histogram.count);
			this.windows = count(this.windows + 1);
			const record = {
				schema: "pi.core-responsiveness",
				schemaVersion: 2,
				window: this.windows,
				windowMs: milliseconds(elapsed),
				metrics: this.metrics,
				eventLoop: {
					scope: "process",
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
			this.activity = false;
			histogram.reset();
			this.health.windowsObserved = count(this.health.windowsObserved + 1);
			this.health.bufferedRecords++;
			this.manager.bufferCoreTelemetry(record, (result) => {
				this.health.bufferedRecords = Math.max(0, this.health.bufferedRecords - 1);
				if (result === "persisted") this.health.recordsPersisted = count(this.health.recordsPersisted + 1);
				else if (result === "memory") this.health.recordsInMemory = count(this.health.recordsInMemory + 1);
				else {
					this.health.droppedRecords = count(this.health.droppedRecords + 1);
					if (result === "error") this.health.writeErrors = count(this.health.writeErrors + 1);
				}
			});
		} catch {
			this.health.droppedRecords = count(this.health.droppedRecords + 1);
			this.detach("observer_error");
		}
	}
	/** Detach now. Graceful callers may append the bounded final batch using existing synchronous history IO. */
	close(persist = true): void {
		if (this.live) {
			if (persist) this.sample(true);
			this.detach("closed");
		}
		if (persist && this.manager.getSessionId() === this.sessionId) this.manager.flushCoreTelemetry();
	}
}

/** Exact opt-out only. The disabled branch constructs nothing or touches telemetry clocks/timers/IO. */
export function createCoreTelemetry(
	manager: SessionManager,
	env: NodeJS.ProcessEnv = process.env,
	dependencies: CoreTelemetryDependencies = defaults,
): CoreTelemetry | undefined {
	return env.PI_CORE_TELEMETRY === "0" ? undefined : new CoreTelemetry(manager, dependencies);
}
/** Snapshot only; no process-global owner or synthetic session. */
export function getCoreTelemetryStatus(owner?: CoreTelemetry): CoreTelemetryStatus {
	if (owner) return owner.status();
	const configured = process.env.PI_CORE_TELEMETRY !== "0";
	return {
		capabilityVersion: 2,
		configured,
		live: false,
		reason: configured ? "no_active_session" : "disabled",
		coverage: "process_event_loop_and_owned_tui_callbacks",
		persistence: "none",
		health: null,
	};
}
