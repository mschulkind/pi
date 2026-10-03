import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import {
	type NormalizedTranscriptPresentation,
	normalizeTranscriptPresentation,
	resolveTranscriptPresentation,
	type TranscriptKind,
} from "../../../core/transcript-presentation.ts";

export interface TranscriptAdapterOptions {
	onCompactDiagnostic?: (message: string) => void;
	transcriptPresentation?: () => NormalizedTranscriptPresentation;
}
export function adapterPolicy(options: TranscriptAdapterOptions, kind: TranscriptKind, name: string) {
	return resolveTranscriptPresentation(
		options.transcriptPresentation?.() ?? normalizeTranscriptPresentation(),
		kind,
		name,
	);
}
export function isExpansionClick(event: TuiMouseEvent): boolean {
	return event.type === "click" && event.button === "left";
}
