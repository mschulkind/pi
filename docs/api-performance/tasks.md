---
status: in-review
stage: DECIDED
next: Extend the explicitly reported unsupported transports and crash recovery
---

# Implemented repairs and remaining work

Scope follows the [audit definitions](research.md#definitions). Passing tests do not establish coverage of a transport they never exercise.

## Implemented

- [x] Five HTTP streaming adapters record actual fetch invocations, rejections, failures, and retries.
- [x] Codex socket construction, generation sends/rejections, successful reuse, provider retries, and pre-start/session HTTP fallback; separate connection kinds, shared logical identity, and local/faux transport regressions.
- [x] Safe settings and usage provenance; gateway defaults are not provider reports, and normalized input consistently excludes cache without invented zeros.
- [x] Refusal/final-only content and duplicate snapshot handling; headers, provider terminal, and adapter completion remain separate.
- [x] Caller versus internal cancellation classification; production Pi retries and actual client-library retries have distinct tests.
- [x] SDK lifecycle identity survives automatic retries and overflow recovery; summaries and cache warming use independent IDs/purposes and owning-session correlation.
- [x] Privately owned in-memory telemetry backend, with no caller-supplied export context.
- [x] Bounded local queue, private files, opened-file checks, immediate-exit draining, inactive-run retention, and protection for live writers.
- [x] Durable unsupported-route/operation notices and visible stderr warnings; health remains available to SDK consumers.
- [x] Local/faux/child-process regressions and five proportionate evidence documents.

## Codex landing

- [x] Reproduce and repair function/custom tool-done timing on SSE and WebSocket, including partial deltas and duplicate snapshots.
- [x] Reproduce and repair HTTP observation-ID allocation failure without preventing actual fetches or inventing records.
- [x] Fresh build, full check, prescribed isolated suite, packed SDK/CLI consumer gate, and five-document verification.

The extension started at `51f721b39` on existing `main`. Recording remains opt-in. [Current evidence](qa.md#codex-landing-verification) reports fresh results, retained artifacts, and limitations separately from prior landing evidence.

## Still incomplete

- [ ] Anthropic and injected/federated client fetches, native Mistral, Bedrock retry-handler invocations, and Google dependency transports.
- [ ] Actual image, classifier, and deferred operation attempts; standalone unsupported calls currently lack automatic notices.
- [ ] Owning-session links for nested auxiliary calls that bypass the SDK stream path, manual retry continuity, and complete custom-provider adoption.
- [ ] Provider-specific usage/schema coverage, timing metrics, effective settings, and gateway reasoning provenance beyond normalized events.
- [ ] Crash/kill and unfinished-attempt recovery; robust ancestor symlink/replacement-race protection and Windows permission guarantees.
- [ ] Fully bounded aggregate retention with concurrent processes/PID reuse, and nonblocking persistence without sacrificing exit-time draining.
- [ ] Remaining non-fetch abort/concurrency/transport tests and interactive health UI beyond stderr warnings.

See [implementation limitations](implementation.md#explicitly-unsupported) and [actual landing checks](qa.md). The feature remains partial regardless of commit status.
