---
status: accepted
stage: DECIDED
---

# Keep dispatch, transport, and loaded code separate

A workflow observes an input object, then core chooses request identity. The
solution is a small versioned capability at the final provider dispatch, rather
than workflow-owned replacement IDs or replay requests. The callback receives
only immutable scalar metadata, is not awaited, and cannot fail dispatch through
an exception or rejected promise. Synchronous callback work still consumes CPU;
subscribers must keep it bounded.

Use the existing logical request and operation IDs. Assign an SDK invocation ID
at each dispatch and pass it into actual attempt recording. An explicit agent
retry retains its logical request ID; a later tool generation gets another one.
Never turn socket construction into generation proof.

Allocate auxiliary correlation once before a summary retry loop. Cached summaries
have no dispatch and therefore no generated traffic record. Do not migrate the
matt adapter or duplicate its route analytics scanner here.

Stamp compiled runtime inputs at build time. Capture extension entry provenance
at module load, retain it with cached factories, and label dependency-graph
uncertainty rather than claim disk HEAD is loaded code. Rendering reads only
snapshots and process-local counters. Show existing inspector status without its
URL. Automatic activation is disabled independently of every Yolo record:
version 2 is observational only and version 1's positive-proof interpretation is
withdrawn. Read-only delivery does not establish mount-replacement resistance.
A new security contract and adversarial verification, not current private claims,
are required before reconsidering positive consumption.

The [contract](implementation.md) defines exact APIs and defaults. The parent owns
full build, suite, check, and packaged-consumer gates; this child runs short
fixtures and TypeScript checks only.
