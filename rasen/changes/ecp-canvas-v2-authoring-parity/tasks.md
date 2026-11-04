## 1. Contract Baseline and Red Tests

- [x] 1.1 Record the current eight-kind kernel shapes and representative native-v2 built-in fixtures in Canvas test builders without copying runtime behavior into UI code.
- [x] 1.2 Add failing wire-shape tests for AtomicStage execution, Gate target/dispositions, required BoundedLoop lifecycle, complete FanOut metadata, complete Join partitions/outcomes, and phase/variant fields.
- [x] 1.3 Replace the existing expectation that FanOut/Join are non-editable with failing palette/model tests that require all eight v2 kinds to be authorable.
- [x] 1.4 Add failing diagnostic-locator tests for `/limits/budget`, declaration contracts, body nodes/connections, and nested execution/lifecycle/parallel paths while retaining malformed/out-of-range unmapped cases.
- [x] 1.5 Add failing page journeys proving a newly added AtomicStage and BoundedLoop are currently rejected because execution/lifecycle authoring is incomplete.
- [x] 1.6 Add failing save/reload tests that distinguish field preservation from genuine creation through visible Canvas controls.

## 2. Complete Wire Types and Pure Draft Model

- [x] 2.1 Strengthen `packages/ui/src/api/types.ts` to mirror the closed kernel v2 execution, Gate, FanOut, Join, BoundedLoop lifecycle, phase, variant, definition-limit, and typed contract fields.
- [x] 2.2 Keep extension-bearing definition/graph/node/declaration values structurally lossless and add compile-time probes that unexposed fields remain representable.
- [x] 2.3 Add pure nested patch helpers for AtomicStage execution/workspace/handoff, definition limits/contracts, BoundedLoop limits/lifecycle/exits, Gate dispositions, and parallel member data.
- [x] 2.4 Extend the editable-kind and root-palette vocabulary to all eight supported v2 kinds while retaining the AtomicStage-only declaration-body palette.
- [x] 2.5 Make new AtomicStage values carry an exact catalog capability plus complete visible `execution.version: 1`, role, and workspace access authored fields.
- [x] 2.6 Make root rename/remove transactions rewrite typed connections, Gate targets, FanOut branches/member paths/join reference, and Join inputs/partitions or refuse a mutation that cannot stay coherent.
- [x] 2.7 Add declaration rename support that rewrites CompositeRef and BoundedLoop references while retaining the referenced-delete guard.
- [x] 2.8 Unit-test every nested patch and reference rewrite with sentinel unexposed fields before wiring components.

## 3. Definition and Declaration Authoring

- [x] 3.1 Add a structured definition-contract editor for typed inputs, artifacts, named outcomes, max actions, and budget without introducing a second draft model.
- [x] 3.2 Add model-level uniqueness/type/positive-value handling that leaves shared server preparation authoritative and surfaces local identity refusals verbatim.
- [x] 3.3 Extend the declaration editor to rename custom declarations and preserve built-in provenance protection plus all existing reference guards.
- [x] 3.4 Extend declaration body AtomicStage creation and editing to include complete execution declarations and exact capability revisions.
- [x] 3.5 Add optional ReviewCycle and GoalLoop phase controls plus goal-body role/workspace visibility, using the closed server vocabulary and no role-from-label inference.
- [x] 3.6 Preserve body-stage execution/phase fields and graph extensions through rename, capability change, connection edit, and deletion.
- [x] 3.7 Add mounted declaration journeys for create/edit/connect/rename/reference/delete-refusal and server-reported incompatible phase/capability/access cases.

## 4. Atomic, Composite, Choice, Gate, Finish, and Loop Panels

- [x] 4.1 Add AtomicStage controls for capability, role, workspace access, lead-review, verification, runtime/model/effort, sandbox, session reuse, and nested handoff with optional-field clearing semantics.
- [x] 4.2 Keep CompositeRef declaration selection and typed port summaries synchronized with declaration contract edits and renamed declaration ids.
- [x] 4.3 Retain ordered unique Choice outcomes and typed connection authoring while mapping duplicate/invalid outcomes to the property control.
- [x] 4.4 Add Gate target selection restricted to same-graph AtomicStages and one structured disposition selector for every authored decision.
- [x] 4.5 Make Gate outcome edits add/remove matching dispositions explicitly and prove no retired `AtomicStage.execution.gate` field is emitted.
- [x] 4.6 Keep Finish outcome editing tied to the definition's named outcomes while allowing the server to diagnose an invalid authored terminal mapping.
- [x] 4.7 Replace the minimal BoundedLoop panel with body, optional goal variant, maxIterations/maxActions/budget, and every reachable body-outcome continue/exit mapping control.
- [x] 4.8 Add the complete lifecycle-v1 editor for thresholds, bounded strategy attempts, material-change requirement, exact optional strategy capability, and all six mechanical trigger dispositions.
- [x] 4.9 Enforce the UI authoring relation that zero strategy attempts omit capability and positive attempts require an explicit exact capability before save can validate.
- [x] 4.10 Add positive and negative mounted journeys for Gate sole authority, loop domain-versus-mechanical exits, research report-tail non-success, incomplete lifecycle, and strategy mismatch diagnostics.

## 5. Paired FanOut and Join Authoring

- [x] 5.1 Implement one pure paired-parallel transaction that creates FanOut and Join from selected eligible root members with stable identities.
- [x] 5.2 Author ordered branches/members, member paths, required/optional status, conditions, positive concurrency cap/budget, Join reference, partitions, and distinct proceed/failed outcomes together.
- [x] 5.3 Implement atomic membership, rename, condition, partition, cap/budget, Join-id, and outcome updates across both structural halves.
- [x] 5.4 Refuse empty membership and require explicit paired deletion so one half cannot become a hidden dangling structure.
- [x] 5.5 Replace the read-only FanOut/Join detail boundary with selectable structured editors while retaining clear member/limit summaries in view mode.
- [x] 5.6 Add model and mounted matrices for required/optional membership, conditions, cap/budget limits, mismatched partitions, missing Join references, rename/delete rewrites, and save/reload equality.

## 6. Nested Diagnostic Locator Parity

- [x] 6.1 Replace root-only path matching with JSON-Pointer segment resolution for definition fields, root nodes/connections, declarations, body nodes/connections, and nested field tails.
- [x] 6.2 Extend issue target types and `IssuesDrawer` actions so selecting a declaration/body issue opens the correct declaration and selects or marks its closest control.
- [x] 6.3 Route top-level input/artifact/outcome/limit issues to the definition-contract editor, including the proven `/limits/budget` gap.
- [x] 6.4 Route execution, Gate, loop lifecycle/exit, FanOut member/cap/budget, and Join partition/outcome paths to the owning root panel control.
- [x] 6.5 Preserve severity, code, message, related locations, and full path for malformed, out-of-range, or newer unmapped diagnostics without selecting the wrong element.
- [x] 6.6 Verify that any draft mutation clears validation summary, issue drawer markers, root/body/declaration highlights, and blocked-save pointers together.

## 7. Duplicate, Save, Reload, and Canonical Round Trips

- [x] 7.1 Add one v2 duplication helper that forks name, definition id, and source id into user identities while preserving graph/contracts and never changing authored version.
- [x] 7.2 Pin existing authored-v1 edit/save/duplicate behavior so v1 definitions remain v1 and keep the compatibility origin/fields expected by the server.
- [x] 7.3 Drive a real blank-v2 Canvas journey that authors definition/declaration contracts and all eight root kinds, then capture the exact validation/save request.
- [x] 7.4 Feed the Canvas-authored request through real preparation and the canonical serializer, reload detail, and assert complete authored-field plus source/capability/plan-digest equality for a no-op round trip.
- [x] 7.5 Add an intentional-edit round trip that proves only the selected semantic projection changes and the next serialize/reload stabilizes to equal digests.
- [x] 7.6 Add export/import coverage using Node path APIs and native Windows/POSIX temporary paths without hard-coded separators.
- [x] 7.7 Prove unknown definition, graph, node, declaration, execution, and lifecycle sentinel fields survive every unrelated Canvas control exercised by the mounted matrix.
- [x] 7.8 Re-run blank Canvas/core factory parity and prove fresh/not-found paths use v2 while duplicate-from-authored-v1 remains the compatibility path.

## 8. Focused Verification and Evidence

- [x] 8.1 Run Canvas pure-model, layout, page, declaration-export, build-split, and engine-support tests with all new positive/negative matrices green.
- [x] 8.2 Run the UI package typecheck and resolve every strengthened wire-contract error without weakening types back to open `unknown` casts for closed fields.
- [x] 8.3 Run the full UI component suite and record exact file/test counts with no failures.
- [x] 8.4 Run focused root Definition preparation, canonical serializer/digest, Management pipeline API, custom Composite, native v2 lowerer, FanOut/Join, Gate, and bounded-loop lifecycle tests.
- [x] 8.5 Run one real Management validation/save/detail round-trip against the Canvas-authored fixture and record diagnostics and digest evidence.
- [x] 8.6 Verify `pipelines/auto-decompose/pipeline.yaml` is byte-identical to its pre-Change v1 blob and absent from every Canvas migration assertion.
- [x] 8.7 Run `pnpm build`, root TypeScript no-emit, lint, and `git diff --check`; classify only pre-existing warnings with evidence.
- [x] 8.8 Run `node bin/rasen.js validate ecp-canvas-v2-authoring-parity --strict` and confirm every proposal/design/spec/task artifact remains internally consistent.
- [x] 8.9 Run the full root suite from a clean isolated TEMP, separately reproduce any shared-TEMP local-version anomaly hermetically, and record exact passed/pending/failed counts without hiding exceptions.
- [x] 8.10 Write `evidence/implementation-report.md` containing the acceptance matrix, positive/negative cases, save/reload/digest proof, v1 compatibility proof, diagnostic locator proof, test commands, and accepted limitations.

## 9. Independent Review and Parent Delivery Gate

- [x] 9.1 Run an independent non-author review against the Direction slice and this Change's full artifacts, with Blocker/Major/Minor/Trivial findings and code/test evidence.
- [x] 9.2 Remediate every accepted Blocker/Major and all feasible lower-severity findings through role-separated fix and fresh re-review rounds until clean or explicitly escalated.
- [x] 9.3 Re-run the affected focused matrices plus final full UI/root/typecheck/build/lint/strict-validation gates on the frozen post-review tree.
- [x] 9.4 Confirm the final review report has zero open Blocker/Major findings and records any accepted limitation without claiming the following vertical-proof Change.
- [x] 9.5 Confirm Child 4 can consume the saved loop-plus-parallel Canvas definition without a second model, serializer, lifecycle policy, or execution projection.
- [ ] 9.6 On the single parent portfolio PR, require green Windows, Linux, and macOS CI for canonical serialization, UI authoring, and round-trip suites.
