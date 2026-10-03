import { Text, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.ts";
import { createBashToolDefinition } from "../src/core/tools/bash.ts";
import { createReadToolDefinition } from "../src/core/tools/read.ts";
import { normalizeTranscriptPresentation } from "../src/core/transcript-presentation.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const ui = { requestRender: vi.fn() } as unknown as TUI;
function definition(): ToolDefinition {
	return {
		name: "private",
		label: "private",
		description: "private",
		parameters: Type.Any(),
		execute: async () => ({ content: [], details: {} }),
		renderCall: vi.fn(() => new Text("PRIVATE\n".repeat(100), 0, 0)),
		renderResult: vi.fn(() => new Text("PRIVATE RESULT\n".repeat(100), 0, 0)),
	};
}
describe("live compact tool adapter", () => {
	beforeAll(() => initTheme("dark"));
	test("built-in semantics stay with original renderers, not redacting overrides", () => {
		const builtin = createReadToolDefinition(process.cwd());
		const row = new ToolExecutionComponent("read", "one", { path: "notes.txt" }, {}, builtin, ui, process.cwd());
		expect(stripAnsi(row.render(80).join("\n"))).toContain("notes.txt");
		const override = new ToolExecutionComponent(
			"read",
			"two",
			{ path: "PRIVATE" },
			{},
			{ ...builtin, renderCall: () => new Text("redacted", 0, 0) },
			ui,
			process.cwd(),
		);
		expect(stripAnsi(override.render(80).join("\n"))).not.toContain("PRIVATE");
	});
	test("bounds unknown components without invoking them; expanded detail stays available", () => {
		const tool = definition();
		const row = new ToolExecutionComponent("private", "one", { secret: "SECRET" }, {}, tool, ui, process.cwd());
		row.markExecutionStarted();
		row.updateResult({ content: [{ type: "text", text: "SECRET RESULT" }], isError: true });
		for (const width of [0, 1, 2, 10, 40, 80]) {
			const lines = row.render(width);
			expect(lines.length).toBeLessThanOrEqual(2);
			expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
			expect(stripAnsi(lines.join("\n"))).not.toMatch(/PRIVATE|SECRET/);
		}
		expect(tool.renderCall).not.toHaveBeenCalled();
		expect(tool.renderResult).not.toHaveBeenCalled();
		row.setExpanded(true);
		expect(stripAnsi(row.render(80).join("\n"))).toContain("PRIVATE RESULT");
	});
	test("refreshes hints only on accepted lifecycle updates, with independent concurrent calls", () => {
		const tool = definition();
		tool.getCompactHints = vi.fn(({ result }) => ({ summary: result?.details?.label }));
		const one = new ToolExecutionComponent("private", "one", {}, {}, tool, ui, process.cwd());
		const two = new ToolExecutionComponent("private", "two", {}, {}, tool, ui, process.cwd());
		one.updateResult({ content: [], details: { label: "final-one" }, isError: false });
		two.markExecutionStarted();
		two.updateResult({ content: [], details: { label: "partial-two" }, isError: false }, true);
		const calls = vi.mocked(tool.getCompactHints).mock.calls.length;
		one.invalidate();
		one.render(80);
		one.setExpanded(true);
		one.setExpanded(false);
		expect(tool.getCompactHints).toHaveBeenCalledTimes(calls);
		one.updateResult({ content: [], details: { label: "late" }, isError: true }, true);
		expect(stripAnsi(one.render(80).join("\n"))).toContain("final-one");
		expect(stripAnsi(one.render(80).join("\n"))).not.toContain("late");
		expect(stripAnsi(two.render(80).join("\n"))).toContain("partial-two");
	});
	test("refreshes exact policy without rebuilding execution state", () => {
		let policy = normalizeTranscriptPresentation();
		const tool = definition();
		const row = new ToolExecutionComponent(
			"private",
			"one",
			{},
			{ transcriptPresentation: () => policy },
			tool,
			ui,
			process.cwd(),
		);
		row.updateResult({ content: [], isError: false });
		expect(row.render(80).length).toBeLessThanOrEqual(2);
		policy = normalizeTranscriptPresentation({ exceptions: [{ kind: "tool", name: "private", mode: "legacy" }] });
		row.invalidate();
		expect(row.render(80).length).toBeGreaterThan(2);
		policy = normalizeTranscriptPresentation({ maxLines: 1 });
		row.invalidate();
		expect(row.render(80)).toHaveLength(1);
	});
	test("built-in shell timer pauses on collapse, resumes on expansion, and stops at completion", () => {
		vi.useFakeTimers();
		try {
			const row = new ToolExecutionComponent(
				"bash",
				"one",
				{ command: "sleep" },
				{},
				createBashToolDefinition(process.cwd()),
				ui,
				process.cwd(),
			);
			row.markExecutionStarted();
			row.updateResult({ content: [], isError: false }, true);
			row.setExpanded(true);
			expect(vi.getTimerCount()).toBe(1);
			row.setExpanded(false);
			expect(vi.getTimerCount()).toBe(0);
			row.setExpanded(true);
			expect(vi.getTimerCount()).toBe(1);
			row.updateResult({ content: [], isError: false });
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
	test("collapse does not permanently dispose custom expanded components", () => {
		const dispose = vi.fn();
		const tool = definition();
		tool.renderResult = () => Object.assign(new Text("interactive detail", 0, 0), { dispose });
		const row = new ToolExecutionComponent("private", "one", {}, {}, tool, ui, process.cwd());
		row.setExpanded(true);
		row.updateResult({ content: [], isError: false }, true);
		row.setExpanded(false);
		expect(dispose).not.toHaveBeenCalled();
		row.setExpanded(true);
		expect(stripAnsi(row.render(80).join("\n"))).toContain("interactive detail");
	});
	test("expanded components that throw during terminal rendering stay redaction-safe", () => {
		const tool = definition();
		tool.renderResult = () => ({
			render() {
				throw Error("PRIVATE");
			},
			invalidate() {},
		});
		const row = new ToolExecutionComponent("private", "one", {}, {}, tool, ui, process.cwd());
		row.updateResult({ content: [{ type: "text", text: "SECRET" }], isError: false });
		row.setExpanded(true);
		expect(stripAnsi(row.render(80).join("\n"))).toContain("renderer unavailable");
		expect(stripAnsi(row.render(80).join("\n"))).not.toMatch(/PRIVATE|SECRET/);
	});
	test("throwing redacting renderers never authorize raw argument or result fallback", () => {
		const tool = definition();
		tool.renderCall = () => {
			throw Error("SECRET error");
		};
		tool.renderResult = () => {
			throw Error("SECRET error");
		};
		const row = new ToolExecutionComponent("private", "one", { secret: "SECRET" }, {}, tool, ui, process.cwd());
		row.updateResult({ content: [{ type: "text", text: "SECRET" }], isError: false });
		row.setExpanded(true);
		expect(stripAnsi(row.render(80).join("\n"))).toContain("renderer unavailable");
		expect(stripAnsi(row.render(80).join("\n"))).not.toContain("SECRET");
	});
});
