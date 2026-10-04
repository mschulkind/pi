---
status: awaiting-review
---

# Default-on session responsiveness plan

## Settled policy (supersedes the diagnostic capture)

Core responsiveness metadata is enabled by default on host and jail. Only
`PI_CORE_TELEMETRY=0` opts out. `PI_CORE_TELEMETRY_DIR` is deprecated/ignored;
`YOLO_DURABLE_DIR` does not control this producer. No standalone capture files,
locks, directory creation, ten-minute capture deadline or synthetic sessions.
API attempt files, workflow journals, scanners and inspector/profiling stay unchanged.

## Approved persistence tradeoff

The real SessionManager uses synchronous normal JSONL commits; it has no async
journal append API. The parent explicitly approved a **narrow buffered/piggyback
adaptation**, not a conversion of all history persistence to asynchronous IO.
No input/render callback serializes or persists metadata. Timers only aggregate
and enqueue bounded windows; they never flush disk. At an actual ordinary commit,
SessionManager inserts queued custom rows before the committing row and combines
rows into the existing write. Setup-only rows in a new persistent session leave
windows pending until its first conversation commit. <=2 bounded envelope
reserializations rebind only the parent within the same origin/branch. Existing synchronous history IO and ordinary
commit failure semantics remain unchanged.

Graceful finalization may perform one extra synchronous <=2-row metadata-only
append, **only to an already-created conversation file**. That failure is caught
and counted. Idle metadata can remain buffered until a normal commit or graceful
shutdown; neither immediate idle durability nor a hard wall-time shutdown bound
against filesystem stalls is promised. This tradeoff supersedes the original
blanket asynchronous-persistence requirement.

## Producer and lifecycle

- One owner per actual AgentSession (including SDK construction), no global
  cross-session aggregate. TUI observers attach to the actual owning TUI only.
- Nine existing closed scalar categories and inclusive callback semantics remain.
  Event-loop delay is explicitly process-wide observation during this session's
  window, overlapping concurrent sessions; never sum it as session CPU.
- Ordinary session history uses `type=custom`, `customType=pi.core-responsiveness`.
  Metadata contributes no model messages, transcript rows, summary content or
  ordinary content-search text. Normal envelopes supply timestamps/linkage.
- Queue snapshots bind session identity and branch/generation. Pending windows
  cannot follow new/resume/fork/tree replacement into another origin. Branch
  changes discard/count pending old-branch windows and reset the scalar/histogram
  generation on the next sample. Disposal detaches idempotently. Inherited fork
  history/entry IDs retain normal parentSession lineage; copied observations do
  not inflate current producer health or become new fork measurements.
- No persistent file without conversation; --no-session is memory-only. Process
  statistics without an actual session never manufacture one.
- /runtime reports default configuration, session owner/live state, buffered vs
  persisted health, disabled/in-memory/no-active-session truthfully, without paths.

## Bounds and idle policy

Fixed nine metrics, 20-ms histogram resolution, 5-second unref sampling cadence,
<=8,192 bytes per enveloped row and <=2 pre-serialized pending rows per manager.
Additional windows drop with cumulative counters; no ordinary entry is dropped.
No ten-minute lifetime limit or standalone retention slots. History retention is
normal append-only session retention. Idle event-loop windows are recorded at
most once per minute; TUI activity can make a five-second window useful. Sampling
or metadata persistence never emits rendering events or requests redraws.
Counts cap at one billion, individual durations at 600,000 ms and totals at the
safe integer ceiling. Opt-out constructs no recorder/clocks/timers/subscriptions.

## Tests before source edits

Observe red against 9adadcb8d for default activation, real piggyback one-write/
reopen/leaf behavior, projection/summary/UI/search exclusion, memory-only/opt-out,
origin changes/fork/branch, independent sessions/TUIs, queue drops, idle behavior,
metadata-only final-write failures and normal failure propagation. Exercise
actual SDK, interactive, RPC and print modes with local faux providers. Replace
only obsolete diagnostic storage/capture tests. Run targeted tests and full
npm run check. Parent owns independent review and managed offline/build/package
gates. No production performance claim, commit, push, deploy or restart.
