---
status: in-review
stage: DECIDED
next: Parent landing gates and workflow consumer integration
---

# Public producer and runtime contract

## Identities and boundaries

The vocabulary follows the user request and the existing
[attempt definitions](../api-performance/research.md#definitions):

- `sdkInvocationId`: one physical-provider dispatch through ModelRuntime after
  authentication/header preparation, not proof of a sent request.
- `logicalRequestId`: the core-selected intended generation; explicit agent
  retries retain it, later tool generations replace it.
- `attemptId`: the existing actual HTTP invocation or socket operation ID. A
  `connection` attempt is not generation traffic; filter `attemptKind`.
- `orchestrationRetry`: explicit agent retry index, starting at zero. Null means
  unavailable, not zero wire retries. Summary callers may supply their own
  explicit retry index without changing the logical ID.
- `operationId`: the existing parent user operation, not an individual attempt.

These IDs are local metadata, never provider routing IDs or replay instructions.

## Capability version 1

Exported from the coding-agent package root:

```ts
getProducerObservationCapability(runtimeOrModelRegistry): ProducerObservationCapability | null
```

A missing method, unsupported version, or throwing capability accessor yields
null. Both ModelRuntime and the extension-facing ModelRegistry expose the method.
Consumers supporting old package releases must namespace-import the package and
check that the helper export exists before calling it; importing a missing named
export would fail before capability detection. Report unsupported/null in that
case. Do not infer support from environment variables or an installed package
on disk.

The capability is frozen and provides:

```ts
subscribe(callback: (event: GenerationObservation) => void | Promise<void>): () => void
createAuxiliaryCorrelation(purpose, { sessionId?, operationId? }): PerformanceCorrelation
```

Subscribe before generation and unsubscribe on disposal/replacement. Events
belong to the runtime, not a workflow run; filter by authoritative owning-session
or parent-operation identity. A shared runtime reports every caller's dispatch.
No history/replay buffer is provided. A cache hit that makes no provider call
emits no dispatch.

The callback receives a frozen scalar-only object:

```ts
{
  schemaVersion: 1,
  boundary: "provider_dispatch",
  sdkInvocationId: string,
  logicalRequestId: string,
  sessionId: string | null,
  operationId: string | null,
  purpose: "assistant" | "compaction" | "branch_summary" |
    "bug_report_summary" | "cache_warm" | "auxiliary" | "unknown",
  orchestrationRetry: number | null,
  provider: string | null,
  api: string | null,
  model: string | null,
  wireAttemptId: null,
  transportCoverage: "supported" | "unsupported"
}
```

Recording options, if supplied, are the authoritative identity source; otherwise
core-selected correlation is used. Missing/invalid logical IDs are selected once
at this boundary and the same selection reaches the provider and recorder.
Callbacks are not awaited; exceptions/rejections are isolated. Callback return
values cannot modify requests. Synchronous callback work can still delay dispatch.

Auxiliary purposes exclude assistant/unknown in the typed API. Allocate once
before an auxiliary retry loop, pass the result as `performanceCorrelation`, and
retain its logical ID across retries. Owning session and parent operation are
independent of summary-specific provider routing IDs. Existing core summary IDs
remain authoritative; this helper is for later adapter adoption, not a second
summary generator. Requested and resolved reasoning stay workflow-owned.

## Attempt schema additions

The existing `PerformanceAttemptRecord` schema remains version 1 with additive
nullable `sdkInvocationId`, `orchestrationRetry`, and `responseHandle` fields.
Coverage-gap records also carry nullable invocation/retry fields. Older consumers
must tolerate additive fields; older recordings simply lack them.

`responseHandle` is captured only from top-level `id` on a known
`chat.completion.chunk` event of the completions API. It is at most 256 ASCII
letters, digits, underscores, or hyphens; empty, malformed, URL-like, nested tool
IDs and arbitrary metadata are not candidates. Missing handles stay null.
The existing assistant `responseId` behavior is unchanged. Returned model or
route and a response handle are not proof of an upstream provider. The matt
route analytics owner remains unchanged.

Actual serialized post-hook settings remain the AI recorder's source. Its closed
allowlist and existing `effective_settings_common_serialized_fields_only`
limitation mean null can indicate an untransmitted, unknown, or unallowlisted
setting. No requested/resolved/transmitted equivalence is invented.

## Recorder activation and proof

ModelRuntime and ModelRegistry expose:

```ts
configureTransportRecording({ directory?: string | null }): TransportRecordingStatus
getTransportRecordingStatus(): TransportRecordingStatus
flushPerformanceRecords(): Promise<void>
```

Status has `capabilityVersion: 1`, `enabled: boolean`,
`observedHealth: PerformanceRecordingHealth | null`, and
`coverage: "allowlisted_transports_only"`. Configure before starting work;
reconfiguration closes/drains the old writer and creates a fresh writer. In-flight
requests retaining the old writer can lose later observations; losses do not
fail generation. No health counters are interpreted as provider success.

Precedence is explicit null or `PI_API_PERFORMANCE=0` opt-out first, then
`PI_API_PERFORMANCE_DIR`, then the API directory, then
`YOLO_DURABLE_DIR/pi-api-performance`. An empty environment directory disables;
relative paths are not enabled. Without any directory source, recording is off.
The default does not use a home directory or upload endpoint.

The existing writer enforces owned private 0700 directories and 0600 files on
POSIX and reports disk failures, drops, queue size, correlation gaps, and
unsupported routes. Enabling alone proves no writes. A workflow must verify the
child's capable API, counters, and fresh local files; an environment variable is
configuration, not traffic evidence. Coverage remains the existing five
allowlisted streaming routes; unsupported routes emit notices, not fake attempts.

## Running code and `/runtime`

`getRuntimeInfo(runtime, loadedExtensions)` returns the source/build identity,
all supplied loaded-extension entry identities, transport status, and existing
inspector status. `formatRuntimeInfo(info)` formats that snapshot; `/runtime`
uses the actual session resource loader's loaded extension list. Neither
formatter nor rendering scans Git or reads files. No session/attempt UUID or
inspector URL is included.

The unbundled build stamps its compiled module before bundling. Build identity
contains version, build-time fork commit, dirty/unknown state, and SHA-256 digest
of compiled workspace inputs, excluding the stamp and prior bundle/Bun outputs.
`digestScope` is `compiled_workspace_inputs`, not a binary-file hash or loaded
module graph attestation. Source execution is `source_unstamped` with unknown
version/commit/digest/dirty rather than a current disk HEAD claim.

`getLoadedExtensionIdentity(extension)` exposes package version, Git snapshot
commit, dirty/unknown state, entry digest, origin, and uncertainty. File-based
extensions capture at module import and retain that snapshot with the loaded
factory across cached reloads. A reused native factory is never relabeled with
new disk metadata. Changed entry bytes during import produce unknown digest and
commit. Dependency graphs always remain `dependency_graph_not_attested`;
native caches may retain dependencies even after `/reload`. Built-ins use the
compiled build stamp, while unknown inline factories remain explicitly unknown.
The captured Git commit is entry snapshot attribution, not proof of the entire
loaded dependency graph.

Inspector output is only active/disabled and existing-origin-unknown/not-started.
Automatic enablement remains `disabled_missing_authoritative_yolo_contract`,
unconditionally and independently of all launch-record bytes. Yolo's current
`yolo.launch-network` version 2 at `/run/yolo/launch/network.json` is observational
only; version 1's positive-proof interpretation was withdrawn. A `private` claim
means separate loopback, not permission to expose an inspector. Even an apparently
read-only effective mount cannot establish resistance to privileged mount
replacement. No environment/configuration flag, read-only parent, or process-ID
namespace is substituted for that missing security guarantee.

Core does not read the record or mount table and does not report network proof.
The permanent v1/v2 forged-record fixtures enforce that neither reading nor
activation occurs during runtime reporting. Any future observational display
must remain separate from authorization. Positive consumption requires a new
explicit contract revision and adversarial verification of continuing
mount-replacement resistance, not merely receipt of the current record.
The Yolo partial patch remains incomplete; no commit or deployment is authorized.

## Limits

No matt files, analytics scanner, root pack, deployed home, compact presentation,
or released changelog entries were changed. No paid request, replay, restart,
commit, push, deployment, or upload occurred. Full managed build/check/suite and
actual packed-consumer checks belong to the parent and remain unclaimed here.
Existing transport/storage coverage gaps, synchronous persistence, crash recovery,
ancestor directory races, and Windows permission uncertainty remain unchanged.
See [QA evidence](qa.md).
