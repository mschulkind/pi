---
status: in-review
stage: IMPLEMENT
next: "Parent runs full managed build, non-e2e, and installed-package gates"
depends-on: [design.md, plan.md]
---

# Compact transcript adapters are integrated

Core now owns collapsed tools, displayed custom messages/entries, extension notices, and user shell rows through the [shared formatter](../../packages/coding-agent/src/modes/interactive/components/compact-transcript.ts). This completes the core integration scope of [the design](design.md), not the external migrations or landing gates.

## Live boundaries

- [ToolExecutionComponent](../../packages/coding-agent/src/modes/interactive/components/tool-execution.ts) defaults to compact presentation, bypasses arbitrary collapsed renderers, caches validated hints per call, rejects late partial results after completion, and expands the original renderer sequence. Core execution clocks are independent of shell renderer initialization. Completed edits seed their actual diff before asynchronous preview work. Settlement invalidates pending previews; failed edits discard proposed diffs and retain error presentation even if a preview resolves afterward.
- [InteractiveMode](../../packages/coding-agent/src/modes/interactive/interactive-mode.ts) passes live settings/provider lookup into execution, replay, custom messages/entries, and user shell creation. Tool and thinking toggles retain pending registration. Settings refresh existing rows without rebuilding execution state.
- Message and entry providers register with `registerMessageHints<T>` and `registerEntryHints<T>`, with first-registration lookup matching existing renderers. Hidden messages and undefined collapsed-entry eligibility stay hidden. Expanded custom renderer failures never authorize raw fallback, including failures from the returned component's render method.
- [Extension notices](../../packages/coding-agent/src/modes/interactive/components/extension-notice.ts) are ephemeral expandable rows. Interactive `notify` consumes the optional third hint argument. Consecutive info notices retain the status replacement boundary; warnings/errors stay separate. Producer status or error hints cannot change notice delivery severity. RPC and noninteractive implementations were not changed.
- User shell execution retains its original raw output, completion/cancellation, context exclusion, loader, and expanded framing. Compact presentation selects only command identity, authoritative status, exclusion marker, exit error, and output-path availability.

## Producers and ownership

Built-in providers live beside their existing detail renderers. Read keeps skill/resource/docs classification and line ranges; edit reports added/removed counts; write reports line counts; shell reports full-output paths; known errors and images use explicitly selected producer data. Find, grep, and ls select their own safe operation labels. Read, grep, find, ls, bash, and PowerShell select truncation/limit warnings from known metadata, preserve a warning marker at one column, and retain execution-error priority.

The [ownership helper](../../packages/coding-agent/src/core/tools/renderers/compact-ownership.ts) ties built-in hint callbacks to both original renderer references. A redacting override or synthesized SDK definition cannot acquire argument disclosure merely by using a built-in tool name. No formatter dispatches on tool names.

Codemode also registers ownership against both original renderer slots, so overriding either slot disables inherited hints. It supplies aggregate calls/failures/running/cancelled counts, nested error text, recorded cost, and output paths to core. Its legacy inline rendering and full expanded script/nested-call interactions remain available. Positive fractional-cent costs retain significant digits.

## Public API and settings

The public exports include `CompactTranscriptHints`, `CompactTranscriptStatus`, `ToolCompactHintsInput`, `ToolCompactHintsProvider`, `MessageHintsProvider`, and `EntryHintsProvider`. Tool renderer context now includes optional `result`, `startedAt`, and `endedAt` to hydrate detail after collapsed execution; no execution payload or persistence format changed.

`transcriptPresentation` defaults to compact, two visual lines, and no exceptions. One `/settings` submenu changes mode and the 1–4 line budget while retaining exact exceptions and changes from prior submenu openings. Exceptions are configured in settings files. See [settings](../../packages/coding-agent/docs/settings.md#transcript-presentation) and [extension contracts](../../packages/coding-agent/docs/extensions.md#compact-display-data).

The todo/truncated-tool examples select progress/count/path data without wrapping execution. SDK examples explain display-only providers and policy. Public TUI, SDK, RPC, keybinding, settings, and extension guides plus the current Unreleased changelog describe integrated behavior, not a preparatory API.

## Verification boundary

[QA](qa.md) records targeted component and faux-provider lifecycle evidence, including actual InteractiveMode event/replay/toggle methods. No extra model requests, provider selection, thinking summary generation, accounting, approval/picker/widget behavior, or external repository sources were changed.

No commit, push, deployment, build, unrestricted test run, or paid provider was used. The parent owns full managed landing gates and controlled terminal verification. External display migrations remain [separately scoped work](tasks.md#t4--later-inverse-commits-in-dependent-repositories).
