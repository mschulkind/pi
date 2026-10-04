import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { Terminal } from "@earendil-works/pi-tui";
import { expect, test, vi } from "vitest";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { formatRuntimeInfo, getRuntimeInfo } from "../../src/core/runtime-info.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
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
function runtime(harness: Awaited<ReturnType<typeof createHarness>>) {
	return new AgentSessionRuntime(
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
}

test.each([false, true])(
	"InteractiveMode records owned input/frames in history before graceful exit (signal=%s)",
	async (fromSignal) => {
		vi.useFakeTimers();
		initTheme("dark");
		vi.stubEnv("PI_CORE_TELEMETRY", undefined);
		const directory = await mkdtemp(join(tmpdir(), "pi-history-lifecycle-"));
		const harness = await createHarness({
			sessionManager: SessionManager.create(directory, directory),
			settings: { tuiMode: "regular", terminal: { showTerminalProgress: false }, quietStartup: true },
		});
		const terminal = new TestTerminal();
		const mode = new InteractiveMode(runtime(harness), { terminal });
		try {
			const owner = harness.session.coreTelemetry;
			expect(owner).toBeDefined();
			const initializing = mode.init();
			await vi.advanceTimersByTimeAsync(100);
			await initializing;
			terminal.input!("private input");
			await vi.advanceTimersByTimeAsync(20);
			harness.setResponses([fauxAssistantMessage("private result")]);
			await harness.session.prompt("private prompt");
			expect(getAssistantTexts(harness)).toEqual(["private result"]);
			expect(harness.getPendingResponseCount()).toBe(0);
			owner!.sample();
			const snapshot = getRuntimeInfo(harness.session.modelRuntime, [], owner);
			expect(snapshot.responsiveness).toMatchObject({
				configured: true,
				live: true,
				persistence: "history",
				health: { inputDispatches: 1, bufferedRecords: 1 },
			});
			expect(snapshot.responsiveness.health!.frames).toBeGreaterThan(0);
			expect(formatRuntimeInfo(snapshot)).toContain("configured=true live=true");
			harness.session.sessionManager.appendSessionInfo("fixture");
			const entryRenderer = vi.spyOn(harness.session.extensionRunner, "getEntryRenderer");
			mode.renderInitialMessages();
			expect(entryRenderer).not.toHaveBeenCalledWith("pi.core-responsiveness");
			expect((mode as unknown as { switchTuiMode(mode: "fullscreen"): boolean }).switchTuiMode("fullscreen")).toBe(
				true,
			);
			terminal.input!("private replaced renderer");
			expect(owner!.status().health!.inputDispatches).toBe(2);
			const exit = new Error("fixture exit");
			const exiting = vi.spyOn(process, "exit").mockImplementation(() => {
				expect(owner!.status()).toMatchObject({ live: false, health: { bufferedRecords: 0 } });
				const entries = harness.session.sessionManager
					.getEntries()
					.filter((entry) => entry.type === "custom" && entry.customType === "pi.core-responsiveness");
				expect(entries.length).toBeGreaterThan(0);
				expect(JSON.stringify(entries)).not.toMatch(/private|prompt|result|input body/);
				expect(readFileSync(harness.session.sessionFile!, "utf8")).toContain('"schemaVersion":2');
				throw exit;
			});
			await expect(
				(mode as unknown as { shutdown(options: { fromSignal: boolean }): Promise<void> }).shutdown({ fromSignal }),
			).rejects.toBe(exit);
			expect(exiting).toHaveBeenCalledWith(0);
		} finally {
			vi.restoreAllMocks();
			mode.stop();
			harness.cleanup();
			vi.unstubAllEnvs();
			vi.useRealTimers();
			await rm(directory, { recursive: true, force: true });
		}
	},
);

test("SDK sessions own independent producers and disposal does not stop a concurrent session", async () => {
	vi.stubEnv("PI_CORE_TELEMETRY", undefined);
	const first = await createHarness();
	const second = await createHarness();
	try {
		expect(first.session.coreTelemetry).toBeDefined();
		expect(second.session.coreTelemetry).toBeDefined();
		expect(first.session.coreTelemetry).not.toBe(second.session.coreTelemetry);
		first.session.dispose();
		expect(first.session.coreTelemetry!.status().live).toBe(false);
		expect(second.session.coreTelemetry!.status().live).toBe(true);
	} finally {
		first.cleanup();
		second.cleanup();
		vi.unstubAllEnvs();
	}
});

test("SDK opt-out creates no producer", async () => {
	vi.stubEnv("PI_CORE_TELEMETRY", "0");
	const harness = await createHarness();
	try {
		expect(harness.session.coreTelemetry).toBeUndefined();
	} finally {
		harness.cleanup();
		vi.unstubAllEnvs();
	}
});
