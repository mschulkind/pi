import type { TUI } from "@earendil-works/pi-tui";
import { beforeAll, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	computeEditsDiff: vi.fn<
		(...args: unknown[]) => Promise<{ error: string } | { diff: string; firstChangedLine: number }>
	>(async () => ({ error: "POST_EDIT_RECOMPUTE" })),
}));
vi.mock("../src/core/tools/edit-diff.ts", () => mocks);

import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => initTheme("dark"));
test("first expansion of completed edit seeds the actual result before async preview work", async () => {
	const row = new ToolExecutionComponent(
		"edit",
		"one",
		{ path: "notes.txt", oldText: "before", newText: "after" },
		{},
		createEditToolDefinition(process.cwd()),
		{ requestRender() {} } as unknown as TUI,
		process.cwd(),
	);
	row.setArgsComplete();
	row.markExecutionStarted();
	row.updateResult({ content: [], details: { diff: "+1 after", firstChangedLine: 1 }, isError: false });
	row.setExpanded(true);
	await Promise.resolve();
	await Promise.resolve();
	expect(mocks.computeEditsDiff).not.toHaveBeenCalled();
	expect(stripAnsi(row.render(80).join("\n"))).toContain("after");
	expect(stripAnsi(row.render(80).join("\n"))).not.toContain("POST_EDIT_RECOMPUTE");
});

test.each(["before", "after"] as const)(
	"preview resolved %s settlement cannot overwrite a failed edit",
	async (timing) => {
		let resolvePreview!: (value: { diff: string; firstChangedLine: number }) => void;
		mocks.computeEditsDiff.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolvePreview = resolve as typeof resolvePreview;
				}),
		);
		const component = new ToolExecutionComponent(
			"edit",
			"failed",
			{ path: "notes.txt", oldText: "before", newText: "after" },
			{},
			createEditToolDefinition(process.cwd()),
			{ requestRender() {} } as unknown as TUI,
			process.cwd(),
		);
		component.setExpanded(true);
		component.setArgsComplete();
		component.markExecutionStarted();
		if (timing === "before") {
			resolvePreview({ diff: "+1 PROPOSED_PRIVATE_DIFF", firstChangedLine: 1 });
			await Promise.resolve();
			await Promise.resolve();
		}
		component.updateResult({ content: [{ type: "text", text: "PERMISSION_DENIED" }], isError: true });
		const failedBefore = component.render(80).join("\n");
		if (timing === "after") resolvePreview({ diff: "+1 PROPOSED_PRIVATE_DIFF", firstChangedLine: 1 });
		await Promise.resolve();
		await Promise.resolve();
		const failedAfter = component.render(80).join("\n");
		expect(stripAnsi(failedAfter)).toContain("PERMISSION_DENIED");
		expect(stripAnsi(failedAfter)).not.toContain("PROPOSED_PRIVATE_DIFF");
		expect(failedAfter).toBe(failedBefore);
		expect(failedAfter).toContain(theme.bg("toolErrorBg", "x").split("x")[0]);
		expect(failedAfter).not.toContain(theme.bg("toolSuccessBg", "x").split("x")[0]);
	},
);
