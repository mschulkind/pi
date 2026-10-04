---
status: awaiting-review
---

# Core responsiveness in ordinary session history

Core metadata is default-on everywhere. Only `PI_CORE_TELEMETRY=0` disables it.
`PI_CORE_TELEMETRY_DIR` is deprecated and ignored; `YOLO_DURABLE_DIR` is not an
activation condition. Inspector/profiling, API attempt files, workflow journals
and scanners remain unchanged. No separate files/locks or synthetic sessions.

## Approved durability contract

See [the settled plan](plan.md). SessionManager's existing normal commits are
synchronous. The parent approved bounded buffering and piggyback on those
commits, plus a bounded metadata-only final append to an already-created
conversation file. This is deliberately **not asynchronous history persistence**.
No timer/input/render callback flushes telemetry disk; callback observers update
scalars only. Metadata-only failures are nonfatal; ordinary commit failures keep
their existing semantics. Idle metadata is not immediately durable. No hard
wall-time shutdown bound can be promised against synchronous filesystem stalls.

Pending windows belong to their originating session/branch. Normal commits
materialize them before the committing ordinary row and preserve parent/leaf/replay order.
Setup-only rows in a new persistent session leave the <=2 windows pending until
an actual conversation commit. That commit may reserialize only their envelopes
to the then-current same-origin/same-branch parent; no hot callback does this.
No conversation means no new file; final metadata cannot recreate a deleted
conversation file. Crash/dead-terminal paths detach without sampling or disk IO.
Public TUI stop detaches only that renderer; the still-owned SDK session remains
live until session disposal or CLI finalization. Nonpersistent sessions keep metadata in
memory only. Retention is ordinary append-only history, not diagnostic slots or
a ten-minute capture. SDK and CLI sessions own independent recorders; TUI
observations attach only to the owning TUI. Disposal/new/resume/fork/tree changes
settle/reset attribution without carrying aggregates into the next session.
Forks retain inherited historical rows/entry IDs like other history. Existing
parentSession lineage is sufficient here: copied rows are inherited observations,
not newly generated measurements. Current runtime health counts only the current
recorder's observations/commits, not ancestor totals or copy writes. This does
not supply a new explicit per-row origin identity.

## Structured payload

Rows use ordinary `type="custom"`, `customType="pi.core-responsiveness"`, and the
normal id/parentId/timestamp envelope. `data` uses `schema="pi.core-responsiveness"`,
`schemaVersion=2`, `window`, monotonic-clock elapsed `windowMs`, fixed `metrics` and cumulative
`losses` (`droppedRecords`, `writeErrors`). The nine metrics each have
`count,totalMs,maxMs`:

`input_dispatch`, `input_dispatch_error`, `render_request`, `render_coalesced`,
`render_cancelled`, `render_wait`, `render`, `render_error`, `full_redraw`.

`eventLoop` has `scope="process"`, `samples,minMs,maxMs,meanMs,p99Ms`. Concurrent
sessions observe overlapping process-wide delay; these are not session CPU
measurements. Unsampled/invalid delay values are null, distinct from zero.
Payload contains no prompt/output/keys/URLs/auth/arbitrary errors/stacks/paths
or extra identities/timestamps. The normal envelope supplies session linkage.

The existing actual TUI seams measure synchronous dispatch (including consumed
input), scheduling wait/coalescing/cancellation, renderer invocations (including
no-change/failed invocations), and redraw observations in both modes. Source
exceptions are unchanged; observer failures are isolated. Inclusive timings
can overlap and must not be summed as CPU. No physical-keypress/display-completion
latency, causal input-to-frame IDs or production improvement is established.

## Bounds and health

Nine categories; 20-ms histogram resolution; 5-second unref cadence; at most one
idle event-loop record per minute; <=8,192-byte enveloped rows and two pending
pre-serialized rows per manager. Further useful windows drop/count until an
ordinary commit; no ordinary row is discarded. No total lifetime capture cap.
Counts cap at one billion, individual durations at 600,000 ms, totals at the
safe integer ceiling. History grows only at these bounded useful checkpoints
under normal retention, not per key/render. Metadata never emits redraw events.

/runtime distinguishes default configured state, live actual-session ownership,
memory-only/disabled/no-active-session states and observed health (including
buffered vs persisted rows and dropped/error counters). Configuration is not
sample or persistence evidence. Snapshot reporting performs no diagnostic IO.

See [QA](qa.md) and [tasks](tasks.md) for fresh verification. Old standalone-capture
gates establish only the previous design and cannot accept this revision.
