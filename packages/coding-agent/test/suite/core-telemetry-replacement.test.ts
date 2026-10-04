import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { getTuiResponsivenessObservation } from "../../../tui/src/responsiveness.ts";
import { AgentSessionRuntime, type CreateAgentSessionRuntimeResult } from "../../src/core/agent-session-runtime.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, type Harness } from "./harness.ts";

function result(harness: Harness): CreateAgentSessionRuntimeResult {
	return {
		session: harness.session,
		extensionsResult: harness.session.resourceLoader.getExtensions(),
		services: {
			cwd: harness.sessionManager.getCwd(),
			agentDir: harness.tempDir,
			modelRuntime: harness.session.modelRuntime,
			settingsManager: harness.settingsManager,
			resourceLoader: harness.session.resourceLoader,
			diagnostics: [],
		},
		diagnostics: [],
	};
}
function telemetry(manager: SessionManager) {
	return manager
		.getEntries()
		.filter((entry) => entry.type === "custom" && entry.customType === "pi.core-responsiveness");
}

test.each([true, false])(
	"new/resume/fork/tree owners preserve history origins and isolate current health (persistent=%s)",
	async (persistent) => {
		vi.stubEnv("PI_CORE_TELEMETRY", undefined);
		const directory = await mkdtemp(join(tmpdir(), "pi-telemetry-replacement-"));
		const harnesses: Harness[] = [];
		const create = async (manager: SessionManager) => {
			const harness = await createHarness({ sessionManager: manager });
			harnesses.push(harness);
			return result(harness);
		};
		const initial = await create(
			persistent ? SessionManager.create(directory, directory) : SessionManager.inMemory(directory),
		);
		const runtime = new AgentSessionRuntime(initial.session, initial.services, async (options) =>
			create(options.sessionManager),
		);
		const ui = {};
		runtime.setRebindSession(async (session) => {
			session.coreTelemetry!.attachTui(ui);
		});
		runtime.session.coreTelemetry!.attachTui(ui);
		const observe = () => {
			getTuiResponsivenessObservation(ui)!.emit("input_dispatch", 3);
			runtime.session.coreTelemetry!.sample();
		};
		try {
			const root = runtime.session.sessionManager.appendMessage({ role: "user", content: "root", timestamp: 1 });
			observe();
			const leaf = runtime.session.sessionManager.appendMessage({
				role: "user",
				content: "fork point",
				timestamp: 2,
			});
			const oldOwner = runtime.session.coreTelemetry!;
			const sourceId = runtime.session.sessionId;
			const sourceFile = runtime.session.sessionFile;
			const historicalIds = telemetry(runtime.session.sessionManager).map((entry) => entry.id);
			expect(historicalIds).toHaveLength(1);
			expect(oldOwner.status().health!.inputDispatches).toBe(1);
			await runtime.fork(leaf, { position: "at" });
			expect(oldOwner.status().live).toBe(false);
			expect(runtime.session.sessionId).not.toBe(sourceId);
			expect(telemetry(runtime.session.sessionManager).map((entry) => entry.id)).toEqual(historicalIds);
			expect(runtime.session.sessionManager.getHeader()!.parentSession).toBe(persistent ? sourceFile : undefined);
			expect(runtime.session.coreTelemetry!.status().health).toMatchObject({
				inputDispatches: 0,
				recordsPersisted: 0,
				recordsInMemory: 0,
			});
			observe();
			runtime.session.sessionManager.appendMessage({ role: "user", content: "new origin", timestamp: 3 });
			expect(telemetry(runtime.session.sessionManager)).toHaveLength(2);
			expect(runtime.session.coreTelemetry!.status().health!.inputDispatches).toBe(1);
			expect(runtime.session.coreTelemetry!.status().health).toMatchObject(
				persistent ? { recordsPersisted: 1 } : { recordsInMemory: 1 },
			);
			observe();
			await runtime.session.navigateTree(root, { summarize: false });
			runtime.session.sessionManager.appendMessage({ role: "user", content: "tree branch", timestamp: 4 });
			expect(runtime.session.sessionManager.getBranch().some((entry) => historicalIds.includes(entry.id))).toBe(
				false,
			);
			const forkOwner = runtime.session.coreTelemetry!;
			await runtime.newSession();
			expect(forkOwner.status().live).toBe(false);
			expect(runtime.session.sessionManager.getEntries().some((entry) => entry.type === "custom")).toBe(false);
			expect(runtime.session.coreTelemetry!.status()).toMatchObject({ live: true, health: { inputDispatches: 0 } });
			if (persistent) {
				const outgoing = runtime.session.coreTelemetry!;
				await runtime.switchSession(sourceFile!);
				expect(outgoing.status().live).toBe(false);
				expect(telemetry(runtime.session.sessionManager).map((entry) => entry.id)).toContain(historicalIds[0]);
				expect(runtime.session.coreTelemetry!.status().health!.recordsPersisted).toBe(0);
				expect(await readFile(sourceFile!, "utf8")).toContain('"schemaVersion":2');
			}
			expect(harnesses.every((harness) => harness.eventsOfType("agent_start").length === 0)).toBe(true);
		} finally {
			await runtime.dispose();
			for (const harness of harnesses) harness.cleanup();
			vi.unstubAllEnvs();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
