import { existsSync } from "node:fs";
import { chmod, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { startCoreTelemetry, stopCoreTelemetry } from "../../src/core/core-telemetry.ts";
import { runPrintMode } from "../../src/modes/print-mode.ts";
import { runRpcMode } from "../../src/modes/rpc/rpc-mode.ts";
import { createHarness } from "./harness.ts";

const output = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock("../../src/core/output-guard.ts", () => ({
	flushRawStdout: async () => {
		output.order.push("flush");
	},
	takeOverStdout: () => {},
	waitForRawStdoutBackpressure: async () => {},
	writeRawStdout: () => {},
}));

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

// Review P1: main's finally cannot drain captures when a mode calls process.exit().
test.each([
	["rpc", "eof", 0],
	["rpc", "extension", 0],
	["rpc", "SIGTERM", 143],
	["rpc", "SIGHUP", 129],
	["print", "SIGTERM", 143],
	["print", "SIGHUP", 129],
] as const)("%s %s drains telemetry before exit %s and permits a fresh capture", async (mode, trigger, code) => {
	const directory = await mkdtemp(join(tmpdir(), "pi-core-noninteractive-"));
	await chmod(directory, 0o700);
	vi.stubEnv("PI_CORE_TELEMETRY", "1");
	vi.stubEnv("PI_CORE_TELEMETRY_DIR", directory);
	output.order = [];
	const harness = await createHarness({
		extensionFactories: [
			(pi) => {
				pi.registerCommand("fixture-quit", {
					description: "Fixture shutdown",
					handler: async (_args, ctx) => {
						ctx.shutdown();
					},
				});
			},
		],
	});
	const runtime = new AgentSessionRuntime(
		harness.session,
		{
			cwd: harness.tempDir,
			agentDir: harness.tempDir,
			modelRuntime: harness.session.modelRuntime,
			settingsManager: harness.settingsManager,
			resourceLoader: harness.session.resourceLoader,
			diagnostics: [],
		},
		async () => {
			throw new Error("Unused runtime replacement");
		},
	);
	const dispose = runtime.dispose.bind(runtime);
	vi.spyOn(runtime, "dispose").mockImplementation(async () => {
		await dispose();
		output.order.push("dispose");
	});
	const input = new PassThrough();
	vi.spyOn(process, "stdin", "get").mockReturnValue(input as unknown as typeof process.stdin);
	const signals = new Map<NodeJS.Signals, () => void>();
	const originalOn = process.on.bind(process);
	vi.spyOn(process, "on").mockImplementation((event, listener) => {
		if (event === "SIGTERM" || event === "SIGHUP") {
			signals.set(event, listener);
			return process;
		}
		return originalOn(event, listener);
	});
	const exited = deferred();
	const releasePrint = deferred();
	const printReady = deferred();
	const recorder = startCoreTelemetry()!;
	let atExit: { live: boolean; queuedRecords: number; recordsWritten: number; lockExists: boolean } | undefined;
	const exit = vi.spyOn(process, "exit").mockImplementation(() => {
		const status = recorder.status();
		atExit = {
			live: status.live,
			queuedRecords: status.health!.queuedRecords,
			recordsWritten: status.health!.recordsWritten,
			lockExists: existsSync(join(directory, "core-telemetry.lock")),
		};
		exited.resolve();
		return undefined as never;
	});
	let printing: Promise<number> | undefined;
	try {
		await recorder.ready;
		expect(recorder.status().reason).toBe("active");
		if (mode === "rpc") {
			void runRpcMode(runtime);
			await vi.waitFor(() => expect(input.listenerCount("data")).toBe(1));
			if (trigger === "eof") input.end();
			else if (trigger === "extension")
				input.write(`${JSON.stringify({ type: "prompt", message: "/fixture-quit" })}\n`);
			else signals.get(trigger)!();
		} else {
			const bind = harness.session.bindExtensions.bind(harness.session);
			vi.spyOn(harness.session, "bindExtensions").mockImplementation(async (options) => {
				await bind(options);
				printReady.resolve();
				await releasePrint.promise;
			});
			printing = runPrintMode(runtime, { mode: "text" });
			await printReady.promise;
			signals.get(trigger as NodeJS.Signals)!();
		}
		await exited.promise;
		expect(exit).toHaveBeenCalledWith(code);
		expect(atExit).toEqual({ live: false, queuedRecords: 0, recordsWritten: 1, lockExists: false });
		expect(output.order).toEqual(mode === "rpc" && trigger !== "SIGTERM" ? ["dispose", "flush"] : ["dispose"]);
		const files = await readdir(directory);
		expect(files).toEqual(["core-telemetry-0.json"]);
		const record = JSON.parse(await readFile(join(directory, files[0]!), "utf8"));
		expect(record).toMatchObject({ schema: "pi.core-responsiveness", schemaVersion: 1, window: 1 });
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.eventsOfType("agent_start")).toHaveLength(0);
		const again = startCoreTelemetry()!;
		expect(again).not.toBe(recorder);
		await again.ready;
		expect(again.status().reason).toBe("active");
		await stopCoreTelemetry();
	} finally {
		releasePrint.resolve();
		await printing;
		input.destroy();
		await stopCoreTelemetry();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		harness.cleanup();
		await rm(directory, { recursive: true, force: true });
	}
});
