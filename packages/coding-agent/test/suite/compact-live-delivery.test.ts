import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { beforeAll, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import { codemodeRenderers } from "../../src/extensions/codemode/renderer.ts";
import type { ToolExecutionComponent } from "../../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, type Harness } from "./harness.ts";

beforeAll(() => initTheme("dark"));
const methods = InteractiveMode.prototype as unknown as {
	handleEvent(this: unknown, event: AgentSessionEvent): Promise<void>;
	getRegisteredToolDefinition(this: unknown, name: string): ConstructorParameters<typeof ToolExecutionComponent>[4];
	addMessageToChat(this: unknown, message: unknown): void;
	addCustomEntryToChat(this: unknown, entry: unknown): void;
};
function liveMode(harness: Harness) {
	return {
		session: harness.session,
		sessionManager: harness.sessionManager,
		settingsManager: harness.settingsManager,
		chatContainer: new Container(),
		pendingTools: new Map<string, ToolExecutionComponent>(),
		entriesRenderedByBoundaryCompaction: new Set<string>(),
		footer: { invalidate() {} },
		ui: { requestRender: vi.fn() } as unknown as TUI,
		isInitialized: true,
		toolOutputExpanded: false,
		outputPad: 1,
		hideThinkingBlock: false,
		getRegisteredToolDefinition: methods.getRegisteredToolDefinition,
		addMessageToChat: methods.addMessageToChat,
		addCustomEntryToChat: methods.addCustomEntryToChat,
		getMarkdownThemeWithSettings: getMarkdownTheme,
		getMarkdownTransformers: () => [],
		maybeShowThinkingDropNotice: vi.fn(),
		maybeShowCacheMissNotice: vi.fn(),
	};
}
test("loaded redacting codemode registration stays private through streaming registry lookup", async () => {
	const harness = await createHarness({
		extensionFactories: [
			(pi) =>
				pi.registerTool({
					...codemodeRenderers,
					name: "codemode",
					label: "codemode",
					description: "test",
					parameters: Type.Object({}),
					renderCall: () => new Text("redacted call", 0, 0),
					renderResult: () => new Text("redacted detail", 0, 0),
					execute: async () => ({
						content: [{ type: "text", text: "PRIVATE RESULT" }],
						details: {
							calls: [
								{
									id: "live/1",
									name: "nested",
									args: "{}",
									status: "error" as const,
									error: "PRIVATE_NESTED_ERROR",
								},
							],
						},
					}),
				}),
		],
	});
	const mode = liveMode(harness);
	const work: Promise<void>[] = [];
	let updates = 0;
	const lookup = vi.spyOn(harness.session, "getToolDefinition");
	harness.session.subscribe((event) => {
		if (
			((event.type === "message_start" || event.type === "message_end") && event.message.role === "assistant") ||
			event.type === "message_update" ||
			event.type === "tool_execution_start" ||
			event.type === "tool_execution_end"
		) {
			if (event.type === "tool_execution_start") expect(mode.pendingTools.has(event.toolCallId)).toBe(true);
			work.push(methods.handleEvent.call(mode, event));
			if (event.type === "message_update") updates++;
		}
	});
	try {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("codemode", {}, { id: "live" })]),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run");
		await Promise.all(work);
		expect(updates).toBeGreaterThan(0);
		expect(lookup).toHaveBeenCalledWith("codemode");
		expect(mode.pendingTools.size).toBe(0);
		expect(stripAnsi(mode.chatContainer.render(80).join("\n"))).not.toMatch(/PRIVATE_NESTED_ERROR|PRIVATE RESULT/);
		expect(
			harness.session.messages.some(
				(message) => message.role === "toolResult" && JSON.stringify(message).includes("PRIVATE_NESTED_ERROR"),
			),
		).toBe(true);
	} finally {
		harness.cleanup();
	}
});
test("loaded providers reach live entry and message delivery without revealing hidden entries", async () => {
	const messageRenderer = vi.fn(() => new Text("PRIVATE MESSAGE DETAIL", 0, 0));
	const harness = await createHarness({
		extensionFactories: [
			(pi) => {
				pi.registerMessageRenderer("scan", messageRenderer);
				pi.registerMessageHints<{ count: number }>("scan", (message) => ({
					label: "scan",
					counts: [{ label: "items", value: message.details?.count ?? 0 }],
					progress: { completed: 2, total: 5 },
					costUsd: 0.000012,
					outputPaths: ["/tmp/out"],
				}));
				pi.registerEntryRenderer("visible", () => new Text("PRIVATE ENTRY DETAIL", 0, 0));
				pi.registerEntryHints("visible", () => ({ label: "entry", counts: [{ label: "items", value: 7 }] }));
				pi.registerEntryRenderer("hidden", (_entry, { expanded }) =>
					expanded ? new Text("PRIVATE HIDDEN", 0, 0) : undefined,
				);
				pi.registerEntryHints("hidden", () => ({ summary: "PRIVATE HIDDEN" }));
				pi.registerEntryHints("hints-only", () => ({ summary: "PRIVATE HINTS ONLY" }));
				pi.registerCommand("deliver", {
					description: "local test",
					handler: async () => {
						pi.appendEntry("visible", { count: 7 });
						pi.appendEntry("hidden", {});
						pi.appendEntry("hints-only", {});
						pi.sendMessage(
							{ customType: "scan", content: "PRIVATE MESSAGE", display: true, details: { count: 5 } },
							{ triggerTurn: false },
						);
						pi.sendMessage(
							{ customType: "scan", content: "PRIVATE HIDDEN MESSAGE", display: false, details: { count: 999 } },
							{ triggerTurn: false },
						);
					},
				});
			},
		],
	});
	const mode = liveMode(harness);
	const work: Promise<void>[] = [];
	let entries = 0;
	let messages = 0;
	harness.session.subscribe((event) => {
		if (event.type === "entry_appended" || (event.type === "message_start" && event.message.role === "custom")) {
			work.push(methods.handleEvent.call(mode, event));
			if (event.type === "entry_appended") entries++;
			else messages++;
		}
	});
	try {
		await harness.session.prompt("/deliver");
		await Promise.all(work);
		expect(entries).toBe(3);
		expect(messages).toBe(2);
		expect(mode.chatContainer.children).toHaveLength(2);
		expect(messageRenderer).not.toHaveBeenCalled();
		const text = stripAnsi(mode.chatContainer.render(80).join("\n"));
		for (const value of ["items 7", "items 5", "2/5", "$0.000012", "/tmp/out"]) expect(text).toContain(value);
		expect(text).not.toContain("PRIVATE");
		expect(stripAnsi(mode.chatContainer.render(40).join("\n"))).toContain("2/5");
		mode.toolOutputExpanded = true;
		for (const child of mode.chatContainer.children)
			if ("setExpanded" in child && typeof child.setExpanded === "function") child.setExpanded(true);
		expect(stripAnsi(mode.chatContainer.render(80).join("\n"))).toContain("PRIVATE MESSAGE DETAIL");
		expect(stripAnsi(mode.chatContainer.render(80).join("\n"))).not.toContain("PRIVATE HIDDEN");
		expect(
			harness.session.messages.some((message) => message.role === "custom" && message.content === "PRIVATE MESSAGE"),
		).toBe(true);
	} finally {
		harness.cleanup();
	}
});
