import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import {
	CompactHintsCache,
	normalizeTranscriptPresentation,
	resolveTranscriptPresentation,
	sanitizeTranscriptText,
	validateCompactHints,
} from "../src/core/transcript-presentation.ts";
import {
	CompactTranscriptComponent,
	formatCompactTranscript,
} from "../src/modes/interactive/components/compact-transcript.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("compact transcript data boundary", () => {
	test("copies only bounded, explicitly disclosed plain data", () => {
		const source = { label: "safe", counts: [{ label: "failed", value: 2 }], outputPaths: ["/tmp/output"] };
		const hints = validateCompactHints(source);
		expect(hints).toEqual(source);
		source.counts[0].value = 9;
		expect(hints?.counts?.[0].value).toBe(2);
		expect(validateCompactHints({ secret: { content: "private" }, summary: "safe" })).toEqual({ summary: "safe" });
	});

	test.each([
		null,
		[],
		new Date(),
		() => {},
		{ label: "x".repeat(161) },
		{ costUsd: Infinity },
		{ costUsd: -1 },
		{ progress: { completed: 2, total: 1 } },
		{ counts: Array(5).fill({ label: "n", value: 1 }) },
		{ outputPaths: ["x".repeat(257)] },
	])("rejects malformed roots or unsafe known fields: %j", (value) => {
		expect(validateCompactHints(value)).toBeUndefined();
	});

	test("never executes accessors, toJSON, or unknown data", () => {
		const getter = vi.fn(() => "private");
		expect(validateCompactHints(Object.defineProperty({}, "label", { get: getter }))).toBeUndefined();
		expect(getter).not.toHaveBeenCalled();
		const toJSON = vi.fn(() => {
			throw new Error("private");
		});
		expect(validateCompactHints({ summary: "safe", toJSON })).toEqual({ summary: "safe" });
		expect(toJSON).not.toHaveBeenCalled();
		const unknownGetter = vi.fn(() => {
			throw new Error("private");
		});
		expect(
			validateCompactHints(Object.defineProperty({ summary: "safe" }, "unknown", { get: unknownGetter })),
		).toEqual({ summary: "safe" });
		expect(unknownGetter).not.toHaveBeenCalled();
	});

	test("drops controls, string sequences, bidi controls and line breaks", () => {
		const text = "a\x1b[31mb\x1b[0m\n\t\u202ec\x1b]8;;secret\x07d\x1b]8;;\x07\x1b_Gprivate\x1b\\e";
		expect(sanitizeTranscriptText(text)).toBe("ab cde");
		expect(validateCompactHints({ summary: text })?.summary).not.toMatch(/[\x00-\x1f\x7f-\x9f\u202e]/);
	});

	test.each([
		"\x1bPsecret\x1b\\",
		"\x1bPsecret",
		"\x9dsecret\x9c",
		"\x1b]secret\x07",
		"\x1b[2J",
		"\x9b31m",
		"\x1b[?25l",
	])("removes terminal command payloads: %j", (sequence) => {
		expect(sanitizeTranscriptText(`safe${sequence}`)).toBe("safe");
	});

	test("bounds serialized bytes and rejects array accessors without executing them", () => {
		expect(
			validateCompactHints({
				label: "\ud800".repeat(160),
				summary: "\ud800".repeat(160),
				error: "\ud800".repeat(160),
				outputPaths: ["\ud800".repeat(256), "\ud800".repeat(256)],
			}),
		).toBeUndefined();
		const getter = vi.fn(() => "private");
		const paths = Object.defineProperty(["safe"], "0", { get: getter });
		expect(validateCompactHints({ outputPaths: paths })).toBeUndefined();
		expect(getter).not.toHaveBeenCalled();
	});

	test("callback failures use generic data and diagnose once without raw content", () => {
		const diagnostic = vi.fn();
		const producer = vi.fn(() => {
			throw new Error("secret payload");
		});
		const cache = new CompactHintsCache(diagnostic);
		cache.update(producer, {});
		cache.update(producer, {});
		expect(cache.hints).toBeUndefined();
		expect(producer).toHaveBeenCalledTimes(2);
		expect(diagnostic).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("secret");
	});

	test("caches per event, not per render, and keeps producer state separate", () => {
		const producer = vi.fn((input: { value: string }) => ({ summary: input.value }));
		const a = new CompactHintsCache();
		const b = new CompactHintsCache();
		a.update(producer, { value: "a" });
		b.update(producer, { value: "b" });
		expect(a.hints?.summary).toBe("a");
		expect(b.hints?.summary).toBe("b");
		for (let i = 0; i < 10; i++)
			formatCompactTranscript({ identity: "unknown", status: "running", hints: a.hints }, 40);
		expect(producer).toHaveBeenCalledTimes(2);
		a.update(undefined, {});
		expect(a.hints).toBeUndefined();
	});
});

describe("central presentation policy", () => {
	test("defaults and exact first-valid matching", () => {
		expect(normalizeTranscriptPresentation()).toEqual({ mode: "compact", maxLines: 2, exceptions: [] });
		const settings = normalizeTranscriptPresentation({
			exceptions: [
				{ kind: "tool", name: "redacted", mode: "legacy" },
				{ kind: "tool", name: "redacted", mode: "compact", maxLines: 4 },
				{ kind: "message", name: "redacted", maxLines: 1 },
			],
		});
		expect(resolveTranscriptPresentation(settings, "tool", "redacted")).toEqual({ mode: "legacy", maxLines: 2 });
		expect(resolveTranscriptPresentation(settings, "message", "redacted")).toEqual({ mode: "compact", maxLines: 1 });
		expect(resolveTranscriptPresentation(settings, "tool", "redacted-more")).toEqual({
			mode: "compact",
			maxLines: 2,
		});
	});

	test("invalid settings safely fall back and yield bounded diagnostics", () => {
		const diagnostic = vi.fn();
		const result = normalizeTranscriptPresentation(
			{
				mode: "anything",
				maxLines: 99,
				exceptions: [
					null,
					{ kind: "widget", name: "secret" },
					{ kind: "tool", name: "ok", mode: "invalid", maxLines: -1 },
				],
			},
			diagnostic,
		);
		expect(result).toEqual({
			mode: "compact",
			maxLines: 2,
			exceptions: [{ kind: "tool", name: "ok", mode: "compact", maxLines: 2 }],
		});
		expect(diagnostic).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("secret");
	});
});

describe("core bounded rows", () => {
	test.each([0, 1, 2, 10, 40, 80])("never exceeds total rows or cell width at %i columns", (width) => {
		for (const maxLines of [1, 2, 3, 4]) {
			const hints = validateCompactHints({
				label: "界😀é".repeat(20),
				error: "failure\n".repeat(10),
				counts: [{ label: "failed", value: 2 }],
				progress: { completed: 1, total: 10 },
				costUsd: 0.02,
				outputPaths: ["/very/long/".repeat(20)],
				summary: "summary",
			});
			const lines = formatCompactTranscript(
				{ identity: "unknown\nprivate", status: "error", hints },
				width,
				maxLines,
				"ctrl+o to expand",
			);
			expect(lines.length).toBeLessThanOrEqual(width === 0 ? 0 : maxLines);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				expect(line).not.toContain("\n");
			}
			if (width === 1) expect(stripAnsi(lines[0])).toBe("!");
		}
	});

	test("generic data contains only identity, authoritative status and affordance", () => {
		const text = formatCompactTranscript(
			{ identity: "unfamiliar", status: "preparing" },
			80,
			2,
			"ctrl+o to expand",
		).join("\n");
		expect(text).toBe("… preparing unfamiliar · ctrl+o to expand");
	});

	test("hint success cannot hide errors, warnings, or running lifecycle", () => {
		for (const status of ["error", "warning", "running", "preparing"] as const) {
			expect(
				formatCompactTranscript({ identity: "tool", status, hints: { status: "completed" } }, 80).join(" "),
			).toContain(status);
		}
	});

	test.each(["error", "warning"] as const)(
		"reserves nested %s disclosure even in one-cell and one-line rows",
		(status) => {
			const hints = validateCompactHints({ status, error: "task failed" });
			for (const width of [1, 2, 8, 12, 40, 80]) {
				for (const maxLines of [1, 2]) {
					const data = { identity: "control", status: "completed" as const, hints };
					const lines = formatCompactTranscript(data, width, maxLines);
					expect(stripAnsi(lines[0])[0]).toBe(status === "error" ? "!" : "?");
					if (width >= status.length + 2) expect(stripAnsi(lines.join(" "))).toContain(status);
					if (width >= 80) expect(lines.join(" ")).toContain("completed");
					expect(lines.length).toBeGreaterThan(0);
					expect(lines.length).toBeLessThanOrEqual(maxLines);
					for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					expect(data.status).toBe("completed");
				}
			}
		},
	);

	test("nested status alone and error text alone cannot be hidden by completion", () => {
		for (const hints of [validateCompactHints({ status: "error" }), validateCompactHints({ error: "task failed" })]) {
			expect(stripAnsi(formatCompactTranscript({ identity: "control", status: "completed", hints }, 1)[0])).toBe(
				"!",
			);
			expect(
				formatCompactTranscript({ identity: "control", status: "completed", hints }, 12, 1).join(" "),
			).toContain("error");
		}
	});

	test("the component colors nested alerts and resets presentation after an update", () => {
		initTheme("dark");
		const component = new CompactTranscriptComponent({
			identity: "control",
			status: "completed",
			hints: validateCompactHints({ status: "error", error: "task failed" }),
		});
		expect(component.render(1)).toEqual([theme.fg("error", "!")]);
		component.setData({
			identity: "control",
			status: "completed",
			hints: validateCompactHints({ status: "warning" }),
		});
		expect(component.render(1)).toEqual([theme.fg("warning", "?")]);
		component.setData({ identity: "control", status: "completed" });
		component.invalidate();
		expect(stripAnsi(component.render(1)[0])).toBe("+");
	});

	test.each([0.000012, 0.000001, 1e-12, Number.MIN_VALUE])(
		"recorded nonzero cost %s remains distinct from zero",
		(costUsd) => {
			const format = (cost: number) =>
				formatCompactTranscript(
					{ identity: "control", status: "completed", hints: validateCompactHints({ costUsd: cost }) },
					80,
				).join(" ");
			const text = format(costUsd);
			expect(text).not.toBe(format(0));
			const amount = text.match(/\$(\S+)/)?.[1];
			expect(amount).toBeDefined();
			expect(Number(amount)).toBeGreaterThan(0);
			if (costUsd === 0.000012) expect(text).toContain("$0.000012");
		},
	);

	test("nested failure remains distinct from successful control tool", () => {
		const text = formatCompactTranscript(
			{
				identity: "control",
				status: "completed",
				hints: {
					status: "error",
					error: "task failed",
					counts: [
						{ label: "failed", value: 2 },
						{ label: "running", value: 4 },
					],
				},
			},
			80,
		).join(" ");
		expect(text).toContain("completed");
		expect(text).toContain("error: task failed");
		expect(text).toContain("failed 2");
		expect(text).toContain("running 4");
	});

	test("omits numeric and path fragments rather than inventing misleading values", () => {
		const lines = formatCompactTranscript(
			{
				identity: "tool",
				status: "completed",
				hints: { outputPaths: [`/${"x".repeat(200)}`], costUsd: 0 },
			},
			30,
		);
		expect(lines.join(" ")).toContain("output available");
		expect(lines.join(" ")).not.toContain("/xxxx");
		const numeric = formatCompactTranscript(
			{ identity: "tool", status: "completed", hints: { counts: [{ label: "count", value: 123456789 }] } },
			10,
		);
		expect(numeric.join(" ")).not.toContain("count");
	});
});
