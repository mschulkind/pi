import { Text, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, expect, test, vi } from "vitest";
import { normalizeTranscriptPresentation } from "../src/core/transcript-presentation.ts";
import { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.ts";
import { CustomEntryComponent } from "../src/modes/interactive/components/custom-entry.ts";
import { CustomMessageComponent } from "../src/modes/interactive/components/custom-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

beforeAll(() => initTheme("dark"));
const message = { role: "custom" as const, customType: "private", content: "SECRET", display: true, timestamp: 1 };
const entry = {
	type: "custom" as const,
	id: "one",
	parentId: null,
	timestamp: "now",
	customType: "private",
	data: { secret: "SECRET" },
};
test("messages bypass arbitrary renderers collapsed and never fall back to redacted raw detail", () => {
	const renderer = vi.fn(() => {
		throw Error("SECRET");
	});
	const row = new CustomMessageComponent(message, renderer);
	expect(row.render(80).length).toBeLessThanOrEqual(2);
	expect(renderer).not.toHaveBeenCalled();
	row.setExpanded(true);
	expect(stripAnsi(row.render(80).join("\n"))).not.toContain("SECRET");
});
test("entry eligibility probes undefined, but never renders an eligible component collapsed", () => {
	const render = vi.fn(() => ["SECRET"]);
	const invalidate = vi.fn();
	const row = new CustomEntryComponent(entry, () => ({ render, invalidate }));
	expect(row.hasContent()).toBe(true);
	expect(row.render(80).length).toBeLessThanOrEqual(2);
	expect(render).not.toHaveBeenCalled();
	row.invalidate();
	expect(invalidate).not.toHaveBeenCalled();
	expect(new CustomEntryComponent(entry, () => undefined).hasContent()).toBe(false);
	const hidden = new CustomEntryComponent(entry, (_entry, { expanded }) =>
		expanded ? new Text("PRIVATE", 0, 0) : undefined,
	);
	hidden.setExpanded(true);
	expect(hidden.hasContent()).toBe(false);
	expect(hidden.render(80)).toEqual([]);
	const broken = new CustomEntryComponent(entry, () => {
		throw Error("SECRET");
	});
	expect(stripAnsi(broken.render(1)[0])).toBe("!");
	expect(stripAnsi(broken.render(80).join("\n"))).not.toContain("SECRET");
});
test("entry policy refresh hydrates discarded legacy detail once", () => {
	let policy = normalizeTranscriptPresentation();
	const renderer = vi.fn(() => new Text("PRIVATE DETAIL", 0, 0));
	const row = new CustomEntryComponent(entry, renderer, { transcriptPresentation: () => policy });
	expect(stripAnsi(row.render(80).join("\n"))).not.toContain("PRIVATE DETAIL");
	policy = normalizeTranscriptPresentation({ mode: "legacy" });
	expect(stripAnsi(row.render(80).join("\n"))).toContain("PRIVATE DETAIL");
	const calls = renderer.mock.calls.length;
	row.render(80);
	expect(renderer).toHaveBeenCalledTimes(calls);
});
test("user shell shares bounds while preserving complete raw output and cancellation", () => {
	const ui = { requestRender() {} } as unknown as TUI;
	const row = new BashExecutionComponent("echo hello", ui, true);
	row.appendOutput("PRIVATE\n".repeat(100));
	row.setComplete(1, true, undefined, "/tmp/full-output");
	expect(row.render(40).length).toBeLessThanOrEqual(2);
	expect(stripAnsi(row.render(40).join("\n"))).toContain("cancelled");
	expect(row.getOutput()).toBe("PRIVATE\n".repeat(100));
	row.setExpanded(true);
	expect(stripAnsi(row.render(80).join("\n"))).toContain("PRIVATE");
});
