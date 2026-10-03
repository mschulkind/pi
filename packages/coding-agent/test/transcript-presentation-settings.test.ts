import { Type } from "typebox";
import { describe, expect, test } from "vitest";
import type { ToolCompactHintsProvider, ToolDefinition } from "../src/core/extensions/types.ts";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";
import { resolveTranscriptPresentation } from "../src/core/transcript-presentation.ts";

describe("transcript settings lifecycle", () => {
	test("defaults compact to two rows without changing persisted settings", () => {
		const settings = SettingsManager.inMemory();
		expect(settings.getTranscriptPresentation()).toEqual({ mode: "compact", maxLines: 2, exceptions: [] });
		expect(settings.getSettings()).toEqual({});
	});

	test("trusted project fields merge and exception arrays replace", () => {
		const storage = new InMemorySettingsStorage();
		storage.withLock("global", () =>
			JSON.stringify({
				transcriptPresentation: {
					mode: "legacy",
					maxLines: 3,
					exceptions: [{ kind: "tool", name: "global", mode: "compact" }],
				},
			}),
		);
		storage.withLock("project", () =>
			JSON.stringify({
				transcriptPresentation: {
					maxLines: 1,
					exceptions: [{ kind: "message", name: "project", mode: "compact" }],
				},
			}),
		);
		const settings = SettingsManager.fromStorage(storage);
		expect(settings.getTranscriptPresentation()).toEqual({
			mode: "legacy",
			maxLines: 1,
			exceptions: [{ kind: "message", name: "project", mode: "compact", maxLines: 1 }],
		});
		settings.setProjectTrusted(false);
		expect(settings.getTranscriptPresentation().maxLines).toBe(3);
		expect(settings.getTranscriptPresentation().exceptions[0].name).toBe("global");
		settings.setProjectTrusted(true);
		expect(settings.getTranscriptPresentation().exceptions[0].name).toBe("project");
	});

	test("persists normalized settings and refreshes after reload and overrides", async () => {
		const storage = new InMemorySettingsStorage();
		const settings = SettingsManager.fromStorage(storage);
		settings.setTranscriptPresentation({
			mode: "legacy",
			maxLines: 4,
			exceptions: [{ kind: "shell", name: "user-shell", mode: "compact" }],
		});
		await settings.flush();
		const reloaded = SettingsManager.fromStorage(storage);
		expect(reloaded.getTranscriptPresentation()).toEqual(settings.getTranscriptPresentation());
		const snapshot = settings.getTranscriptPresentation();
		snapshot.exceptions[0].mode = "legacy";
		expect(resolveTranscriptPresentation(settings.getTranscriptPresentation(), "shell", "user-shell").mode).toBe(
			"compact",
		);
		settings.applyOverrides({ transcriptPresentation: { maxLines: 1 } });
		expect(settings.getTranscriptPresentation().maxLines).toBe(1);
		storage.withLock("global", () => JSON.stringify({ transcriptPresentation: { mode: "compact", maxLines: 2 } }));
		await settings.reload();
		expect(settings.getTranscriptPresentation()).toEqual({ mode: "compact", maxLines: 2, exceptions: [] });
	});

	test("setter preserves inherited exception fields across later overrides", async () => {
		const settings = SettingsManager.inMemory();
		settings.setTranscriptPresentation({ maxLines: 4, exceptions: [{ kind: "shell", name: "user-shell" }] });
		await settings.flush();
		settings.applyOverrides({ transcriptPresentation: { mode: "legacy", maxLines: 1 } });
		expect(resolveTranscriptPresentation(settings.getTranscriptPresentation(), "shell", "user-shell")).toEqual({
			mode: "legacy",
			maxLines: 1,
		});
	});

	test("diagnoses invalid settings once per changed input, without user data", async () => {
		const storage = new InMemorySettingsStorage();
		storage.withLock("global", () => JSON.stringify({ transcriptPresentation: { maxLines: "private" } }));
		const settings = SettingsManager.fromStorage(storage);
		for (let i = 0; i < 5; i++) expect(settings.getTranscriptPresentation().maxLines).toBe(2);
		const errors = settings.drainErrors();
		expect(errors).toHaveLength(1);
		expect(errors[0].scope).toBe("global");
		expect(errors[0].error.message).not.toContain("private");
		expect(settings.getTranscriptPresentation().maxLines).toBe(2);
		expect(settings.drainErrors()).toEqual([]);
		await settings.reload();
		settings.getTranscriptPresentation();
		expect(settings.drainErrors()).toHaveLength(1);
	});

	test("merged invalid settings do not diagnose again after unrelated changes", async () => {
		const storage = new InMemorySettingsStorage();
		storage.withLock("global", () => JSON.stringify({ transcriptPresentation: { maxLines: "private" } }));
		storage.withLock("project", () => JSON.stringify({ transcriptPresentation: { mode: "compact" } }));
		const settings = SettingsManager.fromStorage(storage);
		expect(settings.getTranscriptPresentation().maxLines).toBe(2);
		expect(settings.drainErrors()).toHaveLength(1);
		settings.setTheme("dark");
		expect(settings.getTranscriptPresentation().maxLines).toBe(2);
		expect(settings.drainErrors()).toEqual([]);
		settings.applyOverrides({ transcriptPresentation: { maxLines: "different invalid value" } } as never);
		expect(settings.getTranscriptPresentation().maxLines).toBe(2);
		expect(settings.drainErrors()).toHaveLength(1);
		settings.setOutputPad(0);
		expect(settings.getTranscriptPresentation().maxLines).toBe(2);
		// The setter's merge restores the global value, so this is a real presentation change.
		expect(settings.drainErrors()).toHaveLength(1);
		settings.setTheme("light");
		expect(settings.getTranscriptPresentation().maxLines).toBe(2);
		expect(settings.drainErrors()).toEqual([]);
		await settings.flush();
	});

	test("public tool hints infer parameter and detail types without execution wrappers", () => {
		const parameters = Type.Object({ path: Type.String() });
		const getCompactHints: ToolCompactHintsProvider<{ path: string }, { count: number }> = ({ args, result }) => ({
			label: args.path,
			counts: result ? [{ label: "items", value: result.details.count }] : undefined,
		});
		const definition: ToolDefinition<typeof parameters, { count: number }> = {
			name: "safe-tool",
			label: "safe-tool",
			description: "test",
			parameters,
			execute: async () => ({ content: [], details: { count: 2 } }),
			getCompactHints,
		};
		expect(
			definition.getCompactHints?.({
				args: { path: "safe" },
				toolCallId: "id",
				cwd: "/",
				argsComplete: true,
				executionStarted: false,
				isPartial: true,
				isError: false,
			}),
		).toEqual({ label: "safe", counts: undefined });
	});
});
