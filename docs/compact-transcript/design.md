---
status: accepted
stage: DECIDED
next: "Parent verifies integrated adapters before landing"
---

# Core owns collapsed transcript rows, not their detail

**Status:** 2026-10-03. Accepted behavior against `55c964318` (Pi 1.0); core integration evidence is in [implementation](implementation.md) and [QA](qa.md).

> **In short.** Core renders collapsed transcript rows from execution state and optional display data. Existing renderers remain responsible for expanded detail.

**Why it matters:** Clipping arbitrary renderer output cannot guarantee concise presentation, error visibility, or redaction.
**Cost:** Unknown extensions lose their custom collapsed layout by default, not their execution or expanded UI.
**Start at:** [Ownership and scope](#ownership-and-scope).
**Needs your ruling:** None; implementation choices not fixed below are delegated.
**Reads with:** [Research](research.md) (evidence), [plan](plan.md) (API and file map), [tasks](tasks.md) (verification sequence).

---

## Ownership and scope

Here **collapsed** and **expanded** retain Pi's existing meaning: the brief and detailed transcript views selected by tool expansion. A **hint** is optional, explicitly supplied display data, not evidence extracted from an arbitrary component or unknown result structure.

1. **P1 — Core owns collapsed presentation.** Core chooses status, colors, ordering, truncation, spacing, expansion affordances, and maximum rendered lines. Extensions cannot return terminal components for this view.
2. **P2 — Producers own disclosure.** A hint producer explicitly selects safe labels, counts, progress, cost, and output-file paths. Core never discovers these by scraping terminal output, parsing arbitrary JSON, or examining unknown arguments/results.
3. **P3 — Detail remains detail.** Expansion invokes the current call/result/message/entry renderer with expansion enabled; retain images, mouse handling, focus, disposal, theme invalidation, and keybindings.
4. **P4 — Display is not execution.** No change to tool schemas, execution, permission checks, model context/results, session content, usage, transport events, or standard output.

Included: model tool rows (built-in, extension, MCP and plain SDK tools), displayed extension custom messages, currently displayable custom entries, and extension `ui.notify` calls that produce transcript notices. User `!`/`!!` shell rows use the same presentation policy through their separate execution adapter.

Excluded: user/assistant prose, approval dialogs, selectors, pickers, `ui.custom` overlays, persistent widgets, dashboards, editor/status/footer UI, startup resources, and existing branch/compaction summaries. Do not treat all uses of core `showStatus`/`showError` as extension notices. A tool whose expanded renderer opens or embeds an interactive UI retains that behavior.

## Data and state

Core supplies identity and lifecycle independently of hints:

- Tools: preparing until complete arguments, running after execution starts, then completed/error from the execution result; incomplete restored calls remain pending, never success.
- User shell: preparing/running/completed/error/cancelled from the existing shell component, including actual exit code and exclusion-from-context marker.
- Custom message/entry: neutral information unless its producer explicitly supplies warning/error/running/completed/cancelled status. Missing status never implies success.
- Notices: existing info/warning/error severity is authoritative. Information is not a successful operation. Preserve delivery and consecutive information-notice replacement at the current status boundary, rather than turning every refresh into a new transcript item; warnings/errors retain their current separate-item behavior.

Hints may add label, safe summary/error text, numeric counts, progress, recorded USD cost, output paths, and warning/error state for nested work. A tool may complete successfully while a nested task remains running or fails: show those facts separately rather than changing the tool's model-facing success. A hint cannot downgrade a core error, warning, or running state.

Unknown producers show only sanitized identity, authoritative state, and the configurable expansion key hint. **No fallback argument preview, result text, JSON, image payload, or custom-message headline.** Even error text must be explicitly supplied by a producer before appearing collapsed. Full data remains available through the existing authorized detail view and session/model paths.

## Bounds and priorities

Default: **two visual lines total per collapsed item**, no blank separator or filled outer box. This includes status, optional metadata, and any expansion affordance. One-line success is preferred; two lines are a ceiling, not padding. Budget applies per message/notice, not per nested task.

- Settings permit 1–4 visual lines, never unlimited in compact mode.
- Reserve the first visible cell for a core-owned display marker reflecting the most severe disclosed core or nested alert. A nested error/warning cannot disappear behind a completed control tool at width 1 or with a one-line budget. Show the alert word before identity when it fits and retain the independent execution state when space permits; if both cannot fit, the alert takes priority without changing the execution outcome. At width 1 use distinct running/error/warning markers. Width 0 returns no lines.
- Then prioritize safe error/warning text, identity, progress/failure counts, output-path availability, remaining counts, cost, summary, and the expansion hint. Omit low-priority fields rather than overflowing.
- Each final line is measured and truncated using terminal cell width, not JavaScript string length. ANSI styling is applied only by core, after sanitation. Newlines in hint strings do not create rows.
- Hidden nested tasks produce aggregate counts, including failures and running tasks; do not show just the first successful task and conceal later failures.
- Paths that cannot fit show a short “output available” indication; expansion retains the full path. Do not add shell execution or automatic file opening.
- Collapsed images become a safe image count only for known producers; actual image data remains expanded and obeys existing image settings.

## Settings and interaction

One settings group, `transcriptPresentation`, owns `mode`, `maxLines`, and `exceptions`. Defaults: `mode: "compact"`, `maxLines: 2`, no exceptions. Exceptions match exact kind/name pairs, not patterns or scattered name lists; first duplicate match wins. Tools use registered tool name, messages/entries use custom type, notices use severity, user shell uses `user-shell`.

Allowed modes: `compact` or `legacy`. Legacy explicitly restores existing presentation, including renderer-owned collapsed layouts and shell selection; its content is not line-bounded. This is an intentional exception, not a compact-mode escape available to extensions. Global/project settings use existing trust and merge rules; an exceptions array replaces the inherited array. Invalid mode, bounds, or entries fall back safely and use existing settings diagnostics.

Ctrl+O and existing click expansion remain configurable through current keybinding infrastructure. Add notices and user shell rows to the existing expandable-child traversal. Per-row expansion and global toggles must not lose live pending-tool registration or renderer state. Policy changes re-render existing items without rebuilding execution state.

## Hint lifecycle and failures

Hint callbacks are synchronous, read-only, and run on argument/result/message changes, not every terminal frame. No I/O, timers, model calls, or result mutation. Core caches validated data separately from renderer component/state caches. Latest accepted event for each call replaces its hints; a completed call cannot revert to running because of a late partial update. Concurrent calls never share cache/state.

Validate at the runtime boundary, even for TypeScript callers. Accept bounded plain records/arrays and scalar values only; reject components, functions, accessors, non-finite/negative numeric values, unsupported fields and non-plain objects. Remove terminal controls, newlines and bidirectional controls from accepted text. Oversized/invalid or throwing callbacks degrade to the generic row; record a bounded, once-per-producer diagnostic without raw arguments/results or new stdout output. No retry loop. Extensions already execute arbitrary code: this is an output-safety contract, not a sandbox.

No hint persistence or session-format migration. On replay, registered providers recompute from existing typed message/details data; unavailable providers give generic rows. Hidden custom messages stay hidden. Custom entries without renderers stay hidden; existing renderer `undefined` eligibility must remain intact without analyzing its returned component. The compatibility mechanism is specified in the [plan](plan.md#reuse-and-traps).

A failing expanded custom renderer must not fall back to raw content it may have intentionally redacted. Show a generic renderer-error row instead; preserve original data untouched. An explicitly registered renderer returning `undefined` also does not authorize a raw-content fallback: retain an empty/unavailable detail view. Only absence of a custom renderer permits the existing expanded default detail.

## Thinking stays independent

Thinking may share sanitation and terminal-width primitives, **not the two-line transcript policy**. Retain Ctrl+T visibility and Ctrl+Shift+T summary behavior, six-nonblank-line/900-character previews, Markdown formatting, asynchronous summary replacement, content-hash caches, provider selection, recorded cost/cache/usage, and accounting. Existing thinking summary generation is unchanged; this feature makes no additional model calls.

## Alternatives and risks

| Alternative | Verdict |
| :--- | :--- |
| Render then clip arbitrary components | Rejected: can erase error/status, break interaction/images, or reveal redacted material through fallback. |
| Generic raw JSON/output preview | Rejected: generic code cannot know disclosure policy or meaning. |
| Tool-name rules in several renderers/extensions | Rejected: presentation policy has no single owner and new extensions miss it. |
| Core data rows plus producer hints | Adopt: unknown producers need no upgrade; useful semantics remain opt-in. |

| Risk | Mitigation |
| :--- | :--- |
| Built-in hints inherited by a redacting override | Only attach default hints with default presentation ownership; never use tool name alone. |
| Expanded edit preview initialized only after execution | Seed completed result state before expanded call rendering; preserve asynchronous preview while running. |
| Background lifecycle mistaken for tool-call lifecycle | Separate task counts/status from completion of the control tool. |
| Explicit legacy users depend on inline shell joins | Retain that behavior behind legacy policy until a separately authorized removal. |
| Removing display forks also removes functional changes | Inverse only identified hunks; verify complete fork divergence before changing package sources. |

## Decision Ledger

| ID | Decision | Basis | Built |
| :--- | :--- | :--- | :--- |
| D1 | Core collapse; existing expanded renderers | Approved architecture in task request | Core integrated |
| D2 | Typed optional hints; safe generic fallback | Disclosure and boundedness requirements | Core integrated |
| D3 | Two-line default, exact centralized legacy exceptions | Concrete design default selected for this handoff | Core integrated |
| D4 | Preserve thinking and all non-transcript UI/execution | Explicit task constraints | Core integrated |

Success means an unknown redacting tool, a long workflow message, a many-task background completion, and a narrow terminal all stay bounded and visibly pending/error where appropriate, while expansion and execution remain unchanged. Build core first, add typed producers next, then migrate display-only wrappers after parity verification.
