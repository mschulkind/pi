---
status: in-review
---

# Core responsiveness implementation plan

## Scope and contract

Implement producer-only metadata aggregates in this source fork. Keep transport
recording, workflow telemetry, scanners, profiling and inspectors unchanged.
Do not infer activity from a durable directory or configure a provider.

Activation requires **both** `PI_CORE_TELEMETRY=1` and an absolute
`PI_CORE_TELEMETRY_DIR`. Any other switch spelling, including `0`, disables
capture; directory-only and `YOLO_DURABLE_DIR` configurations do not activate it.
The selected directory must be owner-private; unsafe storage fails closed.

## Design

1. Add a passive scalar-only observer at existing `TuiBase` input, request,
   scheduling and actual renderer boundaries, shared by both renderer modes.
   Disabled paths only read an optional observer before continuing existing
   behavior. No telemetry timer, filesystem call, serialization, per-event
   clock, identity allocation or subscription scan runs on disabled hot paths.
2. Add one CLI-process recorder, with repeat-live starts sharing the same owner.
   Monitor event-loop delay and aggregate nine fixed TUI categories. Subscriber
   exceptions/rejections are isolated and never replace source exceptions.
3. Sample every five seconds with an unreferenced timer. Reset aggregate windows;
   preserve null delay statistics without histogram samples. Bound capture,
   memory, output, ownership and shutdown independently.
4. Use asynchronous serialized private file writes, one pending record and two
   fixed retention slots. No directory scans or synchronous writes. Reject
   symlinks, unsafe ownership/permissions and replacement directories. A lock
   prevents two captures from using the same directory.
5. Start before CLI mode execution and close in `finally`. Graceful hard exits
   in interactive, RPC and print modes await bounded close; public stop, crash
   and dead-terminal exits detach
   without blocking terminal cleanup. Do not change model or signal semantics.
6. Extend `/runtime` snapshots with configuration, live state, static reason,
   coverage and nullable observed health. Configuration proves neither samples
   nor persistence. Reporting remains snapshot-only and exposes no path.

## Bounds

| Resource | Fixed limit |
| --- | --- |
| TUI categories / subscription owners | 9 / 4 |
| Event-loop resolution / sample cadence | 20 ms / 5,000 ms |
| Capture windows / elapsed deadline | 120 / 600,000 ms |
| Record / cumulative accepted session bytes | 8,192 / 1,048,576 |
| In-flight plus pending records | 2 |
| Retained committed files | 2 |
| Shutdown drain wait | 100 ms |
| Numeric count / individual duration | 1 billion / 600,000 ms |
| Directory string / path components | 4,096 characters / 64 |

Shutdown cannot cancel an already-issued OS filesystem operation. Detach timers
and observers immediately, abandon pending output on deadline, then clean up
owned handles/temp/lock when the issued operation eventually returns. Never
remove another owner's lock. A crashed process can leave a stale lock/temp file;
fail closed on the next launch rather than guessing ownership.

## Test and review sequence

Write source-named tests before new modules and observe missing-module failures.
Exercise real renderer callbacks with fake clocks, real interactive/faux-provider
lifecycle, disabled paths, consumed input, source/observer exceptions, scheduled
and direct rendering, ownership changes, storage failures, actual blocked writes,
limits and repeat captures. Run edited targeted tests and full `npm run check`.
Parent owns independent review, full offline suite, build and packed-consumer
checks. No commit, push, restart or deployment belongs to this writer.
