---
status: in-review
stage: DECIDED
next: Finish packed workflow integration; human publication and fresh-process verification
---

# Verification and remaining rollout

Child checks below are separate from the later parent landing evidence. No
paid-provider request, inspector activation, restart, push, deployment, or upload
occurred. Automatic debugging remains off by the user's decision; the incomplete
Yolo experiment was archived and its owned changes restored, not deployed.

## Parent landing evidence

The repaired parent gate passed the full build, quality checks, isolated offline
non-end-to-end suites, build-identity fixture, and packed SDK plus bundled and
unbundled CLI consumers. Coding-agent reported 2,823 passed and 50 skipped.
Permission fixtures ran without DAC override capabilities, with HOME and TMPDIR
outside Git. Evidence: `.yolo/durable/producer-parent/core-rerun/` in the parent
workspace, managed task `570d66f1`.

The first full suite exposed an obsolete object-identity expectation in the SDK
stream-options fixture. The producer boundary intentionally copies options to
add its invocation ID. The retained regression now requires explicit IDs and
the recording callback to survive and the caller's original object to remain
unmodified. Seventeen targeted tests passed before the complete repaired gate.

Fresh packed-Core integration passed two source-workflow tests, two compiled-
workflow tests, and one actual summary-adapter test, with zero skips. Actual
HTTP/SSE attempts joined newly hydrated workflow observations; the WebSocket
check used a local adapter event target, not network WebSocket traffic. Summary
calls had distinct auxiliary identities; cached summaries emitted no dispatch.
Evidence: `.yolo/durable/producer-parent/packed-final/`, task `1a91c190`.

The initial copied compiled-workflow fixture lacked its package's ESM setting
and timed out after assertions passed. Declaring `type: module` in the temporary
consumer fixture repaired loading and cleanup. The final confirmation passed
without diagnostic timer wrappers or forced process exits.

## Reproduced before implementation

The initial producer test failed because the public observation module did not
exist. The explicit activation fixture then failed on the missing runtime status
method. The extension provenance fixture failed because a loaded extension
reported unknown rather than its load snapshot. Those permanent regressions now
pass with integrated code.

The fresh-file fixture initially set `max_tokens` while the actual request also
contained `max_completion_tokens`; the recorder correctly observed the latter's
serialized value. The fixture now replaces the transmitted completion-limit
field, rather than weakening serialized-setting extraction. TypeScript exposed
a missing tool fixture label, which was added without changing production types.

## Continuation review

The continuation started with this implementation already present and uncommitted
on the same base commit. Its targeted suites, build-stamp fixture, TypeScript
check, shrinkwrap consistency, and whitespace checks were rerun successfully;
historical results were not used as current test evidence. One added old-SDK
fixture reproduced a throwing capability property getter escaping detection.
Moving accessor lookup inside the protected boundary repaired it; the retained
fixture now returns null without failing the caller. Scoped formatting initially
reported the new guard layout, which was formatted and rechecked successfully.
No workflow launcher is available to this child; parent orchestration owns the
phase and landing checks.

## Security repair verification

The Core review identified a permanent-test gap, not an authorization bypass.
Two added fixtures supply forged `yolo.launch-network` version 1 and version 2
private/jail/Podman/bridge bytes and an apparently read-only effective mount
through in-memory filesystem mocks. Both assert the unconditional disabled
reason, zero inspector-open calls, and zero reporting-time filesystem reads.
These fixtures do not claim a real privileged mount experiment or proof of
Yolo confinement. Record bytes are deliberately not consumed by Core.

The first fixture run failed because native ESM exports cannot be replaced with
a direct spy; Vitest module spies repaired the harness. A subsequent assertion
included import-time reads from the spy's prior history; clearing that history
before reporting isolated the intended boundary. Both permanent regressions now
pass. No production authorization behavior changed; a source comment and the
public contract now explicitly prohibit positive v1/v2 consumption.

Fresh repair checks passed: eight targeted coding-agent files, 26 tests; root
TypeScript no-emit; scoped Biome for the runtime helper and its tests; Git
whitespace; and Vantage 0.8.1 for the five stage documents. AI/build-stamp suites
were not rerun in this repair because neither implementation changed. Earlier
producer APIs, capability version, attempt schema, compact presentation, and
reload identities are unchanged. The workflow glyph defect belongs to the matt
adapter owner and was not edited under this Core-only writer scope.

## Passing checks

- Eight coding-agent test files: 24 tests passed. Includes actual SDK explicit
  retry/tool-round identity with recording off, passive callback failures,
  auxiliary purpose isolation, old-SDK detection, cached/native factory identity,
  changed disk HEAD, dirty entry snapshots, symlink source attribution, runtime display, recorder
  activation/opt-out, fresh files, private modes, failure counters, unsupported
  notices, shutdown, and existing retention behavior.
- Four AI test files: 60 tests passed. Includes bounded/non-URL response handles,
  nested tool-ID exclusion, post-hook serialized settings, real SDK retry
  fixtures, and existing Codex connection/generation/fallback distinctions.
- Build-stamp script fixture: one test passed against emitted JavaScript loaded
  as a package module. Changing disk HEAD or compiled inputs did not relabel the
  already-loaded stamp; a new stamp captured changed bytes and dirty state.
  This is not a claim that the actual release package was built or installed.
- Root TypeScript no-emit check passed without diagnostics.
- Coding-agent shrinkwrap consistency check passed; dependency locks unchanged.
- Scoped Biome formatting/lint and Git whitespace checks passed.
- Vantage 0.8.1 checked the five new stage documents and the updated existing
  performance implementation reference with no findings.

Commands ran from the appropriate package directories:

```bash
# fork root
node node_modules/typescript/bin/tsc --noEmit --pretty false -p tsconfig.json
node --test scripts/stamp-runtime-build.test.mjs
node scripts/generate-coding-agent-shrinkwrap.mjs --check

# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run \
  test/producer-observation.test.ts test/runtime-provenance.test.ts \
  test/runtime-info.test.ts test/transport-recording.test.ts \
  test/performance-correlation.test.ts test/api-performance-sdk.test.ts \
  test/api-performance-recorder.test.ts test/api-performance-shutdown.test.ts

# packages/ai
node ../../node_modules/vitest/dist/cli.js --run \
  test/producer-response-handle.test.ts test/api-performance.test.ts \
  test/api-performance-review.test.ts test/codex-performance.test.ts
```

## Required parent checks and residuals

The parent full build/check/suite and packed SDK/CLI gates passed as recorded
above, including the additional packed-Core workflow integration. Verify that
`/runtime` shows the newly started process's build and extension list.
The fixture establishes formatting and command registration, not a human terminal
render check. No claim is made about browser/Bun/native module graph freshness.

Entry snapshots explicitly cannot attest imported dependency graphs; native
module caches can remain stale after reload. Build digest describes compiled
workspace inputs, not a final binary hash. Inspector status never includes its
URL and no default listener is started. Current read-only v1/v2 private claims
cannot authorize one. Automatic activation is not a rollout requirement: the
user chose explicit, process-local Node inspector flags instead. Existing storage and transport limitations
remain those in the [public contract](implementation.md#limits).

The retained artifacts are source, permanent tests, build hook, and these five
stage documents in the fork. Tool output in this session is the check evidence;
no external log archive or deployed runtime is claimed.
