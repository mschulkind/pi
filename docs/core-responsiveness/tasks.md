---
status: in-review
---

# Core responsiveness tasks

## Completed implementation

- [x] Read producer/runtime, root responsiveness and sibling workflow references;
  keep their source and documentation read-only.
- [x] Add tests first; observe missing-module red for TUI and recorder modules.
- [x] Instrument actual input, redraw scheduling and renderer boundaries in both
  TUI modes, preserving source exceptions and disabled hot-path work.
- [x] Add explicitly activated, bounded event-loop/TUI capture with asynchronous
  private storage, ownership checks, retention and bounded shutdown.
- [x] Integrate CLI/interactive lifecycle and truthful `/runtime` health.
- [x] Add fake-clock, disabled, storage-failure, genuinely blocked-writer,
  delayed-initialization, ownership and repeat-lifecycle regressions.
- [x] Fix observed-red regression: waiting for current IO while capture is live
  must not release its ownership lock.
- [x] Add source-fork documentation and Unreleased changelog entries.
- [x] Resolve reviewer P1 with six observed-red noninteractive lifecycle tests:
  RPC EOF/extension shutdown/SIGTERM/SIGHUP and print SIGTERM/SIGHUP now await
  bounded telemetry close before hard exit; lock removal permits a fresh capture.
- [x] Resolve reviewer P2 with an observed-red changelog-link test and a stable
  fork repository URL; package-root links no longer escape installed content.

## Acceptance queue

- [x] Initial independent source/security/lifecycle review completed; P1/P2 found.
- [x] Parent independent re-review of P1/P2 fixes and final acceptance.
- [x] Parent full offline suite, build, packed SDK/CLI and documentation gates.
- [ ] Human publication and installation/restart, only after acceptance.

Profiling was removed from scope at the user's request. Telemetry samples from
an installed process remain distinct from fixture evidence; no production CPU
or latency improvement is claimed. Publication, deployment and restart are
human steps. See [QA](qa.md) for the parent landing evidence.
