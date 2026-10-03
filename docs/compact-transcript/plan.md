---
status: accepted
stage: DECIDED
next: "Run parent-owned landing gates for the integrated core"
depends-on: [design.md]
---

# Plan: attach display data without changing execution

**Status:** 2026-10-03. Written against `55c964318`; [implementation](implementation.md) records the integrated core and [QA](qa.md) owns observed verification.
**Design:** [Core-owned collapse](design.md); [research](research.md) owns source and inverse-patch evidence.
**Precedence:** Design wins on behavior; tree wins on facts; this plan is advice unless labeled **must**. Never twist current code to match a stale map.

## Approved API contract

Use exported `CompactTranscriptHints` and callback types in extension types. These names designate the [optional display data](design.md#ownership-and-scope), not a new execution result format.

| Field | Type and limit |
| :--- | :--- |
| `label`, `summary`, `error` | Optional plain strings; label/summary/error each at most 160 characters |
| `status` | Optional `info \| warning \| error \| running \| completed \| cancelled`; never lowers core severity/lifecycle |
| `counts` | Up to four `{ label: string, value: number }` records; label 32 characters, nonnegative safe integer |
| `progress` | Optional `{ completed: number, total: number }`; safe integers, `0 <= completed <= total` |
| `costUsd` | Optional finite nonnegative number, from already recorded usage only; zero differs from absence |
| `outputPaths` | Up to two plain strings, 256 characters each; display only, no file access |

**Must:** Limit validated serialized data to 4 KiB, reject unsupported/non-plain values, validate fields independently where safe, and fall back entirely on callback exceptions or invalid root objects. Unknown keys are ignored, not traversed. Check own data properties before reading; this is not isolation from arbitrary extension code. Validated output is copied and never exposes mutable source references. Numeric/label formatting is core-owned. Safe omission is preferable to a misleading truncated number/path.

**Must:** ToolDefinition adds optional `getCompactHints(input)` returning `CompactTranscriptHints | undefined`. Input contains typed `args`, optional typed latest `result`, `toolCallId`, `cwd`, `argsComplete`, `executionStarted`, `isPartial`, and `isError`. No theme, Component, invalidation function, renderer state, permission mutation, or execution callback. Keep existing ToolDefinition generic parameters; match the current `Static<TParams>`/details types rather than adding `any`.

**Must:** Add `registerMessageHints<T>(customType, provider)` and `registerEntryHints<T>(customType, provider)` alongside existing renderer registrations; callback input is the existing typed CustomMessage/CustomEntry. Keep separate maps so unknown renderers work unchanged. Registration lookup uses the same conflict ordering as current renderer lookup. No new message fields or persistence format. Entry hints do not make hidden state entries visible.

**Must:** Extend `ui.notify(message, severity?, hints?)` with an optional third plain-data argument for interactive presentation. The adapter owns severity and an ephemeral identity; it does not persist notices or request model work. Keep RPC `extension_ui_request` and noninteractive notify behavior byte-for-byte unchanged: omit hints from transport and retain original message/severity. Test the no-third-argument path too.

**Must:** `transcriptPresentation` normalizes `{ mode: "compact" | "legacy", maxLines: number, exceptions: Array<{ kind, name, mode?, maxLines? }> }`. Kinds are `tool`, `message`, `entry`, `notice`, `shell`. Resolve through one function, not renderer branches. Missing/invalid exception fields inherit normalized defaults. Bounds are integer 1–4. An invalid entry is skipped; first valid exact duplicate wins. Policy identifiers are literal names, not extension labels, regexes or wildcards.

## File map

All Pi paths below are relative to `packages/coding-agent/`; **new** files are advisory locations, chosen to keep display imports independent of execution.

| Path | Change |
| :--- | :--- |
| `src/core/extensions/types.ts`, `src/core/extensions/index.ts`, `src/index.ts` | Public hint types/tool field, registrations and notify signature/exports |
| `src/core/extensions/loader.ts`, `src/core/extensions/runner.ts` | Store/look up message and entry providers; runtime-bound registration data |
| **new** `src/core/transcript-presentation.ts` | Hint validation and centralized policy resolution; no execution imports |
| `src/core/settings-manager.ts` | Typed group, normalization/getter/setter and diagnostics using current storage/trust rules |
| **new** `src/modes/interactive/components/compact-transcript.ts` | Shared bounded text row, lifecycle/severity priority and expansion hit region |
| **new** `src/modes/interactive/components/extension-notice.ts` | Expandable ephemeral notice; severity, original expanded text, hints |
| `src/modes/interactive/components/tool-execution.ts` | Core compact path, isolated hint cache/lifecycle clock, existing expanded/legacy paths |
| `src/modes/interactive/components/custom-message.ts`, `custom-entry.ts` | Compact rows, preserved visibility, redaction-safe renderer-error fallback |
| `src/modes/interactive/components/bash-execution.ts` | Separate user-shell adapter; preserve streaming/exit/cancel/image/output data |
| `src/modes/interactive/interactive-mode.ts` | Pass policy/providers, route extension notices, refresh policy, expandable traversal |
| `src/modes/interactive/components/settings-selector.ts` | One presentation group entry/callback through existing settings UI |
| `src/core/tools/renderers/index.ts` | Include hint metadata without assigning built-in hints to custom/redacting ownership |
| `src/core/tools/renderers/{bash,read,write,edit,find,grep,ls}.ts` | Producer-selected hints next to existing detail renderers; powershell shares shell producer |
| `src/extensions/codemode/renderer.ts` | Typed nested-call aggregates and output-path/cost hints; retain expanded detail |
| `src/modes/interactive/components/visual-truncate.ts` | Reuse primitives; change only if extracting total-budget utility is cheaper than a new helper |

## Reuse and traps

- **Advice:** Keep renderer-only import paths through `createAllToolRenderers`/`withBuiltInRenderers`; source 1.0 separated these from execution for startup cost.
- **Must:** Default hints follow the actual built-in definition/default renderer ownership, not names. A definition overriding either renderer gets no inherited semantic hints unless it explicitly provides them. A plain synthesized SDK definition must not expose its args through a name match.
- **Advice:** Reuse TUI `visibleWidth`/`truncateToWidth`, core theme tokens, `keyHint`, `isExpandable` traversal, and the existing theme test fixtures; avoids hardcoded Ctrl+O/color checks.
- **Must:** `VisualLinePreview` counts its hint separately. Do not use it unchanged for the total collapsed-line guarantee.
- **Must:** Preserve custom-entry visibility. For an old renderer without an explicit visibility contract, invoke it with existing collapsed options solely to test `undefined`; discard a returned component without rendering/analyzing it. On expansion invoke with expanded options normally. Do not derive hints from that component. Do not apply this probe to ordinary tool renderers. Future entry registration may supply explicit eligibility; that API extension is optional, not required for this feature.
- **Must:** On collapsed tool updates, do not invoke renderers to obtain data. On first expansion, hydrate the call/result renderer sequence from current arguments/latest result; keep its shared state across toggles. Completed edit results seed preview before asynchronous recomputation can use a post-edit file. Clear renderer timers/dispose resources normally, including collapse during active shell streaming.
- **Must:** Separate lifecycle timestamps from shell renderer `state.startedAt`/intervals. Preserve normal streaming throttle (`BASH_UPDATE_THROTTLE_MS`) and invalidate only affected rows. Do not add a second per-row timer.
- **Must:** PendingTools survives tool and thinking toggles/replay. The regression at `test/suite/regressions/4167-thinking-toggle-pending-tool-render.test.ts` currently asserts raw collapsed result text; rewrite those display assertions while preserving registration/completion checks.
- **Must:** A custom renderer failure must not trigger current custom-message raw Markdown fallback. Generic error is safe; original content still exists in session/model paths.
- **Advice:** Internal cache/container layout and exact ordinary error wording are the implementer's choices; the design's disclosure/status/bounds are not.

## Build order and gates

1. T1: failing bounds/redaction tests first, contract/validation/policy and core row; run targeted Vitest files from coding-agent package root.
2. T2: tools, messages, entries, notices and user-shell adapters; local suite integration via `test/suite/harness.ts`/faux provider, plus targeted component tests.
3. T3: built-in/codemode producers and settings UI; run producer/settings/example tests and `npm run check` from repo root (full output).
4. T4: migrate external display hunks only after parity; separate repositories retain their functional suites, pack edits linted immediately.
5. T5: full applicable non-e2e `./test.sh`, `npm run check`, controlled interactive smoke test, and document checks before landing. Never run unrestricted `npm test`/full Vitest or paid APIs. No commits/deployment are authorized by this scout.

Targeted command: from `packages/coding-agent`, `node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/<specific>.test.ts`. Load the interactive-testing skill before the later TUI smoke test.

## Ships with

- **New tests:** validator/policy/bounded-row, notice, entry and shell component tests; property/parameterized widths 0/1/2/10/40/80, ANSI/control/bidi/Unicode, invalid/throwing hints, empty/many counts, hidden entries and redacting unknown renderer cases.
- **Rewrites:** `test/tool-execution-component.test.ts` inline/collapsed expectations; `test/custom-message.test.ts` collapsed renderer invocation/padding expectations; `test/codemode-renderer.test.ts` compact counts/cost/error tests move to provider/core composition. Preserve expanded/mouse/image assertions.
- **Existing coverage:** `test/tool-renderer-examples.test.ts`, `test/assistant-message.test.ts`, `test/settings-manager.test.ts`, `test/settings-selector.test.ts`, settings diagnostics and pending-tool regression; add live streaming/toggle/replay integration using the faux provider.
- **Public docs:** `docs/extensions.md`, `docs/tui.md`, `docs/settings.md`, `docs/sdk.md`, `docs/keybindings.md`, `docs/rpc.md`, `README.md`, and `CHANGELOG.md` under Unreleased only. Document legacy opt-out, generic fallback, disclosure responsibility, ephemeral notices and unchanged transport/context.
- **Examples:** renderer examples indexed by `examples/extensions/README.md`, especially todo/truncated-tool, plus SDK `05-tools.ts`, `06-extensions.ts`, `10-settings.ts`; show optional hints without tool execution wrappers.
- **External migration:** exact files/hunks in [research](research.md#exact-published-display-patch-boundaries); replace useful semantic display with providers before removing wrappers. Retain license/upstream credit and published changelog/history.

## Don't and blockers

Do not alter permissions, results, schemas, session JSON, RPC/stdout, provider selection, accounting, thinking summaries, widgets, or shared briefings. Do not remove `inline`/`self` support blindly; explicit legacy presentation still needs current behavior. Do not change package sources merely because the display patch is obsolete.

No owner-required unresolved decision. Stop only if later source evidence contradicts the approved behavioral constraints or fork retirement requires removing intentional functionality; otherwise investigate and repair ordinary implementation/test failures directly.
