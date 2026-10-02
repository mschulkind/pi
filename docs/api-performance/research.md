---
status: accepted
stage: CURRENT
---

# Observe transports, not assistant messages

The supplied architecture audit governs the design. Source inspection started on existing `main` at `f349a4d2d`. Local servers, injected fetches, and faux providers supply evidence without paid calls.

## Definitions

These definitions adopt the user's vocabulary rather than coin new terms:

- **Attempt:** one observed transport invocation, not a message, socket lifetime, redirect, or hidden proxy replay.
- **Logical request:** one intended model generation that may be retried, not each adapter invocation or assistant timestamp.
- **Parent operation:** the user request linking assistant generations and supporting summaries; not an individual HTTP request.
- **Content arrival:** a parsed event carrying new nonempty text, refusal, readable reasoning, or tool arguments; not heartbeat, usage-only data, or a duplicate final snapshot.
- **Client-observed duration:** elapsed monotonic time between named local observations, not provider decode latency.
- **Coverage gap:** an explicit local notice that an operation cannot be observed, not a failed API attempt or proof of zero calls.

## Verified findings

- OpenAI Completions, Responses, and Azure Responses inject fetch into pinned clients but disable their internal retries. Production tests therefore prove Pi retry-loop coverage. A separate direct OpenAI client fixture enables an actual SDK-internal retry and proves the same wrapper sees it.
- Pi Messages exposes gateway HTTP and normalized events only. Gateway default counts cannot establish provider usage; preserved numeric provider reports and explicit provider cache splits have separate provenance.
- Existing provider callbacks execute before normalization. Observation runs before awaiting extensions, preserving callbacks and raw message usage.
- Refusal and terminal snapshots may be the first content. Tracking numeric lengths, not saving text, avoids counting duplicate snapshots as new arrival.
- Response headers, provider terminal events, and adapter completion are different observations. HTTP error-body consumption is not instrumented and must stay unknown.
- SDK-owned signal cancellation cannot by itself establish caller abort or timeout. Only the original caller signal proves caller cancellation.
- Session lifecycle events establish retry identity without using timestamps. Summaries need their own ID before entering the retry helper; routing IDs do not identify the owning session.
- Explicit `process.exit` skips natural asynchronous draining. Scheduled synchronous writes plus a best-effort exit hook provide a bounded between-record drain; this trades brief event-loop blocking for fewer lost records.

## Remaining seams

Anthropic injected/federated clients, Codex WebSocket sends and failures, Bedrock request handlers inside Smithy retries, Google dependency transports, native Mistral, and image/classifier/deferred operations remain uninstrumented. An outer call cannot prove their attempt counts. ModelRuntime persists explicit notices instead.

Cross-run retention must not prune another live writer. Crash recovery and ancestor directory replacement races remain separate, unresolved requirements; neither is implied by exit draining or private final-file permissions.

## Sources

- [OpenAI adapter](../../packages/ai/src/api/openai-completions.ts): fetch injection and disabled SDK retries.
- [Responses adapter](../../packages/ai/src/api/openai-responses.ts) and [Azure adapter](../../packages/ai/src/api/azure-openai-responses.ts): provider terminal parsing and transformed serialized requests.
- [Gateway adapter](../../packages/ai/src/api/pi-messages.ts): HTTP and normalized event boundary.
- [Shared telemetry contracts](../../packages/telemetry/src/index.ts) and [in-memory backend](../../packages/telemetry/src/memory.ts): privately owned local snapshots, not arbitrary export contexts.
- [Verification evidence](qa.md): regression failures, successful tests, and landing logs.
