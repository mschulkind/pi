---
status: accepted
stage: DECIDED
next: Complete remaining transport coverage without weakening local-only recording
---

# Keep performance observations outside model context

The [audit definitions](research.md#definitions) distinguish an observed transport attempt from an outer call. The coherent implementation is a four-route subset; durable notices identify unsupported calls instead of inventing counts.

## Settled choices

1. Observe injected fetch invocations and parsed events. Preserve retry policy, prompts, raw usage, renderers, and extension callbacks.
2. Separate headers, provider terminal observation, and adapter completion. Error-body completion and hidden transport behavior stay unknown.
3. Keep provider reports, gateway-normalized counts, and normalized input conventions distinct. Persist only bounded numeric usage and approved settings.
4. Allocate logical IDs from session lifecycle events and before summary retry loops. Keep owning session identity separate from provider routing IDs.
5. Make ModelRuntime recording explicitly opt-in through a private absolute directory. Own the shared in-memory telemetry context; accept no arbitrary exporter as a supposedly local backend.
6. Schedule bounded writes, support explicit exit draining, retain inactive-run files without pruning live writers, and show loss/coverage warnings. Document synchronous I/O and remaining crash/race limitations.

## Implementation map

| Area | Responsibility |
| :--- | :--- |
| [Observer](../../packages/ai/src/api/performance.ts) | Attempt schema, wire callbacks, named timing boundaries, safe usage/settings, bounded histories |
| [Request types](../../packages/ai/src/types.ts) and [simple forwarding](../../packages/ai/src/api/simple-options.ts) | Optional recording and local correlation metadata |
| Four streaming adapters | Initialize observation without replacing parsers, retries, or hooks |
| [Recorder](../../packages/coding-agent/src/core/api-performance-recorder.ts) | Local snapshots, bounded queue, private files, retention, exit draining, health and notices |
| [ModelRuntime](../../packages/coding-agent/src/core/model-runtime.ts) | Explicit enable/disable and durable unsupported-operation reporting |
| [Session SDK](../../packages/coding-agent/src/core/sdk.ts) and [correlation state](../../packages/coding-agent/src/core/performance-correlation.ts) | Actual owning session and lifecycle-based retry/operation identity |
| [Summary helper](../../packages/coding-agent/src/core/compaction/compaction.ts) | One summary logical ID across retries |
| [Cache warmer](../../packages/coding-agent/src/core/cache-warmer.ts) | Independent logical ID and purpose per refresh |

## Verification and next work

Regression tests lead observation/privacy repairs; child processes verify immediate exit, bounded loss reporting, and cross-run cleanup. An actual SDK session test verifies automatic retry identity and later user-request separation. The [QA document](qa.md) records results, not intended checks.

The [remaining queue](tasks.md) retains non-fetch transports, recovery, directory races, and provider-specific metadata requirements. This plan does not mark them complete merely because a partial implementation passes its applicable gates.
