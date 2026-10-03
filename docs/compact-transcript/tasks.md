---
status: accepted
stage: DECIDED
next: "Parent verifies integrated core with full managed landing gates"
depends-on: [design.md, plan.md]
---

# Tasks: core first, display migrations last

**Status:** 2026-10-03. Core data, interactive adapters, producer hints, and settings UI are integrated and uncommitted. Targeted component and faux-provider tests pass; the parent owns full build/non-e2e/package gates. See [implementation](implementation.md) and [QA](qa.md).
**Authority:** [Design](design.md) fixes behavior; [plan](plan.md) supplies API/map/gates; [research](research.md) bounds later inverse commits.

## T1 — Data, policy and bounded rows

**Depends on:** No implementation task.

- Write failing tests for total visual-line bounds and unknown redacting-producer fallback before code.
- Add public optional hint contract, runtime validation, centralized settings resolution and core row formatting.
- Cover absent/empty/invalid/oversized hints, control sequences, Unicode width, zero/narrow widths, duplicate exceptions and invalid settings.
- **Observed:** Targeted validator/policy/row and settings lifecycle tests pass. Public tool hint types and normalized settings API exist. The interactive transcript now consumes the shared policy and validated providers.
- **Exit:** Targeted validator/policy/row tests pass; no raw args/results or arbitrary component output enter collapse.

## T2 — Transcript adapters and compatibility

**Observed:** Integrated tools/messages/entries/notices/user-shell paths pass component, event/replay, and faux-provider lifecycle tests.

**Depends on:** T1.

- Wire tools/custom messages/displayable entries/extension notices/user-shell through the shared row.
- Keep expanded detail, hidden entries/messages, original notice delivery/coalescing, renderer state/cleanup, image settings and click/keybinding behavior.
- Rewrite old collapsed-output expectations, not the execution assertions. Preserve pendingTools across live updates, replay, Ctrl+O and thinking visibility changes.
- Add faux-provider integration: start → partial → global toggle → thinking toggle → completion → replay; two simultaneous calls; failed custom renderer without raw fallback.
- **Exit:** Component/integration tests pass; model context/results, session records and RPC/stdout fixtures are unchanged. Existing two-argument notify callers need no changes.

## T3 — Semantic producers and settings

**Observed:** Built-in ownership-aware and codemode providers, settings UI, and typed examples are integrated; targeted producer/settings/example tests pass.

**Depends on:** T2.

- Attach hints to built-in presentation owners; protect redacting overrides and plain SDK tools from name-based hint inheritance.
- Preserve read skill/docs/resource labels/ranges, edit add/remove counts, shell output-file availability, codemode nested failure/running counts and recorded cost.
- Add the one settings group and explicit legacy exceptions; retain detail renderers and legacy shell behavior.
- **Exit:** Producer/settings/example and assistant-message tests pass; `npm run check` has no errors/warnings/infos. No new model calls or altered accounting.

## T4 — Later inverse commits in dependent repositories

**Depends on:** T3 and verified expandable parity.

- Pi: replace codemode collapsed branches with its provider; compact mode bypasses inline merging. Keep explicit legacy behavior until consumers permit removal.
- Background fork: add tool/completion-message hints; inverse only enumerated transcript hunks, preserving service/journal/delivery/widget/dashboard/process code.
- Todo fork: add progress/status hints; remove the one shell property/test expectation, not state/widget logic. Verify which package is actually selected before claiming deployment.
- Matt pack: remove built-in execution wrappers after native hints cover them; replace workflow headline scraping with typed producer data, preserving full expanded result. A safe generic workflow row is acceptable if no structured data is available.
- Remove compact-tools contribution/file only when no useful registration remains; rewrite its deployment tests rather than deleting assertions without replacements.
- **Exit:** Each changed fork's full applicable local suite passes; every pack edit is followed by `yolo pack lint /workspace/yolo-packs/matt`. Fork dependencies change only after all functional divergence and consumer compatibility have been verified.

## T5 — Landing verification and handoff

**Depends on:** T4, or an explicitly scoped core-only landing with migration still tracked.

- Run Pi `./test.sh` for non-e2e tests, `npm run check` with full output, and the touched-document checker. Do not run unrestricted full Vitest or paid-provider tests.
- Follow the interactive-testing skill for controlled terminal checks: narrow/normal widths, streaming/cancel/error, images, custom interactive expanded components, many-task completions, Ctrl+O, Ctrl+T and Ctrl+Shift+T.
- Inspect execution/model/RPC/session fixture comparisons and recorded usage/cost parity; do not equate a bounded screenshot with unchanged execution.
- Update Unreleased docs/changelog and migration evidence; preserve published history and historical compact-display docs.
- **Exit:** All applicable gates pass, runtime parity is observed or its remaining manual checks are named explicitly. The core-only repair request authorizes one conventional commit after all landing gates pass; no commit is authorized before then. Push, deploy, restart, and dependent-repository migration still require separate authorization.

## Operational handoff, not an agent action

Later pack changes are deployed by the human using `yolo host apply --assert`, followed by relaunch. Repository pack lint does not certify the host's render. Fork publication/package updates also require host-side action after authorization. Never deploy from the jail or use `rcup` for a pack change.
