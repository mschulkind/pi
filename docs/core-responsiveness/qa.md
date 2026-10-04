---
status: in-review
---

# Core responsiveness verification

## Test-led evidence

Before the new modules existed, the TUI test failed on missing
`responsiveness.ts`; the coding-agent test failed on missing `core-telemetry.ts`.
These were observed module-not-found failures, not simulated red assertions.

Additional regressions were red before repair:

- Awaiting current IO via `settled` while capture remained live released the
  ownership lock. The cadence test observed only `core-telemetry-0.json`, not
  the required lock. Cleanup now runs only once capture is no longer live.
- The exported category array was compile-time readonly but mutable at runtime.
  The TUI test failed `Object.isFrozen`; categories are now runtime-frozen.
  That red attempt also had a cascading scheduler assertion from the failed
  test's unfinished TUI; the final complete rerun passed.

An initial full check found an invalid lifecycle-test settings spelling
(`showTerminalProgress` at the top level). It was corrected to
`terminal.showTerminalProgress`; final full checks pass. No dependency or
lockfile changes were used to bypass errors.

## Targeted gates

All commands use HOME/TMPDIR outside Git. Run from the source fork root unless
otherwise specified:

```bash
HOME=/tmp TMPDIR=/tmp node --test \
  packages/tui/test/responsiveness.test.ts \
  packages/tui/test/tui-render.test.ts \
  packages/tui/test/tui-alt-screen.test.ts \
  packages/tui/test/tui-cell-size-input.test.ts

cd packages/coding-agent
HOME=/tmp TMPDIR=/tmp node ../../node_modules/vitest/dist/cli.js --run \
  test/core-telemetry.test.ts \
  test/runtime-info.test.ts \
  test/suite/core-telemetry-lifecycle.test.ts \
  test/suite/core-telemetry-noninteractive-lifecycle.test.ts \
  test/core-telemetry-documentation.test.ts \
  test/suite/regressions/5080-signal-shutdown-extension-cleanup.test.ts \
  test/suite/regressions/5868-rpc-unknown-command-id.test.ts \
  test/suite/regressions/5724-sigterm-signal-exit.test.ts
cd ../..

HOME=/tmp TMPDIR=/tmp npm run check
git diff --check
git diff --cached --quiet
```

The fresh combined TUI run passed **102/102**, no failures/skips. The expanded
coding-agent run passed **36/36 across eight files**: the retained 27 cases plus
six noninteractive lifecycles, one changelog-link regression, and two existing
RPC/signal regressions. The original 27/27 handoff result is retained evidence;
these 36/36 and 102/102 results were freshly rerun during review resolution.

`npm run check` passed formatter, pinned/runtime dependency, relative-import,
entry-graph, shrinkwrap/install-lock, TypeScript and browser-smoke checks. Biome
formatted owned test files; unrelated source/dependencies remain unchanged.
Released changelog bodies were compared against HEAD and remain byte-identical.
Diff whitespace checks pass and there are no staged files.

## Review resolution

- **P1:** Before repair, all six noninteractive fixtures observed `live=true`,
  zero written records and an existing lock at the mocked process exit. RPC
  shutdown and print signal handlers now await `stopCoreTelemetry()` before
  exit. Passing tests assert a committed final window, empty queue, removed
  lock at exit, preserved disposal/flush ordering and codes (0/143/129), and
  successful subsequent capture in the same directory. RPC tests use the real
  JSONL reader over a temporary stream, actual EOF and an extension shutdown
  command; signal-shaped tests invoke captured handlers without OS signals.
  Print binding is held after actual extension binding to exercise its real
  registered signal handler. No generation or paid call is made.
- **P2:** The changelog regression first observed the package-escaping relative
  link. The replacement is a stable `mschulkind/pi` main-branch repository URL;
  the test checks that spelling and the source contract's existence/schema.
  Published URL availability is not claimed before human publication.
- The first fresh full check formatted the new lifecycle test, then caught its
  explicit temporary-stream/stdin type assertion. The assertion now crosses
  `unknown`; no implementation or dependency was weakened to pass typechecking.
  The final fresh `npm run check` passed all stages with no formatter fixes;
  the post-format coding-agent rerun passed 36/36. Released changelog SHA-256
  bodies still match HEAD; `git diff --check` and the no-staged-files check pass.

## What the tests establish

Real regular/fullscreen TUI callbacks use fake monotonic clocks to verify
consumed input, source exceptions, isolated throwing/rejecting observers,
coalesced requests, scheduled/direct/forced/input-preempted frames, cancellation,
repeat start/stop and changed ownership. Disabled dispatch adds no clock; disabled
scheduler/direct-render paths retain only their existing clock calls. Category
cardinality is frozen and four subscription owners are enforced.

Recorder tests use private temporary directories and controlled histograms/IO.
They verify activation/opt-out, no disabled clock/interval/IO/subscription,
null-versus-zero, numeric sanitization, two-file retention, modes, cadence,
window/time/byte bounds, actual blocked file writes, two-record queue, dropped
records, 100-ms close, eventual cleanup, delayed initialization, unsafe directory/
symlink/hardlink rejection, concurrent owners, lock-inode replacement, repeat
health reset, observer failure and metadata-only storage errors.

The lifecycle harness uses actual `InteractiveMode`, `AgentSessionRuntime`, TUI
and faux generation. It records input/frame observations, shows live `/runtime`
health, verifies unchanged faux assistant output and exhausted response fixtures,
then tests public stop and fresh capture. Both graceful quit and signal-shaped
shutdown paths drain before the mocked existing process exit. No OS signal was
sent and no paid/provider-network request was made.

## Limitations and parent acceptance

Initial independent review blocked on P1/P2; both are implemented with
observed-red permanent regressions. The retained independent reviewer re-read
the complete final diff and new files and found no remaining issues. Review
`c871a76f-3e74-4d1b-bd70-c9593d3d6e67` verified shutdown ordering, exit codes,
lock removal at exit and the package-safe documentation link. It did not rerun
tests. Parent-managed gate `b4ec392f` passed offline build, complete quality checks,
full isolated non-end-to-end suites, loaded build-identity regression, packed
SDK plus bundled/unbundled CLI consumers, and documentation validation.
Coding-agent reported 2,849 passed and 50 skipped. Test HOME/TMPDIR were outside
Git, provider credentials isolated, and permission fixtures ran without DAC
override capabilities. Logs are retained in the parent workspace under
`.yolo/durable/core-telemetry-parent/`. Publication and installation remain
human steps. Production loaded identity, CPU, latency and PID 79 remain unverified.

Capture is POSIX/private-directory-only and keeps two latest windows, not a full
history or per-request timeline. Callback durations are inclusive synchronous
measurements, not physical keypress or terminal-pixel latency. Already-issued
filesystem IO can outlive the shutdown wait; stale files after crashes fail
closed. Same-UID/privileged adversaries and crash-durable fsync are not covered.
No observer configuration or telemetry failure changes model/context/input/
renderer decisions. No profiling, inspector activation, scanner/workflow/Yolo
edit, staging, commit, push, restart, deployment or upload was performed.
