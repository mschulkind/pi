---
status: in-review
stage: DECIDED
next: Implement the explicitly unsupported transports and recovery requirements
---

# Verified partial feature

The requested landing gates passed on the final source. **The broader feature is still incomplete:** [unsupported transports and storage/correlation boundaries](implementation.md#explicitly-unsupported) are not made complete by these checks. Recording remains explicitly opt-in.

## Reproduced and repaired

Six initial regressions failed before repair: gateway default-zero provenance, preserved gateway provider usage, refusal/final-only text, callback versus provider-terminal timing, HTTP error-body completion, and SDK internal cancellation misclassified as caller abort. A separate settings privacy test also failed before closed-vocabulary validation.

Final converter inspection exposed two more failing regressions: redacted gateway thinking placeholders counted as content, and final-only gateway tool arguments missed. Both were fixed, retained permanently, and included in the rerun of every landing gate.

The initial full check found an undeclared direct telemetry dependency, then a generic utility entry-point budget violation. The AI package now owns the private snapshot backend, and its transport-specific helper lives under the API directory. No dependency declarations, lockfiles, or entry-point budgets were changed or weakened.

The actual packed consumer smoke needed harness repairs: distinct empty npm config files rather than double-loading one path; restoring the jail's CA certificate paths after a TLS-related install timeout; and using public ModelRuntime authentication options instead of assuming AuthStorage was a root export. TLS validation and lifecycle-script restrictions were preserved. The final consumer installation and SDK/CLI checks passed.

## Final observed checks

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

## Commands and evidence

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

Remaining requirements are tracked in the [work queue](tasks.md), including Anthropic, Mistral, Codex, Bedrock, Google, images/classifiers/deferred attempts, nested auxiliary correlation, crash recovery, directory races, Windows assurance, and provider-specific metrics/settings. Passing local tests establishes the implemented subset only.
