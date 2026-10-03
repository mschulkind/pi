import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { Box, Container, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { EntryHintsProvider, EntryRenderer } from "../../../core/extensions/types.ts";
import type { CustomEntry } from "../../../core/session-manager.ts";
import { CompactHintsCache } from "../../../core/transcript-presentation.ts";
import { theme } from "../theme/theme.ts";
import { CompactTranscriptComponent } from "./compact-transcript.ts";
import { adapterPolicy, isExpansionClick, type TranscriptAdapterOptions } from "./transcript-adapter.ts";

/**
 * Component that renders a custom session entry from extensions.
 * The host owns transcript spacing; renderer output should provide only its content.
 */
export class CustomEntryComponent extends Container {
	private presentation: TranscriptAdapterOptions;
	private hints = new CompactHintsCache();
	private compact = new CompactTranscriptComponent({ identity: "", status: "info" });
	private entry: CustomEntry<unknown>;
	private renderer: EntryRenderer;
	private eligible = false;
	private rendererFailed = false;
	private detailReady = false;
	private _expanded = false;

	constructor(
		entry: CustomEntry<unknown>,
		renderer: EntryRenderer,
		presentation: TranscriptAdapterOptions = {},
		hints?: EntryHintsProvider,
	) {
		super();
		this.hints = new CompactHintsCache(presentation.onCompactDiagnostic);
		this.presentation = presentation;
		this.hints.update(hints, entry);
		this.entry = entry;
		this.renderer = renderer;
		this.rebuild();
	}

	hasContent(): boolean {
		return this.eligible;
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded !== expanded) {
			this._expanded = expanded;
			this.rebuild();
		}
	}

	override invalidate(): void {
		super.invalidate();
		this.rebuild();
	}

	override render(width: number): string[] {
		if (!this.hasContent()) return [];
		const policy = adapterPolicy(this.presentation, "entry", this.entry.customType);
		if (!this._expanded && policy.mode === "compact") {
			this.compact.setData(
				{
					identity: this.entry.customType,
					status: this.rendererFailed ? "error" : "info",
					hints: this.hints.hints,
				},
				policy.maxLines,
			);
			return this.compact.render(width);
		}
		if (!this.detailReady) this.rebuild();
		try {
			return super.render(width);
		} catch {
			return width > 0 ? [truncateToWidth("renderer unavailable", width, "")] : [];
		}
	}
	override handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
		if (!this._expanded && isExpansionClick(event)) {
			this.setExpanded(true);
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
	private rebuild(): void {
		this.clear();
		this.detailReady = false;
		this.eligible = false;
		this.rendererFailed = false;

		let component: Component | undefined;
		try {
			// Eligibility always follows the historical collapsed registration contract.
			const eligible = this.renderer(this.entry, { expanded: false }, theme);
			if (!eligible) return;
			this.eligible = true;
			// The collapsed probe authorizes visibility only; discard its component entirely.
			if (!this._expanded && adapterPolicy(this.presentation, "entry", this.entry.customType).mode === "compact")
				return;
			this.detailReady = true;
			component = this._expanded ? this.renderer(this.entry, { expanded: true }, theme) : eligible;
		} catch {
			this.rendererFailed = true;
			this.detailReady = true;
			const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
			box.addChild(new Text(theme.fg("error", "renderer unavailable"), 0, 0));
			component = box;
			this.eligible = true;
		}

		if (!component) {
			return;
		}

		this.addChild(new Spacer(1));
		this.addChild(component);
	}
}
