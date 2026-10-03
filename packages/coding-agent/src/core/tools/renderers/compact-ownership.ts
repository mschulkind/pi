import type { Component } from "@earendil-works/pi-tui";
import type { ToolCompactHintsInput, ToolDefinition } from "../../extensions/types.ts";
import type { CompactTranscriptHints } from "../../transcript-presentation.ts";

type Presentation = Pick<ToolDefinition, "renderCall" | "renderResult">;
const owners = new WeakMap<object, Presentation>();
const compactCleanups = new WeakMap<Component, () => void>();
/** Built-in detail producers register only their own timer cleanup. */
export function registerCompactCleanup(component: Component, cleanup: () => void): void {
	compactCleanups.set(component, cleanup);
}
export function pauseCompactDetail(component?: Component): void {
	if (component) compactCleanups.get(component)?.();
}
/** Keep inherited built-in display data tied to both original renderer slots, not a tool name. */
export function ownCompactHints<T extends object>(renderers: T): T {
	const data = renderers as Presentation & { getCompactHints?: unknown };
	if (typeof data.getCompactHints === "function") owners.set(data.getCompactHints, data);
	return renderers;
}
export function ownedCompactProvider<T>(provider: T, renderers: Presentation): T | undefined {
	if (typeof provider !== "function") return provider;
	const owner = owners.get(provider);
	return owner && (owner.renderCall !== renderers.renderCall || owner.renderResult !== renderers.renderResult)
		? undefined
		: provider;
}
/** Only built-in producers call this helper; unknown tools never disclose arguments/results. */
export function builtinCompactHints(
	input: ToolCompactHintsInput<unknown, unknown>,
	label: string,
): CompactTranscriptHints {
	const error = input.isError
		? input.result?.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join(" ")
				.slice(0, 160)
		: undefined;
	const images = input.result?.content.filter((part) => part.type === "image").length ?? 0;
	return { label: label.slice(0, 160), error, counts: images ? [{ label: "images", value: images }] : undefined };
}

/** Producers select warning text explicitly; known execution errors retain higher priority. */
export function addCompactWarning(hints: CompactTranscriptHints, warning?: string): CompactTranscriptHints {
	return warning && !hints.error ? { ...hints, status: "warning", error: warning.slice(0, 160) } : hints;
}
