import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CompactTranscriptHints, CompactTranscriptStatus } from "../../../core/transcript-presentation.ts";
import { sanitizeTranscriptText } from "../../../core/transcript-presentation.ts";
import { theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

export interface CompactTranscriptData {
	identity: string;
	status: CompactTranscriptStatus | "preparing";
	/** Notices retain delivery severity regardless of producer lifecycle hints. */
	statusAuthoritative?: boolean;
	/** Validated, copied data from CompactHintsCache or validateCompactHints. */
	hints?: CompactTranscriptHints;
}

/** Display severity can include nested alerts without changing the authoritative execution state. */
function getDisplayStatus(data: CompactTranscriptData): CompactTranscriptData["status"] {
	if (data.statusAuthoritative) return data.status;
	const hintedStatus = data.hints?.error
		? data.hints.status === "warning"
			? "warning"
			: "error"
		: data.hints?.status;
	if (data.status === "error" || hintedStatus === "error") return "error";
	if (data.status === "warning" || hintedStatus === "warning") return "warning";
	return data.status === "info" ? (hintedStatus ?? "info") : data.status;
}

/** Format plain display data, not rendered components. The budget includes every returned row. */
export function formatCompactTranscript(
	data: CompactTranscriptData,
	width: number,
	maxLines = 2,
	expandHint = "",
): string[] {
	if (!Number.isFinite(width) || width < 1) return [];
	width = Math.floor(width);
	const budget = Number.isInteger(maxLines) && maxLines >= 1 && maxLines <= 4 ? maxLines : 2;
	const hints = data.hints;
	// Reserve the leading marker/word for the highest disclosed severity, even at one cell/line.
	const status = getDisplayStatus(data);
	const marker = { preparing: "…", running: "~", error: "!", warning: "?", completed: "+", cancelled: "-", info: "·" }[
		status
	];
	if (width === 1) return [marker];
	const rows = [truncateToWidth(`${marker} ${status}`, width, "")];
	const append = (value: string, clip = false): void => {
		if (!value) return;
		const last = rows.length - 1;
		const joined = `${rows[last]} · ${value}`;
		if (visibleWidth(joined) <= width) {
			rows[last] = joined;
		} else if (rows.length < budget) {
			if (visibleWidth(value) <= width) rows.push(value);
			else if (clip) rows.push(truncateToWidth(value, width, "…"));
		} else if (clip) {
			const remaining = width - visibleWidth(rows[last]) - 3;
			if (remaining > 1) rows[last] += ` · ${truncateToWidth(value, remaining, "…")}`;
		}
	};
	// Error/warning disclosure outranks identity and optional metrics. Do not reinterpret success.
	if (hints?.error) append(`${hints.status === "warning" ? "warning" : "error"}: ${hints.error}`, true);
	else if (
		!data.statusAuthoritative &&
		hints?.status &&
		hints.status !== status &&
		hints.status !== "completed" &&
		hints.status !== "info"
	)
		append(hints.status);
	// Keep execution completion/running state separate from nested display severity when space permits.
	if (status !== data.status && data.status !== "info") append(data.status);
	const identity = sanitizeTranscriptText(hints?.label || data.identity);
	const firstIdentity = `${rows[0]} ${identity}`;
	if (rows.length === 1 && visibleWidth(firstIdentity) <= width) rows[0] = firstIdentity;
	else append(identity, true);
	if (hints?.progress) append(`${hints.progress.completed}/${hints.progress.total}`);
	for (const count of hints?.counts ?? []) append(`${count.label} ${count.value}`);
	for (const path of hints?.outputPaths ?? []) {
		const display = `output: ${path}`;
		append(visibleWidth(display) <= width ? display : "output available");
	}
	if (hints?.costUsd !== undefined) {
		const cost = hints.costUsd;
		// Significant digits preserve fractional-cent charges; the entire amount is atomic in layout.
		append(`$${cost === 0 || cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`);
	}
	if (hints?.summary) append(hints.summary, true);
	append(sanitizeTranscriptText(expandHint));
	// Only core adds styling later. Width truncation may emit an SGR reset, never producer ANSI.
	return rows;
}

/** Theme-aware shell shared by adapters. Producers never supply terminal components to this view. */
export class CompactTranscriptComponent implements Component {
	private data: CompactTranscriptData;
	private maxLines: number;

	constructor(data: CompactTranscriptData, maxLines = 2) {
		this.data = data;
		this.maxLines = maxLines;
	}

	setData(data: CompactTranscriptData, maxLines = this.maxLines): void {
		this.data = data;
		this.maxLines = maxLines;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const status = getDisplayStatus(this.data);
		const color = status === "error" ? "error" : status === "warning" ? "warning" : "muted";
		return formatCompactTranscript(this.data, width, this.maxLines, `${keyText("app.tools.expand")} to expand`).map(
			(line) => theme.fg(color, line),
		);
	}
}
