import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as perf from "node:perf_hooks";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { runPrintMode } from "../../src/modes/print-mode.ts";
import { runRpcMode } from "../../src/modes/rpc/rpc-mode.ts";
import { createHarness } from "./harness.ts";

vi.mock("node:perf_hooks", { spy: true });
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

// Hard exits must finalize the actual session owner; main's finally cannot intercept process.exit().
test.each([
	["rpc", "eof", 0],
	["rpc", "extension", 0],
	["rpc", "SIGTERM", 143],
	["rpc", "SIGHUP", 129],
	["print", "normal", 0],
	["print", "SIGTERM", 143],
	["print", "SIGHUP", 129],
] as const)("%s %s finalizes session history before exit %s", async (mode, trigger, code) => {
	const directory = await mkdtemp(join(tmpdir(), "pi-core-noninteractive-"));
	vi.stubEnv("PI_CORE_TELEMETRY", undefined);
	const histogram = {
		count: 1,
		min: 20e6,
		max: 20e6,
		mean: 20e6,
		percentile: () => 20e6,
		enable() {},
		disable() {},
		reset() {
			this.count = 0;
		},
	};
	vi.spyOn(perf, "monitorEventLoopDelay").mockReturnValue(
		histogram as unknown as ReturnType<typeof perf.monitorEventLoopDelay>,
	);
	output.order = [];
	const harness = await createHarness({
		sessionManager: SessionManager.create(directory, directory),
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
	harness.session.sessionManager.appendMessage({ role: "user", content: "ordinary fixture", timestamp: 1 });
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
	const recorder = harness.session.coreTelemetry!;
	let atExit: { live: boolean; bufferedRecords: number; recordsPersisted: number } | undefined;
	const exit = vi.spyOn(process, "exit").mockImplementation(() => {
		const status = recorder.status();
		atExit = {
			live: status.live,
			bufferedRecords: status.health!.bufferedRecords,
			recordsPersisted: status.health!.recordsPersisted,
		};
		exited.resolve();
		return undefined as never;
	});
	let printing: Promise<number> | undefined;
	try {
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
			if (trigger === "normal") {
				releasePrint.resolve();
				expect(await printing).toBe(0);
				const status = recorder.status();
				atExit = {
					live: status.live,
					bufferedRecords: status.health!.bufferedRecords,
					recordsPersisted: status.health!.recordsPersisted,
				};
				exited.resolve();
			} else signals.get(trigger as NodeJS.Signals)!();
		}
		await exited.promise;
		if (trigger === "normal") expect(exit).not.toHaveBeenCalled();
		else expect(exit).toHaveBeenCalledWith(code);
		expect(atExit).toEqual({ live: false, bufferedRecords: 0, recordsPersisted: 1 });
		expect(output.order).toEqual(
			(mode === "rpc" && trigger !== "SIGTERM") || trigger === "normal" ? ["dispose", "flush"] : ["dispose"],
		);
		const files = await readdir(directory);
		expect(files).toEqual([harness.session.sessionFile!.split("/").at(-1)]);
		const entries = (await readFile(harness.session.sessionFile!, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(entries.at(-1)).toMatchObject({
			type: "custom",
			customType: "pi.core-responsiveness",
			data: { schema: "pi.core-responsiveness", schemaVersion: 2, window: 1 },
		});
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.eventsOfType("agent_start")).toHaveLength(0);
		expect(SessionManager.open(harness.session.sessionFile!).buildSessionContext().messages).toHaveLength(1);
	} finally {
		releasePrint.resolve();
		await printing;
		input.destroy();
		recorder?.close();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		harness.cleanup();
		await rm(directory, { recursive: true, force: true });
	}
});
