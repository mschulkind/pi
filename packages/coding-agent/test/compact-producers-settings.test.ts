import type { TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { beforeAll, expect, test, vi } from "vitest";
import { codemodeRenderers } from "../src/extensions/codemode/renderer.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => initTheme("dark"));
test("codemode discloses all nested failures and recorded fractional cost through core rows", () => {
	const row = new ToolExecutionComponent(
		"codemode",
		"one",
		{ code: "await work()" },
		{},
		{
			...codemodeRenderers,
			name: "codemode",
			label: "codemode",
			description: "",
			parameters: Type.Any(),
			execute: async () => ({ content: [], details: undefined }),
		},
		{ requestRender() {} } as unknown as TUI,
		process.cwd(),
	);
	row.updateResult({
		content: [],
		isError: false,
		details: {
			calls: [
				{ name: "one", status: "ok", cost: 0.000012 },
				{ name: "two", status: "error", error: "nested failure" },
				{ name: "three", status: "running" },
			],
			fullOutputPath: "/tmp/script-output",
		},
	});
	const output = stripAnsi(row.render(200).join("\n"));
	expect(output).toContain("nested failure");
	expect(output).toContain("failed 1");
	expect(output).toContain("running 1");
	expect(output).toContain("$0.000012");
	expect(output).toContain("/tmp/script-output");
	expect(stripAnsi(row.render(1)[0])).toBe("!");
	row.setExpanded(true);
	expect(stripAnsi(row.render(200).join("\n"))).toContain("two");
});
test("settings submenu changes compact policy while retaining exact exceptions", () => {
	const onChange = vi.fn();
	const config = {
		defaultModel: "not set",
		availableDefaultModels: [],
		availableThinkingLevels: [],
		modelThinkingLevels: {},
		availableThemes: [],
		warnings: {},
		transcriptPresentation: {
			mode: "compact",
			maxLines: 2,
			exceptions: [{ kind: "tool", name: "private", mode: "legacy", maxLines: 2 }],
		},
	} as unknown as SettingsConfig;
	const callbacks = { onTranscriptPresentationChange: onChange, onCancel() {} } as unknown as SettingsCallbacks;
	const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();
	list.selectItem("transcript-presentation");
	list.handleInput("\r");
	list.handleInput("\r");
	expect(onChange).toHaveBeenCalledWith(
		expect.objectContaining({ mode: "legacy", exceptions: config.transcriptPresentation?.exceptions }),
	);
});
