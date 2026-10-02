---
status: in-review
stage: DECIDED
next: Implement the explicitly unsupported transports and recovery requirements
---

# Verified partial feature

The prior implementation passed its requested landing gates before the Codex extension. The Codex extension has its own fresh landing evidence below; historical results are not reused as current verification. **The broader feature is still incomplete:** [unsupported transports and storage/correlation boundaries](implementation.md#explicitly-unsupported) are not made complete by these checks. Recording remains explicitly opt-in.

## Codex landing verification

Started on existing `main` at `51f721b39`. The current source passed the requested build, full check, isolated suite, and packed-consumer gate before landing as one coherent commit. This does not finish the broader feature or enable recording by default. No branch/worktree, push, deployment, paid generation, or dependency upgrade was performed. Build catalog downloads are metadata refreshes, not generation calls; they produced no tracked catalog changes.

The first fifteen Codex transport regressions failed with no records, then passed after instrumentation. Separate failing regressions preceded the Codex coverage-list change, final-only full reasoning observation, and safe-setting/buffering-boundary repairs. The ModelRuntime fixture initially used a removed catalog model, then unnecessarily registered a custom stream and tried an API-key override on an OAuth-only provider. It now uses the builtin catalog route with an unexpired, fake, in-memory OAuth credential; no refresh or live request is needed. Production auth and custom-provider coverage policies were not weakened.

Two review blockers were reproduced before repair: SSE and WebSocket tool-done timestamps included a 50 ms awaited-hook delay (60 ms instead of 10 ms), and an HTTP observation-ID allocation failure prevented the actual fetch (one invocation instead of two). Three new tests failed, then passed after observing both tool-done event types with snapshot deduplication and isolating HTTP observation initialization. The permanent timing tests cover function/custom tools with empty, partial, and complete preceding deltas on both transports.

| Current check | Result |
| :--- | :--- |
| Targeted AI tests | Five files, 96 passed; includes 35 Codex performance tests and existing Codex/hook/raw-usage regressions |
| Targeted coding-agent tests | Four files, 15 passed; builtin Codex HTTP/WebSocket local persistence, SDK correlation, shutdown, and retention |
| Root `npm run build` | Passed all workspaces; coding-agent bundle: 75 files, 8.6 MiB |
| Root `npm run check` | Passed; no formatting fixes, warnings, or errors; includes TypeScript, generated-lock checks, and browser smoke |
| Prescribed isolated full suite | Passed scripts and all tested workspaces; AI: 1288 passed / 860 skipped; coding-agent: 2695 passed / 50 skipped; durable: 853 passed / 1 skipped; TUI exited successfully |
| Root `npm run check:package-install` | Passed production installation from actual workspace tarballs, SDK smoke, and both CLI entry points; no source aliases |
| Fresh review probes | Tool timestamps precede the delayed callback on both transports; allocation failure still fetches successfully; concurrent generations retain ownership and correct socket reuse |
| Five-document Vantage check and git whitespace | Passed |

Skipped external/auth-dependent and platform tests are not claimed verified. The packed-consumer gate verifies SDK/CLI installation, not live Codex connectivity. The required pre-commit hook runs the root check again; its output is retained in the commit log.

Socket fixtures count actual construction/send invocations, including rejected sends and successful reuse. They verify cached continuation retry frames, generation ordinals across reconnect/fallback, missing constructors, cancellation, post-start failure without fallback, original terminal variants, settings/usage privacy, and observer isolation (including failed metadata observation without blocking a transport). A genuine local HTTP POST verifies hostname and missing usage; injected Codex fetches prove rejection/status retries and compressed post-hook settings. Builtin ModelRuntime tests persist HTTP and WebSocket records through the existing private telemetry recorder without unsupported-route notices. No real-provider or browser/Bun WebSocket compatibility is claimed.

Current targeted commands (run tests from their package directories):

```bash
# packages/ai
node ../../node_modules/vitest/dist/cli.js --run \
  test/codex-performance.test.ts test/openai-codex-stream.test.ts \
  test/api-performance.test.ts test/api-performance-review.test.ts \
  test/telemetry-options.test.ts
# packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run \
  test/api-performance-recorder.test.ts test/api-performance-sdk.test.ts \
  test/api-performance-shutdown.test.ts test/performance-correlation.test.ts
```

The landing gates ran from the fork root, once each before committing:

```bash
npm run build
npm run check
TMPDIR=/tmp /nix/store/1jasg83hbsd6m0gymnc6c740v0jl7mg8-util-linux-2.39.4-bin/bin/setpriv \
  --bounding-set=-dac_override,-dac_read_search -- /bin/bash ./test.sh
TMPDIR=/workspace/.yolo/durable npm run check:package-install
```

Fresh evidence and a snapshot of the built AI/coding-agent distribution directories are retained outside tracked source. The archive is not an independently installable release package. The packed-consumer gate removes its temporary tarballs and installation after success; those temporary paths in its log are not retained artifacts.

```text
/workspace/.yolo/durable/codex-landing-red.log
/workspace/.yolo/durable/codex-landing-ai.log
/workspace/.yolo/durable/codex-landing-agent.log
/workspace/.yolo/durable/codex-landing-probe.log
/workspace/.yolo/durable/codex-landing-concurrency.log
/workspace/.yolo/durable/codex-landing-build.log
/workspace/.yolo/durable/codex-landing-check.log
/workspace/.yolo/durable/codex-landing-full-suite.log
/workspace/.yolo/durable/codex-landing-package-install.log
/workspace/.yolo/durable/codex-landing-quality.log
/workspace/.yolo/durable/codex-landing-style-guide.log
/workspace/.yolo/durable/codex-landing-docs-check.log
/workspace/.yolo/durable/codex-landing-commit.log
/workspace/.yolo/durable/codex-landing-built-dist.tar.gz
/workspace/.yolo/durable/codex-landing-artifacts.sha256
```

Limits remain: send acceptance is not provider receipt; HTTP error-body completion, hidden transport routing/replay, crash recovery, directory races, Windows permission assurance, nested auxiliary correlation, complete provider settings, and all other unfinished routes are not established. Connection records increase the existing recorder queue/file load and must not be summed as generation requests.

## Prior reproduced and repaired

Six initial regressions failed before repair: gateway default-zero provenance, preserved gateway provider usage, refusal/final-only text, callback versus provider-terminal timing, HTTP error-body completion, and SDK internal cancellation misclassified as caller abort. A separate settings privacy test also failed before closed-vocabulary validation.

Final converter inspection exposed two more failing regressions: redacted gateway thinking placeholders counted as content, and final-only gateway tool arguments missed. Both were fixed, retained permanently, and included in the rerun of every landing gate.

The initial full check found an undeclared direct telemetry dependency, then a generic utility entry-point budget violation. The AI package now owns the private snapshot backend, and its transport-specific helper lives under the API directory. No dependency declarations, lockfiles, or entry-point budgets were changed or weakened.

The actual packed consumer smoke needed harness repairs: distinct empty npm config files rather than double-loading one path; restoring the jail's CA certificate paths after a TLS-related install timeout; and using public ModelRuntime authentication options instead of assuming AuthStorage was a root export. TLS validation and lifecycle-script restrictions were preserved. The final consumer installation and SDK/CLI checks passed.

## Prior landing checks

| Check | Result |
| :--- | :--- |
| Targeted AI tests | 11 files, 114 passed |
| Targeted coding-agent tests | 10 files, 59 passed |
| Root `npm run check` | Passed; full output inspected, including formatting, declarations, import rules, entry graphs, generated locks, TypeScript, and browser smoke |
| Root `npm run build` | Passed all workspaces; coding-agent bundle: 75 files, 8.6 MiB |
| Prescribed isolated full suite | Passed scripts and all tested workspaces; AI: 1253 passed / 860 skipped; coding-agent: 2692 passed / 50 skipped; durable: 853 passed / 1 skipped; TUI exited successfully |
| Packed SDK/CLI consumer | Passed against actual workspace release tarballs, not source aliases; only coding-agent was installed directly |
| Packed performance recording | Passed injected HTTP failure, exact single fetch, safe saved record, 0700/0600 permissions, correlation, null usage/completion, and named header boundary |
| Vantage documentation checks | Vantage 0.8.0: five files passed with no findings |
| Git whitespace check | Passed |

Skipped external/auth-dependent and platform cases are not claimed verified. No paid generation call was made. Build catalog refreshes and npm package downloads are not model generation.

Tests preserve raw provider message usage and existing hooks/renderers, exercise real local HTTP and genuine client-library retries separately from Pi retries, and verify actual SDK lifecycle correlation with faux providers. Child processes cover immediate `process.exit`, bounded loss reporting, inactive-run retention, and protection for another active recorder. Deferred cancellation persists a coverage notice, not a fake streaming attempt.

## Prior commands and evidence

The full suite used the exact requested isolation, with logs captured afterward:

```bash
npm run build
npm run check
TMPDIR=/tmp /nix/store/1jasg83hbsd6m0gymnc6c740v0jl7mg8-util-linux-2.39.4-bin/bin/setpriv \
  --bounding-set=-dac_override,-dac_read_search -- /bin/bash ./test.sh
```

All final logs and retained artifacts are outside the fork's tracked source:

```text
/workspace/.yolo/durable/performance-review-ai-tests.log
/workspace/.yolo/durable/performance-review-agent-tests.log
/workspace/.yolo/durable/performance-review-build.log
/workspace/.yolo/durable/performance-review-check.log
/workspace/.yolo/durable/performance-review-full-suite.log
/workspace/.yolo/durable/performance-review-consumer.log
/workspace/.yolo/durable/performance-review-docs-check.log
/workspace/.yolo/durable/performance-review-consumer-5yWRKn/tarballs/
/workspace/.yolo/durable/performance-review-consumer-5yWRKn/consumer/
/workspace/.yolo/durable/performance-review-consumer-5yWRKn/ledger/
/workspace/.yolo/durable/performance-review-consumer-5yWRKn/sample-record.json
```

Earlier failures remain in the sibling logs with `first`, `second`, `third`, `tls`, and `content-regression-first` suffixes. The durable consumer harness reproduces packing with `--ignore-scripts`, production installation, both CLI entry-point version checks, and a no-network model fixture. Its successful run retained twelve tarballs, totaling about 11 MiB.

The inspected sample is an OpenAI Responses HTTP 400 attempt. It contains only the actual hostname, approved identities/settings, null missing usage, an observed header offset, unknown error-body completion, and explicit coverage limitations. The fake prompt, key, URL path/query, and error-body markers were absent. No record is uploaded or included in model context or bug-report bundles.

## Documentation verification

Read the installed Vantage 0.8.0 style guide before revising these documents. Check only the five task documents; do not weaken repository configuration or sweep unrelated documentation.

```bash
uvx vantage-check style-guide
uvx vantage-check docs/api-performance/research.md \
  docs/api-performance/plan.md docs/api-performance/tasks.md \
  docs/api-performance/implementation.md docs/api-performance/qa.md
```

## Scope and advisories

Source changes are confined to the coherent recorder, supported adapter integration, local correlation, tests, changelogs, and five evidence documents. Existing Waykeeper/compact-presentation changes remain untouched. No branch/worktree, push, deployment, manual home-directory edit, or unrelated dependency/security upgrade was performed. Workflow tools were unavailable; phases and foreground command evidence were maintained directly.

The user-reported existing brace-expansion and Gondolin node-forge advisories remain outside this change. Dependency and lockfile versions were not changed; no new security audit or remediation is claimed. The jail diagnostic preflight showed normal in-jail skips and a missing optional local environment file; no jail configuration was edited.

Remaining requirements are tracked in the [work queue](tasks.md), including Anthropic, Mistral, Bedrock, Google, images/classifiers/deferred attempts, nested auxiliary correlation, crash recovery, directory races, Windows assurance, and provider-specific metrics/settings. Passing local tests establishes the implemented subset only.
