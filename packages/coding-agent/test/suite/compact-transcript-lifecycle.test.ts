import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { beforeAll, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import type { ToolDefinition } from "../../src/core/extensions/types.ts";
import type { ToolExecutionComponent } from "../../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, getToolResult } from "./harness.ts";

beforeAll(() => initTheme("dark"));
test("faux execution reaches InteractiveMode adapters, survives toggles, and replays without changing results", async () => {
	let release!: () => void;
	const bothStarted = new Promise<void>((resolve) => {
		release = resolve;
	});
	let started = 0;
	let maxPending = 0;
	const argsCompleteness: boolean[] = [];
	const tool: ToolDefinition = {
		name: "private",
		label: "private",
		description: "private",
		parameters: Type.Object({}),
		executionMode: "parallel",
		getCompactHints: ({ result, argsComplete }) => {
			argsCompleteness.push(argsComplete);
			return { summary: result ? "safe completion" : "safe pending" };
		},
		renderCall: () => new Text("PRIVATE CALL", 0, 0),
		renderResult: () => new Text("PRIVATE DETAIL", 0, 0),
		execute: async (_id, _args, _signal, update) => {
			update?.({ content: [{ type: "text", text: "PRIVATE PARTIAL" }], details: {} });
			if (++started === 2) release();
			await bothStarted;
			return { content: [{ type: "text", text: "PRIVATE RESULT" }], details: {} };
		},
	};
	const harness = await createHarness({ extensionFactories: [(pi) => pi.registerTool(tool)] });
	const chatContainer = new Container();
	const prototype = InteractiveMode.prototype as unknown as {
		handleEvent(this: unknown, event: AgentSessionEvent): Promise<void>;
		setToolsExpanded(this: unknown, expanded: boolean): void;
		toggleThinkingBlockVisibility(this: unknown): void;
		updateThinkingBlockVisibility(this: unknown): void;
		renderSessionItems(this: unknown, items: readonly unknown[]): void;
		getRegisteredToolDefinition(this: unknown, name: string): ConstructorParameters<typeof ToolExecutionComponent>[4];
	};
	const mode = {
		footer: { invalidate() {} },
		chatContainer,
		loadedResourcesContainer: new Container(),
		pendingMessagesContainer: new Container(),
		pendingTools: new Map<string, ToolExecutionComponent>(),
		ui: { requestRender: vi.fn() } as unknown as TUI,
		settingsManager: harness.settingsManager,
		sessionManager: harness.sessionManager,
		session: harness.session,
		toolOutputExpanded: false,
		hideThinkingBlock: false,
		isInitialized: true,
		getRegisteredToolDefinition: prototype.getRegisteredToolDefinition,
		getMarkdownThemeWithSettings: getMarkdownTheme,
		getMarkdownTransformers: () => [],
		maybeShowThinkingDropNotice: vi.fn(),
		maybeShowCacheMissNotice: vi.fn(),
		showStatus: vi.fn(),
		maybeShowAssistantDiagnostics: vi.fn(),
		addMessageToChat: () => {},
		updateThinkingBlockVisibility: prototype.updateThinkingBlockVisibility,
	};
	const work: Promise<void>[] = [];
	const registryLookup = vi.spyOn(harness.session, "getToolDefinition");
	let streamingUpdates = 0;
	let assistantEnds = 0;
	harness.session.subscribe((event) => {
		if (
			(event.type === "message_start" && event.message.role === "assistant") ||
			event.type === "message_update" ||
			(event.type === "message_end" && event.message.role === "assistant") ||
			event.type === "tool_execution_start" ||
			event.type === "tool_execution_update" ||
			event.type === "tool_execution_end"
		) {
			if (event.type === "tool_execution_start") expect(mode.pendingTools.has(event.toolCallId)).toBe(true);
			work.push(prototype.handleEvent.call(mode, event));
			if (event.type === "message_update") streamingUpdates++;
			if (event.type === "message_end") assistantEnds++;
			if (event.type === "tool_execution_update") {
				expect(mode.pendingTools.has(event.toolCallId)).toBe(true);
				maxPending = Math.max(maxPending, mode.pendingTools.size);
				prototype.setToolsExpanded.call(mode, true);
				expect(stripAnsi(chatContainer.render(80).join("\n"))).toContain("PRIVATE DETAIL");
				prototype.toggleThinkingBlockVisibility.call(mode);
				prototype.setToolsExpanded.call(mode, false);
				expect(mode.pendingTools.has(event.toolCallId)).toBe(true);
				maxPending = Math.max(maxPending, mode.pendingTools.size);
			}
		}
	});
	try {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("private", {}, { id: "one" }), fauxToolCall("private", {}, { id: "two" })]),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("run");
		await Promise.all(work);
		expect(maxPending).toBe(2);
		expect(streamingUpdates).toBeGreaterThan(0);
		expect(assistantEnds).toBe(2);
		expect(registryLookup).toHaveBeenCalledWith("private");
		expect(mode.pendingTools.size).toBe(0);
		expect(stripAnsi(chatContainer.render(80).join("\n"))).toContain("safe completion");
		expect(stripAnsi(chatContainer.render(80).join("\n"))).not.toContain("PRIVATE RESULT");
		expect(getToolResult(harness, "private").content).toEqual([{ type: "text", text: "PRIVATE RESULT" }]);
		chatContainer.clear();
		argsCompleteness.length = 0;
		prototype.renderSessionItems.call(mode, harness.session.messages);
		expect(argsCompleteness.at(-1)).toBe(true);
		expect(mode.pendingTools.size).toBe(0);
		expect(stripAnsi(chatContainer.render(80).join("\n"))).toContain("safe completion");
		harness.settingsManager.setTranscriptPresentation({ mode: "legacy" });
		chatContainer.invalidate();
		expect(stripAnsi(chatContainer.render(80).join("\n"))).toContain("PRIVATE DETAIL");
	} finally {
		harness.cleanup();
	}
});
