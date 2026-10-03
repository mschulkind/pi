import { Container, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { ToolExecutionComponent } from "../../../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";
import { createHarness } from "../harness.ts";

const methods = InteractiveMode.prototype as unknown as {
	getRegisteredToolDefinition(this: unknown, name: string): ConstructorParameters<typeof ToolExecutionComponent>[4];
	updateThinkingBlockVisibility(this: unknown): void;
	toggleThinkingBlockVisibility(this: unknown): void;
};

function renderChat(container: Container): string {
	return stripAnsi(container.render(120).join("\n"));
}

// #8611: thinking toggles must retain pending shell output, not reconstruct its row.
describe("thinking visibility while a bash tool is running (#8611)", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test.each([
		{ name: "expanded built-in", registered: true, expanded: true, legacy: false },
		{ name: "collapsed built-in compact", registered: true, expanded: false, legacy: false },
		{ name: "expanded generic", registered: false, expanded: true, legacy: false },
		{ name: "collapsed generic compact", registered: false, expanded: false, legacy: false },
		{ name: "collapsed built-in legacy exception", registered: true, expanded: false, legacy: true },
	])("preserves partial output in $name", async ({ registered, expanded, legacy }) => {
		const harness = await createHarness({
			settings: {
				transcriptPresentation: {
					mode: "compact",
					maxLines: 2,
					exceptions: legacy ? [{ kind: "tool", name: "bash", mode: "legacy" }] : [],
				},
			},
		});
		const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
		const ui = { requestRender: vi.fn() } as unknown as TUI;
		const chatContainer = new Container();
		const lookup = vi.spyOn(harness.session, "getToolDefinition");
		const definition = registered ? methods.getRegisteredToolDefinition.call(harness, "bash") : undefined;
		if (registered) {
			expect(lookup).toHaveBeenCalledWith("bash");
			expect(definition?.renderResult).toBeTypeOf("function");
			expect(definition?.getCompactHints).toBeTypeOf("function");
		}
		const component = new ToolExecutionComponent(
			"bash",
			"tool-8611",
			{ command: "echo first; sleep 10" },
			{ showImages: false, transcriptPresentation: () => harness.settingsManager.getTranscriptPresentation() },
			definition,
			ui,
			harness.sessionManager.getCwd(),
		);
		const pendingTools = new Map([["tool-8611", component]]);
		const mode = {
			hideThinkingBlock: false,
			settingsManager: harness.settingsManager,
			chatContainer,
			pendingTools,
			ui,
			updateThinkingBlockVisibility: methods.updateThinkingBlockVisibility,
			showStatus: vi.fn(),
		};
		// Output is distinct from the command identity, which built-in hints may disclose.
		const partial = "PRIVATE_PARTIAL_STDOUT_first";
		try {
			component.markExecutionStarted();
			component.setExpanded(expanded);
			component.updateResult({ content: [{ type: "text", text: partial }], isError: false }, true);
			chatContainer.addChild(component);
			const before = renderChat(chatContainer);
			if (expanded || legacy) expect(before).toContain(partial);
			else {
				expect(before).toContain("running");
				expect(before).not.toContain(partial);
				expect(component.render(120).length).toBeLessThanOrEqual(2);
				if (!registered) expect(before).not.toContain("echo first");
			}

			for (const hidden of [true, false]) {
				methods.toggleThinkingBlockVisibility.call(mode);
				expect(harness.settingsManager.getHideThinkingBlock()).toBe(hidden);
				expect(chatContainer.children).toContain(component);
				expect(pendingTools.get("tool-8611")).toBe(component);
				expect(renderChat(chatContainer)).toBe(before);
			}

			// The hidden raw output remains available when detail is authorized after either toggle.
			component.setExpanded(true);
			expect(renderChat(chatContainer)).toContain(partial);
			component.updateResult({ content: [{ type: "text", text: `${partial}\nsecond` }], isError: false }, true);
			methods.toggleThinkingBlockVisibility.call(mode);
			expect(renderChat(chatContainer)).toContain(partial);
			expect(renderChat(chatContainer)).toContain("second");
			component.updateResult({ content: [{ type: "text", text: `${partial}\nsecond\nfinal` }], isError: false });
			expect(renderChat(chatContainer)).toContain("final");
			component.setExpanded(false);
			if (!legacy) {
				expect(renderChat(chatContainer)).toContain("completed");
				expect(renderChat(chatContainer)).not.toContain(partial);
			}
			component.setExpanded(true);
			expect(renderChat(chatContainer)).toContain(partial);
		} finally {
			// Settling clears the built-in elapsed-time interval even after a failed assertion.
			component.updateResult({ content: [], isError: false });
			clock.mockRestore();
			harness.cleanup();
		}
	});
});
