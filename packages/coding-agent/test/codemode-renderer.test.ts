import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Text } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { ToolRenderContext } from "../src/core/extensions/types.ts";
import { codemodeRenderers } from "../src/extensions/codemode/renderer.ts";
import type { CodemodeToolDetails } from "../src/extensions/codemode/tool.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

function render(result: AgentToolResult<CodemodeToolDetails | undefined>, isError = false, expanded = true): string {
	const context = {
		args: { code: "" },
		toolCallId: "call",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded,
		showImages: false,
		isError,
	} satisfies ToolRenderContext;
	const component = codemodeRenderers.renderResult?.(result, { expanded, isPartial: false }, theme, context) as Text;
	return stripVTControlCharacters(component.render(200).join("\n"))
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

describe("codemode renderer", () => {
	beforeAll(() => initTheme("dark"));

	it("uses the inline shell without showing the script while collapsed", () => {
		expect(codemodeRenderers.renderShell).toBe("inline");
		const component = codemodeRenderers.renderCall?.(
			{ code: "text('secret script');\ntext('second line');" },
			theme,
			{ expanded: false } as ToolRenderContext,
		) as Text;
		const text = stripVTControlCharacters(component.render(200).join("\n")).trim();
		expect(text).toBe("codemode · 2 lines");
	});

	it("collapses nested calls and output into one status line without a blank spacer", () => {
		const result = {
			content: [
				{ type: "text" as const, text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
				{ type: "text" as const, text: "large output\nsecond output line" },
			],
			details: {
				calls: [
					{ id: "1", name: "read", args: "secret arguments", status: "ok" as const, cost: 0.01 },
					{ id: "2", name: "read", args: "other arguments", status: "ok" as const, cost: 0.02 },
				],
			},
		};
		const text = render(result, false, false);
		expect(text.split("\n")).toHaveLength(1);
		expect(text).toContain("2 calls");
		expect(text).toContain("2 output lines");
		expect(text).toContain("$0.03");
		expect(text).not.toContain("secret arguments");
		expect(text).not.toContain("large output");
		const context = { showImages: false, isError: false } as ToolRenderContext;
		const lines = codemodeRenderers
			.renderResult?.(result, { expanded: false, isPartial: false }, theme, context)
			?.render(200);
		expect(lines).toHaveLength(1);
		expect(render(result)).toContain("large output");
	});

	it("keeps errors, cancelled calls, and full-output paths visible when collapsed", () => {
		const text = render(
			{
				content: [
					{ type: "text", text: "Script failed\nWall time 0.1 seconds\nOutput:\n" },
					{ type: "text", text: "Script error: broken recipe" },
				],
				details: {
					fullOutputPath: "/logs/full.txt",
					calls: [
						{ id: "1", name: "bash", args: "", status: "error", error: "bad command" },
						{ id: "2", name: "read", args: "", status: "cancelled" },
					],
				},
			},
			true,
			false,
		);
		expect(text).toContain("1 failed");
		expect(text).toContain("1 cancelled");
		expect(text).toContain("broken recipe");
		expect(text).toContain("/logs/full.txt");
	});

	it("preserves the full script on expansion and the running-call count while streaming", () => {
		const component = codemodeRenderers.renderCall?.({ code: "text('first');\ntext('second');" }, theme, {
			expanded: true,
		} as ToolRenderContext) as Text;
		const script = stripVTControlCharacters(component.render(200).join("\n"));
		expect(script).toContain("text('first')");
		expect(script).toContain("text('second')");
		const partial = codemodeRenderers.renderResult?.(
			{
				content: [{ type: "text", text: "not final" }],
				details: { calls: [{ id: "1", name: "bash", args: "", status: "running" }] },
			},
			{ expanded: false, isPartial: true },
			theme,
			{ showImages: false, isError: false } as ToolRenderContext,
		);
		const status = stripVTControlCharacters(partial?.render(200).join("\n") ?? "");
		expect(status).toContain("1 running");
		expect(status).not.toContain("not final");
	});

	it("hides the script header and shows the output", () => {
		const text = render({
			content: [
				{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
				{ type: "text", text: "hello" },
			],
			details: { calls: [{ id: "call/1", name: "read", args: '{"path":"a"}', status: "ok", durationMs: 5 }] },
		});
		expect(text).toBe('✓ read {"path":"a"} 5ms\n\nhello');
	});

	it("shows the cost of model calls and their total", () => {
		const call = { name: "models.classify", args: "scorer/judge", status: "ok" as const, durationMs: 5 };
		const text = render({
			content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
			details: {
				calls: [
					{ ...call, id: "call/models.classify/1", cost: 0.000012936 },
					{ ...call, id: "call/models.classify/2", cost: 0.02 },
					{ ...call, id: "call/models.classify/3" },
				],
			},
		});
		expect(text).toBe(
			[
				"✓ models.classify scorer/judge 5ms $0.000013",
				"✓ models.classify scorer/judge 5ms $0.02",
				"✓ models.classify scorer/judge 5ms",
				"Model calls: $0.02",
			].join("\n"),
		);
	});

	it("shows results without a header, such as rejected options", () => {
		const text = render(
			{
				content: [{ type: "text", text: "The @options line must be followed by JavaScript source" }],
				details: undefined,
			},
			true,
		);
		expect(text).toBe("The @options line must be followed by JavaScript source");
	});
});
