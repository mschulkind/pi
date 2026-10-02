---
status: in-review
stage: DECIDED
next: Extend the explicitly unsupported transports and recovery paths
---

# Local performance recording: implemented scope

This remains a **partial feature**, not complete transport coverage. Terms such as [attempt and logical request](research.md#definitions) follow the user's audit. The initial implementation started at `f349a4d2d`; this Codex extension started on existing `main` at `51f721b39`; no push, deployment, paid provider call, or dependency change is part of this work.

## Enable and inspect

```bash
# The directory must be absolute, owned by you, and private.
mkdir -m 700 /absolute/private/performance
PI_API_PERFORMANCE_DIR=/absolute/private/performance pi

# Each line is either an actual observed attempt or an explicit coverage notice.
jq -c 'select(.recordKind == "api_attempt") |
  {sessionId, operationId, logicalRequestId, attemptOrdinal,
   api, actualApiHostname, outcome, timing, usage}' \
  /absolute/private/performance/attempts-*.jsonl
jq -c 'select(.recordKind == "coverage_gap")' \
  /absolute/private/performance/attempts-*.jsonl
```

SDK consumers can pass `performanceDirectory` to `ModelRuntime.create`; null disables recording even with the environment variable. `PI_TELEMETRY=0` is independent. No implicit directory or consent is assumed. Standalone supported AI adapters accept `performance` with a consumer-owned record callback.

The default recorder owns the shared in-memory telemetry backend and exports its privacy-allowlisted JSON snapshot to local files only. No caller-supplied telemetry context is accepted by this feature. General telemetry contexts are not forwarded. Records never enter model context, session transcripts, or bug-report uploads.

## Boundaries and provenance

The five recorded streaming routes are OpenAI Completions, OpenAI Responses, Azure Responses, Pi Messages, and Codex Responses. A wrapped fetch observes each actual HTTP invocation, including rejection and retries. HTTP is distinguished from its observed streaming protocol; the response content type identifies SSE (server-sent events) or newline-delimited JSON without persisting headers.

All offsets are monotonic milliseconds from the attempt anchor. UTC is only an absolute start time. Parsed content observations precede awaited extension callbacks; refusal deltas and new final-only text, reasoning, and tool arguments count. Duplicate final snapshots do not invent later arrival. No message timestamp, chunk/token conversion, throughput estimate, or token decode latency is used.

- `headersOffsetMs`: response headers received.
- `providerTerminalOffsetMs`: parsed provider terminal event or finish reason observed; it is not the end of the response body.
- `completedOffsetMs`: adapter terminal completion for successful generation, or transport rejection. It includes adapter work and extension callbacks.
- `completionBoundary`: states the boundary explicitly. HTTP error records close at headers with **unknown** error-body completion, null completion offset, and a durable limitation.
- `observationClosedOffsetMs`: when recording closed, distinct from actual provider completion.

Only the caller's abort signal establishes caller cancellation. An aborted SDK signal with a live caller is an internal cancellation of unknown cause, not inferred caller abort or timeout. The SDK timeout regression and actual SDK retry regression are separate from production Pi retries, which disable OpenAI SDK retries.

Usage has three distinct representations:

- `rawReports` and matching `rawReportSources`: safe numeric provider reports, either observed directly, preserved by the gateway, or reported gateway provider cache splits. Arbitrary usage JSON is never saved.
- `gatewayCounts`: allowlisted gateway-normalized counts, which may include initialized zeros. They are **not** evidence of reported provider counts.
- Normalized counts: input excludes cache consistently. `providerInput` preserves the provider's reported input with its own convention. If cache counts or the provider convention are unknown, uncached input stays null. Totals are reported, never synthesized.

Missing counts remain null; a reported zero remains zero. Existing assistant-message usage, raw usage, rendering, and hooks are unchanged. Settings are safe common serialized fields after request hooks; reasoning string settings use closed vocabularies. Returned model identity comes only from observed provider events. Pi timing describes the gateway, not its upstream provider; its normalized reasoning kind remains unknown.

## Codex transport boundaries

Codex uses the same observer and private recorder, not another telemetry backend. HTTP attempts start at actual fetch invocations, including compressed requests, rejections, and provider retries. Observation initialization is isolated: an allocation failure still invokes the actual fetch and creates no fabricated record. Settings come from the serialized post-hook body, not caller options that Codex does not send. Codex additionally allowlists temperature, service tier, text verbosity, scalar tool choice, and parallel tool calls; unknown values stay null. Its untransmitted `maxTokens` option does not invent an output limit.

WebSocket records distinguish two actual invocations:

- `attemptKind: connection`: socket construction through open or rejection. No generation model, usage, content timing, generation ordinal, or HTTP headers/status is invented. `observationPoint` is `socket_lifecycle`; completion is `connection_open` or `connection_rejection`.
- `attemptKind: generation`: one `socket.send` invocation, including synchronous send rejection. `websocket_events` identifies parsed frames, and `send_rejection` distinguishes failed sends from later transport/generation failures. `sendAccepted` means the socket accepted the call, not that the provider received it.

A random `connectionId` links sends to a socket without account IDs or auth hashes. `reused` describes actual acquisition of an existing socket; filter successful outcomes when counting successful reuse. The actual socket hostname survives changed requested routing and recording enabled after socket creation. An unavailable constructor creates no connection or generation record.

Generation ordinals and previous-attempt links exclude connections. One logical request ID spans connection attempts, provider generation retries, and pre-start HTTP fallback; owning session and operation IDs remain separate from routing affinity. `transportTransition` distinguishes `pre_start_sse_fallback` from `session_sse_fallback` on actual HTTP attempts. There is no artificial fallback request when no fetch occurs. Original `response.done`/completed/incomplete/failed events are observed before normalization and awaited hooks; readable full/summary reasoning excludes encrypted replay data. Function-call arguments and custom-tool input done events also count new content before callbacks; later identical item/terminal snapshots do not move content-arrival timestamps. Close reason bodies and arbitrary provider errors never enter these records.

## Correlation and storage

Session events assign a parent operation to a user request, distinct logical IDs to later assistant/tool turns, and the same logical ID to explicit automatic retries or overflow recovery. Summary retries reuse one logical ID. Compaction, branch summaries, bug-report summaries, and cache warming have separate purposes and IDs; summaries use the owning SDK session, not their provider routing ID. Explicit caller recording options survive unchanged.

The queue holds at most 128 records, each at most 256 KiB. Files target 8 MiB, with four retained across inactive runs and this writer's rotations. Other live writers in the same [process-ID namespace](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html) are protected from pruning, so aggregate storage can exceed four files; process-ID reuse can temporarily protect old files. Do not share a recording directory across hosts or process-ID namespaces: this liveness check cannot identify their active writers. A single record can exceed a smaller configured file target.

Writes are scheduled outside the model-call callback but use synchronous filesystem operations, permitting production `process.exit` draining. This can briefly delay the event loop. Exit draining has a 250 ms between-record budget and reports drops/write failures on stderr; an individual blocked filesystem call cannot be forcibly interrupted. SDK consumers can await `flushPerformanceRecords()` for orderly writes.

Directory/file modes are 0700/0600 on POSIX; symlink final targets, nonprivate files, and incorrect ownership are rejected. File checks inspect the opened descriptor. Health getters expose written, dropped, write failures, queue size, missing/partial correlation, and unsupported counts. Written/dropped/queued counts include both record kinds, not just API attempts. Disk/queue failures and unsupported routes also produce visible stderr notices; unsupported calls additionally persist `coverage_gap` lines when storage is healthy.

## Explicitly unsupported

- Anthropic, injected/federated client transports, native Mistral, Bedrock handlers inside Smithy retries, and Google hidden transports.
- Images, classifiers, and deferred polling/cancellation: ModelRuntime emits durable notices, not artificial attempt records. Nested standalone calls bypassing ModelRuntime do not automatically emit notices or inherit owning-session correlation.
- Gateway upstream retries, redirects, hidden proxy replay, and overlapping successful fetch attribution; overlap closes the earlier observation with unknown completion.
- Crash/kill and unfinished-attempt recovery. Windows permission assurance, ancestor symlink/replacement-race hardening, provider-specific timing metrics, and complete provider setting schemas.
- Correlation beyond the 1024-request history: unseen explicit IDs have unknown ordinals after truncation, not invented restarts. Raw usage history and final-content history are bounded and disclose truncation. Numeric-length snapshot tracking cannot distinguish same-length content replacements. There is no exactly-once guarantee.

See [remaining work](tasks.md) and [observed verification](qa.md).
