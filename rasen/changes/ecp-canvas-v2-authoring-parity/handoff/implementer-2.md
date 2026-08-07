# Implementer 2 handoff — mounted v2 authoring and diagnostic navigation

## Scope and state

- Apply-stage work only in `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`; no machine run-state, canonical Run, commit, push, PR, ship, or archive mutation was performed.
- The shared dirty tree and Implementer 1 foundation were preserved. All mounted edits reuse the existing complete `WirePipelineDefinitionV2` draft and `draft.ts` transactions; no second model, serializer, validator, execution projection, or lifecycle contract was introduced.
- Progress after this relay: **41/67 complete, 26 remaining** (entry was 17/67).
- Completed and checked this relay: **3.1–3.7, 4.1–4.10, 5.5–5.6, and 6.2–6.6**.

## Product changes

### Definition and declaration authoring

- Added `DefinitionContractPanel.tsx` for typed definition inputs/artifacts, named outcomes, and optional positive max-actions/budget limits.
- Moved typed identity/type/positive-limit refusals into the pure draft model and surfaces those exact refusal messages from the page; server preparation remains authoritative for semantic compatibility.
- Added custom declaration rename with existing CompositeRef/BoundedLoop reference rewrites, plus visible built-in rename/delete protection.
- Declaration body AtomicStages now expose exact capability, complete execution policy, ReviewCycle/GoalLoop phase, role, workspace, and all optional execution fields through the shared `V2ExecutionEditor`.
- Added `updateBodyStageExecution`; nested edits preserve body graph/declaration/node/workspace/handoff extensions. Body stage removal now also preserves graph extensions.

### Root node authoring

- Added reusable structured Atomic execution controls for role, workspace access, lead review, verification, runtime/model/effort, sandbox, session reuse, and nested handoff. Optional clearing deletes only the chosen field and preserves unexposed siblings.
- Gate now selects only same-graph AtomicStage targets and edits every decision disposition as `proceed | fail | escalate`; decision edits continue through `updateGateDecisions`. No path authors retired `AtomicStage.execution.gate`.
- Finish uses definition named outcomes while retaining an invalid loaded value for server repair. Existing ordered Choice editing and typed connections remain intact.
- Replaced the minimal BoundedLoop panel with body, goal variant, all limits, every body-outcome continue/exit mapping, complete `bounded-loop-lifecycle/1` thresholds/strategy, exact optional strategy capability, material-change visibility, and all six mechanical trigger dispositions.
- Zero strategy attempts delete capability; positive attempts expose a required blank exact-capability selection so server validation can report the mismatch before save.

### Paired parallel editing

- FanOut and Join now open one paired structured editor backed only by `setParallelMembers`, `updateParallelMember`, `updateParallelContract`, and `removeParallelPair`.
- Mounted controls cover eligible member selection, required/optional partition, condition/path, positive cap/budget, Join identity, proceed/failed outcomes, and explicit paired deletion.
- Join rename commits on blur/Enter rather than mutating identity per keystroke. Save/detail-reload coverage proves both halves remain equal.

### Diagnostic navigation

- `IssuesDrawer` now preserves and renders severity, code, message, full path, and related locations for every issue.
- Typed actions navigate definition fields, root nodes/connections, declarations, body nodes/connections, and nested execution/lifecycle/parallel controls. Unknown/malformed/out-of-range/newer paths remain visible and have no select action.
- Any real draft mutation now clears validation summary, drawer issues, graph badges, definition/declaration/body/root focus, and a stale blocked-save pointer together. Dismiss and re-validation also clear stale focus.

## Tests and evidence

- Red-first mounted run before implementation: `pipeline-canvas-page.test.tsx` had **4 expected failures / 55 passed** for the new missing surfaces.
- Final focused command:

  `pnpm --dir packages/ui exec vitest run test/canvas/v2-authoring-model.test.ts test/canvas/draft.test.ts test/canvas/layout.test.ts test/canvas/pipeline-canvas-page.test.tsx --reporter=dot`

  Result: **4 files / 127 tests passed**.
- `pnpm --dir packages/ui typecheck`: passed.
- `git diff --check -- packages/ui/src/canvas packages/ui/test/canvas rasen/changes/ecp-canvas-v2-authoring-parity/tasks.md`: passed; only repository LF→CRLF notices were emitted.
- `pipelines/auto-decompose/pipeline.yaml` remains untouched and hashes to the required blob **`6f306544010a8950508f1223acfca5d62de407f5`**.
- The two pre-existing jsdom `window.scrollTo` not-implemented messages still appear on stderr in passing page tests.

## Mounted and pure coverage added

- One mounted request authors definition contracts, all Atomic optional policy fields, Gate disposition, research loop domain/mechanical exits, strategy capability, and parallel condition/budget while proving no execution gate field appears.
- Declaration journey renames the declaration, rewrites both root references, creates an execution-complete body stage, and authors review phase/role/workspace.
- Parallel matrix adds a second optional member, condition, cap/budget, failed outcome, saves, reloads detail, and validates exact draft equality; explicit paired delete removes both halves.
- Incomplete lifecycle journey repairs through the shared default lifecycle, proves positive-attempt/missing-capability diagnostics, then proves zero attempts omit capability.
- Diagnostic journey navigates definition, declaration, body execution/capability/access, loop lifecycle, Join partition, and missing Join reference paths; unknown issues retain code and related locations without misselection; a mutation clears every marker.
- Pure tests cover lossless root/body execution and handoff clearing, definition/loop optional-limit clearing, typed identity/type/positive-limit refusals, and preservation of extension-bearing owners.

## Remaining work for the next implementer

1. Baseline evidence tasks **1.1, 1.5, 1.6** remain unchecked. Reconcile their historical red-test wording with the now-green implementation; do not fabricate a failing final tree.
2. Complete persistence/compatibility tasks **7.2–7.8**: explicit v1 edit/save/duplicate pins; one real blank-v2 all-eight authoring request; Management preparation/canonical serializer/detail/digest no-op and intentional-edit stabilization; portable export/import; full mounted sentinel matrix; blank/core parity.
3. Complete verification/evidence **8.1–8.10** and independent review/remediation **9.1–9.5**. Task **9.6** stays open for the parent portfolio PR CI.
4. The current tests use mocked Management responses for mounted negative diagnostics. The next relay must cross the real Management preparation/save/detail/canonical/digest seams before claiming round-trip acceptance.
5. Run full UI/browser visual QA after the dense contract panels stabilize; this relay proves component behavior and types, not final visual polish.

## Important continuation notes

- Use `updateAtomicStageExecution` / `updateBodyStageExecution` for nested execution edits, `updateBoundedLoopContract` for every loop edit, and the paired parallel APIs for every FanOut/Join edit. Do not patch those owners independently in components.
- `Gate` remains the sole gate authority. Never add `execution.gate`.
- A zero-attempt lifecycle strategy must omit capability; positive attempts intentionally remain invalid until the user chooses an exact enabled capability.
- Do not independently delete FanOut or Join. `removeV2Node` still refuses it; only the explicit paired action calls `removeParallelPair`.
- Preserve the authored-v1 compatibility path and do not migrate `auto-decompose`.
- Do not touch `.tmp-ecp6-defaults/`, `rasen/changes/foo/`, retained test temp directories, or the safety stash.
