---
status: in-review
---

# Core responsiveness: measurement boundaries

## Problem and evidence

The root [responsiveness research](../../../../docs/pi/responsiveness/research.md)
records main-thread and repeated-read hypotheses for another jail. It does not
identify JavaScript stacks, establish the loaded build, or prove a recorder was
active. This implementation does not attach to that process or diagnose PID 79.

The existing [producer/runtime contract](../core-producer-runtime/implementation.md)
separates generation dispatch, HTTP attempts and runtime snapshots. Core
responsiveness is a fourth evidence category: local scheduling and synchronous
TUI callback time. It is neither request usage nor server/network timing.

Read-only references were the root responsiveness documents and sibling
`pi-dynamic-workflows/src/workflow-performance.ts`. No workflow, scanner,
provider, profiling, inspector, Yolo, deployed-home or root-repository source
was changed.

## Concrete boundaries

`TuiBase.start()` passes the terminal its real input callback. Timing surrounds
that callback's dispatch, including listeners, consumed terminal replies and
focused input handling. A consumed input still has an observation; an exception
still propagates. The observer never receives the input string.

Both `TuiMainScreen` and `TuiAltScreen` inherit the same scheduling boundary.
A first redraw request starts scheduling wait; repeated requests before the
frame count as coalesced. Scheduled, input-preempted, forced and direct renders
all reach `performRender()`, which surrounds the actual renderer `doRender()`.
Stopping cancels pending wait. Subscription generations avoid attributing an
old owner's pending timestamp to a new owner.

For example, two requests while a frame is pending produce request counts and
one coalesced count, one wait duration, then one actual render duration. These
numbers describe different work and must not be summed as CPU time. Direct
rendering without a pending request has a frame duration but no wait sample.

Node's `monitorEventLoopDelay()` is sampled/reset in five-second windows at
20-ms resolution. No histogram samples means null statistics, not zero delay.
The histogram baseline includes its sampling resolution; it is not a trace of
individual input events.

## Why aggregates

Fixed numeric categories make cardinality and serialization bounded. Per-event
IDs, keys, prompts, output, component names, paths, URLs, errors and stacks are
unnecessary for these boundaries and are excluded. Callback timing is not
physical keypress latency; render invocation is not terminal display completion.
No input-to-frame causal correlation, CPU profile, phase breakdown, provider
attribution or production improvement claim is added.
