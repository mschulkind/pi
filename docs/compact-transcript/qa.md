---
status: in-review
stage: IMPLEMENT
next: "Migrate extension presentation overrides; human performs rollout and real-terminal smoke checks"
depends-on: [implementation.md]
---

# Source landing gates pass; real-terminal rollout remains unverified

This records observed evidence for the [integrated core adapters](implementation.md), not approval for deployment or external migration.

## Tests led missing behavior

New adapter tests first demonstrated four failures: arbitrary tool components exceeded the total budget, hints were not consumed, exact policy did not refresh, and redacting renderer exceptions dumped raw arguments/results. Separate custom-adapter tests demonstrated three failures for message bounds, entry eligibility, and shell bounds.

Further failing tests demonstrated missing built-in ownership-aware semantics, codemode/settings integration, completed-edit recomputation against a post-edit file, returned-component render exceptions, expanded-only entry renderers revealing hidden entries, and missing example providers. Each regression was retained and repaired.

Existing display assertions now expect core compact status or explicitly exercise expanded/legacy compatibility. Completion, shared renderer state, image conversion races, duration precision, mouse expansion, raw result delivery, pending registration, and thinking behavior remain asserted.

## Observed integration evidence

The earlier adapter/producer/settings/replay/example run passed 18 files and 238 tests. The repair-integration run now passes **23 files, 293 tests**; its durable targeted log is authoritative for this handoff. It includes the earlier focused adapter coverage, review regressions, actual streaming/registry and live custom delivery, and existing edit/codemode detail suites.

Coverage includes:

- Actual ToolExecutionComponent rendering at widths 0, 1, 2, 10, 40, and 80; unknown oversized renderers are not invoked collapsed. Expanded callback and returned-component failures use generic detail, never private payloads.
- Per-call accepted event caches, late-partial rejection, independent concurrent rows, policy exceptions and mode refresh, and renderer state across toggles.
- Faux-provider execution through actual InteractiveMode tool event methods: two simultaneous calls, partial updates, Ctrl+O-equivalent global expansion, thinking visibility toggle, completion, and historical replay. Pending maps remain intact and original model/session results retain their private raw content without displaying it collapsed.
- Typed registration and first-provider lookup; hidden-entry eligibility is tested independently of expansion. Notices replace consecutive info items but retain separate warning/error delivery, with distinct width-one markers and original expanded text.
- User-shell cancellation and complete raw output, built-in ownership/redacting overrides, read classification/ranges, completed edit hydration, codemode aggregate failures/running work, tiny positive recorded costs, output paths, and one settings submenu retaining exceptions.
- Existing assistant/thinking, renderer examples, settings diagnostics, and the pending-tool regression remain green.

The repository check initially found two unused declarations/imports. They were repaired. The final `npm run check` passed formatting, dependency/runtime-import/entry-graph checks, both coding-agent lock checks, TypeScript, and browser smoke checks with no errors, warnings, or information diagnostics.

Additional failing tests caught an entry probe component receiving invalidation instead of being discarded, settings UI freezing omitted exception overrides, and deferred shell rows missing global expansion. Repairs now discard compact eligibility components, preserve raw global exception fields, and include pending shell rows in expansion traversal. Further checks verify historical argument completeness, one-time hydration when entry policy changes to legacy, shell timer pause/resume/final cleanup, and preservation of custom interactive components across collapse.

## Review blockers reproduced and repaired

The new review and edit tests initially failed **29 of 37 tests** before implementation changes. The retained failing log demonstrates all five independent blockers:

- Codemode inherited hints disclosed nested errors after call-only, result-only, or combined renderer overrides. Its producer now registers the same two-slot ownership rule as built-ins.
- Reopening the settings submenu reconstructed stale mode/budget state. The enclosing selector now retains updates across openings.
- A pending edit preview resolved after failed settlement and replaced failure presentation with a proposed diff. Settlement now cancels the pending preview; failure discards both pending and already-resolved proposals and keeps the error background.
- Notice hints changed info/warning/error severity. Notice delivery severity now overrides every supplied lifecycle status, including hints carrying nested error text.
- Read/grep/find/ls/bash omitted truncation and limit warnings. Producers now select known warning metadata with warning priority, while execution errors retain higher priority. Additional coverage includes byte-truncated reads, a first line exceeding the limit, and PowerShell.

The first repaired run exposed an overly literal background-color test assertion; it now checks the actual color-opening code rather than expecting adjacent opening/closing codes around empty text. Initial test-fixture type errors were repaired without weakening production types.

[Live delivery tests](../../packages/coding-agent/test/suite/compact-live-delivery.test.ts) load real extension registrations, invoke the actual registry lookup, and feed assistant start/update/end plus tool lifecycle events through InteractiveMode methods on a lightweight UI fixture, not a real terminal. They verify that streamed calls already exist before execution starts and that redacting codemode registrations keep nested errors private while original session results retain them. A loaded command exercises actual appended-entry and custom-message events: visible providers reach core, hidden/rendererless entries remain absent, and expanded detail uses the original renderer. At 80 columns, progress, item counts, tiny recorded cost, and output path all remain visible; progress also survives at 40 columns.

The existing edit detail suite initially failed three compact-default assertions. It now explicitly expands rows before checking large diffs, preflight errors, settled replay, and absence of full redraw. No detail assertion was removed.

## Parent-gate repair: timing and shell disclosure assertions

The parent non-e2e gate exposed two test failures. Neither required changing production behavior.

- The unchanged [Chord fuzz test](../../packages/chord/test/state-fuzz.test.ts) grouped 100 independent seeds, each with 100 revisions, under one 5,000 ms deadline. The parent recorded 5,362 ms with only a timeout, not a failed convergence, ownership, or alias assertion. The same original test passed alone in 3.00 seconds and beside the tracker/retention tests in 3,517 ms. These observations support scheduling contention rather than a semantic fault; the parent-scale timeout did not recur in the focused runs. Each seed now has its own ordinary test deadline and diagnostic name. All 100 seeds, 10,000 revisions, mutation choices, and assertions remain unchanged. No timeout setting, Chord source, or seed coverage was relaxed.
- The [bash thinking-toggle regression](../../packages/coding-agent/test/suite/regressions/8611-thinking-toggle-pending-bash-output.test.ts) expected raw output in the default collapsed generic view. It failed before the toggle, so it did not demonstrate output loss. That expectation contradicted the [safe disclosure contract](design.md#data-and-state). Five retained cases now exercise expanded built-in/generic detail, collapsed built-in/generic compact rows, and a real exact legacy exception. Built-in cases use the session registry and all cases use real in-memory settings. Output differs from command text so an argument hint cannot masquerade as preserved stdout. Both thinking-toggle directions retain the row and pending registration; expansion recovers the original partial output, later updates, and final output. Generic collapse never displays raw command or stdout. An initial new-test run failed on terminal right-padding, not missing output; the repaired assertion checks content independently of padding. A fixed clock isolates the test from elapsed-time display changes.

Observed focused gates: **7 coding-agent files, 61 tests passed** and **3 Chord files, 181 tests passed**, including all 100 separately named fuzz seeds alongside tracker/retention coverage. Biome checked both changed test files with no fixes needed. Production code, existing feature edits, and released changelog history were not changed. Full build, repository check, and non-e2e reruns remain parent-owned; this repair did not run them, paid providers, or terminal/deployment checks.

Evidence and exact commands are captured separately from repository documentation:

```text
/workspace/.yolo/durable/compact-core-verify/core-gate-repair/
  bash-baseline-red.log
  bash-policy.log
  bash-targeted.log
  chord-baseline.log
  chord-contention-red.log
  chord-contention-timing.log
  chord-targeted.log
  commands.txt
  handoff.txt
  repair.diff
  after.status
```

Despite its historical filename, the contention-red log records a passing local attempt, not a reproduced timeout. The parent timeout evidence remains in the parent test log. The child repair remains uncommitted.

### Independent review and finish-phase verification

The bounded independent review reported no blocking or actionable findings. It reproduced **242 passing tests across 10 files**, scoped Biome, and the whitespace check, and confirmed unchanged correctness coverage and preservation of existing tracked feature changes. Its initial Biome invocation used the wrong repository root; rerunning from the Pi fork passed. No code or test changes were needed in this finish phase.

Fresh finish-phase runs passed **61 tests across 7 coding-agent files** in 6.39 seconds and **181 tests across 3 Chord files** in 5.65 seconds. Scoped Biome checked both repaired tests from the fork root with no fixes applied. Vantage 0.8.1 strictly checked this QA document. All 100 fuzz seeds remain individually recorded; scheduling contention remains supported, not proven.

Finish-phase evidence stays inside the exclusive-writer repository:

```text
/workspace/.forks/pi/.yolo/durable/core-repair-finish/
  bash-targeted.log
  chord-targeted.log
  biome.log
  docs.log
  whitespace.log
  before.diff
  after.diff
  before.status
  after.status
  commands.txt
  handoff.json
```

Full non-e2e and repository checks, including TypeScript, remain parent-owned and were not rerun here. Installed-package, SDK/CLI, RPC/print parity, and controlled terminal checks also remain parent-owned. No real-terminal behavior is certified by these focused fixtures. No commit, push, deploy, or provider request occurred.

## Parent source landing verification

The repaired parent gate passed on October 3, 2026. The full offline monorepo
build, repository quality checks, isolated non-e2e suite, and packed-consumer
SDK smoke plus bundled and unbundled CLI probes all passed. Coding-agent
reported 2,812 passing tests and 50 skipped; its other workspace suites also
passed. Chord retained all separately named seeds. The suite used empty API-key
environment, temporary HOME/TMPDIR outside Git, and dropped DAC override
capabilities for permission tests. No paid-provider test was run.

Evidence is under
`/workspace/.yolo/durable/compact-core-verify/parent-rerun/`:
`parent-build.log`, `parent-check.log`, `parent-tests.log`, and
`parent-consumer.log`. This supersedes pending source-gate statements above;
it does not certify production activation or a real interactive terminal.
The existing packed consumer tests are SDK/CLI delivery smoke tests, not a
claim that every new hint contract was exercised through a installed package.

Real-terminal focus, mouse, images, scrolling, permission dialogs, pickers,
and protected widgets remain explicit human smoke checks. RPC/print execution
paths are unchanged and existing suite coverage passed; no new production
session parity capture was performed. External display migration and rollout
remain separate work, with no extension overrides removed by this core task.

## Durable artifacts

```text
/workspace/.yolo/durable/compact-core-verify/integration-red.log
/workspace/.yolo/durable/compact-core-verify/custom-red.log
/workspace/.yolo/durable/compact-core-verify/ownership-red.log
/workspace/.yolo/durable/compact-core-verify/producers-red.log
/workspace/.yolo/durable/compact-core-verify/edit-red.log
/workspace/.yolo/durable/compact-core-verify/render-error-red.log
/workspace/.yolo/durable/compact-core-verify/hidden-red.log
/workspace/.yolo/durable/compact-core-verify/examples-red.log
/workspace/.yolo/durable/compact-core-verify/integration-targeted.log
/workspace/.yolo/durable/compact-core-verify/integration-check.log
/workspace/.yolo/durable/compact-core-verify/integration-docs.log
/workspace/.yolo/durable/compact-core-verify/review-red.log
/workspace/.yolo/durable/compact-core-verify/review-legacy-red.log
/workspace/.yolo/durable/compact-core-verify/review-targeted.log
/workspace/.yolo/durable/compact-core-verify/review-check.log
/workspace/.yolo/durable/compact-core-verify/review-docs.log
/workspace/.yolo/durable/compact-core-verify/review-inventory.json
/workspace/.yolo/durable/compact-core-verify/review-complete.diff
```

Tests use temporary HOME/TMPDIR outside Git and no paid providers. Prior foundation red/green logs remain in the same durable directory; they are not substitutes for live integration evidence.

## Document and landing boundary

The checker is Vantage 0.8.0; its style guide was read before these edits. The strict check passed **15 files, nothing to fix**: all six planning documents, seven public guides/README, the extension example index, and an extracted Unreleased section. The first index check reported 60 inherited unlinked filenames; they were converted to real relative links, without weakening configuration. The released changelog retains its inherited 211 checker errors and is not certified clean; released history is unchanged.

The parent owns full build, non-e2e suite, installed-package SDK/CLI export checks, RPC/print parity checks, and controlled interactive terminal smoke testing. These were not run by this child. Session-switch cleanup and real-terminal focus, mouse, images, scrolling, and interactions with permission dialogs, pickers, and widgets remain explicit landing checks. Component/faux-provider checks do not certify real terminal focus, images, scrolling, or every extension's interactive detail UI. No external migration, commit, push, publication, deployment, or restart occurred.
