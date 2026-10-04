---
status: in-review
---

# Core responsiveness producer contract

## Activation and lifecycle

For a future accepted installation, launch Pi with `PI_CORE_TELEMETRY=1` and
an absolute `PI_CORE_TELEMETRY_DIR` naming a dedicated private directory. All
other switch values disable capture, including `0`, regardless of directory or
`YOLO_DURABLE_DIR`. This change does not auto-enable in a jail or inspect Yolo.
The parent owns build/installation verification; no deploy or restart was run.

`main.ts` starts one process capture immediately before executing its interactive,
RPC or print mode and awaits close in `finally`. Early CLI setup/help paths are
not covered. Graceful hard exits also await bounded close: interactive quit/
signals, RPC stdin EOF/extension shutdown/signals, and print SIGTERM/SIGHUP.
Existing disposal/output ordering and exit codes are preserved.
`InteractiveMode.stop()`, crash and dead-terminal paths detach immediately
without delaying terminal cleanup. Repeated live starts share one recorder;
repeat starts after awaited stop get fresh health, observers and histogram.

`CoreTelemetry.ready` completes asynchronous storage initialization. Live capture
can start while storage is initializing; windows arriving before storage is
ready are dropped and counted. Initialization failure stops capture. A configured
path is not a successful-open, sample or write assertion.

## Actual TUI observations

`subscribeTuiResponsiveness(callback)` is exported from pi-tui. It supplies only
a closed category and numeric duration, never a source string. Up to four
independent owners may subscribe; unsubscribe is idempotent and affects only its
owner. Exceptions and promise rejections are swallowed. Synchronous subscriber
work still costs main-thread time and must stay bounded.

| Category | Meaning |
| --- | --- |
| `input_dispatch` | Actual terminal callback synchronous dispatch duration, including consumed input |
| `input_dispatch_error` | Dispatch invocation threw; source exception remains unchanged |
| `render_request` | Redraw request, including input-preempted and forced requests |
| `render_coalesced` | Another request with a pending scheduling timestamp |
| `render_cancelled` | Pending observed request cancelled by TUI stop |
| `render_wait` | First pending request to actual render entry; not physical keypress latency |
| `render` | Actual renderer invocation duration, including layout/diff/write calls |
| `render_error` | Renderer invocation threw; source exception remains unchanged |
| `full_redraw` | Renderer full-redraw counter increased during the invocation |

Count-only categories have zero duration. Render count includes invocations that
throw and no-change invocations; it is not a count of terminal-displayed frames
or writes. Pre-start rendering is not measured. Direct frames without a pending
request have no wait observation. Subscription generation changes invalidate
old pending wait attribution. Both regular and fullscreen renderers use these
same base-class seams.

Nested inclusive timings overlap: input dispatch can request rendering, and
rendering can request another frame. Do not add these aggregates as CPU time.
No causal input-to-frame IDs or phase-level profiler are provided.

## Window record

Files contain one JSON object with this fixed schema:

```json
{
  "schema": "pi.core-responsiveness",
  "schemaVersion": 1,
  "window": 1,
  "windowMs": 5000,
  "metrics": {
    "input_dispatch": { "count": 0, "totalMs": 0, "maxMs": 0 },
    "input_dispatch_error": { "count": 0, "totalMs": 0, "maxMs": 0 },
    "render_request": { "count": 0, "totalMs": 0, "maxMs": 0 },
    "render_coalesced": { "count": 0, "totalMs": 0, "maxMs": 0 },
    "render_cancelled": { "count": 0, "totalMs": 0, "maxMs": 0 },
    "render_wait": { "count": 0, "totalMs": 0, "maxMs": 0 },
    "render": { "count": 0, "totalMs": 0, "maxMs": 0 },
    "render_error": { "count": 0, "totalMs": 0, "maxMs": 0 },
    "full_redraw": { "count": 0, "totalMs": 0, "maxMs": 0 }
  },
  "eventLoop": { "samples": 0, "minMs": null, "maxMs": null, "meanMs": null, "p99Ms": null },
  "losses": { "droppedRecords": 0, "writeErrors": 0 }
}
```

`window` is a per-capture sequence, not an identity. `windowMs` uses a monotonic
clock; no wall timestamp, process/session/request ID or directory is serialized.
Every TUI category is included; zero means no observed invocations in this
window. Delay statistics are null when histogram samples are unavailable, or
when a numeric value is invalid. Histogram nanoseconds become milliseconds;
values are bounded and rounded to three decimal places. Counts cap at one
billion, individual durations at ten minutes, aggregate totals at the safe
integer ceiling. Unknown kinds and negative/nonfinite event durations are ignored.

The histogram is reset each window. Loss counters in records are cumulative
snapshots at serialization, so the current write's later failure cannot appear
in that same record. Live health provides the later counters. Limits stop
observation after 120 windows or the first sample at/after the ten-minute deadline;
a blocked event loop can delay timer delivery.

## Storage and bounded shutdown

Only the final directory may be created; ancestors must exist. POSIX UID checks
reject foreign ownership, symlinks and unsafe writable ancestors, allowing sticky
shared temporary ancestors. The final directory must be owned and exclude group/
other permission bits (created 0700). Windows/no-UID environments fail closed.

An exclusively created 0600 `core-telemetry.lock` owns the directory. Existing
locks are never removed speculatively. Fixed output slots are checked for regular
owned private single-link files. Writes use an exclusive no-follow 0600
`core-telemetry.tmp`, verify file and directory identity, close, then rename to
`core-telemetry-0.json` or `core-telemetry-1.json`. No unrelated files are scanned
or pruned. The two slots retain only the latest committed windows, **not the full
capture history**; repeat captures overwrite slots. Use distinct directories for
independent processes. There is no wall-clock correlation across captures.

One active write plus one pending serialized record is the maximum queue.
Further windows drop without awaiting storage. Record bytes cap at 8 KiB and
cumulative accepted bytes at 1 MiB. Storage failure stops capture and exposes
only a static reason/counter, never an error message or path.

Close takes a final window if still live, detaches timer/histogram/subscription
synchronously, and drains for at most 100 ms. On timeout it counts queued output
as dropped and abandons pending commits. Already-issued filesystem calls cannot
be cancelled; owned handle/temp/lock cleanup waits for eventual completion.
Retaining that lock prevents a new owner racing a blocked old writer. Crashes can
leave stale lock/temp files requiring operator inspection; no automatic stale
recovery is attempted. Ownership/mode/inode checks do not protect against a
malicious same-UID or privileged peer, and writes are not fsync-durable.

## `/runtime`: configuration versus evidence

The existing runtime snapshot adds `responsiveness`:

- `capabilityVersion: 1` and fixed coverage `event_loop_windows_and_tui_callbacks`;
- `configured`, `live`, and static `reason` (`disabled`, `invalid_directory`,
  `not_started`, `starting`, `active`, `storage_error`, `observer_error`, `limit`,
  `closed`, `shutdown_timeout`);
- nullable `health`: written records/bytes, dropped records, write errors, queued
  records, observed windows, input dispatches and actual render invocations.

Before a recorder exists, health is null and text says `unavailable`, not zero.
For an existing recorder, zero is an observed counter value; it does not prove
healthy storage or input/frame activity. `live=true reason=starting` means
observation is active but storage initialization is incomplete. After stop has
completed, the process owner is released and status is configuration-only again.
Reporting performs no telemetry IO, environment dump, Git scan or inspector
activation. Existing transport/inspector semantics remain unchanged.

## Evidence and limits

See [QA](qa.md) for targeted tests and required parent gates. These fixtures
establish instrumentation/lifecycle behavior, not production latency or reduced
CPU. No paid provider request, production capture, attach, signal, deployment,
commit or push was performed.
