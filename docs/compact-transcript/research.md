---
status: accepted
stage: DECIDED
next: "Use the source map and migration boundaries in the implementation plan"
---

# Existing boundaries support core-owned collapse

**Status:** 2026-10-03. Static source/history reconnaissance at `55c964318`, clean main before documentation. No runtime tests or paid providers used.
**Reads with:** [Design](design.md) (behavior), [plan](plan.md) (build map), [tasks](tasks.md) (gates).

## Verified from Pi 1.0 source

| Source | Finding and consequence |
| :--- | :--- |
| [Extension types](../../packages/coding-agent/src/core/extensions/types.ts#L478) | Tool renderer context already carries lifecycle, arguments, state, invalidation and expansion. Add separate plain-data hints; do not reinterpret `renderCall` output. |
| [Definition wrapper](../../packages/coding-agent/src/core/tools/tool-definition-wrapper.ts) | Execution wrappers enumerate execution fields, not renderer metadata. Keep new display fields on definitions only; plain SDK `AgentTool` overrides get generic collapse. |
| [Renderer registry](../../packages/coding-agent/src/core/tools/renderers/index.ts) | Display-only imports avoid loading the execution/schema graph. `withBuiltInRenderers` merges call/result renderers; adding hints here requires ownership checks, not unconditional name lookup. |
| [Tool execution](../../packages/coding-agent/src/modes/interactive/components/tool-execution.ts) | Current collapse delegates to arbitrary components; default text preview is ten lines. Inline shell joining is width-dependent and cannot enforce semantic priority. |
| [Custom messages](../../packages/coding-agent/src/modes/interactive/components/custom-message.ts) | Renderer failure currently falls through to boxed raw Markdown content. This is unsafe for an extension whose renderer redacts details. |
| [Custom entries](../../packages/coding-agent/src/modes/interactive/components/custom-entry.ts) | Renderer returning `undefined` means no transcript content. Do not reveal private state entries merely because they exist in the session. |
| [Interactive mode](../../packages/coding-agent/src/modes/interactive/interactive-mode.ts#L2924) | Extension notices call ordinary error/warning/status helpers, bypassing expandable transcript components. Scope the change at `showExtensionNotify`, not every core status call. |
| [Messages](../../packages/coding-agent/src/core/messages.ts) | `display` does not control model context. Custom content and `details` are separate from presentation; no session-message changes are necessary for callback hints. |
| [Visual truncation](../../packages/coding-agent/src/modes/interactive/components/visual-truncate.ts) | Existing utility accounts for wrapped visual lines, but `VisualLinePreview` adds a hint outside its content budget. Reuse width primitives, not that budget contract unchanged. |
| [Edit detail](../../packages/coding-agent/src/core/tools/renderers/edit.ts) | Diff preview is asynchronous and renderer-stateful. Moving collapse must not remove expanded preview/result-state initialization. |
| [Read detail](../../packages/coding-agent/src/core/tools/renderers/read.ts) | Skill/docs/resource classification already supplies useful labels; selected ranges handle null omitted values. Move classification into typed hints, not core allowlists. |
| [Assistant message](../../packages/coding-agent/src/modes/interactive/components/assistant-message.ts) | Thinking summaries use content hashes and a provider seam; the separate thinking visibility path must survive tool presentation changes. |
| [User shell](../../packages/coding-agent/src/modes/interactive/components/bash-execution.ts) | Separate `!`/`!!` component owns streaming, cancellation, truncation and output links. It needs its own adapter, not a fake tool invocation. |

Source docs/types/examples used are this fork's 1.0 tree, not the installed 0.99.1 package. Relevant public contracts: [extensions](../../packages/coding-agent/docs/extensions.md), [TUI](../../packages/coding-agent/docs/tui.md), [settings](../../packages/coding-agent/docs/settings.md), [SDK](../../packages/coding-agent/docs/sdk.md), [session format](../../packages/coding-agent/docs/session-format.md), [keybindings](../../packages/coding-agent/docs/keybindings.md), [RPC](../../packages/coding-agent/docs/rpc.md). Implementation must update their overlapping behavior, not just fix links.

## External inventory — read-only

Paths below are other repositories under `/workspace`; none is edited by this handoff. Historical docs at `/workspace/docs/pi/compact-display/{research,plan,tasks,qa,follow-up}.md` record the earlier display rollout, not authority for current 1.0 APIs.

| Area | Display-only candidate | Must remain |
| :--- | :--- | :--- |
| `yolo-packs/matt/files/extensions/compact-tools.ts` | Entire bash/write/edit overriding registrations and collapsed workflow-result renderer | Native built-in execution/prompt metadata; workflow result's original content and expansion |
| `yolo-packs/matt/pack.json` | Compact-tools file contribution after replacement is deployed | Thinking extensions/settings, usage capture, todo cleanup, all unrelated packages/contributions |
| `pi-background-tasks/index.ts`, `tui.ts` | Shell property and compact transcript result/completion branches | Process manager, model-facing output, completion delivery/journal, service, wake ledger, status widget and dashboard |
| `pi-manage-todo-list/src/tool.ts` | `renderShell: "self"` and collapsed progress presentation | Todo validation/state, continuation instructions, reconstruction, editor widget and cleanup nudge |

The matt wrapper infers shell failures from output regexes and write failures from text prefixes. **Do not move those guesses into core.** Core uses execution `isError`; a known producer may select a safe error summary, but cannot redefine execution outcome. Its expanded bash output is capped at 30 lines; replacing it with native detail is an intentional restoration of full detail, not loss of execution behavior.

## Exact published display-patch boundaries

Use later inverse commits against current code; never rewrite published history or mechanically revert mixed commits. Saved patches are durable evidence under `/workspace/.yolo/durable/compact-transcript/evidence/`.

- **Pi `cac5688b48ba7c2d01dc8900711281185691496d`:** `types.ts` inline shell enum arm; `tool-execution.ts` visibleWidth import, shell union/getter, non-default container routing, two-line join block, mouse routing and rebuild routing; two inline tests in `tool-execution-component.test.ts`. Core compact mode supersedes the join. Keep its legacy behavior/type until remaining consumers are migrated; non-default routing still supports intentional self framing.
- **Pi `a70c386c797dbdeba57cc847a24fa03fbf8e4b40`:** codemode renderer inline shell property; collapsed script line-count branch; `!options.expanded` result block counting nested calls/running/failures/cancellations/cost/output and selecting safe error/path; four new collapsed tests. Replace semantics with a typed provider. Keep full expanded script/nested-call/error/output rendering, header filtering, and expanded full-output path. Do not restore old preview limits. Preserve released changelog text; add a new entry later rather than inverse the historical changelog hunk.
- **Background `7377c7c7601b29ead27ca3b72faf040dd202237e`:** `index.ts` tool shell property; `tui.ts` stop grace-period conditional, expanded-only process metadata, completion summary conditional, collapsed task-error placement, removal of output-tail hint, and final Box-to-Text change; added shell test and two transcript tests. Replace collapse with providers, keep expansion and dashboard. The README's `service.ts` link fix is unrelated and stays; revise only the fork-display description. Do not revert test theme initialization if remaining tests need it.
- **Todo `d7ca87f341573a82c0329e7d4b3fc1754571a3f8`:** exactly one `src/tool.ts` shell property, the new unboxed-shell assertion, and README “Fork display change” section. Progress-count hints replace useful existing collapse separately; do not inverse upstream todo rendering/state/widget code.
- **Dotfiles `e205e80155b75e81a955b66015745da44eb2d13f`:** compact-tools inline shell changes and workflow-result renderer; compact-tools test addition; settings-test inline-shell expectations. Existing historical docs stay untouched. The complete wrapper retirement also supersedes edit collapsing from **`409c5d480ca19545c269fee3608c919e0a7cae4b`** and original pack-owned wrapper from **`b1377bc`**; remove the wrapper only after native producers cover bash/write/edit and workflow detail.

Not obsolete: Pi `9026130e7` thinking label/summary seam, `86e18014a` Markdown thinking previews, and `78e570f99` empty-visible-turn marker; matt thinking-preview/thinking-summary, usage accounting and todo-cleanup. Mixed integration commits `085d19550` and `f349a4d2d` are not revert units.

## Fast-moving — verify before building

- Re-check HEAD and renderer API definitions when implementation starts; this map is commit-scoped.
- The current matt pack selects `git:github.com/mschulkind/pi-background-tasks` but **`npm:pi-manage-todo-list`**, not the local todo fork. An inverse in that fork alone changes no selected package.
- A display-only fork may be retired only after comparing all functional divergence, exported service APIs, packaging and selected consumers. This scout does not certify upstream replacements as equivalent.
- Pack render/host deployment is not verified here. Later pack edits require `yolo pack lint`, host-side `yolo host apply --assert`, and relaunch; `rcup` does not deploy packs.

## Verdict and limits

Adopt definition-attached tool hints and parallel custom message/entry hint registrations. Preserve current renderer signatures and execution wrappers. Generic core rows are preferable to guessing what an unknown renderer means.

Evidence is static inspection and published patch comparison, not measured UI parity. No new runtime test, fork build, deployment, provider call, or implementation is claimed by these documents.
