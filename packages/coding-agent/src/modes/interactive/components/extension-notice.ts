import { Container, Text, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { type CompactTranscriptHints, validateCompactHints } from "../../../core/transcript-presentation.ts";
import { theme } from "../theme/theme.ts";
import { CompactTranscriptComponent } from "./compact-transcript.ts";
import { adapterPolicy, isExpansionClick, type TranscriptAdapterOptions } from "./transcript-adapter.ts";

/** Ephemeral interactive notice: original delivery text is only used in detail. */
export class ExtensionNoticeComponent extends Container {
	private expanded = false;
	private severity: "info" | "warning" | "error";
	private options: TranscriptAdapterOptions;
	private hints?: CompactTranscriptHints;
	private compact = new CompactTranscriptComponent({ identity: "notice", status: "info" });
	constructor(
		message: string,
		severity: "info" | "warning" | "error",
		options: TranscriptAdapterOptions = {},
		hints?: CompactTranscriptHints,
	) {
		super();
		this.severity = severity;
		this.options = options;
		this.hints = validateCompactHints(hints);
		this.addChild(new Text(theme.fg(severity === "info" ? "dim" : severity, message), 1, 0));
	}
	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}
	override render(width: number): string[] {
		const policy = adapterPolicy(this.options, "notice", this.severity);
		if (!this.expanded && policy.mode === "compact") {
			this.compact.setData(
				{ identity: "notice", status: this.severity, statusAuthoritative: true, hints: this.hints },
				policy.maxLines,
			);
			return this.compact.render(width);
		}
		return super.render(width);
	}
	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		if (!this.expanded && isExpansionClick(event)) {
			this.expanded = true;
			return {
				handled: true,
				target: {
					component: this,
					originX: event.screenX - event.x,
					originY: event.screenY - event.y,
					width: event.width,
					height: event.height,
				},
			};
		}
		return super.handleMouse(event);
	}
}
