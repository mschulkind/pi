import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Container, Markdown, type MarkdownTheme, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import type { MarkdownTransformer, ThinkingSummaryProvider } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/**
 * Collapsed-label defaults. These mirror the shipped `thinking-preview`
 * extension so a block collapsed here and a block previewed there do not
 * disagree: the first N non-blank lines joined onto one row, with a character
 * backstop for a single runaway line.
 */
const DEFAULT_THINKING_PREVIEW_LINES = 6;
const DEFAULT_THINKING_PREVIEW_CHARS = 900;
const THINKING_PREVIEW_SEPARATOR = " \u00b7 ";
const THINKING_PREVIEW_ELLIPSIS = "\u2026";
/** Marks a label whose text was generated for the block, not quoted from it. */
const GENERATED_THINKING_MARKER = "\u2726 ";
const DEFAULT_HIDDEN_THINKING_LABEL = "Thinking...";

/**
 * Stable, non-cryptographic content hash for a thinking block (cyrb53). Used
 * only as a cache key for generated summaries, so a hash collision would show
 * the wrong summary, never change what a block says.
 */
export function thinkingContentHash(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Flattens the first `maxLines` non-blank lines of a thinking block onto one
 * row, trimmed to `maxChars` as a backstop and marked with an ellipsis when
 * that fires. Returns an empty string when the block has no visible text, so
 * the caller can fall back to its own label.
 */
function previewThinkingText(
	text: string,
	maxLines = DEFAULT_THINKING_PREVIEW_LINES,
	maxChars = DEFAULT_THINKING_PREVIEW_CHARS,
): string {
	// Never scan all of a still-growing block: this runs per streamed token.
	const scanLimit = Math.max(4096, maxChars * 2);
	const lines = text
		.slice(0, scanLimit)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return "";
	const joined = lines.slice(0, maxLines).join(THINKING_PREVIEW_SEPARATOR);
	if (joined.length <= maxChars) return joined;
	return joined.slice(0, Math.max(0, maxChars - 1)).trimEnd() + THINKING_PREVIEW_ELLIPSIS;
}

/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private hiddenThinkingLabel: string | undefined;
	private thinkingSummaryProvider: ThinkingSummaryProvider | undefined;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	private thinkingVisibilityOverrides = new Map<number, boolean>();

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		hiddenThinkingLabel: string | undefined = undefined,
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
		thinkingSummaryProvider: ThinkingSummaryProvider | undefined = undefined,
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.hiddenThinkingLabel = hiddenThinkingLabel;
		this.thinkingSummaryProvider = thinkingSummaryProvider;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.thinkingVisibilityOverrides.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHiddenThinkingLabel(label?: string): void {
		this.hiddenThinkingLabel = label;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setThinkingSummaryProvider(provider?: ThinkingSummaryProvider): void {
		this.thinkingSummaryProvider = provider;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/**
	 * Resolves the one-line label for a collapsed thinking run: an explicitly
	 * set label wins, then a summary the extension generated for this exact
	 * text, then the block's own first lines. Generated text is marked so it is
	 * never mistaken for the model's words.
	 */
	private resolveHiddenThinkingLabel(text: string): string {
		if (this.hiddenThinkingLabel !== undefined) {
			return theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel));
		}
		// A summary is only meaningful once the block has stopped growing; skip
		// the provider per streamed token and ask again on the final update.
		if (!this.isStreaming && this.thinkingSummaryProvider) {
			const summary = this.thinkingSummaryProvider(thinkingContentHash(text), text);
			if (summary) {
				return theme.fg("accent", GENERATED_THINKING_MARKER) + theme.italic(theme.fg("thinkingText", summary));
			}
		}
		const preview = previewThinkingText(text);
		return theme.italic(theme.fg("thinkingText", preview || DEFAULT_HIDDEN_THINKING_LABEL));
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.lastMessage = message;
		this.isStreaming = isStreaming;

		// Clear content container
		this.contentContainer.clear();

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		let thinkingRunIndex = 0;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(
					new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme, undefined, {
						transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
					}),
				);
			} else if (content.type === "thinking") {
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				i--;

				if (thinkingBlocks.length === 0) {
					continue;
				}

				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				const runIndex = thinkingRunIndex++;
				const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;
				const thinkingComponent = hidden
					? new Text(this.resolveHiddenThinkingLabel(thinkingBlocks.join("\n\n")), this.outputPad, 0)
					: new Markdown(
							thinkingBlocks.join("\n\n"),
							this.outputPad,
							0,
							this.markdownTheme,
							{
								color: (text: string) => theme.fg("thinkingText", text),
								italic: true,
							},
							{
								transform: createMarkdownTransform(
									"assistant-thinking",
									this.isStreaming,
									this.markdownTransformers,
								),
							},
						);
				this.contentContainer.addChild(
					new MouseRegion(thinkingComponent, (event) => {
						if (event.type !== "click" || event.button !== "left") return undefined;
						this.thinkingVisibilityOverrides.set(runIndex, !hidden);
						if (this.lastMessage) this.updateContent(this.lastMessage);
						return { handled: true };
					}),
				);
				if (hasVisibleContentAfter) {
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		// Check if incomplete/failed - show after partial content.
		// For aborted/error tool calls, tool execution components show the error.
		// Length stops can happen before a tool call is complete, so surface them here too.
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), this.outputPad, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				const abortMessage =
					message.errorMessage && message.errorMessage !== "Request was aborted"
						? message.errorMessage
						: "Operation aborted";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", abortMessage), this.outputPad, 0));
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			}
		}
	}
}
