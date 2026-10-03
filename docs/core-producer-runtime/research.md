---
status: accepted
stage: CURRENT
---

# Core producer and loaded runtime findings

Started on existing main at `c972e4aa7`, after the shared compact source landed.
The core already owns logical request selection; a workflow argument wrapper runs
before that selection and cannot report the final choice reliably.

The installed SDK, extension, package, provider, and terminal UI documentation,
and the existing [performance contract](../api-performance/implementation.md),
were inspected. ModelRuntime prepares request authentication and headers before
calling the selected provider. That dispatch is observable without recording or
sending an extra request. Actual transport attempts remain the AI adapter's job.

A completion chunk's top-level response identifier is distinct from nested tool
identifiers. Capturing only the known completion chunk boundary avoids adding an
arbitrary metadata extractor. Serialized settings already come from actual
post-hook request bodies; requested/resolved reasoning belongs to the workflow,
not a second interpretation of these fields.

Extension factories have a process cache. Reading disk HEAD on every render would
mislabel a factory that was loaded earlier. A factory-associated entry snapshot
can survive cached reloads, but cannot attest every imported dependency: native
module caches and dependency graphs remain explicitly uncertain.

The repair review supersedes the initial assumption that a launch record could
be positive proof. Yolo's version 2 network record is observational only, and
version 1's positive interpretation was withdrawn: configured mount shadowing
was repaired, but resistance to privileged mount replacement remains unproven.
Read-only delivery and private-loopback claims do not authorize an inspector.
Core therefore leaves automatic activation unconditionally disabled and does
not read record bytes or a mount table. No inspector activation, network
inference, root-pack edit, restart, upload, or paid-provider check is part of
this phase. See the [public contract](implementation.md).
