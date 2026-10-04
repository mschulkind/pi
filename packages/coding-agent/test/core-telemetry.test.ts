import { performance } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import { getTuiResponsivenessObservation } from "../../tui/src/responsiveness.ts";
import { CORE_TELEMETRY_LIMITS, createCoreTelemetry, getCoreTelemetryStatus } from "../src/core/core-telemetry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});
function fixture(env: NodeJS.ProcessEnv = {}) {
	const manager = SessionManager.inMemory();
	let now = 0;
	const histogram = {
		count: 0,
		min: 10e6,
		max: 30e6,
		mean: 20e6,
		percentile: vi.fn(() => 30e6),
		enable: vi.fn(),
		disable: vi.fn(),
		reset: vi.fn(() => {
			histogram.count = 0;
		}),
	};
	const clock = vi.fn(() => now);
	const monitor = vi.fn(() => histogram);
	const owner = createCoreTelemetry(manager, env, { now: clock, monitor });
	const ui = {};
	owner?.attachTui(ui);
	return {
		owner,
		manager,
		histogram,
		clock,
		monitor,
		advance: (ms = 5000) => {
			now += ms;
		},
		emit: (kind: string, ms = 0) => getTuiResponsivenessObservation(ui)?.emit(kind as "render", ms),
	};
}
function data(manager: SessionManager) {
	return manager
		.getEntries()
		.filter((entry) => entry.type === "custom" && entry.customType === "pi.core-responsiveness")
		.map((entry) =>
			entry.type === "custom"
				? (entry.data as {
						metrics: Record<string, { count: number; totalMs: number; maxMs: number }>;
						eventLoop: object;
						losses: object;
					})
				: undefined,
		);
}
it("exact opt-out is inert; default-on needs no directory or Yolo condition", () => {
	const interval = vi.spyOn(globalThis, "setInterval");
	const off = fixture({ PI_CORE_TELEMETRY: "0", PI_CORE_TELEMETRY_DIR: "/ignored" });
	expect(off.owner).toBeUndefined();
	expect(off.clock).not.toHaveBeenCalled();
	expect(off.monitor).not.toHaveBeenCalled();
	expect(interval).not.toHaveBeenCalled();
	for (const env of [{}, { PI_CORE_TELEMETRY: "false" }, { PI_CORE_TELEMETRY_DIR: "relative" }]) {
		const f = fixture(env);
		expect(f.owner!.status()).toMatchObject({ live: true, persistence: "memory" });
		f.owner!.close();
	}
	for (const result of interval.mock.results) if (result.type === "return") expect(result.value.hasRef()).toBe(false);
});
it("scalar windows sanitize fixed categories and durations; unsampled loop delay is unknown, not zero", () => {
	const f = fixture();
	try {
		f.emit("input_dispatch", 3);
		f.emit("render", 7);
		f.emit("render", 1e99);
		for (const duration of [NaN, Infinity, -1]) f.emit("render", duration);
		f.emit("secret prompt https://secret/path", 4);
		f.advance();
		f.owner!.sample();
		f.manager.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
		expect(data(f.manager)[0]!.metrics.render).toEqual({
			count: 2,
			totalMs: CORE_TELEMETRY_LIMITS.maxDurationMs + 7,
			maxMs: CORE_TELEMETRY_LIMITS.maxDurationMs,
		});
		expect(data(f.manager)[0]!.eventLoop).toEqual({
			scope: "process",
			samples: 0,
			minMs: null,
			maxMs: null,
			meanMs: null,
			p99Ms: null,
		});
		expect(JSON.stringify(data(f.manager))).not.toMatch(/secret|https|NaN|Infinity/);
		f.histogram.count = 4;
		f.advance(60000);
		f.owner!.sample();
		f.owner!.close();
		expect(data(f.manager)[1]!.eventLoop).toEqual({
			scope: "process",
			samples: 4,
			minMs: 10,
			maxMs: 30,
			meanMs: 20,
			p99Ms: 30,
		});
	} finally {
		f.owner?.close();
	}
});
it("idle cadence is unref'ed, buffers only, and continues beyond ten minutes with counted drops", () => {
	vi.useFakeTimers();
	const f = fixture();
	try {
		expect(vi.getTimerCount()).toBe(1);
		f.advance(59000);
		f.owner!.sample();
		expect(f.owner!.status().health!.windowsObserved).toBe(0);
		for (let i = 0; i < 121; i++) {
			f.advance(60000);
			f.owner!.sample();
		}
		expect(f.owner!.status()).toMatchObject({
			live: true,
			health: { bufferedRecords: 2, windowsObserved: 121, droppedRecords: 119 },
		});
		expect(f.manager.getEntries()).toHaveLength(0);
	} finally {
		f.owner!.close();
	}
	expect(vi.getTimerCount()).toBe(0);
	expect(f.histogram.disable).toHaveBeenCalledOnce();
});
it("sampling cannot request renders or mix concurrent UI observations", () => {
	const first = fixture();
	const second = fixture();
	try {
		first.emit("input_dispatch", 1);
		first.advance();
		first.owner!.sample();
		second.advance();
		second.owner!.sample();
		expect(first.owner!.status().health!.inputDispatches).toBe(1);
		expect(second.owner!.status().health!.inputDispatches).toBe(0);
		expect(second.owner!.status().health!.windowsObserved).toBe(0);
		first.owner!.close();
		second.emit("render", 2);
		expect(second.owner!.status().health!.frames).toBe(1);
	} finally {
		first.owner!.close();
		second.owner!.close();
	}
});
it("setup and histogram errors detach timers/observers and never expose arbitrary errors", () => {
	vi.useFakeTimers();
	const manager = SessionManager.inMemory();
	const setup = createCoreTelemetry(
		manager,
		{},
		{
			now: () => {
				throw new Error("private clock");
			},
			monitor: () => {
				throw new Error("private histogram");
			},
		},
	)!;
	expect(setup.status()).toMatchObject({ live: false, reason: "observer_error" });
	const f = fixture();
	f.histogram.count = 1;
	f.histogram.percentile.mockImplementation(() => {
		throw new Error("private percentile");
	});
	f.advance(60000);
	f.owner!.sample();
	expect(f.owner!.status()).toMatchObject({ live: false, reason: "observer_error", health: { droppedRecords: 1 } });
	expect(JSON.stringify(f.owner!.status())).not.toContain("private");
	expect(vi.getTimerCount()).toBe(0);
	f.owner!.close();
});
it("runtime configuration is not observation evidence and status detects changed session identity", () => {
	vi.stubEnv("PI_CORE_TELEMETRY", "1");
	expect(getCoreTelemetryStatus()).toMatchObject({
		configured: true,
		live: false,
		reason: "no_active_session",
		health: null,
	});
	vi.stubEnv("PI_CORE_TELEMETRY", "0");
	expect(getCoreTelemetryStatus()).toMatchObject({ configured: false, live: false, reason: "disabled", health: null });
	const f = fixture();
	f.manager.newSession();
	expect(f.owner!.status()).toMatchObject({ live: false, reason: "session_changed" });
	f.owner!.close();
});
it("crash detachment does not serialize, persist or sample a final window", () => {
	const f = fixture();
	const buffer = vi.spyOn(f.manager, "bufferCoreTelemetry");
	const flush = vi.spyOn(f.manager, "flushCoreTelemetry");
	f.emit("render", 1);
	f.advance();
	f.owner!.close(false);
	expect(buffer).not.toHaveBeenCalled();
	expect(flush).not.toHaveBeenCalled();
	expect(f.histogram.disable).toHaveBeenCalledOnce();
});
it("unsubscribed UI dispatch performs no observer clock work", () => {
	const f = fixture();
	f.owner!.close();
	const clock = vi.spyOn(performance, "now");
	expect(getTuiResponsivenessObservation({})).toBeUndefined();
	expect(clock).not.toHaveBeenCalled();
});
