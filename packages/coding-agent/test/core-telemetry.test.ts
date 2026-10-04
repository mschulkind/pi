import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	CORE_TELEMETRY_LIMITS,
	type CoreTelemetryDependencies,
	createCoreTelemetry,
	getCoreTelemetryStatus,
} from "../src/core/core-telemetry.ts";

const roots: string[] = [];
afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function directory() {
	const root = await fs.mkdtemp(join(tmpdir(), "pi-core-telemetry-"));
	roots.push(root);
	await fs.chmod(root, 0o700);
	return root;
}
function harness(io: CoreTelemetryDependencies["io"] = fs) {
	let observer: ((kind: string, duration: number) => void) | undefined;
	const histogram = {
		count: 0,
		min: 1e7,
		max: 3e7,
		mean: 2e7,
		percentile: vi.fn(() => 3e7),
		reset: vi.fn(),
		enable: vi.fn(),
		disable: vi.fn(),
	};
	const dependencies = {
		io,
		monitor: () => histogram,
		subscribe: vi.fn((callback) => {
			observer = callback;
			return () => {
				observer = undefined;
			};
		}),
		now: () => 100,
	} satisfies CoreTelemetryDependencies;
	return { dependencies, histogram, emit: (kind: string, ms = 0) => observer?.(kind, ms) };
}

it.each([
	{},
	{ PI_CORE_TELEMETRY_DIR: "/tmp/unused" },
	{ PI_CORE_TELEMETRY: "0", PI_CORE_TELEMETRY_DIR: "/tmp/unused", YOLO_DURABLE_DIR: "/tmp/unused" },
	{ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: "relative" },
	{ PI_CORE_TELEMETRY: "true", PI_CORE_TELEMETRY_DIR: "/tmp/unused" },
])("disabled factory is inert for %j", (env) => {
	const h = harness({ ...fs });
	const monitor = vi.spyOn(h.dependencies, "monitor");
	const now = vi.spyOn(h.dependencies, "now");
	const interval = vi.spyOn(globalThis, "setInterval");
	const io = vi.spyOn(h.dependencies.io, "lstat");
	expect(createCoreTelemetry(env, h.dependencies)).toBeUndefined();
	expect(monitor).not.toHaveBeenCalled();
	expect(now).not.toHaveBeenCalled();
	expect(interval).not.toHaveBeenCalled();
	interval.mockRestore();
	expect(io).not.toHaveBeenCalled();
	expect(h.dependencies.subscribe).not.toHaveBeenCalled();
	io.mockRestore();
});

it("persists private bounded sanitized sample windows, unknown is not zero, and rotates two files", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	const h = harness();
	const recorder = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await recorder.ready;
	expect(recorder.status()).toMatchObject({ configured: true, live: true, health: { recordsWritten: 0 } });
	h.emit("input_dispatch", 3);
	h.emit("render", 7);
	h.emit("render_wait", 5);
	h.emit("secret prompt https://secret/path", 4);
	h.emit("render", NaN);
	h.emit("render", Infinity);
	h.emit("render", -1);
	h.emit("render", 1e99);
	await recorder.sample();
	let records = await fs.readdir(dir);
	const first = JSON.parse(await fs.readFile(join(dir, records.find((name) => name.endsWith(".json"))!), "utf8"));
	expect(first.eventLoop).toEqual({ samples: 0, minMs: null, maxMs: null, meanMs: null, p99Ms: null });
	expect(first.metrics.render).toEqual({
		count: 2,
		totalMs: CORE_TELEMETRY_LIMITS.maxDurationMs + 7,
		maxMs: CORE_TELEMETRY_LIMITS.maxDurationMs,
	});
	expect(JSON.stringify(first)).not.toMatch(/secret|https|path|NaN|Infinity/);
	h.histogram.count = 4;
	await recorder.sample();
	await recorder.sample();
	records = await fs.readdir(dir);
	expect(records.filter((name) => name.endsWith(".json"))).toHaveLength(2);
	for (const name of records) expect((await fs.lstat(join(dir, name))).mode & 0o777).toBe(0o600);
	const latest = JSON.parse(await fs.readFile(join(dir, "core-telemetry-0.json"), "utf8"));
	expect(latest.eventLoop).toEqual({ samples: 4, minMs: 10, maxMs: 30, meanMs: 20, p99Ms: 30 });
	await recorder.close();
	expect(h.histogram.disable).toHaveBeenCalledOnce();
	expect(recorder.status().live).toBe(false);
	expect(await fs.readdir(dir)).not.toContain("core-telemetry.lock");
});

it("blocked writer bounds queue, cadence and shutdown; late cleanup cannot steal a new owner", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	const h = harness();
	let release!: () => void;
	let enteredWrite!: () => void;
	const writeStarted = new Promise<void>((resolve) => {
		enteredWrite = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const io = {
		...fs,
		open: vi.fn(async (...args: Parameters<typeof fs.open>) => {
			const file = await fs.open(...args);
			if (String(args[0]).endsWith(".tmp")) {
				const writeFile = file.writeFile.bind(file);
				vi.spyOn(file, "writeFile").mockImplementation(async (...writeArgs) => {
					enteredWrite();
					await blocked;
					return writeFile(...writeArgs);
				});
			}
			return file;
		}),
	};
	h.dependencies.io = io;
	const recorder = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await recorder.ready;
	const writing = recorder.sample();
	await writeStarted;
	for (let i = 0; i < 100; i++) {
		h.emit("render", 1);
		void recorder.sample();
	}
	expect(recorder.status().health!.queuedRecords).toBeLessThanOrEqual(2);
	expect(recorder.status().health!.droppedRecords).toBeGreaterThan(90);
	const closing = recorder.close();
	await vi.advanceTimersByTimeAsync(CORE_TELEMETRY_LIMITS.shutdownMs);
	await closing;
	expect(recorder.status()).toMatchObject({ live: false, reason: "shutdown_timeout", health: { queuedRecords: 0 } });
	release();
	await writing;
	await recorder.settled;
	expect(await fs.readdir(dir)).not.toContain("core-telemetry.lock");
	expect(await fs.readdir(dir)).not.toContain("core-telemetry-0.json");
});

it("fails closed for public directories, symlink ancestors and concurrent owners; repeat lifecycles reset", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	const publicDir = join(dir, "public");
	await fs.mkdir(publicDir, { mode: 0o755 });
	const env = (path: string) => ({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: path });
	const bad = createCoreTelemetry(env(publicDir), harness().dependencies)!;
	await bad.ready;
	expect(bad.status()).toMatchObject({ live: false, reason: "storage_error" });
	await bad.close();
	await fs.symlink(dir, join(dir, "link"));
	const link = createCoreTelemetry(env(join(dir, "link", "child")), harness().dependencies)!;
	await link.ready;
	expect(link.status().reason).toBe("storage_error");
	await link.close();
	const first = createCoreTelemetry(env(dir), harness().dependencies)!;
	await first.ready;
	const second = createCoreTelemetry(env(dir), harness().dependencies)!;
	await second.ready;
	expect(second.status().reason).toBe("storage_error");
	await second.close();
	expect((await fs.lstat(join(dir, "core-telemetry.lock"))).isFile()).toBe(true);
	await first.close();
	const again = createCoreTelemetry(env(dir), harness().dependencies)!;
	await again.ready;
	expect(again.status().health!.recordsWritten).toBe(0);
	await again.close();
});

it("writer errors remain metadata-only and stop all observers and timers", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	const h = harness({
		...fs,
		rename: async () => {
			throw new Error("secret credentials/path");
		},
	});
	const recorder = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await recorder.ready;
	await recorder.sample();
	await recorder.close();
	expect(recorder.status()).toMatchObject({ live: false, reason: "storage_error", health: { writeErrors: 1 } });
	expect(JSON.stringify(recorder.status())).not.toMatch(/secret|credentials|path/);
	expect(vi.getTimerCount()).toBe(0);
	expect(constants.O_NOFOLLOW).toBeGreaterThan(0);
});

it("runtime configuration is not live capture or observed zero", () => {
	vi.stubEnv("PI_CORE_TELEMETRY", "1");
	vi.stubEnv("PI_CORE_TELEMETRY_DIR", "/tmp/not-started-core-telemetry");
	expect(getCoreTelemetryStatus()).toMatchObject({
		configured: true,
		live: false,
		reason: "not_started",
		health: null,
	});
	vi.stubEnv("PI_CORE_TELEMETRY", "0");
	expect(getCoreTelemetryStatus()).toMatchObject({ configured: false, live: false, reason: "disabled", health: null });
	vi.stubEnv("PI_CORE_TELEMETRY", "1");
	vi.stubEnv("PI_CORE_TELEMETRY_DIR", "relative");
	expect(getCoreTelemetryStatus()).toMatchObject({
		configured: false,
		live: false,
		reason: "invalid_directory",
		health: null,
	});
});

it("cadence and capture limits halt and release storage without requiring explicit close", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	const h = harness();
	const recorder = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await recorder.ready;
	await vi.advanceTimersByTimeAsync(CORE_TELEMETRY_LIMITS.cadenceMs - 1);
	expect(recorder.status().health!.windowsObserved).toBe(0);
	await vi.advanceTimersByTimeAsync(1);
	await recorder.settled;
	expect(recorder.status().health!.windowsObserved).toBe(1);
	expect(await fs.readdir(dir)).toContain("core-telemetry.lock");
	for (let i = 1; i < CORE_TELEMETRY_LIMITS.maxWindows; i++) await recorder.sample();
	await recorder.settled;
	expect(recorder.status()).toMatchObject({ live: false, reason: "limit", health: { windowsObserved: 120 } });
	expect(vi.getTimerCount()).toBe(0);
	expect(h.histogram.disable).toHaveBeenCalledOnce();
	expect(await fs.readdir(dir)).not.toContain("core-telemetry.lock");
	for (const name of await fs.readdir(dir)) {
		const bytes = (await fs.lstat(join(dir, name))).size;
		expect(bytes).toBeLessThanOrEqual(CORE_TELEMETRY_LIMITS.maxRecordBytes);
	}
	expect(recorder.status().health!.bytesWritten).toBeLessThanOrEqual(CORE_TELEMETRY_LIMITS.maxSessionBytes);
});

it("elapsed capture deadline halts after a delayed window", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	const h = harness();
	const recorder = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await recorder.ready;
	h.dependencies.now = () => 100 + CORE_TELEMETRY_LIMITS.maxDurationMs;
	await recorder.sample();
	await recorder.settled;
	expect(recorder.status()).toMatchObject({ live: false, reason: "limit", health: { windowsObserved: 1 } });
	expect(vi.getTimerCount()).toBe(0);
});

it.each(["symlink", "hardlink"])("rejects unsafe %s output slots without changing the target", async (kind) => {
	vi.useFakeTimers();
	const dir = await directory();
	const target = join(dir, "untouched");
	await fs.writeFile(target, "private sentinel", { mode: 0o600 });
	const slot = join(dir, "core-telemetry-0.json");
	if (kind === "symlink") await fs.symlink(target, slot);
	else await fs.link(target, slot);
	const h = harness();
	const recorder = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await recorder.ready;
	await recorder.close();
	expect(recorder.status()).toMatchObject({ live: false, reason: "storage_error" });
	expect(await fs.readFile(target, "utf8")).toBe("private sentinel");
	expect(await fs.readdir(dir)).not.toContain("core-telemetry.lock");
});

it("late initialization after shutdown timeout releases only its acquired lock", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	let release!: () => void;
	let enteredOpen!: () => void;
	const entered = new Promise<void>((resolve) => {
		enteredOpen = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const h = harness({
		...fs,
		open: async (...args: Parameters<typeof fs.open>) => {
			enteredOpen();
			await blocked;
			return fs.open(...args);
		},
	});
	const recorder = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await entered;
	const closing = recorder.close();
	await vi.advanceTimersByTimeAsync(CORE_TELEMETRY_LIMITS.shutdownMs);
	await closing;
	release();
	await recorder.settled;
	expect(recorder.status()).toMatchObject({ live: false, reason: "shutdown_timeout" });
	expect(await fs.readdir(dir)).not.toContain("core-telemetry.lock");
	expect(vi.getTimerCount()).toBe(0);
});

it("cleanup never unlinks a lock whose inode no longer belongs to this capture", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	const h = harness();
	const recorder = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await recorder.ready;
	const lock = join(dir, "core-telemetry.lock");
	await fs.rename(lock, join(dir, "old-owner-lock"));
	await fs.writeFile(lock, "replacement owner", { mode: 0o600 });
	await recorder.close();
	expect(await fs.readFile(lock, "utf8")).toBe("replacement owner");
	expect(vi.getTimerCount()).toBe(0);
});

it("observer setup and sampling failures detach diagnostics without leaking private errors", async () => {
	vi.useFakeTimers();
	const dir = await directory();
	const h = harness();
	h.dependencies.subscribe = vi.fn(() => {
		throw new Error("private observer failure");
	});
	const setup = createCoreTelemetry({ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir }, h.dependencies)!;
	await setup.ready;
	await setup.close();
	expect(setup.status()).toMatchObject({ live: false, reason: "observer_error" });
	expect(h.histogram.disable).toHaveBeenCalledOnce();
	const sampleHarness = harness();
	sampleHarness.histogram.count = 1;
	sampleHarness.histogram.percentile.mockImplementation(() => {
		throw new Error("private histogram failure");
	});
	const sample = createCoreTelemetry(
		{ PI_CORE_TELEMETRY: "1", PI_CORE_TELEMETRY_DIR: dir },
		sampleHarness.dependencies,
	)!;
	await sample.ready;
	await sample.sample();
	await sample.settled;
	expect(sample.status()).toMatchObject({ live: false, reason: "observer_error", health: { droppedRecords: 1 } });
	expect(JSON.stringify(sample.status())).not.toMatch(/private|histogram failure/);
	expect(vi.getTimerCount()).toBe(0);
	expect(await fs.readdir(dir)).not.toContain("core-telemetry.lock");
});
