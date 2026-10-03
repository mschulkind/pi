import { Text, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { beforeAll, expect, test, vi } from "vitest";
import { createAllToolRenderers } from "../src/core/tools/renderers/index.ts";
import type { CompactTranscriptStatus } from "../src/core/transcript-presentation.ts";
import { codemodeRenderers } from "../src/extensions/codemode/renderer.ts";
import { ExtensionNoticeComponent } from "../src/modes/interactive/components/extension-notice.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => initTheme("dark"));
const ui = { requestRender() {} } as unknown as TUI;
function row(name: string, renderers: ConstructorParameters<typeof ToolExecutionComponent>[4]) {
	return new ToolExecutionComponent(
		name,
		"one",
		{ path: "notes.txt", command: "echo hi", pattern: "hi", code: "await work()" },
		{},
		renderers,
		ui,
		process.cwd(),
	);
}
test.each(["call", "result", "both"])("codemode inherited hints stay private with %s overrides", (slot) => {
	const renderers = {
		...codemodeRenderers,
		...(slot !== "result" ? { renderCall: () => new Text("redacted", 0, 0) } : {}),
		...(slot !== "call" ? { renderResult: () => new Text("redacted", 0, 0) } : {}),
	};
	const component = row("codemode", renderers);
	component.updateResult({
		content: [],
		isError: false,
		details: { calls: [{ name: "private", status: "error", error: "PRIVATE_NESTED_ERROR" }] },
	});
	expect(stripAnsi(component.render(80).join("\n"))).not.toContain("PRIVATE_NESTED_ERROR");
});
test("settings submenu retains earlier mode and budget when reopened", () => {
	const onChange = vi.fn();
	const config = {
		availableDefaultModels: [],
		modelThinkingLevels: {},
		warnings: {},
		transcriptPresentation: { mode: "compact", maxLines: 2, exceptions: [] },
	} as unknown as SettingsConfig;
	const list = new SettingsSelectorComponent(config, {
		onTranscriptPresentationChange: onChange,
	} as unknown as SettingsCallbacks).getSettingsList();
	list.selectItem("transcript-presentation");
	list.handleInput("\r");
	list.handleInput("\r");
	list.handleInput("\x1b");
	list.selectItem("transcript-presentation");
	list.handleInput("\r");
	list.handleInput("\x1b[B");
	list.handleInput("\r");
	expect(onChange.mock.calls.map(([settings]) => [settings.mode, settings.maxLines])).toEqual([
		["legacy", 2],
		["legacy", 3],
	]);
	list.handleInput("\x1b");
	list.selectItem("transcript-presentation");
	list.handleInput("\r");
	expect(stripAnsi(list.render(80).join("\n"))).toContain("3");
});
const statuses: Array<CompactTranscriptStatus | undefined> = [
	undefined,
	"info",
	"completed",
	"running",
	"cancelled",
	"warning",
	"error",
];
for (const severity of ["info", "warning", "error"] as const) {
	test.each(statuses)(`notice ${severity} remains authoritative over hint %s`, (status) => {
		for (const error of [undefined, "nested text"]) {
			const component = new ExtensionNoticeComponent("private", severity, {}, { status, error });
			const marker = { info: "·", warning: "?", error: "!" }[severity];
			expect(stripAnsi(component.render(1)[0])).toBe(marker);
			expect(stripAnsi(component.render(80)[0])).toMatch(new RegExp(`^\\${marker} ${severity}`));
			expect(stripAnsi(component.render(80).join("\n"))).not.toMatch(/completed|running|cancelled/);
		}
	});
}
const truncation = { truncated: true, truncatedBy: "lines", outputLines: 2, totalLines: 10 };
const warningCases = [
	{ name: "read", details: { truncation }, text: "truncated" },
	{ name: "read", details: { truncation: { ...truncation, truncatedBy: "bytes" } }, text: "truncated" },
	{
		name: "read",
		details: { truncation: { ...truncation, firstLineExceedsLimit: true } },
		text: "first line exceeds limit",
	},
	{ name: "grep", details: { truncation }, text: "truncated" },
	{ name: "grep", details: { matchLimitReached: 5 }, text: "matches limit" },
	{ name: "grep", details: { linesTruncated: true }, text: "lines truncated" },
	{ name: "find", details: { truncation }, text: "truncated" },
	{ name: "find", details: { resultLimitReached: 5 }, text: "results limit" },
	{ name: "ls", details: { truncation }, text: "truncated" },
	{ name: "ls", details: { entryLimitReached: 5 }, text: "entries limit" },
	{ name: "bash", details: { truncation, fullOutputPath: "/tmp/output" }, text: "truncated" },
	{ name: "powershell", details: { truncation }, text: "truncated" },
] as const;
test.each(warningCases)("$name discloses $text with warning priority", ({ name, details, text }) => {
	const renderers = createAllToolRenderers();
	const component = row(name, renderers[name]);
	component.updateResult({ content: [{ type: "text", text: "private output" }], details, isError: false });
	for (const width of [1, 40, 80]) {
		const lines = component.render(width);
		expect(lines.length).toBeLessThanOrEqual(2);
		expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
		expect(stripAnsi(lines[0])[0]).toBe("?");
		if (width === 80) expect(stripAnsi(lines.join("\n")).toLowerCase()).toContain(text);
	}
	component.updateResult({ content: [{ type: "text", text: "permission denied" }], details, isError: true });
	expect(stripAnsi(component.render(1)[0])).toBe("!");
	expect(stripAnsi(component.render(80).join("\n"))).toContain("permission denied");
});
test("codemode cost, counts, and output availability remain useful at 80 columns", () => {
	const component = row("codemode", codemodeRenderers);
	component.updateResult({
		content: [],
		isError: false,
		details: { calls: [{ name: "one", status: "ok", cost: 0.000012 }], fullOutputPath: "/tmp/out" },
	});
	const text = stripAnsi(component.render(80).join("\n"));
	expect(text).toContain("calls 1");
	expect(text).toContain("$0.000012");
	expect(text).toContain("/tmp/out");
});
