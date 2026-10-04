---
status: accepted
---

# Session responsiveness QA

## Approved revision and evidence boundary

The user approved default-on host+jail metadata in ordinary session history;
only `PI_CORE_TELEMETRY=0` opts out. Prior standalone-capture gates do not accept
this revision. Baseline is unchanged `main` at `9adadcb8d7dcba074a2f249cdf683654e0d0743d`.

Parent approved <=2 pending pre-serialized windows, piggyback on existing
synchronous normal commits, and <=2-row graceful final append only to an already
created conversation file. Setup-only persistent rows keep windows pending until
an actual commit; <=2 envelope reserializations may rebind to the current parent
within the same origin/branch. Ordinary durability/errors remain unchanged.
No timer/input/render disk flush, async journal rewrite, immediate idle durability
or hard wall-time shutdown guarantee against filesystem stalls is claimed.

Forks preserve inherited historical metadata/IDs and normal parentSession lineage.
Copied observations are not newly generated fork measurements; current health
counts only the current producer's observations/commits, not ancestor/copy totals.
No stronger explicit per-row origin identity or analytics behavior is claimed.

## Permanent red-to-green evidence

- Initial six history-policy tests failed against the old producer: default
  creation returned undefined. Added default buffering/real normal commit/reopen/
  leaf, exact opt-out, ignored directory, empty/memory-only, queue/lifetime/idle,
  origin changes and final-vs-ordinary error cases before the initial source fix.
- SDK/mode ownership regressions failed before AgentSession integration. Real
  interactive, RPC JSONL and print paths use faux providers/intercepted exits,
  not paid traffic. SDK producers are independent; disposal/fork/new/resume/tree
  reset owners; regular/fullscreen renderer replacement retains actual-TUI scope.
- Both renderer scope regressions initially observed zero attributed inputs.
  Both pending-wait regressions observed an empty wait list when another TUI's
  subscription changed. Real scoped callbacks now isolate owners and preserve
  independent scheduling waits; original exception/disabled behavior remains.
- Tree all-mode regression first rendered `pi.core-responsiveness`; HTML tree
  regression first retained the telemetry leaf. Both now hide it even in all/
  search views, while retaining raw ancestry. Context, summary serialization,
  transcript rendering and actual session-discovery content indexes exclude it.
- Startup/setup->first conversation/reopen checks truthful persisted counters;
  deleted/empty conversations are not created/recreated by final metadata.
  Envelope byte limits, bounded drops and nonfatal metadata errors are covered.

Obsolete standalone lock/slot/deadline tests were replaced, not retained as
claims about the superseding policy. Fixtures establish functional behavior,
not loaded production identity, process CPU attribution or a performance gain.

## Prior implementation validation (handoff)

- **98/98 coding-agent tests across 18 files passed**, including all new/edited
  telemetry files plus SDK, tree, runtime, summary/HTML and signal/RPC regressions.
  Existing API coverage-gap notices are expected for local faux/auxiliary calls;
  they do not claim HTTP attempt coverage or paid traffic.
- **106/106 TUI tests passed** across responsiveness, rendering, fullscreen and
  cell-size handling. Both regular/fullscreen isolation/wait regressions passed.
- **Full `npm run check` passed**: Biome, pinned/runtime dependencies, import and
  entry graphs, shrinkwrap/install-lock, TypeScript and browser smoke.
- Whitespace/no-staged and released-changelog hash checks passed. HEAD is unchanged.

Earlier iteration failures included formatting/lint and two TypeScript fixes;
legacy reflection shutdown fixtures exposed redundant post-dispose owner access,
which was removed. A mocked-fs listing fixture hung; moved the content-index test
to real temporary storage. HTML function extraction needed its real search
helpers. No production history behavior was altered to accommodate these fixtures.

### Reproducible commands

From `packages/coding-agent`, all with `HOME=/tmp TMPDIR=/tmp`:

```sh
node ../../node_modules/vitest/dist/cli.js --run \
  test/core-telemetry-documentation.test.ts \
  test/core-telemetry-projection.test.ts test/session-core-telemetry.test.ts \
  test/core-telemetry.test.ts test/runtime-info.test.ts \
  test/suite/core-telemetry-lifecycle.test.ts \
  test/suite/core-telemetry-noninteractive-lifecycle.test.ts \
  test/suite/core-telemetry-replacement.test.ts \
  test/sdk-session-manager.test.ts test/tree-selector.test.ts \
  test/suite/agent-session-runtime.test.ts test/compaction-serialization.test.ts \
  test/export-html-skill-block.test.ts test/export-html-whitespace.test.ts \
  test/export-html-xss.test.ts \
  test/suite/regressions/5080-signal-shutdown-extension-cleanup.test.ts \
  test/suite/regressions/5868-rpc-unknown-command-id.test.ts \
  test/suite/regressions/5724-sigterm-signal-exit.test.ts
```

From the fork root, all with `HOME=/tmp TMPDIR=/tmp`:

```sh
node --test packages/tui/test/responsiveness.test.ts \
  packages/tui/test/tui-render.test.ts packages/tui/test/tui-alt-screen.test.ts \
  packages/tui/test/tui-cell-size-input.test.ts
npm run check
git diff --check
git diff --cached --quiet
```

## Final blocker corrections (2026-10-04)

Owned follow-up files are exactly:
- `packages/coding-agent/src/core/compaction/compaction.ts`
- `packages/coding-agent/src/core/session-manager.ts`
- `packages/coding-agent/test/core-telemetry-projection.test.ts`
- `packages/coding-agent/test/session-core-telemetry-tail.test.ts` (new)
- this QA file.

### Compaction turn boundary

Before fixing the source, the paired `prepareCompaction()` regression reproduced
`isSplitTurn=true` with metadata versus `false` without it. The public
`findCutPoint()` regression independently reproduced the same mismatch against
its original classifier. Both classifiers now preserve the context-visible cut
for turn classification while retaining adjacent raw metadata in history.
Paired boundary/split tests verify summary inputs, split status, retained raw
indices/IDs, and one versus two local faux summary calls. Existing context-edit
recovery/omission regressions remain green. No real provider call is used.

### Failed metadata tail

Real-file regressions first reproduced loss of the next ordinary row after a
partial final metadata append threw: reopened branch contained only the later
orphaned message. Final append now attempts a one-byte newline on the same open
fd before closing it; it does not truncate, recreate or repair through a replaced
path. This isolates a malformed metadata fragment, not restores lost metadata.
If that separator also fails, a supervisor-approved constant-memory process-wide
flag prepends a newline in all subsequent existing append writes, including
already-loaded managers and hardlink/renamed-file writers. The flag never resets
on owner disposal/session replacement; no inode/path table or extra healthy IO
is added. Healthy processes' commit bytes and IO are unchanged. Blank lines are
ignored by existing replay. Ordinary write errors still propagate.

Six real-file cases cover successful/failed separator repair, preloaded writers,
hardlink aliases, path replacement during the failing append, repeated ordinary
appends/reopen, parent/leaf order, unrelated files and ordinary-error propagation.
Tests use normal Vitest file isolation, not a production reset seam.
This does not claim crash durability, immediate idle persistence or recovery of
lost metadata. Existing replay-time tail handling remains unchanged.

### Actual follow-up validation

- Initial red run after fixture correction: **4 failed / 6 passed** (projected
  compaction boundary and ordinary-row loss on preloaded/hardlink writers).
  Separate public-classifier red run: **1 failed / 1 passed / 6 skipped**.
- Final targeted run: **131 passed / 2 skipped across 13 files**. Skips are existing
  compaction fixture cases, not the added regressions. Expected API coverage-gap
  notices came from local faux/auxiliary fixtures, not paid requests.
- Full `npm run check` passed; formatting passes changed only owned source/tests.
  Final clean check, whitespace and no-staged-file checks passed (output report).
  Earlier fixture iterations fixed histogram reset/mock-call isolation; none
  changed source behavior to accommodate tests.

From `packages/coding-agent`, with `HOME=/tmp TMPDIR=/tmp`:

```sh
node ../../node_modules/vitest/dist/cli.js --run \
  test/core-telemetry-projection.test.ts test/session-core-telemetry-tail.test.ts \
  test/session-core-telemetry.test.ts test/compaction.test.ts \
  test/compaction-summary-reasoning.test.ts test/session-context-edit.test.ts \
  test/session-manager/build-context.test.ts test/suite/agent-session-runtime.test.ts \
  test/core-telemetry-documentation.test.ts test/core-telemetry.test.ts \
  test/suite/core-telemetry-lifecycle.test.ts \
  test/suite/core-telemetry-noninteractive-lifecycle.test.ts \
  test/suite/core-telemetry-replacement.test.ts
```

The approved activation/persistence boundary is unchanged: default on in host
and jail, exact `PI_CORE_TELEMETRY=0` off; bounded schema-v2 plain `custom` rows
with `customType="pi.core-responsiveness"` live in ordinary session JSONL, not
capture files. They are excluded from model/summary context and terminal/HTML
presentation/search. Actual AgentSession ownership and renderer attachment stay
intact. Pending old-origin windows are discarded/counted on branch/identity
changes; forks inherit history rather than generating new observations from it.
At most two <=8,192-byte rows buffer; idle sampling performs no disk IO; normal
synchronous commits/final checkpoint provide delayed durability. Crash paths
avoid final sampling/IO; graceful finalization cannot bound filesystem stall time.
Overlapping event-loop windows are process-wide, not per-session CPU or evidence
of a performance gain. API producer/TUI seams, dependencies and root docs were
not changed by this follow-up.

## Parent acceptance

Independent follow-up review resolved both P1 findings with no further issues.
Parent offline build, full quality check, isolated suites, build-identity test,
packed SDK and bundled/unbundled CLI smoke checks, and five-document render
checks passed. Coding-agent reported **2,868 passed / 50 skipped**. Tracked source
was unchanged during the successful gate. The first full run found three stale
session-start ordering fixtures without the new session field; four test-only
lines corrected them, preserving production invariants. Their seven tests then
passed, followed by the complete gate rerun. No provider traffic was required.

The additional fresh packed SDK probe passed: default-on without capture/Yolo
environment, explicit opt-out, one actual owned TUI input observation persisted
through an ordinary commit, and reopened history retaining three model-context
messages without telemetry. Private key/body content was absent from the metadata;
no provider request occurred. Two initial probe import failures were corrected
by using the public `pi-ai/compat` factory instead of obsolete root exports;
production code was unchanged. Fixture package paths were recorded before cleanup.

Publication, installation/restart, loaded-runtime and live-terminal checks remain
human steps. Repository documentation URL publication is not verified.
No full suite/build/package gate, paid provider request, production capture,
profiling, inspector activation, scanner/workflow/Yolo change, staging, commit,
push, deployment or restart was performed by this sourcewriter.
