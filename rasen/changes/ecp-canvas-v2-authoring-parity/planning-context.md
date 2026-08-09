# Direction Projection Context

- Workstream: `executable-composite-pipelines`
- Active Slice: `v2-authoring-loop-contract-closure` (ECP-6)
- Direction source: `rasen/work/issue-centered-automation-platform/executable-composite-pipelines/slices/v2-authoring-loop-contract-closure/`
- Parent portfolio: `ecp-v2-authoring-loop-contract-closure`
- DAG node: `ecp6-003`; depends on `ecp-v2-default-authoring-and-builtins` being review-clean.

Make blank Canvas consume the canonical v2 factory and complete create/edit/save/reload parity for
CompositeRef, BoundedLoop, Choice, FanOut/Join, Gate, Finish, declaration/body, typed outcomes,
limits, exits, capability and the final shared loop lifecycle policy. Reuse existing declaration/body
CRUD, diagnostics, save/export and digest implementations; do not create a second model or serializer.

Read the parent planning context and all prerequisite artifacts/durable findings first. Append durable
cross-child findings to the parent planning context after proposal.

## Prerequisite contracts now review-clean

- Fresh/not-found Canvas already consumes the shared browser-safe blank-v2 factory mirror; duplicate-from-existing and authored-v1 editing remain compatibility paths.
- Native v2 `Gate` is the sole authored gate authority. It has a typed AtomicStage `target`, authored decisions/outcomes, and complete `proceed | fail | escalate` dispositions. `AtomicStage.execution.gate` is retired and invalid. Canvas must edit the Gate contract and must not recreate a second boolean gate authority.
- Compatibility-normalized v1 retains historical `stage:<id>-gate` identities and `approve | reject` decisions. Canvas save/reload must preserve authored source version and must not silently rewrite existing v1 definitions to v2.
- Every native-v2 AtomicStage has a complete version-1 execution declaration (role, workspace access, and applicable policy fields). The Canvas form must preserve unknown/unexposed fields losslessly and consume server validation diagnostics.
- ReviewCycle phases have distinct capability authority: review/triage/re-review remain read-only `rasen-review`; fix is write-capable `rasen-review-fix@sha256:737e61418515fb67d0bdf46626f80b0e0c418a38d7b931b9bf69d320a520cad0`.
- GoalLoop work remains `rasen-goal-iterate`; authoritative read-only judge is `rasen-goal-judge@sha256:944c21e977d795c1ee2c67f5a0ad0534e8b40a8c1f746ecd83ae89a4e51de40c`. Canvas must preserve work/judge role and workspace separation.
- The prepared execution view is the shared CLI/API/launch projection, is host-aware, and performs native-v2 route/bridge preflight before Run creation. Canvas may display its diagnostics but must not infer a second executable profile locally.
- Effective install/execution closure includes capability owners reached through required pipelines, while public profile roots/picker/`nextWorkflows` remain separate and exclude internal dependency-only workflows.
- Exactly six Change-level package pipelines are native v2. `auto-decompose` remains byte-identical authored v1 with boundary `issue-dispatch-0.3.0`.

## Child 2 acceptance evidence available to this planner

- Three-round independent review-cycle final verdict: CLEAN, Blocker 0 / Major 0 / Minor 0 / Trivial 0.
- Frozen-tree root validation: 432/432 non-local-version files clean; `local-version-runtime` passes 7/7 in two distinct hermetic `E:\` TEMP directories and its shared-TEMP concurrent interference is recorded explicitly.
- UI typecheck and full UI: 57/57 files, 611/611 tests.
- Strict Change validation, build, TypeScript no-emit, lint, diff-check, v1 compatibility adjacency, native-v2 Gate/phase contracts, and `auto-decompose` zero-diff checks passed.
- Full Canvas primitive/Composite/BoundedLoop/Choice/FanOut/Join/Gate/Finish authoring parity remains this child. Final blank-Canvas-to-canonical-Run dogfood remains Child 4; Session effect execution remains ECP-7.

## Planner-1 durable artifact relay

- Proposal, design, one `pipelines-ui` delta spec, and 67 apply tasks are complete and strict-valid. The Change is apply-ready.
- Concrete baseline gaps are larger than serializer preservation: FanOut/Join are explicitly excluded from `isV2EditableNodeKind`; new AtomicStage values omit required execution; Gate cannot author target/dispositions; BoundedLoop cannot author complete limits/domain exits/lifecycle; root wire mirrors omit closed parallel/Gate fields; and diagnostics currently leave both declaration paths and `/limits/budget` unmapped.
- The design keeps one complete `WirePipelineDefinition` draft and the existing server canonical serializer/preparation. Nested edits must patch owned paths and preserve siblings/extensions; no UI-local execution profile, lifecycle reducer, graph validator, model, or serializer is permitted.
- FanOut/Join authoring is a paired referential transaction. Membership, required/optional partitions, paths, conditions, cap/budget, join identity, outcomes, rename, and deletion must update both halves coherently.
- Root/declaration identity operations must rewrite typed connections plus Gate targets, FanOut/Join references, CompositeRef declaration ids, and BoundedLoop bodies. Shared server preparation stays authoritative for semantic legality.
- Diagnostic locator parity now explicitly covers definition fields, root nodes/connections, declarations, body nodes/connections, and nested execution/lifecycle/parallel fields. Malformed/newer paths remain visible and unmapped rather than being dropped or misdirected.
- Acceptance requires real Canvas-control creation followed by validation/save/detail reload and canonical prepare/serialize/export/import digest evidence. A preserved fixture alone is not authoring evidence.
- Authored v1 edit/save/duplicate remains v1 compatibility behavior. Fresh/not-found authoring remains browser-safe blank v2. Child 4 owns the canonical Run dogfood; ECP-7 owns Session/effect execution; ECP-8 owns release closure; `auto-decompose` remains byte-identical v1 for 0.3.0.
