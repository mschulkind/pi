/**
 * Presentation for the codemode tool.
 *
 * Collapsed calls and results use a short inline status. Expansion reveals the script,
 * every nested call, and the script output. Errors and model-call costs remain visible
 * when collapsed. This changes presentation only, never the model-facing output.
 */

import { Text } from "@earendil-works/pi-tui";
import type { ToolDefinition } from "../../core/extensions/types.ts";
import { getTextOutput, replaceTabs, str } from "../../core/tools/render-utils.ts";
import { highlightCode, type Theme } from "../../modes/interactive/theme/theme.ts";
import type { CodemodeNestedCall, CodemodeToolDetails } from "./tool.ts";

const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n$/;

function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "";
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Cents for larger amounts, two significant digits for the fractions of a cent classifier calls cost. */
function formatCost(cost: number): string {
	return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

function statusIcon(call: CodemodeNestedCall, theme: Theme): string {
	switch (call.status) {
		case "running":
			return theme.fg("warning", "…");
		case "ok":
			return theme.fg("success", "✓");
		case "error":
			return theme.fg("error", "✗");
		case "cancelled":
			return theme.fg("muted", "⊘");
	}
}

function formatCall(call: CodemodeNestedCall, theme: Theme): string {
	const args = call.args;
	const duration = formatDuration(call.durationMs);
	let line = `${statusIcon(call, theme)} ${theme.fg("toolTitle", call.name)}`;
	if (args) line += ` ${theme.fg("muted", args)}`;
	if (duration) line += ` ${theme.fg("dim", duration)}`;
	if (call.cost) line += ` ${theme.fg("dim", formatCost(call.cost))}`;
	if (call.error) line += `\n    ${theme.fg("error", call.error.split("\n").join("\n    "))}`;
	return line;
}

export const codemodeRenderers: Pick<
	ToolDefinition<any, CodemodeToolDetails | undefined>,
	"renderShell" | "renderCall" | "renderResult"
> = {
	renderShell: "inline",
	renderCall(args, theme, context) {
		// The code includes the `// @options:` line, so options show as part of the script.
		const code = str((args as { code?: unknown } | undefined)?.code);
		let text = theme.fg("toolTitle", theme.bold("codemode"));
		if (code === null) {
			text += ` ${theme.fg("error", "[invalid arg]")}`;
		} else if (code && !context.expanded) {
			const count = code.replace(/\r/g, "").trimEnd().split("\n").length;
			text += theme.fg("muted", ` · ${count} line${count === 1 ? "" : "s"}`);
		} else if (code) {
			const lines = highlightCode(replaceTabs(code.replace(/\r/g, "").trimEnd()), "javascript");
			text += `\n${lines.join("\n")}`;
		}
		const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		component.setText(text);
		return component;
	},
	renderResult(result, options, theme, context) {
		const sections: string[] = [];
		const calls = result.details?.calls ?? [];
		if (!options.expanded) {
			const [first, ...rest] = result.content;
			const hasHeader = first?.type === "text" && SCRIPT_HEADER.test(first.text);
			const output = options.isPartial
				? ""
				: getTextOutput({ ...result, content: hasHeader ? rest : result.content }, context.showImages).trim();
			const failed = calls.filter((call) => call.status === "error");
			const running = calls.filter((call) => call.status === "running").length;
			const cancelled = calls.filter((call) => call.status === "cancelled").length;
			const isError = context.isError || failed.length > 0;
			const status = isError ? "✗ failed" : options.isPartial ? "… running" : "✓ done";
			const parts = [theme.fg(isError ? "error" : options.isPartial ? "warning" : "success", status)];
			if (calls.length) parts.push(`${calls.length} call${calls.length === 1 ? "" : "s"}`);
			if (running) parts.push(`${running} running`);
			if (failed.length) parts.push(theme.fg("error", `${failed.length} failed`));
			if (cancelled) parts.push(`${cancelled} cancelled`);
			const total = calls.reduce((sum, call) => sum + (call.cost ?? 0), 0);
			if (total) parts.push(formatCost(total));
			if (output) {
				const count = output.split("\n").length;
				parts.push(`${count} output line${count === 1 ? "" : "s"}`);
			}
			const error = context.isError ? output : failed.find((call) => call.error)?.error;
			if (error) parts.push(theme.fg("error", error.replace(/\s+/g, " ").slice(0, 160)));
			if (result.details?.fullOutputPath) parts.push(`Full output: ${result.details.fullOutputPath}`);
			const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			component.setText(parts.join(" · "));
			return component;
		}
		if (calls.length > 0) {
			const lines = calls.map((call) => formatCall(call, theme));
			const priced = calls.filter((call) => call.cost);
			if (priced.length > 1) {
				const total = priced.reduce((sum, call) => sum + (call.cost ?? 0), 0);
				lines.push(theme.fg("muted", `Model calls: ${formatCost(total)}`));
			}
			sections.push(lines.join("\n"));
		}

		// Drop the "Script completed\nWall time ...\nOutput:\n" header. Rejected input (invalid options)
		// has no header.
		const [first, ...rest] = result.content;
		const hasHeader = first?.type === "text" && SCRIPT_HEADER.test(first.text);
		const output = options.isPartial
			? ""
			: getTextOutput({ ...result, content: hasHeader ? rest : result.content }, context.showImages).trim();
		if (output) {
			const color = context.isError ? "error" : "toolOutput";
			const lines = replaceTabs(output).split("\n");
			let text = lines.map((line) => theme.fg(color, line)).join("\n");
			const fullOutputPath = result.details?.fullOutputPath;
			if (fullOutputPath) text += `\n${theme.fg("muted", `Full output: ${fullOutputPath}`)}`;
			sections.push(text);
		}

		const component = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
		component.setText(sections.length > 0 ? `\n${sections.join("\n\n")}` : "");
		return component;
	},
};
