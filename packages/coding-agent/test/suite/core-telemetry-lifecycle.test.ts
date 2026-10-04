import { chmod, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { Terminal } from "@earendil-works/pi-tui";
import { expect, test, vi } from "vitest";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { getCoreTelemetryStatus, startCoreTelemetry, stopCoreTelemetry } from "../../src/core/core-telemetry.ts";
import { formatRuntimeInfo, getRuntimeInfo } from "../../src/core/runtime-info.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { createHarness, getAssistantTexts } from "./harness.ts";

vi.mock("../../src/utils/tools-manager.ts", () => ({ ensureTool: async (name: string) => `/tmp/${name}` }));
vi.mock("../../src/utils/syntax-highlight.ts", () => ({ loadAllHighlightLanguages: async () => {} }));

class TestTerminal implements Terminal {
	columns = 80;
	rows = 24;
	kittyProtocolActive = false;
	input: ((data: string) => void) | undefined;
	start(input: (data: string) => void): void {
		this.input = input;
	}
	stop(): void {
		this.input = undefined;
	}
	async drainInput(): Promise<void> {}
	write(): void {}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
}

test.each([false, true])(
	"InteractiveMode lifecycle records input/frames and drains before graceful exit (signal=%s) without extra model calls",
	async (fromSignal) => {
		vi.useFakeTimers();
		initTheme("dark");
		const directory = await mkdtemp(join(tmpdir(), "pi-core-lifecycle-"));
		await chmod(directory, 0o700);
		vi.stubEnv("PI_CORE_TELEMETRY", "1");
		vi.stubEnv("PI_CORE_TELEMETRY_DIR", directory);
		const harness = await createHarness({
			settings: { tuiMode: "regular", terminal: { showTerminalProgress: false }, quietStartup: true },
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
		const terminal = new TestTerminal();
		const mode = new InteractiveMode(runtime, { terminal });
		const recorder = startCoreTelemetry()!;
		try {
			await recorder.ready;
			expect(startCoreTelemetry()).toBe(recorder);
			const initializing = mode.init();
			await vi.advanceTimersByTimeAsync(100);
			await initializing;
			terminal.input!("private input");
			await vi.advanceTimersByTimeAsync(20);
			harness.setResponses([fauxAssistantMessage("private result")]);
			await harness.session.prompt("private prompt");
			expect(getAssistantTexts(harness)).toEqual(["private result"]);
			expect(harness.getPendingResponseCount()).toBe(0);
			await recorder.sample();
			const snapshot = getRuntimeInfo(harness.session.modelRuntime, []);
			expect(snapshot.responsiveness).toMatchObject({
				configured: true,
				live: true,
				health: { inputDispatches: 1 },
			});
			expect(snapshot.responsiveness.health!.frames).toBeGreaterThan(0);
			expect(formatRuntimeInfo(snapshot)).toContain("configured=true live=true");
			mode.stop();
			await stopCoreTelemetry();
			expect(recorder.status().live).toBe(false);
			const records = await readdir(directory);
			for (const name of records)
				expect(await readFile(join(directory, name), "utf8")).not.toMatch(/private|prompt|result|input body/);
			const again = startCoreTelemetry()!;
			await again.ready;
			expect(again).not.toBe(recorder);
			expect(getCoreTelemetryStatus().health!.inputDispatches).toBe(0);
			const exit = new Error("fixture exit");
			const exiting = vi.spyOn(process, "exit").mockImplementation(() => {
				expect(again.status().live).toBe(false);
				expect(again.status().health!.queuedRecords).toBe(0);
				throw exit;
			});
			const shutdownMode = mode as unknown as { shutdown(options: { fromSignal: boolean }): Promise<void> };
			await expect(shutdownMode.shutdown({ fromSignal })).rejects.toBe(exit);
			expect(exiting).toHaveBeenCalledWith(0);
			expect(await readdir(directory)).not.toContain("core-telemetry.lock");
			exiting.mockRestore();
		} finally {
			vi.restoreAllMocks();
			mode.stop();
			await stopCoreTelemetry();
			harness.cleanup();
			vi.unstubAllEnvs();
			vi.useRealTimers();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
