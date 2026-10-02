---
status: in-review
stage: DECIDED
next: Extend the explicitly reported unsupported transports and crash recovery
---

# Implemented repairs and remaining work

Scope follows the [audit definitions](research.md#definitions). Passing tests do not establish coverage of a transport they never exercise.

## Implemented

- [x] Four HTTP streaming adapters record actual fetch invocations, rejections, failures, and retries.
- [x] Safe settings and usage provenance; gateway defaults are not provider reports, and normalized input consistently excludes cache without invented zeros.
- [x] Refusal/final-only content and duplicate snapshot handling; headers, provider terminal, and adapter completion remain separate.
- [x] Caller versus internal cancellation classification; production Pi retries and actual client-library retries have distinct tests.
- [x] SDK lifecycle identity survives automatic retries and overflow recovery; summaries and cache warming use independent IDs/purposes and owning-session correlation.
- [x] Privately owned in-memory telemetry backend, with no caller-supplied export context.
- [x] Bounded local queue, private files, opened-file checks, immediate-exit draining, inactive-run retention, and protection for live writers.
- [x] Durable unsupported-route/operation notices and visible stderr warnings; health remains available to SDK consumers.
- [x] Local/faux/child-process regressions and five proportionate evidence documents.

## Still incomplete

- [ ] Anthropic and injected/federated client fetches, native Mistral, Codex HTTP/WebSocket, Bedrock retry-handler invocations, and Google dependency transports.
- [ ] Actual image, classifier, and deferred operation attempts; standalone unsupported calls currently lack automatic notices.
- [ ] Owning-session links for nested auxiliary calls that bypass the SDK stream path, manual retry continuity, and complete custom-provider adoption.
- [ ] Provider-specific usage/schema coverage, timing metrics, effective settings, and gateway reasoning provenance beyond normalized events.
- [ ] Crash/kill and unfinished-attempt recovery; robust ancestor symlink/replacement-race protection and Windows permission guarantees.
- [ ] Fully bounded aggregate retention with concurrent processes/PID reuse, and nonblocking persistence without sacrificing exit-time draining.
- [ ] Remaining non-fetch abort/concurrency/transport tests and interactive health UI beyond stderr warnings.

See [implementation limitations](implementation.md#explicitly-unsupported) and [actual landing checks](qa.md). The feature remains partial regardless of commit status.
